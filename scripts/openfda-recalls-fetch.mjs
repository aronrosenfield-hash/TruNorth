#!/usr/bin/env node
/**
 * openFDA Enforcement / Recall reports → TruNorth slug augment.
 *
 * openFDA publishes the FDA's recall-enforcement reports as a public-domain
 * (CC0) JSON API with NO authentication required. Three product centers:
 *
 *   - https://api.fda.gov/food/enforcement.json    (~29k records)
 *   - https://api.fda.gov/drug/enforcement.json    (~18k)
 *   - https://api.fda.gov/device/enforcement.json  (~39k)
 *
 * Each record carries: recalling_firm, classification ("Class I/II/III"),
 * reason_for_recall, report_date (YYYYMMDD), status, product_description.
 * Class I = most serious (reasonable probability of serious harm/death),
 * Class III = least serious.
 *
 * This complements the existing food-only USDA-FSIS feed (meat/poultry/egg)
 * and the manufacturer-level openFDA aggregates in health-signals-fetch.mjs.
 * Here we aggregate ALL three centers by `recalling_firm`, resolve each firm
 * to a TruNorth brand slug (reusing the ITEP name→slug matcher), and emit a
 * derived augment keyed by slug:
 *
 *   data/derived/openfda-recalls-augment.json
 *   {
 *     _license, sourceUrls, generatedAt, windowYears,
 *     matchCount, orphanCount, rawFirmCount,
 *     <slug>: {
 *       recallCount, classI, classII, classIII,
 *       mostRecent: { date, reason, classification, product },
 *       byCategory: { food, drug, device },
 *       lastUpdated
 *     }
 *   }
 *
 * Strategy — bounded, polite pull:
 *   We page the RAW records (not the count API) for a recent date window so
 *   we can compute the per-class breakdown AND the most-recent recall in a
 *   single client-side pass. `limit=1000` (the API max) with `skip` paging
 *   keeps this to ~tens of requests across all three centers — well inside
 *   the unauthenticated 240/min & 1,000/day budgets. A small inter-request
 *   delay keeps us under the per-minute cap. An OPENFDA_API_KEY (free) is
 *   used automatically if present, but is not required.
 *
 * Matching: ITEP's buildIndexLookup + matchCompanyToIndex + nameVariants
 * against public/data/index.json, with a brand-parent-map.json fallback.
 *
 * Flags:
 *   --apply          write data/derived/openfda-recalls-augment.json
 *   --dry            (default) print summary only
 *   --years N        date window in years (default 6)
 *   --max-pages N    safety cap on pages PER center (default 60 = 60k recs)
 *   --centers a,b    subset of {food,drug,device} (default all three)
 *
 * Writes ONLY the derived augment. Never touches public/data/companies/*.
 * Locally:
 *   node scripts/openfda-recalls-fetch.mjs            # dry summary
 *   node scripts/openfda-recalls-fetch.mjs --apply
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildIndexLookup,
  matchCompanyToIndex,
  matchViaParentMap,
} from "./itep-tax-merge.mjs";
import { normalizeCompanyName } from "./itep-tax-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE = path.join(DERIVED_DIR, "openfda-recalls-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const PARENT_MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const UA = "TruNorth-openFDA/1.0 (+https://www.trunorthapp.com)";
const API_KEY = process.env.OPENFDA_API_KEY || "";
const LICENSE_TAG = "openFDA enforcement reports (U.S. FDA, public domain / CC0)";
const LANDING = "https://open.fda.gov/apis/";

const ENDPOINTS = {
  food: "https://api.fda.gov/food/enforcement.json",
  drug: "https://api.fda.gov/drug/enforcement.json",
  device: "https://api.fda.gov/device/enforcement.json",
};

const PAGE_LIMIT = 1000; // API hard max per request
const REQ_DELAY_MS = 350; // polite spacing (~170 req/min < 240 cap)

// ─────────────────────────── CLI ────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
function flagArg(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
}
const WINDOW_YEARS = Math.max(1, Number(flagArg("--years", "6")) || 6);
const MAX_PAGES = Math.max(1, Number(flagArg("--max-pages", "60")) || 60);
const CENTERS = String(flagArg("--centers", "food,drug,device"))
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((c) => ENDPOINTS[c]);

// ─────────────────────────── helpers ────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function yyyymmdd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** "20240131" → "2024-01-31" (or "" if unparseable). */
function isoDate(yyyymmddStr) {
  const s = String(yyyymmddStr || "").trim();
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Class I/II/III → "classI"|"classII"|"classIII"| null. */
function classKey(classification) {
  const c = String(classification || "").toLowerCase();
  if (c.includes("class iii")) return "classIII";
  if (c.includes("class ii")) return "classII";
  if (c.includes("class i")) return "classI";
  return null;
}

/**
 * Precision guard for direct (name-index) matches.
 *
 * The shared ITEP matcher's nameVariants() includes a bare first-word
 * fallback ("American Health Packaging" → "american"). That's safe for
 * ITEP's curated ~340-company list but, against ~4.5k arbitrary FDA firm
 * names, it collapses unrelated firms onto generic single-word brand slugs.
 *
 * Rules:
 *   1. The brand's normalized tokens must be a *leading* run of the firm's
 *      normalized tokens (firmTokens startsWith brandTokens). This already
 *      rejects "Mid America Bank" → america (brand isn't the lead).
 *   2. Exact (post-normalization) equality is always accepted.
 *   3. Multi-word brand names ("Boston Scientific", "General Mills") are
 *      inherently specific → accept any firm beginning with them.
 *   4. A single-word brand name is accepted on a *prefix* (non-exact) match
 *      ONLY if the word is distinctive — i.e. NOT on AMBIGUOUS_SINGLE_WORD.
 *      "Cargill Cocoa", "Medtronic Perfusion Systems", "Pfizer Inc" pass
 *      (distinctive). "American Laboratories", "Global Vitality",
 *      "Queen Bee Gardens", "HP Hood" are rejected (the lone word is a
 *      common adjective / unrelated to the TruNorth brand of that name).
 *
 * The denylist is deliberately small and conservative — it only needs to
 * cover single-word brand slugs that exist in the index AND are common
 * enough to be the incidental lead of an unrelated firm. Exact-name firms
 * still match even when listed (rule 2), so e.g. a literal "Global, Inc."
 * would still resolve; only spurious trailing-word firms are dropped.
 */
const AMBIGUOUS_SINGLE_WORD = new Set([
  "american",
  "global",
  "international",
  "sun",
  "queen",
  "harvard",
  "hp",
  "go", // "Go!" brand vs "Salad and Go", "G.O. Corporation"
  "walker",
  "national",
  "premier",
  "general",
  "united",
  "pacific",
  "atlantic",
  "central",
  "eagle",
  "summit",
  "pioneer",
  "liberty",
  "majestic",
  "imperial",
  "royal",
  "crown",
  "star",
  "sterling",
  "apex",
  "vital",
  "fresh",
  "pure",
  "natural",
  "organic",
  "prime",
]);

function confidentDirectMatch(firmName, brandName) {
  const fTok = normalizeCompanyName(firmName).split(" ").filter(Boolean);
  const bTok = normalizeCompanyName(brandName).split(" ").filter(Boolean);
  if (!fTok.length || !bTok.length) return false;
  // Rule 1: brand tokens must be a leading run of the firm tokens.
  if (fTok.length < bTok.length) return false;
  for (let i = 0; i < bTok.length; i++) {
    if (fTok[i] !== bTok[i]) return false;
  }
  // Rule 2: exact equality is always fine.
  if (fTok.length === bTok.length) return true;
  // Rule 4: single-word brand, non-exact prefix → require distinctiveness.
  if (bTok.length === 1) {
    return !AMBIGUOUS_SINGLE_WORD.has(bTok[0]);
  }
  // Rule 3: multi-word brand name already specific → accept the prefix.
  return true;
}

/**
 * Page raw enforcement records for one center within the date window.
 * Returns an array of {recalling_firm, classification, report_date,
 * reason_for_recall, product_description, status}. Guards against empty
 * downloads (throws if a non-404 request yields nothing on page 0).
 */
async function fetchCenter(center, sinceYYYYMMDD, untilYYYYMMDD) {
  const base = ENDPOINTS[center];
  const search = `report_date:[${sinceYYYYMMDD}+TO+${untilYYYYMMDD}]`;
  const records = [];
  let skip = 0;
  let total = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    // Build manually so the date-range brackets/plus aren't double-encoded.
    const keyPart = API_KEY ? `api_key=${encodeURIComponent(API_KEY)}&` : "";
    const url = `${base}?${keyPart}search=${search}&limit=${PAGE_LIMIT}&skip=${skip}`;
    void params;

    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
    } catch (err) {
      throw new Error(`[${center}] network error on page ${page}: ${err.message}`);
    }

    // openFDA returns 404 with {error:{code:"NOT_FOUND"}} when skip runs
    // past the result set — that's the normal "no more pages" terminator.
    if (res.status === 404) {
      if (page === 0) {
        console.warn(`  [${center}] 404 on first page (no records in window).`);
      }
      break;
    }
    if (res.status === 429) {
      throw new Error(`[${center}] rate-limited (HTTP 429) on page ${page}; back off / add OPENFDA_API_KEY.`);
    }
    if (!res.ok) {
      throw new Error(`[${center}] HTTP ${res.status} on page ${page}`);
    }

    let body;
    try {
      body = await res.json();
    } catch (err) {
      throw new Error(`[${center}] bad JSON on page ${page}: ${err.message}`);
    }

    const batch = Array.isArray(body.results) ? body.results : [];
    if (total == null) total = body.meta?.results?.total ?? null;

    // Guard against silent empty downloads on the first page.
    if (page === 0 && batch.length === 0) {
      if (total && total > 0) {
        throw new Error(`[${center}] empty first page despite total=${total} — aborting.`);
      }
      console.warn(`  [${center}] no records in window ${sinceYYYYMMDD}..${untilYYYYMMDD}.`);
      break;
    }

    for (const r of batch) {
      records.push({
        recalling_firm: r.recalling_firm || "",
        classification: r.classification || "",
        report_date: r.report_date || "",
        reason_for_recall: r.reason_for_recall || "",
        product_description: r.product_description || "",
        status: r.status || "",
      });
    }

    skip += batch.length;
    if (batch.length < PAGE_LIMIT) break; // last page
    if (total != null && skip >= total) break;
    await sleep(REQ_DELAY_MS);
  }

  return { records, total };
}

