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
// 2026-06-13 (review): `health` dropped from scoring (Aron's call) — it was an
// invisible driver (no Match card, no detail UI). Kept in sync with App.jsx
// CAT_KEYS + index-entry CATEGORIES (all 9 marketed categories, no health).
const CAT_KEYS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay"];

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
export function parseDollars(text) {
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
export function negativeSeverityScore(narrative, enumVal, revenue) {
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
function parsePayRatio(d, includeEnriched = true) {
  const pr = d?.payRatio;
  if (pr && typeof pr.ratio === "number" && pr.ratio > 0) return pr.ratio;
  if (typeof pr === "number" && pr > 0) return pr;
  // B-115: the SEC DEF-14A bulk pull lands the ratio in enriched.execPay, not on
  // d.payRatio. This is used PENALIZE-ONLY (option 2), so callers computing the
  // positive pay baseline pass includeEnriched=false — the enriched ratio may
  // only DRAG a score down, never lift it above the pre-B-115 legacy baseline.
  if (includeEnriched) {
    const er = d?.enriched?.execPay?.payRatio;
    if (typeof er === "number" && er > 0) return er;
  }
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
export function payRatioScore(ratio) {
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

// B-115 (Aron 2026-08-01): execPay is now "Pay & Tax". ITEP federal effective
// tax rate → score. PENALIZE-ONLY (Aron's call, option B): paying the taxes you
// owe is the baseline, not a virtue — the median payer (~15.8% federal) sits at
// NEUTRAL 50 and the score is CAPPED at 50, so full payment never boosts a
// grade. Only clear avoidance drags down: below-median rates fall toward 8, and
// a PROFITABLE company with multiple $0-tax years bottoms out. A company with
// LOSSES legitimately pays none → return null (no signal, NOT a bad grade).
// secTax (GAAP total rate) is DELIBERATELY NOT used — a low/negative total rate
// is usually foreign losses/accounting, not avoidance (Aron's call: ITEP only).
const TAX_ANCHORS = [[0, 8], [5, 20], [10, 36], [15, 50]]; // fed rate % → score, capped at 50
function taxAvoidanceScore(d) {
  const t = d?.enriched?.tax;
  if (!t || typeof t.effectiveFederalTaxRate !== "number") return null;
  if (typeof t.totalProfits === "number" && t.totalProfits <= 0) return null; // losses ⇒ legit
  // Repeated $0-tax years signal avoidance — but ONLY alongside a sub-median
  // multi-year average. A company averaging ≥15% federal with isolated $0 years is
  // showing loss-year artifacts, not a pattern (fixes e.g. Trimble at 21.5% avg).
  if ((t.zeroTaxYears || 0) >= 2 && t.effectiveFederalTaxRate < 0.15) return 8;
  const r = Math.max(0, Math.min(15, t.effectiveFederalTaxRate * 100));
  if (r >= 15) return 50; // median-or-above ⇒ neutral, no boost
  for (let i = 1; i < TAX_ANCHORS.length; i++) {
    const [r1, s1] = TAX_ANCHORS[i - 1], [r2, s2] = TAX_ANCHORS[i];
    if (r <= r2) return s1 + ((r - r1) / (r2 - r1)) * (s2 - s1);
  }
  return 50;
}

// Combined "Pay & Tax" — STRICTLY PENALIZE-ONLY & MONOTONIC-DOWN (Aron's call,
// B-115 option 2). The ONLY new force is the ITEP federal-tax-avoidance penalty.
// Pay is scored EXACTLY as it was pre-B-115 (legacy ratio sources + enum buckets):
// the enriched SEC pay ratio is deliberately NOT used — it frequently disagrees
// with the legacy ratio and would drag brands down on a data-quality artifact, not
// conduct (e.g. Alaska/Frontier/Home Depot). Tax avoidance can only DRAG DOWN:
//   • Already-graded (enum) brands: averaged into the baseline, min-capped so a
//     brand's grade can only fall, never rise.
//   • Neutral/na brands (a NEW category): fires ONLY on CLEAR avoidance
//     (score < SEVERE_NEG), always below any graded brand's overall — so it can
//     newly-grade a "?" brand LOW or drag a graded one down, but never lift one.
// A company with LOSSES pays no tax legitimately → taxAvoidanceScore returns null.
function payTaxScore(d, val) {
  const hasEnum = ["fair", "good", "mixed", "poor"].includes(val);
  const taxRaw = taxAvoidanceScore(d);                       // 8..50, or null
  // Only a rate BELOW the ~15% median (score < 50) is avoidance; a compliant rate
  // scores exactly 50 and must NOT drag a good pay score down (that mislabels
  // full-rate payers like Arista/Campbell/Quanta as avoiders).
  const taxPenalty = taxRaw != null && taxRaw < 50 ? taxRaw : null;

  // Pay baseline — pre-B-115 exactly (legacy sources only; nothing here can lift).
  const legacyRatio = parsePayRatio(d, false);
  const base = hasEnum
    ? (legacyRatio != null ? payRatioScore(legacyRatio)
      : ["fair", "good"].includes(val) ? 97
      : val === "mixed" ? 50
      : 8)
    : null;

  if (base != null) {
    // Tax avoidance drags the existing score down (averaged, capped ≤ baseline).
    if (taxPenalty != null && taxPenalty < base) return Math.min(base, (base + taxPenalty) / 2);
    return base;
  }
  // Neutral/na enum: a NEW signal only on clear tax avoidance (< SEVERE_NEG).
  if (taxPenalty != null && taxPenalty < SEVERE_NEG) return taxPenalty;
  return null;
}

// Charity positive band spread by IRS-990 grant totals (log scale):
//   $10K→60 · $100K→68 · $1M→76 · $10M→84 · $100M→92 · ≥$1B→100
// Returns null when no structured grant data — caller falls back to 85
// (documented-but-unquantified giving).
export function charityGivingScore(d, revenue) {
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
  if (neg && pos)  return 50; // genuinely mixed evidence — a real, informative signal
  // C-4 (2026-08-10): a narrative with NO directional keywords is NOT evidence.
  // This used to return 50, described as "conservative" — it was the opposite.
  // 50 clears the B threshold, so a company with a neutral-toned blurb and
  // nothing else was published as a "B" on zero information: 231 brands held a
  // B from a single neutral enum, and 23andMe scored B off one "mixed" privacy
  // datapoint while its own record cited the CA AG suing it over a breach.
  // No signal must mean NO GRADE, not a median grade.
  return null;
}

// ─── Political signal differentiation (B-58 / Path B) ────────────────────
// Parse $ amount + tilt from political.s narrative or political.fecData.
// Old scoring jammed ALL bipartisan brands at score 80 (the right peak of
// the bimodal cluster). This spreads them across 55-90 using donation size
// (log scale) + tilt distance from 50/50.
export function parsePoliticalSignals(d) {
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

export function politicalScore(d, val) {
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
export function baseScoreCat(k, v, d) {
  const val = String(v || "").toLowerCase();
  // B-115: execPay ("Pay & Tax") is scored ENTIRELY by payTaxScore — the SEC pay
  // ratio (pre-B-115 baseline) plus the ITEP tax-avoidance penalty, even when the
  // enum is neutral/absent (the structured data IS the signal). Return
  // unconditionally so execPay never falls through to the generic enum scorer
  // below: that preserves the exact pre-B-115 pay behavior (null → dropped by the
  // bake loop, e.g. "very poor" with no ratio) and keeps this change tax-only.
  if (k === "execPay") return payTaxScore(d, val);
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
  // execPay ("Pay & Tax") handled above (before the neutral guard) via payTaxScore.
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
    // V3/R3: positive band spread 60–100 by IRS-990 grant totals. Enum-only
    // positives (documented giving but NO quantified IRS-990 total) sit at 65,
    // not 85 (2026-07-04 diligence + Aron's call). The flat 85 was ~46% of all
    // charity scores and upside-only, inflating grades on unverified "positive"
    // enums (it floated polluters toward a B). 65 = "documented but unquantified"
    // — still positive, but not a full record-backed 85.
    if (["positive", "excellent", "strong", "good", "active_giving"].includes(val)) {
      return charityGivingScore(d, REVENUE[d?.slug]?.revenue) ?? 65;
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

  // B-115 (option 2): execPay ("Pay & Tax") can be scoreable while the enum is
  // na/neutral — but ONLY as a PENALTY (tax avoidance or an egregious dark pay
  // ratio). payTaxScore returns null for non-penalizing positives, so a good dark
  // ratio / compliant tax never enters the bake loop and never lifts a brand off
  // "?". Gated on a NON-recognized enum so recognized enums keep flowing through
  // the normal path below (incl. the no-record orphan-label zeroing). A "No public
  // record found" narrative refers to PAY DISCLOSURE — it must NOT suppress a real
  // ITEP tax-avoidance penalty (the tax filing IS the record). Placed before the
  // na guard so a tax-only avoider with a neutral/na pay enum still bakes.
  if (k === "execPay" && !["fair", "good", "mixed", "poor"].includes(val)
      && payTaxScore(d, val) != null) {
    return { state: "real", value: "neutral" };
  }

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

// Moved above the run block (was interleaved with it) so it's module-scoped
// and exportable for scripts/scoring-engine.test.mjs — which now imports the
// REAL engine instead of inline copies that could drift.
export function gradeFromOverall(n) {
  // Thresholds recalibrated once (R7.1, 2026-06-13: A≥62/B≥50/C≥38/D≥33/F<33,
  // after political-exclusion + revenue-normalized severity) then re-frozen.
  // Must stay in sync with src/App.jsx scoreGrade + scripts/lib/index-entry.mjs.
  if (n == null) return "?";
  if (n >= 62) return "A";
  if (n >= 50) return "B";
  if (n >= 38) return "C";
  if (n >= 33) return "D";
  return "F";
}

// Run the catalog rebake ONLY when invoked directly (node scripts/rebake-...).
// Importing this module (the test does) gets the functions without the run.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
const files = fs.readdirSync(COMPS).filter(f => f.endsWith(".json"));
console.log(`[rebake] processing ${files.length} companies`);

let updated = 0;
// C-5: slug -> scored result, used by the parent/child conflict pass after the loop.
const scored = new Map();
const distOld = {}, distNew = {};
const realCountDist = {};
const allOveralls = [];
let nullOveralls = 0;
const wendySlug = "wendy-s";
const tjSlug = "trader-joe-s";
const traces = { [wendySlug]: null, [tjSlug]: null };

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
  // C-4 (2026-08-10): a brand whose ENTIRE evidence is one category sitting on
  // the exact neutral midpoint has no directional information — yet 50 clears
  // the frozen B threshold, so it published as a "B". Live example: 23andMe held
  // a B off a single privacy:"mixed" datapoint on a record that itself cites the
  // California AG suing it over a data breach. "We found one ambiguous thing"
  // must read as "?", not as a good grade. Thresholds are frozen, so this is
  // expressed as evidence sufficiency (no grade) rather than a threshold change.
  // Multi-category brands are untouched: averaging to 50 across several real
  // records IS an informative result.
  if (newOverall != null && signalCount === 1) {
    const onlyScore = Object.values(csc)[0];
    if (typeof onlyScore === "number" && Math.abs(onlyScore - 50) < 1e-9) newOverall = null;
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
  scored.set(slug, { overall: newOverall, cats: Object.keys(csc).length, name: d.name, filePath });
}

// ── C-5 SECOND PASS: same-company contradictory grades ─────────────────────
// A user searching one company must not get opposite answers depending on which
// row they land on: Amazon=C but Amazon Go=F, CVS Health=F but CVS Pharmacy=C,
// Dollar General=C but Dollar General Market=F. Of 550 sub-brands graded beside
// a graded parent, 120 (22%) disagreed and 28 by 2+ letter grades. That reads as
// "this app is wrong", which is worse than "this app doesn't know".
//
// NOT every disagreement is a bug — Ben & Jerry's (A) genuinely differs from
// Unilever (C), as do Patagonia, Prana, Toms and Caribou Coffee, each on their
// own richer record. Suppress ONLY the artifact class: the child disagrees by
// 2+ letter grades AND rests on strictly FEWER scored categories, i.e. a thin
// slice of the same business shouting louder than the business itself.
//
// This must live inside the rebake (not a standalone script) or the next cron
// run would silently recompute the contradiction back in.
{
  const GV = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  let suppressed = 0;
  try {
    const amap = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8"));
    // Alias keys are squashed ("americanairlinesshuttle") while slugs are
    // hyphenated ("american-airlines-shuttle"), so match on a normalized form
    // as well as the literal slug.
    const nrm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const byNormSlug = new Map();
    for (const [slug, v] of scored) {
      const k = nrm(slug);
      if (!byNormSlug.has(k)) byNormSlug.set(k, v);
    }
    const lookup = (s) => scored.get(String(s).toLowerCase()) || byNormSlug.get(nrm(s));
    for (const [alias, info] of Object.entries(amap)) {
      const kid = lookup(alias);
      const par = lookup(info?.parent || "");
      if (!kid || !par || kid.overall == null || par.overall == null) continue;
      const kg = gradeFromOverall(kid.overall), pg = gradeFromOverall(par.overall);
      if (!GV[kg] || !GV[pg]) continue;
      if (Math.abs(GV[kg] - GV[pg]) < 2) continue;
      if (!(kid.cats < par.cats)) continue; // child holds its own — keep it
      if (!DRY) {
        const d2 = JSON.parse(fs.readFileSync(kid.filePath, "utf8"));
        d2.overall = null;
        d2._gradeSuppressed = { reason: "parent-child-conflict", parent: String(info.parent) };
        fs.writeFileSync(kid.filePath, JSON.stringify(d2, null, 2));
      }
      suppressed++;
      console.log(`  [C-5] ${kid.name}=${kg} (${kid.cats} cats) -> "?"   [parent ${par.name}=${pg}, ${par.cats} cats]`);
    }
  } catch (err) {
    console.warn("[rebake] C-5 pass skipped:", err.message);
  }
  console.log(`[rebake] C-5 suppressed ${suppressed} contradictory sub-brand grades.`);
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
} // end: if invoked directly (catalog rebake run)
