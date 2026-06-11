#!/usr/bin/env node
/**
 * Lever 2 residuals (2026-06-11) — guns factual fills for merchants.
 *
 * For industries where the firearms question APPLIES (Retail, Grocery,
 * Sports & Outdoor — per category-applicability.json after the Lever 2 map
 * change), convert empty guns cells into factual answers:
 *
 *   - ATF FFL evidence on file (firearms_atf_ffl.licenseCount > 0):
 *       primaryRole "manufacturer" → sc.guns = "makes_guns"
 *       otherwise                  → sc.guns = "sells_guns"
 *   - No FFL on record → sc.guns = "no_guns" with an ATF-registry narrative.
 *     Defensible: the FFL registry is a complete public record of licensed
 *     firearms dealers/manufacturers/importers — absence for a merchant is a
 *     factual "no licensed firearms dealing."
 *
 * Deliberately EXCLUDES Defense & Aerospace: a defense contractor without a
 * retail FFL still makes weapons systems — autofilling "no_guns" there would
 * be wrong. Those stay evidence/AI-driven.
 *
 * Never overwrites a real existing enum (sells_guns/makes_guns/no_guns/
 * makes_weapons/poor/etc.) or a real existing narrative. Idempotent.
 *
 * Scoring note (V3/R4): guns is a stance category — these fills do NOT touch
 * un-quizzed grades. They matter for quiz users with a firearms stance and
 * for the badge row ("Does Not Sell Firearms" becomes a real answer instead
 * of a dimmed unknown).
 *
 * Run AFTER reflag-categories.mjs (needs the na flags already cleared) and
 * BEFORE rebake-scoring.mjs + finalize-bundle.mjs.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");

const FILL_CATS = new Set(["Retail", "Grocery", "Sports & Outdoor"]);
const EMPTY_VALS = new Set(["", "neutral", "unknown", "na", "n/a", "?"]);
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

const NO_GUNS_NARRATIVE =
  "No federal firearms license on record for this company in the ATF FFL registry — no licensed firearms dealing or manufacturing.";

const files = fs.readdirSync(COMPS).filter((f) => f.endsWith(".json"));
let noGuns = 0, sells = 0, makes = 0, skippedReal = 0;

for (const f of files) {
  const fp = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  if (!FILL_CATS.has(d.cat)) continue;
  if (d.flags?.guns?.na === true) continue; // per-slug override forced NA

  const cur = String(d.sc?.guns || "").toLowerCase();
  const curNarr = String(d.guns?.s || "");
  const hasRealEnum = !EMPTY_VALS.has(cur);
  const hasRealNarr = curNarr && !NO_REC_RE.test(curNarr);
  const ffl = d.firearms_atf_ffl;
  const hasFfl = ffl && Number(ffl.licenseCount) > 0;

  if (hasFfl) {
    // Evidence wins. Only set the enum if it's currently empty — never
    // overwrite an AI/manual verdict like makes_weapons.
    if (!hasRealEnum) {
      d.sc = d.sc || {};
      d.sc.guns = ffl.primaryRole === "manufacturer" ? "makes_guns" : "sells_guns";
      if (!hasRealNarr) {
        d.guns = d.guns || {};
        d.guns.s = `Holds ${ffl.licenseCount} active federal firearms license${ffl.licenseCount > 1 ? "s" : ""} (ATF FFL registry${ffl.primaryRole ? `, ${ffl.primaryRole}` : ""}).`;
        d.guns.sources = Array.from(new Set([...(d.guns.sources || []), "atf-ffl"]));
      }
      if (d.sc.guns === "makes_guns") makes++; else sells++;
      fs.writeFileSync(fp, JSON.stringify(d, null, 2));
    } else {
      skippedReal++;
    }
    continue;
  }

  if (hasRealEnum || hasRealNarr) { skippedReal++; continue; }

  d.sc = d.sc || {};
  d.sc.guns = "no_guns";
  d.guns = d.guns || {};
  d.guns.s = NO_GUNS_NARRATIVE;
  d.guns.sources = Array.from(new Set([...(d.guns.sources || []), "atf-ffl"]));
  noGuns++;
  fs.writeFileSync(fp, JSON.stringify(d, null, 2));
}

console.log(`[lever2] no_guns fills: ${noGuns} · sells_guns: ${sells} · makes_guns: ${makes} · skipped (real data present): ${skippedReal}`);
