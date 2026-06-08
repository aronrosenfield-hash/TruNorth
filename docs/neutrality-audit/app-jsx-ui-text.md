# UI-Text Neutrality Audit — src/

**Date:** 2026-06-08
**Branch:** `feature/neutrality-audit-ui-text`
**Scope:** All user-facing strings under `src/` — `App.jsx` (6,622 lines), `OnboardingFlow.jsx`, `MarketingLanding.jsx`, `SplashScreen.jsx`, `PrivacyPolicy.jsx`, `components/ConfirmModal.jsx`, `lib/fingerprint.js`.
**Principle applied:** "Journalism, not opinion." Every user-facing string must be defensible to both left- and right-leaning users.

---

## Headline numbers

- **~5–6 surfaces scanned** containing user-facing strings (counts in roughly the low thousands of strings; only ~30 were materially evaluative).
- **CRITICAL auto-fixes applied:** 6
- **MAJOR cases flagged (not auto-fixed):** 6
- **TONE issues flagged:** 1

The codebase is already strongly oriented toward neutrality. Most editorial cleanup has been done in prior phases (Phase 4.11 "display layer reports FACTS, not verdicts"; Phase 5.aj BDS / firearms factual reframings; Phase 5.ah ownership badges as positive signals only; the source-list copy is rigorously factual). The remaining issues are concentrated in two surfaces: the **Values Fingerprint archetype blurbs** (`src/lib/fingerprint.js`) and a handful of grade-legend / weekly-changes captions in `App.jsx`.

---

## CRITICAL auto-fixes applied

All edits preserve component shape and only mutate string literals. No functional changes.

### 1. `src/lib/fingerprint.js:31` — "polluter" framing

**Before:**
```
"You'd skip a deal to skip a polluter. Environment is your top filter."
```

**After:**
```
"Environment is your top filter. EPA enforcement and emissions records weigh heavier than price."
```

**Why:** "Polluter" is a pejorative used to characterize specific companies the user would presumably avoid. The replacement names the actual data sources (EPA enforcement, emissions records) and removes the implied moral judgement.

---

### 2. `src/lib/fingerprint.js:49` — "bad-actor brands"

**Before:**
```
"You don't post about it, but you quietly route around bad-actor brands."
```

**After:**
```
"You don't post about it, but you quietly route around brands with poor records on the categories you care about."
```

**Why:** "Bad-actor" is editorializing. The replacement points at the user-defined record (their categories of concern) rather than asserting brands are bad actors.

---

### 3 & 4. `src/lib/fingerprint.js:70–80` — asymmetric political archetype blurbs

**Before:**
```
"Progressive politics drives your shopping — environment, labor, and DEI all rank high."
"You prioritize American jobs, faith-friendly brands, and traditional values."
```

**After:**
```
"Your shopping aligns with left-leaning priorities — corporate donations, lobbying disclosures, and policy positions all factor into your grades."
"Your shopping aligns with right-leaning priorities — corporate donations, lobbying disclosures, and policy positions all factor into your grades."
```

**Why:** This was the single most egregious neutrality issue in the entire UI. The two political archetypes were structurally **asymmetric**:
- The progressive blurb named policy CATEGORIES the user cares about (environment, labor, DEI) — factual.
- The conservative blurb named specific cultural-attribute signifiers ("American jobs," "faith-friendly," "traditional values") which are (a) a much narrower / more loaded characterization of "conservative shopping," (b) presupposes any conservative cares about all three of those specifically, and (c) is not parallel in form to the progressive description.

Both now share an identical structural template: "Your shopping aligns with [left/right]-leaning priorities — corporate donations, lobbying disclosures, and policy positions all factor into your grades." Symmetric, source-grounded, no cultural-signifier baggage on either side.

---

### 5. `src/App.jsx:6529` — F-grade legend

**Before:**
```
"Severe issues across most categories with public-record evidence"
```

**After:**
```
"Substantial negative signals across most categories with public-record evidence"
```

