#!/usr/bin/env node
/**
 * B-23 — Scoring rebake engine.
 *
 * Reads per-company recent_events[] (populated by news-extracted-merge.mjs)
 * and derives a SIDECAR scoring_overlay that the runtime applies on top of
 * the existing sc.* baseline. We never mutate sc.* in place — the overlay
 * is the single, reversible path that closes the gap between fresh news
 * signals and the grade the user sees.
 *
 *   effective_score(co, k) = clamp(scoreCat(k, co.sc[k]) + overlay.delta, 0, 100)
 *
 * --- Why a sidecar (not direct mutation of sc.*)? ---------------------
 * sc.* is the human-curated / pipeline-baked baseline. If a rebake misfires
 * (bad outlet, hallucinated event, mis-categorized article), we'd lose the
 * baseline AND the audit trail. The sidecar means:
 *   - `delete co.scoring_overlay` reverts everything cleanly
 *   - the baseline is always inspectable
 *   - each delta carries source_events so a user can see WHY a grade moved
 *
 * --- Weight formula ---------------------------------------------------
 * For each event in the 90-day window:
 *   bias_w   = OUTLET_BIAS[outlet].weight, or 0.3 if unknown
 *   sev_n    = severity_to_unit(severity)         in [0, 1]
 *   mag_n    = magnitude_to_unit(magnitude)       in [0, 1]
 *   ev_n     = evidence_to_unit(evidence_strength) in [0, 1]  (defaults 0.6)
 *   dir_sign = direction_to_sign(direction)       in {-1, 0, +1}
 *
 *   event_weight = bias_w * sev_n * mag_n * ev_n * dir_sign
 *
 * Per category aggregate:
 *   signal = sum(event_weight) / clamp(count, 3, 10)
 *           // divide by clamp so 3 strong events ≈ 10 mild ones
 *
 * Numeric categories (environment / labor / privacy / execPay):
 *   delta  = round(signal * 15)        in [-15, +15]
 *
 * Categorical categories (political / animals / guns / dei / charity):
 *   no numeric delta. Instead:
 *     - record co.events_agg.<cat> = { negative_count, positive_count,
 *       net_signal, top_event_urls, last_rebaked } so the UI can render a
 *       "5 recent events affecting this grade" freshness chip
 *     - if events disagree strongly with the baseline (e.g. sc.dei=pro_dei
 *       but multiple high-severity discrimination lawsuits), push the
 *       category key into co.excl_stale[] so the UI can flag it
 *
 * --- Opt-out threshold -----------------------------------------------
 * If a brand has fewer than MIN_EVENTS_PER_CATEGORY events for a category
 * inside the window, skip that category. Signal too weak — one rogue
 * article shouldn't move a grade.
 *
 * --- Usage ------------------------------------------------------------
 *   node scripts/rebake-scores-from-events.mjs               # DRY-RUN (default)
 *   node scripts/rebake-scores-from-events.mjs --apply       # WRITE changes
 *   node scripts/rebake-scores-from-events.mjs --apply --limit 50
 *
 * DRY-RUN is the default. Writing requires --apply explicitly.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");

const WINDOW_DAYS              = 90;
const MIN_EVENTS_PER_CATEGORY  = 3;
const DELTA_BOUND              = 15;   // clamp to [-15, +15]
const REBAKE_VERSION           = "b-23-1.0.0";

// Numeric categories get a delta on the scoreCat-derived 0-100 baseline.
const NUMERIC_CATEGORIES     = new Set(["environment", "labor", "privacy", "execPay"]);
// Categorical categories — never overridden numerically, but tracked.
const CATEGORICAL_CATEGORIES = new Set(["political", "animals", "guns", "dei", "charity"]);
const ALL_CATEGORIES = new Set([...NUMERIC_CATEGORIES, ...CATEGORICAL_CATEGORIES]);

// Inline copy of OUTLET_BIAS from news-rss-collect.mjs. Duplicated rather
// than imported to keep the rebake script self-contained — the source map
// is the canonical one; if it grows, copy it here too. Unknown outlets get
// the unknown-default of 0.3 in `outletWeight()`.
const OUTLET_BIAS = {
  "reuters.com":          { weight: 1.0 },
  "apnews.com":           { weight: 1.0 },
  "bloomberg.com":        { weight: 1.0 },
  "bbc.com":              { weight: 1.0 },
  "bbc.co.uk":            { weight: 1.0 },
  "npr.org":              { weight: 0.9 },
  "axios.com":            { weight: 0.9 },
  "csmonitor.com":        { weight: 0.9 },
  "marketwatch.com":      { weight: 0.85 },
  "cnbc.com":             { weight: 0.8 },
  "arstechnica.com":      { weight: 0.85 },
  "techcrunch.com":       { weight: 0.7 },
  "bleepingcomputer.com": { weight: 0.9 },
  "krebsonsecurity.com":  { weight: 0.95 },
  "thehill.com":          { weight: 0.8 },
  "semafor.com":          { weight: 0.85 },
  "404media.co":          { weight: 0.8 },
  "theverge.com":         { weight: 0.75 },
  "wired.com":            { weight: 0.75 },
  "nytimes.com":          { weight: 0.9 },
  "washingtonpost.com":   { weight: 0.9 },
  "theguardian.com":      { weight: 0.85 },
  "propublica.org":       { weight: 0.95 },
  "politico.com":         { weight: 0.85 },
  "theatlantic.com":      { weight: 0.7 },
  "newyorker.com":        { weight: 0.7 },
  "wsj.com":              { weight: 0.9 },
  "forbes.com":           { weight: 0.8 },
  "ft.com":               { weight: 0.85 },
  "businessinsider.com":  { weight: 0.7 },
  "fortune.com":          { weight: 0.8 },
  "barrons.com":          { weight: 0.85 },
  "huffpost.com":         { weight: 0.4 },
  "msnbc.com":            { weight: 0.4 },
  "vox.com":              { weight: 0.5 },
  "salon.com":            { weight: 0.3 },
  "motherjones.com":      { weight: 0.7 },
  "foxnews.com":          { weight: 0.4 },
  "nypost.com":           { weight: 0.5 },
  "dailycaller.com":      { weight: 0.3 },
  "breitbart.com":        { weight: 0.2 },
  "nationalreview.com":   { weight: 0.6 },
  "washingtontimes.com":  { weight: 0.5 },
  "retaildive.com":       { weight: 0.85 },
  "modernretail.co":      { weight: 0.85 },
  "esgtoday.com":         { weight: 0.85 },
};

const UNKNOWN_OUTLET_WEIGHT = 0.3;

// --------- Normalizers (handle schema variance in recent_events) ---------
// The merger (scripts/news-extracted-merge.mjs) writes:
//   { date, category, direction, magnitude, severity ("high"/"medium"/"low"),
//     summary, url, ingested_at }
// The typedef (src/lib/types.js NewsEvent) describes a richer shape:
//   { title, url, outlet, bias, date, category, severity 1-10,
//     magnitude 1-10, evidence_strength 1-10, summary }
// Both shapes can appear in production once the AI extractor matures.
// Every helper below tolerates BOTH inputs.

function severityToUnit(s) {
  if (typeof s === "number") {
    if (!Number.isFinite(s)) return 0.5;
    return Math.max(0, Math.min(1, s / 10));
  }
  const v = String(s || "").toLowerCase();
  if (v === "high")   return 0.9;
  if (v === "medium") return 0.55;
  if (v === "low")    return 0.25;
  return 0.5;  // unknown — neutral midpoint
}

function magnitudeToUnit(m) {
  if (typeof m === "number") {
    if (!Number.isFinite(m)) return 0.5;
    // The typedef says 1-10. The merger writes score_impact.magnitude
    // which tends to be 0-1 already. Sniff which scale we're on.
    if (m <= 1.0) return Math.max(0, m);
    return Math.max(0, Math.min(1, m / 10));
  }
  const v = String(m || "").toLowerCase();
  if (v === "high")   return 0.9;
  if (v === "medium") return 0.55;
  if (v === "low")    return 0.25;
  return 0.5;
}

function evidenceToUnit(e) {
  if (typeof e === "number" && Number.isFinite(e)) {
    if (e <= 1.0) return Math.max(0, e);
    return Math.max(0, Math.min(1, e / 10));
  }
  return 0.6;  // default when AI extraction didn't provide it
}

function directionToSign(d) {
  const v = String(d || "").toLowerCase();
  if (v === "positive") return 1;
  if (v === "negative") return -1;
  if (v === "mixed")    return 0;
  return 0;
}

function outletDomain(ev) {
  // Prefer explicit outlet field; fall back to url's host.
  if (ev.outlet && typeof ev.outlet === "string") {
    return ev.outlet.replace(/^www\./, "").toLowerCase();
  }
  if (ev.url) {
    try {
      const u = new URL(ev.url);
      return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch { /* fall through */ }
  }
  return null;
}

