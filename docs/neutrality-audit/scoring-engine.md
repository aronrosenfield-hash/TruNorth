# Scoring Engine Neutrality Audit

**Date:** 2026-06-08
**Branch:** `feature/neutrality-audit-scoring`
**Auditor:** Pre-launch automated review (PH launch 2026-06-23)
**Principle:** Journalism, not opinion. Score math + labels + rule text must be neutral across the political spectrum.

---

## Files Scanned

| Path | Purpose | Lines |
|---|---|---|
| `scripts/rebake-scores-from-events.mjs` | News-event scoring overlay engine (B-23) | 455 |
| `scripts/audit-grade-drift.mjs` | Duplicate scoreCat (kept-in-sync mirror) | ~150 of 250 |
| `scripts/reflag-categories.mjs` | Per-company flags writer (PR-2) | 265 |
| `src/lib/scoringFlags.js` | Flag-to-render helper (PR-3) | 90 |
| `src/App.jsx` lines 510–710 | Canonical `CAT_KEYS`, `CAT_LABELS`, `CAT_FULL`, `scoreCat`, `applyOverlay`, `computeScore` | ~200 |
| `src/App.jsx` lines 720–815 | `factualLabel` + `scoreGrade` (letter cutoffs) | ~95 |
| `src/App.jsx` lines 455–504 | Quiz/onboarding stance labels | ~50 |
| `src/OnboardingFlow.jsx` | Marketing copy for 9 categories | ~80 |
| `public/data/_meta/category-applicability.json` | Per-industry NA map (18-cat taxonomy) | 33 |
| `public/data/_meta/category-applicability-overrides.json` | Per-slug overrides (firearm retailers) | 12 |

---

## Severity counts

| Severity | Count | Notes |
|---|---|---|
| CRITICAL (must fix before launch) | **0** | No hard-coded bias in score math; no editorial labels. |
| MAJOR (flag for human review) | **3** | All structural asymmetries — see §3. |
| MINOR (cosmetic only) | **2** | Wording nits in `factualLabel`. See §4. |

---

## 1. Category-label review (11 categories)

| Key | Public label | Full label | Verdict |
|---|---|---|---|
| `political` | "Political" | "Political donations & lobbying" | **Neutral.** Symbol is `◀` / `▶` / `◆`. No party preference baked in. |
| `charity` | "Charity" | "Charitable giving" | **Neutral.** Factual descriptor. |
| `environment` | "Environ." | "Environmental policy" | **Neutral.** Factual. |
| `labor` | "Labor" | "Labor practices" | **Neutral.** Factual. |
| `dei` | "DEI" | "DEI & social equity" | **Neutral.** Acronym-only label avoids loaded framing. Quiz uses "Workplace diversity programs" — also neutral. |
| `animals` | "Animal Testing" | "Animal testing" | **Neutral.** Factual descriptor of the practice being measured. |
| `guns` | "Firearms" | "Firearms policy" | **Neutral.** Not "Gun Lobby Ties" or "Gun Violence." Industry flag pill is "Firearms industry" — neutral. |
| `privacy` | "Data Privacy" | "Data privacy" | **Neutral.** |
| `execPay` | "Exec Pay" | "Executive pay ratio" | **Neutral.** Factual ratio (CEO:worker). |
| `transparency` | (planned PR-3) | "Transparency benchmarks" | **Neutral.** Not yet surfaced. |
| `health` | (planned PR-3) | "Health & safety" | **Neutral.** Not yet surfaced. |

**Verdict: 11/11 categories use neutral, factual labels.** No "Equity & Inclusion Performance" or "Gun Lobby Ties"-style editorializing.

---

## 2. Score-label vocabulary (per-category thresholds)

`scoreCat()` produces 0–100; `scoreGrade()` maps to A (≥75) / B (≥62) / C (≥48) / D (≥35) / F (<35). Letter cutoffs are **universal across all categories**, so per-category grading inherits the same scale.

