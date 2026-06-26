#!/usr/bin/env node
/**
 * Animal-welfare certifications — cruelty-free / humane brand directories.
 *
 * Targets TruNorth's WEAKEST scoring category (animals, ~16% coverage). This
 * is a POSITIVE-only signal: we record the certifications a brand actually
 * HOLDS, drawn from two public marketing directories that publish factual
 * lists of certified brands. Same license/posture as the repo's existing
 * Leaping Bunny / PETA Beauty-Without-Bunnies scrapes.
 *
 * SOURCES
 *   1. Vegan Action "Certified Vegan" logo holders
 *        https://vegan.org/certification/companies-using-our-logo
 *      Static server-side HTML, A–Z. Each holder is rendered as
 *        <p class="wp-block-paragraph">Brand Name <a href="domain">domain</a></p>
 *      The brand NAME is the text node BEFORE the anchor (the anchor text is
 *      the brand's website domain, not its name). Certified = no animal
 *      products AND no animal testing.  → cert "certified-vegan"
 *
 *   2. Certified Humane (Humane Farm Animal Care) "Who's Certified" directory
 *        https://certifiedhumane.org/whos-certified/
 *      Static server-side HTML, a single <table> with columns
 *        COMPANY | PRODUCTS CERTIFIED | CONTACT INFORMATION
 *      The company name is <td class="column-1">. Humane farm-animal raising.
 *      → cert "certified-humane"
 *
 * OUTPUT (DERIVED AUGMENT, keyed by TruNorth company slug):
 *   data/derived/animal-certs-augment.json
 *   {
 *     _source, sourceUrls, generatedAt, matchCount, orphanCount, ...,
 *     <slug>: { certifications: ["certified-vegan","certified-humane"], lastUpdated }
 *   }
 *
 * MATCHING — STRICT (deliberately under-matches):
 *   Prior build agents over-collapsed by reusing the ITEP `nameVariants`, which
 *   emits BARE first-word / 2-word prefixes ("tom" → Tom's of Maine vs Tom Ford,
 *   "kind" → KIND vs anything). Against arbitrary directory names those prefixes
 *   produce WRONG flags. In a values app a MISSING flag beats a WRONG flag.
 *   So we match ONLY on:
 *     (a) the FULL normalized name (reuse normalizeCompanyName + buildIndexLookup), and
 *     (b) a geo/suffix-stripped FULL name (drop trailing "us"/"north america"/… ).
 *   Parent-map fallback uses ONLY full-name slug candidates (never bare prefixes)
 *   AND only HIGH-confidence edges — medium/low Wikidata edges over-collapse
 *   same-named-but-unrelated brands onto giant parents (e.g. "Asna" → GM).
 *
 * GUARDS
 *   - Honest User-Agent that includes a contact email.
 *   - Each source must clear a minimum row threshold or it is treated as a
 *     failed/empty download and that source contributes nothing (we never let
 *     an empty scrape silently wipe coverage).
 *   - 2 req/sec politeness; retry on 5xx with backoff.
 *   - --fixture reads test/fixtures/animal-certs/*.html instead of the network.
 *
 * NEVER writes public/data/companies/*.json. NEVER commits.
 *
 * Locally:
 *   node scripts/animal-certs-fetch.mjs            # live scrape, dry-run summary
 *   node scripts/animal-certs-fetch.mjs --apply    # write the augment
 *   node scripts/animal-certs-fetch.mjs --fixture  # use bundled fixtures
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeCompanyName,
} from "./itep-tax-fetch.mjs";
import {
  buildIndexLookup,
} from "./itep-tax-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/animal-certs");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "animal-certs-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/animal-certs");

const SOURCE = "Vegan Action (Certified Vegan) + Certified Humane (HFAC)";
const UA =
  "TruNorth-AnimalCerts/1.0 (+https://www.trunorthapp.com; contact: aron@trunorthapp.com; humane/vegan certification transparency)";
const REQ_DELAY_MS = 2000; // 2s — small nonprofits

const VEGAN_URL = "https://vegan.org/certification/companies-using-our-logo";
const HUMANE_URL = "https://certifiedhumane.org/whos-certified/";

// A source must clear this many rows or we treat the download as empty/failed
// and skip it (so a transient 0-byte / Cloudflare body never wipes coverage).
const MIN_ROWS_VEGAN = 100;
const MIN_ROWS_HUMANE = 50;

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FIXTURE_MODE = argv.includes("--fixture");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── html decode ────────────────────────────

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
  return String(s)
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

function stripTags(s) {
  return decode(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// ─────────────────────────── parsers ────────────────────────────────

/**
 * Vegan Action "Certified Vegan" logo-holders page.
 *
 * Real markup (verified live, 2026-06):
 *   <h3 class="wp-block-heading" id="A"><strong>A</strong></h3>
 *   <p class="wp-block-paragraph">Amy’s Kitchen&nbsp;<a href="https://www.amys.com/">amys.com</a></p>
 *
 * The brand NAME is the text node before the first anchor (the anchor text is
 * the website domain). We only keep paragraphs that carry an external link —
 * that distinguishes real holder rows from prose paragraphs.
 */
