# Egregious Rotation (30 brands)

A unified, deterministic rotation of 30 data-driven facts surfaced
across TruNorth's marketing surfaces:

1. **Marketing website banner** (`banner-website-{slug}.png`, 1280×320)
2. **Email banner** (`banner-email-{slug}.png`, 600×200 — single-image embed)
3. **Social card** (`social-{slug}.png`, 1200×675 — X / LinkedIn spec)
4. **iOS post-Welcome splash** (`ios-splash-{slug}.png`, 1320×2868)

Plus 4 contact sheets (`contact-sheet-{website,email,social,ios-splash}.png`)
for QA.

All four surfaces show the **same fact on the same day**, driven by one
JSON file and one tiny pure function.

---

## Source of truth

[`public/data/_meta/egregious-facts.json`](../../../public/data/_meta/egregious-facts.json)

```json
{
  "rotationDays": 1,
  "epoch": "1970-01-18",
  "facts": [ { id, brandSlug, brandName, polarity, brandLogoUrl,
               lens, statNumber, statUnit, statKicker, context,
               shortContext, source, sourceUrl, cta, deeplink }, ... ]
}
```

- `rotationDays` — **1** (daily rotation; 30 facts = 30-day cycle).
- `epoch` — **1970-01-18** (chosen so fact index 0 = Home Depot lands on
  Product Hunt launch day, **June 23, 2026**).
- `facts[]` — ordered list. Position 0 is launch-day hero.

New fields (additive — backward compatible with prior 5-brand schema):

- `polarity: "positive" | "negative"` — drives accent colour. Positive
  → green `#4caf82`. Negative → purple `#7c6dfa` (default).
- `brandLogoUrl` — Wikipedia article URL used by
  `scripts/_fetch-brand-logos.mjs` to resolve a Wikidata P154 logo file
  on Commons. Null/missing → banner renders without a brand logo.

---

## Rotation engine

[`scripts/lib/egregious-rotation.mjs`](../../../scripts/lib/egregious-rotation.mjs)

```js
import { getCurrentEgregious } from './scripts/lib/egregious-rotation.mjs';

const { fact, index, nextRotationDate } = getCurrentEgregious({
  facts,            // raw.facts (30 entries)
  rotationDays: 1,  // raw.rotationDays
  epoch: '1970-01-18',
  date: new Date(), // optional, defaults to "now"
});
```

Formula (unchanged from the 5-brand version):

```
daysSinceEpoch = floor((utcMidnightOfDate - epochUtcMs) / 86_400_000)
slot           = floor(daysSinceEpoch / rotationDays)
index          = slot % facts.length
```

UTC day boundaries so the rotation flips at the same instant worldwide.
Pure + idempotent: same date in, same fact out.

---

## Cadence — why daily?

The 5-brand version rotated every 3 days (15-day cycle). With 30 brands
we moved to **1 day per fact (30-day cycle)** for three reasons:

1. **Freshness.** A 30-day cycle still feels new but never stale —
   email + social subscribers see novel content for a full month.
2. **Email cadence match.** TruNorth's newsletter ships ~once per week;
   a daily rotation guarantees each issue gets a fresh fact.
3. **PostHog A/B reads.** With 30 distinct cells over 30 days we can
   compare which facts drive the most "See the receipt" clicks.

Trade-off: any single fact gets ~24h of surface time vs the prior 72h.
Bump `rotationDays` to `2` or `3` in the JSON if a fact under-performs
and you want longer dwell — no code change required.

---

## Brand-logo sourcing (NEW)

`scripts/_fetch-brand-logos.mjs` caches Wikipedia logos under
`docs/marketing/egregious/logos/<slug>.png` (one-time, then re-cached
forever). Pipeline:

1. Read `brandLogoUrl` → extract Wikipedia article title.
2. Resolve title → Wikidata QID via the MediaWiki API (with `redirects=1`
   so "The Home Depot" → "Home Depot" works).
3. Fetch QID claims → look up **P154 (logo image)**.
4. Pick the highest-scoring filename (prefers `logo`, then `wordmark`;
   demotes `app`, `icon`, `smile`).
