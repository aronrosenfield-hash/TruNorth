#!/usr/bin/env node
/**
 * Animal Welfare Watchdog Union — Sprint F (animals category)
 *
 * Fan-out fetcher unifying SIX independent corporate animal-welfare signals
 * into one normalized snapshot. Two of the original eight watchdog sources
 * (PETA Beauty Without Bunnies + Leaping Bunny) are already covered by the
 * existing scripts/peta-bwb-fetch.mjs and scripts/leaping-bunny-fetch.mjs
 * pipelines and are NOT duplicated here — the merger reconciles their raw
 * output as a separate input.
 *
 * NEW SOURCES (this script):
 *   1. Cruelty Free International (Leaping Bunny's UK arm — separate roster)
 *        https://www.crueltyfreeinternational.org/leaping-bunny-program
 *   2. Choose Cruelty Free (Australian list, now archived under CCF.org.au)
 *        https://www.choosecrueltyfree.org.au
 *   3. The Vegan Society Trademark (vegan-formulation certification)
 *        https://www.vegansociety.com/the-vegan-trademark
 *   4. The Humane League — Corporate Animal-Welfare Pledge Tracker
 *        https://thehumaneleague.org/corporate-pledges-tracker
 *   5. Compassion in World Farming — Business Benchmark on Farm Animal Welfare
 *      (tier 1–5 ranking, food companies only)
 *        https://www.compassioninfoodbusiness.com/our-work/business-benchmark-on-farm-animal-welfare/
 *   6. Open Wing Alliance — cage-free progress reports (commitment %, deadline)
 *        https://openwingalliance.org
 *
 * NORMALIZED OUTPUT (data/raw/animal-welfare-union/<YYYY-MM-DD>.json):
 *   {
 *     _license, _generated_at,
 *     _sources: [{ key, url, count, status, note? }],
 *     _stats:   {...},
 *     entries:  [{
 *       brand,
 *       parent_company?,
 *       sources: [<source-key>...],
 *       signals: {
 *         crueltyFreeCertified?: bool,
 *         veganTrademark?:       bool,
 *         farmAnimalWelfareTier?: 1|2|3|4|5,
 *         cageFreeCommitment?: { committed: bool, deadline: number?, progress: number? }
 *       },
 *       source_urls: { <source-key>: <url> }
 *     }]
 *   }
 *
 * THROTTLE / POLITENESS
 *   - 2s delay between distinct sources.
 *   - Honest UA identifying TruNorth + this pipeline.
 *   - Cloudflare / 403 / 5xx detected per-source and recorded with status="blocked";
 *     the run never fails the workflow — the merger reads the previous snapshot.
 *
 * FIXTURE MODE
 *   --fixture loads HTML from test/fixtures/animal-welfare-union/<key>.html so
 *   the script can be exercised end-to-end without network. Tests use this.
 *
 * NO new dependencies — regex parsing consistent with the existing
 * peta-bwb-fetch.mjs and leaping-bunny-fetch.mjs (cheerio is NOT installed
 * project-wide, so we honour "no new deps" over the spec's cheerio hint).
 *
 * Locally:
 *   node scripts/animal-welfare-union-fetch.mjs              # live (do NOT in worktree)
 *   node scripts/animal-welfare-union-fetch.mjs --fixture    # use HTML fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/animal-welfare-union");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/animal-welfare-union");

const UA = "TruNorth-AnimalWelfareUnion/1.0 (+https://www.trunorthapp.com; sprint-F animal-welfare watchdog union)";
const REQ_DELAY_MS = 2000;
const FIXTURE_MODE = process.argv.includes("--fixture");

export const SOURCES = [
  { key: "cfi-leaping-bunny",   url: "https://www.crueltyfreeinternational.org/leaping-bunny-program" },
  { key: "choose-cruelty-free", url: "https://www.choosecrueltyfree.org.au" },
  { key: "vegan-society",       url: "https://www.vegansociety.com/the-vegan-trademark" },
  { key: "humane-league",       url: "https://thehumaneleague.org/corporate-pledges-tracker" },
  { key: "ciwf-benchmark",      url: "https://www.compassioninfoodbusiness.com/our-work/business-benchmark-on-farm-animal-welfare/" },
  { key: "open-wing-alliance",  url: "https://openwingalliance.org" },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------ fetch ----------------------------------- */

