#!/usr/bin/env node
/**
 * DW-9 — FERC enforcement merge.
 *
 * Reads latest /data/raw/ferc-enforcement/<date>.json, aggregates actions
 * per matched TruNorth slug into:
 *
 *   data/derived/ferc-enforcement-augment.json
 *
 * Per-slug shape:
 *   {
 *     slug, action_count, total_civil_penalty_usd, total_disgorgement_usd,
 *     recent_top5: [...], primary_violation, earliest_action, latest_action,
 *     source, source_url
 *   }
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ferc-enforcement");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const META_DIR = path.join(ROOT, "public/data/_meta");
const OUT_FILE = path.join(ROOT, "data/derived/ferc-enforcement-augment.json");

function parseArgs(argv) {
  const out = { rawPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") out.rawPath = argv[++i];
    else if (argv[i] === "--out") out.outPath = argv[++i];
  }
  return out;
}

async function loadLatestRaw() {
  try {
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json")).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

async function loadCompanySlugs() {
  if (!existsSync(COMP_DIR)) return [];
  return (await fs.readdir(COMP_DIR)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5));
}

async function loadParentMap() {
  try { return JSON.parse(await fs.readFile(path.join(META_DIR, "brand-parent-map.json"), "utf-8")); }
  catch { return {}; }
}

export function buildAliasIndex(slugs, parentMap) {
  const idx = new Map();
  for (const slug of slugs) {
    const n = normalizeCompanyName(slug.replace(/-/g, " "));
    if (n) idx.set(n, slug);
    for (const a of parentMap[slug]?.aliases || []) {
      const nn = normalizeCompanyName(a);
      if (nn) idx.set(nn, slug);
    }
  }
  return idx;
}

export function matchCompany(company, aliasIdx) {
  const en = normalizeCompanyName(company);
  if (!en) return null;
  if (aliasIdx.has(en)) return aliasIdx.get(en);
  for (const [alias, slug] of aliasIdx) {
    if (alias.length < 4) continue;
    if (en.includes(alias)) return slug;
  }
  return null;
}

/** Build per-slug aggregate. Exported for tests. */
export function aggregateForSlug(slug, actions, sourceUrl) {
  const sorted = [...actions].sort((a, b) => (b.civil_penalty_usd || 0) - (a.civil_penalty_usd || 0));
  const dates = actions.map(a => a.date).filter(Boolean).sort();
  const violationFreq = {};
  for (const a of actions) {
    const v = (a.violation || "").split(/[—\-:]/)[0].trim().slice(0, 80);
    if (v) violationFreq[v] = (violationFreq[v] || 0) + 1;
  }
  const primary = Object.entries(violationFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    slug,
    action_count: actions.length,
    total_civil_penalty_usd: actions.reduce((s, a) => s + (a.civil_penalty_usd || 0), 0),
    total_disgorgement_usd: actions.reduce((s, a) => s + (a.disgorgement_usd || 0), 0),
    recent_top5: sorted.slice(0, 5),
    primary_violation: primary,
    earliest_action: dates[0] || null,
    latest_action: dates[dates.length - 1] || null,
    source: "ferc-enforcement",
    source_url: sourceUrl,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPath = args.rawPath || await loadLatestRaw();
  if (!rawPath) { console.error(`No raw snapshot under ${RAW_DIR}.`); process.exit(2); }

  const snap = JSON.parse(await fs.readFile(rawPath, "utf-8"));
  const slugs = await loadCompanySlugs();
  const idx = buildAliasIndex(slugs, await loadParentMap());

  const buckets = {};
  for (const a of snap.actions || []) {
    const slug = matchCompany(a.company, idx);
    if (!slug) continue;
    (buckets[slug] ||= []).push(a);
  }

  const companies = {};
  for (const [slug, actions] of Object.entries(buckets)) {
    companies[slug] = aggregateForSlug(slug, actions, snap.source_url);
  }

  const augment = {
    source: "ferc-enforcement",
    source_url: snap.source_url,
    generated_at: new Date().toISOString(),
    snapshot_date: snap.snapshot_date,
    matched_slug_count: Object.keys(companies).length,
    companies,
  };

  const outPath = args.outPath || OUT_FILE;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(augment, null, 2));
  console.log(`Wrote ${outPath} (${augment.matched_slug_count} slugs / ${snap.action_count} actions)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ferc-enforcement-merge failed:", err);
    process.exit(1);
  });
}
