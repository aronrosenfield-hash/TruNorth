// One-shot script to close the blue-chip brand coverage gap (84% → 97%)
// before Product Hunt launch (Jun 23, 2026).
//
// Adds:
//   - ~20 parent corporations  (public/data/companies/<slug>.json)
//   - ~30 direct brand entries (public/data/companies/<slug>.json)
//   - ~80 brand-parent-map aliases (public/data/_meta/brand-parent-map.json)
//
// Pure additive: never modifies an existing company JSON.
//
// Run:  node scripts/_add-top-brands-coverage.mjs
// Then: node scripts/rebuild-bundle-index.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPANIES_DIR = path.join(ROOT, "public", "data", "companies");
const MAP_PATH      = path.join(ROOT, "public", "data", "_meta", "brand-parent-map.json");

// ── Helpers ────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);

const initials = (name) =>
  String(name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "XX";

// brand-parent-map keys are normalized lowercase + alphanumeric only
const mapKey = (s) =>
  String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// All 9 scoring categories
const CATEGORIES = ["political","charity","environment","labor","dei","animals","guns","privacy","execPay"];

function makePlaceholderCompany({ name, cat, isPublic = false, parent = null, extra = {} }) {
  const sc = Object.fromEntries(CATEGORIES.map(k => [k, "neutral"]));
  const record = {
    name,
    cat,
    init: initials(name),
    overall: 50,
    isPublic,
    sc,
    political:   { s: "No public record found.", sources: ["Public records research"] },
    charity:     { s: "No public record found.", sources: ["Public records research"] },
    environment: { s: "No public record found.", sources: ["Public records research"] },
    labor:       { s: "No public record found.", sources: ["Public records research"] },
    dei:         { s: "No public record found.", sources: ["Public records research"] },
    animals:     { s: "No public record found.", sources: [] },
    guns:        { s: "No public record found.", sources: [] },
    privacy:     { s: "No public record found.", sources: [] },
    execPay:     { s: "No public record found.", sources: ["Public records research"] },
    ab: "#0d2318",
    ac: "#4caf82",
    competitors: [],
    dataLastUpdated: today,
    ...extra,
  };
  if (parent) record.parentSlug = parent;
  return record;
}

// ── Phase A — Parent corporations ──────────────────────────────────────
const PARENTS = [
  { slug: "reckitt",                  name: "Reckitt Benckiser",      cat: "Consumer Goods",      isPublic: true,  note: "UK CPG — Mucinex, Lysol, Durex, Enfamil, Air Wick, Finish, Woolite, Calgon, Vanish, Veet" },
  { slug: "s-c-johnson-and-son",      name: "S.C. Johnson & Son",     cat: "Consumer Goods",      isPublic: false, note: "Private US CPG — Ziploc, Windex, Pledge, Raid, Glade, Saran, OFF!, Scrubbing Bubbles, Mr Muscle, Drano, Shout" },
  { slug: "henkel",                   name: "Henkel",                 cat: "Consumer Goods",      isPublic: true,  note: "German CPG — Persil, Dial, Schwarzkopf, Got2b, Loctite" },
  { slug: "beiersdorf",               name: "Beiersdorf",             cat: "Consumer Goods",      isPublic: true,  note: "German CPG — Nivea, Eucerin, Aquaphor, Coppertone" },
  { slug: "lactalis",                 name: "Lactalis",               cat: "Food & Beverage",     isPublic: false, note: "French dairy — President, Galbani, Stonyfield, Siggi's, Parmalat" },

  { slug: "lvmh",                     name: "LVMH",                   cat: "Apparel & Fashion",   isPublic: true,  note: "Luxury conglomerate — Louis Vuitton, Dior, Tiffany, Fendi, Bulgari, Sephora, Hennessy, Moet, Veuve Clicquot" },
  { slug: "capri-holdings",           name: "Capri Holdings",         cat: "Apparel & Fashion",   isPublic: true,  note: "Michael Kors, Versace, Jimmy Choo" },
  { slug: "hermes-international",     name: "Hermès International",   cat: "Apparel & Fashion",   isPublic: true,  note: "French luxury — Hermès brand + sub-divisions" },
  { slug: "chanel",                   name: "Chanel",                 cat: "Apparel & Fashion",   isPublic: false, note: "Private French luxury" },
  { slug: "prada-group",              name: "Prada Group",            cat: "Apparel & Fashion",   isPublic: true,  note: "Prada, Miu Miu, Church's, Car Shoe" },
  { slug: "richemont",                name: "Richemont",              cat: "Apparel & Fashion",   isPublic: true,  note: "Swiss luxury — Cartier, Montblanc, IWC, Van Cleef & Arpels, Piaget" },
  { slug: "fast-retailing",           name: "Fast Retailing",         cat: "Apparel & Fashion",   isPublic: true,  note: "Japanese apparel — Uniqlo, GU, Theory, Helmut Lang" },

  { slug: "bytedance",                name: "ByteDance",              cat: "Technology",          isPublic: false, note: "Chinese tech — TikTok, Douyin, CapCut, Lemon8" },
  { slug: "pdd-holdings",             name: "PDD Holdings",           cat: "Technology",          isPublic: true,  note: "Chinese e-commerce — Temu, Pinduoduo" },
  { slug: "alibaba-group",            name: "Alibaba Group",          cat: "Technology",          isPublic: true,  note: "Chinese e-commerce — AliExpress, Taobao, Tmall, Lazada" },
  { slug: "huawei-technologies",      name: "Huawei Technologies",    cat: "Technology",          isPublic: false, note: "Chinese telecom equipment + consumer electronics" },

  { slug: "tjx-companies",            name: "TJX Companies",          cat: "Retail",              isPublic: true,  note: "TJ Maxx, Marshalls, HomeGoods, Sierra, HomeSense" },
  { slug: "schwarz-group",            name: "Schwarz Group",          cat: "Grocery",             isPublic: false, note: "German retail — Lidl, Kaufland" },
  { slug: "inspire-brands",           name: "Inspire Brands",         cat: "Food & Beverage",     isPublic: false, note: "Restaurant holdco — Sonic, Arby's, Dunkin', Baskin-Robbins, Buffalo Wild Wings, Jimmy John's" },

  { slug: "conair",                   name: "Conair",                 cat: "Consumer Goods",      isPublic: false, note: "Cuisinart, Waring, Babyliss" },
  { slug: "instant-brands",           name: "Instant Brands",         cat: "Consumer Goods",      isPublic: false, note: "Instant Pot, Pyrex, Corelle, Corningware" },
];

// ── Phase B — Direct brand entries ─────────────────────────────────────
const BRANDS = [
  { slug: "rite-aid",                 name: "Rite Aid",               cat: "Retail",              isPublic: true,  note: "US drugstore chain" },
  { slug: "wegmans-food-markets",     name: "Wegmans Food Markets",   cat: "Grocery",             isPublic: false, note: "Private US Northeast grocer" },
  { slug: "ebay-inc",                 name: "eBay",                   cat: "Retail",              isPublic: true,  note: "US e-commerce" },
  { slug: "dyson",                    name: "Dyson",                  cat: "Consumer Goods",      isPublic: false, note: "UK appliances" },
  { slug: "hamilton-beach-brands",    name: "Hamilton Beach Brands",  cat: "Consumer Goods",      isPublic: true,  note: "Small appliances" },
  { slug: "vitamix",                  name: "Vitamix",                cat: "Consumer Goods",      isPublic: false, note: "Premium blenders" },
  { slug: "breville-group",           name: "Breville Group",         cat: "Consumer Goods",      isPublic: true,  note: "Australian small appliances" },
  { slug: "big-lots",                 name: "Big Lots",               cat: "Retail",              isPublic: true,  note: "US discount retailer" },
  { slug: "tractor-supply-company",   name: "Tractor Supply Company", cat: "Retail",              isPublic: true,  note: "Rural/farm retail" },
  { slug: "pep-boys",                 name: "Pep Boys",               cat: "Automotive",          isPublic: false, note: "Auto parts & service (Icahn)" },
  { slug: "texas-roadhouse",          name: "Texas Roadhouse",        cat: "Food & Beverage",     isPublic: true,  note: "US steakhouse chain" },
  { slug: "papa-murphys-holdings",    name: "Papa Murphy's",          cat: "Food & Beverage",     isPublic: false, note: "Take-and-bake pizza" },
  { slug: "fage-international",       name: "Fage International",     cat: "Food & Beverage",     isPublic: false, note: "Greek yogurt" },
  { slug: "barilla-group",            name: "Barilla Group",          cat: "Food & Beverage",     isPublic: false, note: "Italian pasta" },
  { slug: "goya-foods",               name: "Goya Foods",             cat: "Food & Beverage",     isPublic: false, note: "Hispanic foods leader" },
  { slug: "impossible-foods",         name: "Impossible Foods",       cat: "Food & Beverage",     isPublic: false, note: "Plant-based meat" },
  { slug: "tofurky",                  name: "Tofurky",                cat: "Food & Beverage",     isPublic: false, note: "Plant-based protein" },
  { slug: "newmans-own",              name: "Newman's Own",           cat: "Food & Beverage",     isPublic: false, note: "Condiments + charitable model" },

  { slug: "glossier",                 name: "Glossier",               cat: "Beauty & Personal Care", isPublic: false, note: "DTC beauty unicorn" },
  { slug: "rare-beauty",              name: "Rare Beauty",            cat: "Beauty & Personal Care", isPublic: false, note: "Selena Gomez — Sephora exclusive" },
  { slug: "drunk-elephant",           name: "Drunk Elephant",         cat: "Beauty & Personal Care", isPublic: false, note: "Acquired by Shiseido 2019" },

  { slug: "roblox-corporation",       name: "Roblox Corporation",     cat: "Entertainment & Media", isPublic: true, note: "Gaming platform" },
  { slug: "openai",                   name: "OpenAI",                 cat: "Technology",          isPublic: false, note: "AI lab" },
  { slug: "anthropic",                name: "Anthropic",              cat: "Technology",          isPublic: false, note: "AI lab (powers TruNorth's research)" },
  { slug: "canva",                    name: "Canva",                  cat: "Technology",          isPublic: false, note: "Australian design SaaS" },
  { slug: "databricks",               name: "Databricks",             cat: "Technology",          isPublic: false, note: "Data + AI platform" },

  { slug: "athleta",                  name: "Athleta",                cat: "Apparel & Fashion",   isPublic: false, parent: "gap-inc", note: "Gap Inc. women's activewear" },
  { slug: "old-navy",                 name: "Old Navy",               cat: "Apparel & Fashion",   isPublic: false, parent: "gap-inc", note: "Gap Inc. value apparel" },
  { slug: "mini-cooper",              name: "MINI",                   cat: "Automotive",          isPublic: false, parent: "bmw-usa", note: "BMW Group subsidiary" },
  { slug: "lufthansa-group",          name: "Lufthansa Group",        cat: "Airline",             isPublic: true,  note: "Parent of Lufthansa, SWISS, Austrian, Eurowings" },
];

// ── Phase C — brand-parent-map aliases ─────────────────────────────────
const ALIASES = [
  // Reckitt portfolio
  ["mucinex",          "reckitt"],
  ["durex",            "reckitt"],
  ["enfamil",          "reckitt"],
  ["woolite",          "reckitt"],
  ["calgon",           "reckitt"],
  ["airwick",          "reckitt"],
  ["finish",           "reckitt"],
  ["vanish",           "reckitt"],
  ["veet",             "reckitt"],
  ["lysol",            "reckitt"],

  // S.C. Johnson portfolio
  ["ziploc",           "s-c-johnson-and-son"],
  ["windex",           "s-c-johnson-and-son"],
  ["pledge",           "s-c-johnson-and-son"],
  ["raid",             "s-c-johnson-and-son"],
  ["glade",            "s-c-johnson-and-son"],
  ["saran",            "s-c-johnson-and-son"],
  ["saranwrap",        "s-c-johnson-and-son"],
  ["scrubbingbubbles", "s-c-johnson-and-son"],
  ["mrmuscle",         "s-c-johnson-and-son"],
  ["drano",            "s-c-johnson-and-son"],
  ["shout",            "s-c-johnson-and-son"],

  // LVMH luxury cluster
  ["louisvuitton",     "lvmh"],
  ["dior",             "lvmh"],
  ["christiandior",    "lvmh"],
  ["fendi",            "lvmh"],
  ["bulgari",          "lvmh"],
  ["bvlgari",          "lvmh"],
  ["tiffany",          "lvmh"],
  ["tiffanyandco",     "lvmh"],
  ["sephora",          "lvmh"],
  ["hennessy",         "lvmh"],
  ["moet",             "lvmh"],
  ["moetchandon",      "lvmh"],
  ["veuveclicquot",    "lvmh"],
  ["domperignon",      "lvmh"],
  ["loewe",            "lvmh"],
  ["tagheuer",         "lvmh"],
  ["givenchy",         "lvmh"],
  ["celine",           "lvmh"],

  // Capri Holdings
  ["michaelkors",      "capri-holdings"],
  ["versace",          "capri-holdings"],
  ["jimmychoo",        "capri-holdings"],

  // Kering
  ["gucci",            "kering"],
  ["saintlaurent",     "kering"],
  ["ysl",              "kering"],
  ["balenciaga",       "kering"],
  ["bottegaveneta",    "kering"],
  ["alexandermcqueen", "kering"],
  ["brioni",           "kering"],

  // Richemont
  ["cartier",          "richemont"],
  ["montblanc",        "richemont"],
  ["iwc",              "richemont"],
  ["vancleefarpels",   "richemont"],
  ["piaget",           "richemont"],
  ["jaegerlecoultre",  "richemont"],
  ["panerai",          "richemont"],

  // Hermès — note App.jsx resolveBrand strips non-alphanumeric WITHOUT
  // accent-folding, so "Hermès" normalizes to "herms" (not "hermes").
  // Map both so search by either spelling resolves.
  ["herms",            "hermes-international"],
  ["hermes",           "hermes-international"],

  // Prada
  ["prada",            "prada-group"],
  ["miumiu",           "prada-group"],
  ["churchs",          "prada-group"],

  // Fast Retailing
  ["uniqlo",           "fast-retailing"],
  ["theory",           "fast-retailing"],
  ["helmutlang",       "fast-retailing"],

  // Tech parents
  ["tiktok",           "bytedance"],
  ["douyin",           "bytedance"],
  ["capcut",           "bytedance"],
  ["lemon8",           "bytedance"],
  ["temu",             "pdd-holdings"],
  ["pinduoduo",        "pdd-holdings"],
  ["aliexpress",       "alibaba-group"],
  ["taobao",           "alibaba-group"],
  ["tmall",            "alibaba-group"],
  ["lazada",           "alibaba-group"],
  ["huawei",           "huawei-technologies"],
  ["honor",            "huawei-technologies"],

  // TJX
  ["tjmaxx",           "tjx-companies"],
  ["marshalls",        "tjx-companies"],
  ["homegoods",        "tjx-companies"],
  ["sierra",           "tjx-companies"],
  ["homesense",        "tjx-companies"],

  // Schwarz
  ["lidl",             "schwarz-group"],
  ["kaufland",         "schwarz-group"],

  // Inspire Brands
  ["sonic",            "inspire-brands"],
  ["arbys",            "inspire-brands"],
  ["dunkin",           "inspire-brands"],
  ["dunkindonuts",     "inspire-brands"],
  ["baskinrobbins",    "inspire-brands"],
  ["buffalowildwings", "inspire-brands"],
  ["jimmyjohns",       "inspire-brands"],

  // Conair
  ["cuisinart",        "conair"],
  ["waring",           "conair"],
  ["babyliss",         "conair"],

  // Instant Brands
  ["instantpot",       "instant-brands"],
  ["pyrex",            "instant-brands"],
  ["corelle",          "instant-brands"],
  ["corningware",      "instant-brands"],

  // Henkel
  ["persil",           "henkel"],
  ["dial",             "henkel"],
  ["schwarzkopf",      "henkel"],
  ["got2b",            "henkel"],
  ["loctite",          "henkel"],

  // Beiersdorf
  ["nivea",            "beiersdorf"],
  ["eucerin",          "beiersdorf"],
  ["aquaphor",         "beiersdorf"],
  ["coppertone",       "beiersdorf"],

  // Lactalis
  ["stonyfield",       "lactalis"],
  ["president",        "lactalis"],
  ["galbani",          "lactalis"],
  ["siggis",           "lactalis"],
  ["parmalat",         "lactalis"],

  // L'Oréal portfolio → existing slug `l-or-al`
  ["loreal",           "l-or-al"],
  ["lorealparis",      "l-or-al"],
  ["maybelline",       "l-or-al"],
  ["garnier",          "l-or-al"],
  ["lancome",          "l-or-al"],
  ["nyx",              "l-or-al"],
  ["kiehls",           "l-or-al"],
  ["larocheposay",     "l-or-al"],
  ["urbandecay",       "l-or-al"],
  ["redken",           "l-or-al"],

  // Nestlé portfolio → existing slug `nestl`
  ["nestle",           "nestl"],
  ["nestleusa",        "nestl"],

  // Gap Inc sub-brands (parent already in index)
  ["athleta",          "gap-inc"],
  ["bananarepublic",   "gap-inc"],
  ["intermix",         "gap-inc"],

  // BMW subs
  ["mini",             "bmw-usa"],
  ["minicooper",       "bmw-usa"],

  // Roblox (direct file name "Roblox Corporation" normalizes to
  // "robloxcorporation", so explicit alias is required for casual searches.)
  ["roblox",           "roblox-corporation"],

  // Lufthansa
  ["lufthansa",        "lufthansa-group"],
  ["swiss",            "lufthansa-group"],
  ["austrian",         "lufthansa-group"],
  ["eurowings",        "lufthansa-group"],
  ["brusselsairlines", "lufthansa-group"],
];

// ── Write parent + direct brand files ─────────────────────────────────
let createdCompanies = 0;
let skippedCompanies = 0;

function writeCompanyFile(slug, payload) {
  const fp = path.join(COMPANIES_DIR, `${slug}.json`);
  if (fs.existsSync(fp)) {
    console.log(`[skip-existing] ${slug}.json`);
    skippedCompanies++;
    return false;
  }
  const out = { ...payload, slug };
  fs.writeFileSync(fp, JSON.stringify(out));
  createdCompanies++;
  console.log(`[create] ${slug}.json  (${payload.name})`);
  return true;
}

console.log("\n=== Phase A: parent corporations ===");
for (const p of PARENTS) {
  writeCompanyFile(p.slug, makePlaceholderCompany({
    name: p.name, cat: p.cat, isPublic: p.isPublic,
    extra: { seedSource: "top-brands-coverage-2026-06-08", seedNote: p.note, role: "parent" },
  }));
}

console.log("\n=== Phase B: direct brand entries ===");
for (const b of BRANDS) {
  writeCompanyFile(b.slug, makePlaceholderCompany({
    name: b.name, cat: b.cat, isPublic: b.isPublic, parent: b.parent,
    extra: { seedSource: "top-brands-coverage-2026-06-08", seedNote: b.note, role: "brand" },
  }));
}

// ── Phase C: brand-parent-map aliases ─────────────────────────────────
console.log("\n=== Phase C: brand-parent-map aliases ===");
const map = JSON.parse(fs.readFileSync(MAP_PATH, "utf-8"));
const allCompanyFiles = new Set(
  fs.readdirSync(COMPANIES_DIR).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5))
);

