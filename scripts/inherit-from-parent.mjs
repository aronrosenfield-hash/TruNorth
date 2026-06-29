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
 *   - COLLISION GUARD (2026-06-29): never copies a parent's records onto a
 *     child that is a DISTINCT real-world entity which merely shares the
 *     brand key. Generic / common-word slugs collide: the brand-parent-map
 *     key "on" points at Altria's "on!" pouches, but the company FILE at
 *     slug "on" is On Holding (ONON, footwear) — a separate SEC filer. The
 *     same false-positive class fixed in industry-flags.mjs (B-15), but
 *     more damaging here because it copies real category RECORDS, attributed
 *     "Via parent company X". Two signals suppress inheritance:
 *       (a) the child carries its OWN cik/ticker/sic that the parent does
 *           not share — it is a distinct EDGAR filer, not a marketing
 *           sub-brand (on→altria, star→heineken, stride→mondelez [Stride
 *           Inc is an education co], monster-energy→coca-cola, evgo→nrg,
 *           victoria-s-secret→bath-and-body-works); OR
 *       (b) the child slug is on the shared AMBIGUOUS_SLUGS denylist (from
 *           industry-flags.mjs) — for colliders with no own EDGAR identity
 *           (patagonia→anheuser-busch, next→philip-morris, jet→phillips-66).
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
import { AMBIGUOUS_SLUGS } from "./industry-flags.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMP_DIR = path.join(ROOT, "public/data/companies");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const MAP_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const CATS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay", "health"];
const NO_RECORD = /no public record found/i;
const SRC = "parent-inheritance";
// Identity fields that mark a company as its own distinct SEC/EDGAR filer.
const IDENTITY_FIELDS = ["cik", "ticker", "sic"];

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const filled = v => { const s = String(v || "").toLowerCase(); return s && !["neutral", "unknown", "na", "n/a"].includes(s); };

/**
 * True when the child carries its OWN corporate identity (a cik/ticker/sic the
 * parent does not share) — i.e. it is a separate SEC EDGAR filer, a real public
 * company, NOT a marketing sub-brand of the parent. Such a child must never
 * inherit a parent's records even when a brand-parent-map edge of the same key
 * points at a (different) real sub-brand. Empty/undefined fields are ignored;
 * a field equal to the parent's (same company under two slugs) does not count.
 */
export function hasOwnCorporateIdentity(child, parent) {
  for (const k of IDENTITY_FIELDS) {
    const cv = child?.[k];
    if (cv === undefined || cv === null || cv === "") continue;
    if (cv !== parent?.[k]) return true;
  }
  return false;
}

/**
 * Decide whether to suppress parent→child inheritance because the child is a
 * distinct real-world entity that merely shares the brand key. Pure function so
 * the walker and the unit tests share one source of truth.
 * @returns {"own-edgar-identity" | "ambiguous-slug" | null} reason, or null to allow.
 */
export function inheritanceBlocked(child, parent, childSlug) {
  // (a) Distinct SEC filer — strongest signal, generalizes to any future case.
  if (hasOwnCorporateIdentity(child, parent)) return "own-edgar-identity";
  // (b) Curated generic-slug colliders with no own EDGAR identity. Reuses the
  //     same denylist that guards industry-flags.mjs so the two stay in sync.
  if (AMBIGUOUS_SLUGS.has(String(childSlug || "").toLowerCase())) return "ambiguous-slug";
  return null;
}

function main() {
  const APPLY = process.argv.includes("--apply");

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
  const blocked = [];                  // collision-guard skips, for reporting
  const touchedSlugs = new Set();

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

    // COLLISION GUARD — never copy a parent's records onto a child that is a
    // distinct real-world entity sharing the brand key (see inheritanceBlocked).
    const blockReason = inheritanceBlocked(child, parent, c.slug);
    if (blockReason) {
      const stale = CATS.filter(k => (child[k]?.sources || []).includes(SRC));
      blocked.push({ slug: c.slug, parent: parentSlug, reason: blockReason, stale });
      continue;
    }

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
      touchedSlugs.add(c.slug);
      if (APPLY) fs.writeFileSync(childFile, JSON.stringify(child, null, 2));
    }
  }

  console.log(`[inherit] ${APPLY ? "APPLIED" : "DRY RUN"} — children touched: ${children}, cells written: ${cells} (${refreshed} refreshed)`);
  console.log("[inherit] per-category:", Object.entries(perCat).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" "));

  // Collision-guard report — the children we refused to fill (distinct entities
  // sharing a brand key). Any with stale inherited cells are pre-existing damage
  // from before the guard existed; clean those by reverting the cell + rebaking.
  if (blocked.length) {
    console.log(`[inherit] collision guard skipped ${blocked.length} child(ren) (distinct entity sharing a brand key):`);
    for (const b of blocked.sort((x, y) => x.slug.localeCompare(y.slug))) {
      const warn = b.stale.length ? `  ⚠ has ${b.stale.length} stale inherited cell(s) [${b.stale.join(",")}] — needs manual revert+rebake` : "";
      console.log(`  - ${b.slug.padEnd(24)} ↛ ${b.parent.padEnd(28)} [${b.reason}]${warn}`);
    }
    const staleCount = blocked.filter(b => b.stale.length).length;
    if (staleCount) console.log(`[inherit] ${staleCount} skipped child(ren) still carry stale inherited cells written before the guard.`);
  }

  if (!APPLY) {
    // Regression canary: the confirmed colliders must never be inheritance targets.
    const WATCH = ["on", "star", "patagonia", "next", "jet"];
    const leaked = WATCH.filter(s => touchedSlugs.has(s));
    console.log(`[inherit] collision self-check (${WATCH.join(",")}): ${leaked.length ? "LEAKED → " + leaked.join(",") : "none inherited ✓"}`);
    console.log("[inherit] pass --apply to write. Then run rebake-scoring.mjs --apply + finalize-bundle.mjs.");
  }
}

// Only run the walker when invoked directly, so the test can import the guards.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
