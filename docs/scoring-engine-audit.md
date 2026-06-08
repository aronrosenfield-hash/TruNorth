# Scoring Engine Audit (PR-1)

**Date:** 2026-06-08
**Author:** PR-1 audit agent
**Purpose:** Map the existing scoring engine so PR-2 (schema/data) and PR-3 (UI/grade math) can be surgical instead of exploratory. Read-only — no code changes.
**Audience:** Owner — readable in 15 minutes.

---

## TL;DR

- The "score block" is **two-layer**: a compact `index.json` row (the bundle) and a richer `public/data/companies/<slug>.json` (the detail). Both carry `sc.<cat>` and `overall`; the bundle additionally carries a pre-computed `excl[]` array so detail/bundle grades match.
- "Neutral", `na`, and "no public record found" are **already excluded** from the grade today, but through three different code paths. The proposed `flags.na` / `flags.notDisclosed` / `flags._inferred` collapses these into a single canonical signal.
- The grade letter is a single function — `scoreGrade(n)` in `src/App.jsx:802-808` — fed by `computeScore(co, profile)` at `:604-700`. Both PR-2 and PR-3 changes funnel through that one site.
- There are **34 distinct `cat` values** across 11,209 companies. The top 14 cover 99 %; the long tail (12 values with ≤4 companies, plus one literal `"na"`) needs normalization in PR-2's applicability map.
- **No existing field is called `flags`** at the per-company top level (verified across 500-sample probe and grep). The closest collision is `industry_flags` (B-15 read-only disclosure pills) — different name, safe.
- iOS ships the data bundle **statically**: `vite build` → `public/data/*` is copied into `dist/`, and `cap sync ios` bundles `dist/` into the .ipa. There is no runtime fetch of production data from the iOS app for the core grade. PR-3's feature-flag toggle therefore requires a fresh TestFlight build to take effect on iOS — confirmed in `scripts/ship-ios.sh:83-88`.

---

## 1. Score-block shape

### 1.1 `public/data/index.json` (the bundle / compact row)

- **Top-level type:** JSON `Array`, 11,209 entries, sorted by `name.localeCompare()` (`scripts/rebuild-bundle-index.mjs:79`).
- **Per-entry shape**, written at `scripts/rebuild-bundle-index.mjs:52-75`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | usually equals `slug`; rare numeric IDs exist (`"47"`) |
| `slug` | string | filename stem of `public/data/companies/<slug>.json` |
| `name` | string | display name |
| `cat` | string | industry bucket — see §4 for full enumeration |
| `init` | string | 2-4 char initials for logo fallback |
| `grade` | string \| undef | letter (currently `undefined` for all in the sample — computed live in App.jsx instead) |
| `score` | number \| undef | likewise, undefined; lives only in detail JSON |
| `overall` | number | un-personalized score 0–100 (always present) |
| `ab`, `ac` | string | hex colors for chip styling |
| `sc` | object | the 9-category enum block, see §1.3 |
| **`excl`** | string[] | category keys with `"No public record found."` in detail narrative |
| `foreignOwned`, `foreignCountry` | bool/string | dealbreaker inputs |
| `antitrust`, `childLabor`, `stillInRussia` | bool | dealbreaker inputs |
| `competitors` | string[] | slug list |
| `logoUrl` | string \| null | external logo CDN |
| `hasRecall`, `recallSeverity` | bool/number | derived from `recalls.recalls` |
| `bdsListed` | bool \| undef | BDS list membership |

Notable: there is **no `flags` field** on bundle entries today. The bundle is the load-bearing object — 280 K `computeScore` calls per Top Picks render (per comment at `src/App.jsx:5817`), so anything PR-2 adds here ships in the gzipped JS bundle.

### 1.2 `public/data/companies/<slug>.json` (the detail file)

Sampled apple, walmart, patagonia, mondelez-international, johnson-and-johnson. All 5 share these keys:

`name, cat, init, overall, isPublic, ticker, sc, political, charity, environment, labor, dei, animals, guns, privacy, execPay, execPayAPI, ab, ac, dataLastUpdated, competitors, wiki, bbb, secComplaints, payRatio, logoUrl, logoSource, deiBadges, animalCerts, charity_irs990, slug, news, products, storeFootprint, recalls, origin, ownership, environment_ejscreen, ownership_wikidata, privacy_hibp_breaches, litigation_courtlistener, labor_dol_whd, violationTracker, fec, sec, osha, nlrb, epa, lastUpdated, firearms_atf_ffl, cpsc, doj`

