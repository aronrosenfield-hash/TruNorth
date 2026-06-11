#!/usr/bin/env node
/**
 * ToS;DR merger (E-2 / Lever 4c, 2026-06-11).
 *
 * Routes rated ToS;DR services onto catalog brands via the standard
 * resolution chain (direct slug → alias → parent map → orphan) and fills the
 * privacy category for brands that have NO existing privacy record.
 *
 * Precedence rule: breach evidence beats terms-of-service grades. If the
 * brand already has a real privacy enum or narrative (HIBP breaches, FTC
 * action, AI synthesis), we only attach the tosdr sidecar — we never
 * overwrite the existing verdict.
 *
 * Grade mapping (stays in the enum vocabulary; V3 csc comes from rebake):
 *   A, B → good · C → mixed · D, E → poor
 *
 * Attribution (CC BY-SA 3.0 compliance): narrative names ToS;DR + marks the
 * grade as transformed; Sources tab carries the license link.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCompanyName, toSlug } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const IN = path.join(ROOT, "public/data/tosdr.json");

const NO_REC_RE = /^\s*no public record found\.?\s*$/i;
const EMPTY = new Set(["", "neutral", "unknown", "na", "n/a"]);
const GRADE_ENUM = { A: "good", B: "good", C: "mixed", D: "poor", E: "poor" };
const GRADE_WORD = { A: "excellent", B: "good", C: "mixed", D: "poor", E: "very poor" };

const { services } = JSON.parse(fs.readFileSync(IN, "utf8"));

// alias + parent resolution
const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/slug-aliases.json"), "utf8"));
const parentMap = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8"));
const exists = new Set(fs.readdirSync(COMPS).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));

function resolveSlug(name) {
  const direct = toSlug(name);
  if (exists.has(direct)) return direct;
  if (aliases[direct] && exists.has(aliases[direct])) return aliases[direct];
  const norm = toSlug(normalizeCompanyName(name));
  if (exists.has(norm)) return norm;
  if (aliases[norm] && exists.has(aliases[norm])) return aliases[norm];
  const parent = parentMap[direct] || parentMap[norm];
  if (parent && exists.has(parent)) return parent;
  return null;
}

let matched = 0, filled = 0, sidecarOnly = 0, orphans = 0;
const fills = [];
// Brand-level dedupe: a parent (e.g. Google) can match several ToS;DR
// services — keep the WORST grade (conservative for the user).
const RANK = { E: 0, D: 1, C: 2, B: 3, A: 4 };
const byBrand = new Map();
for (const s of services) {
  const slug = resolveSlug(s.name);
  if (!slug) { orphans++; continue; }
  const prev = byBrand.get(slug);
  if (!prev || RANK[s.rating] < RANK[prev.rating]) byBrand.set(slug, s);
}

for (const [slug, s] of byBrand) {
  const fp = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  matched++;

  d.privacy_tosdr = {
    rating: s.rating,
    serviceName: s.name,
    tosdrUrl: `https://tosdr.org/en/service/${s.id}`,
    reviewed: s.reviewed,
    license: "CC BY-SA 3.0",
    fetchedAt: new Date().toISOString().slice(0, 10),
  };

  const cur = String(d.sc?.privacy || "").toLowerCase();
  const curNarr = String(d.privacy?.s || "");
  const hasReal = !EMPTY.has(cur) || (curNarr && !NO_REC_RE.test(curNarr));
  if (hasReal) {
    sidecarOnly++;
  } else {
    d.sc = d.sc || {};
    d.sc.privacy = GRADE_ENUM[s.rating];
    d.privacy = d.privacy || {};
    d.privacy.s = `Terms-of-service privacy grade ${s.rating} (${GRADE_WORD[s.rating]}) via ToS;DR (tosdr.org), CC BY-SA 3.0 — transformed to TruNorth's scale.`;
    d.privacy.sources = Array.from(new Set([...(d.privacy.sources || []), "tosdr"]));
    filled++;
    fills.push(`${slug}:${s.rating}`);
  }
  fs.writeFileSync(fp, JSON.stringify(d, null, 2));
}

console.log(`[tosdr-merge] matched ${matched} brands · filled privacy on ${filled} · sidecar-only (existing record kept) ${sidecarOnly} · orphans ${orphans}`);
if (fills.length) console.log(`[tosdr-merge] sample fills: ${fills.slice(0, 12).join(", ")}`);
