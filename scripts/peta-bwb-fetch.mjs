#!/usr/bin/env node
/**
 * PETA Beauty Without Bunnies — animal-testing brand database (quarterly) — B-14.
 *
 * Two lists, both public:
 *   - https://crueltyfree.peta.org/companies-do-test-on-animals/    (negative)
 *   - https://crueltyfree.peta.org/companies-dont-test-on-animals/  (positive)
 *
 * PETA's BWB database is the broadest cruelty-free signal available (more
 * brands than Leaping Bunny, but a slightly less strict pledge). Pairing
 * the two gives belt-and-suspenders coverage of the cruelty-free space
 * + an explicit negative signal for brands that DO test.
 *
 * STRATEGY
 *   1. Fetch each list page once (these are flat A–Z listings).
 *   2. Brand entries are rendered as <li> or <a> inside the main directory
 *      container. We support multiple class-name variants.
 *   3. Fall back to a permissive regex if the structured selectors miss.
 *
 * THROTTLE / POLITENESS
 *   - 2 req/sec (only 2 requests anyway — both list pages)
 *   - Honest UA identifying TruNorth + this pipeline
 *
 * KNOWN BLOCKER
 *   PETA occasionally fronts crueltyfree.peta.org with Cloudflare bot
 *   protection. If the fetcher hits a 403 / 503 with a Cloudflare body,
 *   we log the blocker, exit 0 (non-fatal), and the merger reads the
 *   previous snapshot. That avoids breaking the weekly merge.
 *
 * OUTPUT
 *   public/data/_raw/peta-bwb.json
 *   {
 *     generated_at,
 *     source_urls: { do_test, dont_test },
 *     do_test:   [{ brand, parent_company? }],
 *     dont_test: [{ brand, parent_company? }],
 *     blocked?:  { do_test?: "cloudflare", dont_test?: "cloudflare" }
 *   }
 *
 * Runs quarterly via .github/workflows/peta-bwb-quarterly.yml.
 *
 * Locally:
 *   node scripts/peta-bwb-fetch.mjs             # live scrape (DO NOT in worktree)
 *   node scripts/peta-bwb-fetch.mjs --fixture   # use fixture HTML
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "public/data/_raw");
const OUT_FILE = path.join(RAW_DIR, "peta-bwb.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/cruelty-free");

const PETA_BASE = "https://crueltyfree.peta.org";
const DO_TEST_URL   = `${PETA_BASE}/companies-do-test-on-animals/`;
const DONT_TEST_URL = `${PETA_BASE}/companies-dont-test-on-animals/`;
const REQ_DELAY_MS = 2000;
const UA = "TruNorth-PETA-BWB/1.0 (+https://www.trunorthapp.com; data pipeline for cruelty-free certification transparency)";
const FIXTURE_MODE = process.argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchText(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const file = url.includes("dont-test")
      ? "peta-dont-test.html"
      : "peta-do-test.html";
    const p = path.join(FIXTURE_DIR, file);
    if (existsSync(p)) return { ok: true, body: await fs.readFile(p, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    const body = await res.text();
    // Cloudflare bot wall detection
    if (
      res.status === 403 || res.status === 503 ||
      /cf-(?:browser-verification|chl-bypass)|just a moment\.\.\./i.test(body)
    ) {
      return { ok: false, body, blocker: "cloudflare", status: res.status };
    }
    if (!res.ok && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

/* ------------------------------- parser --------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", szlig: "ß",
  Eacute: "É", Aacute: "Á", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

function decode(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// PETA brand lists are rendered as flat <li> rows or <div class="company-row">
// entries inside the main content area. We accept either, and fall back to
// scanning all <a> tags whose href contains "/companies/" or whose parent
// has class "bwb-brand".
export function parsePetaListPage(html) {
  if (!html) return [];

  const items = [];

  // Variant A: explicit list rows
  const liRe = /<(li|div)\b[^>]*class="(?:[^"]*\s)?(?:bwb-brand|company-row|company-listing)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let parent_company = null;
    const parentMatch =
      inner.match(/<[^>]*class="[^"]*\b(?:parent-company|parent)\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/\((?:parent[: ]\s*)?([^()]{3,80})\)\s*$/i);
    if (parentMatch) {
      parent_company = stripTags(parentMatch[1]).replace(/^parent\s*[:\-]?\s*/i, "").trim() || null;
    }

    items.push({ brand, parent_company });
  }

  // Variant B fallback: scan section <ul> bullets if Variant A found nothing.
  if (items.length === 0) {
    const altRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = altRe.exec(html)) !== null) {
      const inner = m[1];
      // Skip nav / menu items
      if (/menu|nav|footer|widget/i.test(inner)) continue;
      const brand = stripTags(inner.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/i, "$1"));
      // Heuristic: brand names are typically 2–60 chars, no full sentence
      if (!brand || brand.length < 2 || brand.length > 80) continue;
      if (/[.!?]\s+\w/.test(brand)) continue;
      items.push({ brand, parent_company: null });
    }
  }

  // Dedupe by lowercase brand name (PETA lists can include duplicates across
  // alphabetic anchors for multi-word brand names).
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = `${it.brand.toLowerCase()}|${(it.parent_company || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`PETA BWB fetcher starting (fixture=${FIXTURE_MODE})...`);

  const blocked = {};

  const doRes = await fetchText(DO_TEST_URL);
  if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  const dontRes = await fetchText(DONT_TEST_URL);

  let do_test = [];
  let dont_test = [];

  if (doRes.ok) {
    do_test = parsePetaListPage(doRes.body);
    console.log(`  do_test:   ${do_test.length} brands`);
  } else {
    blocked.do_test = doRes.blocker;
    console.error(`  do_test:   BLOCKED (${doRes.blocker})`);
  }

  if (dontRes.ok) {
    dont_test = parsePetaListPage(dontRes.body);
    console.log(`  dont_test: ${dont_test.length} brands`);
  } else {
    blocked.dont_test = dontRes.blocker;
    console.error(`  dont_test: BLOCKED (${dontRes.blocker})`);
  }

  await fs.mkdir(RAW_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    source_urls: { do_test: DO_TEST_URL, dont_test: DONT_TEST_URL },
    do_test_count: do_test.length,
    dont_test_count: dont_test.length,
    do_test:   do_test.sort((a, b) => a.brand.localeCompare(b.brand)),
    dont_test: dont_test.sort((a, b) => a.brand.localeCompare(b.brand)),
  };
  if (Object.keys(blocked).length > 0) out.blocked = blocked;
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  // We exit 0 even on partial blocker — merger reads previous snapshot.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("peta-bwb-fetch failed:", err);
    process.exit(1);
  });
}
