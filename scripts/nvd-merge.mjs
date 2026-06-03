#!/usr/bin/env node
/**
 * NIST NVD — Step 2: Merge nvd-cves.json into per-company JSON.
 *
 * Reads /public/data/nvd-cves.json (produced by nvd-fetch.mjs) and writes
 * the structured per-vendor aggregates into each matching company file
 * under `enriched.nvd`.
 *
 * Vendor → brand slug routing (mirrors cisa-kev-merge.mjs):
 *   0. VENDOR_OVERRIDES (hand-curated)
 *   1. Direct slug file match
 *   2. slug-aliases.json
 *   3. brand-parent-map.json
 *
 * Locally: node scripts/nvd-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NVD_FILE = path.join(ROOT, "public/data/nvd-cves.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "nvd-merge-log.json");

// Hand-curated overrides for NVD CPE vendor tokens that don't slugify cleanly
// to a TruNorth company slug. Keys = slugified CPE vendor; values = company slug.
const VENDOR_OVERRIDES = {
  "google":     "google-alphabet",
  "alphabet":   "google-alphabet",
  "android":    "google-alphabet",
  "chrome":     "google-alphabet",
  "youtube":    "google-alphabet",
  "meta":       "meta-facebook",
  "facebook":   "meta-facebook",
  "instagram":  "meta-facebook",
  "whatsapp":   "meta-facebook",
  "twitter":    "twitter-x",
  "x":          "twitter-x",
  "linkedin":   "microsoft",
  "github":     "microsoft",
  "aws":        "amazon",
  "amazon":     "amazon",
  "microsoft":  "microsoft",
  "apple":      "apple",
  "adobe":      "adobe",
  "oracle":     "oracle",
  "cisco":      "cisco",
  "ibm":        "ibm",
  "sap":        "sap",
  "samsung":    "samsung",
  "intel":      "intel",
  "amd":        "amd",
  "nvidia":     "nvidia",
  "dell":       "dell",
  "hp":         "hp",
  "vmware":     "vmware",
  "fortinet":   "fortinet",
  "citrix":     "citrix",
  "mozilla":    "mozilla",
  "salesforce": "salesforce",
  "atlassian":  "atlassian",
  "zoom":       "zoom",
  "slack":      "slack",
  "dropbox":    "dropbox",
  "netflix":    "netflix",
  "spotify":    "spotify",
  "uber":       "uber",
  "airbnb":     "airbnb",
  "shopify":    "shopify",
  "paypal":     "paypal",
  "tesla":      "tesla",
  "sony":       "sony",
  "lg":         "lg",
  "lenovo":     "lenovo",
  "asus":       "asus",
  "acer":       "acer",
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

async function mergeOne(entry, maps, now) {
  // Prefer the CPE vendor token (canonical) for routing.
  const vendorSlug = slugifyVendor(entry.cpe_vendor || entry.vendor);
  const { slug: targetSlug, routed_via } = resolveSlug(vendorSlug, maps);
  if (!targetSlug) {
    return { vendor: entry.vendor, vendor_slug: vendorSlug, status: "orphan" };
  }

  const file = path.join(COMP_DIR, `${targetSlug}.json`);
  let company;
  try { company = JSON.parse(await fs.readFile(file, "utf-8")); }
  catch (e) {
    return { vendor: entry.vendor, target: targetSlug, status: "parse_error", error: e.message };
  }

  // If another NVD vendor already merged into this company (e.g. both
  // "Google" and "YouTube" → google-alphabet), keep the larger lifetime count.
  const existing = company?.enriched?.nvd;
  if (existing && existing.totalCvesLifetime >= entry.total_cves_lifetime) {
    return {
      vendor: entry.vendor, target: targetSlug, routed_via,
      status: "skipped_lower_count",
    };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.nvd = {
    vendor:                entry.vendor,
    cpeVendor:             entry.cpe_vendor,
    totalCvesLifetime:     entry.total_cves_lifetime,
    criticalSeverityCount: entry.critical_severity_count,
    highSeverityCount:     entry.high_severity_count,
    recent24mo:            entry.recent_24mo,
    sampleTopSeverity:     entry.sample_top_severity,
    lastUpdated:           now,
    source:                "nist-nvd",
    sourceUrl:             "https://nvd.nist.gov/developers/vulnerabilities",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.nvd = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    vendor:             entry.vendor,
    vendor_slug:        vendorSlug,
    target:             targetSlug,
    routed_via,
    status:             "merged",
    totalCvesLifetime:  entry.total_cves_lifetime,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("NVD merge starting...");

  const nvd = JSON.parse(await fs.readFile(NVD_FILE, "utf-8"));
  const entries = nvd.vendors || [];
  console.log(`${entries.length} vendor entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    if (e.error) {
      results.push({ vendor: e.vendor, status: "fetch_error", error: e.error });
      continue;
    }
    results.push(await mergeOne(e, maps, now));
  }

  const merged  = results.filter(r => r.status === "merged");
  const skipped = results.filter(r => r.status === "skipped_lower_count");
  const orphans = results.filter(r => r.status === "orphan");
  const errors  = results.filter(r => r.status === "parse_error" || r.status === "fetch_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    source_file:    "public/data/nvd-cves.json",
    total_vendors:  entries.length,
    merged_count:   merged.length,
    skipped_count:  skipped.length,
    orphan_count:   orphans.length,
    error_count:    errors.length,
    merged_vendors: merged.map(m => ({
      vendor: m.vendor, target: m.target, routed_via: m.routed_via, cves: m.totalCvesLifetime,
    })),
    orphans: orphans.map(o => ({ vendor: o.vendor, vendor_slug: o.vendor_slug })),
    errors,
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`Skipped (duplicate vendor, lower count): ${skipped.length}`);
  console.log(`Orphan vendors: ${orphans.length}`);
  console.log(`Errors: ${errors.length}`);
  if (merged.length > 0) {
    console.log("\nTop merges:");
    for (const m of merged.sort((a, b) => b.totalCvesLifetime - a.totalCvesLifetime).slice(0, 15)) {
      console.log(`  ${m.totalCvesLifetime.toString().padStart(5)} ${m.vendor} -> ${m.target} (${m.routed_via})`);
    }
  }
}

main().catch(err => {
  console.error("nvd-merge failed:", err);
  process.exit(1);
});
