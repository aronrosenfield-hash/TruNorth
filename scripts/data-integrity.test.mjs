#!/usr/bin/env node
/**
 * data-integrity.test.mjs — C-6 stop-ship gate.
 *
 * Every check here encodes a defect that was ACTUALLY SHIPPED to production and
 * found on 2026-08-10. The point is not to document them — it is to make them
 * impossible to reintroduce without failing the build. Correctness work has no
 * visible payoff, so it is the first thing to erode when attention moves on;
 * this file is the part that keeps working when nobody is watching.
 *
 * Run: node --test scripts/data-integrity.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPS = path.join(ROOT, "public/data/companies");

// Load once — this walks ~12,800 files.
const files = fs.readdirSync(COMPS).filter((f) => f.endsWith(".json"));
const brands = [];
for (const f of files) {
  try { brands.push({ f, d: JSON.parse(fs.readFileSync(path.join(COMPS, f), "utf8")) }); } catch { /* skip */ }
}
const graded = brands.filter((b) => typeof b.d.overall === "number");
const CATS = ["political", "charity", "environment", "labor", "dei", "animals", "guns", "privacy", "execPay"];
const NO_REC = /^\s*no public record found\.?\s*$/i;

test("C-6: the catalog is non-empty and parses", () => {
  assert.ok(brands.length > 10000, `expected >10k brand files, got ${brands.length}`);
  assert.ok(graded.length > 1000, `expected >1k graded brands, got ${graded.length}`);
});

test("C-3: no brand cites an AI as a source", () => {
  // Shipped defect: 82,553 "Claude AI synthesis" strings across 11,187 files on a
  // product whose promise is "records, not opinions".
  const offenders = [];
  for (const { f, d } of brands) {
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (!v || typeof v !== "object" || !Array.isArray(v.sources)) continue;
      if (v.sources.some((s) => /claude|ai synthesis|gpt|llm/i.test(String(s)))) offenders.push(`${f} [${k}]`);
    }
  }
  assert.equal(offenders.length, 0, `AI cited as a source in: ${offenders.slice(0, 5).join(", ")}`);
});

test("C-4: no graded brand rests on a single, purely neutral signal", () => {
  // Shipped defect: 463 brands published a "B" (score exactly 50 clears B>=50)
  // off one non-directional datapoint — 23andMe held a B while its own record
  // cited the CA AG suing it over a data breach.
  const offenders = graded.filter(({ d }) => {
    const vals = Object.values(d.csc || {});
    return vals.length === 1 && typeof vals[0] === "number" && Math.abs(vals[0] - 50) < 1e-9;
  });
  assert.equal(offenders.length, 0,
    `single-neutral-signal grades: ${offenders.slice(0, 5).map((o) => o.d.name).join(", ")}`);
});

test("C-4: every graded brand has at least one scored category", () => {
  const offenders = graded.filter(({ d }) => Object.keys(d.csc || {}).length === 0);
  assert.equal(offenders.length, 0,
    `graded with no category evidence: ${offenders.slice(0, 5).map((o) => o.d.name).join(", ")}`);
});

test("C-4: a graded brand always has evidence — prose OR a structured record", () => {
  // NB: evidence does not have to be prose. The B-115 tax-avoidance brands
  // (Telephone & Data Systems, Ugi, Voya, Williams) grade off structured ITEP
  // federal-tax records while their pay-disclosure narratives correctly read
  // "No public record found." A stricter "all narratives must not be no-record"
  // version of this test flagged those four as defects; they are not.
  const structuredFor = (d, k) => {
    if (k === "execPay") return !!(d.payRatio || d.enriched?.tax || d.enriched?.execPay);
    return !!d.enriched?.[k];
  };
  const offenders = [];
  for (const { d, f } of graded) {
    for (const k of Object.keys(d.csc || {})) {
      const prose = d[k] && typeof d[k].s === "string" && d[k].s.trim() && !NO_REC.test(d[k].s);
      if (!prose && !structuredFor(d, k)) offenders.push(`${f} [${k}]`);
    }
  }
  assert.equal(offenders.length, 0,
    `scored categories with no evidence at all: ${offenders.slice(0, 5).join(", ")}`);
});

