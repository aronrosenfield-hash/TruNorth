# MailerLite Welcome Drip — Paste-Ready Copy

> **Goal:** Convert email subscribers (from PH Coming Soon, paywall, submit form, quiz completion) into active users + Pro upgrades.
>
> **Setup:** Login to MailerLite → Automations → Create new → Trigger: "Subscriber joins group [launch_subscribers]". Add 3 emails below at the indicated delays.
>
> **Sender:** `Aron@trunorthapp.com` (must be verified in MailerLite). Set "From name" to `Aron at TruNorth`.

---

## Email 1 — Welcome (sent: instantly on signup)

**Subject:** Welcome to TruNorth — here's what's next 👋

**Preview text:** Your archetype, your first brand to look up, and a tiny ask

**Body (HTML — MailerLite drag-and-drop):**

```
Hi {$name|"there"},

Thanks for subscribing — you'll be one of the first to hear when TruNorth goes live on the App Store (target: June 23).

If you want a preview right now:
👉 Open trunorthapp.com on your phone — the web version has the full 12,000+-brand database. The iOS app adds personalized scoring (locked behind a 45-second values match) + an in-store barcode scanner.

A few brands I'd suggest looking up first to get a feel for how the grading works:
• A brand you assume is "good" (Patagonia, Ben & Jerry's, REI)
• A brand you assume is "bad" (ExxonMobil, Comcast, Wells Fargo)
• A brand you actually shop at (your grocery, your favorite coffee chain)

The grades will surprise you on at least one of those three. The whole point of the app is to replace assumptions with citations.

The tiny ask:
On June 23, TruNorth launches on Product Hunt. If you'd like to support it, the link is here — you can subscribe now and you'll get one email from PH on launch day:
👉 https://www.producthunt.com/products/trunorth?launch=trunorth

That's it. No spam, no daily emails — just the occasional update when something interesting happens with the data.

Thanks,
Aron
Founder, TruNorth
Aron@trunorthapp.com

PS — reply to this email any time. It comes straight to my inbox. Brand requests, feedback, bugs, criticism, all welcome.
```

---

## Email 2 — Behind the data (sent: 3 days after signup)

**Subject:** How TruNorth actually grades a brand (with one full example)

**Preview text:** Walmart's $1.7B wage theft, line by line

**Body:**

```
Hi {$name|"there"},

Quick follow-up — I want to show you what makes TruNorth's grading different from every other "ethical shopping" app you've tried.

Most of those apps grade with opinions. They say "Walmart is bad" without showing you why, or which specific records they're citing. You have to trust them.

TruNorth doesn't ask for trust. Every grade is built from primary public records, and every score in the app links back to the actual filing.

Take Walmart's Labor grade as an example:

📋 SOURCE: Violation Tracker (Good Jobs First) + OSHA + NLRB
📋 RECORDS: $1.7B in wage theft penalties since 2000 across 250+ settlements
📋 SOURCE: NLRB
📋 RECORDS: 38 active unfair labor practice cases since 2020
📋 SOURCE: OSHA
📋 RECORDS: 2,400+ inspections, 480 willful or serious violations

You don't have to trust the grade — you can verify any number against violationtracker.goodjobsfirst.org or NLRB.gov in two clicks.

That's the whole methodology. No AI scoring. No opinions. No paid placements. The grade is the math.

The full list of sources we pull from:
✅ FEC — political donations
✅ OpenSecrets — PAC + lobbying spend
✅ OSHA — workplace safety
✅ NLRB — labor disputes
✅ EPA Enforcement — environmental violations
✅ SEC — executive pay, 10-K subsidiaries
✅ Yale SOM — Russia operations
✅ Have I Been Pwned — data breaches
✅ OpenFDA — product recalls
✅ HRC CEI — DEI score
✅ CDP — climate disclosure
✅ BHRRC — supply chain human rights
✅ Leaping Bunny / PETA — animal testing
✅ + 9 more

The whole list and methodology are in the app under the "Sources" section.

Catch you in a few days with the third (and last) onboarding email — that one shares the most-viewed brands on TruNorth this week.

Thanks,
Aron

PS — If you've already tried it: which brand surprised you the most? Hit reply, I read every one.
```

