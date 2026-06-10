#!/usr/bin/env node
/**
 * state-lobbying-r5-merge.mjs — diagnostic merge / slug-routing check.
 *
 * The actual per-company writes happen through the unified writer at
 * scripts/apply-augments-to-companies.mjs (the writer named
 * "state-lobbying-r5"). This script is the dry-run companion: it loads
 * data/derived/state-lobbying-r5-augment.json, resolves every slug
 * against the company-files universe + slug-aliases + brand-parent-map,
 * and writes a log to public/data/_meta/state-lobbying-r5-merge-log.json
 * so a human can audit which entries hit, which need an alias, and
 * which are likely false positives.
 *
 * No company JSON files are mutated here. To actually write, run the
 * unified `node scripts/apply-augments-to-companies.mjs` afterwards.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INTL_FIRST_TOKEN_BLOCKLIST } from "./lib/intl-regulator-resolve.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AUG_FILE = path.join(ROOT, "data/derived/state-lobbying-r5-augment.json");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const LOG_FILE = path.join(META_DIR, "state-lobbying-r5-merge-log.json");

async function loadCompanySlugs() {
  try {
    const files = await fs.readdir(COMP_DIR);
    return new Set(files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)));
  } catch {
    return new Set();
  }
}

async function loadMaps() {
  const tryLoad = async (p) => {
    try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return {}; }
  };
  return {
    aliases: await tryLoad(path.join(META_DIR, "slug-aliases.json")),
    parents: await tryLoad(path.join(META_DIR, "brand-parent-map.json")),
  };
}

/**
 * resolveSlug — light wrapper around the canonical lookups used across
 * the writer fleet. We mirror the order used by the apply-augments
 * pipeline (direct → alias → parent) and lean on INTL_FIRST_TOKEN_BLOCKLIST
 * to avoid the classic "Senior Public Affairs LLC" → "senior" miss.
 */
export function resolveSlug(slug, knownSlugs, maps) {
  if (!slug) return { slug: null, routed_via: "no-slug" };
  if (knownSlugs.has(slug)) return { slug, routed_via: "direct" };
  const alias = maps.aliases?.[slug];
  if (alias && knownSlugs.has(alias)) return { slug: alias, routed_via: "alias" };
  const parent = maps.parents?.[slug]?.parent;
  if (parent && knownSlugs.has(parent)) return { slug: parent, routed_via: "parent" };
  // First-token fallback, with the blocklist gating obvious false positives.
  const first = slug.split("-")[0];
  if (first.length >= 4 && first !== slug && knownSlugs.has(first) && !INTL_FIRST_TOKEN_BLOCKLIST.has(first)) {
    return { slug: first, routed_via: "first-token" };
  }
  return { slug: null, routed_via: "orphan" };
}

async function main() {
  const nowIso = new Date().toISOString();
  console.log("state-lobbying-r5-merge — DRY (slug routing audit)");

  let augment;
  try {
    augment = JSON.parse(await fs.readFile(AUG_FILE, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${AUG_FILE}: ${e.message}`);
    console.error("Run `node scripts/state-lobbying-r5-fetch.mjs` first.");
    process.exit(1);
  }

  const knownSlugs = await loadCompanySlugs();
  const maps = await loadMaps();
  console.log(`  ${knownSlugs.size} company files, ${Object.keys(maps.aliases).length} aliases, ${Object.keys(maps.parents).length} parents`);

  const matched = [];
  const orphans = [];
  for (const [slug, block] of Object.entries(augment)) {
    if (slug.startsWith("_")) continue;
    const r = resolveSlug(slug, knownSlugs, maps);
    if (!r.slug) {
      orphans.push({ slug, raw_name: block?.political?.state_lobbying_r5?.raw_name_matched });
      continue;
    }
    matched.push({
      slug_seed: slug,
      slug_routed: r.slug,
      routed_via: r.routed_via,
      total_usd_annual: block?.political?.state_lobbying_r5?.total_usd_annual || 0,
      jurisdictions: (block?.political?.state_lobbying_r5?.jurisdictions || []).map(j => j.code),
    });
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    generated_at: nowIso,
    augment_meta: augment._meta || null,
    matched_count: matched.length,
    orphan_count: orphans.length,
    matched,
    orphans,
  }, null, 2) + "\n");

  console.log(`\nMatched: ${matched.length}`);
  console.log(`Orphans: ${orphans.length}`);
  if (orphans.length) {
    console.log("Sample orphans:");
    for (const o of orphans.slice(0, 5)) console.log(`  - ${o.slug} (${o.raw_name || "?"})`);
  }
  console.log(`\nLog: ${LOG_FILE}`);
  console.log("Run `node scripts/apply-augments-to-companies.mjs` to actually write per-company JSON.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(err => { console.error("state-lobbying-r5-merge failed:", err); process.exit(1); });
}
