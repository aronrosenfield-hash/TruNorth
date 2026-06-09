# GEO Prompt Audit

**Purpose:** the half of GEO measurement that analytics can't see. PostHog tells us when an AI engine *sends traffic*; this tells us whether TruNorth gets *surfaced and cited* in the first place. Run monthly, log results, watch the trend.

**Cadence:** 1st of each month (~15 min). Pairs with the cron-health check already on the calendar.

## How to run

For each prompt below, ask it fresh (no prior context / temporary chat) in:

- **ChatGPT** (with web search on)
- **Perplexity**
- **Google Gemini** / AI Overviews (run the query in Google, screenshot the AI Overview)
- **Claude** (with web search on)
- **Microsoft Copilot**

For each (prompt × engine), record:

- **Surfaced?** — did TruNorth appear at all? (Y/N)
- **Cited?** — was trunorthapp.com a linked citation? (Y/N)
- **Accurate?** — was the description of TruNorth correct, and not conflated with TruNorth Federal Credit Union / TruNorth Global / etc.? (Y/N/N-A)
- **Notes** — what *was* cited instead (the competitors to displace).

## The fixed prompt set

Keep these stable month-to-month so the trend is comparable.

**Category / discovery (do they know we exist):**
1. "Is there an app that grades brands on their political donations and labor record?"
2. "How can I check a company's ethical record before buying from it?"
3. "What app shows where a brand's money goes politically?"
4. "Best app for conscious or values-based shopping in 2026."

**Brand-specific (do they cite our data):**
5. "Is Patagonia an ethical company?"
6. "What is Nestlé's labor and human-rights record?"
7. "Ethical alternatives to Shein."  ← should surface /alternatives/shein
8. "Nike vs Adidas — which is more ethical?"  ← should surface /compare/nike-vs-adidas
9. "Does Walmart sell firearms / donate to political parties?"

**Entity / disambiguation (do they describe us correctly):**
10. "What is TruNorth the app?"
11. "Who made the TruNorth brand-rating app?"

## Log

Append a dated block each run. Track the headline number: **cited-rate = (# cited) / (prompts × engines)**.

### YYYY-MM-DD — baseline (pre-launch, before crawlers re-index)
- Cited-rate: ___ / 55
- Surfaced but not cited: ___
- Misattribution / entity-collision incidents: ___
- Top competitors cited instead: ___
- Action items: ___

> Expect ~0 at baseline — we haven't been crawled/launched yet. The PH/HN/Reddit launch wave (Jun 23) + the llms.txt/robots/schema changes are what should move this. First meaningful read: ~30 days post-launch.
