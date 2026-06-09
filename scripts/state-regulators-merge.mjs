#!/usr/bin/env node
/**
 * US state-regulator enforcement — merge step.
 *
 * Reads:   data/raw/state-regulators/<latest>.json  (from state-regulators-fetch.mjs)
 * Writes:  data/derived/state-regulators-augment.json   keyed by TruNorth slug
 *          data/derived/state-regulators-unmatched.json
 *
 * Output (state-regulators-augment.json):
 *   {
 *     _license:           "Public records (state AG + NYDFS)",
 *     _generated:         "<ISO>",
 *     _source_urls:       { ny-ag: ..., tx-ag: ..., ny-dfs: ... },
 *     _action_count:      <int>,
 *     _matched_companies: <int>,
 *     <slug>: {
 *       actions: [
 *         { source, caseTitle, date, amountUsd, summary, sourceUrl, category }, ...
 *       ],
 *       categoryHints: { consumer-protection: <n>, financial-regulation: <n> }
 *     }
 *   }
 *
 * Slug resolution mirrors naag-merge:
 *   1. Direct slug match (with + without corp suffix stripping)
 *   2. Index-name lookup (exact name)
 *   3. slug-aliases.json
 *   4. brand-parent-map.json (parent or sub-brand)
 *   5. First-token fallback
 *
 * Conservative on subsidiaries: a sub-brand only credits its parent when
 * brand-parent-map.json says so. No fuzzy substring matching.
 *
 * CLI:
 *   node scripts/state-regulators-merge.mjs
 *   node scripts/state-regulators-merge.mjs --raw /tmp/x.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/state-regulators");
const DERIVED    = path.join(ROOT, "data/derived");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE        = path.join(DERIVED, "state-regulators-augment.json");
const UNMATCHED_FILE  = path.join(DERIVED, "state-regulators-unmatched.json");

const SOURCE_URLS = {
  "ny-ag":  "https://ag.ny.gov/press-releases",
  "tx-ag":  "https://www.texasattorneygeneral.gov/news/releases",
  "ny-dfs": "https://www.dfs.ny.gov/industry_guidance/enforcement_actions",
};

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

/* ─────────────────────── slug resolution ────────────────────────── */

async function loadJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const aliases = (await loadJson(path.join(META_DIR, "slug-aliases.json"))) || {};
  const parentMap = (await loadJson(path.join(META_DIR, "brand-parent-map.json"))) || {};
  const indexRaw = (await loadJson(INDEX_FILE)) || [];
  const indexSlugs = new Set();
  const indexByName = new Map();
  for (const entry of indexRaw) {
    if (entry && entry.slug) {
      indexSlugs.add(entry.slug);
      if (entry.name) indexByName.set(entry.name.toLowerCase(), entry.slug);
    }
  }
  return { aliases, parentMap, indexSlugs, indexByName };
}

function hasCompanyFile(slug) {
  if (!slug) return false;
  return existsSync(path.join(COMP_DIR, `${slug}.json`));
}

function existsInIndex(slug, maps) {
  return maps.indexSlugs.has(slug) || hasCompanyFile(slug);
}

export function resolveSlug(defendant, maps) {
  if (!defendant) return { slug: null, via: "no-input" };

  const slug = slugify(defendant);
  const raw  = rawSlugify(defendant);

  for (const cand of [slug, raw]) {
    if (cand && existsInIndex(cand, maps)) return { slug: cand, via: "direct" };
  }

  const nameKey = String(defendant).toLowerCase().trim();
  if (maps.indexByName.has(nameKey)) {
    return { slug: maps.indexByName.get(nameKey), via: "index-name" };
  }
  const stripped = defendant.replace(CORP_SUFFIX_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (maps.indexByName.has(stripped)) {
    return { slug: maps.indexByName.get(stripped), via: "index-name-stripped" };
  }

  for (const cand of [slug, raw]) {
    const alias = maps.aliases[cand];
    if (alias && existsInIndex(alias, maps)) return { slug: alias, via: "alias" };
  }

  for (const cand of [slug, raw]) {
    const node = maps.parentMap[cand];
    const parent = node?.parent;
    if (parent && existsInIndex(parent, maps)) return { slug: parent, via: "parent" };
  }

  // No first-token fallback. The free-text defendant strings produced by AG
  // press releases include too many false positives ("Senior Enforcement
  // Counsel" → "senior", "James' Office" → "james"). Better to leave them
  // unmatched than to credit the wrong brand.

  return { slug: null, via: "orphan" };
}

/* ────────────────────────── main merge ──────────────────────────── */

async function pickLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  // Only consider date-named files (YYYY-MM-DD.json), ignore underscore-
  // prefixed staging files written via --out.
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  return path.join(RAW_DIR, files[files.length - 1]);
}

