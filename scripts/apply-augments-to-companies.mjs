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

// Sources whose narratives can be combined into a multi-source positive
// summary. When a brand sits on multiple of these lists we concatenate the
// narratives instead of letting "first wins" hide later evidence.
const POSITIVE_MERGE_SOURCES = new Set([
  "bcorp", "just-capital", "drucker-250", "fortune-admired", "forbes-employers",
  "hrc-cei", "bloomberg-gei", "cdp-a-list", "climate-neutral", "fair-trade",
  "newsweek-trust", "one-percent-planet", "disability-in", "sbti",
  "net-zero-tracker", "textile-exchange", "epa-smartway", "epa-green-vehicle",
  "nlrb-voluntary-recognition", "corporate-giving",
]);

const NEGATIVE_OR_NEUTRAL_SCS = new Set([
  "neutral", "na", "mixed", "unknown", undefined, null, "",
]);

const TRACE_SLUGS = new Set([
  "patagonia", "ben-and-jerry-s", "microsoft", "salesforce", "costco",
]);

function loadAugment(name) {
  const p = path.join(AUG_DIR, `${name}-augment.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function entriesOf(aug) {
  // Augments can be { slug: data }, { companies: { slug: data } },
  // or { bySlug: { slug: data } } depending on age of the merger.
  if (!aug) return [];
  const root = aug.bySlug || aug.companies || aug;
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
  // (bcorp writer moved below — multi-category positive with merge support)
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
      const score = e.score || e.index || e.dei_score;
      if (score == null) return [];
      const sc = score >= 90 ? "pro_dei" : score >= 70 ? "pro_dei" : "mixed";
      return [{
        category: "dei",
        narrative: `Disability:IN Equality Index score ${score}/100.`,
        sc, severity: "positive", mergePositive: true,
      }];
    },
  },
  // ─── B Corp Directory (multi-cat: labor + environment + dei) ──────────
  {
    name: "bcorp",
    write: (e) => {
      const score = e.score;
      const yr = e.certifiedSince;
      const baseline = score
        ? `Certified B Corporation${yr ? ` since ${yr}` : ""} (B Impact score ${score}/200).`
        : `Certified B Corporation${yr ? ` since ${yr}` : ""}.`;
      return [
        { category: "labor",       narrative: baseline, sc: "positive",  mergePositive: true },
        { category: "environment", narrative: baseline, sc: "positive",  mergePositive: true },
        { category: "dei",         narrative: baseline, sc: "pro_dei",   mergePositive: true },
        { category: "charity",     narrative: baseline, sc: "positive",  mergePositive: true },
      ];
    },
  },
  // ─── JUST Capital JUST 100 (multi-dimensional positive) ───────────────
  {
    name: "just-capital",
    write: (e) => {
      const baseline = `JUST Capital JUST 100 — ranked #${e.rank} of Russell 1000 (${e.year}) for treatment of workers, customers, communities, environment.`;
      return [
        { category: "labor",       narrative: baseline, sc: "positive", mergePositive: true },
        { category: "environment", narrative: baseline, sc: "positive", mergePositive: true },
        { category: "dei",         narrative: baseline, sc: "pro_dei",  mergePositive: true },
        { category: "charity",     narrative: baseline, sc: "positive", mergePositive: true },
      ];
    },
  },
  // ─── Drucker Institute Management Top 250 ─────────────────────────────
  {
    name: "drucker-250",
    write: (e) => {
      const baseline = `Drucker Institute Management Top 250 — ranked #${e.rank} (${e.year}) on customer satisfaction, employee engagement, innovation, social responsibility, and financial strength.`;
      return [
        { category: "labor",       narrative: baseline, sc: "positive", mergePositive: true },
        { category: "charity",     narrative: baseline, sc: "positive", mergePositive: true },
      ];
    },
  },
  // ─── Fortune World's Most Admired ─────────────────────────────────────
  {
    name: "fortune-admired",
    write: (e) => {
      const baseline = `Fortune World's Most Admired Companies — ranked #${e.rank} (${e.year}).`;
      return [
        { category: "labor",   narrative: baseline, sc: "positive", mergePositive: true },
        { category: "charity", narrative: baseline, sc: "positive", mergePositive: true },
      ];
    },
  },
  // ─── Forbes World's Best Employers ────────────────────────────────────
  {
    name: "forbes-employers",
    write: (e) => {
      const baseline = `Forbes World's Best Employers — ranked #${e.rank} (${e.year}) by employee survey.`;
      return [
        { category: "labor", narrative: baseline, sc: "positive", mergePositive: true },
      ];
    },
  },
  // ─── HRC Corporate Equality Index ─────────────────────────────────────
  {
    name: "hrc-cei",
    write: (e) => [{
      category: "dei",
      narrative: `HRC Corporate Equality Index ${e.cei_score}/100 (${e.year}) — top-tier LGBTQ+ workplace equality rating.`,
      sc: "pro_dei", mergePositive: true,
    }],
  },
  // ─── Bloomberg Gender-Equality Index ──────────────────────────────────
  {
    name: "bloomberg-gei",
    write: (e) => [{
      category: "dei",
      narrative: `Bloomberg Gender-Equality Index member (${e.year}) — transparent on female leadership, equal pay, inclusive culture.`,
      sc: "pro_dei", mergePositive: true,
    }],
  },
  // ─── CDP A-List (Climate) ─────────────────────────────────────────────
  {
    name: "cdp-a-list",
    write: (e) => [{
      category: "environment",
      narrative: `CDP A-List (${e.year}) — top tier for climate disclosure and emissions-reduction action.`,
      sc: "positive", mergePositive: true,
    }],
  },
  // ─── Climate Neutral Certified ────────────────────────────────────────
  {
    name: "climate-neutral",
    write: (e) => [{
      category: "environment",
      narrative: `Climate Neutral Certified${e.year ? ` (${e.year})` : ""} — third-party verified measurement, offsetting, and reduction of full-business carbon footprint.`,
      sc: "positive", mergePositive: true,
    }],
  },
  // ─── Fair Trade Certified ─────────────────────────────────────────────
  {
    name: "fair-trade",
    write: (e) => {
      const what = e.products ? ` (${e.products})` : "";
      const baseline = `Fair Trade Certified partner${what} — sources through cooperatives guaranteeing minimum prices and community premiums.`;
      return [
        { category: "labor",       narrative: baseline, sc: "positive", mergePositive: true },
        { category: "environment", narrative: baseline, sc: "positive", mergePositive: true },
      ];
    },
  },
  // ─── Newsweek Most Trustworthy Companies ──────────────────────────────
  {
    name: "newsweek-trust",
    write: (e) => [{
      category: "charity",
      narrative: `Newsweek Most Trustworthy Companies in America — ranked #${e.rank} (${e.year}).`,
      sc: "positive", mergePositive: true,
    }],
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
  // ─── HRC Corporate Equality Index — LGBTQ+ workplace policy ──────────
  {
    name: "hrc-cei",
    write: (e) => {
      const l = e.lgbtq;
      if (!l || typeof l.score !== "number") return [];
      const yr = l.vintage ? ` (${l.vintage})` : "";
      let narrative, sc;
      if (l.score >= 100) {
        narrative = `HRC Corporate Equality Index: 100/100 — Equality 100 Leader${yr}. Top-rated LGBTQ+ workplace policies, benefits, and culture.`;
        sc = "pro_dei";
      } else if (l.score >= 80) {
        narrative = `HRC Corporate Equality Index: ${l.score}/100${yr} — strong LGBTQ+ workplace policies with minor deductions.`;
        sc = "pro_dei";
      } else if (l.score >= 60) {
        narrative = `HRC Corporate Equality Index: ${l.score}/100${yr} — partial LGBTQ+ workplace policy coverage; gaps remain.`;
        sc = "neutral";
      } else {
        narrative = `HRC Corporate Equality Index: ${l.score}/100${yr} — lapsed / non-responsive to LGBTQ+ workplace policy survey.`;
        sc = "anti_dei";
      }
      return [{ category: "dei", narrative, sc, severity: l.score >= 80 ? "positive" : "negative" }];
    },
  },
  // ─── CDP Climate Change disclosure score ─────────────────────────────
  {
    name: "cdp-climate",
    write: (e) => {
      const d = e.climateDisclosure;
      if (!d || !d.score) return [];
      const yr = d.vintage ? ` (${d.vintage})` : "";
      let narrative, sc;
      if (d.score === "A" || d.score === "A-") {
        narrative = `CDP Climate Change: ${d.score}${yr} — leadership-band environmental disclosure with validated targets.`;
        sc = "good";
      } else if (d.score === "B" || d.score === "B-") {
        narrative = `CDP Climate Change: ${d.score}${yr} — management-band disclosure; discloses emissions data but limited target ambition.`;
        sc = "mixed";
      } else if (d.score === "C" || d.score === "C-") {
        narrative = `CDP Climate Change: ${d.score}${yr} — awareness-band only; minimal target-setting.`;
        sc = "mixed";
      } else if (d.score === "F") {
        narrative = `CDP Climate Change: F${yr} — declined to disclose despite investor request${d.note ? ` (${d.note})` : ""}.`;
        sc = "poor";
      } else {
        narrative = `CDP Climate Change: ${d.score}${yr}.`;
        sc = "mixed";
      }
      return [{ category: "environment", narrative, sc, severity: sc === "good" ? "positive" : sc === "poor" ? "negative" : "neutral" }];
    },
  },
  // ─── NCRC / FFIEC CRA bank ratings ───────────────────────────────────
  {
    name: "ncrc-cra",
    write: (e) => {
      const c = e.cra;
      if (!c || !c.rating) return [];
      const yr = c.exam_year ? ` (${c.exam_year} exam)` : "";
      const noteSfx = c.note ? ` — ${c.note}` : "";
      let narrative, sc, severity;
      if (c.rating === "Outstanding") {
        narrative = `Community Reinvestment Act rating: Outstanding${yr} — exceeds expectations for serving low- and moderate-income communities.${noteSfx}`;
        sc = "good"; severity = "positive";
      } else if (c.rating === "Satisfactory") {
        narrative = `Community Reinvestment Act rating: Satisfactory${yr} — meets baseline expectations for community lending and services.${noteSfx}`;
        sc = "mixed"; severity = "neutral";
      } else if (c.rating === "Needs to Improve") {
        narrative = `Community Reinvestment Act rating: Needs to Improve${yr}${noteSfx}.`;
        sc = "poor"; severity = "negative";
      } else {
        narrative = `Community Reinvestment Act rating: Substantial Noncompliance${yr}${noteSfx}.`;
        sc = "poor"; severity = "negative";
      }
      // CRA is a labor/community-impact signal — route to labor since
      // TruNorth doesn't yet have a dedicated 'community' category.
      return [{ category: "labor", narrative, sc, severity }];
    },
  },
  // ─── GLAAD Studio Responsibility Index — LGBTQ+ media content ────────
  {
    name: "glaad-sri",
    write: (e) => {
      const g = e.lgbtqMedia;
      if (!g || !g.grade) return [];
      const yr = g.vintage ? ` (${g.vintage})` : "";
      const pct = g.inclusivePct != null ? ` — ${g.inclusivePct}% inclusive slate` : "";
      let narrative, sc;
      if (g.grade === "Excellent" || g.grade === "Good") {
        narrative = `GLAAD ${g.category || "studio"} scorecard: ${g.grade}${yr}${pct}. Strong LGBTQ+ representation in published slate.`;
        sc = "pro_dei";
      } else if (g.grade === "Fair") {
        narrative = `GLAAD ${g.category || "studio"} scorecard: Fair${yr}${pct} — partial LGBTQ+ representation.`;
        sc = "neutral";
      } else {
        narrative = `GLAAD ${g.category || "studio"} scorecard: ${g.grade}${yr}${pct} — insufficient LGBTQ+ representation.`;
        sc = "anti_dei";
      }
      return [{ category: "dei", narrative, sc, severity: sc === "pro_dei" ? "positive" : sc === "anti_dei" ? "negative" : "neutral" }];
    },
  },
  // ─── Mind Share Partners — workplace-mental-health pledge ────────────
  {
    name: "mind-share-partners",
    write: (e) => {
      const m = e.mentalHealth;
      if (!m || !m.program) return [];
      const since = m.since ? ` (since ${m.since})` : "";
      return [{
        category: "labor",
        narrative: `${m.program} signatory${since}: public commitment to gold-standard workplace mental-health policy, C-suite accountability, and measurable outcomes.`,
        sc: "good",
        severity: "positive",
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
  // ─── High-credibility investigative news (ProPublica, The Markup, etc.)
  // Per-brand augment shape: { investigations: [], categorySummary: { [cat]: { count, sc, severity, narrative, sources, topItems } } }
  // We replay each categorySummary entry as a writer output.
  {
    name: "high-cred-news",
    write: (e) => {
      const cs = e.categorySummary || {};
      const out = [];
      for (const [cat, sum] of Object.entries(cs)) {
        if (!sum || !sum.narrative) continue;
        out.push({
          category: cat,
          narrative: sum.narrative,
          sc: sum.sc,
          severity: sum.severity || "negative",
        });
      }
      return out;
    },
  },
  // ─── Fact-check verdicts (PolitiFact, Snopes, FactCheck.org)
  // Routes to "transparency" category — false corporate claims tank
  // transparency, true ones lift it.
  {
    name: "factcheck-verdicts",
    write: (e) => {
      const s = e.summary;
      if (!s || !s.narrative) return [];
      return [{
        category: "transparency",
        narrative: s.narrative,
        sc: s.sc,
        severity: s.severity || "neutral",
      }];
    },
  },
  // ─── Corporate PR wire (PR Newswire, Business Wire)
  // Self-claims — narratives EXPLICITLY say "Company announcement" so
  // consumers know this isn't independent verification.
  {
    name: "corporate-prwire",
    write: (e) => {
      const cs = e.categorySummary || {};
      const out = [];
      for (const [cat, sum] of Object.entries(cs)) {
        if (!sum || !sum.narrative) continue;
        out.push({
          category: cat,
          narrative: sum.narrative,
          sc: sum.sc,
          severity: "positive",
        });
      }
      return out;
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
const patagoniaTrace = {};
for (const s of TRACE_SLUGS) patagoniaTrace[s] = [];

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
      const existingSources = existing.sources || [];
      const existingPositive = existingSources.some(s => POSITIVE_MERGE_SOURCES.has(s));
      const isNoRecord = !existingS || NO_RECORD.test(existingS);

      // Three cases:
      //  1) No existing → write fresh.
      //  2) Existing positive merge-source AND this writer is mergePositive →
      //     append narrative + add source (multi-source enrichment).
      //  3) Existing non-no-record → skip (first wins).
      if (isNoRecord) {
        d[w.category] = { ...existing, s: w.narrative, sources: [...existingSources, name] };
      } else if (w.mergePositive && existingPositive && !existingS.includes(w.narrative)) {
        const merged = `${existingS.replace(/\s+$/, "")} ${w.narrative}`;
        d[w.category] = { ...existing, s: merged, sources: [...existingSources, name] };
      } else {
        if (TRACE_SLUGS.has(slug)) patagoniaTrace[slug].push(`  ${w.category}: SKIP (already filled by earlier source)`);
        continue;
      }
      if (w.sc) {
        d.sc = d.sc || {};
        // Upgrade sc only when going from no-record OR when current sc is
        // negative/neutral and new is positive. Never downgrade an existing
        // explicit positive.
        const cur = d.sc[w.category];
        if (!cur || NEGATIVE_OR_NEUTRAL_SCS.has(cur) || isNoRecord) {
          d.sc[w.category] = w.sc;
        }
      }
      touched = true;
      categoryWrites++;
      perCategoryHits[w.category] = (perCategoryHits[w.category] || 0) + 1;
      if (TRACE_SLUGS.has(slug)) patagoniaTrace[slug].push(`  ${w.category} ← ${name}: "${w.narrative.slice(0, 80)}" (sc=${w.sc || "-"})`);
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
for (const s of TRACE_SLUGS) {
  console.log(`=== ${s} trace ===`);
  for (const l of patagoniaTrace[s]) console.log(l);
}
