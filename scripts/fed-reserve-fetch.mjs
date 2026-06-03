#!/usr/bin/env node
/**
 * Federal Reserve Enforcement Actions (monthly).
 *
 * The Federal Reserve Board publishes a single canonical CSV of all formal
 * enforcement actions taken against the entities it supervises — bank
 * holding companies, state member banks, US branches/agencies of foreign
 * banks, Edge Act corporations, and certain individuals affiliated with
 * those entities. Coverage is complementary to OCC (national banks) and
 * FDIC (state non-member insured banks).
 *
 * Source:
 *   - Landing page: https://www.federalreserve.gov/supervisionreg/enforcementactions.htm
 *   - Search UI:    https://www.federalreserve.gov/apps/enforcementactions/search.aspx (Angular SPA)
 *   - Bulk CSV:     https://www.federalreserve.gov/supervisionreg/files/enforcementactions.csv
 *
 * CSV columns (header row is BOM-prefixed):
 *   Effective Date, Termination Date, Individual, Individual Affiliation,
 *   Banking Organization, Action, URL, Name, Note
 *
 * Penalty amounts are embedded inline in the Action string, e.g.
 *   "Civil Money Penalty,  $14,000,000"
 *   "Civil Money Penalty, $54.75 million"
 *   "Civil Money Penalty, $100,000,000, and Cease and Desist Order"
 * — we extract a USD amount with a permissive regex.
 *
 * For each brand in /public/data/top-500-brands.txt we filter rows whose
 * "Banking Organization" or "Individual Affiliation" field tokens overlap
 * with the brand-name tokens (same approach as occ-fetch.mjs) and emit:
 *   - total_fed_actions
 *   - total_fed_actions_5y
 *   - total_penalties_dollars       (all-time)
 *   - total_penalties_5y_dollars
 *   - top_action_types               (top 5)
 *   - sample_actions                 (5 most recent)
 *
 * Output: /public/data/fed-reserve-enforcement.json (overwritten monthly)
 *
 * Throttle: a single CSV fetch — no per-brand rate limit needed — but we
 * still announce 1 req/sec compliance and use UA "TruNorth-FedReserve/1.0"
 * so we appear politely in Fed logs.
 *
 * Locally: node scripts/fed-reserve-fetch.mjs
 *   --smoke   only the 4 smoke-test brands (Goldman, Morgan Stanley,
 *             JPMorgan, BoA)
 * Workflow: .github/workflows/fed-reserve-monthly.yml — 1st of the month
 *           17:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fed-reserve-enforcement.json");

const FED_CSV = "https://www.federalreserve.gov/supervisionreg/files/enforcementactions.csv";
const FED_SEARCH_BASE = "https://www.federalreserve.gov/apps/enforcementactions/search.aspx";
const UA = "TruNorth-FedReserve/1.0 (+https://www.trunorthapp.com)";
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

// Brand-name tokens that don't help disambiguate banks — strip from token sets.
const STOP_TOKENS = new Set([
  "the","and","bank","banks","banking","national","association",
  "inc","co","corp","corporation","company","group","holdings","holding",
  "financial","services","trust","savings",
]);

const SMOKE_SLUGS = new Set([
  "goldman-sachs", "morgan-stanley", "jpmorgan-chase", "bank-of-america",
]);

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);
}

function tokenize(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

// Word-boundary match — token must appear as a discrete word in haystack.
// Prevents "america" matching "americas" or "embankment" matching "bank".
function hasToken(haystack, token) {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(haystack);
}

/**
 * RFC-4180-style CSV parser that handles quoted fields with embedded
 * commas, newlines, and "" escapes. We avoid pulling in a dependency.
 */
