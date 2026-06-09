# Cron Quality Audit — 2026-06-07

Audited via `gh run list` + per-workflow run history (last 20 each). Pre-launch
gate before Product Hunt on 2026-06-23.

## Summary
- Total workflows: 87
- Healthy (last run success): 21
- Failing (last run = failure): 3
- Mixed (recent run cancelled or intermittently failing): 5
- Never-ran but recently-added (legit — monthly/quarterly/annual cron not yet
  hit): 58 (NOT flagged as failures per instructions)
- Stale-and-broken: 0

Only **3 workflows currently fail on every run, and 2 more have a clear bug
pattern in recent failures**. All are fixable before June 23.

## Failing — Quick Fixes (do today)

| Workflow | Last failure | Root cause | Fix |
|---|---|---|---|
| `uk-companies-house-quarterly` | 2026-06-07 19:37 UTC | `COMPANIES_HOUSE_API_KEY` env var not set in workflow (passed empty) | Add the secret to repo settings, reference it in the `env:` block. 5 min. |
| `bonica-dime-annual` | 2026-06-07 19:37 UTC | `DIME_CSV_URL` env var not set; live mode requires URL to Stanford DIME CSV | Add `DIME_CSV_URL` secret pointing at the current Stanford DIME release. 5 min. |
| `lobbying-quarterly` | 2026-06-07 19:37 UTC | FARA endpoint returns 404: `https://efile.fara.gov/ords/fara/active_foreign_principals/?offset=0&limit=500` | URL drift — FARA changed their ORDS endpoint. Verify current URL at efile.fara.gov and update `scripts/fara-fetch.mjs:63`. 10–15 min. |

## Failing — Medium

| Workflow | Last failure | Root cause | Fix |
|---|---|---|---|
| `news-rss-nightly` | 2026-06-03 12:08 UTC | AI extraction returns `undefined` per batch: `Cannot read properties of undefined (reading 'find')` — 200/200 items failed. Then commit step fails on missing `merge-log.json` pathspec. | Two bugs: (1) the Claude/AI extractor response shape changed (missing array it tries `.find()` on) in `scripts/news-extract.mjs`-equivalent; (2) workflow `git add public/data/news/merge-log.json` fails when file isn't written. Make `git add` tolerant (`|| true`) and fix the extractor response parsing. 20–30 min. |
| `courtlistener-weekly` | 2026-06-02 19:19 UTC | Push race: `! [rejected] main -> main (fetch first)` — another bot job pushed during this run. No pull-rebase-retry loop (unlike news-rss-nightly which has it). | Add the same `for i in 1 2 3; do git pull --rebase origin main && git push && break; done` retry loop the news workflow uses. 5–10 min. *(Bordering on quick fix.)* |

## Failing — Blockers

None. No workflows are dead-ended on an unrecoverable source.

## Cancelled (need attention but not failing)

| Workflow | Last status | Note |
|---|---|---|
| `news-rss-nightly` | 14 runs, 4 success / 2 failure / 8 cancelled | Frequently cancelled — looks like overlapping triggers killing earlier runs. Add `concurrency: { group: news-rss, cancel-in-progress: false }` so we queue rather than drop. |
| `openstates-monthly` | cancelled 2026-06-03 | Single run was manually cancelled. Re-trigger to verify health. |
| `gdelt-weekly` | cancelled 2026-06-03 | Same — re-trigger to confirm. |
| `epa-echo-weekly` | cancelled 2026-06-03 | Same — re-trigger to confirm. |

## Stale (need cron schedule check)

None. The 58 "never-ran" workflows are all recently added (past week per git
log: `accc-monthly`, `eu-antitrust-monthly`, `oversight-ig-monthly`,
`stanford-scac-monthly`, etc.) and their crons are weekly/monthly/quarterly/
annual — they simply haven't reached their first scheduled trigger. Per
instructions, these are not flagged as failures.

**Recommendation**: before PH launch, run a one-shot `workflow_dispatch`
smoke-test on every NEVER_RAN workflow (loop over `gh workflow run`) to surface
any that have the same env-var or URL-drift issues as the three quick-fixes
above. ~5 min to kick off, runs in parallel.

## Cross-cutting issues to fix once

1. **Node.js 20 deprecation warning** on every run. GitHub forces Node 24 on
   2026-06-16 — that's a week before launch. Bump `actions/checkout@v4` and
   `actions/setup-node@v4` (still v4 is fine; set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`
   or wait for v5). Add to every workflow or use a composite action. 30 min.
2. **Missing push-retry loop** on most data workflows. `courtlistener-weekly`
   already bit us. Template this into every workflow that does
   `git add && git commit && git push`. 1 hr.
3. **No `concurrency:` groups** — overlapping crons cancel each other (see
   news-rss-nightly's 8 cancels). Add per-workflow concurrency groups. 30 min.

## Action plan before 2026-06-23

| Priority | Task | ETA |
|---|---|---|
| P0 | Add `COMPANIES_HOUSE_API_KEY` + `DIME_CSV_URL` repo secrets | 5 min |
| P0 | Fix FARA URL in `scripts/fara-fetch.mjs` | 15 min |
| P0 | Fix `news-rss-nightly` extractor + tolerant `git add` | 30 min |
| P1 | Add push-retry loop to `courtlistener-weekly` (and template across workflows) | 1 hr |
| P1 | Smoke-test all 58 NEVER_RAN workflows via `workflow_dispatch` | 30 min total elapsed |
| P1 | Add `concurrency:` groups | 30 min |
| P2 | Node 24 readiness (bump actions, set env flag) — must land before 2026-06-16 | 30 min |

**Total fix time: ~3.5 hours of focused work.** No blockers, no dead sources.
The pipeline is in good shape for launch once the 3 quick env/URL fixes land.