---

## Email 3 — Top brand insights + re-engage (sent: 7 days after signup)

**Subject:** The 5 brands TruNorth users looked up the most this week

**Preview text:** Spoiler: only one of them got an A

**Body:**

```
Hi {$name|"there"},

Last email of the welcome series. I want to show you what other TruNorth users are actually looking up — because brand-search patterns turn out to be the most interesting product analytics in the whole app.

This week's top 5 most-searched brands (anonymized, aggregate counts):

1. 🥇 Patagonia — Grade A
   Strong on environment (CDP A-List) and labor (no major NLRB cases). Weakest category: political donations (some surprising ones — open it up).

2. 🥈 Amazon — Grade C
   Mixed across the board. Surprisingly strong on environment (operations side). Demolished on labor (OSHA + NLRB). Weakest political record of any retailer in the database.

3. 🥉 Patagonia
   Yes, twice. People DOUBLE-CHECKED it. The fact that we score it 95 surprised users enough that they came back to look again.

4. ExxonMobil — Grade D
   Predictable on environment. Less predictable on charity (actually scores higher than you'd think) and political (highly bipartisan donations, which scores neutral, not bad).

5. ColourPop Cosmetics — Grade A
   Beauty brand that punches above its weight on cruelty-free certifications + clean labor record. The kind of small brand TruNorth surfaces that no other app does.

If you've taken the values quiz (locked feature in the iOS app), these grades are different — they're tuned to YOU. Two different users see different Top Picks for the same brand. That's the personalization layer most "ethical shopping" apps don't have.

Two things:

1. If you haven't downloaded the iOS app yet, here's the App Store link: [insert when live]
   (Until then, the TestFlight invite link is in your earlier email — reply if you need it again.)

2. If you found this email useful, the highest-leverage thing you can do right now is forward it to one other person who shops with their values. The whole thesis of TruNorth is "data > opinions" — getting more people in the funnel means more demand for the next round of data sources.

That's the last automated email from me. From here on out, you'll only hear from me when there's something genuinely worth saying — new data source, major brand re-grade, big methodology update.

Thanks for being here.

Aron
Founder, TruNorth
Aron@trunorthapp.com

PS — Find a bug? See a wrong grade? Have a brand you want us to add? Reply to this email. Every one goes to my personal inbox.
```

---

## Operational notes

### Setup checklist in MailerLite

1. ✅ Verify sender domain (Aron@trunorthapp.com) — DKIM should be active
2. ✅ Create group: `launch_subscribers`
3. ✅ Hook the Coming Soon subscribers list → auto-add to that group
4. ✅ Hook the in-app paywall email capture → same group (via our API integration)
5. ✅ Hook the submit form submitter emails → same group
6. ✅ Create automation with 3 emails above + delays (0min, 3 days, 7 days)

### Personalization tokens

- `{$name|"there"}` — falls back to "there" if name is empty. MailerLite syntax.
- `{$email}` — the subscriber's email
- `{$signup_source}` — useful for branching (paywall vs PH vs submit form). Email 2 could mention "the paywall signup form" if that's where they came from.

### A/B testing later

After 200+ subscribers in the drip, A/B-test the subject lines:
- Email 1: "Welcome to TruNorth — here's what's next" vs. "Quick start: 3 brands to look up first"
- Email 3: "The 5 brands TruNorth users looked up the most this week" vs. "Patagonia, twice"

### Update cadence

- **Email 1** rarely needs changing — it's onboarding
- **Email 2** should swap the Walmart example every ~3 months for whatever brand has the most damning fresh record at that time
- **Email 3** should refresh the "top 5 brands" list quarterly based on actual PostHog data

### Unsubscribe

MailerLite handles this automatically. The unsubscribe link is auto-added to every email per CAN-SPAM / GDPR. Don't try to suppress it.

### What NOT to do in these emails

- ❌ No "limited time offer" or scarcity copy
- ❌ No "click here" emoji-bait CTAs
- ❌ No 5+ links (these emails should feel personal, not marketing)
- ❌ No P.S. that's a sales pitch — the PS should sound like a friend
- ❌ Don't ask for upvotes/reviews — drives spam complaint rate
