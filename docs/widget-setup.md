# TruNorth Home/Lock-Screen Widget — wire-up

**Status:** all the *code* is written (Swift widget, JS data bridge, deep-link, URL scheme). What's left is a one-time **Xcode GUI setup** to create the widget *target* and the *App Group* — the two things that can't be done safely by editing project files by hand. Budget ~15 minutes. You need a **real iPhone** to see a widget (the Simulator can show it too, but a device is the honest test).

## What it does
A small/medium Home- or Lock-Screen widget showing your basket's standing — **"N clashes · X% aligned"** (or "Scan a product for its grade" when your basket is empty) — and **one tap opens the scanner**. The app writes a tiny snapshot to a shared App Group whenever your basket changes; the widget reads it and refreshes ~every 30 min.

## Files already in the repo
- `ios/App/TruNorthWidget/TruNorthWidget.swift` — the widget (WidgetKit + SwiftUI).
- `ios/App/TruNorthWidget/Info.plist` — the extension's Info.plist.
- `ios/App/TruNorthWidget/TruNorthWidget.entitlements` — the App Group entitlement.
- `src/lib/widget.js` — writes the basket snapshot to the App Group (already wired into `App.jsx`; no-op on web / until the App Group exists).
- `ios/App/App/Info.plist` — the `trunorth://` URL scheme is already registered (for the tap-to-scan).

---

## Steps

**1. Open the project in Xcode**
- Terminal: `cd ~/Developer/trunorth && npx cap open ios` (or open `ios/App/App.xcworkspace`).

**2. Add the Widget Extension target**
- Menu: **File → New → Target…**
- Pick **Widget Extension** → **Next**.
- Product Name: **`TruNorthWidget`** (exact).
- **Uncheck** "Include Live Activity" and "Include Configuration App Intent" (this widget uses a plain `StaticConfiguration`).
- **Finish**. When it asks to "Activate the TruNorthWidget scheme?" → **Activate**.

**3. Point the target at our files**
- Xcode generated a `TruNorthWidget.swift` and `TruNorthWidgetBundle.swift` (and maybe an Assets/Info.plist) under a new group. **Delete** the generated `.swift` files (Move to Trash).
- **Add** our files to the target: right-click the `TruNorthWidget` group → **Add Files to "App"…** → select `ios/App/TruNorthWidget/TruNorthWidget.swift`. In the dialog, make sure **Target membership = TruNorthWidget** (only), and **"Copy items if needed" is unchecked** (they're already in place).
- If Xcode made its own `Info.plist` for the target, either replace it with ours or leave Xcode's — both work (ours just mirrors the standard widget keys).

**4. Add the App Group to BOTH targets** (this is the shared data bridge)
- Select the **App** target → **Signing & Capabilities** → **+ Capability** → **App Groups** → **+** → add **`group.com.trunorthapp.app`** (check the box).
- Select the **TruNorthWidget** target → **Signing & Capabilities** → **+ Capability** → **App Groups** → add the **same** `group.com.trunorthapp.app` (check it).
  - *(If you prefer, set the widget target's "Code Signing Entitlements" build setting to `TruNorthWidget/TruNorthWidget.entitlements` instead — it already declares the group.)*
- Make sure **automatic signing** is on for both, same team.

**5. Sync + build**
- Terminal: `npx cap sync ios` (installs the `@capacitor/preferences` pod and refreshes the project).
- Back in Xcode: select the **App** scheme + your device → **⌘R** to build/run the app once (this writes the first snapshot).
- Then select the **TruNorthWidget** scheme → **⌘R** to preview the widget, **or** just add the widget on your phone (step 6).

**6. Add + verify the widget**
- On your iPhone: long-press the Home Screen → **+** (top-left) → search **TruNorth** → add the **Your Basket** widget (Small or Medium).
- Open the app, take the Match, save a few brands. Reopen the Home Screen — the widget should show your clashes/alignment within a refresh cycle (or force it by re-adding the widget).
- **Tap the widget** → the app should open straight to the **scanner** (the `trunorth://scan` deep-link).

---

## If the widget shows the empty state even with a basket
The only likely gotcha is the **key spelling** `@capacitor/preferences` uses. The widget already tries both `tn_widget` and `CapacitorStorage.tn_widget`. If neither works, print the real keys once:
- Temporarily add to `getTimeline` in `TruNorthWidget.swift`:
  `print("keys:", UserDefaults(suiteName: "group.com.trunorthapp.app")?.dictionaryRepresentation().keys.sorted() ?? [])`
- Run the widget scheme, read the Xcode console, and add the exact key to `candidateKeys`.

## Shipping
Once it builds, `npm run ship:ios` archives the App scheme and **embeds the widget extension automatically** — no change to `ship-ios.sh` needed. (The widget also needs its own build-number bump, which Xcode/`agvtool` handle alongside the app.)
