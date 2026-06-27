# Launch Day — Go-Live Runbook

> Prepared 2026-06-18. **v1.0 (Build 75) is APPROVED** and set to **"Manually release this version"** → it's sitting at **"Pending Developer Release."** Nothing is live until you pull the levers below. Manual release = you control the timing; release the morning of the Product Hunt launch so traffic hits a live link.

## The App Store URL
```
https://apps.apple.com/app/id6775301458
```
Goes live the moment you hit **Release** in App Store Connect. 404s until then.

## Go-live steps (~10 min of clicks, then a few hours to propagate)
1. **Release in App Store Connect** — Distribution → the 1.0 version → **"Release This Version"** (it's at "Pending Developer Release"). The app goes live on the Store within ~1–4 hours.
2. **Flip the website CTA** — in `src/MarketingLanding.jsx` line 46, change `const APP_STORE_URL = "";` → `const APP_STORE_URL = "https://apps.apple.com/app/id6775301458";`. This **auto-swaps** the landing hero CTA from the TestFlight mailto to a real **"Download on the App Store"** button, and flips the subtext. Merge to `main` → Vercel deploys. *(Claude does this one-liner + deploy in ~5 min on your word — say "flip the App Store URL live.")*
3. **Post the launch copy** — Product Hunt first comment + social, with the URL inserted. The kit lives in `docs/producthunt/` (PROMO_COPY, FIRST_COMMENT, LAUNCH_DAY_PLAYBOOK). Claude inserts the live URL into these on your go.

## What's already done / ready
- ✅ Web changes (pricing $14.99/$1.99, Android waitlist, Methodology fix) are merged + deployed (PR #109).
- ✅ Landing CTA logic is wired — it flips automatically once `APP_STORE_URL` is set; no other code change needed.
- ⬜ Launch copy: insert the App Store URL into the PH first comment + social posts (Claude does on your go).
- ⬜ Optional email blast to the MailerLite list announcing the live app.

## Notes
- **Android** stays on the waitlist (the landing already has the Android waitlist CTA + `#get-notified` capture).
- The App Store listing name shows as **"TruNorthApp"** (App Information → Name). If you want it to read **"TruNorth"** on the Store, that's a metadata edit you can make anytime (non-blocking).
