# TruNorth Scoring Math — How a Grade Is Computed

**Last updated:** 2026-06-09 (post Build 54 scoring rebake)
**Source of truth:** `src/App.jsx` (`computeScore` line 686, `scoreCat` line 623) + `scripts/rebake-scoring.mjs` (the offline base-score job)

This doc traces every step of how a brand becomes a letter grade so we can argue with the math when it disagrees with intuition.

---

## Two scores per brand

| Score | When it shows | Where it comes from |
|---|---|---|
| **Base `overall`** | User hasn't done the quiz | `scripts/rebake-scoring.mjs` writes this to each `public/data/companies/<slug>.json` |
| **Personalized score** | User has done the quiz | `computeScore(co, profile)` in `src/App.jsx` recomputes live, per user |

The grade letter comes from the same threshold for both:

| Letter | Range |
|---|---|
| **A** | ≥ 75 |
| **B** | ≥ 62 |
| **C** | ≥ 48 |
| **D** | ≥ 35 |
| **F** | < 35 |
| **?** | `overall == null` (no signal — see below) |

---

## Step 1 — classify each category

For every brand × every category (10 of them), we determine **state**:

| State | Trigger | Counts toward grade? |
|---|---|---|
| `na` | Industry says category doesn't apply (e.g. animal testing on a B2B software co) — `flags.<cat>.na` or `sc.<cat> = "na"` | ❌ |
| `notDisclosed` | `flags.<cat>.notDisclosed` OR `detail.<cat>.s` is "No public record found." | ❌ |
| `neutral` | Enum is "neutral" or empty, no narrative | ❌ |
| `real` | Enum is non-neutral non-na AND narrative confirms (or no narrative either way) | ✅ weight 1.0 |
| `inferred` | `flags.<cat>._inferred = true` (industry-level guess, not company-specific) | ✅ weight 0.5 |
| `narrativeOnly` | Enum is neutral BUT narrative has real text content | ✅ weight 0.75 |

**Minimum signal threshold:** at least 1 contributing category. Zero contributing → `overall = null` → grade `?` (insufficient data).

---

## Step 2 — score each contributing category 0-100

### Non-personalized (`scripts/rebake-scoring.mjs`)

