#!/usr/bin/env node
/**
 * Investigative journalism corpus merge.
 *
 * Reads newest data/raw/investigative-journalism/<date>.json
 *   → data/derived/investigative-journalism-augment.json keyed by slug.
 *
 * Severity policy (per project brief):
 *   - 1 outlet               → severity_max = "mixed"
 *   - 2+ distinct outlets    → severity_max = "poor"
 *   - 3+ distinct outlets    → severity_max = "very_poor"
 *
 * Multiple categories per brand are tracked separately under `by_category`.
 * The top-level `severity_max` reflects the brand's hottest category.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/investigative-journalism");
const DERIVED = path.join(ROOT, "data/derived/investigative-journalism-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

/**
 * Subject → slug map. Each subject CAN map to multiple slugs so that
 * brand-parent aliases (e.g. "Boeing" → both "boeing" and
 * "boeing-defense-space-and-security") all receive the augment.
 * Verified against /public/data/companies/ slug index.
 */
export const SUBJECT_TO_SLUGS = {
  "Boeing":                   ["boeing", "boeing-defense-space-and-security"],
  "Purdue Pharma":            ["purdue-pharma"],
  "Sackler Family":           ["purdue-pharma"],
  "Chemours":                 ["chemours"],
  "DuPont":                   ["dupont"],
  "3M":                       ["3m", "3m-company"],
  "Facebook":                 ["meta-platforms", "meta-facebook"],
  "Meta":                     ["meta-platforms", "meta-facebook"],
  "Amazon":                   ["amazon"],
  "Wells Fargo":              ["wells-fargo"],
  "IBM":                      ["ibm"],
  "Anadarko Petroleum":       ["anadarko-petroleum"],
  "TurboTax (Intuit)":        ["intuit", "turbotax"],
  "Tyson Foods":              ["tyson-foods"],
  "Goldman Sachs":            ["goldman-sachs"],
  "McKinsey & Company":       ["mckinsey-and-company"],
  "Allergan":                 ["allergan", "abbvie"],
  "Coca-Cola":                ["coca-cola"],
  "Walmart":                  ["walmart"],
  "Johnson & Johnson":        ["johnson-and-johnson"],
  "Glencore":                 ["glencore", "glencore-plc"],
  "Eli Lilly":                ["eli-lilly"],
  "Bayer":                    ["bayer"],
  "Halliburton":              ["halliburton"],
  "Volkswagen":               ["volkswagen", "volkswagen-ag"],
  "Exxon Mobil":              ["exxon-mobil", "exxonmobil", "exxon"],
  "Foxconn":                  ["foxconn", "hon-hai-precision-industry"],
  "Tesla":                    ["tesla"],
  "Activision Blizzard":      ["activision-blizzard"],
  "Uber":                     ["uber", "uber-technologies"],
  "Wirecard":                 ["wirecard"],
  "Saudi Aramco":             ["saudi-aramco", "saudi-arabian-oil-company"],
  "Credit Suisse":            ["credit-suisse", "credit-suisse-ag"],
  "WeWork":                   ["wework"],
  "Norfolk Southern":         ["norfolk-southern"],
  "Smithfield Foods":         ["smithfield-foods"],
  "Boohoo":                   ["boohoo", "boohoo-group"],
  "Shell":                    ["shell", "shell-usa", "shell-plc"],
  "FIFA":                     ["fifa"],
  "Loblaw Companies":         ["loblaw", "loblaw-companies"],
  "Tim Hortons":              ["tim-hortons"],
  "Cambridge Analytica":      ["cambridge-analytica"],
  "Chevron":                  ["chevron", "chevron-phillips-chemical"],
  "BP":                       ["bp", "bp-usa", "bp-plc"],
  "Nestlé":                   ["nestl", "nestle"],
  "Mars":                     ["mars", "mars-inc", "mars-incorporated"],
  "Hershey":                  ["hershey", "hershey-company", "the-hershey-company"],
  "Adani Group":              ["adani", "adani-group", "adani-enterprises"],
  "Theranos":                 ["theranos"],
  "JPMorgan Chase":           ["jpmorgan-chase", "jpmorgan", "jp-morgan-chase"],
  "Apple":                    ["apple"],
  "The Weinstein Company":    ["the-weinstein-company", "weinstein-company"],
  "Sturm Ruger":              ["sturm-ruger", "ruger"],
  "Smith & Wesson":           ["smith-and-wesson", "smith-wesson-brands"],
  "Daniel Defense":           ["daniel-defense"],
  "Koch Industries":          ["koch-industries", "koch"],
  "Monsanto":                 ["monsanto", "bayer"],
  "Palantir":                 ["palantir", "palantir-technologies"],
  "Google":                   ["google", "google-alphabet", "alphabet"],
  "Microsoft":                ["microsoft"],
  "Northrop Grumman":         ["northrop-grumman", "northrop"],
  "Duke Energy":              ["duke-energy"],
  "Marathon Petroleum":       ["marathon-petroleum"],
  "Energy Transfer":          ["energy-transfer", "energy-transfer-lp"],
  "Mossack Fonseca":          ["mossack-fonseca"],
  "Appleby":                  ["appleby"],
  "Nike":                     ["nike"],
  "HSBC":                     ["hsbc", "hsbc-holdings"],
  "Deutsche Bank":            ["deutsche-bank", "deutsche-bank-aktiengesellschaft"],
  "BNY Mellon":               ["bny-mellon", "bank-of-new-york-mellon"],
  "Bank of America":          ["bank-of-america"],
  "Standard Chartered":       ["standard-chartered", "standard-chartered-plc"],
  "Clearview AI":             ["clearview-ai"],
  "23andMe":                  ["23andme"],
  "NSO Group":                ["nso-group"],
  "Wagner Group":             ["wagner-group"],
  "FTX":                      ["ftx"],
  "Huawei":                   ["huawei", "huawei-technologies"],
  "American Petroleum Institute": ["american-petroleum-institute", "api"],
  "Asbestos Industry":        [], // archival
  "Lead Industry":            [], // archival
};

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

