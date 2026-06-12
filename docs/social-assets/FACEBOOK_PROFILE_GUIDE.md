# TruNorth — Facebook Page setup

> Step-by-step to turn the blank Page into a credible, follow-worthy presence before the June 23, 2026 launch. Mirrors the LinkedIn guide; copy is tuned for Facebook's fields + character limits.

---

## 📎 Files for upload

| Asset | Location | Spec |
|---|---|---|
| Profile picture (logo) | `/docs/social-assets/linkedin-logo-400.png` | 400×400 (FB displays at 170×170) |
| Cover photo ⭐ | `/docs/social-assets/facebook-cover-1640x624.png` | 1640×624, content centered for mobile crop |
| Cover HTML source (to re-render) | `/docs/social-assets/facebook-cover.html` | open in Chrome → headless screenshot |

The logo is reused from LinkedIn (square, works everywhere). The cover is Facebook-specific — the LinkedIn banner is too thin (1128×191) and would crop badly.

---

## 1. Profile picture (2 min)

- Page → **Edit** → profile picture → upload `/docs/social-assets/linkedin-logo-400.png`
- Facebook crops to a circle — the compass mark is centered, so it survives the circle crop.

## 2. Cover photo (2 min)

- Page → camera icon on the cover → **Upload photo** → `/docs/social-assets/facebook-cover-1640x624.png`
- Drag to reposition if needed; the hero is centered so default position is fine.
- Desktop shows the full width; mobile center-crops the sides — all essential text sits in the safe middle.

## 3. Page name + username (3 min)

| Field | Value |
|---|---|
| **Page name** | `TruNorth` (one word — never "Tru North") |
| **Username / @handle** | `@trunorthapp` (gives you `facebook.com/trunorthapp`) |

Set the username under **Edit** → **Username**. Must be 5+ chars; `trunorthapp` matches your domain + Product Hunt slug. If taken, fall back to `@trunorth.app` or `@gettrunorth`.

## 4. Category (2 min)

Pick up to 3 (Facebook uses these for discovery + the Page subtitle):
1. **Software** (primary)
2. **App Page** / **Mobile App**
3. **Shopping & Retail** *(or "Cause" if you want the values framing front-loaded)*

## 5. Bio — short description (101 char max)

Facebook truncates hard at 101 characters. Use:

```
Shop your values. We grade 12,000+ brands using only public records. Free on iOS.
```

(80 chars.) Alternate:

```
Know where your money goes. 12,000+ brands graded from 200+ public-record sources.
```

(81 chars.)

## 6. Contact + basic info (5 min)

Page → **Edit** → **Page info**:

