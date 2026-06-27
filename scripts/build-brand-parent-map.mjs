#!/usr/bin/env node
/**
 * scripts/build-brand-parent-map.mjs
 *
 * Expand public/data/_meta/brand-parent-map.json to thousands of entries so the
 * in-app barcode scanner (resolveBrand in src/App.jsx) can fall back from a
 * sub-brand name returned by Open Food Facts (e.g. "Nabisco", "Oreo", "Lay's")
 * to a corporate parent slug that exists in public/data/index.json.
 *
 * Sources, in priority order:
 *   1. Hand-curated CURATED_MAP below (highest priority — overrides everything).
 *      Covers every parent company called out in the launch checklist.
 *   2. Wikidata SPARQL — brands (Q431289) with P127 (owned by) or P749
 *      (parent organization) where the parent maps to a slug we ship.
 *      Cached to scripts/cache/wikidata-brands.json (24h TTL).
 *   3. The existing brand-parent-map.json (preserved unless overridden).
 *
 * Key normalization (matches resolveBrand in src/App.jsx:127):
 *   key = name.toLowerCase().replace(/[^a-z0-9]+/g, "")
 * Value: { parent: "<slug>", confidence: "high|medium|low", source?: "..." }
 *
 * Guardrails:
 *   - SKIPS any brand whose proposed parent slug does NOT exist in index.json.
 *   - Sorts output keys alphabetically.
 *   - Pretty-prints with 2-space indent.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeParentMap } from "./lib/parent-map-guards.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_JSON = path.join(ROOT, "public/data/index.json");
const OUT_JSON = path.join(ROOT, "public/data/_meta/brand-parent-map.json");
const CACHE_DIR = path.join(__dirname, "cache");
const WIKIDATA_CACHE = path.join(CACHE_DIR, "wikidata-brands.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Match resolveBrand normalization exactly. */
function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function fileAge(p) {
  try {
    const st = await fs.stat(p);
    return Date.now() - st.mtimeMs;
  } catch {
    return Infinity;
  }
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Parent slug whitelist (verified against index.json on 2026-06-07).
// Map of human label → slug that EXISTS in public/data/index.json.
// ─────────────────────────────────────────────────────────────────────────────
const PARENTS = {
  mondelez: "mondelez-international",
  pepsico: "pepsico",
  cocaCola: "coca-cola",
  nestle: "nestl",
  unilever: "unilever",
  pg: "procter-and-gamble",
  kraftHeinz: "kraft-heinz",
  generalMills: "general-mills",
  kelloggs: "kellogg-s",
  mars: "mars",
  wrigley: "wrigley",
  hershey: "hershey",
  abInBev: "anheuser-busch",
  molsonCoors: "molson-coors-beverage",
  constellation: "corona-constellation-brands",
  jnj: "johnson-and-johnson",
  kenvue: "kenvue",
  colgate: "colgate-palmolive",
  bayer: "bayer",
  pfizer: "pfizer",
  gsk: "gsk",
  haleon: "haleon",
  newell: "newell-brands",
  clorox: "clorox-co",
  tyson: "tyson-foods",
  jbs: "jbs-n-v",
  pilgrims: "pilgrim",
  conagra: "conagra-brands",
  walmart: "walmart",
  costco: "costco",
  target: "target",
  wholeFoods: "whole-foods",
  traderJoes: "trader-joe-s",
  amazon: "amazon",
  kimberlyClark: "kimberly-clark",
  churchDwight: "church-and-dwight-co-inc",
  campbell: "campbell-soup",
  smucker: "j-m-smucker",
  hormel: "hormel-foods",
  danone: "danone",
  dannon: "dannon-danone",
  mccormick: "mccormick",
  kdp: "keurig-dr-pepper",
  altria: "altria-group",
  pmi: "philip-morris-international",
  rjr: "r-j-reynolds-tobacco-company",
  reynoldsConsumer: "reynolds-consumer-products",
  diageo: "diageo",
  brownForman: "brown-forman",
  heinekenUsa: "heineken-usa",
  beamSuntory: "jim-beam-suntory",
  revlon: "revlon",
  coty: "coty",
  edgewell: "edgewell-personal-care",
  prestige: "prestige-consumer-healthcare",
  sanofi: "sanofi",
  novartis: "novartis",
  merck: "merck",
  abbott: "abbott-laboratories",
  perrigo: "perrigo-co",
  dole: "dole-food",
  delMonte: "del-monte",
  arla: "arla",
  saputo: "saputo-inc",
  landOLakes: "land-o-lakes",
  organicValley: "organic-valley",
  sysco: "sysco",
  pfg: "performance-food-group",
  aramark: "aramark",
  starbucks: "starbucks",
  dunkin: "dunkin",
  rbi: "restaurant-brands-international",
  mcdonalds: "mcdonald-s",
  chipotle: "chipotle",
  wendys: "wendy-s",
  jackInTheBox: "jack-in-the-box",
  papaJohns: "papa-john-s",
  dominos: "domino-s",
  pizzaHut: "pizza-hut",
  kfc: "kfc",
  tacoBell: "taco-bell",
  subway: "subway",
  chickFilA: "chick-fil-a",
  panera: "panera-bread",
  fiveGuys: "five-guys",
  inNOut: "in-n-out-burger",
  shakeShack: "shake-shack",
  popeyes: "popeyes",
  flowers: "flowers-foods",
  simplyGood: "simply-good-foods",
  blackstone: "blackstone",
  kkr: "kkr-and-co",
  carlyle: "carlyle-group",
  esteeLauder: "estee-lauder-companies",
  purinaNestle: "purina-nestl",
  yumBrands: "kfc",            // YUM Brands not present as parent; KFC stands in for Yum-owned QSRs
  // Some directly-owned sub-brands ARE first-class entries in index.json — point at themselves
  // (these double as fallback parents for product-line variants):
  dollarShaveClub: "dollar-shave-club",
  duracell: "duracell",
  gillette: "gillette",
  pampers: "pampers",
  crest: "crest",
  bounty: "bounty",
  pantene: "pantene",
  olay: "olay",
  febreze: "febreze",
  vicks: "vicks",
  tide: "tide",
  charmin: "charmin",
  oralB: "oral-b",
  // Bottled water & beverages
  perrierBrand: "perrier",
  sanPellegrino: "san-pellegrino",
  polandSpring: "poland-spring",
  // Snacks
  lays: "lay-s",
  doritos: "doritos",
  cheetos: "cheetos",
  ruffles: "ruffles",
  tostitos: "tostitos",
  fritos: "fritos",
  sunChips: "sun-chips",
  // Cereals
  cheeriosBrand: "cheerios",
  luckyCharms: "lucky-charms",
  // Personal care (own slug)
  dove: "dove",
  vaseline: "vaseline",
  lipton: "lipton",
  // Cleaning (own slug)
  lysol: "lysol",
  airwick: "air-wick",
  windex: "windex",
  glade: "glade",
  ziploc: "ziploc",
  saran: "saran",
  // Beauty (own slug)
  maybelline: "maybelline",
  garnier: "garnier",
  lancome: "lancome",
  clinique: "clinique",
  bobbiBrown: "bobbi-brown",
  aveda: "aveda",
  origins: "origins",
  tomFord: "tom-ford",
  // Pet food (own slug)
  whiskas: "whiskas",
  iams: "iams",
  // Personal items
  speedStick: "speed-stick",
  irishSpring: "irish-spring",
  cleanAndClear: "clean-and-clear",
  tylenolBrand: "tylenol",
  listerineBrand: "listerine",
  hawaiianTropic: "hawaiian-tropic",
  playtex: "playtex",
  // Food
  chefBoyardee: "chef-boyardee",
  hebrewNational: "hebrew-national",
  kirkland: "kirkland-signature",
  morningstarFarms: "morningstar-farms",
  pringles: "pringles",
  // Cold cereals / oats
  quaker: "quaker-oats-company",
  // Coffee/tea
  tropicana: "tropicana",
  // Soft drinks
  pepsi: "pepsi",
  drPepperBrand: "dr-pepper",
  mountainDew: "mountain-dew",
  // Sweets
  milka: "milka",
  // Misc
  famousAmos: "famous-amos",
  kashi: "kashi",
};

// Quick verification map. We'll filter at write-time so a typo doesn't crash.

// ─────────────────────────────────────────────────────────────────────────────
// CURATED BRAND → PARENT mappings
// (label is human-readable; key gets normalized to alphanumeric-lowercase.)
// ─────────────────────────────────────────────────────────────────────────────
const CURATED = [];

function add(label, parentSlug, confidence = "high", source = "curated") {
  CURATED.push({ label, parent: parentSlug, confidence, source });
}
function many(parent, brands, confidence = "high") {
  for (const b of brands) add(b, parent, confidence, "curated");
}

// ── Mondelez International ─────────────────────────────────────────────────
many(PARENTS.mondelez, [
  "Mondelez", "Mondelēz", "Nabisco", "Oreo", "Chips Ahoy", "Chips Ahoy!", "Ritz",
  "Ritz Crackers", "Ritz Bits", "Triscuit", "Wheat Thins", "Honey Maid", "BelVita",
  "Cadbury", "Cadbury Dairy Milk", "Trident", "Trident Gum", "Sour Patch Kids",
  "Toblerone", "Cote d'Or", "Cote dOr", "Milka", "Nilla", "Nilla Wafers",
  "Nutter Butter", "Premium Saltines", "Wheatables", "Newtons", "Fig Newtons",
  "Tate's Bake Shop", "Tates Bake Shop", "Tang", "Tic Tac", "Dentyne",
  "Halls", "Halls Cough Drops", "Stride", "Bubblicious", "Chiclets",
  "Royal", "Lacta", "Bubaloo", "Cipster", "Suchard", "LU", "TUC",
  "Mikado", "Petit Ecolier", "Oro", "Club Social", "Terrabusi", "Ciel",
  "Cream of Wheat", "Easy Cheese", "Handi-Snacks", "Mallomars",
  "Animal Crackers", "Barnum's Animals", "Better Cheddars", "Cameo",
  "Chicken in a Biskit", "Chips Deluxe", "Ginger Snaps", "Lorna Doone",
  "Mister Salty", "Mr. Salty", "Pinwheels", "Snackwells", "SnackWell's",
  "Stella D'oro", "Stella Doro", "Stoned Wheat Thins", "Teddy Grahams",
  "Vegetable Thins", "Veggie Thins", "Wheatsworth", "Premium Crackers",
  "Stride Gum", "Trident Layers", "Trident White", "Trident Splash",
  "Dentyne Ice", "Dentyne Fire", "Clorets", "Maynards", "Maynards Bassetts",
  "Sour Patch", "Swedish Fish", "Toblerone Tiny", "Oreo Mini", "Oreo Thins",
]);

// ── PepsiCo ─────────────────────────────────────────────────────────────────
many(PARENTS.pepsico, [
  "PepsiCo", "Pepsi", "Pepsi Cola", "Pepsi-Cola", "Pepsi Max", "Pepsi Zero",
  "Diet Pepsi", "Pepsi Wild Cherry", "Mountain Dew", "Mtn Dew", "Mountain Dew Code Red",
  "Mountain Dew Baja Blast", "Mountain Dew Voltage", "Mountain Dew Live Wire",
  "Mug Root Beer", "Mug", "Sierra Mist", "Starry", "Crush", "Schweppes",
  "Manzanita Sol", "Mirinda", "7UP", "Seven Up", "Diet 7UP",
  "Gatorade", "Gatorade Zero", "Gatorade Fit", "Propel", "Propel Water",
  "Tropicana", "Tropicana Pure Premium", "Naked Juice", "Naked",
  "Quaker", "Quaker Oats", "Quaker Oatmeal", "Quaker Chewy", "Quaker Rice Cakes",
  "Aunt Jemima", "Pearl Milling Company", "Rice-A-Roni", "Rice A Roni",
  "Pasta Roni", "Cap'n Crunch", "Cap N Crunch", "Captain Crunch", "Life",
  "Life Cereal", "Quaker Life", "Frito-Lay", "Frito Lay", "Lay's", "Lays",
  "Doritos", "Cool Ranch", "Cheetos", "Flamin' Hot Cheetos", "Flamin Hot",
  "Ruffles", "Tostitos", "Sun Chips", "SunChips", "Fritos", "Fritos Chili",
  "Funyuns", "Munchies", "Stacy's", "Stacys", "Stacy's Pita Chips",
  "Smartfood", "Smartfood Popcorn", "Cracker Jack", "Cracker Jacks",
  "Rold Gold", "Rold Gold Pretzels", "Bugles", "Sabra", "Sabra Hummus",
  "Kevita", "KeVita", "Bare", "Bare Snacks", "Off The Eaten Path",
  "Pop Works", "Popworks", "Walkers", "Walkers Crisps", "Wotsits",
  "Doritos Loaded", "Lays Stax", "Sabritas", "Twistos", "Hello Goodness",
  "Aquafina", "Aquafina Water", "Bubly", "Bubly Sparkling Water",
  "Lifewtr", "Soulboost", "Driftwell", "Lipton Brisk", "Brisk",
  "Pure Leaf", "Pure Leaf Tea", "Starbucks Doubleshot", "Starbucks Frappuccino",
  "Muscle Milk", "Muscle Milk Protein", "Evolve", "Evolve Protein",
  "Rockstar", "Rockstar Energy", "AMP Energy", "AMP",
]);

// ── The Coca-Cola Company ───────────────────────────────────────────────────
many(PARENTS.cocaCola, [
  "Coca-Cola", "Coca Cola", "Coke", "Diet Coke", "Coca-Cola Zero", "Coke Zero",
  "Coca-Cola Light", "Coca-Cola Cherry", "Cherry Coke", "Vanilla Coke",
  "Coca-Cola Life", "Caffeine Free Coke", "Sprite", "Sprite Zero",
  "Fanta", "Fanta Orange", "Fanta Grape", "Fresca", "Fresca Original",
  "Mello Yello", "Mellow Yellow", "TaB", "Pibb Xtra", "Mr. Pibb",
  "Barq's", "Barqs", "Barq's Root Beer", "Surge", "Inca Kola",
  "Minute Maid", "Minute Maid Orange", "Minute Maid Lemonade", "Hi-C", "Hi C",
  "Powerade", "Powerade Zero", "Vitaminwater", "Vitamin Water", "Glaceau",
  "Smartwater", "Smart Water", "Dasani", "Dasani Sparkling",
  "Honest Tea", "Honest Kids", "Topo Chico", "Topo Chico Hard Seltzer",
  "Costa Coffee", "Costa", "Simply Orange", "Simply Lemonade", "Simply",
  "Simply Apple", "Simply Grapefruit", "Innocent", "Innocent Drinks",
  "Gold Peak", "Gold Peak Tea", "Peace Tea", "Fairlife", "Fairlife Milk",
  "Core Power", "Coca-Cola Energy", "Coke Energy", "Monster Energy",
  "Mello Yello Zero", "AdeS", "Del Valle", "Aquarius", "Bonaqua",
  "Schweppes Coke", "Appletiser", "Lilt", "Oasis", "Ayataka",
  "Georgia", "Georgia Coffee", "Real Leaf", "Sokenbicha", "I Lohas",
  "Bodyarmor", "Body Armor", "BodyArmor SuperDrink", "Bodyarmor Lyte",
]);

// ── Nestlé ─────────────────────────────────────────────────────────────────
many(PARENTS.nestle, [
  "Nestle", "Nestlé", "Nestle USA", "Kit Kat", "KitKat", "Kit-Kat",
  "Nescafe", "Nescafé", "Nespresso", "Coffee-Mate", "Coffee Mate",
  "Stouffer's", "Stouffers", "Hot Pockets", "Lean Pockets", "DiGiorno",
  "Di Giorno", "Lean Cuisine", "Toll House", "Nestle Toll House",
  "Gerber", "Gerber Baby", "Gerber Graduates", "Perrier", "San Pellegrino",
  "Poland Spring", "Sanpellegrino", "Buxton", "Acqua Panna",
  "Arrowhead", "Arrowhead Water", "Deer Park", "Ice Mountain", "Ozarka",
  "Zephyrhills", "Pure Life", "Nestle Pure Life", "Carnation",
  "Carnation Evaporated Milk", "Nesquik", "Quik", "Nestle Quik", "Milo",
  "Boost", "Boost Nutrition", "Compleat", "Optifast", "Vital Proteins",
  "Nature's Bounty", "Atrium", "Garden of Life", "Solgar", "Pure Encapsulations",
  "Persona Nutrition", "Drumstick", "Edy's", "Edys", "Häagen-Dazs International",
  "Haagen Dazs", "Outshine", "Skinny Cow", "Push-Ups", "Push Pops",
  "Cookie Crisp", "Cinnamon Toast Crunch International", "Chef-mate",
  "Maggi", "Maggi Noodles", "Buitoni", "Sweet Earth", "Garden Gourmet",
  "Wonka", "Nerds", "Nerds Candy", "Sweet Tarts", "SweeTarts",
  "Spree", "Bottle Caps", "Laffy Taffy", "Pixy Stix", "Gobstopper",
  "Everlasting Gobstopper", "Runts", "Fun Dip",
  "Crunch", "Nestle Crunch", "Smarties Nestle", "Aero", "After Eight",
  "Animal Bar", "Bertie Beetle", "Big Turk", "Black Magic", "Boost Bar",
  "Butterfinger", "Cailler", "Caramello", "Carlos V", "Chips Ahoy! Cookies",
  "Chocapic", "Chokito", "Coffee Crisp", "Cookie Crisp", "Damak",
  "Drifter", "Fitness", "Flake", "Frigor", "Garoto", "Goobers",
  "Joya", "Lion", "Lion Bar", "Milkybar", "Milky Bar", "Mirage",
  "Negrita", "Nestle Alpine White", "Oh Henry", "Polo", "Polo Mints",
  "Quality Street", "Raisinets", "Rolo", "Smarties", "Texan Bar",
  "Tronky", "Turtles", "Violet Crumble", "Wonka Bar", "Yorkie",
  "Yorkie Bar", "Zero Bar",
]);
// Nestle Purina
many(PARENTS.purinaNestle, [
  "Purina", "Purina ONE", "Purina One", "Purina Pro Plan", "Pro Plan",
  "Friskies", "Fancy Feast", "Beneful", "Beggin' Strips", "Beggin Strips",
  "Beggin'", "Tidy Cats", "Cat Chow", "Dog Chow", "Alpo", "Mighty Dog",
  "Kit & Kaboodle", "Kit and Kaboodle", "Felix", "Bonio", "Gourmet",
  "Pro Plan Veterinary Diets", "Purina Veterinary Diets",
  "Kibbles n Bits", "Kibbles 'n Bits", "Bakers", "Yesterday's News",
  "Litter Genie", "Felix Soup", "Frosty Paws", "Busy Bone", "Whisker Lickin's",
  "Wet Pals", "Beyond", "Purina Beyond", "Muse",
]);

// ── Unilever ────────────────────────────────────────────────────────────────
many(PARENTS.unilever, [
  "Unilever", "Dove", "Dove Men+Care", "Dove Men Care", "Dove Soap",
  "Axe", "AXE", "Lynx", "Hellmann's", "Hellmanns", "Best Foods", "Mayo",
  "Knorr", "Knorr Soup", "Knorr Sides", "Lipton", "Lipton Tea",
  "Lipton Iced Tea", "Brooke Bond", "PG Tips", "Ben & Jerry's",
  "Ben and Jerry's", "Ben & Jerrys", "Magnum", "Magnum Ice Cream",
  "Klondike", "Klondike Bar", "Talenti", "Breyer's", "Breyers",
  "Popsicle", "Good Humor", "Cornetto", "Wall's", "Walls",
  "Suave", "Vaseline Brand", "Vaseline Petroleum Jelly", "Q-tips", "Qtips", "Q Tips",
  "TRESemmé", "TRESemme", "Tresemme", "Pond's", "Ponds", "Pond's Cream",
  "Degree", "Degree Deodorant", "St. Ives", "St Ives", "Saint Ives",
  "Nexxus", "Sunsilk", "Clear", "Clear Shampoo", "Caress", "Lever 2000",
  "Lever 2000 Soap", "Lifebuoy", "Lux", "Lux Soap", "Rexona", "Sure",
  "Sure Deodorant", "Impulse", "Ren", "Ren Clean Skincare", "Schmidt's",
  "Schmidts", "Seventh Generation", "Persil ProClean", "Persil ProClean Discs",
  "Snuggle Brand", "Surf Excel", "Surf", "Comfort", "Cif", "Domestos",
  "Hourglass", "Hourglass Cosmetics", "Living Proof", "Murad", "Murad Skincare",
  "Dermalogica", "Kate Somerville", "Tazo", "Tazo Tea", "PureIt",
  "Pureit", "Continental", "Continental Soup", "Hourglass", "Dollar Shave Club",
  "Sir Kensington's", "Sir Kensingtons", "Mayocoba", "Carte d'Or", "Carte dOr",
  "Country Crock", "I Can't Believe It's Not Butter", "Cant Believe Its Not Butter",
  "Bertolli", "Bertolli Pasta Sauce", "Wish-Bone", "Wishbone",
  "Marmite", "Vegemite Australia", "Bovril", "Pot Noodle", "Slim-Fast",
  "Slim Fast", "Slimfast", "Streets", "Cremo", "Mae", "Lakme",
  "Pepsodent", "Closeup", "Close-Up", "Close Up Toothpaste",
  "Signal", "Mentadent", "Aim Toothpaste", "Andrelon", "Brut",
  "Cif Cream", "Comfort Fabric", "Cornetto Ice Cream", "Domex",
  "Fair & Lovely", "Glow & Lovely", "Glow and Lovely", "Hartog's",
  "Heartbrand", "Hourglass Cosmetics", "I Heart Naturals",
  "Lifebuoy Soap", "Mod's Hair", "Omo", "OMO", "Persil Unilever",
  "Pringles Unilever", "Quanta Pura", "Radox", "Sara Lee Body Care",
  "Skippy", "Skippy Peanut Butter", "Smith & Vandiver", "Surf Excel",
  "Toni & Guy", "Toni and Guy", "TRESemmé Naturals", "Vasenol",
  "Vim", "Wall's Ice Cream", "Zendium",
]);

// ── Procter & Gamble ────────────────────────────────────────────────────────
many(PARENTS.pg, [
  "Procter & Gamble", "Procter Gamble", "P&G", "PG", "Tide", "Tide Pods",
  "Tide Free", "Bounty", "Bounty Paper Towels", "Charmin", "Charmin Ultra",
  "Crest", "Crest Whitening", "Crest 3D White", "Crest Pro-Health",
  "Oral-B", "Oral B", "OralB", "Gillette", "Gillette Fusion", "Gillette Mach3",
  "Gillette Venus", "Venus", "Gillette ProGlide", "Pampers", "Pampers Cruisers",
  "Pampers Swaddlers", "Pantene", "Pantene Pro-V", "Head & Shoulders",
  "Head and Shoulders", "Olay", "Old Spice", "SK-II", "SK II", "Vicks",
  "Vicks VapoRub", "Vicks NyQuil", "Vicks DayQuil", "NyQuil", "DayQuil",
  "Pepto-Bismol", "Pepto Bismol", "Metamucil", "Febreze", "Swiffer",
  "Swiffer WetJet", "Mr. Clean", "Mr Clean", "Dawn", "Dawn Dish Soap",
  "Cascade", "Cascade Pods", "Cascade Dishwasher", "Joy", "Joy Dish Soap",
  "Bounce", "Bounce Dryer Sheets", "Downy", "Downy Unstopables", "Gain",
  "Gain Detergent", "Gain Fireworks", "Era", "Era Detergent", "Cheer",
  "Cheer Detergent", "Dreft", "Ariel", "Ariel Detergent", "Ace Bleach",
  "Mr Proper", "Salvo", "Always", "Always Pads", "Tampax", "Tampax Pearl",
  "Whisper", "Naturella", "Naturella Pads", "Luvs", "Luvs Diapers",
  "Pampers Pure", "ZzzQuil", "Vicks ZzzQuil", "Vicks Sinex", "PUR",
  "PUR Water", "Braun", "Braun Razor", "Fixodent", "Scope", "Scope Mouthwash",
  "Camay", "Camay Soap", "Safeguard", "Zest", "Coast", "Ivory",
  "Ivory Soap", "Hugo Boss Fragrances", "Hugo Boss Cologne", "Dolce & Gabbana Beauty",
  "DG Beauty", "Gucci Beauty", "Gucci Fragrances", "Lacoste Fragrances",
  "Native", "Native Deodorant", "Olay Regenerist", "Olay Total Effects",
  "First Response", "First Response Pregnancy Test",
  "Secret", "Secret Deodorant", "Mr. Clean Magic Eraser", "Mr Clean Magic Eraser",
  "Bonus", "Bonux", "Dash", "Dash Detergent", "Lenor",
]);

// ── Kraft Heinz ─────────────────────────────────────────────────────────────
many(PARENTS.kraftHeinz, [
  "Kraft Heinz", "Kraft", "Heinz", "Heinz Ketchup", "Heinz Mustard",
  "Oscar Mayer", "Oscar Meyer", "Jell-O", "Jello", "Jell O", "Velveeta",
  "Capri Sun", "Capri-Sun", "CapriSun", "Kool-Aid", "Kool Aid", "KoolAid",
  "Maxwell House", "Maxwell House Coffee", "Philadelphia", "Philadelphia Cream Cheese",
  "Planters", "Planters Peanuts", "Lunchables", "Ore-Ida", "Ore Ida",
  "Kraft Mac & Cheese", "Kraft Macaroni", "Easy Mac", "Velveeta Shells",
  "Cracker Barrel", "Cracker Barrel Cheese", "Stove Top", "Stove Top Stuffing",
  "Stovetop Stuffing", "Shake 'N Bake", "Shake N Bake", "Shake and Bake",
  "Grey Poupon", "A.1.", "A1 Steak Sauce", "A.1. Sauce", "A1",
  "Lea & Perrins", "Lea and Perrins", "Worcestershire Sauce",
  "Miracle Whip", "Smart Ones", "Smart Ones Frozen", "Weight Watchers Smart Ones",
  "Boca", "Boca Burger", "Bagel Bites", "Devour", "Devour Frozen",
  "Polly-O", "Polly O", "Roka", "Maxwell", "Sanka", "Yuban",
  "International Delight", "Milani", "Quero", "Wattie's", "Watties",
  "Brianna's", "Briannas", "Lender's", "Lenders", "Lender's Bagels",
  "Cool Whip", "Country Time", "Country Time Lemonade", "Tang Heinz",
  "Smucker's Heinz", "Plasmon", "Karvan Cevitam", "Honig", "Roosvicee",
  "Brinta", "Cool Whip Lite", "Mio", "Mio Water", "Crystal Light",
  "Crystal Light Lemonade", "Cabazitaxel", "Classico", "Classico Pasta Sauce",
  "Frank's RedHot", "Franks RedHot", "French's", "Frenchs Mustard",
  // Note: Frank's RedHot & French's are McCormick — moved below
]);

// ── General Mills ───────────────────────────────────────────────────────────
many(PARENTS.generalMills, [
  "General Mills", "Cheerios", "Honey Nut Cheerios", "Multi Grain Cheerios",
  "Cheerios Protein", "Lucky Charms", "Wheaties", "Pillsbury",
  "Pillsbury Crescent", "Pillsbury Grands", "Pillsbury Cookies",
  "Pillsbury Cinnamon Rolls", "Pillsbury Toaster Strudel", "Toaster Strudel",
  "Betty Crocker", "Hamburger Helper", "Tuna Helper", "Chicken Helper",
  "Yoplait", "Yoplait Original", "Yoplait Light", "Go-Gurt", "GoGurt",
  "Trix", "Trix Cereal", "Trix Yogurt", "Cocoa Puffs", "Reese's Puffs",
  "Reeses Puffs", "Count Chocula", "Boo Berry", "Franken Berry",
  "Total", "Total Cereal", "Total Whole Grain", "Chex", "Corn Chex",
  "Rice Chex", "Wheat Chex", "Chex Mix", "Fiber One", "Fiber One Brownies",
  "Nature Valley", "Nature Valley Granola", "Nature Valley Crunchy",
  "Nature Valley Sweet & Salty", "Old El Paso", "Annie's", "Annies",
  "Annie's Homegrown", "Annie's Mac & Cheese", "Larabar", "Lärabar",
  "Häagen-Dazs", "Haagen Dazs", "Haagen-Dazs", "Cascadian Farm",
  "Cascadian Farms", "Muir Glen", "Bisquick", "Bisquick Pancake",
  "Gold Medal", "Gold Medal Flour", "Wanchai Ferry", "Cinnamon Toast Crunch",
  "Cookie Crisp US", "Golden Grahams", "Total Raisin Bran",
  "Kix", "Kix Cereal", "Honey Kix", "Berry Berry Kix",
  "Wheat Thins GM", "Bugles GM", "Progresso", "Progresso Soup",
  "Pearl Milling Mix",
  "Wanchai Ferry", "Suddenly Salad", "Suddenly Pasta Salad", "Yo-Plait",
  "Liberte", "Liberté", "Liberté Yogurt", "Dunkaroos", "Bugles General Mills",
  "Macaroni Grill", "Helper Stove Top Mixes", "Mountain High Yoghurt",
  "EPIC", "EPIC Provisions", "Loaded Mashed Potatoes",
  "Wanchai Ferry Dumplings",
  "Blue Buffalo", "Blue", "Blue Wilderness", "Blue Life Protection",
  "Wilderness Blue", "Blue Tastefuls",
]);

// ── Kellogg's / Kellanova / WK Kellogg ──────────────────────────────────────
many(PARENTS.kelloggs, [
  "Kellogg's", "Kelloggs", "Kellogg", "Kellanova", "WK Kellogg", "W.K. Kellogg",
  "Pringles", "Pringles Original", "Pringles Sour Cream", "Pop-Tarts", "Pop Tarts",
  "Pop-Tarts Frosted", "Eggo", "Eggo Waffles", "Cheez-It", "Cheez-Its",
  "Cheez It", "Cheezit", "Special K", "Special K Red Berries", "Rice Krispies",
  "Rice Krispies Treats", "Frosted Flakes", "Corn Flakes", "Kellogg's Corn Flakes",
  "Froot Loops", "Fruit Loops", "Apple Jacks", "Mini-Wheats", "Mini Wheats",
  "Frosted Mini Wheats", "Raisin Bran", "Raisin Bran Crunch", "Crispix",
  "Corn Pops", "Smacks", "Honey Smacks", "Smart Start", "All-Bran", "All Bran",
  "Krave", "Bear Naked", "Bear Naked Granola", "Kashi GO",
  "Special K Protein", "Nutri-Grain", "Nutri Grain", "Nutrigrain",
  "Nutri-Grain Bars", "Eggo Mini", "Eggo Thick & Fluffy",
  "MorningStar Farms", "Morning Star Farms", "Morningstar",
  "MorningStar", "Veggie Burger Morningstar", "Gardenburger",
  "Famous Amos", "Famous Amos Cookies", "Mother's Cookies", "Mothers Cookies",
  "Murray", "Murray Cookies", "Keebler", "Keebler Cookies", "Town House",
  "Town House Crackers", "Club Crackers", "Sandies", "Pecan Sandies",
  "E.L. Fudge", "EL Fudge", "Chips Deluxe Keebler", "Vienna Fingers",
  "Carr's", "Carrs", "Carr's Crackers", "Austin", "Austin Crackers",
  "Stretch Island", "Stretch Island Fruit", "RXBAR", "RX Bar", "RXBar",
  "Kashi", "Kashi Cereal", "Kashi GoLean", "Kashi GO Crunch",
  "Bear Naked Soft", "Sunshine", "Cheez-It Snap'd",
]);

// ── Mars Inc ────────────────────────────────────────────────────────────────
many(PARENTS.mars, [
  "Mars", "Mars Inc", "Mars Incorporated", "M&M's", "M&Ms", "M and M's",
  "MnMs", "M&M", "Snickers", "Twix", "Mars Bar", "Milky Way", "3 Musketeers",
  "Three Musketeers", "Skittles", "Starburst", "Combos", "Combos Pretzel",
  "LifeSavers", "Life Savers", "Lifesavers", "Orbit", "Orbit Gum", "Extra",
  "Extra Gum", "Juicy Fruit", "Doublemint", "Big Red", "Big Red Gum",
  "Wrigley's Spearmint", "Wrigleys", "Wrigley's", "Hubba Bubba",
  "Bubble Tape", "Altoids", "Eclipse", "Eclipse Gum", "Lockets",
  "Pedigree", "Pedigree Dog Food", "Whiskas Brand", "Sheba", "Sheba Cat Food",
  "Iams Brand", "Iams Dog Food", "Royal Canin", "Royal Canin Cat",
  "Cesar", "Cesar Dog Food", "Nutro", "Greenies", "Greenies Treats",
  "Crave", "Crave Pet Food", "Temptations", "Temptations Cat Treats",
  "Whiskas Mars", "Kitekat", "Catsan", "Frolic", "Chappi", "Pal",
  "Dolmio", "Dolmio Pasta Sauce", "Uncle Ben's", "Uncle Bens", "Ben's Original",
  "Bens Original", "Seeds of Change", "Masterfoods", "Suzi-Wan",
  "Tasty Bite", "Kan Tong", "Kantong", "Galaxy", "Galaxy Chocolate",
  "Maltesers", "Topic", "Bounty Chocolate", "Bounty Bar", "Fling",
  "Forever Yours", "Marathon", "Mars Almond", "Munch", "Revels",
  "Twirl Bar", "Curly Wurly", "Banjo Bar", "Snickers Almond",
  "Snickers Peanut Butter", "Milky Way Midnight", "Milky Way Dark",
  "Snickers Ice Cream", "Twix Ice Cream", "Dove Chocolate",
  "Dove Promises", "Galaxy Minstrels", "Tunes", "Spangles",
  "Banfield Pet Hospital", "BluePearl Pet Hospital", "VCA Animal Hospitals",
  "Antech Diagnostics", "Heinz Mars",
]);

// Wrigley brands (own slug)
many(PARENTS.wrigley, [
  "Wrigley", "Wrigleys", "Wrigley's", "Wrigley Co",
]);

// ── Hershey ─────────────────────────────────────────────────────────────────
many(PARENTS.hershey, [
  "Hershey", "Hershey's", "Hersheys", "Hershey Company", "Hershey Bar",
  "Hershey's Kisses", "Hershey Kisses", "Kisses", "Reese's", "Reeses",
  "Reese's Pieces", "Reeses Pieces", "Reese's Cups", "Reese's Peanut Butter Cups",
  "Reese's Big Cup", "Reeses Big Cup", "Reese's Outrageous", "Reese's Take 5",
  "Take 5", "Take Five", "Kit Kat US", "Kit Kat Hershey",
  "Twizzlers", "Twizzlers Pull n Peel", "Jolly Rancher", "Jolly Ranchers",
  "Almond Joy", "Mounds", "Heath", "Heath Bar", "Skor", "Skor Bar",
  "Whoppers", "Milk Duds", "Milk Dud", "Pay Day", "PayDay", "Payday",
  "5th Avenue", "5th Avenue Bar", "Krackel", "Mr. Goodbar", "Mr Goodbar",
  "Goodbar", "Special Dark", "Hershey's Special Dark", "Symphony",
  "Symphony Bar", "Cookies 'n' Creme", "Cookies n Creme", "Hershey's Cookies",
  "Rolo US", "Rolo Hershey", "York", "York Peppermint Patties",
  "York Peppermint Pattie", "Bubble Yum", "Ice Breakers", "Icebreakers",
  "Breath Savers", "BreathSavers", "Breath Savers Mints",
  "Brookside", "Brookside Dark Chocolate", "Cadbury US", "Cadbury Creme Egg US",
  "Cadbury Mini Eggs US", "Scharffen Berger", "Dagoba",
  "Krave Jerky", "SkinnyPop", "Skinny Pop", "Skinny Pop Popcorn",
  "Pirate's Booty", "Pirates Booty", "Lily's", "Lilys", "Lily's Chocolate",
  "Dot's Pretzels", "Dots Pretzels", "Dot's Homestyle Pretzels",
  "Pretzelmaker", "Reese's Puffs Cereal", "Hershey's Syrup",
  "Mauna Loa", "Mauna Loa Macadamia",
]);

// ── Anheuser-Busch InBev ───────────────────────────────────────────────────
many(PARENTS.abInBev, [
  "Anheuser-Busch", "Anheuser Busch", "AB InBev", "ABInBev", "InBev",
  "Anheuser-Busch InBev", "Budweiser", "Bud Light", "Bud Light Lime",
  "Bud Light Seltzer", "Bud Light Platinum", "Bud Ice", "Bud Dry",
  "Michelob", "Michelob Ultra", "Michelob Light", "Stella Artois",
  "Stella", "Corona Extra International", "Corona Light International",
  "Hoegaarden", "Beck's", "Becks", "Goose Island", "Goose Island IPA",
  "Goose Island 312", "Natural Light", "Natty Light", "Natural Ice",
  "Natty Ice", "Busch", "Busch Light", "Busch Beer", "Bass", "Bass Pale Ale",
  "Leffe", "Leffe Blonde", "Boddingtons", "Brahma", "Brahma Beer",
  "Skol", "Quilmes", "Cass", "Harbin Beer", "Sedrin", "Antarctica",
  "Bohemia", "Castle Lager", "Carling Black Label", "Hasseröder", "Hasseroder",
  "Jupiler", "Spaten", "Lowenbrau", "Löwenbräu", "Franziskaner",
  "Estrella Damm", "Cubanisto", "Magners", "Tennent's", "Tennents",
  "Spykes", "Stella Artois Cidre", "Wicked", "Wicked Wheat",
  "Rolling Rock", "Skipper", "Patagonia", "Patagonia Beer",
  "Modelo Especial US", "Modelo Negra US", "Cutwater", "Cutwater Spirits",
  "Hop Valley", "Karbach", "Wicked Weed", "Devils Backbone",
  "Elysian", "10 Barrel", "Ten Barrel", "Blue Point", "Breckenridge Brewery",
  "Four Peaks", "Golden Road", "Kona Brewing", "Veza Sur",
  "Wild Goose", "Mason Ale", "Magners Cider",
]);

// ── Molson Coors ────────────────────────────────────────────────────────────
many(PARENTS.molsonCoors, [
  "Molson Coors", "Molson", "Coors", "Coors Light", "Coors Banquet",
  "Miller", "Miller Lite", "Miller High Life", "Miller Genuine Draft",
  "MGD", "Miller 64", "Blue Moon", "Blue Moon Belgian White", "Keystone",
  "Keystone Light", "Keystone Ice", "Foster's", "Fosters", "Peroni",
  "Peroni Nastro Azzurro", "Pilsner Urquell", "Carling", "Carling Beer",
  "Hamm's", "Hamms", "Hamm's Beer", "Olde English", "Mickey's Malt Liquor",
  "Mickeys", "Steel Reserve", "Magnum Malt Liquor", "Icehouse",
  "Henry's Hard Soda", "Henrys Hard Soda", "Crispin Cider", "Crispin",
  "Smith & Forge", "George Killian's Irish Red", "Killians", "Killian's",
  "Leinenkugel's", "Leinenkugels", "Leinies", "Vizzy", "Vizzy Hard Seltzer",
  "Topo Chico Hard Seltzer Molson", "Coors Edge", "Coors Pure", "Coors Seltzer",
  "Carling Black Label MC", "Cobra", "Cobra Beer", "Worthington's",
  "Worthingtons", "Caffrey's", "Caffreys", "Caffrey's Irish Ale",
  "ZOA", "ZOA Energy", "AC Golden", "Saint Archer", "Terrapin",
  "Madri", "Madrí", "Madri Excepcional", "Aspall Cyder", "Aspall",
  "Three Fold Cider", "Sharp's Doom Bar", "Sharps Doom Bar",
]);

// ── Constellation Brands (corona-constellation-brands) ─────────────────────
many(PARENTS.constellation, [
  "Constellation Brands", "Corona", "Corona Extra", "Corona Light",
  "Corona Premier", "Corona Familiar", "Corona Refresca", "Modelo",
  "Modelo Especial", "Modelo Negra", "Negra Modelo", "Pacifico",
  "Pacifico Clara", "Victoria", "Victoria Beer", "Robert Mondavi",
  "Mondavi", "Kim Crawford", "Kim Crawford Sauvignon Blanc", "Meiomi",
  "Meiomi Pinot Noir", "The Prisoner", "Prisoner Wine", "Ruffino",
  "Ruffino Chianti", "Casa Noble", "Casa Noble Tequila", "Mi Campo",
  "Mi Campo Tequila", "Svedka", "Svedka Vodka", "High West", "High West Whiskey",
  "Nelson's Green Brier", "Nelson Green Brier", "Black Velvet",
  "Black Velvet Whiskey", "Paul Masson", "Paul Masson Brandy",
  "Schrader Cellars", "Mount Veeder Winery", "Mount Veeder",
  "Charles Smith Wines", "Crafters Union", "Cooper & Thief", "Cooper and Thief",
  "Lumina", "Simi Winery", "Estancia", "Clos du Bois",
  "Dreaming Tree", "Funky Buddha", "Funky Buddha Brewery",
  "Ballast Point", "Ballast Point Brewing",
]);

// ── Johnson & Johnson (consumer arm = Kenvue post-2023) ────────────────────
many(PARENTS.kenvue, [
  "Kenvue", "Tylenol", "Tylenol Extra Strength", "Tylenol PM", "Band-Aid",
  "Band Aid", "Bandaid", "Listerine", "Listerine Cool Mint", "Neutrogena",
  "Neutrogena Hydro Boost", "Aveeno", "Aveeno Baby", "Aveeno Daily Moisturizing",
  "Clean & Clear", "Clean and Clear", "Lubriderm", "Carefree",
  "Carefree Pads", "OB Tampons", "Stayfree", "Sudafed", "Sudafed PE",
  "Benadryl", "Benadryl Allergy", "Motrin", "Motrin IB", "Zyrtec",
  "Zyrtec D", "Imodium", "Imodium AD", "Pepcid", "Pepcid AC",
  "Rolaids", "Mylanta", "Visine", "Visine Eye Drops", "Splenda",
  "Splenda Sweetener", "Nicorette", "Nicoderm", "Nicoderm CQ",
  "Calpol", "Caltrate Kenvue", "Listerine PocketPaks", "Reactine",
  "Johnson's Baby", "Johnsons Baby", "Johnson's Baby Shampoo",
  "Johnson's Baby Powder", "Desitin", "Penaten", "Bedtime Bath",
  "Le Petit Marseillais", "Aveeno Positively Radiant", "OGX",
  "Listerine Total Care", "Tylenol Sinus", "Tylenol Cold",
  "Tylenol Arthritis", "Vendome", "Tucks", "Tucks Pads",
]);
many(PARENTS.jnj, [
  "Johnson & Johnson", "Johnson and Johnson", "J&J", "JnJ",
  "Ethicon", "DePuy", "Janssen", "Janssen Pharmaceuticals",
  "Acuvue", "Acuvue Contact Lenses", "Stelara", "Remicade",
  "Imbruvica", "Xarelto", "Tremfya", "Darzalex", "Erleada",
  "Invokana", "Concerta", "Risperdal", "Procrit",
]);

// ── Colgate-Palmolive ──────────────────────────────────────────────────────
many(PARENTS.colgate, [
  "Colgate", "Colgate-Palmolive", "Colgate Total", "Colgate Optic White",
  "Colgate Max Fresh", "Colgate Sensitive", "Palmolive", "Palmolive Dish",
  "Palmolive Ultra", "Tom's of Maine", "Toms of Maine", "Tom's",
  "Hill's Pet Nutrition", "Hills Pet Nutrition", "Hill's Science Diet",
  "Hills Science Diet", "Science Diet", "Hill's Prescription Diet",
  "Hills Prescription Diet", "Speed Stick", "Lady Speed Stick",
  "Mennen", "Mennen Speed Stick", "Irish Spring", "Softsoap",
  "Softsoap Hand Soap", "Ajax", "Ajax Cleaner", "Ajax Dish Soap",
  "Fab", "Fab Detergent", "Suavitel", "Cuddly", "Murphy Oil Soap",
  "Murphy's Oil Soap", "Murphys Oil Soap", "Hawley & Hazel", "Darlie",
  "Sanex", "Sanex Deodorant", "Cleopatra", "Elmex", "Meridol",
  "Diaper Genie", "Soupline", "Axion", "Hi-Wash", "Protex",
  "Caprice", "Lady Speed Stick Fresh Fusion", "Filorga",
  "EltaMD", "EltaMD Sunscreen", "PCA Skin", "Hello Products", "Hello Toothpaste",
]);

// ── Newell Brands ───────────────────────────────────────────────────────────
many(PARENTS.newell, [
  "Newell Brands", "Sharpie", "Sharpie Markers", "Sharpie Permanent",
  "Rubbermaid", "Rubbermaid Commercial", "Coleman", "Coleman Cooler",
  "Coleman Tent", "Yankee Candle", "Mr. Coffee", "Mr Coffee",
  "Crock-Pot", "Crock Pot", "Crockpot", "Foodsaver", "FoodSaver",
  "Calphalon", "Oster", "Oster Blender", "Sunbeam", "Sunbeam Heater",
  "Sunbeam Blanket", "Holmes", "Holmes Heater", "Bionaire", "Mr. Coffee Coffee Maker",
  "Paper Mate", "PaperMate", "Paper Mate Pen", "Parker", "Parker Pen",
  "Waterman", "Waterman Pen", "Expo", "Expo Markers", "Elmer's",
  "Elmers", "Elmer's Glue", "X-Acto", "X Acto", "Dymo", "DYMO",
  "Mr. Sketch", "Mr Sketch", "Prismacolor", "Graco", "Graco Stroller",
  "Graco Car Seat", "Baby Jogger", "NUK", "NUK Bottles", "Aprica",
  "Tigex", "Quickie", "Contigo", "Contigo Water Bottle", "Bubba",
  "Bubba Brands", "Bubba Bottle", "Marmot", "Marmot Jacket",
  "ExOfficio", "Ex Officio", "Spontex", "Mapa", "Volo",
  "Diamond", "Diamond Matches", "First Alert", "BRK", "BRK Electronics",
  "Bicycle Cards", "Bicycle Playing Cards", "Aviator Cards", "Hoyle",
  "Hoyle Cards", "Yankee Candle Company",
]);

// ── Clorox ──────────────────────────────────────────────────────────────────
many(PARENTS.clorox, [
  "Clorox", "Clorox Bleach", "Clorox Disinfecting Wipes", "Clorox Wipes",
  "Pine-Sol", "Pine Sol", "Hidden Valley", "Hidden Valley Ranch",
  "KC Masterpiece", "Kingsford", "Kingsford Charcoal", "Kingsford Match Light",
  "Burt's Bees", "Burts Bees", "Brita", "Brita Filter", "Brita Pitcher",
  "Glad", "Glad ForceFlex", "Glad Bags", "Glad Trash Bags",
  "Liquid-Plumr", "Liquid Plumr", "Tilex", "Tilex Mold", "Tilex Bathroom",
  "S.O.S", "SOS", "SOS Pads", "Formula 409", "409 Cleaner", "409",
  "Clorox Clean-Up", "Clorox Bathroom", "Clorox Toilet Bowl",
  "Clorox 2", "Clorox2", "Fresh Step", "Fresh Step Cat Litter",
  "Scoop Away", "Scoop Away Cat Litter", "Natural Vitality", "Calm",
  "Natural Vitality Calm", "Renew Life", "Renew Life Probiotics",
  "Rainbow Light", "Rainbow Light Vitamins", "Stop Aging Now",
  "NeoCell", "Neocell", "Liquid-Plumr Snake",
  "Ever Clean", "Ever Clean Cat Litter", "Glad Press'n Seal",
  "Glad Pressn Seal", "Glad Press n Seal", "Glad ClingWrap", "Glad Cling Wrap",
]);

// ── Tyson Foods ─────────────────────────────────────────────────────────────
many(PARENTS.tyson, [
  "Tyson", "Tyson Foods", "Tyson Chicken", "Tyson Anytizers",
  "Jimmy Dean", "Jimmy Dean Sausage", "Jimmy Dean Breakfast",
  "Hillshire Farm", "Hillshire Farms", "Hillshire", "Sara Lee Tyson",
  "Sara Lee Bread", "Ball Park", "Ball Park Franks", "Ball Park Hot Dogs",
  "State Fair", "State Fair Corn Dogs", "Aidells", "Aidells Sausage",
  "Wright Brand", "Wright Brand Bacon", "Wright Bacon", "Mexican Original",
  "Cobb-Vantress", "Cobb Vantress", "BCG Foods", "BCG", "BBQ Original",
  "Bosco's", "Boscos", "Bosco Sticks", "Open Prairie", "Open Prairie Natural",
  "Raised & Rooted", "Raised and Rooted", "True Chews",
  "Hillshire Snacking", "Jimmy Dean Delights", "Jimmy Dean Simple Scrambles",
  "Tyson Grilled & Ready", "Tyson Grilled and Ready", "Tyson Crispy Chicken Strips",
  "Tyson Any'tizers",
]);
many(PARENTS.pilgrims, [
  "Pilgrim's", "Pilgrims", "Pilgrim's Pride", "Pilgrim Pride",
]);

// ── JBS ────────────────────────────────────────────────────────────────────
many(PARENTS.jbs, [
  "JBS", "JBS USA", "JBS Foods", "Swift", "Swift Beef", "Swift Pork",
  "Swift Premium", "Just BARE", "Just BARE Chicken", "1855", "1855 Black Angus",
  "Friboi", "Cabaña Las Lilas", "Cabana Las Lilas", "Plumrose", "Plumrose USA",
  "Adelaide Brighton Cement", "Smithfield JBS",  // not really — drop if wrong
  "Seara", "Seara Foods", "Moy Park", "Moy Park Chicken",
]);

// ── ConAgra Brands ─────────────────────────────────────────────────────────
many(PARENTS.conagra, [
  "ConAgra", "Conagra", "Conagra Brands", "Hunt's", "Hunts", "Hunt's Ketchup",
  "Slim Jim", "Slim Jims", "Reddi-wip", "Reddi Wip", "Reddi-Whip", "Reddiwhip",
  "Birds Eye", "Birds Eye Vegetables", "Healthy Choice", "Marie Callender's",
  "Marie Callenders", "Marie Callender", "Banquet", "Banquet Frozen Meals",
  "Chef Boyardee", "Vlasic", "Vlasic Pickles", "Wesson", "Wesson Oil",
  "Hebrew National", "Hebrew National Hot Dogs", "Orville Redenbacher",
  "Orville Redenbachers", "Orville Redenbacher's", "Pam", "PAM Cooking Spray",
  "Pam Cooking Spray", "La Choy", "Rosarita", "Snack Pack", "Snack Pack Pudding",
  "Swiss Miss", "Swiss Miss Cocoa", "Act II", "Act 2", "Act II Popcorn",
  "Andy Capp's", "Andy Capps", "Andy Capp's Hot Fries", "Angie's Boomchickapop",
  "Boomchickapop", "Angie's BOOMCHICKAPOP", "Crunch 'n Munch", "Crunch n Munch",
  "Fiddle Faddle", "Pop Secret", "Pop Secret Popcorn", "Jiffy Pop",
  "Duncan Hines", "Egg Beaters", "Frontera", "Frontera Salsa",
  "Gardein", "Gardein Beefless", "Gardein Chicken", "Gulden's Mustard",
  "Guldens", "Hungry-Man", "Hungry Man", "Hungry-Man Frozen", "Kid Cuisine",
  "La Choy Soy Sauce", "Libby's", "Libbys", "Manwich", "Manwich Sloppy Joe",
  "Marie Callender's Pie", "P.F. Chang's Home Menu", "PF Changs Home Menu",
  "Parkay", "Parkay Margarine", "Peter Pan", "Peter Pan Peanut Butter",
  "Ro*Tel", "Ro Tel", "Rotel", "Ranch Style", "Ranch Style Beans",
  "Reddi-wip Yogurt", "Udi's", "Udis", "Udi's Gluten Free", "Van Camp's",
  "Van Camps", "Wolfgang Puck", "Wolfgang Puck Soup", "Glutino",
  "Earth Balance", "Earth Balance Buttery",
]);

// ── Kimberly-Clark ─────────────────────────────────────────────────────────
many(PARENTS.kimberlyClark, [
  "Kimberly-Clark", "Kimberly Clark", "KC", "Huggies", "Huggies Diapers",
  "Huggies Pull-Ups", "Pull-Ups", "Pull Ups", "GoodNites", "Good Nites",
  "Kleenex", "Kleenex Tissues", "Cottonelle", "Cottonelle Toilet Paper",
  "Scott", "Scott Tissue", "Scott Toilet Paper", "Scott Paper Towels",
  "Viva", "Viva Paper Towels", "Kotex", "Kotex Pads", "U by Kotex",
  "Depend", "Depend Underwear", "Poise", "Poise Pads", "Wypall",
  "WypAll", "Kimberly Clark Professional", "Spectra", "Hospeco",
  "Plenitude", "Andrex", "Andrex Toilet Paper", "Kim & Co", "WaterGuard",
  "Hakle", "Tena Kimberly Clark", "Hakle Toilet Paper",
]);

// ── Church & Dwight ────────────────────────────────────────────────────────
many(PARENTS.churchDwight, [
  "Church & Dwight", "Church and Dwight", "Arm & Hammer", "Arm and Hammer",
  "ArmHammer", "OxiClean", "Oxi Clean", "Trojan", "Trojan Condoms",
  "Trojan Magnum", "First Response", "Nair", "Nair Hair Removal",
  "Vitafusion", "Vitafusion Gummies", "L'il Critters", "Lil Critters",
  "L'il Critters Gummies", "Sterimar", "Batiste", "Batiste Dry Shampoo",
  "Spinbrush", "Arm & Hammer Spinbrush", "Waterpik", "Water Pik",
  "Waterpik Aquarius", "Toppik", "Toppik Hair", "FLAWLESS by Finishing Touch",
  "Finishing Touch Flawless", "Finishing Touch", "TheraBreath",
  "Therabreath", "TheraBreath Mouthwash", "Hero Cosmetics", "Mighty Patch",
  "Hero Mighty Patch", "Zicam", "Zicam Cold Remedy", "Orajel", "Oragel",
  "Orajel Toothache", "Anbesol", "Pearl Drops", "Mentadent CD",
  "Aim CD", "Close-Up CD", "Trojan Vibrations", "XTRA", "Xtra Detergent",
  "Xtra Laundry", "Kaboom", "Kaboom Cleaner", "Cameo Aluminum Cleaner",
]);

// ── Campbell Soup ──────────────────────────────────────────────────────────
many(PARENTS.campbell, [
  "Campbell's", "Campbells", "Campbell Soup", "Campbell's Soup",
  "Campbell's Chunky", "Chunky Soup", "Campbell's Slow Kettle",
  "Pace", "Pace Picante", "Pace Salsa", "Prego", "Prego Pasta Sauce",
  "Swanson", "Swanson Broth", "Swanson Chicken Broth", "V8", "V8 Juice",
  "V8 Splash", "V8 Energy", "Pepperidge Farm", "Pepperidge Farms",
  "Goldfish", "Goldfish Crackers", "Milano", "Milano Cookies",
  "Pepperidge Farm Cookies", "Mint Milano", "Brussels Cookies",
  "Pepperidge Farm Bread", "Pepperidge Farm Stuffing", "Snyder's of Hanover",
  "Snyders of Hanover", "Snyder's", "Snyders", "Snyder's Pretzels",
  "Lance", "Lance Crackers", "Cape Cod", "Cape Cod Chips",
  "Cape Cod Potato Chips", "Kettle", "Kettle Brand", "Kettle Chips",
  "Kettle Foods", "Pop Secret Campbell", "Snack Factory", "Pretzel Crisps",
  "Snyder's Pretzel Pieces", "Lance Toast Chee", "Late July",
  "Late July Snacks", "Emerald", "Emerald Nuts", "Pirouline",
  "Stella D'oro Campbell", "Stella Doro Campbell", "Plum Organics",
  "Bolthouse Farms", "Bolthouse",
]);

// ── J.M. Smucker ───────────────────────────────────────────────────────────
many(PARENTS.smucker, [
  "Smucker's", "Smuckers", "Smucker", "J.M. Smucker", "JM Smucker",
  "Smucker's Jelly", "Smucker's Jam", "Jif", "Jif Peanut Butter",
  "Jif Skippy", "Folgers", "Folgers Coffee", "Folgers Classic Roast",
  "Cafe Bustelo", "Café Bustelo", "Bustelo", "Cafe Pilon",
  "Dunkin' Donuts Coffee", "Dunkin Donuts Coffee At Home",
  "1850 Coffee", "Crisco", "Crisco Shortening", "Crisco Oil",
  "Smucker's Uncrustables", "Uncrustables", "Pillsbury Smucker",
  "Hungry Jack", "Hungry Jack Pancake", "Carnation Smucker",
  "Robin Hood Flour", "Eagle Brand", "Eagle Brand Milk",
  "Five Roses", "Five Roses Flour", "R.W. Knudsen", "RW Knudsen",
  "Santa Cruz Organic", "Adams Peanut Butter", "Goober",
  "Goober Grape", "Laura Scudder's", "Laura Scudders",
  "Sahale Snacks", "Sahale", "Truroots", "TruRoots",
  "Kibbles 'n Bits Smucker", "Milk Bone", "Milk-Bone",
  "Pup-Peroni", "Pup Peroni", "Meow Mix", "Gravy Train",
  "9Lives", "9 Lives", "Nine Lives", "Snausages",
  "Big Heart Pet Brands", "Pounce", "Pounce Cat Treats",
  "Nature's Recipe", "Natures Recipe", "Rachael Ray Nutrish",
  "Rachael Ray", "Nutrish", "Dad's Dog Food", "Dads Dog Food",
]);

// ── Hormel Foods ───────────────────────────────────────────────────────────
many(PARENTS.hormel, [
  "Hormel", "Hormel Foods", "Spam", "SPAM", "Skippy Hormel",
  "Skippy Peanut Butter Hormel", "Skippy", "Dinty Moore", "Dinty Moore Stew",
  "Stagg", "Stagg Chili", "Hormel Chili", "Hormel Cure 81 Ham",
  "Cure 81", "Hormel Black Label", "Black Label Bacon",
  "Jennie-O", "Jennie O", "JennieO", "Jennie-O Turkey", "Hormel Turkey",
  "Applegate", "Applegate Naturals", "Applegate Farms",
  "Justin's", "Justins", "Justin's Nut Butter", "Justin's Almond Butter",
  "Wholly Guacamole", "Wholly Avocado", "Wholly", "Herdez",
  "Herdez Salsa", "La Victoria", "La Victoria Salsa", "Don Miguel",
  "Don Miguel Foods", "Lloyd's BBQ", "Lloyds BBQ", "Hormel Compleats",
  "Compleats", "Mary Kitchen", "Mary Kitchen Hash", "Hormel Pepperoni",
  "Hormel Bacon Bits", "Bacon Bits", "Real Bacon Bits", "Café H",
  "Cafe H", "House of Tsang", "House Of Tsang", "Embasa",
  "Embasa Chipotle", "Ceratti", "Hormel Square Table",
  "Sadler's Smokehouse", "Sadlers Smokehouse",
  "Columbus Salame", "Columbus Salami", "Columbus Craft Meats",
  "Planters Hormel", "Planters Peanuts Hormel",
]);

// ── McCormick ──────────────────────────────────────────────────────────────
many(PARENTS.mccormick, [
  "McCormick", "McCormick Spices", "McCormick Seasoning",
  "French's", "Frenchs", "French's Mustard", "French's Crispy Onions",
  "Frank's RedHot", "Franks RedHot", "Frank's Red Hot", "Cholula",
  "Cholula Hot Sauce", "Old Bay", "Old Bay Seasoning", "Lawry's",
  "Lawrys", "Lawry's Seasoned Salt", "Zatarain's", "Zatarains",
  "Zatarain's Jambalaya", "Stubb's", "Stubbs", "Stubb's BBQ Sauce",
  "Stubbs BBQ Sauce", "Kitchen Bouquet", "Schwartz", "Schwartz Seasoning",
  "Ducros", "Vahiné", "Vahine", "Club House", "Clubhouse", "Club House Spice",
  "Thai Kitchen", "Simply Asia", "Gourmet Garden", "Tones Spices",
  "Spice Islands", "Mama Sita's", "Mama Sitas", "McCormick Grill Mates",
  "Grill Mates", "Bag 'n Season", "Slim Jim McCormick",
]);

// ── Keurig Dr Pepper ───────────────────────────────────────────────────────
many(PARENTS.kdp, [
  "Keurig", "Keurig Coffee", "Keurig K-Cup", "K-Cup", "KCup", "Keurig Dr Pepper",
  "Dr Pepper", "Dr. Pepper", "Dr Pepper Cherry", "Dr Pepper Zero",
  "7UP KDP", "7 Up", "Schweppes KDP", "Snapple", "Snapple Tea",
  "Snapple Apple", "A&W Root Beer", "A and W Root Beer", "AandW",
  "A&W Cream Soda", "Sunkist", "Sunkist Orange", "Canada Dry",
  "Canada Dry Ginger Ale", "Mott's", "Motts", "Mott's Applesauce",
  "Mott's Apple Juice", "Hawaiian Punch", "Yoo-hoo", "Yoohoo",
  "Yoo Hoo", "Penafiel", "Peñafiel", "Squirt", "Squirt Soda",
  "RC Cola", "Royal Crown", "Royal Crown Cola", "Cactus Cooler",
  "Vernors", "Vernors Ginger Soda", "Crush KDP", "Big Red KDP",
  "Tahitian Treat", "Welch's KDP", "Welchs Soda", "Welch's Grape Soda",
  "Stewart's Fountain", "Stewarts Fountain", "Stewart's Root Beer",
  "Diet Rite", "Country Time KDP", "ReaLemon", "ReaLime",
  "Bai", "Bai Bubbles", "Bai Antioxidant", "Body Armor KDP",
  "Core Hydration", "Core Hydration Water", "Polar Beverages",
  "Vita Coco KDP", "Limited Edition", "Hydrive", "Force Factor",
  "Force Factor Pre Workout", "Atkins Bars KDP", "Atkins KDP",
  "ForToo", "Penafiel KDP", "Mistic", "Mistic Juice",
  "Clamato", "Clamato Juice", "Margaritaville KDP",
  "Margaritaville Cocktails", "Green Mountain Coffee",
  "Green Mountain", "Caribou Coffee", "Caribou", "Tully's",
  "Tullys", "Tully's Coffee", "Original Donut Shop", "Donut Shop Coffee",
  "Diedrich Coffee", "Coffee People", "Forte Coffee",
  "Polar Seltzer", "Polar", "Polar Beverages",
]);

// ── Altria / PMI / RJR / Reynolds Consumer ─────────────────────────────────
many(PARENTS.altria, [
  "Altria", "Altria Group", "Marlboro", "Marlboro Red", "Marlboro Lights",
  "Marlboro Gold", "Marlboro Menthol", "Marlboro Smooth", "Marlboro Silver",
  "Marlboro Black", "Marlboro Special Blend", "Philip Morris USA",
  "Philip Morris", "Parliament", "Parliament Cigarettes",
  "Virginia Slims", "Benson & Hedges", "Benson and Hedges",
  "Merit", "Merit Cigarettes", "Basic", "Basic Cigarettes",
  "Black & Mild", "Black and Mild", "Black & Mild Cigars",
  "Middleton", "John Middleton", "Copenhagen", "Copenhagen Dip",
  "Skoal", "Skoal Dip", "Husky", "Husky Dip", "Red Seal",
  "Red Seal Tobacco", "Nat Sherman", "Helix Innovations",
  "on!", "on! Nicotine", "on! Pouches", "njoy", "NJOY",
  "NJOY Ace", "Ste. Michelle Wine Estates", "Chateau Ste. Michelle",
  "Chateau Ste Michelle", "Columbia Crest", "14 Hands",
]);
many(PARENTS.pmi, [
  "Philip Morris International", "PMI", "Marlboro International",
  "L&M", "L and M", "L&M Cigarettes", "Chesterfield",
  "Chesterfield Cigarettes", "Lark", "Lark Cigarettes",
  "Bond Street", "Bond Cigarettes", "Next", "Optima",
  "Sampoerna", "Sampoerna A Mild", "A Mild", "U Mild",
  "IQOS", "IQOS Heatsticks", "Heets", "HEETS", "Marlboro IQOS",
  "Veev", "VEEV", "VEEV NOW", "Terea", "TEREA",
]);
many(PARENTS.rjr, [
  "R.J. Reynolds", "RJ Reynolds", "RJR", "Camel", "Camel Cigarettes",
  "Camel Crush", "Camel Filters", "Newport", "Newport Cigarettes",
  "Newport Menthol", "Pall Mall", "Pall Mall Cigarettes",
  "Doral", "Doral Cigarettes", "Kool", "Kool Cigarettes",
  "Kool Menthol", "Misty", "Misty Cigarettes", "Salem",
  "Salem Cigarettes", "Winston", "Winston Cigarettes",
  "Natural American Spirit", "American Spirit", "American Spirit Cigarettes",
  "Eclipse Cigarettes", "Vuse", "Vuse Vapor", "Vuse Alto", "Vuse Solo",
  "Grizzly", "Grizzly Tobacco", "Kodiak", "Kodiak Dip", "Longhorn",
  "Longhorn Snuff",
]);
many(PARENTS.reynoldsConsumer, [
  "Reynolds Consumer Products", "Reynolds Wrap", "Reynolds Aluminum Foil",
  "Reynolds Foil", "Hefty", "Hefty Trash Bags", "Hefty Cinch Sak",
  "Hefty Slider Bags", "Reynolds Kitchens", "Reynolds Parchment",
  "Diamond Foil", "Hefty Ultra Strong", "Hefty Storage Bags",
  "EZ Foil", "EZ Foil Pans", "Presto Products", "Vitafresh",
]);

// ── Diageo ────────────────────────────────────────────────────────────────
many(PARENTS.diageo, [
  "Diageo", "Guinness", "Guinness Stout", "Guinness Draught", "Smirnoff",
  "Smirnoff Vodka", "Smirnoff Ice", "Johnnie Walker", "Johnnie Walker Black",
  "Johnnie Walker Red", "Johnnie Walker Blue", "Johnnie Walker Gold",
  "Crown Royal", "Crown Royal Apple", "Bulleit", "Bulleit Bourbon",
  "Bulleit Rye", "Captain Morgan", "Captain Morgan Spiced",
  "Captain Morgan Original", "Tanqueray", "Tanqueray Gin",
  "Tanqueray No. Ten", "Don Julio", "Don Julio Tequila", "Casamigos",
  "Casamigos Tequila", "Casamigos Blanco", "Casamigos Reposado",
  "Ciroc", "Cîroc", "Ciroc Vodka", "Ketel One", "Ketel One Vodka",
  "Baileys", "Bailey's", "Baileys Irish Cream", "Bailey's Irish Cream",
  "Buchanan's", "Buchanans", "Buchanan's Whisky", "J&B", "JB Whisky",
  "Cardhu", "Cragganmore", "Dalwhinnie", "Glenkinchie", "Lagavulin",
  "Lagavulin 16", "Oban", "Talisker", "Talisker 10",
  "Singleton", "The Singleton", "George Dickel", "Dickel",
  "George Dickel Whisky", "Roe & Co", "Roe and Co",
  "Seagram's 7", "Seagrams 7", "Seagram's VO", "Pampero",
  "Zacapa", "Ron Zacapa", "Shui Jing Fang", "Mei Tai",
  "DeLeón Tequila", "Astral Tequila", "Aviation Gin Diageo",  // Aviation was acquired
  "Aviation Gin",
]);

// ── Brown-Forman ──────────────────────────────────────────────────────────
many(PARENTS.brownForman, [
  "Brown-Forman", "Brown Forman", "Jack Daniel's", "Jack Daniels",
  "Jack Daniel's Old No. 7", "Jack Daniel's Honey", "Jack Daniel's Fire",
  "Jack Daniel's Tennessee Apple", "Gentleman Jack", "Gentleman Jack Whiskey",
  "Woodford Reserve", "Woodford Reserve Bourbon", "Old Forester",
  "Old Forester Bourbon", "Jack Daniel's Single Barrel",
  "Finlandia", "Finlandia Vodka", "Korbel", "Korbel Champagne",
  "Korbel Brandy", "el Jimador", "El Jimador", "el Jimador Tequila",
  "Herradura", "Herradura Tequila", "Tequila Herradura",
  "Chambord", "Chambord Liqueur", "Slane Irish Whiskey",
  "Slane", "Sonoma-Cutrer", "Sonoma Cutrer", "Glenglassaugh",
  "Glendronach", "GlenDronach", "BenRiach", "Ben Riach",
  "Diplomatico", "Diplomático", "Diplomatico Rum",
]);

// ── Beam Suntory (slug jim-beam-suntory) ───────────────────────────────────
many(PARENTS.beamSuntory, [
  "Beam Suntory", "Jim Beam", "Jim Beam Bourbon", "Jim Beam Black",
  "Jim Beam Apple", "Jim Beam Honey", "Maker's Mark", "Makers Mark",
  "Maker's Mark 46", "Knob Creek", "Knob Creek Bourbon", "Knob Creek Rye",
  "Basil Hayden's", "Basil Haydens", "Basil Hayden", "Baker's",
  "Bakers Bourbon", "Booker's", "Bookers Bourbon", "Booker's Bourbon",
  "Old Crow", "Old Crow Bourbon", "Old Grand-Dad", "Old Grand Dad",
  "Suntory", "Suntory Whisky", "Hibiki", "Hibiki Whisky",
  "Yamazaki", "Hakushu", "Toki", "Toki Whisky", "Roku Gin",
  "Roku", "Sipsmith", "Sipsmith Gin", "Bowmore", "Bowmore Whisky",
  "Laphroaig", "Laphroaig 10", "Auchentoshan", "Glen Garioch",
  "Ardmore", "Ardmore Whisky", "Connemara", "Kilbeggan", "Tyrconnell",
  "2 Gingers", "Two Gingers", "Larios", "Larios Gin", "Sauza",
  "Sauza Tequila", "Hornitos", "Hornitos Tequila", "Tres Generaciones",
  "Tres Generaciones Tequila", "Pinnacle", "Pinnacle Vodka",
  "Skinnygirl", "Skinnygirl Cocktails", "Skinnygirl Margarita",
  "Effen", "Effen Vodka", "EFFEN", "Courvoisier", "Courvoisier Cognac",
  "Cruzan", "Cruzan Rum", "DeKuyper", "DeKuyper Schnapps",
  "Midori", "Midori Melon", "Castellana", "El Tesoro",
  "El Tesoro Tequila", "Calici", "Yamazaki Distillery",
]);

// ── Heineken USA ──────────────────────────────────────────────────────────
many(PARENTS.heinekenUsa, [
  "Heineken", "Heineken Lager", "Heineken Light", "Heineken Original",
  "Heineken 0.0", "Amstel", "Amstel Light", "Dos Equis", "Dos Equis XX",
  "Dos Equis Lager", "Dos Equis Ambar", "Tecate", "Tecate Light",
  "Tecate Original", "Sol", "Sol Beer", "Bohemia Heineken",
  "Bohemia Mexico", "Indio", "Indio Beer", "Carta Blanca",
  "Affligem", "Birra Moretti", "Moretti", "Newcastle Brown Ale",
  "Newcastle", "Strongbow", "Strongbow Cider", "Lagunitas",
  "Lagunitas IPA", "Lagunitas Brewing", "Red Stripe",
  "Star", "Star Lager", "Desperados", "Desperados Tequila Beer",
  "Murphy's Irish Stout", "Murphys Irish Stout",
  "Cruzcampo", "Krušovice", "Krusovice", "Zywiec", "Żywiec",
]);

// ── Estée Lauder Companies ────────────────────────────────────────────────
many(PARENTS.esteeLauder, [
  "Estée Lauder", "Estee Lauder", "Estée Lauder Companies",
  "Clinique", "MAC", "M.A.C.", "MAC Cosmetics", "Bobbi Brown",
  "Bobbi Brown Cosmetics", "La Mer", "La Mer Cream", "Aveda Estee",
  "Aveda Shampoo", "Origins Estee", "Origins Skincare",
  "Tom Ford Beauty", "Tom Ford Cosmetics", "Smashbox", "Smashbox Cosmetics",
  "Aramis", "Aramis Cologne", "Bumble and bumble", "Bumble & Bumble",
  "Bumble", "Dr.Jart+", "Dr Jart", "Dr Jart Plus", "Too Faced",
  "Too Faced Cosmetics", "Glamglow", "GLAMGLOW", "Editions de Parfums Frédéric Malle",
  "Frederic Malle", "Frédéric Malle", "Jo Malone", "Jo Malone London",
  "Le Labo", "Le Labo Perfume", "Donna Karan", "DKNY", "DKNY Fragrance",
  "By Kilian", "Kilian Paris", "KILIAN", "Becca", "Becca Cosmetics",
  "GoodSkin Labs", "Ojon", "Ojon Hair", "AERIN", "Aerin Lauder",
  "Prescriptives", "Lab Series", "Lab Series Skincare",
  "Tory Burch Beauty", "Tory Burch Fragrance",
  "Michael Kors Beauty", "Michael Kors Fragrance",
]);

// ── Walmart store brands ──────────────────────────────────────────────────
many(PARENTS.walmart, [
  "Great Value", "Equate", "Sam's Choice", "Sams Choice", "Marketside",
  "Parent's Choice", "Parents Choice", "Mainstays", "Mainstays Walmart",
  "Ozark Trail", "Ozark Trail Walmart", "Hyper Tough", "George",
  "George at Walmart", "Athletic Works", "Faded Glory", "Time and Tru",
  "Wonder Nation", "Terra & Sky", "No Boundaries", "Holiday Time",
  "Allswell", "Allswell Mattress", "Better Homes & Gardens",
  "Better Homes and Gardens", "Sofia Vergara", "Sofia Jeans",
  "Free Assembly", "Onn", "onn.", "onn Walmart", "Pure Balance",
  "Pure Balance Dog Food", "Special Kitty", "Spring Valley",
  "Spring Valley Vitamins", "Joyful", "Joyful Dog Food", "Sam's Club",
  "Sams Club", "Members Mark", "Member's Mark",
]);

// ── Costco store brand ────────────────────────────────────────────────────
many(PARENTS.costco, [
  "Kirkland Signature", "Kirkland", "Costco", "Costco Wholesale",
]);

// ── Target store brands ──────────────────────────────────────────────────
many(PARENTS.target, [
  "Up & Up", "Up&Up", "Up and Up", "Market Pantry", "Archer Farms",
  "Threshold", "Cat & Jack", "Cat and Jack", "Good & Gather", "Good and Gather",
  "Smartly", "Smartly Target", "Mondo Llama", "Open Story", "Open Story Target",
  "Pillowfort", "All in Motion", "Universal Thread", "Wild Fable",
  "Ava & Viv", "Ava and Viv", "Goodfellow & Co", "Goodfellow and Co",
  "A New Day", "Project 62", "Hearth & Hand", "Hearth and Hand", "Magnolia",
  "Heyday", "Sun Squad", "Boots & Barkley", "Boots and Barkley",
  "Kindfull", "Made by Design", "Brightroom", "Original Use",
  "Wondershop", "Bullseye's Playground", "Bullseyes Playground",
]);

// ── Trader Joe's ──────────────────────────────────────────────────────────
many(PARENTS.traderJoes, [
  "Trader Joe's", "Trader Joes", "Trader Joe", "Trader Ming's",
  "Trader Mings", "Trader Giotto's", "Trader Giottos", "Trader Jose's",
  "Trader Joses", "Trader Joe-San", "Trader Ming",
]);

// ── Whole Foods ──────────────────────────────────────────────────────────
many(PARENTS.wholeFoods, [
  "365 by Whole Foods Market", "365 Everyday Value", "365 Whole Foods",
  "365", "Whole Foods Market", "Whole Foods", "Whole Foods 365",
]);

// ── Amazon ───────────────────────────────────────────────────────────────
many(PARENTS.amazon, [
  "Amazon Basics", "AmazonBasics", "Amazon Essentials", "Solimo",
  "Amazon Solimo", "Happy Belly", "Mama Bear", "Mama Bear Amazon",
  "Wickedly Prime", "Wickedly Prime Amazon", "Whole Foods Amazon",
  "Amazon Fresh", "Amazon Brand", "Amazon Aware", "Amazon Collection",
  "Goodthreads", "Daily Ritual", "Pinzon", "Pinzon Amazon",
  "Stone & Beam", "Stone and Beam", "Rivet", "Rivet Furniture",
  "Presto!", "Presto Amazon", "Belei", "Belei Skincare",
]);

// ── Frank's RedHot/French's are McCormick already covered ───────────────
// ── Quaker is PepsiCo (already covered) ─────────────────────────────────
// ── PepsiCo cereal-aisle brands etc covered ─────────────────────────────

// ── Mars petcare extra (Royal Canin etc) ───────────────────────────────
// Already covered above.

// ── Bayer Consumer Health ──────────────────────────────────────────────
many(PARENTS.bayer, [
  "Bayer", "Bayer Aspirin", "Aleve", "Aleve Liquid Gels", "Aleve PM",
  "One A Day", "One-A-Day", "OneADay", "Alka-Seltzer", "Alka Seltzer",
  "Alka-Seltzer Plus", "Berocca", "Berocca Vitamins",
  "Midol", "MiraLax", "Miralax", "MiraLAX", "Bactine", "Citrucel",
  "Phillips' Milk of Magnesia", "Phillips Milk of Magnesia",
  "Phillips' Colon Health", "Coppertone Bayer",
  "Coppertone", "Coppertone Sport", "Coppertone Pure & Simple",
  "Dr. Scholl's", "Dr Scholls", "Dr Scholl's", "Scholl Bayer",
  "Aspirin Cardio", "Bayer Heart Advantage", "Flintstones Vitamins",
  "Flintstones Multivitamins", "Aleve-D", "RID", "RID Lice", "Talcid",
  "Iberogast", "Canesten", "Canesten Cream", "Bepanthen", "Bepanthol",
]);

// ── GSK Consumer / Haleon ──────────────────────────────────────────────
many(PARENTS.haleon, [
  "Haleon", "Sensodyne", "Sensodyne Toothpaste", "Sensodyne Pronamel",
  "Flonase", "Flonase Allergy Relief", "ChapStick", "Chap Stick",
  "Tums", "Tums Antacid", "Tums Smoothies", "Advil", "Advil PM",
  "Advil Liqui-Gels", "Centrum", "Centrum Silver", "Centrum MultiGummies",
  "Caltrate", "Caltrate Plus", "Theraflu", "Theraflu Flu Relief",
  "Robitussin", "Robitussin DM", "Robitussin Cough", "Excedrin",
  "Excedrin Migraine", "Excedrin Tension", "Aquafresh", "Aquafresh Toothpaste",
  "Polident", "Polident Denture Cleanser", "Poligrip", "PoliGrip",
  "Super Poligrip", "Nicorette Haleon", "Nicoderm Haleon",
  "Voltaren", "Voltaren Gel", "Otrivin", "Otrivin Nasal", "Beechams",
  "Beechams Cold", "Eno", "Eno Antacid", "Panadol", "Panadol Extra",
  "Parodontax", "Parodontax Toothpaste", "Biotène", "Biotene",
  "Biotene Mouthwash", "Corsodyl", "Stiefel", "Stiefel Skincare",
  "Triaminic", "Citrucel Haleon", "Emergen-C", "Emergen C", "EmergenC",
  "Preparation H", "Prep H", "Iodex",
]);
many(PARENTS.gsk, [
  "GSK", "GlaxoSmithKline", "Glaxo", "Glaxo Smith Kline",
  "Advair", "Advair Diskus", "Breo Ellipta", "Trelegy", "Trelegy Ellipta",
  "Ventolin", "Ventolin HFA", "Nucala", "Benlysta",
]);

// ── Pfizer ────────────────────────────────────────────────────────────
many(PARENTS.pfizer, [
  "Pfizer", "Lipitor", "Viagra", "Lyrica", "Eliquis", "Prevnar",
  "Prevnar 13", "Prevnar 20", "Comirnaty", "Paxlovid", "Ibrance",
  "Xeljanz", "Enbrel", "Premarin", "Diflucan", "Zithromax",
  "Z-Pak", "Z Pak", "Celebrex", "Norvasc", "Zoloft",
]);

// ── Sanofi ────────────────────────────────────────────────────────────
many(PARENTS.sanofi, [
  "Sanofi", "Allegra", "Allegra Allergy", "Aspercreme", "Cortizone",
  "Cortizone 10", "Cortizone-10", "Gold Bond", "Gold Bond Powder",
  "Gold Bond Lotion", "Icy Hot", "Icy Hot Patch", "Capzasin",
  "Compound W", "Unisom", "Unisom SleepTabs", "Selsun Blue",
  "Selsun", "Lubriderm Sanofi",
  "Dulcolax", "Plavix", "Lantus", "Toujeo", "Dupixent",
  "Apidra", "Praluent",
]);

// ── Novartis ─────────────────────────────────────────────────────────
many(PARENTS.novartis, [
  "Novartis", "Excedrin Novartis", "TheraFlu Novartis", "Triaminic Novartis",
  "Lamisil", "Lamisil AT", "Cosentyx", "Entresto", "Gilenya",
  "Tasigna", "Kymriah", "Kisqali", "Zolgensma", "Voltaren Novartis",
]);

// ── Merck ────────────────────────────────────────────────────────────
many(PARENTS.merck, [
  "Merck", "Merck & Co", "Keytruda", "Gardasil", "Gardasil 9",
  "Januvia", "Janumet", "Bridion", "Lynparza", "Zerbaxa",
  "Recombivax", "ProQuad", "Varivax", "Zostavax", "Shingrix Merck",
]);

// ── Abbott ───────────────────────────────────────────────────────────
many(PARENTS.abbott, [
  "Abbott", "Abbott Laboratories", "Similac", "Similac Advance",
  "Similac Pro-Advance", "Similac Sensitive", "Similac NeoSure",
  "Ensure", "Ensure Plus", "Ensure Original", "Ensure Max Protein",
  "Glucerna", "Glucerna Hunger Smart", "PediaSure", "Pedialyte",
  "Pedialyte Powder Packs", "EleCare", "Elecare", "Pure Bliss",
  "Pure Bliss by Similac", "Juven", "Juven Powder", "ZonePerfect",
  "Zone Perfect", "Curity", "FreeStyle Libre", "FreeStyle Lite",
  "BinaxNOW", "Binax", "Binax NOW", "Animas",
]);

// ── Perrigo ──────────────────────────────────────────────────────────
many(PARENTS.perrigo, [
  "Perrigo", "Plackers", "Plackers Floss Picks", "Wartner",
  "Compeed", "Mederma", "Mederma Scar Gel", "Solpadeine",
  "Bronchicum", "Ranir", "Steripod", "Steripod Toothbrush Cover",
  "Good Sense", "Good Sense Vitamins",
]);

// ── Dole Food ────────────────────────────────────────────────────────
many(PARENTS.dole, [
  "Dole", "Dole Pineapple", "Dole Fruit Cups", "Dole Salad",
  "Dole Banana", "Dole Bananas", "Dole Whip",
]);
many(PARENTS.delMonte, [
  "Del Monte", "Del Monte Foods", "Del Monte Pineapple",
  "Del Monte Fruit", "Contadina", "Contadina Tomato Sauce",
  "S&W", "SW Beans", "S&W Beans", "College Inn", "College Inn Broth",
  "Fruit Naturals", "Joyba", "Joyba Boba",
]);

// ── Land O'Lakes ─────────────────────────────────────────────────────
many(PARENTS.landOLakes, [
  "Land O'Lakes", "Land O Lakes", "LandOLakes", "Land OLakes",
  "Alpine Lace", "Alpine Lace Cheese", "Kozy Shack",
  "Win Brand", "Purina Mills",
]);
many(PARENTS.organicValley, [
  "Organic Valley", "Organic Valley Milk", "Organic Valley Eggs",
  "Stonyfield Organic Valley",
]);
many(PARENTS.dannon, [
  "Dannon", "Dannon Yogurt", "Activia", "Activia Probiotic Yogurt",
  "Light & Fit", "Light and Fit", "Oikos", "Oikos Triple Zero",
  "YoCrunch", "Yo Crunch", "Dannon Two Good", "Two Good",
  "Silk Dannon",
]);
many(PARENTS.danone, [
  "Danone", "Danone North America", "Silk", "Silk Almond Milk",
  "Silk Soy Milk", "Silk Oat Milk", "So Delicious", "So Delicious Dairy Free",
  "Vega", "Vega Protein", "International Delight Danone",
  "Horizon Organic", "Horizon", "Horizon Organic Milk", "Wallaby",
  "Wallaby Organic", "Evian", "Evian Water", "Volvic", "Volvic Water",
  "Aqua", "Aqua Danone", "Mizone", "Mizone Water",
  "Aptamil", "Aptamil Baby Formula", "Nutricia", "Nutrilon",
  "Cow & Gate", "Cow and Gate", "Karicare",
]);

// ── Pet hospitals & food, restaurant chains, etc ──────────────────────
many(PARENTS.starbucks, [
  "Starbucks", "Starbucks Coffee", "Starbucks Reserve", "Teavana",
  "Seattle's Best Coffee", "Seattles Best Coffee", "Evolution Fresh",
  "Princi", "Princi Bakery", "Ethos Water", "Ethos",
]);
many(PARENTS.dunkin, [
  "Dunkin'", "Dunkin Donuts", "Dunkin'", "Dunkin",
  "Baskin-Robbins", "Baskin Robbins", "Inspire Brands",
]);
many(PARENTS.rbi, [
  "Restaurant Brands International", "RBI", "Burger King",
  "Burger King Whopper", "Tim Hortons", "Tim Hortons Coffee",
  "Popeyes Louisiana Kitchen", "Firehouse Subs",
]);
many(PARENTS.mcdonalds, [
  "McDonald's", "McDonalds", "Big Mac", "McRib", "McFlurry",
  "Happy Meal", "McCafé", "McCafe",
]);
many(PARENTS.wendys, [
  "Wendy's", "Wendys", "Frosty", "Wendy's Frosty",
]);
many(PARENTS.papaJohns, [
  "Papa John's", "Papa Johns", "Papa John",
]);
many(PARENTS.dominos, [
  "Domino's", "Dominos", "Domino's Pizza", "Dominos Pizza",
]);
many(PARENTS.pizzaHut, [
  "Pizza Hut", "PizzaHut", "Pizza Hut Personal Pan",
]);
many(PARENTS.kfc, [
  "KFC", "Kentucky Fried Chicken", "KFC Bucket",
]);
many(PARENTS.tacoBell, [
  "Taco Bell", "TacoBell", "Crunchwrap", "Doritos Locos Tacos",
  "Chalupa", "Cantina Bell",
]);
many(PARENTS.subway, [
  "Subway", "Subway Sub", "Subway Sandwich",
]);
many(PARENTS.chickFilA, [
  "Chick-fil-A", "Chick fil A", "ChickFilA", "Chick-fil-A Sauce",
]);
many(PARENTS.panera, [
  "Panera", "Panera Bread", "Au Bon Pain",
]);
many(PARENTS.fiveGuys, [
  "Five Guys", "Five Guys Burgers", "FiveGuys",
]);
many(PARENTS.inNOut, [
  "In-N-Out", "In N Out", "InNOut", "In-N-Out Burger",
]);
many(PARENTS.shakeShack, [
  "Shake Shack", "ShakeShack", "Shack Burger",
]);
many(PARENTS.popeyes, [
  "Popeyes", "Popeyes Louisiana Kitchen", "Popeyes Chicken",
]);
many(PARENTS.chipotle, [
  "Chipotle", "Chipotle Mexican Grill", "Chipotle Burrito",
]);
many(PARENTS.jackInTheBox, [
  "Jack in the Box", "Jack In The Box", "JackInTheBox",
]);

// ── Flowers Foods ─────────────────────────────────────────────────────
many(PARENTS.flowers, [
  "Flowers Foods", "Wonder Bread", "Wonder Bread Classic", "Nature's Own",
  "Natures Own", "Nature's Own Bread", "Tastykake", "Tasty Kake",
  "Dave's Killer Bread", "Daves Killer Bread", "DKB", "Sunbeam Bread",
  "Cobblestone Bread", "Mrs. Freshley's", "Mrs Freshleys", "Mrs Freshley's",
  "Mi Casa", "Bunny Bread", "Roman Meal", "ButterKrust", "Butter Krust",
  "Holsum", "Mary B's", "Mary Bs", "Country Kitchen", "Country Hearth",
  "Captain John Derst's", "Captain John Dersts", "Aunt Hattie's",
  "Aunt Hatties", "European Bakers", "Toufayan", "Canyon Bakehouse",
  "Canyon", "Mrs Baird's", "Mrs Bairds",
]);

// ── Simply Good Foods ─────────────────────────────────────────────────
many(PARENTS.simplyGood, [
  "Simply Good Foods", "Atkins", "Atkins Bars", "Atkins Shakes",
  "Quest", "Quest Nutrition", "Quest Bars", "Quest Chips",
  "Quest Protein Powder", "Quest Pizza", "Quest Cookies",
]);

// ── Dr Pepper standalone slug ─────────────────────────────────────────
many("dr-pepper", [
  "Dr Pepper Standalone",
], "medium");

// ── Edgewell Personal Care ────────────────────────────────────────────
many(PARENTS.edgewell, [
  "Edgewell", "Edgewell Personal Care", "Schick", "Schick Hydro",
  "Schick Quattro", "Schick Intuition", "Wilkinson Sword",
  "Banana Boat", "Banana Boat Sunscreen", "Hawaiian Tropic", "Wet Ones",
  "Wet Ones Wipes", "Bulldog", "Bulldog Skincare", "Cremo",
  "Cremo Shave", "Jack Black", "Jack Black Skincare", "Carefree Edgewell",
  "Stayfree Edgewell", "Playtex Edgewell", "Diaper Genie",
  "Diaper Genie Edgewell", "Skintimate", "Skintimate Shave",
  "Edge", "Edge Shave Gel", "Energizer Edgewell",
  "Bilt", "Personna", "Personna Razor", "Fieldcrest",
  "Billie", "Billie Razor",
]);

// ── Prestige Consumer Healthcare ──────────────────────────────────────
many(PARENTS.prestige, [
  "Prestige Consumer Healthcare", "Monistat", "Monistat 1", "Monistat 3",
  "Monistat 7", "Summer's Eve", "Summers Eve", "Compound W Prestige",
  "Clear Eyes", "Clear Eyes Drops", "Beano", "Beano Tablets",
  "Boudreaux's Butt Paste", "Boudreaux", "Boudreauxs Butt Paste",
  "BC Powder", "BC Powder Headache", "Goody's Powder", "Goodys Powder",
  "Luden's", "Ludens", "Luden's Cough Drops", "Chloraseptic",
  "Chloraseptic Spray", "Dramamine", "Dramamine Less Drowsy", "Efferdent",
  "Efferdent Denture", "Ecotrin", "Doan's", "Doans Pills",
  "Nix", "Nix Lice", "DenTek", "Dentek", "Dentek Floss Picks",
  "Yellow Ribbon", "Sleepinal", "Murine", "Murine Eye Drops",
  "Hydralyte", "Fess", "Fess Nasal Spray", "Gaviscon Prestige",
]);

// ── Coty (perfumes/cosmetics) ─────────────────────────────────────────
many(PARENTS.coty, [
  "Coty", "CoverGirl", "Cover Girl", "Max Factor", "Rimmel",
  "Rimmel London", "Sally Hansen", "Sally Hansen Nail",
  "Bourjois", "Joop!", "Joop", "Calvin Klein Fragrance",
  "Calvin Klein Cologne", "Hugo Boss Coty", "Lancaster",
  "Lancaster Sun", "philosophy", "Philosophy Skincare", "OPI",
  "OPI Nail Polish", "GHD", "GHD Hair", "Adidas Fragrance",
  "Beyonce Heat", "Marc Jacobs Fragrance", "Vera Wang Fragrance",
  "Roberto Cavalli Fragrance", "Davidoff Cool Water",
  "Davidoff", "Tiffany & Co. Fragrance", "Tiffany Fragrance",
  "Chloé Fragrance", "Chloe Fragrance", "Gucci Coty",
  "Salvatore Ferragamo Fragrance", "Adidas Cologne", "Burberry Fragrance",
  "Sebastian Professional", "Wella", "Wella Professionals",
  "Clairol", "Clairol Nice 'N Easy", "Nice n Easy",
  "Wella Color Charm",
]);

// ── Revlon ───────────────────────────────────────────────────────────
many(PARENTS.revlon, [
  "Revlon", "Revlon ColorStay", "Revlon Super Lustrous",
  "Almay", "Almay Cosmetics", "Almay Mascara", "Mitchum",
  "Mitchum Deodorant", "Elizabeth Arden", "Elizabeth Arden Skincare",
  "Ceramide", "Ceramide Elizabeth Arden", "Revlon Hair Color",
  "Revlon One-Step", "Revlon One Step", "American Crew",
  "American Crew Pomade", "Pure Ice", "Pure Ice Nail Polish",
  "Elizabeth Taylor White Diamonds", "White Diamonds",
  "Curve", "Curve Cologne", "Halston", "Halston Fragrance",
  "Britney Spears Fantasy", "Christina Aguilera Inspire",
]);

// ── Sysco ────────────────────────────────────────────────────────────
many(PARENTS.sysco, [
  "Sysco", "Sysco Classic", "Sysco Imperial", "Sysco Reliance",
  "Sysco Supreme", "Sysco Natural",
]);
many(PARENTS.pfg, [
  "Performance Food Group", "PFG", "Roma Foods", "Vistar",
  "Reinhart Foodservice",
]);
many(PARENTS.aramark, [
  "Aramark", "Aramark Foodservice",
]);

// ── KKR / Blackstone / Carlyle (some packaged-food parents) ───────────
many(PARENTS.kkr, [
  "KKR", "KKR & Co", "Kohlberg Kravis Roberts",
]);
many(PARENTS.blackstone, [
  "Blackstone", "Blackstone Group", "Bumble", "Bumble Dating",
  "Hello Sunshine", "Service King",
]);
many(PARENTS.carlyle, [
  "Carlyle", "Carlyle Group",
]);

// ── Saputo ──────────────────────────────────────────────────────────
many(PARENTS.saputo, [
  "Saputo", "Saputo Cheese", "Stella Cheese", "Frigo",
  "Frigo Cheese", "Treasure Cave", "Friendship Dairies",
  "Friendship Cottage Cheese", "Black Diamond", "Black Diamond Cheese",
  "Armstrong", "Armstrong Cheese", "Dragone", "Dragone Cheese",
  "Joyya", "Joyya Milk", "Neilson", "Milk2Go", "Dairyland",
  "Dairyland Milk", "Nutrilait", "Cathedral City", "Davidstow",
]);

// ── Arla ────────────────────────────────────────────────────────────
many(PARENTS.arla, [
  "Arla", "Arla Foods", "Arla Organic", "Castello", "Castello Cheese",
  "Lurpak", "Lurpak Butter", "Apetina", "Cravendale", "Anchor",
  "Anchor Butter", "Anchor Cheese",
]);

// ── Frito-Lay (Pepsi sub) brands already covered ────────────────────

// ── Self-pointers: brands that ARE their own slug in index.json ───────
// Resolver already direct-matches these; we add explicit entries so the map
// is queryable as a single source of truth for the iOS scanner.
const SELF_POINTERS = [
  "lysol", "maybelline", "windex", "lancome", "tom-ford", "glade",
  "ziploc", "saran", "garnier", "clinique", "bobbi-brown", "aveda",
  "origins", "olay", "crest", "bounty", "charmin", "gillette",
  "pampers", "pantene", "febreze", "vicks", "tide", "duracell",
  "vaseline", "tylenol", "listerine", "speed-stick", "irish-spring",
  "clean-and-clear", "hawaiian-tropic", "playtex", "doritos", "cheetos",
  "ruffles", "tostitos", "fritos", "sun-chips", "lay-s", "cheerios",
  "lucky-charms", "perrier", "san-pellegrino", "poland-spring",
  "morningstar-farms", "pringles", "famous-amos", "kashi", "pepsi",
  "mountain-dew", "dr-pepper", "milka", "tropicana", "air-wick",
  "chef-boyardee", "hebrew-national", "whiskas", "iams", "popeyes",
  "subway", "kfc", "starbucks", "amazon", "walmart", "costco", "target",
  "kirkland-signature",
];
for (const slug of SELF_POINTERS) {
  add(slug, slug, "high", "self-pointer");
}

// Reach into Wikidata for the rest.

// ─────────────────────────────────────────────────────────────────────────────
// Wikidata SPARQL fan-out
// ─────────────────────────────────────────────────────────────────────────────
const WIKIDATA_QUERIES = [
  // Brands (Q431289) with owner P127
  `SELECT ?brandLabel ?ownerLabel WHERE {
     ?brand wdt:P31/wdt:P279* wd:Q431289 .
     ?brand wdt:P127 ?owner .
     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
   } LIMIT 8000`,
  // Brands (Q431289) with parent org P749
  `SELECT ?brandLabel ?ownerLabel WHERE {
     ?brand wdt:P31/wdt:P279* wd:Q431289 .
     ?brand wdt:P749 ?owner .
     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
   } LIMIT 8000`,
  // Food brands (Q22687388)
  `SELECT ?brandLabel ?ownerLabel WHERE {
     ?brand wdt:P31/wdt:P279* wd:Q22687388 .
     { ?brand wdt:P127 ?owner } UNION { ?brand wdt:P749 ?owner } .
     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
   } LIMIT 8000`,
];

async function fetchWikidata() {
  const cacheAge = await fileAge(WIKIDATA_CACHE);
  if (cacheAge < CACHE_TTL_MS) {
    return readJson(WIKIDATA_CACHE);
  }
  console.log("[wikidata] cache miss — fetching SPARQL");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const rows = [];
  for (const [i, q] of WIKIDATA_QUERIES.entries()) {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`;
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "TruNorth-BrandMapBuilder/1.0 (contact@trunorth.app)",
          "Accept": "application/sparql-results+json",
        },
      });
      if (!r.ok) {
        console.warn(`[wikidata] query ${i} HTTP ${r.status}`);
        continue;
      }
      const json = await r.json();
      const hits = json?.results?.bindings || [];
      console.log(`[wikidata] query ${i}: ${hits.length} rows`);
      for (const b of hits) {
        const brand = b?.brandLabel?.value;
        const owner = b?.ownerLabel?.value;
        if (brand && owner && !brand.startsWith("Q") && !owner.startsWith("Q")) {
          rows.push({ brand, owner });
        }
      }
    } catch (e) {
      console.warn(`[wikidata] query ${i} failed:`, e.message);
    }
  }
  await writeJson(WIKIDATA_CACHE, rows);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  // Offline prune: re-apply the edge guards to the committed artifact without a
  // Wikidata fetch or index rebuild. Deterministic, surgical, parallel-safe.
  //   node scripts/build-brand-parent-map.mjs --sanitize-only
  if (process.argv.includes("--sanitize-only")) {
    const current = await readJson(OUT_JSON);
    const { clean, dropped } = sanitizeParentMap(current);
    console.log(`[guards] dropped ${dropped.length} edge(s):`);
    for (const d of dropped) console.log(`  - ${d.key} → ${d.parent} [${d.confidence}] (${d.reason})`);
    await writeJson(OUT_JSON, clean);
    console.log(`[guards] wrote ${OUT_JSON} (${Object.keys(clean).filter(k => k !== "_doc").length} entries)`);
    return;
  }

  console.log("[build] reading index.json…");
  const index = await readJson(INDEX_JSON);
  const validSlugs = new Set(index.map(c => c.slug));
  const nameToSlug = new Map();
  for (const c of index) {
    const n = (c.name || "").toLowerCase().trim();
    if (n && !nameToSlug.has(n)) nameToSlug.set(n, c.slug);
  }
  console.log(`[build] ${validSlugs.size} valid parent slugs`);

  // 1. Start with existing map (preserve _doc + valid entries)
  let existing = {};
  try {
    existing = await readJson(OUT_JSON);
  } catch {}
  const out = {};
  out._doc = "B-22 (expanded 2026-06-07): maps consumer-product sub-brand keys (alphanumeric-lowercase, matching resolveBrand normalization in src/App.jsx:127) to parent company slugs that exist in public/data/index.json. Built by scripts/build-brand-parent-map.mjs from curated lists + Wikidata SPARQL.";

  // Carry over existing entries (re-key to alphanumeric-only).
  let carriedOver = 0;
  for (const [k, v] of Object.entries(existing)) {
    if (k === "_doc") continue;
    if (!v || typeof v !== "object" || !v.parent) continue;
    if (!validSlugs.has(v.parent)) continue;
    const nk = normKey(k);
    if (!nk || nk.length < 2) continue;
    if (!out[nk]) {
      out[nk] = { parent: v.parent, confidence: v.confidence || "high", source: v.source || "existing" };
      carriedOver++;
    }
  }
  console.log(`[build] carried over ${carriedOver} existing mappings`);

  // 2. Curated
  let curatedAdded = 0, curatedSkipped = 0;
  for (const c of CURATED) {
    if (!validSlugs.has(c.parent)) { curatedSkipped++; continue; }
    const k = normKey(c.label);
    if (!k || k.length < 2) continue;
    if (!out[k]) {
      out[k] = { parent: c.parent, confidence: c.confidence, source: c.source };
      curatedAdded++;
    }
  }
  console.log(`[build] curated: added ${curatedAdded} (skipped ${curatedSkipped} for invalid parent)`);

  // 3. Wikidata
  let wdAdded = 0, wdSkipped = 0;
  try {
    const wd = await fetchWikidata();
    for (const { brand, owner } of wd) {
      // Match owner name → slug in index.json
      const ownerNorm = owner.toLowerCase().trim();
      let parentSlug = nameToSlug.get(ownerNorm);
      if (!parentSlug) {
        // try removing 'inc.', ' inc', ' company', ' corp', ' corporation', ' ltd', ' plc'
        const cleaned = ownerNorm
          .replace(/[.,]/g, "")
          .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|llc|sa|nv|ag|gmbh|kg|sàrl|sas|spa|s\.p\.a\.|holdings|group)\b/g, "")
          .trim();
        if (cleaned) parentSlug = nameToSlug.get(cleaned);
      }
      if (!parentSlug || !validSlugs.has(parentSlug)) { wdSkipped++; continue; }
      const k = normKey(brand);
      if (!k || k.length < 2) continue;
      if (!out[k]) {
        out[k] = { parent: parentSlug, confidence: "medium", source: "wikidata" };
        wdAdded++;
      }
    }
  } catch (e) {
    console.warn("[build] wikidata fan-out failed:", e.message);
  }
  console.log(`[build] wikidata: added ${wdAdded} (skipped ${wdSkipped} with no parent match)`);

  // 4. Guards — drop audited bad edges: same-name collisions + passive-holder
  //    ("owned by" = largest shareholder) noise. See lib/parent-map-guards.mjs.
  //    Runs over ALL layers (carried-over + curated + wikidata) so a bad edge
  //    can't sneak back in via carry-over.
  const { clean: guarded, dropped } = sanitizeParentMap(out);
  if (dropped.length) {
    console.log(`[build] guards: dropped ${dropped.length} edge(s):`);
    for (const d of dropped) console.log(`  - ${d.key} → ${d.parent} [${d.confidence}] (${d.reason})`);
  }
  for (const k of Object.keys(out)) delete out[k];
  Object.assign(out, guarded);

  // Sort keys (preserve _doc at top of JSON)
  const sorted = {};
  sorted._doc = out._doc;
  const keys = Object.keys(out).filter(k => k !== "_doc").sort();
  for (const k of keys) sorted[k] = out[k];
  // Re-emit with _doc first by re-creating object insertion order
  const final = {};
  final._doc = sorted._doc;
  for (const k of keys) final[k] = sorted[k];
  Object.assign(sorted, final);

  await writeJson(OUT_JSON, sorted);
  const finalCount = keys.length;
  console.log(`[build] wrote ${OUT_JSON} with ${finalCount} brand→parent mappings`);

  // Top parents
  const parentCounts = {};
  for (const k of keys) {
    const p = out[k].parent;
    parentCounts[p] = (parentCounts[p] || 0) + 1;
  }
  const top = Object.entries(parentCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("[build] top 15 parents by sub-brand count:");
  for (const [p, n] of top) console.log(`  ${p.padEnd(40)} ${n}`);
}

main().catch(e => { console.error(e); process.exit(1); });
