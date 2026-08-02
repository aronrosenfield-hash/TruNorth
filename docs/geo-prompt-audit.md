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

### 2026-08-01 — first post-launch read (T+39 days), automated run (G-10)

**Run by:** scheduled task, unattended. **Engines actually run: 1 of 5** (Claude with web search). ChatGPT, Perplexity, Gemini/AI Overviews and Copilot need a logged-in human and are **not** measured here — see "Manual engine runs still owed" below. Numbers are reported against the engine that ran, not the full 55-cell grid.

- **Cited-rate: 0 / 11** (Claude + web search column). Full-grid denominator 55 still pending.
- **Surfaced but not cited: 0.** TruNorth did not appear in any answer, in any form, for any of the 11 prompts.
- **Misattribution / entity-collision incidents: 0 by the strict definition — but that is not good news.** We were never described *incorrectly* because we were never described *at all*. Prompts 10 and 11 ("What is TruNorth the app?" / "Who made the TruNorth brand-rating app?") returned **eight** colliding namesakes and zero mentions of us: TrüNorth Global (truck warranty), TruNorth app for Carle Health, TruNorth Fitness, TruNorth Bank, TruNorth Federal Credit Union, trunorth.ai, trunorth.dev, and TruNorth Consulting (trunorth.com). Prompt 11 answered, in effect, "no such app exists."
- **Top competitors cited instead:**
  - *Discovery prompts (1, 3):* **Goods Unite Us** (dominant — cited in both), **BuyPartisan**, and **WalletVote** (walletvote.net) — WalletVote is new since this list was written and is the closest thing to our exact pitch: scan a product, see PAC/lobbying money from FEC data. Track it.
  - *Ethical-record prompts (2, 5, 6):* Ethical Consumer, The Good Shopping Guide, Good On You, Business & Human Rights Resource Centre, Corporate Research Project.
  - *Alternatives (7):* Sustainably Chic, Project Cece, Eco-Stylist, StyleWise — all long-form blog posts. Our `/alternatives/shein` did not appear.
  - *Compare (8):* Good On You's Nike-vs-Adidas page, plus mashinii.com "Nike vs Adidas: A Data-Driven Ethics Comparison (2026)". Our `/compare/nike-vs-adidas` did not appear.
  - *Prompt 4 ("best conscious shopping app 2026"):* Good On You, plus generic listicles. No values-grading app besides Good On You was named.
  - *Prompt 9 (Walmart):* mainstream press only — no ratings tool of any kind was cited.

**Diagnosis — this is an indexation problem, not a ranking problem.** Four control probes were run beyond the fixed set: `"trunorthapp.com"` in quotes, the exact rendered headline `"Nike vs adidas — values & public-records comparison"`, an App-Store-worded probe, and a founder-name probe. **All four returned nothing from the domain.** An exact-phrase query against live, server-rendered text on our own site returning zero means the pages are not in the index being searched. You cannot out-rank Goods Unite Us on a page that was never crawled.

**Technical state verified this run (all checked live, not assumed):**

| Check | Result |
|---|---|
| `robots.txt` | ✅ Correct. Explicitly allows OAI-SearchBot, PerplexityBot, Claude-User, Claude-SearchBot, GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot, DuckAssistBot et al. Blocks only `/api/`, `/admin/`, tracking params. |
| `llms.txt` | ✅ Present, 3,259 chars, well-structured — including an explicit "not affiliated with TruNorth Federal Credit Union / TruNorth Global" disambiguation block. ⚠️ But see accuracy defect below. |
| `sitemap.xml` | ✅ 200, **35,637 URLs**, 6.7 MB. Legal (under the 50k/50 MB cap) but large enough that crawl budget is a real constraint for a new domain with thin external links. |
| `/company/patagonia`, `/alternatives/shein`, `/compare/nike-vs-adidas` | ✅ All 200 and genuinely server-rendered (8–15 KB of real text). Content quality is not the problem. |
| **Homepage `/`** | 🔴 **37 characters of visible body text.** 10 KB of HTML that is almost entirely script/style; the only readable string is the tagline "TruNorth — Know where your money goes". Confirmed identical when fetched with a GPTBot user-agent — there is no bot prerender. Title, meta description, OG tags and a JSON-LD `Organization` block are all present and good, but the body an extractor reads is empty. The highest-authority URL on the domain — the one every "what is TruNorth" answer would land on — is the single weakest page we serve. |
| Bing / Google index check | ⛔ Inconclusive. Bing served a bot challenge to the scripted check. Needs a human in a browser. |

**Data-accuracy defect found (fix regardless of GEO):** `llms.txt` opens with *"grades 11,000+ consumer brands"* and repeats *"one per brand, 11,000+ total."* Ground truth from `public/data/index.json` this morning: **3,054 graded, 12,830 tracked.** The site's own meta description already carries the honest reframe ("2,800+ brands fully graded … 12,000+ tracked") that came out of the 2026-07-02 diligence review — `llms.txt` never got that fix. This is the one file written specifically to be quoted verbatim by AI engines. If it starts working, it will make us repeat a claim we can't support.

**Action items:**
1. **Fix `llms.txt` counts** to "3,000+ fully graded, 12,800+ tracked" (or re-word to match whatever the homepage says, and keep them in sync). Highest priority because it is a correctness issue, not just a marketing one. Also reconcile "200+ sources" against the real figure.
2. **Give the homepage a server-rendered body.** ~400–800 words of real text: what TruNorth is, the nine categories, the honest graded/tracked counts, three sample brand grades, and links to `/company/`, `/compare/`, `/alternatives/`. The deep pages already prove the rendering path works — the root just isn't using it.
3. **Prove crawlability before optimizing anything else.** Check Google Search Console and Bing Webmaster Tools for actual indexed-page counts and any crawl errors, and confirm the 35,637-URL sitemap is being processed rather than silently dropped. Everything else is wasted effort until pages are in an index.
4. **Own the name.** Eight namesakes currently split the query "TruNorth app." The `llms.txt` disambiguation block is necessary but not sufficient — it only helps engines that have already fetched us. External mentions on high-crawl-rate surfaces (Product Hunt, Reddit, HN, App Store) are what break an entity collision.
5. **Watch WalletVote.** Newest direct competitor, already being cited on our core discovery prompt.
6. **Run the four manual engine columns** (below) and append to this same block so the 55-cell grid is complete for the September comparison.

**Manual engine runs still owed — ChatGPT, Perplexity, Gemini/AI Overviews, Copilot:**
1. Open a **fresh/temporary chat** in each engine (no prior context — history contaminates the result).
2. In ChatGPT, turn **web search on** explicitly. In Perplexity, use the default web mode.
3. Paste the 11 prompts from "The fixed prompt set" above **one at a time, verbatim** — don't reword them, or next month isn't comparable.
4. For each answer record four things: **Surfaced?** (did TruNorth appear at all) · **Cited?** (was trunorthapp.com an actual linked citation) · **Accurate?** (described correctly, not confused with the credit union or the truck-warranty company) · **Notes** (what got cited instead).
5. For Gemini/AI Overviews, run the prompt as a **Google search** and screenshot the AI Overview box at the top rather than using the Gemini chat app — that's the surface real users see.
6. Total cells = 11 prompts × 4 engines = 44. Add them to the 11 above for the full 55.
7. Append the tally under this block as "2026-08-01 — manual engine columns" so the dated entry stays one unit.

**Bottom line:** the technical GEO groundwork (robots, llms.txt, rendered deep pages, schema) is done and done well. It has produced zero citations at T+39 because the pages don't appear to be indexed yet. Next month's read is only meaningful if item 3 is resolved first.
