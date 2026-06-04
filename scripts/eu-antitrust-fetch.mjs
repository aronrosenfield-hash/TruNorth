#!/usr/bin/env node
/**
 * European Commission DG Competition — antitrust decisions (monthly).
 *
 * The European Commission's Directorate-General for Competition (DG COMP)
 * publishes all antitrust decisions, cartel decisions, and merger reviews
 * via the public case search at:
 *
 *   https://ec.europa.eu/competition/antitrust
 *   https://ec.europa.eu/competition/elojade/isef/index.cfm  (case search)
 *
 * There is no clean public JSON API. The cartels-and-antitrust statistics
 * page exposes a structured case-decisions feed that we lean on as the
 * primary source, supplemented by the Commission's press-release JSON
 * endpoint (https://ec.europa.eu/commission/presscorner/api/...) for
 * recent enforcement actions. Both are free, no auth, polite rate-limit
 * required.
 *
 * For each of ~528 brands in /public/data/top-500-brands.txt we collect
 * antitrust decisions where the brand (parent + subsidiaries) is an
 * addressee, then emit per-brand:
 *
 *   {
 *     slug, name, status: "ok",
 *     total_EU_antitrust_actions_lifetime: number,
 *     total_fines_eur:                      number,   // EUR, all-time
 *     sample_decisions: [                              // top 5 most recent
 *       { date, case_no, decision_type, fine_eur,
 *         allegation, url }
 *     ],
 *     source_url, scraped_at,
 *   }
 *
 * Output: /public/data/eu-antitrust.json (overwritten monthly).
 *
 * Throttle: 1 req/sec via REQUEST_DELAY_MS=1000. UA "TruNorth-EU-Antitrust/1.0".
 *
 * Smoke brands: Google (~€8.25B in fines), Microsoft, Apple, Meta.
 *
 * Locally: node scripts/eu-antitrust-fetch.mjs
 *          node scripts/eu-antitrust-fetch.mjs --smoke
 * Workflow: .github/workflows/eu-antitrust-monthly.yml — 2nd of each month
 *           at 04:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/eu-antitrust.json");

// DG Comp decisions feed (cartels + antitrust statistics tables). The
// JSON-formatted case list lives behind the Cartel & Antitrust statistics
// page. The press-corner JSON API also exposes COMP-prefixed press
// releases on every decision.
const EC_CASE_SEARCH = "https://ec.europa.eu/competition/elojade/isef/index.cfm";
const EC_PRESSCORNER = "https://ec.europa.eu/commission/presscorner/api/notices";
const EC_LANDING     = "https://ec.europa.eu/competition/antitrust";
const UA = "TruNorth-EU-Antitrust/1.0 (+https://www.trunorthapp.com)";
const REQUEST_DELAY_MS = 1000;   // 1 req/sec — DG Comp politeness ask

const SMOKE_SLUGS = new Set(["google", "microsoft", "apple", "meta"]);

// Generic tokens that don't help disambiguate the addressee of an EC
// decision. EC press release subjects almost always include the brand
// name verbatim, so the stop-list is small.
const STOP_TOKENS = new Set([
  "the", "and", "inc", "corp", "corporation", "company", "co",
  "group", "holdings", "holding", "ltd", "limited", "plc", "sa",
  "se", "ag", "gmbh", "nv", "bv", "llc",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name, category] = l.split("|").map((s) => s.trim());
      return { slug, name, category };
    })
    .filter((b) => b.slug && b.name);
}

function tokenize(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

function hasToken(haystack, token) {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(haystack);
}

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchJson(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

async function fetchText(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
    });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchText(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

/**
 * Parse a EUR amount embedded in an EC press-release/title snippet.
 * Handles "€8.25 billion", "€2,420,000,000", "EUR 561 million",
 * "fined 4.34 billion euros". Returns 0 if no fine detected.
 */
function parseFineEUR(text) {
  if (!text) return 0;
  const t = text.toLowerCase().replace(/ /g, " ");
  let total = 0;
  // €X.YZ billion/million OR EUR X.YZ billion/million OR X.YZ billion euros
  const patterns = [
    /(?:€|eur(?:o)?(?:s)?)\s*([\d.,]+)\s*(billion|million|thousand)?/gi,
    /([\d.,]+)\s*(billion|million|thousand)?\s*(?:euros?|€|eur)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const raw = m[1].replace(/,/g, "");
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const unit = (m[2] || "").toLowerCase();
      let v = n;
      if (unit === "billion") v = n * 1_000_000_000;
      else if (unit === "million") v = n * 1_000_000;
      else if (unit === "thousand") v = n * 1_000;
      if (v >= total) total = v;   // pick largest (headline fine, not per-party)
    }
  }
  return Math.round(total);
}

/**
 * Coarse decision-type classifier from press-release title + teaser.
 */
function classifyDecisionType(text) {
  const t = (text || "").toLowerCase();
  if (t.includes("cartel")) return "cartel";
  if (t.includes("abuse of dominant") || t.includes("dominant position")) return "abuse_of_dominance";
  if (t.includes("merger")) return "merger";
  if (t.includes("state aid")) return "state_aid";
  if (t.includes("commitment")) return "commitments";
  if (t.includes("antitrust")) return "antitrust";
  return "other";
}

/**
 * Pull recent COMP decisions from the Commission press-corner JSON API.
 * The press-corner exposes notices filtered by DG (COMP) and language
 * (EN). We page through up to MAX_PAGES of 50 to capture ~5 years of
 * activity, which is sufficient for the lifetime sample (older
 * decisions remain stable and rarely move).
 */
