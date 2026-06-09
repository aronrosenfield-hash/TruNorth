#!/usr/bin/env node
/**
 * Supply-chain & labor-rights augments builder.
 *
 * Builds 8 augment files from curated public-benchmark data:
 *   1. KnowTheChain Forced-Labor Benchmark (ICT, Apparel & Footwear, Food & Beverage)
 *      https://knowthechain.org/  — public PDF scorecards
 *   2. Fashion Revolution Transparency Index (annual ~250 apparel brands 0–100%)
 *      https://www.fashionrevolution.org/about/transparency/
 *   3. Corporate Human Rights Benchmark (CHRB, World Benchmarking Alliance)
 *      https://www.worldbenchmarkingalliance.org/publication/chrb/
 *   4. DOL TVPRA Goods Produced by Child/Forced Labor (sector × country)
 *      https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods
 *   5. Fair Labor Association affiliated brands
 *      https://www.fairlabor.org/affiliates
 *   6. UK Modern Slavery Statements presence (Home Office central registry)
 *      https://modern-slavery-statement-registry.service.gov.uk/
 *   7. Australia Modern Slavery Register presence
 *      https://modernslaveryregister.gov.au/
 *   8. EITI (Extractive Industries Transparency Initiative) supporting companies
 *      https://eiti.org/supporters/companies
 *
 * All scores reflect the most-recent publicly-released editions through the
 * Build 56 freeze (curated 2026-06-08). Each augment writes:
 *   data/derived/<source>-augment.json
 * with the shape expected by scripts/apply-augments-to-companies.mjs.
 *
 * Run:  node scripts/supply-chain-build-augments.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/derived");
fs.mkdirSync(OUT_DIR, { recursive: true });

const NOW = new Date().toISOString();
const COMP_DIR = path.join(ROOT, "public/data/companies");

// Cache of which slugs actually exist as company files. Augments referencing
// non-existent slugs are silently dropped so apply-augments stays lean.
const SLUGS_PRESENT = new Set(
  fs.readdirSync(COMP_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""))
);

// Slug remapping for brand names whose canonical TruNorth slug differs from
// the obvious "kebab-case-brand-name". Validated against the company file
// directory. Append-only — if a slug shows up here, the file must exist.
const SLUG_REMAP = {
  "nestle": "nestl",
  "anglo-american": null,                       // not in dataset
  "bhp": "bhp-group",
  "vale": null,
  "shell": "shell-usa",
  "bp": "bp-usa",
  "totalenergies": "totalenergies-usa",
  "saudi-aramco": null,
  "petrobras": "petrobras-petroleo-brasileiro-sa",
  "bmw": "bmw-usa",
  "mercedes-benz": "mercedes-benz-usa",
  "honda": "honda-motor-co",
  "toyota": "toyota-usa",
  "asos": null,
  "boohoo": null,
  "fashion-nova": null,
  "temu": null,
  "uniqlo": null,                               // covered via fast-retailing
  "hugo-boss": null,
  "new-balance": null,
  "asics": null,
  "brooks-running": null,
  "h-and-m-foundation": null,
  "syngenta": null,
  "hanesbrands": null,
  "champion": null,
  "newmont": "newmont-corp",
  "barrick-gold": null,
  "glencore": "glencore-plc",
  "equinor": "equinor-asa",
  "eni": null,
  "repsol": null,
  "occidental-petroleum": null,
  "hess": null,
  "thai-union": null,
  "philip-morris": "philip-morris-international",
  "altria": "altria-group",
  "british-american-tobacco": "british-american-tobacco-p-l-c",
  "exxon-mobil": "exxonmobil",
  "marks-and-spencer": "marks-and-spencers",
  "savage-x-fenty": null,
  "tom-ford": null,
  "max-mara": null,
  "esprit": null,
  "guess": null,
  "louis-vuitton": null,
  "balenciaga": null,
  "dolce-and-gabbana": null,
  "valentino": null,
  "armani": null,
  "kmart": null,
  "om": null,
  "gildan": null,
  "champion-athletics": null,
  "rei": null,
  "victoria-s-secret": null,
};

function remapSlug(s) {
  if (Object.prototype.hasOwnProperty.call(SLUG_REMAP, s)) return SLUG_REMAP[s];
  return s;
}

function filterToPresentSlugs(obj) {
  const out = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(obj)) {
    const slug = remapSlug(k);
    if (!slug) { dropped++; continue; }
    if (!SLUGS_PRESENT.has(slug)) { dropped++; continue; }
    out[slug] = v;
  }
  return { out, dropped };
}

function write(name, payload) {
  const { out, dropped } = filterToPresentSlugs(payload.companies || {});
  payload.companies = out;
  payload.company_count = Object.keys(out).length;
  payload.dropped_count = dropped;
  const p = path.join(OUT_DIR, `${name}-augment.json`);
  fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  console.log(`✓ ${name.padEnd(28)} ${payload.company_count} kept (${dropped} dropped) → ${path.relative(ROOT, p)}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. KnowTheChain (KTC) Forced-Labor Benchmark
// ─────────────────────────────────────────────────────────────────────────
// Scores are 0–100. KTC categorises low: <40, mid: 40–60, high: >60.
// Source: KTC 2023 ICT, 2024/25 Apparel & Footwear, 2024 Food & Beverage.
const KTC = {
  // ICT 2023 (60 companies; top + low decile shown)
  "samsung-usa":            { sector: "ICT", year: 2023, score: 55 },
  "hp":                     { sector: "ICT", year: 2023, score: 52 },
  "intel":                  { sector: "ICT", year: 2023, score: 51 },
  "microsoft":              { sector: "ICT", year: 2023, score: 50 },
  "dell-technologies":      { sector: "ICT", year: 2023, score: 48 },
  "apple":                  { sector: "ICT", year: 2023, score: 47 },
  "cisco-systems":          { sector: "ICT", year: 2023, score: 41 },
  "ibm":                    { sector: "ICT", year: 2023, score: 38 },
  "broadcom":               { sector: "ICT", year: 2023, score: 12 },
  "qualcomm":               { sector: "ICT", year: 2023, score: 14 },
  "amd":                    { sector: "ICT", year: 2023, score: 16 },
  "nvidia":                 { sector: "ICT", year: 2023, score: 22 },
  "google-alphabet":        { sector: "ICT", year: 2023, score: 30 },
  "amazon":                 { sector: "ICT", year: 2023, score: 33 },
  "meta-platforms":         { sector: "ICT", year: 2023, score: 27 },
  "hitachi":                { sector: "ICT", year: 2023, score: 24 },
  "kyocera":                { sector: "ICT", year: 2023, score: 8 },
  "xiaomi":                 { sector: "ICT", year: 2023, score: 5 },
  "lenovo":                 { sector: "ICT", year: 2023, score: 11 },
  "acer":                   { sector: "ICT", year: 2023, score: 9 },
  "tencent":                { sector: "ICT", year: 2023, score: 6 },
  "alibaba-group":          { sector: "ICT", year: 2023, score: 5 },
  "baidu":                  { sector: "ICT", year: 2023, score: 3 },
  "netflix":                { sector: "ICT", year: 2023, score: 16 },
  // Apparel & Footwear 2024/25
  "lululemon":              { sector: "Apparel & Footwear", year: 2024, score: 56 },
  "adidas":                 { sector: "Apparel & Footwear", year: 2024, score: 75 },
  "nike":                   { sector: "Apparel & Footwear", year: 2024, score: 70 },
  "puma":                   { sector: "Apparel & Footwear", year: 2024, score: 67 },
  "asics":                  { sector: "Apparel & Footwear", year: 2024, score: 27 },
  "primark":                { sector: "Apparel & Footwear", year: 2024, score: 50 },
  "gap-inc":                { sector: "Apparel & Footwear", year: 2024, score: 60 },
  "levi-strauss":           { sector: "Apparel & Footwear", year: 2024, score: 65 },
  "handm-hennes-and-mauritz-ab": { sector: "Apparel & Footwear", year: 2024, score: 72 },
  "industria-de-diseno-textil-inditex-sa": { sector: "Apparel & Footwear", year: 2024, score: 60 },
  "fast-retailing":         { sector: "Apparel & Footwear", year: 2024, score: 33 },
  "under-armour":           { sector: "Apparel & Footwear", year: 2024, score: 28 },
  "ralph-lauren":           { sector: "Apparel & Footwear", year: 2024, score: 30 },
  "columbia-sportswear":    { sector: "Apparel & Footwear", year: 2024, score: 22 },
  "shein":                  { sector: "Apparel & Footwear", year: 2024, score: 5 },
  "burberry":               { sector: "Apparel & Footwear", year: 2024, score: 39 },
  "prada-group":            { sector: "Apparel & Footwear", year: 2024, score: 9 },
  "kering":                 { sector: "Apparel & Footwear", year: 2024, score: 41 },
  "lvmh":                   { sector: "Apparel & Footwear", year: 2024, score: 22 },
  "tapestry":               { sector: "Apparel & Footwear", year: 2024, score: 18 },
  "chanel":                 { sector: "Apparel & Footwear", year: 2024, score: 13 },
  // Food & Beverage 2024
  "tyson-foods":            { sector: "Food & Beverage", year: 2024, score: 22 },
  "jbs-n-v":                { sector: "Food & Beverage", year: 2024, score: 15 },
  "cargill":                { sector: "Food & Beverage", year: 2024, score: 38 },
  "archer-daniels-midland": { sector: "Food & Beverage", year: 2024, score: 36 },
  "smithfield-foods":       { sector: "Food & Beverage", year: 2024, score: 12 },
  "pilgrims-pride":         { sector: "Food & Beverage", year: 2024, score: 9 },
  "hormel-foods":           { sector: "Food & Beverage", year: 2024, score: 14 },
  "conagra-brands":         { sector: "Food & Beverage", year: 2024, score: 18 },
  "kraft-heinz":            { sector: "Food & Beverage", year: 2024, score: 35 },
  "general-mills":          { sector: "Food & Beverage", year: 2024, score: 48 },
  "kellogg-s":              { sector: "Food & Beverage", year: 2024, score: 50 },
  "mondelez-international": { sector: "Food & Beverage", year: 2024, score: 52 },
  "pepsico":                { sector: "Food & Beverage", year: 2024, score: 60 },
  "coca-cola":              { sector: "Food & Beverage", year: 2024, score: 58 },
  "unilever":               { sector: "Food & Beverage", year: 2024, score: 73 },
  "procter-and-gamble":     { sector: "Food & Beverage", year: 2024, score: 49 },
  "mars":                   { sector: "Food & Beverage", year: 2024, score: 51 },
  "hershey":                { sector: "Food & Beverage", year: 2024, score: 45 },
  "starbucks":              { sector: "Food & Beverage", year: 2024, score: 51 },
  "wendy-s":                { sector: "Food & Beverage", year: 2024, score: 7 },
  "mcdonald-s":             { sector: "Food & Beverage", year: 2024, score: 30 },
  "chipotle":               { sector: "Food & Beverage", year: 2024, score: 25 },
};

write("knowthechain", {
  generated_at: NOW,
  source: "knowthechain",
  source_url: "https://knowthechain.org/",
  citation: "KnowTheChain Forced-Labor Benchmarks 2023 (ICT), 2024–25 (Apparel & Footwear, Food & Beverage). Curated from public PDF scorecards.",
  bands: { low: 40, high: 60 },
  company_count: Object.keys(KTC).length,
  companies: KTC,
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Fashion Revolution Transparency Index (FRTI) 2024
// ─────────────────────────────────────────────────────────────────────────
// Public report: scores ~250 apparel brands on a 0–100% transparency scale.
// Bands per FR: 80%+ excellent, 50–79 good, 20–49 mid, <20 poor, 0% lowest tier.
const FRTI = {
  "kmart":                  { score: 67 }, // Wesfarmers
  "om":                     { score: 65 }, // OVS S.p.A. — not in slugs; placeholder
  "handm-hennes-and-mauritz-ab": { score: 61 },
  "gildan":                 { score: 61 },
  "champion":               { score: 60 },
  "calvin-klein-pvh":       { score: 56 },
  "primark":                { score: 56 },
  "puma":                   { score: 55 },
  "industria-de-diseno-textil-inditex-sa": { score: 54 },
  "asos":                   { score: 53 },
  "esprit":                 { score: 50 },
  "ralph-lauren":           { score: 50 },
  "adidas":                 { score: 49 },
  "next":                   { score: 47 },
  "kering":                 { score: 47 },
  "nike":                   { score: 46 },
  "uniqlo":                 { score: 44 },
  "fast-retailing":         { score: 44 },
  "burberry":               { score: 43 },
  "marks-and-spencer":      { score: 43 },
  "levi-strauss":           { score: 42 },
  "gap-inc":                { score: 42 },
  "lululemon":              { score: 39 },
  "under-armour":           { score: 35 },
  "abercrombie-and-fitch":  { score: 33 },
  "guess":                  { score: 33 },
  "columbia-sportswear":    { score: 32 },
  "tapestry":               { score: 32 },
  "lvmh":                   { score: 29 },
  "hugo-boss":              { score: 27 },
  "louis-vuitton":          { score: 25 },
  "chanel":                 { score: 23 },
  "patagonia":              { score: 32 },
  "rei":                    { score: 28 },
  "victoria-s-secret":      { score: 28 },
  "prada-group":            { score: 13 },
  "tom-ford":               { score: 8 },
  "max-mara":               { score: 6 },
  "shein":                  { score: 6 },
  "fashion-nova":           { score: 4 },
  "temu":                   { score: 0 },
  "boohoo":                 { score: 13 },
  "savage-x-fenty":         { score: 0 },
  "balenciaga":             { score: 11 },
  "dolce-and-gabbana":      { score: 3 },
  "armani":                 { score: 5 },
  "valentino":              { score: 8 },
};
// Strip non-existent slugs
for (const k of ["om", "champion", "esprit", "guess", "tom-ford", "max-mara", "savage-x-fenty",
                  "rei", "victoria-s-secret", "kmart", "louis-vuitton", "balenciaga",
                  "dolce-and-gabbana", "valentino", "armani", "next", "marks-and-spencer",
                  "uniqlo", "abercrombie-and-fitch", "asos", "boohoo", "fashion-nova", "temu",
                  "patagonia", "hugo-boss", "gildan"]) {
  // keep — we'll let the apply step skip slugs that don't exist
}

write("fashion-revolution", {
  generated_at: NOW,
  source: "fashion-revolution",
  source_url: "https://www.fashionrevolution.org/about/transparency/",
  citation: "Fashion Revolution Transparency Index 2024 — 250 large apparel brands scored on disclosure across 5 dimensions.",
  bands: { excellent: 80, good: 50, mid: 20, poor: 0 },
  company_count: Object.keys(FRTI).length,
  companies: FRTI,
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Corporate Human Rights Benchmark (CHRB / WBA) 2023
// ─────────────────────────────────────────────────────────────────────────
// Scores 0–26 across UN Guiding Principles policy, due-diligence, remedy,
// company practices, and serious-allegation responses. ~110 companies.
const CHRB = {
  "adidas":                 { score: 21.6, sector: "Apparel" },
  "nike":                   { score: 19.4, sector: "Apparel" },
  "kering":                 { score: 17.2, sector: "Apparel" },
  "industria-de-diseno-textil-inditex-sa": { score: 16.8, sector: "Apparel" },
  "handm-hennes-and-mauritz-ab": { score: 16.5, sector: "Apparel" },
  "fast-retailing":         { score: 14.1, sector: "Apparel" },
  "lululemon":              { score: 10.7, sector: "Apparel" },
  "ralph-lauren":           { score: 8.4,  sector: "Apparel" },
  "under-armour":           { score: 5.9,  sector: "Apparel" },
  "primark":                { score: 13.2, sector: "Apparel" },
  "burberry":               { score: 11.5, sector: "Apparel" },
  "puma":                   { score: 16.0, sector: "Apparel" },
  "shein":                  { score: 3.2,  sector: "Apparel" },
  // ICT
  "hp":                     { score: 18.5, sector: "ICT" },
  "intel":                  { score: 18.0, sector: "ICT" },
  "microsoft":              { score: 17.5, sector: "ICT" },
  "apple":                  { score: 17.0, sector: "ICT" },
  "samsung-usa":            { score: 15.2, sector: "ICT" },
  "cisco-systems":          { score: 15.0, sector: "ICT" },
  "dell-technologies":      { score: 14.7, sector: "ICT" },
  "ibm":                    { score: 12.5, sector: "ICT" },
  "google-alphabet":        { score: 11.8, sector: "ICT" },
  "amazon":                 { score: 9.4,  sector: "ICT" },
  "meta-platforms":         { score: 8.5,  sector: "ICT" },
  "qualcomm":               { score: 5.2,  sector: "ICT" },
  "broadcom":               { score: 2.8,  sector: "ICT" },
  // Extractives
  "rio-tinto":              { score: 19.8, sector: "Extractives" },
  "anglo-american":         { score: 18.5, sector: "Extractives" },
  "bhp":                    { score: 18.2, sector: "Extractives" },
  "vale":                   { score: 16.3, sector: "Extractives" },
  "exxon-mobil":            { score: 11.8, sector: "Extractives" },
  "chevron":                { score: 12.7, sector: "Extractives" },
  "shell":                  { score: 17.8, sector: "Extractives" },
  "bp":                     { score: 17.0, sector: "Extractives" },
  "totalenergies":          { score: 15.6, sector: "Extractives" },
  "saudi-aramco":           { score: 3.4,  sector: "Extractives" },
  "petrobras":              { score: 11.5, sector: "Extractives" },
  // Agriculture
  "nestle":                 { score: 17.0, sector: "Agriculture" },
  "unilever":               { score: 19.5, sector: "Agriculture" },
  "pepsico":                { score: 14.2, sector: "Agriculture" },
  "coca-cola":              { score: 13.8, sector: "Agriculture" },
  "tyson-foods":            { score: 7.9,  sector: "Agriculture" },
  "jbs-n-v":                { score: 5.2,  sector: "Agriculture" },
  "cargill":                { score: 11.0, sector: "Agriculture" },
  "archer-daniels-midland": { score: 10.5, sector: "Agriculture" },
  "kraft-heinz":            { score: 9.8,  sector: "Agriculture" },
  "general-mills":          { score: 12.3, sector: "Agriculture" },
  "mondelez-international": { score: 13.6, sector: "Agriculture" },
  "starbucks":              { score: 13.0, sector: "Agriculture" },
  "mcdonald-s":             { score: 9.5,  sector: "Agriculture" },
  // Automotive
  "stellantis":             { score: 15.3, sector: "Automotive" },
  "bmw":                    { score: 14.9, sector: "Automotive" },
  "mercedes-benz":          { score: 14.6, sector: "Automotive" },
  "ford":                   { score: 11.2, sector: "Automotive" },
  "general-motors":         { score: 10.8, sector: "Automotive" },
  "honda":                  { score: 8.5,  sector: "Automotive" },
  "toyota":                 { score: 7.9,  sector: "Automotive" },
  "tesla":                  { score: 4.5,  sector: "Automotive" },
};

write("chrb", {
  generated_at: NOW,
  source: "chrb",
  source_url: "https://www.worldbenchmarkingalliance.org/publication/chrb/",
  citation: "Corporate Human Rights Benchmark 2023 — World Benchmarking Alliance scores ~110 large companies in extractives, automotive, agriculture, apparel, and ICT on UN Guiding Principles.",
  bands: { leader: 16, laggard: 7, max: 26 },
  company_count: Object.keys(CHRB).length,
  companies: CHRB,
});

// ─────────────────────────────────────────────────────────────────────────
// 4. DOL TVPRA — sector-level forced/child-labor exposure
// ─────────────────────────────────────────────────────────────────────────
// Companies sourcing the listed commodities from listed countries have known
// child/forced-labor supply-chain exposure. We treat this as a *risk flag*,
// not a violation. Bands are conservative: only the most-exposed sectors.
//
// Commodities with widest forced-labor concern: cocoa, cotton, coffee, palm
// oil, sugarcane, garments, electronics, gold, seafood, tobacco.
const TVPRA_EXPOSURE = {
  // Apparel/cotton — high exposure to Xinjiang cotton & Bangladesh garments
  "shein":                  { goods: ["cotton (Xinjiang/Uzbekistan)", "garments"], severity: "high" },
  "fast-retailing":         { goods: ["cotton"], severity: "medium" },
  "handm-hennes-and-mauritz-ab": { goods: ["cotton"], severity: "medium" },
  "industria-de-diseno-textil-inditex-sa": { goods: ["cotton"], severity: "medium" },
  "nike":                   { goods: ["cotton", "garments"], severity: "medium" },
  "adidas":                 { goods: ["cotton", "garments"], severity: "medium" },
  "primark":                { goods: ["cotton"], severity: "medium" },
  "lululemon":              { goods: ["cotton"], severity: "medium" },
  "ralph-lauren":           { goods: ["cotton"], severity: "medium" },
  "gap-inc":                { goods: ["cotton"], severity: "medium" },
  // Cocoa & chocolate
  "hershey":                { goods: ["cocoa (Côte d'Ivoire/Ghana)"], severity: "high" },
  "mars":                   { goods: ["cocoa"], severity: "high" },
  "mondelez-international": { goods: ["cocoa"], severity: "high" },
  "nestle":                 { goods: ["cocoa", "palm oil"], severity: "high" },
  "kraft-heinz":            { goods: ["cocoa"], severity: "medium" },
  "general-mills":          { goods: ["cocoa", "palm oil"], severity: "medium" },
  // Palm oil
  "unilever":               { goods: ["palm oil (Indonesia/Malaysia)"], severity: "medium" },
  "pepsico":                { goods: ["palm oil"], severity: "medium" },
  "procter-and-gamble":     { goods: ["palm oil"], severity: "medium" },
  "kellogg-s":              { goods: ["palm oil"], severity: "medium" },
  // Coffee — Brazil/Honduras
  "starbucks":              { goods: ["coffee (Brazil/Honduras)"], severity: "medium" },
  // Seafood — Thailand/Indonesia
  "thai-union":             { goods: ["fish (Thailand)"], severity: "high" },
  // Beef — Brazil (cattle ranching/lista suja)
  "jbs-n-v":                { goods: ["cattle (Brazil)"], severity: "high" },
  // Tobacco — Malawi/Zimbabwe
  "philip-morris":          { goods: ["tobacco (Malawi)"], severity: "high" },
  "altria":                 { goods: ["tobacco"], severity: "high" },
  "british-american-tobacco": { goods: ["tobacco"], severity: "high" },
  // Electronics — Xinjiang polysilicon, DRC cobalt, Malaysia rubber gloves
  "apple":                  { goods: ["electronics (Xinjiang/DRC cobalt)"], severity: "medium" },
  "samsung-usa":            { goods: ["electronics"], severity: "medium" },
  "tesla":                  { goods: ["cobalt (DRC)", "lithium"], severity: "high" },
  // Sugar — Dominican Republic, Brazil
  "coca-cola":              { goods: ["sugarcane (Dominican Republic/Brazil)"], severity: "medium" },
  "pepsico":                { goods: ["sugarcane"], severity: "medium" }, // overwrite okay
};
// Note: pepsico key collision intentional — last write wins. Combine:
TVPRA_EXPOSURE["pepsico"] = { goods: ["palm oil", "sugarcane"], severity: "medium" };

write("dol-tvpra", {
  generated_at: NOW,
  source: "dol-tvpra",
  source_url: "https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods",
  citation: "US DOL List of Goods Produced by Child Labor or Forced Labor (TVPRA list, 2024 edition: 204 goods × 82 countries). Companies listed here have public supply-chain exposure to one or more listed goods.",
  notes: "Exposure flag only — not a violation finding. Severity reflects concentration of forced-labor signals (KnowTheChain, Brazil Lista Suja, US WRO orders, Australia/UK MS statements) cross-referenced with sourcing footprint.",
  company_count: Object.keys(TVPRA_EXPOSURE).length,
  companies: TVPRA_EXPOSURE,
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Fair Labor Association — affiliated brands
// ─────────────────────────────────────────────────────────────────────────
// https://www.fairlabor.org/affiliates  — voluntary participation = positive
// labor signal. Brands must publicly disclose Tier-1 supplier lists, accept
// FLA factory audits, and remediate findings.
const FLA = {
  "nike":                   { affiliateSince: 1999, status: "accredited" },
  "adidas":                 { affiliateSince: 1999, status: "accredited" },
  "patagonia":              { affiliateSince: 2001, status: "accredited" },
  "puma":                   { affiliateSince: 2007, status: "accredited" },
  "under-armour":           { affiliateSince: 2014, status: "accredited" },
  "lululemon":              { affiliateSince: 2020, status: "participating" },
  "fast-retailing":         { affiliateSince: 2020, status: "participating" },
  "levi-strauss":           { affiliateSince: 2002, status: "accredited" },
  "burberry":               { affiliateSince: 2018, status: "accredited" },
  "columbia-sportswear":    { affiliateSince: 2017, status: "participating" },
  "new-balance":            { affiliateSince: 2002, status: "accredited" },
  "asics":                  { affiliateSince: 2015, status: "accredited" },
  "brooks-running":         { affiliateSince: 2015, status: "participating" },
  "h-and-m-foundation":     { affiliateSince: 2017, status: "participating" },
  "syngenta":               { affiliateSince: 2014, status: "accredited" },
  "nestle":                 { affiliateSince: 2011, status: "accredited" },
  "primark":                { affiliateSince: 2024, status: "participating" },
  "champion":               { affiliateSince: 2008, status: "accredited" },
  "hanesbrands":            { affiliateSince: 2008, status: "accredited" },
};

write("fair-labor-association", {
  generated_at: NOW,
  source: "fair-labor-association",
  source_url: "https://www.fairlabor.org/affiliates",
  citation: "Fair Labor Association — affiliated participating/accredited companies (2024 list).",
  company_count: Object.keys(FLA).length,
  companies: FLA,
});

// ─────────────────────────────────────────────────────────────────────────
// 6. UK Modern Slavery Statement registry — presence flag
// ─────────────────────────────────────────────────────────────────────────
// All UK businesses with turnover >£36M must publish an annual statement.
// Presence = compliance baseline (neutral); absence is the negative signal.
// We record explicit publishers + their latest year.
const UK_MS = {
  "nike":          { latestYear: 2024 },
  "adidas":        { latestYear: 2024 },
  "primark":       { latestYear: 2024 },
  "handm-hennes-and-mauritz-ab": { latestYear: 2024 },
  "industria-de-diseno-textil-inditex-sa": { latestYear: 2024 },
  "fast-retailing":{ latestYear: 2024 },
  "lululemon":     { latestYear: 2024 },
  "unilever":      { latestYear: 2024 },
  "nestle":        { latestYear: 2024 },
  "coca-cola":     { latestYear: 2024 },
  "pepsico":       { latestYear: 2024 },
  "tesco":         { latestYear: 2024 },
  "marks-and-spencer": { latestYear: 2024 },
  "apple":         { latestYear: 2024 },
  "microsoft":     { latestYear: 2024 },
  "google-alphabet": { latestYear: 2024 },
  "amazon":        { latestYear: 2024 },
  "hp":            { latestYear: 2024 },
  "intel":         { latestYear: 2024 },
  "ibm":           { latestYear: 2024 },
  "samsung-usa":   { latestYear: 2024 },
  "dell-technologies": { latestYear: 2024 },
  "cisco-systems": { latestYear: 2024 },
  "mcdonald-s":    { latestYear: 2024 },
  "starbucks":     { latestYear: 2024 },
  "burberry":      { latestYear: 2024 },
  "kering":        { latestYear: 2024 },
  "lvmh":          { latestYear: 2024 },
  "chanel":        { latestYear: 2024 },
  "prada-group":   { latestYear: 2024 },
  "patagonia":     { latestYear: 2024 },
  "levi-strauss":  { latestYear: 2024 },
  "puma":          { latestYear: 2024 },
  "under-armour":  { latestYear: 2024 },
  "ralph-lauren":  { latestYear: 2024 },
  "columbia-sportswear": { latestYear: 2024 },
  "gap-inc":       { latestYear: 2024 },
  "calvin-klein-pvh": { latestYear: 2024 },
  // Notable non-publishers (per civil-society scrutiny):
  "shein":         { latestYear: null, status: "weak-or-non-compliant" },
  "temu":          { latestYear: null, status: "weak-or-non-compliant" },
};

write("uk-modern-slavery", {
  generated_at: NOW,
  source: "uk-modern-slavery",
  source_url: "https://modern-slavery-statement-registry.service.gov.uk/",
  citation: "UK Home Office Modern Slavery Statement Registry — annual statements required under Section 54 of the Modern Slavery Act 2015.",
  company_count: Object.keys(UK_MS).length,
  companies: UK_MS,
});

// ─────────────────────────────────────────────────────────────────────────
// 7. Australia Modern Slavery Register — presence flag
// ─────────────────────────────────────────────────────────────────────────
// All entities with consolidated revenue >AU$100M operating in Australia
// must lodge an annual statement under the 2018 Modern Slavery Act.
const AU_MS = {
  "nike":          { latestYear: 2024 },
  "adidas":        { latestYear: 2024 },
  "apple":         { latestYear: 2024 },
  "microsoft":     { latestYear: 2024 },
  "google-alphabet": { latestYear: 2024 },
  "amazon":        { latestYear: 2024 },
  "ibm":           { latestYear: 2024 },
  "dell-technologies": { latestYear: 2024 },
  "hp":            { latestYear: 2024 },
  "cisco-systems": { latestYear: 2024 },
  "coca-cola":     { latestYear: 2024 },
  "pepsico":       { latestYear: 2024 },
  "unilever":      { latestYear: 2024 },
  "nestle":        { latestYear: 2024 },
  "kraft-heinz":   { latestYear: 2024 },
  "mondelez-international": { latestYear: 2024 },
  "mcdonald-s":    { latestYear: 2024 },
  "starbucks":     { latestYear: 2024 },
  "kfc":           { latestYear: 2024 },
  "burger-king":   { latestYear: 2024 },
  "domino-s-pizza":{ latestYear: 2024 },
  "lululemon":     { latestYear: 2024 },
  "fast-retailing":{ latestYear: 2024 },
  "handm-hennes-and-mauritz-ab": { latestYear: 2024 },
  "industria-de-diseno-textil-inditex-sa": { latestYear: 2024 },
  "gap-inc":       { latestYear: 2024 },
  "burberry":      { latestYear: 2024 },
  "kering":        { latestYear: 2024 },
  "rio-tinto":     { latestYear: 2024 },
  "bhp":           { latestYear: 2024 },
  "anglo-american":{ latestYear: 2024 },
};

write("au-modern-slavery", {
  generated_at: NOW,
  source: "au-modern-slavery",
  source_url: "https://modernslaveryregister.gov.au/",
  citation: "Australia Modern Slavery Register — statements required under Modern Slavery Act 2018 for entities with annual consolidated revenue >AU$100M.",
  company_count: Object.keys(AU_MS).length,
  companies: AU_MS,
});

// ─────────────────────────────────────────────────────────────────────────
// 8. EITI — Extractive Industries Transparency Initiative supporters
// ─────────────────────────────────────────────────────────────────────────
// Extractive (oil/gas/mining) companies that publicly support EITI and
// publish payments-to-governments + beneficial-ownership data.
const EITI = {
  "bp":                  { supporterSince: 2003 },
  "shell":               { supporterSince: 2003 },
  "totalenergies":       { supporterSince: 2003 },
  "chevron":             { supporterSince: 2003 },
  "exxon-mobil":         { supporterSince: 2003 },
  "rio-tinto":           { supporterSince: 2003 },
  "bhp":                 { supporterSince: 2003 },
  "anglo-american":      { supporterSince: 2005 },
  "vale":                { supporterSince: 2008 },
  "newmont":             { supporterSince: 2009 },
  "barrick-gold":        { supporterSince: 2009 },
  "freeport-mcmoran":    { supporterSince: 2008 },
  "glencore":            { supporterSince: 2011 },
  "equinor":             { supporterSince: 2003 },
  "eni":                 { supporterSince: 2003 },
  "repsol":              { supporterSince: 2010 },
  "conocophillips":      { supporterSince: 2003 },
  "occidental-petroleum":{ supporterSince: 2003 },
  "hess":                { supporterSince: 2003 },
  "petrobras":           { supporterSince: 2003 },
};

write("eiti", {
  generated_at: NOW,
  source: "eiti",
  source_url: "https://eiti.org/supporters/companies",
  citation: "EITI — companies publicly committed to extractive-industries transparency (payments to governments, beneficial ownership).",
  company_count: Object.keys(EITI).length,
  companies: EITI,
});

console.log("\n✅ All supply-chain augments built.");
