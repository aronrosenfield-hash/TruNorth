#!/usr/bin/env node
/**
 * CBP forced-labor fetcher (R7 #4/#5, 2026-06-11).
 *
 * Two public-domain federal feeds (gap 6 — supply chain / forced labor):
 *   1. DHS UFLPA Entity List (dhs.gov/uflpa-entity-list) — companies subject
 *      to the rebuttable import-ban presumption under 19 U.S.C. §1307.
 *      HTML table parse (~150 entities).
 *   2. CBP Withhold Release Orders & Findings — CSV discovered from
 *      cbp.gov/document/stats/withhold-release-orders-findings (the file
 *      href changes per release; ~97 per-producer records).
 *
 * License: CBP/DHS site content is public domain (CBP copyright notice),
 * commercial use permitted, citation requested. cbp.gov 403s non-browser
 * UAs — use a browser UA there; dhs.gov accepts default.
 *
 * Writes public/data/cbp-forced-labor.json. Guards against empty snapshots.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/data/cbp-forced-labor.json");
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const get = async (url, ua) => {
  const res = await fetch(url, { headers: { "User-Agent": ua || "TruNorth-CBP/1.0 (data pipeline; contact@trunorthapp.com)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};

const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// ── 1. UFLPA Entity List ────────────────────────────────────────────────────
const uflpaHtml = await get("https://www.dhs.gov/uflpa-entity-list");
const uflpa = [];
for (const tr of uflpaHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []) {
  const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
  if (tds.length < 2 || !tds[0]) continue;
  const nameRaw = tds[0];
  const aliases = [...nameRaw.matchAll(/alias(?:es)?:?\s*([^)]+)\)/gi)].map((m) => m[1].trim());
  const name = nameRaw.replace(/\s*\((?:and\s+)?[^)]*alias[^)]*\)\s*/gi, "").trim();
  uflpa.push({ name, aliases, listedDate: tds[1] || null });
}

// ── 2. WRO / Findings CSV ───────────────────────────────────────────────────
const docPage = await get("https://www.cbp.gov/document/stats/withhold-release-orders-findings", BROWSER_UA);
const csvHref = (docPage.match(/href="(\/sites\/default\/files\/[^"]*withhold-release[^"]*\.csv)"/i) || [])[1];
if (!csvHref) throw new Error("WRO CSV link not found on document page");
const csvText = await get(`https://www.cbp.gov${csvHref}`, BROWSER_UA);
// Simple CSV parse (fields may be quoted)
const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
const parseLine = (l) => {
  const out = []; let cur = "", q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};
const header = parseLine(lines[0]).map((h) => h.toLowerCase());
const idx = (names) => header.findIndex((h) => names.some((n) => h.includes(n)));
const iEntity = idx(["entity", "producer", "merchandise"]);
const iCountry = idx(["country"]);
const iStatus = idx(["status"]);
const iDate = idx(["effective", "date"]);
const wro = lines.slice(1).map(parseLine).filter((c) => c[iEntity]).map((c) => ({
  entity: c[iEntity],
  country: iCountry >= 0 ? c[iCountry] : null,
  status: iStatus >= 0 ? c[iStatus] : null,
  effectiveDate: iDate >= 0 ? c[iDate] : null,
}));

// Guards (B-60/61/62): refuse suspiciously small snapshots.
if (uflpa.length < 80 || wro.length < 40) {
  console.error(`[cbp] FATAL: uflpa=${uflpa.length} wro=${wro.length} — too small, refusing to write`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  license: "US government (CBP/DHS) — public domain, commercial use permitted, citation requested",
  fetchedAt: new Date().toISOString(),
  uflpa, wro,
  csvSource: `https://www.cbp.gov${csvHref}`,
}, null, 2));
console.log(`[cbp] wrote ${uflpa.length} UFLPA entities + ${wro.length} WRO/Findings records`);
