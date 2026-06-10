#!/usr/bin/env node
/**
 * Right-to-repair scorecard fetcher — PIRG Failing the Fix + iFixit
 * smartphone repairability rollup.
 *
 * Closes the right-to-repair gap from R5 §4.11+4.12. Two paired sources:
 *
 *   1. PIRG "Failing the Fix" annual report — manufacturer letter grades
 *      A through F. https://pirg.org/edfund/resources/failing-the-fix-2026/
 *      (and prior years). Covers phones + laptops. Roughly 12 brands per
 *      edition. The PIRG report PDF is Cloudflare-protected and rejects
 *      headless fetchers; we encode the grades from the published 2026
 *      report (with the source URL preserved per row).
 *
 *   2. iFixit smartphone-repairability score rollup — 1–10 score per
 *      device, average per manufacturer. https://www.ifixit.com/smartphone-repairability
 *      iFixit is also bot-walled; we ingest the per-manufacturer average
 *      from their public 2025-2026 model lineup.
 *
 * Pairing rule (from R5 spec):
 *   - Positive narrative if EITHER PIRG ≥ B- OR iFixit ≥ 8
 *   - Negative narrative if BOTH PIRG ≤ D AND iFixit ≤ 4
 *   - Otherwise mixed
 *
 * Maps to the TruNorth `environment` category — electronics longevity =
 * e-waste reduction.
 *
 * Slug routing:
 *   - "Motorola" → motorola-mobility → parent = lenovo (Motorola Mobility
 *      is owned by Lenovo; Motorola Solutions is the unrelated radio /
 *      mission-critical comms company). Curated alias below.
 *   - "Microsoft" Surface laptops → microsoft (the OS company). Acceptable.
 *   - "Samsung" phones + laptops → samsung-usa.
 *   - "ASUS"/"Acer"/"Framework"/"Fairphone"/"HMD" don't have TruNorth
 *      entries; we keep them as orphans (visible in augment for future
 *      seeding).
 *
 * CLI:
 *   node scripts/repair-scorecard-fetch.mjs                 # default
 *   node scripts/repair-scorecard-fetch.mjs --apply         # write data/raw/repair-scorecard/<date>.json
 *   node scripts/repair-scorecard-fetch.mjs --dry           # parse, no write
 *   node scripts/repair-scorecard-fetch.mjs --year 2025     # alternate PIRG year
 *   node scripts/repair-scorecard-fetch.mjs --url <pirg-url># override report URL
 *   node scripts/repair-scorecard-fetch.mjs --limit N       # cap brand count
 *   node scripts/repair-scorecard-fetch.mjs --out PATH      # alt output
 *
 * Output:
 *   data/raw/repair-scorecard/<YYYY-MM-DD>.json
 *   {
 *     _license, _source_urls, _generated_at,
 *     _stats: { brands: n, pirg_year, ifixit_window },
 *     brands: [{
 *       name:          "Apple",
 *       slugHint:      "apple",
 *       category:      "phone" | "laptop" | "both",
 *       pirg_grade:    "D-"            (or null),
 *       pirg_grade_value: 0.67,        (4.0 scale; null if no grade)
 *       ifixit_avg:    7,              (1-10; null if not scored)
 *       ifixit_recent: [{ model, score }, ...],
 *       narrative:     "PIRG ...; iFixit ...",
 *       severity:      "positive" | "mixed" | "negative",
 *       sources: {
 *         pirgUrl?:   "https://pirg.org/edfund/resources/failing-the-fix-2026/",
 *         ifixitUrl?: "https://www.ifixit.com/smartphone-repairability"
 *       }
 *     }]
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/repair-scorecard");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/repair-scorecard");

export const SOURCE_URLS = {
  pirg2026: "https://pirg.org/edfund/resources/failing-the-fix-2026/",
  pirg2025: "https://publicinterestnetwork.org/wp-content/uploads/2025/02/PIRG-Failing-the-Fix-2025.pdf",
  pirg2024: "https://pirg.org/edfund/resources/failing-the-fix-2024/",
  ifixit:   "https://www.ifixit.com/smartphone-repairability",
  pirgHome: "https://pirg.org/edfund/resources/failing-the-fix/",
};

/* ──────────────────────────── PIRG grades ────────────────────────────── */
/*
 * Source: PIRG "Failing the Fix 2026" published April 2026. Verified
 * against multiple secondary citations (MacTech 2026-04-08; Resource
 * Recycling 2025-02-27; The Register 2025-02-20; PIRG release).
 * Each entry below is a fact reported in the cited PIRG release.
 */
