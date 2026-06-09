#!/usr/bin/env node
/**
 * Apply augment data → per-company narratives (Build 55).
 *
 * The Build 54 enrichment fleet successfully produced data in
 * data/derived/<source>-augment.json files, but those augments never made
 * it into per-company narratives (public/data/companies/<slug>.json detail
 * fields). This script bridges that gap directly — no hybrid-pipeline,
 * no raw.json, no build-split-bundle.
 *
 * For each augment source we know how to interpret, we:
 *   - Iterate slugs present in the augment
 *   - Construct a per-category narrative + optionally update sc[cat] enum
 *   - Write into the company file ONLY IF the existing detail.s says
 *     "No public record found." (Aron's call: first non-no-record wins)
 *
 * Multiple augments can write to the same category — first wins by
 * priority order in WRITERS array.
 *
 * Idempotent. Safe to re-run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AUG_DIR = path.join(ROOT, "data/derived");
const COMP_DIR = path.join(ROOT, "public/data/companies");

const NO_RECORD = /^\s*no public record found\.?\s*$/i;

function loadAugment(name) {
  const p = path.join(AUG_DIR, `${name}-augment.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function entriesOf(aug) {
  // Augments can be either { slug: data } or { companies: { slug: data } }
  if (!aug) return [];
  const root = aug.companies || aug;
  return Object.entries(root).filter(([k]) => !k.startsWith("_"));
}

// Each WRITER takes (entry, slug) → list of { category, narrative, sc?, severity? }
// Returns empty if the augment hit isn't actionable for this slug.
//
// severity: "positive" | "negative" | "mixed" | "neutral" — informs sc enum
// when not explicitly set.
const WRITERS = [
  // ─── Charity / philanthropy ───────────────────────────────────────────
  {
    name: "corporate-giving",
    write: (e) => {
      const c = e.charity;
      if (!c || !c.totalGivingUsd) return [];
      const pct = c.pctRevenue ? ` (~${(c.pctRevenue * 100).toFixed(2)}% of revenue)` : "";
      const yr = c.year ? ` in ${c.year}` : "";
      const usd = c.totalGivingUsd >= 1e9
        ? `$${(c.totalGivingUsd / 1e9).toFixed(2)}B`
        : c.totalGivingUsd >= 1e6
          ? `$${(c.totalGivingUsd / 1e6).toFixed(0)}M`
          : `$${c.totalGivingUsd.toLocaleString()}`;
      const score = c.pctRevenue >= 0.05 ? "positive"
        : c.pctRevenue >= 0.01 ? "positive"
          : c.pctRevenue >= 0.001 ? "mixed" : "neutral";
      return [{
        category: "charity",
        narrative: `${usd} reported corporate giving${yr}${pct}${c.foundationName ? ` via ${c.foundationName}` : ""}.`,
        sc: score,
        severity: "positive",
      }];
    },
  },
  // ─── Environment: 1% for the Planet (highest signal) ─────────────────
  {
    name: "one-percent-planet",
    write: (e) => [{
      category: "environment",
      narrative: `1% for the Planet member — pledges 1% of annual sales to environmental nonprofits${e.memberSince ? ` (since ${e.memberSince})` : ""}.`,
      sc: "positive",
      severity: "positive",
    }],
  },
  // ─── B Corp certification (multi-category) ────────────────────────────
  {
    name: "bcorp",
    write: (e) => {
      const out = [];
      const score = e.score || e.totalScore || e.overallScore;
      const yr = e.certifiedSince || e.year;
      const baseline = score
        ? `Certified B Corporation${yr ? ` since ${yr}` : ""}, B Impact score ${score}/200.`
        : `Certified B Corporation${yr ? ` since ${yr}` : ""}.`;
      out.push({ category: "labor", narrative: baseline, sc: "positive" });
      out.push({ category: "environment", narrative: baseline, sc: "positive" });
      out.push({ category: "dei", narrative: baseline, sc: "pro_dei" });
      return out;
    },
  },
  // ─── SBTi (Science-Based Targets) ────────────────────────────────────
  {
    name: "sbti",
    write: (e) => {
      const status = e.status || e.targetStatus || "Target Validated";
      const temp = e.temperatureCommitment ? ` (${e.temperatureCommitment})` : "";
      return [{
        category: "environment",
        narrative: `Science Based Targets initiative: ${status}${temp}. Emissions reduction targets independently validated.`,
        sc: "positive",
        severity: "positive",
      }];
    },
  },
  // ─── Net Zero Tracker ────────────────────────────────────────────────
  {
    name: "net-zero-tracker",
    write: (e) => {
      const yr = e.targetYear || e.netZeroYear;
      const quality = e.qualityScore || e.assessment || "tracked";
      const grade = e.grade;
      const narrative = `Net-zero pledge${yr ? ` by ${yr}` : ""}${grade ? ` (Net Zero Tracker grade: ${grade})` : ""}.`;
      const sc = grade === "A" || grade === "B" ? "positive" : grade === "F" || grade === "D" ? "negative" : "mixed";
      return [{ category: "environment", narrative, sc, severity: sc }];
    },
  },
  // ─── Textile Exchange (apparel certs) ────────────────────────────────
  {
    name: "textile-exchange",
    write: (e) => {
      const certs = Array.isArray(e.certifications) ? e.certifications : (e.certs || []);
      if (!certs.length) return [];
      const out = [
        { category: "environment", narrative: `Textile Exchange certified: ${certs.join(", ")}.`, sc: "positive" },
      ];
      if (certs.some(c => /RWS|RDS/i.test(c))) {
        out.push({ category: "animals", narrative: `Certified to Responsible Wool/Down Standard (animal welfare audited supply chain).`, sc: "positive" });
      }
      return out;
    },
  },
  // ─── Disability:IN ────────────────────────────────────────────────────
  {
    name: "disability-in",
    write: (e) => {
      const score = e.score || e.index;
      if (score == null) return [];
      const sc = score >= 90 ? "pro_dei" : score >= 70 ? "pro_dei" : "mixed";
      return [{
        category: "dei",
        narrative: `Disability:IN Equality Index score ${score}/100.`,
        sc, severity: "positive",
      }];
    },
  },
  // ─── EPA SmartWay (clean trucking) ────────────────────────────────────
  {
    name: "epa-smartway",
    write: (e) => [{
      category: "environment",
      narrative: `EPA SmartWay partner — commits to measure + reduce freight transportation emissions.`,
      sc: "positive",
      severity: "positive",
    }],
  },
  // ─── EPA Green Vehicle ────────────────────────────────────────────────
  {
    name: "epa-green-vehicle",
    write: (e) => {
      const models = e.models || e.vehicles;
      const ct = Array.isArray(models) ? models.length : null;
      return [{
        category: "environment",
        narrative: `EPA Green Vehicle Guide${ct ? `: ${ct} eligible model(s) listed` : " participation"}.`,
        sc: "positive",
      }];
    },
  },
  // ─── NLRB voluntary union recognition (positive labor) ────────────────
  {
    name: "nlrb-voluntary-recognition",
    write: (e) => [{
      category: "labor",
      narrative: `Voluntarily recognized union(s) — NLRB record of non-contested union elections.`,
      sc: "positive",
      severity: "positive",
    }],
  },
  // ─── Cornell ILR labor strike tracker (negative labor) ────────────────
  {
    name: "cornell-ilr",
    write: (e) => {
      const actions = e.actionCount || e.totalActions || e.count;
      if (!actions) return [];
      const sc = actions >= 50 ? "poor" : actions >= 10 ? "mixed" : "neutral";
      return [{
        category: "labor",
        narrative: `${actions} documented labor actions (strikes, protests, work stoppages) per Cornell ILR Labor Action Tracker.`,
        sc, severity: "negative",
      }];
    },
  },
  // ─── DOL WHD wage violations ──────────────────────────────────────────
  {
    name: "dol-whd-violations",
    write: (e) => {
      const total = e.totalBackWages || e.backWages;
      const cases = e.caseCount || e.cases;
      if (!total && !cases) return [];
      const tStr = total ? `$${(total / 1e6).toFixed(2)}M in back wages owed to workers` : `${cases} wage/hour violations`;
      return [{
        category: "labor",
        narrative: `DOL Wage & Hour Division: ${tStr}${cases ? ` across ${cases} cases` : ""}.`,
        sc: "poor",
        severity: "negative",
      }];
    },
  },
  // ─── Exec political donations (FEC) ───────────────────────────────────
  // Actual augment shape: { political: { execDonationLean: "D+31", totalUsd,
  // donorCount, year, sources } }. The lean string uses PVI-style notation:
  //   D+X = X percentage points more Democratic than Republican
  //   R+X = X percentage points more Republican than Democratic
  // Translation to our enum:
  //   D+30+ or R+30+  → strong lean (left / right)
  //   D+10..29 / R+10..29 → moderate lean (left-leaning / right-leaning)
  //   D/R +0..9          → mixed (donates to both sides)
  {
    name: "exec-political-donations",
    write: (e) => {
      const p = e.political || e;
      const lean = p.execDonationLean || p.lean || p.partisanLean;
      const total = p.totalUsd || p.total || 0;
      const donors = p.donorCount || null;
      if (!lean) return [];
      const m = /^([DR])\+(\d+)$/i.exec(String(lean));
      let enum_ = "bipartisan";
      let label = lean;
      if (m) {
        const dir = m[1].toUpperCase();
        const margin = parseInt(m[2], 10);
        if (margin >= 30)      enum_ = dir === "D" ? "left" : "right";
        else if (margin >= 10) enum_ = dir === "D" ? "left-leaning" : "right-leaning";
        else                   enum_ = "bipartisan";
        label = `${dir === "D" ? "Democratic" : "Republican"} +${margin}`;
      } else if (/bipartisan|mixed/i.test(lean)) {
        enum_ = "bipartisan";
      }
      const totalStr = total >= 1e6 ? `$${(total / 1e6).toFixed(2)}M`
        : total >= 1e3 ? `$${Math.round(total / 1e3)}K`
        : total > 0 ? `$${total}` : "";
      const donorStr = donors ? ` across ${donors} executive donors` : "";
      const parts = [];
      if (totalStr) parts.push(`${totalStr} in executive political donations`);
      parts.push(`partisan lean ${label}`);
      const narrative = `FEC: ${parts.join("; ")}${donorStr}.`;
      return [{ category: "political", narrative, sc: enum_ }];
    },
  },
  // ─── Firearms industry ────────────────────────────────────────────────
  {
    name: "firearms-industry",
    write: (e) => {
      if (!e || (!e.atfFfl && !e.sellsGuns && !e.makesGuns)) return [];
      const enum_ = e.makesGuns ? "makes_guns" : e.sellsGuns ? "sells_guns" : "neutral";
      const what = e.makesGuns ? "Manufactures firearms" : e.sellsGuns ? "Sells firearms" : "Firearms-industry tie";
      return [{
        category: "guns",
        narrative: `${what} (ATF FFL or industry registration).`,
        sc: enum_,
      }];
    },
  },
  // ─── FDAAA TrialsTracker ──────────────────────────────────────────────
  {
    name: "fdaaa-trials",
    write: (e) => {
      const total = e.totalTrials || e.trialCount;
      const late = e.lateOrMissing || e.unreported;
      if (!total) return [];
      const lateCount = late || 0;
      const sc = lateCount / total >= 0.5 ? "poor" : lateCount / total >= 0.2 ? "mixed" : "good";
      return [{
        category: "health",
        narrative: `FDAAA TrialsTracker: ${lateCount} of ${total} clinical trial results late or unreported (per federal disclosure requirements).`,
        sc, severity: lateCount > 0 ? "negative" : "positive",
      }];
    },
  },
  // ─── KnowTheChain forced-labor benchmark (ICT/Apparel/F&B) ───────────
  {
    name: "knowthechain",
    write: (e) => {
      const score = e.score;
      if (score == null) return [];
      const sector = e.sector || "industry";
      const year = e.year || "";
      // KTC bands: <40 poor; 40–60 mid; >60 strong
      let sc, severity;
      if (score >= 60) { sc = "positive"; severity = "positive"; }
      else if (score < 25) { sc = "very_poor"; severity = "negative"; }
      else if (score < 40) { sc = "poor"; severity = "negative"; }
      else { sc = "mixed"; severity = "mixed"; }
      const narrative = `KnowTheChain Forced-Labor Benchmark${year ? ` (${year})` : ""}: ${score}/100 (${sector}). ${score >= 60 ? "Among sector leaders for supply-chain due diligence." : score < 40 ? "Below sector average — gaps in supplier disclosure, worker voice, or grievance remedy." : "Mid-pack on supply-chain disclosure and remedy."}`;
      return [{ category: "labor", narrative, sc, severity }];
    },
  },
  // ─── Fashion Revolution Transparency Index ────────────────────────────
  {
    name: "fashion-revolution",
    write: (e) => {
      const score = e.score;
      if (score == null) return [];
      let sc, severity;
      if (score >= 60) { sc = "positive"; severity = "positive"; }
      else if (score >= 30) { sc = "mixed"; severity = "mixed"; }
      else if (score >= 10) { sc = "poor"; severity = "negative"; }
      else { sc = "very_poor"; severity = "negative"; }
      const narrative = `Fashion Revolution Transparency Index: ${score}% disclosure across supply chain, policies, governance, and impact. ${score >= 60 ? "Top-tier disclosure for an apparel brand." : score >= 30 ? "Mid-pack apparel transparency." : "Among the least-transparent major apparel brands."}`;
      return [{ category: "labor", narrative, sc, severity }];
    },
  },
  // ─── Corporate Human Rights Benchmark (CHRB / WBA) ────────────────────
  {
    name: "chrb",
    write: (e) => {
      const score = e.score;
      if (score == null) return [];
      const sector = e.sector ? ` (${e.sector})` : "";
      // CHRB scale 0–26: leader ≥16, mid 8–15.9, laggard <8
      let sc, severity;
      if (score >= 16) { sc = "positive"; severity = "positive"; }
      else if (score >= 8) { sc = "mixed"; severity = "mixed"; }
      else { sc = "poor"; severity = "negative"; }
      const narrative = `Corporate Human Rights Benchmark${sector}: ${score}/26 on UN Guiding Principles assessment (policy, due diligence, remedy, and serious-allegation response).`;
      return [{ category: "labor", narrative, sc, severity }];
    },
  },
  // ─── DOL TVPRA Goods List supply-chain exposure ───────────────────────
  {
    name: "dol-tvpra",
    write: (e) => {
      const goods = Array.isArray(e.goods) ? e.goods : [];
      if (!goods.length) return [];
      const sev = e.severity || "medium";
      const sc = sev === "high" ? "very_poor" : "poor";
      const narrative = `DOL TVPRA exposure — supply chain includes ${goods.join(", ")} from countries on the US Department of Labor's List of Goods Produced by Child Labor or Forced Labor.`;
      return [{ category: "labor", narrative, sc, severity: "negative" }];
    },
  },
  // ─── Fair Labor Association affiliate ─────────────────────────────────
  {
    name: "fair-labor-association",
    write: (e) => {
      const status = e.status || "participating";
      const since = e.affiliateSince;
      const narrative = `Fair Labor Association ${status === "accredited" ? "accredited" : "participating"} affiliate${since ? ` since ${since}` : ""} — publicly discloses Tier-1 suppliers, accepts independent factory audits, and remediates findings.`;
      return [{ category: "labor", narrative, sc: "positive", severity: "positive" }];
    },
  },
  // ─── UK Modern Slavery Statement registry ─────────────────────────────
  // Presence = compliance baseline (neutral positive). Only used when no
  // stronger labor signal exists.
  {
    name: "uk-modern-slavery",
    write: (e) => {
      const yr = e.latestYear;
      if (e.status === "weak-or-non-compliant") {
        return [{
          category: "labor",
          narrative: `No public UK Modern Slavery Act statement on the Home Office registry — Section 54 compliance gap.`,
          sc: "poor", severity: "negative",
        }];
      }
      if (!yr) return [];
      return [{
        category: "labor",
        narrative: `Publishes UK Modern Slavery Act Section 54 statement${yr ? ` (latest ${yr})` : ""} — discloses supply-chain due-diligence steps.`,
        sc: "neutral", severity: "positive",
      }];
    },
  },
  // ─── Australia Modern Slavery Register ────────────────────────────────
  {
    name: "au-modern-slavery",
    write: (e) => {
      const yr = e.latestYear;
      if (!yr) return [];
      return [{
        category: "labor",
        narrative: `Publishes Australia Modern Slavery Act statement${yr ? ` (latest ${yr})` : ""} — annual disclosure of supply-chain modern-slavery risk + remediation.`,
        sc: "neutral", severity: "positive",
      }];
    },
  },
  // ─── EITI extractive transparency supporter ───────────────────────────
  {
    name: "eiti",
    write: (e) => {
      const since = e.supporterSince;
      return [{
        category: "labor",
        narrative: `EITI (Extractive Industries Transparency Initiative) supporting company${since ? ` since ${since}` : ""} — publicly discloses payments to host governments and beneficial-ownership data.`,
        sc: "positive", severity: "positive",
      }];
    },
  },
  // ─── Industry carbon intensity (sector inferred) ──────────────────────
  {
    name: "industry-carbon-intensity",
    write: (e) => {
      const cat = e.category || e.sector;
      const intensity = e.intensity || e.tier;
      if (!intensity) return [];
      const sc = intensity === "high" ? "poor" : intensity === "low" ? "good" : "mixed";
      return [{
        category: "environment",
        narrative: `Sector carbon intensity: ${intensity}${cat ? ` (${cat})` : ""} — industry benchmark inference.`,
        sc, inferred: true,
      }];
    },
  },
];

// ─── Apply ──────────────────────────────────────────────────────────────
const augmentsLoaded = {};
const writerMap = {};
for (const w of WRITERS) {
  const aug = loadAugment(w.name);
  if (!aug) { console.log(`[skip] no augment file: ${w.name}`); continue; }
  augmentsLoaded[w.name] = entriesOf(aug);
  writerMap[w.name] = w;
  console.log(`[load] ${w.name}: ${augmentsLoaded[w.name].length} entries`);
}

// Supply-chain & labor-rights sources — when a brand has 3+ of these
// hits in the "labor" category, we append a richer combined sentence to
// the existing narrative (rather than skipping under "first wins").
// This honours the rule: "If a brand has data from 3+ sources, write a
// richer combined narrative; don't truncate."
const SUPPLY_CHAIN_SOURCES = new Set([
  "knowthechain",
  "fashion-revolution",
  "chrb",
  "dol-tvpra",
  "fair-labor-association",
  "uk-modern-slavery",
  "au-modern-slavery",
  "eiti",
]);

function buildSupplyChainSummary(hits) {
  const labels = [];
  for (const [name, w] of hits) {
    if (name === "knowthechain") labels.push(`KnowTheChain ${w._raw?.score ?? "?"}/100`);
    else if (name === "chrb") labels.push(`CHRB ${w._raw?.score ?? "?"}/26`);
    else if (name === "fashion-revolution") labels.push(`Fashion Rev ${w._raw?.score ?? "?"}%`);
    else if (name === "fair-labor-association") labels.push(`FLA affiliate`);
    else if (name === "dol-tvpra") labels.push(`TVPRA exposure`);
    else if (name === "uk-modern-slavery") labels.push(w._raw?.status === "weak-or-non-compliant" ? "UK MS gap" : "UK MS statement");
    else if (name === "au-modern-slavery") labels.push("AU MS statement");
    else if (name === "eiti") labels.push("EITI supporter");
  }
  return labels.length ? ` Supply-chain signals: ${labels.join("; ")}.` : "";
}

const compFiles = fs.readdirSync(COMP_DIR).filter(f => f.endsWith(".json"));
let companyHits = 0;
let categoryWrites = 0;
let supplyChainAppends = 0;
const perCategoryHits = {};
const patagoniaTrace = [];

for (const f of compFiles) {
  const filePath = path.join(COMP_DIR, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }
  const slug = d.slug || f.replace(/\.json$/, "");
  let touched = false;

  // First pass: collect supply-chain hits keyed by source name, with the raw entry attached
  const supplyChainHits = [];
  for (const [name, entries] of Object.entries(augmentsLoaded)) {
    if (!SUPPLY_CHAIN_SOURCES.has(name)) continue;
    const hit = entries.find(([k]) => k === slug);
    if (!hit) continue;
    const writes = writerMap[name].write(hit[1], slug);
    for (const w of writes) {
      if (w?.category === "labor") {
        supplyChainHits.push([name, { ...w, _raw: hit[1] }]);
      }
    }
  }

  for (const [name, entries] of Object.entries(augmentsLoaded)) {
    const hit = entries.find(([k]) => k === slug);
    if (!hit) continue;
    const [, entry] = hit;
    const writes = writerMap[name].write(entry, slug);
    for (const w of writes) {
      if (!w || !w.category) continue;
      const existing = d[w.category] || {};
      const existingS = String(existing.s || "");
      // First non-no-record narrative wins (Aron's rule).
      if (existingS && !NO_RECORD.test(existingS)) {
        if (slug === "patagonia") patagoniaTrace.push(`  ${w.category}: SKIP (already filled by earlier source)`);
        continue;
      }
      d[w.category] = { ...existing, s: w.narrative, sources: [...(existing.sources || []), name] };
      if (w.sc) {
        d.sc = d.sc || {};
        d.sc[w.category] = w.sc;
      }
      touched = true;
      categoryWrites++;
      perCategoryHits[w.category] = (perCategoryHits[w.category] || 0) + 1;
      if (slug === "patagonia") patagoniaTrace.push(`  ${w.category} ← ${name}: "${w.narrative.slice(0, 80)}" (sc=${w.sc || "-"})`);
    }
  }

  // ─── Supply-chain combined sentence: ≥3 sources hit on labor ────────
  if (supplyChainHits.length >= 3) {
    const existing = d.labor || {};
    const existingS = String(existing.s || "");
    const summary = buildSupplyChainSummary(supplyChainHits);
    if (summary && !existingS.includes("Supply-chain signals")) {
      const newS = existingS && !NO_RECORD.test(existingS)
        ? `${existingS.trim()}${summary}`
        : summary.trim();
      const newSources = Array.from(new Set([
        ...(existing.sources || []),
        ...supplyChainHits.map(([n]) => n),
      ]));
      d.labor = { ...existing, s: newS, sources: newSources };
      supplyChainAppends++;
      touched = true;
      if (slug === "patagonia") patagoniaTrace.push(`  labor APPEND: supply-chain (${supplyChainHits.length} sources)`);
    }
  }

  if (touched) {
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
    companyHits++;
  }
}

console.log("");
console.log(`=== APPLY DONE ===`);
console.log(`  Companies touched: ${companyHits} / ${compFiles.length}`);
console.log(`  Total category narratives written: ${categoryWrites}`);
console.log(`  Supply-chain combined-summary appends: ${supplyChainAppends}`);
console.log(`  Per-category:`);
for (const [c, n] of Object.entries(perCategoryHits)) {
  console.log(`    ${c.padEnd(13)} ${n}`);
}
console.log("");
console.log(`=== Patagonia trace ===`);
patagoniaTrace.forEach(l => console.log(l));
