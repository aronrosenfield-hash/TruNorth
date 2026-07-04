#!/usr/bin/env node
// dedup-brands.mjs — merge duplicate company entries that describe the SAME
// firm but carry contradictory grades (the "Exxon is a D and a B" credibility
// bug found in the 2026-07-02 diligence review).
//
// CURATED, hand-verified merges only (the immediate fix covers the 2 divergent
// groups + the "exxon" brand variant). Canonical = the best-evidenced entry
// (most realCats). Losers are: removed from the company/ dir, aliased to the
// canonical in slug-aliases.json (so old deep-links + search resolve), and the
// bundle index is rebuilt so they vanish from index.json + search-index.json.
//
// Usage:  node scripts/dedup-brands.mjs          (dry run — prints the plan)
//         node scripts/dedup-brands.mjs --apply   (delete files + write aliases)
// After --apply, run:  node scripts/finalize-bundle.mjs   (repack index.json AND
// search-index.json — rebuild-bundle-index.mjs alone leaves search stale).
//
// The broader same-name (non-divergent) sweep is a separate this-week task.

import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const CO_DIR = "public/data/companies";
const ALIAS_PATH = "public/data/_meta/slug-aliases.json";

// canonical ← [losers].  name = corrected display name for the canonical.
const MERGES = [
  // ExxonMobil: the F/D/B triplicate + the ungraded division entities that
  // cluttered the "Exxon" search under the real ExxonMobil (Aron flagged, 2026-
  // 07-04). All are ExxonMobil (realCats=0, no scoreable data) → alias to parent.
  { canonical: "exxon-mobil", losers: ["exxon", "exxonmobil",
    "exxonmobil-fuels-and-lubricants-company",
    "exxonmobil-fuels-lubricants-and-specialties-marketing-company",
    "exxonmobil-refining-and-supply-company"], name: "ExxonMobil" },
  { canonical: "southern-copper-corp", losers: ["southern-copper"], name: "Southern Copper" },
];

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const coPath = (slug) => path.join(CO_DIR, `${slug}.json`);

let aliases = {};
try { aliases = readJSON(ALIAS_PATH); } catch { aliases = {}; }

const plan = [];
for (const m of MERGES) {
  const canonFile = coPath(m.canonical);
  if (!fs.existsSync(canonFile)) { console.error(`✗ canonical missing: ${m.canonical}`); process.exit(1); }
  const canon = readJSON(canonFile);
  const canonGrade = canon.overall != null ? canon.grade || "(baked)" : "?";
  const loserInfo = m.losers.map((s) => {
    const p = coPath(s);
    if (!fs.existsSync(p)) return { slug: s, missing: true };
    const c = readJSON(p);
    return { slug: s, name: c.name, grade: c.grade, overall: c.overall, realCats: c.realCats };
  });
  plan.push({ m, canon: { slug: m.canonical, name: canon.name, newName: m.name, overall: canon.overall, realCats: canon.realCats }, losers: loserInfo });
}

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — ${MERGES.length} curated merges:\n`);
for (const p of plan) {
  console.log(`● canonical: ${p.canon.slug}  overall=${p.canon.overall} rc=${p.canon.realCats}  name "${p.canon.name}" → "${p.canon.newName}"`);
  for (const l of p.losers) {
    console.log(`    merge ${l.slug.padEnd(22)} ${l.missing ? "(file missing — alias only)" : `"${l.name}" grade=${l.grade} overall=${l.overall} rc=${l.realCats}`}  →  ${p.canon.slug}`);
  }
}

if (!APPLY) { console.log("\n(dry run — re-run with --apply to execute)"); process.exit(0); }

// Apply
let deleted = 0, aliased = 0, renamed = 0;
for (const m of MERGES) {
  // 1. fix canonical display name
  const canonFile = coPath(m.canonical);
  const canon = readJSON(canonFile);
  if (m.name && canon.name !== m.name) { canon.name = m.name; fs.writeFileSync(canonFile, JSON.stringify(canon)); renamed++; }
  // 2. per loser: alias → canonical, delete file
  for (const loser of m.losers) {
    aliases[loser] = m.canonical; aliased++;
    const lp = coPath(loser);
    if (fs.existsSync(lp)) { fs.unlinkSync(lp); deleted++; }
  }
}
// write aliases sorted for a stable diff
const sorted = Object.fromEntries(Object.entries(aliases).sort((a, b) => a[0].localeCompare(b[0])));
fs.writeFileSync(ALIAS_PATH, JSON.stringify(sorted, null, 2) + "\n");
console.log(`\n✓ applied: ${deleted} files deleted · ${aliased} aliases added · ${renamed} canonical names fixed`);
console.log("→ next: node scripts/finalize-bundle.mjs   (repack index.json + search-index.json)");
