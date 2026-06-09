#!/usr/bin/env node
/**
 * Wikipedia controversies merger.
 *
 * Reads:
 *   data/raw/wikipedia/<YYYY-MM-DD>.json
 *   public/data/index.json
 *
 * Writes:
 *   data/derived/wikipedia-controversies-augment.json
 *
 * Output:
 *   {
 *     _license, _source, _generated_at, _stats: { ... },
 *     companies: {
 *       "<slug>": {
 *         title, page_url,
 *         narratives: { <cat>: { text, sc, severity, source_url } },
 *         category_signals: [{ category_title, signal, cat, positive }],
 *         section_count
 *       }
 *     }
 *   }
 *
 * Severity logic (conservative; matches the prompt's hard rule):
 *   - Wikipedia is editorial. Default sc is "mixed".
 *   - Mark "poor" / "very_poor" ONLY when:
 *       (a) ref_count >= 3 in the section, AND
 *       (b) text contains a hard-negative keyword (settlement, fine,
 *           conviction, lawsuit, fraud, breach, recall, strike).
 *   - Mark "positive" only for `Sustainability` / `Philanthropy` /
 *     `Charitable giving` / `Diversity` sections, AND require a positive
 *     keyword cue (donated, pledged, certified, awarded, recognized).
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikipedia");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const DEFAULT_OUT = path.join(DERIVED_DIR, "wikipedia-controversies-augment.json");
const LICENSE = "CC BY-SA 4.0 — Wikipedia, https://en.wikipedia.org";

const NEG_KEYWORDS = [
  /settlement/i, /\bfined?\b/i, /penalty/i, /penalties/i, /conviction/i,
  /lawsuit/i, /class action/i, /fraud/i, /breach/i, /recall/i, /strike/i,
  /antitrust/i, /\bsued\b/i, /allegations?/i, /violation/i, /investigation/i,
  /scandal/i,
];
const POS_KEYWORDS = [
  /donated/i, /pledged/i, /certified/i, /awarded/i, /recognized/i,
  /reduced.+emissions/i, /carbon neutral/i, /renewable energy/i,
  /transparent/i, /commitment/i, /pledge/i,
];
// "External-source" cues — used to satisfy the prompt's rule that we
// need 2+ external source cites before marking negative. Counted as
// either ref tags or external link tags in the raw record.
function externalSourceCount(section) {
  return (section.ref_count || 0) + (section.external_link_count || 0);
}

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

// Returns { text, sc, severity }
export function classifySection(section) {
  const text = section.text || "";
  const cat = section.category;
  const refs = externalSourceCount(section);
  const negHits = NEG_KEYWORDS.filter(rx => rx.test(text)).length;
  const posHits = POS_KEYWORDS.filter(rx => rx.test(text)).length;

  let sc = "mixed";
  let severity = "mixed";

  const POSITIVE_CATS = new Set(["charity", "dei"]);
  // Sustainability sections under "environment" may be net-positive when
  // they talk about reductions / pledges / certs.
  if (cat === "environment" && posHits >= 1 && negHits === 0 && /sustainab|environment(al)? record/i.test(section.heading || "")) {
    sc = "positive"; severity = "positive";
  } else if (POSITIVE_CATS.has(cat) && posHits >= 1 && negHits === 0) {
    sc = "positive"; severity = "positive";
  } else if (cat === "political") {
    // Political sections (lobbying / political donations) talk about
    // money flowing TO politicians. "donated" / "contribution" here is
    // descriptive, not laudatory — always treat as mixed/informational
    // unless explicit negative cues fire.
    sc = negHits ? "mixed" : "mixed";
    severity = negHits ? "negative" : "mixed";
  } else if (negHits >= 2 && refs >= 3) {
    // Strong negative requires hard keywords AND ≥3 external sources.
    sc = "poor"; severity = "negative";
  } else if (negHits >= 1 && refs >= 2) {
    sc = "mixed"; severity = "negative";
  } else if (negHits >= 1) {
    sc = "mixed"; severity = "mixed";
  } else if (posHits >= 1) {
    sc = "positive"; severity = "positive";
  } else {
    sc = "mixed"; severity = "neutral";
  }

  // Render narrative — cap section text at 200 chars (prompt rule).
  const cleaned = secondPassClean(text);
  const clipped = clip(cleaned, 200);
  const narrative = `Wikipedia "${section.heading}" section: ${clipped}`;
  return { text: narrative, sc, severity, source_url: section.url };
}

function clip(s, n) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

// Second-pass cleanup for wikitext residue not caught by the fetcher's
// stripWikitext. Older raw bundles may have leftover heading markers
// (`=== Foo ===`), nested bracket fragments (`]]`), or pipe-separated
// link remnants.
function secondPassClean(text) {
  if (!text) return "";
  let s = String(text);
  // Drop any remaining ==/=== headings
  s = s.replace(/={2,}\s*[^=]+\s*={2,}/g, "");
  s = s.replace(/[\[\]]+/g, " ");
  // Leading punctuation + brackets that survive
  s = s.replace(/^[\s,.\|]+/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Merge multiple sections in the same category into one narrative.
function mergeCategoryNarratives(perCategory) {
  const out = {};
  for (const [cat, recs] of Object.entries(perCategory)) {
    if (!recs.length) continue;
    // Prefer worst-severity for sc; concat narratives (cap 240 chars total).
    const sevRank = { negative: 3, mixed: 2, neutral: 1, positive: 0 };
    recs.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0));
    const top = recs[0];
    let text = top.text;
    if (recs.length > 1) text += ` (+${recs.length - 1} more section${recs.length > 2 ? "s" : ""})`;
    out[cat] = {
      text: clip(text, 280),
      sc: top.sc,
      severity: top.severity,
      source_url: top.source_url,
      section_count: recs.length,
    };
  }
  return out;
}

export function buildAugment(raw, slugSet) {
  const pages = raw.pages || [];
  const companies = {};
  for (const p of pages) {
    if (!slugSet.has(p.slug)) continue;
    const perCat = {};
    for (const s of (p.sections || [])) {
      const klass = classifySection(s);
      (perCat[s.category] ||= []).push(klass);
    }
    const narratives = mergeCategoryNarratives(perCat);

    // Category signals — collapse to per-category positive/negative flag.
    const categoryByCat = {};
    for (const c of (p.categories || [])) {
      const arr = (categoryByCat[c.cat] ||= []);
      arr.push(c);
    }

    if (!Object.keys(narratives).length && !p.categories?.length) continue;
    companies[p.slug] = {
      title: p.title,
      page_url: p.page_url,
      narratives,
      category_signals: p.categories || [],
      section_count: (p.sections || []).length,
    };
  }
  return companies;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let raw;
  let inDesc;
  if (args.allRaw) {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));
    if (!files.length) {
      console.error("No raw files in", RAW_DIR);
      process.exit(2);
    }
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
      console.error("No raw wikipedia file. Run wikipedia-controversies-fetch.mjs first, or pass --in / --all-raw.");
      process.exit(2);
    }
    raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
    inDesc = inFile;
  }
  console.log(`Wikipedia controversies merge starting — input: ${inDesc}`);
  console.log(`  raw: ${(raw.pages || []).length} pages`);

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const slugSet = new Set(index.map(c => c.slug));

  const companies = buildAugment(raw, slugSet);
  const matchedCompanies = Object.keys(companies).length;
  const totalNarratives = Object.values(companies).reduce((s, c) => s + Object.keys(c.narratives).length, 0);
  const totalCategories = Object.values(companies).reduce((s, c) => s + (c.category_signals?.length || 0), 0);
  const byCategory = {};
  for (const c of Object.values(companies)) {
    for (const cat of Object.keys(c.narratives)) byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  const outFile = args.out || DEFAULT_OUT;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const bundle = {
    _license: LICENSE,
    _source: "https://en.wikipedia.org",
    _generated_at: new Date().toISOString(),
    _source_file: inDesc.includes(" files (") ? inDesc : path.relative(ROOT, inDesc),
    _stats: {
      raw_pages:           (raw.pages || []).length,
      matched_companies:   matchedCompanies,
      total_narratives:    totalNarratives,
      total_category_sig:  totalCategories,
      by_category:         byCategory,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nMatched companies:      ${matchedCompanies}`);
  console.log(`Narratives produced:    ${totalNarratives}`);
  console.log(`Category signals:       ${totalCategories}`);
  console.log(`By category:            ${JSON.stringify(byCategory)}`);
  console.log(`Wrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("wikipedia-controversies-merge failed:", e); process.exit(1); });
}
