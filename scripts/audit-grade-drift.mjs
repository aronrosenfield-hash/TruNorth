// PR-3 grade-drift audit.
//
// Computes the un-personalized (profile = null fallback is `co.overall`, so
// we use a neutral "default profile" instead) grade for every company in
// public/data/index.json TWICE — once with VITE_SCORING_FLAGS_ENABLED=false
// (today's behavior) and once with =true (PR-3 behavior).
//
// Writes data/derived/_meta/grade-drift-report.json listing every company
// whose grade letter changes, plus a per-category reason explaining which
// flag (na / notDisclosed) flipped the math.
//
// Acceptance bar (per the PR-3 plan): < 200 companies experience drift, OR
// every drift is explainable. Both conditions are reported.
//
// Run:
//   node scripts/audit-grade-drift.mjs
//
// Why a duplicate computeScore lives here instead of importing src/App.jsx:
//   App.jsx is a 6,000-line React module that imports CSS, browser APIs,
//   Capacitor, and import.meta.env. Importing it from a node script would
//   require a full Vite/JSX pipeline. The scoring math is small (~80 LOC)
//   and stable — duplicating it here is cheaper than the toolchain to share.
//   If the math ever diverges, the test in
//   scripts/audit-grade-drift.test.mjs (TODO) would catch it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isCategoryExcludedByFlags,
} from "../src/lib/scoringFlags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "public/data/index.json");
const OUT_DIR    = path.join(ROOT, "data/derived/_meta");
const OUT_PATH   = path.join(OUT_DIR, "grade-drift-report.json");

const CAT_KEYS = ["political","charity","environment","labor","dei","animals","guns","privacy","execPay"];
const NA_IS_FACTUAL = new Set(["animals", "guns", "privacy", "execPay"]);
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

// ─── Score helpers (mirror of src/App.jsx — keep in sync) ───────────────────

function getDataState(k, v) {
  if (v == null) return "unknown";
  const val = String(v).toLowerCase().trim();
  if (val === "" || val === "unknown" || val === "?") return "unknown";
  if (val === "na" || val === "n/a") return NA_IS_FACTUAL.has(k) ? "scored" : "unknown";
  return "scored";
}

function scoreCat(k, v, profile) {
  const val = (v || "").toLowerCase();
  if (k === "political") {
    const lean = profile?.lean || "neutral";
    if (lean === "left")   { if (["left","left-leaning"].includes(val)) return 97; if (["bipartisan","mixed"].includes(val)) return 62; if (val==="neutral") return 48; return 8; }
    if (lean === "right")  { if (["right","right-leaning"].includes(val)) return 97; if (["bipartisan","mixed"].includes(val)) return 62; if (val==="neutral") return 48; return 8; }
    if (["bipartisan","mixed"].includes(val)) return 80; if (val==="neutral") return 72; return 52;
  }
  if (k === "dei") {
    const deiLean = profile?.deiLean || "neutral";
    if (deiLean === "pro")  { if (val==="pro_dei") return 97; if (val==="mixed") return 52; if (val==="neutral") return 45; return 5; }
    if (deiLean === "anti") { if (val==="anti_dei") return 97; if (val==="mixed") return 52; if (val==="neutral") return 45; return 5; }
    return 62;
  }
  if (k === "animals") {
    const pref = profile?.animalTesting || "neutral";
    if (pref === "dealbreaker") { if (val==="cruelty_free") return 97; if (val==="some_testing") return 15; if (val==="tests_animals") return 0; return 50; }
    if (pref === "prefer_not")  { if (val==="cruelty_free") return 92; if (val==="some_testing") return 52; if (val==="tests_animals") return 20; return 50; }
    return 62;
  }
  if (k === "guns") {
    const pref = profile?.guns || "neutral";
    if (pref === "avoid")   { if (val==="no_guns") return 97; if (val==="sells_guns") return 8; if (val==="makes_guns") return 3; return 45; }
    if (pref === "support") { if (["sells_guns","makes_guns"].includes(val)) return 97; if (val==="no_guns") return 35; return 58; }
    return 62;
  }
  if (k === "labor") {
    const union = profile?.unionSupport || "neutral";
    const base = ["positive","excellent","strong","good"].includes(val) ? 88
      : val==="mixed" ? 55 : val==="neutral" ? 50
      : ["negative","poor","below average"].includes(val) ? 15 : val==="very poor" ? 5 : 50;
    if (union === "pro")  { if (["positive","excellent","strong","good"].includes(val)) return Math.min(base + 8, 97); if (["negative","poor"].includes(val)) return Math.max(base - 15, 3); }
    if (union === "anti") { if (["positive","excellent","strong","good"].includes(val)) return Math.max(base - 15, 30); if (["negative","poor"].includes(val)) return Math.min(base + 20, 80); if (val==="mixed") return 65; }
    return base;
  }
  if (k === "privacy") {
    if (val==="good") return 92; if (val==="mixed") return 52; if (val==="poor") return 10; return 50;
  }
  if (k === "execPay") {
    if (["fair","good"].includes(val)) return 88; if (val==="mixed") return 58; if (val==="poor") return 15; return 50;
  }
  if (["positive","excellent","strong","good"].includes(val)) return 88;
  if (val==="mixed") return 52; if (val==="neutral") return 48;
  if (["negative","poor","below average"].includes(val)) return 15;
  if (val==="very poor") return 3;
  return 50;
}

