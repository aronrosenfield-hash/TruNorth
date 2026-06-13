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

// R7.1 (2026-06-13): per-brand annual revenue (SEC XBRL, slug → {revenue,…})
// used to revenue-normalize penalty severity so big, heavily-scrutinized brands
// aren't auto-penalized by absolute-dollar fines. Built by sec-revenue-fetch.mjs.
// Absent / unresolved-CIK brands fall back to the absolute-dollar curve.
const REVENUE = (() => {
  try {
    const p = path.join(ROOT, "public/data/_meta/company-revenue.json");
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  } catch { return {}; }
})();

// Categories the scoring engine cares about. NOTE: transparency is not in
// CAT_KEYS in App.jsx — it's a display-only badge — so we omit it here too.
const CAT_KEYS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay", "health"];

const NO_RECORD = /^\s*no public record found\.?\s*$/i;

// Pass --dry to compute + print the distribution without writing any files.
const DRY = process.argv.includes("--dry");

// ─── SCORING V3 (2026-06-11, grade-dispersion overhaul) ─────────────────────
// Four changes vs Build 57:
//   R1 Shrinkage: overall = (W·raw + K·50)/(W+K), W = evidence weight used,
//      K = 1.5. Replaces the realCats grade cliff (A needs ≥3 sig, etc.) with
//      a continuous evidence-confidence slope — same estimator family as
//      IMDb's weighted rating. Grades start neutral; every verified record
//      moves them.
//   R2 Thresholds recalibrated once from the post-V3 score distribution to a
//      target shape (~A10/B25/C35/D20/F10), then FROZEN. See gradeFromOverall.
//   R3 Severity-continuous category scores: execPay from the actual SEC
//      pay ratio, labor/environment negatives from penalty dollars, charity
//      from IRS-990 grant totals. ("Path B for every category.")
//   R4 Stance categories (dei / animals / guns) are EXCLUDED from the
//      un-quizzed neutral baseline — the app takes no position on contested
//      values; those axes only move grades after the user takes the quiz.
//      They still render as badges and still personalize.
const K_SHRINK = 1.5;
// E-10 (Aron, 2026-06-13): a single contributing category with a csc below this
// is a "severe" negative (≈ a $5M+ federal penalty on the 8–40 band) and is
// allowed to sink a thin-record brand below C. Above it, one moderate record
// floors at C — see the thin-record floor where newOverall is finalized.
const SEVERE_NEG = 20;

