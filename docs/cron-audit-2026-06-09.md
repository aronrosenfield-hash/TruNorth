# Cron Audit — 2026-06-09

Verifying the 44+ new workflows added Jun 7-8.

## Summary

- **146 workflow files** in `.github/workflows/`
- **51 workflows** seen in last 200 runs (the rest are annual/quarterly that haven't fired yet)
- **39 healthy** ✅
- **6 failing** ❌
- **6 cancelled** (replaced/timed-out — normal)

## Failing workflows + root cause

### Category A: Upstream API broken (3 crons) — needs source-side fix

| Workflow | Error | Fix |
|---|---|---|
| `itep-tax-annual` | `itep landing HTTP 404` | ITEP changed their URL. **Already deferred** — B-12 says dormant pending license. Disable cron or pin to fixture until X-7 (ITEP citation approval) lands. |
| `eu-transparency-monthly` | `HTTP 404 Not Found for https://transparency-register.europa.eu/download/full?type=json` | EU Transparency Register changed their bulk-dump URL. Need to find the new endpoint — could be `/download/full?type=json&lang=en` or it moved to `/download.json`. |
| `fsis-weekly` | `HTTP 403` (3 attempts) | USDA FSIS added bot detection. Needs User-Agent header or auth token. Probably the same kind of fix the round-3 agents applied to other federal scrapes. |

### Category B: GitHub Actions setting (2 crons) — **single toggle fixes both**

| Workflow | Error |
|---|---|
| `opensanctions-monthly` | `GitHub Actions is not permitted to create or approve pull requests` |
| `wikirate-quarterly` | Same error |

**Fix:** Repo Settings → Actions → General → Workflow permissions →
☑ **"Allow GitHub Actions to create and approve pull requests"**

One toggle, unblocks both. The fetcher itself works — it just can't open the PR. 30-second fix.

### Category C: Missing secret (1 cron)

| Workflow | Error |
|---|---|
| `bonica-dime-annual` | `DIME_CSV_URL` env var is empty |

**Fix:** Set `DIME_CSV_URL` in repo secrets, OR commit the URL to the workflow file directly. Stanford DIME bulk download URL is public.

## Cancelled workflows (normal — not failures)

These were superseded by later runs or hit timeouts:
- `courtlistener-weekly` (2026-06-07)
- `epa-echo-weekly` (2026-06-08)
- `fra-weekly` (2026-06-08)
- `gdelt-weekly` (2026-06-08)
- `news-rss-nightly` (2026-06-09)
- `openstates-monthly` (2026-06-03)

If these become a pattern over the next weeks, raise.

## Action items

| Priority | Action | Who | Effort |
|---|---|---|---|
| 🔴 P0 | Enable "Allow GH Actions to create PRs" in repo settings | Aron | 30 sec |
| 🟡 P1 | Set `DIME_CSV_URL` secret OR remove bonica-dime cron | Aron | 5 min |
| 🟢 P2 | Disable `itep-tax-annual` until X-7 lands (it's dormant per B-12) | Aron | 1 min |
| 🟢 P2 | Add User-Agent header to `fsis-fetch.mjs` to bypass 403 | Future | 15 min |
| 🟢 P2 | Find new EU Transparency Register URL pattern | Future | 30 min |

## Methodology

```
gh run list --limit 200 --json workflowName,conclusion,createdAt,event
```

Then grouped by workflow name, sorted by latest-run status. Failures investigated via `gh run view <id> --log-failed`.