| Field | Value |
|---|---|
| **Website** | `https://www.trunorthapp.com` |
| **Email** | `aron@trunorthapp.com` |
| **Phone** | *(leave blank — optional, don't expose a personal cell)* |
| **Location** | `Texas, United States` (city optional; "does not have a storefront" is fine) |
| **Hours** | Set to **"Always open"** or leave unset — it's an app, not a shop |
| **Price range** | Leave blank (core app is free) |

## 7. Action button / CTA (2 min)

Page → **Add action button** (under the cover). Best options, in order:
1. **Sign Up** → `https://www.trunorthapp.com` (routes to the TestFlight / waitlist CTA)
2. After App Store approval, switch to **Use App** / **Download** → App Store URL

Avoid "Contact Us" / "Send Message" as the primary — adds reply pressure. "Sign Up" → website is the lowest-friction conversion path.

## 8. "Intro" / detailed About (longer — no hard 101 limit)

Page → **Edit** → **About** → **Additional information**. Paste:

```
TruNorth is the conscious-consumer shopping app for people who want their money to match their values.

We grade 12,000+ consumer brands across 9 categories — political donations, environmental record, labor practices, DEI, animal welfare, firearms policy, data privacy, executive pay, and charitable giving — using 200+ public-record sources. No vibes. No opinions. Every grade traces back to a primary record you can audit yourself.

Take a 30-second values quiz and every brand grade is personalized to what you actually care about. Search or scan 12,000+ brands in-store before you pay. Subsidiaries roll up to their parent companies, so you never accidentally reward the holding company you were boycotting.

Free forever for the core grading. iOS first, Android to follow. Launching on Product Hunt June 23, 2026.

Learn more: www.trunorthapp.com
```

## 9. "Our Story" panel (optional but recommended)

Pages let you add a featured **Story** with its own header image + title. Use the founder angle:

**Title:** `Why we built TruNorth`

**Body:**
```
Every "ethical shopping" app I tried felt like vibes — opinions dressed up as ratings. So I built TruNorth differently.

It pulls from primary sources only: FEC for political donations, EPA for environmental enforcement, OSHA for labor violations, SEC for executive pay, and 90+ more. 12,000+ companies graded. Every score traceable to a public record you can check yourself.

Scan a barcode in-store and get the verdict before you pay. Free forever, iOS first.

— Aron, founder
```

---

## 10. First 3 posts to seed the Page (15 min)

Post in order, ~3 days apart. **Pin Post 1** to the top of the Page (post → ⋯ → Pin to top).

### Post 1 — launch the Page (PIN THIS)

```
We just launched TruNorth's Facebook page 👋

If you've ever wondered "is this brand actually doing what they say?" — we built the answer.

200+ public-record sources. 12,000+ brands. Grades you can trace back to the EPA filing, the OSHA violation, the SEC litigation, the FEC donation.

No vibes. No paid ratings. No engagement traps.

iOS public launch on Product Hunt: June 23, 2026. Follow along — the next few weeks are the build-up.

👉 www.trunorthapp.com
```

### Post 2 — "Why 100 sources"

```
A lot of shopping apps tell you what to buy. Almost none show you why.

TruNorth's brand grades are powered by 200+ public-record sources, including:

▶ FEC.gov — every campaign donation
▶ EPA ECHO — environmental violations by facility
▶ OSHA — workplace safety inspections + fines
▶ CourtListener — federal lawsuits by case type
▶ SEC EDGAR — executive pay ratios
▶ ATF FFL — firearms licenses by state
▶ CISA / NIST — data breach + CVE history

Plus 93 more.

If an app says "Brand X is bad" — ask which filing. We can show you.

Launching on Product Hunt June 23.
```

### Post 3 — "How it works" (closer to launch)

```
TruNorth in 30 seconds:

1️⃣ Take the quiz — pick the 9 values that matter to you
2️⃣ Search or scan any brand
3️⃣ Get a letter grade personalized just for you

What makes it different is the audit trail. Every grade traces back to a primary source — a federal filing, a court case, a certification. No editorial. No paid ratings.

iOS launch: June 23 on Product Hunt. Comment 👋 if you want a TestFlight beta invite.
```

---

## 11. Grow the Page (ongoing)

- **Invite friends:** Page → ⋯ → **Invite friends** → select your personal Facebook connections (free, one invite per friend). Do this in waves like the LinkedIn plan: closest circle first.
- **Cross-link your personal profile:** add "Founder, TruNorth" to your personal Facebook work info and link the Page.
- **Cadence:** 1 post/week until launch; daily during launch week (Jun 17–30); 2–3/week after.
- **Mix:** 60% educational (a source we use), 30% product (what we shipped), 10% behind-the-scenes.
- Facebook favors **native video** and **photo** posts over bare links — when you have the PH demo video (L-9), post it natively here, with the link in the first comment rather than the post body (link-in-body suppresses reach).

---

## ✅ Quick checklist

- [ ] Profile picture uploaded (logo-400)
- [ ] Cover photo uploaded (facebook-cover-1640x624)
- [ ] Page name = TruNorth, username = @trunorthapp
- [ ] Categories set (Software / App / Shopping)
- [ ] Bio (101-char) added
- [ ] Website + email filled in
- [ ] Action button = Sign Up → trunorthapp.com
- [ ] About / Additional info pasted
- [ ] "Our Story" added (optional)
- [ ] Post 1 published + pinned
- [ ] Posts 2 & 3 scheduled
- [ ] First invite wave sent

*Estimated time for steps 1–9: ~25 minutes. Steps 10–11 are ongoing.*
