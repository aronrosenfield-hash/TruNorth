#!/usr/bin/env node
/**
 * Smithsonian Bird Friendly Coffee — certified roasters/brands (DW-59).
 *
 *   https://nationalzoo.si.edu/migratory-birds/bird-friendly-coffee
 *
 * Smithsonian's Bird Friendly programme certifies coffee farms that
 * preserve native-tree shade canopy — the strictest shade-grown standard
 * (USDA-Organic prerequisite, biodiversity audit, 40%+ shade cover,
 * minimum 10 woody species per hectare). The Smithsonian Migratory Bird
 * Center publishes a directory of certified roasters / consumer brands.
 *
 * NORMALISED OUTPUT
 *   data/raw/bird-friendly-coffee/<YYYY-MM-DD>.json
 *   {
 *     _license, _source, _generated_at,
 *     _stats: { total_roasters, with_cert_year },
 *     roasters: [{
 *       brand,
 *       country?: string,
 *       region?: string,  // free text — e.g. "USA / Pacific Northwest"
 *       certYear?: number,
 *       website?: string,
 *       sourceUrl: string
 *     }]
 *   }
 *
 * STRATEGY
 *   The Smithsonian page is a single roster — a few dozen roasters total.
 *   Several template variants observed in the wild:
 *     - <li class="roaster"> w/ <h3> + .country + .website
 *     - <div class="bf-brand"> w/ <strong>BrandName</strong>
 *     - flat <ul> bullet list (older template)
 *   Regex-permissive parser (no cheerio).
 *
 * THROTTLE / POLITENESS
 *   - 2 sec courtesy delay (only 1 request anyway)
 *   - Honest UA identifying TruNorth
 *   - 5xx retry with exponential backoff (3 tries)
 *
 * FIXTURE MODE
 *   --fixture reads scripts/fixtures/bird-friendly-coffee/sample.html.
 *
 * Locally:
 *   node scripts/bird-friendly-coffee-fetch.mjs              # live (CI)
 *   node scripts/bird-friendly-coffee-fetch.mjs --fixture    # offline
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/bird-friendly-coffee");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/bird-friendly-coffee");

export const SOURCE_URL = "https://nationalzoo.si.edu/migratory-birds/bird-friendly-coffee";
const UA = "TruNorth-BirdFriendlyCoffee/1.0 (+https://www.trunorthapp.com; data pipeline for shade-grown-coffee certification transparency)";
const REQ_DELAY_MS = 2000;
const MAX_RETRIES = 3;

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

/* ------------------------------- utils ---------------------------------- */

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", aacute: "á", iacute: "í", oacute: "ó",
  uacute: "ú", ntilde: "ñ", ccedil: "ç",
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

/** "Certified 2018" / "since 2018" / bare "2018" → 2018. */
export function parseCertYear(text) {
  if (!text) return null;
  const m = String(text).match(/(?:certified|since|cert(?:\.|ified)?\s*year)[^0-9]*((?:19|20)\d{2})/i);
  if (m) return Number(m[1]);
  const bare = String(text).match(/\b((?:19|20)\d{2})\b/);
  return bare ? Number(bare[1]) : null;
}

/** Permissive URL extractor for the optional roaster homepage. */
export function extractWebsite(inner) {
  if (!inner) return null;
  const m = inner.match(/href="(https?:\/\/[^"]+)"/i);
  if (!m) return null;
  // Skip Smithsonian self-links.
  if (/nationalzoo\.si\.edu|s\.si\.edu/i.test(m[1])) return null;
  return m[1];
}

/* ------------------------------- parser --------------------------------- */

export function parseRoastersHtml(html) {
  if (!html) return [];
  const out = [];

  // Variant A/B: .roaster / .bf-brand / .certified-roaster cards.
  const blockRe = /<(li|div|article|tr)\b[^>]*class="(?:[^"]*\s)?(?:roaster|bf-brand|certified-roaster|bird-friendly-brand)(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];

    let brand = "";
    const nameMatch =
      inner.match(/<(?:a|span|strong|h\d)[^>]*class="[^"]*\b(?:brand-name|roaster-name|name)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span|strong|h\d)>/i)
      || inner.match(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/i)
      || inner.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)
      || inner.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (nameMatch) brand = stripTags(nameMatch[1]);
    if (!brand) continue;

    let country = null;
    const countryMatch = inner.match(/<[^>]*class="[^"]*\b(?:country)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (countryMatch) country = stripTags(countryMatch[1]) || null;

    let region = null;
    const regionMatch = inner.match(/<[^>]*class="[^"]*\b(?:region|location)\b[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (regionMatch) region = stripTags(regionMatch[1]) || null;

    const certYear = parseCertYear(stripTags(inner));
    const website = extractWebsite(inner);

    out.push({ brand, country, region, certYear, website, sourceUrl: SOURCE_URL });
  }

  // Variant C: plain <ul><li>Brand Name — Country (YYYY)</li></ul>.
  if (out.length === 0) {
    const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    while ((m = liRe.exec(html)) !== null) {
      const text = stripTags(m[1]);
      if (!text || text.length < 2 || text.length > 120) continue;
      if (/menu|cookie|sitemap|privacy|terms|contact|^home$|^about$/i.test(text)) continue;
      // "Birds & Beans — USA (2005)" → brand="Birds & Beans" country="USA" cert=2005
      const split = text.match(/^([^—\-–]+?)(?:\s*[—\-–]\s*([^()]+?))?(?:\s*\(((?:19|20)\d{2})\))?\s*$/);
      const brand = split ? split[1].trim() : text;
      const region = split && split[2] ? split[2].trim() : null;
      const certYear = split && split[3] ? Number(split[3]) : parseCertYear(text);
      out.push({
        brand, country: null, region, certYear, website: null, sourceUrl: SOURCE_URL,
      });
    }
  }

  // Dedupe (case-insensitive brand).
  const seen = new Set();
  return out.filter(r => {
    const k = r.brand.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log(`Bird Friendly Coffee fetcher starting (fixture=${FIXTURE_MODE})...`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  const res = await fetchHtml(SOURCE_URL);
  let roasters = [];
  let status = "ok"; let note;
  if (!res.ok) {
    console.error(`  BLOCKED (${res.blocker})`);
    status = "blocked"; note = res.blocker;
  } else {
    roasters = parseRoastersHtml(res.body);
    console.log(`  Parsed ${roasters.length} roasters`);
    if (roasters.length === 0) status = "empty";
  }

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(RAW_DIR, `${today}.json`);
  const payload = {
    _license: "Public certification list (Smithsonian Migratory Bird Center); cite source URL.",
    _source: SOURCE_URL,
    _generated_at: new Date().toISOString(),
    _status: status,
    ...(note ? { _note: note } : {}),
    _stats: {
      total_roasters: roasters.length,
      with_cert_year: roasters.filter(r => r.certYear).length,
    },
    roasters,
  };
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile} (${roasters.length} roasters)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("bird-friendly-coffee-fetch failed:", err);
    process.exit(1);
  });
}
