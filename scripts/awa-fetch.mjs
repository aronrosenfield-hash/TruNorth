#!/usr/bin/env node
/**
 * A Greener World — Animal Welfare Approved (AWA) certified farms/brands.
 *
 *   https://agreenerworld.org/aw     (canonical landing)
 *   https://agreenerworld.org/programs/certified-animal-welfare-approved/
 *
 * AWA is the strictest higher-welfare certification for meat, dairy and
 * eggs in North America — pasture/range required, no feedlots, no growth
 * promoters, no debeaking, audited annually. The AGW directory lists
 * certified farms together with the product categories they cover
 * (beef, dairy, eggs, pork, poultry, lamb, etc.).
 *
 * NORMALISED OUTPUT
 *   data/raw/awa/<YYYY-MM-DD>.json
 *   {
 *     _license, _source, _generated_at,
 *     _stats: { total_farms, with_products },
 *     farms: [{
 *       brand,                          // farm or consumer brand name
 *       state?: string,
 *       country?: string,
 *       productCategories: string[],    // ["eggs","dairy"] etc., lower-case
 *       sourceUrl: string
 *     }]
 *   }
 *
 * STRATEGY (updated 2026-06 after AGW site redesign)
 *   The old program page (/programs/certified-animal-welfare-approved/) now
 *   301s to an unrelated audit-fee *product* page, so the legacy HTML scrape
 *   parses 0 farms. The directory moved to https://agreenerworld.org/directory/
 *   which is backed by the WordPress GeoDirectory plugin and exposes a public
 *   REST API:
 *
 *     GET /wp-json/geodir/v2/agw-listings?per_page=100&page=N
 *       -> [{ title, region, country, post_category[], certification_type, link }]
 *       -> X-WP-Total / X-WP-TotalPages response headers drive pagination
 *
 *   We walk the API (API-first), keep listings whose certification_type
 *   includes "Animal Welfare" (other values observed: "Certified Regenerative
 *   by AGW", "Grassfed", "Non-GMO"), and map post_category names (Beef,
 *   Dairy, Eggs, Pork, Lamb & Mutton, …) through normalizeCategories().
 *
 *   IMPORTANT — the directory is a WHERE-TO-BUY directory, not a pure
 *   certified-farm registry. store_type distinguishes producer-operated
 *   listings (Farm Stores, CSAs, Farm Stays & BnBs — the named entity IS the
 *   certified producer) from retail outlets that merely *carry* AWA products
 *   (Stores: Kroger/Whole Foods/Vons; Restaurants; Farmers Markets; Online
 *   Shopping: Amazon/Crowd Cow marketplaces). Outlets are EXCLUDED — flagging
 *   Kroger as "AWA certified" because one branch stocks AWA cheese would be
 *   factually wrong.
 *
 *   If the API disappears we fall back to the legacy HTML parse of
 *   SOURCE_URL (farm-card / awa-listing template variants) so the script
 *   degrades rather than dies.
 *
 * THROTTLE / POLITENESS
 *   - 1 req/sec between API pages
 *   - Honest UA identifying TruNorth
 *   - 5xx retry with exponential backoff (3 tries)
 *
 * STATUS SEMANTICS (snapshot _status)
 *   ok       fetch + parse succeeded, >0 farms
 *   empty    fetch SUCCEEDED but yielded 0 AWA farms (_empty_reason explains;
 *            _stats.listings_total proves the fetch actually returned data)
 *   blocked  fetch FAILED (HTTP 403/503/4xx/5xx or network error; see _note)
 *
 * FIXTURE MODE
 *   --fixture reads scripts/fixtures/awa/sample.html (legacy HTML parse).
 *
 * Locally:
 *   node scripts/awa-fetch.mjs              # live (CI only)
 *   node scripts/awa-fetch.mjs --fixture    # offline
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/awa");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/awa");

export const SOURCE_URL = "https://agreenerworld.org/directory/";
export const LEGACY_SOURCE_URL = "https://agreenerworld.org/programs/certified-animal-welfare-approved/";
export const LANDING_URL = "https://agreenerworld.org/aw";
export const API_URL = "https://agreenerworld.org/wp-json/geodir/v2/agw-listings";
const UA = "TruNorth-AWA/1.0 (+https://www.trunorthapp.com; data pipeline for animal-welfare certification transparency)";
const REQ_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const PER_PAGE = 100;
const MAX_PAGES = 50; // hard cap; directory is ~16 pages as of 2026-06

const FIXTURE_MODE = process.argv.includes("--fixture");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------------- fetch ---------------------------------- */

