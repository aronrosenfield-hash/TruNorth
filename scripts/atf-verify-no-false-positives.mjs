#!/usr/bin/env node
/**
 * ATF FFL false-positive verifier — B-37.
 *
 * Scans every per-company JSON under public/data/companies/ and asserts:
 *
 *   For any company that has `firearms_atf_ffl` attached, at least one
 *   of these must be true:
 *
 *     (a) Slug is in the curated allow-list (scripts/atf-allowlist.json),
 *         OR
 *     (b) Category is in the legitimate-FFL-holder set
 *         {Defense & Aerospace, Manufacturing, Retail, Outdoor,
 *          Sports & Fitness, Aerospace}, AND category is NOT in the
 *         hard blocklist, AND the company has a CIK or ticker
 *         (i.e. a real public entity), OR
 *     (c) `wiki.cik` (or top-level `cik`) is set — i.e. the company
 *         has a SEC-corroborated identity, even outside the allowed
 *         categories.
 *
 * Anything that fails all three is a violation and gets printed. Exit
 * code is non-zero if any violation is found, so this can run in CI.
 *
 * Usage:
 *   node scripts/atf-verify-no-false-positives.mjs
 *   node scripts/atf-verify-no-false-positives.mjs --json   # machine-readable
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const ALLOWLIST = path.join(__dirname, "atf-allowlist.json");

const AS_JSON = process.argv.includes("--json");

const INDUSTRY_BLOCKLIST = new Set([
  "Technology", "Entertainment & Media", "Financial Services", "Healthcare",
  "Apparel & Fashion", "Professional Services", "Food & Beverage", "Beverage",
  "Telecommunications", "Transportation", "Hospitality", "Hospitality & Travel",
  "Real Estate", "Education", "Insurance", "Energy", "Automotive",
  "Travel", "Travel & Hospitality", "Grocery", "Consumer Goods",
  "Pet Care", "Beauty & Personal Care", "Furniture & Home", "Agriculture",
  "Utilities", "Utility", "Airline", "Chemicals & Materials", "Other", "na",
]);

const INDUSTRY_ALLOW_CATEGORIES = new Set([
  "Defense & Aerospace", "Manufacturing", "Retail",
  "Outdoor", "Sports & Fitness", "Aerospace",
]);

async function loadAllowSlugs() {
  const raw = JSON.parse(await fs.readFile(ALLOWLIST, "utf-8"));
  const slugs = new Set();
  for (const section of ["retailers", "manufacturers", "defense"]) {
    for (const slug of Object.keys(raw[section] || {})) slugs.add(slug);
  }
  return slugs;
}

async function main() {
  const allowSlugs = await loadAllowSlugs();
  const files = await fs.readdir(COMP_DIR);

  let scanned   = 0;
  let withFfl   = 0;
  const violations = [];

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    scanned++;
    let doc;
    try { doc = JSON.parse(await fs.readFile(path.join(COMP_DIR, f), "utf-8")); }
    catch { continue; }
    if (!doc.firearms_atf_ffl) continue;
    withFfl++;

    const slug   = f.replace(/\.json$/, "");
    const cat    = doc.cat || "";
    const ticker = doc.ticker || doc?.wiki?.ticker;
    const cik    = doc.cik    || doc?.wiki?.cik;

    // (a) allow-list
    if (allowSlugs.has(slug)) continue;

    // (b) credible category + public-entity identity
    const catOk     = INDUSTRY_ALLOW_CATEGORIES.has(cat) && !INDUSTRY_BLOCKLIST.has(cat);
    const hasIdent  = !!(ticker || cik);
    if (catOk && hasIdent) continue;

    // (c) CIK by itself (SEC-corroborated identity)
    if (cik) continue;

    violations.push({
      slug,
      name:        doc.name,
      cat,
      ticker:      ticker || null,
      cik:         cik || null,
      primaryRole: doc.firearms_atf_ffl?.primaryRole,
      fflTypes:    doc.firearms_atf_ffl?.fflTypes,
      states:      doc.firearms_atf_ffl?.states,
      reason:      reasonFor({ allowSlugs, slug, cat, catOk, hasIdent, cik }),
    });
  }

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({
      scanned, with_ffl: withFfl,
      violation_count: violations.length,
      violations,
    }, null, 2) + "\n");
  } else {
    console.log(`Scanned ${scanned} companies, ${withFfl} carry firearms_atf_ffl.`);
    console.log("");
    if (violations.length === 0) {
      console.log("PASS — no false-positive FFL attachments found.");
    } else {
      console.log(`FAIL — ${violations.length} violation(s):`);
      console.log("");
      for (const v of violations) {
        console.log(`  ${v.slug.padEnd(40)} ${(v.name || "").padEnd(35)} cat=${(v.cat || "?").padEnd(22)} role=${v.primaryRole}`);
        console.log(`    └─ ${v.reason}`);
      }
    }
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

function reasonFor({ allowSlugs, slug, cat, catOk, hasIdent, cik }) {
  if (!allowSlugs.has(slug) && !catOk && !cik) {
    return `slug not in allow-list, category "${cat}" not in FFL-allow categories, and no CIK on file`;
  }
  if (catOk && !hasIdent) {
    return `slug not in allow-list, category "${cat}" is plausible but company has no CIK/ticker (cannot verify entity)`;
  }
  return "no gate satisfied";
}

main().catch((err) => {
  console.error("verify failed:", err);
  process.exit(2);
});
