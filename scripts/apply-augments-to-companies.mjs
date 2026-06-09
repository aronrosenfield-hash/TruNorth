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
  // ─── USTR Notorious Markets (counterfeit/piracy IP concerns) ──────────
  // Flagged as a privacy/trust concern — these platforms knowingly host
  // counterfeit goods or pirated content per USTR's annual review.
  {
    name: "ustr-notorious-markets",
    write: (e) => {
      const p = e.privacy;
      if (!p || !p.ustrNotoriousMarket) return [];
      const concernStr = p.concern || "counterfeit goods or piracy";
      const ops = p.operator ? ` (operator: ${p.operator})` : "";
      return [{
        category: "privacy",
        narrative: `USTR ${p.listYear || ""} Notorious Markets List: flagged for ${concernStr} via ${p.marketName}${ops}.`.replace(/\s+/g, " ").trim(),
        sc: "poor",
        severity: "negative",
      }];
    },
  },
  // ─── Common Sense Privacy ─────────────────────────────────────────────
  // Worst tier across all flagship products of a corporate slug. Warning
  // = "fails minimum Common Sense safeguards"; Pass is rare and salient.
  {
    name: "common-sense-privacy",
    write: (e) => {
      const p = e.privacy;
      if (!p || !p.csPrivacyWorstTier) return [];
      const prods = Array.isArray(p.csPrivacyProducts) ? p.csPrivacyProducts : [];
      if (!prods.length) return [];
      const tier = p.csPrivacyWorstTier;
      const names = prods.map(x => x.product).slice(0, 3).join(", ")
        + (prods.length > 3 ? ` (+${prods.length - 3} more)` : "");
      let narrative, sc, sev;
      if (tier === "fail") {
        narrative = `Common Sense Privacy: Fail rating across ${prods.length} product(s) (${names}) — fails minimum data-protection safeguards.`;
        sc = "poor"; sev = "negative";
      } else if (tier === "warning") {
        narrative = `Common Sense Privacy: Warning rating across ${prods.length} product(s) (${names}) — does not meet minimum data-protection safeguards.`;
        sc = "poor"; sev = "negative";
      } else if (tier === "pass") {
        narrative = `Common Sense Privacy: Pass rating on ${prods.length} product(s) (${names}) — meets data-protection safeguards.`;
        sc = "good"; sev = "positive";
      } else {
        return [];
      }
      return [{ category: "privacy", narrative, sc, severity: sev }];
    },
  },
  // ─── Consumer Reports Auto Brand Report Card ──────────────────────────
  // Reliability ranking drives a quality-of-product signal that maps to
  // the health category (closest semantic: consumer safety + reliability).
  {
    name: "cr-auto-reliability",
    write: (e) => {
      const h = e.health;
      if (!h || !h.crBrandRank) return [];
      const tier = h.crTier || "midpack";
      const sc = tier === "top10" ? "good" : tier === "bottom5" ? "poor" : "mixed";
      const sev = tier === "top10" ? "positive" : tier === "bottom5" ? "negative" : "neutral";
      const rel = h.crReliabilityRank
        ? ` and #${h.crReliabilityRank} for reliability`
        : "";
      return [{
        category: "health",
        narrative: `Consumer Reports ${h.seedYear || ""} Brand Report Card: ranked #${h.crBrandRank} of ~26 auto brands${rel}.`.replace(/\s+/g, " ").trim(),
        sc, severity: sev,
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

const compFiles = fs.readdirSync(COMP_DIR).filter(f => f.endsWith(".json"));
let companyHits = 0;
let categoryWrites = 0;
const perCategoryHits = {};
const patagoniaTrace = [];

for (const f of compFiles) {
  const filePath = path.join(COMP_DIR, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { continue; }
  const slug = d.slug || f.replace(/\.json$/, "");
  let touched = false;

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

  if (touched) {
    fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
    companyHits++;
  }
}

console.log("");
console.log(`=== APPLY DONE ===`);
console.log(`  Companies touched: ${companyHits} / ${compFiles.length}`);
console.log(`  Total category narratives written: ${categoryWrites}`);
console.log(`  Per-category:`);
for (const [c, n] of Object.entries(perCategoryHits)) {
  console.log(`    ${c.padEnd(13)} ${n}`);
}
console.log("");
console.log(`=== Patagonia trace ===`);
patagoniaTrace.forEach(l => console.log(l));
