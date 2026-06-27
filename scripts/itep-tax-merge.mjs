#!/usr/bin/env node
/**
 * ITEP Corporate Tax Avoidance — merge into TruNorth slugs.
 *
 * Reads the most recent snapshot in data/raw/itep-tax/ (produced by
 * itep-tax-fetch.mjs, which itself uses the bundled fixture by default
 * until ITEP_INTEGRATION_ENABLED=true) and writes an augmentation file
 * keyed by TruNorth company slug:
 *
 *   data/derived/itep-tax-augment.json
 *
 *   {
 *     _license: "ITEP Corporate Tax Avoidance — reuse permission pending",
 *     _dormant: <bool>,        // true until the env gate is opened
 *     sourceUrl: "...",
 *     generatedAt: "...",
 *     matchCount: N,
 *     orphanCount: M,
 *     <slug>: {
 *       political: {
 *         effectiveFederalTaxRate: 0.0,
 *         zeroTaxYears: 4,
 *         totalProfits: 78420,    // USD millions
 *         federalTaxesPaid: -129, // USD millions
 *         studyYears: 5,
 *         reportEdition: "2024",
 *         sourceUrl: "...",
 *         _license: "ITEP Corporate Tax Avoidance — reuse permission pending"
 *       }
 *     }
 *   }
 *
 * Why under `political`?
 *   The TruNorth scoring engine groups tax-avoidance signals with
 *   "political/policy" flags (lobbying, donations, executive comp) because
 *   they're choices about who benefits from public goods rather than
 *   product-level harms. This keeps the augment shape consistent with
 *   the existing exec-political-donations + corporate-giving augments.
 *
 * Matching strategy:
 *   1. Direct normalized-name match against public/data/index.json.
 *   2. Parent-company match against public/data/_meta/brand-parent-map.json.
 *   3. Otherwise -> orphan.
 *
 * Flags:
 *   --apply        — write the augment file (otherwise print summary only).
 *   --dry          — (default) print what WOULD be written.
 *   --in PATH      — read a specific snapshot instead of the newest one.
 *
 * License gate:
 *   - When ITEP_INTEGRATION_ENABLED is NOT "true", the merge still runs
 *     (so tests + CI work end-to-end) but the output is stamped `_dormant: true`
 *     and the loader on the app side is expected to skip dormant augments.
 *
 * Locally:
 *   node scripts/itep-tax-merge.mjs
 *   node scripts/itep-tax-merge.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeCompanyName,
  LICENSE_TAG,
  INTEGRATION_ENABLED,
} from "./itep-tax-fetch.mjs";
import { isBlockedEdge } from "./lib/parent-map-guards.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/itep-tax");
const FIXTURE = path.join(__dirname, "fixtures/itep-tax/sample.json");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "itep-tax-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const CITE_URL = "https://itep.org/corporate-tax-avoidance/";
const PARENT_MAP_FILE = path.join(
  ROOT,
  "public/data/_meta/brand-parent-map.json",
);

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const IN_PATH = (() => {
  const i = argv.indexOf("--in");
  return i >= 0 ? argv[i + 1] : null;
})();

// ─────────────────────────── matching ───────────────────────────────

/**
 * Build an O(1)-lookup map from normalized index name → slug. We add a
 * few common short-form aliases so "Amazon.com, Inc." matches "Amazon".
 */
export function buildIndexLookup(index) {
  const byName = new Map();
  for (const e of index) {
    const k = normalizeCompanyName(e.name);
    if (k && !byName.has(k)) byName.set(k, e.slug);
  }
  return byName;
}

/**
 * Produce normalized-name variants for matching. ITEP rows often carry
 * the long legal form ("Amazon.com, Inc." / "AT&T Inc." / "The Home Depot")
 * which the normalizer reduces but not always to the brand slug name.
 *
 * Returns an array of candidate normalized strings, longest first.
 */
