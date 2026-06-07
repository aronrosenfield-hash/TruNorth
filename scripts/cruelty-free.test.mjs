#!/usr/bin/env node
/**
 * Test harness for the cruelty-free pipeline (B-14).
 *
 * Runs the parsers + slug resolver against 3 fixture HTML files. NO network
 * calls — we deliberately do not ping leapingbunny.org or peta.org from CI
 * or worktree review.
 *
 * Locally: node scripts/cruelty-free.test.mjs
 *
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLeapingBunnyPage } from "./leaping-bunny-fetch.mjs";
import { parsePetaListPage } from "./peta-bwb-fetch.mjs";
import { resolveSlug, slugify } from "./cruelty-free-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "test/fixtures/cruelty-free");

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`); }
}
function truthy(actual, msg) {
  if (actual) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg} (got ${JSON.stringify(actual)})`); }
}

function findBrand(items, name) {
  return items.find(b => b.brand.toLowerCase() === name.toLowerCase());
}

async function loadFakeMaps() {
  // Use the real meta files for resolution checks; this gives confidence the
  // overrides hit real targets in the company universe.
  const meta = path.join(ROOT, "public/data/_meta");
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(meta, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

async function main() {
  console.log("Cruelty-free parser + merge tests\n");

  // --- Leaping Bunny letter L ---
  const lbL = await fs.readFile(path.join(FIXTURES, "leaping-bunny-L.html"), "utf-8");
  const lbItems = parseLeapingBunnyPage(lbL);
  console.log(`\n[leaping-bunny-L.html] parsed ${lbItems.length} brands`);
  for (const it of lbItems) console.log(`  - ${it.brand} (parent: ${it.parent_company || "—"}, since: ${it.certification_date || "—"})`);
  eq(lbItems.length, 4, "LB-L: 4 brands parsed");

  const lush = findBrand(lbItems, "Lush");
  truthy(lush, "LB-L: Lush present");
  eq(lush?.parent_company, "Lush Cosmetics Ltd.", "LB-L: Lush parent parsed");
  eq(lush?.certification_date, "2002-06-15", "LB-L: Lush ISO date parsed");

  const lbp = findBrand(lbItems, "Love Beauty and Planet");
  eq(lbp?.certification_date, "2018-04-12", "LB-L: Love Beauty long-date normalized to ISO");

  const lrp = findBrand(lbItems, "La Roche-Posay");
  truthy(lrp?.parent_company?.includes("L'Oréal") || lrp?.parent_company?.includes("L’Or") || lrp?.parent_company?.toLowerCase().includes("oréal") || lrp?.parent_company?.toLowerCase().includes("oreal"), "LB-L: La Roche-Posay parent contains L'Oreal");

  // --- PETA DON'T test ---
  const petaDont = await fs.readFile(path.join(FIXTURES, "peta-dont-test.html"), "utf-8");
  const dontItems = parsePetaListPage(petaDont);
  console.log(`\n[peta-dont-test.html] parsed ${dontItems.length} brands`);
  for (const it of dontItems) console.log(`  - ${it.brand} (parent: ${it.parent_company || "—"})`);
  eq(dontItems.length, 5, "PETA-DONT: 5 brands parsed");
  truthy(findBrand(dontItems, "Dove"), "PETA-DONT: Dove present");
  truthy(findBrand(dontItems, "Lush"), "PETA-DONT: Lush present");
  truthy(findBrand(dontItems, "Burt's Bees") || findBrand(dontItems, "Burt’s Bees"), "PETA-DONT: Burt's Bees present (entity decoded)");
  truthy(findBrand(dontItems, "e.l.f. Cosmetics"), "PETA-DONT: e.l.f. Cosmetics present");

  // --- PETA DO test ---
  const petaDo = await fs.readFile(path.join(FIXTURES, "peta-do-test.html"), "utf-8");
  const doItems = parsePetaListPage(petaDo);
  console.log(`\n[peta-do-test.html] parsed ${doItems.length} brands`);
  for (const it of doItems) console.log(`  - ${it.brand} (parent: ${it.parent_company || "—"})`);
  eq(doItems.length, 4, "PETA-DO: 4 brands parsed");
  truthy(findBrand(doItems, "Estée Lauder"), "PETA-DO: Estée Lauder present (entity decoded)");
  truthy(findBrand(doItems, "MAC Cosmetics"), "PETA-DO: MAC Cosmetics present");
  truthy(findBrand(doItems, "Maybelline"), "PETA-DO: Maybelline present");

  // --- Slug resolution against real company files ---
  console.log("\nSlug resolution (against real public/data/companies/):\n");
  const maps = await loadFakeMaps();

  // Dove → dove (direct)
  let r = resolveSlug("Dove", null, maps);
  eq(r.slug, "dove", "resolve: Dove → dove");
  eq(r.routed_via, "direct", "resolve: Dove routed_via direct");

  // MAC Cosmetics → mac-cosmetics (override list pre-empts direct match —
  // that's the documented behavior: overrides win first).
  r = resolveSlug("MAC Cosmetics", "The Estée Lauder Companies Inc.", maps);
  eq(r.slug, "mac-cosmetics", "resolve: MAC Cosmetics → mac-cosmetics");
  truthy(["override", "direct"].includes(r.routed_via), `resolve: MAC Cosmetics routed_via ∈ {override, direct} (got ${r.routed_via})`);

  // Estée Lauder → est-e-lauder (override path, since the slugified form is "est-e-lauder" but
  // the slug-alias map sends "estee-lauder" → "est-e-lauder")
  r = resolveSlug("Estée Lauder", "The Estée Lauder Companies Inc.", maps);
  eq(r.slug, "est-e-lauder", "resolve: Estée Lauder → est-e-lauder");

  // e.l.f. Cosmetics → e-l-f-beauty (override)
  r = resolveSlug("e.l.f. Cosmetics", null, maps);
  eq(r.slug, "e-l-f-beauty", "resolve: e.l.f. Cosmetics → e-l-f-beauty");

  // L'Oréal → l-or-al via slug-aliases (loreal → l-or-al)
  r = resolveSlug("L'Oréal", null, maps);
  eq(r.slug, "l-or-al", "resolve: L'Oréal → l-or-al (via slug-aliases)");
  eq(r.routed_via, "alias", "resolve: L'Oréal routed_via alias");

  // Slugify sanity (apostrophes stripped, accents stripped — matches the
  // existing slug-aliases convention)
  eq(slugify("Burt's Bees"), "burts-bees", "slugify: Burt's Bees → burts-bees");
  eq(slugify("L'Oréal"), "loreal", "slugify: L'Oréal → loreal (slug-aliases maps it to l-or-al)");
  eq(slugify("Estée Lauder"), "estee-lauder", "slugify: Estée Lauder → estee-lauder");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