export function parseVeganPage(html) {
  if (!html) return [];
  const out = [];
  const pRe = /<p\b[^>]*class="[^"]*\bwp-block-paragraph\b[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(html)) !== null) {
    const inner = m[1];
    // Require an external website link — holder rows always have one.
    if (!/<a\b[^>]*href="https?:\/\//i.test(inner)) continue;
    // Brand name = text BEFORE the first anchor.
    const before = inner.split(/<a\b/i)[0];
    const brand = stripTags(before);
    if (!isPlausibleBrand(brand)) continue;
    out.push({ brand });
  }
  return dedupeBrands(out);
}

/**
 * Certified Humane "Who's Certified" directory — a single <table>.
 * Company name lives in <td class="column-1">. The header row uses <th>,
 * so it is naturally skipped (no column-1 <td>).
 */
export function parseHumanePage(html) {
  if (!html) return [];
  const out = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const row = m[1];
    const cell =
      row.match(/<td\b[^>]*class="[^"]*\bcolumn-1\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i) ||
      row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i); // fallback: first cell
    if (!cell) continue;
    const brand = stripTags(cell[1]);
    if (!isPlausibleBrand(brand)) continue;
    out.push({ brand });
  }
  return dedupeBrands(out);
}

// A holder name must look like a brand, not a sentence / heading / nav label.
function isPlausibleBrand(name) {
  if (!name) return false;
  if (name.length < 2 || name.length > 80) return false;
  // Reject obvious prose (a sentence with a period mid-string followed by a word).
  if (/[.!?]\s+[A-Za-z]/.test(name)) return false;
  // Reject pure A–Z section labels.
  if (/^[A-Z0-9](?:[-–][0-9])?$/.test(name)) return false;
  return true;
}

function dedupeBrands(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = it.brand.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out.sort((a, b) => a.brand.localeCompare(b.brand));
}

// ─────────────────────────── fetch ──────────────────────────────────

