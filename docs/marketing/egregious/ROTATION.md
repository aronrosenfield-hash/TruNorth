# "5 Most Egregious" rotation

A unified, deterministic rotation of 5 data-driven "wait, REALLY?" facts
surfaced across three TruNorth marketing surfaces:

1. **Marketing website banner** (`banner-website-{1..5}.png`, 1280×320)
2. **Email banner** (`banner-email-{1..5}.png`, 600×200 — single-image embed)
3. **iOS post-Welcome splash** (`ios-splash-{1..5}.png`, 1320×2868)

Plus social cards (`social-{1..5}.png`, 1200×675, X / LinkedIn spec) and a
contact sheet for QA (`contact-sheet-website.png`).

All three surfaces show the **same fact on the same day**, driven by one
JSON file and one tiny pure function.

---

## Source of truth

[`public/data/_meta/egregious-facts.json`](../../../public/data/_meta/egregious-facts.json)

```json
{
  "rotationDays": 3,
  "epoch": "1970-01-01",
  "facts": [ { id, brandSlug, brandName, lens, statNumber, statUnit,
               statKicker, context, shortContext, source, sourceUrl,
               cta, deeplink }, ... ]
}
```

- `rotationDays` — number of days each fact stays current. Default `3`.
- `epoch` — anchor date for rotation math. Don't change unless you want
  the schedule to shift.
- `facts[]` — ordered list. Order = rotation order.

---

## Rotation engine

[`scripts/lib/egregious-rotation.mjs`](../../../scripts/lib/egregious-rotation.mjs)

```js
import { getCurrentEgregious } from './scripts/lib/egregious-rotation.mjs';

const { fact, index, nextRotationDate } = getCurrentEgregious({
  facts,            // raw.facts
  rotationDays: 3,  // raw.rotationDays
  date: new Date()  // optional, defaults to "now"
});
```

Formula:

```
daysSinceEpoch = floor((utcMidnightOfDate - epochUtcMs) / 86_400_000)
slot           = floor(daysSinceEpoch / rotationDays)
index          = slot % facts.length
```

UTC day boundaries are used so the rotation flips at the same instant
worldwide — no time-zone drift between server-rendered email and
client-side iOS splash.

The function is **pure and idempotent**: same date in, same fact out, on
every surface. No state, no DB.

---

## How each surface consumes the rotation

| Surface | When it picks | How it picks |
| --- | --- | --- |
| Marketing website banner | Per request (or per build, if static) | Fetch `/data/_meta/egregious-facts.json` → call `getCurrentEgregious()` → render the matching `banner-website-N.png` |
| Email (MailerLite / Resend) | Just before each send | Email script imports `getCurrentEgregiousFromDisk()` → embeds the matching `banner-email-N.png` as a single `<img>` |
| iOS splash | On app launch / after Welcome | Capacitor JS reads `/data/_meta/egregious-facts.json` from the bundled assets → shows the matching `ios-splash-N.png` |

All three surfaces ship **all five** PNGs (~3 MB total), so the rotation
is offline-safe and zero-network on the iOS side.

---

## Producing the PNGs

```bash
node scripts/build-egregious-banners.mjs
```

Reads `public/data/_meta/egregious-facts.json`, writes 21 PNGs to
`docs/marketing/egregious/`. Re-run whenever the JSON changes.

The renderer is type-driven SVG → sharp (no headless browser, no
network). Brand palette + fonts match `docs/TALK_TRACKS.md`:

- Primary purple gradient `#7c6dfa → #5b4ed7`
- Dark surface `#0a0a0a`, text `#f2f2f2`, dim `#a8a8a8`
- `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`
- Stat number weight 900, kerning -6 to -22 px

---

## Modifying the rotation

### Add a 6th fact
1. Append a new entry to `facts[]` in the JSON.
2. Run `node scripts/build-egregious-banners.mjs` — it auto-emits a `*-6.png` for every surface.
3. All three surfaces pick it up automatically; rotation period becomes 18 days instead of 15.

### Swap an existing fact
1. Edit the entry in place (keep its position).
2. Re-run the producer.
3. Same calendar slot, new content. No code changes.

### Change cadence
- Set `rotationDays` to `1` (daily), `7` (weekly), etc. No code changes.

### Reorder
- Reorder the array. Be aware: this **shifts the schedule**, so today's
  fact may change. Pin the order at launch and only append after.

---

## Rotation schedule (around Product Hunt launch, June 23 2026)

| Date (UTC) | # | Fact |
| --- | --- | --- |
| 2026-06-08 | 1 | Home Depot — 2,026× CEO pay |
| 2026-06-09 → 11 | 2 | Amazon — 785 Prop 65 notices |
| 2026-06-12 → 14 | 3 | Colgate-Palmolive — 18/35 unpublished trials |
| 2026-06-15 → 17 | 4 | Starbucks — 269 labor actions |
| 2026-06-18 → 20 | 5 | Shein — 5/100 transparency |
| **2026-06-21 → 23** | **1** | **Home Depot — 2,026× CEO pay (launch day)** |
| 2026-06-24 → 26 | 2 | Amazon — 785 Prop 65 notices |

The schedule naturally lands fact #1 (Home Depot) on Product Hunt launch
day. This is the strongest "wait, REALLY?" hook — keep it.

If for any reason you need to force a different fact for launch day,
either reorder `facts[]` or bump the JSON's `epoch` by N days; the
rotation will slide deterministically.
