#!/usr/bin/env node
/**
 * NIST NVD — Per-vendor CVE aggregation (monthly)
 *
 * Queries the NIST National Vulnerability Database (NVD) API 2.0 once per
 * tech vendor using CPE name search (`cpeName=cpe:2.3:a:VENDOR:*`) and
 * aggregates a privacy/security signal per brand.
 *
 * Unlike CISA KEV (a single bulk JSON), NVD requires per-vendor calls
 * because the full CVE corpus is enormous (>250k entries). We iterate a
 * curated TECH_VENDORS list — major consumer-tech brands TruNorth covers.
 *
 * Per-vendor aggregates written to /public/data/nvd-cves.json:
 *   - total_cves_lifetime         — all-time count
 *   - critical_severity_count     — CVSS v3 base ≥ 9.0
 *   - high_severity_count         — CVSS v3 base 7.0–8.9
 *   - recent_24mo                 — CVEs published in last 24 months
 *   - sample_top_severity         — top 5 by severity in last 24mo
 *
 * Rate limits: NVD allows 5 req/30s without an API key. We pace at
 * 6 req/30s (5s gap) to stay comfortably under, with retries on 429/503.
 * UA: "TruNorth-NVD/1.0".
 *
 * Source:  https://nvd.nist.gov/developers/vulnerabilities
 * Workflow: .github/workflows/nvd-monthly.yml (1st of month 08:00 UTC).
 * Local:   node scripts/nvd-fetch.mjs
 *          node scripts/nvd-fetch.mjs --smoke   # only Microsoft/Apple/Google/Adobe
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/nvd-cves.json");

const NVD_BASE = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const UA = "TruNorth-NVD/1.0 (+https://www.trunorthapp.com)";

// Pacing: NVD allows 5 req/30s without an API key. 6 req/30s = 5000ms gap.
// We use 5200ms for a small safety margin.
const REQ_GAP_MS = 5200;
const PAGE_SIZE = 2000;             // NVD max per page
const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

// Curated tech vendors (CPE-vendor token → display name).
// Smoke run uses the first four. Keep this list in sync with brand-parent-map
// + slug-aliases where possible; the merger handles routing.
const TECH_VENDORS = [
  { cpe: "microsoft",         display: "Microsoft" },
  { cpe: "apple",             display: "Apple" },
  { cpe: "google",            display: "Google" },
  { cpe: "adobe",             display: "Adobe" },
  { cpe: "oracle",            display: "Oracle" },
  { cpe: "cisco",             display: "Cisco" },
  { cpe: "ibm",               display: "IBM" },
  { cpe: "samsung",           display: "Samsung" },
  { cpe: "amazon",            display: "Amazon" },
  { cpe: "meta",              display: "Meta" },
  { cpe: "facebook",          display: "Facebook" },
  { cpe: "intel",             display: "Intel" },
  { cpe: "amd",               display: "AMD" },
  { cpe: "nvidia",            display: "NVIDIA" },
  { cpe: "dell",              display: "Dell" },
  { cpe: "hp",                display: "HP" },
  { cpe: "vmware",            display: "VMware" },
  { cpe: "fortinet",          display: "Fortinet" },
  { cpe: "citrix",            display: "Citrix" },
  { cpe: "mozilla",           display: "Mozilla" },
  { cpe: "sap",               display: "SAP" },
  { cpe: "salesforce",        display: "Salesforce" },
  { cpe: "atlassian",         display: "Atlassian" },
  { cpe: "zoom",              display: "Zoom" },
  { cpe: "slack",             display: "Slack" },
  { cpe: "dropbox",           display: "Dropbox" },
  { cpe: "twitter",           display: "Twitter" },
  { cpe: "linkedin",          display: "LinkedIn" },
  { cpe: "netflix",           display: "Netflix" },
  { cpe: "spotify",           display: "Spotify" },
  { cpe: "uber",              display: "Uber" },
  { cpe: "airbnb",            display: "Airbnb" },
  { cpe: "shopify",           display: "Shopify" },
  { cpe: "paypal",            display: "PayPal" },
  { cpe: "tesla",             display: "Tesla" },
  { cpe: "sony",              display: "Sony" },
  { cpe: "lg",                display: "LG" },
  { cpe: "lenovo",            display: "Lenovo" },
  { cpe: "asus",              display: "ASUS" },
  { cpe: "acer",              display: "Acer" },
];

const SMOKE_VENDORS = new Set(["microsoft", "apple", "google", "adobe"]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Pick the best CVSS base score across v3.1, v3.0, then v2.
function bestCvssScore(metrics) {
  if (!metrics) return { score: null, severity: null, version: null };
  for (const key of ["cvssMetricV31", "cvssMetricV30"]) {
    const arr = metrics[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const m = arr[0];
      const data = m.cvssData || {};
      return {
        score:    data.baseScore ?? null,
        severity: data.baseSeverity ?? null,
        version:  data.version ?? null,
      };
    }
  }
  const v2 = metrics.cvssMetricV2;
  if (Array.isArray(v2) && v2.length > 0) {
    const data = v2[0].cvssData || {};
    let sev = null;
    if (typeof data.baseScore === "number") {
      sev = data.baseScore >= 7 ? "HIGH" : data.baseScore >= 4 ? "MEDIUM" : "LOW";
    }
    return { score: data.baseScore ?? null, severity: sev, version: data.version ?? "2.0" };
  }
  return { score: null, severity: null, version: null };
}

function englishDescription(cve) {
  const descs = cve?.descriptions || [];
  const en = descs.find(d => d.lang === "en");
  return (en?.value || "").trim();
}

async function fetchPage(cpeVendor, startIndex, attempt = 0) {
  const url = `${NVD_BASE}?cpeName=${encodeURIComponent(`cpe:2.3:a:${cpeVendor}:*`)}&resultsPerPage=${PAGE_SIZE}&startIndex=${startIndex}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (res.status === 429 || res.status === 503) {
    if (attempt >= 4) throw new Error(`NVD ${res.status} after ${attempt} retries (${cpeVendor})`);
    const backoff = 15000 * (attempt + 1);
    console.warn(`  [${cpeVendor}] ${res.status} — backing off ${backoff}ms`);
    await sleep(backoff);
    return fetchPage(cpeVendor, startIndex, attempt + 1);
  }
  if (!res.ok) throw new Error(`NVD ${res.status} for ${cpeVendor} startIndex=${startIndex}`);
  return res.json();
}

async function fetchVendor(vendor) {
  const all = [];
  let startIndex = 0;
  let total = Infinity;
  while (startIndex < total) {
    const page = await fetchPage(vendor.cpe, startIndex);
    total = page.totalResults ?? 0;
    const vulns = page.vulnerabilities || [];
    for (const item of vulns) all.push(item.cve);
    console.log(`  [${vendor.cpe}] page ${startIndex}/${total} (+${vulns.length})`);
    startIndex += PAGE_SIZE;
    if (startIndex < total) await sleep(REQ_GAP_MS);
  }
  return all;
}

function aggregate(vendor, cves) {
  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;

  let critical = 0, high = 0;
  const recent = [];
  const enriched = cves.map(cve => {
    const cvss = bestCvssScore(cve.metrics);
    const published = cve.published || null;
    const t = published ? Date.parse(published) : NaN;
    const isRecent = !Number.isNaN(t) && t > cutoff;
    if (typeof cvss.score === "number") {
      if (cvss.score >= 9.0) critical++;
      else if (cvss.score >= 7.0) high++;
    }
    const obj = {
      cveId:        cve.id,
      published,
      lastModified: cve.lastModified || null,
      cvssScore:    cvss.score,
      cvssSeverity: cvss.severity,
      cvssVersion:  cvss.version,
      summary:      englishDescription(cve).slice(0, 400),
      isRecent,
    };
    if (isRecent) recent.push(obj);
    return obj;
  });

  // Top 5 by severity in last 24mo. Tie-break on published date desc.
  const topSeverity = [...recent]
    .filter(c => typeof c.cvssScore === "number")
    .sort((a, b) => {
      if (b.cvssScore !== a.cvssScore) return b.cvssScore - a.cvssScore;
      return (b.published || "").localeCompare(a.published || "");
    })
    .slice(0, 5)
    .map(c => ({
      cveId:        c.cveId,
      cvssScore:    c.cvssScore,
      cvssSeverity: c.cvssSeverity,
      published:    c.published,
      summary:      c.summary,
      url:          `https://nvd.nist.gov/vuln/detail/${c.cveId}`,
    }));

  return {
    vendor:                  vendor.display,
    cpe_vendor:              vendor.cpe,
    total_cves_lifetime:     enriched.length,
    critical_severity_count: critical,
    high_severity_count:     high,
    recent_24mo:             recent.length,
    sample_top_severity:     topSeverity,
  };
}

async function main() {
  const isSmoke = process.argv.includes("--smoke");
  const list = isSmoke ? TECH_VENDORS.filter(v => SMOKE_VENDORS.has(v.cpe)) : TECH_VENDORS;
  console.log(`NVD fetcher starting (${isSmoke ? "SMOKE" : "FULL"}: ${list.length} vendors)...`);

  const vendors = [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    console.log(`\n[${i + 1}/${list.length}] ${v.display} (cpe:2.3:a:${v.cpe}:*)`);
    try {
      const cves = await fetchVendor(v);
      const agg = aggregate(v, cves);
      vendors.push(agg);
      console.log(`  -> total=${agg.total_cves_lifetime} critical=${agg.critical_severity_count} high=${agg.high_severity_count} recent24mo=${agg.recent_24mo}`);
    } catch (err) {
      console.error(`  FAILED ${v.cpe}:`, err.message);
      vendors.push({
        vendor: v.display, cpe_vendor: v.cpe,
        total_cves_lifetime: 0, critical_severity_count: 0, high_severity_count: 0,
        recent_24mo: 0, sample_top_severity: [], error: err.message,
      });
    }
    if (i < list.length - 1) await sleep(REQ_GAP_MS);
  }

  vendors.sort((a, b) => b.total_cves_lifetime - a.total_cves_lifetime);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:  new Date().toISOString(),
    source:        "NIST NVD API 2.0",
    source_url:    "https://nvd.nist.gov/developers/vulnerabilities",
    smoke:         isSmoke,
    vendor_count:  vendors.length,
    vendors,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log("Summary (top 10 by lifetime CVEs):");
  for (const v of vendors.slice(0, 10)) {
    console.log(`  ${v.total_cves_lifetime.toString().padStart(5)} ${v.vendor} (critical=${v.critical_severity_count}, high=${v.high_severity_count}, 24mo=${v.recent_24mo})`);
  }
}

main().catch(err => {
  console.error("nvd-fetch failed:", err);
  process.exit(1);
});
