#!/usr/bin/env node
/**
 * OCC Enforcement Actions (weekly)
 *
 * For each brand in /public/data/top-500-brands.txt, queries the OCC
 * (Office of the Comptroller of the Currency) Enforcement Actions search
 * for institution-level actions against that bank.
 *
 * The OCC regulates national banks and federal savings associations —
 * so almost all results will be financial brands (JPMorgan Chase, BoA,
 * Wells Fargo, Citi, USAA, etc). Non-bank brands return zero results,
 * which the merger skips.
 *
 * Output: /public/data/occ-enforcement.json (overwritten weekly)
 *
 * API: undocumented but used by https://apps.occ.gov/EASearch/
 *   GET https://apps.occ.gov/EASearch/api/WebSearch/Actions
 *     ?q=<institution name>&instOnly=true
 *   Returns JSON array of enforcement-action records. No auth.
 *
 * Per-brand aggregates:
 *   - total_enforcement_actions_5y
 *   - total_civil_money_penalties_dollars (all-time)
 *   - total_civil_money_penalties_5y_dollars
 *   - top_subject_matters (top 5)
 *   - top_action_types     (top 5)
 *   - sample_actions       (5 most recent)
 *
 * Runs via .github/workflows/occ-weekly.yml Tuesday 00:00 UTC.
 * Locally: node scripts/occ-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/occ-enforcement.json");

const OCC_BASE = "https://apps.occ.gov/EASearch/api/WebSearch/Actions";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const UA = "TruNorth-OCC/1.0 (+https://www.trunorthapp.com)";

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name);
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// SubjectMatterAssociations is a pipe-delimited string of overlapping
// subject tags. Split into a flat array and dedupe.
function explodeSubjects(record) {
  const raw = record.SubjectMatterAssociations || "";
  if (!raw) return [];
  return [...new Set(raw.split("|").map(s => s.trim()).filter(Boolean))];
}

async function fetchBrandActions(brand) {
  const url = `${OCC_BASE}?q=${encodeURIComponent(brand.name)}&instOnly=true`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "application/json",
      },
    });
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }

  if (!res.ok) {
    return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
  }

  let data;
  try { data = await res.json(); }
  catch (err) { return { slug: brand.slug, name: brand.name, status: "error", error: "json_parse" }; }

  if (!Array.isArray(data)) {
    return { slug: brand.slug, name: brand.name, status: "error", error: "non_array_response" };
  }

  // OCC matches on substring across many fields. We want institution-level
  // actions where the BankName actually contains a brand-name token. That
  // filters out unrelated hits (e.g. a bank in another city that happens to
  // share a word).
  const tokens = brand.name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && !["the","and","bank","national","association","inc","co","corp","corporation"].includes(t));

  const records = data.filter(r => {
    if (r.EnforcementInstIAPType !== "Institution") return false;
    const bn = (r.BankName || "").toLowerCase();
    if (!tokens.length) return true;
    // Require at least one meaningful token to appear in the BankName.
    return tokens.some(t => bn.includes(t));
  });

  if (records.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_enforcement_actions: 0 };
  }

  const cutoff = Date.now() - FIVE_YEARS_MS;
  const last5y = records.filter(r => {
    const t = Date.parse(r.CompleteDate);
    return !Number.isNaN(t) && t > cutoff;
  });

  const cmpAll = records.reduce((s, r) => s + (Number(r.Amount) || 0), 0);
  const cmp5y  = last5y.reduce((s, r) => s + (Number(r.Amount) || 0), 0);

  const sorted = [...records].sort((a, b) =>
    (Date.parse(b.CompleteDate) || 0) - (Date.parse(a.CompleteDate) || 0)
  );

  const subjects = records.flatMap(explodeSubjects);

  // Build a stable URL on the OCC search UI for users who want the full list.
  const searchUrl = `https://apps.occ.gov/EASearch/?q=${encodeURIComponent(brand.name)}&instOnly=true`;

  return {
    slug:                                 brand.slug,
    name:                                 brand.name,
    status:                               "ok",
    total_enforcement_actions:            records.length,
    total_enforcement_actions_5y:         last5y.length,
    total_civil_money_penalties_dollars:  cmpAll,
    total_civil_money_penalties_5y_dollars: cmp5y,
    top_subject_matters:                  topN(subjects, 5),
    top_action_types:                     topN(records.map(r => r.EnforcementTypeDescription || r.EnforcementTypeCode), 5),
    sample_actions: sorted.slice(0, 5).map(r => ({
      bank_name:               r.BankName,
      charter_number:          r.CharterNumber,
      city_state:              [r.CityName, r.StateAbbreviation].filter(Boolean).join(", "),
      action_type:             r.EnforcementTypeDescription || r.EnforcementTypeCode,
      action_type_code:        r.EnforcementTypeCode,
      amount_dollars:          Number(r.Amount) || 0,
      complete_date:           r.CompleteDate,
      termination_date:        r.TerminationDate,
      docket_number:           r.DocketNumber,
      document_number:         r.DocumentNumber,
      document_url:            r.HasPdf && r.DocumentNumber
        ? `https://occ.gov/static/enforcement-actions/ea${r.DocumentNumber}.pdf`
        : null,
      subject_matters:         explodeSubjects(r),
    })),
    sampled_count:                        records.length,
    source_url:                           searchUrl,
    scraped_at:                           new Date().toISOString(),
  };
}

async function main() {
  console.log("OCC enforcement-action fetcher starting...");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  // 1 req/sec courtesy throttle — ~9 min for 500 brands.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandActions(brands[i]);
    results.push(r);
    if (i % 50 === 0) console.log(`  ...${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const withActions = results.filter(r => r.status === "ok").length;
  const noActions   = results.filter(r => r.status === "no_actions").length;
  const err         = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:           new Date().toISOString(),
    brand_count:            brands.length,
    with_actions_count:     withActions,
    no_actions_count:       noActions,
    error_count:            err,
    actions:                results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With enforcement actions: ${withActions}`);
  console.log(`   No actions:               ${noActions}`);
  console.log(`   Errors:                   ${err}`);
}

main().catch(err => {
  console.error("occ-fetch failed:", err);
  process.exit(1);
});