/**
 * Fold raw records (from all centers, each tagged with its center) into a
 * per-firm aggregate keyed by the raw recalling_firm string.
 */
function aggregateByFirm(tagged) {
  const byFirm = new Map();
  for (const { center, rec } of tagged) {
    const firm = (rec.recalling_firm || "").trim();
    if (!firm) continue;
    let agg = byFirm.get(firm);
    if (!agg) {
      agg = {
        firm,
        recallCount: 0,
        classI: 0,
        classII: 0,
        classIII: 0,
        byCategory: { food: 0, drug: 0, device: 0 },
        _mostRecent: null, // {dateNum, date, reason, classification, product}
      };
      byFirm.set(firm, agg);
    }
    agg.recallCount++;
    const ck = classKey(rec.classification);
    if (ck) agg[ck]++;
    if (agg.byCategory[center] != null) agg.byCategory[center]++;

    const dateNum = /^\d{8}$/.test(rec.report_date) ? Number(rec.report_date) : 0;
    if (!agg._mostRecent || dateNum > agg._mostRecent.dateNum) {
      agg._mostRecent = {
        dateNum,
        date: isoDate(rec.report_date),
        reason: rec.reason_for_recall || "",
        classification: rec.classification || "",
        product: rec.product_description || "",
      };
    }
  }
  return byFirm;
}

