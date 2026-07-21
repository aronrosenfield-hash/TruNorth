# Android Launch Plan (Phase 6.a)

> **Status:** queued. Blocked on iOS App Store launch.
> **Estimated effort:** 1 full focused day end-to-end.
> **One-time cost:** $25 (Google Play Developer account).

---

## Why wait for iOS first

Same Capacitor + React codebase. Every iOS bug you fix needs an Android equivalent fix. Cheapest to ship iOS, iterate based on real feedback, then port the polished version.

You're also currently the only TestFlight tester — until you have ~5-10 real users on iOS, you don't have signal to know what Android changes matter.

---

## Day-of execution checklist

### Morning: scaffold + Android Studio (~2 hours)

1. **Install Android Studio** (free)
   - https://developer.android.com/studio
   - During install: accept all default SDK components
   - Open it once → let it download additional SDKs (~30 min)

2. **Install JDK 17** (if not already)
   - Verify: `java -version` should show 17+
   - If missing: `brew install openjdk@17`

3. **Add Android target to the Capacitor project**
   ```bash
   cd /Users/aronrosenfield/Developer/trunorth
   npx cap add android
   npx cap sync android
   ```
   Generates `android/` directory with the full Gradle project.

4. **Edit `android/app/src/main/AndroidManifest.xml`**
   - Should already have permissions for camera (scanner), internet (data), etc. — Capacitor scaffolds them
   - Add `android:label="TruNorth"` if not set

5. **Smoke test in emulator**
   ```bash
   npx cap open android
   ```
   Opens Android Studio → run on a Pixel emulator → verify app launches, splash shows, navigation works, scanner permission prompts on tap.

### Afternoon: signing + Play Console (~3 hours)

6. **Generate release signing key**
   ```bash
   keytool -genkey -v -keystore ~/Developer/keys/trunorth-release.keystore \
     -alias trunorth -keyalg RSA -keysize 2048 -validity 25000
   ```
   - Set a strong password — store it in your password manager
   - Save the keystore file PERMANENTLY (losing it = can never update the app on the same listing)
   - Back it up to encrypted cloud storage

7. **Configure signing in `android/app/build.gradle`**
   ```gradle
   android {
     signingConfigs {
       release {
         storeFile file("/Users/aronrosenfield/Developer/keys/trunorth-release.keystore")
         storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
         keyAlias "trunorth"
         keyPassword System.getenv("ANDROID_KEY_PASSWORD")
       }
     }
     buildTypes {
       release {
         signingConfig signingConfigs.release
         minifyEnabled true
         proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
       }
     }
   }
   ```

8. **Sign up for Google Play Developer Console** ($25 one-time)
   - https://play.google.com/console
   - Use the same email as your Apple Developer / Google Workspace
   - Identity verification (~24 hours)

9. **Create the Play Console app listing**
   - Package name: `com.trunorthapp.app` (matches iOS bundle ID)
   - Default language: English (US)
   - App or game: App
   - Free or paid: Free (paid features later via in-app purchases)
   - Declarations: privacy policy URL = `https://www.trunorthapp.com/#privacy`

9b. **Payments parity — Play products + RevenueCat + service account** *(added 2026-07-20, B-75)*

    Pro is the only revenue, and none of this existed when the Android scaffold
    landed: `payments.js` read only `VITE_REVENUECAT_IOS_KEY` and passed it
    unconditionally, so on Android RevenueCat got an iOS key — the paywall
    rendered and every purchase failed. The code now selects the key by
    `Capacitor.getPlatform()`; the rest is account setup.

    **Order matters** — each step needs the previous one:

    1. **Create the two Play subscriptions** (needs the listing from step 9).
       Play Console → Monetize → Subscriptions → Create. Use the SAME product
       IDs as iOS so one entitlement serves both platforms:
       `com.trunorthapp.app.pro.annual` ($14.99/yr) and
       `com.trunorthapp.app.pro.monthly` ($1.99/mo).

    2. **Create the Google Play app in RevenueCat.**
       RevenueCat → Apps → **+ New → Google Play Store**, package
       `com.trunorthapp.app`. ⚠️ Until you do this there is NO Android SDK key
       to find — the API keys page only lists the iOS app.
       The **public SDK key (`goog_…`) is issued at app creation**, so you can
       grab it and unblock the build BEFORE the service account exists.

    3. **Attach both products to the existing `TruNorth Pro` entitlement**
       in RevenueCat. This is what makes `hasProEntitlement()` work on Android
       with zero code changes — the entitlement ID is already hardcoded in
       `src/lib/payments.js`.

    4. **Create the Play service account** — this is what lets RevenueCat
       *validate* purchases and receive renewal/cancel/refund notifications.
       It does not exist by default; you generate it:
       - Play Console → **Setup → API access** → link (or create) a Google
         Cloud project.
       - **Create new service account** → opens Google Cloud Console → name it
         e.g. `revenuecat-play` → Create → Done.
       - That service account → **Keys → Add key → Create new key → JSON**.
         The downloaded `.json` IS the credential.
       - Back in Play Console → **Refresh service accounts** → **Manage Play
         Console permissions** → grant *View financial data*, *Manage orders
         and subscriptions*, *View app information*.
       - RevenueCat → the Google Play app → upload that JSON.
       - 🔐 The JSON is a secret: never commit it, never paste it into chat or
         email. If it leaks, revoke the key in Cloud Console and issue a new one.
       - ⏳ Google's permission propagation can take **24–36 hours**. RevenueCat
         may report a credentials error immediately after setup even when
         everything is correct. Wait a day before debugging it.

    5. **Put the key in your LOCAL `.env`** (see `.env.example`):
       ```
       VITE_REVENUECAT_ANDROID_KEY=goog_...
       ```
       ⚠️ The APK/AAB is built from `dist/`, which `npm run build` generates on
       your machine. Setting this ONLY in Vercel affects the web deploy and
       ships a binary with no key — purchases fail silently. It must be local.
       Use the **public SDK key**, never a Secret API key: `VITE_` vars are
       compiled into the client bundle.