function slugsForSubject(subject) {
  const map = SUBJECT_TO_SLUGS[subject];
  if (map) return map;
  // Soft fallback: kebab-case the subject.
  const slug = subject
    .toLowerCase()
    .replace(/[&]/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? [slug] : [];
}

/**
 * Returns the augment object keyed by slug.
 * Each entry contains:
 *   outlets[]            distinct outlet codes
 *   outlet_count         outlets.length
 *   investigation_count  total records (can exceed outlets if same outlet wrote multiple pieces)
 *   first_date / last_date
 *   by_category          per-category breakdown for the apply layer
 *   investigations[]     full pieces, newest first, capped to 5
 *   severity_max         "mixed" | "poor" | "very_poor"
 *   source / source_url
 */
export function buildAugment(records, outletsMeta = {}) {
  const by = {};
  for (const r of records) {
    const slugs = slugsForSubject(r.subject || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          subject: r.subject,
          outlets: [],
          outlet_count: 0,
          investigation_count: 0,
          first_date: null,
          last_date: null,
          by_category: {},
          investigations: [],
          severity_max: "mixed",
          source: "investigative-journalism",
          source_url: "https://www.propublica.org/",
        };
      }
      const agg = by[slug];
      agg.investigation_count += 1;
      if (r.outlet && !agg.outlets.includes(r.outlet)) {
        agg.outlets.push(r.outlet);
      }
      agg.outlet_count = agg.outlets.length;
      if (r.date) {
        if (!agg.first_date || r.date < agg.first_date) agg.first_date = r.date;
        if (!agg.last_date  || r.date > agg.last_date)  agg.last_date  = r.date;
      }
      // Per-category aggregation
      const cat = r.category;
      if (cat) {
        if (!agg.by_category[cat]) {
          agg.by_category[cat] = {
            outlets: [],
            outlet_count: 0,
            investigation_count: 0,
            latest: null,
          };
        }
        const bc = agg.by_category[cat];
        bc.investigation_count += 1;
        if (r.outlet && !bc.outlets.includes(r.outlet)) bc.outlets.push(r.outlet);
        bc.outlet_count = bc.outlets.length;
        if (!bc.latest || (r.date || "") > (bc.latest.date || "")) {
          bc.latest = {
            outlet: r.outlet,
            outletLabel: outletsMeta[r.outlet] || r.outlet,
            headline: r.headline,
            date: r.date,
            url: r.url,
            abstract: r.abstract,
          };
        }
      }
      agg.investigations.push({
        outlet: r.outlet,
        outletLabel: outletsMeta[r.outlet] || r.outlet,
        headline: r.headline,
        date: r.date,
        url: r.url,
        category: r.category,
        abstract: r.abstract,
      });
    }
  }
  for (const slug of Object.keys(by)) {
    const agg = by[slug];
    agg.investigations.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (agg.investigations.length > 5) {
      agg.investigations = agg.investigations.slice(0, 5);
    }
    // Top-level severity: max of any category severity.
    let worst = "mixed";
    for (const cat of Object.keys(agg.by_category)) {
      const oc = agg.by_category[cat].outlet_count;
      let sev = "mixed";
      if (oc >= 3) sev = "very_poor";
      else if (oc >= 2) sev = "poor";
      if (rank(sev) > rank(worst)) worst = sev;
    }
    agg.severity_max = worst;
  }
  return by;
}

function rank(s) { return s === "very_poor" ? 3 : s === "poor" ? 2 : s === "mixed" ? 1 : 0; }

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) {
    console.error("Run investigative-journalism-fetch.mjs first.");
    process.exit(2);
  }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || [], raw.outlets || {});
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "investigative-journalism",
    source_url: "https://www.propublica.org/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  // Per-outlet count + cross-cited tally for the PR summary.
  const perOutlet = {};
  const crossCited = new Set();
  for (const slug of Object.keys(augment)) {
    const agg = augment[slug];
    if (agg.outlet_count >= 2) crossCited.add(slug);
    for (const o of agg.outlets) perOutlet[o] = (perOutlet[o] || 0) + 1;
  }
  console.log(`Wrote ${Object.keys(augment).length} brand augments -> ${outPath}`);
  console.log(`Cross-cited (>=2 outlets): ${crossCited.size}`);
  console.log("Per outlet brand counts:");
  for (const [o, n] of Object.entries(perOutlet).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${o.padEnd(22)} ${n}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("investigative-journalism-merge failed:", err); process.exit(1); });
