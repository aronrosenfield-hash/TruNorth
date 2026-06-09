#!/usr/bin/env node
/**
 * ASIC merge.
 *
 * data/raw/asic/<date>.json -> data/derived/asic-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";
import { resolveSlug, loadMaps, loadKnownSlugs } from "./lib/intl-regulator-resolve.mjs";
const COMPANIES_DIR_REL = "public/data/companies";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/asic");
const DERIVED = path.join(ROOT, "data/derived/asic-augment.json");
const SOURCE_URL = "https://asic.gov.au/about-asic/news-centre/find-a-media-release/";

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records, knownSlugs = new Set(), maps = { aliases: {}, parents: {} }) {
  const by = {};
  const orphans = [];
  for (const r of records) {
    if (!r.respondent) continue;
    const { slug, routed_via } = resolveSlug(r.respondent, knownSlugs, maps);
    if (!slug) { orphans.push(r.respondent); continue; }
    if (!by[slug]) {
      by[slug] = {
        normalized_name:   normalizeCompanyName(r.respondent),
        raw_name:          r.respondent,
        routed_via,
        total_penalty_aud: 0,
        action_count:      0,
        latest_action:     null,
        action_types:      [],
        sample_actions:    [],
        source:            "asic",
        source_url:        SOURCE_URL,
      };
    }
    const agg = by[slug];
    agg.total_penalty_aud += r.penalty_aud || 0;
    agg.action_count      += 1;
    if (!agg.latest_action || (r.date && r.date > agg.latest_action)) {
      agg.latest_action = r.date || agg.latest_action;
    }
    if (r.action_type && !agg.action_types.includes(r.action_type)) agg.action_types.push(r.action_type);
    if (agg.sample_actions.length < 5) {
      agg.sample_actions.push({
        action_type: r.action_type,
        date:        r.date,
        penalty_aud: r.penalty_aud,
        url:         r.url,
      });
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return { by, orphans };
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run asic-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const knownSlugs = await loadKnownSlugs(path.join(ROOT, COMPANIES_DIR_REL));
  const maps = await loadMaps();
  const { by: augment, orphans } = buildAugment(raw.records || [], knownSlugs, maps);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:  new Date().toISOString(),
    source:        "asic",
    source_url:    SOURCE_URL,
    input:         path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    orphan_count:  orphans.length,
    companies:     augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies (${orphans.length} orphans) -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("asic-merge failed:", err); process.exit(1); });
}