async function fetchText(url, fixtureName, attempt = 0) {
  if (FIXTURE_MODE) {
    const p = path.join(FIXTURE_DIR, fixtureName);
    if (existsSync(p)) return await fs.readFile(p, "utf-8");
    console.error(`  [fixture] missing ${path.relative(ROOT, p)} — empty.`);
    return "";
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    });
    const body = await res.text();
    // Cloudflare / bot-wall detection — treat as a failed fetch (caller skips).
    if (
      res.status === 403 || res.status === 503 ||
      /just a moment\.\.\.|cf-(?:browser-verification|chl-bypass)/i.test(body)
    ) {
      throw new Error(`bot-wall (HTTP ${res.status})`);
    }
    if (res.status >= 500 && attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, fixtureName, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return body;
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000 * Math.pow(2, attempt));
      return fetchText(url, fixtureName, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────── STRICT slug matching ───────────────────────

/**
 * STRICT candidate generator. Returns the full normalized name and a single
 * geo/suffix-stripped full normalized name — and NOTHING shorter. We never
 * emit bare first-word / 2-word prefixes (the over-collapse trap).
 */
export function strictVariants(name) {
  const base = normalizeCompanyName(name); // already drops legal suffixes & punctuation
  const out = new Set();
  if (base) out.add(base);
  // Drop trailing geo qualifiers ("us", "usa", "north america", …). Still a
  // FULL-name match, just without the country tail.
  const stripped = base
    .replace(/\b(us|usa|north america|na|global|americas|international|worldwide)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped && stripped !== base) out.add(stripped);
  return [...out].filter((v) => v.length >= 3);
}

export function matchSlug(name, byName, parentMap) {
  for (const v of strictVariants(name)) {
    const hit = byName.get(v);
    if (hit) return { slug: hit, route: "direct" };
  }
  // Parent-map fallback — ONLY full-name slug candidates (kebab of strictVariants)
  // AND only HIGH-confidence edges. The parent-map carries some medium/low
  // Wikidata edges where a same-named-but-unrelated entity points to a giant
  // holding co (e.g. a vegan brand "Asna" → General Motors). Trusting those on
  // a positive certification signal produces a WRONG flag; a missing flag is
  // safer. High-confidence edges are hand-curated/existing and reliable.
  if (parentMap && typeof parentMap === "object") {
    for (const v of strictVariants(name)) {
      const cand = v.replace(/\s+/g, "-");
      const entry = parentMap[cand];
      if (entry && entry.parent && entry.confidence === "high") {
        return { slug: entry.parent, route: "parent" };
      }
    }
  }
  return null;
}

// ─────────────────────────── merge ──────────────────────────────────

export function mergeToSlugs(sources, { index, parentMap }) {
  const byName = buildIndexLookup(index);
  const augment = {}; // slug -> { certifications:Set, _route }
  const stats = { direct: 0, parent: 0, orphan: 0, byCert: {} };
  const orphanList = [];

  for (const { cert, rows } of sources) {
    stats.byCert[cert] = { matched: 0, orphan: 0 };
    for (const { brand } of rows) {
      const hit = matchSlug(brand, byName, parentMap);
      if (!hit) {
        stats.orphan++;
        stats.byCert[cert].orphan++;
        orphanList.push(`${cert}: ${brand}`);
        continue;
      }
      const { slug, route } = hit;
      if (!augment[slug]) {
        augment[slug] = { certifications: new Set(), _routes: new Set() };
        if (route === "direct") stats.direct++; else stats.parent++;
      }
      augment[slug].certifications.add(cert);
      augment[slug]._routes.add(route);
      stats.byCert[cert].matched++;
    }
  }
  return { augment, stats, orphanList };
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

async function snapshotRaw(name, html) {
  if (FIXTURE_MODE || !html) return;
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(path.join(RAW_DIR, name), html);
}

// ─────────────────────────── main ───────────────────────────────────

async function main() {
  console.log(
    `animal-certs fetch starting... (mode=${APPLY ? "APPLY" : "DRY"}, fixture=${FIXTURE_MODE})`,
  );

  // --- Vegan Action ---
  let veganRows = [];
  try {
    const html = await fetchText(VEGAN_URL, "vegan.html");
    await snapshotRaw("vegan.html", html);
    veganRows = parseVeganPage(html);
    if (veganRows.length < MIN_ROWS_VEGAN) {
      console.error(
        `  ⚠️ Vegan Action: ${veganRows.length} rows < ${MIN_ROWS_VEGAN} — treating as empty download, skipping.`,
      );
      veganRows = [];
    } else {
      console.log(`  Vegan Action (certified-vegan): ${veganRows.length} holders`);
    }
  } catch (err) {
    console.error(`  ⚠️ Vegan Action fetch failed: ${err.message} — skipping source.`);
  }

  if (!FIXTURE_MODE) await sleep(REQ_DELAY_MS);

  // --- Certified Humane ---
  let humaneRows = [];
  try {
    const html = await fetchText(HUMANE_URL, "humane.html");
    await snapshotRaw("humane.html", html);
    humaneRows = parseHumanePage(html);
    if (humaneRows.length < MIN_ROWS_HUMANE) {
      console.error(
        `  ⚠️ Certified Humane: ${humaneRows.length} rows < ${MIN_ROWS_HUMANE} — treating as empty download, skipping.`,
      );
      humaneRows = [];
    } else {
      console.log(`  Certified Humane (certified-humane): ${humaneRows.length} brands`);
    }
  } catch (err) {
    console.error(`  ⚠️ Certified Humane fetch failed: ${err.message} — skipping source.`);
  }

  if (veganRows.length === 0 && humaneRows.length === 0) {
    console.error("\nBoth sources empty/failed — refusing to write an empty augment.");
    process.exit(2);
  }

  // --- Merge ---
  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  console.log(
    `\nLoaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`,
  );

  const sources = [
    { cert: "certified-vegan", rows: veganRows },
    { cert: "certified-humane", rows: humaneRows },
  ];
  const { augment, stats, orphanList } = mergeToSlugs(sources, { index, parentMap });
  const matchCount = Object.keys(augment).length;
  const lastUpdated = new Date().toISOString();

  console.log("\nResults:");
  console.log(`  Direct name matches:    ${stats.direct}`);
  console.log(`  Parent-map matches:     ${stats.parent}`);
  console.log(`  Distinct matched slugs: ${matchCount}`);
  console.log(`  Orphans (no slug):      ${stats.orphan}`);
  for (const [cert, s] of Object.entries(stats.byCert)) {
    console.log(`    ${cert.padEnd(18)} matched=${s.matched}  orphan=${s.orphan}`);
  }

  // Examples for the log.
  const examples = Object.entries(augment).slice(0, 8).map(([slug, v]) => {
    const certs = [...v.certifications].sort().join(", ");
    const r = [...v._routes].join("/");
    return `    ${slug.padEnd(26)} [${certs}]  (${r})`;
  });
  if (examples.length) {
    console.log("\n  Examples (slug → certifications):");
    console.log(examples.join("\n"));
  }
  if (orphanList.length) {
    console.log(`\n  First 5 orphans: ${orphanList.slice(0, 5).join(" | ")}`);
  }

  // Shape per slug: { certifications:[...], lastUpdated }
  const augmentOut = {};
  for (const [slug, v] of Object.entries(augment)) {
    augmentOut[slug] = {
      certifications: [...v.certifications].sort(),
      lastUpdated,
    };
  }

  const out = {
    _source: SOURCE,
    _signal: "POSITIVE only — the cruelty-free / humane certifications a brand HOLDS",
    _category: "animals",
    sourceUrls: { certifiedVegan: VEGAN_URL, certifiedHumane: HUMANE_URL },
    generatedAt: lastUpdated,
    matchCount,
    orphanCount: stats.orphan,
    veganHolderCount: veganRows.length,
    humaneBrandCount: humaneRows.length,
    ...augmentOut,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${matchCount} slugs).`);
    console.log("  (Derived augment only — no company-file writes, no commits.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("animal-certs-fetch failed:", err);
    process.exit(1);
  });
}
