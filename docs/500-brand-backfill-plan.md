# 500-Brand Backfill Plan

> Real-Risks #1A from the audit: 85% of catalog has no personalization signal. Fix: backfill top 500 brands with verified data so quiz personalization actually works on the brands users look up.

## The problem (in plain terms)

Right now: a user takes the quiz, looks up "Patagonia," and the app shows neutral — even though Patagonia is literally the iconic green brand. Why? Because the long-tail company in our index has `political:"neutral", environment:"unknown", labor:"unknown"...` for every field. The quiz can't personalize what isn't there.

## What success looks like

After this backfill, the top 500 most-recognized US consumer brands have at least **3 of 9 categories** filled with verified public-record signal:

- Political donations (FEC PAC + employee summary)
- Labor record (OSHA + NLRB)
- Environment (EPA enforcement + CDP if available)
- Plus 3+ of: DEI, charity, animal testing, privacy, exec pay, supply chain

Patagonia, Amazon, Walmart, Costco, Target, Apple, Google, Tesla, Chick-fil-A, Hobby Lobby — every one of these should have a grade that actually moves when the quiz preferences move.

## Brand list — 500 candidates (we need YOUR call)

### Option A — by PostHog impressions
Once PostHog has 1-2 weeks of data, take the top 500 most-searched / most-viewed brand slugs. Most data-driven approach but requires waiting for traffic.

### Option B — curated by recognition (recommended for pre-launch)
The 500 brands most likely to be searched on Day 1. Sources to merge:
1. **Top 100 Numerator/NIQ share-of-wallet** (food, household, personal care — the brands people buy weekly)
2. **Top 100 Fortune 500 consumer brands** (retail, tech, financial, healthcare)
3. **Top 100 Wikipedia traffic among private US companies** (the brands people Google)
4. **Top 50 controversy-driven brands** (Chick-fil-A, Hobby Lobby, Goya, MyPillow, In-N-Out, Ben & Jerry's, Lush, Patagonia — the ones people EXPECT to take political sides on)
5. **Top 150 PH-launch-niche brands** (Anthropic, Notion, Linear, Vercel, Stripe, etc. — Product Hunt's audience knows these by heart)

### Option C — Aron's hand-curated 500
Aron writes the list. Time-consuming but produces the most launch-relevant catalog.

## How the backfill runs

**Three data sources, ranked by cost vs. quality:**

### 1. Free + automated (~2-3 hr per 100 brands, parallelizable)
- **FEC OpenFEC API** — PAC + employee contributions per company
- **OSHA Inspections API** — workplace safety incidents
- **NLRB Cases API** — labor disputes
- **EPA ECHO API** — environmental enforcement actions
- **Have I Been Pwned** — breaches per domain
- **OpenFDA** — product recalls

These are all rate-limited, free APIs. Existing pipeline at `/Users/aronrosenfield/Developer/hybrid-pipeline/` already wires them up — just needs a targeted run.

### 2. Web search + AI synthesis (~$5-15 per 100 brands)
For each brand, dispatch a Claude agent with web search to compile:
- Recent (12-month) news on political donations, labor disputes, environmental violations
- Public certifications (B-Corp, Fair Trade, Leaping Bunny, Fair Tax Mark, HRC CEI rating)
- News articles flagging controversies

Anthropic API cost via Claude Sonnet 4.6 batch + caching: ~$1-2 per 100 brands. Web search 2-3¢ per query × ~5 queries per brand = ~$10-15 per 100.

Total estimated cost for 500 brands: **~$50-100 in API spend**.

### 3. Hand-verification (~30 min per 100 brands)
Spot-check the top 50 most-recognized brands manually. Patagonia, Amazon, Walmart should all be "obvious" — if the data feels wrong, fix manually before going broader.

## Execution plan

**Phase 1 — Pick the list (your call, ~30 min)**
- Decide between Option A / B / C above
- Generate or write the 500-brand CSV with column: `name, slug, parent_company`

**Phase 2 — Free APIs (~4-6 hours, mostly waiting)**
- Run `node backfill-targeted.mjs --list brands-500.csv` from the pipeline repo
- This pings FEC + OSHA + NLRB + EPA + HIBP + OpenFDA per brand
- Outputs `raw-backfilled.json` with new signal

**Phase 3 — AI deep research (~2-4 hours per 500 brands)**
- Workflow: for each brand, run a research agent that returns:
  ```json
  {
    "name": "Patagonia",
    "categories": {
      "political": "left-leaning",
      "environment": "excellent",
      "labor": "good",
      "dei": "pro_dei",
      "charity": "excellent",
      "animals": "cruelty_free"
    },
    "sources": [<3-5 cited URLs>],
    "narrative": "<300-word summary citing specific filings>"
  }
  ```
- Merge into existing companies.json

**Phase 4 — QA + ship (~1 hour)**
- Re-export the bundle
- Spot-check top 50 brands manually
- Re-run sitemap
- Commit + deploy

## Tradeoffs

| Approach | Cost | Time | Quality |
|---|---|---|---|
| Option B + free APIs only | $0 | 6-8 hr | Decent on labor/political/environment; gaps on DEI/animals/charity |
| Option B + AI deep research | ~$75 | 8-12 hr | Full coverage; best launch credibility |
| Option C (hand-curated) + AI | ~$75 + your time | 12-16 hr | Highest quality but you're in the loop |

## My recommendation

**Option B + AI deep research.** Best ratio of quality-per-hour. Cost is trivial relative to launch leverage. I can run it as a workflow when you confirm.

## Next step

**Decision:** which list-source option (A / B / C)? Once you pick, I'll start a workflow that runs Phase 2 + 3 in parallel for the 500 brands. ~8 hr wall-clock. Final ship to production is 1-click after QA.

**Or alternatively:** wait 2 weeks post-launch for real PostHog data → then do a smaller, demand-driven backfill of the top 100 actually-searched brands. Cheaper, more accurate, less guess-work.
