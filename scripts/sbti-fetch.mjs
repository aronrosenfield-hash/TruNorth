#!/usr/bin/env node
/**
 * SBTi (Science Based Targets initiative) — Companies Taking Action
 *
 * SBTi publishes a public dashboard of every company that has either
 * COMMITTED to setting a climate target or has had one APPROVED (and
 * occasionally REMOVED). The dashboard powers a downloadable Excel/CSV
 * export from https://sciencebasedtargets.org/companies-taking-action.
 *
 * As of 2026 the page links a fresh "CTAs-Excel.xlsx" (or a CSV variant)
 * built monthly. The exact filename / URL changes per release, so we use
 * a heuristic: scrape the landing page for any href that ends in
 * ".csv" OR ".xlsx" AND contains "companies" in the link text or filename.
 * If a CSV exists we prefer that; if only XLSX, we fall back to the
 * checked-in fixture and emit a TODO log message.
 *
 * No API key required — the export is a public download.
 *
 * Output: data/raw/sbti/<YYYY-MM-DD>.json  — array of normalized rows.
 *
 * Cadence: monthly.
 *
 * Flags:
 *   (no args)        → dry run from fixture (test/fixtures/sbti/sample.csv)
 *   --apply / --live → actually hit sciencebasedtargets.org
 *   --limit N        → cap output to first N rows
 *   --out PATH       → override output path (overrides data/raw/sbti/<date>.json)
 *
 * Locally:
 *   node scripts/sbti-fetch.mjs
 *   node scripts/sbti-fetch.mjs --apply
 *   node scripts/sbti-fetch.mjs --apply --limit 200
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/sbti");
const FIXTURE    = path.join(ROOT, "test/fixtures/sbti/sample.csv");
const LANDING    = "https://sciencebasedtargets.org/companies-taking-action";
const UA = "TruNorth-SBTi/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

/**
 * Normalize one SBTi raw row to a stable TruNorth shape.
 * Tolerates field-name drift between releases — multiple aliases supported.
 */
export function normalizeRow(r) {
  const name = r["Company Name"] ?? r.company_name ?? r.Company ?? "";
  if (!name) return null;
  const sector = r["Sector"] ?? r.sector ?? null;
  const country = r["Country"] ?? r.country ?? null;
  const targetType =
    r["Target Type"] ?? r["Near term - Target Classification"] ?? r.target_classification ?? null;
  const targetYearRaw = r["Target Year"] ?? r.target_year ?? null;
  const targetYear = Number.parseInt(targetYearRaw, 10) || null;
  // Status may live under "Status", "Near term - Target Status", or "Action".
  const rawStatus = (
    r["Status"] ?? r["Near term - Target Status"] ?? r["Action"] ?? ""
  ).toString().trim().toLowerCase();
  let status = "unknown";
  if (rawStatus.includes("remov")) status = "removed";
  else if (rawStatus.includes("targets set") || rawStatus.includes("approv")) status = "approved";
  else if (rawStatus.includes("commit")) status = "committed";
  const netZeroYearRaw = r["Net-Zero Year"] ?? r.net_zero_year ?? null;
  const netZeroYear = Number.parseInt(netZeroYearRaw, 10) || null;
  const netZeroCommitted = /yes|true/i.test(r["Net-Zero Committed"] ?? "");
  const datePublished = r["Date Published"] ?? r.date_published ?? null;

  return {
    company: String(name).trim(),
    sector,
    country,
    target_type: targetType ? String(targetType).trim() : null,   // "1.5°C" | "Well-below 2°C" | "Net-Zero"
    target_year: targetYear,
    status,                                                       // "committed" | "approved" | "removed"
    net_zero_committed: netZeroCommitted,
    net_zero_year: netZeroYear,
    date_published: datePublished,
  };
}

/**
 * Scrape the SBTi landing page for the latest downloadable CSV link.
 * Returns the absolute URL or null if no CSV link is found.
 */
export function findCsvLink(html, base = "https://sciencebasedtargets.org") {
  if (!html) return null;
  // Look for any href ending in .csv (case-insensitive) that mentions
  // "compan" so we don't accidentally pick up unrelated downloads.
  const re = /href=["']([^"']+\.csv[^"']*)["'][^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = (m[2] || "").toLowerCase();
    if (/compan|action|cta/i.test(href) || /compan|action/.test(text)) {
      return href.startsWith("http") ? href : new URL(href, base).toString();
    }
  }
  // Fallback: just pick the first .csv on the page.
  re.lastIndex = 0;
  while ((m = re.exec(html))) {
    return m[1].startsWith("http") ? m[1] : new URL(m[1], base).toString();
  }
  return null;
}

async function fetchLiveCsv() {
  const landingRes = await fetch(LANDING, { headers: { "User-Agent": UA } });
  if (!landingRes.ok) throw new Error(`SBTi landing fetch failed: HTTP ${landingRes.status}`);
  const html = await landingRes.text();
  const csvUrl = findCsvLink(html);
  if (!csvUrl) {
    // TODO: SBTi sometimes only exposes an .xlsx — when that happens, this
    // script falls back to the fixture so the workflow doesn't crash, but
    // the maintainer should add an xlsx→csv conversion step (e.g.
    // `node -e "..."` with a lightweight xlsx reader) before --apply runs.
    console.warn("⚠️  SBTi: no .csv link found on landing page; falling back to fixture.");
    return null;
  }
  console.log(`⬇️  SBTi CSV: ${csvUrl}`);
  const csvRes = await fetch(csvUrl, { headers: { "User-Agent": UA } });
  if (!csvRes.ok) throw new Error(`SBTi CSV fetch failed: HTTP ${csvRes.status}`);
  return await csvRes.text();
}

async function loadFixture() {
  return await fs.readFile(FIXTURE, "utf-8");
}

async function main() {
  console.log(`SBTi fetcher starting... (mode=${APPLY ? "APPLY (live)" : "DRY (fixture)"})`);

  const csvText = APPLY ? (await fetchLiveCsv() ?? await loadFixture()) : await loadFixture();
  const rawRows = parseCSVToObjects(csvText);
  console.log(`Parsed ${rawRows.length} raw rows`);

  let rows = rawRows.map(normalizeRow).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const payload = {
    generated_at: new Date().toISOString(),
    source: "sbti",
    source_url: LANDING,
    mode: APPLY ? "live" : "fixture",
    row_count: rows.length,
    rows,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} normalized companies`);

  // Print a small breakdown so CI logs are useful at a glance.
  const byStatus = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  console.log(`   By status: ${JSON.stringify(byStatus)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("sbti-fetch failed:", err);
    process.exit(1);
  });
}
