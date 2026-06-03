#!/usr/bin/env node
/**
 * OSV — Open Source Vulnerabilities (monthly)
 *
 * Queries OSV.dev's vulnerability database for OS/software-shipping vendors
 * and aggregates per-vendor counts. Unlike CISA KEV (which lists exploited
 * CVEs across all vendors), OSV is a comprehensive index of vulns across
 * open-source ecosystems and OS vendor advisories (RHSA, MSRC, GHSA, etc.).
 *
 * Strategy
 * --------
 * OSV's API is package-centric (POST {package:{name,ecosystem}}). For each
 * brand we ship, we maintain a list of (ecosystem, package) tuples that
 * represent that vendor's software footprint. We POST one query per tuple,
 * dedupe vuln IDs across the brand, then aggregate.
 *
 * Output: /public/data/osv.json (overwritten monthly)
 *
 * Per-vendor aggregates:
 *   - total_vulnerabilities — distinct vuln IDs across all packages for vendor
 *   - recent_24mo           — vulns published in last 24 months
 *   - critical_count        — vulns with CRITICAL severity rating
 *   - sample_top_vulns      — 5 most recent w/ summary + URL
 *   - package_breakdown     — top packages by vuln count
 *
 * Runs via .github/workflows/osv-monthly.yml on the 1st @ 09:00 UTC.
 * Locally: node scripts/osv-fetch.mjs
 *
 * Source: https://osv.dev  (Google-operated, free, no auth required)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/osv.json");

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";
const UA = "TruNorth-OSV/1.0 (+https://www.trunorthapp.com)";
const TWENTY_FOUR_MONTHS_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 1000; // 1 req/sec per task spec

// Vendor → ecosystem/package map. Each entry's packages are the canonical
// OS / runtime / browser / cloud surfaces the vendor ships. OSV advisories
// (GHSA, RHSA, MSRC, GO, PYSEC, etc.) attach to these package identifiers.
//
// Ecosystem names follow OSV's vocabulary:
//   https://ossf.github.io/osv-schema/#defined-ecosystems
const VENDORS = [
  {
    vendor: "Microsoft",
    packages: [
      { ecosystem: "NuGet",  name: "Microsoft.AspNetCore.App.Runtime" },
      { ecosystem: "NuGet",  name: "Microsoft.NETCore.App.Runtime" },
      { ecosystem: "NuGet",  name: "Microsoft.Data.SqlClient" },
      { ecosystem: "npm",    name: "@microsoft/teams-js" },
    ],
  },
  {
    vendor: "Google",
    packages: [
      { ecosystem: "Go",     name: "golang.org/x/crypto" },
      { ecosystem: "Go",     name: "golang.org/x/net" },
      { ecosystem: "Maven",  name: "com.google.guava:guava" },
      { ecosystem: "Maven",  name: "com.google.protobuf:protobuf-java" },
      { ecosystem: "npm",    name: "googleapis" },
      { ecosystem: "PyPI",   name: "google-cloud-storage" },
    ],
  },
  {
    vendor: "Mozilla",
    packages: [
      { ecosystem: "crates.io", name: "mozjpeg-sys" },
      { ecosystem: "npm",       name: "mozjpeg" },
      { ecosystem: "PyPI",      name: "bleach" },
      { ecosystem: "Debian:12", name: "firefox-esr" },
      { ecosystem: "Debian:12", name: "nss" },
    ],
  },
  {
    vendor: "Red Hat",
    packages: [
      { ecosystem: "Red Hat", name: "openshift/kubernetes" },
      { ecosystem: "Red Hat", name: "rhel-9/openssl" },
      { ecosystem: "Red Hat", name: "rhel-9/kernel" },
      { ecosystem: "Red Hat", name: "rhel-9/glibc" },
    ],
  },
  {
    vendor: "Apple",
    packages: [
      { ecosystem: "SwiftURL", name: "https://github.com/apple/swift-nio" },
      { ecosystem: "SwiftURL", name: "https://github.com/apple/swift-crypto" },
      { ecosystem: "SwiftURL", name: "https://github.com/apple/swift" },
    ],
  },
  {
    vendor: "Oracle",
    packages: [
      { ecosystem: "Maven",  name: "com.oracle.database.jdbc:ojdbc11" },
      { ecosystem: "Maven",  name: "mysql:mysql-connector-java" },
      { ecosystem: "npm",    name: "oracledb" },
    ],
  },
  {
    vendor: "IBM",
    packages: [
      { ecosystem: "Maven",  name: "com.ibm.icu:icu4j" },
      { ecosystem: "npm",    name: "ibm-cos-sdk" },
      { ecosystem: "PyPI",   name: "ibm-cos-sdk" },
    ],
  },
  {
    vendor: "Adobe",
    packages: [
      { ecosystem: "Maven",  name: "com.adobe.aem:uber-jar" },
      { ecosystem: "npm",    name: "@adobe/reactor-cookie" },
    ],
  },
  {
    vendor: "Amazon",
    packages: [
      { ecosystem: "npm",    name: "aws-sdk" },
      { ecosystem: "npm",    name: "@aws-sdk/client-s3" },
      { ecosystem: "PyPI",   name: "boto3" },
      { ecosystem: "Go",     name: "github.com/aws/aws-sdk-go" },
    ],
  },
  {
    vendor: "Meta",
    packages: [
      { ecosystem: "npm",    name: "react" },
      { ecosystem: "npm",    name: "react-native" },
      { ecosystem: "npm",    name: "graphql" },
      { ecosystem: "PyPI",   name: "torch" },
    ],
  },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function queryOsv(pkg) {
  const body = { package: { name: pkg.name, ecosystem: pkg.ecosystem } };
  const res = await fetch(OSV_QUERY_URL, {
    method:  "POST",
    headers: {
      "User-Agent":   UA,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn(`  [warn] ${pkg.ecosystem}/${pkg.name} -> HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  return data.vulns || [];
}

// OSV severity rating is stored in different shapes across ecosystems.
// GHSA puts a "CRITICAL"/"HIGH"/"MODERATE"/"LOW" string under
// database_specific.severity. Some sources only emit a CVSS vector with no
// pre-computed numeric score, in which case we conservatively don't count
// it as critical.
function isCritical(vuln) {
  const dbSpec = vuln.database_specific || {};
  const rating = String(
    dbSpec.severity || dbSpec.cvss_severity || ""
  ).toUpperCase();
  if (rating === "CRITICAL") return true;
  // Some advisories embed severity inside the severity[].score CVSS vector.
  // A coarse heuristic: if vector contains "/S:C/" (scope changed) and a
  // high impact set we still won't try to score it numerically here — that's
  // out of scope for a monthly aggregate.
  return false;
}

function topN(items, n = 10) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function osvUrl(id) {
  return `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

async function fetchVendor(vendor) {
  console.log(`\n[${vendor.vendor}] ${vendor.packages.length} packages`);
  const byId = new Map(); // dedupe across packages
  const pkgCounts = [];   // (pkg-label) repeated for breakdown

  for (const pkg of vendor.packages) {
    await sleep(RATE_LIMIT_MS);
    let vulns = [];
    try {
      vulns = await queryOsv(pkg);
    } catch (e) {
      console.warn(`  [error] ${pkg.ecosystem}/${pkg.name}: ${e.message}`);
      continue;
    }
    console.log(`  ${pkg.ecosystem}/${pkg.name} -> ${vulns.length} vulns`);
    const label = `${pkg.ecosystem}/${pkg.name}`;
    for (let i = 0; i < vulns.length; i++) pkgCounts.push(label);
    for (const v of vulns) {
      if (!v.id) continue;
      // First-seen wins (OSV returns the same record across multiple packages
      // when one vuln affects many).
      if (!byId.has(v.id)) byId.set(v.id, v);
    }
  }

  const all = [...byId.values()];
  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;

  const sorted = all.sort((a, b) => {
    const ta = Date.parse(a.published || a.modified || "") || 0;
    const tb = Date.parse(b.published || b.modified || "") || 0;
    return tb - ta;
  });

  const recent24mo = sorted.filter(v => {
    const t = Date.parse(v.published || v.modified || "");
    return !Number.isNaN(t) && t > cutoff;
  });

  const critical = sorted.filter(isCritical);

  const topVulns = sorted.slice(0, 5).map(v => ({
    id:         v.id,
    summary:    (v.summary || "").slice(0, 280),
    published:  v.published || null,
    modified:   v.modified  || null,
    aliases:    (v.aliases || []).slice(0, 5),
    url:        osvUrl(v.id),
  }));

  return {
    vendor:                 vendor.vendor,
    total_vulnerabilities:  all.length,
    recent_24mo:            recent24mo.length,
    critical_count:         critical.length,
    sample_top_vulns:       topVulns,
    package_breakdown:      topN(pkgCounts, 10),
    packages_queried:       vendor.packages.length,
  };
}

async function main() {
  console.log("OSV fetcher starting...");
  const vendors = [];
  for (const v of VENDORS) {
    vendors.push(await fetchVendor(v));
  }
  vendors.sort((a, b) => b.total_vulnerabilities - a.total_vulnerabilities);

  console.log("\nVendor totals:");
  for (const v of vendors) {
    console.log(`  ${v.total_vulnerabilities.toString().padStart(5)} ${v.vendor} (24mo=${v.recent_24mo}, critical=${v.critical_count})`);
  }

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:  new Date().toISOString(),
    source:        "osv.dev",
    source_url:    "https://osv.dev",
    vendor_count:  vendors.length,
    vendors,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
}

main().catch(err => {
  console.error("osv-fetch failed:", err);
  process.exit(1);
});
