# TruNorth Talk Tracks

Plain-language answers to the questions you'll get asked at events, in DMs, on podcasts. Memorize the bold lines; the rest is backup detail you can deploy if pressed.

---

## "What is TruNorth?"

**TruNorth grades 11,000+ consumer brands on what they actually do — using only public records.**

It's an iOS app. You scan a barcode in-store and get a letter grade (A through F) on the company behind the product, tuned to the values you care about — politics, environment, labor, animal testing, privacy, and more. Every score traces back to a public-record citation. No surveys, no vibes, no opinions.

---

## "How did you build it?"

**Solo. About a year. Mostly evenings and weekends.**

I'm not a professional developer — I'm a founder who learned what I needed to as I went. The whole thing is web technology wrapped in a thin iOS shell, deployed on infrastructure that costs me essentially zero.

If they ask for specifics, the longer answer:

---

## "What's the tech stack?"

**React + Vite for the app, Capacitor to ship it as a native iOS app, deployed on Vercel. No backend server, no database — just versioned data files on GitHub.**

The longer breakdown:

| Layer | What I use | Why |
|---|---|---|
| **App UI** | React 18, Vite (build tool) | Fast iteration, hot reload, huge ecosystem |
| **iOS shell** | Capacitor | Wraps the web app in a native iOS container. Same codebase ships to TestFlight and App Store. |
| **Barcode scanner** | Google ML Kit via `@capacitor-mlkit/barcode-scanning` | Apple's native barcode reader (free, on-device) |
| **Hosting (marketing site)** | Vercel free tier | Auto-deploys from GitHub on every push. Zero cost. |
| **"Database"** | JSON files in the GitHub repo | 11k companies, 5.6 MB bundle, served as a static file. No SQL, no NoSQL. The iOS app downloads it once and caches it. |
| **Data pipeline** | 99+ GitHub Actions workflows | Each one fetches a public-records source on a schedule (daily/weekly/monthly/quarterly/annual) and commits the result back to the repo. The repo IS the database. |
| **Email** | MailerLite (newsletter), Gmail Apps Script (support auto-reply) | Both free tiers cover us for years at expected scale |
| **Analytics** | PostHog | Free tier, proxied through our subdomain so ad blockers don't break it |
| **Code/data version control** | GitHub | Every data update is a git commit — fully auditable change history |

**The whole monthly cost: $0.**

(Domain renewal is $14/year. Apple Developer Program is $99/year. That's the entire infrastructure budget.)

---

## "Where's the server?"

**There isn't one.**

The marketing site is static HTML/JS/CSS served by Vercel's CDN. The iOS app is a self-contained React bundle that talks to:
- The bundled data file (11k companies, downloaded once per app session)
- Open Food Facts (third-party, free, for barcode → brand name lookup)
- Our marketing site's email endpoint (Vercel Edge Function — counts as part of Vercel's free tier)

That's it. No EC2, no Heroku, no Postgres, no Redis, no Lambda. The phone does the work.

---

## "How do you collect the data?"

**Every data source is a public-records API or a scrape of a government website. I never buy data, never scrape behind paywalls, never use leaked or proprietary stuff. Everything is journalism-defensible.**

Examples:
- **FEC** for political donations (corporate PACs, executive donations)
- **EPA** for environmental enforcement (TRI, GHGRP, ECHO)
- **OSHA** for workplace safety citations
- **NLRB** for unfair labor practice cases
- **OpenFDA** for product recalls
- **SEC** for exec pay and litigation
- **USAspending.gov** for federal contract dollars
- **Senate LD-2** and **FARA** for lobbying disclosures
- ...and 100+ more

Every grade has a "Why this grade?" view that lists the exact citations. If the government records change, our grades change. If a company gets sued or fined or wins an award, we know within a week.

---

## "How is this different from Goodguide / Buycott / Ethical Consumer / Yuka?"

**Most of those score products. We score the company. And we use only primary sources.**

Goodguide and Yuka grade based on ingredients (sugar, saturated fat). That's nutrition.

Buycott aggregates campaigns ("boycott this company, support that one"). That's activism.

Ethical Consumer uses paid editorial researchers. That's opinion.

TruNorth uses 113+ public-records data sources with traceable citations. We grade the parent company, not the product, so scanning an Oreo gives you a verdict on Mondelez. And the grading methodology is published.

---

## "Why now?"

**Two things converged.**

First, the public data is finally good enough. FEC, EPA, OSHA, NLRB all expose machine-readable feeds. Five years ago this would have required a research team. Today it's 113 cron jobs.

Second, consumers got fed up with marketing-speak. "Sustainable," "ethical," "purpose-driven" are all spin. People want receipts. We provide the receipts.

---

## "What's your business model?"

**Free for users, forever. Pro tier for power users (~$5/mo) covers everything personalized and the in-store scanner.**

No ads. No selling user data. No taking money from rated companies.

Pre-launch, we're focused on getting to 10k engaged users. Conversion to Pro comes later.

---

## "Are you worried about being sued?"

**No. We publish factual public-record citations. The First Amendment protects journalism. Every grade has a paper trail — the same paper trail a journalist would use writing about that company.**

We also default to neutrality: if we can't find data for a category, the score reflects "not enough data" rather than guessing. That's both fairer and legally safer.

---

## "How accurate is the data?"

**Every datapoint is sourced from primary government records or established certifiers. We don't generate scores from AI; we aggregate facts and let the rules engine map them to letter grades.**

We do have known limitations:
- New companies take time to accumulate enough records for a confident grade
- Sub-brands sometimes don't auto-link to the parent (we're improving that mapping continuously)
- Some smaller companies have sparse data

Users can submit corrections via the in-app "Submit" tab. Every correction is reviewed personally.

---

## "Can I get an API / partnership / white-label?"

**Not yet — we want to nail the consumer launch first. Email me directly and I'll keep you posted: Aron@trunorthapp.com.**

---

## "Who's behind it?"

**Me. I'm Aron Rosenfield, founder of TruNorthApp LLC. Single-founder, built it myself, no team yet.**

If they ask about background, mention: a year of solo development, mortgaged-the-weekends kind of project, deeply motivated by wanting my own kids to know where their dollars actually go.

---

## "Why iOS first?"

**I had to pick one. iOS users tend to be early-adopters for consumer tech, and the App Store discovery is better for new launches. Android comes next quarter.**

---

## Quick numbers to memorize

- **11,209 companies graded**
- **113+ public-records data sources** (growing weekly)
- **99 GitHub Actions cron jobs** keeping data fresh
- **9 values categories** (politics, environment, labor, animal welfare, privacy, health, exec pay, charity, transparency)
- **0 ads, 0 trackers selling user data, 0 dollars from rated companies**
- **$0/month** total infrastructure cost
- **1 founder, 1 year, evenings and weekends**

---

## The 30-second elevator pitch

"Every ethical-shopping app out there feels like vibes — opinions dressed up as ratings. I built TruNorth differently. It grades 11,000 companies using only public records — FEC, EPA, OSHA, SEC. Every score traces back to a citation. You scan a barcode in-store, get the verdict before you pay. Free, iOS, launching on Product Hunt June 23. Want me to add you to the launch list?"