test("C-2: a published pay ratio matches the authoritative SEC record", () => {
  // Shipped defect: the sec-def14a parser dropped a leading "1" (Coca-Cola
  // 1739 -> 739) and read a filing YEAR as a ratio (Home Depot "2026:1").
  const offenders = [];
  for (const { d, f } of brands) {
    const pr = d.payRatio;
    if (!pr || typeof pr.ratio !== "number" || !(pr.ratio > 0)) continue;
    const m = String(d.execPay?.s || "").match(/ratio\s+([\d][\d,]*(?:\.\d+)?)\s*:\s*1/i);
    if (!m) continue;
    const claimed = Number(m[1].replace(/,/g, ""));
    if (Math.abs(claimed - pr.ratio) > 1) offenders.push(`${f}: says ${claimed}:1, record says ${pr.ratio}:1`);
  }
  assert.equal(offenders.length, 0, `contradicted pay ratios: ${offenders.slice(0, 5).join("; ")}`);
});

test("C-2: a pay ratio is never a filing year", () => {
  const offenders = [];
  for (const { d, f } of brands) {
    for (const r of [d.payRatio?.ratio, d.enriched?.execPay?.payRatio]) {
      if (typeof r === "number" && r >= 1990 && r <= 2035) offenders.push(`${f}: ratio=${r}`);
    }
  }
  assert.equal(offenders.length, 0, `year-shaped pay ratios: ${offenders.slice(0, 5).join("; ")}`);
});

test("C-1: grade() treats a null score as NO GRADE, never as an F", () => {
  // Shipped defect: Number(null) is 0, which IS finite, so the /alternatives SEO
  // pages published an "F" on all 9,765 ungraded companies.
  const mustGuard = ["api/alternatives-seo.js", "api/company-seo.js"];
  for (const rel of mustGuard) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(src, /function numOrNull/, `${rel} lost its null guard helper`);
    // Inspect the body of grade() specifically — a repo-wide regex also matches
    // unrelated helpers and produces a false failure.
    const body = src.slice(src.indexOf("function grade("));
    const gradeFn = body.slice(0, body.indexOf("\n}") + 2);
    assert.match(gradeFn, /numOrNull\(score\)/, `${rel}: grade() no longer uses numOrNull`);
    assert.doesNotMatch(gradeFn, /Number\(score\)/,
      `${rel}: grade() reintroduced the Number() coercion that turns null into F`);
  }
});

test("C-5: no sub-brand contradicts its parent by 2+ grades on a thinner record", () => {
  const GV = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const gradeOf = (n) => (n == null ? null : n >= 62 ? "A" : n >= 50 ? "B" : n >= 38 ? "C" : n >= 33 ? "D" : "F");
  const nrm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const bySlug = new Map();
  for (const { d, f } of brands) {
    const slug = d.slug || f.replace(/\.json$/, "");
    bySlug.set(nrm(slug), d);
  }
  let amap;
  try { amap = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8")); }
  catch { return; } // map absent — nothing to check
  const offenders = [];
  for (const [alias, info] of Object.entries(amap)) {
    const kid = bySlug.get(nrm(alias)), par = bySlug.get(nrm(info?.parent || ""));
    if (!kid || !par) continue;
    const kg = gradeOf(kid.overall), pg = gradeOf(par.overall);
    if (!kg || !pg || !GV[kg] || !GV[pg]) continue;
    if (Math.abs(GV[kg] - GV[pg]) < 2) continue;
    if (Object.keys(kid.csc || {}).length < Object.keys(par.csc || {}).length) {
      offenders.push(`${kid.name}=${kg} vs ${par.name}=${pg}`);
    }
  }
  assert.equal(offenders.length, 0, `thin contradictions: ${offenders.slice(0, 5).join("; ")}`);
});

test("V-1: shelf-brand aliases are wired into the search index", () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/search-index.json"), "utf8"));
  const blob = JSON.stringify(idx);
  // A handful of names a shopper actually types; each must be indexed somewhere.
  for (const alias of ["tide", "oreo", "cheerios", "pampers", "charmin"]) {
    assert.ok(blob.includes(alias), `alias "${alias}" is missing from the search index`);
  }
});
