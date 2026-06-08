# Per-Company Narrative Neutrality Audit

**Scope:** All `public/data/companies/<slug>.json` files — every per-category narrative field a user can see in the app's "Why this grade?" view.

**Date:** 2026-06-08 (pre-PH-launch audit, T-15 days)
**Branch:** `feature/neutrality-audit-narratives`
**Auditor:** automated scan + manual review of every hit.

---

## TL;DR

**The user-facing narrative corpus is already clean.** Zero CRITICAL editorial phrases and zero MAJOR editorializing adjectives were found in any field a user actually reads. The data pipeline emits factual templated strings only ("FEC: $X PAC donations; Y% to Republican, Z% to Democratic committees", "N federal penalties totaling $X since 2000 (Violation Tracker).", etc.).

No auto-fixes were applied because none were warranted. All scanner hits resolved to either (a) third-party verbatim text we already exclude from review, (b) legal ATF license category names ("Destructive Devices" = ATF Type 10), or (c) a proper noun (rapper Eminem's record label "Shady Records").

The PH-launch positioning — "journalism, not opinion" — is currently defensible across the entire 11,260-company corpus on the narrative-text axis.

---

## Scope and methodology

**Files scanned:** 11,260 `public/data/companies/*.json`.

**Fields covered:** Every string value in each file. Per the brief, the user-visible narrative surface is:

- `political.s`, `environment.s`, `labor.s`, `dei.s`, `animals.s`, `guns.s`, `privacy.s`, `execPay.s`, `charity.s`
- Plus generic narrative-ish keys: `narrative`, `summary`, `description`, `whyGrade`, `_note`.

A separate sweep covered ALL string values in every file (not just `.s`) to make sure nothing slipped through unusual field names.

**Exclusions (third-party verbatim text — out of scope for editorial cleanup):**
- `wiki.controversies`, `wiki.extract`, `wiki.description` (Wikipedia text)
- `enriched.secLitigation.*`, `secLitigation.sampleReleases.*` (verbatim SEC press releases)
- `cpsc.sampleRecalls.*`, `cpsc.topHazards.*` (verbatim CPSC recall titles)
- `doj.recentReleases.*` (verbatim DOJ press-release snippets)
- `hhsOig.exclusionSample.*` (verbatim HHS OIG exclusion records)
- `enriched.oshaSevereInjury.sampleRecords.*` (verbatim OSHA SIR narratives)
- `asYouSow.*` lists, `litigation_courtlistener.cases.*`, `news.*` headlines
- `violationTracker.primaryOffenses[].category` (e.g., "consumer protection violation" — official Violation Tracker label)

**Patterns scanned (regex, case-insensitive):**

CRITICAL (auto-fix candidates): `shifts? the burden`, `burden onto`, `burden on famil(y|ies)`, `exploits? (workers|customers|consumers)`, `screws? over`, `preyed upon`, `preys? on (workers|consumers|customers|families)`, `deserves to know`, `deserves better`, `worst offender`, `ringleader`, `(extreme|extremist) (right|left|partisan)`, `radical (right|left|partisan|ideolog)`, `ideological\w*`, `anti-worker`, `anti-environment`, `anti-consumer`, `greedy|shady|shadowy`, `slapped with`, `evade.*(tax|regulation|oversight)`.

MAJOR (propose-only): `egregious`, `shameful`, `outrageous`, `appalling`, `harmful`, `irresponsible`, `negligent`, `destructive`, `destroy(ed|ing)`, `wipe(s|d) out`, `leaving (workers|customers|families|consumers) without`.

MINOR (note-only): `controversial`, `problematic`, `troubling`, `concerning`.

---

## Findings summary

| Severity | Hits | True positives | False positives | Auto-fixed |
|---|---:|---:|---:|---:|
| CRITICAL | 2 | 0 | 2 | 0 |
| MAJOR | 35 | 0 | 35 | 0 |
| MINOR | 2 | 0 | 2 | 0 |
| **Total** | **39** | **0** | **39** | **0** |

**Unique narrative-`.s` strings audited:** 2,484 (over 101,295 non-empty `.s` field occurrences).
**Distribution check:** 96.6% of all non-empty `.s` occurrences are the literal templated phrase `No public record found.` — i.e., neutrality-by-default is already enforced upstream by the data pipeline.

### Templated narrative families observed in `.s` (all neutral-by-construction)

- `No public record found.` / `No FEC PAC contributions on record.` / `No FEC PAC data found.`
- `FEC: $X PAC donations; Y% to Republican, Z% to Democratic committees.`
- `<offense category> violation: $X in federal penalties (Violation Tracker).`
- `N federal penalties totaling $X since 2000 (Violation Tracker).`
- `1 documented breach affecting N accounts (HIBP); latest breach YYYY-MM-DD.`
- `Federal <type> violation resulted in $X penalty; documented enforcement action on record.`
- `Charity gap: <fact>.` / `Limited public charity disclosure.`
- N/A boilerplate for non-applicable categories ("Fine art retailer; firearms not a product line.", "Privately held; executive compensation data not public.", etc.)

None of the 2,484 unique strings contain editorial framing, judgmental adjectives, or partisan characterization. Every string is either (a) raw counts/dollar amounts plus the source name in parens, (b) a neutral "no data" statement, or (c) a neutral N/A explanation.

---

## CRITICAL findings (auto-fix candidates)

**None applied. Both hits are false positives:**

1. `shady-records.json :: name` = `"Shady Records"` — proper noun (Eminem's record label, founded 1999). Not editorial. **No action.**
2. `shady-records.json :: slug` = `"shady-records"` — derived from the proper noun above. **No action.**

---

## MAJOR findings (proposed fixes, for human review)

**None applied. All 35 hits are false positives:**

All matches for `\bdestructive\b` (35 hits across 19 files: `aerovironment`, `am-general`, `bae-systems-inc`, `bell-textron`, `boeing`, `browning-arms-company`, `bwx-technologies`, `byrna-technologies`, `colt-s-manufacturing-company`, `dunham-s-sports`, `federal-cartridge`, `leidos`, `lockheed-martin`, `md-helicopters`, `olin-corporation`, `saic`, `sig-sauer-inc`, `sturm-ruger-and-co`, `walmart`) occur in `firearms_atf_ffl.fflTypeNames[]` and are the verbatim ATF Federal Firearms License category names:

- "Manufacturer of Destructive Devices (10)"
- "Importer of Destructive Devices (11)"
- "Dealer in Destructive Devices (09)"
- "Manufacturer of Firearms Other Than Destructive Devices (07)"
- "Dealer in Firearms Other Than Destructive Devices (01)"
- "Importer of Firearms Other Than Destructive Devices (08)"

These are official ATF regulatory labels (27 CFR 478.11), not editorializing. Recommend keeping as-is — rewriting would obscure the source provenance.

---

## MINOR findings (notes)

**Two hits, both in source-citation summaries that are already excluded by policy** (SEC litigation releases — verbatim third-party text). Listed for completeness:

1. `general-motors.json :: enriched.secLitigation.sampleReleases[0].summary` — phrase "concerning its pension plans" inside a verbatim SEC press release. **No action.**
2. `hertz.json :: enriched.secLitigation.sampleReleases[2].summary` — phrase "concerning" inside a verbatim SEC press release. **No action.**

---

## Why the corpus is so clean (root-cause observation)

The data pipeline emits narrative `.s` values via a small number of template strings in the per-source cron jobs (FEC, Violation Tracker, HIBP, OSHA, etc.). The templates are themselves neutral-by-construction (number + dollar amount + parenthetical source). There is no LLM-generated commentary or hand-written editorial layer between the raw public records and the user — which is exactly the "journalism, not opinion" posture the brand claims.

This is the desired state. The audit confirms it holds at scale.

---

## Recommended next steps

1. **Lock in the discipline.** Add a unit test (or a CI guardrail in the data-pipeline workflows) that fails if any newly committed `.s` value contains any CRITICAL phrase from the pattern list above. Cheap insurance against regression as we add new data sources.
2. **Apply the same scan to the cron-job templates themselves** (in `scripts/cron/*` or wherever `.s` strings are formatted). If a future template ever adopts editorial language, this scan would catch it — but the test in step 1 prevents the data from ever shipping.
3. **Extend the audit to the marketing site copy and in-app static text.** Out of scope for this pass (this audit covers per-company data only), but the same neutrality standard should hold for:
   - `src/App.jsx` static labels and category descriptions
   - `MarketingLanding.jsx` claims and category copy
   - `OnboardingFlow.jsx` quiz text
   - `docs/marketing/*` and `public/about/*` if user-facing
   A separate agent or audit pass should cover these surfaces.
4. **Re-run before each launch milestone.** Trivial 30s scan; worth re-running before PH (Jun 23), before Android beta, and before each major data-source addition.

---

## Reproducibility

Scanner used: `scripts/audit/scan-narrative-bias.py` (committed in this PR). Re-runnable as:

```sh
python3 scripts/audit/scan-narrative-bias.py
```

Expected output as of 2026-06-08: 37 hits, all false positives (Shady Records proper noun + ATF "Destructive Devices" license labels). Any new CRITICAL hit after a data update is a regression and should be investigated before shipping.
