# Pre-Launch Scoring Flags — Safe 3-PR Rollout Plan

**Goal:** Ship `na` / `notDisclosed` / `_inferred` per-category flags before Product Hunt launch on Jun 23, 2026.

**Why split into 3 PRs:** This is the most invasive UX change in TruNorth's history. It touches the scoring engine (`computeScore` + `applyOverlay`), 11,209 per-company JSON files, the grade-letter calculation, and the App.jsx render path. The scoring engine agent we spawned tonight (Jun 7) correctly refused to do this as a single PR — too much surface area, too close to launch, too easy to introduce silent grade drift across thousands of brands.

**Strategy:** Land changes incrementally with feature flags so we can deploy each step, observe for stability, and roll back instantly if needed.

---

## Timeline (15 days to launch)

| Date | Phase | Status |
|---|---|---|
| **Jun 8 (today)** | PR-1: Audit + documentation | Start |
| **Jun 9** | PR-1 review + merge | |
| **Jun 10** | PR-2: Schema + data only (no UI change yet) | Start |
| **Jun 11** | PR-2 review + merge + deploy (flag OFF) | |
| **Jun 12-13** | PR-3: UI rendering + grade math (feature-flagged OFF by default) | |
| **Jun 14** | PR-3 review + merge + deploy (flag OFF) | |
| **Jun 15** | QA: toggle flag ON in staging, eyeball every category render | |
| **Jun 16** | Flag ON in production, 24hr stability watch | |
| **Jun 17** | App Store final build cut + submit (1.0.1 if patched) | |
| Jun 18-22 | Buffer / fallback window | |
| **Jun 23** | 🚀 Launch | |

---

## PR-1 — Audit + Documentation (Jun 8)

**Goal:** Map the existing scoring engine so PR-2 and PR-3 changes are surgical, not exploratory.

**Read-only sweep. No code changes. Output: a doc.**

### Deliverables

`docs/scoring-engine-audit.md` documenting:

1. **The current score-block shape** — exact JSON structure of `sc.<cat>`, `excl`, `flags` (if any), `overall`, `grade-letter` per the actual files in `public/data/companies/<slug>.json` and `public/data/index.json`.

2. **The current computeScore() + applyOverlay() implementation** — read `scripts/rebake-scores-from-events.mjs` (the existing rebake engine from commit `d7efc12a3`) and any related files. Document:
   - What inputs feed each category score?
   - How is "neutral" decided vs "good"/"bad"?
   - How does `excl` interact with score calc?
   - Where does grade-letter (A-F) get assigned?
   - What's the current behavior for missing data?

3. **The current App.jsx render path** — find the brand-detail view component, the per-category score chip render, and the grade-letter render. Document the exact files + line numbers.

4. **The current `cat` field taxonomy** — enumerate every distinct value of the `cat` field across all 11,209 companies. We need this to write the industry → applicable-categories map correctly. (E.g., is it "Tech / Software" or "Software" or "Software & Apps"? Need actual values, not guesses.)

5. **Known overlap risks** — flag any code paths that would be affected by adding `flags.<cat>` to the score block:
   - Bundle build script — will it preserve new fields?
   - Search index build — does it need to know about the new flags?
   - Existing `excl` semantics — do we deprecate, replace, or coexist?
   - Per-company JSON sharding — does any consumer assume a fixed schema?

### Acceptance criteria
- All 5 sections complete with file references, line numbers, and current behavior quotations
- No code changes, no new tests, no schema changes
- Reviewable in 15 minutes by the user

**Agent prompt for this PR:** see `/docs/agent-prompts/scoring-audit.md` (to be written if approved)

---

## PR-2 — Schema + Data Only (Jun 10)

**Goal:** Add the new fields to data without changing any user-visible behavior.

### Deliverables