// Parse "$8.4M" / "$120,500" / "$95K" → dollars. 0 when nothing parseable.
function parseDollars(text) {
  const m = String(text || "").match(/\$([\d,]+(?:\.\d+)?)\s*([KMB])?/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const unit = (m[2] || "").toUpperCase();
  return n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
}

// Negative-band severity: log-scaled penalty dollars.
//   $10K→40 · $100K→32 · $1M→24 · $10M→16 · ≥$100M→8   (clamped 8–40)
// "very poor" enums cap at 18 so they can't out-score a documented "poor".
// No parseable $ → legacy band defaults (35 / 8) so nothing silently moves.
function negativeSeverityScore(narrative, enumVal, revenue) {
  const dollars = parseDollars(narrative);
  if (dollars >= 1000) {
    let sev;
    if (revenue && revenue > 0) {
      // R7.1 (2026-06-13): revenue-normalized severity — score the penalty as a
      // SHARE of annual revenue, not absolute dollars. A $10M fine is trivial
      // for a $700B company and existential for a $50M one; absolute dollars
      // treated them identically and bottomed out every mega-brand. Anchors:
      // ~0.01% of revenue → ~45 (trivial), ~10%+ → 8 (severe). Falls back to the
      // absolute curve when revenue is unknown (private / unresolved-CIK cos).
      const ratio = dollars / revenue;
      sev = Math.max(8, Math.min(47, -4.33 - 12.33 * Math.log10(ratio)));
    } else {
      sev = Math.max(8, Math.min(40, 40 - 8 * Math.log10(dollars / 10_000)));
    }
    return enumVal === "very poor" ? Math.min(sev, 18) : sev;
  }
  return enumVal === "very poor" ? 8 : 35;
}

// Actual CEO-to-median-worker pay ratio, preferring the structured DEF 14A
// crawl (payRatio.ratio) over the narrative "NNN:1" string.
function parsePayRatio(d) {
  const pr = d?.payRatio;
  if (pr && typeof pr.ratio === "number" && pr.ratio > 0) return pr.ratio;
  if (typeof pr === "number" && pr > 0) return pr;
  for (const s of [d?.execPay?.ratio, d?.execPay?.s]) {
    const m = String(s || "").replace(/,/g, "").match(/([\d.]+)\s*:\s*1/);
    if (m && parseFloat(m[1]) > 0) return parseFloat(m[1]);
  }
  return null;
}

// Piecewise-linear in log10(ratio) over published anchors:
//   ≤20:1→100 · 25→95 · 100→70 · 300→45 · 1000→15 · ≥3000→5
// The anchors keep the old enum bands honest (<50 was "fair", >300 "poor")
// while spreading brands inside each band by their disclosed number.
const PAY_ANCHORS = [[20, 100], [25, 95], [100, 70], [300, 45], [1000, 15], [3000, 5]];
function payRatioScore(ratio) {
  if (ratio <= PAY_ANCHORS[0][0]) return 100;
  const lr = Math.log10(ratio);
  for (let i = 1; i < PAY_ANCHORS.length; i++) {
    const [r1, s1] = PAY_ANCHORS[i - 1];
    const [r2, s2] = PAY_ANCHORS[i];
    if (ratio <= r2) {
      const t = (lr - Math.log10(r1)) / (Math.log10(r2) - Math.log10(r1));
      return s1 + t * (s2 - s1);
    }
  }
  return 5;
}

// Charity positive band spread by IRS-990 grant totals (log scale):
//   $10K→60 · $100K→68 · $1M→76 · $10M→84 · $100M→92 · ≥$1B→100
// Returns null when no structured grant data — caller falls back to 85
// (documented-but-unquantified giving).
function charityGivingScore(d, revenue) {
  const g = d?.charity_irs990?.totalGrants;
  if (typeof g !== "number" || g < 10_000) return null;
  if (revenue && revenue > 0) {
    // R7.1 (2026-06-13): score giving as a SHARE of revenue, not absolute
    // dollars — a $1B gift from a $600B company (0.17%) shouldn't outrank a
    // $35M gift that's a bigger slice of a smaller firm (review flag). Anchors:
    // ~0.1% of revenue → 70, ~1% → 90. Absolute-$ fallback when revenue unknown.
    const ratio = g / revenue;
    return Math.max(60, Math.min(100, 60 + 20 * Math.log10(ratio / 0.000316)));
  }
  return Math.max(60, Math.min(100, 60 + 8 * Math.log10(g / 10_000)));
}

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
  // V3: negative narratives scale by penalty $ when one is stated —
  // a $9K citation shouldn't score like a $100M consent decree.
  if (neg && !pos) {
    const dollars = parseDollars(text);
    if (dollars >= 1000) return Math.max(8, Math.min(40, 40 - 8 * Math.log10(dollars / 10_000)));
    return 22; // clear negative signal, magnitude unknown
  }
  if (pos && !neg) return 78; // clear positive signal
  if (neg && pos)  return 50; // mixed
  // Narrative present but no scoring keywords found — treat as mild signal at 50.
  // This is conservative: companies with neutral-toned narratives stay near
  // the median rather than disappearing entirely.
  return 50;
}