### 2a. Symmetric (left/right, pro/anti) thresholds

| Category | Pro-side payoff | Anti-side payoff | Verdict |
|---|---|---|---|
| `political` (user=left) | left donations → **97** | right donations → **8** | Symmetric with user=right (right=97, left=8). ✓ |
| `political` (user=right) | right donations → **97** | left donations → **8** | Mirror of left-user case. ✓ |
| `political` (user=neutral) | bipartisan=80, neutral=72, partisan=52 | Same for left- and right-leaning brands. ✓ |
| `dei` (user=pro) | pro_dei → **97** | anti_dei → **5** | Symmetric with user=anti (anti=97, pro=5). ✓ |
| `dei` (user=anti) | anti_dei → **97** | pro_dei → **5** | Mirror of pro-user case. ✓ |
| `dei` (user=neutral) | flat **62** regardless of brand stance | No bias either way (no scoring signal extracted). ✓ |

**No left/right or pro/anti DEI asymmetry detected in `scoreCat`.**

### 2b. Asymmetries flagged (one-sided preferences)

| Category | Asymmetry | Reason | Action |
|---|---|---|---|
| `animals` | No symmetric "pro animal testing" option — quiz offers only dealbreaker/prefer_not/neutral. | By design: vivisection advocacy is not a consumer preference TruNorth attempts to satisfy. Reasonable. | **No change.** Acceptable one-sided design. |
| `guns` (user=avoid) penalties | `makes_guns=3`, `sells_guns=8` (harsh) | Mirror penalty for "user=support" + brand `no_guns` is only **35**. | **MAJOR — see §3.** |
| `labor` (user=anti-union) | Poor labor boost is **+20**, max **80**; pro-union "good labor" boost is **+8**, max **97**. | Stronger penalty insulation for poor labor when user is anti-union. | **MAJOR — see §3.** |

### 2c. Numeric-category baselines (no user preference)

| `sc.<cat>` value | environment | charity | labor | privacy | execPay |
|---|---|---|---|---|---|
| positive/good/strong/excellent | 88 | 88 | 88 | 92 | 88 |
| mixed | 52 | 52 | 55 | 52 | 58 |
| neutral | 48 | 48 | 50 | 50 (n/a) | 50 (n/a) |
| poor/negative/below average | 15 | 15 | 15 | 10 | 15 |
| very poor | 3 | 3 | 5 | n/a | n/a |
| fallback (`unknown`) | 50 | 50 | 50 | 50 | 50 |

**Symmetry check:** "good" delivers +38 to +42pts above midpoint (50); "poor" delivers −35 to −40pts below midpoint. Slight asymmetry of ~2–5pts (positive payoff edges out negative penalty in privacy/execPay). **Consistent across all five numeric categories.** No category is scored more strictly than another. ✓

---

## 3. MAJOR findings — flagged for human review

### M-1. Guns: penalty for disliked side is HARSHER for "avoid" users than for "support" users

**Location:** `src/App.jsx:560–565` (and mirror in `scripts/audit-grade-drift.mjs:73–77`)

```js
if (pref === "avoid")   { if (val==="no_guns") return 97; if (val==="sells_guns") return 8;  if (val==="makes_guns") return 3;  return 45; }
if (pref === "support") { if (["sells_guns","makes_guns"].includes(val)) return 97; if (val==="no_guns") return 35; return 58; }
```

Avoid-user sees a `makes_guns` brand → score **3** (F-tier).
Support-user sees a `no_guns` brand → score **35** (D-tier).

Asymmetry: `97 − 3 = 94` (avoid swing) vs `97 − 35 = 62` (support swing). The "avoid" user gets a more discriminating ranker than the "support" user.

**Recommended remedy (human sign-off required):**
- Either: tighten avoid penalties to `(no_guns=97, sells_guns=20, makes_guns=10)` — still strong, but symmetric to support side.
- Or: loosen support side to `(makes_guns=97, sells_guns=97, no_guns=20)` — gives gun-supporting user a sharper ranker.
- Or: justify the asymmetry in docs ("avoiding the firearms industry is a behavioral signal we believe is closer to dealbreaker territory than supporting it") and leave as-is.