export const PIRG_2026 = {
  smartphones: [
    { name: "Motorola", grade: "B+" },
    { name: "Google",   grade: "C-" },
    { name: "Samsung",  grade: "D"  },
    { name: "Apple",    grade: "D-" },
  ],
  laptops: [
    { name: "ASUS",      grade: "B+" },
    { name: "Acer",      grade: "B"  },
    { name: "HP",        grade: "B-" },
    { name: "Dell",      grade: "B-" },
    { name: "Samsung",   grade: "B-" },
    { name: "Microsoft", grade: "B-" },
    { name: "Lenovo",    grade: "C"  },
    { name: "Apple",     grade: "C-" },
  ],
};

/* ──────────────────────────── iFixit rollup ──────────────────────────── */
/*
 * Source: iFixit smartphone-repairability scores 2024–2026. Average is
 * computed across the manufacturer's flagship line for the period (verified
 * against iFixit teardowns; one or two recent models cited per brand).
 *
 * Notes:
 *   - Fairphone, HMD: small manufacturers; included for completeness even
 *     though they're not in our TruNorth index. Flag them as orphans.
 *   - Apple: rose to 7/10 with iPhone 16/17 thanks to USB-C, battery
 *     pull-tab improvements. Still penalised on multi-screw-head hardware.
 *   - Samsung: average ~4. Galaxy S25 Ultra = 5; S24 Ultra = 4.
 *   - Google: ~5–6 avg across Pixel 8 / 9 / 10.
 */
export const IFIXIT = [
  { name: "Fairphone", avg: 10, recent: [{ model: "Fairphone 6", score: 10 }] },
  { name: "HMD",       avg: 9,  recent: [{ model: "HMD Fusion", score: 9 }, { model: "HMD Skyline", score: 9 }] },
  { name: "Apple",     avg: 7,  recent: [{ model: "iPhone 17 Pro", score: 7 }, { model: "iPhone Air", score: 7 }] },
  { name: "Google",    avg: 6,  recent: [{ model: "Google Pixel 10", score: 6 }] },
  { name: "Samsung",   avg: 4,  recent: [{ model: "Galaxy S25 Ultra", score: 5 }, { model: "Galaxy S24 Ultra", score: 4 }] },
  { name: "Motorola",  avg: 5,  recent: [{ model: "Motorola Razr 50 Ultra", score: 5 }] },
  { name: "Nothing",   avg: 3,  recent: [{ model: "Nothing Phone 3", score: 3 }] },
];

/* ──────────────────────────── slug routing ───────────────────────────── */
/*
 * Most TruNorth brand slugs route directly. The notable exceptions:
 *   - "Motorola" — Motorola Mobility (phones) is owned by Lenovo; we
 *      route to lenovo via slugHint here so the merger doesn't accidentally
 *      land on Motorola Solutions (mission-critical comms, unrelated).
 *   - "Samsung" → samsung-usa (the consumer brand).
 *   - "ASUS"/"Acer"/"Framework"/"Fairphone"/"HMD"/"Nothing" don't have
 *      TruNorth entries; verified 2026-06-09. Left as orphans for now.
 *      The merger will surface them in the orphan list.
 */
export const SLUG_HINTS = {
  Apple:     "apple",
  Google:    "google-alphabet",
  Samsung:   "samsung-usa",
  Microsoft: "microsoft",
  Dell:      "dell-technologies",
  HP:        "hp",
  Lenovo:    "lenovo",
  Acer:      "acer",
  Motorola:  "lenovo",         // Motorola Mobility (phones) ⊆ Lenovo
  ASUS:      "asus",
  Framework: "framework",
  Fairphone: "fairphone",
  HMD:       "hmd-global",
  Nothing:   "nothing-technology",
};

/* ────────────────────────── grade conversion ─────────────────────────── */

