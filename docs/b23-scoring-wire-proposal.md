# B-23 — Wire `enriched.*` into scoring: design proposal

> **Status:** ✅ **`animalCerts` WIRED + verified (2026-06-27, approved by Aron).** The other 6 remain HOLD. Produced 2026-06-27 by an 8-agent adversarial analysis (1 engine-spec + 7 per-dimension skeptics) verified against the live R7.1 engine. Each dimension was judged on: category fit, a severity model *consistent with R7.1*, double-count risk, and expected grade drift (audit acceptance bar = <200 brands).
>
> **Implementation (2026-06-27):** client-only personalized promotion mirrored across all 5 scoring sites in `src/App.jsx` (`computeScore`, `userRelevantRealCats`, `verdictSentence`, the CompassSeal ring, the Why-panel) + a compact `acertB` index flag in `scripts/lib/index-entry.mjs` so browse and detail agree (the proposal under-specified this; without it the promotion would have caused index-vs-detail flicker). **No audit-drift mirror** — `audit-grade-drift.mjs` skips neutral/na enums *before* `scoreCat`, so the promotion is structurally invisible to the baseline auditor (same as `deiEvidence`); baseline drift is 0 by construction. **Verified:** 28/28 baked tests, 0 baseline grade drift after `rebuild-bundle-index`, `acertB` on all 19 carriers, per-category logic against real data (cert→92/88, cal-maine→50), and end-to-end in preview (Trader Joe's → A "aligned 1/1"; Cal-Maine → 40 "aligned 0/1", *not* whitewashed).

## TL;DR

**Wire 1 of 7. Hold 6.** The Build-76 footprint was deliberately shipped display-only, and that call holds for almost all of it: most `enriched.*` fields are **compliance disclosures, counts without penalty-dollars, or double-counts of signals we already score** — wiring them as-is would move 150–450 grades *down* for the wrong reasons (utilities penalized for legal tax timing, electronics brands for filing a mandatory conflict-minerals form, employers for lawful layoff notices). Only **`animalCerts`** is a clean, safe wire, and only as a stance-gated *positive*.

| Dimension | Coverage | Verdict | One-line reason | Drift if wired |
|---|---|---|---|---|
| **animalCerts** | 19 | 🟢 **WIRE (with care)** | Genuine positive signal, stance-gated, baseline can't move, reuses the DEI-badge pattern | 0 baseline · ≤18 personalized (up-only) |
| privacy | 345 | 🟡 hold (care-at-best) | Thin data (⅔ missing breach size) + double-counts existing breach enum/HHS/HIBP | ~100–150 if gap-gated |
| pharmaConduct | 211 | 🔴 hold | Opioid $ already inside labor's Violation-Tracker totals (8/10); Sunshine Act = legal disclosure | ~2 defensible |
| openfdaRecalls | 363 | 🔴 hold | Counts with no $ (R7.1 needs revenue-normalized dollars); B2B device/pharma confound | mis-targeted |
| secTax | 3,418 | 🔴 hold | Single-year GAAP rate is denominator garbage + double-counts the taxAvoidance dealbreaker | 150–450 down (unfair) |
| supplyChain | 872 | 🔴 hold | All-`true` *compliance* flag (Form SD), no severity gradient; real signal (`uflpaListed`) = 0 brands | downgrades whole categories |
| laborWages | 48 | 🔴 hold | WARN notices = lawful layoffs, not violations; single-state (TX) bias; double-counts labor | invalid |

## The one wire — `animalCerts` (Certified Vegan / Certified Humane)

**Why it's safe.** `animals` is a *stance* category — excluded from the un-quizzed baseline (`rebake-scoring.mjs:296`, `:462`), so the **frozen R7.1 baseline grades literally cannot move** (`audit-grade-drift.mjs` reports 0 by construction). It only enters a grade for users who set `animalTesting = prefer_not / dealbreaker`. The 19 cert-holders currently fall through to the neutral `50` (the live catalog uses BBFAW vocab the `scoreCat` animals branch doesn't match), so this is **untapped signal, not a double-count**.

