#!/usr/bin/env node
/**
 * EDGAR catalog expansion (2026-06-11, Aron's "add many more public companies").
 *
 * 1. Downloads SEC company_tickers_exchange.json (every EDGAR registrant with
 *    an active ticker + exchange).
 * 2. Filters OUT: fund/trust/SPAC/shell vehicles (name patterns + SIC 6722/
 *    6726/6770), OTC-only listings, and anything already in the catalog
 *    (matched by ticker OR normalized name via lib/company-name-normalize).
 * 3. For each genuinely-new company, fetches data.sec.gov/submissions/CIK*.json
 *    for the SIC code (polite ~8 req/s, SEC fair-access UA, resumable cache at
 *    data/raw/edgar-expansion/sic-cache.json).
 * 4. Maps SIC → TruNorth's 18 industry buckets and writes a catalog-shaped
 *    stub: isPublic:true, ticker, cik, sic, all sc.* neutral, every category
 *    narrative "No public record found." — the pipeline (mergers, reflag,
 *    inherit, rebake) enriches from there exactly like any other brand.
 *
 * Flags:
 *   --dry          analyze + print counts, write nothing
 *   --limit=N      cap new stubs (pilot runs)
 *
 * Run order afterwards: *-merge passes → reflag-categories → lever2-residuals
 * → inherit-from-parent --apply → rebake-scoring → finalize-bundle.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const RAW_DIR = path.join(ROOT, "data/raw/edgar-expansion");
const SIC_CACHE = path.join(RAW_DIR, "sic-cache.json");
const UA = "TruNorth-EDGAR/1.0 (data pipeline; contact@trunorthapp.com)";

const DRY = process.argv.includes("--dry");
const LIMIT = Number((process.argv.find(a => a.startsWith("--limit=")) || "").split("=")[1]) || Infinity;

// Fund/trust/shell vehicles — not consumer-gradeable operating companies.
const VEHICLE_NAME_RE = /\b(etf|funds?|acquisitions?|spac|blank check|capital pool|depositar?y|closed[- ]end|unit trust|investment trust|income trust|royalty trust|statutory trust|capital trust)\b|\b(bitcoin|ethereum|solana|crypto|digital asset)\b.*\b(trust|fund)\b/i;
const VEHICLE_SIC = new Set([6221, 6722, 6726, 6770, 6792, 6798]); // commodity/fund vehicles, blank checks, royalty traders, REIT trusts
const OK_EXCHANGES = new Set(["NYSE", "Nasdaq", "CBOE", "NYSE MKT", "NYSE Arca", "NYSEAMER", "NYSEArca"]);

// ─── SIC → TruNorth industry bucket ─────────────────────────────────────────
function sicToCat(sic) {
  const n = Number(sic) || 0;
  if (n >= 100 && n <= 999) return "Food & Beverage";          // agriculture
  if (n >= 1000 && n <= 1499) return "Energy & Utilities";      // mining
  if (n >= 1500 && n <= 1799) return "Manufacturing";           // construction
  if (n >= 2000 && n <= 2099) return "Food & Beverage";
  if (n === 2100 || (n > 2100 && n <= 2199)) return "Consumer Goods"; // tobacco
  if (n >= 2200 && n <= 2399) return "Apparel & Fashion";
  if (n === 2711 || n === 2721 || n === 2731 || n === 2741) return "Entertainment & Media"; // publishing
  if (n >= 2400 && n <= 2799) return "Manufacturing";           // lumber/paper/printing
  if (n === 2834 || n === 2835 || n === 2836 || n === 8731) return "Healthcare"; // pharma/biotech
  if (n === 2844) return "Beauty & Personal Care";
  if (n >= 2800 && n <= 2899) return "Manufacturing";           // chemicals
  if (n >= 2900 && n <= 2999) return "Energy & Utilities";      // petroleum
  if (n >= 3570 && n <= 3579) return "Technology";              // computers
  if (n >= 3600 && n <= 3699) return "Technology";              // electronics
  if (n >= 3711 && n <= 3799) return "Automotive";
  if (n >= 3812 && n <= 3829) return "Technology";              // instruments
  if (n >= 3841 && n <= 3851) return "Healthcare";              // medical devices
  if (n >= 3000 && n <= 3999) return "Manufacturing";
  if (n === 4512 || n === 4513 || (n >= 4700 && n <= 4799)) return "Travel & Transportation";
  if (n >= 4000 && n <= 4699) return "Travel & Transportation";
  if (n === 4832 || n === 4833 || n === 4841) return "Entertainment & Media"; // broadcasting/cable
  if (n >= 4800 && n <= 4899) return "Technology";              // telecom
  if (n >= 4900 && n <= 4999) return "Energy & Utilities";
  if (n === 5411) return "Grocery";
  if (n === 5812 || n === 5813) return "Hospitality";           // restaurants/bars
  if (n >= 5000 && n <= 5199) return "Consumer Goods";          // wholesale
  if (n >= 5200 && n <= 5999) return "Retail";
  if (n >= 6000 && n <= 6799) return "Financial Services";
  if (n >= 7000 && n <= 7099) return "Hospitality";             // hotels
  if (n === 7370 || n === 7371 || n === 7372 || n === 7374 || n === 7389) return "Technology";
  if (n >= 7812 && n <= 7841) return "Entertainment & Media";   // movies
  if (n === 7900 || (n >= 7910 && n <= 7999)) return "Entertainment & Media";
  if (n >= 7200 && n <= 7699) return "Professional Services";
  if (n >= 8000 && n <= 8099) return "Healthcare";
  if (n >= 8100 && n <= 8999) return "Professional Services";
  return "Consumer Goods";
}

// Deterministic dark-bg + accent palette from the name (matches catalog vibe:
// dark tinted bg `ab`, saturated accent `ac`).
function brandColors(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const hsl = (hh, s, l) => {
    const a = s * Math.min(l, 1 - l);
    const f = (k) => {
      const kk = (k + hh / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(kk - 3, Math.min(9 - kk, 1)));
      return Math.round(255 * c).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  return { ab: hsl(hue, 0.45, 0.09), ac: hsl(hue, 0.55, 0.58) };
}

const NO_REC = { s: "No public record found.", sources: [] };
const CAT_FIELDS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay", "health"];

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(RAW_DIR, { recursive: true });

console.log("[edgar] downloading company_tickers_exchange.json…");
const raw = await fetchJSON("https://www.sec.gov/files/company_tickers_exchange.json");
// shape: { fields: ["cik","name","ticker","exchange"], data: [[...], ...] }
const rows = raw.data.map((r) => ({ cik: r[0], name: r[1], ticker: r[2], exchange: r[3] }));
console.log(`[edgar] ${rows.length} EDGAR registrants with tickers`);

console.log("[edgar] indexing existing catalog…");
const existingTickers = new Set();
const existingNames = new Set();
const existingSlugs = new Set();
for (const f of fs.readdirSync(COMPS)) {
  if (!f.endsWith(".json")) continue;
  existingSlugs.add(f.replace(/\.json$/, ""));
  try {
    const d = JSON.parse(fs.readFileSync(path.join(COMPS, f), "utf8"));
    if (d.ticker) existingTickers.add(String(d.ticker).toUpperCase());
    if (d.name) existingNames.add(normalizeCompanyName(d.name));
  } catch {}
}
// Slug aliases also count as "existing"
try {
  const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/slug-aliases.json"), "utf8"));
  for (const k of Object.keys(aliases)) existingSlugs.add(k);
} catch {}
console.log(`[edgar] existing: ${existingSlugs.size} slugs · ${existingTickers.size} tickers`);

// Dedupe multi-class listings (GOOG/GOOGL): keep first ticker per CIK.
const byCik = new Map();
for (const r of rows) if (!byCik.has(r.cik)) byCik.set(r.cik, r);

const candidates = [];
for (const r of byCik.values()) {
  if (!r.ticker || !r.name) continue;
  if (!OK_EXCHANGES.has(r.exchange)) continue;
  if (VEHICLE_NAME_RE.test(r.name)) continue;
  if (existingTickers.has(String(r.ticker).toUpperCase())) continue;
  if (existingNames.has(normalizeCompanyName(r.name))) continue;
  const slug = toSlug(r.name);
  if (!slug || existingSlugs.has(slug)) continue;
  candidates.push({ ...r, slug });
}
console.log(`[edgar] new operating-company candidates: ${candidates.length}`);

// SIC lookup with resumable cache
let sicCache = {};
try { sicCache = JSON.parse(fs.readFileSync(SIC_CACHE, "utf8")); } catch {}
let fetched = 0, errors = 0;
const todo = candidates.filter((c) => sicCache[c.cik] === undefined).slice(0, DRY ? 0 : 50_000);
console.log(`[edgar] SIC lookups needed: ${todo.length} (cache has ${Object.keys(sicCache).length})`);
for (let i = 0; i < todo.length; i++) {
  const c = todo[i];
  const cik10 = String(c.cik).padStart(10, "0");
  try {
    const sub = await fetchJSON(`https://data.sec.gov/submissions/CIK${cik10}.json`);
    sicCache[c.cik] = { sic: Number(sub.sic) || 0, sicDesc: sub.sicDescription || "", entityType: sub.entityType || "" };
  } catch (e) {
    sicCache[c.cik] = { sic: 0, sicDesc: "", error: true };
    errors++;
  }
  fetched++;
  if (fetched % 50 === 0) {
    fs.writeFileSync(SIC_CACHE, JSON.stringify(sicCache));
    process.stdout.write(`\r[edgar] SIC ${fetched}/${todo.length} (errors ${errors})   `);
  }
  await sleep(125); // ~8 req/s, SEC fair-access ceiling is 10
}
fs.writeFileSync(SIC_CACHE, JSON.stringify(sicCache));
if (todo.length) console.log(`\n[edgar] SIC fetch complete (${errors} errors)`);

// Build + write stubs
let written = 0, skippedVehicleSic = 0;
const catDist = {};
for (const c of candidates) {
  if (written >= LIMIT) break;
  const meta = sicCache[c.cik] || { sic: 0 };
  if (VEHICLE_SIC.has(meta.sic)) { skippedVehicleSic++; continue; }
  const cat = sicToCat(meta.sic);
  catDist[cat] = (catDist[cat] || 0) + 1;
  if (DRY) { written++; continue; }

  // Title-case the EDGAR ALL-CAPS-ish legal name, drop trailing legal suffix
  // for display (keep the legal name in `legalName`).
  const display = c.name
    .replace(/\s*\/[A-Z]{2}\/?\s*$/, "")  // strip EDGAR "/DE/" state markers
    .replace(/\s+/g, " ").trim()
    .toLowerCase()
    .replace(/(^|[\s\-./&(])([a-z])/g, (m, p, ch) => p + ch.toUpperCase())
    .replace(/\b(Inc|Corp|Co|Ltd|Plc|Lp|Llc|Sa|Nv|Ag)\.?$/i, "")
    .replace(/[,\s]+$/, "");
  const { ab, ac } = brandColors(display);
  const stub = {
    name: display,
    legalName: c.name,
    cat,
    init: c.ticker.slice(0, 4).toUpperCase(),
    overall: null,
    realCats: 0,
    isPublic: true,
    ticker: c.ticker,
    cik: c.cik,
    sic: meta.sic || null,
    sicDescription: meta.sicDesc || null,
    addedBy: "edgar-expansion-2026-06",
    sc: Object.fromEntries(CAT_FIELDS.map((k) => [k, "neutral"])),
    ...Object.fromEntries(CAT_FIELDS.map((k) => [k, { ...NO_REC }])),
    ab, ac,
    competitors: [],
    slug: c.slug,
  };
  fs.writeFileSync(path.join(COMPS, `${c.slug}.json`), JSON.stringify(stub, null, 2));
  written++;
}

console.log(`[edgar] ${DRY ? "WOULD write" : "wrote"} ${written} stubs · skipped ${skippedVehicleSic} fund/shell SICs`);
console.log("[edgar] industry distribution:", JSON.stringify(catDist, null, 1));