// ─── Political signal differentiation (B-58 / Path B) ────────────────────
// Parse $ amount + tilt from political.s narrative or political.fecData.
// Old scoring jammed ALL bipartisan brands at score 80 (the right peak of
// the bimodal cluster). This spreads them across 55-90 using donation size
// (log scale) + tilt distance from 50/50.
function parsePoliticalSignals(d) {
  const p = d?.political || {};
  let amount = 0, tiltAbs = null, hasData = false;
  // Prefer structured fecData if present
  if (p.fecData) {
    amount = Number(p.fecData.totalRaised) || 0;
    const rep = Number(p.fecData.repTotal) || 0;
    const dem = Number(p.fecData.demTotal) || 0;
    if (rep + dem > 0) {
      tiltAbs = Math.abs((rep / (rep + dem)) * 100 - 50); // 0 (balanced) to 50 (one-sided)
    }
    hasData = true;
  }
  // Fall back to narrative parsing
  const s = String(p.s || "");
  if (!hasData) {
    // Match "$XX K|M" patterns: "$166K", "$2.5M", "$1.2B"
    const m = s.match(/\$([\d.]+)\s*([KMB]?)/);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2] || "";
      amount = n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
    }
  }
  if (tiltAbs == null) {
    // "70% to Republican" / "42% to Democratic"
    const pctR = s.match(/(\d+)%\s+to\s+Republican/i);
    const pctD = s.match(/(\d+)%\s+to\s+Democratic/i);
    if (pctR || pctD) {
      const r = pctR ? +pctR[1] : (pctD ? 100 - +pctD[1] : 50);
      tiltAbs = Math.abs(r - 50);
    } else {
      // "+23 across X donors" / "+54 across Y donors" — partisan lean magnitude
      const lean = s.match(/\+(\d+)\s+across/i);
      if (lean) tiltAbs = Math.min(50, +lean[1]);
      else if (/partisan lean split/i.test(s)) tiltAbs = 5; // explicitly balanced
    }
  }
  // Defaults when nothing parseable
  if (amount === 0) amount = 100_000;          // "small unknown PAC"
  if (tiltAbs == null) tiltAbs = 15;            // mild assumption
  return { amount, tiltAbs };
}

function politicalScore(d, val) {
  const { amount, tiltAbs } = parsePoliticalSignals(d);
  // Log-scaled $ factor: $100K → 0, $1M → 1, $10M → 2, $100M → 3 …
  // Always positive; we SUBTRACT it weighted to push bigger PACs lower.
  const sizeFactor = Math.log10(Math.max(1, amount / 100_000));
  if (val === "bipartisan" || val === "mixed") {
    // Base 85, spread 55-95 by tilt + size
    return Math.max(55, Math.min(95, 85 - tiltAbs * 0.5 - sizeFactor * 7));
  }
  if (val === "left-leaning" || val === "right-leaning") {
    return Math.max(45, Math.min(70, 65 - sizeFactor * 5));
  }
  if (val === "left" || val === "right") {
    // Hard partisan: 35-65 spread by tilt + size (bigger PAC = lower)
    return Math.max(35, Math.min(65, 58 - tiltAbs * 0.2 - sizeFactor * 5));
  }
  return null;
}