5. Download via `Special:FilePath?width=512` — Commons auto-rasterises
   SVG → PNG at 512px wide.
6. Polite 1s throttle. Aggressive caching — re-running skips existing files.

**Logos are NEVER modified.** On dark surfaces (social + iOS splash) the
logo sits inside a rounded white "cartridge" so dark-on-dark logos
(Patagonia, Microsoft '82 mark, etc.) still read — the cartridge is
background only, the logo bitmap itself is untouched.

Brands without a P154 claim get a hardcoded override in
`LOGO_OVERRIDES` (currently: `williams-sonoma`). Brands with no
freely-licensed Commons logo (currently: `chipotle`) render without a
logo — fallback is graceful.

Last fetch: **29 / 30** logos available.

---

## Nominative fair use disclaimer

Every banner now carries the footer:

> Brand names and logos are trademarks of their respective owners. Used
> for editorial identification under nominative fair use.

This is shown in muted text on every surface (`#a8a8a8` @ 55–70% opacity,
smallest legal-readable size — 9 px on website, 7 px on email, 11 px on
social, 18 px on iOS splash). The phrasing tracks the standard
nominative-fair-use test (Volkswagenwerk v. Church, 1969 → New Kids on
the Block v. News Am. Pub., 1992): identification of the brand, no
sponsorship implied, no logo modification.

---

## How each surface consumes the rotation

| Surface | When it picks | How it picks |
| --- | --- | --- |
| Marketing website banner | Per request (or per build, if static) | Fetch `/data/_meta/egregious-facts.json` → call `getCurrentEgregious()` → render the matching `banner-website-{slug}.png` |
| Email | Just before each send | Email script imports `getCurrentEgregiousFromDisk()` → embeds the matching `banner-email-{slug}.png` |
| Social | At post time | Schedule one `social-{slug}.png` per day via Buffer / native scheduler |
| iOS splash | On app launch / after Welcome | Capacitor reads `/data/_meta/egregious-facts.json` from the bundled assets → shows the matching `ios-splash-{slug}.png` |

All four surfaces ship **all 30** PNGs (~20 MB total), so the rotation
is offline-safe and zero-network on the iOS side.

---

## Producing the assets

```bash
# One-time / when new brands are added — fetches logos from Wikipedia.
node scripts/_fetch-brand-logos.mjs

# Every time the JSON changes — renders all 30×4 PNGs + 4 contact sheets.
node scripts/build-egregious-banners.mjs

# Tests — verifies rotation math + JSON schema.
node --test scripts/egregious-rotation.test.mjs
```

---

## The 30 brands

| # | Slug | Brand | Polarity | Stat | Lens |
| - | --- | --- | --- | --- | --- |
| 0 | home-depot | Home Depot | negative | 2,026× | Pay equity |
| 1 | amazon | Amazon | negative | 785 | Health |
| 2 | colgate-palmolive | Colgate-Palmolive | negative | 18/35 | Health & transparency |
| 3 | starbucks | Starbucks | negative | 269 | Labor |
| 4 | shein | Shein | negative | 5/100 | Transparency |
| 5 | tesla | Tesla | negative | $0 | Tax avoidance |
| 6 | walmart | Walmart | negative | 395 | Health |
| 7 | dollar-tree | Dollar Tree | negative | 911× | Pay equity |
| 8 | chipotle | Chipotle Mexican Grill | negative | 886× | Pay equity |
| 9 | disney | Disney | negative | 805× | Pay equity |
| 10 | tyson-foods | Tyson Foods | negative | 798× | Pay equity |
| 11 | berkshire-hathaway | Berkshire Hathaway | negative | 13,560 kt | Climate |
| 12 | duke-energy | Duke Energy | negative | 19,691 kt | Climate |
| 13 | exxon-mobil | Exxon Mobil | negative | F | Climate |
| 14 | equifax | Equifax | negative | $700M | Privacy |
| 15 | google-alphabet | Google / Alphabet | negative | $391M | Privacy |
| 16 | mckesson | McKesson | negative | $26B | Public health |
| 17 | forever-21 | Forever 21 | negative | 3/100 | Transparency |
| 18 | ross-stores | Ross Stores | negative | 574 | Health |
| 19 | williams-sonoma | Williams-Sonoma | negative | 191 | Health |
| 20 | patagonia | Patagonia | **positive** | A+ | Transparency & climate |
| 21 | lucid-motors | Lucid Motors | **positive** | 116.4 MPGe | Climate |
| 22 | audi-usa | Audi | **positive** | 45 | Safety |
| 23 | microsoft | Microsoft | **positive** | $3.20B | Charitable giving |
| 24 | merck | Merck | **positive** | $2.70B | Charitable giving |
| 25 | acura-usa | Acura | **positive** | 5.00★ | Safety |
| 26 | nvidia | NVIDIA | **positive** | 92/100 | Transparency |
| 27 | ben-and-jerry-s | Ben & Jerry's | **positive** | B Corp | Climate & transparency |
| 28 | salesforce | Salesforce | **positive** | 1% | Charitable giving |
| 29 | levi-strauss | Levi Strauss | **positive** | 5/5 | Materials |

20 negative / 10 positive — 2:1 ratio, weighted toward eye-catching
accountability stats but with positive reinforcement built in.

Slug notes (orphans resolved):
- `audi-usa`, `acura-usa` — the bare slugs `audi` / `acura` aren't in
  `public/data/index.json`; their US distributor sub-brands are used.
- `chipotle` — input was `chipotle-mexican-grill`, resolved to the
  shorter slug present in our index.

---

## Schedule (around Product Hunt launch — June 23, 2026)

| Date (UTC) | # | Brand |
| --- | --- | --- |
| 2026-06-08 | 15 | Google / Alphabet |
| 2026-06-09 | 16 | McKesson |
| 2026-06-10 | 17 | Forever 21 |
| 2026-06-11 | 18 | Ross Stores |
| 2026-06-12 | 19 | Williams-Sonoma |
| 2026-06-13 | 20 | Patagonia (first positive) |
| 2026-06-14 | 21 | Lucid Motors |
| 2026-06-15 | 22 | Audi |
| 2026-06-16 | 23 | Microsoft |
| 2026-06-17 | 24 | Merck |
| 2026-06-18 | 25 | Acura |
| 2026-06-19 | 26 | NVIDIA |
| 2026-06-20 | 27 | Ben & Jerry's |
| 2026-06-21 | 28 | Salesforce |
| 2026-06-22 | 29 | Levi Strauss |
| **2026-06-23** | **0** | **Home Depot (launch day)** |
| 2026-06-24 | 1 | Amazon |
| 2026-06-25 | 2 | Colgate-Palmolive |
| 2026-06-26 | 3 | Starbucks |
| 2026-06-27 | 4 | Shein |
| 2026-06-28 | 5 | Tesla |
| 2026-07-23 | 0 | Home Depot (cycle 2 begins) |

The 10 days of positive facts lead INTO launch day, building momentum
with sympathetic brands before pivoting to the marquee accountability
stat on day-of.

---

## Modifying the rotation

### Add a new fact
1. Append to `facts[]`. Add `brandLogoUrl`, `polarity`.
2. `node scripts/_fetch-brand-logos.mjs` — pulls the new logo.
3. `node scripts/build-egregious-banners.mjs` — emits the 4 new PNGs +
   refreshes contact sheets.
4. `node --test scripts/egregious-rotation.test.mjs` — confirms math still holds.

### Swap an existing fact
1. Edit in place (keep position so launch-day math doesn't shift).
2. Re-run the producers.

### Change cadence
- Set `rotationDays` to `2` (2 days per fact, 60-day cycle), `7`
  (weekly), etc. **Be aware** this changes which fact lands on
  June 23 — update `epoch` if you need to keep Home Depot at launch.

### Reorder
- Don't. The 30-brand sequence was tuned so positive facts cluster
  before launch day. Append new facts; only reorder if you re-tune the
  whole calendar.

---

## Recommendation

**Keep `rotationDays = 1` through August 2026.** Re-evaluate after the
post-launch click data lands in PostHog — if a particular fact drives
3× more "See the receipt" clicks than the mean, consider promoting it
to index 0 (next-launch slot) and bumping its dwell.
