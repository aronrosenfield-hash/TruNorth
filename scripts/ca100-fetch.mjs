#!/usr/bin/env node
/**
 * Climate Action 100+ Net Zero Company Benchmark fetcher (annual) — B-Data8.
 *
 * SOURCE
 *   https://www.climateaction100.org
 *   https://www.climateaction100.org/whos-involved/companies/
 *   https://www.climateaction100.org/net-zero-company-benchmark/
 *
 * Climate Action 100+ is an investor-led initiative tracking the 167
 * highest-emitting public companies on their net-zero transition. The
 * Net Zero Company Benchmark (released annually each March) scores each
 * focus company across a battery of disclosure indicators rolled up into
 * four headline pillars:
 *
 *   - disclosure          (0-5)  TCFD-aligned reporting depth
 *   - alignment           (0-5)  short / medium / long-term target rigor
 *   - governance          (0-5)  board oversight + lobbying integrity
 *   - capital_allocation  (0-5)  green capex + transition spend
 *
 * The benchmark also publishes per-company net-zero target year and
 * Scope 1+2 emissions (Mt CO2e) tables alongside the PDF.
 *
 * WHY IT MATTERS
 *   These 167 companies account for ~80% of global industrial GHG
 *   emissions. Their benchmark scores are the single best public signal
 *   on whether a company is actually transitioning to net zero or just
 *   greenwashing. Direct environment-category input for TruNorth.
 *
 * MODES
 *   --dry      (default) Hits the on-disk fixtures under test/fixtures/ca100/.
 *              No network. Safe to run in worktrees / CI dry-runs.
 *   --fixture  Alias for --dry. Explicit.
 *   --live     Pings the public CA100+ URLs (1 req/sec) + writes a fresh
 *              cache. CA100+ pages are JS-rendered with no public JSON
 *              API, so the live path produces the same fixture-shape
 *              output — the network round-trip just verifies the URLs
 *              still resolve and refreshes the cache timestamp.
 *
 * CACHING
 *   On a successful --live run we copy the fixture JSON into
 *   public/data/_cache/ca100/<benchmark_year>/{focus-companies,benchmark-scores,emissions-targets}.{html,json}
 *   so subsequent dry-runs can rebuild against the latest snapshot.
 *
 * OUTPUT
 *   public/data/ca100.json
 *     {
 *       generated_at, source_urls, benchmark_year, mode,
 *       portal_pings: [...],
 *       fixtures_used: { roster, scores, emissions },
 *       focus_company_count, brand_count, matched_count, ...,
 *       rankings: [ { slug, name, status,
 *                     is_focus_company, scores, net_zero_target_year,
 *                     scope_1_2_emissions_mt_co2e, source_url } ]
 *     }
 *
 * SCHEDULE
 *   .github/workflows/ca100-annual.yml — Apr 15 (after annual benchmark
 *   release in March).
 *
 * Locally:
 *   node scripts/ca100-fetch.mjs                # default --dry (fixtures)
 *   node scripts/ca100-fetch.mjs --live         # pings live CA100+ URLs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE  = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE     = path.join(ROOT, "public/data/ca100.json");
const FIXTURE_DIR  = path.join(ROOT, "test/fixtures/ca100");
const CACHE_DIR    = path.join(ROOT, "public/data/_cache/ca100");

const UA = "TruNorth-CA100/1.0 (+https://www.trunorthapp.com; environment-category data pipeline)";
const REQ_DELAY_MS = 1000;
const SLEEP = (ms) => new Promise(r => setTimeout(r, ms));

const HOME_URL      = "https://www.climateaction100.org";
const COMPANIES_URL = "https://www.climateaction100.org/whos-involved/companies/";
const BENCHMARK_URL = "https://www.climateaction100.org/net-zero-company-benchmark/";

const argv = new Set(process.argv.slice(2));
const LIVE = argv.has("--live");
const DRY  = !LIVE;   // --dry / --fixture are the default.
void DRY;             // marker — read by the smoke log only.

/* ------------------------------ fixtures --------------------------------- */

