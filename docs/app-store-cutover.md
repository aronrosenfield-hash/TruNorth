# TestFlight → App Store Production Cutover

> **When to run this:** The moment Apple approves the v1 submission and the listing flips to "Pending Developer Release" or "Ready for Sale."
>
> **Time:** ~30 min focused work · ~2-4 hr to fully propagate across surfaces.
>
> **Goal:** Switch every CTA, social asset, and outreach template from "TestFlight invite" to the real App Store URL within 2 hours of approval.

---

## Pre-cutover — confirm the trigger

Apple sends an email "Your app has been approved" + the App Store Connect status flips. Verify:

- [ ] App Store Connect → My Apps → TruNorth → status = "Pending Developer Release" or "Ready for Sale"
- [ ] You receive the approval email at Aron@trunorthapp.com
- [ ] The App Store URL works: `https://apps.apple.com/us/app/trunorth/idXXXXXXXXX` (replace with real ID)

If "Pending Developer Release" — that means manual release is required. Click "Release This Version" in App Store Connect to flip to "Ready for Sale."

---

## Step 1 — Capture the App Store URL (5 min)

The URL format is: `https://apps.apple.com/us/app/trunorth/id<NUMERIC_ID>`

Get it from App Store Connect → My Apps → TruNorth → App Information → look for "Apple ID" (the numeric one, NOT the Bundle ID).

**Save it for the rest of this doc:**
```
APP_STORE_URL = https://apps.apple.com/us/app/trunorth/id<XXXXXXXXX>
```

---

## Step 2 — Update the codebase constant (5 min)

The marketing landing already has an `APP_STORE_URL` constant that flips the CTA from TestFlight mailto → App Store URL automatically.

**File:** `src/MarketingLanding.jsx`

Find this line (currently empty):
```js
const APP_STORE_URL = "";
```

Replace with:
```js
const APP_STORE_URL = "https://apps.apple.com/us/app/trunorth/idXXXXXXXXX";
```

**Test:**
- `npm run build` → check `dist/` builds cleanly
- Open the production site, the hero CTA should now say "Get TruNorth on iOS" and link to the App Store (not mailto)

**Commit:**
```
git add src/MarketingLanding.jsx
git commit -m "feat: switch marketing landing CTA to live App Store URL"
git push
```

Vercel auto-deploys in 60 sec.

---

## Step 3 — Update Product Hunt First Comment (5 min)

The launch playbook has this line in the First Comment:

> "It's free forever. iOS first (App Store: [INSERT URL]). Android coming soon."

Open https://www.producthunt.com/products/trunorth?launch=trunorth (your Coming Soon page) and update the First Comment placeholder before launch day.

Pre-launch (now):
1. Go to your PH dashboard
2. Edit the saved First Comment
3. Replace `[INSERT URL]` with the real App Store URL

If the launch already happened, update the live First Comment (PH allows editing for ~30 days after launch).

---

## Step 4 — Update outreach templates (5 min)

Each of these has placeholder URLs that need to be replaced:

### `/docs/producthunt/PROMO_COPY.md`
Already filled in with PH Coming Soon URL. The App Store URL is NOT in this file — no change needed.

### `/docs/producthunt/LAUNCH_DAY_PLAYBOOK.md`
Search for `[INSERT URL]` in the First Comment block. Replace with the App Store URL.

```bash
sed -i '' 's|\[INSERT URL\]|https://apps.apple.com/us/app/trunorth/idXXXXXXXXX|g' docs/producthunt/LAUNCH_DAY_PLAYBOOK.md
```

### `/docs/trade-press-pitches.md`
The 4 press pitches reference TestFlight invites as a fallback. Now that the App Store is live:
- Find each "iOS app, free forever. Launching on Product Hunt June 23 — currently in TestFlight" line
- Change to "iOS app, free forever, live on the App Store: [URL]. Featured launch on Product Hunt June 23."

### `/docs/mailerlite-welcome-drip.md`
Email 1 and Email 3 reference "[insert when live]" for the App Store URL.
- Find: `[insert when live]`
- Replace with the App Store URL

---

## Step 5 — Update social profiles (10 min)

### Twitter / X
- Bio: include App Store link
- Pinned tweet: replace TestFlight reference with App Store
- Header image (optional): add "Now on the App Store" badge

### LinkedIn
- Personal headline mentions TruNorth
- Pinned post: replace TestFlight invite line with App Store CTA
- Company page (TruNorthApp LLC): add the App Store URL

