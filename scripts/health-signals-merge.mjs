#!/usr/bin/env node
/**
 * Health signals — merge OpenFDA facet counts + EPA TRI carcinogen totals
 * into per-slug records under data/derived/health-signals-augment.json.
 *
 * Output (single JSON file):
 *   {
 *     _license, _sources, _generated_at, _stats,
 *     companies: {
 *       <slug>: {
 *         health: {
 *           recallEvents5y:        int   // sum of drug+device+food recalls
 *           adverseEvents5y:       int   // FAERS + MAUDE + tobacco problems
 *           warningLetters5y:      int   // proxy: boxed-warning label updates
 *           carcinogenEmissionsKg: int   // TRI Group 1 / 2A releases (kg)
 *           class1RecallCount:     int   // Class I recalls (serious harm/death)
 *           breakdown: { … per-stream counts … }
 *           chemicals: [string]
 *           sourceUrls: [string]
 *         }
 *       }
 *     },
 *     orphans: [{ firm, total, sourceUrls }]   // top firms with no slug match
 *   }
 *
 * Slug resolution: brand-parent-map → slug-aliases → direct file lookup
 * (same chain as epa-emissions-merge / wikirate-merge). We normalize firm
 * names from OpenFDA (often shouty + suffixed: "PFIZER, INC.") and parent
 * names from EPA TRI ("PFIZER INC") into the same slug space the rest of
 * the pipeline uses (lowercase, hyphenated, suffix-stripped).
 *
 * Flags:
 *   --raw <file>   override input path (default: most recent file in
 *                  data/raw/health-signals/)
 *   --out <file>   override output path
 *   --quiet        suppress per-firm match logs
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/health-signals");
const DER_DIR    = path.join(ROOT, "data/derived");
const OUT_FILE   = path.join(DER_DIR, "health-signals-augment.json");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const COMP_DIR   = path.join(ROOT, "public/data/companies");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (flag) => { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] : null; };
  return {
    raw: get("--raw"),
    out: get("--out"),
    quiet: a.includes("--quiet"),
  };
}

const SUFFIX_RE = /\b(corporation|corp|company|companies|incorporated|inc|llc|lp|plc|usa|us|of america|north america|north american|holdings|group|the|sa|n v|n\.v|s a|s\.a|gmbh|ag|ltd|limited|co|cos|us inc|usa inc|division|div|enterprises|labs|laboratories|laboratorios|industries|international|intl|brand|brands|holding|holding co|pharma|pharmaceuticals|pharmaceutical)\b/gi;

export function slugifyFirm(name) {
  if (!name) return null;
  let s = String(name).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[.,'"]/g, " ");
  s = s.replace(/[\/\\]+/g, " ");
  s = s.replace(SUFFIX_RE, " ");
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s || null;
}

// Hand-tuned synonyms — OpenFDA / TRI firm names that don't map cleanly to
// the canonical TruNorth slug via slugifyFirm alone.
const FIRM_SYNONYMS = {
  "pfizer": "pfizer",
  "merck-sharp-and-dohme": "merck",
  "merck-sharp-dohme": "merck",
  "merck": "merck",
  "abbvie": "abbvie",
  "johnson-and-johnson-consumer": "johnson-and-johnson",
  "j-and-j-consumer": "johnson-and-johnson",
  "janssen-products": "johnson-and-johnson",
  "janssen": "johnson-and-johnson",
  "johnson-and-johnson": "johnson-and-johnson",
  "j-j": "johnson-and-johnson",
  "abbott": "abbott-laboratories",
  "abbott-nutrition": "abbott-laboratories",
  "novartis": "novartis",
  "sanofi-aventis": "sanofi",
  "sanofi": "sanofi",
  "glaxosmithkline": "gsk",
  "gsk-consumer-healthcare": "gsk",
  "gsk": "gsk",
  "astrazeneca": "astrazeneca",
  "bristol-myers-squibb": "bristol-myers-squibb",
  "bms": "bristol-myers-squibb",
  "eli-lilly-and": "eli-lilly",
  "eli-lilly": "eli-lilly",
  "lilly": "eli-lilly",
  "bayer-healthcare": "bayer",
  "bayer": "bayer",
  "amgen": "amgen",
  "biogen": "biogen",
  "gilead-sciences": "gilead-sciences",
  "regeneron-pharmaceuticals": "regeneron",
  "regeneron": "regeneron",
  "moderna": "moderna",
  "moderna-tx": "moderna",
  "moderna-therapeutics": "moderna",
  "biontech": "biontech",
  "teva": "teva",
  "teva-pharmaceuticals": "teva",
  "mylan": "viatris",
  "viatris": "viatris",
  "perrigo": "perrigo",
  "perrigo-of-tennessee": "perrigo",
  "boston-scientific": "boston-scientific",
  "medtronic": "medtronic",
  "medtronic-minimed": "medtronic",
  "medtronic-vascular": "medtronic",
  "stryker": "stryker",
  "stryker-instruments": "stryker",
  "zimmer-biomet": "zimmer-biomet",
  "edwards-lifesciences": "edwards-lifesciences",
  "ge-healthcare": "ge-healthcare",
  "ge-medical-systems": "ge-healthcare",
  "siemens-healthineers": "siemens-healthineers",
  "siemens-medical-solutions": "siemens-healthineers",
  "philips": "philips",
  "philips-respironics": "philips",
  "philips-healthcare": "philips",
  "becton-dickinson-and": "becton-dickinson",
  "becton-dickinson": "becton-dickinson",
  "bd": "becton-dickinson",
  "baxter-healthcare": "baxter-international",
  "baxter": "baxter-international",
  "baxter-international": "baxter-international",
  "danaher": "danaher",
  "thermo-fisher-scientific": "thermo-fisher-scientific",
  "smith-and-nephew": "smith-and-nephew",
  "dexcom": "dexcom",
  "alcon": "alcon",
  "altria": "altria",
  "philip-morris": "altria",
  "philip-morris-usa": "altria",
  "reynolds-american": "reynolds-american",
  "r-j-reynolds-tobacco": "reynolds-american",
  "british-american-tobacco": "british-american-tobacco",
  "imperial-tobacco": "imperial-brands",
  "imperial-brands": "imperial-brands",
  "juul-labs": "juul-labs",
  "juul": "juul-labs",
  "njoy": "njoy",
  "swedish-match-north-america": "swedish-match",
  "swedish-match": "swedish-match",
  // Food / consumer
  "nestle-usa": "nestle",
  "nestle": "nestle",
  "kraft-heinz-foods": "kraft-heinz",
  "kraft-heinz": "kraft-heinz",
  "kraft-foods": "kraft-heinz",
  "general-mills": "general-mills",
  "kellogg": "kellogg-s",
  "kellanova": "kellogg-s",
  "tyson-foods": "tyson-foods",
  "tyson": "tyson-foods",
  "jbs-usa": "jbs-usa",
  "jbs": "jbs-usa",
  "conagra-brands": "conagra",
  "conagra-foods": "conagra",
  "conagra": "conagra",
  "smithfield-foods": "smithfield-foods",
  "perdue-farms": "perdue-farms",
  "hormel-foods": "hormel-foods",
  "campbell-soup": "campbell-soup",
  "mondelez-international": "mondelez",
  "mondelez-global": "mondelez",
  "mondelez": "mondelez",
  "pepsico": "pepsico",
  "frito-lay": "pepsico",
  "coca-cola": "coca-cola",
  "coca-cola-north-america": "coca-cola",
  "the-coca-cola": "coca-cola",
  "anheuser-busch": "anheuser-busch",
  "anheuser-busch-inbev": "anheuser-busch",
  "molson-coors-beverage": "molson-coors",
  "molson-coors": "molson-coors",
  "constellation-brands": "constellation-brands",
  "diageo": "diageo",
  "diageo-north-america": "diageo",
  "danone": "danone",
  "danone-north-america": "danone",
  // Personal care
  "procter-and-gamble": "procter-and-gamble",
  "p-and-g": "procter-and-gamble",
  "unilever": "unilever",
  "unilever-united-states": "unilever",
  "colgate-palmolive": "colgate-palmolive",
  "church-and-dwight": "church-and-dwight",
  "kimberly-clark": "kimberly-clark",
  "estee-lauder": "est-e-lauder",
  "l-oreal": "l-or-al",
  "loreal-usa": "l-or-al",
  "l-oreal-usa": "l-or-al",
  // Chemicals / TRI heavy hitters
  "3m": "3m",
  "dupont": "dupont",
  "dupont-de-nemours": "dupont",
  "dow": "dow",
  "dow-chemical": "dow",
  "basf": "basf-corp",
  "basf-corporation": "basf-corp",
  "lyondellbasell": "lyondellbasell",
  "eastman-chemical": "eastman-chemical",
  "celanese": "celanese",
  "huntsman": "huntsman",
  "exxon-mobil": "exxon-mobil",
  "exxonmobil": "exxon-mobil",
  "chevron-phillips-chemical": "chevron",
  "chevron": "chevron",
  "shell": "shell-usa",
  "shell-oil": "shell-usa",
  "bp": "bp-usa",
  "bp-products-north-america": "bp-usa",
  "marathon-petroleum": "marathon-petroleum",
  "valero-energy": "valero-energy",
  "phillips-66": "phillips-66",
  "westlake-chemical": "westlake-chemical",
  "olin": "olin",
  "ineos": "ineos",
  "georgia-pacific": "georgia-pacific",
  "international-paper": "international-paper",
  "weyerhaeuser": "weyerhaeuser",
  "smurfit-westrock": "smurfit-westrock",
  "westrock": "smurfit-westrock",
  "packaging-corporation-of-america": "packaging-corp-of-america",
  "freeport-mcmoran": "freeport-mcmoran",
  "southern-copper": "southern-copper",
  "alcoa": "alcoa",
  "us-steel": "us-steel",
  "united-states-steel": "us-steel",
  "nucor": "nucor",
  "cleveland-cliffs": "cleveland-cliffs",
  "arconic": "arconic",
  "honeywell": "honeywell",
  "honeywell-international": "honeywell",
  "ford-motor": "ford",
  "ford": "ford",
  "general-motors": "gm-stellantis",
  "gm": "gm-stellantis",
  "stellantis": "gm-stellantis",
  "toyota-motor": "toyota",
  "boeing": "boeing",
  "boeing-defense-space-and-security": "boeing",
  "lockheed-martin": "lockheed-martin",
  "raytheon": "raytheon-technologies",
  "raytheon-technologies": "raytheon-technologies",
  "rtx": "raytheon-technologies",
  "northrop-grumman": "northrop-grumman",
  "general-dynamics": "general-dynamics",
};

async function loadJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return fallback; }
}

async function loadMaps() {
  return {
    aliases: await loadJson(path.join(META_DIR, "slug-aliases.json"), {}),
    parents: await loadJson(path.join(META_DIR, "brand-parent-map.json"), {}),
  };
}

export function resolveSlug(rawName, maps, companyExists) {
  if (!rawName) return null;
  const base = slugifyFirm(rawName);
  if (!base) return null;

  // Single-token slugs are noisy when matched DIRECTLY against /companies/<x>
  // (e.g. "Sun Pharmaceutical Industries" → "sun" collides with the Sun
  // energy company). A single-token direct match is only allowed when the
  // token appears in our curated FIRM_SYNONYMS map. Single-token brand-parent
  // and alias matches ARE allowed though — those are the legit sub-brand
  // lookup case ("Advil" → "haleon", "Brita" → "clorox-co").
  const isSingleToken = !base.includes("-");

  // PASS 1 — synonym + direct + alias + parent on the FULL slug.
  if (FIRM_SYNONYMS[base]) {
    const target = FIRM_SYNONYMS[base];
    if (companyExists(target)) return { slug: target, via: target === base ? "direct" : "synonym" };
  } else if (!isSingleToken && companyExists(base)) {
    return { slug: base, via: "direct" };
  }
  const alias1 = maps.aliases?.[base];
  if (alias1 && companyExists(alias1)) return { slug: alias1, via: "alias" };
  const parent1 = maps.parents?.[base]?.parent;
  if (parent1 && companyExists(parent1)) return { slug: parent1, via: "parent" };

  // PASS 2 — strip trailing tokens and re-try, but ONLY via the curated
  // FIRM_SYNONYMS lookup (not direct file). Direct prefix→file matches are
  // too noisy: e.g. "Sun Pharmaceutical Industries" → "sun" → /sun.json
  // (a different brand entirely). Curated synonyms cover the legitimate
  // long-form → canonical mappings (Pfizer, Merck, Medtronic Minimed, etc.).
  const parts = base.split("-").filter(Boolean);
  for (let k = parts.length - 1; k >= 1; k--) {
    const pref = parts.slice(0, k).join("-");
    const cand = FIRM_SYNONYMS[pref];
    if (cand && companyExists(cand)) return { slug: cand, via: "prefix-synonym" };
  }
  return null;
}

export function buildPerSlugCounts(openfda, tri, maps, companyExists, { quiet = true } = {}) {
  // bucket[slug] = aggregated record
  const bucket = new Map();
  const orphans = new Map(); // firm -> { total, sourceUrls:Set }

  const addCount = (slug, field, n, sourceUrl) => {
    if (!bucket.has(slug)) {
      bucket.set(slug, {
        recallEvents5y: 0,
        adverseEvents5y: 0,
        warningLetters5y: 0,
        carcinogenEmissionsKg: 0,
        class1RecallCount: 0,
        breakdown: {
          drugRecalls: 0, deviceRecalls: 0, foodRecalls: 0,
          drugEvents: 0, deviceEvents: 0, tobaccoEvents: 0,
          boxedWarningLabels: 0,
          drugRecallsCls1: 0, deviceRecallsCls1: 0, foodRecallsCls1: 0,
        },
        chemicals: new Set(),
        sourceUrls: new Set(),
      });
    }
    const rec = bucket.get(slug);
    rec.breakdown[field] = (rec.breakdown[field] || 0) + n;
    if (sourceUrl) rec.sourceUrls.add(sourceUrl);
  };

  const STREAM_MAP = [
    ["drugRecalls",       "drugRecalls",       "https://api.fda.gov/drug/enforcement.json"],
    ["drugRecallsCls1",   "drugRecallsCls1",   "https://api.fda.gov/drug/enforcement.json"],
    ["deviceRecalls",     "deviceRecalls",     "https://api.fda.gov/device/recall.json"],
    ["deviceRecallsCls1", "deviceRecallsCls1", "https://api.fda.gov/device/recall.json"],
    ["foodRecalls",       "foodRecalls",       "https://api.fda.gov/food/enforcement.json"],
    ["foodRecallsCls1",   "foodRecallsCls1",   "https://api.fda.gov/food/enforcement.json"],
    ["deviceEvents",      "deviceEvents",      "https://api.fda.gov/device/event.json"],
    ["drugEvents",        "drugEvents",        "https://api.fda.gov/drug/event.json"],
    ["tobaccoEvents",     "tobaccoEvents",     "https://api.fda.gov/tobacco/problem.json"],
    ["drugLabelsBoxed",   "boxedWarningLabels","https://api.fda.gov/drug/label.json"],
  ];

  for (const [streamKey, field, srcUrl] of STREAM_MAP) {
    const rows = openfda?.[streamKey] || [];
    for (const r of rows) {
      const firm = r.term || r.key;
      const n = Number(r.count || r.doc_count || 0);
      if (!firm || !Number.isFinite(n) || n <= 0) continue;
      const resolved = resolveSlug(firm, maps, companyExists);
      if (!resolved) {
        const cur = orphans.get(firm) || { total: 0, sourceUrls: new Set() };
        cur.total += n;
        cur.sourceUrls.add(srcUrl);
        orphans.set(firm, cur);
        continue;
      }
      addCount(resolved.slug, field, n, srcUrl);
      if (!quiet) console.log(`  ${field}: ${firm} (${n}) -> ${resolved.slug} [${resolved.via}]`);
    }
  }

  // TRI carcinogen kg.
  const triSrc = "https://enviro.epa.gov/enviro/efservice/TRI_FACILITY_FULL";
  for (const [parentName, entry] of Object.entries(tri || {})) {
    const resolved = resolveSlug(parentName, maps, companyExists);
    if (!resolved) {
      const cur = orphans.get(parentName) || { total: 0, sourceUrls: new Set() };
      cur.total += entry.carcinogenKg || 0;
      cur.sourceUrls.add(triSrc);
      orphans.set(parentName, cur);
      continue;
    }
    if (!bucket.has(resolved.slug)) {
      bucket.set(resolved.slug, {
        recallEvents5y: 0, adverseEvents5y: 0, warningLetters5y: 0,
        carcinogenEmissionsKg: 0, class1RecallCount: 0,
        breakdown: {
          drugRecalls: 0, deviceRecalls: 0, foodRecalls: 0,
          drugEvents: 0, deviceEvents: 0, tobaccoEvents: 0,
          boxedWarningLabels: 0,
          drugRecallsCls1: 0, deviceRecallsCls1: 0, foodRecallsCls1: 0,
        },
        chemicals: new Set(),
        sourceUrls: new Set(),
      });
    }
    const rec = bucket.get(resolved.slug);
    rec.carcinogenEmissionsKg += entry.carcinogenKg || 0;
    for (const c of (entry.chemicals || [])) rec.chemicals.add(c);
    rec.sourceUrls.add(triSrc);
  }

  // Roll up category totals.
  const companies = {};
  for (const [slug, rec] of bucket) {
    const b = rec.breakdown;
    rec.recallEvents5y   = b.drugRecalls + b.deviceRecalls + b.foodRecalls;
    rec.adverseEvents5y  = b.drugEvents + b.deviceEvents + b.tobaccoEvents;
    rec.warningLetters5y = b.boxedWarningLabels;
    rec.class1RecallCount = b.drugRecallsCls1 + b.deviceRecallsCls1 + b.foodRecallsCls1;
    companies[slug] = {
      health: {
        recallEvents5y:        rec.recallEvents5y,
        adverseEvents5y:       rec.adverseEvents5y,
        warningLetters5y:      rec.warningLetters5y,
        carcinogenEmissionsKg: Math.round(rec.carcinogenEmissionsKg),
        class1RecallCount:     rec.class1RecallCount,
        breakdown: rec.breakdown,
        chemicals: [...rec.chemicals].slice(0, 10),
        sourceUrls: [...rec.sourceUrls],
      },
    };
  }

  const orphansArr = [...orphans.entries()]
    .map(([firm, v]) => ({ firm, total: v.total, sourceUrls: [...v.sourceUrls] }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 200);

  return { companies, orphans: orphansArr };
}

async function newestRawFile() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function main() {
  const args = parseArgs();
  const rawPath = args.raw || await newestRawFile();
  if (!rawPath || !existsSync(rawPath)) {
    console.error("No raw input found in data/raw/health-signals/ — run health-signals-fetch.mjs first.");
    process.exit(1);
  }
  console.log(`health-signals-merge -- reading ${path.relative(ROOT, rawPath)}`);
  const raw = await loadJson(rawPath);
  const maps = await loadMaps();

  // Cache companies/ listing so existence checks don't hit the FS 50k times.
  const companyFiles = new Set();
  if (existsSync(COMP_DIR)) {
    for (const f of await fs.readdir(COMP_DIR)) {
      if (f.endsWith(".json")) companyFiles.add(f.slice(0, -5));
    }
  }
  const companyExists = (slug) => companyFiles.has(slug);

  const { companies, orphans } = buildPerSlugCounts(
    raw.openfda || {},
    raw.tri || {},
    maps,
    companyExists,
    { quiet: args.quiet },
  );

  const topCarc = Object.entries(companies)
    .filter(([, v]) => v.health.carcinogenEmissionsKg > 0)
    .sort((a, b) => b[1].health.carcinogenEmissionsKg - a[1].health.carcinogenEmissionsKg)
    .slice(0, 10)
    .map(([slug, v]) => ({ slug, kg: v.health.carcinogenEmissionsKg }));

  const topCls1 = Object.entries(companies)
    .filter(([, v]) => v.health.class1RecallCount > 0)
    .sort((a, b) => b[1].health.class1RecallCount - a[1].health.class1RecallCount)
    .slice(0, 10)
    .map(([slug, v]) => ({ slug, class1: v.health.class1RecallCount }));

  const out = {
    _license: "US public domain (OpenFDA + EPA TRI)",
    _sources: raw._sources,
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, rawPath),
    _stats: {
      companies_tagged: Object.keys(companies).length,
      orphan_firms: orphans.length,
      top_carcinogen_emitters: topCarc,
      top_class1_recallers: topCls1,
    },
    companies,
    orphans,
  };

  await fs.mkdir(DER_DIR, { recursive: true });
  const outPath = args.out || OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);
  console.log(`Companies tagged: ${Object.keys(companies).length}`);
  console.log(`Top 5 carcinogen emitters: ${topCarc.slice(0, 5).map(t => `${t.slug}(${t.kg}kg)`).join(", ")}`);
  console.log(`Top 5 Class I recallers: ${topCls1.slice(0, 5).map(t => `${t.slug}(${t.class1})`).join(", ")}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("health-signals-merge failed:", e); process.exit(1); });
}