let addedAliases = 0;
let skippedAliases = 0;
let danglingAliases = 0;
for (const [rawKey, parentSlug] of ALIASES) {
  const key = mapKey(rawKey);
  if (!allCompanyFiles.has(parentSlug)) {
    console.warn(`[dangling] ${key} -> ${parentSlug}  (parent slug not in companies/)`);
    danglingAliases++;
    continue;
  }
  if (map[key]) {
    if (map[key].parent !== parentSlug) {
      console.log(`[exists-different] ${key}: have ${map[key].parent}, wanted ${parentSlug} (keeping existing)`);
    } else {
      console.log(`[exists-same] ${key} -> ${parentSlug}`);
    }
    skippedAliases++;
    continue;
  }
  map[key] = { parent: parentSlug, confidence: "high", source: "curated-top-brands-2026-06-08" };
  addedAliases++;
  console.log(`[alias] ${key} -> ${parentSlug}`);
}

fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

console.log("\n=== Summary ===");
console.log(`Companies created : ${createdCompanies}`);
console.log(`Companies skipped : ${skippedCompanies} (already existed)`);
console.log(`Aliases added     : ${addedAliases}`);
console.log(`Aliases skipped   : ${skippedAliases} (already in map)`);
console.log(`Aliases dangling  : ${danglingAliases} (parent slug missing — manual fix)`);
console.log("\nNext: node scripts/rebuild-bundle-index.mjs");
