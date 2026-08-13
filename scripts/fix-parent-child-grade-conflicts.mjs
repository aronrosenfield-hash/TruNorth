#!/usr/bin/env node
/**
 * fix-parent-child-grade-conflicts.mjs — stop publishing contradictory grades
 * for the same corporate family (C-5).
 *
 * WHY (found 2026-08-10): a user searching one company can get opposite answers
 * depending on which row they land on — Amazon=C but Amazon Go=F, CVS Health=F
 * but CVS Pharmacy=C, Dollar General=C but Dollar General Market=F, American
 * Airlines=C but American Airlines Shuttle=F. Of 550 sub-brands graded beside a
 * graded parent, 120 (22%) disagree and 28 disagree by 2+ letter grades. That
 * reads as "this app is wrong", which is worse than "this app doesn't know".
 *
 * NOT every disagreement is a bug. Ben & Jerry's (A) genuinely differs from
 * Unilever (C); Patagonia, Prana, Toms and Caribou Coffee all hold their own,
 * richer records. Those are the product working correctly and MUST be preserved.
 *
 * RULE — suppress only the artifact class: the child disagrees with its parent
 * by 2+ letter grades AND rests on STRICTLY FEWER scored categories. That is a
 * thin slice of the same business producing a louder verdict than the business
 * itself. Its grade is removed (overall -> null, i.e. "?"), never inverted or
 * silently replaced with the parent's. Thanks to V-1 alias search, typing the
 * sub-brand still surfaces the parent's record.
 *
 * Usage:
 *   node scripts/fix-parent-child-grade-conflicts.mjs           # DRY RUN
 *   node scripts/fix-parent-child-grade-conflicts.mjs --apply
 */
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const DATA = path.join(process.cwd(), "public/data");
const COMPS = path.join(DATA, "companies");

const map = JSON.parse(fs.readFileSync(path.join(DATA, "_meta/brand-parent-map.json"), "utf8"));
const rows = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
const list = Array.isArray(rows) ? rows : rows.companies;

const GV = { A: 5, B: 4, C: 3, D: 2, F: 1 };
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const bySlug = new Map(list.map((c) => [String(c.slug || c.id || "").toLowerCase(), c]));
const byNorm = new Map();
for (const c of list) { const k = norm(c.name); if (!byNorm.has(k)) byNorm.set(k, c); }
const load = (slug) => {
  const p = path.join(COMPS, `${slug}.json`);
  try { return { p, d: JSON.parse(fs.readFileSync(p, "utf8")) }; } catch { return null; }
};

const suppress = [], kept = [];
for (const [alias, info] of Object.entries(map)) {
  const kid = bySlug.get(alias.toLowerCase()) || byNorm.get(norm(alias));
  const par = bySlug.get(String(info.parent || "").toLowerCase()) || byNorm.get(norm(info.parent));
  if (!kid || !par) continue;
  if (!GV[kid.grade] || !GV[par.grade]) continue;
  if (Math.abs(GV[kid.grade] - GV[par.grade]) < 2) continue;

  const kf = load(kid.slug || kid.id), pf = load(par.slug || par.id);
  if (!kf || !pf) continue;
  const kn = Object.keys(kf.d.csc || {}).length;
  const pn = Object.keys(pf.d.csc || {}).length;

  if (kn < pn) {
    suppress.push({ kid, par, kn, pn, file: kf });
  } else {
    kept.push(`${kid.name}=${kid.grade} (${kn} cats) vs ${par.name}=${par.grade} (${pn}) — child's own record is as deep or deeper`);
  }
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"} — C-5 parent/child grade conflicts\n`);
console.log(`SUPPRESSED (thin child contradicting its parent by 2+ grades): ${suppress.length}`);
for (const s of suppress) {
  console.log(`   ${s.kid.name}=${s.kid.grade} (${s.kn} cats)  ->  "?"      [parent ${s.par.name}=${s.par.grade}, ${s.pn} cats]`);
  if (APPLY) {
    s.file.d.overall = null;
    s.file.d._gradeSuppressed = {
      reason: "parent-child-conflict",
      parent: s.par.slug || s.par.id,
      note: "Thin sub-brand record contradicted its parent company by 2+ letter grades; see C-5.",
    };
    fs.writeFileSync(s.file.p, JSON.stringify(s.file.d, null, 2));
  }
}
console.log(`\nPRESERVED (legitimate divergence — child has its own equal/richer record): ${kept.length}`);
kept.forEach((k) => console.log("   " + k));
if (!APPLY) console.log("\nRe-run with --apply, then re-run rebake + finalize.");
