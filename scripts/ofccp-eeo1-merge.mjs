#!/usr/bin/env node
/**
 * OFCCP EEO-1 merger (R7 #1, 2026-06-11).
 *
 * Routes per-company EEO-1 workforce demographics (data/derived/
 * ofccp-eeo1-companies.json) onto catalog brands via the standard chain
 * (direct slug → alias → normalized → parent map).
 *
 * NEUTRALITY: writes the `dei_eeo1` evidence sidecar + a factual dei
 * narrative ONLY where the dei cell is empty. Never sets a pro_dei/anti_dei
 * enum — workforce composition is a fact the user interprets through their
 * own quiz stance, not a verdict the app renders. The narrative gives the
 * DEI cell a real public record (display + AI-bake context), nothing more.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const IN = path.join(ROOT, "data/derived/ofccp-eeo1-companies.json");
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

const { companies } = JSON.parse(fs.readFileSync(IN, "utf8"));
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/slug-aliases.json"), "utf8"));
const parentMap = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8"));
const exists = new Set(fs.readdirSync(COMPS).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));

// Build catalog lookup: normalized catalog name -> slug
const catalogByNorm = new Map();
for (const slug of exists) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(COMPS, `${slug}.json`), "utf8"));
    const n = normalizeCompanyName(d.name || slug);
    if (n && !catalogByNorm.has(n)) catalogByNorm.set(n, slug);
    if (d.legalName) {
      const ln = normalizeCompanyName(d.legalName);
      if (ln && !catalogByNorm.has(ln)) catalogByNorm.set(ln, slug);
    }
  } catch {}
}

let matched = 0, narrated = 0, sidecarOnly = 0, orphans = 0;
for (const [norm, rec] of Object.entries(companies)) {
  let slug = catalogByNorm.get(norm) || null;
  if (!slug) {
    const s = toSlug(rec.coname);
    if (exists.has(s)) slug = s;
    else if (aliases[s] && exists.has(aliases[s])) slug = aliases[s];
    else if (parentMap[s] && exists.has(parentMap[s])) slug = parentMap[s];
  }
  if (!slug) { orphans++; continue; }

  const fp = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  matched++;

  d.dei_eeo1 = {
    year: rec.year,
    totalEmployees: rec.total,
    pctWomen: rec.pctWomen,
    pctMinority: rec.pctMinority,
    ...(rec.pctWomenMgmt != null ? { pctWomenMgmt: rec.pctWomenMgmt, pctMinorityMgmt: rec.pctMinorityMgmt } : {}),
    source: "DOL OFCCP FOIA — Type 2 EEO-1",
    sourceUrl: "https://www.dol.gov/agencies/ofccp/foia/library/Employment-Information-Reports",
  };

  const narr = String(d.dei?.s || "");
  if (!narr || NO_REC_RE.test(narr)) {
    d.dei = d.dei || {};
    d.dei.s = `EEO-1 workforce demographics on federal record (FY${rec.year}, DOL OFCCP FOIA release): ${rec.total.toLocaleString()} US employees — ${rec.pctWomen}% women, ${rec.pctMinority}% racial/ethnic minorities${rec.pctWomenMgmt != null ? `; management ${rec.pctWomenMgmt}% women, ${rec.pctMinorityMgmt}% minorities` : ""}.`;
    d.dei.sources = Array.from(new Set([...(d.dei.sources || []), "ofccp-eeo1"]));
    narrated++;
  } else {
    sidecarOnly++;
  }
  fs.writeFileSync(fp, JSON.stringify(d, null, 2));
}

console.log(`[ofccp-merge] matched ${matched} brands · dei narratives written ${narrated} · sidecar-only ${sidecarOnly} · orphans ${orphans}`);
