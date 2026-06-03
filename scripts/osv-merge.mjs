#!/usr/bin/env node
/**
 * OSV — Step 2: Merge osv.json into per-company JSON.
 *
 * Reads /public/data/osv.json (produced monthly by osv-fetch.mjs) and writes
 * the structured payload into each matching company file under
 * `enriched.osv`.
 *
 * Routing (same pattern as cisa-kev-merge):
 *   1. Hand-curated VENDOR_OVERRIDES
 *   2. Direct slug match (microsoft → microsoft.json)
 *   3. slug-aliases.json
 *   4. brand-parent-map.json
 *
 * Locally: node scripts/osv-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OSV_FILE  = path.join(ROOT, "public/data/osv.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(META_DIR, "osv-merge-log.json");

const VENDOR_OVERRIDES = {
  "google":    "google-alphabet",
  "alphabet":  "google-alphabet",
  "meta":      "meta-facebook",
  "facebook":  "meta-facebook",
  "red-hat":   "red-hat",
  "redhat":    "red-hat",
  "ibm":       "ibm",
  "microsoft": "microsoft",
  "apple":     "apple",
  "amazon":    "amazon",
  "oracle":    "oracle",
  "adobe":     "adobe",
  "mozilla":   "mozilla",
};

function slugifyVendor(vendor) {
  return String(vendor)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

function resolveSlug(vendorSlug, maps) {
  if (VENDOR_OVERRIDES[vendorSlug]) {
    const tgt = VENDOR_OVERRIDES[vendorSlug];
    if (existsSync(path.join(COMP_DIR, `${tgt}.json`))) {
      return { slug: tgt, routed_via: "override" };
    }
  }
  if (existsSync(path.join(COMP_DIR, `${vendorSlug}.json`))) {
    return { slug: vendorSlug, routed_via: "direct" };
  }
  const alias = maps.aliases[vendorSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  const parent = maps.parents[vendorSlug]?.parent;
  if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) {
    return { slug: parent, routed_via: "parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

async function mergeOne(vendorEntry, maps, now) {
  const vendorSlug = slugifyVendor(vendorEntry.vendor);
  const { slug: targetSlug, routed_via } = resolveSlug(vendorSlug, maps);
  if (!targetSlug) {
    return { vendor: vendorEntry.vendor, vendor_slug: vendorSlug, status: "orphan" };
  }

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) {
    return { vendor: vendorEntry.vendor, target: targetSlug, status: "parse_error", error: e.message };
  }

  // If a higher-count OSV vendor already merged into this slug, keep larger.
  const existing = company?.enriched?.osv;
  if (existing && existing.totalVulnerabilities >= vendorEntry.total_vulnerabilities) {
    return {
      vendor: vendorEntry.vendor, target: targetSlug, routed_via,
      status: "skipped_lower_count",
    };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.osv = {
    vendor:                vendorEntry.vendor,
    totalVulnerabilities:  vendorEntry.total_vulnerabilities,
    recent24mo:            vendorEntry.recent_24mo,
    criticalCount:         vendorEntry.critical_count,
    sampleTopVulns:        vendorEntry.sample_top_vulns,
    packageBreakdown:      vendorEntry.package_breakdown,
    packagesQueried:       vendorEntry.packages_queried,
    lastUpdated:           now,
    source:                "osv",
    sourceUrl:             "https://osv.dev",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.osv = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    vendor:                vendorEntry.vendor,
    vendor_slug:           vendorSlug,
    target:                targetSlug,
    routed_via,
    status:                "merged",
    totalVulnerabilities:  vendorEntry.total_vulnerabilities,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("OSV merge starting...");

  const osv = JSON.parse(await fs.readFile(OSV_FILE, "utf-8"));
  const entries = osv.vendors || [];
  console.log(`${entries.length} vendor entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped_lower_count");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    source_file:    "public/data/osv.json",
    total_vendors:  entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    merged_vendors: merged.map(m => ({
      vendor: m.vendor, target: m.target, routed_via: m.routed_via,
      vulns: m.totalVulnerabilities,
    })),
    orphans: orphans.map(o => ({ vendor: o.vendor, vendor_slug: o.vendor_slug })),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`Skipped (duplicate vendor, lower count): ${skipped.length}`);
  console.log(`Orphan vendors: ${orphans.length}`);
  console.log(`Errors: ${errors.length}`);
  if (merged.length > 0) {
    console.log("\nMerges:");
    for (const m of merged.sort((a, b) => b.totalVulnerabilities - a.totalVulnerabilities)) {
      console.log(`  ${m.totalVulnerabilities.toString().padStart(5)} ${m.vendor} -> ${m.target} (${m.routed_via})`);
    }
  }
}

main().catch(err => {
  console.error("osv-merge failed:", err);
  process.exit(1);
});
