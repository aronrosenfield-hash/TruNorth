#!/usr/bin/env node
/**
 * IIHS Top Safety Pick / TSP+ annual list scraper.
 *
 * The Insurance Institute for Highway Safety (IIHS) is the insurance
 * industry's safety research arm. Each spring it publishes an annual
 * "Top Safety Pick" (TSP) and "Top Safety Pick+" (TSP+) award list —
 * the de-facto consumer-facing standard for vehicle crashworthiness +
 * crash-avoidance + headlight performance.
 *
 * The plus tier (TSP+) requires the highest ratings in front, side,
 * roof + head-restraint tests AND "good" or "acceptable" headlights
 * across all trim levels. The plain tier (TSP) is the same minus the
 * acceptable-trims-of-headlights requirement.
 *
 * Source pages (one per year, public, no login):
 *   https://www.iihs.org/ratings/top-safety-picks/<YYYY>
 *
 * License: IIHS publishes these award lists publicly with no API and
 * no explicit license — they're cited freely in consumer media, dealer
 * marketing, and government documentation. We attribute each record
 * back to the per-year IIHS source URL.
 *
 * STRUCTURE OF SOURCE PAGE
 *   Each award winner is a card:
 *     <a class="card" href="/ratings/vehicle/<make>/<model>/<year>">
 *       <tsp-photo tsp-award-level="category__tspPlus"|"category__tsp" ...>
 *       <div class="card-content">
 *         <p class="category tspPlusBanner|tspBanner">…</p>
 *         <p>2024-25 Acura Integra 4-door hatchback</p>
 *       </div>
 *     </a>
 *
 * OUTPUT
 *   data/raw/iihs-tsp/<YYYY-MM-DD>.json
 *   {
 *     _license: "Public IIHS award list — attributed per record",
 *     _source: "https://www.iihs.org/ratings/top-safety-picks",
 *     _generated_at: "...",
 *     _years: [2020, ..., 2026],
 *     _entry_count: N,
 *     entries: [
 *       { awardYear, award: "TSP"|"TSP+", make, model, modelYearLabel,
 *         vehicleSlug, sourceUrl }
 *     ]
 *   }
 *
 * CLI
 *   node scripts/iihs-tsp-fetch.mjs                    # all 2020..currentYear
 *   node scripts/iihs-tsp-fetch.mjs --year 2024        # single year
 *   node scripts/iihs-tsp-fetch.mjs --year 2024 --out /tmp/test.json
 *   node scripts/iihs-tsp-fetch.mjs --fixture          # fixture HTML only
 *
 * Runs annually via .github/workflows/iihs-tsp-annual.yml in March
 * (IIHS releases new award lists each spring; lists also get retroactive
 * tier changes through the year as headlight evaluations finish).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/iihs-tsp");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/iihs-tsp");

const BASE_URL = "https://www.iihs.org";
const LIST_PATH = "/ratings/top-safety-picks";
const UA = "TruNorth-IIHS/1.0 (+https://www.trunorthapp.com; data pipeline for vehicle-safety transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES = 3;

const argv = process.argv.slice(2);
const FIXTURE_MODE = argv.includes("--fixture");
const yearIdx = argv.indexOf("--year");
const ONLY_YEAR = yearIdx >= 0 ? Number(argv[yearIdx + 1]) : null;
const outIdx = argv.indexOf("--out");
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── fetch ────────────────────────────────────────────────────────────────
async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  ${res.status} for ${url} — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const backoff = REQ_DELAY_MS * Math.pow(2, attempt);
      console.warn(`  fetch error "${err.message}" — retrying in ${backoff}ms (${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

// ─── parsing helpers (exported for tests) ─────────────────────────────────

/**
 * Convert IIHS's URL `make` slug ("mercedes-benz", "land-rover", "honda")
 * into a display-friendly brand name ("Mercedes-Benz", "Land Rover",
 * "Honda"). Keeps hyphenated brands like "Mercedes-Benz" and "Rolls-Royce"
 * hyphenated; word-cases the rest. This is the human-readable name; the
 * raw slug is preserved separately for downstream slug-matching.
 */
export function makeNameFromSlug(slug) {
  if (!slug) return "";
  const HYPHENATED = new Set([
    "mercedes-benz", "rolls-royce", "alfa-romeo",
  ]);
  if (HYPHENATED.has(slug.toLowerCase())) {
    return slug.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join("-");
  }
  // Otherwise treat as space-separated
  const ACRONYMS = new Set(["bmw", "gmc", "mg"]);
  if (ACRONYMS.has(slug.toLowerCase())) return slug.toUpperCase();
  return slug.split("-").map(p => {
    if (ACRONYMS.has(p)) return p.toUpperCase();
    return p[0].toUpperCase() + p.slice(1);
  }).join(" ");
}

/**
 * Pull the year-label, model name etc. out of a card label string like:
 *   "2024-25 Acura Integra 4-door hatchback"
 *   "2025 Honda Civic 4-door sedan"
 * Returns { modelYearLabel, modelDescriptor } — modelDescriptor is the
 * rest of the line after the leading year token. (We already know make
 * and model from the URL, so this is just for display.)
 */
export function parseModelLabel(raw) {
  if (!raw) return { modelYearLabel: null, modelDescriptor: "" };
  const s = String(raw).replace(/\s+/g, " ").trim();
  // Leading year or year-range: "2024" or "2024-25"
  const m = s.match(/^(\d{4}(?:-\d{2,4})?)\s+(.+)$/);
  if (m) return { modelYearLabel: m[1], modelDescriptor: m[2].trim() };
  return { modelYearLabel: null, modelDescriptor: s };
}

