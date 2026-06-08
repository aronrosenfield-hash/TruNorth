# Neutrality Audit — User-Facing & Outreach Docs

**Date:** 2026-06-08
**Auditor:** Pre-launch neutrality sweep (PH launch Jun 23, 2026)
**Branch:** `feature/neutrality-audit-docs`
**Scope:** Aron-facing pitches, paste-ready promo copy, launch-day playbook, personal email blast template, Gmail auto-reply (5 templates), trade-press pitches.

---

## Core principle applied

"Journalism, not opinion." TruNorth's positioning to journalists, partners, and supporters
must avoid:

1. **Partisan signaling** (left-coded OR right-coded vocabulary)
2. **Loaded vocabulary** ("union-busting", "damning", "expose")
3. **Advocacy framing** ("hold accountable", "fight back", "take down")
4. **Named-company callouts** that read as targeting (especially via partisan-coded examples)

These docs reach high-attention surfaces (journalist inboxes, Twitter pinned tweets,
PH first comment, personal-email recipients), so the bar is **higher** than for
internal data JSON.

---

## Files scanned (8)

| File | Purpose | Reaches |
|---|---|---|
| `docs/TALK_TRACKS.md` | Aron's elevator pitch + Q&A | In-person, podcasts, DMs |
| `docs/producthunt/PROMO_COPY.md` | Paste-ready Twitter / LinkedIn / email | Public social feeds |
| `docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` | Hour-by-hour launch script | PH first comment, social |
| `docs/producthunt/COMING_SOON_PASTE.md` | PH Coming Soon form fields | PH product page |
| `docs/L-3-email-blast-checklist.md` | Personal email template + checklist | Aron's warm network |
| `docs/gmail-personalized-autoreply.gs` | 5 auto-reply templates (billing / bug / press / feature / generic) | Every inbound email |
| `docs/gmail-personalized-autoreply-setup.md` | Setup doc | Aron only |
| `docs/trade-press-pitches.md` | 4 pitches (Verge / Fast Company / Mother Jones / ESG Today) | Journalist inboxes |

**Skipped (per scope rules):** `BACKLOG.md`, `planned_*.md`, `parked_*.md`,
`docs/scoring-engine-audit.md`, `docs/research/*.md`, `README.md` (stock Vite
template — not user-facing brand copy).

---

## Severity counts

| Severity | Count | Status |
|---|---|---|
| CRITICAL | 4 | Auto-fixed inline |
| MAJOR | 3 | Auto-fixed inline (1 also flagged below for re-review) |
| MINOR / Flagged | 5 | Listed for human review; not modified |

---

## CRITICAL fixes applied

### C-1 — `docs/TALK_TRACKS.md` — Partisan-coded competitor callout

Singling out "Koch Industries" as the example of activism is partisan signaling
(Koch is strongly right-coded). Replaced with a generic phrasing that makes the
same point without picking a side.

**Before:**
> Buycott aggregates campaigns ("boycott Koch Industries"). That's activism.

**After:**
> Buycott aggregates campaigns ("boycott this company, support that one"). That's activism.

### C-2 — `docs/TALK_TRACKS.md` — Loaded labor vocabulary

"Union-busting" is left-coded advocacy vocabulary; the neutral phrasing
("unfair labor practice cases") is what the NLRB actually calls these
filings.

**Before:**
> - **NLRB** for union-busting cases

**After:**
> - **NLRB** for unfair labor practice cases

### C-3 — `docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` — Partisan-coded community recommendation

Recommending `r/Anticonsumption` as a launch-day distribution channel positions
TruNorth as anti-consumerist (a left-coded political identity), which alienates
the right-leaning half of the audience. Swapped for neutral product-focused
subreddits.

**Before:**
> Indie Hackers post + Reddit post (r/SideProject, r/Anticonsumption — be authentic)

**After:**
> Indie Hackers post + Reddit post (r/SideProject, r/iosapps, r/apps — be authentic)

### C-4 — `docs/trade-press-pitches.md` — Loaded vocabulary ("damning")

"Damning public-record story" presupposes a verdict before the records are
examined — that's advocacy framing, not journalism. Neutralized.

