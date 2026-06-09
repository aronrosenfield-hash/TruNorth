#!/usr/bin/env node
/**
 * Rebake all 11,260 company base scores using corrected, flag-aware math.
 *
 * Why this exists (Aron's morning Build 53 review, 2026-06-09):
 *   The pre-rebake grade distribution was broken — 91.8% C, 8.2% D, 0% A/B/F.
 *   Root cause: many companies had AI-baked sc.* enums (pro_dei, cruelty_free,
 *   right, etc.) that didn't match the underlying narrative ("No public record
 *   found"). The scoring engine correctly excluded these orphan labels via
 *   string-matching, but the UI still rendered the positive badges, creating
 *   "Pro-DEI + Grade A on a right-donating company" contradictions.
 *
 *   Concrete cases traced before this script:
 *     - Wendy's: sc.dei=pro_dei but detail says "no record" → silently
 *       excluded from math, but UI showed Pro-DEI badge. Same for env/privacy.
 *     - Trader Joe's: every sc.* category was either neutral, na, or had
 *       a "no public record" narrative. weightUsed=0 fell back to co.overall
 *       (50, C). User's quiz weighting of animals (cruelty_free) literally
 *       could not affect the grade.
 *
 * What this script does:
 *   1. Walk every public/data/companies/*.json.
 *   2. For each category, check detail[cat].s. If it says "No public record
 *      found." then force sc[cat] = "neutral" (was pro_dei / cruelty_free /
 *      right etc.) — kills the UI-vs-math contradiction at the source.
 *   3. Recompute co.overall using a non-personalized version of the scoring
 *      engine that EXCLUDES neutral/na/notDisclosed and a "no public record"
 *      narrative; uniform weights across categories that contribute.
 *   4. If fewer than 2 categories have real signal → set co.overall = null
 *      and the grade becomes "?" (insufficient data) instead of a misleading C.
 *      The bundle index entry shape supports null overall (computeScore in
 *      App.jsx falls back to grade "?" via scoreGrade when overall is null).
 *   5. Write each updated company file in place.
 *   6. Print before/after distribution + Wendy's + Trader Joe's traces.
 *
 * Reversibility: this overwrites sc.* and overall. Run a git diff before
 * committing to make sure nothing went sideways. Safe to re-run; idempotent.
 *
 * Doesn't touch: flags.* (handled by reflag-categories.mjs), per-category
 * detail strings, competitors, news, etc.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");

// Categories the scoring engine cares about. NOTE: transparency is not in
// CAT_KEYS in App.jsx — it's a display-only badge — so we omit it here too.
const CAT_KEYS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay", "health"];

const NO_RECORD = /^\s*no public record found\.?\s*$/i;

// Narrative-keyword scoring (Build 55 — salvage signals from text records
// where the enum was baked as neutral but the detail.s actually contains
// substantive content). Wendy's case: detail.s says "environmental violation:
// $8K in federal penalties" but sc.environment="neutral" → was excluded under
// the strict enum-only rebake. With this, "violation/penalty" → negative.
//
// Keywords chosen conservatively. False positives are biased toward neutral
// (50) rather than wrong-polarity, so "complaint dismissed" doesn't get
// negative-scored just because "complaint" appears.
const NEG_KEYWORDS = /\b(violation|violator|penalty|penalties|penalized|fined|breach|breaches|lawsuit|sued|settlement|recall|recalled|citation|cited|enforcement action|sanctioned|convicted|conviction|class action|consent decree|antitrust|monopoly|deceptive|fraudulent|fraud|negligence|misleading|forced labor|child labor|sweatshop|exploitation|harassment|discrimination|wrongful)\b/i;
const POS_KEYWORDS = /\b(certified|certification|b ?corp|fair ?trade|leaping bunny|cruelty-?free|award|awarded|net ?zero|carbon ?neutral|donated|donation|philanthropic|pledge|pledged|signatory|1% for the planet|transparent|transparency report|gold standard|gri reporting|union recognition)\b/i;

function narrativeScore(text) {
  if (!text || NO_RECORD.test(text)) return null;
  const neg = NEG_KEYWORDS.test(text);
  const pos = POS_KEYWORDS.test(text);
  if (neg && !pos) return 22; // clear negative signal
  if (pos && !neg) return 78; // clear positive signal
  if (neg && pos)  return 50; // mixed
  // Narrative present but no scoring keywords found — treat as mild signal at 50.
  // This is conservative: companies with neutral-toned narratives stay near
  // the median rather than disappearing entirely.
  return 50;
}

/** Non-personalized score for a category. Returns null when no signal. */
function baseScoreCat(k, v) {
  const val = String(v || "").toLowerCase();
  if (!val || val === "neutral" || val === "na" || val === "n/a" || val === "unknown") return null;

  // Build 55 (Aron's Excel-rebuild 2026-06-09): values aligned with
  // docs/scoring-calculator.xlsx → scoreCat sheet at user-stance "neutral".
  if (k === "political") {
    if (["bipartisan", "mixed"].includes(val)) return 80;
    if (["left", "left-leaning", "right", "right-leaning"].includes(val)) return 50;
    return null;
  }
  if (k === "dei") {
    // Preference axis; non-personalized = neutral baseline.
    if (["pro_dei", "anti_dei", "mixed"].includes(val)) return 50;
    return null;
  }
  if (k === "animals") {
    if (["cruelty_free", "some_testing", "tests_animals"].includes(val)) return 50;
    return null;
  }
  if (k === "guns") {
    if (["no_guns", "sells_guns", "makes_guns"].includes(val)) return 50;
    return null;
  }
  if (k === "labor") {
    if (["positive", "excellent", "strong", "good"].includes(val)) return 97;
    if (val === "mixed") return 50;
    if (["negative", "poor", "below average"].includes(val)) return 35;
    if (val === "very poor") return 8;
    return null;
  }
  if (k === "privacy") {
    if (val === "good") return 97;
    if (val === "mixed") return 50;
    if (val === "poor") return 8;
    return null;
  }
  if (k === "execPay") {
    if (["fair", "good"].includes(val)) return 97;
    if (val === "mixed") return 50;
    if (val === "poor") return 8;
    return null;
  }
  if (k === "health") {
    if (["good", "positive"].includes(val)) return 100;
    if (val === "mixed") return 50;
    if (["poor", "negative"].includes(val)) return 8;
    return null;
  }
  if (k === "environment") {
    if (["positive", "excellent", "strong", "good"].includes(val)) return 100;
    if (val === "mixed") return 50;
    if (["negative", "poor", "below average", "very poor"].includes(val)) return 8;
    return null;
  }
  // charity (and fallback)
  if (["positive", "excellent", "strong", "good"].includes(val)) return 97;
  if (val === "mixed") return 50;
  if (["negative", "poor", "below average", "very poor"].includes(val)) return 8;
  return null;
}

