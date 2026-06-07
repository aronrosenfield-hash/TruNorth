#!/usr/bin/env node
/**
 * NAAG Multistate Settlements — merge step.
 *
 * Reads:   data/raw/naag/<latest>.json  (from naag-fetch.mjs)
 * Writes:  data/derived/naag-augment.json   keyed by TruNorth company slug
 *          data/derived/naag-unmatched.json (defendant strings that didn't match)
 *
 * Output shape (naag-augment.json):
 *   {
 *     _license:     "Public, NAAG.org",
 *     _generated:   "<ISO>",
 *     _source_url:  "https://www.naag.org/our-work/multistate-cases/",
 *     _settlement_count: <int>,    // total settlements in source after $1M filter
 *     _matched_companies: <int>,
 *     <slug>: { settlements: [{ caseTitle, statesInvolved, amountUsd, date, summary, sourceUrl }, ...] }
 *   }
 *
 * Resolution order:
 *   1. Direct slug match (slugify(defendant_string) → companies/<slug>.json)
 *   2. slug-aliases.json
 *   3. brand-parent-map.json (parent or sub-brand)
 *   4. First-token fallback ("walmart-stores-inc" → "walmart")
 *   5. Summary-derived defendant extraction (handles "with X Inc., Y Corp.")
 *   6. Unmatched — log to naag-unmatched.json
 *
 * Signal filter: only include settlements where amountUsd >= $1M.
 *
 * CLI:
 *   node scripts/naag-merge.mjs                       # writes derived files
 *   node scripts/naag-merge.mjs --raw /tmp/x.json     # use a specific raw input
 *
 * Runs monthly via .github/workflows/naag-monthly.yml.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/naag");
const DERIVED    = path.join(ROOT, "data/derived");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE        = path.join(DERIVED, "naag-augment.json");
const UNMATCHED_FILE  = path.join(DERIVED, "naag-unmatched.json");

const MIN_AMOUNT_USD = 1_000_000;
const SOURCE_URL = "https://www.naag.org/our-work/multistate-cases/";

/* ─────────────────────────── CLI args ───────────────────────────── */

function parseArgs(argv) {
  const args = { raw: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") args.raw = argv[++i];
  }
  return args;
}

/* ─────────────────────── slug utilities ─────────────────────────── */

const CORP_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|companies|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america|americas|services|technologies|labs|laboratories|international|global)\b\.?/g;

