#!/usr/bin/env node
/**
 * Stanford Securities Class Action Clearinghouse (SCAC) scraper (monthly).
 *
 * The SCAC (https://securities.stanford.edu/filings.html) is the canonical
 * public index of federal securities class action filings since 1996. The
 * full search UI (per-defendant filter, settlement amounts, case-status
 * facets) lives behind a free email login, but the index landing page
 * exposes the 30 most-recent filings as plain HTML rows of:
 *
 *     Filing Name | Filing Date | District Court | Exchange | Ticker
 *
 * Each row links to /filings-case.html?id=NNNNNN. Detail pages, settlement
 * value fields, and pagination beyond the first page require auth and are
 * NOT scraped here (we honor SCAC's gating).
 *
 * Strategy
 * --------
 * Per brand in /public/data/top-500-brands.txt we:
 *   1. Walk the public /filings.html index (30 rows; the public "recent
 *      filings" window — covers ~3-6 months of activity).
 *   2. Regex-match the brand display name (+ aliases) against each row's
 *      Filing Name caption (word-boundary, case-insensitive).
 *   3. Aggregate.
 *
 * Per-brand output:
 *   - total_class_actions_lifetime  — count of public-window matches. SCAC
 *                                      does not surface a lifetime count
 *                                      without auth; for brands appearing in
 *                                      the public window we report what we
 *                                      see. The monthly cadence means we
 *                                      accumulate signal across runs into
 *                                      /public/data/_meta/stanford-scac-
 *                                      lifetime-ledger.json (additive).
 *   - recent_24mo                   — same set, filtered to last 730d
 *   - total_settlement_value_usd    — null (lives behind auth; PCAOB-style
 *                                      placeholder so downstream consumers
 *                                      can backfill from press releases or
 *                                      ISS/SCAS if needed)
 *   - latest_filing_date            — most recent ISO date
 *   - sample_actions                — top 5 most recent (filing_name, date,
 *                                      court, exchange, ticker, case_id, url)
 *
 * Rate limit: 1 req/sec. UA: "TruNorth-StanfordSCAC/1.0".
 *
 * Runs via .github/workflows/stanford-scac-monthly.yml on the 1st @ 23:00 UTC.
 * Locally: node scripts/stanford-scac-fetch.mjs              (all brands)
 *          node scripts/stanford-scac-fetch.mjs --smoke      (Meta, Tesla,
 *                                                            Wells Fargo,
 *                                                            Boeing)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/stanford-scac.json");
const LEDGER_FILE = path.join(ROOT, "public/data/_meta/stanford-scac-lifetime-ledger.json");

const INDEX_URL = "https://securities.stanford.edu/filings.html";
const CASE_URL  = "https://securities.stanford.edu/filings-case.html?id=";
const UA = "TruNorth-StanfordSCAC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const TWENTY_FOUR_MO_MS = 730 * 24 * 60 * 60 * 1000;

const SMOKE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["meta", "tesla", "wells-fargo", "boeing"]);

// Brand-name aliases for case captions. SCAC captions usually take the form
// "<Defendant Corp.> Securities Litigation" — the legal entity name, which
// often differs from the consumer-brand display name.
//
// Map value of `strictOnly: true` means we do NOT match the bare brand name
// (too many false positives) — only the listed aliases.
const BRAND_ALIASES = {
  "Meta":              { strictOnly: true, aliases: ["Meta Platforms", "Facebook, Inc", "Facebook Inc"] },
  "Apple":             { strictOnly: true, aliases: ["Apple Inc"] },
  "Target":            { strictOnly: true, aliases: ["Target Corporation"] },
  "Visa":              { strictOnly: true, aliases: ["Visa Inc"] },
  "Goldman Sachs":     { aliases: ["Goldman, Sachs", "Goldman Sachs Group"] },
  "JPMorgan Chase":    { aliases: ["JPMorgan", "J.P. Morgan", "Chase Bank"] },
  "Bank of America":   { aliases: ["BofA"] },
  "Wells Fargo":       { aliases: ["Wells Fargo & Co", "Wells Fargo & Company"] },
  "Google":            { aliases: ["Alphabet"] },
  "Verizon":           { aliases: ["Verizon Communications"] },
  "AT&T":              { aliases: ["AT&T Inc"] },
  "ExxonMobil":        { aliases: ["Exxon Mobil", "Exxon"] },
  "ConocoPhillips":    { aliases: ["Conoco"] },
  "Berkshire Hathaway":{ aliases: ["Berkshire"] },
  "Boeing":            { aliases: ["Boeing Company", "Boeing Co"] },
  "Tesla":             { aliases: ["Tesla, Inc", "Tesla Motors"] },
};

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

async function loadLedger() {
  try {
    return JSON.parse(await fs.readFile(LEDGER_FILE, "utf-8"));
  } catch {
    return { generated_at: null, brands: {} };
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse the public index page into [{ case_id, filing_name, date, court,
// exchange, ticker, url }]. The markup uses <tr class="table-link" onclick=
// "window.location='filings-case.html?id=NNNNNN'"> wrapping 5 <td> cells.
function parseIndex(html) {
  const out = [];
  const rowRe = /<tr class="table-link"[^>]*onclick="window\.location='filings-case\.html\?id=(\d+)'"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const caseId = m[1];
    const body   = m[2];
    const tdRe   = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells  = [];
    let tm;
    while ((tm = tdRe.exec(body))) {
      const text = tm[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#?\w+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      cells.push(text);
    }
    if (cells.length < 5) continue;
    const [filingName, dateRaw, court, exchange, ticker] = cells;
    // Date is MM/DD/YYYY — normalize to YYYY-MM-DD.
    let dateIso = "";
    const dm = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dm) dateIso = `${dm[3]}-${dm[1]}-${dm[2]}`;
    out.push({
      case_id:      caseId,
      filing_name:  filingName,
      date:         dateIso,
      court:        court,
      exchange:     exchange,
      ticker:       ticker,
      url:          `${CASE_URL}${caseId}`,
    });
  }
  return out;
}

async function fetchPublicIndex() {
  console.log(`  Fetching ${INDEX_URL} …`);
  const html = await fetchText(INDEX_URL);
  const rows = parseIndex(html);
  console.log(`  Parsed ${rows.length} public-window rows`);
  return rows;
}

function brandRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}\\b`, "i");
}

function matchersFor(brand) {
  const entry = BRAND_ALIASES[brand.name];
  let names;
  if (entry && !Array.isArray(entry) && entry.strictOnly) {
    names = entry.aliases;
  } else if (entry && Array.isArray(entry.aliases)) {
    names = [brand.name, ...entry.aliases];
  } else if (Array.isArray(entry)) {
    names = [brand.name, ...entry];
  } else {
    names = [brand.name];
  }
  return names.map(brandRegex);
}

function aggregateForBrand(brand, rows, ledger) {
  const regexes = matchersFor(brand);
  const matches = rows.filter(r =>
    regexes.some(re => re.test(r.filing_name))
  );

  // Merge this run's case_ids into the additive lifetime ledger so we
  // accumulate signal month-over-month even though the public window only
  // shows 30 filings at a time.
  const prev = ledger.brands[brand.slug] || { case_ids: [], first_seen_at: null };
  const seen = new Set(prev.case_ids);
  for (const m of matches) seen.add(m.case_id);
  const lifetimeIds = Array.from(seen);
  ledger.brands[brand.slug] = {
    name:          brand.name,
    case_ids:      lifetimeIds,
    first_seen_at: prev.first_seen_at || new Date().toISOString(),
    last_seen_at:  matches.length > 0 ? new Date().toISOString() : prev.last_seen_at || null,
  };

  if (matches.length === 0 && lifetimeIds.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions", total_class_actions_lifetime: 0 };
  }

  matches.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const cutoff = Date.now() - TWENTY_FOUR_MO_MS;
  const recent24mo = matches.filter(r => {
    const t = Date.parse(r.date);
    return !Number.isNaN(t) && t > cutoff;
  }).length;

  const sample = matches.slice(0, 5).map(r => ({
    filing_name: r.filing_name,
    date:        r.date,
    court:       r.court,
    exchange:    r.exchange,
    ticker:      r.ticker,
    case_id:     r.case_id,
    url:         r.url,
  }));

  return {
    slug:                          brand.slug,
    name:                          brand.name,
    status:                        "ok",
    total_class_actions_lifetime:  lifetimeIds.length,
    recent_24mo:                   recent24mo,
    total_settlement_value_usd:    null, // gated behind SCAC auth
    latest_filing_date:            matches[0]?.date || null,
    sample_actions:                sample,
    scraped_at:                    new Date().toISOString(),
  };
}

async function main() {
  console.log("Stanford SCAC fetcher starting…");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE) {
    brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));
    console.log(`SMOKE — testing ${brands.length}: ${brands.map(b => b.slug).join(", ")}`);
  }

  const ledger = await loadLedger();

  console.log("Walking public filings index…");
  const rows = await fetchPublicIndex();
  await sleep(REQ_DELAY_MS);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = aggregateForBrand(brands[i], rows, ledger);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  ${brands[i].slug}: ${r.total_class_actions_lifetime} lifetime (${r.recent_24mo} in last 24mo, latest ${r.latest_filing_date || "?"})`);
    }
    if (i % 50 === 0 && i > 0) console.log(`  …${i}/${brands.length}`);
  }

  const okCount   = results.filter(r => r.status === "ok").length;
  const noneCount = results.filter(r => r.status === "no_actions").length;

  // Persist additive lifetime ledger (commits month-over-month so coverage
  // grows as new filings rotate through the public window).
  ledger.generated_at = new Date().toISOString();
  await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
  await fs.writeFile(LEDGER_FILE, JSON.stringify(ledger, null, 2));

  const outPath = SMOKE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:       new Date().toISOString(),
    smoke:              SMOKE || undefined,
    source:             "stanford-securities-class-action-clearinghouse",
    source_url:         "https://securities.stanford.edu/filings.html",
    note:               "Public window is the 30 most-recent filings. Lifetime counts accumulate via the additive ledger at public/data/_meta/stanford-scac-lifetime-ledger.json. Settlement values are gated behind SCAC auth and not scraped.",
    public_window_size: rows.length,
    brand_count:        brands.length,
    with_actions_count: okCount,
    no_actions_count:   noneCount,
    filings:            results,
  }, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`   With actions: ${okCount}`);
  console.log(`   None:         ${noneCount}`);
}

main().catch(err => {
  console.error("stanford-scac-fetch failed:", err);
  process.exit(1);
});
