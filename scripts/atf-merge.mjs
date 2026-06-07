#!/usr/bin/env node
/**
 * ATF — FFL (Federal Firearms Licensee) merge — B-37 entity-resolution rewrite.
 *
 * BACKGROUND
 * ----------
 * The previous version of this script did name-only fuzzy substring
 * matching between the ATF's Federal Firearms Licensee list and
 * TruNorth's 11k+ company catalog. That generated ~85 false positives
 * (Uber tagged as a gun manufacturer, AMD as manufacturer, Safeway as
 * dealer, French's mustard as pawnbroker, etc.) — a libel-adjacent
 * pre-launch risk. Two emergency scrub passes shipped on 2026-06-05/06
 * (see scripts/scrub-bogus-firearms-ffl.mjs). This rewrite is the
 * systemic fix.
 *
 * ENTITY-RESOLUTION STRATEGY
 * --------------------------
 * Tiered match — each candidate FFL row goes through these gates in
 * order, and only attaches to a TruNorth company file if it passes
 * gate 1 OR gate 2. Anything that looks like a possible match but
 * fails both lands in a manual review queue.
 *
 *   GATE 1 — ALLOW-LIST (curated)
 *     scripts/atf-allowlist.json hand-curates brands that legitimately
 *     hold FFLs (Walmart, Bass Pro, Sturm Ruger, Lockheed, BAE, etc.) with
 *     explicit `match_terms`. An FFL row passes this gate if its business
 *     name contains any of the match_terms as a whole-word match.
 *
 *   GATE 2 — STRICT EVIDENCE CHAIN (for non-allow-listed brands)
 *     a) Company must have a CIK OR ticker (i.e. be a real public entity
 *        we can corroborate via SEC EDGAR), AND
 *     b) Company category must be one of {Defense & Aerospace,
 *        Manufacturing, Retail, Outdoor, Sports & Fitness}, AND
 *     c) Company category must NOT be in the industry blocklist
 *        (Tech / Finance / Healthcare / Apparel / Food / etc.), AND
 *     d) FFL business name must contain the company's full normalized
 *        name as a contiguous whole-word phrase (NOT just a token-subset
 *        match — "AMD" doesn't match "AMD JONES GUN SHOP" the way the
 *        old matcher did), AND
 *     e) The FFL row's SIC/NAICS code (or the company's own SIC code)
 *        must be one of the firearms-industry codes (332994 firearms
 *        mfg, 423920 sporting-goods wholesale, 451110 sporting-goods
 *        retail, etc.).
 *
 *   FALLTHROUGH — REVIEW QUEUE
 *     Anything that gets a plausible name match but fails the gates
 *     gets logged to public/data/_meta/atf-review-queue.json. A human
 *     reviews periodically; passes become allow-list additions.
 *
 *   HARD BLOCKLIST
 *     Companies whose category is in INDUSTRY_BLOCKLIST are NEVER
 *     attached, even if they have a credible-looking name match.
 *     A consumer-staples brand whose name happens to collide with
 *     a small gun shop is not getting an FFL flag from this pipeline.
 *
 * INPUT
 *   public/data/atf-ffl.json   — produced by an upstream fetcher
 *     {
 *       generated_at: "...",
 *       source_url:   "https://www.atf.gov/firearms/listing-federal-firearms-licensees",
 *       source_month: "YYYY-MM",
 *       licensees: [
 *         { business_name, license_type, state, expiration, sic_code? }, ...
 *       ]
 *     }
 *
 * OUTPUT
 *   per-company JSON files get
 *     firearms_atf_ffl: {
 *       fflTypes:      ["07", ...],
 *       fflTypeNames:  ["Manufacturer of Firearms Other Than Destructive Devices"],
 *       licenseCount:  N,
 *       states:        ["TX", "CA", ...],
 *       primaryRole:   "manufacturer" | "dealer" | ...,
 *       sourceMonth:   "YYYY-MM",
 *       sourceUrl:     "...",
 *       matchBasis:    "allowlist" | "evidence_chain",
 *       confidence:    0..1
 *     }
 *
 *   public/data/_meta/atf-merge-log.json
 *   public/data/_meta/atf-review-queue.json  — manual-review fall-through
 *
 * USAGE
 *   node scripts/atf-merge.mjs                # full run
 *   node scripts/atf-merge.mjs --dry          # no writes, just log + queue
 *   node scripts/atf-merge.mjs --input=path/to/ffl.json
 *
 * Per B-37, this script does not run from the cron until the FFL fetcher
 * is updated to publish public/data/atf-ffl.json in the documented
 * schema. See .github/workflows/atf-monthly.yml — currently paused.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT          = path.resolve(__dirname, "..");
const FFL_FILE      = path.join(ROOT, "public/data/atf-ffl.json");
const COMP_DIR      = path.join(ROOT, "public/data/companies");
const META_DIR      = path.join(ROOT, "public/data/_meta");
const ALLOWLIST     = path.join(__dirname, "atf-allowlist.json");
const LOG_FILE      = path.join(META_DIR, "atf-merge-log.json");
const REVIEW_QUEUE  = path.join(META_DIR, "atf-review-queue.json");

const DRY = process.argv.includes("--dry");
const INPUT_OVERRIDE = process.argv
  .find((a) => a.startsWith("--input="))?.slice("--input=".length);

// ─── policy: industries that NEVER hold FFLs ─────────────────────────────
//
// A name match against any company in these categories is a name
// collision with a small business that shares a token. Hard block.
const INDUSTRY_BLOCKLIST = new Set([
  "Technology",
  "Entertainment & Media",
  "Financial Services",
  "Healthcare",
  "Apparel & Fashion",
  "Professional Services",
  "Food & Beverage",
  "Beverage",
  "Telecommunications",
  "Transportation",
  "Hospitality",
  "Hospitality & Travel",
  "Real Estate",
  "Education",
  "Insurance",
  "Energy",
  "Automotive",
  "Travel",
  "Travel & Hospitality",
  "Grocery",
  "Consumer Goods",
  "Pet Care",
  "Beauty & Personal Care",
  "Furniture & Home",
  "Agriculture",
  "Utilities",
  "Utility",
  "Airline",
  "Chemicals & Materials",
  "Other",
  "na",
]);

// Categories where an FFL is plausible. Combined with evidence-chain
// gate (a)+(d)+(e) — see header comment.
const INDUSTRY_ALLOW_CATEGORIES = new Set([
  "Defense & Aerospace",
  "Manufacturing",
  "Retail",
  "Outdoor",
  "Sports & Fitness",
  "Aerospace",
]);

// Firearms-relevant NAICS/SIC codes. If the FFL row or company carries
// one of these we treat the SIC/NAICS check as passed.
const FIREARMS_NAICS = new Set([
  "332994", // Small Arms, Ordnance, and Ordnance Accessories Manufacturing
  "332992", // Small Arms Ammunition Manufacturing
  "332993", // Ammunition (except Small Arms) Manufacturing
  "423920", // Sporting and Recreational Goods and Supplies Merchant Wholesalers
  "451110", // Sporting Goods Stores (2017 NAICS)
  "459110", // Sporting Goods Stores (2022 NAICS)
  "3484",   // SIC: Small Arms
  "3482",   // SIC: Small Arms Ammunition
  "5941",   // SIC: Sporting Goods Stores
]);

// FFL license-type → human-readable + primaryRole mapping. See
// https://www.atf.gov/firearms/listing-federal-firearms-licensees
const FFL_TYPE_MAP = {
  "01": { name: "Dealer in Firearms Other Than Destructive Devices",  role: "dealer" },
  "02": { name: "Pawnbroker in Firearms Other Than Destructive Devices", role: "pawnbroker" },
  "03": { name: "Collector of Curios and Relics",                     role: "dealer" },
  "06": { name: "Manufacturer of Ammunition for Firearms",            role: "ammo_only" },
  "07": { name: "Manufacturer of Firearms Other Than Destructive Devices", role: "manufacturer" },
  "08": { name: "Importer of Firearms Other Than Destructive Devices", role: "importer" },
  "09": { name: "Dealer in Destructive Devices",                      role: "destructive_devices" },
  "10": { name: "Manufacturer of Destructive Devices",                role: "destructive_devices" },
  "11": { name: "Importer of Destructive Devices",                    role: "destructive_devices" },
};

// primaryRole precedence — when a company has multiple license types
// the most-restrictive role wins for display.
const ROLE_PRECEDENCE = [
  "destructive_devices", "manufacturer", "importer",
  "dealer", "pawnbroker", "ammo_only",
];

// ─── helpers ──────────────────────────────────────────────────────────────

function normalize(s) {
  return (s || "")
    .toString()
    .toUpperCase()
    .replace(/[&]/g, " AND ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-word containment: does normalized(haystack) contain normalized(needle) as a contiguous phrase bounded by word boundaries? */