function applyOverlay(co, k, baseline0to100) {
  const ov = co.scoring_overlay?.[k];
  if (!ov || typeof ov.delta !== "number") return baseline0to100;
  return Math.max(0, Math.min(100, baseline0to100 + ov.delta));
}

// Track which categories the flag-ON pass excluded that the flag-OFF pass
// included so we can attribute the drift.
function computeScore(co, profile, flagsOn, captureExcluded) {
  if (!profile) return { score: co.overall ?? null, newlyExcluded: [] };
  const politicalBoost = profile.lean         && profile.lean         !== "neutral" ? 2 : 1;
  const deiBoost       = profile.deiLean      && profile.deiLean      !== "neutral" ? 2 : 1;
  const animalBoost    = profile.animalTesting && profile.animalTesting !== "neutral" ? 2 : 1;
  const gunBoost       = profile.guns         && profile.guns         !== "neutral" ? 4 : 1;
  const unionBoost     = profile.unionSupport && profile.unionSupport !== "neutral" ? 2 : 1;
  const baseWeights = {
    political:    (profile.weights?.political    || 3) * politicalBoost,
    charity:      profile.weights?.charity      || 2,
    environment:  profile.weights?.environment  || 3,
    labor:        (profile.weights?.labor       || 3) * unionBoost,
    dei:          (profile.weights?.dei          || 3) * deiBoost,
    animals:      (profile.weights?.animals      || 2) * animalBoost,
    guns:         (profile.weights?.guns        || 2) * gunBoost,
    privacy:      profile.weights?.privacy      || 2,
    execPay:      profile.weights?.execPay      || 2,
  };
  let weightedSum  = 0;
  let weightUsed   = 0;
  const newlyExcluded = [];
  for (const k of CAT_KEYS) {
    if (isCategoryExcludedByFlags(co.flags, k, flagsOn)) {
      if (captureExcluded) newlyExcluded.push({ k, by: co.flags?.[k]?.na ? "na" : "notDisclosed" });
      continue;
    }
    const v = co.sc?.[k];
    if (getDataState(k, v) === "unknown") continue;
    const lv = String(v || "").toLowerCase();
    if (lv === "neutral") continue;
    if (lv === "na" || lv === "n/a") continue;
    if (Array.isArray(co.excl) && co.excl.includes(k)) continue;
    const detailObj = co[k] || {};
    if (NO_REC_RE.test(String(detailObj.s || ""))) continue;
    const catScore = applyOverlay(co, k, scoreCat(k, v, profile));
    weightedSum += catScore * baseWeights[k];
    weightUsed  += baseWeights[k];
  }
  const ws = weightUsed > 0 ? weightedSum / weightUsed : (co.overall || 50);
  const pen = (profile.dealBreakers || []).reduce((p, db) => {
    if (["environment","labor","privacy","execPay","animals","guns","charity"].includes(db)) {
      const v = (co.sc?.[db] || "").toLowerCase();
      const bad = ["negative","poor","very poor","below average","tests_animals","sells_guns","makes_guns"];
      return bad.includes(v) ? p + 20 : p;
    }
    if (db === "forcedLabor"    && (co.sc?.labor||"").toLowerCase() === "poor") return p + 25;
    if (db === "taxAvoidance"   && (co.sc?.execPay||"").toLowerCase() === "poor") return p + 15;
    if (db === "predatoryPrice" && (co.sc?.labor||"").toLowerCase() === "poor") return p + 15;
    if (db === "darkPatterns"   && (co.sc?.privacy||"").toLowerCase() === "poor") return p + 20;
    if (db === "foreignOwn"     && co.foreignOwned) return p + 30;
    if (db === "monopoly"       && co.antitrust) return p + 25;
    if (db === "childLabor"     && co.childLabor) return p + 30;
    return p;
  }, 0);
  if (profile.animalTesting === "dealbreaker" && (co.sc?.animals === "tests_animals")) {
    return { score: Math.max(0, Math.min(ws - 40, 30)), newlyExcluded };
  }
  return { score: Math.max(0, Math.min(100, Math.round(ws - pen))), newlyExcluded };
}

