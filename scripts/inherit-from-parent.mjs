#!/usr/bin/env node
/**
 * Lever 1 (R6 coverage plan, 2026-06-10): parent → sub-brand data inheritance.
 *
 * Thousands of catalog entries are sub-brands of data-rich parents (Old Navy
 * ← Gap Inc., KitKat ← Hershey). The scanner already resolves sub-brands to
 * parents at scan time via public/data/_meta/brand-parent-map.json, but the
 * sub-brands' OWN catalog pages showed "No public record found" in every
 * category. This script copies each FILLED parent category into the child
 * where the child has no record, with explicit "Via parent company X"
 * attribution in the narrative — the same convention Good On You / Ethical
 * Consumer use for owned brands. Simulated gain: ~617 entries, ~308 newly
 * reaching 3+ real categories.
 *
 * Rules:
 *   - Only fills children whose category is empty/no-record. Never
 *     overwrites direct child data (a sub-brand's own OSHA record beats
 *     the parent's).
 *   - Only inherits from map entries with confidence high|medium.
 *   - Skips children that are themselves parents of others (conglomerate
 *     roots shouldn't inherit sideways).
 *   - Idempotent: inherited cells carry source "parent-inheritance" and are
 *     refreshed (not duplicated) on re-run, so a parent rebake propagates.
 *   - Stamps child.inheritedFrom = parentSlug for UI/debugging.
 *
 * Run AFTER apply-augments-to-companies.mjs and BEFORE rebake-scoring.mjs:
 *   node scripts/inherit-from-parent.mjs          # dry — report only
 *   node scripts/inherit-from-parent.mjs --apply  # write company files
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const APPLY = process.argv.includes("--apply");
const CATS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay", "health"];
const NO_RECORD = /no public record found/i;
const SRC = "parent-inheritance";

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const filled = v => { const s = String(v || "").toLowerCase(); return s && !["neutral", "unknown", "na", "n/a"].includes(s); };

const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
const bySlug = new Map(index.map(c => [c.slug, c]));
const bp = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
const mapEntries = Object.entries(bp).filter(([k, v]) => !k.startsWith("_") && v?.parent && ["high", "medium"].includes(v.confidence || "high"));
const parentOfBrandKey = new Map(mapEntries.map(([k, v]) => [k, v.parent]));
const isAParent = new Set(mapEntries.map(([, v]) => v.parent));

// Cache parent company files (full narratives live there, not in index).
const parentCache = new Map();
function loadCompany(slug) {
  if (parentCache.has(slug)) return parentCache.get(slug);
  const f = path.join(COMP_DIR, `${slug}.json`);
  const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  parentCache.set(slug, d);
  return d;
}

let children = 0, cells = 0, refreshed = 0;
const perCat = Object.fromEntries(CATS.map(k => [k, 0]));

for (const c of index) {
  if (!c.slug) continue;
  const parentSlug = parentOfBrandKey.get(norm(c.name));
  if (!parentSlug || parentSlug === c.slug) continue;
  if (isAParent.has(c.slug)) continue; // conglomerate roots don't inherit
  const parentIdx = bySlug.get(parentSlug);
  if (!parentIdx || (parentIdx.realCats ?? 0) < 1) continue;

  const childFile = path.join(COMP_DIR, `${c.slug}.json`);
  if (!fs.existsSync(childFile)) continue;
  const child = JSON.parse(fs.readFileSync(childFile, "utf8"));
  const parent = loadCompany(parentSlug);
  if (!parent) continue;

  let touched = false;
  for (const k of CATS) {
    if (!filled(parent.sc?.[k])) continue;
    const pNarr = String(parent[k]?.s || "").trim();
    if (!pNarr || NO_RECORD.test(pNarr)) continue;

    const existing = child[k] || {};
    const exSources = existing.sources || [];
    const isInherited = exSources.includes(SRC);
    const isEmpty = !existing.s || NO_RECORD.test(String(existing.s));
    // Fill empties; refresh previously-inherited cells (parent may have
    // rebaked); NEVER touch a cell with the child's own direct data.
    if (!isEmpty && !isInherited) continue;

    const narrative = `Via parent company ${parent.name || parentSlug}: ${pNarr}`;
    child[k] = { ...existing, s: narrative, sources: [SRC] };
    child.sc = child.sc || {};
    child.sc[k] = parent.sc[k];
    perCat[k]++;
    cells++;
    if (isInherited) refreshed++;
    touched = true;
  }

  if (touched) {
    child.inheritedFrom = parentSlug;
    children++;
    if (APPLY) fs.writeFileSync(childFile, JSON.stringify(child, null, 2));
  }
}

console.log(`[inherit] ${APPLY ? "APPLIED" : "DRY RUN"} — children touched: ${children}, cells written: ${cells} (${refreshed} refreshed)`);
console.log("[inherit] per-category:", Object.entries(perCat).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" "));
if (!APPLY) console.log("[inherit] pass --apply to write. Then run rebake-scoring.mjs --apply + finalize-bundle.mjs.");
