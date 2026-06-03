#!/usr/bin/env node
/**
 * DEA Diversion Control — administrative actions against registrants
 * (pharmacies, distributors, manufacturers, practitioners).
 *
 * The DEA publishes every Decision and Order / Order to Show Cause /
 * Immediate Suspension Order in the Federal Register. We query the
 * Federal Register's free, official JSON API filtered to the
 * Drug Enforcement Administration agency, then search per-brand.
 *
 * For each brand in /public/data/top-500-brands.txt we capture
 * actions in the last 5 years:
 *   - total_DEA_actions_5y
 *   - sample_actions: [{ date, type, allegation, fine_or_revocation, url }]
 *
 * Source: https://www.deadiversion.usdoj.gov/administrative_actions.html
 * API:    https://www.federalregister.gov/developers/documentation/api/v1
 *
 * Output: /public/data/dea-actions.json (overwritten monthly).
 *
 * Smoke test brands (opioid distribution / dispensing crisis):
 *   Walgreens, CVS, Cardinal Health, McKesson, AmerisourceBergen.
 *
 * Run monthly via .github/workflows/dea-monthly.yml on the 1st @ 21:00 UTC.
 * Locally: node scripts/dea-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/dea-actions.json");

const FR_API = "https://www.federalregister.gov/api/v1/documents.json";
const UA     = "TruNorth-DEA/1.0 (+https://www.trunorthapp.com)";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

// Strip common corporate suffixes so the FR full-text search has the best
// chance of hitting registrant names: e.g. "Cardinal Health, Inc." → "Cardinal Health".
function searchTerm(name) {
  return name
    .replace(/\s*,?\s*(Inc\.?|Incorporated|Corp\.?|Corporation|LLC|L\.L\.C\.|Ltd\.?|Limited|Co\.?|Company|Holdings|Group|PLC|N\.A\.|N\.V\.)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Classify a DEA FR notice based on its title. Decisions and Orders are the
// final adjudications; Show Cause / Suspension orders are interim actions.
function classifyAction(title = "") {
  const t = title.toLowerCase();
  if (t.includes("immediate suspension")) return "immediate_suspension_order";
  if (t.includes("show cause"))           return "order_to_show_cause";
  if (t.includes("decision and order"))   return "decision_and_order";
  if (t.includes("final order"))          return "final_order";
  if (t.includes("revoked") || t.includes("revocation")) return "revocation";
  if (t.includes("denial"))               return "denial";
  if (t.includes("order"))                return "order";
  return "notice";
}

// Extract an "outcome" hint (revoked / denied / suspended / civil penalty)
// from the FR excerpt — best-effort, since the structured API doesn't
// expose the holding directly.
function extractOutcome(excerpt = "", title = "") {
  const blob = `${title} ${excerpt}`.toLowerCase();
  // Look for a civil penalty $ amount first
  const fineMatch = blob.match(/\$\s?([\d,]{4,})/);
  const fine = fineMatch ? `$${fineMatch[1]}` : null;

  let action = null;
  if (blob.includes("revoke") || blob.includes("revocation")) action = "revocation";
  else if (blob.includes("suspend")) action = "suspension";
  else if (blob.includes("deny") || blob.includes("denied") || blob.includes("denial")) action = "denial";
  else if (blob.includes("civil penalty") || fine) action = "civil_penalty";
  else if (blob.includes("dismiss")) action = "dismissed";
  else if (blob.includes("surrender")) action = "surrendered";

  if (action && fine) return `${action} + ${fine}`;
  if (action) return action;
  if (fine)   return `civil_penalty ${fine}`;
  return null;
}

async function fetchBrandActions(brand, cutoffISO) {
  const term = searchTerm(brand.name);

  // Federal Register API supports: agency filter + full-text term + date range.
  // We restrict to DEA-agency notices in the last 5y and search for the brand.
  const params = new URLSearchParams({
    "conditions[agencies][]":               "drug-enforcement-administration",
    "conditions[term]":                     `"${term}"`,
    "conditions[publication_date][gte]":    cutoffISO,
    "conditions[type][]":                   "NOTICE",
    "per_page":                             "100",
    "order":                                "newest",
    "fields[]":                             "document_number",
  });
  // Note: passing repeated fields[] for each field we want back.
  for (const f of ["title","publication_date","html_url","excerpts","abstract"]) {
    params.append("fields[]", f);
  }

  const url = `${FR_API}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) {
      return { slug: brand.slug, name: brand.name, status: "error", code: res.status };
    }
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const total = data?.count ?? results.length;

    if (total === 0) {
      return { slug: brand.slug, name: brand.name, status: "no_actions", total_DEA_actions_5y: 0 };
    }

    // Filter again client-side: the FR full-text search will match incidental
    // mentions (e.g. an unrelated pharmacy's case that mentions a Walgreens
    // subpoena). We require the brand term to appear in the TITLE for the
    // action to count as "against" the brand. This dramatically reduces
    // false positives. Sample list still includes near-matches as context.
    const termRx = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const titleMatches = results.filter(r => termRx.test(r.title || ""));

    const sample_actions = titleMatches.slice(0, 5).map(r => ({
      date:               r.publication_date,
      type:               classifyAction(r.title),
      allegation:         r.title,
      fine_or_revocation: extractOutcome(r.excerpts, r.title),
      document_number:    r.document_number,
      url:                r.html_url,
    }));

    return {
      slug:                 brand.slug,
      name:                 brand.name,
      status:               titleMatches.length ? "ok" : "mentions_only",
      search_term:          term,
      total_DEA_actions_5y: titleMatches.length,
      total_mentions_5y:    total,
      sample_actions,
      scraped_at:           new Date().toISOString(),
    };
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }
}

async function main() {
  console.log("DEA Diversion administrative-action fetcher starting…");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  const cutoff = new Date(Date.now() - FIVE_YEARS_MS).toISOString().slice(0, 10);
  console.log(`Cutoff: actions published on or after ${cutoff}`);

  // 1 req/sec courtesy to the Federal Register.
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await fetchBrandActions(brands[i], cutoff);
    results.push(r);
    if (i % 50 === 0) console.log(`  …${i}/${brands.length}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  const withActions  = results.filter(r => r.status === "ok").length;
  const mentionsOnly = results.filter(r => r.status === "mentions_only").length;
  const none         = results.filter(r => r.status === "no_actions").length;
  const err          = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:           new Date().toISOString(),
    source:                 "DEA Diversion Control / Federal Register API",
    cutoff_date:            cutoff,
    brand_count:            brands.length,
    with_actions_count:     withActions,
    mentions_only_count:    mentionsOnly,
    no_actions_count:       none,
    error_count:            err,
    actions:                results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With DEA actions: ${withActions}`);
  console.log(`   Mentions only:    ${mentionsOnly}`);
  console.log(`   No actions:       ${none}`);
  console.log(`   Errors:           ${err}`);

  // Smoke-test summary
  const smoke = ["walgreens", "cvs", "cardinal-health", "mckesson", "amerisourcebergen"];
  console.log("\nSmoke test:");
  for (const slug of smoke) {
    const r = results.find(x => x.slug === slug);
    if (r) console.log(`   ${slug.padEnd(22)} status=${r.status} count=${r.total_DEA_actions_5y ?? 0}`);
    else   console.log(`   ${slug.padEnd(22)} (not in brand list)`);
  }
}

main().catch(err => {
  console.error("dea-fetch failed:", err);
  process.exit(1);
});
