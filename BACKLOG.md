# TruNorth Backlog

> **Single source of truth.** Claude keeps this current. You can edit it directly anytime — edits are respected.
>
> **How to use:** Open this file → say "let's do **L-3**" or "what's blocked?" or "what's the next highest-leverage item?"
>
> **🟢 LAUNCHED — Jun 23, 2026 · 2:01 AM CDT** (App Store · id `6775301458` · `https://apps.apple.com/app/id6775301458` · PH launched). **CURRENT LIVE BUILD = v1.1 Build 81** (approved 2026-07-08, released Manual **2026-07-14**) — it superseded v1.0 Build 75, which was live Jun 23 → Jul 14. **Next iOS ship = Build 82.** *(The 2026-06-11 "date is soft, get it right" call held through the Compass redesign; the experience shipped on the locked date. Go-live runbook: `docs/LAUNCH_DAY.md`.)*
>
> **Last updated:** 2026-08-19 22:15 CDT (daily doc-sync, covering **2026-08-19**).
>
> 📌 **THE QUIETEST MACHINE DAY YET — AND IT SURFACED THE FIRST HARD USAGE NUMBER SINCE LAUNCH: ZERO.** Only **2 bot data commits** landed on `origin/main` (`news` 05:36Z `76af48bf7`, `ofac-sdn` 17:53Z `6608f898f`) and only **4 workflow runs fired all day** — `news-rss-nightly`, `cron-health-daily`, `ofac-sdn-daily`, `trending-refresh` — **all four `success`.** The drop from yesterday's 8 runs is **expected, not a failure: Wednesday carries no weeklies.** **Zero human commits. Zero code changes** — `git diff --name-only 957956106..HEAD` touches only `data/derived/` (1), `data/raw/ofac-sdn/` (1), `public/data/companies/` (11) and `public/data/news/` (3); nothing under `src/`, `scripts/`, `ios/`, `android/`, `.github/workflows/` or `package.json`. **`public/data/index.json` untouched → 0 grade movement**; its last change is still the 08-14 push `c2c1216de`. The clone was 2 behind at sync start; rebased cleanly to `0 0`, nothing lost.
>
> ✅ **RE-VERIFIED AT THE CDN, NOT INFERRED FROM GIT** (`curl https://www.trunorthapp.com/data/index.json`): **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256**, 10,240 "?". **Byte-identical to local and to the last FIVE days. Quote 2,590.** ✅ `grep -rl "Claude AI synthesis" public/data/` → **0 files**; `sourceKind: "synthetic"` → **0 files.**
>
> 🆕📉🚨 **NEW TODAY — B-131: POSTHOG HAS RECORDED ZERO `company_view` EVENTS FOR TWELVE STRAIGHT DAYS. NOBODY IS OPENING BRAND CARDS IN THE SHIPPED APP.** This is the first *measured* answer to "is anyone using it," and it did not come from a failure — it came from a **green** cron. `trending-refresh` run `32309351311` finished `success` tonight and its own log reads: **`📊 Querying top 15 brands (last 7 days)…`** then **`(No company_view events in the lookback window — leaving trending.json alone.)`** **`public/data/trending.json` was last written 2026-08-07T22:48:29Z (`ae9d88a41`) and contains exactly ONE brand — `rocket-lab`, `views: 1`, `uniques: 1`.** The cron has committed **58 times** in its life and **not once since 08-07**. 🔑 **The instrumentation is NOT broken, and I checked before saying so:** `src/App.jsx:3252` emits `track("company_view", { slug, name, grade, … })` and `scripts/refresh-trending.mjs:64` queries `WHERE event = 'company_view'` — **the event names match exactly**, and the PostHog query returned a result set rather than erroring. ⚠️ **Two readings remain and both matter:** ① **genuinely zero brand-detail opens in 12 days** — the likeliest reading, and it is exactly what "nobody has run the shipped app" predicts; ② the analytics **transport** is dropping events before PostHog ingests them (an app-side `track()` no-op, a consent gate, or a dead key on the client — note `POSTHOG_API_KEY` here is the *server* read key and proves nothing about the client). 🧭 **Distinguishing them is cheap and is now the single best reason to do item ② below: install Build 81, open 5 brand cards, then re-run `trending-refresh` via `workflow_dispatch`. If the events appear, usage is the problem; if they do not, the client instrumentation is.** ✅ **This is NOT a UI defect and must not be "fixed" as one** — `src/App.jsx:6170-6178` deliberately keeps the curated fallback (`Patagonia, Amazon, Costco, Tesla, Nike`) whenever fewer than 3 brands match, so the stale one-brand file is invisible to users. **The guard is correct. Leave it alone.**
>
> 🔴 **B-127 UNCHANGED AND STILL ARMED FOR SUNDAY 2026-08-23.** `public/data/_meta/grade-snapshot.json` is byte-identical for the fifth day running (md5 `195a5e9ccf5714807fb8f9678ed91d68`): **`takenAt 2026-08-09T17:00:25.665Z`, 3,060 entries**, still last written by `247dd4c87` on 08-09 — the pre-push catalog, against a shipped catalog of 2,590 graded. **Nothing was re-baselined today. The next rebake fails at step 9 the same way and discards its own output again — four days from now.** Still the highest-leverage open fix on the board.
>
> ✅ **`data(news)` FOR 08-19 LANDED** (`76af48bf7`, run `32218622484`). **Lost nights stand at 08-02, 08-09, 08-16 — 3 in 18 days, unchanged.** 🚨 **Three green nights is not recovery.** The 08-10→08-15 six-night streak was broken the very next night; B-124 is a race that looks healthy most days. **Only the commit series is evidence: `git log origin/main --grep='data(news)'`.** 📊 **Worth recording for contrast with B-129: today's news merge log reports `total_items: 33 · brand_count: 11 · merged_count: 11` — a 100% match rate.** **The brand matcher is not globally broken; the news path resolves everything it is handed.** That makes B-129 a per-source key/alias problem, not a shared-matcher problem.
>
> 🟡 **B-101 FLAT AT 40 open data PRs for the third day** (40, 40, 39). Oldest is **#116, now 51 days**. 🚨 **Both must-not-merge landmines still open — #134 (CC-BY-NC augment B-63 stripped) and #165 (synthetic `.gov`-attributed data). Drain by hand, never in bulk, never on the title.**
>
> 🟢 **B-128 HELD FLAT A THIRD DAY: 389 single-line / 12,441 pretty** — identical on 08-17, 08-18 and 08-19. **Today's news merge rewrote 11 company files and flipped none, so they were already single-line.** ⚠️ **Three flat days is still not stabilization — no serializer has been chosen, and the split has only held because the crons happened to touch files already in their own format.**
>
> 📌 **Everything else unchanged.** **#155 still 37 rows** (rewritten 2026-08-19T13:57Z) — same set as yesterday; today's four runs were green so nothing cleared and nothing was added. ⚠️ **The row count is a FLOOR — it lists only crons whose LATEST run did not succeed, so it is blind to B-124-class green-but-discarded runs and to B-131 entirely.** **B-122 unchanged** — `bis-entity-list-weekly` last failed 08-17 (`31986924514`), still blocked on Aron requesting a free `api.data.gov` key. **B-125 unchanged — `faa`/`fra`/`gdelt` are Monday weeklies; next evidence Monday 2026-08-24.** **Chronic and NOT new:** `fcc-weekly`, `fsis-weekly`, `fsis-dw-weekly`. **OFAC augment moved timestamps only** — `matched_slug_count: 91`, unchanged. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — repo confirms `CURRENT_PROJECT_VERSION = 81`, `MARKETING_VERSION = 1.1`, no `ios/` or `android/` changes today. Android still scaffold-only. ⚠️ **The push shipped WEB ONLY — never say "Build 81 has the C-fixes."** ⚠️ **Housekeeping: the 5 untracked `docs/` files remain, day 16.**
>
> 🔴 **WHAT ARON STILL OWES — still 2, and ② just became the higher-value one:** ① **add `RESEND_API_KEY`** — `gh secret list` today returns the same **7** secrets (`ANTHROPIC`, `COMPANIES_HOUSE`, `DOL`, `MAILERLITE_API_KEY`, `MAILERLITE_GROUP_ID`, `OPENSTATES`, `POSTHOG`) and no Resend key; **an outside subscriber (`jlougee24@live.com`) has missed 3 digests, and the weekly digest is blocked by NOTHING ELSE — the secret alone turns it on.** ② **install Build 81 and open 5 brand cards** — **this is no longer just hygiene. B-131 means 12 days of zero recorded brand views, and this one action distinguishes "no users" from "broken client analytics" in about five minutes.** 🧭 **Next engineering work: B-127 (one re-baseline unblocks every future Sunday rebake), then B-128, then V-4 — 31 dark `enriched` dims led by `secTax` at 3,415 brands, plus the dark top-level keys — then B-129/B-130 and L-1/L-3/L-4.**
>
> ---
>
> **[08-18 sync]** 📌 **ANOTHER ZERO-CODE MACHINE DAY — BUT IT FOUND A SECOND, SEPARATE CLASS OF DEAD DATA, AND ONE CRON THAT COMMITS NOTHING BUT A TIMESTAMP.** 6 bot data commits landed on `origin/main` (`news` 05:36, `fdic` 10:28, `finra` 11:05, `nrc` 17:07, `occ` 17:50, `ofac-sdn` 17:57). **Zero human commits. Zero code changes** — the diff touches nothing under `src/`, `scripts/`, `ios/`, `android/`, `.github/workflows/` or `package.json` (verified by `git diff --name-only ebc53d801..5e44daf2a`). **`public/data/index.json` untouched → 0 grade movement** (its last change on `origin/main` is still the 08-14 push `c2c1216de`). The clone was 6 behind at sync start; fast-forwarded cleanly to `0 0`, nothing lost. **Every one of today's 8 workflow runs reported `success` — no new cron failures.**
>
> ✅ **RE-VERIFIED AT THE CDN, NOT INFERRED FROM GIT** (`curl https://www.trunorthapp.com/data/index.json`): **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256**, 10,240 "?". **Byte-identical to local and to the last four days. Quote 2,590.** ✅ `grep -rl "Claude AI synthesis" public/data/` → **0 files**; `sourceKind: "synthetic"` → **0 files.**
>
> 🆕🕳️🚨 **NEW TODAY — B-130: `nrc-weekly` IS NOT A MATCHING PROBLEM. IT COMMITS A TIMESTAMP AND NOTHING ELSE, EVERY WEEK, AND REPORTS SUCCESS.** This is a *different and worse* failure than B-129 and deserves its own line. Run `32163102119` → `success`, commit `e765b7e7b`. **The entire commit is 2 files and 7 changed lines.** `public/data/nrc-events.json` says **`operator_count: 5`, `with_records_count: 0`** — and every one of the 5 operators has **empty `sample_events`, empty `sample_violations`, empty `top_action_types`.** The diff is **literally nothing but `generated_at` and five `scraped_at` timestamps rolling forward.** The merge log confirms the consequence: **`total_brands: 5 · merged_count: 0 · skipped: 5 · orphan_count: 0 · merged_brands: []`.** 🔑 **Two things separate this from B-129:** ① **the universe is 5 operators, not 528** — NRC was scoped to nuclear utilities only; ② **there are ZERO orphans**, which means nothing failed to match — **there was nothing to match, because the fetch returns no records at all.** ⚠️ **So the alias/matcher fix prescribed for B-129 would do nothing here. The upstream scrape is returning empty and the job still exits 0.** 🚨 **It is advertised to users at `src/App.jsx:4918` ("NRC Event Reports … enforcement actions per nuclear utility").**
>
> 🆕📊🕳️ **NEW TODAY — THE DARK-DATA PROBLEM IS BIGGER THAN `enriched.*`. THERE IS A SECOND CLASS: TOP-LEVEL COMPANY-FILE KEYS THAT NOTHING READS.** Yesterday's V-4 count (33 `enriched.*` dims, only 2 scored) was correct but **incomplete** — it only looked under `enriched`. Today's `finra` and `occ` merges write **top-level** keys instead, so they were invisible to that count. Verified by grep across the whole repo: **`finra`, `occ`, `nrc` and `phmsa` have 0 references in `scripts/rebake-scoring.mjs`, 0 in `scripts/lib/index-entry.mjs`, and appear in `src/App.jsx` ONLY inside the static Sources array** (`:4884` FINRA, `:4881` OCC, `:4918` NRC, `:4917` PHMSA) — that array is a citation list, not a data consumer. **Counted across all 12,830 company files: `finra` 92 · `phmsa` 30 · `occ` 14 = 136 top-level key placements with zero consumers.** ⚠️ **Method correction for V-4: enumerate ALL company-file keys, not just `enriched.*`, or the scope will keep under-counting. The two classes together are 31 dark `enriched` dims + at least 3 dark top-level keys.**
>
> 🕳️ **B-129 EXPANDS FROM 4 SOURCES TO 7 — TODAY'S THREE BANKING/FINANCE WEEKLIES ARE THE SAME DEFECT.** From today's merge logs on `origin/main`, not run statuses: **`fdic` merged 0 of 528** (`merged_partial_count: 38 · skipped: 483 · orphan: 7`) — and **the 08-11 log is identical (`merged 0 · partial 38`), so this is structural, not a bad week**; **`occ` merged 14 of 528** (skipped 511, orphan 3); **`finra` merged 93 of 528** (skipped 421, orphan 14) — the best match rate of any B-129 source so far, and still under 18%. **Running list: `ntsb` 0/528 · `fdic` 0/528 (38 partial) · `occ` 14/528 · `phmsa` 30/528 · `msha` 70/528 · `finra` 93/528 · `cisa-kev` 2 vendors with 238/276 orphaned.** ⚠️ **`fdic` is the interesting one — `merged_count: 0` but `merged_partial_count: 38`, so its 38 writes land under `enriched.fdic` via a partial path. Any fix must read BOTH counters; `merged_count` alone reads as a total failure when 38 files were in fact written.**
>
> 🔴 **B-127 UNCHANGED AND STILL ARMED FOR SUNDAY 2026-08-23.** `public/data/_meta/grade-snapshot.json` is byte-identical to the last three days: **`takenAt 2026-08-09T17:00:25.665Z`, 3,060 entries**, still last written by `247dd4c87` on 08-09 — the pre-push catalog. **Nothing was re-baselined today. The next rebake will fail at step 9 the same way and discard its own output again.** Still the highest-leverage open fix on the board.
>
> ✅ **`data(news)` FOR 08-18 LANDED** (`2e421f956`, run `32102061878` — 20,180 insertions across 12 files). **Lost nights stand at 08-02, 08-09, 08-16 — 3 in 17 days, unchanged.** 🚨 **Two green nights is not recovery.** The 08-10→08-15 six-night streak was broken immediately afterwards; B-124 is a race that looks healthy most days. **Only the commit series is evidence: `git log origin/main --grep='data(news)'`.**
>
> 🟡 **B-101 FLAT AT 40 open data PRs** (40 yesterday, 39 the day before). Oldest is **#116, now 50 days**. 🚨 **Both must-not-merge landmines still open — #134 (CC-BY-NC augment B-63 stripped) and #165 (synthetic `.gov`-attributed data). Drain by hand, never in bulk, never on the title.**
>
> 🟢 **B-128 HELD FLAT TODAY: 389 single-line / 12,441 pretty** — identical to yesterday. **Today's four merge crons rewrote only files that were already single-line, so nothing new flipped.** ⚠️ **Do not read this as stabilizing — the split has oscillated every day the crons touch a prettified file, and no serializer has been chosen. Flat for one day is noise, not a trend.**
>
> 📌 **Everything else unchanged.** **#155 still 37 rows** (rewritten 2026-08-18T13:56Z) — same set as yesterday; today's runs were all green so nothing cleared and nothing was added. **B-122 unchanged** — `bis-entity-list-weekly` is a Monday weekly, last failed 08-17 (`31986924514`); failures 08-03, 08-10, 08-17 vs last success 07-27, still blocked on Aron requesting a free `api.data.gov` key. **B-125 unchanged** — `faa`/`fra`/`gdelt` are Monday weeklies; **next evidence Monday 2026-08-24.** **Chronic and NOT new:** `fcc-weekly` (3 straight failures), `fsis-weekly` and `fsis-dw-weekly` (6+ straight each). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — repo confirms `CURRENT_PROJECT_VERSION = 81`, `MARKETING_VERSION = 1.1`, no `ios/` or `android/` changes today. Android still scaffold-only. ⚠️ **The push shipped WEB ONLY — never say "Build 81 has the C-fixes."** ⚠️ **Housekeeping: the 5 untracked `docs/` files remain, day 15.**
>
> 🔴 **WHAT ARON STILL OWES — unchanged at 2:** ① **add `RESEND_API_KEY`** — `gh secret list` today returns the same **7** secrets and no Resend key; **an outside subscriber (`jlougee24@live.com`) has missed 3 digests, and the weekly digest is blocked by NOTHING ELSE — the secret alone turns it on.** ② **install Build 81 and scan 5 real products** — still nobody has run the shipped app. 🧭 **Next engineering work: B-127 (one re-baseline unblocks every future Sunday rebake), then B-128, then V-4 — now re-scoped to 31 dark `enriched` dims led by `secTax` at 3,415 brands PLUS the newly-found top-level dark keys — then B-129/B-130 and L-1/L-3/L-4.**
>
> ---
>
> **[08-17 sync]** 📌 **A QUIET MACHINE DAY THAT PRODUCED THE SHARPEST EMAIL EVIDENCE YET — AND EXPOSED THAT V-4 IS FIVE TIMES BIGGER THAN THIS BOARD SAYS.** 6 bot data commits landed on `origin/main` (`cisa-kev` 04:06, `news` 05:43, `msha` 15:38, `ntsb` 17:31, `ofac-sdn` 17:58, `phmsa` 19:34). **Zero human commits. Zero code changes** — the diff touches nothing under `src/`, `scripts/`, `ios/`, `android/`, `.github/workflows/` or `package.json` (verified by `git diff --name-only`). **`public/data/index.json` untouched → 0 grade movement.** The clone was 6 behind at sync start; rebased cleanly, nothing lost.
>
> ✅ **RE-VERIFIED AT THE CDN, NOT INFERRED FROM GIT** (`curl https://www.trunorthapp.com/data/index.json`): **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256**, 10,240 "?". **Identical to local and to the last three days. Quote 2,590.**
>
> 🔴🧾 **THE EMAIL OUTAGE IS NO LONGER ABSTRACT — THERE ARE FOUR REAL SUBSCRIBERS AND ALL FOUR WERE MISSED, ON TAPE.** Pulled the log for `weekly-digest` run **`31964140063`** (2026-08-16 18:00Z). It resolved the list from MailerLite — **`4 active subscriber(s)`** — attempted delivery, and printed:
>
> > `✅ Weekly digest sent: 0 delivered, 4 failed.`
> > `   ✗ aron.rosenfield@gmail.com: RESEND_API_KEY not set`
> > `   ✗ aron+postfix-test-…@trunorthapp.com: RESEND_API_KEY not set`
> > `   ✗ aron+recheck-…@trunorthapp.com: RESEND_API_KEY not set`
> > `   ✗ jlougee24@live.com: RESEND_API_KEY not set`
> > `❌ Every send failed — failing the job so the cron does not report success.`
>
> 🔑 **THREE THINGS THIS SETTLES.** ① **A real third party is on that list** (`jlougee24@live.com`) — this is not a self-test that nobody notices; an outside subscriber has now missed three weekly digests. ② **`weekly-digest` is a SEPARATE workflow from the rebake's `Notify-me` step and it is NOT blocked by B-127** — it fires on its own schedule (Sunday 18:00 UTC, `.github/workflows/weekly-digest.yml:28`), it ran to completion, and **the missing secret is its only blocker.** ⚠️ **This corrects yesterday's framing that "both blockers must be fixed before any email can send" — that is true of `Notify-me`, but NOT of the weekly digest, which will send the moment the secret exists.** ③ **It fails honestly** (`exit 1`, no soft-fail) — the opposite of B-126, and the reason it shows on the watchdog at all. ⚠️ **The B-127 caveat that DOES survive: `weekly_changes.json` was last written 2026-08-09 by `247dd4c87`, so with the secret set today the digest would ship 8-day-old change data. Fix B-127 too, but for content accuracy — not to unblock the send.**
>
> 🔬🔴 **B-125 CONFIRMED AGAIN — THIRD CONSECUTIVE MONDAY, SAME THREE CRONS, SAME STEP, SAME CAPS.** The Monday weeklies ran today and all three were killed inside the **fetch** step with every later step skipped: **`faa-weekly` `32018127077` — 1,815s** · **`fra-weekly` `32025687480` — 1,816s** · **`gdelt-weekly` `32027864201` — 5,416s.** Every one is within ~16s of its configured `timeout-minutes`. Kill dates now **08-03, 08-10, 08-17.** ⚠️ **This is no longer "awaiting evidence" — it is a proven weekly-recurring failure with three data points. `faa-weekly`'s one lifetime success had 37s of margin, so `faa-weekly.yml:25` is still the calibrated one-line fix.**
>
> 🔴 **B-127 UNCHANGED AND STILL ARMED FOR SUNDAY.** `public/data/_meta/grade-snapshot.json` on `origin/main` is byte-identical to yesterday: **`takenAt 2026-08-09T17:00:25.665Z`, 3,060 entries** — still the pre-push catalog. **The next rebake (Sunday 2026-08-23) will fail at step 9 in exactly the same way and discard its own output again.** Nothing was re-baselined today. **Still the highest-leverage open fix on the board.**
>
> ✅ **`data(news)` FOR 08-17 LANDED** (`5bdfc6c81`, run `31997590919`). **Lost nights stand at 08-02, 08-09, 08-16 — 3 in 16 days.** 🚨 **Do NOT read this as recovery.** The 08-10→08-15 six-night green streak was followed immediately by a loss; B-124 is a race that looks healthy most days and only the commit series is evidence (`git log origin/main --grep='data(news)'`).
>
> 🆕🕳️ **NEW TODAY — B-129: THE TRANSPORT + CYBER WEEKLIES FETCH REAL DATA AND MATCH ALMOST NOTHING, WHILE REPORTING SUCCESS.** Read the merge logs from `origin/main` rather than the run statuses. **`ntsb` merged 0 of 528 brands** (`merged_count: 0 · skipped: 528 · orphan: 0 · error: 0`) — and it committed a 1,058-line refresh to do it; the 08-10 log is identical, so this is not a one-week anomaly. **`cisa-kev` merged 2 vendors and orphaned 238 of 276 (86%).** **`msha` 70/528**, **`phmsa` 30/528.** ⚠️ **Nothing here is silent-failure in the B-123/B-124 sense — the data lands. The defect is that the brand-matching layer resolves almost nothing, so four sources advertised on the app's Sources screen (`src/App.jsx:4917/4925/4971` and NHTSA at `:4897`) contribute essentially nothing to any brand record.**
>
> 🆕📊 **NEW TODAY — V-4 IS 5× BIGGER THAN THIS BOARD RECORDS, AND THE "animalCerts IS WIRED TO SCORING" NOTE IS IMPRECISE.** Counted every `enriched.*` sub-key across all 12,830 company files: **33 distinct dimensions exist, not 7.** Then read the actual accesses in `scripts/rebake-scoring.mjs` — it references `enriched` on exactly **five lines**, and reads exactly **two dimensions**: **`enriched.execPay.payRatio` (`:142`)** and **`enriched.tax` (`:182`)** — both B-115. **Everything else moves no grade.** 🔑 **`enriched.animalCerts` is wired to a BADGE, not a grade** — `scripts/lib/index-entry.mjs:111` sets `acertB: 1` from it. Earlier notes saying it is "wired to scoring" should read "wired to the badge flag." **The 31 dark dims by brand count: `secTax` 3,415 · `supplyChain` 869 · `openfdaRecalls` 362 · `privacy` 344 · `oshaSevereInjury` 251 · `pharmaConduct` 211 · `federalContracts` 210 · `political` 80 · `msha` 70 · `secLitigation` 62 · `newsweekMrc` 58 · `cpaZicklin` 48 · `laborWages` 48 · `asYouSow` 42 · `ungc` 41 · `knowTheChain` 38 · `fdic` 38 · `cisaKev` 37 · `supply_chain` 27 · `cftc` 24 · `fedReserve` 23 · `animalCerts` 19 · `osv` 9 · `rainforestAlliance` 8 · `ferc` 7 · `githubAdvisories` 5 · `dojFcpa` 5 · `goodWeave` 4 · `cdcFoodOutbreaks` 4 · `climateNeutral` 3 · `fairTrade` 3.** ⚠️ **`secTax` at 3,415 brands is the single biggest dark dimension in the catalog and is not named in V-4's current one-line scope.** ⚠️ **Also dark and NOT under `enriched`: `phmsa` sits as a top-level key on 30 company files and is read by neither `rebake-scoring.mjs` nor `src/App.jsx` — written every week, never used.**
>
> 🟡 **B-101 UP TO 40 open data PRs** (39 yesterday, 39 the day before). Oldest is **#116, now 49 days**. 🚨 **Both must-not-merge landmines still open — #134 (CC-BY-NC augment B-63 stripped) and #165 (synthetic `.gov`-attributed data). Drain by hand, never in bulk, never on the title.**
>
> 🟡 **B-128 DRIFTED THE WRONG WAY: 389 single-line / 12,441 pretty** (was 387 / 12,443). Two more files flipped to the unmergeable format. The oscillation continues every day nobody picks a serializer.
>
> 📌 **Everything else unchanged.** **#155 now 37 rows** (was 36; rewritten 2026-08-17T13:52Z) — the additions are today's Monday weeklies rolling their latest run to a failure. **B-122 unchanged** — `bis-entity-list-weekly` failed again today (`31986924514`); its failure dates are now 08-03, 08-10, 08-17 against a last success of 07-27, still blocked on Aron requesting a free `api.data.gov` key. **Chronic and NOT new:** `fcc-weekly` (3 straight failures), `fsis-weekly` and `fsis-dw-weekly` (6+ straight each). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — no `ios/` or `android/` changes today. Android still scaffold-only. ⚠️ **The push shipped WEB ONLY — never say "Build 81 has the C-fixes."** ⚠️ **Housekeeping: the 5 untracked `docs/` files remain, day 14.**
>
> 🔴 **WHAT ARON STILL OWES — unchanged at 2, but ① is now sharper:** ① **add `RESEND_API_KEY`** — **an outside subscriber has missed 3 digests, and the weekly digest is blocked by NOTHING ELSE; the secret alone turns it on.** ② **install Build 81 and scan 5 real products** — still nobody has run the shipped app. 🧭 **Next engineering work, unchanged in order: B-127 (one re-baseline unblocks every future Sunday rebake), then B-128, then V-4 — now re-scoped to 31 dark dims led by `secTax` at 3,415 brands — then B-129 and L-1/L-3/L-4.**
>
> ---
>
> **[08-16 sync] A BUSY, BAD SUNDAY. STILL ZERO HUMAN COMMITS AND ZERO GRADE MOVEMENT — BUT TWO PIPELINES FAILED TO DELIVER, AND ONE OF THEM FAILED SILENTLY.** 9 bot data commits landed on `origin/main` (`cfpb` 03:47, `lawsuits` 05:00, `cpsc` 05:18, `cruelty-free` 05:34, `doj` 07:09, `epa-echo` 08:00, `ofac-sdn` 17:50, `nhtsa` 18:17, `sec` 21:01). **None touched `public/data/index.json`**, whose last change on `origin/main` is still the push `c2c1216de` → **0 grade movement.** The clone was 9 behind at sync start; rebased cleanly to **`0 0`**, nothing lost.
>
> ✅ **RE-VERIFIED AT THE CDN, NOT INFERRED FROM GIT** (`curl https://www.trunorthapp.com/data/index.json`): **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256**, 10,240 "?". **Identical to local and to yesterday. Local == live == 2,590 — that is the number to quote.** Spot-check held: **23andMe is still `"?"` in production.** ✅ `grep -rl "Claude AI synthesis" public/data/` → **0 files**; `sourceKind: "synthetic"` → **0 files.**
>
> 🔴 **NEW — B-127: THE WEEKLY REBAKE FAILED FOR THE FIRST TIME IN SIX WEEKS, AND IT FAILED *CORRECTLY*. A GUARD REFUSED TO PUBLISH FROM A POISONED BASELINE.** `score-rebake-weekly` run **`31959545104`** (16:45Z) → **`failure`**, after 5 straight successes (08-09, 08-02, 07-26, 07-20, 07-19). It died at step 9 of 11, `compute-weekly-changes.mjs --apply`:
>
> > `[weekly-changes] snapshot disagrees with the committed index.json on 536/3060 brands (17.52% > 2%). The baseline is stale or was committed without its index — refusing to publish change claims from a poisoned baseline.`
>
> 🔑 **ROOT CAUSE, AND THE ARITHMETIC CLOSES EXACTLY: the 08-14 push moved 542 brands and nobody re-baselined `grade-snapshot.json`.** The snapshot is `takenAt 2026-08-09T17:00:25Z` with **3,060 entries** — the *pre-push* catalog — last written by the 08-09 rebake (`247dd4c87`). **542 moved − 6 newly graded (which by definition cannot appear in a 3,060-entry snapshot) = 536.** Re-ran the comparison locally: **536 disagreements / 3,060, 0 missing — byte-identical to the CI message.** This is the guard added 2026-07-20 (after a poisoned snapshot produced 60 false grade claims) doing exactly its job. **Do NOT weaken it and do NOT raise the 2% tolerance.**
>
> ⚠️ **THE COST: the guard fires BEFORE `Commit + push` (step 10) and `Notify-me` (step 11), so both were SKIPPED and the rebake discarded its own output.** The dry-run had already computed **A 62 · B 708 · C 1,029 · D 538 · F 268 · "?" 10,225 = 2,605 graded (+15)** and none of it shipped. 🔴 **This blocks EVERY future Sunday rebake until the snapshot is re-baselined from the shipped `index.json` — a hard recurring blocker, not a one-off.** ⚠️ **Generalize it: `grade-snapshot.json` must be re-baselined after ANY out-of-band catalog change; a hand-regenerated push silently arms this failure a week later.**
>
> 🔴 **B-124 RECURRED — 3rd CONFIRMED LOST NIGHT, and this time the whole mechanism is on tape.** `news-rss-nightly` run **`31928275753`** reported **`success`**, and **no `data(news)` commit exists on `origin/main` for 08-16** (the 08-10→08-15 six-day streak is broken — `ofac-sdn` landed, `news` did not). The log walks the full signature: commit `7f57f64` created locally (**13 files, 20,263 insertions**) → `git pull --rebase` → **`CONFLICT (content)` on 5 per-company files** (`anheuser-busch`, `coca-cola`, `heinz`, `hershey`, `pepsi`) → attempt 1 fails → **attempts 2 and 3 die on `Pulling is not possible because you have unmerged files`** (no `git rebase --abort`, exactly as predicted) → loop ends on `sleep 5` with no post-check → **exit 0.** **Lost nights: 08-02, 08-09, 08-16 — 3 in 15 days.** ⚠️ **Yesterday's "B-124 has not recurred" is now superseded; a streak of green nights never closed this and still doesn't.**
>
> 🆕🔑 **NEW — B-128: THE CONFLICTS HAVE A CAUSE. TWO JSON SERIALIZERS ARE FIGHTING OVER `public/data/companies/`.** Cron merge scripts write **single-line** JSON; the local rebake/regeneration path writes **pretty-printed**. The 08-14 push prettified files (anheuser-busch → 955 newlines) and **today's crons flipped 326 of them straight back to single-line.** Current split: **387 single-line / 12,443 pretty.** 🚨 **All 5 files that conflicted today were single-line — and single-line JSON cannot merge, because every edit rewrites the one and only line, so any two same-day crons touching the same brand produce a guaranteed whole-file conflict.** This is the most likely upstream driver of B-124's conflicts, it makes hand-reviewing the B-101 queue nearly impossible (a 1-line diff is unreadable), and it inflated today's diff to **188,747 deletions.**
>
> ✅ **THOSE 188,747 DELETIONS ARE REFORMATTING, NOT DATA LOSS — CHECKED, NOT ASSUMED.** Parsed `amazon`/`walmart`/`starbucks`/`microsoft` before vs after: **key counts identical (59/60/61/60), `overall` unchanged (amazon 39.2), and the only differing keys are exactly the ones today's crons refresh** — `dataLastUpdated`, `litigation_courtlistener`, `cpsc`, `doj`, `enriched` — at essentially unchanged byte sizes. **No records dropped.** ⚠️ **Method rule: a huge deletion count in a bot commit is a formatting question first and a data-loss question second — parse and compare the objects, never read the line counts.**
>
> 🆕 **NEW DATASET: `public/data/nhtsa-auto.json`** (added by `9b8352d35`; `nhtsa-weekly` has a clean **8-for-8** success history). **28 auto brands · 25 with data · 1 no-data · 2 skipped · 0 errors**, years 2022–2026 (Tesla: 33 recalls / 4,730 complaints). **Display-only — named in `src/App.jsx:4897`, NOT referenced in `scripts/rebake-scoring.mjs`, so it moves no grades.** Another dark dimension → V-4 territory.
>
> 🔴 **`RESEND_API_KEY` STILL NOT SET — THE 3rd CONSECUTIVE MISS IS NOW CONFIRMED, AND IT FAILED TWICE OVER.** `gh secret list` (2026-08-16) returns the same 7 secrets — `ANTHROPIC_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `DOL_API_KEY`, `MAILERLITE_API_KEY`, `MAILERLITE_GROUP_ID`, `OPENSTATES_API_KEY`, `POSTHOG_API_KEY` — **and no Resend key.** Today's Sunday send produced nothing because **(a)** the secret is absent *and* **(b)** B-127 killed the rebake at step 9 so the notify step **never ran at all.** **Misses: 08-02, 08-09, 08-16.** ⚠️ **Report it as an ongoing outage with a miss count — do not invent a new countdown; that framing has already failed twice to produce action.**
>
> 🟡 **B-101 FLAT AT 39 open data PRs** (39 yesterday, 38 the day before). Oldest is **#116, now 48 days**. 🚨 **Both must-not-merge landmines are still open — #134 (re-adds the CC-BY-NC augment B-63 stripped) and #165 (`data(fmcsa-sms)`, synthetic `.gov`-attributed data under an innocuous title). Drain by hand, never in bulk, never on the title.** ⚠️ **B-128 makes that hand-review materially harder.**
>
> 📌 **Everything else unchanged.** **#155 still 36 rows** (rewritten 2026-08-16T13:44Z) · **B-122 and B-125 unchanged** — `faa`/`fra`/`gdelt` are Monday weeklies still showing their 2026-08-10 kills; **next evidence 2026-08-17 (tomorrow).** 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — repo confirms `CURRENT_PROJECT_VERSION = 81`, `MARKETING_VERSION = 1.1`, and there were **no `ios/`, `android/`, `.github/workflows/`, `src/`, `scripts/`, or `package.json` changes today** (verified by diff). Android still scaffold-only. ⚠️ **The push shipped WEB ONLY — never say "Build 81 has the C-fixes."** ⚠️ **Housekeeping: the 5 untracked `docs/` files remain, day 13.**
>
> 🔴 **WHAT ARON STILL OWES — unchanged at 2:** ① **add `RESEND_API_KEY`** (3 misses deep) ② **install Build 81 and scan 5 real products** — still nobody has run the shipped app. 🧭 **Next engineering work, reordered: B-127 first (one re-baseline unblocks the weekly rebake entirely and is the highest-leverage fix on the board), then B-128, then V-4 and L-1/L-3/L-4.**
>
> ---
>
> **[08-14 sync] IT SHIPPED. THE 12-DAY PUSH FREEZE IS OVER AND PRODUCTION IS SERVING THE CORRECTED CATALOG.** `c2c1216de` (2026-08-14 07:58 EDT) — *"regenerate derived data after rebase onto 84 bot commits"* — carried the whole pile to `origin/main`: **B-115 ×2 · C-1 · C-2 · C-3 · C-4 · C-5 · C-6 · V-1 · V-2/V-3 · B-121 · L-2.** **The clone is now `0 ahead`** (1 behind only because a routine `ofac-sdn` bot commit `f02f4a2d4` landed at 14:27 EDT). **Every "NOT LIVE" and "not yet live" warning on this board is retired. Stop repeating them.**
>
> ✅ **VERIFIED AT THE CDN, NOT INFERRED FROM GIT — this is the check that matters and it was actually run:**
> `curl https://www.trunorthapp.com/data/index.json` → **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256**, 10,240 "?". **Live moved 3,060 → 2,590 (−470), and that drop is the INTENDED C-4/C-5 correction, not a regression.** Local and live are now the same catalog for the first time in 12 days.
>
> ✅ **SPOT-CHECKED PER-BRAND IN PRODUCTION — the fixes reached real users, not just the repo:** **23andMe `B → "?"`** (the C-4 flagship: it had held a B while its own record cited the California AG suing it) · **`"Claude AI synthesis"` → 0 occurrences in the live `23andme.json`** (C-3) · **LiveRamp still `D`** (the CPPA privacy move survived the rebake) · **Ben & Jerry's `A` vs Unilever `C` still diverge** — intended behavior, never "fix" it.
>
> 📊 **THE FULL LIVE DELTA, DIFFED PER-BRAND ACROSS ALL 12,830 ROWS (pre-push `origin/main` → shipped). This is the honest accounting of what the push changed for users — 542 brands moved:**
>
> | transition | brands | what caused it |
> |---|---|---|
> | **B → ?** | **463** | **C-4** — the unsupported "B" removal, the headline of the sprint |
> | C → D | 23 | B-115 tax-avoidance penalty |
> | D → F | 21 | B-115 tax-avoidance penalty |
> | F → ? | 9 | C-4/C-5 evidence gates |
> | ? → D | 6 | B-115 newly graded |
> | B → C | 6 | B-115 |
> | C → F | 5 | B-115 |
> | D → ? | 3 | C-4/C-5 |
> | A → B | 2 | B-115 (`frontier-airlines`, `vital-farms`) |
> | B → D | 2 | B-115 |
> | C → ? | 1 | C-5 contradiction suppression |
> | **F → D** | **1** | **C-3 — `mayo-clinic`, the only brand that got BETTER** |
>
> **Rolled up: 476 grades removed · 6 newly graded · 59 downgraded · 1 upgraded. 3,060 − 476 + 6 = 2,590 ✅ reconciles exactly.** 🔑 **The 463 and the 59 match the C-4 and B-115 predictions on the nose — the sprint did precisely what it claimed, no more.** 🔬 **The single upgrade is the best evidence C-3 was substantive, not cosmetic: `mayo-clinic` F → D because C-3 removed the unsourced "$52.5M federal privacy penalty" that had been driving a published F on a named hospital system.**
>
> ⚠️ **QUOTE 2,590, NOT 2,586.** Yesterday's local figure was 2,586 (D 533); the shipped figure is 2,590 (D 537). **The pre-rebase local `index.json` was rewritten by the rebase, so that +4 cannot be diffed directly and is NOT attributed here** — an earlier draft of this entry guessed it was the four CPPA privacy moves; that guess is withdrawn as unverified. **The live delta above IS fully verified and reconciles, which is the number that matters.**
>
> ✅ **CI EXECUTED AND PASSED ON THE PUSHED COMMIT — the C-6 stop-ship gate is real, not just a local claim.** Run `31798426525` (`ci`, 2026-08-14T11:59Z, `c2c1216de`) → **success**. ⚠️ **Non-trivial context: the two prior `ci` runs (08-09 `4e366d4fa`, 08-10 `2d42cb086`) sat in `action_required` and never executed. This is the first genuine CI execution in recent history and the first time `data-integrity.test.mjs` gated an actual push.**
>
> 🔴 **THE ONE BLOCKER THAT DID NOT MOVE — `RESEND_API_KEY` IS STILL NOT SET, AND IT IS NOW THE ONLY THING STANDING BETWEEN TRUNORTH AND A WORKING EMAIL.** `gh secret list` (2026-08-14) returns exactly: `ANTHROPIC_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `DOL_API_KEY`, `MAILERLITE_API_KEY`, `MAILERLITE_GROUP_ID`, `OPENSTATES_API_KEY`, `POSTHOG_API_KEY` — **no Resend key.** B-121's code is live and `score-rebake-weekly.yml` now passes `--apply`, so the pipeline is armed and pointed at a missing secret. **The next send is Sunday 2026-08-16 — 2 days out. A third miss makes it three consecutive silent weeks.**
>
> 📌 **Machine side quiet; nothing regressed.** **1 bot data commit** on `origin/main` since the push (`ofac-sdn`, 14:27 EDT) and **it did not touch `index.json`** — `index.json`'s last change on `origin/main` is the push itself → **0 grade movement since**. ✅ **`data(news)` for 2026-08-14 landed (`96309826b`) — B-124 did not recur.** **#155 still 36 rows** (rewritten 2026-08-14T14:19Z) · **B-101 still 38 open PRs**, oldest **#116 now 46 days** · **B-122 and B-125 unchanged** (B-125's `faa`/`fra`/`gdelt` are Monday weeklies — next evidence **2026-08-17**). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — **no `ios/` or `android/` changes today** (verified). Android still scaffold-only. ⚠️ **The push shipped WEB ONLY — never say "Build 81 has the C-fixes."**
>
> 🔴 **WHAT ARON STILL OWES — down to 2 items from 3:** ① **add `RESEND_API_KEY` to repo secrets** ② **install Build 81 and scan 5 real products** (still nobody has run the shipped app). 🧭 **Next engineering work: V-4 (the dark `enriched.*` dimensions — grade-moving) and L-1/L-3/L-4.** ⚠️ **Housekeeping: the dirty `public/sitemap.xml` cleared (it went in with the push); the 5 untracked `docs/` files remain, day 11.**
>
> ---
>
> **[08-13 sync] THE BIGGEST HUMAN-WORK DAY SINCE LAUNCH — 9 commits landed (8 code + 1 backlog), and the v1.3 CORRECTNESS GATE IS CLOSED.** `C-3 · C-4 · C-5 · C-6 · V-1 · V-2 · V-3 · B-121 · L-2` all shipped **locally**. Combined with C-1/C-2 (2026-08-10), **every C item and V-1…V-3 are done.** **68/68 tests pass**, including a new **10-assertion `scripts/data-integrity.test.mjs` wired into `ci.yml` to FAIL THE BUILD** (verified by running it). `grep -rl "Claude AI synthesis" public/data/companies/` → **0 files** (was 11,187).
>
> ~~🔴🔴 **NONE OF IT IS LIVE, AND THE GAP IS NOW THE MOST IMPORTANT FACT ON THIS BOARD.**~~ ✅ **RESOLVED 2026-08-14 — pushed as `c2c1216de`, production verified at 2,590 graded. History only:** ⏳ **The clone is `83 behind / 27 ahead`** (28 once this sync's own commit lands) — behind-trend since 08-02: 24 → 34 → 42 → 48 → 51 → 55 → 67 → 73 → 79 → 81 → **83**. **The ahead pile is no longer mostly noise: 12 of the 27 are real code** (B-115 ×2, C-1, C-2, C-3, C-4, C-5, C-6, V-1, V-2/V-3, B-121, L-2); the other 15 are doc commits. 🚨 **`origin/main` still serves 3,060 graded — meaning the live site is STILL publishing the 479 unsupported grades C-4/C-5 removed, the fabricated "F" C-1 fixed, and the 13 false pay ratios C-2 fixed.** **Never describe any C or V item as "fixed" without the words "not yet live."**
>
> 📉 **THE HEADLINE NUMBER, STATED HONESTLY: local graded 3,065 → 2,586 (−479), ON PURPOSE.** ⚠️ **SUPERSEDED — the shipped figure is 2,590 graded (D 537); see the 08-14 header for why the +4.** Re-counted from `index.json`: **12,830 tracked / 2,586 graded** (A 62 · B 706 · C 1,029 · D 533 · F 256), 10,244 "?". The drop is almost entirely **B: 1,170 → 706 — 40% of every B grade rested on non-evidence.** `origin/main` for comparison: 3,060 graded (A 64 · B 1,175 · C 1,052 · D 529 · F 240). **Findable coverage moved the opposite way:** V-1 attached **5,241 shelf-brand names to 193 parents as searchable aliases** (ONE record, MANY aliases — no new catalog rows), taking shelf-brand search correctness **top-1 28%→72%, top-3 31%→93%**.
>
> ⚠️ **CONTRADICTION FOUND AND CORRECTED — this sprint was dated wrong everywhere.** Yesterday's backlog, the skill files, the C-6 comment in `.github/workflows/ci.yml:69`, and the memory file all label the whole v1.3 batch **"2026-08-10."** **Git says otherwise: only C-1 (`b8f529575`) and C-2 (`3c503eca1`) are 08-10. C-3 through L-2 are all authored 2026-08-13** — and yesterday's 08-12 sync independently confirmed they did not exist then. Docs and memory are corrected; **the `ci.yml` comment is code and was left alone — fix it on the next code touch.**
>
> 🟡 **B-121 IS CODE-COMPLETE BUT STILL CANNOT SEND — the blocker moved from a vendor plan to a missing secret.** `58dab0aa4` moves delivery off MailerLite campaigns (the 422) to **Resend** via a new `scripts/lib/send-email.mjs`; MailerLite stays the list store. `score-rebake-weekly.yml` also gains `--apply` — it had been running the notifier **without it, so it had never sent a single notification.** 🔴 **`send-email.mjs:72` returns `{ok:false, error:"RESEND_API_KEY not set"}` — nothing goes out until Aron adds `RESEND_API_KEY` to repo secrets. That is now the activation switch, and Sunday 2026-08-16 is 3 days away; a third miss makes it three weeks silent.** ~~Note this also depends on the push.~~ ✅ **UPDATE 2026-08-14 — the push dependency is GONE (`c2c1216de`); the live crons now run the Resend code. `gh secret list` confirms `RESEND_API_KEY` is still absent, so the secret is the sole remaining blocker and Sunday is now 2 days away.**
>
> 📌 **Machine side was quiet and nothing regressed.** Only **2 bot data commits** on `origin/main` (`news-rss` 06:28Z, `ofac-sdn` 18:30Z), and **`index.json` was NOT touched — its last change on `origin/main` remains the 08-09 rebake `247dd4c87` → 0 live grade movement.** **#155 still 36 rows** (checked 2026-08-13T14:33Z) · **B-101 still 38 open PRs** · B-122 and B-125 unchanged (B-125's `faa`/`fra`/`gdelt` run Mondays; next evidence 2026-08-17). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** — **no `ios/` or `android/` changes today** (verified); Android still scaffold-only.
>
> 🔴 **STILL OPEN AND STILL ONLY ARON'S: ~~① push the 27 ahead-commits~~ ② add `RESEND_API_KEY` ③ install Build 81 and scan 5 real products.** ✅ **① DONE 2026-08-14 (`c2c1216de`); the list is now 2 items.** ✅ **The rebase acceptance test is CLOSED — the rebake was re-run inside the push and the recomputed shipped answer is 2,590 graded.** ✅ **`public/sitemap.xml` cleared (it went in with the push);** the 5 untracked `docs/` files remain.
>
> ---
>
> **[08-12 sync] ZERO human commits again — day 11 of the push freeze.** `origin/main`'s last human commit is still `e29deabd0` (2026-08-02 15:15 CDT, PR #156). Machine-side: only **2 bot data commits** today (`news-rss` 06:27, `ofac-sdn` 18:30), and **`index.json` was NOT touched — its last change on `origin/main` remains the 08-09 rebake `247dd4c87` → 0 grade movement.** **Local catalog re-counted from `index.json`: 12,830 tracked / 3,065 graded** (A 64 · B 1,170 · C 1,041 · D 534 · F 256), 9,765 "?". 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only). ⏳ **The clone is now `81 behind / 17 ahead`** — behind-trend since 08-02: 24 → 34 → 42 → 48 → 51 → 55 → 67 → 73 → 79 → **81**. Still only **3 real code commits** in the pile (B-115, C-1, C-2); the other 14 are doc-sync noise.
>
> 🔴🔴 **NEW TODAY — B-124 IS RECURRING, NOT A ONE-OFF. YESTERDAY'S ENTRY IN THIS FILE WAS WRONG AND IS RETRACTED.** Yesterday I wrote "✅ B-124 did not recur — and the miss is now provably a one-off." **That was asserted from a query window starting 08-05.** Pulling the complete `data(news)` series exposes a **second lost night**: commits exist for 07-28…08-01, 08-03…08-08, 08-10, 08-11, 08-12 — **08-02 and 08-09 are BOTH missing.** Run **`30737556200`** (2026-08-02) was pulled; its log is the B-124 signature byte-for-byte — it printed `[main b341985] data(news): nightly RSS digest … 2026-08-02 [skip ci]`, then `Push attempt 1 failed` → `error: Pulling is not possible because you have unmerged files.` → attempts 2 and 3 died the same way → **GitHub lists the run as `success`.** **2 of the last 11 nights on this one workflow silently threw away a full run's data, and all 117 workflows share that push loop.** ⚠️ **Method rule this earns: "the only gap" describes your query window, not the data. Pull the full series before writing "only" or "one-off."** **The structural fix (`git rebase --abort || true` between attempts + a post-loop push check) is still unwritten in all 117 workflows — this is now a recurring data-loss bug, not a theoretical one.**
>
> 🟡 **NEW TODAY — #155 WENT 37 → 36 ROWS AND NOTHING WAS FIXED.** The cleared row is **`fmcsa-sms-monthly`**, whose 2026-08-12 08:00 run is its **first success ever** (07-12 and 06-12 both failed). Its log says why: `Pass/Property: endpoint redirected to an FMCSA error page (https://ai.fmcsa.dot.gov/SMS/error.html) … keeping last-known-good snapshot data/raw/fmcsa-sms/2026-06.json — not overwriting, exiting 0.` **That is the `--keep-last-on-fail` hardening from PR #144 behaving exactly as designed — the FMCSA source is as dead as it was in June (still B-69), and the green is the soft-fail path.** 🚨 **The consequence is the finding: a soft-fail silently REMOVES a broken pipeline from the watchdog, so the dashboard improves while the data stays frozen.** Three silent modes, now clearly separated — **B-123** exits 1 and never commits · **B-124** commits then fails to push and exits 0 · **soft-fail** succeeds honestly and ships nothing by design. **Standing rule: a row leaving #155 is NOT evidence of a fix. Confirm a `data(<name>)` commit or a PR carrying real data followed.**
>
> 🔴 **NEW TODAY — B-126: PR #165 WOULD SHIP SYNTHETIC DATA UNDER A `.gov` SOURCE URL.** The same soft-failed FMCSA run still opened **PR #165, "data(fmcsa-sms): monthly carrier safety refresh"** — one file, `data/derived/fmcsa-sms-augment.json` (+38/−6). The file self-declares **`"sourceKind": "synthetic"`, `"snapshotDate": "2026-06"`**, and the diff adds invented safety scores under fabricated DOT numbers (`900002`, `900006`, `900007`) — a complete **Knight-Swift** record (unsafeDriving 52, fleetSize 9800, "KNIGHT TRANSPORTATION INC", Phoenix AZ), plus a `ups` → `united-parcel-service` slug rename — with every entry carrying `sourceUrl: https://ai.fmcsa.dot.gov/SMS/Carrier/…`. **The PR title says "refresh"; the payload is fiction.** ✅ **No live exposure — verified, not assumed: `grep -rl 'fmcsaSafetyScores' public/data/` returns 0 files**, and the augment's only consumer is its own producer, `scripts/fmcsa-sms-merge.mjs`. **On a "records, not opinions" product this is the same class of harm as C-1 and C-2, caught before publication.** **Action: close PR #165 (or gate the merge script on `sourceKind !== "synthetic"`); do not merge it.**
>
> 📈 **B-101 UPDATED — the bot-PR pile is now 38 open, not the "~29–30" this file has been carrying.** Oldest is **#116 (2026-06-29), 44 days old.** New since the last count: #157–#165. **Two named landmines now, both requiring the queue be drained by hand, never bulk-merged:** #134 re-adds the CC-BY-NC augment B-63 deliberately stripped, and **#165 injects synthetic `.gov`-attributed safety data (B-126).**
>
> 📌 **No change and both waiting on Aron, not on evidence:** **B-121** outbound email (2 sends missed; next fires **Sunday 2026-08-16**) and **B-122** BIS (`bis-entity-list-weekly` failed 08-10 exactly as predicted — needs a free `api.data.gov` key; **stop re-probing the cert**). **B-125** `faa`/`fra`/`gdelt` run weekly on Mondays, so the next evidence is **2026-08-17**; nothing was due today and nothing appeared.
>
> ---
>
> **[08-11 sync, mislabeled 08-12]** — **ZERO human commits today; yesterday's three fixes are STILL UNPUSHED (day 10).** `origin/main`'s last human commit remains `e29deabd0` (2026-08-02 15:15 CDT, PR #156). Machine-side: **6 bot data commits on `origin/main`** (`ofac-sdn` · `occ` · `nrc` · `finra` · `fdic` · `news-rss`), and **`index.json` was NOT touched — its last change on `origin/main` is still the 08-09 rebake `247dd4c87` → 0 grade movement** (measured, not assumed). **Local catalog re-counted from `index.json`: 12,830 tracked / 3,065 graded** (A 64 · B 1,170 · C 1,041 · D 534 · F 256), 9,765 "?". 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only). ⏳ **The clone is now `79 behind / 16 ahead` — the behind-count has run 24 → 34 → 42 → 48 → 51 → 55 → 67 → 73 → 79 since 08-02, and the 16th ahead-commit is this doc-sync's own predecessor. Seven of the 16 are now doc-sync noise; only 3 are real code.**
>
> 🔬🔴 **NEW TODAY — B-125: THE `timeout-minutes` MYSTERY IS SOLVED, AND TWO OF THE THREE CRONS HAVE NEVER RUN TO COMPLETION IN THEIR LIFETIME.** Four straight doc-syncs recorded "`faa`/`fra`/`gdelt` are weekly and didn't run today, so there is still zero evidence on the residual timeout cause." **They DID run — on Monday 2026-08-10 — and the evidence is unambiguous.** All three were killed at their exact configured limit, inside the **fetch** step, with every later step skipped:
> | workflow | run | job duration | `timeout-minutes` | cancelled step |
> |---|---|---|---|---|
> | `faa-weekly` | `31380090344` | 10:39:40Z → 11:09:53Z (**30m13s**) | **30** | `Run FAA fetcher` |
> | `fra-weekly` | `31385689066` | 11:56:00Z → 12:26:15Z (**30m15s**) | **30** | `Run FRA fetcher` |
> | `gdelt-weekly` | `31388693714` | 12:34:52Z → 14:05:07Z (**90m15s**) | **90** | `Fetch GDELT brand digests` |
> **Three jobs, three different limits, three kills within ~15 seconds of the limit. This is a `timeout-minutes` kill, definitively — not push contention (B-124), not the `.gitignore` `git add` bug (B-123), and not the overlap B-120 destaggered** (they are scheduled 09:22 / 11:07 / 11:54 UTC and do not collide with each other).
> 🚨 **AND THE LIFETIME HISTORY REWRITES THE TRIAGE — these are not three instances of one problem, they are two different problems:**
> - **`faa-weekly` is a REGRESSION with a measurable margin.** It has exactly **one success in its entire history — 2026-06-08, its first scheduled run — and it took `18:09:01Z → 18:38:24Z` = 29m23s against a 30-minute limit. It passed with 37 seconds to spare.** Every one of the **9** runs since (06-15 → 08-10) has been cancelled. **This is an undersized timeout on a job that has always taken ~30 minutes, not a hang.** Raising `timeout-minutes` is a genuine, cheap fix candidate here — it is the one cron on the board with a green baseline to calibrate against.
> - **`fra-weekly` and `gdelt-weekly` have NEVER SUCCEEDED, not once.** `fra`: **10 runs in all of history, all cancelled** (06-08 → 08-10). `gdelt`: **11 runs, all cancelled** (06-03 dispatch → 08-10). ⚠️ **This DIRECTLY CONTRADICTS the standing note that "`faa`/`fra`/`gdelt` have green history" — that is true only of `faa`, and only for a single run.** They belong with `tosdr-monthly` and `au-fair-work-monthly` in the **never-commissioned** class (B-107 triage): no last-good run to bisect, no snapshot ever shipped, nothing to compare a fix against. **The never-succeeded roster is now 4, not 2.** For these two a timeout bump is a guess, not a calibrated fix — the fetcher needs to be profiled locally first.
>
> ~~✅ **B-124 did not recur — and the miss is now provably a one-off, not a pattern.** `git log origin/main --grep='data(news)'` shows nightly commits for 08-05, 08-06, 08-07, **08-08, 08-10, 08-11** — **08-09 is the only missing day in the series**, exactly the run B-124 traced.~~ 🔴 **RETRACTED 2026-08-12 — WRONG. The query started at 08-05 and hid a second miss on 08-02 (run `30737556200`, commit `b341985`, identical signature, reported `success`). B-124 is recurring: 2 of the last 11 nights. See today's entry at the top.** ⚠️ **Two green nights still do NOT close B-124** — it is a race needing a concurrent push to fire, so it will look healthy most days. The structural fix (`git rebase --abort || true` between attempts + a post-loop push check) remains unwritten in all 117 workflows.
>
> ✅ **CRON HEALTH — #155 back to 37 rows** (rewritten 2026-08-11T14:31Z), down from 38, **which is the unwind the 08-07 entry predicted and the 08-10 entry expected.** ⚠️ **Read it with the standing caveats: it lists only NON-success runs, so it is structurally blind to B-124; and it shows only each workflow's LATEST run, so an intermittent cron vanishes on a lucky week.** **37 rows = 36 real + 1 permanent phantom (`canada-comp-monthly`, no workflow file).**
>
> 📌 **CARRY-FORWARD, unchanged today — nothing on either moved, and neither can move without Aron:** 🔴 **B-121 outbound email still DOWN, day 10.** 2 sends missed (08-02, 08-09); **the next send is Sunday 2026-08-16 — 4 days out — and a third miss makes it three weeks silent.** Decision ④ of v1.3 already says **Resend**; nothing has been wired. ⏰ **B-122 BIS** — dead on an expired upstream cert; "wait" is exhausted after four identical probes and the 08-10 confirmation failure; the move is `data.trade.gov/consolidated_screening_list/v1/search`, blocked only on Aron requesting a free `api.data.gov` key. **Stop re-probing daily.**
>
> **[08-11 text] THE DROUGHT BROKE. Three substantive commits landed — the first human work since 2026-08-02** — and they are the two highest-severity correctness fixes this product has shipped plus the **v1.3 program** (below). 🔴 **BUT ALL THREE ARE UNPUSHED, SO NOTHING IS LIVE.** `origin/main`'s last human commit is still `e29deabd0` (2026-08-02 15:15 CDT, PR #156) — **day 9**. Machine-side: **6 bot data commits on `origin/main`, and `index.json` was NOT touched → 0 grade movement** (measured, not assumed). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only).
>
> 🔴🔴 **THE UNPUSHED PILE CHANGED IN KIND — STOP CALLING IT "THE B-115 PUSH."** *(Counts below are the 08-11 snapshot; today's number is **79 behind / 16 ahead** — see the header.)* The clone was **73 behind / 15 ahead** (was 67/11 the day before; the behind-count has run 24 → 34 → 42 → 48 → 51 → 55 → 67 → 73 since 08-02). **Two of the 15 commits fix claims the live site is publishing RIGHT NOW about named real companies.** Until Aron pushes, C-1 and C-2 are **fixed on disk and still broken in production** — a materially worse state than "a scoring model isn't live yet." ⚠️ **Never report C-1 or C-2 as "fixed" without the words "not yet live."** The push now carries three separate payloads: **B-115 Pay & Tax scoring · the fabricated-F fix · the false-pay-ratio fix.**
>
> 🔴 **C-1 DONE (`b8f529575`) — TruNorth was publishing a fabricated "F" on 9,765 companies it has never graded.** Ungraded brands carry `overall: null`; **`Number(null)` is `0`, which IS finite**, so the `isFinite()` guard in `api/alternatives-seo.js:63-64` passed and `grade(0)` returned **"F"**. All **12,792** of those `/alternatives` pages are in `sitemap.xml`, so it was indexed. Fixed via a `numOrNull()` helper at the **root of `grade()`** (every call site inherits it) plus the 3 call sites doing their own coercion, and the identical latent defect hardened in `api/company-seo.js`. Verified against the real handlers: ungraded subject now asserts **no** grade; graded subject (10x Genomics, 61) still reports **B**; ungraded peers can no longer be ranked as "higher-graded alternatives" as if they scored 0. ⚠️ **Reusable trap: `isFinite(Number(x))` is NOT a null guard — it admits `null`, `false`, `''`, `[]`. Grep `isFinite(Number(` before trusting any similar guard.**
>
> 🔴 **C-2 DONE (`3c503eca1`) — 13 publicly FALSE CEO pay-ratio claims, 0 grade drift.** The `sec-def14a` parser **drops a leading "1"** (Coca-Cola 1739→739 · McDonald's 1082→82 · Starbucks 1794→794 · Ross 1730→730 · Ulta 1296→296 · Victoria's Secret 1360→360 · Wingstop 1590→590 · WBD 1378→378 · Dick's 1341→341 · Pottery Barn 1335→335 · Wayfair 5702→702) and **on Home Depot parsed the filing YEAR as the ratio** — publishing *"2026:1 … CEO total comp $2K"* against a real **427:1 / $16.2M**. ✅ **Dry rebake "updated 0 files", catalog unchanged at 3,065/12,830 — display-only, confirmed not assumed.** ✅ **This retroactively VINDICATES B-115's call to cut the enriched SEC pay ratio from scoring: `parsePayRatio()` reads legacy sources only, so none of the fabricated numbers were ever graded. Had it still been wired in, 13 named companies would have been graded off garbage.** ⚠️⚠️ **THE UPSTREAM PARSER IS STILL BROKEN — these 13 REGRESS on its next successful run. And `sec-def14a-annual` is also a B-123 victim, so its first green run ships ~2 months of withheld data AND re-introduces the false ratios. Fix the parser in the same pass as the `git add` line; landing B-123 alone makes this worse.** Remaining known defect: Pottery Barn's `payRatio.medianWorkerPay` ($53,686) contradicts its own ratio and CEO pay (true median $24,943) — the `ratio === ceoPay/medianWorkerPay` identity is the cheap corpus-wide validator.
>
> ⚠️ **CONTRADICTION FOUND — the plan doc is WRONG about the rebake notify step; do NOT "fix" it as a bug.** `docs/research/v1.2-growth-strategy-2026-08-10.md` §3 lists `score-rebake-weekly.yml:105` "running as a dry run without `--apply`" among the defects. **The workflow carries an explicit comment: *"DRY RUN ON PURPOSE — it sends nothing. Email is irreversible and outward-facing, so the recipient set gets proven in the logs for a few weeks before anyone flips this to `--apply`."*** That is a deliberate safety gate. **Flipping `--apply` is a decision to start sending real mail, not a bug fix — and it is moot until B-121 is resolved, since the same broken MailerLite call sits underneath it.**
>
> ⚠️ **UNCOMMITTED ON DISK — `public/sitemap.xml` was regenerated today and never staged** (+36,576 / −35,820; every `lastmod` moved 2026-06-12 → 2026-08-10). **It is NOT required for C-1** (that fix is in the API handler, not the sitemap), but it is sitting dirty and a future session could sweep it into an unrelated commit. Also still untracked: `docs/AI-OPERATOR-REFERENCE.{md,docx}`, `docs/trunorth-project-brief.md`, `docs/research/v1.1-diligence-review-2026-07-02.md`, `docs/research/v1.2-big-update-plan-2026-07-18.md`.
>
> ✅ **`news-rss-nightly` LANDED TONIGHT (`2eaee1292`) — the B-124 loss did not repeat.** ⚠️ **One green night does NOT close B-124** — the defect needs a concurrent push to trigger, so it will look fine most days. The structural fix (`git rebase --abort` between attempts + a post-loop verification) is still unwritten in all 117 workflows.
>
> 📌 **CARRY-FORWARD, unchanged today:** 🔴 **B-121 outbound email still DOWN** — 2 sends missed (08-02, 08-09); **next is Sunday 2026-08-16 and a third miss makes it three weeks silent.** Aron's call: upgrade MailerLite or move to Resend (decision ④ below says **Resend**). ⏰ **B-122 BIS** — the 08-10 run failed with `CERT_HAS_EXPIRED` exactly as forecast and a **fourth** off-runner probe was byte-identical; **"wait" is exhausted**, the move is `data.trade.gov/.../v1/search`, blocked only on Aron requesting a free `api.data.gov` key. **Stop re-probing daily.**
>
> 🔴🔴 **NEW TODAY — B-124: THE PUSH RETRY LOOP IN 117 WORKFLOWS IS BOTH UNRECOVERABLE AND SILENT. This is bigger than B-123.** Every data cron ends with the same block: `for i in 1 2 3; do git pull --rebase origin main && git push origin main && break; echo "Push attempt $i failed, retrying…"; sleep 5; done`. **Two defects compound.** (1) **The retries cannot possibly work.** When `git pull --rebase` conflicts, the repo is left mid-rebase with unmerged files, and **not one workflow calls `git rebase --abort`** — `grep -l 'rebase --abort' .github/workflows/*.yml` returns **0 of 117**. Attempts 2 and 3 then die instantly on `Pulling is not possible because you have unmerged files`. **"3 retries" is really 1 try.** (2) **The failure is invisible.** The loop's last command is `sleep 5`, which exits 0, and **nothing verifies the push afterwards** — so the step, job and workflow all exit **0** and GitHub marks the run **green**. 🔬 **CONFIRMED LIVE, not theorised — `news-rss-nightly` run `31296988521` (2026-08-09T05:34Z): 22m50s of RSS + AI extraction, a successful commit (`[main bb945f1] data(news): … 2026-08-09`), 3 failed pushes, and the run is listed as `success`. There is no `data(news)` commit for 08-09 on `origin/main` — an entire night's work was built and discarded.** The trigger was real concurrency (news-rss overlapped the `cfpb`/`courtlistener`/`cpsc`/`cruelty-free` pushes) — **so this is the FIRST genuine push-contention evidence in the repo; B-120's 3 suspected rows turned out to be B-123, but this one really is contention.** 🚨 **THE CONSEQUENCE IS THE HEADLINE: a green cron no longer means its data shipped, and issue #155 UNDERSTATES breakage by construction — it lists only non-success runs, and B-124 failures ARE successes. To check whether a data cron landed, look for its commit (`git log origin/main --grep='data(<name>)'`), never the run status.** ⚠️ **Do not confuse with B-123 — the last 4 log lines look identical but the fixes are opposite: B-123 = 4 workflows, exits 1, log says `paths are ignored`, commit never happens; B-124 = 117 workflows, exits 0, log PRINTS a successful `[main <sha>]` commit and then fails to push.** **Fix shape: `git rebase --abort || true` before each retry, plus a post-loop check so the job exits non-zero when all attempts fail.** **Unknown and worth scoping next: how many past "green" runs silently lost data — B-124 has been latent in every one of these 117 workflows for as long as the loop has existed.**
>
> 🔴 **GRADES MOVED — first movement on `origin/main` in 8 days, and the chain is fully traced (no engine change).** `7a6caa342` (2026-08-08, `cppa-data-brokers-quarterly`) refreshed the CPPA data-broker registry and touched exactly 4 company files; the **08-09 weekly rebake `247dd4c87`** then rescored them. **Per-brand diff of all 12,830 rows, `247dd4c87^ → 247dd4c87`: 4 changes — 0 better · 3 worse · 1 newly graded.** **`liveramp` B→D · `veeva-systems` B→D · `zeta-global` B→D · `viant-technology` ?→D.** Mechanism is visible in the diff: each gained a **`"privacy": 8`** dimension score (`privacy` is a scored category at weight 4). **`origin/main` graded count 3,059 → 3,060.** ✅ **This vindicates the [[data-crons-can-move-grades]] rule twice in four days: the 08-07 SAM commit diffed to 0 changes, this one to 4 — same method, opposite result. Always diff per-brand; never infer from the commit label.**
>
> **[08-07] ZERO human commits, the FIFTH day in a row. The last human commit on `origin/main` is still `e29deabd0` (2026-08-02 15:15 CDT, PR #156); locally still `9c955183e` (2026-08-02 15:46 CDT). Machine-side: 4 bot data commits on `origin/main` (`news-rss`, `ofac-sdn`, `sam-exclusions`, `trending`).** ✅ **Grade-safety check done the hard way, because one of today's commits was the exact kind memory warns about: `22f494ca1 data(sam): exclusions refresh` DID touch `index.json`, `meta.json` and `search-index.json` (Huawei alone gained 163 lines). A per-brand diff of all 12,830 rows across `9ab2ecab9 → ae9d88a41` returns 0 grade changes / 0 new slugs. A SAM commit that touches `index.json` is not automatically a grade move — but it always has to be diffed, never assumed.** ✅ **YESTERDAY'S PREDICTION LANDED EXACTLY: #155 posted a 38th row, and it is `ofac-sdn-daily` (08-06T18:53Z failure) — a timing artifact, not new breakage.** 🔮 **AND IT ALREADY UNWOUND: `ofac-sdn-daily` SUCCEEDED at 2026-08-07T18:25Z (after today's 14:18Z rewrite) and shipped `9ab2ecab9`. So tomorrow's list drops back to 37. This is the SECOND clean confirmation of B-103's "wait one cycle, change no code" rule — do not reopen it.** ⚠️ **TODAY'S REAL FIND — `tosdr-monthly` and `au-fair-work-monthly` have a 0% LIFETIME success rate, which is sharper than "recurring."** Each has exactly **2 runs in its entire history and BOTH were cancelled** (`tosdr`: 07-06, 08-07; `au-fair-work`: 07-04, 08-04). These are not intermittent crons that regressed — **they have never once completed**, so there is no "last good run" to compare against and no snapshot they have ever shipped. Treat them as never-commissioned fetchers inside B-107, not as flaky ones. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only).
>
> **[08-06] ZERO human commits, the FOURTH day in a row. The last human commit on `origin/main` is still `e29deabd0` (2026-08-02 15:15 CDT, PR #156); locally still `9c955183e` (2026-08-02 15:46 CDT). Machine-side movement was the LIGHTEST in a week: only 3 bot data commits on `origin/main` (`trending`, `news-rss`, `canada-competition-bureau`) and they moved 0 grades.** 🔴 **TODAY'S FIND — `ofac-sdn-daily` FAILED again at 2026-08-06T18:53Z after 5 straight green days (08-01 → 08-05).** This is the B-103 signature repeating, not a regression: B-103 closed with **zero code changes** because the 403 is CI-only. **Do not "fix" the fetcher.** ⏰ **But it has a scheduling consequence: the health check runs at ~15:27Z and OFAC runs at ~19:00Z, so tomorrow's #155 rewrite will see the 08-06 failure as OFAC's latest scheduled run and post a 38th row — the first non-flat day in four. Expect it; it is a timing artifact of a source that self-heals, not new breakage.** ⚠️ **Also new: `tosdr-monthly` was CANCELLED again at 2026-08-07T01:04Z — 2-for-2 cancelled on its last two monthly runs, exactly the `au-fair-work-monthly` pattern. It joins the standing `timeout-minutes` suspect list (B-107 triage), promoted from "stale 07-06 row" to "recurring."** ✅ **Cron health list flat at 37 rows for a THIRD straight day.** 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only).
>
> **[08-05] ZERO human commits, the THIRD day in a row. The last human commit on `origin/main` is still `e29deabd0` (2026-08-02 15:15 CDT, PR #156); locally still `9c955183e` (2026-08-02 15:46 CDT). All movement was machine-side: 6 bot data commits on `origin/main` that moved 0 grades.** 🔴 **TODAY'S REAL FIND — the 3 "commit+push failure" crons are NOT push contention. `sec-8k-events-monthly` finally ran (the test B-120 was waiting for) and the log gives an unambiguous cause: `git add` targets `public/data/_cache/…`, which `.gitignore:90` ignores, so under `bash -e` the step exits 1 BEFORE `git commit` — every run does its full fetch and then throws 100% of the work away. Confirmed in the logs of all three. New item **B-123**; one-line fix per workflow.** ✅ **Cron health list flat at 37 rows for a second straight day.** 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82** (no `ios/` or `android/` changes; Android still scaffold-only).
>
> **CATALOG — MOVED on 2026-08-09 after eight flat days; still two numbers, both counted from `index.json` on 08-10.** **LOCAL (has B-115, but NOT the 08-09 rebake): 12,830 tracked / 3,065 graded**, 9,765 "?". **`origin/main` (no B-115, what the live site serves): 12,830 tracked / 3,060 graded**, 9,770 "?" — **up 1 from 3,059** (`viant-technology` ?→D; the other 3 CPPA moves were downgrades inside the already-graded set). ⚠️ **THE GAP IS NOW 5, NOT 6, AND IT IS NO LONGER A PURE B-115 GAP.** Local is ahead by B-115's 6 brands but **behind by the 4 CPPA privacy moves it has never seen. After the rebase the union should be 3,066 — not 3,065 and not 3,060. Stop describing the delta as "the 6-brand B-115 gap"; it is now two-directional.** **Re-counted today at `ae9d88a41`. Unlike the last four days, this one required an actual diff rather than a "nothing touched `index.json`" shortcut — the SAM exclusions commit `22f494ca1` DID rewrite `index.json`/`meta.json`/`search-index.json`. Per-brand comparison of all 12,830 rows, `9ab2ecab9 → ae9d88a41`: 0 grade changes, 0 new slugs. Zero grade movement, verified, not assumed.** The 6-brand gap IS B-115 and nothing else. ⚠️ **The 08-01 header's "3,060 / A 62" was measured at `a8ba45a7c` — the REJECTED first pass — so it is not a valid baseline for anything. The true pre-B-115 baseline is `c0a7450f2` = 3,059 / A 64.**
>
> ✅ **B-115 MONOTONIC-DOWN IS NOW PROVEN, not asserted.** Per-brand diff of `c0a7450f2` → `3bdae9815` across all 12,830 rows: **0 upgrades · 38 downgrades · 6 newly graded** (atmos-energy, telephone-and-data-systems-de, ugi-pa, voya-financial, williams-companies, xcel-energy — **all ?→D**). A-grades untouched. The design claim in the item text holds exactly as written.
>
> 🚨 **ACTION FOR YOU — B-115 IS COMMITTED BUT NOT PUSHED (day 9).** ⏳ **TODAY'S NUMBER: `67 behind / 11 ahead` on a fresh 08-10 fetch. The trend behind: 24 (08-02) → 34 → 42 → 48 → 51 → 55 → 67 today — a +12 jump across the 3-day gap, the largest yet.** 🔴 **THE REBASE GOT HARDER IN KIND, NOT JUST IN SIZE.** Until 08-09 every commit you were rebasing over was grade-neutral, so the merge was mechanical. **The 08-09 rebake `247dd4c87` broke that: it rewrote `index.json`/`meta.json`/`search-index.json` AND 4 company files, and it MOVED 4 GRADES that B-115 knows nothing about.** Consequences: **(1) re-running the rebake after the rebase is now mandatory, not optional; (2) the expected post-rebase drift is no longer the clean 0-up/38-down/6-new tax set — it should be that set PLUS the 4 CPPA privacy moves (`liveramp`/`veeva-systems`/`zeta-global` B→D, `viant-technology` ?→D), landing at 3,066 graded. If you see only 38 downgrades, the rebase silently dropped the privacy data; if you see fewer than 6 new grades, it dropped B-115.** ⚠️ **The `ahead` side moved too, and it is worth naming: 9 → 10, and the new one is this doc-sync's own commit. Six of the ten commits you are carrying are now doc-sync/geo noise; only 2 are real code (`a8ba45a7c` superseded by `3bdae9815`). Every day this sits, the rebase gets 4–10 commits wider AND one commit of self-generated noise deeper.** The rest of this item is unchanged from 08-05 and still accurate:
>
> **[08-05 text] B-115 IS COMMITTED BUT NOT PUSHED (day 4, and the cost of waiting is now measurable).** The FINAL Pay & Tax is `3bdae9815` (it supersedes the rejected first pass `a8ba45a7c`; **both are local-only**). `origin/main` has neither and the **live site still scores the old `execPay`**. **Your push is what takes "Pay & Tax" live.** The clone is now **48 behind / 8 ahead** (fresh `git fetch` on 08-05). **The trend is the point: 24 behind on 08-02 → 34 on 08-03 → 42 on 08-04 → 48 today, ~6–10 bot data commits/day. This is a rebase that grows every single day you don't do it, and none of that growth is work you want.** Only 2 of the 7 ahead are code; the rest is doc-sync/geo noise. This sync deliberately did **not** pull, rebase, or push, because rebasing a scoring commit over 42 bot data commits is a merge you drive, not an unattended job. ✅ **Good news that shrinks the job: the geo commit `5ae00931e` already landed on `origin/main` independently as PR #156 (`e29deabd0`, byte-identical 49-line `docs/geo-prompt-audit.md`), so the rebase should drop it as already-applied — you are effectively rebasing 2 real commits, not 7.** Suggested: `git pull --rebase origin main`, resolve `index.json`/`meta.json`/`search-index.json` by re-running the rebake, confirm the drift is still the 0-up/38-down/6-new tax set, then push.
>
> 🥇🔴🔴 **#1 ITEM ON THE BOARD — ALL OUTBOUND EMAIL IS DOWN (B-121, day 9). THE DEADLINE PASSED. THE SECOND SEND WAS MISSED.** ⏰ **Confirmed 2026-08-10 from run history AND the failing log: `weekly-digest` ran Sunday 2026-08-09T18:28Z and FAILED with the byte-identical `MailerLite campaigns 422: {"message":"Content submission is only available on Premium plan."}` (run `31329104909`). That is 2 consecutive misses — 08-02 and 08-09 — after 7 clean Sundays. The 08-08 decide-by date came and went with no decision made.** 🔴 **THE FRAMING HAS TO CHANGE: this is no longer "a blip with a deadline ahead of it." The newsletter has now been silent for two weeks, which is exactly the outcome the 08-02 entry warned about — to a subscriber it reads as abandoned, not delayed.** **Next send: Sunday 2026-08-16. A third miss makes it three weeks.** ⚠️ **Nine days of a byte-identical 422 also kills any "wait it out" reading — this is a plan entitlement that will not restore itself.** **The decision is unchanged and still only Aron's: upgrade the MailerLite plan, or move sends to Resend (already wired for `trunorthapp.com`). Tier-3 "Notify me when we grade this" remains broken on the same call (`scripts/notify-newly-graded.mjs:307`), silent only because it is DRY-RUN unless `--apply`.** The 08-07 framing below is now superseded but kept for the trend:
>
> **[08-07 text] #1 ITEM ON THE BOARD — ALL OUTBOUND EMAIL IS DOWN (B-121, day 6). YOU HAVE 2 DAYS, AND THE DECIDE-BY DATE IS TOMORROW.** ⏰ **Re-verified 2026-08-07 from run history AND from the failing log itself: `weekly-digest`'s last run is still the 2026-08-02T18:58Z failure, and the error is byte-for-byte the same — `MailerLite campaigns 422: {"message":"Content submission is only available on Premium plan."}`. Nothing has changed in six days. Exactly ONE send has been missed. The next send fires Sunday 2026-08-09.** **This is the only open item where doing nothing creates a NEW, externally-visible failure on a known date — every other red item on this board is already-broken-and-stable.** **Decide tomorrow (08-08) — upgrade the MailerLite plan, or move the send to Resend (already wired for `trunorthapp.com`) — so there is one day to test before it fires.** If 08-09 also misses, this stops being "a blip" and becomes a newsletter that looks abandoned to every subscriber. The rest of this item is unchanged from 08-02 and still accurate:
>
> **[08-02 text] ALL OUTBOUND EMAIL IS DOWN (B-121).** `weekly-digest` failed at 2026-08-02T18:58Z after **7 consecutive clean Sundays** (Jun 14 → Jul 26). Cause is not code: MailerLite returned **422 `"Content submission is only available on Premium plan."`** on `POST /campaigns`. **The 2026-08-02 subscriber digest did not go out** — first miss since launch. Same call, same failure mode, sits at `scripts/notify-newly-graded.mjs:307` — so **Tier-3 "Notify me when we grade this" is broken too**; it just hasn't screamed because it is DRY-RUN by default and will only 422 the moment you run `--apply`. ⏰ **Deadline, confirmed from run history today: exactly ONE send has been missed (08-02). The next one is Sunday 2026-08-09.** Either fix — upgrade the MailerLite plan, or move the send to Resend (already wired for `trunorthapp.com`) — **has to be in before 08-09, or one skipped week becomes a newsletter that looks dead.**
>
> 🔴 **NEW TODAY — 4 crons have been throwing away perfectly good data for 8 WEEKS because of a one-line `git add` / `.gitignore` mismatch (B-123).** On 2026-06-11 commit `f356963c2` ("untrack 398MB pipeline `_cache`") added **`public/data/_cache/` to `.gitignore:90`** — but **4 workflows still `git add` a path underneath it**: `sec-8k-events-monthly.yml:52`, `sec-def14a-annual.yml:53`, `usaspending-quarterly.yml:45`, `ca100-annual.yml:59`. Those steps run under `shell: bash -e`, so `git add` exits 1 on the ignored path and the step dies **before `git commit`** — the "push retry loop" in the log is a red herring; the push never happens. **Confirmed from three separate run logs, and the waste is large: `sec-8k` fetched 1,913 records / 1,231 with events and wrote 1,000 company files, `sec-def14a` wrote 2,982 records / 1,606 usable, `usaspending` wrote its contracts file — then all of it was discarded.** ✅ **This also CLOSES the open question in B-120: these 3 were never push contention.** `ca100-annual` is the latent fourth — its last run (2026-06-07, manual) predates the ignore rule and passed, so it will fail on its next scheduled run. **Fix is one line per file** (drop the `_cache` arg, or append `|| true` as `health-signals-monthly.yml:48` already does).
>
> ⏰🔴 **DECISION DUE TODAY AND THE EVIDENCE HAS ANSWERED IT — `bis-entity-list-weekly` is dead on an EXPIRED TLS CERT at the source (B-122, day 13).** ✅ **The predicted 08-10 run fired at 02:53Z and FAILED with `CERT_HAS_EXPIRED` (run `31351035643`) — forecast exactly, so treat it as confirmation, not news.** 🔬 **Re-probed from the Mac 2026-08-10 — IDENTICAL for a FOURTH reading (08-05 · 08-06 · 08-07 · 08-10): `api.trade.gov` → `certificate has expired`, `ssl_verify_result=10`, `notAfter = Jul 28 10:56:42 2026 GMT` UNCHANGED; `data.trade.gov` → `ssl_verify_result=0`, answers 301.** 🚨 **THIRTEEN DAYS AND A FULL EXTRA WEEKLY CYCLE WITH A STATIC `notAfter` EXHAUSTS OPTION (a).** The standing plan said *decide on the DATE, not the failure* — the date is here, and the reading is that Commerce is not reissuing this host. **Recommended: move to `data.trade.gov/consolidated_screening_list/v1/search`, which is TLS-healthy and returns 401 — meaning the only blocker is an `api.data.gov` key, which is Aron's to request. That key request is the next action on this item.** 🚫 Never "fix" this by disabling cert verification. **0 grade impact — the fetcher hard-fails before writing, so the last-good snapshot stands.** Prior text:
>
> **[08-07 text] STILL OPEN — `bis-entity-list-weekly` is dead on an EXPIRED TLS CERTIFICATE at the source (B-122, day 10).** ⏳ **RE-PROBED 2026-08-07 from Aron's Mac — IDENTICAL for a THIRD consecutive day (08-05 · 08-06 · 08-07).** `api.trade.gov` (the host our fetcher actually calls) still returns `certificate has expired`, `ssl_verify_result=10`. `data.trade.gov` still presents a **valid** cert (`ssl_verify_result=0`, answers `301`). **Three days of identical readings is no longer "the reissue hasn't reached us yet" — it says the host-by-host rollout has STALLED on our host specifically. Weight option (b) accordingly when you decide on 08-10.** 🔬 **The probe rule stands and is cheap (10 seconds): probe the exact HOST, never the domain. "trade.gov is fixed" is not a checkable claim.** **Nothing changes the plan: expect the ~08-10 run to fail, and decide on the DATE, not the failure.** The rest of this item is unchanged from 08-03/08-05 and still accurate:
>
> **[08-03 text] `bis-entity-list-weekly` is down on an EXPIRED TLS CERT (B-122).** The fetcher's primary endpoint `https://api.trade.gov/static/consolidated_screening_list/consolidated.csv` now fails with **`CERT_HAS_EXPIRED`**. **Root cause is verified and dated, not guessed:** the `*.trade.gov` certificate (Dept. of Commerce, issued by Entrust) has `notAfter = Jul 28 10:56:42 2026 GMT` — **it expired 6 days ago.** BIS ran green on 07-27 (the day before expiry) and failed on 08-03, its first run after. ⚠️ **This is the OPPOSITE of B-103/OFAC: the failure REPRODUCES off-runner** — `curl` from Aron's Mac returns the same `certificate has expired`. **So it is a real upstream break, not a CI artifact, and "wait one cycle" only works if Commerce renews.** Nothing to fix in our code. **Cheapest correct response: wait one week; if 08-10 also fails, switch to `data.trade.gov/consolidated_screening_list/v1/search` (returns 401 — needs an API key) or scrape the BIS site.** No grade impact — the last good snapshot stands. ⏳ **RE-PROBED 08-05 (day 8) — and the picture CHANGED in a way that matters: the renewal is rolling out host-by-host.** `api.trade.gov` (the endpoint our fetcher actually uses) is **still expired** — `curl` returns `certificate has expired`, `ssl_verify_result=10`, same `notAfter = Jul 28 10:56:42 2026 GMT`. **But `data.trade.gov` now presents a VALID cert** — `ssl_verify_result=0`, answering `401` (i.e. healthy, just needs a key). **So Commerce IS reissuing; `api.trade.gov` simply hasn't been done yet.** That makes option (a) "wait" look better than it did yesterday, and it also means option (b) is now a live, TLS-healthy fallback rather than a theoretical one. **Still expect the ~08-10 run to fail; decide on the date, not the failure.**
>
> ✅ **CRON HEALTH — FIRST FLAT DAY IN FOUR. The list stopped growing.** Issue **#155 held at 37 rows** (20 hard failures + 17 cancelled) at the 08-04T15:34Z rewrite — **same population as 08-03, zero new rows**, ending a 3-day run of new hard failures (15 → 17 → 20 → 20). **Today's scheduled runs: 10 total — 9 success · 1 cancelled = 90% healthy, up from 67% on 08-03 and 80% on 08-02.** ⚠️ **Don't over-read it — nothing was fixed, the slate was just easy.** `faa`, `fra` and `gdelt` are **weekly and did not run today**, so today produced **no new evidence** on the residual `timeout-minutes` cause that B-120's destagger left behind. The single cancellation was **`au-fair-work-monthly`** (08:29Z) — not a new row, just a date refresh from 07-04; **it has now been cancelled on both of its last two monthly runs**, which makes it a standing timeout suspect rather than a fluke. ✅ `ofac-sdn-daily` green again — B-103's zero-code-change closure holds. **37 broken crons is still the real number.**
>
> ⚠️✅ **CRON HEALTH 2026-08-07 — the streak broke at 38 rows, exactly as predicted, and it will heal itself tomorrow.** Issue **#155 rewrote at 08-07T14:18Z and posted 38 rows** — up from four flat days at 37. **The 38th row is `ofac-sdn-daily` (latest scheduled run: failure, 2026-08-06T18:53Z)**, which is precisely what the 08-06 entry told you to expect. ✅ **And the unwind is already on the board: `ofac-sdn-daily` ran again at 08-07T18:25Z and SUCCEEDED, shipping `9ab2ecab9`. Because that success landed AFTER the 14:18Z rewrite, tomorrow's list should return to 37. If it does, do nothing — that is the system working.** **Scheduled runs in the health window (08-06T15:27Z → 08-07T14:18Z): 6 total — 4 success · 1 failure · 1 cancelled = 67% healthy.** ⚠️ **Read that 67% against its denominator, not against yesterday's 89%: 6 runs is the thinnest slate yet recorded, and two of the six ARE the health check itself. A single cancellation on a 6-run day costs 17 points; on a 30-run day it costs 3. The percentage is noise at this sample size — the 38-row population count is the signal.** ⚠️ **For the FOURTH day running the weekly long-runners (`faa`, `fra`, `gdelt`) did not run, so there is still ZERO new evidence on the residual `timeout-minutes` cause B-120 left behind.** The window's one cancellation is `tosdr-monthly` (08-07T01:04Z) — a date refresh on an existing row, not a new one, **but see the header: it and `au-fair-work-monthly` have now never succeeded even once.** **38 rows = 37 real + 1 permanent phantom (`canada-comp-monthly`).**
>
> ✅⚠️ **CRON HEALTH 2026-08-06 — FLAT FOR A THIRD STRAIGHT DAY, but tomorrow will break the streak for a reason that is not breakage.** Issue **#155 held at 37 rows** at the 08-06T15:27Z rewrite — **same population as 08-05, 08-04 and 08-03; four days now with zero new rows.** **Scheduled runs in the health window (08-05T15:27Z → 08-06T15:27Z): 9 total — 8 success · 1 failure = 89% healthy** (08-05 91%, 08-04 90%, 08-03 67%). ⚠️ **Keep quoting the denominator, not just the percentage: 9 runs is a thin slate, and the weekly long-runners (`faa`, `fra`, `gdelt`) again did not run — so today produced NO new evidence on the residual `timeout-minutes` cause.** The one failure is `sec-8k-events-monthly` (08-05T21:16Z) — **the same run counted yesterday**, landing in today's window because it fired after yesterday's rewrite; it produced a date refresh on an existing row, exactly as 08-05 predicted. ✅ **`canada-competition-bureau-monthly` SUCCEEDED (05:25Z) and shipped data (`5286b5715`)** — and re-verified today, it is the ONLY row of the 37 with **no workflow file in the repo**: the phantom is the *old* `canada-comp-monthly`, deleted by B-108. **Confirmed mechanism: `cron-health-daily` groups by `.workflowName` from run history, not by workflow file, so a deleted workflow's last failing run can never age out. 37 rows = 36 real + 1 permanent phantom.** 🔮 **PREDICTION FOR TOMORROW, so it is not misread as a new break: `ofac-sdn-daily` failed at 08-06T18:53Z (after the rewrite). OFAC runs ~19:00Z, the health check runs ~15:27Z — so the 08-07 rewrite will see the failure as OFAC's latest scheduled run and post a 38th row. Per B-103 that is a CI-only 403 that self-heals; wait one cycle, change no code.**
>
> **[08-05] CRON HEALTH — FLAT FOR A SECOND STRAIGHT DAY.** Issue **#155 held at 37 rows again** (20 hard failures + 17 cancelled) at the 08-05T15:27Z rewrite — **same population as 08-04 and 08-03; three days now with zero new rows.** **Today's scheduled runs: 11 total — 10 success · 1 failure = 91% healthy** (08-04 90%, 08-03 67%, 08-02 80%). The one failure is **`sec-8k-events-monthly` at 21:16Z — and it is the most useful failure in weeks, because it is what cracked B-123.** ⚠️ **Two counting notes so tomorrow isn't misread:** (1) `sec-8k` failed *after* the 15:27Z health rewrite, and it was already a row (dated 07-05), **so tomorrow's list will show a date refresh, not a 38th row — still flat**; (2) as on 08-04, the weekly long-runners (`faa`, `fra`, `gdelt`) **did not run today**, so today again produced **no new evidence** on the residual `timeout-minutes` cause. ✅ `ofac-sdn-daily` green again (B-103 closure holds). **37 broken crons is still the real number — but B-123 now accounts for 3 of them with a known one-line fix.**
>
> **📊 QW-20 KPIs — `brands_added` = 0 · `brands_graded` = +1** (2026-08-10, covering 08-08 → 08-10). 🔴 **THE ZERO STREAK IS BROKEN at six days.** Catalog is **12,830 tracked / 3,060 graded on `origin/main`** (was 3,059). **`brands_graded` = +1 is `viant-technology` (?→D); alongside it 3 already-graded brands were DOWNGRADED B→D (`liveramp`, `veeva-systems`, `zeta-global`), which the headline KPI does not capture — 4 grades moved in total, net graded-count +1.** ⚠️ **Method note: this was a MEASURED result from a full 12,830-row per-brand diff across the 08-09 rebake `247dd4c87`, not inferred. Keep doing it this way whenever `index.json` moves — the same method returned 0 changes on 08-07 and 4 changes here.**
>
> **[08-07] 📊 QW-20 KPIs — `brands_added` = 0 · `brands_graded` = 0. Sixth consecutive day both are zero.** Catalog is 12,830 tracked / 3,059 graded on `origin/main`. ⚠️ **Method note for whoever reads this next: today's zero is a MEASURED zero, not an inferred one. `22f494ca1` rewrote `index.json`, so the usual "no commit touched `index.json`" shortcut was unavailable and a full 12,830-row per-brand grade diff was run instead (0 changed, 0 new). Keep doing it this way whenever `index.json` moves.**
>
> **[08-05] 📊 QW-20 KPIs — `brands_added` = 0 · `brands_graded` = 0.** Fourth consecutive day both are zero; today's 6 bot commits touched raw snapshots, augments, news and trending only — **not `index.json`**.
>
> **[08-11] 📊 QW-20 KPIs — `brands_added` = 0 · `brands_graded` = 0.** Catalog is **12,830 tracked / 3,065 graded LOCAL, 3,060 on `origin/main`**. Today's zero used the valid shortcut: **`index.json` was not touched by any of the 6 bot commits** (its last change on `origin/main` is still the 08-09 rebake `247dd4c87`), so no per-brand diff was required.
>
> **✅ CLOSED 2026-08-11 (0 — no human commits; the 08-10 burst was a single evening, not a resumption).** 🔬 **NEW WORK OPENED: B-125** — the residual `timeout-minutes` kills are now proven from run timings, `faa-weekly` has a calibrated one-line fix, and `fra-weekly` + `gdelt-weekly` turn out to have **never succeeded once**, which corrects four days of notes claiming all three "have green history." ✅ **Nothing else moved:** B-121 and B-122 both sat unchanged and both are blocked on Aron, not on evidence; B-124 did not recur (08-09 remains the only missing night in the `data(news)` series); #155 unwound 38 → 37 rows as predicted. ⚠️ **Housekeeping, now 8 days old and still untouched:** uncommitted `public/sitemap.xml`, plus `docs/AI-OPERATOR-REFERENCE.{md,docx}`, `docs/trunorth-project-brief.md` and the two `docs/research/` reports. **Clear the sitemap before the B-115 rebase.**
>
> **✅ CLOSED 2026-08-10 (0 — day 8 with no human commits).** 🔴 **NEW WORK OPENED: B-124** (the push-retry-loop bug — 117 workflows that can discard a full run and report success). **B-121, B-122 and B-115 all escalated rather than resolved: B-121 missed its second send, B-122's decision date arrived with the "wait" option exhausted, and B-115's rebase gained a grade-moving commit to resolve against.** ⚠️ **Cron-health caveat that now applies to every future reading of #155: the list is structurally blind to B-124, so "37 rows" is a floor, not a count.** ⚠️ **Housekeeping, now 7 days old and unchanged:** the working tree still has an **uncommitted `public/sitemap.xml`** (~36,576 insertions / 35,820 deletions — a `lastmod` bump, pure regenerated-artifact churn, no URL changes). Untouched by this sync. **Clear it before the B-115 rebase so it doesn't ride along or collide.** Also still uncommitted and untouched: `docs/AI-OPERATOR-REFERENCE.{md,docx}`, `docs/trunorth-project-brief.md`, and the two `docs/research/` reports.
>
> **[08-07] ✅ CLOSED (0 — FIFTH consecutive day with no human commits).** **NO new backlog items opened.** Today's two findings both sharpen existing items rather than open new ones: the `ofac-sdn-daily` row is a **B-103** recurrence that self-healed within the same day (do not reopen), and the `tosdr` / `au-fair-work` 0%-lifetime finding refines the **B-107** `timeout-minutes` sub-class. ✅ **B-123 SCOPE RE-VERIFIED TODAY and it is exactly 4 workflows — not more.** Swept every workflow referencing `_cache`: 9 files mention it, but only 5 `git add` it, and **`health-signals-monthly.yml:48` and `privacy-policy-quarterly.yml:50` both already append `|| true`**, so they are immune (their failures are timeouts, a different bug — do not "fix" them under B-123). Also confirmed `public/data/_raw/` and `public/data/_meta/` are **not** ignored, so `bcorp-quarterly` and `epa-emissions-annual` are clean. **The 4 victims stand: `sec-8k-events-monthly.yml:52`, `sec-def14a-annual.yml:53`, `usaspending-quarterly.yml:45`, `ca100-annual.yml:59` — and there are now two in-repo templates for the one-line fix.** ⚠️ **Housekeeping, now 4 days old and unchanged:** the working tree still has an **uncommitted `public/sitemap.xml`** (~36,576 insertions / 35,820 deletions — a `lastmod` bump, pure regenerated-artifact churn, no URL changes). Untouched by this sync. **Clear it before the B-115 rebase so it doesn't ride along or collide.**
>
> **[08-06] ✅ CLOSED (0 — FOURTH consecutive day with no human commits).** **NO new backlog items opened today** — today's two findings both fold into existing items: the `ofac-sdn-daily` failure is a B-103 recurrence (closed, zero-code-change, do not reopen), and `tosdr-monthly`'s second consecutive cancellation joins the **B-107** `timeout-minutes` triage alongside `au-fair-work-monthly`. ⚠️ **Housekeeping note, now 3 days old and unchanged:** the working tree still has an **uncommitted `public/sitemap.xml`** (~36,576 insertions / 35,820 deletions — it is a `lastmod` date bump from 2026-06-12 to 2026-08-01 across the whole file, i.e. pure regenerated-artifact churn, no URL changes). Untouched by this sync. **Clear it before the B-115 rebase so it doesn't ride along or collide.**
>
> **[08-05] ✅ CLOSED (0 — third consecutive day with no human commits).** **NEW work opened: B-123 (the `_cache` `git add` bug — 4 crons discarding fetched data since 2026-06-11).** ⚠️ **Housekeeping note, now 2 days old and unchanged:** the working tree still has an **uncommitted `public/sitemap.xml`** (regenerated-artifact churn), untouched by this sync. Clear it before the B-115 rebase so it doesn't ride along or collide.
>
> **✅ CLOSED 2026-08-04 (0 — second consecutive day with no human commits).** **NO new work opened today.** ⚠️ **Housekeeping note:** the working tree has an **uncommitted `public/sitemap.xml` with ~36,576 insertions / 35,820 deletions** — regenerated-artifact churn, untouched by this sync. Worth a look before your B-115 rebase so it doesn't ride along or collide.
>
> **✅ CLOSED 2026-08-02 (0 new items — the day's 3 commits refined and documented work already open):** `3bdae9815` re-cut B-115, `9c955183e` documented it, `5ae00931e` logged the G-10 GEO audit. **NEW work opened: B-121 (outbound email).**
>
> **✅ CLOSED 2026-08-01 (7):** **B-104** commit `audit-ungraded.mjs` as the coverage instrument (`d39dcc8e2`) · **B-105** watchdog rewrite (`e7c90c7fd`) · **B-108** retire the duplicate Canada Competition Bureau pipeline (`fc0b4aa0d`, −636 lines) · **B-113** `very_poor` enum normalization (`539b0947c`) · **B-115** Pay & Tax — penalize-only final (`3bdae9815`, **unpushed**) · **B-120** cron destagger (`9f4bf87b2`) · **QW-17/QW-18** funnel schema hygiene + `grade` on `scanner_match` (`31c1d3e43`). Plus **`c0a7450f2`** — one canonical brand count (**"3,000+ graded / 12,800+ tracked"**) across App.jsx, MarketingLanding, OnboardingFlow, `index.html`, `llms.txt` and both SEO APIs. **"2,800+" is retired copy; do not reintroduce it.**
>
> **⚠️ B-115 — FINAL model (`3bdae9815`, supersedes the rejected first pass `a8ba45a7c`).** `execPay` is now **"Pay & Tax"**, reworked to **strict penalize-only & provably MONOTONIC-DOWN (option 2)** after the first pass's full drift showed 248 moves / 93 brands graded B off a lone pay ratio / giants lifted to A by tax dilution. Final `payTaxScore()`: **ITEP federal tax avoidance is the ONLY new force** — a compliant rate (≥~15% median) scores neutral 50 and contributes nothing (only `<50` penalizes); losses → `null`; `zeroTaxYears≥2 → 8` **only when the avg is also sub-median** (fixes Trimble). **The enriched SEC pay ratio was CUT** — it disagrees with the legacy ratio (Alaska 75:1 vs 117:1) and would grade ~90 brands to B off a lone number. Pay is scored EXACTLY as pre-B-115; penalties average in **min-capped at baseline**, and new signals fire only on clear avoidance (`<SEVERE_NEG`) — so a grade **can only fall, never rise. Verified from `index.json`: graded 3,059 → 3,065 (+6 new-D), 0 up / 38 down / 6 new — 100% tax avoiders** (Duke, Dominion, Southern, AEP, FirstEnergy, Kinder Morgan, Eversource, Exelon, NRG, CMS, DTE, Atmos, Xcel, Williams, ONEOK + AECOM/Ally/Cadence); A untouched; 28/28 tests. **Scoped as "up to 927" — real answer = 44 moves. "up to N" runs ~20× hot; discount B-116 (393) and B-119 HARD until a dry rebake.**
>
> **🔧 CRON HEALTH — both silent-death defects are now fixed in code; what's left is verification + 15 individual fetcher breaks.** **B-105** made `cron-health-daily` cadence-agnostic: it now takes the **latest scheduled run of every workflow**, flags `failure`/`cancelled`/`timed_out`/`startup_failure`, rewrites one rolling issue's body, and **never auto-closes on a quiet window**. Its first run opened **issue #155 listing 35 unhealthy crons (20 cancelled + 15 hard failures)** on a day the old watchdog read green. ⚠️ **This retires the old "an empty issue list means nothing" rule — #155's BODY is now the live health list. Read the body, not the count.** **B-120** found the cancellation root cause: **all ~126 data workflows shared one `concurrency: data-pipeline-commit` group** while **~90 were scheduled in the 04:00–07:00 UTC window**, so they cancelled each other as superseded (`trending-refresh` ran **62s against a 30-min cap** and still came back `cancelled` — proof it was never a timeout). Fixed by destaggering + isolating long-runners. Also ignore #155's `canada-comp-monthly` row — B-108 deleted that workflow 10 minutes after the issue was written, **and the row is STILL there in the 2026-08-02T14:42Z rewrite** (the watchdog reports the last known scheduled run, so a deleted workflow's row never ages out — cosmetic, not a break).
>
> **✅/⚠️ B-120 VERIFIED 2026-08-02 — the first full post-destagger cycle is in, and it is a PARTIAL fix, not a complete one.** The destagger landed 2026-08-01T16:17Z; every scheduled run after that is a real test. **What worked:** the bunched-window cancellations are gone, and two of the exact workflows B-120 diagnosed went **cancelled → success on the same day** — `osv-monthly` (cancelled 11:00Z, success 19:38Z) and `trending-refresh` (cancelled 08:39Z, success 23:02Z). **2026-08-02 as a whole ran 30 scheduled jobs: 24 success · 4 failure · 2 cancelled — ~80% healthy, against a 27%-broken baseline nine days ago.** The rolling watchdog issue moved 35 → **34**. **What did NOT work: 3 cancellations still occurred post-destagger, and they are NOT bunched** — `openstates-monthly` (08-01 18:58Z), `gao-monthly` (08-02 12:40Z), `oversight-ig-monthly` (08-02 19:44Z), hours apart from each other and from anything else. **Shared-concurrency contention cannot explain those; a second cause exists** (most likely genuine `timeout-minutes` kills, which is what the watchdog's "⏱ likely a timeout" hint guessed all along). Fold these 3 into B-107 triage as their own sub-class. ⚠️ **Still genuinely unverifiable: the 3 commit+push failures B-120 was expected to self-resolve (`sec-8k`, `sec-def14a`, `usaspending`) have not run since the destagger** — their cadences are monthly / annual / quarterly, so their last runs are 07-05, 07-10 and 07-01. **`sec-8k-events-monthly` is the first to come due (~Aug 5); that run is the test. Do not mark them fixed before it.**
>
> ✅ **WEEKLY REBAKE — 3rd consecutive clean Sunday.** `score-rebake-weekly` ran 2026-08-02T17:27Z, success, and **committed `0513aad9e` with ZERO grade moves** — verified by per-brand diff of `origin/main`'s `index.json` against `c0a7450f2`, not by reading the commit message. The 2026-07-20 silent-death fix has now held for three straight Sundays (07-19 · 07-26 · 08-02). **`index.json` remains the ONLY authority on shipped grades.**
>
> **✅ B-103 (OFAC 403) SELF-RESOLVED with zero code changes** — `ofac-sdn-daily` ran green at 06:06Z (`a2811ca29`, full 14,955-line snapshot), exactly as the 07-31 off-runner probe predicted. **Rule earned: a CI-only 403 on a source that answers off-runner is a wait-one-cycle event, not a fix-the-URL event** — the opposite of FMCSA (B-69), where the endpoint really did move. Waiting was the correct and cheapest response.
>
> — **EARLIER 2026-07-31 (daily doc-sync):** **no human commits (none since 07-21, now 10 days), and only 2 bot crons — but the day produced the first genuinely NEW break in a week (B-103) and, more usefully, the first evidence in three days that the cron watchdog actually works.** The day = **2 `trunorth-bot` `[skip ci]` crons** (news nightly `def2c9116`, 11 companies — display-only · PostHog trending `b4349f50b`). Local clone was **2 commits behind `origin/main`** at sync start; rebased cleanly, nothing lost. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82.** Android still scaffold-only. **CATALOG UNCHANGED — counted from `index.json`: 12,830 tracked / 3,054 graded** (A 64 · B 1,185 · C 1,050 · D 521 · F 234), 9,776 "?" — **0 grade moves, and `index.json` was not touched at all today**; field-level diff of all 11 changed company files shows only `dataLastUpdated` / `news` / `news_items` / `recent_events` moved — **no `overall`, no `grade`.** **Scoring model R7.1 unchanged.** 🚨 **NEW → B-103: `ofac-sdn-daily` failed for the first time** (run `30609308711`, 06:19Z) — `OFAC SDN 403 Forbidden` at `scripts/ofac-sdn-fetch.mjs:110`, after 100% green daily runs through 07-30. ⚠️ **But the source is NOT dead, and this is worth knowing before anyone "fixes" it:** probed from Aron's Mac during this sync, the exact URL the fetcher uses (`www.treasury.gov/ofac/downloads/sdn.csv`) returns **302 → presigned AWS GovCloud S3 → HTTP 200, 5,626,755 bytes** of real CSV. So this is **not** an FMCSA-style endpoint migration (B-69) — the 403 is aimed at the **GitHub runner specifically**, which reads as IP-based rejection or a failed presign handoff on the runner's egress. ✅ **The pipeline behaved correctly and shipped nothing bad:** the fetcher hard-fails *before* writing, so `data/raw/ofac-sdn/2026-07-31.json` was never created, the 51 prior snapshots are intact, and the augment was untouched — **the opposite of B-102, where the file attested to being live while holding 0.1% of the data.** **Recommended action is to wait one run:** tomorrow's 06:19Z result decides whether this is a transient token hiccup (do nothing) or durable blocking (browser-like UA first — same first move B-99 needs). ✅ **SCOPE CORRECTION TO B-100 — the watchdog is NOT globally broken.** After three straight days of zero open issues, `cron-health-daily` ran 15:28Z today and **opened issue #154, still OPEN**, naming exactly the one real failure (`ofac-sdn-daily`). **When a *daily* cron fails with a true `status=failure`, detection works end-to-end.** Both defects still stand and are untouched by this: blind to `cancelled` timeouts (**B-97** — FAA/FRA/GDELT still dying unseen), and the 24h lookback still erases **weekly** failures (**B-99**'s FSIS crons failed 07-27 and are correctly absent from #154 for exactly that reason). **The revised rule: an OPEN watchdog issue now means something real and should be acted on; an EMPTY issue list still means nothing.** ⚠️ **Watch tomorrow ~15:30Z** — if `ofac-sdn-daily` 403s again *and* #154 auto-closes anyway, that is a new and worse variant of B-100. **B-97 / B-98 / B-99 / B-100 / B-101 / B-102 / B-103 all open and unworked**; B-101 unchanged at **29 open bot PRs**. No weekly cron fired today (they run Sun/Mon) → **next evidence point on FSIS/FAA/FRA/GDELT is 2026-08-02/03**; `gdelt.json` + `fra-incidents.json` still absent from disk. ✅ **B-70 rebake fix still holds** (none due today; last clean run 2026-07-26). — **EARLIER 2026-07-30 (daily doc-sync):** **no human commits (still none since 07-21), but not a quiet day — a quarterly cron fired for the first time since June and auditing its output found a new bug: B-102.** The day = **4 `trunorth-bot` `[skip ci]` crons** (OFAC-SDN daily `a00bafc6c` · news nightly `7709e3e53`, 12 companies — display-only · PostHog trending `7dcd0740e` · **`lobbying-quarterly` `db079e17a`**, its scheduled Jul-30 firing). Local clone was **4 commits behind `origin/main`** at sync start; rebased cleanly, nothing lost. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82.** Android still scaffold-only. **CATALOG UNCHANGED — counted from `index.json`: 12,830 tracked / 3,054 graded** (A 64 · B 1,185 · C 1,050 · D 521 · F 234), 9,776 "?" — **0 grade moves, verified per-slug** (0 changed, 0 added, 0 removed). **Scoring model R7.1 unchanged.** 📉 **NEW → B-102: the LD-2 lobbying fetcher stored 25 of 25,968 filings for 2026Q2 (~0.1%) and reported success.** Its pagination breaks on a short page, but the Senate LDA API caps pages at 25 while requesting 250 — so it quit after page 1 of every quarter (`cumulative=25, 50, 75 … 200`; the whole "live" 8-quarter fetch took **10 seconds**). The file still says `"mode":"LIVE"` because the workflow really does pass `--live`. One-line fix; details + re-run steps in B-102. ⚠️ **The 43 brands enriched today carry LD-2 dollar figures from that 0.1% sample — don't quote them or build UI on them yet.** ✅ **FARA from the same cron is healthy** (543 → **556** active registrations). ✅ **No data lost in the merge** despite the commit reading `-8,673` lines — leaf-path diff across all 53 changed company files is **612 gained / 0 lost**; the delta is re-minification. ⚠️ The new lobbying data is **dark** — `App.jsx` has no reader for `enriched.political.lobbying`. 🔴 **B-100 confirmed a THIRD day:** `cron-health-daily` ran 15:22Z, concluded `success`, opened nothing → **still ZERO open issues** while five pipelines stay dead. Those are weekly (last fired 07-27) → **next evidence point 2026-08-02/03**; `gdelt.json` + `fra-incidents.json` still absent from disk. **B-97 / B-98 / B-99 / B-100 / B-101 / B-102 all open and unworked**; B-101 unchanged at **29 open bot PRs** (oldest #116 2026-06-29, newest #152 2026-07-27). ✅ **B-70 rebake fix still holds** (none due today; last clean run 2026-07-26). `ci` still `action_required` on PR #152. — **EARLIER 2026-07-29 (daily doc-sync):** **quiet day: no human commits, no new findings, nothing to fix that wasn't already logged.** The whole day = **3 routine `trunorth-bot` `[skip ci]` data crons** (OFAC-SDN daily `8b8f38f57` · news nightly `76ba0aa81`, 10 companies — display-only · PostHog trending `3c8f7b073`). Local clone was 3 commits behind `origin/main` at sync start; fast-forwarded, nothing lost. Aron's work today was on the **Executive AI Assistant / Atlas** repo, not TruNorth. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82.** Android still scaffold-only. **CATALOG UNCHANGED — counted from `index.json`: 12,830 tracked / 3,054 graded** (A 64 · B 1,185 · C 1,050 · D 521 · F 234), 9,776 "?" — **0 grade moves, verified per-slug against yesterday's `index.json`** (0 changed, 0 added, 0 removed — not just an unchanged total). **Scoring model R7.1 unchanged.** 🔴 **B-100 CONFIRMED A SECOND DAY, and it now looks like resolution.** `cron-health-daily` ran today at 15:18Z and **concluded `success`** — it did **not** reopen #153 and did **not** open a new alert, so **the repo now has ZERO open issues** while `fsis-weekly` + `fsis-dw-weekly` are still 403ing and `faa-weekly` / `fra-weekly` / `gdelt-weekly` are still being killed at their `timeout-minutes` caps. **An empty issue list is now the STEADY STATE of a repo with five dead pipelines** — that is exactly the failure mode B-100 describes, observed twice. **B-97 / B-98 / B-99 / B-100 / B-101 all remain open and unworked.** No weekly cron fired today (they run Sun/Mon), so the next evidence point on FSIS/FAA/FRA/GDELT is **2026-08-02/03**; last failures stand at 07-27. `public/data/gdelt.json` + `public/data/fra-incidents.json` **still do not exist on disk** (only `scripts/gdelt-fetch.mjs`, `scripts/gdelt-merge.mjs`, and the workflow do). **B-101 unchanged at 29 open bot PRs** — oldest still #116 (2026-06-29), newest #152 (2026-07-27); nothing drained, nothing added. ✅ **B-70 rebake fix still holds** (no rebake due today; last clean run 2026-07-26). ⚠️ `ci` still `action_required` on PR #152; Node-20 deprecation warnings continue on all workflows. — **EARLIER 2026-07-28 (daily doc-sync) — **no human commits; the day was 6 routine `trunorth-bot` `[skip ci]` data crons** (OCC weekly `1bbb30f63` · FDIC weekly `78d59201a` · FINRA BrokerCheck weekly `fd26f3af3` · NRC weekly `cbf500d53` · OFAC-SDN daily `d7cf7aaad` · news nightly `8732d5a96`, 13 companies — display-only). Local clone was 5 commits behind `origin/main` at sync start; fast-forwarded, nothing lost. 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82.** Android still scaffold-only. **CATALOG UNCHANGED — counted from `index.json`: 12,830 tracked / 3,054 graded** (A 64 · B 1,185 · C 1,050 · D 521 · F 234), 9,776 "?" — **0 grade moves.** **Scoring model R7.1 unchanged.** 🚨 **TWO NEW FINDINGS, both about work that only LOOKS done (→ B-100 / B-101).** (1) **B-100 — the cron watchdog erases its own alerts.** Yesterday's sync said FSIS was "correctly reported, watchdog issue #153 is open." It isn't anymore: `cron-health-daily` closed #153 today at 15:33Z with *"✅ No failed runs in the last 24h"* **while FSIS is still 403ing**. Cause: the watchdog looks back exactly **24 hours**, but the crons it watches are **weekly** — so a Monday failure is out of scope by Tuesday and the `COUNT == 0` branch auto-closes the issue. **11 watchdog issues have been opened and auto-closed this way since 2026-06-12** (#107 → #153), each living 1–3 days, **not one underlying break ever fixed**. This is the actual reason B-99 went 5 weeks unnoticed — it *did* alert, repeatedly, and deleted the evidence each time. Fix it in the same file as **B-97**: widen the lookback past the slowest cadence and only close on a *subsequent success*. (2) **B-101 — 29 bot data-refresh PRs are open and unmerged**, oldest **2026-06-29**, covering **25 distinct sources** — so those sources' refreshes never reach production even though their crons report success. ⚠️ This **contradicts NB-8's "all open PRs triaged to ZERO" (2026-06-27)** — the queue rebuilt in two days. **Do not bulk-merge:** PR **#134 `data/opensanctions-monthly`** would re-add `opensanctions-augment.json` (+19,879 lines) — **the exact CC-BY-NC file class B-63 deliberately stripped** once the paid tier shipped. **B-97 / B-98 / B-99 all remain open and unworked** (FSIS 403'd again 07-27; FAA/FRA/GDELT all `cancelled` at their caps again 07-27; `gdelt.json` + `fra-incidents.json` still do not exist on disk). Net: **three separate ways a cron can be dead while reading green** — timed-out (`cancelled`, B-97), alerted-then-erased (B-100), and succeeded-into-an-unmerged-PR (B-101). ✅ Unchanged good news: the **B-70 rebake fix still holds** (no rebake was due today; last clean run 2026-07-26). ⚠️ `ci` still sits at **`action_required`** on the la-county PR #152, and every workflow still emits the Node 20 deprecation warning — neither breaking anything today. — **EARLIER 2026-07-27 (daily doc-sync) — **quiet week on the product, ONE bad discovery on the data plumbing. No human commits since 07-21** (the local clone was 18 commits behind `origin/main` at sync start — all 18 are `trunorth-bot` `[skip ci]` cron output; fast-forwarded, nothing lost). 🟢 **v1.1 Build 81 stays the LIVE App Store build; next iOS ship = Build 82.** Android still scaffold-only (no Play listing, no build). **CATALOG UNCHANGED — counted from `index.json`: 12,830 tracked / 3,054 graded** (A 64 · B 1,185 · C 1,050 · D 521 · F 234), 9,776 "?" — **0 grade moves** across the whole 18-commit window. **Scoring model R7.1 unchanged.** ✅ **The B-70 rebake fix HELD:** `score-rebake-weekly` fired on schedule again 2026-07-26 (`3b257a28f`, `grade-snapshot.json takenAt 2026-07-26T17:29Z`, `meta.finalizeStamp` matching) — its **second clean Sunday in a row**, and this time it correctly moved nothing because nothing had drifted. 🚨 **NEW — FIVE WEEKLY PIPELINES ARE DEAD AND THE WATCHDOG ONLY SEES TWO OF THEM (→ B-97 / B-98 / B-99).** (1) **`fsis-weekly` + `fsis-dw-weekly` fail on HTTP 403** from the USDA FSIS endpoint — **5 consecutive weeks** (06-29 → 07-27), 3 retries each run, same class of break as the FMCSA dead-endpoint problem (B-69). These *are* visible: watchdog issue **#153** is open and correctly lists them. (2) **`faa-weekly`, `fra-weekly`, `gdelt-weekly` hit their `timeout-minutes` cap on EVERY scheduled run since June** — verified on FRA 07-27: job started **11:59, killed 12:29 = exactly its 30-minute cap**. **GitHub reports a timed-out job as `cancelled`, and `cron-health-daily.yml` queries only `status=failure`** — so these three have never once announced their own death. The 2026-06-09 cron audit (B-49) wrote them off as "6 cancelled (normal)"; **that assumption was wrong.** (3) **Two of the three have never produced output at all:** `public/data/gdelt.json` and `public/data/fra-incidents.json` **do not exist on disk** — `gdelt-weekly` is 9-for-9 cancelled with **zero data commits ever**, `fra-weekly` 8-for-8 with only its 2026-06-03 human integration commit. FAA is the partial exception (`public/data/faa-safety.json` last refreshed 2026-07-20, when the run committed at 10:54 just before the cap killed it). Net: **~9 weeks of runner time burned for two files that were never written**, and the "168 workflows" cadence table below overstates live coverage by at least these five. Otherwise the window = routine `[skip ci]` crons (OFAC-SDN daily · news nightly · BIS · CISA-KEV · SEC-litigation · EPA-ECHO · DOJ · CPSC · CFPB · CourtListener · NHTSA · MSHA · PHMSA · NTSB · FCC · cruelty-free · enriched-augments). ⚠️ Also noted: `ci` is sitting at **`action_required`** (waiting for maintainer approval), and every workflow now emits the **Node 20 deprecation warning** (forced onto Node 24) — neither is breaking anything today. — **EARLIER 2026-07-21 (daily doc-sync) — the v1.2 punch-list went into execution — 22 human commits since the last sync, ALL on `main`, ALL non-`[skip ci]` → web-deployed via Vercel. No iOS build (Build 81 still the LIVE App Store build, next ship = 82). Android still scaffold-only (no Play listing/build).** These are Batches **B (07-20 evening, 19:56–21:47 CST — the 07-20 AM doc-sync ran mid-morning and MISSED this whole batch)** + **C (07-21 morning, 07:07–09:56 CST).** **Punch-list items shipped ✅:** **B-74** Android hardware-Back stack (LIFO `back-stack.js` + `useBackDismiss`; Back never quits on first press) · **B-76** search now ranks by relevance not alphabetically (the "?" wall was ~60% a sort bug) + a persisted "Graded only" browse chip (on by default) · **B-77** scanner `resolveBrand` reordered exact→parent-map→prefix (curated map beats the prefix guess; roll up to parent only when the sub-brand is ungraded) · **B-80** the "?" dead-end screen rebuilt (receipt-of-absence, no more "no sources report" while showing the brand's own records) · **B-81** notify-me delivery loop CLOSED (see below) · **B-82** first CI workflow that runs on a code change (`ci.yml` on `pull_request`: `npm ci` → 3 real test files → `vite build` oxc gate) · **B-85** paywall cooldown economics (only write `tn_paywallDismissedAt` on the hard gate, 7d→24h, never suspend the quota) · **B-91** ONE grade palette in `src/lib/theme.js` — killed opacity-as-meaning for the baseline/ungraded state, fixed Shein's "C" rendering in D's amber on the public landing, + a11y sweep of 8 style pairs below WCAG AA · **B-95** deduped the `-de` shell entries (3 brands shipped contradictory grades — `abercrombie-and-fitch-de` etc.) via `dedup-brands.mjs` · **B-96** unstaled the 3 `scoringFlags.test.mjs` snapshots + gated them in CI. **Android unblock (B-75, ⚠️ still MOSTLY DONE):** `VITE_REVENUECAT_ANDROID_KEY` selected by platform + camera + App Links `<intent-filter>` + `custom_url_scheme` + published `.well-known/assetlinks.json` + release signing config + `.env.example` + Play payments/App-Links sequence doc — **but still no Play listing, no Android build.** **B-81 detail:** `scripts/notify-newly-graded.mjs` now consumes the `type:"new_brand"` signal from the B-70-repaired `weekly_changes.json`, matches each subscriber's `brands_requested`, and sends **one MailerLite campaign per newly-graded brand** to a throwaway per-brand group — ⚠️ **DRY-RUN BY DEFAULT; sending requires `--apply`** (irreversible/outward-facing). Plus `--audit` mode + a census/legacy-`brand`-field recovery pass over the waiting list (`notify-audit.yml` is audit-only, does NOT auto-send). **📧 EMAIL SAFETY FIX (not a B-number):** `send-weekly-digest.mjs` was hardcoded to send `from: "Aron@trunorth.com"` — the UNauthenticated domain, NOT the DKIM/SPF/MX-verified `trunorthapp.com` — so the Sunday digest **could never have delivered even once its data was fixed** (it hid for months because B-70 left it with nothing to send). Both senders now read `TRUNORTH_FROM_EMAIL` (default `aron@trunorthapp.com`); new ui-guard asserts every literal `from:` across `scripts/`+`api/` is on `trunorthapp.com`. `api/submit.js`'s actual Resend sender was already correct (`submit@trunorthapp.com`); only its docs were wrong. **CATALOG — re-counted from `index.json`: 12,830 tracked / 3,054 graded** (was 12,833 / 3,057), dist **A 64 · B 1,185 · C 1,050 · D 521 · F 234** (only B moved, 1,188→1,185) — that's exactly the **B-95 dedup removing 3 duplicate `-de` shell entries**; 9,776 "?" unchanged. **Scoring model R7.1 unchanged** (no threshold or formula edits; B-95 was an entry-dedup, not a rebake). Rest of the window = routine automated `[skip ci]` data crons (OCC · FDIC · FINRA · NRC weekly + OFAC-SDN daily + news nightly). **EARLIER 2026-07-20 (daily doc-sync) — **the biggest work day since 07-04. 4 human commits, all on `main`; no iOS build shipped (Build 81 still live, next ship = 82).** **`e42f1f29b` v1.2 review Batch A** (NOT `[skip ci]` → **web-deployed via Vercel**) — 4 critical defects + the whole 27-agent / 155-finding punch list minted as **B-70…B-93 + QW-01…QW-16** (see the section below) · **`fd1e67250` Android scaffold committed + tracked** (QW-14 ✅ — 54 files, `applicationId com.trunorthapp.app`, minSdk 24 / SDK 36, `*.jks`/`*.keystore` pre-ignored; **no Play listing, no Android build, key + App Links + Back-stack still unconfigured — B-74/B-75/B-93**) · **`6102eba31` B-94** — regenerated the false weekly-changes feed + added the 2% snapshot-drift guard · **`fd84d7e81`** — hand-restore of cron output clobbered by a prior doc-sync commit. **⚡ The B-70 cron fix WORKED and self-healed the same day:** `trunorth-bot` ran the weekly rebake at 16:12 UTC (`236fe1c57`) and **moved `index.json` for the first time in 5 weeks**. **CATALOG COUNT UNCHANGED BUT THE CURVE MOVED — re-counted from `index.json`: 12,833 tracked / 3,057 graded, dist now A 64 · B 1,188 · C 1,050 · D 521 · F 234** (was A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?" unchanged. That's the **33 real changes: 19 drops, 14 rises** (Tesla Energy D→B, Buick/GMC/Hummer F→C) — 5 weeks of accumulated source movement landing at once. **Scoring model R7.1 unchanged** (no threshold or formula edits). Rest of the day = 10 routine automated `[skip ci]` data crons (EPA-ECHO · SEC-litigation · CISA-KEV · BIS-entity-list · news nightly · PHMSA · MSHA · FAA · NTSB + the rebake). ⚠️ **PROCESS BUG FOUND IN THIS TASK ITSELF:** the 07-20 07:38 doc-sync commit `b0e2adba0` staged far more than `BACKLOG.md` and **deleted 34,212 lines of that morning's cron output** (the `data/raw/bis-entity-list/2026-07-20.json` snapshot + 5 merge logs + company files); Aron had to revert it by hand in `fd84d7e81`. The daily doc-sync now stages **`BACKLOG.md` and nothing else** — no `git add -A`, no `git add .`, no `git commit -a`. — **EARLIER 2026-07-19 (daily doc-sync) — **no human commits that day (07-19 CST); this commit also persists the prior 07-18 sync, which was written but never committed.** The day = **9 routine automated `[skip ci]` data-cron commits** (OFAC-SDN daily · cruelty-free weekly · news nightly RSS digest · CourtListener lawsuits weekly · CFPB weekly · CPSC recalls weekly · DOJ weekly · EPA-ECHO weekly · SEC-litigation weekly) — all display-only, **none touched `public/data/index.json`.** Re-verified by counting the index: catalog **UNCHANGED — 12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?"**; scoring **R7.1**; last human commit still 07-12's PR #144. The only pending human work remains the uncommitted v1.2 plan doc (`docs/research/v1.2-big-update-plan-2026-07-18.md`) — see "NEEDS YOUR DECISION" below. — **EARLIER 2026-07-18 (daily doc-sync) — **🟢 v1.1 Build 81 is LIVE on the App Store (released 2026-07-14).** ⚠️ **STALE-STATUS CORRECTION:** this file said "Build 81 Waiting for Review" from 07-07 through 07-12 — Apple **approved it 07-08** and Aron **released it (Manual) on 07-14**. v1.1 now supersedes v1.0 Build 75 as the live build; **next iOS ship = Build 82**. (Re-verified in `project.pbxproj`: `MARKETING_VERSION 1.1` / `CURRENT_PROJECT_VERSION 81`.) The doc-sync did not run 07-13 → 07-17, which is why the launch sat unrecorded here for 4 days. **No human commits 07-13 → 07-18** — last human commit remains 07-12's PR #144. The 6-day gap = **21 automated `[skip ci]` data-cron commits** (OFAC-SDN daily · news nightly · PostHog trending nightly · weekly FDIC/FINRA/NRC/OCC · monthly climate-trace · quarterly oecd-watch + one-percent-planet). Today = OFAC-SDN (`b71d6f5dc`) + news digest (`7a91e1b84`). **Catalog UNCHANGED — counted from `index.json`: 12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?"**; scoring **R7.1**. 📋 **Today's only human work is a PLANNING DOC, uncommitted: `docs/research/v1.2-big-update-plan-2026-07-18.md`** — the v1.2 "Reach & Coverage" master plan (Aron's ask: +50 sources, +5,000 companies, Android, big upgrade). Key reframe: measure **graded** coverage (3,057 → 7,000–8,000), not tracked, because the real problem is the **9,776 "?" wall (76%)**. Five workstreams: A Coverage Engine (GLEIF/entity-resolution first, then license-clean gov primaries, then B-23 dark-data wiring) · B Android · C marquee "Ask TruNorth" · D push + widget retention · E claims/QA honesty. **Nothing built; no new BACKLOG IDs minted on purpose — the doc ends with 8 decisions awaiting Aron** (see "NEEDS YOUR DECISION" below). — **EARLIER 2026-07-12 (daily doc-sync):** *[status line superseded above]* **that day's ONE human commit: PR #144 (`c1e6a7324`, merged 11:31 CDT) — FMCSA SMS fetcher hardening** (first human commit since 07-07's widget-drop). Scope is the monthly `fmcsa-sms` cron infra ONLY (`scripts/fmcsa-sms-fetch.mjs` + `.github/workflows/fmcsa-sms-monthly.yml` + test) — **no scoring, no web deploy, no iOS, no grade/count drift.** The dead `ai.fmcsa.dot.gov/SMS/files/*.zip` endpoints 302 → an HTML error page that `unzip` choked on ("End-of-central-directory signature not found"); `downloadTo()` now validates content-type / sub-10KB size / ZIP magic bytes before unzip and throws a legible `SourceUnavailableError`, URLs are env-overridable (`FMCSA_PASS_PROPERTY_URL` / `FMCSA_CENSUS_URL` → republished location = secret change not code change), and new `--keep-last-on-fail` keeps the last-known-good snapshot + exits 0 with a `::warning::` instead of red-failing monthly. **Real-data restore still needs a Socrata rewrite → newly tracked as B-69** (DOT Open Data Portal serves CSV not ZIP + `*_measure`/`*_ac` not `*_percentile` → grade-semantics change, Aron's call). Rest of the day = routine automated data crons only (`[skip ci]`): OFAC-SDN daily (`edd1ae39f`) · cruelty-free weekly LB+PETA merge (`83c7f15dd`) · news nightly RSS digest (`aa12bf0e5`, 19 companies — display-only) · PostHog trending (`6274871dd`). Catalog UNCHANGED — re-verified from `index.json`: **12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235)**; scoring **R7.1**. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-10 (daily doc-sync) — **🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 "Waiting for Review" at Apple (widget-less; Manual release).** **No human commits since 2026-07-07's widget-drop; 07-08 → 07-10 = automated data crons only** (`[skip ci]`). 07-10: OFAC-SDN daily (`7e90346b7`) · news nightly (`b39d6fac3`, 19 companies — display-only) · PostHog trending (`816d96eaf`). 07-09: CBP UFLPA + WRO forced-labor refresh (`47d9719e5`) · news · OFAC · trending. ⚠️ **CORRECTION — the graded catalog is now `12,833 tracked / 3,057 graded` (A 71 · B 1,180 · C 1,037 · D 534 · F 235), NOT the `2,839` the 07-04→07-08 headers claimed.** The +218 jump was **not** a human rebake: the **07-07 `bad32a65a` commit — labelled "data(sam): exclusions refresh" but which actually attached `csc.execPay` (SEC executive-pay governance) signals to ~216 previously-ungraded public companies** — surfaced each at score 50 → grade **B** (e.g. Abercrombie `?`→B); the 07-09 CBP forced-labor refresh added +1 D. **So a `[skip ci]` data-cron DID move grades** — the "no grade/count drift" note the 07-07/07-08 doc-syncs put on `bad32a65a` was wrong. These are thin single-signal B's at the **B≥50** floor (E-9 single-signal cap-at-B; **scoring model R7.1 itself unchanged, thresholds untouched**). All on `main` via `[skip ci]` → not web-deployed, not in Build 75 or the pending Build 81. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-08 (daily doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 "Waiting for Review" at Apple (widget-less; Manual release).** **Today = routine automated data crons only** (`[skip ci]`, no grade/count/build/code drift, no human commits): **OFAC-SDN daily** snapshot + augment refresh (`709d47f46`) · **news nightly** RSS digest + AI extraction + per-company merge (`dbf400a88`, 14 companies touched — display-only news, no grades moved) · **PostHog trending nightly** (`a0c7f50e1`). Catalog unchanged (~12,833 tracked / 2,839 graded) *[SUPERSEDED — the 07-07 SAM/execPay rebake had already lifted it to 3,057; see 07-10]*; scoring **R7.1**. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-07 (evening doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 SUBMITTED to App Review (widget-less).** ⚑ **DECISION 2026-07-07: the Home-Screen widget is DROPPED from Build 81; v1.1 ships WITHOUT it.** Commit `7703c1602` **decouples `TruNorthWidgetExtension` from the App target** (removed from the Embed Foundation Extensions phase + target dependency) so the Build 81 archive contains **no `.appex`** — the widget target and its Swift sources are **preserved for Build 82** (de-scope, not deletion; App Group entitlement, `trunorth://` scheme, `writeWidgetSnapshot()` left as harmless no-ops). The same commit **also lands the previously-uncommitted deployment-target fix 26.5 → 15.0** on both widget configs (moot for 81, kept correct for 82) → the earlier doc-sync's "UNCOMMITTED fix in the working tree" warning is now **RESOLVED** (working tree clean of pbxproj). Verified `xcodebuild -sdk iphonesimulator` → **BUILD SUCCEEDED with 0 widget compiled** → Build 81 is **single-target again, so `ship:ios` works** (no Organizer archive needed). Widget-less Build 81 → **Manual release** (Aron clicks "Release" after approval). See [[widget-deployment-target-gotcha]]. **Rest of the day = routine automated data crons only** (`[skip ci]`, no grade/count/build drift): OCC weekly · FDIC weekly · FINRA BrokerCheck weekly · NRC weekly · OFAC-SDN daily · news nightly · PostHog trending nightly · firearms-industry quarterly seed + FEC · SAM exclusions. Catalog unchanged (~12,833 tracked / 2,839 graded); scoring **R7.1**. — **EARLIER 2026-07-07 (morning doc-sync):** at that point the 26.5→15.0 widget fix was still UNCOMMITTED and Build 81 was framed as "awaiting Aron's Xcode Organizer archive" — both **SUPERSEDED** by the evening widget-drop above. — **EARLIER 2026-07-06 (daily doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 IN FLIGHT (Build 81 still awaiting Aron's Xcode Organizer archive; no iOS change that day).** Today's ONLY human commit: **SEO Soft-404 fix** (`c383cf3d4`, **NOT `[skip ci]` → web-deployed via Vercel**). `/company/<slug>` used to answer HTTP **200 with the generic SPA shell** for brands that don't exist, so Google Search Console flagged stale/renamed slugs (deduped Exxon subsidiaries, `estée-lauder→estee-lauder`, etc.) as **Soft 404** with no signal to drop them. Now `api/company-seo.js` returns a **hard 404** on a confirmed-missing data file (new `confirmedMissing` flag), but **still 200 on a transient fetch failure** so a real page is never deindexed over a blip; SPA still renders its not-found UX on the 404 body. Everything else was routine data crons (no grade/count drift): SEC-litigation weekly · CISA-KEV weekly · OFAC-SDN daily · BIS-Entity-List weekly · EPA-ECHO weekly · PHMSA weekly · MSHA weekly · news nightly · PostHog trending nightly. Catalog unchanged (~12,833 tracked / 2,839 graded); scoring **R7.1**. — **EARLIER 2026-07-05 (daily doc-sync) — **🟢 LIVE (v1.0 Build 75) + v1.1 IN FLIGHT. iOS binary on main is now `MARKETING_VERSION = 1.1`, `CURRENT_PROJECT_VERSION = 81`** (verified in `project.pbxproj` — BOTH the App and the new widget target). ✅ **NB-10 DONE — the widget Xcode target is now WIRED** (`68a518585`): Aron created the `TruNorthWidgetExtension` target in Xcode; App Group `group.com.trunorthapp.app` added to BOTH `App/App.entitlements` + the new `TruNorthWidgetExtension.entitlements`; the New-Target template had clobbered `TruNorthWidget.swift` with the emoji sample → the real "Your Basket" widget was restored, the bundle trimmed, the generated Control widget neutralized, the orphaned `TruNorthWidget.entitlements` removed. **Verified on iPhone 17 Pro sim: builds → signs → installs → renders** the empty state ("Scan a product for its grade"); populated/data state not yet confirmed. Then **bumped to Build 81** (`f30acd7be`, both targets `CURRENT_PROJECT_VERSION = 81`). ⚠️ Build 81 = the FIRST build carrying the widget → **archive via Xcode Organizer, NOT `ship:ios`** (the script isn't multi-target-aware yet: manual export map at `ship-ios.sh:203` lists only the app profile; the post-`cap sync` entitlements re-inject at `ship-ios.sh:124` isn't target-aware). Widget is NOT in the already-shipped Build 80 — it lands in Build 81 (repo-bumped, **awaiting Aron's Organizer archive**). Both commits `[skip ci]`, unpushed at doc-sync start. Today's data crons (routine, no grade/count drift): MAS-Singapore monthly · DOL-OFLC-LCA quarterly H-1B LCA · SEC-ecd quarterly execPay · TX-TCEQ monthly · eviction-lab monthly · news nightly · cruelty-free weekly · OFAC-SDN daily. — **EARLIER 2026-07-04 (daily doc-sync) — Builds 79 → 80 both shipped via `ship:ios` — `d11cc91ad` = 79, `5ab4cfd58` = 80, + SPM manifest `bc9cd9743`; **next ship = Build 81**). Build 80 = the **diligence mega-batch** (retention Tiers 1–3 + Build-79 device-bug fixes) + the **charity re-grade** (`8ce735f7e`) + the **Home/Lock-Screen widget scaffold** (`7f3886bce`). ⚠️ **Widget Xcode target NOT wired yet** (`docs/widget-setup.md`) → Build 80 has NO widget; `ios/App/TruNorthWidget/*` inert until wired. **Aron is device-testing Build 80 before an App Store submission** (Builds 76–80 = v1.1 TestFlight track, not yet submitted for review; v1.0 Build 75 stays the LIVE App Store build). ✅ **Charity sub-cap tightened 85→65** (`8ce735f7e`) — unquantified `positive`/`active_giving` charity (no IRS-990 total) was a flat 85 (~46% of charity scores, upside-only) floating polluters toward a B; now 65 ("documented but unquantified"). Rebaked all company files: **133 grades moved (121 down, 12 up)**; dist A 77→70 / B 1017→964 / C 1017→1037 / D 492→533 (F 235); Tesla C→B (demo grade updated); catalog now **12,833 tracked / 2,839 graded**; 28/28 + 9/9 guards. ✅ **Retention Tiers 1–3** — camera-denied "Search by name instead" (`aa6c3fa02`, T1) · empty-basket watch card + deletable watches (`91cc38483`, T2) · share-the-grade receipt + de-dup Share (`8e067bcd9`, T3) · ungraded "?" brands don't consume the free daily view (`7f17a7be1`). ✅ **Build-79 device-bug fixes + a11y** — C renders bone-gray, distinct from D's amber (`f05b7d563`) · "Resume the Match · N of 11" on a saved draft (`267811a55`) · cross-pressured users not mislabeled Progressive/Conservative (`eddbc0f3f`) · account button 40→44px (`e33901223`) · logo tiles show initials while loading (`e4b844941`) · padlock removed next to visible grade (`ef274e38c`) · Ledger large-amount overflow → froze/zoomed screen FIXED (`5fd494cb7`) · ExxonMobil division subs folded into parent (`2060d5981`) · saved-brand row `div role=button` not button-in-button (`b1b378789`). ✅ **Security headers** HSTS + X-Content-Type-Options + X-Frame-Options + Referrer-Policy (`e2ee985ec`, **NOT skip-ci → web-deployed**). ✅ **Copy** — paywall/FAQ stop contradicting the free experience (`ba6f14c27`) · Match standardized to "45 seconds" (`6e874d0e2`) · placeholder testimonials pulled from landing (`aa553ed70`, Aron OK'd) · "Software & Technology" dropped from daily shelf lead (`744a843a7`). Scoring model **R7.1** (charity sub-cap only; thresholds unchanged). — **EARLIER 2026-07-03 (daily doc-sync):** the "▶ NEXT BUILD (Build 79)" framing below is SUPERSEDED — Builds 79 + 80 both shipped 2026-07-04. The 2026-07-02 four-team diligence review's fixes landed on `main`** (all `[skip ci]` → NOT web-deployed, NOT in a submitted App Review build; Aron tests first). ✅ **All 5 CRITICAL diligence items fixed** (`1a7430b73` + `12f300c15`): **C1** un-quizzed "?" wall → real baseline grades at 8 badge sites (`computeScore(co,null)` already returned baked `co.overall`; **reverses the 2026-06-13 quiz-gate**); **C2** ExxonMobil triplicate deduped → `exxon-mobil` D canonical (`scripts/dedup-brands.mjs`) + client-side slug-alias resolution so `/company/exxon` resolves not 404, new ui-guards test bans divergent-grade name-dups — **catalog 12,839→12,836 tracked / 2,837 graded, 0 drift**; **C3** honest count reframe → "2,800+ fully graded" leads everywhere + landing/onboarding demo grades corrected (Costco B / Tesla C / Shein C, guard-locked); **C4** "one-time Pro upgrade" → accurate auto-renewing subscription copy (App Store 3.1.2/FTC); **C5** server-side entitlement — `isPaid` reconciled from RevenueCat `hasProEntitlement()` on boot + foreground resume (was 100% client-side localStorage = free-unlock/never-revoke leak; **verify Sandbox purchase/cancel in Build 79**). Also H9 purchase-error color + Methodology footer anchor. ✅ **Retention (Tier-3):** "Notify me when we grade this" opt-in on ungraded detail cards (`98c945556` — generalized `SuggestBrandButton`, source `brand_grade_notify`, turns a "?" dead-end into a return event). Scoring **R7.1 unchanged.** Full review: `docs/research/v1.1-diligence-review-2026-07-02.md`. — **EARLIER 2026-06-27 (evening doc-sync) — 🟢 LIVE: TruNorth v1.0 (Build 75) on the App Store + Product Hunt** (id `6775301458`). **▶ NEXT-BUILD worklist cleared almost to the floor this evening** — of the 9 pre-ship items, **6 are now ✅ DONE**: **NB-3/B-63** CC-BY-NC strip EXECUTED (`1135c84d9`/`393566d61`/`f37d05de8` — 6 NC augments removed + 58 narratives scrubbed, 22 NC-traceable grade changes, 28/28 tests, 0 NC text remains) · **NB-5/B-64** 3 weekly crons fixed (`e8df769c5` — score-rebake `npm ci`, cruelty-free skip-on-absent, epa-echo per-request timeout) · **NB-6/E-6** source-count reconciled to one **200+** headline + `SOURCES.md` regen (`c60d58ebc`/`306b3ea33`) · **NB-8** all open PRs triaged to ZERO (`gh pr list` empty — #115 parent-map landed via `af6abf34b` (E-11) then closed; #114/#111 la-county dups closed; #105 paywall-flip closed = keep waitlist) · **NB-9** Fed-Reserve card lit (`c25dea5dc` — `fed-reserve-enforcement.json` committed + 23 company files carry `enriched.fedReserve`; ⚠️ this **CORRECTS** the older "fed-reserve absent / sub-card dark" note below) · **B-23/NB-2 first wire** — **animalCerts WIRED** into personalized scoring (`d8cb9fd06`, Aron-approved; stance-gated, suppressed on record-backed negatives, 0 baseline drift, 28/28 tests). Also **G-9** sameAs entity links done (`ead659b38`). **Still open for Build 76:** NB-1 (iOS 75→76 bump — `pbxproj` still 75) · NB-4/B-67 (GJF `vt-strip-gjf.mjs` still UNRUN — fire after any B-23 rebake) · NB-7/E-1 (scoring-flags flip decision) · B-23 remaining 6 dims (held). **Build-76 data-expansion wave FULLY LANDED on `origin/main`** (Jun 26–27): the **"10 sources" = 7 net-new license-clean pipelines + 3 revived dead fetchers** (EPA TRI · ITEP tax · EPA GHGRP). 7 new pipelines fold into `company.enriched.*` via `apply-enriched-augments.mjs` (format-preserving, additive, **no score impact, no rebake**) → reveal **"public-record footprint"** card (`App.jsx:3408`) + government-only **Fed-Reserve/SEC enforcement** block (`App.jsx:3425`): sec-tax 3,417 · supply-chain 872 · openfda-recalls 363 · privacy 345 · pharma-conduct 211 · labor-wages 48 (DOL WHISARD key now set) · animalCerts **19** (the earlier "~11,210 via rebake" was a bad grep match — verified nested count is 19; `enriched.tax` is 0, only `secTax` (3,418) populates today). Refreshed weekly by `enriched-augments-refresh.yml` (`9a3f1c8dc`) — **truncated by a bad patch, repaired today `36e90245a`**; cron ran once auto (`9b49e6273`, Jun-26) + manual CI run 28298599428 **success** (Jun-27). Two today cleanup commits: `eba9b9a5c` (format-preserving merges + complete footprint pipeline), `36e90245a` (workflow restore). **B-64 news-cron FIXED** (`72f7d71c5`; healthy nightlies `5af76ac86`/`b84ca5f9b`/`e618dff58`). **Footprint is display-only "dark data" — NOT read by scoring (gate = B-23, re-scoped below).** **✅ Branch divergence RESOLVED (2026-06-27):** repo consolidated to a single `main` (working tree clean); the old feat branch + ~120 agent worktrees were retired this session. `fed-reserve-enforcement.json` is intentionally absent from main and *not* needed — `App.jsx` reads the merged `enriched.fedReserve`/`secLitigation` per-company fields (fully guarded), so the **SEC enforcement sub-card renders but the Fed-Reserve sub-card is dark** (the `fed-reserve-monthly` cron has never run on main → 0 company files carry `fedReserve`). **Parallel sessions:** PR #115 brand-parent-map Wikidata guard **OPEN but CONFLICTING (needs rebase)** (brings E-11) · GJF "Federal penalties" license gate on branch `claude/wizardly-franklin-fb8226` (**pushed to origin**, unmerged) (`d19b9dc92` display gated off, `039dbe769` `vt-strip-gjf.mjs` built+sandbox-tested **NOT YET RUN** — fire AFTER the Build-76 rebake; **now tracked as B-67**). Catalog 12,845 tracked / ~2,864 graded; scoring R7.1 unchanged. — **EARLIER 2026-06-25 — data-pipeline repair + marketing/social:** first cuts of the B-64 news-cron fix (`72f7d71c5`) and the EPA TRI endpoint fix (`ec77b498b`); nightly snapshots PostHog trending `c553e5f44`, OFAC-SDN `7033c6a6b`; PH-driving social session. — **EARLIER 2026-06-22 (pre-launch doc-sync): App Store v1.0 (Build 75) ✅ APPROVED 2026-06-18 → "Pending Developer Release" (Manual); PH launch Jun 23 · 2:01 AM CDT (scheduled).** The full 6-issue App Store saga is CLOSED (3.1.1 · 3.1.2c · 2.1b · 5.1.1v · 2.1a · 2.1b — never resurface as blockers). **Launch-day runbook `docs/LAUNCH_DAY.md`:** Release in ASC the night before (link propagates 1–4h) → set `APP_STORE_URL` in `MarketingLanding.jsx:46` (landing CTA auto-flips off the TestFlight mailto) → paste PH First Comment + social with the live URL. **This doc-sync's work:** (1) **main build number synced 74→75** (commit `85dbe033b`, `[skip ci]`) — main had lagged while ASC held 70–75, so a ship-from-main would collide at 75; next ship now = **76**. (2) **PH gallery rebuilt** from current Build-65 screenshots (commit `4ec1b8c2f`, feat branch: Civic Premium, clean de-waitlisted Reveal, "200+ sources"). (3) **Source-expansion research → B-65** (`docs/research/data-sources-expansion-2026-06-22.md` — 59 verified net-new public-record sources; build **POST-launch**, license-safe gov first, Norges Bank via NBIM-direct not OpenSanctions). Parallel-session items now tracked here: **B-63** (NC-license cleanup — paid tier triggers the CC-BY-NC drop, post-launch; stale "free" comments committed `fec17d0e2`) · **B-64** (live cron failures — `news-rss-nightly` hangs nightly → **news signals stale for weeks**; post-launch). Catalog 12,845 tracked / ~2,864 graded; scoring R7.1 unchanged.
>
> **EARLIER 2026-06-14 (PM) — ✅✅ v1.0 (BUILD 74, iPhone-only) RESUBMITTED TO APP REVIEW — status "Waiting for Review" (~7:40pm CST).** The whole rejection→resubmit arc closed today: on-device **sandbox purchase + restore VERIFIED** (Build 69/70) → the 11-agent **QA fix sweep** shipped across Builds 70–74 → all three cited rejection guidelines resolved + resubmitted with both subscriptions. **Apple's 3 issues, fixed:** **3.1.1** (real StoreKit purchase via RevenueCat; the email "waitlist" mechanism is gone) · **3.1.2(c)** (paywall shows the auto-renew disclosure + functional Terms of Use (EULA) + Privacy Policy links; EULA in the App Description, Privacy Policy URL set) · **2.1(b)** (both subs attached to the version, each with an App Review screenshot). Proactively also fixed **5.1.1** (paywall email made optional — B73) and de-waitlisted the archetype **Reveal email card** (stale "ship on the App Store" copy → neutral opt-in — B74). App is now **iPhone-only** (B72, drops the iPad-screenshot requirement). 5 iPhone screenshots regenerated; reply posted to the Jun-7 rejection thread. Sandbox tester `aron@trunorthapp.com`; submission paste-sheet at `docs/app-store-submission.md`. **NEXT: await Apple's verdict (~24–48h, email on status change); on approval set `APP_STORE_URL` (landing CTA flips off the TestFlight mailto) + update PH First Comment / announce copy + flip the live URL.** **Web: PR #109 MERGED → trunorthapp.com deployed + VERIFIED LIVE** ($14.99/$1.99 pricing, Android waitlist CTA, Methodology source-disclosure fix). Builds 70–74 carry the full QA sweep — see the **QA-1…QA-25** table below. — **EARLIER 2026-06-14 (AM): 🚀 Build 69 on TestFlight → sandbox gate.** Build 69 uploaded via `scripts/ship-ios.sh` (altool UPLOAD SUCCEEDED, delivery `f701b040…`, bump committed `f7b9897e8`) — first TestFlight build with the merged review wave + **live RevenueCat IAP**; the on-device sandbox purchase that gated submission (v1.0 was rejected over a non-completable paywall) **succeeded**, clearing the gate. Launch-prep done today after the merge: **honest copy sweep** ('12,000+ graded' → '~2,900 graded / 12,000+ tracked' across 24 files incl. website meta + App Store listing + PH/social/investor/email; pushed `237c72125`); **prompt caching** on both Anthropic API callers (`ai-research-bake` + `news-rss-extract`, ~30% spend cut); **Vercel → Pro** (free-tier 75%-of-100GB auto-pause risk GONE; 1TB allowance, ~32GB/mo; bandwidth diagnosis = mostly Googlebot, **NOT** AI crawlers → robots.txt left unchanged); **`main` branch protected** via Ruleset (force-push + deletion blocked; PR/status-check rules OFF so the `trunorth-bot` nightly pushes keep working). — **EARLIER 2026-06-13: ✅ POST-R2 REVIEW WAVE MERGED TO MAIN + DEPLOYED** (merge `e20b36ab3` → `git push origin main` → Vercel prod, verified live via `/data/companies/hobby-lobby.json` 200). The merge bundled the **should-fix sweep** (dead-Quiz removal · tests import the real engine · vocabulary unified on 'Basket' · the previously-missing **weekly-changes generator** `compute-weekly-changes.mjs` + Sunday-digest ordering fix · Reveal slimmed to archetype→clash→one CTA) and the **Chase data bucket** (Target DEI now reflects the Jan-2025 rollback · LEGO **B** / Hobby Lobby **C** / Nintendo & Puma **"?"** seeded from real entity-verified records — Nestlé was never missing, it's slug `nestl`). Catalog now **12,845 tracked / 2,851 graded / 9,994 "?"**. — Full investor/product-lead review (UX · scoring · code · data · competitive) → fixes landed on the branch in 5 commits: **W1 P0/P1** — native iOS API funnel un-broken (subscribe/submit resolved to `capacitor://localhost` and were silently lost; submit.js OPTIONS+CORS); grade-legend corrected to real thresholds (was A=90–100 "school curve"); Methodology §6 politics contradiction; vt-merge synthetic-data guard; welcome-modal cold-launch re-fire; Match crash-loop clamp + **card reorder (politics off slot 1)**; quiz→Match copy; dropped plaintext-email PostHog identify. **R7 SCORING (Aron's call)** — political **EXCLUDED from the un-quizzed baseline** (now a stance cat like dei/animals/guns; counts only when the user takes a side in the Match): 4-engine change + 4,862-file rebake, thresholds kept frozen. **Analytics** — persistence memory→localStorage (retention now measurable) + surface_view / match_card_answered / scanner-failure events. **Cracker Barrel** wrong-parent merge fixed (was graded on Kraft Heinz's records → D→C on its own). **SCORING REWORKED → R7.1 (Aron, 2026-06-13) — now MERGED to main + deployed.** R7's political-exclusion initially cratered the curve to 37.7% F (political was the main positive counterweight; baseline is violation-dominated). Aron chose "recalibrate + keep R7, then fix sparsity" → **R7.1**: (1) revenue-normalized penalty severity (new `sec-revenue-fetch.mjs` → SEC XBRL revenue for 357 ticker'd brands; penalty scored as %-of-revenue, absolute fallback otherwise) — a $10M fine no longer sinks a $700B co; (2) **E-10 thin-record floor** (mirror of E-9: one moderate negative-only record floors at C); (3) recalibrated thresholds **A≥62/B≥50/C≥38/D≥33** (re-anchored once after the structural change, re-frozen; all 8 engine copies + legend + Methodology synced; E-9 single-signal cap 62→61). **Result among 2,864 graded: A 3 / B 36 / C 36 / D 18 / F 8.** Walmart/Target/Amazon/Kroger F→C, McDonald's D, Apple A, Costco/Nike/Starbucks B; 0/12,841 parity mismatches; 28/28 tests. (A=3% — single-signal brands correctly cap at B; revisit if too rare.) Prior 2026-06-12 PM — **Compass Redesign R1+R2 shipped through Build 68.** R1 Civic Premium skin + Compass seal (B59–61), R1.1 ring verdict seal + E-9 single-category cap-at-B (B62), R1.2 chip-fit + cooler signal `#3DD6B5→#38C0CE` (B63), R2 "The Flows" four-surface nav Today/Lens/Ledger/You + the Match (11 tension cards, replaces quiz) + Ledger v1 + the Switch + Versus single verdict + first-run basket → Reveal-judged (B64), R2.1 device feedback — Versus single-column, AI synthesis chips hidden, DEI third-party recognition reaches stanced grades (B65), Civic Premium brand media refresh — icon/OG/landing/social kit (B66), B66 device fixes — splash mark, Lens un-clipped, center-button scanner, Methodology scroll, share OG title (B67), B68 clash-led basket articulation ("0% aligned" retired, `basketVerdict()` single source, Today serif clash sentence + Ledger "N clashes" tile + Reveal clash line, scoring untouched/symmetric). Build numbering now true (`manageAppVersionAndBuildNumber=false`) — repo build == ASC build from 61. Promo video re-cut + 5-platform announcement pack landed same day. Prior 2026-06-11 AM —
> **SCORING V3 shipped: grade-dispersion overhaul.** The Build-57 signal-count cliff (37.8% of graded brands flattened to C — 1,520 A-range one-signal brands among them) is replaced by evidence-weighted shrinkage toward 50 (K=1.5, IMDb-style); thresholds recalibrated once from the post-V3 distribution and FROZEN at A≥63/B≥56/C≥46/D≥41; severity-continuous category scores ("Path B for every category"): execPay from actual SEC pay ratios (log curve, 20:1→100 … 1000:1→15), labor/env negatives by penalty $ (8–40), charity by IRS-990 grants (60–100); stance cats (dei/animals/guns) excluded from the un-quizzed baseline per the Phase-4.11 neutrality principle. Per-category continuous scores baked as `csc` on company files AND index entries (kills index-vs-detail political flicker). Grade dist among 5,306 graded: **A 7.2 / B 34.5 / C 40.7 / D 8.1 / F 9.5** (was A 1.9 / B 14.7 / C 58.5 / D 22.0 / F 3.0). Sync points updated: rebake-scoring, finalize-bundle, rebuild-bundle-index, App.jsx, audit-grade-drift, 3 SEO endpoints; scoring-engine tests rewritten (27/27 pass). ⚠️ Note: `a77722b21` (parallel R6 session) swept the mid-flight engine files into its commit — this ship completes/repairs that state. Prior 2026-06-10 late PM: **R6 execPay rollout shipped** (`ebc27c88e`, `cb8b6e9bc`): new SEC XBRL ecd source + the orphaned sec-def14a pay ratios wired + crawl universe 340→1,372. execPay scored **23 → 676 brands**, full-grade (3+ cats) brands **1,107 → 1,228**. Research doc: docs/research/data-sources-r6-coverage-gaps-2026-06-10.md (next up: IRS-990 foundation pass for charity, CPPA data-broker CSV, ToS;DR pending license check, OFCCP EEO-1 manual download). Earlier today — **Full-app QA sweep: all 5 fix phases shipped to main** (`c2d587bca`..`10811f944`). Phase 1 data (legacy-category revert re-fixed, flags passthrough, HRC writer, trending slugs). Phase 2 payments-branch P0s (`bc649612d` on feat/paywall-go-live: getOfferings, cancel detection, tri-state entitlement revoke, $14.99/$1.99/37% copy). Phase 3 app criticals (deep-link detail fetch + /c/ links + consumption-based deepLinkSlug clear, S3 cap fix, dealbreaker math, Why-panel −20/−10 sync, Top Match capped-grade rank, onboarding live grades + real Terms/Privacy links, scanner double-fire, NaN sorts). Phase 4 web (SEO grade parity — 0/11,261 mismatches, lookupSpa await, JSON-LD escape, subscribe CORS preflight, landing 200+ sources, double-POST). Phase 5 infra (news-rss-nightly hang fixed: fetch timeouts + 35-min budget + partial commits; gdelt/openstates/nhtsa timeout bumps; dead dup writers removed; /privacy path + sitemap; local-day quota; 44px scanner close; grammar). IAP screenshot regenerated at 37% — **Aron must re-upload to BOTH subscriptions in ASC**. 15 empty augments flagged as a follow-up task. Prior: GEO shipped Jun 9. **13 days to launch.**

---

## 🚀 v1.3 "WHO OWNS WHAT YOU BUY" — CORRECTNESS → COVERAGE → LAUNCH (2026-08-10, 14-agent review)

> **Full plan:** `docs/research/v1.2-growth-strategy-2026-08-10.md`
> **Aron's decisions (2026-08-10):** ① Fix ~3 weeks, **launch late September** — do NOT big-bang in August.
> ② Positioning = **"who owns what you buy"** (the brand→parent map is the wedge). ③ **Paywall unchanged**
> — leave pricing alone for now. ④ Email **moves to Resend**.
>
> **The finding that reframed the plan:** TruNorth does not have a marketing problem yet — it has a
> **correctness problem that gets worse with every visitor**. A launch that *works* is the risk.

> 🟢 **STATUS 2026-08-14 — ALL OF IT IS LIVE IN PRODUCTION.** The 12-commit pile was rebased onto 84 bot
> commits and pushed as **`c2c1216de`** (07:58 EDT); the clone is **0 ahead** of `origin/main`, CI ran and
> **passed** on that commit (run `31798426525`), and `curl https://www.trunorthapp.com/data/index.json`
> returns **12,830 tracked / 2,590 graded — A 62 · B 706 · C 1,029 · D 537 · F 256.** Live moved
> **3,060 → 2,590 (−470)** — the intended correction. Per-brand production checks: **23andMe `B → "?"`**,
> **0 `"Claude AI synthesis"` in the live `23andme.json`**, **LiveRamp still `D`**, **Ben & Jerry's `A` vs
> Unilever `C` still diverge (correct).** 📊 **542 brands moved and the ledger reconciles exactly: 476
> grades removed (463 of them C-4's `B → ?`) · 6 newly graded · 59 downgraded (B-115 tax) · 1 upgraded
> (`mayo-clinic` F → D, C-3 removing an unsourced penalty). 3,060 − 476 + 6 = 2,590.** ⚠️ **Quote 2,590,
> not 2,586.** 🔴 **Still open: V-4 (dark `enriched.*` dims — grade-moving), L-1/L-3/L-4, the `sec-def14a`
> parser fix, and `RESEND_API_KEY` (confirmed still absent from repo secrets).**
>
> ✅ **[08-13 EOD] C-1…C-6, V-1…V-3, L-2 and the B-121 email migration ALL DONE and
> committed locally (12 code commits, unpushed at the time).** ⚠️ **Dates, corrected from git:** C-1 and C-2
> landed **2026-08-10**; **C-3, C-4, C-5, C-6, V-1, V-2/V-3, B-121 and L-2 all landed 2026-08-13** —
> earlier notes labelling the whole batch "08-10" were wrong. Catalog moved **3,065 → 2,586 graded** — a
> deliberate 479-grade reduction buying correctness (B alone: 1,170 → 706); findable coverage went the
> other way, with 5,241 shelf-brand names now resolving (search correctness on real shelf brands:
> **top-1 28%→72%, top-3 31%→93%**). **68/68 tests pass**, and `grep -rl "Claude AI synthesis"
> public/data/companies/` returns **0**. ~~🔴 **`origin/main` still serves 3,060 graded — every one of these
> fixes is on disk and NOT live.**~~ ✅ **PUSHED AND LIVE 2026-08-14 — see the status block above.**

### C — Correctness (must land before ANY distribution work). Stop-ship gate.
- **C-1 ✅ DONE (`b8f529575`) — 9,765 pages published a fabricated "F".** `Number(null)` is `0`, which IS
  finite, so `alternatives-seo.js` turned "no grade" into `grade(0)`="F" on every ungraded company; all
  12,792 of those pages are in the sitemap. Fixed at the root of `grade()` via `numOrNull()` + all 3
  coercing call sites; same latent defect hardened in `company-seo.js`. Verified against the real
  handlers: ungraded subject now asserts NO grade; graded subject still correct.
- **C-2 ✅ DONE (`3c503eca1`) — 13 publicly FALSE CEO pay-ratio claims.** The `sec-def14a` parser drops a
  leading "1" (Coca-Cola 1739→739, McDonald's 1082→82, Starbucks 1794→794, Wayfair 5702→702, …) and on
  Home Depot parsed the filing YEAR as the ratio ("2026:1, CEO total comp $2K" vs the real 427:1 /
  $16.2M). Surgical data fix; **0 grade drift** (scoring reads structured `payRatio` first — which
  retroactively validates cutting the enriched ratio from B-115). ⚠️ **Upstream parser still broken —
  these regress on its next successful run (B-107/B-123).**
- **C-3 ✅ DONE (`a585101c1`) — 82,553 `"Claude AI synthesis"` source strings across 11,187 brand files (87% of the catalog).**
  On a "records, not opinions" product this is the single most dangerous string in the repo. Either cite
  the real record or drop the claim. **Highest remaining reputational risk.**
- **C-4 ✅ DONE (`056784c71`) — 1,298 graded brands (42%) rested on ONE category; 586 score exactly 50.000, which renders as "B".**
  Live example: **23andMe grades "B"** off one `privacy:"mixed"` datapoint while its own narrative cites
  the CA AG suing it over a data breach. Show *"Not enough public record to grade"* instead. Grade-moving
  → rule #16, Aron approves drift.
- **C-5 ✅ DONE (`1591a2793`) — same company, contradictory grades.** `Alaska Air Group=D` vs `Alaska Airlines=A`; `Apple=B` vs
  `Apple Store=A` vs `Apple Music=C`; `Amazon=C` vs `Amazon Go=F`; `CVS Health=D`/`CVS Pharmacy=C`. Of 602
  sub-brands graded beside a graded parent, **143 (24%) disagree, 32 by 2+ letters.** Keep legitimate
  divergence (Ben & Jerry's=A vs Unilever=C); suppress thin-data artifacts on the same business.
- **C-6 ✅ DONE (`1cb740822`) — data-integrity gate that FAILS THE BUILD** if any brand asserts a grade unsupported by a record.
  The only control that keeps working when attention moves elsewhere.

### V — Coverage (the release feature)
- **V-1 ✅ DONE (`0d1ea2f4c`) 🔑 THE FLAGSHIP — brand→parent map wired into SEARCH.** The scanner loads
  `brand-parent-map.json` (6,704 entries) at `App.jsx:149-190`; **the text-search path never does**
  (`App.jsx:5483-5521`). Measured: **4,902 shelf brands already resolve to an ALREADY-GRADED parent and
  are unfindable by typing the name** (4,389 high-confidence) — Nestlé 206 · P&G 180 · Unilever 179 ·
  PepsiCo 124 · Mars 115 · General Mills 101 · Hershey 96 · Coca-Cola 95. Proof of the absurdity:
  **Febreze/Downy/Gillette/Olay/Pantene/Head & Shoulders all grade C; Tide/Charmin/Pampers/Old Spice/
  Swiffer — same parent — return nothing.** ⚠️ **Design: ONE record, MANY aliases** ("Tide — made by
  Procter & Gamble, graded C on the parent"), NOT 4,902 new rows (that inflates the brand count and
  multiplies C-5). Never let an alias overwrite an independently-graded brand.
- **V-2 ✅ DONE (`1d279f5b1`) — normalized 1,736 raw ALL-CAPS EDGAR display names** ("CLOROX CO", "J M SMUCKER"); 732 are graded
  and surface in results.
- **V-3 ✅ DONE (`1d279f5b1`) — zero-result + no-graded-result searches now logged.** The single most valuable dataset currently discarded; it becomes the
  prioritized "what to grade next" queue.
- **V-4 — depth over breadth:** wire 1–2 dark `enriched.*` dims using the B-115 penalize-only template,
  targeting the 1,298 single-signal brands.
  🔬 **RE-SCOPED 2026-08-17 — MEASURED, NOT ESTIMATED. THE DARK SURFACE IS 5× WHAT THIS ITEM SAID.**
  Counted every `enriched.*` sub-key across all 12,830 company files: **33 distinct dimensions exist.**
  `scripts/rebake-scoring.mjs` mentions `enriched` on **five lines** and reads exactly **two** of them —
  **`enriched.execPay.payRatio` (`:142`)** and **`enriched.tax` (`:182`)**, both B-115. **The other 31
  move no grade.**
  🔑 **Correction to carry forward: `enriched.animalCerts` is wired to a BADGE, not to scoring** —
  `scripts/lib/index-entry.mjs:111` sets `acertB: 1` from it. Prior notes calling it "the one dim wired
  to scoring" are imprecise; nothing but `execPay` and `tax` touches a grade.
  📊 **Dark dims by brand count:** `secTax` **3,415** · `supplyChain` 869 · `openfdaRecalls` 362 ·
  `privacy` 344 · `oshaSevereInjury` 251 · `pharmaConduct` 211 · `federalContracts` 210 · `political` 80 ·
  `msha` 70 · `secLitigation` 62 · `newsweekMrc` 58 · `cpaZicklin` 48 · `laborWages` 48 · `asYouSow` 42 ·
  `ungc` 41 · `knowTheChain` 38 · `fdic` 38 · `cisaKev` 37 · `supply_chain` 27 · `cftc` 24 ·
  `fedReserve` 23 · `animalCerts` 19 · `osv` 9 · `rainforestAlliance` 8 · `ferc` 7 ·
  `githubAdvisories` 5 · `dojFcpa` 5 · `goodWeave` 4 · `cdcFoodOutbreaks` 4 · `climateNeutral` 3 ·
  `fairTrade` 3.
  🧭 **Start with `secTax` (3,415 brands — by far the largest) and `supplyChain` (869), not the four
  originally named here.** ⚠️ **`supplyChain` and `supply_chain` are two different keys (869 + 27) —
  reconcile the naming before wiring either.**
  🆕🕳️ **SCOPE CORRECTION 2026-08-18 — THERE IS A SECOND CLASS OF DARK DATA, AND THE 08-17 COUNT MISSED
  IT ENTIRELY.** The count above enumerated sub-keys **under `enriched` only**. Several crons write
  **top-level** company-file keys instead, so they never appeared in it. Verified by grep across the
  repo: **`finra`, `occ`, `nrc` and `phmsa` have 0 references in `scripts/rebake-scoring.mjs` and 0 in
  `scripts/lib/index-entry.mjs`**, and appear in `src/App.jsx` **only inside the static Sources array**
  (`:4884` FINRA, `:4881` OCC, `:4918` NRC, `:4917` PHMSA) — **that array is a citation list, not a data
  consumer.** **Counted across all 12,830 company files: `finra` 92 · `phmsa` 30 · `occ` 14 = 136
  top-level key placements with zero consumers.**
  ⚠️ **METHOD RULE: enumerate EVERY company-file key, not just `enriched.*`, or this scope keeps
  under-counting.** Current known total: **31 dark `enriched` dims + at least 3 dark top-level keys**,
  plus the display-only datasets (`nhtsa-auto.json`, `ntsb-accidents.json`) that never enter a company
  file at all.
  ⚠️ **Sequencing note vs B-129/B-130: matching more brands into a key nothing reads changes nothing.**
  Wiring a consumer and fixing the matcher are two halves of the same fix — **decide the consumer
  first**, otherwise B-129 work produces better-populated dead keys.
  ⚠️ **Anything wired here is grade-moving → rule #16, Aron approves drift.**

### L — Launch (late September)
- **L-1 — hero asset: "Your grocery aisle is 10 companies."** Interactive, free, no app required. The
  parent map is the only dataset TruNorth owns that nobody else publishes.
- **L-2 ✅ DONE (`a7a83ebaf`) — `/methodology` rewritten to match the code + public corrections log.** On a checkability product these are features, and they
  are the prerequisite for every partnership ask (ITEP permission is already on file, unused).
- **L-3 — App Store listing overhaul.** Per agent research the app is filed under **News** (not Shopping),
  named "TruNorthApp" (zero keywords), and ranks **#4 for its own brand name**. ⚠️ Aron to confirm in ASC.
- **L-4 — creator-led distribution, not ads.** Competitive proof: **Buy'r launched 2026-01-21 → 50K
  downloads week one, 4.8★/597 ratings**, off ONE TikTok creator (4M followers), with a thinner database
  and **no scores at all**. Yuka hit 80M with zero paid marketing. A *dormant* app (Goods Unite Us, last
  updated 2024) has 40,000 ratings to TruNorth's 2.
- **L-5 — stopping rule (write it down):** if by **2026-12-15** organic sessions <100/month AND graded
  brands with ≥3 categories <1,000, stop building and keep the site as a credibility asset.

### ⛔ Blocking on Aron
1. ✅ **PUSH — DONE 2026-08-14 (`c2c1216de`). STALE ITEM, CLOSED 2026-08-17.** The 12-commit pile (B-115 ×2, C-1…C-6, V-1, V-2/V-3, B-121, L-2) was rebased onto 84 bot commits and pushed; CI ran and passed (`31798426525`); production serves **12,830 tracked / 2,590 graded**, verified at the CDN. ⚠️ **The old text here still said "73 behind / 15 ahead" and predicted "3,066 graded" — both were superseded three days ago. The shipped number is 2,590; the clone is 0 ahead.** ⚠️ **The push shipped WEB ONLY — Build 81 does not contain the C-fixes.**
2. 🔺 **Install Build 81, open 5 brand cards, then re-run `trending-refresh` via `workflow_dispatch`**
   — nobody has ever run the shipped app; every UX claim in the review is read from source code.
   🚨 **RAISED IN PRIORITY 2026-08-19 (B-131).** PostHog has logged **zero `company_view` events for
   12 straight days** and `public/data/trending.json` has been frozen since 08-07 holding a single
   brand. **This one action is now the cheapest possible diagnostic on the board:** events show up
   → the app works and the problem is adoption; events do not show up → the shipped client is not
   reporting analytics at all, which is a code defect nobody has detected in two months live.
   ⚠️ **Scanning 5 products is not a substitute — the event fires on the brand DETAIL card
   (`src/App.jsx:3252`), so open the cards.**
3. **App Store Connect** — confirm the category/name/keyword findings and make (or delegate) the edits.
4. ✅ **Resend migration IMPLEMENTED** (`58dab0aa4`) — `--apply` now passed on
   `score-rebake-weekly.yml`. ⚠️ **Nothing can send until you add `RESEND_API_KEY` to the repo
   secrets** — that secret is the activation switch. Warm up deliverability on the small existing
   list before any launch campaign.

---

## ▶ NEXT BUILD (Build 82, iOS) — Build 81 ✅ SHIPPED + LIVE 2026-07-14 (updated 2026-07-18)

> 🟢 **Build 81 (v1.1) is DONE — approved 2026-07-08, released Manual 2026-07-14, now the LIVE App Store build.** The table below is the Build-81 worklist, kept for its still-open rows; **its ✅ rows are history, not pending work.** **Carry-forward into Build 82:** **NB-2** (B-23 — wire the remaining 6 `enriched.*` dims into scoring) · **NB-4** (B-67 GJF strip, still unrun) · **NB-7** (E-1 scoring-flags flip decision) · **widget revival** (target + Swift preserved, deployment target already at iOS 15.0; re-add to the App target's Embed phase + dependencies, and harden `ship-ios.sh:124`/`:203` for multi-target before `ship:ios` can carry it). Most of these are also v1.2 candidates — see the v1.2 plan doc referenced in the header, pending Aron's decisions. — **Historical (2026-07-07):** ✅ **Build 81 SUBMITTED to App Review, WIDGET-LESS (Manual release).** ⚑ **DECISION 2026-07-07: the Home-Screen widget is DROPPED from Build 81; v1.1 ships WITHOUT it.** Commit `7703c1602` decoupled `TruNorthWidgetExtension` from the App target (Embed phase + dependency) so the archive carries **no `.appex`**, and also landed the previously-uncommitted deployment-target fix **26.5 → 15.0** (moot for 81, kept correct for Build 82). Verified `xcodebuild` → **BUILD SUCCEEDED, 0 widget compiled** → Build 81 is **single-target again, so `ship:ios` works** (no Xcode Organizer archive needed). The widget target + Swift are **preserved for Build 82** (de-scope, not deletion). So the NB-10 "archive via Organizer because it carries the widget" caveat below is **no longer in force for Build 81** — revisit only when Build 82 re-adds the widget (and the `ship-ios.sh` multi-target hardening at `:124`/`:203` will matter again then). Build 80 was the last build shipped before this. Everything else below was reconciled 2026-06-27 — re-verify before acting.

| # | Item | What / why (verified) | Status |
|---|---|---|---|
| **NB-10 🆕** | **Wire the widget Xcode target** | ✅ **DONE 2026-07-05** (`68a518585`): `TruNorthWidgetExtension` target created in Xcode; App Group `group.com.trunorthapp.app` on BOTH `App.entitlements` + `TruNorthWidgetExtension.entitlements`; restored the real "Your Basket" widget after the New-Target template clobbered it; verified on iPhone 17 Pro sim (builds→signs→installs→renders empty state). Then bumped to **Build 81** (`f30acd7be`). ⚠️ Widget lands in **Build 81** (first build carrying it) → **archive via Xcode Organizer, NOT `ship:ios`** (script not yet multi-target-aware). | ✅ **DONE** (`68a518585` + `f30acd7be`) |
| **NB-1** | ~~Bump iOS build 75 → 76~~ | **✅ DONE + PAST** — binary is now v1.1 / Build **80** on main (`CURRENT_PROJECT_VERSION = 80`; `ship:ios` auto-bumps). Next ship = **81**. | ✅ moot |
| **NB-2 🔑** | **B-23 — wire `enriched.*` into scoring** | The load-bearing lever. animalCerts wired (the one approved dim); 6 others held. Remaining lever = wiring more dims. | 🟡 **animalCerts WIRED** (`d8cb9fd06`, B-23); other 6 HELD per proposal |
| **NB-3** | **B-63 — strip CC-BY-NC enrichment** | EXECUTED: 6 NC augments `git rm`'d + 58 narratives scrubbed (`b63-strip-nc.mjs`) + 5 writers removed; 22 grade changes all NC-traceable, 28/28 tests, 0 NC text remains. | ✅ **DONE** (`1135c84d9`/`393566d61`/`f37d05de8`) |
| **NB-4** | **B-67 — GJF data strip** | Run `vt-strip-gjf.mjs` (on `claude/wizardly-franklin-fb8226`, **already pushed to origin**) AFTER the NB-2 rebake so narratives aren't re-written. | ⬜ after NB-2 (still unrun) |
| **NB-5** | **B-64 tail — fix 3 crons** | FIXED: `score-rebake-weekly` got `npm ci`; `cruelty-free-merge` exits 0 (skip) when quarterly raws absent; `epa-echo-fetch` got 20s per-request timeout + retry. | ✅ **DONE** (`e8df769c5`) |
| **NB-6** | **E-6 — reconcile source count** | DONE: in-app copy reconciled to one **200+** headline (free tab = 105 highest-signal subset / "full 200+ in pipeline"; paid 105+→200+); landing 170+→190+; `SOURCES.md` regen'd to 2026-06-27 (105-curated/200+-pipeline split). | ✅ **DONE** (`c60d58ebc` copy + `306b3ea33` SOURCES.md) |
| **NB-7** | **E-1 — decide scoring-flags flag** | VERIFIED never flipped: `feature-flags.json scoringFlagsEnabled:false` since Jun-8; app launched OFF. Runtime kill-switch (no build needed). Flip + 24h watch, or close deferred. | ⬜ decision |
| **NB-8** | **Triage 8 open PRs** | Resolved *at the time*: #115 parent-map landed via direct commit (`af6abf34b`, E-11) then PR closed; #114/#111 (la-county dups) closed; #105 (paywall flip X-0) closed = keep waitlist. ⚠️ **STALE — the "0 open PRs" state lasted about two days.** As of **2026-07-28** there are **29 open bot data-refresh PRs**, oldest 2026-06-29 → re-opened as **B-101**. | ⚠️ **REGRESSED** — 29 open PRs (see B-101) |
| **NB-9** | **light the Fed-Reserve card** | Ran fetch+merge once: `fed-reserve-enforcement.json` now committed + **23 company files carry `enriched.fedReserve`** → Bank-penalties sub-card now lights for those brands. | ✅ **DONE** (`c25dea5dc`) |

---

## 🎯 v1.2 COVERAGE & ADOPTION PROGRAM (2026-08-01, 6-agent audit)

> **Two goals:** (1) increase LEGITIMATE graded coverage (convert "?" brands with credible data),
> (2) create trustworthy adoption measurement + repeat usage. Android held to code/CI/emulator/docs
> only until Aron has device access.
> **Measured baseline:** 12,830 tracked · **3,065 graded** · 9,765 "?" (76.1%) *(updated 2026-08-02 after B-113 +5 and B-115 +6; the original audit baseline was 3,054)*. A brand grades iff ≥1 of
> the **5 scoreable** categories (charity/environment/labor/privacy/execPay) has a signal; the 4 stance
> categories (political/dei/animals/guns) return null by design and can NEVER lift a brand off the wall.
> **"?" wall causes:** identity-but-no-scoreable-evidence **4,277 (44%)** · stance-only **3,104 (32%,
> structural, don't chase)** · genuinely empty **1,964 (20%, the honest floor)** · execPay-no-ratio 350 ·
> dark-scoreable-on-disk 66 · graded-parent-not-inherited 10 · enum-vocab-bug 5.
> **Ordered by (impact × credibility × match-confidence) / (effort × maintenance × wrong-grade-risk).**

### Batch 1 — measurement + instruments (no grades, no decisions) — DO FIRST

- **QW-17 ✅ DONE — PostHog funnel schema hygiene.** *(WS-E, S, no grades/decision)* The pipe is healthy
  (`analytics.js` init, ph.trunorthapp.com proxy, localStorage → retention already computable) but the funnel
  is un-queryable: `paywall_shown` fires 2 incompatible shapes (App.jsx:3217 vs :5731), share splits across 3
  names (:4650/:4742/:6669), notify-me uses 2 names (:5101/:5107), `company_view` (:3242) has no `graded`
  boolean. Consolidate to one shape per funnel step. **Impact:** every step queryable with one query;
  foundational for measuring whether ANY coverage/retention work moves the needle. Free at ~9 visitors/wk;
  prevents un-fixable historical gaps at scale.
- **QW-18 ✅ DONE — add `grade` to `scanner_match`** (App.jsx:6780). *(WS-D, S)* The flagship in-store
  feature's dead-end rate (scan resolves to a "?" brand) is currently invisible. Additive prop. **Impact:**
  directly answers whether coverage or barcode data is the bigger lever.
- **B-104 ✅ DONE — commit `scripts/audit-ungraded.mjs` as the coverage instrument.** *(WS-A, S)* The audit script the
  workflow wrote; classifies all 9,776 "?" by root cause. **Impact:** repeatable one-command coverage
  measurement — the backbone number every coverage decision depends on.
- **B-105 ✅ DONE — fix the watchdog blind spot before adding any source.** *(WS-B, S)* `cron-health-daily` uses a 24h
  lookback (misses weekly crons), queries only `status=failure` (misses `cancelled` = timeout kills), and
  auto-closes empty windows. **Confirmed live 2026-08-01:** 11 cancelled + 7 failed crons, watchdog green.
  **Impact:** prerequisite for trusting any new source; without it every pipeline inherits silent death.
- **B-106 — materialize demand signals into one in-repo `demand-queue.json`.** *(WS-C, S)* scanner_no_match +
  notify-me + ungraded company_view + trending, ranked. **Impact:** ends the repo's blindness to what users
  scan/search but can't find — the true expansion backlog.
- **QW-19 — widen the trending window 7→90 days** (`refresh-trending.mjs`). *(WS-C, S)* trending.json currently
  = 2 brands/1 view each. **Impact:** makes the dead Trending row + demand queue meaningful at near-zero
  traffic. Revert once daily views hit hundreds. **NOTE (corrected 2026-08-01): `trending-refresh` was never
  timing out — it ran 62s against a 30-min cap and was CANCELLED by the shared concurrency group. B-120
  should have unblocked it; verify it goes green on the next scheduled run, then this is unblocked.**
- **QW-20 — report `brands_added` and `brands_graded` as two separate KPIs in doc-sync.** *(WS-C, S)* Never raw
  catalog count. **Impact:** the one metric that says whether expansion creates gradeable value vs inflating "?".

### Batch 2 — source hygiene (no grades) 

- **B-120 ✅ DONE (destagger + long-runners isolated) — ⚠️ ROOT CAUSE of the 20 cancelled crons: one shared concurrency group.** *(WS-B, M, **REQUIRES
  DECISION**)* All **126** data workflows share `concurrency: group: data-pipeline-commit` (identical stanza,
  `cancel-in-progress: false`). GitHub allows only 1 running + 1 pending per group, so in the hour-4–7 UTC
  window where **~90 crons are scheduled**, ~88 get CANCELLED as superseded — not timeouts (trending-refresh
  ran 62s vs a 30-min limit). The crons ALREADY handle push races individually (`git pull --rebase && push`
  retry), so the global serialize isn't needed for push safety. **Fix options:** (a) per-workflow group
  `${{ github.workflow }}` — all run concurrently, risk = push contention with 90 concurrent pushes to main;
  (b) DESTAGGER the ~90 bunched schedules across 24h, keep the shared group — lowest risk, no push storm, but
  edits ~90 cron times; (c) hybrid — a handful of groups by cadence. **Reviving ~20 dead sources triggers a
  large data-freshness burst → grade drift at the next rebake (rule #16, show diff first).** Needs Aron's call
  on approach + awareness of the drift. Separately, the **15 hard FAILURES** (sec-def14a-annual, dol-ofccp,
  fsis/fsis-dw, usda-aphis, eu-antitrust, followthemoney-state, forest500, wikirate, usaspending, sec-8k, …)
  are NOT concurrency — each is its own fetcher break, folded into B-107.
  ⚠️ **VERIFIED PARTIAL 2026-08-02 (see header).** Option (b) shipped and the bunched cancellations are
  genuinely gone (`osv-monthly` and `trending-refresh` both went cancelled → success the same day; 08-02 ran
  24/30 scheduled jobs green). **But 3 cancellations recurred post-destagger, hours apart and unbunched
  (`openstates`, `gao`, `oversight-ig`) — so concurrency was A cause, not THE cause.** Those 3 move to B-107.
  The 3 commit+push failures this was supposed to self-heal (`sec-8k`, `sec-def14a`, `usaspending`) still
  have not run — next real test is `sec-8k-events-monthly` ~Aug 5. **Feared "large data-freshness burst →
  grade drift" did NOT materialize: the 08-02 weekly rebake moved 0 grades.**
  ✅ **ANSWERED 2026-08-05 — the test ran and the answer is NO.** `sec-8k-events-monthly` (run `31047921114`)
  failed again, and the log shows it was **never push contention at all**: the step dies at `git add` on a
  `.gitignore`d `public/data/_cache/` path, before `git commit` or any push. **The destagger could never have
  fixed these 3 — they are their own bug. Moved out to B-123.** With them reassigned, B-120's remaining
  unexplained residue is just the 3 unbunched post-destagger cancellations (`openstates`, `gao`,
  `oversight-ig`), which stay in B-107.
- **B-121 🟡 CODE DONE 2026-08-13 (`58dab0aa4`) — moved to Resend; now blocked ONLY on a secret.**
  🔴 **2026-08-16 — THIRD CONSECUTIVE MISS CONFIRMED (08-02, 08-09, 08-16), AND IT FAILED TWICE OVER.**
  `gh secret list` (2026-08-16) returns the same 7 secrets and **no `RESEND_API_KEY`**. Today's Sunday
  send produced nothing for **two independent reasons**: **(a)** the secret is still absent, and
  **(b)** **B-127 killed `score-rebake-weekly` at step 9, so step 11 `Notify-me` never ran at all.**
  🔑 **REFINED 2026-08-17 FROM THE ACTUAL LOG — the "both blockers" framing was too broad and is corrected
  here.** `weekly-digest` run **`31964140063`** (2026-08-16 18:00Z) is a **separate workflow** from the
  rebake's `Notify-me` step (`.github/workflows/weekly-digest.yml:28`, Sunday 18:00 UTC), it is **NOT
  blocked by B-127**, and it **ran to completion.** It resolved **`4 active subscriber(s)`** from
  MailerLite and printed `✅ Weekly digest sent: 0 delivered, 4 failed.` with each recipient annotated
  **`RESEND_API_KEY not set`**, then `❌ Every send failed — failing the job` and `exit 1`.
  🚨 **One of the four is a real third party — `jlougee24@live.com` — who has now missed three weekly
  digests.** ✅ **So: the secret ALONE turns the weekly digest back on.** ⚠️ **What B-127 still costs is
  content accuracy, not delivery: `public/data/weekly_changes.json` was last written 2026-08-09 by
  `247dd4c87`, so a digest sent today would carry 8-day-old change claims. Fix B-127 too — for the
  content, not to unblock the send.** ⚠️ **`Notify-me` (inside `score-rebake-weekly`, step 11) DOES need
  both.** ⚠️ **Report this as an ongoing outage with a miss count, not as a new countdown to the next
  Sunday; the countdown framing has now failed twice to produce action.**
  ✅ **Decision (b) executed.** Delivery moved off MailerLite campaigns to **Resend** behind a new
  `scripts/lib/send-email.mjs`; **MailerLite stays the list store** (signup was never broken).
  `send-weekly-digest.mjs` and `notify-newly-graded.mjs` both rewritten onto it, and
  `score-rebake-weekly.yml` now passes **`--apply`** — it had been running the notifier without it, so
  **notify-me had never sent a single email, ever.** 🔴 **NOTHING SENDS YET, for two reasons:**
  ① `send-email.mjs:72` short-circuits with `{ok:false, error:"RESEND_API_KEY not set"}` — **Aron must add
  `RESEND_API_KEY` to GitHub repo secrets**; ② the workflow changes are in the **unpushed** pile, so the
  live crons still run the old MailerLite code. **Next send fires Sunday 2026-08-16; a third miss makes it
  three weeks silent.** Original diagnosis kept below for the record:
  *(WS-B, S — retention/marketing impact, no grade impact)* `weekly-digest` failed
  2026-08-02T18:58Z (run `30762336788`) after **7 straight clean Sundays**; the error is a **422 from
  MailerLite: `"Content submission is only available on Premium plan."`** against `POST /campaigns` at
  `scripts/send-weekly-digest.mjs:150`. **Not a code regression — the script is unchanged; the account's
  plan entitlement changed underneath it** (trial ended or MailerLite re-tiered the API). **Blast radius is
  both outbound paths, because both build a campaign the same way:** the weekly subscriber digest, and
  **Tier-3 "Notify me when we grade this"** at `scripts/notify-newly-graded.mjs:307` (`emails[0].content`).
  Notify-me is silent only because it is DRY-RUN unless `--apply`. **Consequence:** the 08-02 digest did not
  send — first miss since launch — and the retention loop the diligence review credited is not actually
  deliverable today. **Decision Aron owns:** (a) upgrade the MailerLite plan, (b) move sends to Resend, which
  is already wired for transactional mail from the authenticated `trunorthapp.com` domain, or (c) accept the
  gap and pause both. **Recommendation: (b) for notify-me** — it is low-volume, per-brand, transactional in
  shape, and removes a plan dependency from the retention path — **and (a) only if the marketing digest is
  worth a monthly fee.** ⚠️ **Whatever is chosen, add a non-zero-exit guard so a send failure keeps opening
  the watchdog row rather than failing quietly on a weekly cadence** (this is bug-class (b) from B-100).
  ⏰ **STATUS 2026-08-04 (day 3, still undecided) — there is now a hard date.** Run history confirms
  **exactly one missed send**: `weekly-digest` is `success` on 07-05 · 07-12 · 07-19 · 07-26 and `failure`
  on 08-02 only. **The next scheduled send is Sunday 2026-08-09**, so whichever option is chosen has to be
  in place before then. **One skipped week is invisible to subscribers; two consecutive weeks is a
  newsletter that reads as abandoned** — that is the real cost of letting this slide another cycle.
  ⏰ **STATUS 2026-08-05 (day 4, still undecided) — 4 days left.** Re-checked the run history today: no new
  `weekly-digest` run since the 08-02 failure (last 5 scheduled runs = 08-02 `failure`, 07-26 · 07-19 ·
  07-12 · 07-05 all `success`), so the count is still **one** missed send and the deadline is unchanged.
  **This is a decision, not a task — nothing can be built until Aron picks (a), (b), or (c).**
- **B-122 🔴 NEW 2026-08-03 — `bis-entity-list-weekly` is down on an EXPIRED TLS CERT at the source.**
  *(WS-B, XS — **wait, don't code**; display/enrichment only, no grade impact)* Run `30783601658` (08-03
  04:09Z) exited 1 with **`CERT_HAS_EXPIRED`** fetching
  `https://api.trade.gov/static/consolidated_screening_list/consolidated.csv`
  (`scripts/bis-entity-list-fetch.mjs:42`). **Verified root cause, dated:** the `*.trade.gov` cert
  (`O=United States Dept.of Commerce`, issuer `Entrust OV TLS Issuing RSA CA 1`) has
  **`notAfter = Jul 28 10:56:42 2026 GMT`**. Run history matches exactly — **success 06-29 · 07-06 · 07-13 ·
  07-20 · 07-27, then failure 08-03**, i.e. five clean weeks, then the first run after the cert lapsed.
  ⚠️ **Contrast with B-103 (OFAC), and note the rule this sharpens:** the OFAC 403 was CI-only and cleared
  itself; **this one REPRODUCES off-runner** (`curl` from the Mac: `SSL certificate problem: certificate has
  expired`). **Reproducing off-runner is what separates "wait one cycle" from "the source really is
  broken."** Run the off-runner probe first, every time — it is 10 seconds and it decides the response.
  **Options:** (a) **wait one cycle** — Commerce renews and 08-10 goes green, cost zero; (b) switch to
  `https://data.trade.gov/consolidated_screening_list/v1/search`, which is healthy but returns **401 —
  requires a `api.data.gov` key**; (c) scrape `bis.doc.gov` (301s fine, but HTML, brittle).
  **Recommendation: (a) for one week, then (b).** ⚠️ **Do NOT "fix" this by disabling cert verification
  (`NODE_TLS_REJECT_UNAUTHORIZED=0` / `rejectUnauthorized:false`) — that trades a legible weekly red run
  for a silent MITM hole across every fetcher that shares the agent.** The fetcher failed **correctly**
  (hard-fail before write, last-good snapshot intact) — same good pattern as B-103.
  ⏳ **RE-PROBED 2026-08-04 — day 7, cert still NOT reissued.** `openssl s_client` against `api.trade.gov`
  from the Mac returns the identical cert, `notAfter = Jul 28 10:56:42 2026 GMT`; `curl` still refuses the
  connection. Commerce has now left a public data endpoint on an expired cert for a full week, which makes
  option (a) look weaker than it did on 08-03. **Consequence: the ~08-10 run is EXPECTED to fail — log it as
  confirmation, not as a new break.** **Escalation trigger is now a DATE, not a failure: if the cert is
  still expired after the 08-10 run, stop waiting and price out the `api.data.gov` key for (b).**
  🔬 **RE-PROBED 2026-08-05 — day 8, and the diagnosis is now finer-grained: the renewal is happening
  HOST-BY-HOST, and ours is simply not done yet.** Two probes from the Mac, same minute:
  `curl https://api.trade.gov/static/consolidated_screening_list/consolidated.csv` → **`certificate has
  expired`, `ssl_verify_result=10`** (verbose still shows `CN=*.trade.gov`, `notAfter = Jul 28 10:56:42 2026
  GMT`); `curl "https://data.trade.gov/consolidated_screening_list/v1/search?sources=EL"` → **`ssl_verify_result=0`,
  HTTP `401`.** **`data.trade.gov` has a VALID certificate again.** Two consequences worth acting on:
  **(1)** this is evidence Commerce is actively reissuing rather than ignoring the lapse, which strengthens
  option (a) — the 08-10 date trigger still stands, but "they've abandoned it" is now the less likely read;
  **(2)** option (b) is no longer theoretical — the fallback host is TLS-healthy today and the ONLY thing
  standing between us and it is a free `api.data.gov` key. ⚠️ **Probe the specific host, not the domain:**
  a `*.trade.gov` wildcard lapse does NOT expire uniformly across the hosts that serve it, so
  "trade.gov is fixed" is not a checkable claim — `api.trade.gov` is.
- **B-127 🔴 NEW 2026-08-16 — the weekly rebake is now HARD-BLOCKED on a stale `grade-snapshot.json`
  baseline, and it discards its own output every Sunday until someone re-baselines it.**
  *(WS-B, **S — this is a one-command fix and the highest-leverage item on the board**)*
  **What happened.** `score-rebake-weekly` run **`31959545104`** (2026-08-16T16:45Z) returned
  **`failure`** — the first failure in six weeks (08-09, 08-02, 07-26, 07-20, 07-19 all succeeded).
  It died at **step 9 of 11**, `node scripts/compute-weekly-changes.mjs --apply`:
  `[weekly-changes] snapshot disagrees with the committed index.json on 536/3060 brands
  (17.52% > 2%). The baseline is stale or was committed without its index — refusing to publish
  change claims from a poisoned baseline. Re-baseline the snapshot from the shipped catalog, then re-run.`
  **✅ This guard is CORRECT and must not be weakened.** It was added 2026-07-20 after a poisoned
  snapshot produced **60 false grade claims** (see the weekly-rebake-was-silently-dead entry). **Do not
  raise the 2% tolerance and do not skip the step** — the whole point is that it refuses to publish
  "what changed this week" claims it cannot substantiate.
  **Root cause, and the arithmetic closes exactly.** `public/data/_meta/grade-snapshot.json` is
  `takenAt 2026-08-09T17:00:25.665Z` and holds **3,060 entries** — the **pre-push** catalog — last
  written by the 08-09 rebake (`247dd4c87`). The 2026-08-14 push `c2c1216de` moved **542** brands and
  **nobody re-baselined the snapshot.** **542 moved − 6 newly graded (which by definition cannot appear
  in a 3,060-entry snapshot) = 536.** Re-ran the comparison locally and got **536 disagreements /
  3,060 entries, 0 missing — byte-identical to the CI message.**
  **The cost, which is the reason this is urgent.** The guard fires **before** step 10 `Commit + push`
  and step 11 `Notify-me`, so **both were skipped and the rebake threw away its own work.** The dry-run
  had already computed a catalog of **A 62 · B 708 · C 1,029 · D 538 · F 268 · "?" 10,225 = 2,605
  graded (+15 vs the live 2,590)**. None of it shipped, and none of it will ship on **any** future
  Sunday until the baseline is fixed. It also means the Sunday email had **no** newly-graded list to
  send even if `RESEND_API_KEY` existed (see B-121).
  **Fix.** Re-baseline `grade-snapshot.json` from the shipped `public/data/index.json`, commit it, and
  re-run the workflow via `workflow_dispatch` to confirm it gets past step 9. **Then generalize the
  lesson:** the snapshot must be re-baselined after **any** out-of-band catalog change — a hand-
  regenerated push silently arms this same failure a week later. Worth a follow-up assertion in
  `scripts/data-integrity.test.mjs` so a stale baseline fails CI at push time rather than on Sunday.

- **B-131 🔴 NEW 2026-08-19 — PostHog has recorded ZERO `company_view` events for 12 straight days.
  Either nobody is opening brand cards in the shipped app, or the client analytics transport is
  dead. A GREEN nightly cron is what surfaced it.**
  *(WS-A, S to diagnose — Aron can settle it in ~5 minutes; see "Blocking on Aron" ②)*
  **What happened.** `trending-refresh` run `32309351311` completed `success` on 2026-08-19 at
  22:33Z. Its log:
  `📊 Querying top 15 brands (last 7 days)…` →
  `(No company_view events in the lookback window — leaving trending.json alone.)`
  `public/data/trending.json` was last written **2026-08-07T22:48:29Z** by `ae9d88a41` and holds
  **exactly one brand — `rocket-lab`, `views: 1`, `uniques: 1`.** The cron has committed **58 times**
  in its life (`git log origin/main --grep='chore(trending)' | wc -l`) and **not once since 08-07**.
  Because the workflow only commits `if ! git diff --quiet public/data/trending.json`
  (`.github/workflows/trending-refresh.yml:47`), 12 nights of empty results produce 12 green runs,
  no commits, and no watchdog row.
  **The instrumentation is NOT mismatched — verify this before re-diagnosing.** `src/App.jsx:3252`
  emits `track("company_view", { slug, name, grade, graded, score, category })`;
  `scripts/refresh-trending.mjs:64` queries `WHERE event = 'company_view'`. **The names match**, and
  the PostHog query returned a result set rather than erroring, so the server-side read path works.
  **Two live hypotheses, both material:**
  ① **Genuinely zero brand-detail opens in 12 days.** The likeliest reading, and exactly what the
  standing "nobody has run the shipped app" gap predicts. If true this is a distribution problem,
  not a code problem, and it is the most important number on this board.
  ② **The client never sends the event.** A `track()` no-op, a consent/opt-out gate, or a missing
  client-side PostHog key in the shipped bundle. ⚠️ **`POSTHOG_API_KEY` in Actions is the SERVER
  read key and proves nothing about the client** — do not cite its presence as evidence the app is
  reporting.
  **Fix / next step.** Do NOT touch the fetcher or the UI first. **Install Build 81, open 5 brand
  cards, wait for the flush, then re-run `trending-refresh` via `workflow_dispatch`.** Events appear
  → hypothesis ①, and the work is adoption. Events do not appear → hypothesis ②, and the work is
  client instrumentation. **One run distinguishes them.**
  ✅ **DO NOT "fix" the stale one-brand `trending.json` as a UI bug.** `src/App.jsx:6170-6178`
  deliberately keeps the curated fallback (`Patagonia, Amazon, Costco, Tesla, Nike`) whenever fewer
  than 3 brands match, precisely so a low-signal day cannot ship a 1-chip row. **The guard is
  correct and users see nothing wrong. The defect is upstream of the display.**
  ⚠️ **Watchdog blind spot (extends B-105/#155):** a cron that legitimately commits only on change
  can go dead-quiet for weeks while reporting `success` and never appears on #155. **Judge
  `trending-refresh` by its commit series, not its run status** — same rule as B-124.

- **B-130 🔴 NEW 2026-08-18 — `nrc-weekly` commits a timestamp and nothing else, every week, and
  reports `success`. The scrape returns zero records; this is NOT the B-129 matcher defect.**
  *(WS-B, S — fix or retire the NRC fetcher; do NOT prescribe the B-129 alias fix here)*
  **What happened.** Run `32163102119` → `success`; commit `e765b7e7b` is **2 files, 7 changed lines.**
  `public/data/nrc-events.json` reports **`operator_count: 5`, `with_records_count: 0`**, and all five
  operators carry **empty `sample_events`, empty `sample_violations`, empty `top_action_types`**. The
  diff contains **only `generated_at` plus five `scraped_at` timestamps rolling forward** — verified by
  reading `git show e765b7e7b -- public/data/nrc-events.json`, not inferred. `public/data/_meta/nrc-merge-log.json`
  closes it: **`total_brands: 5 · merged_count: 0 · skipped_count: 5 · orphan_count: 0 · merged_brands: []`.**
  🔑 **Two facts separate this from B-129.** ① **The universe is 5 operators, not 528** — NRC was scoped
  to nuclear utilities only, so a low absolute number was always expected. ② **`orphan_count` is 0**,
  meaning *nothing failed to match* — **there was nothing to match, because the fetch produced no
  records at all.** ⚠️ **Therefore the alias/`brand-parent-map.json` fix prescribed for B-129 would
  change nothing here. The defect is upstream in the fetcher (or the NRC endpoint), and the job still
  exits 0 on an empty result — the same "green cron proves nothing" family as B-123/B-124/B-126,
  though with a different mechanism.**
  **Why it matters.** It is advertised to users at **`src/App.jsx:4918`** ("NRC Event Reports … event
  notification reports + enforcement actions per nuclear utility") as part of the "100 public-records
  sources" claim, while contributing literally nothing. It also burns a weekly commit that makes the
  data log look busier than it is.
  **Fix shape.** Run the NRC fetcher locally and see whether the endpoint returns records at all
  (**B-122's lesson: reproduce off-runner before rewriting any URL**). If it does, the parser is broken;
  if it does not, the source moved and the honest move is to retire it from the Sources screen. Either
  way **add a non-empty assertion so a zero-record fetch fails the job instead of committing a
  timestamp.**

- **B-129 🟡 NEW 2026-08-17, EXPANDED 2026-08-18 to SEVEN sources — weekly sources fetch real records
  and match almost no brands, while reporting success. The pipelines work; the brand-matching layer
  does not.**
  *(WS-B, M — fix the matcher/alias table, or stop advertising the source)*
  **What happened.** Read from the merge logs on `origin/main`, not from run statuses:
  **`ntsb-weekly` merged 0 of 528 brands** (`public/data/_meta/ntsb-merge-log.json`, 2026-08-17T17:31Z —
  `merged_count: 0 · skipped_count: 528 · orphan_count: 0 · error_count: 0`) while committing a
  **1,058-line refresh** of `public/data/ntsb-accidents.json`. **The 2026-08-10 log is identical, so this
  is structural, not a bad week.** **`cisa-kev` merged 2 vendors and orphaned 238 of 276 (86%).**
  **`msha` merged 70/528. `phmsa` merged 30/528.**
  **🆕 Three more found 2026-08-18 — the banking/finance weeklies are the same defect.**
  **`fdic` merged 0 of 528** (`merged_partial_count: 38 · skipped: 483 · orphan: 7`, 2026-08-18T10:28Z) —
  **and the 08-11 log is identical (`merged 0 · partial 38`), so structural here too.**
  **`occ` merged 14 of 528** (skipped 511, orphan 3). **`finra` merged 93 of 528** (skipped 421,
  orphan 14) — **the best rate of any B-129 source and still under 18%.**
  ⚠️ **`fdic` needs BOTH counters read.** `merged_count: 0` alongside `merged_partial_count: 38` means
  38 files *were* written, via a partial path, under `enriched.fdic`. **Judging `fdic` on `merged_count`
  alone reads as a total failure when it is not.** No other B-129 source emits a `partial` counter.
  **Running list (merged / attempted):** `ntsb` 0/528 · `fdic` 0/528 (+38 partial) · `occ` 14/528 ·
  `phmsa` 30/528 · `msha` 70/528 · `finra` 93/528 · `cisa-kev` 2 vendors, 238/276 orphaned.
  **Why it matters.** All are advertised to users on the app's Sources screen —
  `src/App.jsx:4917` (PHMSA), `:4925` (MSHA), `:4971` (NTSB), `:4884` (FINRA), `:4881` (OCC), plus
  NHTSA at `:4897` — as part of the "100 public-records sources" claim, while contributing essentially
  nothing to any brand record. On a product whose entire pitch is checkability, an advertised source
  that resolves to zero brands is a credibility exposure, not just wasted compute.
  ⚠️ **This is NOT a silent-failure bug — keep it separate from B-123/B-124.** The fetch succeeds, the
  merge runs, the commit lands. The defect is that operator/vendor names in these federal datasets
  (mine operators, pipeline operators, NTSB parties, CVE vendors, bank charters, broker-dealers) do not
  resolve to catalog slugs.
  ⚠️ **Keep B-130 (`nrc`) OUT of this item.** NRC reports `orphan_count: 0` on a 5-operator universe
  with zero fetched records — nothing failed to match, so the alias fix below does not apply to it.
  **Fix shape.** Sample 20 unmatched `orphan` names per source and check whether the miss is a missing
  alias (fixable via `brand-parent-map.json`, the V-1 machinery) or a genuine non-consumer entity
  (in which case the honest move is to drop the source from the Sources screen). **Decide per source —
  NTSB at 0/528 is the one most likely to be genuinely inapplicable to a consumer-brand catalog, and
  FINRA/OCC/FDIC are the most likely to be fixable, since bank and broker-dealer names map cleanly onto
  catalog slugs the app already carries.**
  ⚠️ **Related but distinct: matching more brands into a key that no consumer of the data reads changes
  nothing on its own. `phmsa` (30 files), `finra` (92) and `occ` (14) all write TOP-LEVEL keys that
  neither `rebake-scoring.mjs` nor `index-entry.mjs` reads — see V-4.**

- **B-128 🟡 NEW 2026-08-16 — two JSON serializers are fighting over `public/data/companies/`, which
  causes unmergeable whole-file conflicts (the likely upstream driver of B-124) and unreadable diffs.**
  *(WS-B, M — pick one format and enforce it in the writers)*
  **What happened.** The cron merge scripts write per-company JSON as a **single line**; the local
  rebake/regeneration path writes it **pretty-printed**. The 2026-08-14 push `c2c1216de` prettified
  files (`anheuser-busch.json` went to **955 newlines**), and **today's crons converted 326 of them
  straight back to single-line.** Current split: **387 single-line / 12,443 pretty-printed** out of
  12,830. Files flip format based on which script touched them last.
  **Why it matters — three concrete harms, in order of severity:**
  **(1) It makes merges impossible, and it is the likely cause of B-124's conflicts.** A single-line
  JSON file has exactly one line, so **every** edit rewrites it and git cannot ever auto-merge two
  concurrent changes. **All 5 files that conflicted in today's lost `news-rss-nightly` run
  (`anheuser-busch`, `coca-cola`, `heinz`, `hershey`, `pepsi`) were single-line.** Pretty-printed JSON
  would very likely have merged cleanly, since same-day crons write **different keys** (`cpsc`, `doj`,
  `litigation_courtlistener`, `news`) on different lines. ⚠️ Stated as the strong hypothesis it is:
  the format is confirmed, the counterfactual merge is not tested.
  **(2) It makes the B-101 PR queue unreviewable.** Standing policy is "drain by hand, never in bulk,
  never on the title" — but a single-line file's diff renders as one changed line, so a reviewer
  cannot see what a bot PR actually did. That policy exists precisely because #134 and #165 are
  landmines, and this format defeats the review that catches them.
  **(3) It produces alarming phantom diffs.** Today's 9 bot commits showed **188,747 deletions**, which
  is **pure reformatting** — verified by parsing `amazon`/`walmart`/`starbucks`/`microsoft` before vs
  after: key counts identical (59/60/61/60), `overall` unchanged (amazon 39.2), and the only differing
  keys were exactly the ones today's crons refresh, at essentially unchanged byte sizes. **No data was
  lost.** But a future real deletion is now camouflaged in the same noise.
  **Fix.** Decide one serialization for `public/data/companies/*.json` and make every writer use it.
  **Recommend pretty-printed (`JSON.stringify(obj, null, 2)`)** — mergeability and reviewability are
  worth far more than the bytes, and the CDN payload that users actually download is `index.json` /
  `search-index.json`, not the per-company files. Then normalize all 12,830 files once so the repo
  stops oscillating. ⚠️ **That normalization pass will itself produce an enormous one-time diff and
  must not be run on the same day as anything grade-moving.**

- **B-126 🔴 NEW 2026-08-12 — a soft-failing fetcher opened a PR that would publish SYNTHETIC safety data
  under a `.gov` source URL (PR #165), and the same soft-fail quietly cleared the workflow off the
  watchdog.** *(WS-B, S — close the PR; M if the merge script gets the guard)*
  **What happened.** `fmcsa-sms-monthly` ran 2026-08-12 08:00 and recorded its **first success ever**
  (07-12 and 06-12 both failed). It did not recover — its log reads
  `Pass/Property: endpoint redirected to an FMCSA error page (https://ai.fmcsa.dot.gov/SMS/error.html)
  … keeping last-known-good snapshot data/raw/fmcsa-sms/2026-06.json — not overwriting, exiting 0.`
  That is the **`--keep-last-on-fail` hardening from PR #144 working as designed**; the FMCSA bulk
  endpoint is as dead as it was in June (real restore is still **B-69**, a Socrata rewrite, Aron's call).
  **Two distinct problems fall out of one green run:**
  **(1) The PR ships fiction.** The merge step still ran against the synthetic fixture and opened
  **PR #165 "data(fmcsa-sms): monthly carrier safety refresh"** — one file,
  `data/derived/fmcsa-sms-augment.json` (+38/−6). The file self-declares
  **`"sourceKind": "synthetic"`, `"snapshotDate": "2026-06"`**, and the diff adds invented safety scores
  under fabricated DOT numbers (`900002`, `900006`, `900007`) — a full **Knight-Swift** record
  (unsafeDriving 52, hoursOfService 47, fleetSize 9800, "KNIGHT TRANSPORTATION INC", Phoenix AZ) — plus
  a `ups` → `united-parcel-service` slug rename, every entry stamped
  `sourceUrl: https://ai.fmcsa.dot.gov/SMS/Carrier/…`. **The title says "refresh." The payload is
  made up, and it is attributed to a federal safety database.**
  ✅ **No live exposure, verified not assumed:** `grep -rl 'fmcsaSafetyScores' public/data/` returns
  **0 files**, and the augment's only consumer is its own producer, `scripts/fmcsa-sms-merge.mjs`.
  Nothing synthetic has reached the shipped catalog. **This is C-1/C-2-class harm caught before
  publication rather than after.**
  **(2) The watchdog got quieter while nothing improved.** Issue **#155 dropped 37 → 36 rows** on 08-12,
  and this is the only row that left. 🚨 **A soft-fail removes a broken pipeline from the watchdog.**
  Keep the three silent modes straight: **B-123** exits 1 and never commits · **B-124** commits then
  fails to push and exits 0 · **soft-fail** succeeds honestly and ships nothing by design.
  **Standing rule: a row leaving #155 is not evidence of a fix — confirm a `data(<name>)` commit or a
  PR carrying real data followed.**
  **Fix.** Close **PR #165**. Then gate the merge step so it refuses to emit an augment when the
  snapshot it read is `sourceKind: "synthetic"` (or when the fetch soft-failed) — a soft-fail should
  keep the last-known-good augment too, not regenerate one from the fixture. Also worth a sweep:
  any other fetcher carrying `--keep-last-on-fail` that still runs its merge unconditionally.
- **B-125 🔴 CONFIRMED RECURRING 2026-08-17 — third consecutive Monday, same three crons, same step.**
  The Monday weeklies ran again today and all three were killed inside the **fetch** step with every
  later step skipped: **`faa-weekly` `32018127077` — 1,815s** · **`fra-weekly` `32025687480` — 1,816s** ·
  **`gdelt-weekly` `32027864201` — 5,416s.** Each is within ~16s of its configured `timeout-minutes`.
  **Kill dates: 08-03, 08-10, 08-17.** ⚠️ **This item is no longer "awaiting evidence" — it is a proven
  weekly-recurring failure with three clean data points, and every Monday it stays open is another week
  of FAA, FRA and GDELT data never collected.** 🔑 **`faa-weekly`'s single lifetime success finished with
  37s of margin, so raising the cap at `.github/workflows/faa-weekly.yml:25` remains the calibrated
  one-line fix.** ⚠️ **`fra-weekly` and `gdelt-weekly` have never succeeded once — for those, a higher cap
  is a guess, not a calibrated fix; profile the fetch before changing the number.**

- **B-125 🔬 NEW 2026-08-11 — the residual `timeout-minutes` kills are PROVEN, and `faa-weekly` has a
  calibrated one-line fix while `fra`/`gdelt` have never once completed.** *(WS-B, S for `faa` / M for the
  other two; no grade impact until they first succeed — then see [[data-crons-can-move-grades]])*
  **THE EVIDENCE (from the 2026-08-10 weekly runs — the first time all three ran on a day this sync looked):**
  all three were cancelled at their exact configured limit, inside the **fetch** step, every later step skipped —
  `faa-weekly` run `31380090344` **30m13s** vs `timeout-minutes: 30` (`Run FAA fetcher`);
  `fra-weekly` run `31385689066` **30m15s** vs `30` (`Run FRA fetcher`);
  `gdelt-weekly` run `31388693714` **90m15s** vs `90` (`Fetch GDELT brand digests`).
  **Three different limits, three kills within ~15s of the limit — this is definitively a timeout kill.**
  ✅ **It is NOT B-124 (push contention), NOT B-123 (`git add` on an ignored path), and NOT the overlap B-120
  destaggered** — they run 09:22 / 11:07 / 11:54 UTC and never collide with each other.
  🚨 **TRIAGE SPLIT — these are two different problems, do not fix them as one:**
  - **`faa-weekly` = a REGRESSION with a measured margin, and the cheapest real fix on the cron board.**
    Exactly **one success in its whole history: 2026-06-08, `18:09:01Z → 18:38:24Z` = 29m23s against a
    30-minute limit — it passed with 37 seconds to spare.** All **9** runs since (06-15 → 08-10) cancelled.
    **The job has always taken ~30 minutes; the limit was simply set too tight.** Raise `timeout-minutes`
    (`.github/workflows/faa-weekly.yml:25`) and re-run — it is the only one of the three with a green
    baseline to calibrate against.
  - **`fra-weekly` and `gdelt-weekly` have NEVER SUCCEEDED — 0% lifetime.** `fra`: 10 runs, all cancelled
    (06-08 → 08-10). `gdelt`: 11 runs, all cancelled (06-03 dispatch → 08-10). ⚠️ **This CORRECTS the
    standing claim that all three "have green history" — only `faa` does, and only once.** They join
    `tosdr-monthly` + `au-fair-work-monthly` as **never-commissioned fetchers (B-107 triage) — the roster is
    now 4, not 2.** No last-good run to bisect and no snapshot ever shipped, so **a timeout bump here is a
    guess, not a fix: profile the fetcher locally first** (`gdelt` already has 90 minutes and still dies).
- **B-124 🔴🔴 NEW 2026-08-10 · ⬆️ ESCALATED 2026-08-12 — the shared push retry loop in 117 workflows is BOTH
  unrecoverable AND silent: a cron can fetch, commit, fail to push, discard everything, and REPORT SUCCESS.**
  ⭐⭐ **Highest-severity infrastructure item open — it invalidates "the cron is green" as evidence anywhere
  in this repo.** *(WS-B, S — a 2-line change per workflow, but it touches 117 files; no grade impact by itself)*
  🔴🔴 **2026-08-16 — RECURRED A THIRD TIME, AND THE ENTIRE MECHANISM IS NOW ON TAPE IN ONE LOG.**
  `news-rss-nightly` run **`31928275753`** reported **`success`**, and **no `data(news)` commit exists on
  `origin/main` for 08-16** — breaking the 08-10→08-15 six-day streak (`ofac-sdn` landed that day; `news`
  did not). The log walks every step of the predicted failure: commit **`7f57f64`** created locally
  (**13 files, 20,263 insertions**, including `public/data/news/2026-08-16.json` and
  `2026-08-16.extracted.json`) → `git pull --rebase origin main` → **`CONFLICT (content)` on 5 per-company
  files** (`anheuser-busch`, `coca-cola`, `heinz`, `hershey`, `pepsi`) → `Push attempt 1 failed` →
  **attempts 2 and 3 both die on `error: Pulling is not possible because you have unmerged files.`**
  because **no workflow runs `git rebase --abort`** → the loop's last command is `sleep 5` with no
  post-check → **the job exits 0.** **Lost nights are now 08-02, 08-09, 08-16 — 3 in 15 days.**
  🆕 **The conflicts themselves now have a named cause: all 5 conflicted files were single-line JSON,
  which cannot auto-merge. See B-128 — fixing the serialization may remove most of the trigger, but it
  does NOT fix this item; the loop is still unrecoverable and still lies about its exit status.**
  ⚠️ **The 08-15 note "the daily pair has landed 6 days straight — B-124 has not recurred" is superseded.
  A streak of green nights has never closed this item and cannot: it is a race that needs a concurrent
  push to fire, so it will look healthy most days.**
  🔴 **2026-08-12 — CONFIRMED RECURRING, 2 misses in 11 nights. The 08-11 "provably a one-off" note is
  RETRACTED.** That call was made from a query window starting 08-05. The full `data(news)` series has
  **two** gaps — **08-02 and 08-09**. Run **`30737556200`** (2026-08-02) reproduces the signature exactly:
  it printed `[main b341985] data(news): nightly RSS digest … 2026-08-02 [skip ci]`, then
  `Push attempt 1 failed` → `error: Pulling is not possible because you have unmerged files.` → attempts
  2 and 3 died identically → **GitHub lists the run `success`.** ⚠️ **Method rule: "the only gap" is a
  statement about your query window, not about the data — pull the full series before writing "only."**
  **This is now an observed recurring data-loss bug at roughly an 18% nightly loss rate on one workflow,
  with the same loop in all 117. Treat the fix as scheduled work, not a nice-to-have.**
  **What happens:** every data cron ends with the same block —
  `for i in 1 2 3; do git pull --rebase origin main && git push origin main && break;`
  `echo "Push attempt $i failed, retrying…"; sleep 5; done`
  **Defect 1 — the retries cannot work.** A conflicting `git pull --rebase` leaves the repo mid-rebase with
  unmerged files, and **no workflow calls `git rebase --abort`** (verified: `grep -l 'rebase --abort'
  .github/workflows/*.yml` → **0 of 117**). Attempts 2 and 3 then fail instantly with *"Pulling is not
  possible because you have unmerged files"* / *"fatal: Exiting because of an unresolved conflict"*.
  **"3 retries" is really 1 try.**
  **Defect 2 — the failure is invisible.** The loop's final command is `sleep 5` (exit 0) and **nothing
  checks afterwards whether the push happened**, so the step, job and workflow all exit **0** and GitHub
  marks the run **green**.
  🔬 **Confirmed live — `news-rss-nightly` run `31296988521` (2026-08-09T05:34Z):** 22m50s of RSS + AI
  extraction, a successful commit (`[main bb945f1] data(news): … 2026-08-09 [skip ci]`), 3 failed push
  attempts, **and the run is listed as `success`.** There is **no `data(news)` commit for 08-09 on
  `origin/main`** — a whole night's work was built and thrown away. Trigger was genuine concurrency:
  news-rss (05:34–05:57Z) overlapped the `cfpb`/`courtlistener`/`cpsc`/`cruelty-free` pushes. ✅ **This is
  the first REAL push-contention evidence in the repo** — B-120's 3 suspected rows turned out to be B-123.
  🚨 **Consequence, and the reason this outranks B-123: issue #155 and `cron-health-daily` list only
  NON-SUCCESS runs, so they are structurally blind to B-124. True breakage is strictly larger than the 37
  rows shown. To confirm a data cron actually landed, check for its commit
  (`git log origin/main --grep='data(<name>)'`), never the run status.**
  ⚠️ **Do not confuse with B-123 — the last 4 log lines look identical, the fixes are opposite:** B-123 =
  4 workflows, **exits 1**, log says *"paths are ignored"*, **commit never happens**; B-124 = 117 workflows,
  **exits 0**, log **prints a successful `[main <sha>]` commit** and then fails to push.
  **Fix:** `git rebase --abort || true` before each retry, plus a post-loop check that exits non-zero when
  all 3 attempts fail (so #155 can finally see it).
  **Open question worth scoping next:** how many past "green" runs silently lost data — this has been latent
  in all 117 workflows for as long as the loop has existed.

- **B-123 🔴 NEW 2026-08-05 — 4 crons `git add` a path that `.gitignore` ignores, so they fetch real data and
  then discard 100% of it. Broken since 2026-06-11. ⭐ Best effort-to-value ratio open in the repo.**
  *(WS-B, XS — one line per file; display/enrichment data, **grade impact unknown until it actually lands**)*
  **What happens:** commit **`f356963c2` (2026-06-11, "fix(infra): C1+C2 — untrack 398MB pipeline `_cache`
  from git/Vercel")** added **`public/data/_cache/` at `.gitignore:90`**. Four workflows were never updated
  and still name a path underneath it in their staging step:
  `sec-8k-events-monthly.yml:52` · `sec-def14a-annual.yml:53` · `usaspending-quarterly.yml:45` ·
  `ca100-annual.yml:59`.
  ✅ **SCOPE RE-VERIFIED 2026-08-07 — it is exactly these 4, and the sweep is worth recording so nobody
  re-does it.** Nine workflows mention `_cache`; only five `git add` it; and two of those five —
  **`health-signals-monthly.yml:48` and `privacy-policy-quarterly.yml:50`** — already append **`|| true`**
  and are therefore immune. **Do not "fix" those two under B-123** (their failures are `timeout-minutes`
  kills, a different bug, tracked in B-107). Also confirmed: `public/data/_raw/` and `public/data/_meta/`
  are **not** gitignored, so `bcorp-quarterly` and `epa-emissions-annual` stage fine. **Net: 4 victims,
  and the repo already contains two working examples of the fix.**
  `git add` on an ignored path prints *"The following paths are ignored by one of your
  .gitignore files"* and **exits 1**; the step declares `shell: /usr/bin/bash -e`, so it aborts **before
  `git commit`** — and therefore before the `git pull --rebase && git push` retry loop ever runs.
  ⚠️ **Why this was misread for two months:** the last log lines are `Push attempt $i failed, retrying...`
  and `##[error]Process completed with exit code 1`, which reads exactly like push contention. It is not.
  **The `git add` failure is 4 lines above it and is the actual cause.** B-120 hypothesized these 3 were
  push races that the destagger would self-heal; **today's `sec-8k` run is the test B-120 asked for, and the
  answer is no — this closes that open question.**
  **Confirmed from three independent run logs (not inferred from the pattern):**
  · `sec-8k-events-monthly` run `31047921114` (2026-08-05) — `Wrote data/raw/sec-8k-events/2026-08-05.json
  (1913 records, 1231 with events)`, augment `1000 matched, 0 orphans`, `Apply: wrote 1000 company files` →
  **discarded**;
  · `sec-def14a-annual` run `29096286080` (2026-07-10) — `2982 records, 1606 usable`, `1606 matched` →
  **discarded**;
  · `usaspending-quarterly` run `28522036511` (2026-07-01) — wrote `usaspending-contracts.json` + 49 brand
  records → **discarded**.
  **`ca100-annual` is the latent fourth:** its only recent run (`27102693929`, 2026-06-07, `workflow_dispatch`)
  **succeeded and committed `public/data/_cache/ca100/2026/*` — because it predates the ignore rule by 4 days.**
  It has not run since, so it is not on issue #155; it will fail the moment it next runs on schedule.
  **Fix:** drop the `_cache` argument from the `git add` line (the cache is deliberately untracked — that was
  the whole point of `f356963c2`), or append `|| true`. **`health-signals-monthly.yml:48` already has
  `|| true` on the same shape and is immune** — so the safe pattern already exists in-repo; these 4 just
  missed it. **Impact:** clears **3 of the 37 rows** on issue #155 plus one latent, and restores monthly SEC
  8-K material events (1,000 companies), annual DEF 14A pay ratios (1,606 usable), and quarterly federal
  contract data. ⚠️ **Land it deliberately, not casually: the first successful run of each ships ~8 weeks of
  withheld data at once. `sec-def14a` feeds execPay and `sec-8k` feeds ~1,000 company files, so this CAN move
  grades at the next rebake — show the diff first (rule #16).** Do NOT bundle with the B-115 push.
- **B-107 — triage the hard-FAILURE crons.** *(WS-B, L — ⭐ **now the highest-value open ops item**, and with
  B-105 shipped it has a trustworthy live list: **read the body of issue #155**, which the watchdog rewrites
  every day.)*
  🔍 **2026-08-07 — the `timeout-minutes` sub-class has two members that were never working at all, and
  that changes how to fix them.** `tosdr-monthly` and `au-fair-work-monthly` each have **exactly 2 runs in
  their entire GitHub Actions history, and BOTH were cancelled** (`tosdr`: 2026-07-06, 2026-08-07;
  `au-fair-work`: 2026-07-04, 2026-08-04). **A 0% lifetime success rate is a different problem from a
  regression:** there is no last-good run to bisect against, no snapshot either fetcher has ever shipped,
  and nothing on disk from them to compare a fix to. Treat them as **never-commissioned pipelines** —
  the question is "did this fetcher ever work?", not "what broke it?" — and expect the fix to be a real
  fetcher/runtime problem rather than a timeout bump. They are separable from `faa`/`fra`/`gdelt`, which
  DO have green history behind them.
  ✅ **PRE-TRIAGE DONE 2026-08-02 — the "re-read #155 after one full cycle" instruction has been carried out,
  and the list did NOT shrink the way it was expected to.** The 08-02T14:42Z rewrite shows **34 rows: 17
  hard failures + 18 cancelled** (one row counts in both buckets by wording). So the hard-failure count went
  **15 → 17, up not down** — the destagger removed bunching but new individual sources broke. **Fresh
  failures dated 08-01/08-02 that were NOT in the original 15:** `eu-sanctions-monthly` (08-02),
  `usda-aphis-monthly` (08-02, animals), `stanford-scac-monthly` (08-01), plus re-confirmations of
  `dol-ofccp`, `eu-antitrust`, `eu-enforcement`, `followthemoney-state`.
  ⚠️ **RE-READ 2026-08-03 — the trend is the wrong direction and this is now urgent. #155 is 34 → 37 rows
  (20 hard failures + 17 cancelled); hard failures have risen 15 → 17 → 20 on three consecutive days.**
  Three new 08-03 rows: **`bis-entity-list-weekly`** (expired source cert → its own item, **B-122**),
  **`fcc-weekly`** (`TypeError: fetch failed` / `read ETIMEDOUT`), **`fsis-dw-weekly`** (`HTTP 403`, same
  403 wall as `fsis-weekly` — treat the two FSIS crons as ONE fix). **08-03 ran 21 scheduled jobs: 14
  success · 4 failure · 3 cancelled (67% healthy), down from 80% on 08-02.**
  ⚠️ **New watchdog caveat discovered today — the health list UNDERSTATES intermittent breakage.**
  `fcc-weekly` has failed **4 of its last 6 runs** (07-06, 07-13, 07-20, 08-03) yet was absent from #155
  yesterday, because 07-27 succeeded and the watchdog reports only each workflow's **latest** run.
  **A flaky cron disappears from the list on any lucky week — so #155 is a floor on breakage, not a
  ceiling.** When triaging, check run HISTORY per workflow, not just the current row.
  **Add a 4th sub-class to the
  categories below: the non-bunched post-destagger CANCELLATIONS** — `openstates-monthly`, `gao-monthly`,
  `oversight-ig-monthly`, **plus `faa-weekly`, `fra-weekly` and `gdelt-weekly`, all cancelled again on 08-03
  at 12:39 / 13:47 / 14:04 UTC — hours apart and unbunched, on the second post-destagger day** — which are
  almost certainly real `timeout-minutes` kills and should be triaged by
  raising or splitting their caps, NOT by touching concurrency.
  ⚠️ **2026-08-04/06 ADDITIONS to that 4th sub-class — two monthly crons are now 2-for-2 cancelled on their
  last two runs, which makes them standing timeout suspects rather than stale rows:** `au-fair-work-monthly`
  (07-04 + 08-04) and **`tosdr-monthly` (07-06 + 2026-08-07T01:04Z, added today)**. Both fired alone, hours
  from anything else — concurrency cannot explain either. **Triage them with the `faa`/`fra`/`gdelt` group by
  raising or splitting `timeout-minutes`.**
  🚫 **Ignore the `canada-comp-monthly` row permanently** (B-108 deleted the workflow; the watchdog reports
  last-known runs so the row never ages out). ✅ **Re-verified 2026-08-06 by diffing all 37 rows against
  `.github/workflows/`: this is the ONLY row with no workflow file, and the mechanism is confirmed —
  `cron-health-daily` groups by `.workflowName` from `gh run list` history, not by workflow file.
  So the honest number is 37 rows = 36 real + 1 permanent phantom.** The live replacement,
  `canada-competition-bureau-monthly`, **succeeded 2026-08-06 and shipped data (`5286b5715`)**.
  Categorized 2026-08-01: **12 fail at their FETCH step** — each a unique dead/moved live source, individual
  triage: `fmcsa-sms` (→Socrata, already B-69), `canada-comp`, `dol-ofccp` (labor), `eu-antitrust`,
  `eu-enforcement` (GDPR tracker), `fsis`+`fsis-dw` (recalls), `usda-aphis` (animals), `wikirate`,
  `dime-augment`, `forest500`, `followthemoney-state`. **3 fail at COMMIT+PUSH** — `sec-8k`, `sec-def14a`
  (execPay source for B-115/117), `usaspending` — ❌ **the "OLD shared-concurrency rebase contention"
  diagnosis on this line is now DISPROVEN — do not act on it. B-123 (2026-08-05) proved from three run logs
  that all three die on `git add` hitting a `.gitignore`d `public/data/_cache/` path, before `git commit`
  ever runs. Re-confirmed in the `sec-8k-events-monthly` log 2026-08-06. Fix them under B-123 (one line
  each), not here.** Sequence the fetch-failures by
  coverage value (sec/dol/labor first); several may be genuinely dead sources → honestly degrade the in-app
  "live" claim rather than fake data. **Impact:** restores coverage-critical gov sources + closes the
  over-claim the diligence review flagged.
- **B-108 ✅ DONE — retire the duplicate Canada Competition Bureau pipeline** (two crons, two fetchers). *(WS-B, S)*
  **Impact:** one less maintenance surface for a solo founder.
- **B-118 — build the one-workflow source-discovery MVP + separate source-value model.** *(WS-B, L)*
  `source-discovery-weekly.yml` → one ranked GitHub issue; `scripts/source-value-score.mjs` scores sources
  0–100 on coverage-lift 0.30 / category-need 0.25 (inverse coverage, self-steers to DEI 11%) / license 0.20
  (gov=1.0, CC-BY-NC hard-block) / freshness 0.15 / solo-maintenance 0.10 — MUST NOT touch frozen thresholds.
  **Impact:** answers "what source next?" with data; the pipeline moves nothing, only human-approved wire-ins.

### Batch 3 — repeat-usage (client display, no grades)

- **B-109 — surface "?"→grade transitions for SAVED brands** (the event that actually fires as coverage grows;
  App.jsx:5898 currently EXCLUDES `?`→grade). *(WS-D, S)*
- **B-110 — fulfill the notify-me promise IN-APP** (reconcile `tn_pendingSubmits` vs index.json: "You asked
  about Trader Joe's — it's now graded B"). *(WS-D, S)* Closes the loop the email path can't; no backend.
- **B-111 — catalog-level "N brands graded this week" Today card.** *(WS-D, S)* Cheap proof-of-concept for the
  marquee; something true + new for every returning user even when their basket didn't move.
- **B-112 — ⭐ MARQUEE: full personalized "Newly Graded" return engine.** *(WS-D, L, **REQUIRES DECISION**, no
  grades)* Flip the weekly-return mechanic from grade-CHANGES (weekly_changes.json = 0, fires ~never) to
  newly-GRADED (fires constantly as coverage grows 3,054→7–8k). Client-side diff of index.json vs a stored
  snapshot; no push, no accounts, no rebake. **Makes the coverage workstream visible to users so both goals
  compound.** Ship B-111 first as proof, then this. Do NOT build until Aron approves.

### Batch 4 — coverage conversions (MOVE GRADES → rule #16, show drift before commit)

- **B-113 ✅ DONE — normalize the `very_poor` underscore enum + rebake.** *(WS-A, S, grades)* Data stores `very_poor`,
  scorer matches `very poor` (rebake-scoring.mjs:301/332/348/354) → Chanel/Prada/PetroChina/Pioneer/TD
  Ameritrade fall to "?" instead of earned D/F. **~5–6 convert; 16 already-graded carry underscored enums and
  WILL shift — show the drift diff.** Cheapest real coverage fix.
- **B-114 — parent-map inheritance for absent everyday brands + fix 10 broken redirects.** *(WS-C, S, grades)*
  ~8–30 high-recognition pages (Oreo, Cheerios, Pampers/Tide, Uniqlo, Temu) inherit an already-graded parent
  with "Via parent company" attribution. Honor the collision guard (distinct SEC filers don't inherit).
- **B-117 — backfill SEC CEO-to-worker pay ratio → sc.execPay.** *(WS-A, M, grades, no decision — ⚠️ **partly
  overtaken by B-115**, which already rescued the ~15 brands whose disclosed ratio sat unread in
  `enriched.execPay.payRatio`. What remains is the true backfill: pulling ratios for brands that have **no**
  ratio on disk. **Blocked in practice by `sec-def14a-annual`, whose latest scheduled run is a FAILURE
  (2026-07-10) — that cron is this item's source. Fix it under B-107 first.**)* Highest-
  credibility automated lever (SEC, exact CIK). Never fabricate the ratio where the exemption means it doesn't
  exist. Low-hundreds of brands.
- **B-115 ✅ DONE 2026-08-02 (`3bdae9815`, supersedes `a8ba45a7c`) — ⚠️ COMMITTED BUT NOT PUSHED; live site
  still scores the old execPay.** *(WS-A, M, grades, decision RESOLVED — Aron chose **option 2, strict
  penalize-only** after seeing the first pass's 248-move drift)* `execPay` → **"Pay & Tax"**, reworked to
  provably **MONOTONIC-DOWN**: `taxAvoidanceScore()` reads the **ITEP** federal rate (`0%→8 · 5%→20 · 10%→36 ·
  ≥15%→50 cap`; losses → `null`; `zeroTaxYears≥2 → 8` **only when avg is also sub-median**; GAAP/`secTax`
  excluded). `payTaxScore()` scores pay at the **exact pre-B-115 baseline** and applies tax **penalty-only**
  (compliant 50 contributes nothing; penalty averages in min-capped ≤ baseline; a NEW signal fires only on
  clear avoidance `<SEVERE_NEG`). **The enriched SEC pay ratio was CUT** (disagrees w/ legacy → data
  artifact; would inflate ~90 brands to B off a lone ratio). App.jsx reads baked `csc.execPay` → scorers stay
  in sync, no runtime edit. **Measured drift (from `index.json`): graded 3,059 → 3,065 (+6 new-D), 0 up / 38
  down / 6 new — 100% tax avoiders** (Duke/Dominion/Southern/AEP/FirstEnergy/Kinder Morgan/Eversource/Exelon/
  NRG/CMS/DTE/Atmos/Xcel/Williams/ONEOK + AECOM/Ally/Cadence); A untouched; 28/28 tests. ⚠️ **"up to 927"
  was wrong — real = 44 moves (~20× hot).** 🚨 **Remaining action is Aron's: pull --rebase, resolve the
  bundle files by re-running the rebake, verify the +6/38-down/0-up tax set, and push. That push is the deploy.**
- **B-116 — ⚠️ wire dark `enriched.environment` (EPA TRI/GHGRP) into environment scoring.** *(WS-B, M, grades,
  **REQUIRES DECISION** — now the ONLY open Batch-4 decision gate, and the natural next move after B-115)* Up
  to **393 graded brands** (coverage 26%); public-domain, no license risk. Needs the toxic-release
  revenue-normalization methodology decision. ⚠️ **Discount the "393" before planning around it:** the
  identically-derived "927" on B-115 turned out to be **140**. Measure the real `csc.environment` delta on a
  dry rebake before committing to scope. **B-115 is the template to copy** — penalize-only where the "good"
  end is just compliance, `null` (not a bad grade) where the signal legitimately doesn't apply, and drift
  shown against `index.json` before commit.
- **B-119 — run gov-record pipelines (DOL WHD / EPA ECHO / OSHA / NLRB / IRS-990) against the 3,708 public-CIK
  ungraded brands.** *(WS-A, L, grades, no decision)* **The strategic ceiling — how graded coverage moves
  3,054 → 7–8k without touching thresholds.** Gov primaries = highest credibility. High maintenance: sequence
  ONE pipeline at a time, verify each name-match before attaching.



## 🧪 v1.2 REVIEW PUNCH LIST — 27-agent multi-lens review (2026-07-20)

> **Source:** 13-lens review (UX ×6, UI/a11y ×3, code ×3, Android ×1) → adversarial verify per lens → synthesis.
> **155 findings survived verification; 131 dropped as dupes/noise.** Every item below cites real code.
> **Headline:** the single highest-value fix was one line in a cron — `score-rebake-weekly.yml` never staged
> `index.json`, so **5 weeks of grade movement, the entire Sunday digest, and every "what changed" surface were
> silently dead while the job reported green.**
>
> ✅ **BATCH A SHIPPED 2026-07-20** (this session): B-70, B-72, B-73 (+ QW-01…QW-04, QW-10, QW-12 and the
> zero-width trash button). `vite build` green, 28/28 scoring tests green.

### 🔴 CRITICAL — live-user impact

- **B-70 ✅ DONE — Weekly rebake cron committed nothing and exited green.** `score-rebake-weekly.yml:73` staged
  only `companies/` + `weekly_changes.json` + `grade-snapshot.json`, but `finalize-bundle.mjs` also rewrites
  `index.json` + `search-index.json`. Tree never clean → all 3 `git pull --rebase` retries aborted → loop ended
  on `sleep 5` so the job exited **0**. `weekly_changes.json` still read `generatedAt 2026-06-13, changes: []`.
  **Fixed:** `git add public/data/` + fail-loudly retry (`exit 1`). *(effort S · WS-A)*
  **↳ FOLLOW-UP — ✅ first item DONE 2026-07-20:** the cron self-healed the same day — `trunorth-bot` ran the weekly
  rebake at 16:12 UTC (`236fe1c57`) and **moved `index.json` for the first time in 5 weeks**, landing the backlog as
  **33 grade changes (19 down / 14 up)**; graded dist went A 71→**64** · B 1,180→**1,188** · C 1,037→**1,050** ·
  D 534→**521** · F 235→**234** (3,057 graded, 12,833 tracked, both unchanged). No manual run was needed.
  **↳ STILL OPEN:** grep the other 167
  workflows for the same `sleep`-swallows-exit-code template; add a freshness assert to `cron-health-daily.yml`
  (fail if `weekly_changes.json` is >10 days stale).
- **B-71 ✅ DONE — Paywall comparison table sells four things that are already free.** `App.jsx:1566-1570` marks the
  exact /100 score, full breakdowns, all 9 categories, per-grade citations and the **in-store scanner** as
  Pro-only. None are gated: /100 renders at `:3753`, `CategoryRow` (`:2963`) never receives `isPaid`, source
  chips render at `:3086`, `setShowScanner` fires unconditionally. The one gate that IS enforced (1 brand/day)
  isn't a row. False purchase disclosure → **App Store 3.1.2 exposure**. Mirrored on `MarketingLanding.jsx:190`
  and `:379`. **Do NOT gate the scanner.** Needs a product decision on the real paid boundary (recommendation:
  ongoing service — unlimited watched brands + change alerts, basket-scoped digest, compare >2, export).
  Generate the table + landing + Account card from ONE shared constant; add a test asserting every `free:false`
  row maps to a real `isPaid` branch. *(effort M · WS-E · **BLOCKED ON ARON'S DECISION**)*
- **B-72 ✅ DONE — "Better for your values" fabricated a points delta on ungraded brands.** `computeScore`
  returns `null` for "?" brands; `App.jsx:3556` filtered `x.score >= ps + 7` — `null` coerced to 0, so nearly
  any graded competitor qualified and `:3597` rendered `{altScore}+ points better for you`. Reachable on
  **1,974** brands, directly under copy saying we don't guess. **Fixed:** require a real score on both sides.
  *(effort S · WS-E)*
- **B-73 ✅ DONE — API CORS allowlist never matched the shipping iOS webview.** All three API files allowed
  `capacitor://localhost`, but `capacitor.config.json` sets `ios.scheme: "TruNorth"` → native email capture was
  very likely 403'ing on the LIVE build, while `marketing.js` returned `{ok:true}` on any non-2xx AND on network
  failure and `SuggestBrandButton` always rendered "✓ we'll email you". Android (`https://localhost`) was also
  excluded — which would have broken the Delete Account endpoint Google Play requires. **Fixed:** match any
  localhost host regardless of scheme + literal `"null"`; `marketing.js` returns honest `ok:false`; added an
  `error_email` retry state. *(effort S · WS-B)*
  **↳ FOLLOW-UP (open):** extract the allowlist into ONE shared module (deliberately inlined ×3 for this hotfix
  to avoid a Vercel routing risk); honor `requiresVerification` ("Check your inbox to confirm"); add a smoke
  test POSTing from each shipping origin.
- **B-74 ✅ DONE — Android hardware Back quits the app from every screen.** `capacitor-init.js:57-60` is
  `history.length > 1 ? history.back() : App.exitApp()`, but the app never calls `pushState` (only
  `replaceState`), so in a fresh WebView `history.length === 1` and the FIRST Back press calls `exitApp()` —
  from onboarding, mid-Match, with the camera live, with the paywall open. Back is the primary Android nav.
  Add `src/lib/back-stack.js` (module-level LIFO) + a `useBackDismiss(onClose)` hook alongside the existing
  `useModalA11y` (one line per overlay). Drop the `history.length` check. *(effort M · WS-B)*
- **B-75 ⚠️ MOSTLY DONE — Android launch blockers (checklist, all before any beta).** `android/` exists as a bare
  `cap add android` scaffold. Every one of these silently fails: `payments.js:40` has only
  `VITE_REVENUECAT_IOS_KEY` and passes it unconditionally at `:66` → the paywall renders and does nothing
  (Pro is the only revenue); no App Links `<intent-filter>` for `trunorthapp.com` `/company/*` + `/c/*`;
  `custom_url_scheme` unfixed; ML Kit module + manifest incomplete. Add
  `VITE_REVENUECAT_ANDROID_KEY` selected by `Capacitor.getPlatform()`, create Play products against the existing
  "TruNorth Pro" entitlement, and build-time assert the key is non-empty. *(effort L · WS-B)*

- **B-94 ✅ DONE — The weekly-changes feed published 60 FALSE claims about named companies.** Same root cause
  as B-70, one layer deeper: the old `git add` staged `_meta/grade-snapshot.json` but NOT `index.json`, so the
  snapshot stopped being a faithful record of the shipped catalog — it drifted **150/2,845 brands (5.29%) out of
  sync and sat systematically ONE GRADE ABOVE reality** (`alcoa: snapshot=C, index=D`). Every diff therefore read
  as a decline. The feed claimed **60 changes, 100% "drops"**; verified against an `index.json` diff, **48 of 60
  were phantom** (no grade change at all) and **0 of 14 sampled "from" letters were correct** — it asserted
  *"Harris Teeter: Grade slipped C → F"* (actually D→F) and *"Alcoa slipped C → D"* (Alcoa never moved).
  Reality was **33 changes: 19 drops and 14 rises** (Tesla Energy D→B, Buick/GMC/Hummer F→C) — it reported
  **zero** rises. This file feeds the Sunday digest AND the in-app "what changed" surfaces, on the product whose
  entire differentiator is that the record is right. **No user ever saw it** (the digest was dead 5 weeks; B-81
  confirms notify-me has no delivery path), but it shipped in the bundle.
  **Fixed 2026-07-20:** regenerated `weekly_changes.json` from a verified `index.json` diff using the script's own
  `snapshotFromIndex`/`diffChanges` (33 real changes, 19 drop / 14 up), and added a baseline-integrity guard to
  `compute-weekly-changes.mjs` — it now compares the prior snapshot against the last COMMITTED `index.json` and
  hard-aborts above `SNAPSHOT_DRIFT_MAX_PCT = 2%` rather than publishing claims from a poisoned baseline.
  Guard verified both ways: fired at 5.29% on the historical bad state, passes 3,057/3,057 post-fix.
  *(effort S · WS-E)*
  **↳ FOLLOW-UP (open):** the pre-existing "bake looks broken" guard only checked for a >50% graded-count
  collapse — a 150-brand semantic divergence sailed through. Audit the other data crons for the same
  "structurally valid but semantically poisoned" blind spot.


- **B-95 ✅ DONE — Three brand pairs ship CONTRADICTORY grades for the same company.** `ui-guards.test.mjs` has a guard
  for exactly this (the old "Exxon is a D and a B" bug) and **it is currently RED**:
  `abercrombie-and-fitch-de=B` vs `abercrombie-and-fitch=F` · `amphenol-de=B` vs `amphenol-corp=F` ·
  `tjx-companies-de=B` vs `tjx-companies=D`. A user searching "Abercrombie & Fitch" gets **B or F depending on
  which entry they land on** — directly corrosive to the one claim the product makes. Verified identical before
  AND after the 2026-07-20 rebake, so this is pre-existing debt, not rebake drift: the Exxon dedup fixed its own
  family and missed the `-de` suffix family (the same family as the dead `-de` sitemap slugs). Fix path already
  exists: `scripts/dedup-brands.mjs`. Grade-affecting → run under rule #16 (rebake → finalize → 28 tests →
  drift audit) with the diff reviewed before commit.
  **⚠️ This is the case FOR B-82:** the guard was written, it went red, and nothing ran it — there is no CI on
  any code change. Every fix in this review is one un-run test away from silently regressing. *(effort S · WS-E)*


- **B-96 ✅ DONE — `scoringFlags.test.mjs` has 3 stale snapshots; blocks adding it to CI.** 9/12 pass. The 3 failures are
  expectation drift, not new breakage: `apple` environment expects `inferred` but gets `default`; `walmart` guns
  expects `{kind:'na'}` but gets `{kind:'default'}`; `patagonia` execPay expects `notDisclosed` but gets `na`.
  Decide per case whether the TEST or the IMPLEMENTATION is right (the patagonia one looks like a real
  regression — a private company's exec pay is "not disclosed", not "not applicable"), fix, then add the file to
  the `ci.yml` gate. *(effort S · WS-E)*


### 🟠 HIGH

- **B-76 ✅ DONE — Search ranking is why the "?" wall feels total (≈60% a sort bug).** `searchHits` runs MiniSearch with
  `boost name:5` then collapses to a membership **Set** (`:5881`); `filtered` re-sorts **alphabetically**
  (`sort` defaults to `"name"`, `:5388`). Replayed on the shipped index: `coca` → COCA COLA FEMSA (?) above
  Coca-Cola; `apple` → Abrams Appleseed (?) above Apple; `pet` → 9 of top 12 are shrugs. The typeahead
  (`:6722`) DOES preserve relevance, so the dropdown and the list below it disagree. Convert to a slug→rank
  **Map**, add a `relevance` sort defaulted when a query is present (sink `overall == null`), and add a
  persisted **"Graded only · 3,057"** chip. **Zero new data required.** *(effort S · WS-A)*
- **B-77 ✅ DONE (partial — see note) — `resolveBrand` returns the wrong company for ~1 in 4 mapped brands.** `App.jsx:182-190` runs a bare
  prefix loop returning the first alphabetical hit BEFORE consulting `brand-parent-map.json`. Replayed:
  **935–1,700 of 6,694** mapped keys resolve wrong — `bounty` → Bounty not P&G, `americanspirit` → America not
  R.J. Reynolds, `ajax` → Ajax Engines not Colgate. **This is the scanner.** Reorder to exact → parent-map →
  prefix; require `k.length>=5` + token boundary; bail on ambiguity; prefer graded. The 935 mismatches are a
  ready-made regression corpus. *(effort M · WS-C)*
- **B-78 — Fabricated "New public records moved X from B to A" when the user changes their own compass.**
  `App.jsx:5741-5766` snapshots the PERSONALIZED grade with deps `[companies, profile]`; onboarding is
  basket-before-Match, so the basket is snapshotted at baseline with `profile null`, and the next run diffs
  personalized vs baseline — rendering record-change stories on the Today front door that no record caused.
  **The core trust claim, inverted.** Store `{g, at, pv}` where `pv` hashes the scoring-relevant profile fields;
  emit only when `prev.pv === currentPv`. *(effort M · WS-D)*
- **B-79 — Reconcile every catalog/source count from one build-time constant.** `OnboardingFlow.jsx:74`
  hardcodes "12,000+ Companies" with **no graded number** — the one screen 100% of new users see, on a catalog
  that is 76% "?". The honest reframe exists (`App.jsx:2274`) but is suppressed for 5 minutes after onboarding.
  Emit `src/generated/catalog-stats.json` from `rebuild-bundle-index.mjs` and `sources-data.json` from
  `docs/SOURCES.md`; consume everywhere. *(effort S · WS-E)*
  *(Note: the "200+ sources" claim itself was REFUTED as a problem — `docs/SOURCES.md:5,13,14` reconciles ~105
  named/in-app vs 200+ pipeline across 168 crons, and `App.jsx:7846` mirrors that distinction.)*
- **B-80 ✅ DONE — Turn the "?" dead end into the app's most valuable screen (marquee candidate).** 76% of sessions land
  here on four stacked contradictions: the zero-data card says "None of our 200+ sources report on this brand"
  (`:4023`) while ~100 lines below it renders that brand's Wikipedia summary, BBB rating and SEC filing count —
  **2,391 brands render a footprint card AND the no-records card.** Rebuild as one card: editorial statement →
  *receipt of absence* ("Checked FEC, OSHA, EPA, NLRB, SEC on <date> — 0 records", needs the pipeline to write
  `sourcesChecked` + `lastCheckedAt`) → whatever About/footprint actually has → 3 same-aisle graded
  alternatives. *(effort L · WS-C)*
- **B-81 ✅ DONE — Close the notify-me loop: "we'll email you the moment X is graded" has no delivery mechanism.** Grep
  for `brand_grade_notify` across `scripts/`, `api/`, `.github/workflows/` returns **zero consumers**. The email
  lands in MailerLite `fields.brand`, which upserts by email — a user asking about three brands keeps only the
  last. Add `scripts/detect-newly-graded.mjs` + per-brand groups + a campaign step. If it can't land in v1.2,
  **downgrade the copy to something true today.** *(effort L · WS-A)*
- **B-82 ✅ DONE — Add a CI workflow: 168 workflows exist and not one runs on a code change.** Zero have a
  `pull_request` trigger. The only pre-ship gate is `ship-ios.sh:88` running one test file; the 28 frozen-
  threshold tests and 135 others never run automatically. **This is the enabling condition for the drift found
  throughout this review** (the A≥62/B≥50/C≥38/D≥33 thresholds exist verbatim in FOUR files). Add `ci.yml`:
  `npm ci` → the 3 real test files → `vite build` (the oxc gate). Exclude the ~133 fetcher tests initially.
  *(effort S · WS-E)*
- **B-83 — The brand-card Match prompt is inert text.** For an un-quizzed user the highest-intent moment renders
  as a plain `<div>` at `App.jsx:3881`; the hero container has no `onClick` and `CompanyCard`'s props contain no
  quiz callback. Add `onTakeMatch`, wire to `setScreen('quiz')` with `track('quiz_started',{from:'brand_card'})`.
  *(effort M · WS-C)*
- **B-84 — Render the 12 weeks of basket-alignment history already collected on every launch.**
  `App.jsx:5770-5782` writes `tn_alignHist` every session and trims to 12 weeks; a repo-wide grep returns
  exactly two hits, both inside that write. **The strongest honest return artifact the product can have** —
  dated, personal, moving. Add a sparkline + WoW delta to Ledger and Today. Do NOT gate behind Pro.
  *(effort M · WS-D)*
- **B-85 ✅ DONE — Free-tier economics: one paywall dismissal buys 7 days of unlimited access.** `App.jsx:3193-3194`
  computes `inCooldown` from `tn_paywallDismissedAt` over 7×24h and `:3197` skips the quota entirely — and the
  timestamp is written on EVERY paywall close, including a voluntary price check. The most purchase-curious
  action buys a free week. Only write on the hard gate; shorten to 24h; never suspend the quota, only the
  interstitial. *(effort S · WS-E)*
- **B-86 — Five invisible icons; one is a zero-width delete button.** `ti-barcode`, `ti-circle-check-filled`,
  `ti-star-filled`, `ti-cigarette`, `ti-trash` have no content rule in `tabler-subset.css` (84-glyph subset).
  ⚠️ **Adding CSS rules alone is NOT enough — the glyphs are not in the subset font and `pyftsubset`/`fontTools`
  is not installed.** Requires `pip install fonttools` + regenerating the subset. *(The functional half — the
  untappable Ledger delete button — was fixed in Batch A with an explicit 44×44 target.)* Wire a grep-vs-CSS
  diff into `ui-guards.test.mjs`. *(effort S · WS-E)*
- **B-87 — Delete 4.6 MB of unread `storedFields` + the 2.3 MB stale `companies.js` fallback.**
  `search-index.json` is 5.75 MB, **79% of it storedFields** — and the only consumer discards everything but the
  slug. Downloaded, synchronously string-parsed on the main thread, heap-retained every session for nothing.
  Set `storeFields: ['slug']` in `finalize-bundle.mjs:47` (→ ~1.2 MB) and delete `src/companies.js`.
  *(effort S · WS-E)*

### 🟡 MEDIUM

- **B-88 — Refill `editorial.json` and de-loop Today.** Holds 7 stories spanning only 2026-06-02→06-08, so since
  06-09 `BrandOfDayCard` has ALWAYS fallen through to the storyless tile — the difference between an editorial
  product and a lookup table. Also the shelf shows `present[day % len]` with a deterministic slice, so the daily
  surface has repeated for six weeks. *(effort S · WS-D)*
- **B-89 — Ungate `SubmitView`: you are charging users to tell you your data is wrong.** `App.jsx:4688-4698`
  blocks corrections and suggestions for free users — backwards for a release whose goal is +2,000 graded. Free
  correction traffic is free labour and the cleanest signal for WHICH "?" brands to grade first. *(effort S · WS-A)*
- **B-90 — Disclose UPCitemdb and stop claiming "refresh nightly".** `PrivacyPolicy.jsx:131` discloses only Open
  Food Facts, but `App.jsx:405` sends the barcode + user IP to `api.upcitemdb.com`, disclosed nowhere (incl. the
  App Store nutrition label). The scanner header asserts "We never store the barcode" while `:431` ships the raw
  barcode to PostHog. *(Copy half fixed in Batch A.)* *(effort S · WS-E)*
- **B-91 ✅ DONE — Kill opacity-as-meaning for the baseline/ungraded state.** v1.1's headline feature reaches first-run
  users as faded letters with no legend; the only explanation is a `title` attribute that never fires on touch.
  Composited, the 0.82 multiplier drops F to **3.19:1**. Replace with a tappable "BASELINE" chip; delete the 8
  duplicated inline grade maps (`GRADE_COLORS` is imported at `:20` and that import is its ONLY occurrence in
  8,372 lines — the hero map at `:3713` has already drifted). *(effort S · WS-E)*
- **B-92 — Extract the scoring engine and start decomposing `App.jsx` (8,372 lines).** `export default function
  App()` is at line 5137, so ~60% of the file is module-scope declarations that CANNOT close over App()'s state
  — moving them is cut-and-paste, not a refactor. Order (one commit per file, `vite build` green after each):
  `grade-thresholds.js` → `political-signals.js` → `scoring.js` → `sources.js`/`BarcodeScanner`. **Do B-82 (CI)
  first.** *(effort L · WS-E)*
- **B-93 — Prune the 119 MB native data payload and fix cold-start order.** `android/app/src/main/assets` is
  131 MB (119 MB `public/data`, 68 MB per-company JSON) — an offline fallback nobody sized, almost none of it
  reachable because `dataSource.js:48-64` fetches the REMOTE copy first on native. Ship an explicit offline
  subset (~12–15 MB); invert to bundled-first-then-swap. *(effort M · WS-B)*

### ⚡ QUICK WINS (QW) — small, high-value, mostly independent

| ID | Item | Status |
|---|---|---|
| **QW-01** | `score-rebake-weekly.yml:73` → `git add public/data/` + non-zero exit on push failure | ✅ done |
| **QW-02** | `App.jsx:3555` → `if (ps == null)` guard; kills the fabricated delta on 1,974 brands | ✅ done |
| **QW-03** | API allowlist ×3 → accept any localhost host regardless of scheme + literal `"null"` | ✅ done |
| **QW-04** | `marketing.js` → `ok:false` on non-2xx and network failure; retry state in the UI | ✅ done |
| **QW-05** | `finalize-bundle.mjs:47` → `storeFields:['slug']` (5.75 MB → ~1.2 MB) | open |
| **QW-06** | `App.jsx:5388` → default sort `score`; `searchHits` as slug→rank Map not Set | open |
| **QW-07** | Delete `src/App.jsx:5721-5722` + `src/companies.js` (2.3 MB chunk, stale May-2026 grades) | open |
| **QW-08** | `OnboardingFlow.jsx:74` → "3,000+ graded / 12,000+ tracked"; `:140` `#fff` → `T.bg` (2.19:1 → ~12:1) | ✅ done |
| **QW-09** | `tabler-subset.css` → 5 missing icon rules **(needs `pip install fonttools` + pyftsubset regen)** | open |
| **QW-10** | `App.jsx` → "refresh nightly" → "refresh continuously — most sources weekly, some daily" | ✅ done |
| **QW-11** | `App.jsx:220` → branch the camera-denied string on `Capacitor.getPlatform()`; sweep iOS-only copy | open |
| **QW-12** | `theme.js` → `GRADE_COLORS['?'].text` `#6E6A60` → `#9A9489` (2.95:1 → ~5.3:1) | ✅ done |
| **QW-13** | `eslint.config.js` → `'no-empty': ['error',{allowEmptyCatch:true}]` (133 errors → ~48, makes lint gateable) | open |
| **QW-14** | Commit `android/` with an `ios/`-style ignore block before native config lands in an untracked tree | ✅ done 2026-07-20 (`fd1e67250` — 54 files tracked, 13,109→54 / 130 MB→0.4 MB) |
| **QW-15** | `App.jsx:2213` → `/^\/(?:company\|c)\//` so What's-New stops covering `/c/<slug>` deep links | open |
| **QW-16** | Refill `editorial.json` (expired 2026-06-08); fall back to `stories[day % len]` not a bare tile | open |


## 🔎 QA PANEL REVIEW — 11-DEVICE / 11-PERSONA (2026-06-14)

11 independent device+persona review agents + Director live walkthrough + source verification. IDs **QA-1…QA-25**, ranked by impact (QA-N = Top-25 item #N). Status: 🔵 needs your decision · 🟢 fixing now · 🟡 project · ✅ done. Full synthesis in session 2026-06-14.

| ID | Sev | Issue | Status / next |
|---|---|---|---|
| **QA-1** | Crit | First run gates all value behind 11-card Match + paywall (inverted funnel) | ✅ **browse-first shipped** — basket → browse; Match optional ("Start the Match · 45s" card); verified live |
| **QA-2** | Crit | Per-grade citations Pro-gated vs "records, not opinions"; code self-contradicts (`App.jsx:7354` "free" vs `:7400` "Pro") | ✅ **kept Pro-gated** (Aron's call); fixed the self-contradicting comment (App.jsx:7354) |
| **QA-3** | High | The Match: huge black void on every card (`MatchFlow.jsx` `marginTop:auto`) — 9/11 flagged | ✅ Match card centered — void gone (verified live) |
| **QA-4** | High | Jargon wall: Lens/Ledger/Compass/WPCN undefined (nav ids are literally today/search/library) | ✅ Lens→**Scan**, Ledger→**Basket** (Aron's call) + WPCN caption |
| **QA-5** | High | No Android build; web dead-ends Android users with no capture | ✅ Android-detect waitlist live (CTA + tagged subscribe); 🟡 native build = P-1 |
| **QA-6** | High | No tablet/desktop layout — centered 430px column in black (1 media query in 7.7k lines) | ✅ responsive column shipped (B71, CSS-var 430→560→600px); 🟡 full 2-pane/multi-col grid = follow-up |
| **QA-7** | High | Web is marketing-only; can't try/verify the product on a computer | 🟡 surface live `/company/<slug>` demos + link Methodology (QA-19) |
| **QA-8** | High | Pricing: marketing "$9/yr" vs app $14.99/$1.99 (`MarketingLanding.jsx:391`) | ✅ standardized $14.99/$1.99; dropped the $9 founder chip |
| **QA-9** | High | A11y: 10px `#444`/`#555` onboarding consent+stat text (~2:1) + pinch-zoom disabled (`index.html:13`) | ✅ pinch-zoom restored + terms/stat contrast bumped (broader contrast pass remains 🟢) |
| **QA-10** | High | No motion/transitions/haptics (feels static on premium HW); dead `pulse` loader keyframe (`App.jsx:3218`) | ✅ pulse keyframe + Match card fade + native **haptics** (Match/Switch/purchase/restore) shipped (B71); 🟡 sheet/tab transitions = follow-up |
| **QA-11** | MedHi | White-on-white logo tiles (`App.jsx:~2522` `background:"#fff"`) → Patagonia/Allbirds blank | ✅ off-white plate + hairline shadow (verified live) |
| **QA-12** | MedHi | WPCN buried + "Share my values" sends URL, never the image (`App.jsx:~6097`) | ✅ share attaches the values-card image (url-only fallback) |
| **QA-13** | Med | Empty states dressed as content ("All quiet on the record") | ✅ reframed to "We're watching…" |
| **QA-14** | Med | Nav: 3 items, no "You" tab; "Lens" = scanner crosshair | ✅ kept top-right (your call), made noticeable (accent ring + 40px icon) |
| **QA-15** | Med | Brand tap = inline expand, not a page (breaks back/bookmark/deep-link; no desktop reading view) | 🟡 real `/company/<slug>` in-app route |
| **QA-16** | Med | Touch targets <44px (Account/Upgrade 32px, top-right reach on big phones) | ✅ Account + Upgrade → 40px hit areas |
| **QA-17** | Med | In-app "Your wallet is a vote. Cast it wisely." reads partisan to pragmatic users | ✅ softened to "Shop with your values / See the record" |
| **QA-18** | Med | In-app still claims "12,000+" though ~2,900 graded; first browse = "?" | ✅ honest "~2,900 graded / 12,000+ tracked" + baseline grade |
| **QA-19** | Med | Methodology orphaned (0 in sitemap, 0 landing links) — best trust asset undiscoverable | ✅ sitemap entry + footer link |
| **QA-20** | Med | First-run basket has B2B chips (Accenture, BrightDrop) under "what you actually buy" | ✅ B2B brands excluded from basket pool (verified — Accenture/BrightDrop gone) |
| **QA-21** | Med | Sort/filter chip row clips the right chip at phone widths (no scroll affordance) | 🟢 edge-fade + wrap ≥700px |
| **QA-22** | Med | No hover/focus-visible states on web/pointer; weak keyboard a11y | ✅ `:focus-visible` rings added (keyboard a11y) |
| **QA-23** | Med | No human-facing founder/About/neutrality on web | 🟢 add section |
| **QA-24** | Med | Inferred grades shown under "records, not opinions" (`App.jsx:~2925`) | 🟢 label inferred distinctly |
| **QA-25** | LowMed | Source count inconsistent (100/200+/free-see-~10); design-system leaks (banned purple `rgba(124,109,250)`, ~250 hardcoded hex) | ✅ banned purple → accent (fully removed); 🔵 source-count number = your call |

---

## 🔴 NEEDS YOUR DECISION — CURRENT (refreshed 2026-08-01)

> **v1.2 program gates — 1 of 3 closed 2026-08-01.** ~~**B-115** execPay/tax mapping~~ ✅ **RESOLVED** — you
> chose penalize-only (option B); shipped as `a8ba45a7c`, **still unpushed**. Still open: **B-116**
> (environment / EPA TRI toxic-release revenue-normalization methodology) and **B-112** (the marquee
> "Newly Graded" return engine — ship **B-111** first as cheap proof). **B-120's concurrency approach did not
> wait on you** — the destagger was the low-risk option and it shipped; the drift warning still stands for
> whenever ~20 dormant sources come back to life.


### 🆕 v1.2 "Reach & Coverage" — 8 decisions blocking Phase 0 (added 2026-07-18)

The plan doc `docs/research/v1.2-big-update-plan-2026-07-18.md` (drafted, **uncommitted**, nothing built) ends on these. **No BACKLOG IDs will be minted until you mark them up** — that's the agreed gate.
1. **Goal framing** — measure success as **graded** coverage (3,057 → 7,000–8,000), or literally +5,000 *tracked* regardless of the "?" wall?
2. **Android payments** — launch Android **free-only** (fast) and add Play Billing later, or **wait for full RevenueCat/Play-Billing parity** before Production? (Biggest timeline lever.)
3. **Marquee feature** — **"Ask TruNorth"** (NL, cited answers from our own graded data) vs **Aisle Mode** (batch cart scan) vs **Wrapped**. Pick one; the plan recommends Ask.
4. **Widget** — relaunch the already-built home-screen widget in v1.2? (Cheap; it's preserved and already at iOS 15.0.)
5. **Push notifications** — v1.2 or v1.3? Needed to deliver the "notify me when we grade this" demand we already collect.
6. **Source count** — all ~50 in v1.2, or top ~30 (entity-resolution + gov primaries) now and the rest in v1.3?
7. **Branding** — **v1.2**, or is Android + a marquee feature big enough to be **v2.0**?
8. **B-23 scope** — conservative (1–2 dark dims, minimal drift) or aggressive (redesign tax/recall/supply-chain into real inputs)? *(Overlaps decision #1 in the older list below.)*

### Carried over (refreshed 2026-06-27)

App is LAUNCHED (**v1.1 Build 81 live since 2026-07-14**); these are the live calls before the next build — detail in **▶ NEXT BUILD** above. *(Resolved this evening: ✅ Open-PR triage — 0 PRs open · ✅ B-63 NC strip executed · ✅ B-64 crons fixed · ✅ E-6 source-count · ✅ NB-9 Fed-Reserve card lit · 🟡 B-23 animalCerts wired.)*
1. **B-23 scoring wire — remaining 6 dims** (NB-2) — animalCerts is wired; do any of secTax/supplyChain/openfdaRecalls/privacy/pharmaConduct/laborWages become real grade inputs (with a careful rebake), or stay display-only? The one big lever still open.
2. **E-1 scoring-flags** (NB-7) — flip the runtime flag on (24h watch) or formally defer.
3. **B-67 GJF strip** (NB-4) — `vt-strip-gjf.mjs` is built+pushed but UNRUN; confirm it fires after the next rebake.
4. ~~**NB-1 iOS bump**~~ — ✅ **fully moot.** v1.1 **Build 81 shipped and is LIVE** (released 2026-07-14); the device-test + App Review gates it described are all passed. Next ship = **Build 82**. *(Per memory: "Pro still active after Delete Account + sign-out" is correct behavior — the sub lives on the Apple ID — and the cancel→relock path was confirmed working, so C5 is settled.)*
5. ~~**NB-10 widget target**~~ — target wired 2026-07-05 (`68a518585`), then ⚑ **DROPPED from Build 81** on 2026-07-07 (`7703c1602` — decoupled, no `.appex`) → **v1.1 shipped widget-less.** Target + Swift preserved, deployment target already corrected to **iOS 15.0**. **Remaining action is now a Build 82 / v1.2 item:** re-add to the App target's Embed phase + dependencies, and harden `ship-ios.sh:124`/`:203` for multi-target. See v1.2 decision #4 above.

---

## 🧭 COMPASS REDESIGN — IN FLIGHT (updated 2026-06-12 AM)

| Step | Status |
|---|---|
| Design brief + 6-screen mockups | ✅ docs/design/REDESIGN_BRIEF.md + public/mockups/compass-redesign.html |
| Aron's decisions | ✅ Dark ink · Make the Switch · Radar (identity) — brief §8 |
| **R1 — Civic Premium skin** | ✅ Build 61 |
| **R1.1 — ring verdict seal** (radar sharded on real data — Adobe "what the hell is that") + E-9 cap | ✅ Build 62 — Aron: "Ring Seal — Looks good" |
| **R1.2 — chip fit + cooler signal color** (#3DD6B5→#38C0CE cyan-teal, full sweep) | ✅ Build 63 (2026-06-12, `fde1d05b2`) |
| **R2 — The Flows** (4-surface nav Today/Lens/Ledger/You · Today's 3 cards · Lens verdict card + receipts · the Match 11 tension cards · the Switch + Ledger v1 · Versus verdict line · first-run basket → Reveal-judged) | ✅ Build 64 (2026-06-12, Aron's go after 63) — gates passed (first-run ≤90s, verdict ≤3s). Tension-card copy awaits Aron's red pen (brief §8.5). |
| **R2.1 — Aron's device feedback** (Versus single-column · "Claude AI synthesis" chips hidden · DEI third-party recognition reaches stanced grades — Denny's anti-DEI repro A→C, deiB index flag, all surfaces agree) | ✅ Build 65 (2026-06-12) |
| **Brand media refresh** (app icon ink/bone/verdigris seal · OG share cards · og-image · favicon/touch/email icons · landing → Civic Premium serif hero · social avatar+banners+kit in docs/media/brand-2026-06) | ✅ Build 66 carries the icon; web deployed on push. Aron-side: upload socials per SOCIAL_KIT.md, capture device screenshots, promo-video recapture (L-9) pending |
| **B66 device fixes** (splash imageset → seal mark · Lens circle un-clipped (iOS composited-layer z-order) · center button = scanner in ONE tap · Methodology owns its scroll · personalized-share OG title drops baseline grade) | ✅ Build 67 (2026-06-12, both batches) |
| **B68 — clash-led basket articulation** (Aron picked A+C: "0% aligned" retired everywhere — Today serif clash sentence + one-switch projection, Ledger "N clashes · aligned/neutral" tile, Reveal clash line; basketVerdict() single source; scoring untouched/symmetric) | ✅ Build 68 (2026-06-12) |
| **R3 — The Magic** (compass physics + haptics · Aisle Mode + Cart Report · APNs push loop · NL ask · Wrapped · App Clip/widgets) | ⏳ next — needs Aron's go |
| Wrapped | 💤 dormant until December (design exists in brief §4 flow E) |

Build numbering is now true (ExportOptions `manageAppVersionAndBuildNumber=false`): repo build == ASC build from 61 onward; ASC builds ≤60 ran one ahead.

## 🔧 OUTSTANDING — ENGINEERING (updated 2026-06-11 PM)

**Shipped this round (`3f251e342`):** EDGAR expansion **+1,583 public cos → 12,841 brands** (all count claims now 12,000+) · ToS;DR privacy source live (E-2 ✅ — license verified CC BY-SA 3.0 grades-only-with-attribution, 114 fills, monthly cron) · Lever 2 residuals ✅ (1,607 factual no_guns from ATF-FFL absence, 27 sells/makes from FFL evidence, private-co execPay→na) · Lever 3 BUILT (`scripts/ai-research-bake.mjs`, citation-required) with a 20-brand pilot dispatched — **full ~3,000-brand run awaits your go (~$300-700 API)** · private+zero-data brands get a distinct "not required to disclose" explainer card with report-a-record CTA · fixed fabricated "C 50" on zero-data brands for quiz users (now "?").

**Note:** the 1,583 new public cos enrich incrementally as the 30+ source crons cycle (their fetchers need network windows) + via the Lever 3 bake.

## ✅ FULL CRITICAL REVIEW — ALL FIXES SHIPPED (2026-06-11 PM)

Every finding from the investor/product review is fixed and pushed (batches 1-5 + chip fix). Highlights: iOS bundle 521MB→~100MB + _cache out of git/Vercel · native iOS now fetches LIVE data (offline = bundled + honest stale banner) · O(n) dedupe + single-parse search index + 12KB icon subset (was 457KB) · session replay OFF, settled-search analytics, zero third-party favicon calls · retry UI instead of "no public record" on fetch failure · PostHog exception capture + cron-health-daily watchdog issue · central augment shrink-guard + snapshot-guard lib + 122 workflows get shared concurrency + staggered cron minutes · quiz weight scale unified (stance 4.5 max, rank-5 wins; shrinkage by evidence breadth) + "Foreign-owned parent company" reword + reveal-screen weight transparency · /methodology published (formulas, frozen thresholds, disclosed judgment calls) + evidence-depth chips + opinion-framing footer · consumerFacing gating (4,734 non-consumer entries hidden from browse, down-ranked in search, toggle to show) · 1-screen onboarding · submit.js origin allowlist + SEO hydration TTL + profile v2 normalization + NaN guard · AI prompt fair-report rules (corpus scan: 0 hits) · Retention v1: "Since your last visit" grade-change feed on saved brands + brand-grade share buttons.

**Aron-side residue from the review:**
| Item | Why |
|---|---|
| **Bind media-liability E&O insurance (~$78/mo)** | The realistic legal risk is defense-cost attrition, not losing — bind before PH visibility |
| Re-capture promo video assets (L-9) | Onboarding is now 1 screen; old captures show 3 |
| Lever 3 full bake still ON HOLD | Top-3,000 demand-ranked fills = best coverage $ post-review |
| APNs push (X-6) | The what-changed feed is local; push is the retention upgrade path post-launch |
| git filter-repo for the old 197MB pack | Needs all sessions to re-clone — coordinate a quiet day |

## 🔧 OUTSTANDING — ENGINEERING (remaining)

| # | Item | Notes |
|---|---|---|
| ~~E-9~~ | ~~Single-stance-signal grade tuning~~ | ✅ done 2026-06-12 (Build 62) — Aron's call: "With only 1 category, we should cap at B." Implemented in both engines (rebake + personalized): `contributingCats === 1 → ws ≤ 62`, upside-only. 117 brands A→B; methodology line "One strong record can earn a B; an A takes a broad, verified track record" now enforced. |


| # | Item | Size | Notes |
|---|---|---|---|
| E-1 | **Scoring-flags toggle** | decision | ⚠️ VERIFIED never flipped — `feature-flags.json scoringFlagsEnabled:false`, untouched since Jun-8; app LAUNCHED with flags OFF. It's a runtime kill-switch (no build needed). Post-launch: flip + 24h watch, or close as deferred. (Stale Jun-16/17 dates dropped — see NB-7.) |
| ~~E-2~~ | ~~ToS;DR (Lever 4c)~~ | ✅ done 2026-06-11 | License verified safe (CC BY-SA 3.0, grades-only + attribution). 2,285 services, 114 privacy fills, tosdr-monthly.yml cron |
| E-7 | **Lever 3 — AI research bake full run** | ⏸️ ON HOLD (Aron, 2026-06-11) — pilot proven (~$0.25/brand Sonnet); revisit post-launch-prep. Dispatch: `gh workflow run ai-research-bake.yml -f max_brands=N` | The long-tail filler: re-bake top ~3,000 brands by PostHog search demand via Claude API + web search, citation URL REQUIRED per claim (uncited claims stay out of scoring per neutrality rules). Phase-4.11 bake had no web search — could only summarize pipeline data. Batched overnight jobs. UNBUILT — the big outstanding lever |
| ~~E-8~~ | ~~Lever 2 residuals~~ | ✅ done 2026-06-11 | reflag-categories na pass IS live (guns na on 11,164 brands, animals 5,698, health 8,729) + private-co explainer shipped; still missing: execPay-na for private companies (0 flagged today) and the retailer "does not sell firearms" factual fills (only 1 no_guns in catalog — it's a real datapoint for gun-stance quiz users) |
| E-3 | **FTC cases & proceedings fetcher** | ~half day | R6 research §4 — privacy/consumer enforcement, verified viable, unbuilt |
| ~~E-4~~ | ~~OFCCP EEO-1 Type 2 static augment~~ | ✅ done | VERIFIED `data/derived/ofccp-eeo1-companies.json` exists; **763 company files carry OFCCP DEI data** (R7 section: 767 matched / 722 narratives). The manual FOIA download happened and merged. |
| ~~E-5~~ | ~~11 empty augments~~ | ✅ verified legit 2026-06-11 | All 11 are legitimately empty: seed/merge scripts run clean but those small intl regulators have zero catalog-brand matches (awa: 9 records all orphaned; fdpic: 0; weko: 1). NOT the wiped-snapshot class |
| E-6 | **Source-count reconcile** | ~1h | ⚠️ VERIFIED inconsistent: the in-app Sources tab renders **"200+" and "105" in the same paragraph** (`App.jsx:7494/7559`); `docs/SOURCES.md` claims 102 / has 137 rows / dated Jun-7 (pre-Build-76); landing mixes 190+/170+→200+. Pipeline reality = **168 workflows + 225 fetchers** → keep **200+** as the single headline everywhere, relabel the in-app 105 as a curated subset, regenerate SOURCES.md, align the landing's "N+ more". See NB-6. |

---

## 🚀 PRE-LAUNCH — YOU MUST DO (manual)

| ID | Item | Effort | Why |
|---|---|---|---|
| ~~**L-1**~~ | ~~Pin Twitter tweet~~ | ✅ done 2026-06-08 PM | Live on @TruNorthapp with 0:23 promo video. |
| **L-2** | LinkedIn pinned post from same doc | 5 min | B2B reach |
| **L-3** | Personal email blast — 10-20 closest contacts | 30 min | Drafted at `/docs/L-3-email-blast-checklist.md` — recipients + tracker ready |
| **L-7** | Activate Gmail Apps Script personalized auto-reply | 20 min | `/docs/gmail-personalized-autoreply-setup.md` — reduces email triage during launch |
| **L-8** | Daily 10-min PH "warming" routine (upvote 5-10, comment on 1) | 10 min/day × 15 days | PH algo rewards engaged accounts |
| **L-9** | Record 30-60s demo video for PH gallery | 1-2 hr | Pipeline at `~/.claude/.../teetime-bot-project.md` peer doc (`promo-video-pipeline.md`) — covers what to recapture when app screens change |
| **L-10** | Trade press pitches — send Mon Jun 16 | 30 min | Drafts ready at `/docs/trade-press-pitches.md` |
| ~~**L-5**~~ | ~~Pick + install ONE email signature~~ | ✅ done 2026-06-03 | `/docs/email-signature.html` installed |
| ~~**L-12**~~ | ~~MailerLite key in GitHub Actions secrets~~ | ✅ done 2026-06-01 | (Vercel runtime env is a separate item — see Decision #4 above) |

---

## ✅ LAUNCH DAY — June 23 (FIRED — app live on App Store + PH)

Launch executed Jun 23; app live worldwide (id `6775301458`). Table below is the historical playbook (`/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`).

| ID | Item | When (CDT) |
|---|---|---|
| **D-1** | Paste First Comment IMMEDIATELY after launch fires | 2:01 AM |
| **D-2** | Fire scheduled Twitter launch tweet | 2:05 AM |
| **D-3** | Fire scheduled LinkedIn launch post | 2:05 AM |
| **D-4** | Text 5 closest people the launch URL | 2:10 AM |
| **D-4b** | Swap LinkedIn personal headline to launch-day version | 7 AM |
| **D-5** | Reply to every PH comment within 5 min | 2-6 AM |
| **D-6** | Indie Hackers post | 9 AM |
| **D-7** | Hacker News "Show HN" post | 9 AM |
| **D-8** | Reddit posts (r/SideProject, r/Anticonsumption) | 9 AM |
| **D-9** | Midday rank check + strategy adjust | 12 PM |
| **D-10** | Slack/Discord community pings | 3 PM |
| **D-11** | Final ping to network non-responders | 6 PM |

---

## ⏸️ BLOCKED — waiting on external

| ID | Item | Blocked on |
|---|---|---|
| **X-0** | Flip `PRO_WAITLIST_MODE = false` + `IAP_SAFE_MODE = false` to enable real IAP | ✅ UNBLOCKED (2026-06-11: LLC ✓, bank ✓, RevenueCat ✓ per Aron). Remaining: rebase/merge `feat/paywall-go-live` onto much-moved main, finish both subs' ASC metadata (screenshot/localization/EULA+privacy links per 3.1.2(c)), sandbox-test purchase, submit version+subs together. |
| ~~**X-1**~~ | ~~App Store URL in PH First Comment + landing CTA~~ | ✅ **DONE** — Apple approved 2026-06-18; `APP_STORE_URL=https://apps.apple.com/app/id6775301458` set on main (`238159e52`) so the landing CTA flipped to "Download on the App Store" (live); PH launched Jun 23. |
| ~~X-2~~ | ~~RevenueCat / Apple IAP integration~~ | ✅ DONE on `feat/paywall-go-live` (91148e52b + bc649612d); LLC + bank + RevenueCat account live (Aron, confirmed 2026-06-11). Web Stripe side still per plan doc. |
| **X-3** | Apify Indeed reviews scraper | $10/mo Apify subscription + `APIFY_API_TOKEN` |
| **X-4** | MailerLite paid plan | >1k subscribers OR >12k emails/month |
| **X-5** | Annual + lifetime pricing tiers | RevenueCat live (depends on X-2) |
| **X-6** | Push notifications (iOS APNs + FCM Android) | iOS launch settled first |
| ~~**X-7**~~ | ~~ITEP citation approval~~ | ✅ **APPROVED 2026-06-14** by Amy Hanauer (ITEP Exec Dir): "all our work is published and available to use with citation"; "the way you're citing this all seems good to us." **Commercial/paid-tier OK** (Aron asked explicitly — no NC restriction, unlike OpenSanctions). Conditions: cite "Verified source: Institute on Taxation & Economic Policy (ITEP)" on every datapoint + link `https://itep.org/corporate-tax-avoidance/` (Amy's suggested target) + refresh annually. → unblocks **B-12**. |

---

## 📅 POST-LAUNCH — first 2 weeks

| ID | Item | Effort | Notes |
|---|---|---|---|
| **P-1** | Phase 6.a: Android launch via Capacitor | 7-9 hr + $25 | `/docs/ANDROID_LAUNCH_PLAN.md`. Blocked on iOS App Store launch. |
| **P-2** | Thank-you DMs to top 10 PH commenters | 1 hr | Day 2 |
| **P-3** | Results tweet ("Launched at #X on PH yesterday…") | 15 min | Day 2 |
| **P-4** | "Featured on PH" badge on trunorthapp.com | 10 min | Day 2 — embed code in PH dashboard |
| **P-5** | Outreach to `?ref=producthunt` UTM visitors | 30 min | Day 3-7 |
| **P-6** | Post-launch retro — what worked, top requests | 1 hr | End of week 1 |
| **P-7** | Trade press follow-ups with launch results data | 1 hr | Week 2 |
| **P-8** | Swap LinkedIn headline to **1-week-after** version | 2 min | Day 7 (Jun 30) |
| **P-9** | Swap LinkedIn headline to **1-month-after** version | 2 min | Day ~30 (Jul 23) |

---

## 📋 BACKLOG — pick when relevant

Sorted by category. Effort tags: **S** = <1 hr · **M** = 1-4 hr · **L** = day+

### Audit deferrals (from Jun 1 25-agent audit)

| ID | Item | Effort | Notes |
|---|---|---|---|
| ~~**A-1**~~ | ~~Unified `openBrand(slug)` helper~~ | ✅ done 2026-06-02 | |
| ~~**A-2**~~ | ~~Modal a11y (focus trap + ESC + return)~~ | ✅ done 2026-06-02 | |
| ~~**A-3**~~ | ~~Copy honesty + acronym pass~~ | ✅ done 2026-06-02 | |
| **A-4** | Backfill personalization signal for top 100 brands | L · $15-60 | Procedure at `/docs/A-4-backfill-procedure.md`. Sample (Jun 3): 24/41 top-100 brands have all-neutral scores. Run requires API budget approval. |
| **A-5** | Bundle splitting (2.5MB companies + 4MB Tabler font) | L | Lazy-load companies dataset; swap Tabler webfont for sprite. Risky — could break dynamic imports/asset paths. |

### App / UX polish

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-1** | iPad tablet breakpoint | M-L | `/docs/tablet-breakpoint-plan.md`. iPhone-first is fine for launch. |
| **B-2** | Browser/Safari extension — grade badge overlay on Amazon/Target/Walmart | L | Primer at `/docs/TruNorth-Tier-C-Browser-Extension-Primer.docx` |
| **B-4** | Break up App.jsx (~5,000 lines → component files) | L | Refactor only |
| **B-5** | JSDoc `@typedef` for Company shape | M | Dev autocomplete win |
| ~~**B-31**~~ | ~~Account → Edit email~~ | ✅ done 2026-06-05 | |
| ~~**B-32**~~ | ~~Email signature HTML template~~ | ✅ done 2026-06-05 | |
| ~~**B-33**~~ | ~~Sources tab — hide behind Pro~~ | ✅ done 2026-06-05 | |
| ~~**B-34**~~ | ~~Group ID 189038375757415926~~ | ✅ resolved (doc artifact) 2026-06-05 | |

### Scoring / data

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-65** | **Data-source expansion — build 59 net-new public-record sources** | L · **post-launch** | Deep-research catalog 2026-06-22 → `docs/research/data-sources-expansion-2026-06-22.md`: 59 verified net-new, company-level, public-record sources (value-sorted, ingestion-tiered, caveats), lifting the live registry from ~100 past **200+** counting multi-feed fetchers. Build quick-wins first (license-safe gov leading): EPA TRI · **Norges Bank via NBIM-direct (NOT OpenSanctions — CC-BY-NC, see B-63)** · FDA Warning Letters/483s · CA+WA breach lists · FTC Legal Library · GHGRP · EEOC feed · Health Canada · CMS Open Payments · ENERGY STAR. Opens new cats: tax/subsidies, product safety, healthcare/pharma payments, ad conduct, fraud/AML. Pattern per source: fetch → resolve to augment → wire scoring + `rebake-scoring.mjs` → `finalize-bundle.mjs` + `scoring-engine.test.mjs` green + grade-drift check (rule #16 — the careful step). ⚠️ Paid-app license rule: drop CC-BY-NC/ShareAlike (Opioid Tracker → rebuild from primary; ICIJ → drop); NGO/benchmark rosters need per-source commercial-reuse confirm. Aron greenlit 2026-06-22; build POST-launch. **⏳ FIRST WAVE SHIPPED to main 2026-06-26 ("Build 76" data label `59529195e` — NOT an iOS bump, binary stays 75).** 7 new license-clean public-record pipelines built + applied to **4,035 brands** via the new **`apply-enriched-augments.mjs`** (folds `data/derived/<src>-augment.json` → `company.enriched.*`, format-preserving, **additive, no score impact, no rebake**), surfaced as a reveal **"public-record footprint"** card row in `App.jsx`: **sec-tax** (SEC EDGAR GAAP rate) 3,417 · **supply-chain** (SEC Form SD conflict minerals) 872 · **openfda-recalls** (CC0) 363 · **privacy** (CA/WA breach + CPPA broker) 345 · **pharma-conduct** (CMS Open Payments + opioid $) 211 · **labor-wages** (state WARN; DOL WHISARD key-gated) 48 · **animal-certs** (Vegan/Humane) 19. Earlier same wave: **EPA TRI** live Envirofacts (`ec77b498b`, 464 brands) + **ITEP tax / EPA GHGRP** dead-fetcher fixes (`5d7db1a4f`; `itep-tax-merge` targets `enriched.tax` — ⚠️ but 0 files carry it on main today, `secTax` (3,418) is what shows; see B-12). Refreshed weekly via new `enriched-augments-refresh.yml` (`9a3f1c8dc`, DOL WHISARD key-gated). Research → `docs/research/data-sources-weak-areas-2026-06-26.md`. **HELD BACK pending license (B-63):** CPA-Zicklin / As You Sow / Newsweek-Statista third-party indices. **STILL OPEN:** (a) all of this is **display-only "dark data" — NOT yet read by scoring** (wire in via B-23, careful rebake + grade-drift); (b) Tier-1/Tier-2 sources not yet built (USAspending, NHTSA, DHS UFLPA, HHS-OIG LEIE, NLRB, FSIS, SEC pay-ratio iXBRL for the execPay 23% gap, IRS-990 990s). **⏳ Build-76 wave now largely DONE (Jun 27).** Pipeline completed + cleaned up: `eba9b9a5c` (format-preserving merges + complete footprint pipeline), `36e90245a` (restore the truncated `enriched-augments-refresh.yml`). Weekly cron verified running (`9b49e6273` Jun-26 + CI run 28298599428 **success** Jun-27). DOL **WHISARD `DOL_API_KEY` is now set** (labor-wages 48 brands live). Added a government-only **Fed-Reserve/SEC enforcement** block (`App.jsx:3425`). ✅ **Branch note:** all on a single clean `main` (consolidation 2026-06-27); the earlier untracked-dupes / feat↔main warning is RESOLVED. (`fed-reserve-enforcement.json` is intentionally absent — the card reads merged `enriched.fedReserve` per-company; that half is dark until the `fed-reserve-monthly` cron runs.) **HELD BACK (B-63 license):** CPA-Zicklin / As You Sow / Newsweek-Statista. **Next:** wire enriched → scoring via **B-23** (the one open lever); build Tier-1/Tier-2 (USAspending, NHTSA, DHS UFLPA, HHS-OIG LEIE, NLRB, FSIS, SEC pay-ratio iXBRL, IRS-990). Resume: "build the data-source expansion". |
| ~~**B-22**~~ | ~~Sub-brand → parent slug mapping~~ | ✅ done 2026-06-03 | |
| **B-23** | Scoring rebake from `recent_events[]` | M-L | **🔑 THE load-bearing open data lever — re-scoped 2026-06-27.** ⭐ **PROPOSAL + FIRST WIRE DONE (2026-06-27)** — `docs/b23-scoring-wire-proposal.md`: an 8-agent adversarial analysis concluded **wire only 1 of 7** enriched dims — **`animalCerts`** ✅ **now WIRED + verified** (stance-gated positive across all 5 client scoring sites + an `acertB` index flag; 28/28 tests, **0 baseline drift**, end-to-end confirmed — Trader Joe's→A aligned 1/1, Cal-Maine *not* whitewashed) — and **HOLD the other 6** (secTax/supplyChain/openfdaRecalls/privacy/pharmaConduct/laborWages: they're compliance-disclosure flags, counts-without-dollars, or double-counts of signals we already score; a naive wire-all would drift **150–450 grades down** unfairly). Awaiting Aron's go on animalCerts (no rebake/build dependency). Salvageable later via redesign: ITEP multi-year **cash** tax, a consumer-food recall score, mapped `uflpaListed`. This is now the single gate for converting all Build-76 enriched "dark data" (7 new sources + ITEP tax + EPA TRI/GHGRP, all `company.enriched.*`) AND `recent_events[]` into actual grade movement. Today everything in B-65/B-12/the footprint is **display-only — NOT read by the scoring engine.** Work: pick which `enriched.*` dimensions become scoring inputs → wire into `scoring-engine` + `rebake-scoring.mjs` → `finalize-bundle.mjs` → `scoring-engine.test.mjs` green → **`audit-grade-drift.mjs` careful grade-drift review (rule #16)**. Partially unblocked by PR #51 (scoring flags live, OFF by default). ⚠️ **Sequencing:** the B-67 GJF data-strip must run AFTER this rebake lands so narratives don't get re-written. |
| ~~**B-24**~~ | ~~AllSides outlet whitelist expansion~~ | ✅ done 2026-06-06 + dedup 2026-06-09 | All 4 outlets (Axios, Politico, The Verge, Ars Technica) already added 06-06. 06-09: removed silent JS object-literal duplicates (techcrunch/theverge/wired/arstechnica appeared twice) — preserved effective weights, no behavior change. |
| ~~**B-25**~~ | ~~BBB scraper letter extraction~~ | ✅ done 2026-06-03 | (Source itself retired in favor of CFPB.) |
| ~~**B-26**~~ | ~~CourtListener party disambiguation~~ | ✅ done 2026-06-03 | |
| ~~**B-27**~~ | ~~CA AG enforcement-actions scrape~~ | ✅ done 2026-06-06 | |
| **B-28** | Skip state AG complaint DBs (CA/NY/IL/FL/TX) | — | Surveyed: no public per-company complaint records. Resolved-not-feasible. |
| **B-29** | Skip FTC Sentinel + EEOC + ConsumerAffairs | — | Surveyed: law-enforcement-only / statutorily confidential / bot-protected. Not buildable without paid infra. |
| ~~**B-30**~~ | ~~VT v2 (per-state + YoY + recent_top5 + active)~~ | ✅ done 2026-06-06 | |
| ~~**B-30b**~~ | ~~UPS slug alias~~ | ✅ done 2026-06-07 | |
| ~~**B-37**~~ | ~~ATF FFL entity-resolution rebuild~~ | ✅ done 2026-06-06 | |
| ~~**B-37b**~~ | ~~Rewrite atf-fetch.mjs to v2 schema~~ | ✅ done 2026-06-07 | |
| **B-37c** | Auto-download ATF FFL CSVs (page scrape) | M | URLs change monthly. Manual drop into `public/data/_raw/atf-ffl/` for now. |
| ~~**B-38**~~ | ~~News-extract pipeline producing 0 high-signal items~~ | ✅ done 2026-06-07 | NEEDS_CONTEXT_BRANDS + NEGATIVE_CONTEXT logic. Pipeline UNFROZEN. |
| ~~**B-43**~~ | ~~OUTLET_BIAS canonical sync (news-rss-collect.mjs)~~ | ✅ done 2026-06-08 | Commit 8f9bb0c6f. Methodology comment + 3 right-of-center additions (NR→0.7, Reason 0.75, Free Beacon 0.5). |
| ~~B-44~~ | ~~Re-render Tesla ITEP mockup~~ | ✅ done | VERIFIED `docs/marketing/itep-citation-mockup.png` rendered (commit `194b35c1d`, Jun-9). |
| ~~B-45~~ | ~~Egregious 15:15 polarity rebalance~~ | ✅ done | VERIFIED `egregious-facts.json` = 15 neg / 15 pos (commit `194b35c1d`, Jun-9). |
| **B-46** | Coverage measurement (re-scope) | S | ⚠️ The Jun-16 auto-task never produced its output (`coverage-measurement-2026-06-16.md` does not exist anywhere). Date passed; re-create as a fresh manual task post-launch if still wanted. |
| ~~**B-47**~~ | ~~Re-fetch cleaner mark-only logo PNGs for Starbucks + Acura~~ | ✅ resolved 2026-06-08 PM | Solved differently — Aron reclassified Acura as wordmark (the cached PNG IS the canonical brand-identity expression for him). Starbucks left as-is; it looks fine in contact sheet. |
| **B-50** | Negative banner palette pinned to desat purple (`#5d54a6`/`#463f7d`) | — | Decided 2026-06-08 PM. Env-var override preserved. If you want to test another palette pre-launch, run `PURPLE=#xxx PURPLE_DEEP=#xxx node scripts/build-egregious-banners.mjs`. |
| **B-51** | Chipotle facts entry shortened (`Chipotle Mexican Grill` → `Chipotle`) | ✅ done 2026-06-08 PM | Long name was overflowing iOS splash brand-identity area at font 140. Stat copy still names "Chipotle Mexican Grill" for legal identity. |
| **B-52** | Auto-fit text in renderer for future long brand names | S | Defer post-launch. Quick template: `textLength + lengthAdjust="spacingAndGlyphs"` on the SVG brand-name `<text>`. Affects ~0 brands today (we shortened the one offender) but a future egregious add could hit this. |
| ~~**B-53**~~ | ~~Search bug: focusedSlug stuck after openBrand~~ | ✅ done 2026-06-08 PM (`aa4c1a941`) | Ships in Build 53. |
| ~~**B-54**~~ | ~~Scanner: brand-parent-map expansion (+1,980 entries)~~ | ✅ done 2026-06-09 AM (PR #64, `15d8c4b6b`) | 4,738 → 6,718 entries. Bush's, Heinz, French's, Pop-Tarts, KitKat→Hershey (correction), Planters→Hormel (correction). |
| ~~**B-55**~~ | ~~Scanner: static UPC→slug cache (3,937 entries)~~ | ✅ done 2026-06-09 AM (PR #65, `b8e610698`) | Baked into IPA. Bush's Best 53 SKUs included. Instant + offline lookup. Monthly cron via `scripts/build-upc-cache.mjs`. |
| ~~**B-56**~~ | ~~Scanner: no-match fallback to brand-name search~~ | ✅ done 2026-06-09 AM (`dcfa9dc5b`) | When OFF/UPCitemdb returns a brand but no parent match, primary "Search for [Brand]" button pre-fills query + jumps to Search tab. Yuka-style no-dead-end. |
| ~~**B-57**~~ | ~~Scanner: nav restructure — SCAN as bottom-nav middle slot~~ | ✅ done 2026-06-09 AM (`243f67051`) | Bottom-nav: [Top Picks] [Search] [**SCAN**] [Browse] [Library]. SCAN renders as a purple circular FAB-style button bumped above the nav line with drop-shadow. Account moved to top-right header (ti-user-circle icon next to Upgrade pill). Upgrade pill now opens Paywall directly instead of routing through Account tab. |
| ~~**B-58**~~ | ~~Scanner: UPCitemdb Tier-3 fallback API~~ | ✅ done 2026-06-09 AM (`dcfa9dc5b`) | Free trial endpoint (100/day per-IP, no key). Hit when OFF returns nothing. Wrapped in try/catch — silent on failure. |
| ~~**B-59**~~ | ~~Coverage-correction call-out in docs/landing~~ | ✅ done 2026-06-09 (commit `e9cf06bb8`) | Onboarding + Marketing Landing + meta tags + Twitter/og descriptions all updated: "graded" → "tracked" with explicit "top brands carry full grades" qualifier. TALK_TRACKS.md gains a "How many brands actually get a real grade?" Q&A with the honest 5K/1.1K/380 breakdown. Aron's voice marketing copy (trade-press, L-1/L-2/L-3 drafts, mailerlite drip) left for Aron's own honesty pass if desired. |

### Scoring schema expansion

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-12** | Tax category (ITEP, FTF, SEC 10-K parsing) | M · **post-launch** | ✅ **SHIPPED (display-only) via the Build-76 footprint, Jun 26** — both dead fetchers revived (`5d7db1a4f`); `itep-tax-merge` was *supposed* to write `enriched.tax`, but ⚠️ VERIFIED **0 company files carry `enriched.tax` on main today** — the visible tax datapoint is `enriched.secTax` (3,418 files); the footprint card reads `enriched.tax` then falls back to `secTax`. ITEP citation honored (Verified source: ITEP + `itep.org/corporate-tax-avoidance/`). **STILL OPEN:** wiring the tax category into SCORING (rebake + grade-drift, rule #16) is the un-done half — folds into B-23. ✅ **UNBLOCKED — ITEP approved (X-7, 2026-06-14).** PR #34 shipped the ITEP pipeline **dormant**; activate POST-launch (new scoring category = rebake — don't churn on launch day). ⚠️ Pre-reqs before going live: (1) **fix the fetcher 404** — it was 404ing on the latest XLSX so the mockup showed a placeholder **$4.4B**; pull ITEP's *real* Corporate Tax Avoidance data from `itep.org/corporate-tax-avoidance/`; (2) display effective rate + total profits + zero-tax-year count per company; (3) cite "Verified source: ITEP" + link the report on every datapoint; (4) wire the tax category into scoring → `rebake-scoring.mjs` → `finalize-bundle.mjs` + tests + grade-drift (rule #16). Commercial use OK per Amy. |
| **B-13** | Supply-chain labor extension (BHRRC + KnowTheChain) | M | Separate score from domestic Labor. `planned_scoring_expansion.md` |
| ~~**B-14**~~ | ~~Cruelty-free / animal testing flags~~ | ✅ done 2026-06-08 | Bird Friendly + AWA shipped in PR #45. |
| **B-15** | Tobacco / fossil-fuel financing flags | S | Easy boolean adds. (Firearms shipped in PR #20.) |
| **B-16** | BDS / Israeli military ties flags | M | Politically polarizing — skipped for v1. |
| **B-17** | CEO behavior dimension (Musk/Tesla case) | M | Opt-in dimension under political. SEC 8-K Items 5.02/4.02 (PR #36) lays groundwork. |

### Marketing / growth

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-18** | Reddit/HN "data pipeline deep dive" post | M | Fire ~1 week after PH launch as follow-up content |
| **B-20** | PostHog → daily KPI digest email | S | Built-in PH feature; subscribe |
| **B-21** | "Worst/Best of the week" auto-social content | M | Use `/public/data/weekly_changes.json` from Sunday digest |
| **B-41** | Set up Postiz self-hosted cross-poster | M | Railway free tier. Cross-platform to X/LinkedIn/Threads/IG/FB/Bluesky. Defer until post-launch traction. **(renumbered from duplicate B-27)** |
| ~~**B-42**~~ | ~~PostHog reverse proxy via subdomain~~ | ✅ done 2026-06-04 | `ph.trunorthapp.com` → `us.i.posthog.com`. **(renumbered from duplicate B-28)** |

### GEO (Generative Engine Optimization)

Goal: be the **cited source** when ChatGPT / Perplexity / Gemini / Claude / Copilot answer "is &lt;brand&gt; ethical?". TruNorth is GEO-native — 11k sourced, attributable brand pages are exactly what answer engines cite. Strategy doc context lives in this session's plan (3 tiers).

| ID | Item | Effort | State |
|---|---|---|---|
| ~~**G-1**~~ | ~~`/llms.txt` — canonical description + URL patterns + methodology notes~~ | ✅ done 2026-06-09 | `public/llms.txt` |
| ~~**G-2**~~ | ~~Expand AI-crawler allowlist (retrieval + training bots)~~ | ✅ done 2026-06-09 | `robots.txt`: +OAI-SearchBot, Google-Extended, Applebot-Extended, Amazonbot, CCBot, Bytespider, Meta, etc. **Decision taken: allow training bots too** (facts are public records; moat = freshness+UX). Flip any bot to `Disallow` to reverse. |
| ~~**G-3**~~ | ~~Entity disambiguation (vs TruNorth Federal Credit Union / Global / Advisors)~~ | ✅ done 2026-06-09 | Org + MobileApplication + WebSite JSON-LD `@graph` in `index.html` with `disambiguatingDescription`. |
| ~~**G-4**~~ | ~~Per-company structured-data upgrade — provenance per claim + TruNorth-authored Review (replaced self-serving AggregateRating) + `dateModified` + brand→Wikipedia `sameAs`~~ | ✅ done 2026-06-09 | `api/company-seo.js`. AI-synthesis sources filtered from all citations. |
| ~~**G-5**~~ | ~~Quotable, attributed summary line per brand (number + source + date)~~ | ✅ done 2026-06-09 | In `company-seo.js` body + Review `reviewBody`. |
| ~~**G-6**~~ | ~~Question-shaped pages: `/alternatives/<slug>` + `/compare/<a>-vs-<b>`~~ | ✅ done 2026-06-09 | `api/alternatives-seo.js` + `api/compare-seo.js` + vercel rewrites. ItemList + FAQPage schema. Sitemap now 30,637 URLs (11.3k company + 9.4k alt + 10k compare). |
| ~~**G-8**~~ | ~~AI-referrer tagging in PostHog (`ai_referrer`/`ai_engine` super-props + `ai_referral` event)~~ | ✅ done 2026-06-09 | `src/lib/analytics.js`. The "is GEO sending traffic?" KPI. |
| **G-7** | Third-party citations (highest-ROI GEO lever — engines weight Wikipedia/Reddit/news >> own site) | M, manual | **Ties to existing:** D-8 (Reddit launch posts), D-6/D-7 (IH/HN), B-18 (data-pipeline deep dive), L-10 (trade press). PH launch itself is a strong ingest signal. Post-launch: pursue a Wikipedia-worthy footprint. |
| ~~**G-9**~~ | ~~Fill `sameAs` entity links~~ | ✅ done 2026-06-27 | App Store + Product Hunt + LinkedIn added to both `index.html` Org `sameAs` (+ MobileApplication `installUrl`) and `TRUNORTH_ORG.sameAs` in `company-seo.js`; JSON-LD validated. Unblocked by launch (App Store URL now live). |
| **G-10** | Monthly GEO prompt audit — run the fixed prompt set, log cited-rate | S, recurring | Checklist at `/docs/geo-prompt-audit.md`. Baseline pre-launch (~0 expected); first real read ~30 days post-launch. Pairs with the 1st-of-month cron-health check. |
| **G-11** | Re-submit sitemap to GSC + Bing after deploy (now 30.6k URLs incl. alt/compare) | S | One-time after this ships. |

### Infra / ops

| ID | Item | Effort | Notes |
|---|---|---|---|
| **B-39** | Privacy page review for CCPA/GDPR pre-1k users | S | Already at `/#privacy`; lawyer review nice-to-have once revenue starts. **(renumbered from duplicate B-24)** |
| **B-40** | k6 loadtest run with real DAU baseline | S | Script + GH Action ready (manual dispatch). **(renumbered from duplicate B-25)** |
| ~~**B-35**~~ | ~~Country-level geo-block (RU/BY/CN/KP/IR/SY/CU/VE → 451)~~ | ✅ done 2026-06-05 | `middleware.js`. |
| ~~**B-36**~~ | ~~Pre-launch load test (single-IP)~~ | ✅ done 2026-06-07 | k6 reduced to 150 VUs (realistic single-IP). 78ms avg / 282ms p95. |
| ~~**B-36b**~~ | ~~Diagnose loadtest 94% failure rate~~ | ✅ done 2026-06-07 | Root cause: per-IP rate limit from single GH Actions IP. Not real-world. |
| **B-36c** | Distributed loadtest at 1000+ VUs (k6 Cloud / BlazeMeter) | M · $ | True 1000-concurrent stress needs many IPs. Defer until post-launch. |
| ~~**B-48**~~ | ~~Retire old `ofac-fetch.mjs` / `ferc-fetch.mjs` / `dol-whd-fetch.mjs`~~ | ✅ done 2026-06-09 (commit `aabe1afee`) | Audit confirmed 0 brands had `d.ofac` / `d.ferc` / `d.dolWhd` fields — old infrastructure was dormant. New `ofac-sdn-augment.json`, `ferc-enforcement-augment.json`, `dol-whd-violations-augment.json` exist (next step: wire writers into `apply-augments-to-companies.mjs`). |
| ~~**B-49**~~ | ~~Verify 44 new crons each ran successfully on schedule~~ | ✅ done 2026-06-09 | See `/docs/cron-audit-2026-06-09.md`. 39 healthy, 6 failing (ITEP 404, EU Transparency 404, FSIS 403, OpenSanctions/Wikirate PR-permission, Bonica DIME secret), 6 cancelled (normal). Top fix: enable "Allow GH Actions to create and approve PRs" in repo settings to unblock 2 crons in one toggle. |
| ~~**B-60**~~ | ~~Fix 15 empty `data/derived/*-augment.json`~~ | ✅ done 2026-06-10 | Root cause: Jun-9 rebake merged PR branches whose fetchers ran in sandboxed (no-network) envs. Fixed: climate-trace (dry-run snapshot shadowed real data → 183 companies; merge now rejects synthetic snapshots), corporate-prwire (dead Business Wire feed token → Philanthropy + PRN-CSR feeds, 2 brands), wikirate (Cloudflare 403 → fails loudly now; fixture-derived 16 companies until B-61), awa (site redesign → GeoDirectory API, 141 farms fetched, 0 catalog matches — small local producers only, documented in `_stats`), nlrb-voluntary-recognition (NLRB no longer publishes VR dispositions anywhere public — documented-empty, see B-62), factcheck-verdicts (legitimate zero + fixed verdict-ordering bug + "Facebook pages claimed…" brand-match FP). 9 intl-regulator seeds (ivass/cnmv/datatilsynet-dk/tietosuoja/fdpic/hk-compcomm/sbv/uae-sca/saudi-cma) were never broken — curated kernels intentionally empty, now marked `parked-empty-by-design` in `_stats`. |
| **B-61** | WikiRate API key | S · **Aron** | WikiRate's Cloudflare 403s all non-browser traffic. Create free wikirate.org account → set `WIKIRATE_API_KEY` GH Actions secret (workflow already supports it). Until then the quarterly cron fails loudly (by design) and the augment stays fixture-derived (16 companies). |
| **B-62** | NLRB voluntary-recognition proxy decision | S | NLRB removed VR dispositions from all public surfaces (verified Jun 2026). Only proxy in the data: "Withdrawal Adjusted" RC closures (~16–25/yr — Ace Hardware, UPS, Guitar Center, Albertson's this year), but the data doesn't label them VR, so using them is a product call. Source stays documented-empty until decided. |
| ~~**B-63**~~ | ~~NC-license cleanup — drop NC enrichment~~ | ✅ **DONE 2026-06-27** | **EXECUTED + pushed** (`1135c84d9` data strip + `393566d61` code cleanup): `git rm` the 6 CC-BY-NC augment files + surgically scrubbed NC narratives from 58 company files (`scripts/b63-strip-nc.mjs`); removed the 5 NC writer blocks + Fashion-Rev from apply-augments + disabled FR in the transparency composite. Clean **scrub + rebake only** (no apply/inherit → zero pipeline catch-up collateral): **22 grade changes, all NC-traceable** (banks up; GM subs/Meta/Tesla/FR-apparel down), 28/28 tests, **0 NC text remains**. ⏳ Legit fallback signals (climate-coalitions etc.) NOT re-surfaced — that's a separate deliberate full-pipeline refresh. — ORIGINAL CONTEXT: ⚠️ Trigger fired: paid Pro tier is LIVE (App Store-approved 2026-06-18) → CC-BY-NC sources no longer "in bounds" (audit 2026-06-22). **Decided (Aron 2026-06-22): drop the NC-only enrichment; do NOT buy OpenSanctions (€500–2k/yr — zero footprint: no committed `opensanctions-augment.json`, no `sanctions` key on any company file, cron was failing).** ⚠️ VERIFIED the "currently free" comment fix is NOT on main — it lives only on the unmerged `claude/wizardly-franklin-fb8226` branch (`fec17d0e2`); single-main consolidation dropped it, so `opensanctions-fetch.mjs:22` + `opensanctions-monthly.yml` still read "currently free … in bounds". (`opensanctions-merge.mjs` + `transparency-benchmarks-fetch` never carried the bad comment.) Cherry-pick `fec17d0e2` or redo. **Live NC cluster to remove (~30 brand-slugs, already in Build 75 binary + Vercel CDN — so removal lands in the NEXT build, can't un-ship 75):** net-zero-tracker · banking-on-climate-chaos · toxic-100 · influence-map (all → `environment`) · followthemoney-state/NIMP (→ `political`: atandt, amazon, koch-inc, walmart, comcast, exxon-mobil, disney) · Fashion Revolution (TWO points — standalone `fashion-revolution-augment.json`+writer AND the FR sub-score inside the `transparency` composite). KEEP `ccc-transparency-pledge` (public signatory roster = facts, not a hard NC blocker). **Runbook:** (1) remove the 5 NC WRITERS entries in `apply-augments-to-companies.mjs` + null out FR in `transparency-benchmarks-fetch.mjs` composite; (2) `git rm` the 5 NC augment files + `fashion-revolution-augment.json`; (3) scrub already-written narratives for affected slugs back to "No public record found." (apply already wrote them — re-apply won't un-write); (4) re-apply → `rebake-scoring.mjs` → `finalize-bundle.mjs`; (5) `node --test scripts/scoring-engine.test.mjs` (27 must pass) + `audit-grade-drift.mjs` (expect ~25 env/political shifts); (6) ship: deploy = web/CDN immediately, next iOS build updates the bundled index. **Clean (no action):** OFAC SDN, EU sanctions, EU Transparency Register, OCC `banking-deep`, Climate TRACE, CBP — all primary public-domain/gov. **Contingent:** CFTC/MAS are NC only if a `*_OS_URL` secret points at an OpenSanctions mirror (default path = fixture/primary gov source; `*_OS_API_KEY` reserved, unused). (Launch is past — safe to run; removal lands in the next iOS build.) |
| ~~**B-64**~~ | ~~Live cron failures — fix sweep (found 2026-06-22)~~ | ✅ **DONE 2026-06-27** | **✅ FULLY CLOSED (all crons fixed: news 06-26, the 3 weekly tails 06-27).** ✅ **(1) `news-rss-nightly` FIXED** — commit `72f7d71c5`, verify run #28206459040 **success** (23 min vs the old 60-min hang); **news refreshes nightly again** (confirmed by the Jun-26 nightly digest commit `b84ca5f9b`). Root cause was output truncation, NOT a schema mismatch: the forced tool-call hit `max_tokens` on 20-item batches → model returned `input:{}` (and no `stop_reason` was logged). Fix: max_tokens 4096→8192 · BATCH_SIZE 20→10 · throw+log on `stop_reason==max_tokens` · 20-min extract budget. ✅ Also fixed **`epa-tri-fetch`** (dead 404, `ec77b498b`) AND **`epa-ghgrp-fetch`** (same stale-EPA-path class, `5d7db1a4f` — both now activated; see B-65). Remaining live-cron failures from the Jun-22 sweep: (2) **`epa-echo-weekly`** cancelled at 62 min (timeout hang). (3) **`score-rebake-weekly`** + (4) **`cruelty-free-merge-weekly`** hard-fail in <25 s. *Context — already done Jun 22:* the **standalone `trunorth-pipeline` repo** (separate from TruNorth, GitHub `aronrosenfield-hash/trunorth-pipeline`) was **retired** — its 4 legacy crons (nightly/weekly/monthly/ai-narrate) had burned ~90 min/run to timeout with **no output since Jun 2** (root cause: `FEC_API_KEY` secret never set there → FEC `DEMO_KEY` → HTTP 429 storm across ~10k cos); all 4 now `disabled_manually`. Indeed/Apify scraper commit preserved on remote branch `indeed-apify-scraper`; local `~/Developer/hybrid-pipeline/` working copy (521 MB) safe to `rm -rf`. **✅ B-64 tail FIXED 2026-06-27 (evening, `e8df769c5`):** all three remaining crons addressed — (2) `epa-echo-fetch` got a 20s per-request `AbortSignal.timeout` + retry so a hung request can't stall to the 60-min cancel; (3) `score-rebake-weekly` got an `npm ci` step (the `minisearch` import was `ERR_MODULE_NOT_FOUND` — no install); (4) `cruelty-free-merge` now exits 0 (skip) instead of 1 when the quarterly raw files are absent. News + EPA TRI/GHGRP were already done. **B-64 now fully closed.** |
| **B-66** | App Store developer name → "TruNorthApp LLC" | M · **post-launch** | The Store seller/"developer" line shows **"Aron Rosenfield"** — it's the **individual** Apple Developer account's legal name (account-level, NOT a per-app field; can't be edited directly). To display **TruNorthApp LLC**: (1) get a free **D-U-N-S number** for the LLC (~1–5 days); (2) enroll a 2nd Apple Developer membership as an **Organization** under TruNorthApp LLC; (3) **App Transfer** the app (App Store id `6775301458`) from the individual account → the org (ASC → app → App Transfer; conditions: app must be live, no pending agreements, both sides' agreements accepted). Disruptive if rushed — do well AFTER launch settles; launching under the individual name is normal/fine. Aron requested 2026-06-22 (launch night). |
| ~~**B-67**~~ | ~~GJF Violation Tracker license gate + data strip~~ | ✅ **DONE 2026-06-28** | **EXECUTED + pushed** (display gate `7ea24e047` + data strip `7fc2941bc`): landed `SHOW_FEDERAL_PENALTIES=false` (gates the Federal-penalties callout / FED-RECORD line / labor badge + drops the VT source citation) and ran `scripts/vt-strip-gjf.mjs --apply` — removed **1,721 root `violationTracker` objects + 316 laborAPI + 3,424 source badges** + `vt-v2.json` + the `companies.js` VT data. Narratives left untouched (Aron's call) → **VERIFIED 0 grade drift**, 28/28 tests, live-verified (Duke Energy shows no callout). Residual: ~2,900 narratives still say "Violation Tracker" (intentional; a fully-clean pass re-sources from gov primaries). — ORIGINAL: ⚠️ Paid-app license exposure: the "Federal penalties" reveal data is **Good Jobs First** (NOT government primaries). **DISPLAY already gated off** 2026-06-27 (`SHOW_FEDERAL_PENALTIES=false`, commit `d19b9dc92`) + scraper quarantined. Data-strip script `scripts/vt-strip-gjf.mjs` **BUILT + sandbox-tested** (`039dbe769`) but **NOT YET RUN**. ⚠️ Both commits live on branch `claude/wizardly-franklin-fb8226` — ✅ VERIFIED **pushed to origin** (`039dbe7`), no PR, unmerged into main. (The earlier "local-only/unpushed" note was stale.) **Sequencing:** fire the strip ONLY AFTER the Build-76 enriched rebake commits + any B-23 rebake (narratives left untouched → grades don't move). Resume: "run the GJF data strip". |
| ~~**B-68**~~ | ~~Land parallel-session branches (PR #115 + GJF) onto main~~ | ✅ **DONE 2026-06-27 (evening)** | (1) ✅ **PR #115** (brand-parent-map Wikidata collision guard) **LANDED** via direct commit `af6abf34b` (E-11) — `scripts/lib/parent-map-guards.mjs` drops 12 bad Wikidata edges (asna→GM collisions, BlackRock/Invesco/Pershing shareholder artifacts); PR then closed. `gh pr list` now empty (all open PRs triaged — #114/#111 la-county dups + #105 paywall-flip closed too). (2) ✅ GJF branch `claude/wizardly-franklin-fb8226` pushed to origin (the `vt-strip-gjf.mjs` *run* is still pending = B-67/NB-4). (3) ✅ Branch divergence RESOLVED — repo consolidated to one clean `main`. |
| **B-69** | **FMCSA SMS — restore real data via Socrata rewrite** | S-M · **Aron's call** | The `ai.fmcsa.dot.gov/SMS/files/*.zip` bulk endpoints are **dead** (302 → HTML error page, found 2026-07-12). ✅ **Fetcher HARDENED** (PR #144, `c1e6a7324`): dead-download validation + `SourceUnavailableError` + env-overridable URLs + `--keep-last-on-fail` (monthly cron now soft-fails green instead of red-failing, keeping the last snapshot). ⚠️ But the only snapshot on disk (`data/raw/fmcsa-sms/2026-06.json`) is the **12-row synthetic preview — the real `--apply` fetch NEVER once succeeded.** **Restore = a fetcher REWRITE, not a URL swap:** data moved to the **DOT Open Data Portal (Socrata) `data.transportation.gov`** — SMS AB PassProperty `4y6x-dmck`, SMS C PassProperty `h9zy-gjn8`, Motor Carrier Census `kjg3-diqy` (all public, no auth, **CSV/JSON not ZIP**, no Akamai). Two files to concat (AB + C); **schema change affects grades** — old `*_percentile` (0-100, higher=worse) → new `*_measure` (raw) + `*_ac` (Above-Category alert flag), no percentile column, so `shapeRow`/`parseBasic` + the `labor.fmcsaSafetyScores` rollup need rework and the measure→grade mapping is a semantics decision. See memory `fmcsa-sms-moved-to-socrata`. |
| **B-97** | **Watchdog is blind to `cancelled` — timed-out crons never report** | **S · highest leverage of the three** | 🚨 Found 2026-07-27. `cron-health-daily.yml` collects failures with `gh api "…/actions/runs?status=failure&…"`. **GitHub reports a job killed by `timeout-minutes` as `cancelled`, not `failure`** — so a cron that times out every single week is invisible to the watchdog forever. Three pipelines have been dying this way since June with zero notification (**B-98**). **Fix:** query `cancelled` as well (or drop the `status` filter and filter client-side on `conclusion != "success"`), and separate "timed out" from "superseded by concurrency" in the issue body so genuine queue-cancellations don't cry wolf. **Pairs with the still-open B-70 follow-up** already logged in `data-pipeline.md`: add a **freshness assert** (fail if a pipeline's output file is older than N× its cadence) — that would have caught `gdelt.json`/`fra-incidents.json` *never existing*, which even a fixed conclusion-filter won't. A watchdog that only watches one of the three ways a cron can die is worse than none, because it reads as green. |
| **B-98** | **`faa-weekly` / `fra-weekly` / `gdelt-weekly` time out on every scheduled run** | M | 🚨 Found 2026-07-27. All three hit their `timeout-minutes` cap on **every** scheduled run since June (FAA 7 of 8 — the lone success was 2026-06-08; FRA 8 of 8; GDELT 9 of 9). Verified on FRA `2026-07-27`: `fetch` job **started 11:59, killed 12:29 = exactly `timeout-minutes: 30`**. Caps today: FAA 30 · FRA 30 · GDELT 90. **Two of the three have never written their output file — `public/data/gdelt.json` and `public/data/fra-incidents.json` do not exist**, and `gdelt-weekly` has **0 data commits, all-time**. FAA is partial: `public/data/faa-safety.json` exists and last refreshed 2026-07-20 (the run committed at 10:54, ~30 min in, immediately before the cap). **Decide per pipeline before spending time:** the FAA pattern says the fetch itself is simply slower than the cap (→ raise the cap, add per-request `AbortSignal.timeout` + resumable/incremental fetch, same medicine as the B-64 `epa-echo` fix); but for FRA and GDELT, which have produced **nothing in ~9 weeks**, the honest first question is whether they're worth keeping at all — **retiring them is a legitimate outcome** and cheaper than fixing them. Do **not** just bump the timeouts blindly; instrument first so a slow fetch is distinguishable from a hung one. |
| **B-99** | **USDA FSIS 403 — `fsis-weekly` + `fsis-dw-weekly` failing 5 straight weeks** | S-M | `scripts/fsis-fetch.mjs:132` throws `HTTP 403` on all 3 retry attempts; both FSIS crons have hard-failed every week 2026-06-29 → 07-27, and `fsis-dw-weekly` back to 06-22. ⚠️ **Not new — the 2026-06-09 cron audit (B-49) already recorded "FSIS 403" and it has simply never been fixed since.** These two *are* correctly reported as `failure`, so the *detection* works — but ⚠️ **CORRECTION 2026-07-28: watchdog issue #153 is no longer open. It was auto-CLOSED at 15:33Z on 07-28 with "✅ No failed runs in the last 24h" while FSIS is still broken** — see **B-100**. So this is a fix-the-source problem *and* the alert for it self-destructs weekly. 403 (not 404) points at bot-blocking/UA-or-header rejection rather than a moved endpoint — try a browser-like UA + `Accept` header first, then check whether FSIS recall data has moved to the openFDA/data.gov surface like FMCSA moved to Socrata (B-69). Apply the **B-69 hardening pattern** while in there: validate the download, throw a legible `SourceUnavailableError`, make the URL env-overridable, and add `--keep-last-on-fail` so a dead upstream keeps the last-known-good snapshot instead of red-failing weekly. |
| **B-100** | **The watchdog's 24-hour lookback ERASES every weekly-cron alert before anyone reads it** | **S · fix WITH B-97, same file** | 🚨 Found 2026-07-28 — **this is why B-99 sat unfixed for 5 weeks even though it was "correctly reported."** `cron-health-daily.yml` queries `created=>$SINCE` where `SINCE = now - 24h`, and in the `else` branch (`COUNT == 0`) it **closes the open issue**. A **weekly** cron fails once every 7 days, so the failure falls out of the 24-hour window the very next day → the watchdog opens an issue one afternoon and auto-closes it the next with "✅ No failed runs in the last 24h." **Verified on the real record:** issue **#153** opened `2026-07-27T15:49:42Z` (correctly listing both FSIS failures) and was auto-closed `2026-07-28T15:33:37Z` — 23h47m of visible life. **This is not a one-off: 11 watchdog issues have been opened and auto-closed since 2026-06-12** (#107, #108, #113, #117, #119, #130, #139, #145, #147, #151, #153), **every one of them closed within 1–3 days, and none of the underlying breaks was ever fixed.** Aron would have to be looking at GitHub inside a same-day window to ever see one. **Fix:** make the lookback match the *slowest* cadence being watched (7–10 days, not 24h), and **never auto-close** — close only when the specific workflow has since had a *successful* run. Together with **B-97** (`cancelled` blindness) this is the whole reason five dead pipelines read as green: one bug hides the timeouts, the other deletes the evidence of the failures. Fix both in the one file. **🔴 CONFIRMED AGAIN 2026-07-29:** the watchdog ran at 15:18Z, concluded `success`, reopened nothing and opened nothing — so **`gh issue list` now returns ZERO open issues while all five pipelines are still broken.** The absence of an alert is the normal resting state of this repo, which means **"no open watchdog issue" carries no information at all** and must never be read as health. ⚠️ **IMPORTANT SCOPE CORRECTION — 2026-07-31.** After three straight days of zero open issues, the watchdog **did fire correctly today**: `cron-health-daily` ran 15:28Z and opened **issue #154**, still **OPEN**, naming exactly the one genuine failure of the day (`ofac-sdn-daily`, **B-103**). So the watchdog is **not globally broken** — when a **daily** cron fails with a true `status=failure`, detection and alerting work end-to-end. **Both defects still stand and neither is weakened by this:** it remains blind to `cancelled` timeouts (**B-97** — FAA/FRA/GDELT are still dying unseen today), and its 24h lookback still erases **weekly** failures (**B-99**'s FSIS crons failed 07-27 and are correctly absent from #154 only because they fall outside the window — the exact erasure this item describes). **What today actually changes is the diagnostic rule:** an *open* watchdog issue is now proven to mean something real and should be acted on; an *empty* issue list still means nothing at all. Watch whether #154 gets auto-closed at ~15:30Z tomorrow — if `ofac-sdn-daily` goes green, the close is legitimate; if it 403s again and the issue closes anyway, that is a **new** and worse variant of this bug. |
| **B-101** | **39 bot data-refresh PRs are open and unmerged — sources' refreshes never reach production** | M · **Aron's call on the merge policy** | 📈 **UPDATED 2026-08-16: FLAT at 39 open PRs** (39 on 08-15, 38 on 08-12) — no net add today, and the oldest (#116) is now **48 days**. ⚠️ **New obstacle to the standing "drain by hand" policy: B-128.** 387 per-company files are now single-line JSON, whose diffs render as one changed line — so a reviewer literally cannot see what a bot PR did. **The hand-review that exists specifically to catch #134 and #165 is degraded until B-128 is fixed.** 📈 **Prior update 2026-08-15: the pile reached 39 open PRs** — **#166 `data(usda-fooddata): quarterly refresh`**, the first net add since 08-12, oldest (#116) then **47 days**. The queue grows on its own; it will not drain itself. 📈 **Prior update 2026-08-12: the pile was 38 open PRs, not 29** — new since the last count are #157–#165, and the oldest is still **#116 (2026-06-29), now 44 days old.** 🔴 **A SECOND landmine is now named: PR #165 (`data(fmcsa-sms)`) would publish SYNTHETIC safety data attributed to `ai.fmcsa.dot.gov` — see B-126.** Together with #134 (re-adds the CC-BY-NC augment B-63 stripped), that is two PRs in this queue that must NOT be merged, which settles the merge policy question: **this queue can only be drained by hand, PR by PR, and never in bulk.** 🚨 Found 2026-07-28. `gh pr list` shows **29 open PRs, all authored by `app/github-actions`, all `data/*` refresh branches**, oldest **2026-06-29** (#116). ⚠️ This **contradicts NB-8**, which recorded "all open PRs triaged to ZERO" on 2026-06-27 — the queue rebuilt within two days and nobody has drained it since. **25 distinct sources** are affected (la-county-restaurants ×5 dups, plus awa · better-cotton · bird-friendly-coffee · ca-prop65 · cornell-ilr · eu-transparency · fdaaa-trials · health-pharma-r3 · naag · oecd-ncp · opensanctions · powerbase · sbti · state-regulators ×2 · strike-map · supplements-verified · tco-certified · textile-exchange · un-bhr · usda-organic · wba-social · wob5050 · wwf-palm-oil). **Why it matters:** these crons **report success** — they did their job and opened a PR — but the data sits on a branch, so for ~25 sources the shipped catalog is as stale as the last time someone merged by hand. A cron that "succeeds" into an unmerged PR is a third way to be silently dead, alongside B-97 (`cancelled`) and B-100 (erased alerts). **⚠️ DO NOT bulk-merge.** At least one PR is a live license hazard: **#134 `data/opensanctions-monthly`** (2026-07-07) adds back `data/derived/opensanctions-augment.json` (+19,879 lines) — **the exact CC-BY-NC file class B-63 deliberately stripped** because the paid Pro tier put NC sources out of bounds. Others in the queue (powerbase, strike-map, cornell-ilr) warrant the same license check before merging. **Recommended sequence:** (1) close the 4 duplicate la-county PRs, keeping the newest; (2) close #134 and disable `opensanctions-monthly` outright — B-63 already decided that source is out; (3) license-check the remaining non-gov sources; (4) merge the clean gov/public-domain ones and re-count `index.json` for grade drift; (5) then decide the standing policy — either these crons commit direct to `main` like the other 40+ do, or a scheduled auto-merge drains the queue. Doing nothing means the queue keeps growing and the cadence table overstates coverage by another 25 rows. |
| **B-102** | **`senate-ld2-fetch.mjs` captures ~0.1% of the Senate LD-2 corpus — green cron, `"mode":"LIVE"`, wrong data** | **S — one-line fix**, then re-run the cron | 🚨 **Found 2026-07-30**, auditing the `lobbying-quarterly` cron's scheduled Jul-30 firing (`db079e17a`). **The bug:** `scripts/senate-ld2-fetch.mjs:127` ends pagination with `if (!data.next \|\| results.length < PAGE_SIZE) break;`. It requests `page_size: 250`, but the Senate LDA API **ignores that and returns 25 results per page while still setting `next`** — so `25 < 250` is true on the *first* page of every quarter and the loop exits immediately. **Evidence:** the run log reads `cumulative=25, 50, 75 … 200` (exactly 25/quarter across all 8 quarters) and the entire "live" 8-quarter fetch completed in **10 seconds**. Queried directly today, `lda.senate.gov/api/v1/filings/?filing_year=2026&filing_period=second_quarter&page_size=250` returns **`count: 25968`, `results: 25`, `next` set** — **2026Q2 alone has 25,968 filings and we stored 25.** **Why nobody caught it:** the workflow genuinely passes `--live`, so `senate-ld2.json` honestly self-reports `"mode":"LIVE"`, the cron concludes `success`, and `stats.total_filings: 200` reads like a real number instead of a truncation. **This is a FOURTH way a TruNorth cron is dead while reading green**, alongside B-97 (`cancelled`), B-100 (erased alerts), B-101 (unmerged PRs) — and the first where the *data file itself* attests to being live. **Blast radius is contained:** display-only, **0 grade moves** (verified per-slug against `index.json`), and currently **dark** — `App.jsx` has no reader for `enriched.political.lobbying`, so the 43 enriched brands render none of it. ⚠️ **But do not quote those LD-2 dollar figures externally or build UI on them until this is fixed and re-run** — they come from a 0.1% sample. ✅ **FARA, from the same cron, is fine** (543 → 556 active registrations). **Fix:** `if (!data.next) break;` — let the server's cursor be the sole termination signal and stop inferring "last page" from a short page. Then `workflow_dispatch` the cron and expect ~200k filings across 8 quarters (add a sanity assert against the API's own `count`, and check the runtime/rate-limit budget — `LDA_API_TOKEN` raises the limit ~15 → 120 req/min and is worth setting before the re-run). **Then audit every other paginated fetcher for the same short-page break condition.** |
| **B-103** | **`ofac-sdn-daily` 403s on the GitHub runner — but the source is alive and downloads fine from Aron's Mac** | S · **watch one more run before spending time** | 🚨 **Found 2026-07-31.** The daily OFAC-SDN cron **failed for the first time** (run `30609308711`, 06:19Z): `ofac-sdn-fetch failed: Error: OFAC SDN 403 Forbidden` at `scripts/ofac-sdn-fetch.mjs:110`. It had concluded `success` every day before this (07-27, 07-28, 07-29, 07-30 all green). **The source is NOT dead.** Probed from Aron's Mac during this sync, the same URL the fetcher uses — `https://www.treasury.gov/ofac/downloads/sdn.csv` — returns **302 → a presigned AWS GovCloud S3 URL → HTTP 200, 5,626,755 bytes** of real SDN CSV. So this is **not** an FMCSA-style endpoint migration (B-69); the 403 is being served to the *GitHub runner specifically*, which points at IP-based rejection or a failed presigned-S3 handoff on the runner's egress, not a moved or retired feed. ✅ **This is the GOOD failure mode and the pipeline behaved correctly:** the fetcher hard-fails (`exit 1`) *before* writing anything, so `data/raw/ofac-sdn/2026-07-31.json` was simply never created, the 51 prior daily snapshots are intact, last-good stays `2026-07-30.json`, and `data/derived/ofac-sdn-augment.json` was not touched — **no empty, synthetic, or truncated data shipped.** Contrast B-102, where the file lied about being live. **Do not fix blind.** The single most useful next fact is **tomorrow's 06:19Z run**: if it goes green, this was a transient presign/token hiccup and the correct action is *nothing but a retry*; if it 403s again, treat it as durable runner-IP blocking and fix in this order — (1) send a browser-like `User-Agent` + `Accept` (the current UA self-identifies as `TruNorth-OFAC-SDN/1.0`, an easy bot-block target, and this is the same first move B-99 needs for the FSIS 403); (2) add retry-with-backoff around the presigned redirect; (3) fall back to the `sanctionslistservice.ofac.treas.gov` export path. Also apply the **B-69 hardening pattern** while in there — env-overridable URL, legible `SourceUnavailableError`, `--keep-last-on-fail` — so a dead upstream soft-fails onto the last-known-good snapshot instead of going red daily. ✅ **Detection worked here:** because this is a genuine `failure` (not a `cancelled` timeout) on a *daily* cron, the watchdog caught it inside its 24h window and **issue #154 is open right now** — see the B-100 note. |

---

## 🎯 SCORING-FLAGS PRE-LAUNCH ROLLOUT — IN FLIGHT

3-PR sequence to ship `na` / `notDisclosed` / `_inferred` flags safely before Jun 23. Full plan at `/docs/pre-launch-scoring-flags-plan.md`.

| Step | What | State |
|---|---|---|
| PR-1 (#?) | Scoring engine audit | ✅ merged |
| PR-2 (#27) | Add `flags` field to data (no UI) | ✅ merged |
| PR-3 (#51) | UI rendering + grade math behind feature flag | ✅ merged (flag OFF) |
| **Toggle ON** | Flip `scoringFlagsEnabled` in `/data/_meta/feature-flags.json` | ⚠️ NEVER FLIPPED — still `false`; app launched with flags OFF. Post-launch call (E-1 / NB-7). |
| **App Store cut** | (historical) | ✅ Superseded — v1.0 Build 75 shipped & launched Jun 23 with flags OFF. |

---

## 🎯 DATA-DEPTH WAITLIST — STATUS POST-JUN-8

The 60-source ranked candidates from Jun 7 research. **Tier S sprint is COMPLETE** (DW-1 through DW-17 all shipped 2026-06-08). Many Tier A items also shipped today (see ✅ below). Remaining items deferred to post-launch.

### Tier S — Quick wins → **ALL SHIPPED 2026-06-08**

| ID | Source | PR |
|---|---|---|
| ✅ DW-1 | SBTi Target Dashboard | (merged) |
| ✅ DW-2 | WBA Social Benchmark | (merged) |
| ✅ DW-3 | Forest 500 | (merged) |
| ✅ DW-4 | 50/50 Women on Boards | (merged) |
| ✅ DW-5 | USDA Organic Integrity DB | (merged) |
| ✅ DW-6 | USDA FSIS Recall API | (merged) |
| ✅ DW-7..12 | OFAC SDN, BIS Entity List, FERC, DOL WHD, Energy Star, 1% for the Planet | #2 + augments |
| ✅ DW-13..17 | Disability:IN, CFTC, UK ICO, Singapore MAS, Canada Competition Bureau | #25 |

### Tier A — Shipped today

| ID | Source | PR |
|---|---|---|
| ✅ DW-19 | Carbon Majors (via Climate TRACE) | #48 |
| ✅ DW-26 | FMCSA Motor Carrier Safety | #42 |
| ✅ DW-29 | (covered by IIHS + FSIS combo) | #35 + ✅DW-6 |
| ✅ DW-33 | (groundwork — FDAAA Trials) | #43 |
| ✅ DW-39 | Certified Humane + AWA | #45 |
| ✅ DW-42 | Cornell ILR Labor Action Tracker | #40 |
| ✅ DW-44 | WWF Sustainable Palm Oil (RSPO partial) | #37 |
| ✅ DW-50 | NLRB voluntary recognition (positive labor) | #41 |
| ✅ DW-57 | Better Cotton Initiative | #45 |

### Tier A — Still open (defer to post-launch unless quick win)

| ID | Source | Effort | Why hold |
|---|---|---|---|
| DW-18 | InfluenceMap / LobbyMap anti-climate-policy scores | M | High-value greenwasher detection. Worth a sprint week 2. |
| DW-20 | EEOC Litigation Resolutions | S | TruNorth DEI has zero enforcement signal today. **High-leverage post-launch.** |
| DW-21 | IRS Form 990 (via ProPublica API) | M | Bumps charity % coverage from ~5% to ~50%. |
| DW-22 | KnowTheChain Forced Labor Benchmark | M | Apparel + ICT depth |
| DW-23 | Corporate Human Rights Benchmark | M | Non-US extractives + auto |
| DW-24 | BHRRC API upgrade (50k stories daily) | S | We have static; live API is daily refresh |
| DW-25 | Mighty Earth Deforestation Trackers (Soy + Cattle + Palm) | M | Satellite-verified Cargill/JBS/Bunge attribution |
| DW-27 | PHMSA Pipeline Enforcement | S | Note: data(phmsa) snapshot is already running daily — wire it up. |
| DW-28 | FTC Cases & Proceedings | M | US consumer-protection backbone |
| DW-30 | Australia ACCC + ASIC | M | 2026 ACCC priority = greenwashing enforcement |
| DW-31 | Banking on Climate Chaos | S | Annual June refresh |
| DW-32 | Ranking Digital Rights | S | 14 platforms; rare to score >50/100 |
| DW-34 | OCC + FDIC Enforcement | S | Chase/Wells/Citi enforcement |
| DW-35 | FCC Enforcement Bureau Forfeitures | S | TCPA + location-data fines |
| DW-36 | EWG Skin Deep beauty DB | M | Scanner UX win |
| DW-37 | EPEAT Registry | S | Scanner UX for electronics |
| DW-38 | Non-GMO Project Verified | S | Highest US seal after Organic |
| DW-40 | OU/OK/Star-K Kosher Search | M | Zero religious-dietary today |
| DW-41 | V-Label Certified (vegan/vegetarian) | M | International Leaping Bunny equivalent |
| DW-43 | ICIJ Offshore Leaks DB | M | Panama/Pandora/Paradise governance opacity |
| DW-45 | Regenerative Organic Certified | S | +22% YoY 2025 |
| DW-46 | Bonsucro (sugar) | S | Sugar is 2nd most ubiquitous commodity |
| DW-47 | Climate Label | S | Only consumer-facing carbon label |
| DW-48 | Cradle to Cradle Certified | S | Premium home goods |
| DW-49 | DOL TVPRA list (204 goods × 82 countries) | M | Cross-reference ingredient origins |

### Tier B — Specialist (DW-51..60) — defer indefinitely or pick selectively

DW-51 As You Sow Fund Lists · DW-52 BaFin (Germany) · DW-53 FCA (UK) · DW-54 KFTC (Korea) · DW-55 SEBI (India) · DW-56 S. Africa Competition Tribunal · DW-58 Demeter Biodynamic · DW-59 Bird-Friendly Smithsonian coffee · DW-60 GAP 5-Step Manufacturers.

**Recommendation:** Don't add anything else pre-launch. Lock the source list at 143 workflows for stability. Resume DW-18, DW-20, DW-21 the week after launch.

---

## 💤 PARKED — not on critical path

| ID | Item | Why |
|---|---|---|
| **F-1** | Migrate to Supabase / any DB | Static JSON + Vercel covers 100k+ free |
| **F-2** | OpenCorporates / Crunchbase / D&B | All paid, doesn't justify cost |
| **F-3** | Local Llama 3.1 8B narrative gen | ~89 hr per 10k brands; Haiku batch is cheaper + better |
| **F-4** | Multiple Claude sessions in worktrees | Only when work fans out across non-conflicting paths |
| **F-5** | Glassdoor employee ratings | ToS forbids scraping; Cloudflare-blocked; prior lawsuits. (PR #19 is the open vehicle — recommend close.) |

---

## 🤖 OPEN BACKGROUND AGENTS

| Agent | Status | Notes |
|---|---|---|
| Banner design fix (PR #63) | ✅ MERGED 2026-06-08 | Verified merged via `gh`; this section is historical. |
| (No other agents in flight) | | |

---

## ⏰ DATA-FRESHNESS CADENCE — 168 workflows now (+`enriched-augments-refresh.yml`, Jun-26)

> ⚠️ **This table is a SCHEDULE, not a health report** (flagged 2026-07-27). Five of the pipelines listed below have not delivered in over a month: **GDELT** (below) and **FRA** have produced **no output file at all — ever** (`public/data/gdelt.json` and `public/data/fra-incidents.json` do not exist on disk); **FAA** last refreshed 2026-07-20; **FSIS** + **FSIS-DW** have 403'd weekly since June. See **B-97 / B-98 / B-99**. ⚠️ **Also (2026-07-28): 25 further sources in this table refresh into a PR that is never merged** — 29 open bot PRs, oldest 2026-06-29, so the shipped data for those rows is as stale as the last hand-merge. See **B-101**. Verify against `gh run list`, `gh pr list`, **and** the output file's mtime before citing any row here as live.

### Daily (UTC)
News RSS (04:00) · Trending refresh (06:00) · OFAC SDN snapshot · MSHA refresh · PHMSA refresh · BIS Entity List · trending augments

### Weekly (Sunday UTC)
CourtListener (17:00) · CFPB (18:00) · NHTSA (19:00) · CPSC (20:00) · DOJ (21:00) · EPA ECHO (22:00) · SEC Litigation (23:00) · CISA KEV (Mon 00:00) · GDELT (Mon 02:00)

### Monthly (1st UTC)
GSA SAM exclusions · OSHA Severe Injury · CDC FoodNet · HHS OIG · OpenStates · CA AG · Climate TRACE · Net Zero Tracker · IIHS · NHTSA 5-Star · Strike Map · Cornell ILR · FMCSA SMS · DOL OFLC · WWF Palm Oil · TCO Certified · NSF/USP · Textile Exchange · EPA Green Vehicle · EPA SmartWay · NLRB voluntary recognition · SEC 8-K · FDAAA Trials · 50+ more added today

### Annual / quarterly (manual reminders)
Tier-1 re-narrate (quarterly Sept 1) · HRC CEI (Nov 15) · CDP A-List (Feb 15) · Banking on Climate Chaos (Jun) · 1% for the Planet sweep

### Human-action reminders (auto-scheduled)
- ~~Jun 9 – Jun 23 reminders~~ — all fired/past (ITEP follow-up, egregious rebalance, coverage prep, launch-eve, launch-hour). App launched Jun 23.
- Jul 1 (+monthly) — Cron health check — next upcoming.

---

## ✅ SHIPPED 2026-06-08 — 37 PRs (BIGGEST DAY)

### Scoring + neutrality (the critical pre-launch sweep)
- ✅ **#27** PR-2 Scoring flags — `flags` field in data
- ✅ **#51** PR-3 Scoring flags — UI rendering + grade math (flag OFF by default)
- ✅ **#28** Category taxonomy 34 → 18 (no <20, no Other)
- ✅ **#50** Category override map for firearm-retailing Retail brands
- ✅ **#54** Neutrality audit: marketing-PNG renderers (4 MAJOR fixed)
- ✅ **#55** Neutrality audit: derived augments + merge scripts (0 critical/major)
- ✅ **#56** Neutrality audit: outreach + user-facing docs
- ✅ **#57** Neutrality audit: marketing-site (2 CRITICAL fixed)
- ✅ **#58** Neutrality audit: rewrite biased UI strings in src/
- ✅ **#59** Neutrality audit: scoring-engine scan
- ✅ **#60** Neutrality audit: per-company narrative text
- ✅ **#62** Apply 6 human-approved fixes from audit sweep
- ✅ **8f9bb0c6f** OUTLET_BIAS canonical sync (news-rss-collect.mjs)

### Egregious rotation
- ✅ **#52** "5 Most Egregious" rotation engine + initial banners
- ✅ **#53** ITEP citation mockup for Amy Hanauer outreach
- ✅ **#61** Egregious 5 → 30 brands + design pass + brand logos
- ✅ **5defd6826** ITEP mockup: remove biased copy, neutral fact-only framing

### Data pipelines (33 new sources)
- ✅ **#1** DW-1..6 Tier-S waitlist (SBTi, WBA, Forest 500, 50/50, USDA Organic, USDA FSIS)
- ✅ **#2** DW-7..12 Tier-S (OFAC, BIS, FERC, DOL WHD, Energy Star, 1% for the Planet)
- ✅ **#25** DW-13..17 Tier-S (Disability:IN, CFTC, UK ICO, Singapore MAS, Canada Competition)
- ✅ **#6** OpenSanctions consolidated feed
- ✅ **#8** Brazil Lista Suja (forced-labor employers)
- ✅ **#10** NAAG Multistate Settlements (replaces 50 state AGs)
- ✅ **#11** Australia Fair Work Ombudsman
- ✅ **#12** UN B&HR communications scraper
- ✅ **#14** Privacy policy rule-based scoring at scale
- ✅ **#17** Animal welfare watchdog union
- ✅ **#20** Firearms industry corporate signals
- ✅ **#23** Full OpenFDA + EPA TRI carcinogen signals
- ✅ **#26** EU Transparency JSON→XML fix
- ✅ **#29** EPA SmartWay clean trucking
- ✅ **#31** Textile Exchange (RCS/GRS/RWS/RDS/RMS — 5 apparel certs)
- ✅ **#32** Net Zero Tracker
- ✅ **#33** EPA Green Vehicle + ZEV
- ✅ **#34** ITEP Corporate Tax Avoidance (dormant, license-pending)
- ✅ **#35** IIHS Top Safety Pick+
- ✅ **#36** SEC 8-K Items 5.02 + 4.02 (exec departures + restatements)
- ✅ **#37** WWF Sustainable Palm Oil Buyer Scorecard
- ✅ **#38** TCO Certified electronics sustainability
- ✅ **#39** NSF + USP supplements verification
- ✅ **#40** Cornell ILR Labor Action Tracker
- ✅ **#41** NLRB voluntary union recognition
- ✅ **#42** FMCSA SMS carrier safety
- ✅ **#43** FDAAA TrialsTracker (~5k pharma sponsors)
- ✅ **#44** Blue-chip coverage gap 84% → 97%
- ✅ **#45** Better Cotton + Bird Friendly + AWA
- ✅ **#46** DOL OFLC LCA H1B
- ✅ **#47** Strike Map USA
- ✅ **#48** Climate TRACE facility emissions
- ✅ **#49** NHTSA 5-Star Safety Ratings

---

## ✅ SHIPPED 2026-06-07 — 24 PRs (prior big day)

**Tier-S waitlist (DW-1..17 sub-PRs):** #4 brand-parent-map (138 → 4,625) · #5 USDA FoodData · #6 OpenSanctions · #7 WikiRate · #8 Brazil Lista Suja · #9 EU Transparency · #10 NAAG · #11 AU Fair Work · #12 UN B&HR · #13 CA Prop 65 (7,395 notices) · #14 Privacy NLP · #15 Industry carbon intensity (100% coverage) · #16 Transparency benchmarks · #17 Animal welfare union · #18 Exec political donations (4,468 cos) · #20 Firearms industry · #21 SEC DEF14A (Home Depot 2,026:1 pay ratio) · #22 EEOC DEI · #23 OpenFDA + EPA TRI carcinogens · #24 Corporate giving ($56.6B disclosed)

---

## ✅ EARLIER MILESTONES (compressed)

- **2026-06-03 — Massive data day**: 11 new sources in parallel agents (CFPB, NHTSA, CPSC, DOJ, EPA ECHO, SEC Litigation, CISA KEV, GSA SAM, OSHA SIR, CDC FoodNet, HHS OIG, OpenStates, GDELT). Total sources 20 → 46.
- **2026-06-03 — Walmart scoring fix**: computeScore + "Why hurt most" exclude no-record categories. Build 41.
- **2026-06-03 — A-1/A-2/A-3 audit deferrals shipped.**
- **2026-06-02 — Option A News pipeline LIVE end-to-end** (528-brand RSS → Claude Sonnet extraction → per-company `news[]` + `recent_events[]`).
- **2026-06-02 — Critical security incident**: 3 leaked API keys revoked + rotated; leak doc scrubbed from git history via `git-filter-repo`.
- **2026-06-02 — 528 hand-curated top-brand list** at `public/data/top-500-brands.txt`.
- **2026-06-01 — 25-agent audit shipped** (343 findings → 5 critical / 15 high / 35 medium fixed).
- **2026-06-01 — 4 critical bugs fixed** (white-screen `__skipMarketing`, `tn_isPaid` persistence, free-tier detail unlock, MailerLite key off bundle).
- **2026-06-01 — Waitlist pivot** (`PRO_WAITLIST_MODE` constant, founder pricing capture).
- **2026-06-01 — GDPR/CCPA delete button**, **quiz retake hydration**, **paywall cooldown** 4h → 7d, **email validation**, **/privacy 404 fix**, **/api/submit rate limit**, **tap-target a11y**.
- **2026-06-01 — iOS Universal Links** end-to-end (Build 33).
- **2026-05-31 — SEO foundation** (11,211-URL sitemap, JSON-LD, GSC + Bing verified).
- **2026-05-31 — Resend DNS** fully verified (SPF + DKIM + MX + DMARC PASS).
- **2026-05-31 — Capacitor bundled dist/** App-Store-ready + ~16 TestFlight builds.
- **2026-05-28 — 6,050-company expansion** + full neutrality overhaul.

---

## 📌 META

**ID hygiene cleanup (2026-06-08):** The doc had duplicate IDs from cross-section reuse. Resolved as:
- `B-24` data (AllSides) kept; infra Privacy moved → `B-39`
- `B-25` data (BBB, done) kept; infra k6 loadtest moved → `B-40`
- `B-27` data (CA AG, done) kept; marketing Postiz moved → `B-41`
- `B-28` data (Skip state AG) kept; infra PostHog proxy moved → `B-42`
- Added `F-5` for Glassdoor parking

**Update protocol:** Claude updates this file at the end of every working session.

**Resume phrases:**
- "Open the backlog" → I summarize the top sections
- "What needs a decision?" → I list the 🔴 section
- "Work on **L-3**" → I start that specific item
- "What's blocked?" → I summarize ⏸️
- "Add task: [description]" → I add with a fresh ID

**Source files this consolidates:**
- `~/.claude/projects/.../memory/MEMORY.md` + linked roadmap/launch/parked docs
- `/docs/pre-launch-scoring-flags-plan.md`, `/docs/scoring-engine-audit.md`
- `/docs/data-coverage-analysis-2026-06-07.md`, `/docs/cron-quality-audit-2026-06-07.md`
- `/docs/L-3-email-blast-checklist.md`, `/docs/trade-press-pitches.md`
- `/docs/neutrality-audit/*` (7 audit reports)
- `/docs/research/*` (4 research dossiers)
- `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` + `/docs/producthunt/PROMO_COPY.md`
- `/docs/ANDROID_LAUNCH_PLAN.md`, `/docs/payments-integration-plan.md`
- `/docs/TruNorth-TestFlight-Setup.docx`, `/docs/app-store-submission.md`


## R7 source research (2026-06-11)

**R7 WIRING STATUS (same day, PM):**
- ✅ **OFCCP EEO-1** — converted (56,649 rows → 20,406 companies, ≥25-employee floor) and merged: **767 brands matched, 722 DEI narratives** (facts only — no verdict enum derived from demographics, per neutrality rules). 52 MB XLSX gitignored; derived JSON committed. Static source, no cron.
- ✅ **DHS UFLPA + CBP WRO** — fetcher live (160 entities + 65 orders); quarterly cron. 1 brand match: **giant-bicycles** (Giant Mfg Co. Ltd WRO, eff. 9/24/2025) via reviewed-alias map; labor narrative + `forcedLaborListed` sidecar now trigger the forcedLabor dealbreaker in the engine.
- ✅ **SAM.gov Exclusions** — daily V2 extract via the fileextractservices download route (direct S3 403s); 6,833 active firm exclusions. **REVIEW-QUEUE GATED** after the first pass produced name-collision false positives ("AMERICAN INTERNATIONAL INC" ≠ AIG; a debarred "TARGET CORPORATION" ≠ the retailer — both auto-writes reverted). Aron reviewed 2026-06-11: APPROVED royal-caribbean-cruises (EPA 1998), huawei-technologies (USAF 2019), gulfport-energy (EPA 2014); REJECTED target + AIG (name collisions, denylisted). Queue empty. Monthly cron.
- ✅ **USAspending** — existing Jun-7 source extended with `--public-cos` mode covering ticker/cik catalog companies (EDGAR mid-caps included), resumable 90-day cache; quarterly cron already existed.
- ⏸️ **FTC Legal Library** — Akamai hard-403s every path from this network (default-UA trick fails here, unlike dol.gov). Retry from GitHub-runner IPs or needs browser-grade fetch. Deferred.
- ⏸️ **USDA APHIS AWA** — public search is a JS Salesforce app; no bulk CSV found at probe time. Needs browser-grade fetch or the Lightning API reverse-engineered. Deferred.
- ⏸️ **Illinois SOS EEO** — Akamai-blocked POST form (known from research). Deferred.

Deep-research sweep (105 agents, adversarially verified) found **8 license-clean $0 sources** — full dossier: `docs/research/data-sources-r7-deep-research-2026-06-11.md`. Headline: **per-company DEI at scale is finally unlocked** — the DOL OFCCP FOIA library completed its court-ordered release (Feb 25, 2026) of Type 2 EEO-1 workforce demographics for federal contractors FY2016-2020; the 52 MB consolidated XLSX (56,650 rows, CONAME/DUNS + ~200 demographic columns) was verified downloadable today. Build order: (1) OFCCP EEO-1 ingest → dei, (2) USAspending per-recipient API → new-mid-cap enrichment (keyless, no rate limits), (3) FTC Legal Library 6,086 cases → privacy, (4) CBP UFLPA Entity List + WRO/Findings → forcedLabor/childLabor flags, (5) SAM.gov Exclusions bulk → debarment, (6) USDA APHIS AWA → animals, (7) Illinois SOS EEO filings → dei supplement. All US-federal = public domain, no commercial restriction. Watch-out: Akamai bot-blocking on dol/ilsos/cbp/ftc — default curl UA worked where spoofed Chrome got 403. Animals at 1,000+ brand scale remains unsolved.
