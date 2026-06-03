#!/usr/bin/env node
/**
 * CISA KEV — Known Exploited Vulnerabilities catalog (weekly)
 *
 * Downloads CISA's KEV JSON feed once (single download, no per-brand loop)
 * and aggregates per vendor (vendorProject field). The KEV catalog tracks
 * vulnerabilities actively exploited in the wild — a high-quality
 * privacy/security signal for tech brands.
 *
 * Output: /public/data/cisa-kev.json (overwritten weekly)
 *
 * Source: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
 * Feed:   https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * Per-vendor aggregates:
 *   - total_cve_count       — all-time count for vendor
 *   - recent_12mo_count     — CVEs added to KEV in last 12 months
 *   - ransomware_count      — CVEs flagged knownRansomwareCampaignUse=Known
 *   - product_breakdown     — top products (top 10)
 *   - top_cves              — 5 most recently added (with NVD URL)
 *   - highest_severity      — ransomware-flagged or most recent items
 *
 * Runs via .github/workflows/cisa-kev-weekly.yml Monday 00:00 UTC.
 * Locally: node scripts/cisa-kev-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/cisa-kev.json");

const KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const UA = "TruNorth-CISA-KEV/1.0 (+https://www.trunorthapp.com)";
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

// Returns the top N values + their counts from an array of strings.
function topN(items, n = 10) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function nvdUrl(cveID) {
  return `https://nvd.nist.gov/vuln/detail/${cveID}`;
}

async function fetchKev() {
  const res = await fetch(KEV_URL, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`KEV download failed: ${res.status}`);
  return res.json();
}

function aggregateByVendor(vulns) {
  const cutoff = Date.now() - TWELVE_MONTHS_MS;
  const byVendor = new Map();

  for (const v of vulns) {
    const vendor = (v.vendorProject || "").trim();
    if (!vendor) continue;
    if (!byVendor.has(vendor)) {
      byVendor.set(vendor, []);
    }
    byVendor.get(vendor).push(v);
  }

  const out = [];
  for (const [vendor, items] of byVendor.entries()) {
    // Sort by dateAdded desc
    const sorted = [...items].sort((a, b) =>
      (b.dateAdded || "").localeCompare(a.dateAdded || ""));

    const recent12mo = sorted.filter(v => {
      const t = Date.parse(v.dateAdded);
      return !Number.isNaN(t) && t > cutoff;
    });

    const ransomware = sorted.filter(v =>
      (v.knownRansomwareCampaignUse || "").toLowerCase() === "known");

    const topCves = sorted.slice(0, 5).map(v => ({
      cveID:                       v.cveID,
      product:                     v.product,
      vulnerabilityName:           v.vulnerabilityName,
      dateAdded:                   v.dateAdded,
      dueDate:                     v.dueDate,
      knownRansomwareCampaignUse:  v.knownRansomwareCampaignUse,
      shortDescription:            v.shortDescription,
      requiredAction:              v.requiredAction,
      url:                         nvdUrl(v.cveID),
    }));

    // Highest severity = ransomware-flagged items first, then most recent.
    // KEV doesn't carry CVSS, but ransomware use is the strongest signal it does carry.
    const highestSeverity = [
      ...ransomware.slice(0, 3),
      ...sorted.filter(v => (v.knownRansomwareCampaignUse || "").toLowerCase() !== "known").slice(0, 2),
    ].slice(0, 5).map(v => ({
      cveID:                       v.cveID,
      product:                     v.product,
      vulnerabilityName:           v.vulnerabilityName,
      dateAdded:                   v.dateAdded,
      knownRansomwareCampaignUse:  v.knownRansomwareCampaignUse,
      url:                         nvdUrl(v.cveID),
    }));

    out.push({
      vendor,
      total_cve_count:    sorted.length,
      recent_12mo_count:  recent12mo.length,
      ransomware_count:   ransomware.length,
      product_breakdown:  topN(sorted.map(v => v.product), 10),
      top_cves:           topCves,
      highest_severity:   highestSeverity,
    });
  }

  // Sort vendors by total_cve_count desc.
  out.sort((a, b) => b.total_cve_count - a.total_cve_count);
  return out;
}

async function main() {
  console.log("CISA KEV fetcher starting...");
  // Courtesy: a single tiny pause to honor the 1 req/sec rule against CISA
  // even though this is a one-shot download. (Future-proof if we ever add
  // a second request.)
  await new Promise(r => setTimeout(r, 1000));

  const data = await fetchKev();
  const vulns = data.vulnerabilities || [];
  console.log(`Downloaded ${vulns.length} CVEs (catalog dated ${data.dateReleased})`);

  const vendors = aggregateByVendor(vulns);
  console.log(`Aggregated into ${vendors.length} unique vendors`);
  console.log("Top 10 by CVE count:");
  for (const v of vendors.slice(0, 10)) {
    console.log(`  ${v.total_cve_count.toString().padStart(4)} ${v.vendor} (12mo=${v.recent_12mo_count}, ransomware=${v.ransomware_count})`);
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:       new Date().toISOString(),
    catalog_version:    data.catalogVersion ?? null,
    catalog_released:   data.dateReleased ?? null,
    total_cve_count:    vulns.length,
    vendor_count:       vendors.length,
    source_url:         KEV_URL,
    vendors,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch(err => {
  console.error("cisa-kev-fetch failed:", err);
  process.exit(1);
});
