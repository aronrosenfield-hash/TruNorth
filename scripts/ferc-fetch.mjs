#!/usr/bin/env node
/**
 * FERC (Federal Energy Regulatory Commission) Enforcement Actions
 * — weekly fetcher.
 *
 * For each brand in /public/data/top-500-brands.txt (energy-utility focus),
 * this script aggregates FERC civil penalty actions and stipulated/consent
 * orders involving that brand.
 *
 * Output: /public/data/ferc-enforcement.json (overwritten weekly)
 *
 * Per-brand aggregates (5-year window):
 *   total_enforcement_actions_5y  — count of public actions, last 5 fiscal yrs
 *   total_civil_penalties_usd     — sum of penalty amounts (USD), 5-yr window
 *   top_violations                — top 5 violation categories
 *   sample_actions                — up to 5 most recent { date, caption,
 *                                   docket, penalty_usd, summary, url }
 *
 * Data sources (in priority order):
 *   1. Live scrape of FERC's Civil Penalty Actions index page
 *        https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions
 *      This page is unfortunately Cloudflare-protected and frequently returns
 *      HTTP 403 to non-browser clients. We attempt it with a polite UA and
 *      a short timeout, then fall back to (2).
 *   2. Curated seed dataset of FERC public actions extracted from FERC's
 *      annual Reports on Enforcement (FY2020–FY2024):
 *        public/data/ferc-enforcement-seed.json
 *      Maintained by hand once a year when FERC publishes its annual report.
 *      Each entry: { date, caption, respondents[], docket, penalty_usd,
 *      disgorgement_usd, violations[], summary, source_url }.
 *
 * Matching:
 *   - Case-insensitive substring match of brand name (with aliases) against
 *     each respondent / caption text.
 *   - Honors a small alias table for common corporate-form variants
 *     (ExxonMobil <-> Exxon Mobil, ConocoPhillips <-> Conoco, BP <-> BP
 *     America / BP Energy, NextEra <-> NextEra Energy / FPL, Shell <->
 *     Shell Energy / Shell Trading, Chevron <-> Chevron Natural Gas, etc.)
 *
 * Rate limiting: 1 request per second. UA "TruNorth-FERC/1.0".
 *
 * Runs via .github/workflows/ferc-weekly.yml Tuesday 04:00 UTC.
 * Locally:
 *   node scripts/ferc-fetch.mjs            (all brands)
 *   node scripts/ferc-fetch.mjs --smoke    (BP, Chevron, Shell, NextEra)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const SEED_FILE   = path.join(ROOT, "public/data/ferc-enforcement-seed.json");
const OUT_FILE    = path.join(ROOT, "public/data/ferc-enforcement.json");

const FERC_LIVE_URL = "https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions";
const UA = "TruNorth-FERC/1.0 (+https://www.trunorthapp.com)";
const REQ_DELAY_MS = 1000;
const FIVE_YEAR_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const SMOKE = process.argv.includes("--smoke");
const SMOKE_BRANDS = new Set(["bp", "chevron", "shell", "nextera"]);

// Brand-name aliases for FERC matching. FERC orders typically name the
// regulated subsidiary (e.g. "BP America Inc.", "Shell Energy North
// America (US), L.P.", "NextEra Energy Power Marketing, LLC"), not the
// parent. Each list is the set of additional substrings (case-insensitive)
// that should also match this brand.
const BRAND_ALIASES = {
  "bp":              ["BP America", "BP Energy", "BP Corporation North America", "BP Products"],
  "chevron":         ["Chevron Natural Gas", "Chevron U.S.A", "ChevronTexaco"],
  "shell":           ["Shell Energy", "Shell Trading", "Shell Oil", "Coral Energy"],
  "exxonmobil":      ["Exxon Mobil", "ExxonMobil", "Mobil Natural Gas", "XTO Energy"],
  "conocophillips":  ["Conoco", "ConocoPhillips", "Burlington Resources"],
  "nextera":         ["NextEra Energy", "NextEra", "Florida Power & Light", "FPL", "Gulf Power"],
  "duke-energy":     ["Duke Energy", "Progress Energy", "Cinergy"],
  "southern-company":["Southern Company", "Georgia Power", "Alabama Power", "Mississippi Power"],
  "berkshire-hathaway":["PacifiCorp", "MidAmerican Energy", "NV Energy", "Berkshire Hathaway Energy"],
  "jpmorgan-chase":  ["J.P. Morgan Ventures Energy", "JPMorgan Ventures Energy"],
  "barclays":        ["Barclays Bank PLC", "Barclays Capital"],
  "deutsche-bank":   ["Deutsche Bank Energy Trading"],
  "morgan-stanley":  ["Morgan Stanley Capital Group"],
  "citigroup":       ["Citigroup Energy"],
  "total":           ["TotalEnergies", "Total Gas & Power"],
  "occidental":      ["Occidental Energy Marketing", "Oxy USA"],
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name);
}

async function loadSeed() {
  if (!existsSync(SEED_FILE)) {
    console.warn(`  (no seed file at ${SEED_FILE} — only live data will be used)`);
    return [];
  }
  const data = JSON.parse(await fs.readFile(SEED_FILE, "utf-8"));
  const actions = Array.isArray(data) ? data : (data.actions || []);
  console.log(`  Loaded ${actions.length} seed actions from ferc-enforcement-seed.json`);
  return actions;
}

// Best-effort live scrape. The page is Cloudflare-protected and most
// non-browser clients get HTTP 403. We try once with a 12-second timeout
// and just log + return [] on failure — the seed file carries the load.
async function tryLiveScrape() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(FERC_LIVE_URL, {
      headers: {
        "User-Agent": UA,
        "Accept":     "text/html,application/xhtml+xml",
      },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn(`  Live FERC fetch returned HTTP ${res.status} — falling back to seed.`);
      return [];
    }
    const html = await res.text();
    return parseLiveHtml(html);
  } catch (e) {
    clearTimeout(t);
    console.warn(`  Live FERC fetch failed (${e.message}) — falling back to seed.`);
    return [];
  }
}

// Parse the (rarely-reachable) live HTML. The Civil Penalty Actions page
// renders a year-by-year table with: Date | Company | Docket | Penalty.
// We extract <tr><td>...</td><td>...</td><td>...</td><td>...</td></tr>.
function parseLiveHtml(html) {
  const out = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const strip = s => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const date    = strip(m[1]);
    const caption = strip(m[2]);
    const docket  = strip(m[3]);
    const penRaw  = strip(m[4]);
    if (!date || !caption) continue;
    if (!/\d{4}/.test(date)) continue; // header row
    const isoDate = isoFromDate(date);
    if (!isoDate) continue;
    out.push({
      date:           isoDate,
      caption,
      respondents:    [caption],
      docket,
      penalty_usd:    parsePenalty(penRaw),
      violations:     [],
      summary:        "",
      source_url:     FERC_LIVE_URL,
      source:         "ferc_live",
    });
  }
  return out;
}

function isoFromDate(s) {
  // "January 15, 2024" → "2024-01-15"
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = months[m[1].slice(0,3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2,"0")}-${String(parseInt(m[2],10)).padStart(2,"0")}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function parsePenalty(s) {
  if (!s) return 0;
  // "$10,000,000" | "$10 million" | "10,000,000"
  const millionM = s.match(/\$?\s*([0-9.]+)\s*million/i);
  if (millionM) return Math.round(parseFloat(millionM[1]) * 1_000_000);
  const billionM = s.match(/\$?\s*([0-9.]+)\s*billion/i);
  if (billionM) return Math.round(parseFloat(billionM[1]) * 1_000_000_000);
  const num = s.replace(/[^0-9.]/g, "");
  return num ? Math.round(parseFloat(num)) : 0;
}

function matchersFor(brand) {
  const aliases = BRAND_ALIASES[brand.slug] || [];
  const names = [brand.name, ...aliases];
  // Build case-insensitive substring regexes with word boundaries on each side
  // where possible.
  return names.map(n => {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${esc}\\b`, "i");
  });
}

function actionMatches(action, regexes) {
  const haystack = [
    action.caption || "",
    ...(action.respondents || []),
  ].join(" || ");
  return regexes.some(re => re.test(haystack));
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) {
    if (!x) continue;
    const k = String(x).trim();
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function aggregateForBrand(brand, allActions) {
  const regexes = matchersFor(brand);
  const matches = allActions.filter(a => actionMatches(a, regexes));
  if (matches.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions" };
  }

  const cutoff = Date.now() - FIVE_YEAR_MS;
  const fiveYr = matches.filter(a => {
    const t = Date.parse(a.date);
    return !Number.isNaN(t) && t > cutoff;
  });

  // Sort newest first
  const sorted = matches.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const totalPenalties5y = fiveYr.reduce((s, a) => s + (Number(a.penalty_usd) || 0), 0);
  const allViolations = matches.flatMap(a => a.violations || []);

  return {
    slug:                          brand.slug,
    name:                          brand.name,
    status:                        "ok",
    total_enforcement_actions_5y:  fiveYr.length,
    total_enforcement_actions_all: matches.length,
    total_civil_penalties_usd:     totalPenalties5y,
    top_violations:                topN(allViolations, 5),
    sample_actions:                sorted.slice(0, 5).map(a => ({
      date:           a.date,
      caption:        a.caption,
      docket:         a.docket || null,
      penalty_usd:    a.penalty_usd || 0,
      violations:     a.violations || [],
      summary:        a.summary || "",
      url:            a.source_url || FERC_LIVE_URL,
    })),
    scraped_at:                    new Date().toISOString(),
  };
}

async function main() {
  console.log("FERC enforcement fetcher starting...");
  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (SMOKE) {
    brands = brands.filter(b => SMOKE_BRANDS.has(b.slug));
    console.log(`SMOKE mode — testing ${brands.length} brands: ${brands.map(b => b.slug).join(", ")}`);
  }

  console.log("Attempting live FERC scrape (1 req/sec, polite UA)...");
  const liveActions = await tryLiveScrape();
  await sleep(REQ_DELAY_MS);
  console.log(`  Live actions collected: ${liveActions.length}`);

  console.log("Loading curated seed dataset...");
  const seedActions = await loadSeed();

  // Merge & dedupe by (date + docket) when possible, otherwise (date + caption).
  const seen = new Set();
  const allActions = [];
  const key = a => `${a.date}|${(a.docket || a.caption || "").toLowerCase().slice(0, 80)}`;
  for (const a of [...liveActions, ...seedActions]) {
    const k = key(a);
    if (seen.has(k)) continue;
    seen.add(k);
    allActions.push(a);
  }
  console.log(`  Combined unique actions: ${allActions.length}`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = aggregateForBrand(brands[i], allActions);
    results.push(r);
    if (r.status === "ok") {
      console.log(`  ${brands[i].slug}: ${r.total_enforcement_actions_5y} actions in 5y, $${r.total_civil_penalties_usd.toLocaleString()} penalties`);
    }
  }

  const withActions = results.filter(r => r.status === "ok").length;
  const noActions   = results.filter(r => r.status === "no_actions").length;

  const outPath = SMOKE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:        new Date().toISOString(),
    smoke:               SMOKE || undefined,
    live_action_count:   liveActions.length,
    seed_action_count:   seedActions.length,
    combined_count:      allActions.length,
    brand_count:         brands.length,
    with_actions_count:  withActions,
    no_actions_count:    noActions,
    actions:             results,
  }, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`   With FERC actions: ${withActions}`);
  console.log(`   None:              ${noActions}`);
}

main().catch(err => {
  console.error("ferc-fetch failed:", err);
  process.exit(1);
});
