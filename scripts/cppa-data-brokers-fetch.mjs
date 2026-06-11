#!/usr/bin/env node
/**
 * Lever 4b (R6): CPPA California Data Broker Registry → privacy category.
 *
 * One bulk CSV, published by the California Privacy Protection Agency:
 *   https://cppa.ca.gov/data_broker_registry/complete-reg-data-brokers.csv
 * Registration is mandatory for businesses that knowingly collect and SELL
 * consumers' personal information to third parties (CA Civil Code
 * §1798.99.80) — a factual statutory signal, not an editorial judgment.
 *
 * Matching: normalized exact name match against the catalog, including the
 * "X doing business as Y" / "X dba Y" forms (both sides tried). ~500
 * registered brokers; most are B2B ad-tech, so expect modest but
 * high-precision catalog overlap.
 *
 * Output: data/derived/cppa-data-brokers-augment.json
 * License: California state government records. Annual registration cycle →
 * quarterly cron is plenty. B-60 guard: refuses to write an empty augment.
 *
 * Run: node scripts/cppa-data-brokers-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const AUG_FILE = path.join(ROOT, "data/derived/cppa-data-brokers-augment.json");
const CSV_URL = "https://cppa.ca.gov/data_broker_registry/complete-reg-data-brokers.csv";

// Manually-reviewed false positives (2026-06-10 review of all matches):
// "Lucid Holdings, LLC" is the survey-data firm, not Lucid Group (EV);
// "The Bridge Corp" is an ad-tech firm, not the retail brand.
const SLUG_DENYLIST = new Set(["lucid-group", "the-bridge"]);

const norm = s => String(s || "").toLowerCase()
  .replace(/[’'`´.,&]/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\b(incorporated|corporation|company|holdings?|group|inc|corp|co|ltd|llc|lp|the)\b/g, " ")
  .replace(/\s+/g, " ").trim();

// CSV rows can contain quoted multi-line cells — parse statefully.
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (q && text[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) { row.push(cur); cur = ""; }
    else if ((ch === "\n" || ch === "\r") && !q) {
      if (cur || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function main() {
  console.log("📡 Fetching CPPA data-broker registry CSV…");
  const res = await fetch(CSV_URL, {
    headers: { "User-Agent": "TruNorth research@trunorthapp.com" },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!res.ok) { console.error(`❌ HTTP ${res.status}`); process.exit(1); }
  const rows = parseCsv(await res.text());
  const header = rows[0].map(h => h.replace(/^﻿/, "").trim());
  const iName = header.findIndex(h => /broker name/i.test(h));
  const iDate = header.findIndex(h => /date added/i.test(h));
  const brokers = rows.slice(1)
    .filter(r => r[iName])
    .map(r => ({ name: r[iName].trim(), dateAdded: (r[iDate] || "").trim() || null }));
  console.log(`   ${brokers.length} registered brokers`);
  if (brokers.length < 100) { console.error("❌ suspiciously few rows — refusing to write (B-60 guard)."); process.exit(1); }

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
  const nameToSlug = new Map();
  for (const c of index) {
    const k = norm(c.name);
    if (k && !nameToSlug.has(k)) nameToSlug.set(k, c.slug);
  }

  const bySlug = {};
  for (const b of brokers) {
    // Try the full name plus both halves of "X doing business as Y" / "X dba Y".
    const candidates = [b.name];
    const dba = b.name.split(/\s+(?:doing business as|d\/?b\/?a)\s+/i);
    if (dba.length === 2) candidates.push(dba[0], dba[1]);
    for (const cand of candidates) {
      const slug = nameToSlug.get(norm(cand));
      if (slug && SLUG_DENYLIST.has(slug)) continue;
      if (slug && !bySlug[slug]) {
        bySlug[slug] = { privacy: { registered: true, registryName: b.name, dateAdded: b.dateAdded, sourceUrl: "https://cppa.ca.gov/data_broker_registry/" } };
        break;
      }
    }
  }
  const n = Object.keys(bySlug).length;
  console.log(`🔎 matched ${n} brokers to catalog slugs`);
  if (n === 0) { console.error("❌ 0 matches — refusing to write (B-60 guard)."); process.exit(1); }

  await fs.writeFile(AUG_FILE, JSON.stringify({
    _license: "California state government records (CPPA Data Broker Registry).",
    _source_url: CSV_URL,
    _generated_at: new Date().toISOString(),
    _stats: { registry_rows: brokers.length, matched: n },
    ...bySlug,
  }, null, 2));
  console.log(`💾 ${path.relative(ROOT, AUG_FILE)}`);
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