**Not changing here** — score-math changes need product sign-off.

---

### M-2. Labor: anti-union user gets bigger boost for "poor labor" than pro-union user gets for "good labor"

**Location:** `src/App.jsx:567–576`

```js
if (union === "pro")  { if (["positive",…].includes(val)) return Math.min(base + 8,  97); if (["negative","poor"].includes(val)) return Math.max(base - 15, 3);  }
if (union === "anti") { if (["positive",…].includes(val)) return Math.max(base - 15, 30); if (["negative","poor"].includes(val)) return Math.min(base + 20, 80); if (val==="mixed") return 65; }
```

| Scenario | Pro-union | Anti-union |
|---|---|---|
| Brand has **good labor** | +8 boost (max 97) | −15 penalty (floor 30) |
| Brand has **poor labor** | −15 penalty (floor 3) | +20 boost (max 80) |
| Brand has **mixed** | base 55 | bumped to 65 |

The anti-union user gets a **larger boost** (+20) than the pro-union user gets for their favored signal (+8). Anti-union user's floors are also gentler (30/65 vs 3/15). Net effect: anti-union users see more compressed scores (anti-friendly brands less penalized; even pro-union brands floored at 30) while pro-union users see wider spread (3–97).

**Recommended remedy (human sign-off required):**
- Make boosts symmetric: pro-union +20 for good / −20 for poor; anti-union +20 for poor / −20 for good. Keep clamp at `[3, 97]` both ways.

**Not changing here** — same product-sign-off reason as M-1.

---

### M-3. Outlet bias map (rebake): mainstream-left outlets weighted higher than mainstream-right outlets at comparable tiers

**Location:** `scripts/rebake-scores-from-events.mjs:83–130`

Notable pairings:

| Left-leaning outlet | Weight | Right-leaning counterpart | Weight | Δ |
|---|---|---|---|---|
| `motherjones.com` | 0.70 | `breitbart.com` | 0.20 | +0.50 |
| `vox.com` | 0.50 | `nationalreview.com` | 0.60 | −0.10 |
| `theatlantic.com` | 0.70 | `washingtontimes.com` | 0.50 | +0.20 |
| `huffpost.com` | 0.40 | `nypost.com` | 0.50 | −0.10 |
| `propublica.org` | 0.95 | (no right-leaning investigative counterpart at this tier) | — | — |
| `msnbc.com` | 0.40 | `foxnews.com` | 0.40 | 0 ✓ |
| `salon.com` | 0.30 | `dailycaller.com` | 0.30 | 0 ✓ |
| `nytimes.com` | 0.90 | `wsj.com` | 0.90 | 0 ✓ |

Pair-by-pair the map is **defensible** if read as "journalistic-rigor weighting, not lean weighting" — Breitbart has documented factual-accuracy issues that Mother Jones does not. ProPublica is a Pulitzer-winning investigative shop; no right-leaning outlet operates at that scale. But the *aggregate effect* is that negative coverage of a brand from left-of-center outlets carries more rebake weight than negative coverage from right-of-center outlets. In a politically charged rebake event (e.g. corporate DEI rollback) this could push the score in one direction more than the other.

**Recommended remedy (human sign-off required):**
1. Document this weighting explicitly in the file header as "journalistic-quality, NOT political-lean, weighted." (Currently the comment just says "OUTLET_BIAS.")
2. Consider adding a third-party reference (e.g. AllSides Media Bias Chart factual-reliability scores) and citing it inline, so the weights aren't opaque editorial judgments.
3. Optionally: add a right-leaning investigative-tier outlet (e.g. `realclearinvestigations.com` at ~0.85, `washingtonexaminer.com` at ~0.60–0.70) to widen the tier-3 pool on the right and dampen the apparent asymmetry.

