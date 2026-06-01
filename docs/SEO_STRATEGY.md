# TruNorth SEO + SEM Strategy

> Goal: rank #1 for every long-tail company query — *"is [brand] ethical"*, *"[brand] political donations"*, *"[brand] labor record"*, *"is [brand] cruelty-free"*, etc.

---

## What ships in Phase 5.ba (this commit)

### 1. `robots.txt`
- Allows crawling of `/` and `/company/*`
- Disallows `/api/*` (no point indexing internal endpoints)
- Explicitly allows GPTBot, ClaudeBot, PerplexityBot — TruNorth's data IS the content, and AI summarizers citing TruNorth is the kind of inbound traffic we want

### 2. `sitemap.xml`
- Auto-generated at build time via `scripts/generate-sitemap.mjs`
- 11,211 URLs (root, privacy, 11K companies)
- Per-company URLs use `<changefreq>weekly</changefreq>` so Google re-crawls after data refreshes
- Submitted to: **Google Search Console** + **Bing Webmaster Tools** (manual steps — see "Submission checklist" below)

### 3. SEO Edge Function (`/api/company-seo.js`)
**The big SEO win.** Every `/company/<slug>` URL now returns server-rendered HTML with:

- **Unique `<title>`**: `"{Name} — {Grade} grade · {Category} | TruNorth"`
- **Unique `<meta description>`**: 160-char distillation of the per-category narrative
- **`<link rel="canonical">`** preventing duplicate-content penalties
- **Open Graph + Twitter Card** meta — rich previews on Twitter, Slack, iMessage, LinkedIn
- **JSON-LD structured data**:
  - `Organization` schema with name, URL, image, sameAs
  - `AggregateRating` schema with the company's score
  - **This enables Google "rich snippets"** — your search result gets a star rating + grade visible directly in SERP, dramatically improving click-through rate
- **`<noscript>` body** with full content (category narratives, grade, sources) so crawlers without JS execution still index the data
- **SPA script bootstrap** — human users still get the full interactive React app after first paint

Cached at Vercel's CDN for 1 hour (stale-while-revalidate 7 days), so the function fires maybe ~12K times/month, not per-pageview.

### 4. `vercel.json` rewrites
- `/company/:slug` → `/api/company-seo?slug=:slug`
- `/c/:slug`       → same (short share URLs)
- Custom Content-Type + Cache-Control headers for sitemap + robots

### 5. Build script integration
- `npm run build` now runs `generate-sitemap.mjs` before `vite build` — every Vercel deploy gets a fresh sitemap
- Standalone: `npm run sitemap` to regenerate manually

---

## Submission checklist (you do these once)

### Google Search Console (free)
1. https://search.google.com/search-console
2. Add property: `www.trunorthapp.com` (DNS verification preferred — add the TXT record Google gives you in Namecheap)
3. Sitemaps → "Add a new sitemap" → enter `sitemap.xml`
4. Wait 24-72 hours → coverage report should show ~11K indexed pages
5. Set up email alerts for "Index coverage issues"

### Bing Webmaster Tools (free, less traffic but easy)
1. https://www.bing.com/webmasters
2. Same process — verify domain, submit `sitemap.xml`
3. Bing's API also feeds DuckDuckGo

### Google Business Profile (if applicable)
- If TruNorthApp LLC has a physical address you're comfortable disclosing, claim a Business Profile — helps with brand searches.

---

## On-page SEO checklist (already done)

- ✅ Every company URL has unique title + description
- ✅ Canonical URLs (prevents www/non-www and trailing-slash duplicates)
- ✅ JSON-LD structured data (Organization + AggregateRating)
- ✅ Open Graph for social sharing
- ✅ Mobile-first responsive design
- ✅ Page speed > 90 Lighthouse (Vite + edge caching)
- ✅ Semantic HTML (h1, h2, sections)
- ✅ Clean URL structure (`/company/<slug>` not `/?id=4f3a`)
- ✅ Internal linking (competitors arrays cross-link company pages)
- ✅ HTTPS (Vercel)

---

## Off-page SEO (backlinks — the slow burn)

**These move the needle most. Plan to spend ~2 hours/week on backlink outreach for the first 3 months.**

### Priority 1: Trade press
- **The Verge, Wired, Fast Company** — pitch a story on TruNorth's launch. Focus angle: "indie founder built consumer values shopping app using only public records". They love that narrative.
- **Mother Jones, ProPublica, ESG Today, Triple Pundit** — values-focused outlets. Pitch a data story (e.g., "the 10 worst-graded brands you've never heard of") that uses TruNorth's data and links back.

