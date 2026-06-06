#!/usr/bin/env node
/**
 * 2026-06-05 emergency scrub.
 *
 * The ATF FFL ingestion (scripts/atf-fetch.mjs + atf-merge.mjs) used
 * name-only fuzzy matching against the ATF Federal Firearms Licensee
 * list, generating ~49 false-positive "Manufactures" flags and many
 * "Dealer" flags on major consumer brands that share words with small
 * gun shops / manufacturers (Uber, AMD, Fox Corp, TaylorMade, CME, etc.)
 *
 * This is libel-adjacent risk: pre-launch, a user pulling up Uber and
 * seeing "Firearms policy · Manufactures" in red is a real reputational
 * hit for TruNorth.
 *
 * Surgical fix: scrub `firearms_atf_ffl` from companies whose category
 * is in a deny-list of clearly-not-gun industries. Keeps Defense,
 * Manufacturing, Retail, Sporting Goods — those need manual review
 * later (some are real). The systemic fix (re-ingest with ticker /
 * CIK matching + manual whitelist) is logged to BACKLOG as B-37.
 *
 * Idempotent: re-running on a clean tree does nothing.
 * Run:
 *   node scripts/scrub-bogus-firearms-ffl.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DIR = "public/data/companies";

// Industries where an ATF FFL match is almost certainly a name collision
// with a small business that shares words with the consumer brand. If
// you're a financial services firm or rideshare app, you don't have
// a Type 07 manufacturing license.
const SCRUB_CATEGORIES = new Set([
  "Technology",
  "Entertainment & Media",
  "Financial Services",
  "Healthcare",
  "Apparel & Fashion",      // includes golf-apparel false positives like TaylorMade
  "Professional Services",
  "Food & Beverage",
  "Telecommunications",
  "Transportation",
  "Hospitality",
  "Real Estate",
  "Education",
  "Insurance",
  "Energy",
  "Automotive",             // car brands aren't gun makers; auto-parts shops are separate
  "Travel & Hospitality",
  "Other",                  // too ambiguous — better safe than sued
]);

let scanned = 0, scrubbed = 0;
const removed = [];

for (const fname of fs.readdirSync(DIR)) {
  if (!fname.endsWith(".json")) continue;
  scanned++;
  const fp = path.join(DIR, fname);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { continue; }

  if (!doc.firearms_atf_ffl) continue;
  if (!SCRUB_CATEGORIES.has(doc.cat || "")) continue;

  const role = doc.firearms_atf_ffl.primaryRole || "?";
  removed.push({ slug: fname.replace(".json",""), name: doc.name, cat: doc.cat, role });
  delete doc.firearms_atf_ffl;
  fs.writeFileSync(fp, JSON.stringify(doc, null, 2) + "\n");
  scrubbed++;
}

console.log(`Scanned ${scanned} companies.`);
console.log(`Scrubbed firearms_atf_ffl from ${scrubbed} companies in deny-list categories.`);
console.log("");
console.log("Scrubbed companies (review for any that SHOULD have stayed):");
for (const r of removed) {
  console.log(`  ${r.slug.padEnd(40)} ${r.name.padEnd(35)} cat=${r.cat.padEnd(25)} was=${r.role}`);
}
console.log("");
console.log("⚠️  Companies in Defense, Manufacturing, Retail, Sporting Goods etc.");
console.log("    were NOT scrubbed — they need manual review. See BACKLOG B-37.");