async function fetchText(url, key, attempt = 0) {
  if (FIXTURE_MODE) {
    const p = path.join(FIXTURE_DIR, `${key}.html`);
    if (existsSync(p)) return { ok: true, body: await fs.readFile(p, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json" },
    });
    const body = await res.text();
    if (
      res.status === 403 || res.status === 503 ||
      /cf-(?:browser-verification|chl-bypass)|just a moment\.\.\./i.test(body)
    ) {
      return { ok: false, body, blocker: "cloudflare", status: res.status };
    }
    if (!res.ok && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, key, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, key, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

/* ------------------------------ utilities ------------------------------- */

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

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function looksLikeBrand(text) {
  if (!text) return false;
  if (text.length < 2 || text.length > 80) return false;
  if (/menu|navigation|footer|widget|cookie|privacy policy|sitemap|^home$|^about$/i.test(text)) return false;
  if (/[.!?]\s+\w/.test(text)) return false; // a sentence, not a brand
  return true;
}

function dedupe(items) {
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

/* ------------------------------ parsers --------------------------------- */

// CFI Leaping Bunny: certified brand cards. Schema similar to leaping-bunny.org;
// we tolerate three template variants.
export function parseCfiLeapingBunny(html) {
  if (!html) return [];
  const items = [];

  const blockRe = /<(li|div|article)\b[^>]*class="(?:[^"]*\s)?(?:brand-card|cfi-brand|approved-brand|brand-entry)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let parent_company = null;
    const parentMatch =
      inner.match(/<[^>]*class="[^"]*\b(?:parent-company|parent)\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/parent(?:\s*company)?\s*[:\-]\s*([^<\n]{2,80})/i);
    if (parentMatch) parent_company = stripTags(parentMatch[1]) || null;

    items.push({ brand, parent_company });
  }

  if (items.length === 0) {
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = liRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      if (!looksLikeBrand(text)) continue;
      items.push({ brand: text, parent_company: null });
    }
  }

  return dedupe(items);
}

// Choose Cruelty Free: flat brand list — same heuristics.
export function parseChooseCrueltyFree(html) {
  return parseCfiLeapingBunny(html);
}

// Vegan Society Trademark holders: cards/rows; tag veganTrademark=true.
export function parseVeganSociety(html) {
  if (!html) return [];
  const items = [];

  const blockRe = /<(li|div|article|tr)\b[^>]*class="(?:[^"]*\s)?(?:trademark-holder|vt-brand|registered-brand|brand-listing)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
      || inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;
    items.push({ brand, parent_company: null });
  }

  if (items.length === 0) {
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = liRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      if (!looksLikeBrand(text)) continue;
      items.push({ brand: text, parent_company: null });
    }
  }

  return dedupe(items);
}

// Humane League corporate pledge tracker. We treat any pledge as a positive
// welfare signal; mark cageFreeCommitment.committed=true when "cage-free" is
// in the pledge text, and capture optional deadline year + progress %.
export function parseHumaneLeague(html) {
  if (!html) return [];
  const items = [];

  const blockRe = /<(li|div|tr|article)\b[^>]*class="(?:[^"]*\s)?(?:pledge|company-pledge|tracker-row|pledge-entry)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d|td)[^>]*class="[^"]*\b(?:company-name|brand-name|pledger)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d|td)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
      || inner.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    const text = stripTags(inner);
    const isCageFree = /cage[\s-]?free/i.test(text);
    let deadline = null;
    const dMatch = text.match(/by\s+(20\d{2})|deadline\s*[:\-]?\s*(20\d{2})/i);
    if (dMatch) deadline = Number(dMatch[1] || dMatch[2]);
    let progress = null;
    const pMatch = text.match(/(\d{1,3})\s*%/);
    if (pMatch) progress = Math.min(100, Number(pMatch[1]));

    items.push({
      brand,
      parent_company: null,
      cageFree: isCageFree ? { committed: true, deadline, progress } : null,
    });
  }

  return dedupe(items);
}

// CIWF Business Benchmark on Farm Animal Welfare — tier 1–5 (food only).
export function parseCiwf(html) {
  if (!html) return [];
  const items = [];

  const blockRe = /<(tr|li|div)\b[^>]*class="(?:[^"]*\s)?(?:benchmark-row|tier-row|company-tier)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d|td)[^>]*class="[^"]*\b(?:company-name|brand-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d|td)>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
      || inner.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let tier = null;
    const tierMatch =
      inner.match(/<[^>]*class="[^"]*\b(?:tier|tier-num)\b[^"]*"[^>]*>([\s\S]*?)<\//i)
      || inner.match(/tier\s*[:\-]?\s*(\d)/i);
    if (tierMatch) {
      const t = Number(String(tierMatch[1]).match(/\d/)?.[0]);
      if (t >= 1 && t <= 5) tier = t;
    }
    if (!tier) continue;

    items.push({ brand, parent_company: null, farmAnimalWelfareTier: tier });
  }

  return dedupe(items);
}

// Open Wing Alliance: cage-free commitment + progress %.
export function parseOpenWingAlliance(html) {
  if (!html) return [];
  const items = [];

  const blockRe = /<(tr|li|div)\b[^>]*class="(?:[^"]*\s)?(?:cage-free|owa-row|progress-row|commitment-row)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d|td)[^>]*class="[^"]*\b(?:company-name|brand-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d|td)>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)
      || inner.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    const text = stripTags(inner);
    let deadline = null;
    const dMatch = text.match(/(20\d{2})/);
    if (dMatch) deadline = Number(dMatch[1]);
    let progress = null;
    const pMatch = text.match(/(\d{1,3})\s*%/);
    if (pMatch) progress = Math.min(100, Number(pMatch[1]));

    items.push({
      brand,
      parent_company: null,
      cageFree: { committed: true, deadline, progress },
    });
  }

  return dedupe(items);
}

