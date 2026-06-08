#!/usr/bin/env node
/**
 * scripts/build-brand-parent-map.test.mjs
 *
 * Smoke tests for public/data/_meta/brand-parent-map.json. Asserts that:
 *   1. The map has at least 3,000 entries.
 *   2. Every common consumer brand from the launch checklist resolves.
 *   3. Every mapped parent slug actually exists in public/data/index.json
 *      (no broken chains).
 *
 * Run: `node scripts/build-brand-parent-map.test.mjs`
 * Exits non-zero on any failure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const map = JSON.parse(
  await fs.readFile(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf8")
);
const index = JSON.parse(
  await fs.readFile(path.join(ROOT, "public/data/index.json"), "utf8")
);
const validSlugs = new Set(index.map(c => c.slug));

const REQUIRED_BRANDS = [
  // From the launch ticket — every one of these must resolve.
  "nabisco", "oreo", "chipsahoy", "ritz", "triscuit", "wheatthins",
  "honeymaid", "belvita", "cadbury", "trident", "sourpatchkids",
  "toblerone", "milka", "nilla",
  "fritolay", "doritos", "cheetos", "lays", "ruffles", "tostitos",
  "sunchips", "sabra", "pepsi", "mountaindew", "gatorade", "tropicana",
  "quaker", "ricearoni", "capncrunch", "lifecereal",
  "cocacola", "coke", "dietcoke", "sprite", "fanta", "minutemaid",
  "powerade", "vitaminwater", "smartwater", "dasani", "honesttea",
  "topochico", "costacoffee", "simplyorange",
  "kitkat", "nescafe", "nespresso", "coffeemate", "stouffers",
  "hotpockets", "digiorno", "leancuisine", "tollhouse", "gerber",
  "purina", "friskies", "fancyfeast", "perrier", "sanpellegrino",
  "polandspring",
  "dove", "hellmanns", "knorr", "lipton", "benjerrys", "magnum",
  "klondike", "suave", "vaseline",
  "tide", "bounty", "charmin", "crest", "oralb", "gillette",
  "pampers", "pantene", "headshoulders", "olay", "oldspice",
  "vicks", "peptobismol", "metamucil", "febreze", "swiffer",
  "heinz", "kraft", "oscarmayer", "jello", "velveeta", "caprisun",
  "koolaid", "maxwellhouse", "philadelphia", "planters", "lunchables",
  "oreida",
  "cheerios", "luckycharms", "wheaties", "pillsbury", "bettycrocker",
  "hamburgerhelper", "yoplait", "naturevalley", "oldelpaso", "annies",
  "larabar", "haagendazs",
  "pringles", "poptarts", "eggo", "cheezit", "specialk", "ricekrispies",
  "frostedflakes", "cornflakes", "frootloops", "applejacks", "miniwheats",
  "morningstarfarms",
  "mms", "snickers", "twix", "milkyway", "skittles", "starburst",
  "lifesavers", "orbit", "juicyfruit", "doublemint", "pedigree",
  "whiskas", "iams", "royalcanin", "unclebens", "bensoriginal",
  "hersheys", "kisses", "reeses", "twizzlers", "jollyrancher",
  "almondjoy", "mounds", "whoppers", "milkduds",
  "budweiser", "budlight", "michelob", "stellaartois", "hoegaarden",
  "becks", "gooseisland", "coorslight", "millerlite", "bluemoon",
  "keystonelight", "peroni", "modelo", "corona", "pacifico",
  "mondavi", "kimcrawford", "meiomi",
  "tylenol", "bandaid", "listerine", "neutrogena", "aveeno",
  "cleanandclear", "lubriderm", "carefree", "stayfree", "splenda",
  "sudafed", "benadryl", "motrin",
  "colgate", "palmolive", "tomsofmaine", "speedstick", "irishspring",
  "softsoap", "ajax",
  "advil", "centrum", "caltrate", "alkaseltzer", "aleve", "bayer",
  "oneaday", "sensodyne", "flonase", "chapstick", "tums",
  "sharpie", "rubbermaid", "coleman", "yankeecandle", "mrcoffee",
  "crockpot", "foodsaver", "calphalon", "oster", "sunbeam",
  "clorox", "pinesol", "hiddenvalley", "kingsford", "burtsbees",
  "brita", "glad", "liquidplumr", "tilex",
  "kelloggs", "kellanova",
  "tysonchicken", "jimmydean", "hillshirefarm", "ballpark",
  "statefair", "aidells",
  "hunts", "slimjim", "reddiwip", "birdseye", "healthychoice",
  "mariecallenders", "banquet", "chefboyardee", "vlasic", "wesson",
  "hebrewnational", "orvilleredenbacher", "pam", "lachoy", "rosarita",
  "snackpack", "swissmiss",
  "greatvalue", "equate", "samschoice", "marketside", "parentschoice",
  "kirklandsignature", "upup", "marketpantry", "archerfarms",
  "threshold", "catandjack", "traderjoes",
  "365bywholefoodsmarket", "365everydayvalue", "365",
  // RBI / restaurants
  "burgerking", "timhortons", "popeyes",
  "mcdonalds", "wendys", "papajohns", "dominos", "pizzahut", "kfc",
  "tacobell", "subway", "chickfila", "panerabread", "fiveguys",
  "innoutburger", "shakeshack", "chipotle",
  // Mondelez beverages
  "tang", "tictac",
];

let failures = 0;
const missing = [];
const brokenChain = [];

for (const k of REQUIRED_BRANDS) {
  const v = map[k];
  if (!v) {
    failures++;
    missing.push(k);
    continue;
  }
  if (!validSlugs.has(v.parent)) {
    failures++;
    brokenChain.push(`${k} → ${v.parent}`);
  }
}

const totalEntries = Object.keys(map).filter(k => k !== "_doc").length;
const minRequired = 3000;
let sizeOk = totalEntries >= minRequired;

// Global broken-chain check
let globalBroken = 0;
for (const [k, v] of Object.entries(map)) {
  if (k === "_doc") continue;
  if (!v?.parent || !validSlugs.has(v.parent)) globalBroken++;
}

console.log("─".repeat(60));
console.log(`Total entries: ${totalEntries} (min required: ${minRequired})  ${sizeOk ? "PASS" : "FAIL"}`);
console.log(`Required brand checks: ${REQUIRED_BRANDS.length - missing.length}/${REQUIRED_BRANDS.length} found`);
console.log(`Broken-chain entries (parent slug not in index.json): ${globalBroken}`);
if (missing.length) {
  console.log("\nMissing required brands:");
  for (const m of missing) console.log(`  - ${m}`);
}
if (brokenChain.length) {
  console.log("\nRequired brands pointing at non-existent parents:");
  for (const b of brokenChain) console.log(`  - ${b}`);
}
console.log("─".repeat(60));

if (!sizeOk || failures > 0 || globalBroken > 0) {
  console.error("FAIL");
  process.exit(1);
}
console.log("PASS");
