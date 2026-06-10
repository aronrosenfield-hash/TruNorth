#!/usr/bin/env node
/**
 * KFF / CMS Marketplace claim-denial rates — annual rollup of in-network
 * claim denial rates by parent-company insurer.
 *
 * Source:
 *   - CMS Transparency in Coverage PUF (Marketplace Open Enrollment Period
 *     Public Use File, data.healthcare.gov)
 *   - KFF curated working file aggregating the CMS PUF at the issuer +
 *     parent-company level. The most recent file is the 2023 plan-year
 *     analysis published Jan 2026:
 *     https://www.kff.org/affordable-care-act/issue-brief/claims-denials-and-appeals-in-aca-marketplace-plans-in-2023/
 *     Working file: https://files.kff.org/attachment/2023-KFF-Transparency-Data-Working-File.xlsx
 *
 * Why a curated dataset + xlsx parse:
 *   The KFF working file is the only one-row-per-issuer aggregation of the
 *   CMS PUF; CMS publishes the raw plan-level CSV but doesn't roll it up
 *   to parent-company. The KFF file has the columns we need:
 *   Parent_Company, Issuer_Name, Claims_Received_In_Network,
 *   Claims_Denied_In_Network, Denial_Rate_In_Network. We parse the
 *   parent-company aggregate (sum claims, sum denials, recompute the
 *   weighted-average denial rate) and join to TruNorth slugs via the
 *   PARENT_TO_SLUG map below.
 *
 *   The fixture mirrors a curated set of the top parent companies so the
 *   unit test is reproducible without re-downloading the xlsx.
 *
 * Output:
 *   data/raw/kff-denial/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --apply       write snapshot to data/raw/...
 *   --dry         explicit dry (default behaviour without --apply)
 *   --out PATH    override output path
 *   --url URL     URL marker recorded in the snapshot meta
 *   --fixture     load INSURERS from scripts/fixtures/kff-denial/ instead
 *   --limit N     truncate insurer count (debug)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/kff-denial");
const FIXTURE_DIR = path.join(__dirname, "fixtures/kff-denial");

export const SOURCE_URLS = {
  cmsPuf: "https://www.cms.gov/marketplace/resources/data",
  cmsPufDataset: "https://data.healthcare.gov/dataset/5c232812-fc30-4dd7-8af7-015ce0073eb8",
  kffBrief: "https://www.kff.org/affordable-care-act/issue-brief/claims-denials-and-appeals-in-aca-marketplace-plans-in-2023/",
  kffWorkingFile: "https://files.kff.org/attachment/2023-KFF-Transparency-Data-Working-File.xlsx",
};

/**
 * Hand-curated parent-company → TruNorth slug map. Each parent label is
 * the exact string used in the CMS Transparency in Coverage PUF's
 * Parent_Company field (uppercased "GRP" suffix is CMS's own
 * abbreviation for "Group"). Slugs must exist in public/data/index.json.
 *
 * Where a parent has both a healthcare subsidiary slug and a holding-
 * company slug we prefer the public-facing brand the consumer would type
 * (e.g. CVS GRP → aetna-cvs-health since "Aetna" is the insurance brand).
 */
export const PARENT_TO_SLUG = {
  "CENTENE CORP GRP": "centene",
  "CVS GRP": "aetna-cvs-health",
  "OSCAR HEALTH INC GRP": "oscar-health",
  "CIGNA HLTH GRP": "cigna",
  "UNITEDHEALTH GRP": "unitedhealth-group",
  "ELEVANCE HLTH INC GRP": "anthem-elevance-health",
  "MOLINA HEALTHCARE INC GRP": "molina-healthcare",
  "HUMANA GRP": "humana",
  "KAISER FOUNDATION GRP": "kaiser-permanente",
  "GUIDEWELL MUT HOLDING GRP": "florida-blue",
  // BCBS regional plans — keep mapping conservative; only when an exact
  // TruNorth slug exists (most BCBS state plans are not in our index).
};

