#!/usr/bin/env node
/**
 * UK HSE merge.
 *
 * data/raw/uk-hse/<date>.json -> data/derived/uk-hse-augment.json
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
const RAW_DIR = path.join(ROOT, "data/raw/uk-hse");
const DERIVED = path.join(ROOT, "data/derived/uk-hse-augment.json");
const SOURCE_URL = "https://resources.hse.gov.uk/convictions-history/";

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
    if (!r.defendant) continue;
    const { slug, routed_via } = resolveSlug(r.defendant, knownSlugs, maps);
    if (!slug) { orphans.push(r.defendant); continue; }
    if (!by[slug]) {
      by[slug] = {
        normalized_name:   normalizeCompanyName(r.defendant),
        raw_name:          r.defendant,
        routed_via,
        total_fines_gbp:   0,
        prosecution_count: 0,
        latest_action:     null,
        offences:          [],
        sample_actions:    [],
        source:            "uk-hse",
        source_url:        SOURCE_URL,
      };
    }
    const agg = by[slug];
    agg.total_fines_gbp   += r.fine_gbp || 0;
    agg.prosecution_count += 1;
    if (!agg.latest_action || (r.date && r.date > agg.latest_action)) {
      agg.latest_action = r.date || agg.latest_action;
    }
    if (r.offence && !agg.offences.includes(r.offence)) agg.offences.push(r.offence);
    if (agg.sample_actions.length < 5) {
      agg.sample_actions.push({
        offence:  r.offence,
        date:     r.date,
        fine_gbp: r.fine_gbp,
        url:      r.url,
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
  if (!inPath || !existsSync(inPath)) { console.error("Run uk-hse-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const knownSlugs = await loadKnownSlugs(path.join(ROOT, COMPANIES_DIR_REL));
  const maps = await loadMaps();
  const { by: augment, orphans } = buildAugment(raw.records || [], knownSlugs, maps);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at:  new Date().toISOString(),
    source:        "uk-hse",
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
  main().catch(err => { console.error("uk-hse-merge failed:", err); process.exit(1); });
}