/** Trim long free-text fields so the augment stays compact. */
function trim(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ─────────────────────────── main ───────────────────────────────────
async function main() {
  console.log(
    `openFDA recalls fetcher starting... (mode=${DRY ? "DRY" : "APPLY"}, window=${WINDOW_YEARS}y, centers=${CENTERS.join(",")}, api_key=${API_KEY ? "yes" : "no"})`,
  );

  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear() - WINDOW_YEARS, now.getUTCMonth(), now.getUTCDate()));
  const sinceStr = yyyymmdd(since);
  const untilStr = yyyymmdd(now);
  console.log(`Date window: ${sinceStr} .. ${untilStr}`);

  // 1) Pull each center.
  const tagged = [];
  const centerTotals = {};
  for (const center of CENTERS) {
    console.log(`\nFetching ${center} enforcement reports...`);
    const { records, total } = await fetchCenter(center, sinceStr, untilStr);
    centerTotals[center] = { fetched: records.length, totalInWindow: total };
    console.log(`  ${center}: pulled ${records.length.toLocaleString()} records (window total reported: ${total ?? "?"})`);
    for (const rec of records) tagged.push({ center, rec });
  }

  if (!tagged.length) {
    throw new Error("No records pulled from any center — refusing to write an empty augment.");
  }

  // 2) Aggregate by raw firm name.
  const byFirm = aggregateByFirm(tagged);
  console.log(`\nDistinct recalling firms: ${byFirm.size.toLocaleString()}`);

  // 3) Resolve firms → slugs.
  const index = await loadJson(INDEX_FILE, []);
  const parentMap = await loadJson(PARENT_MAP_FILE, {});
  const byName = buildIndexLookup(index);
  const slugToName = new Map(index.map((e) => [e.slug, e.name]));
  console.log(`Loaded index (${index.length} brands) + parent-map (${Object.keys(parentMap).length} entries).`);

  // A firm string can resolve to a slug already claimed by another firm
  // (e.g. "Pfizer Inc." and "Pfizer Consumer Healthcare" → pfizer); merge.
  const bySlug = new Map();
  let direct = 0;
  let parent = 0;
  let orphan = 0;
  let rejected = 0;
  const orphanSamples = [];
  const rejectedSamples = [];

  for (const agg of byFirm.values()) {
    let slug = matchCompanyToIndex(agg.firm, byName);
    let route = "direct";
    // Precision guard: re-verify direct name matches (parent-map hits are
    // curated and trusted). Drops generic single-word collisions like
    // "American Outdoor Products" → american.
    if (slug && !confidentDirectMatch(agg.firm, slugToName.get(slug) || "")) {
      if (rejectedSamples.length < 20) {
        rejectedSamples.push(`${agg.firm} ✗→${slug} (${agg.recallCount})`);
      }
      slug = null;
    }
    if (!slug) {
      slug = matchViaParentMap(agg.firm, parentMap);
      if (slug) route = "parent";
    }
    if (!slug) {
      // Distinguish a guard-rejection from a true orphan for reporting.
      if (matchCompanyToIndex(agg.firm, byName)) rejected++;
      else orphan++;
      if (orphanSamples.length < 20) orphanSamples.push(`${agg.firm} (${agg.recallCount})`);
      continue;
    }
    if (route === "direct") direct++;
    else parent++;

    let merged = bySlug.get(slug);
    if (!merged) {
      merged = {
        recallCount: 0,
        classI: 0,
        classII: 0,
        classIII: 0,
        byCategory: { food: 0, drug: 0, device: 0 },
        _mostRecent: null,
        _firms: [],
      };
      bySlug.set(slug, merged);
    }
    merged.recallCount += agg.recallCount;
    merged.classI += agg.classI;
    merged.classII += agg.classII;
    merged.classIII += agg.classIII;
    merged.byCategory.food += agg.byCategory.food;
    merged.byCategory.drug += agg.byCategory.drug;
    merged.byCategory.device += agg.byCategory.device;
    merged._firms.push(agg.firm);
    if (agg._mostRecent && (!merged._mostRecent || agg._mostRecent.dateNum > merged._mostRecent.dateNum)) {
      merged._mostRecent = agg._mostRecent;
    }
  }

  console.log("\nResolution:");
  console.log(`  Direct name matches:   ${direct}`);
  console.log(`  Parent-map matches:    ${parent}`);
  console.log(`  Guard-rejected (loose): ${rejected}`);
  console.log(`  Orphan firms (no slug): ${orphan}`);
  console.log(`  Distinct matched slugs: ${bySlug.size}`);
  if (rejectedSamples.length) {
    console.log(`  Rejected examples: ${rejectedSamples.slice(0, 6).join(" | ")}`);
  }

  // 4) Shape the augment.
  const generatedAt = now.toISOString();
  const out = {
    _license: LICENSE_TAG,
    landingUrl: LANDING,
    sourceUrls: CENTERS.map((c) => ENDPOINTS[c]),
    windowYears: WINDOW_YEARS,
    windowFrom: isoDate(sinceStr),
    windowTo: isoDate(untilStr),
    generatedAt,
    matchCount: bySlug.size,
    orphanCount: orphan,
    rawFirmCount: byFirm.size,
    centerTotals,
  };

  for (const [slug, m] of bySlug.entries()) {
    out[slug] = {
      recallCount: m.recallCount,
      classI: m.classI,
      classII: m.classII,
      classIII: m.classIII,
      mostRecent: m._mostRecent
        ? {
            date: m._mostRecent.date,
            reason: trim(m._mostRecent.reason, 240),
            classification: m._mostRecent.classification,
            product: trim(m._mostRecent.product, 180),
          }
        : null,
      byCategory: m.byCategory,
      lastUpdated: generatedAt,
    };
  }

  // 5) Highlights — most recalls.
  const ranked = [...bySlug.entries()]
    .map(([slug, m]) => ({ slug, ...m }))
    .sort((a, b) => b.recallCount - a.recallCount || b.classI - a.classI)
    .slice(0, 12);
  if (ranked.length) {
    console.log("\n  Top-12 by recall count (count | I/II/III | food/drug/device):");
    for (const r of ranked) {
      const cat = `${r.byCategory.food}/${r.byCategory.drug}/${r.byCategory.device}`;
      console.log(
        `    ${String(r.recallCount).padStart(4)}  ${`${r.classI}/${r.classII}/${r.classIII}`.padStart(10)}  ${cat.padStart(10)}  ${r.slug}`,
      );
    }
  }
  if (orphanSamples.length) {
    console.log(`\n  First orphan firms (count): ${orphanSamples.slice(0, 8).join(" | ")}`);
  }

  // 6) Write (only the derived augment).
  if (APPLY) {
    await fs.mkdir(DERIVED_DIR, { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2));
    console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${bySlug.size} slugs).`);
    console.log("  (Derived augment only — public/data/companies/* untouched.)");
  } else {
    console.log(`\nDRY — re-run with --apply to write ${path.relative(ROOT, OUT_FILE)}.`);
  }

  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("openfda-recalls-fetch failed:", err.message || err);
    process.exit(1);
  });
}

export { aggregateByFirm, classKey, isoDate, fetchCenter, main };