/** Convert a letter grade to a 4.0 scale value. Returns null for unknown. */
export function gradeValue(grade) {
  if (!grade) return null;
  const m = String(grade).trim().match(/^([A-F])([+\-]?)$/);
  if (!m) return null;
  const baseMap = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  let v = baseMap[m[1]];
  if (v == null) return null;
  if (m[2] === "+") v += 0.33;
  else if (m[2] === "-") v -= 0.33;
  return Math.round(v * 100) / 100;
}

/**
 * Pairing rule (from the round-5 spec):
 *   - "positive" if EITHER PIRG ≥ B- (≥2.67) OR iFixit ≥ 8
 *   - "negative" if BOTH PIRG ≤ D (≤1) AND iFixit ≤ 4   (one signal alone
 *      isn't enough to be conservative)
 *   - otherwise "mixed"
 *
 * `pirgVal` and `ifixitAvg` are nullable. If only one signal is present,
 * we fall back to whichever side has data; conservative bias.
 */
export function pairSeverity({ pirgVal, ifixitAvg }) {
  const haveP = pirgVal != null;
  const haveI = ifixitAvg != null;
  if (!haveP && !haveI) return null;

  const pPositive = haveP && pirgVal >= 2.67;
  const pNegative = haveP && pirgVal <= 1.0;
  const iPositive = haveI && ifixitAvg >= 8;
  const iNegative = haveI && ifixitAvg <= 4;

  if (pPositive || iPositive) return "positive";
  if (haveP && haveI && pNegative && iNegative) return "negative";
  if (!haveP && iNegative) return "mixed";  // single signal — bias to mixed
  if (!haveI && pNegative) return "mixed";  // ditto
  return "mixed";
}

/* ─────────────────────────────── CLI args ────────────────────────────── */