async function loadFixtures() {
  const rosterPath    = path.join(FIXTURE_DIR, "focus-companies.html");
  const scoresPath    = path.join(FIXTURE_DIR, "benchmark-scores.json");
  const emissionsPath = path.join(FIXTURE_DIR, "emissions-targets.json");

  if (!existsSync(rosterPath) || !existsSync(scoresPath) || !existsSync(emissionsPath)) {
    throw new Error(`CA100 fixtures missing. Expected three files under ${FIXTURE_DIR}: focus-companies.html, benchmark-scores.json, emissions-targets.json`);
  }
  const roster    = await fs.readFile(rosterPath, "utf-8");
  const scores    = JSON.parse(await fs.readFile(scoresPath, "utf-8"));
  const emissions = JSON.parse(await fs.readFile(emissionsPath, "utf-8"));
  return {
    roster, scores, emissions,
    fixturesUsed: {
      roster: path.relative(ROOT, rosterPath),
      scores: path.relative(ROOT, scoresPath),
      emissions: path.relative(ROOT, emissionsPath),
    },
    fixtureAbsPaths: { rosterPath, scoresPath, emissionsPath },
  };
}

/* ----------------------- focus-company HTML parser ----------------------- */

function parseRoster(html) {
  // Tolerant <li>/<a> extractor; CA100+ renders the roster as a flat <ul>
  // with one anchor per company.
  const out = [];
  const liRe = /<li[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>\s*<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const href = m[1].trim();
    const name = decodeHtml(m[2].trim());
    const id   = href.replace(/^.*\/company\//, "").replace(/\/$/, "").toLowerCase();
    if (id && name) out.push({ company_id: id, name });
  }
  return out;
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* ---------------------------- index assembly ----------------------------- */

function buildIndex(roster, scoresDoc, emissionsDoc) {
  // Roster is the source of truth for "is a focus company". Scores +
  // emissions are looked up by company_id; missing rows are tolerated.
  const scoresById    = new Map(scoresDoc.companies.map(c => [c.company_id, c.scores]));
  const emissionsById = new Map(emissionsDoc.companies.map(c => [c.company_id, c]));

  const index = new Map();
  for (const c of roster) {
    const s = scoresById.get(c.company_id) || null;
    const e = emissionsById.get(c.company_id) || {};
    index.set(c.company_id, {
      company_id: c.company_id,
      name: c.name,
      scores: s,
      net_zero_target_year: e.net_zero_target_year ?? null,
      scope_1_2_emissions_mt_co2e: e.scope_1_2_emissions_mt_co2e ?? null,
    });
  }
  return index;
}

/* ----------------------- brand → focus-company match --------------------- */

const CORP_STOPWORDS = /\b(inc|corp|corporation|company|co|plc|ltd|limited|holdings|holding|group|the|sa|se|spa|nv|ag|asa|sp|sas|usa)\b/g;

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(CORP_STOPWORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSlug(slug, name, index) {
  const normName = normalize(name);
  const normSlug = normalize(slug.replace(/-/g, " "));

  const tokens = (s) => new Set((s || "").split(/\s+/).filter(t => t.length >= 2));
  const nameToks = tokens(normName);
  const slugToks = tokens(normSlug);

  // Pass 1: exact name match, then full-token-set match (avoids
  // substring false positives like "dell" → "lyondellbasell").
  for (const [, entry] of index) {
    const cand = normalize(entry.name);
    if (!cand) continue;
    if (cand === normName || cand === normSlug) return entry;
    const candToks = tokens(cand);
    if (candToks.size === 0) continue;
    // All candidate tokens are present in the brand's name OR brand slug
    // (require nonempty token sets to avoid vacuous-true `.every`).
    if (nameToks.size > 0 && [...candToks].every(t => nameToks.has(t))) return entry;
    if (slugToks.size > 0 && [...candToks].every(t => slugToks.has(t))) return entry;
  }
  // Pass 2: company_id full-token match against slug. Token boundary
  // matching to avoid e.g. "dell" matching "lyondellbasell".
  const slugTokens = new Set(slug.toLowerCase().split(/[-_/]+/).filter(Boolean));
  for (const [id, entry] of index) {
    const idTokens = id.split(/[-_/]+/).filter(Boolean);
    if (idTokens.length === 0) continue;
    if (idTokens.every(t => slugTokens.has(t)) && idTokens.join("") === [...slugTokens].sort().join("")) {
      // exact token-set match (after sorting) — too strict for partial slugs
      return entry;
    }
    // require all id tokens to appear as full slug tokens
    if (idTokens.every(t => slugTokens.has(t))) return entry;
  }
  return null;
}

/* ------------------------------- brands ---------------------------------- */

// Top-50 likely CA100+ overlap from the task spec — used as the DRY-RUN
// target list when top-500-brands.txt is missing or empty.
const TOP_50_FALLBACK = [
  { slug: "exxon-mobil",                name: "ExxonMobil" },
  { slug: "chevron",                    name: "Chevron" },
  { slug: "shell-usa",                  name: "Shell" },
  { slug: "bp-usa",                     name: "BP" },
  { slug: "conoco-phillips",            name: "ConocoPhillips" },
  { slug: "totalenergies-usa",          name: "TotalEnergies" },
  { slug: "eni-spa",                    name: "Eni" },
  { slug: "equinor-asa",                name: "Equinor" },
  { slug: "valero-energy",              name: "Valero Energy" },
  { slug: "marathon-petroleum",         name: "Marathon Petroleum" },
  { slug: "phillips-66",                name: "Phillips 66" },
  { slug: "hess",                       name: "Hess" },
  { slug: "marathon-oil",               name: "Marathon Oil" },
  { slug: "occidental-petroleum",       name: "Occidental Petroleum" },
  { slug: "pioneer-natural-resources",  name: "Pioneer Natural Resources" },
  { slug: "eog-resources",              name: "EOG Resources" },
  { slug: "devon-energy",               name: "Devon Energy" },
  { slug: "southern-company",           name: "Southern Company" },
  { slug: "duke-energy",                name: "Duke Energy" },
  { slug: "dominion-energy",            name: "Dominion Energy" },
  { slug: "exelon",                     name: "Exelon" },
  { slug: "american-electric-power",    name: "American Electric Power" },
  { slug: "nextera-energy",             name: "NextEra Energy" },
  { slug: "edison-international",       name: "Edison International" },
  { slug: "pg-and-e",                   name: "PG&E" },
  { slug: "peabody-energy",             name: "Peabody Energy" },
  { slug: "arch-resources",             name: "Arch Resources" },
  { slug: "alcoa",                      name: "Alcoa" },
  { slug: "glencore-plc",               name: "Glencore" },
  { slug: "rio-tinto-usa",              name: "Rio Tinto" },
  { slug: "bhp",                        name: "BHP" },
  { slug: "freeport-mcmoran",           name: "Freeport-McMoRan" },
  { slug: "dupont",                     name: "DuPont" },
  { slug: "dow",                        name: "Dow" },
  { slug: "basf-corp",                  name: "BASF" },
  { slug: "3m",                         name: "3M" },
  { slug: "lyondellbasell",             name: "LyondellBasell" },
  { slug: "ge-aerospace",               name: "GE Aerospace" },
  { slug: "boeing",                     name: "Boeing" },
  { slug: "airbus",                     name: "Airbus" },
  { slug: "caterpillar",                name: "Caterpillar" },
  { slug: "deere",                      name: "Deere & Company" },
  { slug: "toyota",                     name: "Toyota" },
  { slug: "ford",                       name: "Ford" },
  { slug: "stellantis",                 name: "Stellantis" },
  { slug: "volkswagen",                 name: "Volkswagen" },
  { slug: "daimler",                    name: "Daimler" },
  { slug: "bmw",                        name: "BMW" },
  { slug: "honda",                      name: "Honda" },
  { slug: "glencore",                   name: "Glencore" },
];

async function loadBrands() {
  try {
    const raw = await fs.readFile(BRANDS_FILE, "utf-8");
    const brands = raw.split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"))
      .map(l => {
        const [slug, name] = l.split("|").map(s => s.trim());
        return { slug, name };
      })
      .filter(b => b.slug && b.name);
    if (brands.length > 0) return { brands, source: "top-500-brands.txt" };
  } catch { /* fall through */ }
  return { brands: TOP_50_FALLBACK, source: "TOP_50_FALLBACK (spec list)" };
}

/* ---------------------- portal connectivity check ------------------------ */

async function pingUrl(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    return { url, status: res.status, ok: res.ok };
  } catch (err) {
    return { url, status: 0, ok: false, error: err.message };
  }
}

/* ------------------------------- cache ----------------------------------- */

async function cacheFixtures(year, fixtures) {
  const dir = path.join(CACHE_DIR, String(year));
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(fixtures.fixtureAbsPaths.rosterPath,    path.join(dir, "focus-companies.html"));
  await fs.copyFile(fixtures.fixtureAbsPaths.scoresPath,    path.join(dir, "benchmark-scores.json"));
  await fs.copyFile(fixtures.fixtureAbsPaths.emissionsPath, path.join(dir, "emissions-targets.json"));
}

/* --------------------------------- main ---------------------------------- */

async function main() {
  console.log(`Climate Action 100+ fetcher starting (mode: ${LIVE ? "LIVE" : "DRY-RUN (fixtures)"})...`);

  // Connectivity ping only in --live mode. DRY-RUN never touches the network.
  const pings = [];
  if (LIVE) {
    for (const url of [HOME_URL, COMPANIES_URL, BENCHMARK_URL]) {
      console.log(`  Pinging ${url}`);
      pings.push(await pingUrl(url));
      await SLEEP(REQ_DELAY_MS);
    }
    for (const p of pings) {
      console.log(`    ${p.url} -> ${p.status}${p.ok ? "" : ` (${p.error || "non-200"})`}`);
    }
  } else {
    console.log("  [DRY-RUN] skipping portal pings (no network)");
  }

  const fixtures = await loadFixtures();
  const roster   = parseRoster(fixtures.roster);
  console.log(`Parsed ${roster.length} focus companies from roster fixture`);

  const index = buildIndex(roster, fixtures.scores, fixtures.emissions);
  console.log(`Indexed ${index.size} CA100+ focus companies`);

  const { brands, source: brandsSource } = await loadBrands();
  console.log(`Loaded ${brands.length} brands (source: ${brandsSource})`);

  const results = [];
  for (const brand of brands) {
    const entry = matchSlug(brand.slug, brand.name, index);
    if (!entry) {
      results.push({ slug: brand.slug, name: brand.name, status: "no_match" });
      continue;
    }
    results.push({
      slug: brand.slug,
      name: brand.name,
      status: "ok",
      is_focus_company: true,
      ca100_company_id: entry.company_id,
      ca100_company_name: entry.name,
      scores: entry.scores,           // { disclosure, alignment, governance, capital_allocation }
      net_zero_target_year: entry.net_zero_target_year,
      scope_1_2_emissions_mt_co2e: entry.scope_1_2_emissions_mt_co2e,
      source_url: BENCHMARK_URL,
    });
  }

  const matched = results.filter(r => r.status === "ok");
  const noMatch = results.filter(r => r.status === "no_match").length;

  // Smoke check — high-confidence focus companies.
  const smokeSlugs = ["exxon-mobil", "chevron", "shell-usa", "bp-usa", "totalenergies-usa", "nextera-energy", "ford"];
  const smoke = smokeSlugs.map(s => {
    const r = results.find(x => x.slug === s);
    if (!r) return { slug: s, status: "not_in_brand_list" };
    return {
      slug: s,
      status: r.status,
      focus: r.is_focus_company ?? null,
      scores: r.scores ?? null,
      net_zero_target_year: r.net_zero_target_year ?? null,
      scope_1_2_mt: r.scope_1_2_emissions_mt_co2e ?? null,
    };
  });

  const benchmarkYear = fixtures.scores.benchmark_year ?? new Date().getFullYear();

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    source:              "Climate Action 100+ Net Zero Company Benchmark",
    source_urls:         [HOME_URL, COMPANIES_URL, BENCHMARK_URL],
    benchmark_year:      benchmarkYear,
    mode:                LIVE ? "live" : "dry",
    brands_source:       brandsSource,
    portal_pings:        pings,
    fixtures_used:       fixtures.fixturesUsed,
    focus_company_count: index.size,
    brand_count:         brands.length,
    matched_count:       matched.length,
    no_match_count:      noMatch,
    smoke,
    rankings:            results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   Focus companies indexed:                  ${index.size}`);
  console.log(`   Brands flagged as CA100+ focus companies: ${matched.length}`);
  console.log(`   No-match brands:                          ${noMatch}`);
  console.log("\nSmoke check:");
  for (const s of smoke) {
    if (s.status !== "ok") { console.log(`   - ${s.slug}: ${s.status}`); continue; }
    const sc = s.scores || {};
    console.log(`   - ${s.slug}: focus=${s.focus} D${sc.disclosure}/A${sc.alignment}/G${sc.governance}/C${sc.capital_allocation} target=${s.net_zero_target_year ?? "n/a"} S1+2=${s.scope_1_2_mt}Mt`);
  }

  if (LIVE) {
    await cacheFixtures(benchmarkYear, fixtures);
    console.log(`\nCached snapshot under public/data/_cache/ca100/${benchmarkYear}/`);
  }
}

main().catch(err => {
  console.error("ca100-fetch failed:", err);
  process.exit(1);
});
