#!/usr/bin/env node
/**
 * Powerbase merger.
 *
 * Reads:
 *   data/raw/powerbase/<YYYY-MM-DD>.json
 *   public/data/index.json
 *   public/data/_meta/slug-aliases.json
 *
 * Writes:
 *   data/derived/powerbase-augment.json
 *
 * Output:
 *   {
 *     _license, _source, _generated_at, _stats: { ... },
 *     companies: {
 *       "<slug>": {
 *         title, page_url,
 *         narratives: { <cat>: { text, sc, severity, source_url } },
 *         category_signals: [{category_title, signal, cat}],
 *         external_link_count
 *       }
 *     }
 *   }
 *
 * Severity (conservative, per the prompt):
 *   - default: "mixed"
 *   - upgrade to "poor" ONLY when external_link_count >= 2 AND a negative
 *     keyword (lobbying, denial, front group, sweatshop, scandal, fine)
 *     appears in the extract or matched category signals.
 *
 * Default category:
 *   - If any matched category has cat="political", merge under "political".
 *   - Else if any has cat="environment", merge under "environment".
 *   - Else "political" (the wiki's center of gravity is lobbying / PR).
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/powerbase");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const ALIASES_FILE = path.join(ROOT, "public/data/_meta/slug-aliases.json");
const DEFAULT_OUT = path.join(DERIVED_DIR, "powerbase-augment.json");
const LICENSE = "CC BY-SA 3.0 — Powerbase (Spinwatch), https://powerbase.info";

const NEG_KEYWORDS = [
  /lobby(ing)?/i, /front group/i, /astroturf/i, /revolving door/i,
  /denial/i, /scandal/i, /\bfined\b/i, /penalty/i, /sweatshop/i,
  /tax avoidance/i, /tax haven/i, /bribery/i, /corruption/i,
];

function parseArgs(argv) {
  const args = { in: null, out: null, allRaw: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--all-raw") args.allRaw = true;
  }
  return args;
}

async function findLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

function clip(s, n) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

export function pickCategory(matched) {
  // priority: political > environment > dei > labor
  const order = ["political", "environment", "dei", "labor"];
  for (const c of order) if (matched.some(m => m.cat === c)) return c;
  return "political";
}

export function classifyPage(page) {
  const refs = Number(page.external_link_count || 0);
  const cat = pickCategory(page.categories || []);
  const matchedSignals = (page.categories || []).map(c => c.signal);
  const matchedCats    = (page.categories || []).map(c => c.category_title || "");
  const extract = String(page.extract || "");
  // Use signal labels (with underscores normalised to spaces) + raw category
  // titles + extract text as the haystack for the negative-keyword gate.
  const haystack = `${extract} ${matchedSignals.join(" ").replace(/_/g, " ")} ${matchedCats.join(" ")}`;
  const negHits = NEG_KEYWORDS.filter(rx => rx.test(haystack)).length;
  // Conservative severity:
  //   - default mixed
  //   - poor only when refs >= 2 AND negative cues fire
  let sc = "mixed";
  let severity = "mixed";
  if (refs >= 2 && negHits >= 1) { sc = "poor"; severity = "negative"; }

  // Build narrative:
  //   "Powerbase wiki: <comma-list of top 3 signal labels>. <80-char extract>."
  const labels = matchedSignals.slice(0, 3).map(s => s.replace(/_/g, " "));
  const labelStr = labels.length ? labels.join(", ") : "investigative profile";
  const tail = extract ? ` ${clip(extract, 200)}` : "";
  const narrative = `Powerbase wiki — ${labelStr}.${tail}`.trim();

  return {
    category: cat,
    narrative: clip(narrative, 280),
    sc,
    severity,
    source_url: page.page_url,
  };
}

export function buildAugment(raw, slugSet, aliases = {}) {
  const out = {};
  for (const p of (raw.pages || [])) {
    const slug = aliases[p.slug] || p.slug;
    if (!slugSet.has(slug)) continue;
    const has_signal = (p.categories || []).length > 0 || (p.extract || "").length >= 100;
    if (!has_signal) continue;
    const klass = classifyPage(p);
    const cur = out[slug];
    // First wins per category at this stage (rare for same slug to appear
    // twice across sources). Merger downstream collapses.
    if (cur) continue;
    out[slug] = {
      title: p.title,
      page_url: p.page_url,
      narratives: {
        [klass.category]: {
          text: klass.narrative,
          sc: klass.sc,
          severity: klass.severity,
          source_url: klass.source_url,
        },
      },
      category_signals: p.categories || [],
      external_link_count: p.external_link_count || 0,
    };
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let raw;
  let inDesc;
  if (args.allRaw) {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));
    if (!files.length) { console.error("No raw files in", RAW_DIR); process.exit(2); }
    const merged = { pages: [] };
    const seen = new Set();
    for (const f of files) {
      const r = JSON.parse(await fs.readFile(path.join(RAW_DIR, f), "utf-8"));
      for (const p of (r.pages || [])) {
        if (seen.has(p.slug)) continue;
        seen.add(p.slug); merged.pages.push(p);
      }
    }
    raw = merged;
    inDesc = `${files.length} files (${RAW_DIR})`;
  } else {
    const inFile = args.in || (await findLatestRaw());
    if (!inFile || !existsSync(inFile)) {
      console.error("No raw powerbase file. Run powerbase-fetch.mjs first.");
      process.exit(2);
    }
    raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
    inDesc = inFile;
  }
  console.log(`Powerbase merge starting — input: ${inDesc}`);
  console.log(`  raw: ${(raw.pages || []).length} pages`);

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const slugSet = new Set(index.map(c => c.slug));
  let aliases = {};
  try { aliases = JSON.parse(await fs.readFile(ALIASES_FILE, "utf-8")); } catch {}

  const companies = buildAugment(raw, slugSet, aliases);
  const matched = Object.keys(companies).length;
  const byCat = {};
  const bySc = {};
  for (const c of Object.values(companies)) {
    for (const [cat, n] of Object.entries(c.narratives)) {
      byCat[cat] = (byCat[cat] || 0) + 1;
      bySc[n.sc] = (bySc[n.sc] || 0) + 1;
    }
  }

  const outFile = args.out || DEFAULT_OUT;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const bundle = {
    _license: LICENSE,
    _source: "https://powerbase.info",
    _generated_at: new Date().toISOString(),
    _source_file: inDesc.includes(" files (") ? inDesc : path.relative(ROOT, inDesc),
    _stats: {
      raw_pages:         (raw.pages || []).length,
      matched_companies: matched,
      by_category:       byCat,
      by_severity:       bySc,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nMatched companies: ${matched}`);
  console.log(`By category:       ${JSON.stringify(byCat)}`);
  console.log(`By severity:       ${JSON.stringify(bySc)}`);
  console.log(`Wrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("powerbase-merge failed:", e); process.exit(1); });
}