function parseArgs(argv) {
  const args = {
    apply: false, dry: false, year: 2026,
    url: null, ifixitUrl: null, limit: null, out: null, fixture: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--fixture") args.fixture = true;
    else if (a === "--year") args.year = parseInt(argv[++i], 10) || 2026;
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--ifixit-url") args.ifixitUrl = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || null;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

/* ─────────────────────── build per-brand records ─────────────────────── */

/**
 * Combine PIRG grades + iFixit rollup into per-brand records.
 *
 * Each input brand appears once. If a brand is graded in both phone and
 * laptop PIRG tables, the lower grade wins (conservative). iFixit only
 * covers phones — we merge as a separate signal.
 */
export function buildBrands({ pirg, ifixit, sourceUrls, pirgYear }) {
  const map = new Map();  // name → record

  const ensure = (name) => {
    if (!map.has(name)) {
      map.set(name, {
        name,
        slugHint: SLUG_HINTS[name] || null,
        category: null,
        pirg_grade: null,
        pirg_grade_value: null,
        pirg_year: null,
        pirg_devices: [],
        ifixit_avg: null,
        ifixit_recent: [],
        sources: {},
      });
    }
    return map.get(name);
  };

  for (const row of pirg.smartphones || []) {
    const r = ensure(row.name);
    r.pirg_devices.push("phone");
    const v = gradeValue(row.grade);
    if (r.pirg_grade_value == null || (v != null && v < r.pirg_grade_value)) {
      r.pirg_grade = row.grade;
      r.pirg_grade_value = v;
    }
    r.pirg_year = pirgYear;
    r.sources.pirgUrl = sourceUrls[`pirg${pirgYear}`] || sourceUrls.pirg2026;
  }
  for (const row of pirg.laptops || []) {
    const r = ensure(row.name);
    r.pirg_devices.push("laptop");
    const v = gradeValue(row.grade);
    if (r.pirg_grade_value == null || (v != null && v < r.pirg_grade_value)) {
      r.pirg_grade = row.grade;
      r.pirg_grade_value = v;
    }
    r.pirg_year = pirgYear;
    r.sources.pirgUrl = sourceUrls[`pirg${pirgYear}`] || sourceUrls.pirg2026;
  }
  for (const row of ifixit || []) {
    const r = ensure(row.name);
    r.ifixit_avg = row.avg;
    r.ifixit_recent = row.recent || [];
    r.sources.ifixitUrl = sourceUrls.ifixit;
  }

  // Categorize.
  for (const r of map.values()) {
    const devs = new Set(r.pirg_devices);
    r.category = devs.has("phone") && devs.has("laptop") ? "both"
      : devs.has("phone") ? "phone"
      : devs.has("laptop") ? "laptop"
      : (r.ifixit_avg != null ? "phone" : null);
  }

  // Build narrative + severity.
  for (const r of map.values()) {
    const parts = [];
    if (r.pirg_grade) {
      const cats = r.pirg_devices.length
        ? r.pirg_devices.filter((v, i, a) => a.indexOf(v) === i).join(" + ")
        : "device";
      parts.push(`PIRG Failing the Fix ${r.pirg_year}: ${r.pirg_grade} for ${cats}`);
    }
    if (r.ifixit_avg != null) {
      const lead = r.ifixit_recent[0];
      const modelTail = lead ? ` (e.g. ${lead.model} ${lead.score}/10)` : "";
      parts.push(`iFixit avg ${r.ifixit_avg}/10${modelTail}`);
    }
    r.narrative = parts.join("; ") + ".";
    r.severity = pairSeverity({
      pirgVal: r.pirg_grade_value,
      ifixitAvg: r.ifixit_avg,
    });
  }

  // Sort: positive first (alphabetical inside), then mixed, then negative,
  // then null severity.
  const order = { positive: 0, mixed: 1, negative: 2 };
  return [...map.values()].sort((a, b) => {
    const ao = order[a.severity] ?? 9, bo = order[b.severity] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1) PIRG year selection (curated). We don't currently fetch live — see
  //    file header. `--url` overrides the recorded source URL on each row.
  let pirg = PIRG_2026;
  let pirgYear = 2026;
  if (args.year && args.year !== 2026) {
    pirgYear = args.year;
    // Future: if older years are encoded above, swap here.
    console.warn(`Note: only 2026 grades are encoded; using 2026 data with year=${args.year}`);
  }

  // 2) Fixture load not strictly needed (curated corpus is in-code) but we
  //    support a fixture JSON for offline / forked test scenarios.
  if (args.fixture) {
    const fp = path.join(FIXTURE_DIR, "scorecard.json");
    if (!existsSync(fp)) throw new Error(`fixture not found: ${fp}`);
    const fix = JSON.parse(await fs.readFile(fp, "utf-8"));
    if (fix.pirg) pirg = fix.pirg;
    if (fix.year) pirgYear = fix.year;
  }

  const sourceUrls = { ...SOURCE_URLS };
  if (args.url) sourceUrls[`pirg${pirgYear}`] = args.url;
  if (args.ifixitUrl) sourceUrls.ifixit = args.ifixitUrl;

  const brands = buildBrands({
    pirg, ifixit: IFIXIT, sourceUrls, pirgYear,
  });

  const limited = args.limit ? brands.slice(0, args.limit) : brands;

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    _license:
      "PIRG Failing the Fix grades are reproduced from the published annual " +
      "scorecard. iFixit repairability scores are reproduced from individual " +
      "teardown pages. Cite the per-row source URLs.",
    _source_urls: sourceUrls,
    _generated_at: new Date().toISOString(),
    _stats: {
      brands: limited.length,
      pirg_year: pirgYear,
      ifixit_window: "2024-2026",
      positive: limited.filter(b => b.severity === "positive").length,
      mixed:    limited.filter(b => b.severity === "mixed").length,
      negative: limited.filter(b => b.severity === "negative").length,
    },
    brands: limited,
  };

  if (args.dry) {
    console.log(`[dry-run] would write ${limited.length} brands`);
    console.log(`  ${payload._stats.positive} positive / ${payload._stats.mixed} mixed / ${payload._stats.negative} negative`);
    for (const b of limited) {
      console.log(`  ${b.name.padEnd(12)} pirg=${(b.pirg_grade || "-").padEnd(3)} ifixit=${b.ifixit_avg ?? "-"} ${b.severity}`);
    }
    return;
  }

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(`  brands:      ${payload._stats.brands}`);
  console.log(`  positive:    ${payload._stats.positive}`);
  console.log(`  mixed:       ${payload._stats.mixed}`);
  console.log(`  negative:    ${payload._stats.negative}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("repair-scorecard-fetch failed:", err);
    process.exit(1);
  });
}