1. **New file: `public/data/_meta/category-applicability.json`**
   - Keys: each distinct `cat` value (from PR-1's enumeration)
   - Values: `{ na: [<cat>...], applicable: [<cat>...] }` per the rules signed off Jun 7:
     - guns: na for any industry except Sporting Goods, Outdoor, Defense, Firearms
     - health: na for any industry except Food & Beverage, Pharma, Cosmetics, Personal Care, Beauty, Restaurants, Tobacco, Alcohol
     - animals: na for non-physical-product industries (Software, Financial Services, Consulting)
     - All others: applicable to all
   - Hand-curated map, reviewed in PR

2. **One-shot reflag script: `scripts/reflag-categories.mjs`**
   - Reads every `public/data/companies/<slug>.json`
   - Looks up the company's `cat`
   - Adds `flags.<category>` block per the applicability map AND per data presence:
     - `na: true` if cat is in the `na` list for this industry
     - `notDisclosed: true` if cat is applicable BUT company has no signal AND meets the not-disclosed criteria:
       - execPay: company has no ticker / no SEC CIK
       - dei: company has < 100 employees flag OR no ESG disclosure file present
       - charity: not in `data/derived/corporate-giving-augment.json`
       - transparency: not in `data/derived/transparency-benchmarks-augment.json` or `data/derived/wikirate-augment.json`
     - `_inferred: true` with `basis: <sector>` if score came from `data/derived/industry-carbon-intensity-augment.json`

3. **Backward-compat preserve:** existing `sc.<cat>` and `excl` fields stay untouched. New `flags` field added alongside. Nothing breaks for current consumers.

4. **Tests** — `scripts/reflag-categories.test.mjs`:
   - Apple gets `flags.guns = {na: true}`, `flags.health = {na: true}`, `flags.execPay` undefined (has CIK)
   - Patagonia gets `flags.execPay = {notDisclosed: true}` (private), `flags.guns = {na: true}`, `flags.health = {na: true}`
   - Walmart gets no `na` flags (general merchandise → all categories applicable)
   - A small private brand gets `flags.dei = {notDisclosed: true}`, `flags.charity = {notDisclosed: true}`, `flags.execPay = {notDisclosed: true}`
   - All 11,209 companies process without throwing
   - Before/after diff: every `sc.<cat>` value identical; only new `flags` field added

5. **Bundle build script update** — preserve the new `flags` field in the compact `index.json` (so the UI can render without fetching full detail). Add to the list of fields written into `index.json` entries.

### Acceptance criteria
- All existing UI behavior unchanged (no visual difference yet — flag fields exist in JSON but nothing reads them)
- Bundle rebuild produces the same companies in the same order
- Reflag script runs in < 60 seconds against all 11,209 companies
- Tests pass; manual spot-check of 10 brands confirms expected flags

### Rollback plan
- If anything breaks: `git revert <commit>` and rebuild bundle. The reflag script's output is purely additive, so reversion is clean.

---

## PR-3 — UI Rendering + Grade Math (Jun 13)

**Goal:** Make the flags visible to users. Behind a feature flag, OFF by default.

### Deliverables

1. **Feature flag: `VITE_SCORING_FLAGS_ENABLED`** (env var)
   - Default: `false` — flags exist in data but UI ignores them, current behavior preserved
   - When `true`: new render + grade calc

2. **App.jsx category-chip render changes** (gated on flag):
   - `flags.<cat>.na === true`:
     - Greyed-out chip, no score circle
     - Label: **"Not Applicable for this Industry"**
     - Excluded from "categories filled" count
   - `flags.<cat>.notDisclosed === true`:
     - Greyed-out chip, no score circle
     - Per-category label:
       - execPay → "Private company — exec comp not publicly disclosed"
       - dei → "Company doesn't publicly disclose workforce composition"
       - charity → "No public giving disclosed"
       - transparency → "Transparency benchmarks not yet evaluated"
     - Excluded from "categories filled" count
   - `flags.<cat>._inferred === true`:
     - Normal score circle with small ℹ️ icon
     - Tooltip: **"Industry typical — based on \<basis\>"** (e.g. "Industry typical — based on Tech / Software")
     - INCLUDED in "categories filled" count (counts toward grade)

3. **Grade-letter calculation update** (gated on flag):
   - Denominator = total categories MINUS `na`+`notDisclosed` count (only count categories that are real or could have been)
   - Numerator counts good/neutral/bad as before
   - `_inferred` scores count normally
   - Tests: every company gets a grade that's consistent with before-flag math when no flags are present

4. **Grade-drift diff report** — `scripts/audit-grade-drift.mjs`:
   - Computes grade for every company with flag OFF vs flag ON
   - Outputs `data/derived/_meta/grade-drift-report.json` listing every company whose grade-letter changes, with reason (which category flipped from neutral-counted to na-excluded, etc.)
   - **Acceptance bar: < 200 companies experience grade drift, and every drift is explainable by a documented na/notDisclosed rule.** If more drift than that, fix the applicability map before merging.

5. **Top Picks gate update** — current rule is "3+ categories with real data." Update to "3+ categories that are NOT na AND NOT notDisclosed AND have score." A tech company with 4 categories `na` should still qualify if it has 3+ applicable categories scored.

6. **Tests**:
   - 5+ snapshot tests across known brands (Apple, Walmart, Patagonia, Shein, Starbucks) showing exact rendered JSX with flag ON
   - Grade-drift report has zero unexplained changes

### Acceptance criteria
- Flag OFF in production: pixel-perfect identical to today's UI. Zero user impact.
- Flag ON in staging: every category renders with the correct label per the matrix above
- Grade drift < 200 companies, all explainable
- No crash, no missing fields, no NaN scores

### Rollback plan
- Three layers:
  1. Toggle env var to `false` (instant rollback, no deploy needed)
  2. Revert the PR commit (clean — JSON data still has flags but ignored)
  3. Run a reverse-reflag script if we want to remove `flags` from JSON entirely (not expected to be needed)

---

## Risks + Mitigations

| Risk | Mitigation |
|---|---|
| Grade drift causes user-visible score changes on launch day | Drift report must be < 200, all explainable. If higher, fix applicability map BEFORE PR-3 merges. |
| `cat` field has more values than expected (e.g., 500+ distinct) | PR-1 enumerates all values first. Applicability map covers every value explicitly; unknown → default to "all applicable" (safe fallback). |
| Bundle build script silently drops `flags` field | Test included in PR-2 that builds bundle and asserts `flags` survives the round-trip. |
| Feature flag accidentally ships ON to production | Default is `false`. Vercel env var must be set manually. Flag flip is a separate deploy commit. |
| iOS app build (TestFlight Build N+1) reads stale data | After flag ON, run `ship-ios.sh` to bundle latest data + flag-on JS into a new TestFlight build. Apple review takes ~24-72hr — submit by Jun 17. |
| User confusion: "why does this brand now show Not Applicable?" | The label is the explanation. UX writing is critical. Optional: a `/help/scoring` page explaining the difference. |
| Existing `excl` semantics conflict with new flags | PR-1 audits this. If `excl` is used elsewhere (e.g., quiz filtering), PR-2 preserves it; PR-3 makes flags ADDITIVE not replacement. |

---

## What we're NOT doing (deferred to post-launch)

- Industry classification refinement (the `cat` field is what it is for v1; we'll do a deep recategorization pass post-launch)
- Per-subsidiary inheritance UI for mixed-portfolio parents (basic mixed-portfolio flag from animal welfare PR #17 ships, but the drill-down UI is post-launch)
- Help/scoring explainer page (a single sentence per N/A state is sufficient for v1)
- "Why this grade" expansion to surface the flag state alongside citations (current "Why this grade" view stays as-is; flag visibility is in the chip itself)

---

## Approval gate

Before starting PR-1, user confirms:
- [ ] Timeline OK (today through Jun 16 for full rollout)
- [ ] Acceptable to ship feature flag OFF on Jun 14 and toggle ON Jun 16 (gives 24hr stability watch before App Store submission Jun 17)
- [ ] Acceptable to revert via env var toggle if anything breaks
- [ ] Acceptable that ~10-200 companies will see slight grade changes (per drift report)

If yes to all four, spawn the PR-1 audit agent today.