| Category | Enum | Score |
|---|---|---|
| `political` | `bipartisan` / `mixed` | **55** (was 75 — lowered Build 54 because single-signal bipartisan was triggering accidental A's) |
| | `left` / `left-leaning` / `right` / `right-leaning` | **50** (political alignment is a preference axis, not objectively good/bad) |
| `dei` | `pro_dei` / `anti_dei` | **50** (politically charged, no base judgment) |
| | `mixed` | 55 |
| `animals` | `cruelty_free` | 80 |
| | `some_testing` | 30 |
| | `tests_animals` | 10 |
| `guns` | `no_guns` | 55 |
| | `sells_guns` / `makes_guns` | 45 |
| `labor` | `positive`/`excellent`/`strong`/`good` | 85 |
| | `mixed` | 50 |
| | `poor`/`negative`/`below average` | 20 |
| | `very poor` | 5 |
| `privacy` | `good` | 90 · `mixed` 50 · `poor` 15 |
| `execPay` | `fair`/`good` | 85 · `mixed` 55 · `poor` 15 |
| `health` | `good`/`positive` | 85 · `mixed` 50 · `poor`/`negative` 15 |
| `charity`, `environment` | `positive`/`excellent`/`strong`/`good` | 85 · `mixed` 50 · `negative`/`poor`/`below avg` 20 · `very poor` 5 |

### Narrative-only scoring (text without enum)

If category is `narrativeOnly`, the `narrativeScore()` keyword scan in `scripts/rebake-scoring.mjs`:
- Contains a NEG keyword (`violation`, `penalty`, `breach`, `lawsuit`, `fine`, `recall`, `convicted`, `fraud`, `child labor`, `discrimination`, …) → **22**
- Contains a POS keyword (`certified`, `b corp`, `fair trade`, `cruelty-free`, `award`, `net zero`, `donated`, `pledge`, `signatory`, `1% for the planet`, …) → **78**
- Both → 50 (mixed)
- Neither → 50 (text exists but no scorable signal)

### Personalized override (`scoreCat` in `src/App.jsx`)

When user has a quiz profile, the personalization adjusts scores based on stance:

| Category | If user picked … | Score for company-value … |
|---|---|---|
| **political** | `lean=left` | `left/left-leaning` → 97 · `bipartisan/mixed` → 62 · `neutral` → 48 · anything else → 8 |
| | `lean=right` | `right/right-leaning` → 97 · `bipartisan/mixed` → 62 · `neutral` → 48 · anything else → 8 |
| | `lean=neutral` | `bipartisan/mixed` → 80 · `neutral` → 72 · else 52 |
| **dei** | `deiLean=pro` | `pro_dei` → 97 · `mixed` → 52 · else 5 |
| | `deiLean=anti` | `anti_dei` → 97 · `mixed` → 52 · else 5 |
| | `deiLean=neutral` | 62 for everything (doesn't move the needle) |
| **animals** | `animalTesting=dealbreaker` | `cruelty_free` → 97 · `tests_animals` → 0 |
| | `animalTesting=prefer_not` | `cruelty_free` → 92 · `tests_animals` → 20 |
| **guns** | `guns=avoid` | `no_guns` → 97 · `sells_guns` → 8 · `makes_guns` → 3 |
| | `guns=support` | `sells_guns/makes_guns` → 97 · `no_guns` → 35 |
| **labor** | `union=pro` | shifts the base score up for positive labor, down for negative |
| | `union=anti` | inverted |

---

## Step 3 — weighted average

Each category has a **base weight** (the importance you set in the quiz, default 3 if not set, scale 1-3) and a **boost** if you took a strong stance on the related axis:

```js
political_weight    = quiz.weights.political    × (quiz.lean !== "neutral"        ? 2 : 1)
dei_weight          = quiz.weights.dei          × (quiz.deiLean !== "neutral"     ? 2 : 1)
animal_weight       = quiz.weights.animals      × (quiz.animalTesting !== "neutral" ? 2 : 1)
gun_weight          = quiz.weights.guns         × (quiz.guns !== "neutral"        ? 4 : 1)
labor_weight        = quiz.weights.labor        × (quiz.unionSupport !== "neutral" ? 2 : 1)
```

Then:

```
weightedSum = sum(category_score × category_weight × state_weight)
weightUsed  = sum(category_weight × state_weight)   // state_weight: real=1.0, inferred=0.5, narrative=0.75
overall     = round(weightedSum / weightUsed, 1)
```

Then **dealbreaker penalty** (personalized only): each dealbreaker subtracts 20 from the score if the brand has the violation signal.

---

## Step 4 — letter grade

Bucket the resulting number with the thresholds at the top.

---

## Worked example — **Home Depot** (the F you flagged 2026-06-09)

Home Depot's data after Build 54 rebake:

| Category | Enum | Narrative | State (in rebake) |
|---|---|---|---|
| political | right | "FEC: $65K PAC donations; 92% to Republican…" | **real** |
| charity | neutral | "$132M reported corporate giving in 2024 (~0.09% of revenue)…" | **narrativeOnly** (enum is neutral but text is real) |
| environment | poor | "hazardous waste violation: $37.8M in federal penalties…" | **real** |
| labor | poor | "368 federal penalties totaling $325.1M since 2000…" | **real** |
| dei | neutral | "No public record found." | **notDisclosed** ❌ excluded |
| animals | na | "No public record found." | **na** ❌ excluded |
| guns | neutral | "No public record found." | **notDisclosed** ❌ excluded |
| privacy | neutral | "No public record found." | **notDisclosed** ❌ excluded |
| execPay | na | "No public record found." | **na** ❌ excluded |

**Non-personalized math (what shows when no quiz):**

| Category | Score | Weight | Contribution |
|---|---|---|---|
| political (right) | 50 | 1.0 | 50.0 |
| charity (narrative-only, "$132M corporate giving" — no NEG kw, no POS kw because regex looks for `donated/pledge/...`) | 50 | 0.75 | 37.5 |
| environment (poor) | 20 | 1.0 | 20.0 |
| labor (poor) | 20 | 1.0 | 20.0 |
| **Totals** | | **3.75** | **127.5** |

`overall = 127.5 / 3.75 = 34.0` → **F** (just below the D threshold of 35).

**Why your D intuition is reasonable but the math says F:**

- You expected DEI to lift the score. But our data has `dei=neutral` + "No public record found." → category excluded entirely. **The DEI lift you mentally added doesn't exist in the data.** Home Depot's actual DEI programs aren't captured anywhere in our 30+ source augments — we'd need to add a source (HRC CEI, Disability:IN, etc. — already in pipeline but didn't match Home Depot).
- The charity narrative ($132M giving) scored a neutral 50 because my keyword regex looks for `donated/donation/pledge/philanthropic` and the actual text uses `corporate giving`. Easy keyword fix would lift charity to ~78 → overall ~40 → D.

**Personalized (Democrat user):** political becomes 8 instead of 50 (left user, right co), labor stays low. Likely lands closer to F still, maybe 25-30.

---

## Worked example — **Patagonia** (the A everyone expects)

| Category | Enum | Narrative | State |
|---|---|---|---|
| political | neutral | "No public record found." | notDisclosed ❌ |
| charity | **positive** | "$100M reported corporate giving in 2024 (~6.67% of revenue) via Patagonia Inc." | **real** ✅ |
| environment | **positive** | "1% for the Planet member — pledges 1% of annual sales…" | **real** ✅ |
| labor | neutral | "No public record found." | notDisclosed ❌ |
| dei | neutral | "No public record found." | notDisclosed ❌ |
| animals/guns/etc. | na/neutral | "No public record found." | excluded ❌ |

**Math:**
- charity (positive): 85 × 1.0 = 85
- environment (positive): 85 × 1.0 = 85
- total: 170 / 2.0 = **85.0 → A** ✅

Two strong positive signals, nothing dragging her down. Math agrees with intuition.

---

## Worked example — **Wendy's** (the "A" you flagged before Build 54)

Build 54 trace (un-personalized):
- political (right): 50
- charity (narrative-only, $X donations text without POS keywords): 50 × 0.75 = 37.5
- environment (narrative-only, "$8K penalties" → NEG kw "penalties"): 22 × 0.75 = 16.5
- labor (mixed): 50
- privacy (narrative-only, "breach"): 22 × 0.75 = 16.5
- Sum: 50 + 37.5 + 16.5 + 50 + 16.5 = 170.5; weight: 1 + 0.75 + 0.75 + 1 + 0.75 = 4.25
- `170.5 / 4.25 = 40.1` → **D** ✅

For a Democrat user: political becomes 8 (right co, left user) instead of 50. Score drops to ~30-35 → still F or D. Matches expectation.

---

## Known math weaknesses (Build 54)

1. **Narrative keyword detector is conservative.** Words like `"giving"` (not in POS regex) get scored neutral. Easy to extend; just add to `POS_KEYWORDS` in `scripts/rebake-scoring.mjs`.
2. **`political = right` and `political = left` score the SAME (50) in non-personalized.** Intentional — we don't pre-judge political direction. The personalized math heavily weights to user's lean.
3. **DEI coverage gaps for Home Depot, Walmart, Target etc.** are data issues, not math. We need to re-run `disability-in-merge` and `corporate-giving-merge` against the actual augment data + extend `apply-augments-to-companies.mjs` to also write `dei` from those sources.
4. **`narrativeScore`'s `+0.75` weight feels arbitrary.** Could be 0.5 or 1.0; tuning question.
5. **Single-signal grades feel fragile.** A brand with only labor=poor scores 20 → F. If we believe labor is the only thing we have on them, F is honest. But it might also be unfair if other categories are good-but-undisclosed. The PR-3 scoring-flags feature is meant to differentiate `notDisclosed` from `neutral` visually — when toggled ON, the UI shows greyed-out chips with reasons.

---

## How to argue with the math

1. Pull the brand's JSON: `cat public/data/companies/<slug>.json | jq .`
2. Check each category's `sc.<cat>` enum and `<cat>.s` narrative
3. Trace through the classify table at top of this doc to get state
4. Apply the score table for non-personalized OR the personalized override
5. Weighted-average it manually

When the math disagrees with intuition, the bug is almost always one of:
- **Missing data** (most common): we don't have the signal you mentally have
- **Keyword regex miss**: positive narrative not flagged as positive
- **Orphan label**: enum says one thing, narrative says no record (Build 54 fix kills this)

Open an issue in BACKLOG with the brand + your expected grade + your reasoning — we tune from there.