9c. **App Links — publish `assetlinks.json`** *(added 2026-07-20, B-75)*

    The manifest already declares `autoVerify` App Links for
    `www.trunorthapp.com` + `trunorthapp.com` on `/company/*` and `/c/*`,
    mirroring the iOS associated-domains entitlement. But verified on a Pixel 8:
    `pm get-app-links` reports state **1024 (no response)**, and on Android 12+
    an UNVERIFIED https link does **not** show an "open with" chooser — it goes
    straight to the browser. Confirmed: a shared brand link opened Chrome, while
    the same link targeted explicitly (`am start … -p com.trunorthapp.app`)
    opened the app. So the filter and in-app routing are correct; only the
    verification file is missing.

    Needs the RELEASE keystore from step 6 (the debug cert won't do):
    ```bash
    keytool -list -v -keystore ~/Developer/keys/trunorth-release.keystore \
      -alias trunorth | grep "SHA256:"
    ```
    Then publish at `https://www.trunorthapp.com/.well-known/assetlinks.json`:
    ```json
    [{
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": { "namespace": "android_app",
                  "package_name": "com.trunorthapp.app",
                  "sha256_cert_fingerprints": ["<SHA256 from above>"] }
    }]
    ```
    Serve it as `application/json` with no redirect. Android re-verifies on the
    next install/update. Until this ships, shared brand links land in the
    browser on Android.

10. **Build release AAB** (Android App Bundle — Google Play preferred format)
    ```bash
    cd /Users/aronrosenfield/Developer/trunorth
    npx vite build
    npx cap sync android
    cd android
    ANDROID_KEYSTORE_PASSWORD=... ANDROID_KEY_PASSWORD=... ./gradlew bundleRelease
    ```
    Output: `android/app/build/outputs/bundle/release/app-release.aab`

11. **Upload to Internal Testing track** (Google's TestFlight equivalent)
    - Play Console → Testing → Internal testing → Create new release
    - Upload `app-release.aab`
    - Add up to 100 testers by email
    - Internal testing is INSTANT — no review delay (unlike Closed/Production tracks)

### Evening: polish & ship (~2 hours)

12. **Android Chrome parity fixes** (likely already done in code, verify on device):
    - System back gesture closes modals/quiz progressively (history popstate)
    - Status bar tint matches app theme (`@capacitor/status-bar` plugin already wired)
    - Safe-area-inset works (we already use `env(safe-area-inset-*)`)
    - Camera permission prompts properly on first scanner tap

13. **ML Kit native scanner** (the iOS deferral also affects Android)
    - On Android, `@capacitor-mlkit/barcode-scanning` works natively via Google Play Services ML Kit (no Podfile equivalent needed — Gradle just resolves the dependency)
    - Should "just work" after `npx cap sync android` and rebuild
    - Test by scanning a real barcode

14. **Test on a REAL Android phone** if you have one (emulator misses real-device quirks)
    - Sideload via USB debugging
    - Verify: scanner, deep links, share button, install/uninstall

15. **Add a `scripts/ship-android.sh`** mirroring `ship-ios.sh`
    - vite build → cap sync android → gradle bundleRelease → upload via fastlane supply (or manual Play Console)

### Next day or two: launch

16. **Submit to Closed Testing** (small invite list, no review delay, lets you collect real user feedback before public launch)
17. **Submit to Open Testing** (anyone with the link can join — feeds into the Play Store listing as "Beta")
18. **Submit to Production** (~3-7 day review for first submission, faster for updates)

---

## Code changes likely needed

Most of the iOS work translates 1:1 to Android. A few Android-specific things to confirm:

| Concern | Status | Action |
|---|---|---|
| Status bar tint dark | ✅ wired via `@capacitor/status-bar` | Verify on emulator |
| Splash screen | ✅ shared config in `capacitor.config.json` | Generate `splash.xml` in `android/app/src/main/res/drawable/` from same source PNG |
| App icon | ⚠️ Android needs its own asset set | Use Android Studio's "Image Asset" wizard with the same source logo |
| Back gesture handling | ⚠️ android-specific | `@capacitor/app` listener for `backButton` → wire to close top modal |
| Push notifications | ⏸ defer | If we add later: FCM setup ~half day |
| Deep links from share URLs | ⚠️ need to add `<intent-filter>` to AndroidManifest.xml | One config block, ~15 min |

---

## Decision: trim test runtime by reusing fleet QA

Once Android is in Internal Testing, re-run the 10-agent QA fleet against the live URL to catch Android-specific regressions. The fleet already includes a "Pixel 7" lens — just need to actually exercise it on real device.

---

## Total budget

| Item | Time | Cost |
|---|---|---|
| Android Studio + JDK install | 2 hours | $0 |
| `npx cap add android` + sync + smoke test | 1 hour | $0 |
| Release key generation + signing config | 30 min | $0 |
| Google Play Developer account | 30 min | $25 |
| Play Console app listing | 1 hour | $0 |
| Build + upload first AAB | 30 min | $0 |
| Internal testing | 1 hour | $0 |
| Android-specific polish | 1-2 hours | $0 |
| **Total** | **~7-9 hours** | **$25** |

---

## When to revisit

After ~1-2 weeks of iOS App Store launch data:
- If iOS conversion math works → ship Android same week (Android = larger global market)
- If iOS has unresolved blocker bugs → fix on iOS first, then port
- If iOS has zero users → don't bother with Android yet, focus on iOS marketing