async function fetchHtml(url, attempt = 0) {
  if (FIXTURE_MODE) {
    const fx = path.join(FIXTURE_DIR, "sample.html");
    if (existsSync(fx)) return { ok: true, body: await fs.readFile(fx, "utf-8") };
    return { ok: true, body: "" };
  }
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 503) {
      return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    }
    if (!res.ok && attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    if (!res.ok) return { ok: false, body, blocker: `http_${res.status}`, status: res.status };
    return { ok: true, body, status: res.status };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    return { ok: false, body: "", blocker: `network:${err.message}` };
  }
}

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      redirect: "follow",
    });
    const body = await res.text();
    if (res.status === 403 || res.status === 503) {
      return { ok: false, blocker: `http_${res.status}`, status: res.status };
    }
    if (!res.ok && attempt < MAX_RETRIES && res.status >= 500) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) return { ok: false, blocker: `http_${res.status}`, status: res.status };
    try {
      return {
        ok: true,
        json: JSON.parse(body),
        totalPages: Number(res.headers.get("x-wp-totalpages")) || null,
        total: Number(res.headers.get("x-wp-total")) || null,
      };
    } catch {
      return { ok: false, blocker: "bad_json" };
    }
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(REQ_DELAY_MS * Math.pow(2, attempt));
      return fetchJson(url, attempt + 1);
    }
    return { ok: false, blocker: `network:${err.message}` };
  }
}

/** Walk every page of the GeoDirectory listings API. */
async function fetchAllListings() {
  const listings = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const res = await fetchJson(`${API_URL}?per_page=${PER_PAGE}&page=${page}`);
    if (!res.ok) {
      // Page 1 failure = API down/moved. Mid-walk failure = partial data; bail
      // with what we have rather than writing a silently truncated snapshot.
      if (page === 1) return { ok: false, blocker: res.blocker };
      return { ok: false, blocker: `${res.blocker} (page ${page}/${totalPages})`, partial: listings };
    }
    if (!Array.isArray(res.json)) return { ok: false, blocker: "unexpected_api_shape" };
    listings.push(...res.json);
    if (page === 1 && res.totalPages) totalPages = res.totalPages;
    console.log(`  [api page ${page}/${totalPages}] +${res.json.length} listings (running total ${listings.length})`);
    if (res.json.length === 0) break;
    if (page < totalPages) await sleep(REQ_DELAY_MS);
  }
  return { ok: true, listings };
}

/* ------------------------------- utils ---------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", trade: "™", reg: "®", copy: "©",
};

export function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED_ENTITIES[n] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

const VALID_CATEGORIES = new Set([
  "beef", "dairy", "eggs", "pork", "poultry", "chicken", "turkey",
  "lamb", "goat", "rabbit", "duck", "bison", "veal", "honey", "yogurt", "cheese",
]);

/** Normalise raw category tokens. "Chicken/Eggs" → ["chicken","eggs"]. */
export function normalizeCategories(raw) {
  if (!raw) return [];
  const tokens = String(raw)
    .toLowerCase()
    .split(/[,/&·•|]| and |\s{2,}/)
    .map(t => t.trim().replace(/[^a-z]/g, ""))
    .filter(Boolean);
  const out = [];
  for (const t of tokens) {
    if (VALID_CATEGORIES.has(t)) out.push(t);
    // common aliases
    else if (t === "egg") out.push("eggs");
    else if (t === "hen" || t === "hens" || t === "layer") out.push("eggs");
    else if (t === "milk") out.push("dairy");
    else if (t === "cattle" || t === "cow" || t === "cows") out.push("beef");
    else if (t === "pig" || t === "pigs" || t === "swine") out.push("pork");
    else if (t === "sheep") out.push("lamb");
  }
  // dedupe, preserve first occurrence
  return [...new Set(out)];
}

/* --------------------------- API listing mapper -------------------------- */

/** True when a GeoDirectory listing carries the Animal Welfare certification. */
export function isAwaListing(listing) {
  const ct = listing?.certification_type;
  const vals = Array.isArray(ct?.rendered)
    ? ct.rendered
    : [typeof ct === "object" && ct !== null ? ct.raw : ct].filter(Boolean);
  return vals.some(v => /animal\s*welfare/i.test(String(v)));
}

/**
 * store_type values that mean "the named entity is the certified producer".
 * Everything else (Stores, Restaurants, Farmers Markets, Online Shopping)
 * is an outlet that carries certified products — not itself certified.
 */
export const PRODUCER_STORE_TYPES = new Set([
  "Farm Stores", "CSAs", "Farm Stays & BnBs",
]);

export function listingStoreTypes(listing) {
  const st = listing?.store_type;
  const vals = Array.isArray(st?.rendered)
    ? st.rendered
    : [typeof st === "object" && st !== null ? st.raw : st].filter(Boolean);
  return vals.map(v => decodeEntities(String(v)));
}

/** True when at least one store_type marks the listing producer-operated. */
export function isProducerListing(listing) {
  return listingStoreTypes(listing).some(t => PRODUCER_STORE_TYPES.has(t));
}

/** Normalise one GeoDirectory listing to the snapshot farm shape. */
export function listingToFarm(listing) {
  const brand = stripTags(listing?.title?.raw || listing?.title?.rendered || "");
  if (!brand) return null;
  const categoryRaw = (listing?.post_category || [])
    .map(c => decodeEntities(c?.name || ""))
    .filter(Boolean)
    .join(", ");
  return {
    brand,
    state: listing?.region || null,
    country: listing?.country || null,
    productCategories: normalizeCategories(categoryRaw),
    storeTypes: listingStoreTypes(listing),
    sourceUrl: listing?.link || SOURCE_URL,
  };
}