**Why:** "Severe issues" is editorial; "substantial negative signals" is journalism-conventional and matches the rest of the legend's "negative signals" / "positive signals" framing used at B and D grade rows.

---

### 6. `src/App.jsx:5799` — weekly-changes header stats

**Before:**
```
"N grade · M scandal · K recall"
```

**After:**
```
"N grade · M news flag · K recall"
```

**Why:** "Scandal" connotes editorial verdict; the per-item rendering on the same screen already uses "News flag" (the user-facing verbiage was corrected in Phase 5.aj for the item rows, but the header stats line was missed). This brings the header into agreement with the rows.

---

### 7. `src/App.jsx:2065` — labor spectrum label

**Before:**
```
labor: { lo: "Violations", hi: "Clean record", axisType: "universal" }
```

**After:**
```
labor: { lo: "Violations", hi: "No violations", axisType: "universal" }
```

**Why:** "Clean record" implies a verdict ("clean" = morally good). The factual opposite of "Violations" is "No violations" — symmetric, journalism-defensible. Matches the privacy spectrum which already uses "Breaches" / "No breaches" (line 2069). Behavior is unchanged — this is just label text.

---

## MAJOR flagged (NOT auto-fixed — propose for human review)

### M-1. `src/MarketingLanding.jsx:167` — "No outrage" value prop

```
title: "No streaks. No outrage. Just journalism."
body:  "We deliberately don't ship engagement traps. No push spam, no daily-streak hooks, no rage-bait headlines."
```

**Issue:** "Outrage" / "rage-bait" implies competitors are outrage-driven. It's directional editorial framing, even if the underlying product claim (we don't ship engagement traps) is factual.

**Proposed fix:** `"No streaks. No spam. Just journalism."` — drops the loaded word while keeping the value prop intact.

**Why not auto-fix:** Marketing copy hierarchy choice; should be reviewed alongside the landing-page voice strategy. Not a bias risk against any political audience — both sides agree about engagement traps.

---

### M-2. `src/MarketingLanding.jsx:163` — "boycotting" presupposition

```
"Subsidiaries roll up to parents — no more accidentally rewarding the holding company you were boycotting."
```

**Issue:** Presupposes the user is actively boycotting some holding company. Some users will be, but framing all users that way leans activist.

**Proposed fix:** `"Subsidiaries roll up to parents — so you always see the parent company's grade, not just the surface brand."` — same value prop, no boycott framing.

**Why not auto-fix:** Could read as gutting the punch of the value prop; needs marketing review.

---

### M-3. `src/App.jsx:1673` — "Get the verdict"

```
"Scan any barcode in-store. Get the verdict before you pay."
```

**Issue:** "Verdict" carries judicial / judgmental connotations. Mild.

**Proposed fix:** `"Get the grade before you pay."` — direct, factual, matches the rest of the app's language.

**Why not auto-fix:** "Verdict" is widely used in code comments (lines 720, 2009, 2053, 2853, etc.) as the project's internal term for "the grade." User-facing it appears only here. Decide once whether to retire the term from copy.

---

### M-4. `src/lib/fingerprint.js:43` — "supply-chain dignity"

```
"Wages, unions, and supply-chain dignity decide your purchases."
```

**Issue:** "Dignity" is mildly editorial — it asserts a moral frame on labor conditions rather than just naming the data.

**Proposed fix:** `"Wages, union activity, and supply-chain working conditions weigh heaviest in your grades."`

**Why not auto-fix:** Borderline — "dignity" is mainstream journalism vocabulary for labor conditions and is not particularly partisan. Low-priority polish.

---

### M-5. `src/lib/fingerprint.js:55` — "Bunny on the box, every time"

```
"Cruelty-free is a hard line for you. Bunny on the box, every time."
```

**Issue:** "Bunny on the box" is cute but presupposes Leaping Bunny specifically. Some users may avoid testing on cosmetics only, etc.

**Proposed fix:** `"Cruelty-free certification is a hard line for you — Leaping Bunny and PETA marks decide your purchases."`