### Personal email signature
- Replace "Subscribe to our Product Hunt launch" line with "Download TruNorth on the App Store: [URL]"
- Regenerate via `python3 /tmp/gen_signatures.py` if you want the URL embedded as a button

---

## Step 6 — Notify your network (15 min)

The people who got the personal email blast (L-3) should hear that the app is live. Quick personal text:

> "TruNorth is on the App Store! [URL] — would mean a lot if you'd check it out. Thanks for following along."

Don't blast — this goes to the same ~10-20 closest contacts you originally emailed.

---

## Step 7 — Update structured-data + SEO assets (15 min)

### Add iOS app to JSON-LD on the marketing landing

This boosts the Knowledge Graph entity for "TruNorth" by formally declaring the app as a related entity.

In `src/MarketingLanding.jsx`, find the `<head>` injection (or `vercel.json` `headers` section) and add:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "MobileApplication",
  "name": "TruNorth",
  "operatingSystem": "iOS",
  "applicationCategory": "ShoppingApplication",
  "downloadUrl": "APP_STORE_URL_HERE",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "5"
  }
}
</script>
```

(Replace ratingValue/Count when you have real App Store reviews. Don't fake them.)

### Submit to Apple's Smart App Banner

Add to `index.html`:
```html
<meta name="apple-itunes-app" content="app-id=XXXXXXXXX">
```

This makes Safari users on iOS see a native "Open in App / View in App Store" banner when they visit trunorthapp.com.

---

## Step 8 — Press follow-ups (10 min)

If you sent the L-10 trade press pitches with "currently in TestFlight," send a 1-line follow-up to each journalist:

> "Quick update: TruNorth is now live on the App Store: [URL]. Happy to send a TestFlight invite for the latest beta builds if you want to track ongoing development."

(Keep it short. Don't pitch them a new angle — just update them on the milestone.)

---

## Step 9 — Watch the metrics (recurring)

For the first 7 days post-cutover:

| Metric | Where | Watch for |
|---|---|---|
| App Store impressions | App Store Connect → Analytics | Day 1 baseline |
| First-day installs | App Store Connect → Sales | Should hit 50-200 from your network |
| Conversion rate | Impressions ÷ installs | <5% = listing needs work |
| PostHog DAU | PostHog dashboard | Confirm app actually opens |
| Crash-free rate | App Store Connect → Crashes | Should be >99% |
| Subscriber emails | MailerLite | New `app_store_landing` source if you tag |
| Reviews + ratings | App Store Connect → Ratings & Reviews | Reply to negative ones within 24hr |

---

## Step 10 — In-app changes (small, ship Build 29+)

A few small things benefit from the App Store URL being live in-app:

1. **Account → About TruNorth** → add "Rate on App Store" button → linking to `itms-apps://apps.apple.com/app/idXXXXXXXXX?action=write-review`
2. **Share my values** flow → suggested-action message updated from "Get the app" to include actual App Store link

These are minor; ship them in a regular update cycle (no rush).

---

## Common cutover mistakes

- ❌ **Forgetting the iTunes Connect SK redemption link is different from the App Store URL** — for paid users, use the SKAdNetwork URL or the standard App Store URL with `?ct=` campaign tracking
- ❌ **Hardcoding the App Store ID in multiple places** — keep it in ONE constant (`APP_STORE_URL` in MarketingLanding) and import it everywhere else
- ❌ **Pushing the change without testing the link in Safari + Chrome + Firefox** — sometimes Apple's CDN takes time to propagate
- ❌ **Updating the iOS app's What's New modal to mention being on the App Store** — that creates a tautology; new users finding the app via App Store already know

---

## Rollback (just in case)

If you find a critical bug post-launch:
1. App Store Connect → "Remove from Sale" (instant)
2. Submit a fix as version 1.0.1 (use the same review cycle)
3. Resubmit — usually expedited if you mention "fixing critical bug"

Don't try to roll back the binary itself — Apple doesn't support that. The fix is "release a new version."

---

## Post-cutover backlog

Items that become possible only after the App Store goes live:

- **L-11 cleanup**: remove the `APP_STORE_URL || "mailto:..."` fallback in MarketingLanding (now redundant)
- **Smart App Banner** — Step 7 above
- **Universal Link `apps.apple.com` redirect** — if someone visits apps.apple.com/us/app/trunorth/idXXX on iOS, Apple opens the App Store; on web it shows a preview. Wire that into the marketing landing's "Download" buttons too.
- **In-app `Rate on App Store` button** — Step 10 above
- **Bonus: SKAdNetwork campaign tracking** — for paid ads (post-LLC + payment-rails)