export function nameVariants(s) {
  const base = normalizeCompanyName(s);
  const out = new Set();
  if (base) out.add(base);
  // Drop trailing "us" / "north america" geo qualifiers.
  const stripped = base.replace(/\b(us|usa|north america|global|americas|international)\b/g, " ").replace(/\s+/g, " ").trim();
  if (stripped && stripped !== base) out.add(stripped);
  // Drop common one-word descriptors that appear after the brand
  // ("Tesla, Inc." → "tesla", "Nike, Inc." → "nike", "Dow Inc." → "dow",
  // "T-Mobile US, Inc." → "t mobile"). The first 1-3 words usually IS the brand.
  for (const v of [base, stripped]) {
    if (!v) continue;
    const words = v.split(" ").filter(Boolean);
    if (words.length >= 1) out.add(words[0]);
    if (words.length >= 2) out.add(words.slice(0, 2).join(" "));
    if (words.length >= 3) out.add(words.slice(0, 3).join(" "));
  }
  // Special-case the ampersand collapse — "at t" → "att".
  for (const v of [...out]) {
    if (/^[a-z] [a-z]$/.test(v)) out.add(v.replace(" ", ""));
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Try a few normalized-name variants against the lookup. Returns the
 * matched slug or null.
 */
export function matchCompanyToIndex(companyName, byName) {
  for (const v of nameVariants(companyName)) {
    const hit = byName.get(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve a slug via the brand-parent-map. The parent-map keys are
 * sub-brand slugs (kebab-cased), so we generate slug-candidates from
 * the company name and check each.
 */
export function matchViaParentMap(companyName, parentMap) {
  if (!parentMap || typeof parentMap !== "object") return null;
  const candidates = slugCandidates(companyName);
  for (const c of candidates) {
    const entry = parentMap[c];
    if (entry && entry.parent && !isBlockedEdge(c, entry.parent, entry.confidence)) return entry.parent;
  }
  return null;
}

function slugCandidates(companyName) {
  const out = new Set();
  for (const v of nameVariants(companyName)) {
    out.add(v.replace(/\s+/g, "-"));
  }
  return [...out].filter((x) => x.length >= 3);
}

// ─────────────────────────── snapshot loader ────────────────────────

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function loadJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

// ─────────────────────────── merge ──────────────────────────────────

export function mergeSnapshot(snapshot, { index, parentMap }) {
  const byName = buildIndexLookup(index);
  const augment = {};
  let directMatches = 0;
  let parentMatches = 0;
  let orphans = 0;
  const orphanList = [];

  for (const row of snapshot.rows || []) {
    const political = {
      effectiveFederalTaxRate: row.effectiveFederalTaxRate ?? null,
      zeroTaxYears: row.zeroTaxYears ?? null,
      totalProfits: row.totalProfitsUsdMillions ?? null,
      federalTaxesPaid: row.federalTaxesPaidUsdMillions ?? null,
      studyYears: row.studyYears ?? null,
      reportEdition: row.reportEdition ?? snapshot.reportEdition ?? null,
      sourceUrl: row.sourceUrl || snapshot.sourceUrl || "",
      _license: LICENSE_TAG,
    };

    let slug = matchCompanyToIndex(row.company, byName);
    let route = "direct";
    if (!slug) {
      slug = matchViaParentMap(row.company, parentMap);
      if (slug) route = "parent";
    }
    if (slug) {
      if (route === "direct") directMatches++; else parentMatches++;
      // Last-write-wins is fine — fetcher dedupes by company before this.
      augment[slug] = { political };
      continue;
    }
    orphans++;
    orphanList.push(row.company);
  }

  return {
    augment,
    stats: { directMatches, parentMatches, orphans, orphanList },
  };
}

// ─────────────────────────── main ───────────────────────────────────

async function main() {
  console.log(
    `itep-tax merge starting... (mode=${DRY ? "DRY" : "APPLY"}, integration_enabled=${INTEGRATION_ENABLED})`,
  );

  let snapshotPath = IN_PATH ? path.resolve(IN_PATH) : await latestSnapshot();
  if (!snapshotPath || !existsSync(snapshotPath)) {
    if (existsSync(FIXTURE)) {
      console.log(`No snapshot in ${path.relative(ROOT, RAW_DIR)} — using fixture.`);
      snapshotPath = FIXTURE;
    } else {
      console.error("No snapshot and no fixture available.");
      process.exit(2);
    }
  }
  const snapshot = await loadJson(snapshotPath);
  if (!snapshot) {
    console.error(`Could not parse snapshot at ${snapshotPath}`);
    process.exit(2);
  }
  console.log(
    `Loaded snapshot: ${path.relative(ROOT, snapshotPath)} (${snapshot.rowCount || (snapshot.rows || []).length} companies)`,
  );

  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  console.log(
    `Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`,
  );

  const { augment, stats } = mergeSnapshot(snapshot, { index, parentMap });
  const matchedSlugs = Object.keys(augment).length;

  console.log("\nResults:");
  console.log(`  Direct matches:        ${stats.directMatches}`);
  console.log(`  Parent-map matches:    ${stats.parentMatches}`);
  console.log(`  Orphans (no mapping):  ${stats.orphans}`);
  console.log(`  Distinct matched slugs: ${matchedSlugs}`);

  // Top-10 highlights for the merge log — the headline "$0 in federal tax"
  // story is "highest zero-tax-year count, lowest effective rate".
  const ranked = Object.entries(augment)
    .map(([slug, v]) => ({ slug, ...v.political }))
    .sort((a, b) => {
      const zb = (b.zeroTaxYears || 0) - (a.zeroTaxYears || 0);
      if (zb !== 0) return zb;
      return (a.effectiveFederalTaxRate ?? 9) - (b.effectiveFederalTaxRate ?? 9);
    })
    .slice(0, 10);
  if (ranked.length) {
    console.log("\n  Top-10 (most $0-tax years, then lowest effective rate):");
    for (const r of ranked) {
      const rate = r.effectiveFederalTaxRate == null
        ? "?"
        : `${(r.effectiveFederalTaxRate * 100).toFixed(1)}%`;
      console.log(
        `    ${String(r.zeroTaxYears ?? "?").padStart(2)}/${String(r.studyYears ?? "?")}  ${rate.padStart(6)}  ${r.slug}`,
      );
    }
  }

  if (stats.orphans && stats.orphanList.length) {
    console.log(
      `\n  First 5 orphans: ${stats.orphanList.slice(0, 5).join(" | ")}`,
    );
  }

  const out = {
    _license: LICENSE_TAG,
    _dormant: !INTEGRATION_ENABLED || !!snapshot._fixture,
    sourceUrl: snapshot.sourceUrl || "",
    sourceKind: snapshot.sourceKind || "",
    landingUrl: snapshot.landingUrl || "https://itep.org/corporate-tax-avoidance-report",
    reportEdition: snapshot.reportEdition || null,
    generatedAt: new Date().toISOString(),
    matchCount: stats.directMatches + stats.parentMatches,
    orphanCount: stats.orphans,
    ...augment,
  };

  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
    if (out._dormant) {
      console.log(
        "  (_dormant: true — fixture/offline source; NOT writing into company files.)",
      );
    } else {
      // Display-first: fold the tax data into company.enriched.tax — a standalone
      // datapoint block (like enriched.environment), so the reveal can show it
      // WITHOUT touching the political category narrative or its score.
      let written = 0;
      for (const [slug, v] of Object.entries(augment)) {
        const file = path.join(COMP_DIR, `${slug}.json`);
        if (!existsSync(file)) continue;
        let company;
        try { company = JSON.parse(await fs.readFile(file, "utf-8")); } catch { continue; }
        company.enriched = company.enriched || {};
        company.enriched.tax = {
          ...v.political,
          citation: `Verified source: ${LICENSE_TAG}`,
          citeUrl: snapshot.citeUrl || CITE_URL,
          reportPdf: snapshot.reportPdf || null,
        };
        if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
          company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
        }
        company.dataLastUpdated.itepTax = out.generatedAt;
        await fs.writeFile(file, JSON.stringify(company, null, /\n {2}/.test(await fs.readFile(file, "utf-8").catch(() => "")) ? 2 : 0));
        written++;
      }
      console.log(`  Wrote enriched.tax into ${written} company files.`);
    }
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("itep-tax-merge failed:", err);
    process.exit(1);
  });
}