**Proposed implementation** (client-only, mirrors the shipped `deiEvidence` recognition-promotion at `App.jsx:621`):
1. Add `animalCertEvidence(co)` → true when `enriched.animalCerts.certifications` is non-empty.
2. In `App.jsx` `scoreCat` animals branch: when the user is stanced **and** `sc.animals` is neutral/na, promote → `prefer_not: 88`, `dealbreaker: 92` (below the company-wide `cruelty_free = 97/100` path — a product-line cert is bounded evidence).
3. **Critical guard:** only promote when `sc.animals` is *not* negative/poor. (`cal-maine-foods` holds a humane cert on one line but sits at `animals = negative` on BBFAW — a naive cert→positive would whitewash a known bad actor; the negative record must win.)
4. Mirror the branch in `audit-grade-drift.mjs`'s `scoreCat` copy; no baked-engine/index-entry math change, no `csc.animals` change. Run the per-category test + `audit-grade-drift.mjs` in the same commit (rule #16).

**Drift:** 0 baseline; ≤18 brands for stanced users, positive-only, no A→F cliffs (e.g. Trader Joe's / Organic Valley / Vital Farms tick upward near a threshold). Well under the 200 bar.

## Why the other six are holds (and what would change that)

- **secTax (3,418):** a single fiscal-year GAAP effective rate is dominated by denominator artifacts (666 negative, 584 zero, min −3466%, max 185%); only ~1,579 are even interpretable. A "taxAvoidance" dealbreaker already occupies this slot (`App.jsx:965`), and the *correct* avoidance signal is ITEP's **multi-year cash** rate (`enriched.tax`, currently 0 coverage), not this. Wiring it drifts 150–450 brands down, concentrated in capital-intensive sectors where low rates are legitimate. **Future path:** populate ITEP `enriched.tax` (multi-year cash + zero-tax-year count) and score *that*, not GAAP.
- **supplyChain (872):** realized data is a single all-`true` binary — a *mandatory* SEC Form SD §1502 filing (filing = compliance). No penalty dollars, no severity gradient. The scoreable field, `uflpaListed` (DHS forced-labor), landed on **0 brands** (entities unmapped). **Future path:** map the UFLPA supplier entities → brands; *that* flag is a real hard-labor negative.
- **openfdaRecalls (363):** counts-only with no dollars (R7.1 severity = $-as-share-of-revenue), revenue exists for only 13.5%, and the tail is B2B device/pharma (Medline 1,222, Cardinal Health, Medtronic) where recalls are routine FDA hygiene. **Future path:** a recency-windowed, Class-I-weighted, volume-normalized score on the *consumer-food* subset.
- **privacy (345):** ⅔ of breach records have null `maxAffected`; breach data already partly feeds the privacy enum (25 of 76 scored + HHS OCR + a dormant HIBP field). **Care-at-best path:** a narrowly *gap-gated* (`classifyCategory == neutral/notDisclosed` only), narrative-weight (0.75), floor-at-20 salvage filling the 249-company gap — ~100–150 mostly "?"→C/D moves. Honest default is still hold.
- **pharmaConduct (211):** opioid-settlement dollars are **already inside** the labor `negativeSeverityScore` totals for 8/10 defendants (McKesson, Cardinal, CVS, Walmart, Kroger…); only Teva + Allergan are non-redundant (2 brands → "?"→D). Sunshine Act payments are a legal transparency disclosure that tracks R&D, not wrongdoing. **⚠️ Entangled with B-67:** those labor totals are Good Jobs First data being stripped, so don't build a scoring dependency on the overlap until B-67 settles.
- **laborWages (48):** WARN notices are *advance layoff* filings (WARN-Act compliance), not violations; the real violation feed (DOL WHISARD) is empty; the live data is single-state (Texas). Double-counts 19 already-scored brands and invents a labor negative for 29 others. Not a fair signal.

## Sequencing & cross-links

- **B-67 first for the entangled pair.** Don't touch pharmaConduct/laborWages scoring until the GJF strip (B-67) resolves the labor Violation-Tracker totals they overlap.
- **animalCerts has no rebake dependency** (client-only, baseline-neutral) — it can ship independently of B-63/B-67/the next iOS build.
- If/when product wants a real **tax** or **product-safety** axis, the redesign paths above are the defensible routes (ITEP cash rate; recency/Class-I/volume recalls) — both are new B-23-follow-up sub-tasks, not wires of the current fields.

## Recommendation

1. ~~**Approve `animalCerts`**~~ ✅ **DONE** — client-only stance-gated promotion (88 prefer-not / 92 dealbreaker) with the negative-enum guard + `acertB` index flag, verified end-to-end.
2. **Keep the other 6 display-only** — the footprint card already surfaces them honestly; scoring them as-is is a reputational/fairness liability for a paid ethics app.
3. **Log two follow-up sub-tasks** for the genuinely-salvageable signals: ITEP multi-year cash tax, and a consumer-food recall score (recency + Class-I + volume).