**Why not auto-fix:** This is brand-voice copy; the playfulness is intentional. Replacement loses warmth.

---

### M-6. `src/App.jsx:6525` — "Best of class — strong on most categories with no major red flags"

```
{ grade:"A", range:"90–100", desc:"Best of class — strong on most categories with no major red flags" }
```

**Issue:** "Best of class" is a relative claim (best vs. whom?); "no major red flags" is borderline-OK but uses the loaded "red flag" idiom.

**Proposed fix:** `"Top tier — strong positive signals across most scored categories"` — neutral, doesn't claim superlative, parallel to the rest of the legend.

**Why not auto-fix:** "Best of class" + "red flags" are widely used industry idioms; the change is a polish choice not a defensibility issue. Defer to marketing/copy review.

---

## TONE issues

### T-1. Marketing landing — overall framing

`MarketingLanding.jsx` opens with `"Built for people who actually want answers."` and uses lines like `"Most ethical shopping tools are vibes-based."` While not biased against any political audience, the cumulative voice carries a slight "we're the smart ones" register that could land as preachy on some readers. Not a CRITICAL issue and not flagged for fix — noting for tone awareness alongside any next-pass marketing rewrite.

---

## Surfaces that scanned clean (no findings)

These contain user-facing copy but no defensibility issues were found:

- **`src/OnboardingFlow.jsx`** — 3 onboarding slides, 9 category cards. Category descriptions are exemplary: "FEC: PAC contributions to parties," "Sells or manufactures guns" (factual, no editorializing). Headlines ("Your wallet is a vote") are aspirational but not partisan.
- **`src/SplashScreen.jsx`** — minimal logo + tagline.
- **`src/PrivacyPolicy.jsx`** — boilerplate privacy language.
- **`src/components/ConfirmModal.jsx`** — modal infra, no string content.
- **`src/App.jsx` quiz copy (lines 425–504)** — Already neutrality-audited per code comments (Phase 5.ai). "No preference" replaces "Don't care"; politics is intentionally screen 3; "Mixed" option exists for cross-cutting voters. Quiz subs use neutral framing on every politicized axis ("Workplace diversity programs" — not "DEI," "Labor unions" — not "Big Labor," etc.).
- **`src/App.jsx` getDisplay() factual labels (lines 728–806)** — Outstanding. Every per-category badge label is a factual claim ("Donates to Democrats (US)," "Sells Firearms," "CEO Pay Ratio >300:1," "Cruelty-Free Certified") — no editorializing.
- **`src/App.jsx` SOURCES_DATA (lines 3920–4070)** — All source descriptions are factual. The single appearance of "polluters" is in the verbatim name of an annual report ("Break Free From Plastic Annual Brand Audit ranks top plastic polluters globally") — that's the actual report title, not editorial framing.
- **`src/App.jsx` paywall, weekly digest, Brand of the Day, Better-for-your-values** — all use neutral framings ("Worth knowing," "Mixed signal," "Worth a look"). The "Better for your values" callout is the strongest action-frame in the app and correctly says "for **your** values" (user-specific), not "ethical" or "better" (universal claim).

---

## Recommendations

1. **Merge the auto-fixes** in this branch as-is — they're conservative, surgical, and defensible to any reviewer.
2. **Decide on M-3 (verdict → grade)** before launch — internal term is fine, but standardizing one user-facing word reduces ambiguity.
3. **Run M-1 and M-2** by marketing for the landing-page voice; they are the only two findings that could read as one-sided to a politically-conservative visitor.
4. **Leave M-4 / M-5 / M-6 for a follow-up copy polish pass** — none risks neutrality, all are voice/style choices.

---

## Files touched in this audit

- `src/lib/fingerprint.js` — 4 archetype blurb edits
- `src/App.jsx` — 3 edits (grade-F legend, weekly-changes header stats, labor spectrum hi-end label)
- `docs/neutrality-audit/app-jsx-ui-text.md` — this report

Total: **6 critical fixes** across 2 source files, 0 lines of behavior change.
