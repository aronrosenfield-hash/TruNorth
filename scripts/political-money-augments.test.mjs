#!/usr/bin/env node
/**
 * Smoke tests for scripts/political-money-augments.mjs and the three
 * augment files it produces. Validates:
 *   - The augment files exist and have plausible shape.
 *   - At least one well-known brand per source is present in bySlug.
 *   - No false-positive FARA matches against common-word brands.
 *   - Lobby spend dollars look sane (positive, not absurdly large).
 *
 * Locally: node scripts/political-money-augments.test.mjs
 * Exit 0 on success, 1 on any assertion failure.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DERIV_DIR = path.join(ROOT, "data/derived");

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) { pass++; console.log(`  ok  ${msg}`); }
  else { fail++; console.error(`  FAIL ${msg}`); }
}

async function readAugment(name) {
  const p = path.join(DERIV_DIR, `${name}-augment.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

async function main() {
  console.log("political-money-augments smoke tests");

  // ─── usaspending-contracts ──────────────────────────────────────────
  console.log("\n[usaspending-contracts]");
  const contracts = await readAugment("usaspending-contracts");
  check(contracts !== null, "usaspending-contracts-augment.json exists");
  check(contracts?.source === "usaspending-contracts", "source field set");
  check(typeof contracts?.source_url === "string" && /usaspending\.gov/.test(contracts.source_url),
    "source_url cites USAspending.gov");
  check(contracts?.bySlug && Object.keys(contracts.bySlug).length >= 50,
    `bySlug has ≥50 entries (actual: ${Object.keys(contracts?.bySlug || {}).length})`);
  // Known anchors
  for (const slug of ["lockheed-martin", "boeing", "general-dynamics"]) {
    const v = contracts?.bySlug?.[slug];
    check(v && v.usd > 0, `${slug} present with usd > 0`);
  }
  // Lockheed should be the largest contractor
  const top = Object.entries(contracts?.bySlug || {})
    .sort((a, b) => b[1].usd - a[1].usd)[0];
  check(top?.[0] === "lockheed-martin", `top contractor is lockheed-martin (got ${top?.[0]})`);
  check(top?.[1]?.usd >= 50_000_000_000, "top contractor ≥ $50B");

  // ─── senate-lda ─────────────────────────────────────────────────────
  console.log("\n[senate-lda]");
  const lobby = await readAugment("senate-lda");
  check(lobby !== null, "senate-lda-augment.json exists");
  check(lobby?.source === "senate-lda", "source field set");
  check(typeof lobby?.source_url === "string" && /lda\.senate\.gov/.test(lobby.source_url),
    "source_url cites Senate LDA");
  check(lobby?.bySlug && Object.keys(lobby.bySlug).length >= 50,
    `bySlug has ≥50 entries (actual: ${Object.keys(lobby?.bySlug || {}).length})`);
  // Known anchors
  for (const slug of ["pfizer", "amazon", "boeing"]) {
    const v = lobby?.bySlug?.[slug];
    check(v && v.usd > 0, `${slug} present with usd > 0`);
  }
  // Spend dollars sane (under $200M for any single client)
  const maxSpend = Math.max(...Object.values(lobby?.bySlug || {}).map(v => v.usd));
  check(maxSpend < 200_000_000, `max single-client lobby ≤ $200M (got $${(maxSpend / 1e6).toFixed(0)}M)`);
  // No NaN spends
  const allNumeric = Object.values(lobby?.bySlug || {}).every(v => Number.isFinite(v.usd) && v.usd > 0);
  check(allNumeric, "all entries have finite, positive usd");

  // ─── fara ──────────────────────────────────────────────────────────
  console.log("\n[fara]");
  const fara = await readAugment("fara");
  check(fara !== null, "fara-augment.json exists");
  if (fara) {
    check(fara.source === "fara", "source field set");
    check(/efile\.fara\.gov/.test(fara.source_url || ""), "source_url cites efile.fara.gov");
    check(typeof fara.fara_snapshot === "string", "fara_snapshot timestamp set");
    // High-quality matches — no common-word false positives
    const FALSE_POSITIVES = new Set(["mercury", "vanguard", "royal", "international", "global", "american", "national"]);
    const noFalsePos = Object.keys(fara.bySlug || {}).every(s => !FALSE_POSITIVES.has(s));
    check(noFalsePos, "no false-positive matches on common-word brand slugs");
    // Schema: each entry has registrations array + countries array
    const allShaped = Object.values(fara.bySlug || {}).every(v =>
      Array.isArray(v.registrations) && Array.isArray(v.countries) && typeof v.registration_count === "number"
    );
    check(allShaped, "all entries have registrations[], countries[], registration_count");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("test harness error:", err);
  process.exit(2);
});
