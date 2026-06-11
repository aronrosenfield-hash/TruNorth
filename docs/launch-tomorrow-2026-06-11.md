# Tomorrow's TruNorth checklist — 2026-06-11

Yesterday's payment-infra marathon got us to ~90%. These are the items
parked overnight. Most are <5 min each.

## Order of operations

### 0. **Re-upload the corrected review screenshot to BOTH subscriptions** (3 min)

The screenshot you uploaded yesterday says "save 42%" — the real saving
is **37%** ($14.99 vs $1.99×12 = $23.88). The file at
`docs/marketing/iap-review/paywall-iphone-65.png` is regenerated with
the right number (same 1242×2688 size Apple accepted).

App Store Connect → Subscriptions → **TruNorth Pro Annual** → Review
Information → replace Screenshot → Save. Repeat for **TruNorth Pro
Monthly**.

### 1. **Create TruNorth Pro Monthly subscription** (10 min)

App Store Connect → My Apps → TruNorth → Subscriptions → TruNorth Pro
group → **+ Create**

| Field | Value |
|---|---|
| Reference Name | `TruNorth Pro Monthly` |
| Product ID | `com.trunorthapp.app.pro.monthly` ⚠️ exact spelling |
| Subscription Duration | 1 month |
| Subscription Price | **$1.99 USD** (Tier 1) |
| Availability | 1 Year Upfront → All countries |
| Localization → Display Name | `TruNorth Pro · Monthly` |
| Localization → Description | `Full personalized grades + barcode scanner.` (43 chars) |
| Review Screenshot | Reuse `docs/marketing/iap-review/paywall-iphone-65.png` |
| Image (Optional) | Leave empty |
| Tax Category | Match to parent app |

Save → status flips to "Prepare for Submission" (yellow — normal).

---

### 2. **Sandbox Testers** (5 min)

App Store Connect → Users and Access → **Sandbox** tab → Testers → **+**

Create at least 3:

| Email | Use for |
|---|---|
| `sandbox+annual@trunorthapp.com` | Test annual purchase |
| `sandbox+monthly@trunorthapp.com` | Test monthly purchase |
| `sandbox+restore@trunorthapp.com` | Test Restore Purchases flow |

Country: United States. Passwords: pick something memorable.

These emails don't need to be real inboxes — Apple doesn't email them.

---

### 3. **(Decision) Family Sharing on / off?**

Subscription detail → Family Sharing section → Turn On / leave off.

- **ON** = anyone in your iCloud Family (up to 5 people) gets your Pro
  sub for free. Wife/kids covered automatically.
- **OFF** = each person pays separately. Default for most subs.

Recommended: **leave OFF for launch**, revisit post-launch.

---

### 4. **(Defer to post-launch) Offer Codes / RevenueCat grants**

These require a LIVE App Store listing to redeem against — can't do
either until Apple approves the binary. Park until after App Store goes
live (~Jun 22-23).

Notes for when ready:
- Offer Codes for friends/press: App Store Connect → Subscription →
  Promotional Offers → generate a batch (e.g. 50 codes, "1 year free").
- RevenueCat manual grants for VIPs by email: dashboard → Customers →
  Grant entitlement `pro` → choose duration.

---

### 5. **Ping me when both subs show "Prepare for Submission"**

Then I'll:
1. Run `./scripts/ship-ios.sh` → push TestFlight build with paywall
   wiring (PR #105 branch)
2. Walk you through attaching the 2 IAPs to the binary submission
3. Submit to App Review (IAP + binary reviewed together, ~24-48 hr)

After Apple approves: sandbox-test the full purchase flow → merge
PR #105 → cut the final App Store production build.

---

## Status as of end of Day 2026-06-10

- ✅ Apple banking + tax + agreements all Active
- ✅ RevenueCat configured + iOS SDK Key wired into code
- ✅ TruNorth Pro Annual: Prepare for Submission
- ✅ TruNorth Pro Monthly: created (Aron, Jun 10) — needs corrected
  37% screenshot (step 0)
- ✅ Full-app QA sweep: all 5 fix phases on main
  (`c2d587bca`..`10811f944`) + payments P0s on the PR #105 branch
  (`bc649612d`)
- ⏳ Sandbox testers: not yet created
- ⏳ TestFlight build with paywall: waiting on Monthly + sandbox testers
- ⏳ Apple Small Business Program enrollment: reminder scheduled Jun 24
  (will fire automatically)
- 📌 PR #105 (paywall flip) still DRAFT — do not merge until TestFlight
  sandbox purchase + restore verified
