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
  "climate-coalitions",
  // Round-4 product-safety / verified-mark sources
  "product-safety-deep", "ewg-skin-deep", "ewg-food",
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
  // ─── Carbon Majors (Heede 2024) — highest-priority NEGATIVE env signal.
  // Placed before SBTi/Net-Zero Tracker so historic top emitters don't get
  // greenwashed by their forward-looking pledges. ~22% of all industrial
  // GHG since 1854 traces to ~25 companies in this list.
  {
    name: "carbon-majors",
    write: (e) => {
      if (e.share_total_pct == null) return [];
      const commodities = (e.primary_commodities || []).join(" / ");
      const ownership = e.ownership === "State-Owned" ? "state-owned" : "investor-owned";
      const narrative = `Carbon Majors database (Heede 2024): ${ownership} ${commodities} producer responsible for ${e.share_total_pct.toFixed(2)}% of all industrial GHG emissions since 1854 (${e.share_since_1988_pct.toFixed(2)}% since 1988).`;
      return [{
        category: "environment",
        narrative,
        sc: "very_poor",
        severity: "negative",
      }];
    },
  },
  // ─── Banking on Climate Chaos — fossil-fuel financing 2016-2023 ──────
  {
    name: "banking-on-climate-chaos",
    write: (e) => {
      if (e.fossil_usd_b == null) return [];
      const usd = `$${e.fossil_usd_b.toFixed(1)}B`;
      const rk = e.rank ? ` (#${e.rank} globally)` : "";
      return [{
        category: "environment",
        narrative: `Banking on Climate Chaos 2024: ${usd} in fossil-fuel financing ${e.period || "2016-2023"}${rk}.`,
        sc: e.rank <= 10 ? "very_poor" : "poor",
        severity: "negative",
      }];
    },
  },
  // ─── Toxic 100 Air / Water (UMass PERI) ──────────────────────────────
  {
    name: "toxic-100",
    write: (e) => {
      const ranks = [];
      if (e.air_rank) ranks.push(`#${e.air_rank} Toxic 100 Air Polluters`);
      if (e.water_rank) ranks.push(`#${e.water_rank} Toxic 100 Water Polluters`);
      if (!ranks.length) return [];
      const worst = Math.min(e.air_rank || 99, e.water_rank || 99);
      return [{
        category: "environment",
        narrative: `UMass PERI ranks this company ${ranks.join(" and ")} (toxicity-weighted US releases).`,
        sc: worst <= 15 ? "very_poor" : "poor",
        severity: "negative",
      }];
    },
  },
  // ─── EPA GHGRP — facility-level CO2e rolled to parent ────────────────
  {
    name: "epa-ghgrp",
    write: (e) => {
      if (!e.latest_mt_co2e) return [];
      const mt = (e.latest_mt_co2e / 1e6).toFixed(2);
      const facilities = e.facility_count ? ` across ${e.facility_count} EPA-reporting facilit${e.facility_count === 1 ? "y" : "ies"}` : "";
      const tier = e.latest_mt_co2e >= 10e6 ? "very_poor" : e.latest_mt_co2e >= 1e6 ? "poor" : "mixed";
      return [{
        category: "environment",
        narrative: `EPA GHGRP ${e.latest_year}: ${mt} Mt CO2e direct emissions${facilities} reported under federal greenhouse-gas reporting program.`,
        sc: tier,
        severity: tier === "very_poor" || tier === "poor" ? "negative" : "neutral",
      }];
    },
  },
  // ─── InfluenceMap LobbyMap — corporate climate-policy lobbying ───────
  {
    name: "influence-map",
    write: (e) => {
      if (!e.grade) return [];
      let envSc, label;
      switch (e.grade) {
        case "A": envSc = "positive";  label = "actively advocates for ambitious climate policy"; break;
        case "B": envSc = "positive";  label = "broadly supports ambitious climate policy"; break;
        case "C": envSc = "mixed";     label = "mixed climate-policy engagement"; break;
        case "D": envSc = "poor";      label = "opposes major elements of climate policy"; break;
        case "E": envSc = "very_poor"; label = "strategically opposes ambitious climate policy"; break;
        case "F": envSc = "very_poor"; label = "actively obstructs climate policy"; break;
        default:  envSc = "mixed";     label = `LobbyMap grade ${e.grade}`;
      }
      return [{
        category: "environment",
        narrative: `InfluenceMap LobbyMap grade ${e.grade}: ${label} (${e.engagement || "tracked"} engagement, ${e.topline || "unknown"} topline).`,
        sc: envSc,
        severity: envSc === "positive" ? "positive" : envSc === "mixed" ? "neutral" : "negative",
      }];
    },
  },
  // ─── Climate Action 100+ benchmark ───────────────────────────────────
  {
    name: "ca100",
    write: (e) => {
      if (!e.scores) return [];
      const s = e.scores;
      const avg = e.avg_score;
      let sc;
      if (avg >= 3.5) sc = "positive";
      else if (avg >= 2.5) sc = "mixed";
      else if (avg >= 1.5) sc = "poor";
      else sc = "very_poor";
      return [{
        category: "environment",
        narrative: `Climate Action 100+ ${e.benchmark_year || ""} Net Zero Benchmark — disclosure ${s.disclosure}/5, alignment ${s.alignment}/5, governance ${s.governance}/5, capital allocation ${s.capital_allocation}/5.`,
        sc,
        severity: sc === "positive" ? "positive" : sc === "mixed" ? "neutral" : "negative",
      }];
    },
  },
  // ─── GFANZ / NZAM signatories (positive financial-sector signal) ─────
  {
    name: "gfanz",
    write: (e) => {
      if (!e.alliance) return [];
      const status = e.active ? "active member" : `withdrew ${e.withdrew}`;
      const sc = e.active ? "positive" : "mixed";
      return [{
        category: "environment",
        narrative: `${e.alliance} ${status} (signed ${e.since}) under Glasgow Financial Alliance for Net Zero (GFANZ) umbrella.`,
        sc,
        severity: sc === "positive" ? "positive" : "neutral",
      }];
    },
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
  // ─── Climate coalitions (RE100, EV100, EP100, FMC, WMBC, LEAF) ──────
  // Multi-coalition memberships consolidated into one environment
  // narrative. Conservative severity: only "positive" (verified
  // commitment) — never negative; absence from this list is not signal.
  {
    name: "climate-coalitions",
    write: (e) => {
      const ms = Array.isArray(e.memberships) ? e.memberships : [];
      if (!ms.length) return [];
      // Sort memberships by source to give stable output. Compose a
      // one-line summary like:
      //   "Member of RE100 (joined 2016, 100% renewables by 2030) and
      //    First Movers Coalition (low-carbon aluminum, shipping)."
      const sorted = [...ms].sort((a, b) => (a.source || "").localeCompare(b.source || ""));
      const phrases = sorted.map((m) => {
        const label = m.sourceLabel || m.source;
        const yr = m.joinedYear ? ` (since ${m.joinedYear}` : "";
        const target = m.targetYear ? `${yr ? "; " : " ("}target ${m.targetYear}` : "";
        const close = (yr || target) ? ")" : "";
        return `${label}${yr}${target}${close}`;
      });
      const list = phrases.length === 1
        ? phrases[0]
        : phrases.length === 2
          ? `${phrases[0]} and ${phrases[1]}`
          : `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
      // First commitment becomes the supporting detail to keep narrative
      // concrete without bloating it.
      const lead = ms.find((m) => m.commitment)?.commitment;
      const narrative = `Climate-commitment coalition member: ${list}.${lead ? ` ${lead}` : ""}`;
      return [{
        category: "environment",
        narrative,
        sc: "positive",
        severity: "positive",
        mergePositive: true,
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
  // ─── USAspending federal contracts (FY2024) ──────────────────────────
  // Augment shape per slug: { usd, agency, category, original_slug }.
  // Federal contracting alone is neutral — many contracts are essential
  // goods/services (TRICARE, VA pharmacy, etc.). Narrative reports the
  // dollar figure factually; sc stays unset so the exec-political-donations
  // writer (which knows partisan lean) gets first crack at the political
  // category enum. If no other political writer fires, the category falls
  // through to default neutral.
  {
    name: "usaspending-contracts",
    write: (e) => {
      if (!e || !e.usd) return [];
      const usdStr = e.usd >= 1e9
        ? `$${(e.usd / 1e9).toFixed(1)}B`
        : `$${(e.usd / 1e6).toFixed(0)}M`;
      const agencyStr = e.agency ? ` (primarily ${e.agency})` : "";
      const narrative =
        `USAspending.gov: ~${usdStr} in federal contract obligations in FY2024${agencyStr}.`;
      return [{ category: "political", narrative, severity: "neutral" }];
    },
  },
  // ─── Senate LDA federal lobbying (CY2024) ────────────────────────────
  // Augment shape per slug: { usd, issues, sc, original_slug }.
  // Heavy federal lobbying is a yellow flag for the political category but
  // not directional. sc=bipartisan is the right neutral-but-engaged label
  // (the lobbying $ alone tells us the company actively influences DC
  // policy in both directions). The exec-political-donations writer takes
  // precedence when both fire because it knows actual partisan lean.
  {
    name: "senate-lda",
    write: (e) => {
      if (!e || !e.usd) return [];
      const usdStr = e.usd >= 1e6
        ? `$${(e.usd / 1e6).toFixed(1)}M`
        : `$${Math.round(e.usd / 1e3)}K`;
      const issuesStr = Array.isArray(e.issues) && e.issues.length
        ? ` Top issues: ${e.issues.slice(0, 3).join(", ")}.`
        : "";
      const narrative =
        `Senate LDA: ~${usdStr} in federal lobbying spend in 2024.${issuesStr}`;
      return [{ category: "political", narrative, sc: "bipartisan", severity: "neutral" }];
    },
  },
  // ─── FARA foreign-agent registrations (DOJ) ──────────────────────────
  // Augment shape per slug: { registrations[], countries[], match_via,
  // registration_count }. Match was made via either the US registrant
  // (a Big-Law/PR firm doing lobbying on behalf of a foreign government)
  // or the foreign principal itself (e.g. TikTok, Huawei). Each is a
  // STRONG signal for political category.
  //
  // Severity is "negative" only when the registration represents a foreign
  // state actor under US sanctions/scrutiny (PRC, Russia, etc.). Otherwise
  // neutral — many FARA registrations are routine (UK trade reps, Japan
  // tourism boards, etc.).
  {
    name: "fara",
    write: (e) => {
      if (!e || !e.registration_count) return [];
      const countries = (e.countries || []).slice(0, 3).join(", ");
      const cntStr = e.registration_count === 1
        ? "one active DOJ FARA registration"
        : `${e.registration_count} active DOJ FARA registrations`;
      const matchStr = e.match_via === "principal" ? " as foreign principal"
        : e.match_via === "registrant" ? " as US registrant for a foreign government / entity"
        : "";
      const HIGH_RISK = /CHINA|RUSSIA|IRAN|NORTH KOREA|SYRIA|BELARUS|VENEZUELA|MYANMAR|CUBA/i;
      const highRisk = (e.countries || []).some(c => HIGH_RISK.test(c));
      const narrative =
        `Foreign Agents Registration Act: ${cntStr}${matchStr}` +
        `${countries ? ` (countries: ${countries})` : ""}.`;
      return [{
        category: "political",
        narrative,
        severity: highRisk ? "negative" : "neutral",
      }];
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
  // ─── Farm-animal welfare + sustainable agriculture (consolidated) ───
  // Pulls BBFAW, FAIRR, GAP, CIWF, Open Wing Alliance, Real Organic,
  // Regenerative Organic, Demeter, Non-GMO, MSC, ASC, Bonsucro, Fair Wear.
  // Writes up to 4 categories (animals / environment / labor / health)
  // depending on which sources had a hit for the slug.
  {
    name: "farm-welfare",
    write: (e) => {
      const out = [];
      const CATS = ["animals", "environment", "labor", "health"];
      const SEVERITY_TO_SC = {
        animals:     { leader: "positive", positive: "positive", mixed: "mixed", concern: "negative" },
        environment: { leader: "positive", positive: "positive", mixed: "mixed", concern: "negative" },
        labor:       { leader: "positive", positive: "positive", mixed: "mixed", concern: "negative" },
        health:      { leader: "good",     positive: "good",     mixed: "mixed", concern: "poor" },
      };
      for (const cat of CATS) {
        const b = e[cat];
        if (!b || !b.narrative) continue;
        const certs = Array.isArray(b.certifications) && b.certifications.length
          ? ` [${b.certifications.join(" · ")}]`
          : "";
        const narrative = `${b.narrative}${certs}`;
        const sc = SEVERITY_TO_SC[cat]?.[b.bestStatus];
        const severity = b.bestStatus === "concern" ? "negative"
          : b.bestStatus === "mixed"  ? "mixed"
          : "positive";
        out.push({ category: cat, narrative, sc, severity });
      }
      return out;
    },
  },
  // ─── Health + pharma + food-safety + medical (round 3) ─────────────
  // Pulls DOJ False Claims healthcare, DEA enforcement, opioid master
  // settlements, FDA drug shortages, FDA MAUDE, CMS Nursing Home Compare,
  // Leapfrog Hospital Safety Grade, USDA FSIS recalls, CDC antibiotic-
  // resistance meat-industry callouts, CSPI Xtreme Eating, Public Citizen
  // Worst Pills, Truth Initiative tobacco/vape.
  //
  // Writes into the "health" category. Severity "concern" → "poor",
  // "mixed" → "mixed", "positive" → "good", "leader" → "good".
  {
    name: "health-pharma-r3",
    write: (e) => {
      const b = e.health;
      if (!b || !b.narrative) return [];
      const SC = { leader: "good", positive: "good", mixed: "mixed", concern: "poor" };
      const sc = SC[b.bestStatus];
      if (!sc) return [];
      const severity = b.bestStatus === "concern" ? "negative"
        : b.bestStatus === "mixed"  ? "mixed"
        : "positive";
      const srcLabel = b.sources && b.sources.length
        ? ` Sources: ${b.sources.join(", ")}.`
        : "";
      return [{
        category: "health",
        narrative: `${b.narrative}${srcLabel}`,
        sc, severity,
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
  // ─── HHS OCR HIPAA breaches (privacy + health) ────────────────────────
  {
    name: "hhs-ocr-breaches",
    write: (e) => {
      const n = Number(e.total_individuals || 0);
      if (!n) return [];
      const sizeStr = n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
        : n >= 1e3 ? `${Math.round(n / 1e3)}K`
        : `${n}`;
      const cnt = e.breach_count || 1;
      const last = e.last_breach ? ` Most recent: ${e.last_breach}.` : "";
      const samp = e.largest_breach?.description ? ` ${clip(e.largest_breach.description, 200)}` : "";
      const narrative = cnt === 1
        ? `HHS OCR HIPAA breach: ${sizeStr} individuals affected.${last}${samp}`
        : `${cnt} HHS OCR HIPAA breaches reported; ${sizeStr} individuals affected total.${last}${samp}`;
      const sc = n >= 1e6 || cnt >= 3 ? "poor" : "mixed";
      return [{ category: "privacy", narrative, sc, severity: "negative" }];
    },
  },
  // ─── CPPA enforcement (California Privacy Protection Agency) ──────────
  {
    name: "cppa-enforcement",
    write: (e) => {
      const cnt = e.action_count || 0;
      if (!cnt) return [];
      const total = Number(e.total_penalty_usd || 0);
      const amtStr = total >= 1e6 ? `~$${(total / 1e6).toFixed(2)}M total`
        : total >= 1e3 ? `$${Math.round(total / 1e3)}K total`
        : "";
      const latest = e.actions?.[0];
      const head = cnt === 1
        ? `California Privacy Protection Agency action (${latest?.date || ""}).`
        : `${cnt} California Privacy Protection Agency / CCPA actions.`;
      const tail = amtStr ? ` ${amtStr} in penalties.` : "";
      const detail = latest?.summary ? ` ${clip(latest.summary, 200)}` : "";
      return [{
        category: "privacy",
        narrative: `${head}${tail}${detail}`.trim(),
        sc: total >= 1e6 || cnt >= 2 ? "poor" : "mixed",
        severity: "negative",
      }];
    },
  },
  // ─── CNIL French DPA sanctions ────────────────────────────────────────
  {
    name: "cnil-enforcement",
    write: (e) => {
      const cnt = e.action_count || 0;
      if (!cnt) return [];
      const total = Number(e.total_fines_eur || 0);
      const amtStr = total >= 1e6 ? `€${(total / 1e6).toFixed(1)}M`
        : total >= 1e3 ? `€${Math.round(total / 1e3)}K`
        : "";
      const latest = e.actions?.[0];
      const head = cnt === 1
        ? `CNIL (French DPA) sanction${latest?.date ? ` (${latest.date})` : ""}.`
        : `${cnt} CNIL (French DPA) sanctions.`;
      const tail = amtStr ? ` ${amtStr} in fines.` : "";
      const detail = latest?.issue ? ` ${clip(latest.issue, 120)}.` : "";
      return [{
        category: "privacy",
        narrative: `${head}${tail}${detail}`.trim(),
        sc: total >= 50e6 || cnt >= 3 ? "poor" : "mixed",
        severity: "negative",
      }];
    },
  },
  // ─── Citizen Lab surveillance / mercenary spyware ─────────────────────
  {
    name: "citizen-lab",
    write: (e) => {
      const cnt = e.report_count || 0;
      if (!cnt) return [];
      const sev = e.severity_max || "moderate";
      const first = e.reports?.[0];
      const head = `Citizen Lab investigation: ${first?.product || "platform"} flagged for ${clip(first?.summary || "documented privacy/surveillance concern", 200)}`;
      const sc = sev === "severe" ? "poor" : sev === "high" ? "mixed" : "mixed";
      return [{ category: "privacy", narrative: head, sc, severity: "negative" }];
    },
  },
  // ─── Child-safety tech scorecard (privacy + health) ───────────────────
  {
    name: "child-safety-tech",
    write: (e) => {
      const cnt = e.issue_count || 0;
      if (!cnt) return [];
      const orgs = (e.source_orgs || []).slice(0, 3).join("; ");
      const issue = e.issues?.[0];
      const head = `Child-safety concerns flagged by ${orgs || "regulators / advocates"}.`;
      const tail = issue?.summary ? ` ${clip(issue.summary, 200)}` : "";
      const sc = e.rating === "poor" ? "poor" : "mixed";
      const narrative = `${head}${tail}`.trim();
      return [
        { category: "privacy", narrative, sc, severity: "negative" },
        { category: "health",  narrative, sc, severity: "negative" },
      ];
    },
  },
  // ─── Krebs on Security named-breach investigations ────────────────────
  {
    name: "krebs-investigations",
    write: (e) => {
      const cnt = e.investigation_count || 0;
      if (!cnt) return [];
      const n = Number(e.total_individuals || 0);
      const sizeStr = n >= 1e6 ? `${(n / 1e6).toFixed(0)}M`
        : n >= 1e3 ? `${Math.round(n / 1e3)}K`
        : n > 0 ? `${n}`
        : "";
      const latest = e.investigations?.[0];
      const head = cnt === 1
        ? `Krebs on Security: ${clip(latest?.summary || "named-breach investigation", 220)}`
        : `${cnt} Krebs on Security investigations${sizeStr ? `; ~${sizeStr} individuals affected total` : ""}. ${clip(latest?.summary || "", 160)}`;
      const sev = e.severity_max || "moderate";
      const sc = sev === "severe" || cnt >= 2 ? "poor" : "mixed";
      return [{ category: "privacy", narrative: head.trim(), sc, severity: "negative" }];
    },
  },
  // ─── State regulators: AG consumer-protection + NYDFS financial ───────
  // Maps to "privacy" for consumer-protection (deceptive practices, data
  // misuse) and adds a "labor" narrative if AG action explicitly involved
  // worker mistreatment. NYDFS financial actions are signal but don't map
  // cleanly to any user-facing category — we surface them under "privacy"
  // (financial-services dishonesty correlates with consumer dishonesty).
  {
    name: "state-regulators",
    write: (e) => {
      const actions = Array.isArray(e.actions) ? e.actions : [];
      if (!actions.length) return [];
      const newest = actions[0];
      const totalCount = actions.length;
      const withAmt = actions.filter(a => a.amountUsd);
      const totalUsd = withAmt.reduce((s, a) => s + (a.amountUsd || 0), 0);
      const stateSources = new Set(actions.map(a => a.source));
      const sourceLabel = [...stateSources].map(s => ({
        "ny-ag":  "NY AG",
        "tx-ag":  "TX AG",
        "ny-dfs": "NYDFS",
      }[s] || s)).join(", ");

      const amtStr = totalUsd >= 1e9 ? `~$${(totalUsd / 1e9).toFixed(2)}B in known settlements`
        : totalUsd >= 1e6 ? `~$${(totalUsd / 1e6).toFixed(1)}M in known settlements`
        : totalUsd > 0 ? `$${Math.round(totalUsd / 1e3)}K in known settlements`
        : "";
      const lastDateStr = newest.date ? ` (most recent ${newest.date})` : "";
      const lead = totalCount === 1
        ? `State regulator action: ${sourceLabel}${lastDateStr}.`
        : `${totalCount} state regulator actions (${sourceLabel})${lastDateStr}.`;
      const tail = amtStr ? ` ${amtStr}.` : "";
      const narrative = `${lead}${tail} ${clip(newest.caseTitle, 140)}`.trim();

      // Severity: any NY AG / TX AG action is negative-leaning for privacy;
      // NYDFS-only stays mixed (could be procedural).
      const hasAg = stateSources.has("ny-ag") || stateSources.has("tx-ag");
      const sc = hasAg && totalCount >= 2 ? "poor"
        : hasAg ? "mixed"
        : "mixed";

      return [{
        category: "privacy",
        narrative,
        sc,
        severity: "negative",
      }];
    },
  },
  // ─── Aviation deep (DOT ATCR + DOT enforcement + NTSB) ─────────────────
  // Maps to "health" (safety/quality-of-service is closest user-facing
  // category for airlines) and adds a "privacy" narrative when the DOT
  // enforcement penalty was for refund/disability-service violations.
  {
    name: "aviation-deep",
    write: (e) => {
      const a = e.aviation;
      if (!a) return [];
      const writes = [];
      const refundFlag = a.dotLatestAction?.summary?.match(/refund|wheelchair|disability/i);
      const head = `${a.name}: DOT 2025 ATCR — ${a.onTimePct}% on-time arrivals, ` +
        `${a.complaintsPer100k} complaints per 100K passengers, ` +
        `${a.mishandledBagRate} mishandled bags per 1K.`;
      const enforcement = a.dotEnforcementCount
        ? ` ${a.dotEnforcementCount} DOT enforcement action${a.dotEnforcementCount > 1 ? "s" : ""}` +
          (a.dotPenaltyUsdTotal >= 1e9 ? ` (~$${(a.dotPenaltyUsdTotal/1e9).toFixed(1)}B in penalties).`
           : a.dotPenaltyUsdTotal >= 1e6 ? ` (~$${(a.dotPenaltyUsdTotal/1e6).toFixed(1)}M in penalties).`
           : ".")
        : "";
      const safety = a.safetySummary ? ` ${a.safetySummary}` : "";
      const narrative = `${head}${enforcement}${safety}`.trim();
      const sc = a.severity === "very_poor" ? "very_poor"
        : a.severity === "poor" ? "poor"
        : a.severity === "mixed" ? "mixed"
        : a.severity === "positive" ? "positive"
        : "neutral";
      writes.push({ category: "health", narrative, sc, severity: sc === "positive" ? "positive" : (sc === "neutral" ? "neutral" : "negative") });
      if (refundFlag) {
        writes.push({
          category: "privacy",
          narrative: `DOT enforcement: ${clip(a.dotLatestAction.summary, 220)}`,
          sc: a.dotPenaltyUsdTotal >= 1e7 ? "poor" : "mixed",
          severity: "negative",
        });
      }
      return writes;
    },
  },
  // ─── Hotel deep (UNITE HERE + CDC NORS + DOJ ADA + Green Key) ──────────
  // Multi-category: labor (strikes), health (outbreaks), privacy (ADA = accessibility,
  // closest user-facing analog), environment (Green Key certified count → positive).
  {
    name: "hotel-deep",
    write: (e) => {
      const h = e.hotel;
      if (!h) return [];
      const writes = [];
      const disputes = h.uniteHereDisputes || [];
      if (disputes.length) {
        const latest = disputes[0];
        writes.push({
          category: "labor",
          narrative: `UNITE HERE: ${disputes.length} hospitality-worker dispute${disputes.length > 1 ? "s" : ""} 2022-2025. ${clip(latest.summary, 220)}`,
          sc: "mixed",
          severity: "negative",
        });
      }
      if ((h.cdcOutbreaks5yr || 0) >= 4) {
        writes.push({
          category: "health",
          narrative: `CDC NORS database attributes ${h.cdcOutbreaks5yr} norovirus/foodborne outbreaks to ${h.name} properties 2020-2025.`,
          sc: h.cdcOutbreaks5yr >= 8 ? "poor" : "mixed",
          severity: "negative",
        });
      }
      if ((h.adaConsentDecrees || []).length) {
        const ada = h.adaConsentDecrees[0];
        writes.push({
          category: "privacy",
          narrative: `DOJ ADA Title III: ${clip(ada.summary, 220)}`,
          sc: "mixed",
          severity: "negative",
        });
      }
      if ((h.greenCertifiedPropertyCount || 0) >= 10) {
        writes.push({
          category: "environment",
          narrative: `Green Key Global registry: ${h.greenCertifiedPropertyCount} certified properties under the ${h.name} flag.`,
          sc: "positive",
          severity: "positive",
        });
      }
      return writes;
    },
  },
  // ─── Telecom deep (FCC Enforcement + FTC + DOJ) ────────────────────────
  // Maps to "privacy" by default — most major FCC enforcement actions in
  // the 2020s have been privacy / data-broker / breach related.
  {
    name: "telecom-deep",
    write: (e) => {
      const t = e.telecom;
      if (!t) return [];
      const latest = t.latestAction;
      if (!latest) return [];
      const amt = t.fccPenaltyUsdTotal >= 1e9 ? `~$${(t.fccPenaltyUsdTotal/1e9).toFixed(1)}B`
        : t.fccPenaltyUsdTotal >= 1e6 ? `~$${(t.fccPenaltyUsdTotal/1e6).toFixed(0)}M`
        : "";
      const head = t.fccEnforcementCount === 1
        ? `FCC/FTC enforcement: ${clip(latest.summary, 220)}`
        : `${t.fccEnforcementCount} FCC/FTC enforcement actions${amt ? ` (${amt} in penalties)` : ""}. ${clip(latest.summary, 200)}`;
      const category = (latest.category === "privacy" || (t.privacyActionCount || 0) > 0) ? "privacy" : "health";
      const sc = t.severity === "very_poor" ? "very_poor"
        : t.severity === "poor" ? "poor"
        : t.severity === "mixed" ? "mixed" : "mixed";
      return [{ category, narrative: head.trim(), sc, severity: "negative" }];
    },
  },
  // ─── Banking deep (OCC + CRA + FDIC + Fed) ─────────────────────────────
  // Maps regulator enforcement to "execPay" (closest user-facing analog of
  // executive accountability for a bank). CRA grade contributes a positive
  // (A) or negative (C/D) signal to "charity" (community reinvestment is
  // the CRA's purpose).
  {
    name: "banking-deep",
    write: (e) => {
      const b = e.banking;
      if (!b) return [];
      const writes = [];
      if (b.latestAction) {
        const amt = b.penaltyUsdTotal >= 1e9 ? `~$${(b.penaltyUsdTotal/1e9).toFixed(1)}B`
          : b.penaltyUsdTotal >= 1e6 ? `~$${(b.penaltyUsdTotal/1e6).toFixed(0)}M`
          : "";
        const head = b.enforcementCount === 1
          ? `Federal banking regulator action (${b.latestAction.regulator}): ${clip(b.latestAction.summary, 220)}`
          : `${b.enforcementCount} federal banking regulator actions${amt ? ` (${amt} in penalties)` : ""}. ${clip(b.latestAction.summary, 200)}`;
        const sc = b.severity === "very_poor" ? "very_poor"
          : b.severity === "poor" ? "poor"
          : b.severity === "mixed" ? "mixed" : "mixed";
        writes.push({ category: "execPay", narrative: head.trim(), sc, severity: "negative" });
      }
      if (b.craGrade === "A") {
        writes.push({
          category: "charity",
          narrative: `Community Reinvestment Act (FFIEC, ${b.craYear}): Outstanding rating — top ~3% of US banks for low/moderate-income community lending and services.`,
          sc: "positive",
          severity: "positive",
        });
      } else if (b.craGrade === "C" || b.craGrade === "D") {
        writes.push({
          category: "charity",
          narrative: `Community Reinvestment Act (FFIEC, ${b.craYear}): ${b.craGrade === "C" ? "Needs to Improve" : "Substantial Noncompliance"} — below-peer performance on low/moderate-income community lending obligations.`,
          sc: b.craGrade === "D" ? "very_poor" : "poor",
          severity: "negative",
        });
      }
      return writes;
    },
  },
  // ─── Insurance deep (NAIC + AM Best + state DOIs + DOJ) ────────────────
  // Maps to "health" for health insurers, "execPay" for everyone else
  // (consumer-protection enforcement = governance signal).
  {
    name: "insurance-deep",
    write: (e) => {
      const ins = e.insurance;
      if (!ins) return [];
      const isHealth = (ins.lines || []).some(l => /health|pharmacy/i.test(l));
      const writes = [];
      const idx = ins.naicComplaintIndex;
      const amt = ins.penaltyUsdTotal >= 1e9 ? `~$${(ins.penaltyUsdTotal/1e9).toFixed(1)}B`
        : ins.penaltyUsdTotal >= 1e6 ? `~$${(ins.penaltyUsdTotal/1e6).toFixed(0)}M`
        : "";
      const naicBit = idx != null
        ? `NAIC Complaint Index ${idx.toFixed(2)} (${idx >= 1.20 ? "well above"
                                                  : idx >= 1.00 ? "above"
                                                  : idx >= 0.80 ? "near"
                                                  : "well below"} the 1.00 US peer average).`
        : "";
      const enf = ins.latestAction
        ? ` ${ins.enforcementCount > 1 ? `${ins.enforcementCount} regulator actions${amt ? ` (${amt} in penalties)` : ""}; ` : ""}` +
          `${ins.latestAction.regulator}: ${clip(ins.latestAction.summary, 200)}`
        : "";
      const narrative = `${naicBit}${enf}`.trim();
      if (!narrative) return [];
      const sc = ins.severity === "very_poor" ? "very_poor"
        : ins.severity === "poor" ? "poor"
        : ins.severity === "mixed" ? "mixed"
        : ins.severity === "positive" ? "positive"
        : "neutral";
      writes.push({
        category: isHealth ? "health" : "execPay",
        narrative,
        sc,
        severity: sc === "positive" ? "positive" : (sc === "neutral" ? "neutral" : "negative"),
      });
      return writes;
    },
  },
  // ─── State regulators round 3: CA AG, CPPA, FL AG, IL AG, WA AG, OH AG,
  //     PA AG, NJ AG, GA AG, NC AG — same shape as round 2. Mapped to
  //     "privacy" for consumer-protection (same rationale as round 2) so
  //     downstream "first non-no-record wins" applies cleanly when both
  //     rounds hit the same brand.
  {
    name: "state-regulators-r3",
    write: (e) => {
      const actions = Array.isArray(e.actions) ? e.actions : [];
      if (!actions.length) return [];
      const newest = actions[0];
      const totalCount = actions.length;
      const withAmt = actions.filter(a => a.amountUsd);
      const totalUsd = withAmt.reduce((s, a) => s + (a.amountUsd || 0), 0);
      const stateSources = new Set(actions.map(a => a.source));
      const SRC_LABEL = {
        "ca-ag":  "CA AG",
        "cppa":   "CalPrivacy",
        "fl-ag":  "FL AG",
        "il-ag":  "IL AG",
        "wa-ag":  "WA AG",
        "oh-ag":  "OH AG",
        "pa-ag":  "PA AG",
        "nj-ag":  "NJ AG",
        "ga-ag":  "GA AG",
        "nc-ag":  "NC AG",
      };
      const sourceLabel = [...stateSources].map(s => SRC_LABEL[s] || s).join(", ");

      const amtStr = totalUsd >= 1e9 ? `~$${(totalUsd / 1e9).toFixed(2)}B in known settlements`
        : totalUsd >= 1e6 ? `~$${(totalUsd / 1e6).toFixed(1)}M in known settlements`
        : totalUsd > 0 ? `$${Math.round(totalUsd / 1e3)}K in known settlements`
        : "";
      const lastDateStr = newest.date ? ` (most recent ${newest.date})` : "";
      const lead = totalCount === 1
        ? `State regulator action: ${sourceLabel}${lastDateStr}.`
        : `${totalCount} state regulator actions (${sourceLabel})${lastDateStr}.`;
      const tail = amtStr ? ` ${amtStr}.` : "";
      const narrative = `${lead}${tail} ${clip(newest.caseTitle, 140)}`.trim();

      // Same severity logic as round 2: state AGs lean negative; CalPrivacy
      // alone stays mixed (informational advisories included).
      const hasAg = [...stateSources].some(s => s !== "cppa");
      const sc = hasAg && totalCount >= 2 ? "poor"
        : hasAg ? "mixed"
        : "mixed";

      return [{
        category: "privacy",
        narrative,
        sc,
        severity: "negative",
      }];
    },
  },
  // ─── Product-safety / ingredient certifications (round 4) ─────────────
  // Routes EWG VERIFIED, Made Safe, Good Housekeeping Seal, NSF,
  // GREENGUARD, WaterSense, GoodGuide (archived), Certified Vegan
  // (vegan.org) and Vegan Society into the right value category.
  {
    name: "product-safety-deep",
    write: (e) => {
      const certs = Array.isArray(e.certifications) ? e.certifications : [];
      if (!certs.length) return [];
      const out = [];
      // Pretty per-cert blurb factory
      const blurb = (c) => {
        const label = c.label || c.source;
        const ct = c.product_count ? ` (${c.product_count} certified product${c.product_count === 1 ? "" : "s"})` : "";
        const score = c.avg_score ? ` — GoodGuide avg ${c.avg_score.toFixed(1)}/10` : "";
        return `${label}${ct}${score}.`;
      };
      const inCats = new Set(e.categories || ["health"]);
      // Health (most certs)
      const healthCerts = certs.filter(c => ["ewg-verified","made-safe","good-housekeeping-seal","goodguide","nsf","greenguard","vegan-org","vegan-society"].includes(c.source));
      if (healthCerts.length && inCats.has("health")) {
        out.push({
          category: "health",
          narrative: healthCerts.map(blurb).join(" "),
          sc: "positive",
          severity: "positive",
          mergePositive: true,
        });
      }
      // Environment (GREENGUARD + WaterSense)
      const envCerts = certs.filter(c => ["greenguard","watersense"].includes(c.source));
      if (envCerts.length && inCats.has("environment")) {
        out.push({
          category: "environment",
          narrative: envCerts.map(blurb).join(" "),
          sc: "positive",
          severity: "positive",
          mergePositive: true,
        });
      }
      // Animals (vegan certifications)
      const animalsCerts = certs.filter(c => ["vegan-org","vegan-society"].includes(c.source));
      if (animalsCerts.length && inCats.has("animals")) {
        out.push({
          category: "animals",
          narrative: animalsCerts.map(blurb).join(" "),
          sc: "positive",
          severity: "positive",
          mergePositive: true,
        });
      }
      return out;
    },
  },
  // ─── EWG Skin Deep cosmetics hazard rollup ────────────────────────────
  {
    name: "ewg-skin-deep",
    write: (e) => {
      if (!e.ewg_product_count || e.ewg_product_count < 1) return [];
      const sev = e.severity || "neutral";
      const sc = sev === "positive" ? "positive"
             : sev === "negative" ? "negative"
             : sev === "mixed"    ? "mixed"
             : "neutral";
      const flaggedPct = Math.round((e.ewg_pct_flagged || 0) * 100);
      const verdict = sev === "negative"
        ? `${flaggedPct}% of ${e.ewg_product_count} products scored high-hazard (≥7/10)`
        : sev === "positive"
          ? `All ${e.ewg_product_count} products score low-hazard (avg ${e.ewg_avg_score}/10)`
          : `${e.ewg_product_count} products scored — avg ${e.ewg_avg_score}/10, worst ${e.ewg_worst_score}/10, ${flaggedPct}% flagged`;
      return [{
        category: "health",
        narrative: `EWG Skin Deep cosmetics hazard rating: ${verdict}.`,
        sc,
        severity: sev === "neutral" ? "neutral" : sev,
      }];
    },
  },
  // ─── EWG Food Scores rollup ───────────────────────────────────────────
  {
    name: "ewg-food",
    write: (e) => {
      if (!e.food_product_count || e.food_product_count < 1) return [];
      const sev = e.severity || "neutral";
      const sc = sev === "positive" ? "positive"
             : sev === "negative" ? "negative"
             : sev === "mixed"    ? "mixed"
             : "neutral";
      const flaggedPct = Math.round((e.food_pct_flagged || 0) * 100);
      const verdict = sev === "negative"
        ? `${flaggedPct}% of ${e.food_product_count} products scored high-concern (≥7/10)`
        : sev === "positive"
          ? `${e.food_product_count} products score low-concern (avg ${e.food_avg_score}/10)`
          : `${e.food_product_count} products scored — avg ${e.food_avg_score}/10, worst ${e.food_worst_score}/10, ${flaggedPct}% flagged`;
      return [{
        category: "health",
        narrative: `EWG Food Scores nutrition / ingredient / processing rating: ${verdict}.`,
        sc,
        severity: sev === "neutral" ? "neutral" : sev,
      }];
    },
  },
];

function clip(s, n) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

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
const patagoniaTrace = {};
for (const s of TRACE_SLUGS) patagoniaTrace[s] = [];

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
for (const s of TRACE_SLUGS) {
  console.log(`=== ${s} trace ===`);
  for (const l of patagoniaTrace[s]) console.log(l);
}
