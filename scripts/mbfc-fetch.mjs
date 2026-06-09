#!/usr/bin/env node
/**
 * MediaBias/FactCheck (MBFC) bulk ratings fetcher.
 *
 * Pulls ~8,700+ outlet ratings (bias + factuality + credibility) from the
 * community-maintained MBFC mirror at github.com/drmikecrowe/mbfcext.
 *
 *   Source: https://raw.githubusercontent.com/drmikecrowe/mbfcext/master/docs/v4/combined.json
 *
 * Produces `data/derived/mbfc-outlet-bias.json` — a generated companion to the
 * hand-curated 33-outlet OUTLET_BIAS map in scripts/news-rss-collect.mjs.
 *
 * Schema (per domain):
 *   "domain.com": {
 *     bias:       "left" | "left-leaning" | "center" | "right-leaning" | "right" | "pro-science" | "conspiracy" | "satire" | "fake-news",
 *     factuality: "very-high" | "high" | "mostly-factual" | "mixed" | "low" | "very-low" | null,
 *     weight:     0.1 - 1.0,
 *     credibility:"high" | "medium" | "low" | null,
 *     fact_driver: boolean   // true if factuality ∈ {very-high, high} AND credibility != low
 *   }
 *
 * Weight derivation (deterministic):
 *   factuality very-high → 1.00
 *   factuality high      → 0.85
 *   factuality mostly    → 0.70
 *   factuality mixed     → 0.50
 *   factuality low       → 0.30
 *   factuality very-low  → 0.15
 *   bias == fake-news    → cap at 0.10
 *   bias == satire       → 0.00 (never a fact-driver)
 *   bias == conspiracy   → cap at 0.20
 *
 * news-rss-collect.mjs loads this file at runtime and merges with the
 * hand-curated OUTLET_BIAS — hand entries always win on conflict.
 *
 * Runs ad-hoc (data refreshed by mirror weekly). Locally:
 *   node scripts/mbfc-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/mbfc");
const OUT_FILE = path.join(ROOT, "data/derived/mbfc-outlet-bias.json");

const MBFC_URL =
  "https://raw.githubusercontent.com/drmikecrowe/mbfcext/master/docs/v4/combined.json";
const UA = "TruNorth-MBFC/1.0 (+https://www.trunorthapp.com)";

// MBFC bias codes → our enum.
const BIAS_MAP = {
  L:   "left",
  LC:  "left-leaning",
  C:   "center",
  RC:  "right-leaning",
  R:   "right",
  PS:  "pro-science",
  CP:  "conspiracy",
  S:   "satire",
  FN:  "fake-news",
};

// MBFC reporting codes → factuality string + base weight.
const REPORTING_MAP = {
  VH: { factuality: "very-high",      weight: 1.00 },
  H:  { factuality: "high",           weight: 0.85 },
  MF: { factuality: "mostly-factual", weight: 0.70 },
  M:  { factuality: "mixed",          weight: 0.50 },
  L:  { factuality: "low",            weight: 0.30 },
  VL: { factuality: "very-low",       weight: 0.15 },
};

const CRED_MAP = { H: "high", M: "medium", L: "low", NA: null };

function deriveEntry(src) {
  const bias = BIAS_MAP[src.b] || "unknown";
  const rep  = REPORTING_MAP[src.r] || null;
  const cred = CRED_MAP[src.c] ?? null;

  let weight = rep ? rep.weight : 0.30;
  let factuality = rep ? rep.factuality : null;

  // Bias-class caps — even if MBFC marked them "high" reporting, we cap
  // weight for fundamentally unreliable buckets.
  if (bias === "fake-news")   weight = Math.min(weight, 0.10);
  if (bias === "conspiracy")  weight = Math.min(weight, 0.20);
  if (bias === "satire")      weight = 0.00;
  if (cred === "low")         weight = Math.min(weight, 0.25);

  const fact_driver =
    (factuality === "very-high" || factuality === "high") &&
    cred !== "low" &&
    bias !== "fake-news" &&
    bias !== "satire" &&
    bias !== "conspiracy";

  return { bias, factuality, weight: Number(weight.toFixed(2)), credibility: cred, fact_driver };
}

function normalizeDomain(d) {
  if (!d) return null;
  return String(d).toLowerCase().replace(/^www\./, "").replace(/\/$/, "").trim();
}

async function main() {
  console.log("📡 MBFC bulk fetch starting...");
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  const res = await fetch(MBFC_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`MBFC fetch HTTP ${res.status}`);
  const json = await res.json();

  // Snapshot raw response for audit.
  const today = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(rawPath, JSON.stringify(json));
  console.log(`💾 Raw snapshot: ${rawPath}`);

  const sources = json.sources || {};
  const aliases = json.aliases || {};

  const out = {};
  let written = 0;
  let skipped = 0;

  for (const key of Object.keys(sources)) {
    const src = sources[key];
    const domain = normalizeDomain(src.d || key);
    if (!domain || !/\./.test(domain)) { skipped++; continue; }
    out[domain] = deriveEntry(src);
    written++;
  }

  // Apply MBFC's own aliases (e.g. bbc.co.uk → bbc.com).
  for (const [alias, canonical] of Object.entries(aliases)) {
    const a = normalizeDomain(alias);
    const c = normalizeDomain(canonical);
    if (a && c && out[c] && !out[a]) {
      out[a] = out[c];
      written++;
    }
  }

  // Distribution stats for sanity.
  const dist = { bias: {}, factuality: {}, fact_drivers: 0 };
  for (const o of Object.values(out)) {
    dist.bias[o.bias] = (dist.bias[o.bias] || 0) + 1;
    dist.factuality[o.factuality || "unknown"] = (dist.factuality[o.factuality || "unknown"] || 0) + 1;
    if (o.fact_driver) dist.fact_drivers++;
  }

  const payload = {
    _meta: {
      source:        "mediabiasfactcheck.com (via github.com/drmikecrowe/mbfcext)",
      mbfc_version:  json.version,
      mbfc_date:     json.date,
      fetched_at:    new Date().toISOString(),
      outlet_count:  Object.keys(out).length,
      distribution:  dist,
    },
    outlets: out,
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`✅ Wrote ${OUT_FILE}`);
  console.log(`   Outlets:      ${written}`);
  console.log(`   Fact drivers: ${dist.fact_drivers}`);
  console.log(`   Bias dist:    ${JSON.stringify(dist.bias)}`);
}

main().catch(err => {
  console.error("❌ mbfc-fetch failed:", err);
  process.exit(1);
});