### Priority 2: Communities (relevant subreddits)
- r/Anticonsumption, r/BuyitForLife, r/Frugal, r/ZeroWaste, r/Vegan, r/cruelty_free — when someone asks "is [brand] ethical", a real-user TruNorth link gets upvotes. **Do this organically, don't spam.** One link per week from your real Reddit account.

### Priority 3: Sister tools / directories
- DoneGood, Goodside, Ethical Consumer (UK), B Corp directory — most have "tools we recommend" pages. Ask politely.
- ProductHunt launch — gets ~50-100 backlinks in a single day if it ranks. Schedule for App Store launch day.

### Priority 4: AI search engines (Perplexity, ChatGPT, Claude)
- These cite high-authority sources. As TruNorth accumulates backlinks, it becomes a citation target.
- Our robots.txt explicitly allows their crawlers.

---

## SEM (paid search) strategy

**Don't start SEM until:**
- LLC + bank are done (need billing)
- App Store launch is imminent (so clicks convert to downloads)
- Conversion tracking is set up (we have PostHog — need to confirm UTM params land in events)

### Phase 1 — Brand defense ($5-10/day, ~$150-300/mo)
Bid on **"TruNorth"** + **"TruNorthApp"** so competitors can't poach your branded searches. Cheap and essential.

### Phase 2 — High-intent long tails ($20-50/day, ~$600-1500/mo)
Target queries with clear shopping intent:
- "is [brand] ethical"
- "[brand] political donations"
- "cruelty-free alternative to [brand]"
- "[brand] labor union record"
- Tools: Google Keyword Planner (free with Google Ads account) + Ahrefs trial

Use **dynamic search ads** that auto-match against your sitemap — Google generates the ad headline from your page title, you set the bid.

### Phase 3 — Programmatic remarketing (later)
Retarget visitors who bounced from a company page. Show them an iOS download ad. Probably $30-100/day.

### Budget envelope
- Start: $5-10/day total ($150-300/mo) for ~6 weeks while iterating
- Scale: $50-150/day ($1500-4500/mo) once conversion math is positive
- Kill: any keyword with CAC > LTV × 0.3

---

## Content strategy (for ranking on broader queries)

Right now we rank on **brand searches** ("is Patagonia ethical"). To rank on **category searches** ("most ethical clothing brands"), we need editorial content.

Suggestion: **monthly listicles** like:
- "10 best-graded grocery brands of 2026"
- "The 5 worst political-donation records in fast food"
- "Cruelty-free beauty brands sorted by overall grade"

Host at `/best/<topic>` (e.g., `/best/grocery`, `/best/cruelty-free-beauty`). Each is a static-rendered page with rankings + brand cards + "view full profile" deep links. The editorial.json infrastructure we built is the right foundation — extend it to support topic-based collections.

Effort: ~2 hours per article. Goal: 1-2/month. Slow but compounds.

---

## Metrics to track (Google Search Console, weekly check)

- **Total impressions** — how often we appear in SERP
- **Average position** — where we rank (lower = better)
- **CTR** — % of impressions that click. Rich snippets should bump this from ~3% baseline to ~7-10%
- **Top queries** — what people are searching that's bringing them here. Surprises always show up.
- **Top pages** — which company pages get the most traffic. Helps prioritize data quality work.
- **Crawl stats** — Google should be crawling ~500-2000 pages/day once the sitemap is submitted.

---

## What's NOT shipped yet (future Phase)

- 🔜 **Server-side pre-rendering at build time** (instead of Edge function). Slightly faster TTFB; would require migrating to Next.js or vite-ssg. Defer until clear ROI.
- 🔜 **`/best/<topic>` editorial collections** — listicles. ~2 hours each, big SEO win.
- 🔜 **Schema.org BreadcrumbList** — adds breadcrumb trail in SERP. Small win.
- 🔜 **Hreflang tags** — if/when we expand internationally.
- 🔜 **Submit to Google News Publisher Center** — could land us in "Top stories" carousels for breaking brand news.

---

## TL;DR: what to do this week

1. ✅ Code shipped (this PR) — sitemap, robots, edge function, JSON-LD
2. ⏳ **Submit sitemap to Google Search Console** (~10 min, you)
3. ⏳ **Submit sitemap to Bing** (~10 min, you)
4. ⏳ Write 1 trade-press pitch + 1 ProductHunt teaser (~1 hour, you)
5. ⏳ Once App Store live: brand-defense ads on "TruNorth" + "TruNorthApp" (~30 min Google Ads setup, you)

Compounding starts immediately. Most traffic gains show up in months 3-6.