function scoreGrade(n) {
  // SCORING V3 (2026-06-11) frozen thresholds — keep in sync with
  // src/App.jsx scoreGrade / scripts/rebake-scoring.mjs gradeFromOverall.
  if (n == null) return null;
  if (n >= 63) return "A";
  if (n >= 56) return "B";
  if (n >= 46) return "C";
  if (n >= 41) return "D";
  return "F";
}

// ─── Main ────────────────────────────────────────────────────────────────────

// Neutral profile so personalization doesn't dominate the drift signal — we
// want to isolate the effect of the flag change itself, not user preferences.
// Empty weights/dealBreakers + all leans "neutral" mirrors the most common
// "fresh quiz, no strong opinions" user shape.
const NEUTRAL_PROFILE = {
  lean: "neutral",
  deiLean: "neutral",
  animalTesting: "neutral",
  guns: "neutral",
  unionSupport: "neutral",
  weights: {},
  dealBreakers: [],
};

function main() {
  const t0 = Date.now();
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  console.log(`[grade-drift] scoring ${index.length} companies (flag OFF vs ON)`);

  const drifts = [];
  let bothSame = 0;
  const directionCount = {}; // "A->B", "B->C" etc.

  for (const co of index) {
    const off = computeScore(co, NEUTRAL_PROFILE, false, false);
    const on  = computeScore(co, NEUTRAL_PROFILE, true,  true);
    const gOff = scoreGrade(off.score);
    const gOn  = scoreGrade(on.score);
    if (gOff === gOn && off.score === on.score) { bothSame++; continue; }
    if (gOff === gOn) { bothSame++; continue; }     // letter unchanged is fine
    const dirKey = `${gOff}->${gOn}`;
    directionCount[dirKey] = (directionCount[dirKey] || 0) + 1;
    drifts.push({
      slug: co.slug,
      name: co.name,
      cat: co.cat,
      before: { score: off.score, grade: gOff },
      after:  { score: on.score,  grade: gOn  },
      reason: on.newlyExcluded,   // which categories the flag-ON pass excluded
    });
  }

  drifts.sort((a, b) => a.slug.localeCompare(b.slug));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalCompanies: index.length,
    unchanged: bothSame,
    drifted: drifts.length,
    directionCount,
    acceptanceThreshold: 200,
    withinThreshold: drifts.length < 200,
    drifts,
  }, null, 2));

  const ms = Date.now() - t0;
  console.log(`[grade-drift] done in ${ms}ms`);
  console.log(`[grade-drift] ${drifts.length} companies drift / ${index.length} total`);
  console.log(`[grade-drift] direction breakdown:`, directionCount);
  console.log(`[grade-drift] acceptance bar (<200 drift): ${drifts.length < 200 ? "PASS" : "FAIL"}`);
  console.log(`[grade-drift] report → ${path.relative(ROOT, OUT_PATH)}`);
}

main();