function classifyCategory(d, k) {
  const sc = d.sc || {};
  const detail = d[k] || {};
  const flags = (d.flags || {})[k] || {};
  const val = String(sc[k] || "").toLowerCase();
  const narrative = String(detail.s || "");
  const hasNarrative = narrative && !NO_RECORD.test(narrative);
  const narrativeIsNoRecord = narrative && NO_RECORD.test(narrative);

  if (flags.na === true || val === "na" || val === "n/a") return { state: "na" };
  if (flags.notDisclosed === true && !hasNarrative) return { state: "notDisclosed" };

  // KEY FIX: If the narrative explicitly says "No public record found.", we
  // treat it as notDisclosed regardless of what the enum says. Catches BOTH
  // Wendy's (enum=pro_dei + no-record → orphan label, exclude) AND Trader
  // Joe's (enum=cruelty_free + no-record → orphan label, exclude). The OLD
  // engine had this same exclusion via string-match but only when enum WAS
  // neutral; we extend it to all enum values.
  if (narrativeIsNoRecord) return { state: "notDisclosed" };

  // Enum is neutral but narrative is real → narrative-only signal. Salvage it.
  if ((!val || val === "neutral" || val === "unknown") && hasNarrative) {
    return { state: "narrativeOnly", narrative };
  }
  if (!val || val === "neutral" || val === "unknown") return { state: "neutral" };
  if (flags._inferred === true) return { state: "inferred", value: val };
  return { state: "real", value: val };
}

const files = fs.readdirSync(COMPS).filter(f => f.endsWith(".json"));
console.log(`[rebake] processing ${files.length} companies`);

let updated = 0;
const distOld = {}, distNew = {};
const realCountDist = {};
let nullOveralls = 0;
const wendySlug = "wendy-s";
const tjSlug = "trader-joe-s";
const traces = { [wendySlug]: null, [tjSlug]: null };

function gradeFromOverall(n, realCats) {
  // Build 57 (S2 + signal-count cap):
  //   - A requires score ≥65 AND ≥3 contributing signals
  //   - B requires score ≥55 AND ≥2 contributing signals
  //   - Single-signal brands max out at C regardless of score (S-56 cap)
  // Thresholds lowered from 70/60 to 65/55 so the 3+ signal cohort can
  // earn honest A/B at a realistic rate. Must stay in sync with
  // src/App.jsx scoreGrade and scripts/finalize-bundle.mjs scoreGrade.
  if (n == null) return "?";
  let g;
  if (n >= 65) g = "A";
  else if (n >= 55) g = "B";
  else if (n >= 45) g = "C";
  else if (n >= 30) g = "D";
  else g = "F";
  if (typeof realCats === "number") {
    if (realCats < 2 && (g === "A" || g === "B")) g = "C";
    else if (realCats < 3 && g === "A") g = "B";
  }
  return g;
}