// Defendant strings that obviously aren't a company name. Keeps the
// unmatched.json file from filling up with "City of Denton" and "Lying"
// style noise from political press releases.
const TRASH_DEFENDANT_RE = /^(?:the\s+|a\s+|an\s+|in\s+|to\s+|of\s+|for\s+|that\s+|nearly\s+|inc\.?$|llc$|corp\.?$)|^(?:city of|county of|state of|town of|village of|department of|office of|school|district|isd\b|board|university|college|government|administration|commission|agency|hospital|center|industry|industries\b|companies\b|corporations\b|manufacturers\b|company\b|business(?:es)?\b|firms?\b|drone\s+company|chemical\s+manufacturer|trucking|protein\s+powder|world['']s|north\s+texas|dfw\s+area|houston-area|austin\s+isd|texas|sheriff|lying\b|illegally\b|data\s+from|nearly\s+\d|corporate giants|home\s+solar|capital\s+region|hudson\s+valley|new\s+york|landlords?|merchants?|brokers?|lender|dealers?|dealership|operators?|owners?|landlord)\b/i;
const TRASH_EXACT = new Set([
  "fifa", "the", "and", "or", "for", "to", "inc.", "llc", "corp.",
  "purdue pharma", // legitimately a co but not in our DB; suppress noise
]);

function isTrashDefendant(d) {
  if (!d || d.length < 3 || d.length > 140) return true;
  if (TRASH_EXACT.has(d.toLowerCase().trim())) return true;
  if (TRASH_DEFENDANT_RE.test(d)) return true;
  return false;
}

export function buildAugment(records, maps) {
  const augment = {};
  const unmatched = [];

  for (const r of records) {
    const candidates = new Set();
    for (const d of r.defendants || []) {
      if (!isTrashDefendant(d)) candidates.add(d);
    }

    const matchedSlugs = new Set();
    const trace = [];
    for (const cand of candidates) {
      const { slug, via } = resolveSlug(cand, maps);
      if (slug) {
        matchedSlugs.add(slug);
        trace.push({ defendant: cand, slug, via });
      } else {
        trace.push({ defendant: cand, slug: null, via });
      }
    }

    const actionRecord = {
      source:    r.source,
      caseTitle: r.caseTitle,
      date:      r.date,
      amountUsd: r.amountUsd,
      summary:   r.summary,
      category:  r.category,
      sourceUrl: r.sourceUrl,
    };
    for (const slug of matchedSlugs) {
      if (!augment[slug]) augment[slug] = { actions: [], categoryHints: {} };
      // Deduplicate by sourceUrl
      if (!augment[slug].actions.some(a => a.sourceUrl === r.sourceUrl)) {
        augment[slug].actions.push(actionRecord);
        augment[slug].categoryHints[r.category] = (augment[slug].categoryHints[r.category] || 0) + 1;
      }
    }
    if (matchedSlugs.size === 0) {
      unmatched.push({
        source:    r.source,
        caseTitle: r.caseTitle,
        defendantsTried: [...candidates],
        trace,
        date:      r.date,
        amountUsd: r.amountUsd,
        sourceUrl: r.sourceUrl,
      });
    }
  }

  // Sort each company's actions newest-first
  for (const slug of Object.keys(augment)) {
    augment[slug].actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  return { augment, unmatched };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawFile = args.raw || (await pickLatestRaw());
  if (!rawFile || !existsSync(rawFile)) {
    console.error(`No raw state-regulators file found. Run scripts/state-regulators-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`Reading ${rawFile}`);
  const records = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  console.log(`  ${records.length} raw enforcement records`);

  const maps = await loadMaps();
  const { augment, unmatched } = buildAugment(records, maps);

  const matchedCompanies = Object.keys(augment).length;
  const header = {
    _license:           "Public records (state attorneys-general + NYDFS)",
    _generated:         new Date().toISOString(),
    _source_urls:       SOURCE_URLS,
    _action_count:      records.length,
    _matched_companies: matchedCompanies,
    _per_source:        Object.fromEntries(
      Object.keys(SOURCE_URLS).map(s => [s, records.filter(r => r.source === s).length])
    ),
  };
  const outPayload = { ...header, ...augment };

  await fs.mkdir(DERIVED, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(outPayload, null, 2));
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    _generated:      new Date().toISOString(),
    _source_urls:    SOURCE_URLS,
    unmatched_count: unmatched.length,
    unmatched,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  companies matched: ${matchedCompanies}`);
  console.log(`Wrote ${UNMATCHED_FILE}`);
  console.log(`  unmatched: ${unmatched.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("state-regulators-merge failed:", err);
    process.exit(1);
  });
}
