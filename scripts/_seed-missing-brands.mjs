#!/usr/bin/env node
/**
 * _seed-missing-brands.mjs — close 4 blue-chip coverage gaps before launch.
 *
 * LEGO, Nintendo, Puma (sportswear), and Hobby Lobby were absent from the
 * catalog: all are foreign or private, so none file with SEC EDGAR (the
 * catalog's spine). The only related entries are distinct other entities —
 * legoland-* theme parks, nintendo-stores/-software subsidiaries, and
 * puma-biotechnology (a US pharma name-collision). See the
 * missing-top-brands-diagnosis memo.
 *
 * Their US-subsidiary public records DO exist in our source files (CPSC
 * recalls, OSHA, lawsuits, SEC litigation, …) — every source slugs them
 * consistently as lego / nintendo / puma / hobby-lobby. resolveSlug() in the
 * merge scripts hits a DIRECT match the moment companies/<slug>.json exists,
 * so creating these four files lets the existing local merges attach their
 * real records on the next run; rebake-scoring then grades them from that
 * real evidence (no fabrication).
 *
 * Puma note: the source "puma" records are currently ORPHANED (no companies/
 * puma.json), NOT mis-attached to puma-biotechnology (a different slug). So
 * the sportswear brand takes the clean `puma` slug with zero collision.
 *
 * PURE ADDITIVE — refuses to touch a slug that already has a file. Run once:
 *   node scripts/_seed-missing-brands.mjs            # dry-run (default)
 *   node scripts/_seed-missing-brands.mjs --apply
 * Then run the merges + rebake-scoring + finalize-bundle to attach + grade.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMP_DIR = path.join(ROOT, "public", "data", "companies");
const APPLY = process.argv.includes("--apply");
const today = new Date().toISOString().slice(0, 10);

const CATEGORIES = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay"];
const initials = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "XX";

function placeholder({ name, cat, isPublic }) {
  const sc = Object.fromEntries(CATEGORIES.map((k) => [k, "neutral"]));
  const narr = (sources = ["Public records research"]) => ({ s: "No public record found.", sources });
  return {
    name, cat, init: initials(name), overall: 50, isPublic, sc,
    political: narr(), charity: narr(), environment: narr(), labor: narr(),
    dei: narr(), animals: narr([]), guns: narr([]), privacy: narr([]), execPay: narr(),
    ab: "#0d2318", ac: "#4caf82", competitors: [], dataLastUpdated: today,
  };
}

// slug MUST equal the slug the source records already use (verified: every
// source slugs these brands exactly this way), so resolveSlug() routes "direct".
const BRANDS = [
  { slug: "lego",        name: "LEGO",        cat: "Consumer Goods",      isPublic: false }, // Danish, family-owned (KIRKBI)
  { slug: "nintendo",    name: "Nintendo",    cat: "Entertainment & Media", isPublic: true }, // JP-listed (TSE 7974 / NTDOY)
  { slug: "puma",        name: "Puma",        cat: "Apparel & Fashion",   isPublic: true },  // DE-listed (ETR: PUM)
  { slug: "hobby-lobby", name: "Hobby Lobby", cat: "Retail",              isPublic: false }, // US private (Green family)
];

let created = 0, skipped = 0;
for (const b of BRANDS) {
  const file = path.join(COMP_DIR, `${b.slug}.json`);
  if (fs.existsSync(file)) { console.log(`• skip ${b.slug} — already exists`); skipped++; continue; }
  const rec = { ...placeholder(b), slug: b.slug };
  console.log(`+ create ${b.slug}.json — "${b.name}" (${b.cat}, isPublic=${b.isPublic})`);
  if (APPLY) fs.writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
  created++;
}
console.log(`\n${APPLY ? "WROTE" : "DRY-RUN"} — ${created} to create, ${skipped} skipped.`);
if (!APPLY) console.log("(pass --apply to write, then run merges + rebake-scoring + finalize-bundle)");