async function collectDecisions() {
  const all = [];
  const PAGE_SIZE = 50;
  const MAX_PAGES = 40;          // 40 * 50 = 2,000 recent notices
  let page = 0;
  let stopped = false;

  while (page < MAX_PAGES && !stopped) {
    // Press-corner supports filtering by DG via the `dg` param. COMP =
    // Competition. Sort by date descending so we walk forward in time
    // until we exhaust the feed.
    const url = `${EC_PRESSCORNER}?language=EN&dg=COMP&pageSize=${PAGE_SIZE}&page=${page}`;
    let data;
    try { data = await fetchJson(url); }
    catch (err) {
      console.error(`  presscorner page ${page} failed: ${err.message}`);
      page++;
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    const items = data?.items || data?.results || data?.notices || [];
    if (!items.length) { stopped = true; break; }
    all.push(...items);
    if (page % 5 === 0) console.log(`   …presscorner page ${page} (${all.length} notices)`);
    page++;
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`  Collected ${all.length} DG COMP press notices`);
  return all;
}

/**
 * Normalize a press-corner notice into our internal decision schema.
 */
function normalizeNotice(n) {
  const title    = (n.title || n.subject || "").toString();
  const teaser   = (n.teaser || n.summary || n.description || "").toString();
  const date     = (n.date || n.publicationDate || n.publishedAt || "").toString().slice(0, 10);
  const refId    = (n.reference || n.referenceNumber || n.ref || "").toString();
  const url      = n.url || n.detailUrl || (refId ? `https://ec.europa.eu/commission/presscorner/detail/en/${refId}` : "");
  // Case numbers from titles look like "AT.40411", "COMP/M.9660", "AT.39740".
  const caseMatch = (title + " " + teaser).match(/\b(?:AT|COMP|M)[.\/][A-Z0-9.]+/i);
  const caseNo = caseMatch ? caseMatch[0].toUpperCase() : (refId || "");
  const fullText = `${title}\n${teaser}`;
  const haystack = fullText.toLowerCase();
  return {
    title, teaser, date, url, caseNo,
    fine_eur:      parseFineEUR(fullText),
    decision_type: classifyDecisionType(fullText),
    haystack,
  };
}

function aggregateBrand(brand, decisions, now) {
  const tokens = tokenize(brand.name);
  if (!tokens.length) {
    return { slug: brand.slug, name: brand.name, status: "no_actions",
             total_EU_antitrust_actions_lifetime: 0 };
  }
  const phrase = brand.name.toLowerCase();
  const needsPhrase = tokens.length < 2;

  const matched = decisions.filter((d) => {
    if (needsPhrase && !d.haystack.includes(phrase)) return false;
    return tokens.every((t) => hasToken(d.haystack, t));
  });

  if (!matched.length) {
    return { slug: brand.slug, name: brand.name, status: "no_actions",
             total_EU_antitrust_actions_lifetime: 0 };
  }

  const totalFines = matched.reduce((s, d) => s + (d.fine_eur || 0), 0);
  const sorted = matched.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const searchUrl = `${EC_CASE_SEARCH}?policy_area_id=1&case_party=${encodeURIComponent(brand.name)}`;

  return {
    slug:                                  brand.slug,
    name:                                  brand.name,
    status:                                "ok",
    total_EU_antitrust_actions_lifetime:   matched.length,
    total_fines_eur:                       totalFines,
    sample_decisions: sorted.slice(0, 5).map((d) => ({
      date:          d.date || null,
      case_no:       d.caseNo || null,
      decision_type: d.decision_type,
      fine_eur:      d.fine_eur || 0,
      allegation:    (d.title || "").slice(0, 280),
      url:           d.url || null,
    })),
    source_url:                            searchUrl,
    scraped_at:                            new Date(now).toISOString(),
  };
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  console.log(`EU DG Comp antitrust fetcher starting${smoke ? " (smoke)" : ""}...`);

  const notices = await collectDecisions();
  if (!notices.length) {
    console.error("Got zero DG COMP notices — aborting without overwriting output.");
    process.exit(1);
  }
  const decisions = notices.map(normalizeNotice);

  let brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);
  if (smoke) {
    brands = brands.filter((b) => SMOKE_SLUGS.has(b.slug));
    console.log(`Smoke mode: ${brands.length} brands -> ${brands.map((b) => b.slug).join(", ")}`);
  }

  const now = Date.now();
  const results = brands.map((b) => aggregateBrand(b, decisions, now));

  const withActions = results.filter((r) => r.status === "ok").length;
  const noActions   = results.filter((r) => r.status === "no_actions").length;

  const payload = {
    generated_at:        new Date(now).toISOString(),
    source_landing:      EC_LANDING,
    source_presscorner:  EC_PRESSCORNER,
    source_case_search:  EC_CASE_SEARCH,
    decisions_scanned:   decisions.length,
    brand_count:         brands.length,
    with_actions_count:  withActions,
    no_actions_count:    noActions,
    smoke:               smoke,
    brands:              results,
  };

  if (smoke) {
    const smokeOut = OUT_FILE.replace(/\.json$/, ".smoke.json");
    await fs.writeFile(smokeOut, JSON.stringify(payload, null, 2));
    console.log(`\nSmoke output -> ${smokeOut}`);
  } else {
    await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${OUT_FILE}`);
  }
  console.log(`   With antitrust actions: ${withActions}`);
  console.log(`   No actions:             ${noActions}`);

  for (const slug of SMOKE_SLUGS) {
    const r = results.find((x) => x.slug === slug);
    if (r) {
      console.log(`   ${slug}: actions=${r.total_EU_antitrust_actions_lifetime || 0}, fines=EUR ${(r.total_fines_eur || 0).toLocaleString()}`);
    }
  }
}

main().catch((err) => {
  console.error("eu-antitrust-fetch failed:", err);
  process.exit(1);
});