for (const f of files) {
  const filePath = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }
  const slug = d.slug || f.replace(/\.json$/, "");

  const sc = { ...(d.sc || {}) };
  const trace = { slug, name: d.name, oldOverall: d.overall, oldGrade: gradeFromOverall(d.overall, d.realCats), categories: [], realCount: 0, weightedSum: 0, weightUsed: 0 };

  // Pass 1: align sc.* with detail.* (zero out orphan labels)
  for (const k of CAT_KEYS) {
    const cls = classifyCategory(d, k);
    if (cls.state === "notDisclosed" && sc[k] && sc[k] !== "neutral" && sc[k] !== "na") {
      // Orphan label — kill it so UI + math agree.
      sc[k] = "neutral";
    }
  }
  d.sc = sc;

  // Pass 2: compute new overall over real + inferred + narrative-only categories
  let signalCount = 0;
  for (const k of CAT_KEYS) {
    const cls = classifyCategory(d, k);
    if (cls.state === "real") {
      const cs = baseScoreCat(k, sc[k]);
      if (cs == null) continue;
      trace.weightedSum += cs * 1.0;
      trace.weightUsed += 1.0;
      trace.categories.push({ k, state: "real", val: sc[k], score: cs, weight: 1.0 });
      signalCount++;
    } else if (cls.state === "inferred") {
      const cs = baseScoreCat(k, sc[k]);
      if (cs == null) continue;
      trace.weightedSum += cs * 0.5;
      trace.weightUsed += 0.5;
      trace.categories.push({ k, state: "inferred", val: sc[k], score: cs, weight: 0.5 });
      signalCount++;
    } else if (cls.state === "narrativeOnly") {
      // Salvage: text record present but enum was set to neutral. Score from
      // keywords in the narrative. Weight at 0.75 — more than inferred (which
      // is sector-based guessing) but less than real (which has both enum +
      // narrative agreeing).
      const cs = narrativeScore(cls.narrative);
      if (cs == null) continue;
      trace.weightedSum += cs * 0.75;
      trace.weightUsed += 0.75;
      trace.categories.push({ k, state: "narrative", val: "(neutral enum + text)", score: cs, weight: 0.75, snippet: cls.narrative.slice(0, 80) });
      signalCount++;
    } else {
      trace.categories.push({ k, state: cls.state, val: sc[k] });
    }
  }
  trace.realCount = signalCount;
  realCountDist[signalCount] = (realCountDist[signalCount] || 0) + 1;

  // Minimum data threshold: require >= 1 contributing signal (real/inferred/
  // narrative) for a numeric grade. Companies with 0 signals get overall=null
  // → grade "?". Lowered from 2-real to 1-any after Aron's call: salvage
  // narrative-only signals to expand graded coverage.
  const newOverall = (signalCount >= 1 && trace.weightUsed > 0)
    ? Math.round((trace.weightedSum / trace.weightUsed) * 10) / 10
    : null;
  trace.newOverall = newOverall;
  trace.newGrade = gradeFromOverall(newOverall, signalCount);

  const oldG = trace.oldGrade;
  const newG = trace.newGrade;
  distOld[oldG] = (distOld[oldG] || 0) + 1;
  distNew[newG] = (distNew[newG] || 0) + 1;
  if (newOverall == null) nullOveralls++;

  // Capture trace for the two example brands.
  if (slug === wendySlug || slug === tjSlug) traces[slug] = trace;

  // Persist realCats so the UI + index can apply the signal-count cap.
  if (d.overall !== newOverall || d.realCats !== signalCount || JSON.stringify(d.sc) !== JSON.stringify(sc)) {
    d.overall = newOverall;
    d.realCats = signalCount;
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
    updated++;
  }
}

console.log(`[rebake] updated ${updated} files. ${nullOveralls} companies have null overall (insufficient data).`);
console.log("");
console.log("=== Real-signal-count distribution ===");
for (const k of Object.keys(realCountDist).sort((a, b) => Number(a) - Number(b))) {
  const n = realCountDist[k];
  const pct = (n / files.length * 100).toFixed(1);
  console.log(`  ${k} real cats: ${String(n).padStart(6)} (${pct}%)`);
}
console.log("");
console.log("=== Grade distribution BEFORE → AFTER ===");
for (const g of ["A", "B", "C", "D", "F", "?"]) {
  const o = distOld[g] || 0;
  const n = distNew[g] || 0;
  console.log(`  ${g}: ${String(o).padStart(6)} → ${String(n).padStart(6)} (${(n / files.length * 100).toFixed(1)}%)`);
}

function printTrace(name, t) {
  if (!t) return;
  console.log(`\n=== ${name} (${t.slug}) ===`);
  console.log(`  Before: overall=${t.oldOverall} (grade ${t.oldGrade})`);
  console.log(`  After:  overall=${t.newOverall} (grade ${t.newGrade})`);
  console.log(`  Real signals: ${t.realCount}`);
  console.log(`  Per-category contribution:`);
  for (const c of t.categories) {
    const tag = c.score != null
      ? `${c.state.padEnd(13)} val=${(c.val || "-").padEnd(14)} score=${c.score} weight=${c.weight}`
      : `${c.state.padEnd(13)} val=${(c.val || "-")}`;
    console.log(`    ${c.k.padEnd(12)} ${tag}`);
  }
}
printTrace("Wendy's", traces[wendySlug]);
printTrace("Trader Joe's", traces[tjSlug]);