function containsWholePhrase(haystack, needle) {
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n || !h) return false;
  const escaped = n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
  return re.test(h);
}

function pickPrimaryRole(roles) {
  for (const r of ROLE_PRECEDENCE) if (roles.has(r)) return r;
  return Array.from(roles)[0] || null;
}

async function safeReadJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

// ─── allow-list ───────────────────────────────────────────────────────────

function loadAllowlistFlat(allowlistRaw) {
  // Flatten the nested {retailers,manufacturers,defense} sections into
  // { slug → { rationale, expected_role, match_terms } }
  const out = new Map();
  for (const section of ["retailers", "manufacturers", "defense"]) {
    const block = allowlistRaw[section] || {};
    for (const [slug, meta] of Object.entries(block)) {
      out.set(slug, {
        rationale:      meta.rationale,
        expected_role:  meta.expected_role,
        match_terms:    (meta.match_terms || []).map((s) => normalize(s)),
        section,
      });
    }
  }
  const dropList = new Set(
    allowlistRaw._review_required_drop_list?.slugs || []
  );
  return { allow: out, dropList };
}

// ─── matching ─────────────────────────────────────────────────────────────

function fflRowToTypeInfo(row) {
  const t = String(row.license_type || row.lic_type || "").padStart(2, "0");
  const info = FFL_TYPE_MAP[t] || { name: `Type ${t}`, role: "dealer" };
  return { type: t, name: info.name, role: info.role };
}

