#!/usr/bin/env node
/**
 * Stanford CRFM Foundation Model Transparency Index (FMTI) — fetcher.
 *
 * Pulls the latest per-developer transparency score from the FMTI public
 * GitHub repo (https://github.com/stanford-crfm/fmti). The repo hosts a
 * binary indicator matrix per round (rows = 100 indicators, cols = each
 * scored developer). The "overall score" reported by the FMTI authors is
 * simply the column-sum out of 100, which is what we compute here.
 *
 * Rounds available at time of writing:
 *   - October2023        (10 developers, original index)
 *   - May2024            (14 developers, v1.1)
 *   - Dec2025            (13 developers, latest)
 *
 * We prefer the most recent round whose CSV exists; the merger downstream
 * bands by leader (>=70) / mixed (40-69) / poor (<40) per spec.
 *
 * Maps to the TruNorth `privacy` + `dei` categories — AI ethics spans both
 * surveillance / consent concerns AND labor / data-worker / equitable-access
 * concerns. See FMTI subdomain list:
 * https://crfm.stanford.edu/fmti/May-2024/index.html
 *
 * CLI:
 *   node scripts/fmti-fetch.mjs                       # default = live round
 *   node scripts/fmti-fetch.mjs --dry                 # parse, no write
 *   node scripts/fmti-fetch.mjs --apply               # write data/raw/fmti/<date>.json
 *   node scripts/fmti-fetch.mjs --round May2024       # explicit round
 *   node scripts/fmti-fetch.mjs --url <csv-url>       # override CSV URL
 *   node scripts/fmti-fetch.mjs --limit N             # cap developers (debug)
 *   node scripts/fmti-fetch.mjs --out /tmp/out.json   # alt output path
 *   node scripts/fmti-fetch.mjs --fixture             # parse local fixture only
 *
 * Output:
 *   data/raw/fmti/<YYYY-MM-DD>.json
 *   {
 *     _license, _source_urls, _round, _generated_at,
 *     _stats: { developers: n, indicators: 100, mean: x },
 *     developers: [{
 *       name:          "OpenAI",
 *       slugHint:      "openai",
 *       score:         35,         // 0-100 indicator-count
 *       maxScore:      100,
 *       pct:           35,
 *       band:          "poor"|"mixed"|"leader",
 *       roundLabel:    "Dec2025",
 *       sourceUrl:     "https://crfm.stanford.edu/fmti/",
 *     }]
 *   }
 *
 * Politeness: single network GET (one CSV), retries once on 5xx.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/fmti");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/fmti");

const UA = "TruNorth-FMTI/1.0 (+https://www.trunorthapp.com; AI-transparency data pipeline)";

export const SOURCE_HOME = "https://crfm.stanford.edu/fmti/";
export const SOURCE_REPO = "https://github.com/stanford-crfm/fmti";

// Ordered newest → oldest. Fetcher tries newest first; --round can pin.
export const ROUNDS = [
  {
    label: "Dec2025",
    csvUrl:
      "https://raw.githubusercontent.com/stanford-crfm/fmti/main/Dec2025/Dec2025_scores.csv",
    pageUrl: "https://crfm.stanford.edu/fmti/",
    year: 2025,
  },
  {
    label: "May2024",
    csvUrl:
      "https://raw.githubusercontent.com/stanford-crfm/fmti/main/May2024/May2024_scores.csv",
    pageUrl: "https://crfm.stanford.edu/fmti/May-2024/",
    year: 2024,
  },
  {
    label: "October2023",
    csvUrl:
      "https://raw.githubusercontent.com/stanford-crfm/fmti/main/October2023/scores.csv",
    pageUrl: "https://crfm.stanford.edu/fmti/October-2023/",
    year: 2023,
  },
];

/* -------------------------- slug-hint dictionary -------------------------- */
/*
 * The CSV header has display names that don't slugify cleanly to TruNorth
 * brand slugs (e.g. "Meta" → "meta-facebook", "Google" → "google-alphabet").
 * Below we hand-route the canonical FMTI developer names. The merger will
 * fall back to slug-aliases + brand-parent-map for any not listed here.
 *
 * Verified against public/data/companies/ on 2026-06-09.
 */
