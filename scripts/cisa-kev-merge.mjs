#!/usr/bin/env node
/**
 * CISA KEV — Step 2: Merge cisa-kev.json into per-company JSON.
 *
 * Reads /public/data/cisa-kev.json (produced weekly by cisa-kev-fetch.mjs)
 * and writes the structured `cisaKev` field into each matching company file
 * under `enriched.cisaKev`.
 *
 * Per-vendor → brand slug matching is fuzzy:
 *   1. Normalize vendor name: lowercase, strip punctuation, collapse spaces → slug
 *   2. Direct file match (microsoft → microsoft.json)
 *   3. slug-aliases.json lookup
 *   4. brand-parent-map.json lookup
 *   5. Hand-curated VENDOR_OVERRIDES for known mismatches (Google → google-alphabet)
 *
 * Honors slug-aliases + brand-parent-map for routing. Skips vendors with
 * no matching company file (most KEV vendors are obscure niche security
 * vendors with no consumer brand presence — that's expected).
 *
 * Locally: node scripts/cisa-kev-merge.mjs
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const KEV_FILE  = path.join(ROOT, "public/data/cisa-kev.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(META_DIR, "cisa-kev-merge-log.json");

// Hand-curated overrides for CISA vendor names that don't slugify cleanly
// to a TruNorth company slug. Keys are the slugified vendor name; values
// are the target company slug.
const VENDOR_OVERRIDES = {
  "google":             "google-alphabet",
  "alphabet":           "google-alphabet",
  "android":            "google-alphabet",
  "chrome":             "google-alphabet",
  "fitbit":             "google-alphabet",
  "nest":               "google-alphabet",
  "youtube":            "google-alphabet",
  "meta":               "meta-facebook",
  "facebook":           "meta-facebook",
  "instagram":          "meta-facebook",
  "whatsapp":           "meta-facebook",
  "x":                  "twitter-x",
  "twitter":            "twitter-x",
  "amazon-web-services": "amazon",
  "aws":                "amazon",
  "microsoft":          "microsoft",
  "apple":              "apple",
  "cisco":              "cisco",
  "adobe":              "adobe",
  "oracle":             "oracle",
  "ibm":                "ibm",
  "sap":                "sap",
  "samsung":            "samsung",
  "intel":              "intel",
  "amd":                "amd",
  "nvidia":             "nvidia",
  "dell":               "dell",
  "hp":                 "hp",
  "hewlett-packard":    "hp",
  "hp-enterprise":      "hewlett-packard-enterprise",
  "vmware":             "vmware",
  "fortinet":           "fortinet",
  "citrix":             "citrix",
  "mozilla":            "mozilla",
  "tp-link":            "tp-link",
  "d-link":             "d-link",
  "netgear":            "netgear",
  "qnap":               "qnap",
  "synology":           "synology",
};

function slugifyVendor(vendor) {
  return String(vendor)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")    // strip accents
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
  // 0. Hand-curated override beats everything
  if (VENDOR_OVERRIDES[vendorSlug]) {
    const tgt = VENDOR_OVERRIDES[vendorSlug];
    if (existsSync(path.join(COMP_DIR, `${tgt}.json`))) {
      return { slug: tgt, routed_via: "override" };
    }
  }
  // 1. Direct match
  if (existsSync(path.join(COMP_DIR, `${vendorSlug}.json`))) {
    return { slug: vendorSlug, routed_via: "direct" };
  }
  // 2. slug-aliases
  const alias = maps.aliases[vendorSlug];
  if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) {
    return { slug: alias, routed_via: "alias" };
  }
  // 3. brand-parent-map
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

  // If another KEV vendor already merged into this company (e.g. both
  // "Google" and "Android" → google-alphabet), keep the larger count.
  const existing = company?.enriched?.cisaKev;
  if (existing && existing.totalCveCount >= vendorEntry.total_cve_count) {
    return {
      vendor: vendorEntry.vendor, target: targetSlug, routed_via,
      status: "skipped_lower_count",
    };
  }

  if (!company.enriched || typeof company.enriched !== "object") company.enriched = {};

  company.enriched.cisaKev = {
    vendor:             vendorEntry.vendor,
    totalCveCount:      vendorEntry.total_cve_count,
    recent12moCount:    vendorEntry.recent_12mo_count,
    ransomwareCount:    vendorEntry.ransomware_count,
    productBreakdown:   vendorEntry.product_breakdown,
    topCves:            vendorEntry.top_cves,
    highestSeverity:    vendorEntry.highest_severity,
    lastUpdated:        now,
    source:             "cisa-kev",
    sourceUrl:          "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
  };

  if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
    company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
  }
  company.dataLastUpdated.cisaKev = now;

  await fs.writeFile(file, JSON.stringify(company));

  return {
    vendor:        vendorEntry.vendor,
    vendor_slug:   vendorSlug,
    target:        targetSlug,
    routed_via,
    status:        "merged",
    totalCveCount: vendorEntry.total_cve_count,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log("CISA KEV merge starting...");

  const kev = JSON.parse(await fs.readFile(KEV_FILE, "utf-8"));
  const entries = kev.vendors || [];
  console.log(`${entries.length} vendor entries`);

  const maps = await loadMaps();

  const results = [];
  for (const e of entries) {
    results.push(await mergeOne(e, maps, now));
  }

  const merged   = results.filter(r => r.status === "merged");
  const skipped  = results.filter(r => r.status === "skipped_lower_count");
  const orphans  = results.filter(r => r.status === "orphan");
  const errors   = results.filter(r => r.status === "parse_error");

  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:        now,
    source_file:      "public/data/cisa-kev.json",
    total_vendors:    entries.length,
    merged_count:     merged.length,
    skipped_count:    skipped.length,
    orphan_count:     orphans.length,
    error_count:      errors.length,
    merged_vendors:   merged.map(m => ({ vendor: m.vendor, target: m.target, routed_via: m.routed_via, cves: m.totalCveCount })),
    // Only log top-30 orphans by CVE count so the log stays scannable.
    top_orphans:      orphans
      .map(o => {
        const entry = entries.find(e => e.vendor === o.vendor);
        return { vendor: o.vendor, vendor_slug: o.vendor_slug, cves: entry?.total_cve_count ?? 0 };
      })
      .sort((a, b) => b.cves - a.cves)
      .slice(0, 30),
  }, null, 2));

  console.log(`Merged: ${merged.length}`);
  console.log(`Skipped (duplicate vendor, lower count): ${skipped.length}`);
  console.log(`Orphan vendors: ${orphans.length}`);
  console.log(`Errors: ${errors.length}`);
  if (merged.length > 0) {
    console.log("\nTop merges:");
    for (const m of merged.sort((a, b) => b.totalCveCount - a.totalCveCount).slice(0, 15)) {
      console.log(`  ${m.totalCveCount.toString().padStart(4)} ${m.vendor} -> ${m.target} (${m.routed_via})`);
    }
  }
}

main().catch(err => {
  console.error("cisa-kev-merge failed:", err);
  process.exit(1);
});