**Before:**
> ...which brand in our database has the most damning public-record story right now? (Right now I'd nominate [X]. Real data, happy to walk you through it.)

**After:**
> ...which brand in our database has the most notable public-record paper trail right now? (Happy to walk you through a few candidates and the underlying filings.)

---

## MAJOR fixes applied

### M-1 — `docs/gmail-personalized-autoreply.gs` (PRESS template) — Selective category list including polarizing acronym

The press auto-reply listed five of the nine scoring categories — and the five
chosen included "DEI", a politically-coded acronym in 2026. A journalist
opening the press auto-reply gets framed before they've even pitched. Replaced
with the full nine-category list from `TALK_TRACKS.md` (Aron's canonical
phrasing). Also fixed a stale brand count (was "over 6,000", now "11,000+").

**Before:**
> "TruNorth is a values-first shopping app — over 6,000 brands scored across politics, labor, DEI, charity, and environment so consumers can spend in line with what they actually care about..."

**After:**
> "TruNorth is a values-first shopping app — 11,000+ brands scored across nine categories (politics, environment, labor, animal welfare, privacy, health, exec pay, charity, transparency) using only public records, so consumers can spend in line with what they actually care about..."

> Note: there is an unresolved inconsistency between `TALK_TRACKS.md` (which
> lists 9 categories *without* DEI) and the app source (which has DEI as an
> active category). That inconsistency is **out of scope** for this audit but
> worth resolving before launch. See "Flagged for review → F-1".

---

## Flagged for human review (not modified)

### F-1 — Category-list inconsistency (factual, not bias, but adjacent)

`TALK_TRACKS.md` enumerates 9 categories: politics, environment, labor,
animal welfare, privacy, health, exec pay, charity, transparency.

`docs/trade-press-pitches.md` (Mother Jones pitch, line 112) enumerates:
politics, environment, labor, animal testing, privacy, exec pay, charity,
**DEI**, **firearms** — and counts to 9 by including DEI + firearms but
dropping health + transparency.

`src/companies.js` shows DEI is a real category in the data.

**Recommendation:** Pick ONE canonical 9-category list and propagate it
everywhere. If DEI stays, decide whether to lead with it externally (it's a
high-salience term for some journalists, polarizing for others).

### F-2 — `docs/trade-press-pitches.md` (Mother Jones pitch) — Outlet-targeted framing

The Mother Jones pitch opens: *"Mother Jones has been doing the work of tying
corporate political donations to consumer behavior for ~30 years. I built the
consumer-side delivery layer."* This is appropriate journalist outreach
(tailoring the pitch to the outlet's beat) but it does position TruNorth as
aligned with Mother Jones's editorial worldview. If The Verge or ESG Today
ever quoted from a leaked pitch document, it would look two-faced.

**Recommendation:** Acceptable as private outreach. Don't post or link
publicly. Consider softening to "Mother Jones has long covered the link
between corporate political donations and consumer behavior — TruNorth is the
consumer-side delivery layer."

### F-3 — `docs/trade-press-pitches.md` — Named-brand juxtaposition in Verge + Fast Company pitches

Lines 26 and 72 use "Patagonia and Amazon" / "Patagonia is great, Walmart is
bad" as examples of competitor apps' "vibes" scoring. The juxtaposition is in
quotation marks (clearly paraphrasing what competitors say, not Aron's
view). Mostly fine.

**Recommendation:** Acceptable. If a more neutral pair of named brands is
available ("Brand X and Brand Y") it would be safer for the public-facing
versions; in journalist pitches the concreteness is a feature.

### F-4 — `docs/producthunt/LAUNCH_DAY_PLAYBOOK.md` line 34 — "no outrage feeds"

"📰 Honest — no streaks, no outrage feeds, no influencers pushing affiliate
links" — "outrage feeds" is critiquing a content genre, not picking a
political side. Mild risk that a media-savvy reader hears it as code for a
specific outlet.

**Recommendation:** Acceptable. Could swap for "no rage-bait feeds" or "no
algorithmic outrage loops" if extra caution is wanted.

### F-5 — `docs/TALK_TRACKS.md` line 100 — "consumers got fed up with marketing-speak"

"People want receipts. We provide the receipts." — colloquial, not partisan.
Confidently neutral.

**Recommendation:** Keep. Highlighted only because pre-launch audits should
verify tone-sounding-strong moments aren't accidentally pejorative.

---

## Per-doc tone assessment

| Doc | Tone | Journalist-neutral? | Notes |
|---|---|---|---|
| `TALK_TRACKS.md` | Confident, factual, plain-spoken | YES (after fixes) | Strong opening line ("uses only public records"). Defensible across the political spectrum. |
| `PROMO_COPY.md` | Punchy, action-oriented | YES | "No vibes. No spin. Just journalism." reads as methodological stance, not political. |
| `LAUNCH_DAY_PLAYBOOK.md` | Operational | YES (after fixes) | The r/Anticonsumption swap was the only meaningful neutralization needed. |
| `COMING_SOON_PASTE.md` | Marketing-form copy | YES | Topic list includes "Sustainability / Climate Tech" + "News & opinion" — both neutral category names on PH. |
| `L-3-email-blast-checklist.md` | Internal-operational | N/A | Template body is factual and clean; the checklist itself is for Aron, not user-facing. |
| `gmail-personalized-autoreply.gs` | Warm, founder-personal | YES (after fixes) | Templates are exemplary — welcoming, factual, no political characterizations. Press template now matches canonical category list. |
| `gmail-personalized-autoreply-setup.md` | Internal-operational | N/A | Setup doc; no user-facing prose. |
| `trade-press-pitches.md` | Outlet-tailored | MOSTLY (after fixes) | Each pitch leans into the outlet's beat. Mother Jones pitch is the most editorially-tilted; see F-2. |

---

## Summary

Eight surfaces scanned. Four CRITICAL and one MAJOR fix applied inline (auto-fixed,
no human review required). Five additional items flagged for human review — none
block launch; F-1 (category-list inconsistency) is the most actionable.

Overall the user-facing and outreach docs are in good shape for a pre-launch
neutrality posture. The fixes here remove the few remaining hot spots where
a journalist or partisan reader on either side could have legitimately said
"this app has a side." After the fixes, the answer is "no — it has a
methodology."