/** De-dupe farms on brand + state, preserving first occurrence. */
export function dedupeFarms(farms) {
  const seen = new Set();
  return farms.filter(r => {
    const k = `${r.brand.toLowerCase()}|${(r.state || "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------- parser (legacy HTML) -------------------------- */

export function parseFarmsHtml(html) {
  if (!html) return [];
  const out = [];

  const blockRe = /<(article|li|div)\b[^>]*class="(?:[^"]*\s)?(?:farm-card|awa-listing|certified-farm|awa-farm)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:farm-name|brand-name|company-name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let state = null;
    const stMatch = inner.match(/<[^>]*class="[^"]*\b(?:state|us-state)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (stMatch) state = stripTags(stMatch[1]) || null;

    let country = null;
    const coMatch = inner.match(/<[^>]*class="[^"]*\b(?:country)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (coMatch) country = stripTags(coMatch[1]) || null;

    let categoryRaw = "";
    const catBlock = inner.match(/<[^>]*class="[^"]*\b(?:product-categories|products|species|product-list)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (catBlock) categoryRaw = stripTags(catBlock[1]);
    if (!categoryRaw) {
      // "Products: beef, eggs" inline.
      const text = stripTags(inner);
      const pm = text.match(/(?:products|species|categories)\s*[:\-]\s*([^.]+)/i);
      if (pm) categoryRaw = pm[1];
    }
    const productCategories = normalizeCategories(categoryRaw);

    out.push({ brand, state, country, productCategories, sourceUrl: SOURCE_URL });
  }

  return dedupeFarms(out);
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`AWA fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  let farms = [];
  let status = "ok"; let note; let emptyReason;
  let fetchMethod = "api";
  let listingsTotal = null; let awaListings = null; let producerListings = null;

  if (FIXTURE_MODE) {
    fetchMethod = "fixture";
    const res = await fetchHtml(SOURCE_URL);
    farms = parseFarmsHtml(res.body);
    console.log(`  Parsed ${farms.length} farms (fixture)`);
    if (farms.length === 0) { status = "empty"; emptyReason = "fixture_parse_zero"; }
  } else {
    const api = await fetchAllListings();
    if (api.ok) {
      listingsTotal = api.listings.length;
      const awa = api.listings.filter(isAwaListing);
      awaListings = awa.length;
      const producers = awa.filter(isProducerListing);
      producerListings = producers.length;
      farms = dedupeFarms(producers.map(listingToFarm).filter(Boolean));
      console.log(`  ${listingsTotal} directory listings, ${awaListings} AWA-certified, ` +
        `${producers.length} producer-operated, ${farms.length} unique farms`);
      if (farms.length === 0) {
        status = "empty";
        emptyReason = awaListings === 0
          ? "fetch_ok_zero_awa_listings"
          : "fetch_ok_zero_producer_listings";
        note = `GeoDirectory API returned ${listingsTotal} listings (${awaListings} AWA-certified) but ` +
          `none were producer-operated store types — check certification_type/store_type values upstream.`;
      }
    } else {
      // API down/moved: fall back to the legacy HTML scrape.
      console.error(`  API failed (${api.blocker}); falling back to HTML scrape of ${SOURCE_URL}`);
      fetchMethod = "html-fallback";
      const res = await fetchHtml(SOURCE_URL);
      if (!res.ok) {
        console.error(`  BLOCKED (${res.blocker})`);
        status = "blocked";
        note = `api: ${api.blocker}; html: ${res.blocker}`;
      } else {
        farms = parseFarmsHtml(res.body);
        console.log(`  Parsed ${farms.length} farms (HTML fallback)`);
        if (farms.length === 0) {
          status = "empty";
          emptyReason = "fetch_ok_zero_parsed_farms";
          note = `API failed (${api.blocker}) and the HTML fallback fetched OK but parsed 0 farms — ` +
            `selectors are probably stale after a site redesign.`;
        }
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "Public certification list (A Greener World / Animal Welfare Approved); cite source URL.",
    _source: SOURCE_URL,
    _api: API_URL,
    _landing: LANDING_URL,
    _generated_at: new Date().toISOString(),
    _status: status,
    _fetch_method: fetchMethod,
    ...(emptyReason ? { _empty_reason: emptyReason } : {}),
    ...(note ? { _note: note } : {}),
    _stats: {
      total_farms: farms.length,
      with_products: farms.filter(f => f.productCategories.length > 0).length,
      ...(listingsTotal !== null
        ? { listings_total: listingsTotal, awa_listings: awaListings, producer_listings: producerListings }
        : {}),
    },
    farms,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${farms.length} farms)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("awa-fetch failed:", err);
    process.exit(1);
  });
}
