#!/usr/bin/env node
/**
 * Lever 4a (R6): IRS 990-PF corporate-foundation pass → charity category.
 *
 * ProPublica's Nonprofit Explorer API is license-prohibited for commercial
 * reuse (R6 research), so we go straight to the IRS's own public-domain
 * bulk files:
 *   - EO Business Master File (eo1..eo4.csv) — EIN, NAME, FOUNDATION code
 *     for every exempt org. https://www.irs.gov/pub/irs-soi/eoN.csv
 *   - SOI 990-PF annual extract (24eoextract990pf.zip) — per-EIN financials
 *     incl. CONTRPDPBKS (contributions, gifts & grants PAID per books).
 *
 * Matching is deliberately conservative — "<Brand> Foundation" name
 * collisions are real (a personal "Apple Foundation" is not Apple Inc.):
 *   - BMF name must EXACTLY equal one of a small set of corporate-
 *     foundation name patterns for the brand (no substring matching).
 *   - BMF FOUNDATION code must be a private-foundation code (02/03/04).
 *   - Exactly ONE BMF org may match a brand's patterns (ambiguous → skip).
 *   - Single-word brand names additionally require grants paid ≥ $250K in
 *     the PF extract (big corporate foundations clear this; coincidental
 *     personal foundations rarely do). Multi-word brands ("General Mills
 *     Foundation") are unambiguous and need only > $0.
 *
 * Output: data/derived/irs990pf-foundations-augment.json
 *   { slug: { charity: { foundationName, ein, grantsPaidUsd, taxYear } } }
 *
 * Bulk files cache to public/data/_cache/irs990pf/ (gitignored, ~400 MB) —
 * re-downloaded when absent. B-60 guard: refuses to write an empty augment.
 *
 * License: US-government public domain (IRS SOI). Annual cadence.
 * Run: node scripts/irs990pf-foundations-fetch.mjs
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "public/data/_cache/irs990pf");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const AUG_FILE = path.join(ROOT, "data/derived/irs990pf-foundations-augment.json");

const BMF_FILES = ["eo1.csv", "eo2.csv", "eo3.csv", "eo4.csv"];
const PF_ZIP = "24eoextract990pf.zip";
const PF_CSV = "24eoextract990pf.csv";
const PF_FOUNDATION_CODES = new Set(["02", "03", "04"]); // private foundations

// Famous INDEPENDENT philanthropies whose names collide with consumer
// brands. The Ford Foundation has been fully independent of Ford Motor
// since 1974; same class of problem for several founder-named funds.
// Matching one of these to the brand would be factually wrong.
const INDEPENDENT_FOUNDATIONS = new Set([
  "ford foundation", "hilton foundation", "kellogg foundation",
  "heinz foundation", "getty foundation", "duke foundation",
  "bush foundation", "knight foundation", "moore foundation",
  "mott foundation", "sloan foundation", "mellon foundation",
  "johnson foundation", "luce foundation", "casey foundation",
  "irvine foundation", "penney foundation", "kresge foundation",
]);

const norm = s => String(s || "").toLowerCase()
  .replace(/[’'`´.,&]/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\b(incorporated|corporation|company|inc|corp|co|ltd|llc|the)\b/g, " ")
  .replace(/\s+/g, " ").trim();

async function ensureFiles() {
  await fsp.mkdir(CACHE, { recursive: true });
  for (const f of [...BMF_FILES, PF_ZIP]) {
    const p = path.join(CACHE, f);
    if (fs.existsSync(p) && fs.statSync(p).size > 1e5) continue;
    console.log(`📡 downloading ${f}…`);
    execSync(`curl -sf -A "Mozilla/5.0 (TruNorth research@trunorthapp.com)" -o "${p}" "https://www.irs.gov/pub/irs-soi/${f}" --max-time 300`);
  }
  if (!fs.existsSync(path.join(CACHE, PF_CSV))) {
    execSync(`unzip -o -q "${path.join(CACHE, PF_ZIP)}" -d "${CACHE}"`);
  }
}

// Minimal CSV field splitter (BMF/SOI files are simple; quoted commas rare
// but handled).
function splitCsv(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  await ensureFiles();
  const index = JSON.parse(await fsp.readFile(INDEX_FILE, "utf8"));

  // Brand → acceptable foundation-name patterns (normalized).
  const patterns = new Map(); // normalizedFoundationName -> [{slug, multiword}]
  for (const c of index) {
    const b = norm(c.name);
    if (!b || b.length < 4) continue;
    const multiword = b.includes(" ");
    for (const pat of [
      `${b} foundation`,
      `${b} charitable foundation`,
      `${b} corporate foundation`,
      `${b} foundation inc`, // norm strips "inc", kept for clarity — no-op
      `${b} stores foundation`,
      `${b} cares foundation`,
    ]) {
      const key = pat.replace(/\s+/g, " ").trim();
      if (!patterns.has(key)) patterns.set(key, []);
      patterns.get(key).push({ slug: c.slug, multiword });
    }
  }

  // Pass 1: scan BMF for private foundations whose name hits a pattern.
  const hits = new Map(); // slug -> [{ein, name}]
  for (const f of BMF_FILES) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(CACHE, f)) });
    let header = null, iEIN = 0, iNAME = 1, iFND = 13;
    for await (const line of rl) {
      if (!header) {
        header = splitCsv(line);
        iEIN = header.indexOf("EIN"); iNAME = header.indexOf("NAME"); iFND = header.indexOf("FOUNDATION");
        continue;
      }
      if (!/FOUNDATION/i.test(line)) continue; // cheap prefilter
      const cols = splitCsv(line);
      if (!PF_FOUNDATION_CODES.has(String(cols[iFND]).padStart(2, "0"))) continue;
      const n = norm(cols[iNAME]);
      if (INDEPENDENT_FOUNDATIONS.has(n)) continue;
      const owners = patterns.get(n);
      if (!owners) continue;
      for (const o of owners) {
        if (!hits.has(o.slug)) hits.set(o.slug, []);
        hits.get(o.slug).push({ ein: cols[iEIN], name: cols[iNAME], multiword: o.multiword });
      }
    }
  }
  console.log(`🔎 BMF: ${hits.size} brands with ≥1 private-foundation name match`);

  // Pass 2: join grants-paid from the PF extract.
  const wantEins = new Set([...hits.values()].flat().map(h => h.ein));
  const grants = new Map(); // ein -> { paid, taxYear }
  {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(CACHE, PF_CSV)) });
    let header = null, iEIN = 0, iPaid = 0, iYr = -1;
    for await (const line of rl) {
      if (!header) {
        header = splitCsv(line).map(h => h.toUpperCase().trim());
        iEIN = header.indexOf("EIN");
        iPaid = header.indexOf("CONTRPDPBKS");
        iYr = header.findIndex(h => /TAX_?PRD|TAXPER|TAX_YR/.test(h));
        continue;
      }
      const cols = splitCsv(line);
      const ein = String(cols[iEIN]).replace(/^0+/, "");
      if (!wantEins.has(ein) && !wantEins.has(cols[iEIN])) continue;
      const paid = Number(cols[iPaid]) || 0;
      const yrRaw = iYr >= 0 ? String(cols[iYr]) : "";
      grants.set(ein, { paid, taxYear: yrRaw.slice(0, 4) || null });
      grants.set(cols[iEIN], { paid, taxYear: yrRaw.slice(0, 4) || null });
    }
  }

  // Resolve: one unambiguous foundation per brand, thresholds per match type.
  const bySlug = {};
  let ambiguous = 0, belowThreshold = 0, noFinancials = 0;
  for (const [slug, list] of hits) {
    // Dedupe by EIN (same org can appear in multiple BMF regions).
    const uniq = [...new Map(list.map(h => [h.ein, h])).values()];
    if (uniq.length > 1) { ambiguous++; continue; }
    const h = uniq[0];
    const g = grants.get(h.ein) || grants.get(String(h.ein).replace(/^0+/, ""));
    if (!g || !(g.paid > 0)) { noFinancials++; continue; }
    // Multi-word floor $50K kills coincidental tiny family funds (we saw
    // $1-3K "foundations" matching obscure multiword brands); single-word
    // brands need the bigger $250K corporate-scale floor.
    const minPaid = h.multiword ? 50_000 : 250_000;
    if (g.paid < minPaid) { belowThreshold++; continue; }
    bySlug[slug] = {
      charity: {
        foundationName: h.name.replace(/\s+/g, " ").trim(),
        ein: h.ein,
        grantsPaidUsd: g.paid,
        taxYear: g.taxYear,
        sourceUrl: `https://apps.irs.gov/app/eos/detailsPage?ein=${h.ein}&name=f&city=&state=&countryAbbr=US&dba=&type=CHARITIES`,
      },
    };
  }
  console.log(`✅ resolved: ${Object.keys(bySlug).length} brands (ambiguous skipped: ${ambiguous}, no PF financials: ${noFinancials}, below single-word threshold: ${belowThreshold})`);

  if (Object.keys(bySlug).length === 0) {
    console.error("❌ 0 resolved foundations — refusing to write augment (B-60 guard).");
    process.exit(1);
  }
  await fsp.writeFile(AUG_FILE, JSON.stringify({
    _license: "US Government work — public domain. IRS EO BMF + SOI 990-PF extract.",
    _source_url: "https://www.irs.gov/statistics/soi-tax-stats-annual-extract-of-tax-exempt-organization-financial-data",
    _generated_at: new Date().toISOString(),
    _stats: { brands: Object.keys(bySlug).length, ambiguous, noFinancials, belowThreshold },
    ...bySlug,
  }, null, 2));
  console.log(`💾 ${path.relative(ROOT, AUG_FILE)}`);
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