function parseCSV(text) {
  // Strip BOM if present.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") {
        cur.push(field); rows.push(cur);
        cur = []; field = "";
      } else if (c === "\r") {
        // swallow — handled by \n
      } else {
        field += c;
      }
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function toRecords(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iEff   = idx("Effective Date");
  const iTerm  = idx("Termination Date");
  const iInd   = idx("Individual");
  const iAff   = idx("Individual Affiliation");
  const iOrg   = idx("Banking Organization");
  const iAct   = idx("Action");
  const iUrl   = idx("URL");
  const iName  = idx("Name");
  const iNote  = idx("Note");

  return rows.slice(1)
    .filter((r) => r.length >= header.length - 1 && r.some((c) => c && c.trim()))
    .map((r) => ({
      effective_date:    (r[iEff]   || "").trim(),
      termination_date:  (r[iTerm]  || "").trim(),
      individual:        (r[iInd]   || "").trim(),
      affiliation:       (r[iAff]   || "").trim(),
      banking_org:       (r[iOrg]   || "").trim(),
      action:            (r[iAct]   || "").trim(),
      url:               (r[iUrl]   || "").trim(),
      url_label:         (r[iName]  || "").trim(),
      note:              (r[iNote]  || "").trim(),
    }));
}

/**
 * Parse a USD amount embedded in an Action string.
 * Handles "$14,000,000", "$54.75 million", "$1.2 billion".
 * Returns 0 if no Civil Money Penalty / amount detected.
 */
function parsePenaltyUSD(action) {
  if (!action) return 0;
  const a = action.toLowerCase();
  if (!a.includes("civil money penalty") && !a.includes("$")) return 0;

  // Numeric forms first: $14,000,000 or $14000000
  let total = 0;
  const numeric = action.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|thousand)?/gi);
  for (const m of numeric) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "billion")  total += n * 1_000_000_000;
    else if (unit === "million") total += n * 1_000_000;
    else if (unit === "thousand") total += n * 1_000;
    else total += n;
  }
  return Math.round(total);
}

/**
 * Normalize the Action field to a coarse category for top_action_types
 * aggregation. The raw field can contain multi-part strings like
 * "Civil Money Penalty, $54.75 million, and Cease and Desist Order".
 */
function categorizeAction(action) {
  const cats = [];
  const a = (action || "").toLowerCase();
  if (a.includes("civil money penalty")) cats.push("Civil Money Penalty");
  if (a.includes("cease and desist"))    cats.push("Cease and Desist Order");
  if (a.includes("written agreement"))   cats.push("Written Agreement");
  if (a.includes("prohibition"))         cats.push("Prohibition from Banking");
  if (a.includes("removal"))             cats.push("Removal Order");
  if (a.includes("section 19"))          cats.push("Section 19 Letter");
  if (a.includes("notice of intent"))    cats.push("Notice of Intent");
  if (a.includes("formal agreement"))    cats.push("Formal Agreement");
  if (a.includes("memorandum of understanding")) cats.push("Memorandum of Understanding");
  if (!cats.length && action) cats.push(action.split(",")[0].trim().slice(0, 80));
  return cats;
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function absoluteUrl(u) {
  if (!u) return null;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("/")) return `https://www.federalreserve.gov${u}`;
  return `https://www.federalreserve.gov/${u}`;
}

