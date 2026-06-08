# Neutrality Audit — Marketing-PNG Renderer Source Files

**Branch:** `feature/neutrality-audit-mockups`
**Date:** 2026-06-08
**Core principle:** "Journalism, not opinion."
**Scope:** Text strings baked into PNG renderers (not the rendered PNGs).
**PH launch:** 2026-06-23.

## Files scanned

| # | File | Status |
|---|---|---|
| 1 | `scripts/_render-itep-mockup.mjs` | Audited — 2 MAJOR flags |
| 2 | `scripts/_render-scanner-mockup.mjs` | Clean (UI mockup only, no editorial copy) |
| 3 | `scripts/_caption-screenshots.mjs` | Clean — all captions factual |
| 4 | `scripts/ph-gallery/build-gallery.mjs` | Audited — 2 MAJOR flags |
| 5 | `scripts/build-egregious-banners.mjs` | READ-ONLY (active dev) — clean renderer (text comes from JSON) |
| 6 | `public/data/_meta/egregious-facts.json` | READ-ONLY (active dev) — 2 MAJOR flags (verbs) |

## Severity counts

- **CRITICAL** (auto-fixed): 0
- **MAJOR** (flagged): 4
- **Read-only egregious findings** (for the other agent): 2

## CRITICAL fixes applied

None. No advocacy framing, no FAIL/EVIL/BAD badge labels, no partisan framing, and no cause-and-effect editorializing remain in the scannable files. The previous itep-mockup cleanup ("shifts the public burden onto households" removed; "FAIL" badge removed) is holding.

## MAJOR cases flagged (not auto-fixed)

### M1 — `scripts/_render-itep-mockup.mjs:327`
**Current:** `<div class="tax-title">Tax Responsibility</div>`
**Concern:** "Responsibility" is value-laden — implies moral duty. The in-app category pill on line 317 of the same file uses the neutral term **"Taxes"**. The mockup is therefore inconsistent with the app and editorializes by section title.
**Suggested neutral replacement:** "Federal Tax" or "Taxes" (matches in-app category).

### M2 — `scripts/_render-itep-mockup.mjs:328`
**Current:** `<div class="tax-grade-mini">0% RATE</div>` (rendered as red pill, identical color to the D grade circle and red category dot)
**Concern:** Borderline. The text "0% RATE" is the literal statistic — neutral as text. However, rendering it as a red pill in the same shade as the D-grade circle and the red category dot functions visually like a verdict / FAIL-style label. The user-flagged precedent ("FAIL" already fixed) suggests stripping verdict-style red pills from stat badges where the stat itself is already shown on the next line ("$0 federal tax paid" + "Effective federal rate: 0.0%").
**Suggested neutral replacement:** Drop the red pill entirely, OR change pill color to neutral gray (`#222`/`#444`) with white text — keep the "0% RATE" copy.

### M3 — `scripts/ph-gallery/build-gallery.mjs:142, 282`
**Current:** `"Grade any brand on what it actually does."`
**Concern:** "What it **actually** does" carries an implicit contrast — implies other graders rate brands on something else (claims, marketing, vibes). Mildly editorial / competitive framing.
**Suggested neutral replacement:** `"Grade any brand on public-records data."` or `"Brand grades from public-records data."`

### M4 — `scripts/ph-gallery/build-gallery.mjs:247`
**Current:** `"No surveys. No vendor self-reports. Just the receipts."`
**Concern:** Factual + brand-voice line. "The receipts" is a metaphor that's defensible (it's referencing primary-source citations), but combined with the dual negation it leans rhetorical / competitive vs. neutral.
**Suggested neutral replacement:** `"Built on primary public records — not surveys or vendor self-reports."` Optional — current copy is borderline acceptable.

## Read-only findings — egregious files (for the other agent)

The other agent is expanding `egregious-facts.json` from 5 → 30 brands and rebuilding the renderer. These verb-level issues should be addressed during that pass:

### R1 — `public/data/_meta/egregious-facts.json:29` (Amazon)
**Current:** `"Amazon was hit with 785 California carcinogen-warning notices in the last 12 months."`
**Issue:** "Hit with" is a slightly editorial verb (implies victimization or beating).
**Suggested replacement:** `"Amazon received 785 California Prop 65 carcinogen-warning notices in the last 12 months."`

### R2 — `public/data/_meta/egregious-facts.json:44` (Colgate-Palmolive)
**Current:** `"Colgate-Palmolive failed to publish results for 18 of 35 clinical trials (5% compliance)."`
**Issue:** "Failed to" implies an obligation was breached. Even where regulatory disclosure norms exist, "did not publish" is the neutral journalistic form.
**Suggested replacement:** `"Colgate-Palmolive has not published results for 18 of 35 clinical trials."`
**Bonus catch:** The "(5% compliance)" parenthetical appears mathematically off — 17/35 published ≈ 49%, not 5%. Recommend the other agent double-check the source figure against FDAAA TrialsTracker before re-rendering.

### R3 — `scripts/build-egregious-banners.mjs` (general)
**Status:** Renderer itself is clean. All editorial text is read from JSON (`fact.statKicker`, `fact.context`, `fact.shortContext`, `fact.source`). No hard-coded advocacy strings in the SVG generators. Once R1 + R2 are fixed in the JSON, the renderer needs no changes.

## What was not touched

- Egregious files (active development — other agent owns).
- All MAJOR items above (flag-only per audit rules).
- No PNGs were re-rendered. User must re-run the relevant scripts after reviewing MAJOR fixes.

## Recommended next steps

1. User decides on M1/M2 (itep-mockup) — these are the highest-signal flags because the ITEP mockup is being sent directly to Amy Hanauer at ITEP.
2. User decides on M3/M4 (PH gallery copy) before re-rendering for the 2026-06-23 launch.
3. Other agent applies R1/R2 to `egregious-facts.json` during the 5 → 30 expansion.