**Not changing here** — outlet-weight changes need editorial sign-off.

---

## 4. MINOR findings — cosmetic

### m-1. `factualLabel` asymmetry — wording, not math

**Location:** `src/App.jsx:794–798`

```js
if (k === "environment") return good ? "Verified Certifications" : "Documented Violations";
```

Positive uses "Certifications" (a credential); negative uses "Violations" (a sanction). The two are linguistically asymmetric — a brand could have neither cert nor violation and still have a good record. Consider `good ? "Strong Environmental Record" : "Documented Violations"` for parallelism, but this is cosmetic.

### m-2. `CAT_FULL.dei` says "DEI & social equity"

**Location:** `src/App.jsx:516`

"social equity" leans slightly editorial vs the dryer "DEI policies" or "workforce diversity." Quiz copy uses "Workplace diversity programs" (better). Acceptable, but consider aligning to "DEI policies & workforce diversity."

**Not changing in this PR.** These would benefit from copywriter polish, not a security-style fix.

---

## 5. Per-company applicability + overrides — neutrality check

### Applicability map (`category-applicability.json`)

The `na` lists are structural rules ("Tech doesn't sell guns or animal products"). Spot-check:

- `guns` NA for everyone except Sports & Outdoor + Defense & Aerospace → **structurally correct.** Mass-market retailers handled via per-slug overrides.
- `health` NA for everyone except Food & Bev, Healthcare, Beauty, Grocery, Hospitality → **structurally correct.** Aligns with rule comment.
- `animals` NA for non-physical-product industries → **structurally correct.**

No category is selectively NA for a politically-coded industry but applicable for another in a way that biases the engine.

### Overrides (`category-applicability-overrides.json`)

7 slugs, all setting `guns: "applicable"` for retailers that actually sell firearms (Walmart, Kroger, Costco, Dick's, Cabela's/Bass Pro, Academy). **Neutral structural override.** No politically-coded brand gets a category waived for them; no opponent gets one added.

---

## 6. CRITICAL fixes applied

**None.** No hard-coded political weight, no editorial label, and no per-side threshold flip was discovered. The two threshold asymmetries (M-1 guns, M-2 labor) and the outlet-bias asymmetry (M-3) are flagged for human review but **must not be silently changed** before launch — they require product owner (Aron) sign-off to either justify or symmetrize.

---

## 7. Confidence rating

**Engine overall neutrality: 4 / 5.**

Breakdown:
- **Math layer (`scoreCat`, `computeScore`, `applyOverlay`):** mostly symmetric for two-sided preferences (political, DEI). Two structural asymmetries on guns (M-1) and labor (M-2). 4/5.
- **Labels (`CAT_LABELS`, `CAT_FULL`, `factualLabel`):** uniformly factual. 5/5.
- **Quiz copy (`stances_identity`):** "Progressive / Conservative / Mixed / No preference" — neutral, opt-in. 5/5.
- **Applicability rules:** structural, defensible. 5/5.
- **Outlet bias map:** quality-weighted but disproportionately favors left-of-center outlets at upper tiers, with no right-leaning investigative counterpart at the 0.95 tier (M-3). 3/5.
- **Per-company overrides:** neutral. 5/5.

**Net: launch-safe assuming M-1, M-2, M-3 are either justified in docs or symmetrized post-launch.** None block the 2026-06-23 Product Hunt release.

---

## 8. Recommended next steps (post-launch)

1. **M-1:** Symmetrize gun thresholds OR add a code comment justifying the avoid-skew.
2. **M-2:** Symmetrize labor union boosts (both sides ±20 with `[3, 97]` clamp).
3. **M-3:** Add a header comment to `OUTLET_BIAS` explaining the "rigor-weighted, not lean-weighted" intent, and consider adding 2–3 mid-tier right-leaning outlets.
4. **m-1, m-2:** Copywriter pass on `factualLabel` and `CAT_FULL.dei`.