/** Non-personalized score for a category. Returns null when no signal. */
function baseScoreCat(k, v, d) {
  const val = String(v || "").toLowerCase();
  if (!val || val === "neutral" || val === "na" || val === "n/a" || val === "unknown") return null;

  // V3/R4 + R7: stance categories are personal-values axes the app is neutral
  // on. They contribute NOTHING to the un-quizzed baseline (previously injected
  // a flat 50, diluting every real signal toward C). They still render as
  // badges and still drive personalized grades after the Match.
  //
  // R7 (Aron, 2026-06-12): POLITICAL joins them. A direction-neutral donation
  // score (bipartisan ≈80 vs concentrated-partisan ≈46-48) is itself an
  // editorial position living inside a grade we call "neutral" — the review's
  // strongest "it's biased" attack. Politics now counts ONLY once a user picks
  // a side in the Match (App.jsx computeScore maps lean → own-side/opposite).
  // Returning null here drops political from `overall` and from `csc`.
  if (k === "political" || k === "dei" || k === "animals" || k === "guns") return null;
  if (k === "labor") {
    if (["positive", "excellent", "strong", "good"].includes(val)) return 97;
    if (val === "mixed") return 50;
    // V3/R3: negatives spread 8–40 by penalty dollars in the record.
    if (["negative", "poor", "below average", "very poor"].includes(val)) {
      return negativeSeverityScore(d?.labor?.s, val, REVENUE[d?.slug]?.revenue);
    }
    return null;
  }
  if (k === "privacy") {
    if (val === "good") return 97;
    if (val === "mixed") return 50;
    if (val === "poor") return 8;
    return null;
  }
  if (k === "execPay") {
    // V3/R3: score the actual SEC-disclosed pay ratio when we have it —
    // continuous log curve instead of the {97, 50, 8} buckets.
    const ratio = parsePayRatio(d);
    if (ratio != null) return payRatioScore(ratio);
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
    // V3/R3: negatives spread 8–40 by penalty dollars in the record.
    if (["negative", "poor", "below average", "very poor"].includes(val)) {
      return negativeSeverityScore(d?.environment?.s, val, REVENUE[d?.slug]?.revenue);
    }
    return null;
  }
  if (k === "charity") {
    // V3/R3: positive band spread 60–100 by IRS-990 grant totals; enum-only
    // positives (documented but unquantified giving) sit at 85.
    if (["positive", "excellent", "strong", "good", "active_giving"].includes(val)) {
      return charityGivingScore(d, REVENUE[d?.slug]?.revenue) ?? 85;
    }
    if (val === "mixed") return 50;
    if (["negative", "poor", "below average", "very poor"].includes(val)) return 8;
    return null;
  }
  // fallback (unknown future categories)
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
const allOveralls = [];
let nullOveralls = 0;
const wendySlug = "wendy-s";
const tjSlug = "trader-joe-s";
const traces = { [wendySlug]: null, [tjSlug]: null };

function gradeFromOverall(n) {
  // SCORING V3 (2026-06-11): the Build-57 signal-count cliff (A needs ≥3 sig,
  // single-signal brands capped at C) is GONE — evidence confidence is now
  // handled continuously by the K_SHRINK shrinkage upstream, so a one-signal
  // brand at raw 82 lands ~63 (B) instead of being flattened to the same C
  // as a one-signal brand at 46.
  //
  // Thresholds were recalibrated ONCE from the post-V3 distribution of all
  // 5,303 scored brands (2026-06-11 dry run), then FROZEN — calibration, not
  // a perpetual curve; brands move on their own evidence from here. Cut
  // points deliberately avoid the two dense score spikes (47-48 mixed-record
  // cluster → interior of C; 61-62 single-signal-political cluster → interior
  // of B). Resulting shape among graded: A 7% · B 35% · C 40% · D 8% · F 10%.
  // Must stay in sync with src/App.jsx scoreGrade and
  // scripts/finalize-bundle.mjs scoreGrade.
  if (n == null) return "?";
  if (n >= 62) return "A";
  if (n >= 50) return "B";
  if (n >= 38) return "C";
  if (n >= 33) return "D";
  return "F";
}

for (const f of files) {
  const filePath = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }
  const slug = d.slug || f.replace(/\.json$/, "");

  const sc = { ...(d.sc || {}) };
  const trace = { slug, name: d.name, oldOverall: d.overall, oldGrade: gradeFromOverall(d.overall), categories: [], realCount: 0, weightedSum: 0, weightUsed: 0 };

  // Pass 1: align sc.* with detail.* (zero out orphan labels)
  for (const k of CAT_KEYS) {
    const cls = classifyCategory(d, k);
    if (cls.state === "notDisclosed" && sc[k] && sc[k] !== "neutral" && sc[k] !== "na") {
      // Orphan label — kill it so UI + math agree.
      sc[k] = "neutral";
    }
  }
  d.sc = sc;

  // Pass 2: compute new overall over real + inferred + narrative-only categories.
  // V3: also bake `csc` — the per-category continuous 0-100 used by the
  // client (App.jsx scoreCat consults co.csc[k] so collapsed index rows and
  // expanded detail score identically; fixes the political-fallback flicker).
  let signalCount = 0;
  const csc = {};
  for (const k of CAT_KEYS) {
    const cls = classifyCategory(d, k);
    if (cls.state === "real") {
      const cs = baseScoreCat(k, sc[k], d);
      if (cs == null) continue;
      csc[k] = Math.round(cs * 10) / 10;
      trace.weightedSum += cs * 1.0;
      trace.weightUsed += 1.0;
      trace.categories.push({ k, state: "real", val: sc[k], score: cs, weight: 1.0 });
      signalCount++;
    } else if (cls.state === "inferred") {
      const cs = baseScoreCat(k, sc[k], d);
      if (cs == null) continue;
      csc[k] = Math.round(cs * 10) / 10;
      trace.weightedSum += cs * 0.5;
      trace.weightUsed += 0.5;
      trace.categories.push({ k, state: "inferred", val: sc[k], score: cs, weight: 0.5 });
      signalCount++;
    } else if (cls.state === "narrativeOnly") {
      // V3/R4 guard (2026-06-11, OFCCP regression): stance categories stay
      // OUT of the neutral baseline even when a narrative exists — an EEO-1
      // demographics fact is display evidence, not a neutral-user score.
      // Without this, 722 OFCCP dei narratives entered as flat 50s and
      // pulled strong brands toward C.
      if (k === "political" || k === "dei" || k === "animals" || k === "guns") {
        trace.categories.push({ k, state: "narrative-display-only", val: "(stance cat)" });
        continue;
      }
      // Salvage: text record present but enum was set to neutral. Score from
      // keywords in the narrative. Weight at 0.75 — more than inferred (which
      // is sector-based guessing) but less than real (which has both enum +
      // narrative agreeing).
      const cs = narrativeScore(cls.narrative);
      if (cs == null) continue;
      csc[k] = Math.round(cs * 10) / 10;
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

  // V3/R1: evidence-weighted shrinkage toward neutral (50). W is the evidence
  // weight actually used (real=1.0, narrative=0.75, inferred=0.5 each), so a
  // single-record brand is pulled ~60% toward 50 while a five-record brand
  // keeps ~77% of its raw signal. Replaces the hard signal-count grade cap.
  // Companies with 0 signals keep overall=null → grade "?".
  const W = trace.weightUsed;
  let newOverall = (signalCount >= 1 && W > 0)
    ? Math.round(((trace.weightedSum / W) * W + 50 * K_SHRINK) / (W + K_SHRINK) * 10) / 10
    : null;
  // E-9 (Aron, 2026-06-12): single-category brands cap at B (score ≤62,
  // below the A≥63 threshold). Upside-only — the score-level clamp keeps
  // every downstream scoreGrade() copy in sync with zero signature churn.
  if (newOverall != null && signalCount === 1 && newOverall > 61) newOverall = 61;
  // E-10 (Aron, 2026-06-13): symmetric thin-record FLOOR — the mirror of E-9.
  // One moderate, negative-only record shouldn't sink a brand to D/F: that
  // punishes data-sparsity (we have its violations but not its positives), not
  // conduct. A single NON-severe contributing category floors at C (46). F/D
  // require breadth (2+ contributing records) OR severity (a low csc — see
  // SEVERE_NEG). This is the lower-bound counterpart to E-9's upper cap, so a
  // single record — good or bad — lands mid-range; the extremes need breadth.
  if (newOverall != null && signalCount === 1 && newOverall < 46) {
    const onlyScore = Object.values(csc)[0];
    const isSevere = typeof onlyScore === "number" && onlyScore < SEVERE_NEG;
    if (!isSevere) newOverall = 46;
  }
  trace.newOverall = newOverall;
  trace.newGrade = gradeFromOverall(newOverall);

  const oldG = trace.oldGrade;
  const newG = trace.newGrade;
  distOld[oldG] = (distOld[oldG] || 0) + 1;
  distNew[newG] = (distNew[newG] || 0) + 1;
  if (newOverall == null) nullOveralls++;

  // Capture trace for the two example brands.
  if (slug === wendySlug || slug === tjSlug) traces[slug] = trace;
  if (newOverall != null) allOveralls.push(newOverall);

  // Persist realCats (contributing-signal count, now informational) + csc.
  const newCsc = Object.keys(csc).length ? csc : undefined;
  if (d.overall !== newOverall || d.realCats !== signalCount ||
      JSON.stringify(d.sc) !== JSON.stringify(sc) || JSON.stringify(d.csc) !== JSON.stringify(newCsc)) {
    d.overall = newOverall;
    d.realCats = signalCount;
    if (newCsc) d.csc = newCsc; else delete d.csc;
    if (!DRY) fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
    updated++;
  }
}

// Quantile report — used once to derive the frozen V3 grade thresholds.
allOveralls.sort((a, b) => b - a);
const q = (p) => allOveralls[Math.min(allOveralls.length - 1, Math.floor(p * allOveralls.length))];
console.log(`\n=== Score quantiles (scored brands: ${allOveralls.length}) ===`);
console.log(`  p10(A/B)=${q(0.10)}  p35(B/C)=${q(0.35)}  p70(C/D)=${q(0.70)}  p90(D/F)=${q(0.90)}`);
if (DRY) fs.writeFileSync("/tmp/v3-overalls.json", JSON.stringify(allOveralls));

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
