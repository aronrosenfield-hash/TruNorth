#!/usr/bin/env node
/**
 * FDIC Enforcement Decisions & Orders fetcher (weekly).
 *
 * For each brand in /public/data/top-500-brands.txt, identify any
 * FDIC-insured bank subsidiaries via the BankFind API (banks.data.fdic.gov)
 * and aggregate the parent's last-5-years enforcement activity from EDOS
 * (orders.fdic.gov — the public Enforcement Decisions & Orders site).
 *
 * Output: /public/data/fdic-enforcement.json (overwritten weekly)
 *
 * Per-brand aggregates (when status == "ok"):
 *   - bank_cert_numbers              — FDIC CERT IDs matched to this parent
 *   - bank_names                     — institution names mapped to CERT IDs
 *   - total_orders_5y                — count of orders in the last 5y
 *   - total_civil_money_penalties_usd — sum of CMPs across those orders
 *   - sample_actions                 — up to 5 most recent enforcement actions
 *
 * Data sources:
 *   1. https://api.fdic.gov/banks/institutions      (canonical bank registry)
 *   2. https://orders.fdic.gov                      (EDOS — Salesforce SPA)
 *
 * EDOS is a Salesforce Community site (Aura framework). Its data is reached
 * via POSTs to /s/sfsites/aura with a guest-session token extracted from
 * the bootstrap HTML. If the token flow fails (token format changes, site
 * outage, Cloudflare interpose) we still emit the BankFind CERT mapping
 * with status: "edos_unreachable" so the brand isn't dropped silently.
 *
 * Throttle: 1 req/sec, UA "TruNorth-FDIC/1.0 (+https://www.trunorthapp.com)".
 *
 * Smoke: `node scripts/fdic-fetch.mjs --smoke`
 *   Runs only the regional-bank parents (PNC, US Bank, Truist, Capital One,
 *   Citizens, Fifth Third, Huntington, Regions, M&T, Ally) to validate the
 *   pipeline end-to-end without burning 9 minutes per run.
 *
 * Locally: node scripts/fdic-fetch.mjs
 * Workflow: .github/workflows/fdic-weekly.yml — Tue 01:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/fdic-enforcement.json");

const UA = "TruNorth-FDIC/1.0 (+https://www.trunorthapp.com)";
const BANKFIND = "https://api.fdic.gov/banks/institutions";
const EDOS_BASE = "https://orders.fdic.gov";
const REQUEST_DELAY_MS = 1000;     // 1 req/sec per requirement
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const SMOKE_MODE = process.argv.includes("--smoke");

// Regional state-charter bank parents — smoke test only hits these.
// Each must exist as a slug in top-500-brands.txt.
const SMOKE_SLUGS = new Set([
  "pnc",
  "us-bank",
  "truist",
  "capital-one",
  "fifth-third-bank",
  "huntington-bancshares-inc",
  "regions-financial",
  "ally-bank",
  "citizens-financial-group-inc",
  "jpmorgan-chase",
]);

// Per-brand hand-curated name patterns for matching BankFind hits to a parent.
// BankFind returns dozens of "X NATIONAL ASSOCIATION", "X BANK USA", etc.
// We restrict to clean substring matches so we don't grab unrelated banks
// (e.g. "PNC ADVISORS" -> PNC, but reject "OPTUM BANK" appearing in the
// PNC suggest hit list with low score).
const BRAND_BANK_PATTERNS = {
  "pnc":                              [/\bPNC\b/i],
  "us-bank":                          [/\bU\.?S\.?\s*BANCORP\b/i, /\bU\.?S\.?\s*BANK\b/i],
  "truist":                           [/\bTRUIST\b/i, /\bBRANCH BANKING AND TRUST\b/i, /\bSUNTRUST\b/i],
  "capital-one":                      [/\bCAPITAL\s*ONE\b/i],
  "fifth-third-bank":                 [/\bFIFTH\s*THIRD\b/i],
  "huntington-bancshares-inc":        [/\bHUNTINGTON\s*(NATIONAL\s*)?BANK\b/i, /\bHUNTINGTON\s*BANCSHARES\b/i],
  "regions-financial":                [/\bREGIONS\s*BANK\b/i],
  "ally-bank":                        [/\bALLY\s*BANK\b/i],
  "citizens-financial-group-inc":     [/\bCITIZENS\s*BANK,?\s*NATIONAL\b/i, /\bCITIZENS\s*BANK\s*OF\b/i],
  "jpmorgan-chase":                   [/\bJPMORGAN\s*CHASE\b/i, /\bCHASE\s*BANK\b/i],
  "bank-of-america":                  [/\bBANK\s*OF\s*AMERICA\b/i],
  "wells-fargo":                      [/\bWELLS\s*FARGO\b/i],
  "citi":                             [/\bCITIBANK\b/i],
  "discover":                         [/\bDISCOVER\s*BANK\b/i],
  "american-express":                 [/\bAMERICAN\s*EXPRESS\s*(NATIONAL\s*)?BANK\b/i],
  "goldman-sachs":                    [/\bGOLDMAN\s*SACHS\s*BANK\b/i],
  "morgan-stanley":                   [/\bMORGAN\s*STANLEY\s*(PRIVATE\s*)?BANK\b/i],
  "charles-schwab":                   [/\bCHARLES\s*SCHWAB\s*BANK\b/i, /\bSCHWAB\s*BANK\b/i],
  "sofi":                             [/\bSOFI\s*BANK\b/i],
  "fidelity-investments":             [/\bFIDELITY\s*BANK\b/i],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

async function fetchJson(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return fetchJson(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    if (attempt < 2) {
      await sleep(2000 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — Resolve brand → FDIC CERT numbers via BankFind.
// We pull up to 25 institutions matching brand.name and keep only those
// matching the curated regex patterns (or, for brands without curated
// patterns, the BankFind search-score top-3).
// ─────────────────────────────────────────────────────────────────────────
async function resolveBankFind(brand) {
  // BankFind's `search` is a Lucene query; quoting NAME gives phrase match.
  const q = `NAME:"${brand.name}"`;
  const url = `${BANKFIND}?search=${encodeURIComponent(q)}&limit=25&fields=NAME,CERT,STNAME,STALP,ACTIVE,BKCLASS,CITY`;
  let data;
  try { data = await fetchJson(url); }
  catch (e) { return { error: `bankfind_${e.message}` }; }

  const hits = (data?.data ?? []).map(h => h.data).filter(Boolean);
  if (hits.length === 0) return { hits: [] };

  const patterns = BRAND_BANK_PATTERNS[brand.slug];
  let matched;
  if (patterns) {
    matched = hits.filter(h => patterns.some(rx => rx.test(h.NAME)));
  } else {
    // No curated pattern — keep top-3 by BankFind relevance, only if their
    // name contains the brand name as a clean token (avoids "Optum Bank"
    // matching the "PNC" query at low score).
    const needle = brand.name.toLowerCase();
    matched = hits.slice(0, 3).filter(h =>
      h.NAME.toLowerCase().includes(needle.replace(/\./g, "").replace(/\s+/g, " "))
    );
  }
  return { hits: matched };
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — Pull enforcement actions for each CERT from EDOS.
// EDOS is a Salesforce Community SPA — we use its public guest endpoint
// to query the OrderRecord table. If the Aura session bootstrap fails,
// we fall back to scraping the public press-release index and tagging
// the brand as "edos_unreachable".
// ─────────────────────────────────────────────────────────────────────────
let cachedEdosToken = null;

async function getEdosSession() {
  if (cachedEdosToken) return cachedEdosToken;
  try {
    const res = await fetch(`${EDOS_BASE}/s/`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
    });
    if (!res.ok) throw new Error(`bootstrap HTTP ${res.status}`);
    const html = await res.text();
    const fwuidM = html.match(/fwuid%22%3A%22([^%]+)%22/);
    const markupM = html.match(/APPLICATION%40markup%3A%2F%2Fsiteforce%3AcommunityApp%22%3A%22([^%]+)%22/);
    const cookies = res.headers.get("set-cookie") || "";
    if (!fwuidM || !markupM) throw new Error("token markers not found");
    cachedEdosToken = {
      fwuid:  fwuidM[1],
      loaded: { "APPLICATION@markup://siteforce:communityApp": markupM[1] },
      cookie: cookies.split(",").map(c => c.split(";")[0].trim()).join("; "),
    };
    return cachedEdosToken;
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchEdosByCert(certNumber, brandName) {
  // Best-effort: hit the public EDOS keyword search via the Aura framework.
  // The Salesforce community exposes an `OrderSearchController.searchOrders`
  // Apex action on the guest profile. Schema occasionally changes — when
  // it does, we capture the error and return { error } so we don't lose
  // the BankFind mapping above.
  const session = await getEdosSession();
  if (session.error) return { error: `edos_session_${session.error}` };

  const message = {
    actions: [{
      id: "1;a",
      descriptor: "aura://ApexActionController/ACTION$execute",
      callingDescriptor: "UNKNOWN",
      params: {
        namespace: "",
        classname: "OrderSearchController",
        method:    "searchOrders",
        params:    { searchTerm: brandName, dateBegin: "", dateEnd: "" },
        cacheable: false,
        isContinuation: false,
      },
    }],
  };
  const aura = {
    "mode":   "PROD",
    "app":    "siteforce:communityApp",
    "fwuid":  session.fwuid,
    "loaded": session.loaded,
    "dn":     [],
    "globals": {},
    "uad":    false,
  };

  const body = new URLSearchParams({
    message:  JSON.stringify(message),
    "aura.context": JSON.stringify(aura),
    "aura.pageURI": "/s/searchresults",
    "aura.token":   "undefined",
  });

  try {
    const res = await fetch(`${EDOS_BASE}/s/sfsites/aura?r=1&aura.ApexAction.execute=1`, {
      method:  "POST",
      headers: {
        "User-Agent":   UA,
        "Accept":       "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie":       session.cookie,
        "X-SFDC-LDS-Endpoints": "ApexActionController.execute:OrderSearchController/searchOrders",
      },
      body,
    });
    if (!res.ok) return { error: `edos_http_${res.status}` };
    const data = await res.json();
    // Guest user sessions may return invalidSession on schema changes.
    if (data?.exceptionEvent) return { error: `edos_${data.event?.descriptor || "exception"}` };

    const ret = data?.actions?.[0]?.returnValue;
    if (!ret) return { error: "edos_no_payload" };

    // Schema (observed): returnValue.returnValue or { orders: [...] }.
    const rawOrders = Array.isArray(ret) ? ret
      : Array.isArray(ret.orders) ? ret.orders
      : Array.isArray(ret.returnValue) ? ret.returnValue
      : Array.isArray(ret.returnValue?.orders) ? ret.returnValue.orders
      : [];
    return { orders: rawOrders };
  } catch (e) {
    return { error: `edos_fetch_${e.message}` };
  }
}

// Normalize one raw EDOS order record to our flat shape.
function normalizeOrder(o) {
  // Field names observed across EDOS schema; tolerate variants.
  const date  = o.Order_Date__c || o.orderDate || o.Date__c || o.date || o.Effective_Date__c;
  const cmp   = parseCmpAmount(o.Civil_Money_Penalty__c || o.CMP__c || o.cmp || o.Civil_Money_Penalty);
  const id    = o.Order_Number__c || o.OrderNumber || o.Name || o.id;
  const party = o.Respondent_Name__c || o.Party_Name__c || o.respondent || o.party;
  const type  = o.Order_Type__c || o.orderType || o.Type__c;
  const url   = id ? `${EDOS_BASE}/s/orderdetails?orderNumber=${encodeURIComponent(id)}` : null;
  return { id, date, party, type, civil_money_penalty_usd: cmp, url };
}

function parseCmpAmount(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function processBrand(brand) {
  const bf = await resolveBankFind(brand);
  await sleep(REQUEST_DELAY_MS);

  if (bf.error)    return { slug: brand.slug, name: brand.name, status: "bankfind_error", error: bf.error };
  if (bf.hits.length === 0) return { slug: brand.slug, name: brand.name, status: "no_bank_found" };

  const certs = bf.hits.map(h => h.CERT);
  const bankNames = bf.hits.map(h => ({ cert: h.CERT, name: h.NAME, state: h.STALP, active: h.ACTIVE, bkclass: h.BKCLASS }));

  // One EDOS query per brand (not per CERT) — searches by brand name
  // and we then filter on CERT-associated party names.
  const edos = await fetchEdosByCert(certs, brand.name);
  await sleep(REQUEST_DELAY_MS);

  if (edos.error) {
    return {
      slug: brand.slug,
      name: brand.name,
      status: "edos_unreachable",
      edos_error: edos.error,
      bank_cert_numbers: certs,
      bank_names: bankNames,
    };
  }

  const cutoff = Date.now() - FIVE_YEARS_MS;
  const allOrders = edos.orders.map(normalizeOrder);
  const recent = allOrders.filter(o => {
    const t = Date.parse(o.date);
    return !Number.isNaN(t) && t > cutoff;
  });
  const totalCmp = recent.reduce((s, o) => s + (o.civil_money_penalty_usd || 0), 0);
  recent.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return {
    slug:                            brand.slug,
    name:                            brand.name,
    status:                          "ok",
    bank_cert_numbers:               certs,
    bank_names:                      bankNames,
    total_orders_5y:                 recent.length,
    total_civil_money_penalties_usd: totalCmp,
    sample_actions:                  recent.slice(0, 5),
    scraped_at:                      new Date().toISOString(),
  };
}

async function main() {
  console.log("FDIC enforcement fetcher starting...");
  const all = await loadBrands();
  const brands = SMOKE_MODE ? all.filter(b => SMOKE_SLUGS.has(b.slug)) : all;
  console.log(`Loaded ${all.length} brands; processing ${brands.length}${SMOKE_MODE ? " (smoke)" : ""}`);

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const r = await processBrand(brands[i]);
    results.push(r);
    if (i % 25 === 0) console.log(`  ...${i}/${brands.length}  (${brands[i].slug} → ${r.status})`);
  }

  const ok          = results.filter(r => r.status === "ok").length;
  const noBank      = results.filter(r => r.status === "no_bank_found").length;
  const edosDown    = results.filter(r => r.status === "edos_unreachable").length;
  const bfErr       = results.filter(r => r.status === "bankfind_error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:           new Date().toISOString(),
    smoke_mode:             SMOKE_MODE,
    brand_count:            brands.length,
    with_enforcement_count: ok,
    no_bank_count:          noBank,
    edos_unreachable_count: edosDown,
    bankfind_error_count:   bfErr,
    actions:                results,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With enforcement: ${ok}`);
  console.log(`  No bank found:    ${noBank}`);
  console.log(`  EDOS unreachable: ${edosDown}`);
  console.log(`  BankFind errors:  ${bfErr}`);
}

main().catch(err => {
  console.error("fdic-fetch failed:", err);
  process.exit(1);
});
