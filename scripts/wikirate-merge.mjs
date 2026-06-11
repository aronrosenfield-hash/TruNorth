#!/usr/bin/env node
/**
 * WikiRate — Step 2: Normalize WikiRate company names and slug-match
 * them against TruNorth's master index, producing a multi-metric augment
 * file keyed by TruNorth company slug.
 *
 * Reads:
 *   data/raw/wikirate/<YYYY-MM-DD>.json  (latest, unless --in is set)
 *   public/data/index.json               (the 11,209-company master)
 *   public/data/_meta/slug-aliases.json  (optional)
 *   public/data/_meta/brand-parent-map.json (optional)
 *
 * Writes:
 *   data/derived/wikirate-augment.json
 *
 * Output shape:
 *   {
 *     "_license": "CC BY 4.0 — WikiRate, https://wikirate.org",
 *     "_generated_at": "...",
 *     "_source_file": "...",
 *     "_stats": { answer_count, matched_companies, ... },
 *     "companies": {
 *       "<trunorth-slug>": {
 *         "metrics": {
 *           "<metric label>": {
 *             "value": "...",
 *             "year": 2023,
 *             "sourceUrl": "https://wikirate.org/..."
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Locally:
 *   node scripts/wikirate-merge.mjs                 # use latest raw file
 *   node scripts/wikirate-merge.mjs --in <file>     # specific input
 *   node scripts/wikirate-merge.mjs --out <file>    # custom output
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikirate");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR = path.join(ROOT, "public/data/_meta");
const DEFAULT_OUT = path.join(DERIVED_DIR, "wikirate-augment.json");

const LICENSE = "CC BY 4.0 — WikiRate, https://wikirate.org";

function parseArgs(argv) {
  const args = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return args;
}

// A raw snapshot is usable iff the fetch actually succeeded:
//   - status "failed" (fetcher >= 2026-06) means every metric errored — skip.
//   - A live snapshot with answer_count 0 is a failed fetch in disguise:
//     the 9 curated metrics can never ALL be genuinely empty. (Legacy
//     snapshots written before the fetcher recorded `status` look exactly
//     like this when the network or Cloudflare blocked the run.)
export function isUsableRaw(bundle) {
  if (!bundle || typeof bundle !== "object") return false;
  if (bundle.status === "failed") return false;
  if (bundle.mode === "live" && !(bundle.answer_count > 0)) return false;
  return true;
}

// Pick the newest *usable* YYYY-MM-DD.json in RAW_DIR (skipping snapshots
// from failed fetch runs so a bad quarterly run can't wipe the augment).
async function findLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
  for (const f of files) {
    const full = path.join(RAW_DIR, f);
    try {
      const bundle = JSON.parse(await fs.readFile(full, "utf-8"));
      if (isUsableRaw(bundle)) return full;
      console.warn(`  (skipping ${f}: failed/empty fetch — status=${bundle.status ?? "n/a"}, mode=${bundle.mode}, answers=${bundle.answer_count ?? 0})`);
    } catch {
      console.warn(`  (skipping ${f}: unreadable JSON)`);
    }
  }
  return null;
}

// ─────────────────────────── name normalization ─────────────────────────
// WikiRate names: "Nike, Inc.", "H&M Hennes & Mauritz AB",
// "Industria de Diseno Textil Inditex SA", "Amazon.com, Inc.", etc.
// TruNorth slugs are lower-kebab-case with most punctuation stripped.
// We strip common corporate suffixes ("Inc", "AG", "PLC", "SA", "Co",
// "LLC", "Ltd", "Holdings", "Corporation", "Company", "AB", "NV", "BV",
// "GmbH", "SE", "PJSC", "PCL") before slugifying.
// Trailing corporate suffixes — anchored to the end of the string so
// "International" mid-name (e.g. "Mondelez International" — a real
// company) is preserved, but "Foo Inc." / "Foo & Co." / "Foo PLC" peel.
// We allow " & Co", " and Co", " Co" since WikiRate uses all three.
const CORPORATE_SUFFIX_TAIL = new RegExp(
  "[\\s,]+(?:" +
    "& Co|and Co|Co|" +
    "Inc|Incorporated|Corp|Corporation|Company|" +
    "LLC|LP|Ltd|Limited|" +
    "Holdings|Holding|Group|" +
    "AG|SA|S\\.A|S\\.A\\.S|SAS|NV|N\\.V|BV|B\\.V|" +
    "PLC|p\\.l\\.c|GmbH|SE|AB|OYJ|PJSC|PCL|KK|K\\.K|S\\.p\\.A|SpA" +
  ")\\.?$",
  "i"
);

export function normalizeCompanyName(name) {
  if (!name) return "";
  let s = String(name).trim();
  // Strip a leading "The " (WikiRate: "The Coca-Cola Company").
  s = s.replace(/^the\s+/i, "").trim();
  // Strip trailing punctuation + "Inc."-style suffixes, iteratively so
  // "Nike, Inc." → "Nike, Inc" → "Nike," → "Nike". A second pass also
  // peels trailing ".com" so "Amazon.com, Inc." → "Amazon.com" → "Amazon".
  let prev;
  do {
    prev = s;
    s = s.replace(CORPORATE_SUFFIX_TAIL, "")
         .replace(/[.,]+$/, "")
         .replace(/\.com$/i, "")
         .trim();
  } while (s !== prev && s.length);
  return s;
}

export function toSlug(name) {
  return normalizeCompanyName(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[–—]/g, "-")
    .replace(/[/\\.]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─────────────────────────── matcher ────────────────────────────────────
// Builds a lookup from many candidate slugs / aliases / normalized names
// back to a TruNorth slug. We index by:
//   - the canonical slug from index.json
//   - a slugified version of the display name
//   - the codename minus common corporate suffixes
//   - slug-aliases.json (if present)
//   - brand-parent-map.json (subsidiary → parent)
export function buildIndex(indexJson, maps) {
  const lookup = new Map();
  const add = (key, slug, via) => {
    if (!key || !slug) return;
    if (!lookup.has(key)) lookup.set(key, { slug, via });
  };
  for (const c of indexJson) {
    add(c.slug, c.slug, "direct");
    add(toSlug(c.name), c.slug, "name");
    add(toSlug(normalizeCompanyName(c.name)), c.slug, "name_norm");
    // Brand names that contain "/", e.g. "Zara / Inditex" — try each half.
    if (c.name && c.name.includes("/")) {
      for (const part of c.name.split("/")) {
        add(toSlug(part), c.slug, "name_split");
      }
    }
  }
  // Aliases: {wikirate_slug: trunorth_slug}
  for (const [from, to] of Object.entries(maps.aliases || {})) {
    add(toSlug(from), to, "alias");
    add(from, to, "alias");
  }
  // Parent map: subsidiary → parent slug. Keeps WikiRate hits on
  // subsidiaries from being lost when only the parent exists.
  for (const [child, info] of Object.entries(maps.parents || {})) {
    const parent = info?.parent;
    if (parent) {
      add(toSlug(child), parent, "parent");
      add(child, parent, "parent");
    }
  }
  return lookup;
}

export function matchCompany(wikirateName, lookup) {
  const candidates = [
    toSlug(wikirateName),
    toSlug(normalizeCompanyName(wikirateName)),
  ];
  // Try stripping the leading "The " (WikiRate uses "The Coca-Cola Company").
  if (/^the\s+/i.test(wikirateName)) {
    candidates.push(toSlug(wikirateName.replace(/^the\s+/i, "")));
  }
  // Try with " and " expanded for "&" rendered as "and" (and vice versa).
  candidates.push(toSlug(wikirateName.replace(/&/g, "and")));
  for (const c of candidates) {
    if (lookup.has(c)) return { ...lookup.get(c), matched_on: c };
  }
  return null;
}

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

// ─────────────────────────── core merge ────────────────────────────────
// Reduce a flat list of WikiRate answers into the augment shape:
//   { <trunorth-slug>: { metrics: { <label>: { value, year, sourceUrl } } } }
// For repeated (company, metric) tuples we keep the most recent year.
export function buildAugment(answers, lookup) {
  const companies = {};
  let matched = 0, orphan = 0;
  const orphans = new Map();   // wikirate-name -> count
  for (const ans of answers) {
    const hit = matchCompany(ans.company, lookup);
    if (!hit) {
      orphan++;
      orphans.set(ans.company, (orphans.get(ans.company) || 0) + 1);
      continue;
    }
    matched++;
    const slug = hit.slug;
    if (!companies[slug]) companies[slug] = { metrics: {} };
    const prev = companies[slug].metrics[ans.label];
    const incomingYear = ans.year ?? 0;
    const prevYear = prev?.year ?? -1;
    // Keep the most recent answer per (company, metric).
    if (!prev || incomingYear > prevYear) {
      companies[slug].metrics[ans.label] = {
        value: ans.value,
        year: ans.year,
        sourceUrl: ans.url || ans.sourceUrl || null,
        family: ans.family,
      };
    }
  }
  // Top-15 orphan candidates so the operator can decide whether to add
  // them to slug-aliases.json on the next round.
  const topOrphans = [...orphans.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));
  return { companies, stats: { matched, orphan, unique_orphan: orphans.size }, top_orphans: topOrphans };
}

// ─────────────────────────── runner ────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const inFile = args.in || (await findLatestRaw());
  if (!inFile || !existsSync(inFile)) {
    console.error(`No raw WikiRate file found. Run wikirate-fetch.mjs first, or pass --in.`);
    process.exit(2);
  }

  console.log(`WikiRate merge starting...`);
  console.log(`  Source: ${inFile}`);

  const raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
  if (!isUsableRaw(raw)) {
    console.error(`Refusing to merge ${inFile}: snapshot is from a failed/empty live fetch ` +
                  `(status=${raw.status ?? "n/a"}, mode=${raw.mode}, answer_count=${raw.answer_count ?? 0}). ` +
                  `Re-run wikirate-fetch.mjs successfully first.`);
    process.exit(3);
  }
  const answers = raw.answers || [];
  console.log(`  ${answers.length} raw answers loaded`);

  const indexJson = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  console.log(`  ${indexJson.length} TruNorth companies in index`);

  const maps = await loadMaps();
  const lookup = buildIndex(indexJson, maps);

  const { companies, stats, top_orphans } = buildAugment(answers, lookup);
  const matchedCompanies = Object.keys(companies).length;
  const totalMetricRows = Object.values(companies)
    .reduce((s, c) => s + Object.keys(c.metrics).length, 0);

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = args.out || DEFAULT_OUT;
  const bundle = {
    _license: LICENSE,
    _source: "https://wikirate.org",
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, inFile),
    _stats: {
      raw_answer_count:      answers.length,
      matched_answer_count:  stats.matched,
      orphan_answer_count:   stats.orphan,
      unique_orphan_count:   stats.unique_orphan,
      matched_companies:     matchedCompanies,
      total_metric_rows:     totalMetricRows,
    },
    top_orphans,
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));

  console.log(`\nResults:`);
  console.log(`  matched answers:    ${stats.matched}`);
  console.log(`  orphan answers:     ${stats.orphan}  (${stats.unique_orphan} distinct names)`);
  console.log(`  matched companies:  ${matchedCompanies}`);
  console.log(`  metric rows total:  ${totalMetricRows}`);
  if (top_orphans.length > 0) {
    console.log(`\nTop orphan WikiRate names (consider adding to slug-aliases.json):`);
    for (const o of top_orphans) console.log(`  ${String(o.count).padStart(3)}  ${o.name}`);
  }
  console.log(`\nWrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("wikirate-merge failed:", err);
    process.exit(1);
  });
}