/* ----------------------------- normalize -------------------------------- */

// Fold per-source brand records into one entries[] map keyed by lower-cased
// brand name. Each entry records every source it appeared in.
//
// Signal merge rules (a brand may appear in several sources):
//   - boolean signals (crueltyFreeCertified, veganTrademark): true wins
//   - farmAnimalWelfareTier: lowest (best) tier wins
//   - cageFreeCommitment: committed=OR, deadline=min, progress=max
export function buildEntries(perSource) {
  const byBrand = new Map();

  function add(key, url, rec, signalKey, signalValue) {
    const lc = rec.brand.toLowerCase();
    if (!byBrand.has(lc)) {
      byBrand.set(lc, {
        brand: rec.brand,
        parent_company: rec.parent_company || null,
        sources: [],
        signals: {},
        source_urls: {},
      });
    }
    const e = byBrand.get(lc);
    if (!e.sources.includes(key)) e.sources.push(key);
    e.source_urls[key] = url;
    if (!e.parent_company && rec.parent_company) e.parent_company = rec.parent_company;

    if (signalKey === "cageFreeCommitment") {
      const cur = e.signals.cageFreeCommitment || { committed: false, deadline: null, progress: null };
      e.signals.cageFreeCommitment = {
        committed: cur.committed || !!signalValue.committed,
        deadline: (cur.deadline && signalValue.deadline)
          ? Math.min(cur.deadline, signalValue.deadline)
          : (cur.deadline || signalValue.deadline || null),
        progress: (cur.progress != null && signalValue.progress != null)
          ? Math.max(cur.progress, signalValue.progress)
          : (cur.progress ?? signalValue.progress ?? null),
      };
    } else if (signalKey === "farmAnimalWelfareTier") {
      const cur = e.signals.farmAnimalWelfareTier;
      e.signals.farmAnimalWelfareTier = (cur && cur < signalValue) ? cur : signalValue;
    } else {
      if (signalValue === true) e.signals[signalKey] = true;
      else if (e.signals[signalKey] !== true) e.signals[signalKey] = !!signalValue;
    }
  }

  for (const { key, url, brands } of perSource) {
    for (const rec of brands) {
      switch (key) {
        case "cfi-leaping-bunny":
        case "choose-cruelty-free":
          add(key, url, rec, "crueltyFreeCertified", true);
          break;
        case "vegan-society":
          add(key, url, rec, "veganTrademark", true);
          break;
        case "humane-league":
          add(key, url, rec, "cageFreeCommitment", rec.cageFree
            || { committed: true, deadline: null, progress: null });
          break;
        case "ciwf-benchmark":
          if (rec.farmAnimalWelfareTier)
            add(key, url, rec, "farmAnimalWelfareTier", rec.farmAnimalWelfareTier);
          break;
        case "open-wing-alliance":
          add(key, url, rec, "cageFreeCommitment", rec.cageFree
            || { committed: true, deadline: null, progress: null });
          break;
      }
    }
  }

  return [...byBrand.values()].sort((a, b) => a.brand.localeCompare(b.brand));
}

/* -------------------------------- main ---------------------------------- */

const PARSERS = {
  "cfi-leaping-bunny":   parseCfiLeapingBunny,
  "choose-cruelty-free": parseChooseCrueltyFree,
  "vegan-society":       parseVeganSociety,
  "humane-league":       parseHumaneLeague,
  "ciwf-benchmark":      parseCiwf,
  "open-wing-alliance":  parseOpenWingAlliance,
};

async function main() {
  console.log(`Animal-welfare union fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const perSource = [];
  const sourceMeta = [];

  for (let i = 0; i < SOURCES.length; i++) {
    const { key, url } = SOURCES[i];
    const res = await fetchText(url, key);
    if (!res.ok) {
      console.error(`  [${key}] BLOCKED (${res.blocker})`);
      sourceMeta.push({ key, url, count: 0, status: "blocked", note: res.blocker });
      perSource.push({ key, url, brands: [] });
    } else {
      const brands = PARSERS[key](res.body);
      console.log(`  [${key}] ${brands.length} brands`);
      sourceMeta.push({ key, url, count: brands.length, status: brands.length > 0 ? "ok" : "empty" });
      perSource.push({ key, url, brands });
    }
    if (!FIXTURE_MODE && i < SOURCES.length - 1) await sleep(REQ_DELAY_MS);
  }

  const entries = buildEntries(perSource);
  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "Public membership/certification lists; cite the per-source URLs included in each entry.",
    _generated_at: new Date().toISOString(),
    _sources: sourceMeta,
    _stats: {
      total_brands: entries.length,
      crueltyFreeCertified: entries.filter(e => e.signals.crueltyFreeCertified).length,
      veganTrademark: entries.filter(e => e.signals.veganTrademark).length,
      farmAnimalWelfareTiered: entries.filter(e => e.signals.farmAnimalWelfareTier).length,
      cageFreeCommitted: entries.filter(e => e.signals.cageFreeCommitment?.committed).length,
    },
    entries,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${entries.length} unique brands)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("animal-welfare-union-fetch failed:", err);
    process.exit(1);
  });
}