Brand-specific optional keys observed: `laborAPI`, `antitrust`, `childLabor`, `stillInRussia`, `enriched`, `hhsOig`, `cfpb`. (Patagonia is missing many because it's a private company with sparser SEC/litigation data.)

Per-category subobjects (`co.political`, `co.charity`, ...) carry: `s` (narrative string), `sources[]`, plus category-specific structured fields (`amt`, `lean`, `rating`, `verdict`, `ratio`, etc.). Apple's `political` for example:
```json
"political": { "s": "FEC: $25K PAC donations; 68% to Republican…", "amt": "$29K PAC (2026 cycle)", "lean": "Right", "sources": ["FEC.gov"], "fecData": {…} }
```

**Critical finding — `excl` lives only in the bundle, not the detail file.** All 5 sampled detail JSONs have `excl: undefined`. The bundle has it; the detail derives the same exclusion at runtime via the narrative check at `src/App.jsx:670`. PR-2 must decide whether the new `flags` field lives in detail-only, bundle-only, or both. **Recommendation: write `flags` to detail and copy it into the bundle in `rebuild-bundle-index.mjs`**, mirroring how `excl` works today (computed from detail narrative, baked into bundle).

### 1.3 The `sc` block — 9 categorical enums

Always present, always 9 keys, always one of a fixed enum. Inferred from samples:

| Key | Observed values |
|---|---|
| `political` | `neutral` \| `bipartisan` \| `left` \| `right` \| `mixed` |
| `charity` | `neutral` \| (positive/negative/mixed/excellent — narrative-graded) |
| `environment` | `neutral` \| `poor` \| `good` \| `mixed` \| `excellent` \| etc. |
| `labor` | `neutral` \| `poor` \| `good` \| `mixed` \| `excellent` \| `very poor` |
| `dei` | `neutral` \| `pro_dei` \| `anti_dei` \| `mixed` |
| `animals` | `na` \| `cruelty_free` \| `tests_animals` \| `some_testing` |
| `guns` | `neutral` \| `no_guns` \| `sells_guns` \| `makes_guns` |
| `privacy` | `na` \| `neutral` \| `good` \| `mixed` \| `poor` |
| `execPay` | `na` \| `neutral` \| `fair` \| `good` \| `mixed` \| `poor` |

The full enum mapping to numeric 0-100 lives in `scoreCat()` at `src/App.jsx:535-591`.

### 1.4 `public/data/_meta/brand-parent-map.json`

- Type: JSON object, 4,626 entries (including one `_doc` documentation key).
- Per-entry shape: `{ "<sub-brand-key>": { "parent": "<parent-slug>", "confidence": "high"|"medium", "source": "curated"|"wikidata" } }`.
- Sample: `"365": {"parent":"whole-foods","confidence":"high","source":"curated"}`.
- Built by `scripts/build-brand-parent-map.mjs` from curated lists + Wikidata SPARQL.
- **No interaction with the score block.** This file maps consumer sub-brand → parent for the `resolveBrand()` lookup in `src/App.jsx:127`. PR-2 / PR-3 do not need to touch it.

---

## 2. `computeScore()` + `applyOverlay()` + grade letter

### 2.1 The full pipeline (live, every render)

```
co.sc.<cat> (enum)
   → scoreCat(k, v, profile)        [App.jsx:535-591]   → 0..100 (profile-tuned)
   → applyOverlay(co, k, baseline)  [App.jsx:598-602]   → +/- delta from co.scoring_overlay
   → weighted sum across categories [App.jsx:643-676]   → ws (0..100)
   → minus dealbreaker penalties    [App.jsx:680-696]   → final 0..100
   → scoreGrade(n)                  [App.jsx:802-808]   → "A".."F"
```

### 2.2 What counts toward the grade

`computeScore()` at `src/App.jsx:604-700`. The category loop at `:643-676`:

```
for (const k of CAT_KEYS) {
  const v = co.sc[k];
  if (getDataState(k, v) === "unknown") continue;       // line 645
  const lv = String(v || "").toLowerCase();
  if (lv === "neutral") continue;                        // line 647
  if (lv === "na" || lv === "n/a") continue;            // line 653 (incl. NA_IS_FACTUAL)
  if (Array.isArray(co.excl) && co.excl.includes(k)) continue;  // line 668
  const detailObj = co[k] || {};
  if (/^\s*no public record found\.?\s*$/i.test(String(detailObj.s || ""))) continue;  // line 670
  const catScore = applyOverlay(co, k, scoreCat(k, v, profile));
  weightedSum += catScore * baseWeights[k];
  weightUsed  += baseWeights[k];
}
```

So **5 exclusion gates today**, all collapsing to "skip this category":
1. `getDataState() === "unknown"` (null/empty/`?`/`unknown`)
2. `lv === "neutral"`
3. `lv === "na"` or `"n/a"`
4. bundle-baked `co.excl[]` contains the key (the "Top Picks grade-flicker bug" fix from 2026-06-04)
5. detail narrative literally equals `"No public record found."`

**This is exactly the substrate PR-2 wants to formalize.** The proposed `flags.<cat>.na` / `flags.<cat>.notDisclosed` collapse gates 3-5 into a single canonical field. Gates 1 and 2 stay as-is (truly missing vs. genuinely neutral).

### 2.3 The fallback when nothing scored

`src/App.jsx:679`: `const ws = weightUsed > 0 ? weightedSum / weightUsed : (co.overall || 50);` — if every category was excluded, fall back to the **un-personalized `overall`** baked into the file (or 50 as last resort).

### 2.4 Dealbreakers (apply after the weighted sum)

`src/App.jsx:680-697` — flat 15-30 point penalties for: bad category state, `forcedLabor`, `taxAvoidance`, `predatoryPrice`, `darkPatterns`, `foreignOwn`, `monopoly`, `childLabor`. `animalTesting === "dealbreaker"` is a hard cap at 30 if `sc.animals === "tests_animals"` (line 698).

### 2.5 The grade-letter math

`src/App.jsx:802-808` — pure step function:

```
function scoreGrade(n) {
  if (n >= 75) return "A";
  if (n >= 62) return "B";
  if (n >= 48) return "C";
  if (n >= 35) return "D";
  return "F";
}
```

PR-3's "grade-letter calculation update" — denominator = `total categories MINUS na+notDisclosed` — **does not change `scoreGrade()`**. It changes the **numerator and denominator of `weightedSum / weightUsed`** at `App.jsx:679`. Today, `weightUsed` is already implicitly the denominator after `na`/`neutral`/`excl` exclusion. PR-3's change is therefore: continue excluding `flags.<cat>.na`/`notDisclosed` (no behavior change) but explicitly label them in the UI. The math is already correct.

### 2.6 `applyOverlay()` — the B-23 sidecar

`src/App.jsx:598-602`:
```
function applyOverlay(co, k, baseline0to100) {
  const ov = co.scoring_overlay?.[k];
  if (!ov || typeof ov.delta !== "number") return baseline0to100;
  return Math.max(0, Math.min(100, baseline0to100 + ov.delta));
}
```

Numeric (-15..+15) delta, applied to numeric categories only (`environment`, `labor`, `privacy`, `execPay`). Categorical categories (`political`, `animals`, `guns`, `dei`, `charity`) get `events_agg` instead, and `excl_stale[]` flags inconsistencies. See `scripts/rebake-scores-from-events.mjs:74-77` for the split.

`scoring_overlay` is the **closest existing analogue** to PR-2's `_inferred` flag. Recommendation: PR-2's `_inferred: true` should NOT coexist with a `scoring_overlay.<cat>.delta` — they answer different questions (inferred from sector vs. delta from recent events). Document this clearly in PR-2's reflag script.

### 2.7 Current behavior for missing data

- `co.sc[k]` is `null`/missing/`unknown` → `getDataState()` returns `"unknown"` (`:528-531`), excluded from grade, rendered as a greyed-out "No data" row at `:2340`.
- `co.sc[k]` is `"na"` AND k is in `NA_IS_FACTUAL = {animals, guns, privacy, execPay}` (`:526`) → `getDataState()` returns `"scored"` (it's a real factual answer for those categories), but **`computeScore` still skips it at `:653`**. So the display layer shows a badge ("Not Applicable", "No gun sales"), but it doesn't move the grade.
- `co.sc[k]` is `"na"` for any other category → `"unknown"` (`:531`).

This is the existing "graceful degradation" that PR-3's UX builds on. The proposed `flags.<cat>.na: true` is essentially renaming what's currently encoded as `sc.<cat> = "na"` for `NA_IS_FACTUAL` plus extending it to all 9 categories.

---

## 3. App.jsx render path for scores

Three render sites matter for PR-3:

### 3.1 Overall grade letter circle (the big YUKA hero badge)

`src/App.jsx:2715-2735` (inside `CompanyCard`'s expanded view). The colored circle showing `A`/`B`/`C`/`D`/`F`. Driven by:
- `:2408` `const ps = computeScore(enriched, profile);`
- `:2409` `const grade = scoreGrade(ps);`

```jsx
2724  const gc = gradeColors[profile ? grade : "?"];
2725  return (
2726    <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18, padding:"14px 14px 16px", … }}>
2727      <div style={{ width:78, height:78, borderRadius:"50%", background:gc.bg, border:`3px solid ${gc.border}`, … }}>
2728        <div style={{ fontSize:38, fontWeight:800, color:gc.text, lineHeight:1 }}>
2729          {profile ? grade : "?"}
…
2739      <div style={{ fontSize:22, fontWeight:700, color:T.txt, lineHeight:1.1 }}>{ps}<span style={{ fontSize:14, color:T.txt3, fontWeight:500 }}>/100</span></div>
```

PR-3 changes here are **transparent** if the grade math stays the same (§2.5). No code edit needed at this site.

### 3.2 Per-category chip / row — `CategoryRow`

`src/App.jsx:2293-2390`. This is THE site PR-3 modifies. The current "no data" path at `:2304, 2329, 2340-2342, 2381-2385`:

```jsx
2293  function CategoryRow({ cat: k, enriched, profile }) {
2294    const [expanded, setExpanded] = useState(false);
2295    const v = enriched.sc?.[k];
2296    const d = enriched[k] || {};
2297    const state = getDataState(k, v);
…
2304    const isUnknown = !isBadge && state === "unknown";
…
2329    const rowDimmed = isUnknown || (isBadge && badgeIsUnknown);
2330    return (
2331      <div style={{ marginBottom:10, paddingBottom:10, borderBottom:`1px solid ${T.border}`, opacity: rowDimmed ? 0.7 : 1 }}>
…
2340           {rowDimmed && <span style={{ fontSize:11, color:T.txt3, fontStyle:"italic", marginRight:6 }}>No data</span>}
…
2382           <div style={{ fontSize:11, color:T.txt3, fontStyle:"italic" }}>
2383             No public record found yet. This category is excluded from the overall grade.
2384           </div>
```

PR-3 inserts new branches here: check `enriched.flags?.[k]?.na`, `.notDisclosed`, `._inferred` BEFORE the existing `isUnknown` branch, and render the per-category label from the matrix in the plan doc. The dimming and "excluded from grade" copy already exists — PR-3 specializes it.

Rendered for all 9 categories via the loop at `:2858-2865`:
```jsx
2858  {CAT_KEYS.map(k => (
2859    <CategoryRow key={k} cat={k} enriched={enriched} profile={profile} />
2860  ))}
```

### 3.3 Top Picks ranking

`src/App.jsx:4880-4888` — **curated** list of ~50 slugs, not gated on "3+ categories filled":

```js
4880  const topPicksRanked = useMemo(() => {
4881    const idx = new Map(deduped.map(c => [c.slug, c]));
4882    return TOP_PICKS_CURATED
4883      .map(slug => idx.get(slug))
4884      .filter(Boolean)
4885      .map(c => ({ co: c, score: computeScore(c, profile) }))
4886      .sort((a, b) => b.score - a.score)
4887      .map(({ co }) => co);
4888  }, [deduped, profile]);
```

**Finding that affects PR-3 scope:** The plan's PR-3 deliverable #5 — "Top Picks gate update — current rule is `3+ categories with real data`. Update to `3+ categories that are NOT na AND NOT notDisclosed AND have score`" — **describes a rule that doesn't exist today**. Top Picks is a hand-curated list of ~50 brands (line 4855-4879) ranked by `computeScore`. There is no count-based gate.

The "3+ categories filled" idea may belong elsewhere — perhaps `src/App.jsx:1773` (homepage tile) which filters `c.grade === "A" || c.grade === "B"` and `POPULAR_CATS.has(c.cat)`. Or possibly the implicit count baked into computeScore's denominator. **Recommendation: drop or rewrite PR-3 deliverable #5 — the rule it claims to update is not in the codebase.** If we want a "real-data threshold" for Top Picks visibility, define it from scratch.

---

## 4. The `cat` field taxonomy

Run against `public/data/index.json` (11,209 entries):

```
 1706 Entertainment & Media
 1312 Retail
 1093 Technology
  970 Healthcare
  965 Manufacturing
  864 Food & Beverage
  739 Financial Services
  641 Consumer Goods
  640 Energy
  500 Automotive
  383 Apparel & Fashion
  358 Hospitality
  317 Other
  309 Professional Services
  217 Grocery
   49 Hospitality & Travel
   43 Outdoor
   31 Defense & Aerospace
   17 Beauty & Personal Care
   15 Sports & Fitness
   12 Transportation
    7 Chemicals & Materials
    6 Pet Care
    4 Education
    2 Utilities
    1 Airline
    1 Telecommunications
    1 Utility
    1 na
    1 Agriculture
    1 Furniture & Home
    1 Aerospace
    1 Beverage
    1 Travel
```

- **34 distinct values, 11,209 companies.**
- **Top 13 cover 11,025 companies (98.4 %).** Tail is irrelevant for v1.
- Singletons + duplicates needing normalization in the PR-2 applicability map:
  - `Hospitality` vs `Hospitality & Travel` vs `Travel`
  - `Utilities` vs `Utility`
  - `Airline` (one) → roll into `Transportation`
  - `Telecommunications` (one) → roll into `Technology`
  - `Aerospace` vs `Defense & Aerospace`
  - `Beverage` (one) → roll into `Food & Beverage`
  - `Furniture & Home` (one) → roll into `Consumer Goods`
  - `na` (one company literally has `cat: "na"`) — bug or intentional? Audit before PR-2.

### Recommended PR-2 applicability map (per the plan's signed-off rules)

| Industry (cat) | guns na? | health applicable? | animals na? | other 9 cats |
|---|---|---|---|---|
| Apparel & Fashion | yes | no | no | applicable |
| Automotive | yes | no | yes | applicable |
| Beauty & Personal Care | yes | YES | no | applicable |
| Consumer Goods | yes | partial | partial | applicable |
| Defense & Aerospace | NO (applicable) | no | yes | applicable |
| Energy | yes | no | yes | applicable |
| Entertainment & Media | yes | no | yes | applicable |
| Financial Services | yes | no | YES (na) | applicable; execPay heavily applicable |
| Food & Beverage / Beverage / Grocery | yes | YES | partial | applicable |
| Healthcare | yes | YES | no | applicable |
| Hospitality(+Travel+Airline) | yes | no | yes | applicable |
| Manufacturing | yes | no | partial | applicable |
| Outdoor / Sports & Fitness | NO (applicable) | no | no | applicable |
| Pet Care | yes | partial | no | applicable |
| Professional Services | yes | no | YES (na) | applicable |
| Retail | NO (applicable — many retailers sell guns) | partial | partial | applicable |
| Technology / Telecommunications | yes | no | YES (na) | applicable; privacy heavily applicable |
| Transportation | yes | no | yes | applicable |
| Other / Education / Utilities / Chemicals / Furniture / Agriculture | DEFAULT — applicable to all (safe fallback per plan) |

PR-2 hand-curates this in `public/data/_meta/category-applicability.json`. The plan says "unknown → default to all applicable (safe fallback)" — confirmed safe; the cost of a false-positive `na` is greater than the cost of showing a low-confidence score.

---

## 5. Known overlap risks

### 5.1 Bundle build script — will it preserve a new `flags` field?

**No, not without a code change.** `scripts/rebuild-bundle-index.mjs:52-75` writes a **closed list** of fields to each bundle entry. Any new top-level field on the detail JSON is silently dropped. PR-2 **must** add `flags: co.flags` to that object literal. The plan already calls this out in PR-2 deliverable #5 — confirmed necessary.

### 5.2 Search index build — `public/data/search-index.json`

- Built once and committed (5.7 MB, last touched in commit `17e0c296b`). No active build script in `scripts/` writes this file — it's a MiniSearch serialization (`src/lib/dataSource.js:46`).
- `storeFields: ["id", "slug", "name", "cat", "grade", "score", "init", "ab", "ac", "political"]` (`src/lib/dataSource.js:48`). Used only for typeahead/fuzzy search, not score rendering.
- **No PR-2/PR-3 change required.** When the index is next rebuilt (post-launch), we can add `flags` to `storeFields` if we ever want to filter search results by N/A state. Not needed for v1.

### 5.3 `excl` semantics — anywhere outside the scoring engine?

`grep -n "\.excl\b" src/App.jsx` returns **exactly one hit**: `:668`, inside `computeScore`. It is not read by the quiz, the UI directly, the search, or any cron. **Conclusion: `excl` is purely a scoring-engine optimization (parity between bundle and detail rendering of `"No public record found"`).** It can safely coexist with the new `flags`. Recommendation: **do not deprecate `excl` in PR-2 or PR-3**. Treat `flags` as additive; leave `excl` in place as a belt-and-suspenders compatibility shim that PR-4 (post-launch) can clean up.

### 5.4 Per-company JSON sharding — fixed-schema assumption?

`src/App.jsx:127` (`resolveBrand`) and the merge cascade in `scripts/*-merge.mjs` (15+ scripts) all do shallow-merge `{ ...co, …newFields }` patterns. **They are tolerant of unknown fields** — any new top-level key survives the round-trip. Verified by 500-sample probe: no company has a `flags` key today, and adding one is purely additive.

The one consumer that DOES care about schema is the bundle script (§5.1). Outside of that, the per-company JSON has had ~50 fields added across the project's life without issue.

### 5.5 iOS shipped bundle — does Capacitor bake or fetch?

**Bakes.** Pipeline:

```
scripts/ship-ios.sh:84-88
  npx vite build      # public/data/* → dist/data/*
  npx cap sync ios    # dist/ → ios/App/App/public/
  xcodebuild archive  # everything in ios/App/ → .ipa
```

`capacitor.config.json:webDir = "dist"` confirms it. The iOS app reads `/data/index.json` and `/data/companies/<slug>.json` from the **bundled assets**, not from production. PostHog/crons/news refresh have no live path into the iOS app's grade data.

**Implication for PR-3 feature-flag rollout:**
- Web: env-var toggle flips instantly on Vercel deploy.
- iOS: feature-flag flip **requires a new TestFlight build** to reach users. Per the plan timeline (Jun 16 flag-on, Jun 17 App Store submission), the iOS build cut on Jun 17 will bake the flag-on state. Once submitted, a flag flip *off* requires either another build cycle (24-72h Apple review) OR a remote-config plumbing that doesn't exist today.
- **Recommended PR-3 mitigation:** The web `VITE_SCORING_FLAGS_ENABLED` env var is read at build-time, not runtime. For iOS we have **one shot** — the Jun 17 build must ship with the flag in its final intended state. If we expect to need a kill switch on iOS, add a runtime-readable JSON file in `public/data/_meta/feature-flags.json` that the app fetches lazily AND falls back to bundle. Out of scope for PR-3 itself but worth noting.

### 5.6 Other notable adjacencies

- **`industry_flags`** at `src/App.jsx:2210-2270` (B-15 read-only disclosure pills, e.g. "Tobacco / Fossil Fuel / Firearms Industry / Alcohol"). **Different name from PR-2's `flags`** — no collision. Document the naming distinction in PR-2's PR description so reviewers don't conflate them.
- **`scoring_overlay`** (B-23, §2.6) and **`events_agg`** + **`excl_stale[]`**: All additive sidecars from the news-rebake engine. None of them touch the proposed `flags` field. Safe to ship in parallel.
- **`recent_events[]`**: Source for `scoring_overlay`. Untouched by PR-2/PR-3.

---

## Summary of PR-2 / PR-3 surgical targets

| Site | File | Lines | Change |
|---|---|---|---|
| Reflag write | NEW `scripts/reflag-categories.mjs` | — | Adds `flags` to every `public/data/companies/<slug>.json` |
| Applicability map | NEW `public/data/_meta/category-applicability.json` | — | Hand-curated, ~34 cat values |
| Bundle preservation | `scripts/rebuild-bundle-index.mjs` | 52-75 | Add `flags: co.flags` to entry literal |
| Render — chip | `src/App.jsx` | 2293-2390 | Add `enriched.flags?.[k]` branches BEFORE `isUnknown` |
| Grade math | `src/App.jsx` | 643-676 (computeScore loop) | Gated on `VITE_SCORING_FLAGS_ENABLED`: continue to skip `flags.<cat>.na`/`notDisclosed`; treat `_inferred` as normal |
| Grade letter | `src/App.jsx` | 802-808 | **No change.** The function is pure 0-100 → letter. |

**Total LOC of substantive edits expected:** ~30 in `App.jsx`, ~10 in `rebuild-bundle-index.mjs`, ~200 in the new reflag script. Well under what would justify the 3-PR split — the split is justified by **deploy/rollback granularity**, not LOC.
