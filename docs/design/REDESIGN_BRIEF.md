# TruNorth — The Compass Redesign

> Design brief v1 · 2026-06-11 · Mockups: `/public/mockups/compass-redesign.html`
> Decision context: Aron has deprioritized the June 23 date — "I want it to be right."
> This brief turns the world-class-experience review into a buildable specification.

---

## 1. Product identity

**Not** "an app that grades brands."
**A personal compass for your money** — it knows what you stand for, judges anything you buy against it with government receipts, and counts the impact when you act.

Three sentences that govern every screen:
1. The app performs the judgment; the user receives a **verdict with receipts** — never homework.
2. Identity in (your values, your basket) → behavior out (the switch) → **impact counted** (dollars redirected).
3. Every claim traceable to a public record. Trust is the floor, not the feature.

**Brand voice:** "Show me the receipts." Calm, factual, a little wry. Never preachy — the app has no values; *you* do.

---

## 2. Design system — "Civic Premium"

The current dark-gray + purple is interchangeable with a thousand indie apps. The replacement owns a material: **archival ink and paper** — the look of records, ledgers, and seals, set with modern precision.

### Palette (dark-first, single signal color)
| Token | Value | Role |
|---|---|---|
| `ink.0` | `#0E0F12` | App background (warm near-black) |
| `ink.1` | `#16181D` | Card surface |
| `ink.2` | `#1F2228` | Raised surface / inputs |
| `line` | `#2A2E35` | Hairlines |
| `bone` | `#EDE9E0` | Primary text (warm paper, not white) |
| `bone.dim` | `#A9A498` | Secondary text |
| `bone.mute` | `#6E6A60` | Tertiary / captions |
| `verdigris` | `#38C0CE` | THE signal color: alignment, the compass, progress (cooled toward cyan per Aron, 2026-06-12 — was #3DD6B5) |
| `oxblood` | `#E0524D` | Clash / violations only |
| `brass` | `#C9A86A` | Records, citations, ledger accents (the "receipt" color) |

Rules: verdigris and oxblood are **verdict colors only** — never decoration. Brass marks anything sourced from a record. Everything else is ink and bone. Letter grades keep their semantic colors but rendered as engravings inside the seal, not chips.

### Type
- **Verdict lines / archetype names:** serif (`New York` on iOS, Georgia fallback) — the editorial voice. e.g. *"Aligned on 5 of your 6 priorities."*
- **UI:** SF Pro / system sans, two weights only (400/600).
- **Receipts / numbers / dates / dollars:** `ui-monospace` (SF Mono) — every record line, every ledger entry, every dollar figure. The monospace IS the trust texture.

### The Compass (the hero object)
A nine-spoke seal, unique per user:
- **Spoke direction** = category (fixed order: political, environment, labor, DEI, charity, animals, firearms, privacy, exec pay).
- **Spoke length** = the user's weight (from the Match flow) — your compass is literally shaped like your values.
- **Spoke fill** = a brand's alignment on that axis (when striking a brand against it).
- **States:** *Settled* (aligned — ring closes, verdigris glow, soft double haptic) · *Split* (clash — one spoke fractures oxblood, single sharp haptic) · *Forming* (during the Match — draws stroke by stroke) · *At rest* (Today screen — slow 60s breathing cycle).
- The letter grade engraves in the center when striking a brand. Identity + verdict + share object in one mark.

### Motion & haptics (the signature set — exactly four)
1. **Needle settle** — compass spokes snap to verdict, 380ms spring. Paired haptic: double-tap (aligned) / sharp buzz (clash).
2. **Stroke draw** — Match flow, one spoke draws per answer, 600ms ease-out.
3. **Ledger tick** — dollars-redirected counter rolls like a fuel pump.
4. **Receipt slide** — record lines enter as if printed, 40ms stagger.
Nothing else animates. Restraint is the premium.

---

## 3. Architecture — four surfaces (replaces 5 tabs)

```
┌─────────────────────────────────────┐
│  TODAY     LENS(◉ center)   LEDGER  │   + YOU (top-right avatar/compass-mini)
└─────────────────────────────────────┘
```

### 3.1 TODAY — the daily pulse (replaces Top Picks home)
Three cards, no lists:
1. **Compass card** — your seal at rest + basket alignment ("Your basket: 61% aligned · ▲2 this week"). Tap → Ledger.
2. **Story card** — one record-driven story chosen for *you* ("New OSHA penalty for a brand in your basket — your Walmart grade moved D→F"). Brass accents, receipt line visible.
3. **Shelf card** — one curated, archetype-aware shelf ("Coffee, aligned with you" — 4 brand seals in a row). Refreshes daily.

### 3.2 LENS — ask anything (center tab, camera-first; replaces Search/Browse/Scan)
- Opens to a single input: **"Search, ask, or point."** Camera glyph on the right launches straight into the viewfinder.
- **Verdict card** (the core answer unit, replaces list-first):
  - Brand name + seal striking against your compass (needle settle + haptic)
  - One serif verdict sentence: *"Aligned on 5 of your 6 priorities — one red flag."*
  - Three receipt lines (mono, brass): `2024-09 · OSHA · $4.2M penalty ↗`
  - One swap: "Better match for you: **Costco** (A · settled)" → tap = Versus
  - Below the fold: full nine-axis breakdown (current category detail, restyled as ledger)
- The classic result LIST is one swipe down — demoted, never default.
- **Aisle Mode:** viewfinder stays live; each scan stamps a mini-seal verdict into a tray at the bottom; closing produces a Cart Report (n aligned, n clashes, worst receipt, total swap savings).

### 3.3 LEDGER — your money's record (replaces Library)
Sections top to bottom:
1. **Alignment dial** — basket % + 12-week sparkline.
2. **Impact counter** — "$23/mo redirected · $276/yr" (mono, ticks on update) + aggregate teaser ("TruNorth users: $1.4M this month").
3. **Your basket** — brand seals with live grades; the change feed badges brands whose records moved ("Since your last visit: Walmart C→D · receipt ↗").
4. **Switches** — committed swaps as paired seals ("Shein → Quince · March · receipts attached") with per-switch share card.
5. History (collapsed).

### 3.4 YOU — identity (replaces Account)
- Archetype card (serif name, codename, compass, evolution timeline — "The Balanced Skeptic → The Conservative Consumer, May").
- The nine tension cards, re-answerable any time — compass redraws live.
- Methodology, sources, corrections, settings (one quiet list at the bottom).

---

## 4. Core flows

### Flow A — First run (≤90 seconds to personal payoff)
1. **Hook** (1 screen): *"Your money votes. Want to see how it's been voting?"* — serif, ink, one button. No stats, no feature tour.
2. **Basket** (~15s): "Pick what you actually buy" — chip cloud of ~40 household brand seals + search. Pick 5–10.
3. **The Match** (~45s): nine full-screen tension cards (below). Compass draws one spoke per answer in the corner — visibly becoming *theirs*.
4. **Reveal:** archetype (serif, seal complete, haptic) → **"Your basket: 61% aligned"** → the one clash, WITH its receipt ("Shein — $1.9M CPSC penalties 2024 ↗") → the swap suggestion.
5. **The ask, perfectly timed:** "Want to know the moment any of these records change?" → push permission.

### Flow B — The Match (replaces quiz; kills the 1–5 grid forever)
Nine forced-choice tension cards, full screen, two giant tap targets each:
1. *A company pollutes, but pays workers brilliantly.* → *Forgivable / Dealbreaker*
2. *Great product. The CEO funds politics you oppose.* → *Still buying / I'm out*
3. …(one per category; each binary maps to stance + implied weight; decisive taps weigh more — derived, never asked)
Progress = spokes drawn, not dots. "No preference" = small skip text, never a third button (preserves the research finding while removing the form feel).

### Flow C — The Verdict (the loop)
Encounter → Lens (type/speak/scan) → needle settle + haptic → verdict sentence → receipts → swap → **"Make the switch"** (commit: picks swap into basket, logs the pair, asks monthly spend once) → Ledger ticks → records change later → push ("Your Walmart grade moved — receipt inside") → return.

### Flow D — Versus (replaces Compare)
Any two seals dragged together → overlay morph → serif verdict ("Costco beats Target on 4 of your 6") → poster-grade share card auto-composed (both seals, the verdict line, "receipts attached" footer, watermark).

### Flow E — Wallet Wrapped (annual, December)
Five-card story: your year's alignment arc → top aligned brand → biggest switch + dollars moved → your archetype evolution → the share poster. Built entirely from Ledger data. This is the marquee viral moment; design it now, ship it dormant.

---

## 5. Share objects (designed, not OS-sheet links)
1. **Archetype card** — seal + serif name + 3 top weights. (Exists conceptually — restyle.)
2. **Verdict card** — brand seal + verdict line + one receipt + "what's YOUR compass say?"
3. **Versus poster** — Flow D output.
4. **Switch card** — paired seals + "$X/yr redirected" + receipts-attached footer.
5. **Wrapped** — Flow E.
All: ink background, bone serif, brass receipt line, compass mark, consistent watermark. Every card answers "what would make someone screenshot this?"

---

## 6. Build sequencing (no dates — gates)

**R1 — The Skin (re-theme, no flow changes).** Civic Premium tokens, type system, receipts-as-ledger restyle, seal rendering of existing grades (static compass, no physics), share cards v1 (archetype + verdict). *Gate: every existing screen passes the new system; nothing purple remains.*

**R2 — The Flows (re-flow, same engine).** Four-surface nav · Lens verdict card as default answer (list demoted) · The Match replaces the quiz · Today's three cards · Ledger v1 (basket + change feed + switches, manual spend entry) · Versus. *Gate: first-run → personal payoff ≤90s; verdict ≤3s from query.*

**R3 — The Magic (new build).** Compass physics + haptic set · Aisle Mode + Cart Report · push loop (APNs) · natural-language ask (citation-locked answers) · Wrapped · App Clip + widgets + Action-button Lens. *Gate: the two set-pieces (Aisle, Wrapped) demo-ready.*

Engine note: **zero new data or scoring work required** — verdict sentences, receipts, alternatives, alignment math, and impact arithmetic all exist in the current engine. This is presentation and product, not pipeline.

---

## 7. What we deliberately keep
The scoring engine and methodology page (untouched) · evidence-count honesty (re-expressed as "n receipts") · the "?" no-fake-grades rule · neutrality symmetry (tension cards are stance-neutral by construction) · the corrections channel · barcode infrastructure (Lens wraps it) · the values-archetype concept (promoted, not replaced).

## 8. Design decisions (Aron, 2026-06-11 PM)
1. ✅ **Dark ink** — sole mode. No paper-light variant for now.
2. ✅ **Radar-polygon** for the IDENTITY compass (your weights — always 9 axes, convex). **Verdict seal revised to a segmented RING** (2026-06-12, Aron's Adobe screenshot): real brands have sparse axes + extreme scores, and the radar collapsed into shards. Nine fixed arc slots — color = alignment, oxblood = the clash, dashed = no data, grade engraved serif center. A seal at every data density.
3. ✅ **The Switch flow greenlit** as the core action/loop.
4. Wrapped: design now, ship dormant for the December cultural moment (default kept — revisit anytime).
5. Tension-card copy: drafts stand pending Aron's red pen during R2.

**R1 began 2026-06-11 PM.**