/**
 * Per-parent severity rule (consumer-protection on health claims):
 *   denial_rate >= 0.32                 → "very_poor"  (KFF "high denier" threshold)
 *   denial_rate >= 0.22                 → "poor"
 *   denial_rate >= 0.12                 → "mixed"      (around the 2023 marketplace average of ~20%)
 *   denial_rate <  0.10                 → "positive"
 *   otherwise (between 0.10 and 0.12)   → "neutral"
 */
export function severityFor(p) {
  const r = p.in_network_denial_rate ?? p.denialRate ?? 0;
  if (r >= 0.32) return "very_poor";
  if (r >= 0.22) return "poor";
  if (r >= 0.12) return "mixed";
  if (r < 0.10 && r > 0) return "positive";
  return "neutral";
}

export function todayUTC() { return new Date().toISOString().slice(0, 10); }

export function buildSnapshot(parents, planYear = 2023) {
  const enriched = parents.map(p => ({
    parent: p.parent,
    slug: PARENT_TO_SLUG[p.parent] || null,
    plan_year: planYear,
    in_network_claims: p.in_network_claims,
    in_network_denials: p.in_network_denials,
    in_network_denial_rate: p.in_network_denial_rate,
    issuer_count: p.issuer_count,
    states: p.states,
    severity: severityFor(p),
    source_url: SOURCE_URLS.kffBrief,
  }));
  return {
    source: "kff-denial",
    source_urls: SOURCE_URLS,
    generated_at: new Date().toISOString(),
    snapshot_date: todayUTC(),
    plan_year: planYear,
    parent_count: enriched.length,
    matched_parent_count: enriched.filter(e => e.slug).length,
    parents: enriched,
    license:
      "CMS Transparency in Coverage PUF is US-Federal public domain. " +
      "KFF aggregate file is reproduced under fair-use for analytical purposes.",
    methodology:
      "Per-parent rollup of the CMS Marketplace Open Enrollment Period Public " +
      "Use File via the KFF 2023 working file. We sum Claims_Received_In_Network " +
      "and Claims_Denied_In_Network across all issuer rows under each parent " +
      "company and recompute denial_rate = denials/claims. Severity tier compares " +
      "to the 2023 HealthCare.gov marketplace in-network denial-rate average of ~20%.",
  };
}

function parseArgs(argv) {
  const out = { apply: false, dry: false, out: null, url: null, fixture: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--dry") out.dry = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--fixture") out.fixture = true;
    else if (a === "--limit") out.limit = Number(argv[++i]);
  }
  return out;
}

async function runFixture() {
  const fp = path.join(FIXTURE_DIR, "parents.json");
  const raw = JSON.parse(await fs.readFile(fp, "utf-8"));
  return buildSnapshot(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let parents;
  if (args.fixture) {
    return outputDry(args, await runFixture());
  } else {
    // Default: use the bundled parents-raw.json which was produced by parsing
    // the KFF xlsx working file. Refresh annually via tools/refresh-kff-xlsx.mjs.
    const rawFp = path.join(FIXTURE_DIR, "parents-raw.json");
    parents = JSON.parse(await fs.readFile(rawFp, "utf-8"));
  }

  if (args.limit && args.limit > 0) parents = parents.slice(0, args.limit);
  const snap = buildSnapshot(parents);
  if (args.url) snap.cli_url_marker = args.url;

  if (!args.apply || args.dry) {
    return outputDry(args, snap);
  }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outPath = args.out || path.join(RAW_DIR, `${snap.snapshot_date}.json`);
  await fs.writeFile(outPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${outPath}  parents=${snap.parent_count} matched=${snap.matched_parent_count}`);
}

function outputDry(args, snap) {
  console.log(`KFF/CMS denial-rate: ${snap.parent_count} parents (matched ${snap.matched_parent_count}). Dry — no write.`);
  const matched = snap.parents.filter(p => p.slug);
  console.log(JSON.stringify({
    preview: matched.map(p => ({
      parent: p.parent, slug: p.slug,
      denial_pct: +(p.in_network_denial_rate * 100).toFixed(1),
      claims_M: +(p.in_network_claims / 1e6).toFixed(1),
      severity: p.severity,
    })),
  }, null, 2));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("kff-denial-fetch failed:", err); process.exit(1); });
}