/**
 * Parse a TSP listing page HTML into entries.
 * sourceYear is the award year (the year being viewed). It's used as
 * a fallback when a card has no leading year-label.
 */
export function parseListingHtml(html, sourceYear) {
  const $ = cheerio.load(html);
  const entries = [];

  $("a.card").each((_, el) => {
    const $a = $(el);
    const href = ($a.attr("href") || "").trim();
    if (!href.includes("/ratings/vehicle/")) return;

    // Award level lives on the inner <tsp-photo tsp-award-level="...">
    const awardLevel = ($a.find("tsp-photo").attr("tsp-award-level") || "").trim();
    let award = null;
    if (/tspPlus/i.test(awardLevel)) award = "TSP+";
    else if (/tsp/i.test(awardLevel)) award = "TSP";

    // Fall back to inspecting the banner class if the inner tag is missing
    if (!award) {
      const bannerClass = ($a.find("p.category").attr("class") || "");
      if (/tspPlusBanner/i.test(bannerClass)) award = "TSP+";
      else if (/tspBanner/i.test(bannerClass)) award = "TSP";
    }
    if (!award) return; // can't classify — skip

    // URL: /ratings/vehicle/<make>/<model>/<year>
    const urlMatch = href.match(/\/ratings\/vehicle\/([^/]+)\/([^/]+)\/(\d{4})/);
    if (!urlMatch) return;
    const [, makeSlug, modelSlug, urlYear] = urlMatch;

    // Card label (the second <p> inside .card-content)
    let labelText = "";
    const $contentPs = $a.find(".card-content p");
    if ($contentPs.length >= 2) labelText = $contentPs.eq(1).text().trim();
    else labelText = $a.find(".card-content").text().trim();
    const { modelYearLabel, modelDescriptor } = parseModelLabel(labelText);

    const sourceUrl = href.startsWith("http") ? href : BASE_URL + href;

    entries.push({
      awardYear:       sourceYear,
      award,                                  // "TSP" | "TSP+"
      make:            makeNameFromSlug(makeSlug),
      makeSlug,                               // raw URL slug (lowercase, hyphenated)
      model:           modelDescriptor || modelSlug,
      modelSlug,
      modelYearLabel:  modelYearLabel || String(urlYear),
      vehicleSlug:     `${makeSlug}/${modelSlug}/${urlYear}`,
      sourceUrl,
    });
  });

  return entries;
}

// ─── fetch one year ───────────────────────────────────────────────────────
async function fetchYear(year) {
  if (FIXTURE_MODE) {
    const html = await fs.readFile(path.join(FIXTURE_DIR, "sample-2024.html"), "utf-8");
    return parseListingHtml(html, year);
  }
  const url = `${BASE_URL}${LIST_PATH}/${year}`;
  console.log(`  GET ${url}`);
  const html = await fetchHtml(url);
  return parseListingHtml(html, year);
}

// ─── main runner ──────────────────────────────────────────────────────────
async function main() {
  console.log(`IIHS Top Safety Pick / TSP+ fetcher${FIXTURE_MODE ? " (FIXTURE MODE)" : ""}`);

  const currentYear = new Date().getUTCFullYear();
  const years = FIXTURE_MODE
    ? [2024]
    : (ONLY_YEAR ? [ONLY_YEAR] : Array.from({ length: currentYear - 2020 + 1 }, (_, i) => 2020 + i));

  console.log(`Years to fetch: ${years.join(", ")}`);

  const allEntries = [];
  for (let i = 0; i < years.length; i++) {
    const yr = years[i];
    try {
      const yearEntries = await fetchYear(yr);
      const plus = yearEntries.filter(e => e.award === "TSP+").length;
      const plain = yearEntries.filter(e => e.award === "TSP").length;
      console.log(`  ${yr}: ${yearEntries.length} winners (TSP+ ${plus}, TSP ${plain})`);
      allEntries.push(...yearEntries);
    } catch (err) {
      console.error(`  ${yr}: FAILED — ${err.message}`);
    }
    if (i < years.length - 1 && !FIXTURE_MODE) await sleep(REQ_DELAY_MS);
  }

  const output = {
    _license: "Public IIHS award list — attributed per record",
    _source: `${BASE_URL}${LIST_PATH}`,
    _generated_at: new Date().toISOString(),
    _years: years,
    _entry_count: allEntries.length,
    entries: allEntries,
  };

  // Decide output path
  let outPath;
  if (OUT_OVERRIDE) {
    outPath = OUT_OVERRIDE;
  } else {
    await fs.mkdir(RAW_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    outPath = path.join(RAW_DIR, `${today}.json`);
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log(`\nWrote ${outPath}`);
  console.log(`  ${allEntries.length} award entries across ${years.length} year${years.length === 1 ? "" : "s"}`);

  // Quick summary by make
  const byMake = new Map();
  for (const e of allEntries) {
    const k = e.makeSlug;
    if (!byMake.has(k)) byMake.set(k, { total: 0, plus: 0 });
    const m = byMake.get(k);
    m.total++;
    if (e.award === "TSP+") m.plus++;
  }
  const topMakes = [...byMake.entries()]
    .sort((a, b) => b[1].plus - a[1].plus || b[1].total - a[1].total)
    .slice(0, 10);
  if (topMakes.length > 0) {
    console.log(`\nTop makes by TSP+ count:`);
    for (const [slug, m] of topMakes) {
      console.log(`  ${String(m.plus).padStart(4)} TSP+  ${String(m.total - m.plus).padStart(3)} TSP   ${slug}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("iihs-tsp-fetch failed:", err);
    process.exit(1);
  });
}
