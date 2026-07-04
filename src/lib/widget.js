// Widget data bridge — writes a small basket snapshot into the shared App Group
// (group.com.trunorthapp.app) so the WidgetKit extension can render it.
// See ios/App/TruNorthWidget/TruNorthWidget.swift + docs/widget-setup.md.
//
// Native-only and fully graceful: on web, or before the App Group + the
// @capacitor/preferences group are wired up on-device, every call is a silent
// no-op — nothing here can break the app.

import { Capacitor } from "@capacitor/core";

const APP_GROUP = "group.com.trunorthapp.app";
const KEY = "tn_widget";

let configured = false;

/**
 * Persist the basket snapshot for the widget.
 * @param {{pct:number|null, clashes:number, graded:number, savedCount:number, topClash:string|null}} snap
 */
export async function writeWidgetSnapshot(snap) {
  if (!Capacitor?.isNativePlatform?.()) return; // web / SSR — no widget
  try {
    const { Preferences } = await import("@capacitor/preferences");
    if (!configured) {
      // Route reads/writes to the App Group UserDefaults suite the widget reads.
      await Preferences.configure({ group: APP_GROUP });
      configured = true;
    }
    const payload = JSON.stringify({
      pct: snap.pct ?? null,
      clashes: Number(snap.clashes) || 0,
      graded: Number(snap.graded) || 0,
      savedCount: Number(snap.savedCount) || 0,
      topClash: snap.topClash || null,
      updatedAt: Date.now(),
    });
    await Preferences.set({ key: KEY, value: payload });
    // WidgetKit picks this up on its next timeline refresh (~30 min). An explicit
    // WidgetCenter.reloadAllTimelines() would need a tiny native call — deferred;
    // the periodic refresh is enough for a basket that changes rarely.
  } catch {
    /* plugin missing / group not entitled yet — no-op */
  }
}