/**
 * Allow-list match: does any allow-list match_term appear as a whole
 * phrase in the FFL row's business name?
 */
function findAllowMatch(row, allowMap) {
  const biz = row.business_name || row.licensee_name || row.license_name || "";
  for (const [slug, meta] of allowMap.entries()) {
    for (const term of meta.match_terms) {
      if (containsWholePhrase(biz, term)) {
        return { slug, basis: "allowlist", confidence: 0.95, meta };
      }
    }
  }
  return null;
}

/**
 * Strict evidence-chain match for a non-allow-listed FFL row.
 * Caller has pre-filtered companies to credible category + has-cik/ticker.
 */
function findEvidenceChainMatch(row, candidates) {
  const biz = row.business_name || row.licensee_name || row.license_name || "";
  const rowSic = String(row.sic_code || row.naics_code || "").trim();
  for (const co of candidates) {
    // (d) FFL business name contains the company name as a contiguous phrase.
    if (!containsWholePhrase(biz, co.name)) continue;
    // (e) NAICS/SIC must be a firearms-relevant code (row OR company).
    const coSic = String(co.sic || co.naics || "").trim();
    const naicsOk = FIREARMS_NAICS.has(rowSic) || FIREARMS_NAICS.has(coSic);
    if (!naicsOk) continue;
    return {
      slug:       co.slug,
      basis:      "evidence_chain",
      confidence: 0.75,
      meta:       null,
    };
  }
  return null;
}

// ─── company catalog ──────────────────────────────────────────────────────

async function loadCandidateCompanies() {
  // For evidence-chain matching we only care about companies whose
  // category is plausibly an FFL-holder AND who have a CIK / ticker
  // (i.e. a public-records corroboration). We load these once into
  // memory to avoid 11k file reads per FFL row.
  const files = await fs.readdir(COMP_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    let doc;
    try { doc = JSON.parse(await fs.readFile(path.join(COMP_DIR, f), "utf-8")); }
    catch { continue; }
    const slug = f.replace(/\.json$/, "");
    const cat  = doc.cat || "";
    if (INDUSTRY_BLOCKLIST.has(cat)) continue;
    if (!INDUSTRY_ALLOW_CATEGORIES.has(cat)) continue;
    const ticker = doc.ticker || doc?.wiki?.ticker;
    const cik    = doc.cik    || doc?.wiki?.cik;
    if (!ticker && !cik) continue;
    out.push({
      slug,
      name:   doc.name || slug,
      cat,
      ticker,
      cik,
      sic:    doc.sic   || doc?.wiki?.sic,
      naics:  doc.naics || doc?.wiki?.naics,
    });
  }
  return out;
}

// ─── aggregation ──────────────────────────────────────────────────────────