function outletWeight(ev) {
  const dom = outletDomain(ev);
  if (!dom) return UNKNOWN_OUTLET_WEIGHT;
  const meta = OUTLET_BIAS[dom];
  return meta?.weight ?? UNKNOWN_OUTLET_WEIGHT;
}

function ageDays(isoDate) {
  if (!isoDate) return Infinity;
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function eventId(ev) {
  // Stable ID for audit trail. URL is the natural primary key; fall back
  // to a synthetic compound key if missing.
  return ev.url || `${ev.date || "nodate"}|${ev.category || "nocat"}|${(ev.title || ev.summary || "").slice(0, 60)}`;
}

// --------- Per-company rebake ---------

function rebakeCompany(co) {
  const events = Array.isArray(co.recent_events) ? co.recent_events : [];
  const fresh  = events.filter(e => ageDays(e.date) <= WINDOW_DAYS);

  // Group by category. Use trunorth_category from score_impact if present,
  // else top-level category. Filter to known categories only.
  const byCat = {};
  for (const ev of fresh) {
    const cat = ev.category || ev.score_impact?.trunorth_category;
    if (!cat || !ALL_CATEGORIES.has(cat)) continue;
    (byCat[cat] = byCat[cat] || []).push(ev);
  }

  const overlay   = {};
  const eventsAgg = {};
  const exclStale = new Set();
  const skipped   = [];
  const now = new Date().toISOString();

  for (const [cat, evs] of Object.entries(byCat)) {
    if (evs.length < MIN_EVENTS_PER_CATEGORY) {
      skipped.push({ category: cat, reason: "below_min_events", count: evs.length });
      continue;
    }

    // Compute event-weight aggregate
    let sum = 0;
    let posCount = 0;
    let negCount = 0;
    const urls = [];
    for (const ev of evs) {
      const bias_w   = outletWeight(ev);
      const sev_n    = severityToUnit(ev.severity);
      const mag_n    = magnitudeToUnit(ev.magnitude ?? ev.score_impact?.magnitude);
      const ev_n     = evidenceToUnit(ev.evidence_strength);
      const dir_sign = directionToSign(ev.direction ?? ev.score_impact?.direction);
      const w = bias_w * sev_n * mag_n * ev_n * dir_sign;
      sum += w;
      if (dir_sign > 0) posCount++;
      else if (dir_sign < 0) negCount++;
      urls.push(eventId(ev));
    }
    // Normalize: divide by clamp(count, MIN, 10). 3 strong events ≈ 10
    // mild events — diminishing returns past 10 prevents megabrands with
    // 30 articles from getting all-or-nothing swings.
    const denom = Math.max(MIN_EVENTS_PER_CATEGORY, Math.min(evs.length, 10));
    const signal = sum / denom;

    if (NUMERIC_CATEGORIES.has(cat)) {
      const delta = Math.max(-DELTA_BOUND, Math.min(DELTA_BOUND, Math.round(signal * DELTA_BOUND)));
      if (delta === 0) {
        skipped.push({ category: cat, reason: "delta_zero", count: evs.length });
        continue;
      }
      overlay[cat] = {
        baseline: null,                  // computed at runtime from sc.* via scoreCat
        delta,
        gross_signal: Number(signal.toFixed(3)),
        event_count: evs.length,
        last_rebaked: now,
        source_events: urls.slice(0, 10),
        version: REBAKE_VERSION,
      };
    } else {
      // Categorical — no numeric delta, but record event aggregation.
      eventsAgg[cat] = {
        negative_count: negCount,
        positive_count: posCount,
        net_signal: Number(signal.toFixed(3)),
        event_count: evs.length,
        top_event_urls: urls.slice(0, 5),
        last_rebaked: now,
      };
      // Strong dissent with the baseline → flag stale.
      // Heuristic: more negative than positive AND |signal| > 0.3.
      if (negCount > posCount && Math.abs(signal) > 0.3) {
        exclStale.add(cat);
      }
    }
  }

  return {
    overlay,
    eventsAgg,
    exclStale: [...exclStale],
    skipped,
    eventsInWindow: fresh.length,
    eventsTotal: events.length,
  };
}

// --------- Driver ---------

async function main() {
  const args  = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limit = (() => {
    const i = args.indexOf("--limit");
    if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
    return Infinity;
  })();

  console.log(`B-23 rebake — ${apply ? "APPLY MODE (will write)" : "DRY-RUN (no writes)"}`);
  console.log(`  window=${WINDOW_DAYS}d  min_events=${MIN_EVENTS_PER_CATEGORY}  delta_bound=±${DELTA_BOUND}`);

  const files = (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json"));
  console.log(`  scanning ${files.length} company files…`);

  const summary = {
    brands_scanned:       0,
    brands_with_events:   0,
    brands_overlay_set:   0,
    brands_excl_stale:    0,
    categories_rebaked:   0,
    categories_skipped:   { below_min_events: 0, delta_zero: 0 },
    delta_buckets:        { "-15..-11": 0, "-10..-6": 0, "-5..-1": 0, "0": 0, "+1..+5": 0, "+6..+10": 0, "+11..+15": 0 },
    top_negatives:        [],
    top_positives:        [],
    writes:               0,
  };

  let scanned = 0;
  for (const f of files) {
    if (scanned >= limit) break;
    scanned++;
    summary.brands_scanned++;

    let co;
    try {
      co = JSON.parse(await fs.readFile(path.join(COMP_DIR, f), "utf-8"));
    } catch (e) {
      console.warn(`  parse_error ${f}: ${e.message}`);
      continue;
    }

    if (!Array.isArray(co.recent_events) || co.recent_events.length === 0) continue;
    summary.brands_with_events++;

    const result = rebakeCompany(co);

    if (Object.keys(result.overlay).length === 0 &&
        Object.keys(result.eventsAgg).length === 0 &&
        result.exclStale.length === 0) {
      for (const s of result.skipped) {
        summary.categories_skipped[s.reason] = (summary.categories_skipped[s.reason] || 0) + 1;
      }
      continue;
    }

    summary.brands_overlay_set++;
    if (result.exclStale.length) summary.brands_excl_stale++;

    for (const [cat, ov] of Object.entries(result.overlay)) {
      summary.categories_rebaked++;
      const d = ov.delta;
      if      (d <= -11) summary.delta_buckets["-15..-11"]++;
      else if (d <= -6)  summary.delta_buckets["-10..-6"]++;
      else if (d <= -1)  summary.delta_buckets["-5..-1"]++;
      else if (d === 0)  summary.delta_buckets["0"]++;
      else if (d <= 5)   summary.delta_buckets["+1..+5"]++;
      else if (d <= 10)  summary.delta_buckets["+6..+10"]++;
      else               summary.delta_buckets["+11..+15"]++;

      const slug = co.slug || f.replace(/\.json$/, "");
      const entry = { slug, name: co.name || slug, category: cat, delta: d, event_count: ov.event_count };
      if (d < 0) summary.top_negatives.push(entry);
      if (d > 0) summary.top_positives.push(entry);
    }
    for (const s of result.skipped) {
      summary.categories_skipped[s.reason] = (summary.categories_skipped[s.reason] || 0) + 1;
    }

    if (apply) {
      if (Object.keys(result.overlay).length) {
        co.scoring_overlay = result.overlay;
      } else if (co.scoring_overlay) {
        delete co.scoring_overlay;
      }
      if (Object.keys(result.eventsAgg).length) {
        co.events_agg = result.eventsAgg;
      } else if (co.events_agg) {
        delete co.events_agg;
      }
      if (result.exclStale.length) {
        co.excl_stale = result.exclStale;
      } else if (co.excl_stale) {
        delete co.excl_stale;
      }
      co._meta = co._meta || {};
      co._meta.lastRebaked = new Date().toISOString();
      co._meta.rebakeVersion = REBAKE_VERSION;
      await fs.writeFile(path.join(COMP_DIR, f), JSON.stringify(co));
      summary.writes++;
    }
  }

  // Top movers
  summary.top_negatives.sort((a, b) => a.delta - b.delta);
  summary.top_positives.sort((a, b) => b.delta - a.delta);
  summary.top_negatives = summary.top_negatives.slice(0, 10);
  summary.top_positives = summary.top_positives.slice(0, 10);

  console.log("");
  console.log("=== SUMMARY ===");
  console.log(`  brands scanned:           ${summary.brands_scanned}`);
  console.log(`  brands with events:       ${summary.brands_with_events}`);
  console.log(`  brands overlay set:       ${summary.brands_overlay_set}`);
  console.log(`  brands flagged stale:     ${summary.brands_excl_stale}`);
  console.log(`  categories rebaked:       ${summary.categories_rebaked}`);
  console.log(`  categories skipped:       ${JSON.stringify(summary.categories_skipped)}`);
  console.log(`  delta distribution:`);
  for (const [k, v] of Object.entries(summary.delta_buckets)) {
    if (v > 0) console.log(`     ${k.padEnd(8)} ${v}`);
  }
  if (summary.top_negatives.length) {
    console.log(`  top 10 NEGATIVE deltas:`);
    for (const t of summary.top_negatives) {
      console.log(`     ${String(t.delta).padStart(4)}  ${t.category.padEnd(12)} ${t.slug}  (${t.event_count} events)`);
    }
  }
  if (summary.top_positives.length) {
    console.log(`  top 10 POSITIVE deltas:`);
    for (const t of summary.top_positives) {
      console.log(`     ${("+" + t.delta).padStart(4)}  ${t.category.padEnd(12)} ${t.slug}  (${t.event_count} events)`);
    }
  }
  console.log(`  writes:                   ${summary.writes}${apply ? "" : "   (dry-run; rerun with --apply to write)"}`);
}

main().catch(err => {
  console.error("rebake-scores-from-events failed:", err);
  process.exit(1);
});