/** TruNorth-style slug: lowercase, strip corp suffixes + accents, dasherize. */
export function slugify(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(CORP_SUFFIX_RE, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slug without corp-suffix stripping — preserves files like "honda-motor-co". */
export function rawSlugify(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ─────────────────────── defendant mining ───────────────────────── */

/**
 * Pull additional defendant strings out of a summary blob. NAAG
 * summaries follow patterns like:
 *   "$X settlement with McKesson Corporation, Cardinal Health Inc.,
 *    AmerisourceBergen Corporation, and Johnson & Johnson resolving …"
 *
 * We split on the common conjunction "with" / "against" / "and" and
 * keep candidates that look like company names (Title-cased tokens with
 * a corporate suffix or 2+ capitalized words).
 */
export function mineDefendantsFromSummary(text) {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const add = (n) => {
    const c = (n || "").replace(/\s+/g, " ").trim().replace(/[,.;:]+$/g, "");
    if (!c || c.length < 3 || c.length > 120) return;
    const k = c.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };

  // 1. "with X, Y, and Z" — most common NAAG phrasing.
  // End anchors: a "resolving|over|for|…" verb, OR end-of-sentence period
  // (period followed by space+capital or end-of-string). NOT a period that's
  // part of a corporate suffix like "Inc.", "Corp.", "Co.", "Ltd.".
  const anchors = [
    /\bwith\s+(.+?)(?:\s+(?:resolving|over|for|regarding|relating|related|after|following|to settle|to resolve|in)\b|\.\s*$|\.\s+[A-Z])/i,
    /\bagainst\s+(.+?)(?:\s+(?:resolving|over|for|regarding|relating|related|after|following|to settle|to resolve|in)\b|\.\s*$|\.\s+[A-Z])/i,
  ];
  for (const re of anchors) {
    const m = text.match(re);
    if (!m) continue;
    // Split the captured chunk on ", and" / ", " / " and "
    const chunk = m[1].replace(/\bInc\./g, "Inc.").replace(/\bCorp\./g, "Corp.");
    const parts = chunk.split(/,\s*(?:and\s+)?|\s+and\s+/i);
    for (const p of parts) {
      // Skip non-company phrases (lowercase only, or contains verbs).
      if (!/[A-Z]/.test(p)) continue;
      if (/\b(states|companies|corporations|firms|attorneys?|millions?|billions?)\b/i.test(p.trim())) continue;
      add(p);
    }
  }
  return out;
}

/* ─────────────────────── slug resolution ────────────────────────── */

async function loadJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const aliases = (await loadJson(path.join(META_DIR, "slug-aliases.json"))) || {};
  const parentMapRaw = (await loadJson(path.join(META_DIR, "brand-parent-map.json"))) || {};
  const indexRaw = (await loadJson(INDEX_FILE)) || [];
  const indexSlugs = new Set();
  const indexByName = new Map(); // lowercased name → slug
  for (const entry of indexRaw) {
    if (entry && entry.slug) {
      indexSlugs.add(entry.slug);
      if (entry.name) indexByName.set(entry.name.toLowerCase(), entry.slug);
    }
  }
  return { aliases, parentMap: parentMapRaw, indexSlugs, indexByName };
}

function hasCompanyFile(slug) {
  if (!slug) return false;
  return existsSync(path.join(COMP_DIR, `${slug}.json`));
}

function existsInIndex(slug, maps) {
  return maps.indexSlugs.has(slug) || hasCompanyFile(slug);
}

/** Resolve a single defendant string to a TruNorth slug (or null). */
export function resolveSlug(defendant, maps) {
  if (!defendant) return { slug: null, via: "no-input" };

  const slug = slugify(defendant);
  const raw  = rawSlugify(defendant);

  // 1. Direct (with + without suffix stripping)
  for (const cand of [slug, raw]) {
    if (cand && existsInIndex(cand, maps)) return { slug: cand, via: "direct" };
  }

  // 2. Exact name match in index.json (handles "JUUL Labs Inc." → juul)
  const nameKey = String(defendant).toLowerCase().trim();
  if (maps.indexByName.has(nameKey)) {
    return { slug: maps.indexByName.get(nameKey), via: "index-name" };
  }
  // Try with corp suffix stripped (e.g., "Equifax Inc." → "equifax")
  const stripped = defendant.replace(CORP_SUFFIX_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (maps.indexByName.has(stripped)) {
    return { slug: maps.indexByName.get(stripped), via: "index-name-stripped" };
  }

  // 3. slug-aliases
  for (const cand of [slug, raw]) {
    const alias = maps.aliases[cand];
    if (alias && existsInIndex(alias, maps)) return { slug: alias, via: "alias" };
  }

  // 4. brand-parent-map
  for (const cand of [slug, raw]) {
    const node = maps.parentMap[cand];
    const parent = node?.parent;
    if (parent && existsInIndex(parent, maps)) return { slug: parent, via: "parent" };
  }

  // 5. First-token fallback ("walmart-stores" → "walmart")
  const first = slug.split("-")[0];
  if (first && first.length >= 3 && first !== slug && existsInIndex(first, maps)) {
    return { slug: first, via: "first-token" };
  }

  return { slug: null, via: "orphan" };
}

/* ────────────────────────── main merge ──────────────────────────── */

async function pickLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) return null;
  return path.join(RAW_DIR, files[files.length - 1]);
}

export function buildAugment(settlements, maps) {
  const augment = {};
  const unmatched = [];
  let totalKept = 0;

  for (const s of settlements) {
    // Signal filter
    if (!s.amountUsd || s.amountUsd < MIN_AMOUNT_USD) continue;
    totalKept++;

    const candidates = new Set();
    for (const d of s.defendants || []) candidates.add(d);
    // Mine more defendants from the summary; the listing-only records often
    // have a single garbage defendant derived from the title.
    for (const d of mineDefendantsFromSummary(s.summary || "")) candidates.add(d);

    const matchedSlugs = new Set();
    const unmatchedForThis = [];
    for (const cand of candidates) {
      const { slug, via } = resolveSlug(cand, maps);
      if (slug) {
        matchedSlugs.add(slug);
      } else {
        unmatchedForThis.push({ defendant: cand, via });
      }
    }

    const settlementRecord = {
      caseTitle:      s.caseTitle,
      statesInvolved: s.statesInvolved || [],
      amountUsd:      s.amountUsd,
      date:           s.date,
      summary:        s.summary,
      sourceUrl:      s.sourceUrl,
    };
    for (const slug of matchedSlugs) {
      if (!augment[slug]) augment[slug] = { settlements: [] };
      augment[slug].settlements.push(settlementRecord);
    }
    if (matchedSlugs.size === 0) {
      unmatched.push({
        caseTitle:      s.caseTitle,
        defendantsTried: [...candidates],
        amountUsd:      s.amountUsd,
        date:           s.date,
        sourceUrl:      s.sourceUrl,
      });
    }
  }

  // Sort each company's settlements newest-first
  for (const slug of Object.keys(augment)) {
    augment[slug].settlements.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  return { augment, unmatched, totalKept };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawFile = args.raw || (await pickLatestRaw());
  if (!rawFile || !existsSync(rawFile)) {
    console.error(`No raw NAAG file found. Run scripts/naag-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`Reading ${rawFile}`);
  const settlements = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  console.log(`  ${settlements.length} raw settlements`);

  const maps = await loadMaps();
  const { augment, unmatched, totalKept } = buildAugment(settlements, maps);

  const matchedCompanies = Object.keys(augment).length;

  const header = {
    _license:           "Public, NAAG.org",
    _generated:         new Date().toISOString(),
    _source_url:        SOURCE_URL,
    _settlement_count:  totalKept,
    _matched_companies: matchedCompanies,
    _min_amount_usd:    MIN_AMOUNT_USD,
  };
  // Preserve underscore-prefixed metadata at the top, then per-slug entries.
  const outPayload = { ...header, ...augment };

  await fs.mkdir(DERIVED, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(outPayload, null, 2));
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    _generated:    new Date().toISOString(),
    _source_url:   SOURCE_URL,
    unmatched_count: unmatched.length,
    unmatched,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  settlements kept (>= $${(MIN_AMOUNT_USD/1e6).toFixed(0)}M): ${totalKept}`);
  console.log(`  companies matched: ${matchedCompanies}`);
  console.log(`Wrote ${UNMATCHED_FILE}`);
  console.log(`  unmatched settlements: ${unmatched.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("naag-merge failed:", err);
    process.exit(1);
  });
}