export const SLUG_HINTS = {
  "AI21 Labs":       "ai21-labs",        // not yet in TruNorth index — falls to alias/parent
  "AI21":            "ai21-labs",
  "Adept":           "adept",
  "Aleph Alpha":     "aleph-alpha",
  "Alibaba":         "alibaba-group",
  "Amazon":          "amazon",
  "Anthropic":       "anthropic",
  "Cohere":          "cohere",
  "DeepSeek":        "deepseek",
  "Google":          "google-alphabet",
  "Hugging Face":    "hugging-face-sas",
  "IBM":             "ibm",
  "Inflection":      "inflection-ai",
  "Meta":            "meta-facebook",
  "Microsoft":       "microsoft",
  "Midjourney":      "midjourney",
  "Mistral":         "mistral-ai",
  "OpenAI":          "openai",
  "Stability AI":    "stability-ai",
  "Writer":          "writer",
  "xAI":             "xai",
};

/* ------------------------------- CLI args -------------------------------- */

function parseArgs(argv) {
  const args = {
    apply: false,
    dry: false,
    round: null,
    url: null,
    limit: null,
    out: null,
    fixture: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--fixture") args.fixture = true;
    else if (a === "--round") args.round = argv[++i];
    else if (a === "--url") args.url = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || null;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

/* ------------------------------- network --------------------------------- */

async function fetchText(url, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/csv,text/plain,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    if (res.status >= 500 && attempt < 1) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchText(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return await res.text();
}

/* --------------------------- CSV parser + scorer ------------------------- */

/**
 * Minimal RFC4180-ish CSV row splitter — handles double-quoted fields that
 * contain commas (two Dec2025 indicator labels do, e.g. "Permitted,
 * restricted, and prohibited model behaviors"). No escaped quotes appear in
 * the Stanford CSVs we ingest, but the standard `""` → `"` rule is honoured.
 */
export function splitCsvRow(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  let cur = "";
  let inQ = false;
  while (i < n) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cur += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ",") { out.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  out.push(cur);
  return out;
}

/**
 * Parse a Stanford FMTI scores CSV.
 *
 * Shape: header row = ["Indicator", developer1, developer2, ...]
 *        each remaining row = [indicator_label, 0, 1, 0, 1, ...]
 *
 * Returns { indicators: int, developers: [{name, score}] }.
 *
 * Exported for the test harness.
 */
export function parseScoresCsv(text) {
  const lines = text.replace(/\r/g, "").split(/\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV has fewer than 2 lines");
  }
  const header = splitCsvRow(lines[0]);
  if (header.length < 2 || header[0].toLowerCase() !== "indicator") {
    throw new Error(`Unexpected CSV header: ${lines[0].slice(0, 120)}`);
  }
  const names = header.slice(1).map(s => s.trim());
  const totals = names.map(() => 0);
  let count = 0;
  for (let r = 1; r < lines.length; r++) {
    const cells = splitCsvRow(lines[r]);
    if (cells.length !== header.length) continue;
    count++;
    for (let c = 1; c < cells.length; c++) {
      const v = parseInt(cells[c].trim(), 10);
      if (Number.isFinite(v) && (v === 0 || v === 1)) {
        totals[c - 1] += v;
      }
    }
  }
  return {
    indicators: count,
    developers: names.map((name, i) => ({ name, score: totals[i] })),
  };
}

/**
 * Bands per Aron's spec:
 *   leader  ≥ 70
 *   mixed   40 ≤ score < 70
 *   poor    < 40
 */
export function bandFor(score) {
  if (score >= 70) return "leader";
  if (score >= 40) return "mixed";
  return "poor";
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // 1) Pick a round.
  let round = ROUNDS[0];
  if (args.round) {
    const found = ROUNDS.find(r => r.label === args.round);
    if (!found) throw new Error(`unknown round: ${args.round}`);
    round = found;
  }
  if (args.url) round = { ...round, csvUrl: args.url, label: round.label + "-override" };

  // 2) Load CSV — either live, --url, or fixture fallback.
  let csv;
  let usedFixture = false;
  const fixturePath = path.join(FIXTURE_DIR, `${round.label}_scores.csv`);
  if (args.fixture) {
    if (!existsSync(fixturePath)) {
      throw new Error(`fixture not found: ${fixturePath}`);
    }
    csv = await fs.readFile(fixturePath, "utf-8");
    usedFixture = true;
  } else {
    try {
      csv = await fetchText(round.csvUrl);
    } catch (err) {
      // Fall back to fixture if live fetch fails (offline / blocked).
      if (existsSync(fixturePath)) {
        console.warn(`live fetch failed (${err.message}); using fixture ${fixturePath}`);
        csv = await fs.readFile(fixturePath, "utf-8");
        usedFixture = true;
      } else {
        throw err;
      }
    }
  }

  const { indicators, developers } = parseScoresCsv(csv);
  if (indicators !== 100) {
    console.warn(`expected 100 indicators, got ${indicators} — round=${round.label}`);
  }
  if (developers.length === 0) {
    throw new Error("no developers parsed from CSV");
  }

  // 3) Build payload.
  const enriched = developers.map(d => ({
    name: d.name,
    slugHint: SLUG_HINTS[d.name] || null,
    score: d.score,
    maxScore: 100,
    pct: d.score, // indicator-count = pct since max is 100
    band: bandFor(d.score),
    roundLabel: round.label,
    sourceUrl: round.pageUrl,
  }));

  // Sort: leaders first, then by score descending.
  enriched.sort((a, b) => b.score - a.score);

  const limited = args.limit ? enriched.slice(0, args.limit) : enriched;

  const meanScore = limited.length
    ? Math.round((limited.reduce((s, d) => s + d.score, 0) / limited.length) * 10) / 10
    : 0;

  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    _license:
      "Stanford CRFM Foundation Model Transparency Index — released under Apache-2.0 / MIT-style permissive licence per the github.com/stanford-crfm/fmti repo. Cite the Stanford CRFM as the source.",
    _source_urls: {
      home: SOURCE_HOME,
      repo: SOURCE_REPO,
      csv: round.csvUrl,
      page: round.pageUrl,
    },
    _round: round.label,
    _round_year: round.year,
    _generated_at: new Date().toISOString(),
    _used_fixture: usedFixture,
    _stats: {
      developers: limited.length,
      indicators,
      mean: meanScore,
      leaders: limited.filter(d => d.band === "leader").length,
      mixed: limited.filter(d => d.band === "mixed").length,
      poor: limited.filter(d => d.band === "poor").length,
    },
    developers: limited,
  };

  if (args.dry) {
    console.log(`[dry-run] round=${round.label}; would write ${limited.length} developers`);
    console.log(`  bands: ${payload._stats.leaders} leader / ${payload._stats.mixed} mixed / ${payload._stats.poor} poor`);
    console.log(`  mean: ${meanScore}/100`);
    console.log("  top 5:");
    for (const d of limited.slice(0, 5)) {
      console.log(`    ${d.name.padEnd(20)} ${d.score}/100  (${d.band})`);
    }
    return;
  }

  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(`  developers:   ${payload._stats.developers}`);
  console.log(`  indicators:   ${payload._stats.indicators}`);
  console.log(`  mean:         ${meanScore}/100`);
  console.log(`  leaders:      ${payload._stats.leaders} (≥70)`);
  console.log(`  mixed:        ${payload._stats.mixed} (40–69)`);
  console.log(`  poor:         ${payload._stats.poor} (<40)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("fmti-fetch failed:", err);
    process.exit(1);
  });
}
