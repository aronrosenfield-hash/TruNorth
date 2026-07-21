# TruNorth Backlog

> **Single source of truth.** Claude keeps this current. You can edit it directly anytime — edits are respected.
>
> **How to use:** Open this file → say "let's do **L-3**" or "what's blocked?" or "what's the next highest-leverage item?"
>
> **🟢 LAUNCHED — Jun 23, 2026 · 2:01 AM CDT** (App Store · id `6775301458` · `https://apps.apple.com/app/id6775301458` · PH launched). **CURRENT LIVE BUILD = v1.1 Build 81** (approved 2026-07-08, released Manual **2026-07-14**) — it superseded v1.0 Build 75, which was live Jun 23 → Jul 14. **Next iOS ship = Build 82.** *(The 2026-06-11 "date is soft, get it right" call held through the Compass redesign; the experience shipped on the locked date. Go-live runbook: `docs/LAUNCH_DAY.md`.)*
>
> **Last updated:** 2026-07-20 (daily doc-sync) — **the biggest work day since 07-04. 4 human commits, all on `main`; no iOS build shipped (Build 81 still live, next ship = 82).** **`e42f1f29b` v1.2 review Batch A** (NOT `[skip ci]` → **web-deployed via Vercel**) — 4 critical defects + the whole 27-agent / 155-finding punch list minted as **B-70…B-93 + QW-01…QW-16** (see the section below) · **`fd1e67250` Android scaffold committed + tracked** (QW-14 ✅ — 54 files, `applicationId com.trunorthapp.app`, minSdk 24 / SDK 36, `*.jks`/`*.keystore` pre-ignored; **no Play listing, no Android build, key + App Links + Back-stack still unconfigured — B-74/B-75/B-93**) · **`6102eba31` B-94** — regenerated the false weekly-changes feed + added the 2% snapshot-drift guard · **`fd84d7e81`** — hand-restore of cron output clobbered by a prior doc-sync commit. **⚡ The B-70 cron fix WORKED and self-healed the same day:** `trunorth-bot` ran the weekly rebake at 16:12 UTC (`236fe1c57`) and **moved `index.json` for the first time in 5 weeks**. **CATALOG COUNT UNCHANGED BUT THE CURVE MOVED — re-counted from `index.json`: 12,833 tracked / 3,057 graded, dist now A 64 · B 1,188 · C 1,050 · D 521 · F 234** (was A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?" unchanged. That's the **33 real changes: 19 drops, 14 rises** (Tesla Energy D→B, Buick/GMC/Hummer F→C) — 5 weeks of accumulated source movement landing at once. **Scoring model R7.1 unchanged** (no threshold or formula edits). Rest of the day = 10 routine automated `[skip ci]` data crons (EPA-ECHO · SEC-litigation · CISA-KEV · BIS-entity-list · news nightly · PHMSA · MSHA · FAA · NTSB + the rebake). ⚠️ **PROCESS BUG FOUND IN THIS TASK ITSELF:** the 07-20 07:38 doc-sync commit `b0e2adba0` staged far more than `BACKLOG.md` and **deleted 34,212 lines of that morning's cron output** (the `data/raw/bis-entity-list/2026-07-20.json` snapshot + 5 merge logs + company files); Aron had to revert it by hand in `fd84d7e81`. The daily doc-sync now stages **`BACKLOG.md` and nothing else** — no `git add -A`, no `git add .`, no `git commit -a`. — **EARLIER 2026-07-19 (daily doc-sync) — **no human commits that day (07-19 CST); this commit also persists the prior 07-18 sync, which was written but never committed.** The day = **9 routine automated `[skip ci]` data-cron commits** (OFAC-SDN daily · cruelty-free weekly · news nightly RSS digest · CourtListener lawsuits weekly · CFPB weekly · CPSC recalls weekly · DOJ weekly · EPA-ECHO weekly · SEC-litigation weekly) — all display-only, **none touched `public/data/index.json`.** Re-verified by counting the index: catalog **UNCHANGED — 12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?"**; scoring **R7.1**; last human commit still 07-12's PR #144. The only pending human work remains the uncommitted v1.2 plan doc (`docs/research/v1.2-big-update-plan-2026-07-18.md`) — see "NEEDS YOUR DECISION" below. — **EARLIER 2026-07-18 (daily doc-sync) — **🟢 v1.1 Build 81 is LIVE on the App Store (released 2026-07-14).** ⚠️ **STALE-STATUS CORRECTION:** this file said "Build 81 Waiting for Review" from 07-07 through 07-12 — Apple **approved it 07-08** and Aron **released it (Manual) on 07-14**. v1.1 now supersedes v1.0 Build 75 as the live build; **next iOS ship = Build 82**. (Re-verified in `project.pbxproj`: `MARKETING_VERSION 1.1` / `CURRENT_PROJECT_VERSION 81`.) The doc-sync did not run 07-13 → 07-17, which is why the launch sat unrecorded here for 4 days. **No human commits 07-13 → 07-18** — last human commit remains 07-12's PR #144. The 6-day gap = **21 automated `[skip ci]` data-cron commits** (OFAC-SDN daily · news nightly · PostHog trending nightly · weekly FDIC/FINRA/NRC/OCC · monthly climate-trace · quarterly oecd-watch + one-percent-planet). Today = OFAC-SDN (`b71d6f5dc`) + news digest (`7a91e1b84`). **Catalog UNCHANGED — counted from `index.json`: 12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235), 9,776 "?"**; scoring **R7.1**. 📋 **Today's only human work is a PLANNING DOC, uncommitted: `docs/research/v1.2-big-update-plan-2026-07-18.md`** — the v1.2 "Reach & Coverage" master plan (Aron's ask: +50 sources, +5,000 companies, Android, big upgrade). Key reframe: measure **graded** coverage (3,057 → 7,000–8,000), not tracked, because the real problem is the **9,776 "?" wall (76%)**. Five workstreams: A Coverage Engine (GLEIF/entity-resolution first, then license-clean gov primaries, then B-23 dark-data wiring) · B Android · C marquee "Ask TruNorth" · D push + widget retention · E claims/QA honesty. **Nothing built; no new BACKLOG IDs minted on purpose — the doc ends with 8 decisions awaiting Aron** (see "NEEDS YOUR DECISION" below). — **EARLIER 2026-07-12 (daily doc-sync):** *[status line superseded above]* **that day's ONE human commit: PR #144 (`c1e6a7324`, merged 11:31 CDT) — FMCSA SMS fetcher hardening** (first human commit since 07-07's widget-drop). Scope is the monthly `fmcsa-sms` cron infra ONLY (`scripts/fmcsa-sms-fetch.mjs` + `.github/workflows/fmcsa-sms-monthly.yml` + test) — **no scoring, no web deploy, no iOS, no grade/count drift.** The dead `ai.fmcsa.dot.gov/SMS/files/*.zip` endpoints 302 → an HTML error page that `unzip` choked on ("End-of-central-directory signature not found"); `downloadTo()` now validates content-type / sub-10KB size / ZIP magic bytes before unzip and throws a legible `SourceUnavailableError`, URLs are env-overridable (`FMCSA_PASS_PROPERTY_URL` / `FMCSA_CENSUS_URL` → republished location = secret change not code change), and new `--keep-last-on-fail` keeps the last-known-good snapshot + exits 0 with a `::warning::` instead of red-failing monthly. **Real-data restore still needs a Socrata rewrite → newly tracked as B-69** (DOT Open Data Portal serves CSV not ZIP + `*_measure`/`*_ac` not `*_percentile` → grade-semantics change, Aron's call). Rest of the day = routine automated data crons only (`[skip ci]`): OFAC-SDN daily (`edd1ae39f`) · cruelty-free weekly LB+PETA merge (`83c7f15dd`) · news nightly RSS digest (`aa12bf0e5`, 19 companies — display-only) · PostHog trending (`6274871dd`). Catalog UNCHANGED — re-verified from `index.json`: **12,833 tracked / 3,057 graded (A 71 · B 1,180 · C 1,037 · D 534 · F 235)**; scoring **R7.1**. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-10 (daily doc-sync) — **🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 "Waiting for Review" at Apple (widget-less; Manual release).** **No human commits since 2026-07-07's widget-drop; 07-08 → 07-10 = automated data crons only** (`[skip ci]`). 07-10: OFAC-SDN daily (`7e90346b7`) · news nightly (`b39d6fac3`, 19 companies — display-only) · PostHog trending (`816d96eaf`). 07-09: CBP UFLPA + WRO forced-labor refresh (`47d9719e5`) · news · OFAC · trending. ⚠️ **CORRECTION — the graded catalog is now `12,833 tracked / 3,057 graded` (A 71 · B 1,180 · C 1,037 · D 534 · F 235), NOT the `2,839` the 07-04→07-08 headers claimed.** The +218 jump was **not** a human rebake: the **07-07 `bad32a65a` commit — labelled "data(sam): exclusions refresh" but which actually attached `csc.execPay` (SEC executive-pay governance) signals to ~216 previously-ungraded public companies** — surfaced each at score 50 → grade **B** (e.g. Abercrombie `?`→B); the 07-09 CBP forced-labor refresh added +1 D. **So a `[skip ci]` data-cron DID move grades** — the "no grade/count drift" note the 07-07/07-08 doc-syncs put on `bad32a65a` was wrong. These are thin single-signal B's at the **B≥50** floor (E-9 single-signal cap-at-B; **scoring model R7.1 itself unchanged, thresholds untouched**). All on `main` via `[skip ci]` → not web-deployed, not in Build 75 or the pending Build 81. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-08 (daily doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 "Waiting for Review" at Apple (widget-less; Manual release).** **Today = routine automated data crons only** (`[skip ci]`, no grade/count/build/code drift, no human commits): **OFAC-SDN daily** snapshot + augment refresh (`709d47f46`) · **news nightly** RSS digest + AI extraction + per-company merge (`dbf400a88`, 14 companies touched — display-only news, no grades moved) · **PostHog trending nightly** (`a0c7f50e1`). Catalog unchanged (~12,833 tracked / 2,839 graded) *[SUPERSEDED — the 07-07 SAM/execPay rebake had already lifted it to 3,057; see 07-10]*; scoring **R7.1**. Build 81 stays awaiting Apple's verdict → on approval Aron clicks "Release" (Manual). — **EARLIER 2026-07-07 (evening doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 Build 81 SUBMITTED to App Review (widget-less).** ⚑ **DECISION 2026-07-07: the Home-Screen widget is DROPPED from Build 81; v1.1 ships WITHOUT it.** Commit `7703c1602` **decouples `TruNorthWidgetExtension` from the App target** (removed from the Embed Foundation Extensions phase + target dependency) so the Build 81 archive contains **no `.appex`** — the widget target and its Swift sources are **preserved for Build 82** (de-scope, not deletion; App Group entitlement, `trunorth://` scheme, `writeWidgetSnapshot()` left as harmless no-ops). The same commit **also lands the previously-uncommitted deployment-target fix 26.5 → 15.0** on both widget configs (moot for 81, kept correct for 82) → the earlier doc-sync's "UNCOMMITTED fix in the working tree" warning is now **RESOLVED** (working tree clean of pbxproj). Verified `xcodebuild -sdk iphonesimulator` → **BUILD SUCCEEDED with 0 widget compiled** → Build 81 is **single-target again, so `ship:ios` works** (no Organizer archive needed). Widget-less Build 81 → **Manual release** (Aron clicks "Release" after approval). See [[widget-deployment-target-gotcha]]. **Rest of the day = routine automated data crons only** (`[skip ci]`, no grade/count/build drift): OCC weekly · FDIC weekly · FINRA BrokerCheck weekly · NRC weekly · OFAC-SDN daily · news nightly · PostHog trending nightly · firearms-industry quarterly seed + FEC · SAM exclusions. Catalog unchanged (~12,833 tracked / 2,839 graded); scoring **R7.1**. — **EARLIER 2026-07-07 (morning doc-sync):** at that point the 26.5→15.0 widget fix was still UNCOMMITTED and Build 81 was framed as "awaiting Aron's Xcode Organizer archive" — both **SUPERSEDED** by the evening widget-drop above. — **EARLIER 2026-07-06 (daily doc-sync) — 🟢 LIVE (v1.0 Build 75) + v1.1 IN FLIGHT (Build 81 still awaiting Aron's Xcode Organizer archive; no iOS change that day).** Today's ONLY human commit: **SEO Soft-404 fix** (`c383cf3d4`, **NOT `[skip ci]` → web-deployed via Vercel**). `/company/<slug>` used to answer HTTP **200 with the generic SPA shell** for brands that don't exist, so Google Search Console flagged stale/renamed slugs (deduped Exxon subsidiaries, `estée-lauder→estee-lauder`, etc.) as **Soft 404** with no signal to drop them. Now `api/company-seo.js` returns a **hard 404** on a confirmed-missing data file (new `confirmedMissing` flag), but **still 200 on a transient fetch failure** so a real page is never deindexed over a blip; SPA still renders its not-found UX on the 404 body. Everything else was routine data crons (no grade/count drift): SEC-litigation weekly · CISA-KEV weekly · OFAC-SDN daily · BIS-Entity-List weekly · EPA-ECHO weekly · PHMSA weekly · MSHA weekly · news nightly · PostHog trending nightly. Catalog unchanged (~12,833 tracked / 2,839 graded); scoring **R7.1**. — **EARLIER 2026-07-05 (daily doc-sync) — **🟢 LIVE (v1.0 Build 75) + v1.1 IN FLIGHT. iOS binary on main is now `MARKETING_VERSION = 1.1`, `CURRENT_PROJECT_VERSION = 81`** (verified in `project.pbxproj` — BOTH the App and the new widget target). ✅ **NB-10 DONE — the widget Xcode target is now WIRED** (`68a518585`): Aron created the `TruNorthWidgetExtension` target in Xcode; App Group `group.com.trunorthapp.app` added to BOTH `App/App.entitlements` + the new `TruNorthWidgetExtension.entitlements`; the New-Target template had clobbered `TruNorthWidget.swift` with the emoji sample → the real "Your Basket" widget was restored, the bundle trimmed, the generated Control widget neutralized, the orphaned `TruNorthWidget.entitlements` removed. **Verified on iPhone 17 Pro sim: builds → signs → installs → renders** the empty state ("Scan a product for its grade"); populated/data state not yet confirmed. Then **bumped to Build 81** (`f30acd7be`, both targets `CURRENT_PROJECT_VERSION = 81`). ⚠️ Build 81 = the FIRST build carrying the widget → **archive via Xcode Organizer, NOT `ship:ios`** (the script isn't multi-target-aware yet: manual export map at `ship-ios.sh:203` lists only the app profile; the post-`cap sync` entitlements re-inject at `ship-ios.sh:124` isn't target-aware). Widget is NOT in the already-shipped Build 80 — it lands in Build 81 (repo-bumped, **awaiting Aron's Organizer archive**). Both commits `[skip ci]`, unpushed at doc-sync start. Today's data crons (routine, no grade/count drift): MAS-Singapore monthly · DOL-OFLC-LCA quarterly H-1B LCA · SEC-ecd quarterly execPay · TX-TCEQ monthly · eviction-lab monthly · news nightly · cruelty-free weekly · OFAC-SDN daily. — **EARLIER 2026-07-04 (daily doc-sync) — Builds 79 → 80 both shipped via `ship:ios` — `d11cc91ad` = 79, `5ab4cfd58` = 80, + SPM manifest `bc9cd9743`; **next ship = Build 81**). Build 80 = the **diligence mega-batch** (retention Tiers 1–3 + Build-79 device-bug fixes) + the **charity re-grade** (`8ce735f7e`) + the **Home/Lock-Screen widget scaffold** (`7f3886bce`). ⚠️ **Widget Xcode target NOT wired yet** (`docs/widget-setup.md`) → Build 80 has NO widget; `ios/App/TruNorthWidget/*` inert until wired. **Aron is device-testing Build 80 before an App Store submission** (Builds 76–80 = v1.1 TestFlight track, not yet submitted for review; v1.0 Build 75 stays the LIVE App Store build). ✅ **Charity sub-cap tightened 85→65** (`8ce735f7e`) — unquantified `positive`/`active_giving` charity (no IRS-990 total) was a flat 85 (~46% of charity scores, upside-only) floating polluters toward a B; now 65 ("documented but unquantified"). Rebaked all company files: **133 grades moved (121 down, 12 up)**; dist A 77→70 / B 1017→964 / C 1017→1037 / D 492→533 (F 235); Tesla C→B (demo grade updated); catalog now **12,833 tracked / 2,839 graded**; 28/28 + 9/9 guards. ✅ **Retention Tiers 1–3** — camera-denied "Search by name instead" (`aa6c3fa02`, T1) · empty-basket watch card + deletable watches (`91cc38483`, T2) · share-the-grade receipt + de-dup Share (`8e067bcd9`, T3) · ungraded "?" brands don't consume the free daily view (`7f17a7be1`). ✅ **Build-79 device-bug fixes + a11y** — C renders bone-gray, distinct from D's amber (`f05b7d563`) · "Resume the Match · N of 11" on a saved draft (`267811a55`) · cross-pressured users not mislabeled Progressive/Conservative (`eddbc0f3f`) · account button 40→44px (`e33901223`) · logo tiles show initials while loading (`e4b844941`) · padlock removed next to visible grade (`ef274e38c`) · Ledger large-amount overflow → froze/zoomed screen FIXED (`5fd494cb7`) · ExxonMobil division subs folded into parent (`2060d5981`) · saved-brand row `div role=button` not button-in-button (`b1b378789`). ✅ **Security headers** HSTS + X-Content-Type-Options + X-Frame-Options + Referrer-Policy (`e2ee985ec`, **NOT skip-ci → web-deployed**). ✅ **Copy** — paywall/FAQ stop contradicting the free experience (`ba6f14c27`) · Match standardized to "45 seconds" (`6e874d0e2`) · placeholder testimonials pulled from landing (`aa553ed70`, Aron OK'd) · "Software & Technology" dropped from daily shelf lead (`744a843a7`). Scoring model **R7.1** (charity sub-cap only; thresholds unchanged). — **EARLIER 2026-07-03 (daily doc-sync):** the "▶ NEXT BUILD (Build 79)" framing below is SUPERSEDED — Builds 79 + 80 both shipped 2026-07-04. The 2026-07-02 four-team diligence review's fixes landed on `main`** (all `[skip ci]` → NOT web-deployed, NOT in a submitted App Review build; Aron tests first). ✅ **All 5 CRITICAL diligence items fixed** (`1a7430b73` + `12f300c15`): **C1** un-quizzed "?" wall → real baseline grades at 8 badge sites (`computeScore(co,null)` already returned baked `co.overall`; **reverses the 2026-06-13 quiz-gate**); **C2** ExxonMobil triplicate deduped → `exxon-mobil` D canonical (`scripts/dedup-brands.mjs`) + client-side slug-alias resolution so `/company/exxon` resolves not 404, new ui-guards test bans divergent-grade name-dups — **catalog 12,839→12,836 tracked / 2,837 graded, 0 drift**; **C3** honest count reframe → "2,800+ fully graded" leads everywhere + landing/onboarding demo grades corrected (Costco B / Tesla C / Shein C, guard-locked); **C4** "one-time Pro upgrade" → accurate auto-renewing subscription copy (App Store 3.1.2/FTC); **C5** server-side entitlement — `isPaid` reconciled from RevenueCat `hasProEntitlement()` on boot + foreground resume (was 100% client-side localStorage = free-unlock/never-revoke leak; **verify Sandbox purchase/cancel in Build 79**). Also H9 purchase-error color + Methodology footer anchor. ✅ **Retention (Tier-3):** "Notify me when we grade this" opt-in on ungraded detail cards (`98c945556` — generalized `SuggestBrandButton`, source `brand_grade_notify`, turns a "?" dead-end into a return event). Scoring **R7.1 unchanged.** Full review: `docs/research/v1.1-diligence-review-2026-07-02.md`. — **EARLIER 2026-06-27 (evening doc-sync) — 🟢 LIVE: TruNorth v1.0 (Build 75) on the App Store + Product Hunt** (id `6775301458`). **▶ NEXT-BUILD worklist cleared almost to the floor this evening** — of the 9 pre-ship items, **6 are now ✅ DONE**: **NB-3/B-63** CC-BY-NC strip EXECUTED (`1135c84d9`/`393566d61`/`f37d05de8` — 6 NC augments removed + 58 narratives scrubbed, 22 NC-traceable grade changes, 28/28 tests, 0 NC text remains) · **NB-5/B-64** 3 weekly crons fixed (`e8df769c5` — score-rebake `npm ci`, cruelty-free skip-on-absent, epa-echo per-request timeout) · **NB-6/E-6** source-count reconciled to one **200+** headline + `SOURCES.md` regen (`c60d58ebc`/`306b3ea33`) · **NB-8** all open PRs triaged to ZERO (`gh pr list` empty — #115 parent-map landed via `af6abf34b` (E-11) then closed; #114/#111 la-county dups closed; #105 paywall-flip closed = keep waitlist) · **NB-9** Fed-Reserve card lit (`c25dea5dc` — `fed-reserve-enforcement.json` committed + 23 company files carry `enriched.fedReserve`; ⚠️ this **CORRECTS** the older "fed-reserve absent / sub-card dark" note below) · **B-23/NB-2 first wire** — **animalCerts WIRED** into personalized scoring (`d8cb9fd06`, Aron-approved; stance-gated, suppressed on record-backed negatives, 0 baseline drift, 28/28 tests). Also **G-9** sameAs entity links done (`ead659b38`). **Still open for Build 76:** NB-1 (iOS 75→76 bump — `pbxproj` still 75) · NB-4/B-67 (GJF `vt-strip-gjf.mjs` still UNRUN — fire after any B-23 rebake) · NB-7/E-1 (scoring-flags flip decision) · B-23 remaining 6 dims (held). **Build-76 data-expansion wave FULLY LANDED on `origin/main`** (Jun 26–27): the **"10 sources" = 7 net-new license-clean pipelines + 3 revived dead fetchers** (EPA TRI · ITEP tax · EPA GHGRP). 7 new pipelines fold into `company.enriched.*` via `apply-enriched-augments.mjs` (format-preserving, additive, **no score impact, no rebake**) → reveal **"public-record footprint"** card (`App.jsx:3408`) + government-only **Fed-Reserve/SEC enforcement** block (`App.jsx:3425`): sec-tax 3,417 · supply-chain 872 · openfda-recalls 363 · privacy 345 · pharma-conduct 211 · labor-wages 48 (DOL WHISARD key now set) · animalCerts **19** (the earlier "~11,210 via rebake" was a bad grep match — verified nested count is 19; `enriched.tax` is 0, only `secTax` (3,418) populates today). Refreshed weekly by `enriched-augments-refresh.yml` (`9a3f1c8dc`) — **truncated by a bad patch, repaired today `36e90245a`**; cron ran once auto (`9b49e6273`, Jun-26) + manual CI run 28298599428 **success** (Jun-27). Two today cleanup commits: `eba9b9a5c` (format-preserving merges + complete footprint pipeline), `36e90245a` (workflow restore). **B-64 news-cron FIXED** (`72f7d71c5`; healthy nightlies `5af76ac86`/`b84ca5f9b`/`e618dff58`). **Footprint is display-only "dark data" — NOT read by scoring (gate = B-23, re-scoped below).** **✅ Branch divergence RESOLVED (2026-06-27):** repo consolidated to a single `main` (working tree clean); the old feat branch + ~120 agent worktrees were retired this session. `fed-reserve-enforcement.json` is intentionally absent from main and *not* needed — `App.jsx` reads the merged `enriched.fedReserve`/`secLitigation` per-company fields (fully guarded), so the **SEC enforcement sub-card renders but the Fed-Reserve sub-card is dark** (the `fed-reserve-monthly` cron has never run on main → 0 company files carry `fedReserve`). **Parallel sessions:** PR #115 brand-parent-map Wikidata guard **OPEN but CONFLICTING (needs rebase)** (brings E-11) · GJF "Federal penalties" license gate on branch `claude/wizardly-franklin-fb8226` (**pushed to origin**, unmerged) (`d19b9dc92` display gated off, `039dbe769` `vt-strip-gjf.mjs` built+sandbox-tested **NOT YET RUN** — fire AFTER the Build-76 rebake; **now tracked as B-67**). Catalog 12,845 tracked / ~2,864 graded; scoring R7.1 unchanged. — **EARLIER 2026-06-25 — data-pipeline repair + marketing/social:** first cuts of the B-64 news-cron fix (`72f7d71c5`) and the EPA TRI endpoint fix (`ec77b498b`); nightly snapshots PostHog trending `c553e5f44`, OFAC-SDN `7033c6a6b`; PH-driving social session. — **EARLIER 2026-06-22 (pre-launch doc-sync): App Store v1.0 (Build 75) ✅ APPROVED 2026-06-18 → "Pending Developer Release" (Manual); PH launch Jun 23 · 2:01 AM CDT (scheduled).** The full 6-issue App Store saga is CLOSED (3.1.1 · 3.1.2c · 2.1b · 5.1.1v · 2.1a · 2.1b — never resurface as blockers). **Launch-day runbook `docs/LAUNCH_DAY.md`:** Release in ASC the night before (link propagates 1–4h) → set `APP_STORE_URL` in `MarketingLanding.jsx:46` (landing CTA auto-flips off the TestFlight mailto) → paste PH First Comment + social with the live URL. **This doc-sync's work:** (1) **main build number synced 74→75** (commit `85dbe033b`, `[skip ci]`) — main had lagged while ASC held 70–75, so a ship-from-main would collide at 75; next ship now = **76**. (2) **PH gallery rebuilt** from current Build-65 screenshots (commit `4ec1b8c2f`, feat branch: Civic Premium, clean de-waitlisted Reveal, "200+ sources"). (3) **Source-expansion research → B-65** (`docs/research/data-sources-expansion-2026-06-22.md` — 59 verified net-new public-record sources; build **POST-launch**, license-safe gov first, Norges Bank via NBIM-direct not OpenSanctions). Parallel-session items now tracked here: **B-63** (NC-license cleanup — paid tier triggers the CC-BY-NC drop, post-launch; stale "free" comments committed `fec17d0e2`) · **B-64** (live cron failures — `news-rss-nightly` hangs nightly → **news signals stale for weeks**; post-launch). Catalog 12,845 tracked / ~2,864 graded; scoring R7.1 unchanged.
>
> **EARLIER 2026-06-14 (PM) — ✅✅ v1.0 (BUILD 74, iPhone-only) RESUBMITTED TO APP REVIEW — status "Waiting for Review" (~7:40pm CST).** The whole rejection→resubmit arc closed today: on-device **sandbox purchase + restore VERIFIED** (Build 69/70) → the 11-agent **QA fix sweep** shipped across Builds 70–74 → all three cited rejection guidelines resolved + resubmitted with both subscriptions. **Apple's 3 issues, fixed:** **3.1.1** (real StoreKit purchase via RevenueCat; the email "waitlist" mechanism is gone) · **3.1.2(c)** (paywall shows the auto-renew disclosure + functional Terms of Use (EULA) + Privacy Policy links; EULA in the App Description, Privacy Policy URL set) · **2.1(b)** (both subs attached to the version, each with an App Review screenshot). Proactively also fixed **5.1.1** (paywall email made optional — B73) and de-waitlisted the archetype **Reveal email card** (stale "ship on the App Store" copy → neutral opt-in — B74). App is now **iPhone-only** (B72, drops the iPad-screenshot requirement). 5 iPhone screenshots regenerated; reply posted to the Jun-7 rejection thread. Sandbox tester `aron@trunorthapp.com`; submission paste-sheet at `docs/app-store-submission.md`. **NEXT: await Apple's verdict (~24–48h, email on status change); on approval set `APP_STORE_URL` (landing CTA flips off the TestFlight mailto) + update PH First Comment / announce copy + flip the live URL.** **Web: PR #109 MERGED → trunorthapp.com deployed + VERIFIED LIVE** ($14.99/$1.99 pricing, Android waitlist CTA, Methodology source-disclosure fix). Builds 70–74 carry the full QA sweep — see the **QA-1…QA-25** table below. — **EARLIER 2026-06-14 (AM): 🚀 Build 69 on TestFlight → sandbox gate.** Build 69 uploaded via `scripts/ship-ios.sh` (altool UPLOAD SUCCEEDED, delivery `f701b040…`, bump committed `f7b9897e8`) — first TestFlight build with the merged review wave + **live RevenueCat IAP**; the on-device sandbox purchase that gated submission (v1.0 was rejected over a non-completable paywall) **succeeded**, clearing the gate. Launch-prep done today after the merge: **honest copy sweep** ('12,000+ graded' → '~2,900 graded / 12,000+ tracked' across 24 files incl. website meta + App Store listing + PH/social/investor/email; pushed `237c72125`); **prompt caching** on both Anthropic API callers (`ai-research-bake` + `news-rss-extract`, ~30% spend cut); **Vercel → Pro** (free-tier 75%-of-100GB auto-pause risk GONE; 1TB allowance, ~32GB/mo; bandwidth diagnosis = mostly Googlebot, **NOT** AI crawlers → robots.txt left unchanged); **`main` branch protected** via Ruleset (force-push + deletion blocked; PR/status-check rules OFF so the `trunorth-bot` nightly pushes keep working). — **EARLIER 2026-06-13: ✅ POST-R2 REVIEW WAVE MERGED TO MAIN + DEPLOYED** (merge `e20b36ab3` → `git push origin main` → Vercel prod, verified live via `/data/companies/hobby-lobby.json` 200). The merge bundled the **should-fix sweep** (dead-Quiz removal · tests import the real engine · vocabulary unified on 'Basket' · the previously-missing **weekly-changes generator** `compute-weekly-changes.mjs` + Sunday-digest ordering fix · Reveal slimmed to archetype→clash→one CTA) and the **Chase data bucket** (Target DEI now reflects the Jan-2025 rollback · LEGO **B** / Hobby Lobby **C** / Nintendo & Puma **"?"** seeded from real entity-verified records — Nestlé was never missing, it's slug `nestl`). Catalog now **12,845 tracked / 2,851 graded / 9,994 "?"**. — Full investor/product-lead review (UX · scoring · code · data · competitive) → fixes landed on the branch in 5 commits: **W1 P0/P1** — native iOS API funnel un-broken (subscribe/submit resolved to `capacitor://localhost` and were silently lost; submit.js OPTIONS+CORS); grade-legend corrected to real thresholds (was A=90–100 "school curve"); Methodology §6 politics contradiction; vt-merge synthetic-data guard; welcome-modal cold-launch re-fire; Match crash-loop clamp + **card reorder (politics off slot 1)**; quiz→Match copy; dropped plaintext-email PostHog identify. **R7 SCORING (Aron's call)** — political **EXCLUDED from the un-quizzed baseline** (now a stance cat like dei/animals/guns; counts only when the user takes a side in the Match): 4-engine change + 4,862-file rebake, thresholds kept frozen. **Analytics** — persistence memory→localStorage (retention now measurable) + surface_view / match_card_answered / scanner-failure events. **Cracker Barrel** wrong-parent merge fixed (was graded on Kraft Heinz's records → D→C on its own). **SCORING REWORKED → R7.1 (Aron, 2026-06-13) — now MERGED to main + deployed.** R7's political-exclusion initially cratered the curve to 37.7% F (political was the main positive counterweight; baseline is violation-dominated). Aron chose "recalibrate + keep R7, then fix sparsity" → **R7.1**: (1) revenue-normalized penalty severity (new `sec-revenue-fetch.mjs` → SEC XBRL revenue for 357 ticker'd brands; penalty scored as %-of-revenue, absolute fallback otherwise) — a $10M fine no longer sinks a $700B co; (2) **E-10 thin-record floor** (mirror of E-9: one moderate negative-only record floors at C); (3) recalibrated thresholds **A≥62/B≥50/C≥38/D≥33** (re-anchored once after the structural change, re-frozen; all 8 engine copies + legend + Methodology synced; E-9 single-signal cap 62→61). **Result among 2,864 graded: A 3 / B 36 / C 36 / D 18 / F 8.** Walmart/Target/Amazon/Kroger F→C, McDonald's D, Apple A, Costco/Nike/Starbucks B; 0/12,841 parity mismatches; 28/28 tests. (A=3% — single-signal brands correctly cap at B; revisit if too rare.) Prior 2026-06-12 PM — **Compass Redesign R1+R2 shipped through Build 68.** R1 Civic Premium skin + Compass seal (B59–61), R1.1 ring verdict seal + E-9 single-category cap-at-B (B62), R1.2 chip-fit + cooler signal `#3DD6B5→#38C0CE` (B63), R2 "The Flows" four-surface nav Today/Lens/Ledger/You + the Match (11 tension cards, replaces quiz) + Ledger v1 + the Switch + Versus single verdict + first-run basket → Reveal-judged (B64), R2.1 device feedback — Versus single-column, AI synthesis chips hidden, DEI third-party recognition reaches stanced grades (B65), Civic Premium brand media refresh — icon/OG/landing/social kit (B66), B66 device fixes — splash mark, Lens un-clipped, center-button scanner, Methodology scroll, share OG title (B67), B68 clash-led basket articulation ("0% aligned" retired, `basketVerdict()` single source, Today serif clash sentence + Ledger "N clashes" tile + Reveal clash line, scoring untouched/symmetric). Build numbering now true (`manageAppVersionAndBuildNumber=false`) — repo build == ASC build from 61. Promo video re-cut + 5-platform announcement pack landed same day. Prior 2026-06-11 AM —
> **SCORING V3 shipped: grade-dispersion overhaul.** The Build-57 signal-count cliff (37.8% of graded brands flattened to C — 1,520 A-range one-signal brands among them) is replaced by evidence-weighted shrinkage toward 50 (K=1.5, IMDb-style); thresholds recalibrated once from the post-V3 distribution and FROZEN at A≥63/B≥56/C≥46/D≥41; severity-continuous category scores ("Path B for every category"): execPay from actual SEC pay ratios (log curve, 20:1→100 … 1000:1→15), labor/env negatives by penalty $ (8–40), charity by IRS-990 grants (60–100); stance cats (dei/animals/guns) excluded from the un-quizzed baseline per the Phase-4.11 neutrality principle. Per-category continuous scores baked as `csc` on company files AND index entries (kills index-vs-detail political flicker). Grade dist among 5,306 graded: **A 7.2 / B 34.5 / C 40.7 / D 8.1 / F 9.5** (was A 1.9 / B 14.7 / C 58.5 / D 22.0 / F 3.0). Sync points updated: rebake-scoring, finalize-bundle, rebuild-bundle-index, App.jsx, audit-grade-drift, 3 SEO endpoints; scoring-engine tests rewritten (27/27 pass). ⚠️ Note: `a77722b21` (parallel R6 session) swept the mid-flight engine files into its commit — this ship completes/repairs that state. Prior 2026-06-10 late PM: **R6 execPay rollout shipped** (`ebc27c88e`, `cb8b6e9bc`): new SEC XBRL ecd source + the orphaned sec-def14a pay ratios wired + crawl universe 340→1,372. execPay scored **23 → 676 brands**, full-grade (3+ cats) brands **1,107 → 1,228**. Research doc: docs/research/data-sources-r6-coverage-gaps-2026-06-10.md (next up: IRS-990 foundation pass for charity, CPPA data-broker CSV, ToS;DR pending license check, OFCCP EEO-1 manual download). Earlier today — **Full-app QA sweep: all 5 fix phases shipped to main** (`c2d587bca`..`10811f944`). Phase 1 data (legacy-category revert re-fixed, flags passthrough, HRC writer, trending slugs). Phase 2 payments-branch P0s (`bc649612d` on feat/paywall-go-live: getOfferings, cancel detection, tri-state entitlement revoke, $14.99/$1.99/37% copy). Phase 3 app criticals (deep-link detail fetch + /c/ links + consumption-based deepLinkSlug clear, S3 cap fix, dealbreaker math, Why-panel −20/−10 sync, Top Match capped-grade rank, onboarding live grades + real Terms/Privacy links, scanner double-fire, NaN sorts). Phase 4 web (SEO grade parity — 0/11,261 mismatches, lookupSpa await, JSON-LD escape, subscribe CORS preflight, landing 200+ sources, double-POST). Phase 5 infra (news-rss-nightly hang fixed: fetch timeouts + 35-min budget + partial commits; gdelt/openstates/nhtsa timeout bumps; dead dup writers removed; /privacy path + sitemap; local-day quota; 44px scanner close; grammar). IAP screenshot regenerated at 37% — **Aron must re-upload to BOTH subscriptions in ASC**. 15 empty augments flagged as a follow-up task. Prior: GEO shipped Jun 9. **13 days to launch.**

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
| **NB-8** | **Triage 8 open PRs** | All resolved: #115 parent-map landed via direct commit (`af6abf34b`, E-11) then PR closed; #114/#111 (la-county dups) closed; #105 (paywall flip X-0) closed = keep waitlist. `gh pr list` now empty. | ✅ **DONE** — 0 open PRs |
| **NB-9** | **light the Fed-Reserve card** | Ran fetch+merge once: `fed-reserve-enforcement.json` now committed + **23 company files carry `enriched.fedReserve`** → Bank-penalties sub-card now lights for those brands. | ✅ **DONE** (`c25dea5dc`) |

---

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
- **B-81 ✅ DONE (send path pending a delivery decision) — Close the notify-me loop: "we'll email you the moment X is graded" has no delivery mechanism.** Grep
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
- **B-91 ⚠️ PARTIAL — Kill opacity-as-meaning for the baseline/ungraded state.** v1.1's headline feature reaches first-run
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

## 🔴 NEEDS YOUR DECISION — CURRENT (refreshed 2026-07-18)

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
