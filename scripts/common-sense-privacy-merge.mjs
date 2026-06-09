#!/usr/bin/env node
/**
 * Common Sense Privacy — merge step.
 *
 * Reads latest data/raw/common-sense-privacy/<date>.json and writes
 * data/derived/common-sense-privacy-augment.json keyed by TruNorth slug.
 *
 * Multiple products per slug (Meta has Instagram + Facebook + WhatsApp).
 * We aggregate per-slug by collecting every product evaluation and
 * surfacing the WORST tier (Fail > Warning > Pass) as the headline
 * verdict — Common Sense's methodology treats Warning as "fails minimum
 * safeguards", so any Warning on a flagship product is the salient fact.
 *
 * Per-slug payload (lives under "privacy" category):
 *   {
 *     privacy: {
 *       csPrivacyWorstTier: "warning",
 *       csPrivacyProducts: [
 *         { product, tier, score, evaluationUrl }, ...
 *       ],
 *       sourceUrl: "https://privacy.commonsense.org/"
 *     },
 *     _sources: ["common-sense-privacy"],
 *     _routedVia: "direct" | "alias" | "parent",
 *     _lastUpdated: <iso>
 *   }
 *
 * Locally:
 *   node scripts/common-sense-privacy-merge.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/common-sense-privacy");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "common-sense-privacy-augment.json");

export const SOURCE_URL = "https://privacy.commonsense.org/";

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

/** Severity ladder: fail > warning > pass > unknown. */
const TIER_RANK = { fail: 3, warning: 2, pass: 1, unknown: 0 };

export function worstTier(a, b) {
  const ra = TIER_RANK[a] ?? 0;
  const rb = TIER_RANK[b] ?? 0;
  return ra >= rb ? a : b;
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); } catch { return null; }
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (!Array.isArray(idx)) return new Set();
  return new Set(idx.map(r => r.slug));
}

async function latestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function resolveSlug(slugKey, { knownSlugs, aliases, parents }) {
  if (!slugKey) return null;
  if (knownSlugs.has(slugKey)) return { slug: slugKey, routedVia: "direct" };
  if (aliases[slugKey] && knownSlugs.has(aliases[slugKey])) {
    return { slug: aliases[slugKey], routedVia: "alias" };
  }
  if (parents[slugKey] && knownSlugs.has(parents[slugKey])) {
    return { slug: parents[slugKey], routedVia: "parent" };
  }
  return null;
}

async function main() {
  const raw = await latestRawFile();
  if (!raw) { console.error("[cs-merge] no raw file"); process.exit(1); }
  const data = JSON.parse(await fs.readFile(raw, "utf-8"));
  const { aliases, parents } = await loadMaps();
  const knownSlugs = await loadKnownSlugs();
  const now = new Date().toISOString();

  const companies = {};
  const orphans = [];

  for (const ev of data.evaluations || []) {
    const r = resolveSlug(ev.slugKey, { knownSlugs, aliases, parents });
    if (!r) { orphans.push({ slugKey: ev.slugKey, product: ev.product }); continue; }
    if (!companies[r.slug]) {
      companies[r.slug] = {
        privacy: {
          csPrivacyWorstTier: ev.tierEnum,
          csPrivacyProducts: [],
          sourceUrl: SOURCE_URL,
        },
        _sources: ["common-sense-privacy"],
        _routedVia: r.routedVia,
        _lastUpdated: now,
      };
    }
    companies[r.slug].privacy.csPrivacyWorstTier = worstTier(
      companies[r.slug].privacy.csPrivacyWorstTier, ev.tierEnum,
    );
    companies[r.slug].privacy.csPrivacyProducts.push({
      product: ev.product,
      tier: ev.tier,
      score: ev.score,
      evaluationUrl: ev.evaluationUrl,
    });
  }

  const out = {
    _license: "Common Sense Privacy — citation per evaluation URL",
    _source: "common-sense-privacy",
    _source_url: SOURCE_URL,
    _generated_at: now,
    _matched_slugs: Object.keys(companies).length,
    _orphans: orphans,
    companies,
  };
  const outPath = OUT_OVERRIDE || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[cs-merge] wrote ${outPath} — ${Object.keys(companies).length} slugs, ${orphans.length} orphans`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
