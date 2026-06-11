#!/usr/bin/env node
/**
 * CBP forced-labor merger (R7 #4/#5, 2026-06-11).
 *
 * Matches UFLPA Entity List + WRO/Findings producers against the catalog
 * (conservative exact-normalized matching — these are mostly upstream
 * foreign factories; a false positive here is a serious accusation).
 *
 * On match: sets the `forcedLaborListed` structural sidecar (list, dates,
 * source) and appends a factual labor narrative when the labor cell is
 * empty. The computeScore "forcedLabor" dealbreaker consults the sidecar
 * (App.jsx Build 56+).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const IN = path.join(ROOT, "public/data/cbp-forced-labor.json");
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

const { uflpa, wro } = JSON.parse(fs.readFileSync(IN, "utf8"));

// Reviewed aliases: enforcement names that ARE catalog brands under a
// different trade name. Add ONLY with documented ownership (a false
// forced-labor attribution is the worst error this app can make).
const REVIEWED_ALIASES = {
  "giant manufacturing": "giant-bicycles", // Giant Mfg Co. Ltd (TW) = Giant Bicycles parent; WRO eff. 9/24/2025
};
const exists = new Set(fs.readdirSync(COMPS).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));
const catalogByNorm = new Map();
for (const slug of exists) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(COMPS, `${slug}.json`), "utf8"));
    const n = normalizeCompanyName(d.name || slug);
    if (n && !catalogByNorm.has(n)) catalogByNorm.set(n, slug);
  } catch {}
}

const hits = new Map(); // slug -> entries
const record = (name, entry) => {
  const norm = normalizeCompanyName(name);
  if (!norm || norm.length < 5) return;          // too-short names over-match
  const slug = catalogByNorm.get(norm) || REVIEWED_ALIASES[norm];
  if (!slug) return;
  if (!hits.has(slug)) hits.set(slug, []);
  hits.get(slug).push(entry);
};
for (const e of uflpa) {
  record(e.name, { list: "UFLPA Entity List", entity: e.name, date: e.listedDate });
  for (const a of e.aliases || []) record(a, { list: "UFLPA Entity List", entity: e.name, date: e.listedDate });
}
for (const w of wro) {
  record(w.entity, { list: `CBP ${/finding/i.test(w.status || "") ? "Finding" : "Withhold Release Order"}`, entity: w.entity, date: w.effectiveDate, country: w.country, status: w.status });
}

let matched = 0;
for (const [slug, entries] of hits) {
  const fp = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  matched++;
  d.forcedLaborListed = {
    entries,
    source: "CBP/DHS forced-labor enforcement (19 U.S.C. §1307)",
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
  const narr = String(d.labor?.s || "");
  const line = entries.map(e => `${e.list} (${e.date || "active"})`).join("; ");
  if (!narr || NO_REC_RE.test(narr)) {
    d.labor = d.labor || {};
    d.labor.s = `Named in US forced-labor enforcement: ${line} — imports subject to detention under 19 U.S.C. §1307.`;
    d.labor.sources = Array.from(new Set([...(d.labor.sources || []), "cbp-forced-labor"]));
    d.sc = d.sc || {};
    if (["", "neutral", "unknown"].includes(String(d.sc.labor || "").toLowerCase())) d.sc.labor = "very poor";
  }
  fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  console.log(`[cbp-merge] ${slug}: ${line}`);
}
console.log(`[cbp-merge] matched ${matched} catalog brands (UFLPA ${uflpa.length} + WRO ${wro.length} source entities)`);