/**
 * Roll N matched FFL rows for one company into a single firearms_atf_ffl
 * field per the target schema.
 */
function aggregateMatches(matchedRows, sourceMonth, sourceUrl) {
  const types       = new Set();
  const typeNames   = new Set();
  const states      = new Set();
  const roles       = new Set();
  for (const r of matchedRows) {
    const info = fflRowToTypeInfo(r);
    types.add(info.type);
    typeNames.add(info.name);
    roles.add(info.role);
    if (r.state) states.add(String(r.state).toUpperCase());
  }
  return {
    fflTypes:      Array.from(types).sort(),
    fflTypeNames:  Array.from(typeNames).sort(),
    licenseCount:  matchedRows.length,
    states:        Array.from(states).sort(),
    primaryRole:   pickPrimaryRole(roles),
    sourceMonth,
    sourceUrl,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`ATF FFL merge (B-37) — started at ${startedAt}`);
  if (DRY) console.log("  (--dry: no files will be written)");

  const inputPath = INPUT_OVERRIDE
    ? path.resolve(ROOT, INPUT_OVERRIDE)
    : FFL_FILE;

  if (!existsSync(inputPath)) {
    console.error(`No FFL source file at ${inputPath}.`);
    console.error("Expected schema: { source_month, source_url, licensees: [...] }");
    console.error("This script intentionally does NOTHING when the source");
    console.error("is missing — the cron is paused (see B-37). Exiting.");
    process.exit(0);
  }

  const ffl = await safeReadJSON(inputPath, null);
  if (!ffl || !Array.isArray(ffl.licensees)) {
    console.error("FFL source is malformed (missing .licensees[]). Exiting.");
    process.exit(1);
  }
  const sourceMonth = ffl.source_month || "unknown";
  const sourceUrl   = ffl.source_url
    || "https://www.atf.gov/firearms/listing-federal-firearms-licensees";

  console.log(`  Loaded ${ffl.licensees.length} FFL rows (${sourceMonth})`);

  const allowlistRaw = await safeReadJSON(ALLOWLIST, null);
  if (!allowlistRaw) {
    console.error(`Allowlist not found at ${ALLOWLIST}. Exiting.`);
    process.exit(1);
  }
  const { allow, dropList } = loadAllowlistFlat(allowlistRaw);
  console.log(`  Loaded allow-list: ${allow.size} slugs, ${dropList.size} drop-list slugs`);

  const candidates = await loadCandidateCompanies();
  console.log(`  Loaded ${candidates.length} evidence-chain candidates (cat + CIK/ticker gated)`);

  // Match every FFL row.
  const perCompany = new Map();   // slug → { rows[], basis, confidence }
  const reviewQ    = [];           // unmatched but plausible

  let matchedAllow = 0;
  let matchedChain = 0;
  let blockedByCat = 0;
  let blockedByDrop = 0;

  for (const row of ffl.licensees) {
    // Gate 1 — allow-list.
    let hit = findAllowMatch(row, allow);

    // Gate 2 — evidence chain. Only attempted if allow-list missed.
    if (!hit) {
      hit = findEvidenceChainMatch(row, candidates);
      if (hit) matchedChain++;
    } else {
      matchedAllow++;
    }

    if (hit) {
      // Drop-list veto (never re-attach to slugs we explicitly removed).
      if (dropList.has(hit.slug)) {
        blockedByDrop++;
        reviewQ.push({
          status:      "blocked_by_droplist",
          reason:      `Slug ${hit.slug} is in atf-allowlist.json _review_required_drop_list`,
          row,
        });
        continue;
      }
      let bucket = perCompany.get(hit.slug);
      if (!bucket) {
        bucket = { rows: [], basis: hit.basis, confidence: hit.confidence };
        perCompany.set(hit.slug, bucket);
      }
      bucket.rows.push(row);
      continue;
    }

    // Neither gate matched. If the FFL business name happens to share
    // a token with a credible-category company in our catalog,
    // surface it to the review queue so a human can confirm/codify.
    if (looksLikePotentialMatch(row, candidates)) {
      reviewQ.push({
        status: "no_match",
        reason: "Name does not pass evidence chain",
        row,
      });
    }
  }

  // Roll up per-slug FFL aggregates and write to company files.
  const written = [];
  for (const [slug, bucket] of perCompany.entries()) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) {
      reviewQ.push({
        status: "slug_not_found",
        reason: `Allow-list slug ${slug} has no companion file in ${COMP_DIR}`,
        rows:   bucket.rows,
      });
      continue;
    }
    const agg = aggregateMatches(bucket.rows, sourceMonth, sourceUrl);
    agg.matchBasis = bucket.basis;
    agg.confidence = bucket.confidence;

    if (DRY) {
      written.push({ slug, ...agg, _dry: true });
      continue;
    }

    let doc;
    try { doc = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (e) {
      reviewQ.push({ status: "parse_error", slug, error: e.message });
      continue;
    }
    // Final guardrail: belt + suspenders — if the file's cat has
    // drifted into the blocklist since this run started, refuse.
    if (INDUSTRY_BLOCKLIST.has(doc.cat || "")) {
      blockedByCat++;
      reviewQ.push({
        status: "blocked_by_category",
        slug,
        reason: `Company category "${doc.cat}" is in INDUSTRY_BLOCKLIST`,
        rows:   bucket.rows,
      });
      continue;
    }
    doc.firearms_atf_ffl = agg;
    doc.dataLastUpdated = (typeof doc.dataLastUpdated === "object" && doc.dataLastUpdated)
      ? doc.dataLastUpdated
      : (doc.dataLastUpdated ? { legacy: doc.dataLastUpdated } : {});
    doc.dataLastUpdated.atf_ffl = startedAt;
    await fs.writeFile(file, JSON.stringify(doc, null, 2) + "\n");
    written.push({ slug, ...agg });
  }

  // Persist logs.
  await fs.mkdir(META_DIR, { recursive: true });
  if (!DRY) {
    await fs.writeFile(LOG_FILE, JSON.stringify({
      merged_at:           startedAt,
      source_month:        sourceMonth,
      source_url:          sourceUrl,
      input_rows:          ffl.licensees.length,
      matched_allowlist:   matchedAllow,
      matched_evidence:    matchedChain,
      blocked_by_category: blockedByCat,
      blocked_by_droplist: blockedByDrop,
      written_count:       written.length,
      review_queue_size:   reviewQ.length,
      written,
    }, null, 2));

    await fs.writeFile(REVIEW_QUEUE, JSON.stringify({
      generated_at: startedAt,
      source_month: sourceMonth,
      count:        reviewQ.length,
      entries:      reviewQ.slice(0, 5000),  // truncate; this can get long
    }, null, 2));
  }

  // Summary.
  console.log("");
  console.log("Summary:");
  console.log(`  FFL rows processed:       ${ffl.licensees.length}`);
  console.log(`  Allow-list matches:       ${matchedAllow}`);
  console.log(`  Evidence-chain matches:   ${matchedChain}`);
  console.log(`  Companies updated:        ${written.length}`);
  console.log(`  Blocked by category:      ${blockedByCat}`);
  console.log(`  Blocked by drop-list:     ${blockedByDrop}`);
  console.log(`  Review-queue entries:     ${reviewQ.length}`);
  if (!DRY) {
    console.log(`  Log:           ${path.relative(ROOT, LOG_FILE)}`);
    console.log(`  Review queue:  ${path.relative(ROOT, REVIEW_QUEUE)}`);
  }
}

/**
 * Cheap heuristic — does this row's business name share ANY token (len
 * >= 4) with a candidate company name? Used only to decide whether to
 * add the row to the review queue, not to attach data.
 */
const STOPWORDS = new Set([
  "THE", "AND", "INC", "LLC", "CORP", "CORPORATION", "COMPANY",
  "INTERNATIONAL", "GROUP", "HOLDINGS", "ENTERPRISES", "LIMITED",
  "PARTNERS", "ASSOCIATES", "SERVICES", "INDUSTRIES", "PRODUCTS",
  "SOLUTIONS", "BROTHERS", "FAMILY", "TRUST", "INVESTMENTS",
]);
function looksLikePotentialMatch(row, candidates) {
  const biz = normalize(row.business_name || row.licensee_name || row.license_name || "");
  const tokens = biz.split(" ").filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  if (!tokens.length) return false;
  const tokSet = new Set(tokens);
  for (const co of candidates) {
    const coTokens = normalize(co.name).split(" ")
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
    for (const t of coTokens) if (tokSet.has(t)) return true;
  }
  return false;
}

main().catch((err) => {
  console.error("atf-merge failed:", err);
  process.exit(1);
});
