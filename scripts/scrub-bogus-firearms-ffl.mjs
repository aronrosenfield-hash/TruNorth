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
  // 2026-06-06 (B-37 prep / dealer follow-up) — second wave of false positives
  // surfaced after the first scrub. Sierra Nevada the brewery was matched to
  // Sierra Nevada Corp (defense). Mars-Wrigley was matched to a "Mars" defense
  // vendor. French's mustard was matched to a small pawnbroker. None of these
  // industries hold real FFLs.
  "Beverage",
  "Consumer Goods",         // covers Mars, French's, Craftsman, Wilson Sporting (golf), etc.
  "Grocery",                // Safeway, QFC — grocery chains don't hold FFLs
]);

// 2026-06-06: also scrub clearly-bogus consumer-staples brands that landed in
// an ambiguous Retail category. Walmart legitimately holds FFL dealer licenses
// (firearms in sporting-goods sections of some stores) so it stays. Other
// retailers without a credible firearms-retail presence get explicit removal.
const FORCE_SCRUB_BY_SLUG = new Set([
  "arhaus",            // upscale furniture
  "fontana",           // unclear what this is — name collision likely
  "custom-shop",       // generic name
  "prime",             // generic name — probably Amazon Prime / Prime Hydration
  "geo",               // probably Geo (Hyundai) or a satellite company
  "mks",
  "iac",
  "hansens",
  "eldorado",          // could be gaming/casino brand
  "rogers",            // probably Rogers Communications (telecom) or sporting goods false positive
  "sawyers",           // false positive — name only
  "true-value",        // hardware chain — could be legit FFL dealer in some stores; revisit
  "ace-hardware",      // hardware chain — same case as True Value
  "wilson-sporting-goods", // tennis/golf brand
  "dupont",            // chemicals giant — not a gun dealer
  "dover-corporation", // industrial conglomerate — clearly not
  "safeway",           // grocery
  "qfc",               // grocery
  "craftsman",         // tools brand (Stanley Black & Decker)
  "eos",               // lip balm
  "sos",
  "dts-inc",           // audio tech
  "bang",              // beverage (Bang Energy)
  "huntsman",          // chemicals company
  "graco",             // pumps/baby gear
  "sierra-nevada",     // brewery
  "mars",              // candy giant
  "rca",               // electronics brand
  "frenchs",           // mustard
]);

// 2026-06-13 (review entity-resolution): genuine firearms retailers whose gun
// evidence happens to be the bare ATF-FFL registry — keep them flagged even
// though they'd otherwise trip the registry-collision rule below. (The
// editorially-sourced sellers — Bass Pro, Cabela's, Walmart, Sam's Club, Vista
// Outdoor — don't match the registry pattern, so they're safe already.)
const GUNS_KEEP = new Set(["dunhams-sports", "dunham-s-sports"]);
const FFL_REGISTRY_RE = /ATF FFL regist/i;

let scanned = 0, scrubbed = 0;
const removed = [];

for (const fname of fs.readdirSync(DIR)) {
  if (!fname.endsWith(".json")) continue;
  scanned++;
  const fp = path.join(DIR, fname);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { continue; }

  const slug = fname.replace(".json","");
  const gunsEnum = String(doc.sc?.guns || "").toLowerCase();
  const isGunStance = gunsEnum === "sells_guns" || gunsEnum === "makes_guns";
  const registryOnly = FFL_REGISTRY_RE.test(String(doc.guns?.s || ""));
  const hitByCategory = SCRUB_CATEGORIES.has(doc.cat || "");
  const hitBySlug = FORCE_SCRUB_BY_SLUG.has(slug);
  // 2026-06-13: registry-only FFL matches on a gun STANCE enum are name
  // collisions (Safeway, Arhaus, TK Holdings/Takata, generic short names…)
  // unless the brand is a known firearms retailer. Catch them by RULE so we
  // don't have to enumerate every collision slug.
  const hitByRegistry = isGunStance && registryOnly && !GUNS_KEEP.has(slug);
  if (!hitByCategory && !hitBySlug && !hitByRegistry) continue;
  if (!doc.firearms_atf_ffl && !isGunStance) continue; // nothing left to scrub

  const role = doc.firearms_atf_ffl?.primaryRole || gunsEnum || "?";
  removed.push({ slug, name: doc.name, cat: doc.cat, role, why: hitByRegistry ? "registry" : hitBySlug ? "slug" : "category" });
  // 2026-06-13 fix: the old scrub deleted only the data block and left
  // sc.guns / guns.s behind, so collisions still rendered as gun sellers.
  // Clear the stance enum and the registry narrative too.
  if (doc.firearms_atf_ffl) delete doc.firearms_atf_ffl;
  if (isGunStance && doc.sc) doc.sc.guns = "neutral";
  if (registryOnly && doc.guns) doc.guns = { s: "No public record found.", sources: [] };
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
