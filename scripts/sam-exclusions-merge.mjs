#!/usr/bin/env node
/**
 * SAM exclusions merger (R7 #6, 2026-06-11).
 *
 * Conservative exact-normalized matching of ACTIVE firm debarments against
 * the catalog. Debarment of a recognizable consumer brand is rare and
 * serious — every match prints for review. Writes the `sam_exclusion`
 * sidecar + appends a labor narrative when the cell is empty (a federal
 * debarment is misconduct evidence, not a stance).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const { firms } = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/sam-exclusions.json"), "utf8"));
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;

const catalogByNorm = new Map();
for (const f of fs.readdirSync(COMPS)) {
  if (!f.endsWith(".json")) continue;
  const slug = f.replace(/\.json$/, "");
  try {
    const d = JSON.parse(fs.readFileSync(path.join(COMPS, f), "utf8"));
    const n = normalizeCompanyName(d.name || slug);
    if (n && n.length >= 6 && !catalogByNorm.has(n)) catalogByNorm.set(n, slug); // ≥6 chars: avoid generic-name overmatch
  } catch {}
}

const bySlug = new Map();
for (const firm of firms) {
  const n = normalizeCompanyName(firm.name || "");
  if (!n || n.length < 6) continue;
  const slug = catalogByNorm.get(n);
  if (!slug) continue;
  if (!bySlug.has(slug)) bySlug.set(slug, []);
  bySlug.get(slug).push(firm);
}

let matched = 0;
// REVIEW-QUEUE MODE (2026-06-11, after first run produced name-collision
// false positives: "AMERICAN INTERNATIONAL INC" matched AIG, a debarred
// "TARGET CORPORATION" matched the retailer). A federal-debarment claim on
// the wrong brand is the most damaging error this pipeline can make, so
// NOTHING is written to company files unless the slug is in the reviewed
// allowlist below. New candidates go to data/derived/sam-exclusions-review.json
// for Aron to approve.
const APPROVED = new Set([
  // Aron-reviewed 2026-06-11:
  "royal-caribbean-cruises", // EPA prohibition 1998 — matches documented ocean-dumping felony pleas
  "huawei-technologies",     // USAF ineligible (proceedings pending) 2019 — exact entity
  "gulfport-energy",         // EPA prohibition 2014 — exact corporate name, industry fits
]);
// Rejected name-collisions (Aron 2026-06-11) — never re-queue these slugs:
const REJECTED = new Set([
  "target",                       // "TARGET CORPORATION" (EPA 2006) is not the retailer
  "american-international-group", // "AMERICAN INTERNATIONAL INC" (FAA 2007) is not AIG
]);
const reviewQueue = [];
for (const [slug, recs] of bySlug) {
  if (REJECTED.has(slug)) continue;
  if (!APPROVED.has(slug)) {
    reviewQueue.push({ slug, candidates: recs.slice(0, 3) });
    continue;
  }
  const fp = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  matched++;
  d.sam_exclusion = {
    records: recs.slice(0, 5),
    source: "SAM.gov Exclusions Public Extract V2",
    fetchedAt: new Date().toISOString().slice(0, 10),
  };
  const narr = String(d.labor?.s || "");
  if (!narr || NO_REC_RE.test(narr)) {
    d.labor = d.labor || {};
    d.labor.s = `Active federal exclusion/debarment on record (SAM.gov): ${recs[0].type || "exclusion"} by ${recs[0].agency || "a federal agency"}${recs[0].activeDate ? `, effective ${recs[0].activeDate}` : ""}.`;
    d.labor.sources = Array.from(new Set([...(d.labor.sources || []), "sam-exclusions"]));
  }
  fs.writeFileSync(fp, JSON.stringify(d, null, 2));
}
fs.writeFileSync(path.join(ROOT, "data/derived/sam-exclusions-review.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: "Name-collision candidates — approve by adding the slug to APPROVED in scripts/sam-exclusions-merge.mjs after manual verification",
  queue: reviewQueue,
}, null, 2));
console.log(`[sam-merge] applied ${matched} approved · queued ${reviewQueue.length} for review → data/derived/sam-exclusions-review.json`);