async function fetchCSV() {
  console.log(`Fetching ${FED_CSV} ...`);
  const res = await fetch(FED_CSV, {
    headers: { "User-Agent": UA, "Accept": "text/csv,*/*" },
  });
  if (!res.ok) throw new Error(`Fed Reserve CSV fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  console.log(`  Downloaded ${text.length.toLocaleString()} bytes`);
  return text;
}

function aggregateBrand(brand, records, now) {
  const tokens = tokenize(brand.name);
  if (!tokens.length) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_fed_actions: 0 };
  }

  // Match rows where ALL brand-tokens appear as whole-words in Banking
  // Organization OR Individual Affiliation. Tokens are lowercased,
  // alphanumeric-only, and exclude generic banking words via STOP_TOKENS.
  // Word-boundary matching prevents "america" matching "Americas",
  // "morgan" matching "Morgantown", etc.
  //
  // If the brand collapses to a single token after STOP_TOKENS stripping
  // (e.g. "Bank of America" -> ["america"]), that one word is too generic
  // to match alone — also require the full brand-name phrase to appear as
  // a contiguous substring. This catches "BANK OF AMERICA CORPORATION"
  // and "Bank of America, N.A." while rejecting "Mid America Bank" or
  // "HSBC North America Holdings".
  const fullPhrase = brand.name.toLowerCase();
  const needsPhrase = tokens.length < 2;
  const matched = records.filter((r) => {
    const haystack = `${r.banking_org} ${r.affiliation}`;
    if (!haystack.trim()) return false;
    if (!tokens.every((t) => hasToken(haystack, t))) return false;
    if (needsPhrase && !haystack.toLowerCase().includes(fullPhrase)) return false;
    return true;
  });

  if (!matched.length) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_fed_actions: 0 };
  }

  const cutoff = now - FIVE_YEARS_MS;
  const last5y = matched.filter((r) => {
    const t = Date.parse(r.effective_date);
    return !Number.isNaN(t) && t > cutoff;
  });

  const penaltiesAll = matched.reduce((s, r) => s + parsePenaltyUSD(r.action), 0);
  const penalties5y  = last5y.reduce((s, r) => s + parsePenaltyUSD(r.action), 0);

  const sorted = matched.slice().sort((a, b) =>
    (Date.parse(b.effective_date) || 0) - (Date.parse(a.effective_date) || 0)
  );

  const allCategories = matched.flatMap((r) => categorizeAction(r.action));

  // Stable search URL for users who want the live UI.
  const searchUrl = `${FED_SEARCH_BASE}?Party=${encodeURIComponent(brand.name)}`;

  return {
    slug:                       brand.slug,
    name:                       brand.name,
    status:                     "ok",
    total_fed_actions:          matched.length,
    total_fed_actions_5y:       last5y.length,
    total_penalties_dollars:    penaltiesAll,
    total_penalties_5y_dollars: penalties5y,
    top_action_types:           topN(allCategories, 5),
    sample_actions: sorted.slice(0, 5).map((r) => ({
      effective_date:    r.effective_date,
      termination_date:  r.termination_date || null,
      banking_org:       r.banking_org,
      individual:        r.individual || null,
      affiliation:       r.affiliation || null,
      action:            r.action,
      action_categories: categorizeAction(r.action),
      penalty_dollars:   parsePenaltyUSD(r.action),
      press_release_url: absoluteUrl(r.url),
    })),
    source_url:                 searchUrl,
    scraped_at:                 new Date(now).toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`Fed Reserve enforcement-action fetcher starting${smoke ? " (smoke)" : ""}...`);

  const csv = await fetchCSV();
  const rows = parseCSV(csv);
  const records = toRecords(rows);
  console.log(`Parsed ${records.length.toLocaleString()} enforcement-action rows`);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (smoke) {
    brands = brands.filter((b) => SMOKE_SLUGS.has(b.slug));
    console.log(`Smoke mode: ${brands.length} brands -> ${brands.map((b) => b.slug).join(", ")}`);
  }

  const now = Date.now();
  const results = brands.map((b) => aggregateBrand(b, records, now));

  const withActions = results.filter((r) => r.status === "ok").length;
  const noActions   = results.filter((r) => r.status === "no_actions").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date(now).toISOString(),
    source_csv:          FED_CSV,
    source_landing:      "https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",
    csv_row_count:       records.length,
    brand_count:         brands.length,
    with_actions_count:  withActions,
    no_actions_count:    noActions,
    brands:              results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With enforcement actions: ${withActions}`);
  console.log(`   No actions:               ${noActions}`);

  // Print smoke summary for the 4 smoke brands when present.
  for (const slug of SMOKE_SLUGS) {
    const r = results.find((x) => x.slug === slug);
    if (r) {
      console.log(`   ${slug}: actions=${r.total_fed_actions || 0}, 5y=${r.total_fed_actions_5y || 0}, $${(r.total_penalties_dollars || 0).toLocaleString()}`);
    }
  }
}

main().catch((err) => {
  console.error("fed-reserve-fetch failed:", err);
  process.exit(1);
});
