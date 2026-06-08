# Neutrality Audit — `data/derived/*-augment.json` + `scripts/*-merge.mjs`

**Date:** 2026-06-08
**Scope:** Pre–Product-Hunt-launch language audit of the per-pipeline augment files (what gets merged into `bundle.json`) and the merge scripts that generate them.
**Branch:** `feature/neutrality-audit-derived`
**Principle:** Journalism, not opinion.

## Surface scanned

- **43 augment JSON files** under `data/derived/*-augment.json` (full list at bottom).
- **136 merge scripts** under `scripts/*-merge.mjs`.

For each file we extracted every string value, excluded URLs / slugs / ids / numeric codes / license attributions, and scanned prose strings (length ≥ 15 chars, contain spaces) for editorial language. Field names targeted: `notes`, `description`, `summary`, `narrative`, `whyMatters`, `comment`, `reason`, `interpretation`, `signal`, `_note`, `_doc`, `headline`, `title`, `blurb`, `rationale`, `context`, `explanation`, `label`, `message`, `warning`. All other long prose strings were also scanned.

Editorial-language lexicon used (Tier 1 — auto-fix CRITICAL):
> harmful, irresponsible, egregious, reckless, outrageous, shameful, disgraceful, appalling, deplorable, unethical, immoral, abusive, predatory, greedy, corrupt, sleazy, villainous, evil, sinister, wrongdoer, culpable, screws over, shifts burden, exploits, worst offender, deeply troubling, shocking, horrific, atrocious, sickening, infamous, callous, cruel, nefarious, malicious, deceitful, controversial, polarizing, woke, refuses to, fails to disclose, covers up, widely criticized, widely condemned, caused harm, puts profits over, prioritizes profit, stonewalls, notorious for

## Findings

### Severity counts
| Severity | Count | Notes |
|---|---|---|
| CRITICAL (auto-fix) | **0** | No advocacy framing or partisan characterizations in TruNorth voice. |
| MAJOR (flag for review) | **0** | No editorial adjectives written by our pipeline. |
| INFO (third-party verbatim, neutral) | 1 | A `demands[]` string in `cornell-ilr-augment.json` contains the word "Harmful" — verbatim from a Cornell ILR Labor Action Tracker `demands` field (source-attributed labor protest demand, not TruNorth voice). |

### Why the surface is clean

Augment files are almost entirely **structured aggregates**:
- counts (violations, fines, contributions)
- amounts (`fine_eur`, `total_amount`)
- enums (`tier`, `status`, `signal: "positive"`)
- names (company, parent, authority)
- dates and IDs
- `_license` / `_source` / `_citation` attribution blocks (allow-listed per skill)
- `sourceUrl` / `trackerUrl` (URL fields, excluded from scan)

The only free-prose fields we found are:
1. **Verbatim source quotes** — Cornell ILR `demands[]` and `notes`, Strike Map `reason`, NAAG `summary`. These reproduce the source verbatim with attribution via `sourceUrl` — that is journalism, not opinion.
2. **Log / error messages in scripts** — `"No raw files in ${RAW_DIR}; run X-fetch.mjs first."` and similar. Not user-facing.
3. **Factual auto-built summaries** — e.g. `eu-enforcement-merge.mjs` line 280:
   ```js
   summary: `${authority || "EU DPA"}: €${fine_eur.toLocaleString()} — ${violation_type || "GDPR violation"}`
   ```
   Purely template-filled facts.

### CRITICAL fixes applied

**None.** No CRITICAL-tier language was found in either the augment JSONs or the merge scripts.

### MAJOR cases flagged

**None.** Conservative scan — see "Why the surface is clean" above.

### INFO — third-party verbatim (not flagged, retained as-is)

| File | Path | String | Source |
|---|---|---|---|
| `cornell-ilr-augment.json` | `bySlug.southwest-airlines.labor.laborActions[7].demands[1]` | `"Harmful workplace culture"` | Verbatim from Cornell ILR Labor Action Tracker (`striketracker.ilr.cornell.edu/#action-…`). It is a labor demand articulated by workers, attributed via `sourceUrl` and `trackerUrl`. Skill guidance explicitly excludes source-attributed third-party speech. |

Other `demands[]` strings include phrases like "End exploitation of and discrimination against immigrant workers", "End unjust lawsuits against musicians", "Protest unjust termination", "End to anti-union retaliation", "Scheduling; End to unjust discipline" — all verbatim labor demands from a public dataset. Retained as-is for source fidelity.

## Scripts modified

**None.** No merge script emits editorial prose; nothing to patch.

## Notes for future cron runs

Because augment files are regenerated from `data/raw/*` by the `*-merge.mjs` scripts, **a JSON fix without a script fix is undone by the next cron run**. The good news here is there is nothing in either layer to fix — the pipelines are already neutral by construction (template-filled from numeric facts and source-attributed strings).

## Files scanned (43)

```
bis-entity-list, canada-competition-bureau, cftc-enforcement, climate-trace,
cornell-ilr, corporate-giving, disability-in, dol-oflc-lca, dol-whd-violations,
energy-star, epa-green-vehicle, epa-smartway, eu-transparency,
exec-political-donations, fdaaa-trials, ferc-enforcement, firearms-industry,
fmcsa-sms, forest500, fsis-dw, health-signals, iihs-tsp,
industry-carbon-intensity, itep-tax, mas-singapore, naag, net-zero-tracker,
ofac-sdn, one-percent-planet, sbti, sec-8k-events, sec-def14a, strike-map,
supplements-verified, tco-certified, textile-exchange, transparency-benchmarks,
uk-ico, usda-organic, wba-social, wikirate, wob5050, wwf-palm-oil
```

Merge scripts cross-checked for editorial template strings: **136** (all clean).

## Recommendation

No code changes. PR opens as a documentation/audit artifact so the launch checklist records that this surface was reviewed. Future pipeline additions should keep auto-generated prose template-only (`${authority}: €${fine_eur} — ${violation_type}` style) and continue routing free prose to `sourceUrl` + verbatim attribution.
