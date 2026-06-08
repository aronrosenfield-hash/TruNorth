#!/usr/bin/env node
/**
 * Better Cotton Initiative — corporate members (Retailer & Brand Members)
 * — DW-57 (BACKLOG promotion).
 *
 *   https://bettercotton.org/who-we-are/members/
 *
 * Better Cotton (formerly the Better Cotton Initiative / BCI) is the world's
 * largest cotton-sustainability programme. The Retailer & Brand Member
 * directory lists every retailer/brand that has formally committed to
 * sourcing Better Cotton and that pays the per-tonne Volume-Based Fee that
 * funds farm-level training. Members must report uptake annually.
 *
 * NORMALISED OUTPUT
 *   data/raw/better-cotton/<YYYY-MM-DD>.json
 *   {
 *     _license, _source, _generated_at,
 *     _stats: { total_members, with_member_since },
 *     members: [{
 *       brand,                // display name
 *       country?: string,     // free text (member's HQ country)
 *       memberSince?: number, // year (YYYY)
 *       category?: string,    // "Retailer & Brand" | "Civil Society" | ...
 *       sourceUrl: string
 *     }]
 *   }
 *
 * STRATEGY
 *   The page is a single server-rendered list with member cards. Better
 *   Cotton has historically rotated through several Drupal/WordPress
 *   templates (.member-card / .bci-member / <li class="member">). We
 *   tolerate three variants via regex parsing — no cheerio dependency
 *   needed (consistent with leaping-bunny / bcorp / animal-welfare-union).
 *
 * THROTTLE / POLITENESS
 *   - 2 sec between requests (REQ_DELAY_MS)
 *   - Honest UA identifying TruNorth + this pipeline
 *   - 5xx retry with exponential backoff (3 tries)
 *   - Cloudflare / 403 detection → status="blocked"; the workflow does not
 *     fail (the merger reads the last good snapshot).
 *
 * FIXTURE MODE
 *   --fixture reads scripts/fixtures/better-cotton/sample.html instead of
 *   hitting the network. Used by the test suite + local development.
 *
 * Locally:
 *   node scripts/better-cotton-fetch.mjs              # live (CI only)
 *   node scripts/better-cotton-fetch.mjs --fixture    # offline
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/better-cotton");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/better-cotton");

export const SOURCE_URL = "https://bettercotton.org/who-we-are/members/";
const UA = "TruNorth-BetterCotton/1.0 (+https://www.trunorthapp.com; data pipeline for sustainable-cotton certification transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES = 3;

const FIXTURE_MODE = process.argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchHtml(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const fx = path.join(FIXTURE_DIR, "sample.html");
    if (existsSync(fx)) return { ok: true, body: await fs.readFile(fx, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 503 ||
        /cf-(?:browser-verification|chl-bypass)|just a moment\.\.\./i.test(body)) {
      return { ok: false, body, blocker: "cloudflare", status: res.status };
    }
    if (!res.ok && attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

/* ------------------------------- utils ---------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  aacute: "á", agrave: "à", acirc: "â", auml: "ä", aring: "å",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
  oacute: "ó", ograve: "ò", ocirc: "ô", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
  ntilde: "ñ", ccedil: "ç", szlig: "ß",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** "Member since 2014" → 2014 (or null). */
export function parseMemberSince(text) {
  if (!text) return null;
  const m = String(text).match(/(?:member\s*since|since|joined)[^0-9]*((?:19|20)\d{2})/i);
  if (m) return Number(m[1]);
  const bare = String(text).match(/\b((?:19|20)\d{2})\b/);
  return bare ? Number(bare[1]) : null;
}

/* ------------------------------- parser --------------------------------- */

// Member cards on bettercotton.org rotate through three templates we have
// observed. They all sit inside <(li|div|article) class="…member-card…">
// (or .bci-member / .member-listing). The brand name is in
// .member-name / h3 / first anchor; an optional small line carries
// "Member since YYYY" and another optional class .member-country holds
// the country label.
export function parseMembersHtml(html) {
  if (!html) return [];
  const out = [];

  const blockRe = /<(li|div|article)\b[^>]*class="(?:[^"]*\s)?(?:member-card|bci-member|member-listing|retailer-brand-member)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:member-name|brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    // Drop obvious non-brand cells (footer links).
    if (/^(members?|contact|join|read more|home|about)$/i.test(brand)) continue;

    let country = null;
    const countryMatch =
      inner.match(/<[^>]*class="[^"]*\b(?:member-country|country|location)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (countryMatch) country = stripTags(countryMatch[1]) || null;

    let category = null;
    const catMatch =
      inner.match(/<[^>]*class="[^"]*\b(?:member-category|member-type|category)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (catMatch) category = stripTags(catMatch[1]) || null;

    const memberSince = parseMemberSince(stripTags(inner));

    out.push({ brand, country, memberSince, category, sourceUrl: SOURCE_URL });
  }

  // Fallback: very plain <li>Brand Name</li> list (older template variant).
  if (out.length === 0) {
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = liRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      if (!text || text.length < 2 || text.length > 80) continue;
      if (/menu|cookie|sitemap|privacy|terms|contact/i.test(text)) continue;
      if (/[.!?]\s+\w/.test(text)) continue;
      out.push({ brand: text, country: null, memberSince: null, category: null, sourceUrl: SOURCE_URL });
    }
  }

  // De-dupe (case-insensitive brand).
  const seen = new Set();
  return out.filter(r => {
    const k = r.brand.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`Better Cotton fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const res = await fetchHtml(SOURCE_URL);
  let members = [];
  let status = "ok";
  let note;
  if (!res.ok) {
    console.error(`  BLOCKED (${res.blocker})`);
    status = "blocked"; note = res.blocker;
  } else {
    members = parseMembersHtml(res.body);
    console.log(`  Parsed ${members.length} members`);
    if (members.length === 0) status = "empty";
  }

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "Public membership directory (bettercotton.org); cite source URL.",
    _source: SOURCE_URL,
    _generated_at: new Date().toISOString(),
    _status: status,
    ...(note ? { _note: note } : {}),
    _stats: {
      total_members: members.length,
      with_member_since: members.filter(m => m.memberSince).length,
    },
    members,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${members.length} members)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("better-cotton-fetch failed:", err);
    process.exit(1);
  });
}
