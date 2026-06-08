#!/usr/bin/env node
/**
 * scripts/build-upc-cache.mjs
 *
 * Build public/data/_meta/upc-to-slug.json — a static UPC → parent-slug
 * lookup that ships inside the IPA so the in-store barcode scanner can
 * resolve common products INSTANTLY without a network round-trip to
 * Open Food Facts. The current scanner (src/App.jsx → BarcodeScanner →
 * lookup()) hits https://world.openfoodfacts.org/api/v0/product/<code>.json
 * on every scan, which is unreliable on weak in-store cellular.
 *
 * Data sources (in order):
 *   1. Open Food Facts product search API (US-filtered)
 *        https://world.openfoodfacts.org/cgi/search.pl
 *      For each priority brand below we pull the top N products sorted by
 *      popularity_key. UPC = `code`, brand = `brands`, name = `product_name`.
 *   2. public/data/_meta/brand-parent-map.json — resolves the OFF brand
 *      string to a parent slug. Same normalization rule as
 *      resolveBrand() in src/App.jsx (lowercase, alphanumeric-only).
 *   3. public/data/index.json — only slugs present here are kept (no
 *      dead-end mappings).
 *
 * Cadence:
 *   Monthly via GitHub Actions (or local run). Aim for <500 KB JSON,
 *   3,000-5,000 entries. Re-running is idempotent — duplicate UPCs from
 *   different queries are deduped, preferring the first high-confidence hit.
 *
 * Hard rules:
 *   - Every UPC must come from a real OFF product (we never fabricate codes).
 *   - Every slug must exist in companies index.json.
 *   - Only high-confidence brand→parent mappings are kept.
 *   - UPCs must be 8 / 12 / 13 digit numeric strings.
 *
 * Output schema:
 *   { "<upc>": { slug: "<parent>", brand: "<OFF brand string>", name: "<product>" }, ... }
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_JSON = path.join(ROOT, "public/data/index.json");
const BRAND_MAP_JSON = path.join(ROOT, "public/data/_meta/brand-parent-map.json");
const OUT_JSON = path.join(ROOT, "public/data/_meta/upc-to-slug.json");
const CACHE_DIR = path.join(__dirname, "cache");
const OFF_CACHE = path.join(CACHE_DIR, "off-product-search.json");
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const USER_AGENT = "TruNorth-UPC-Cache-Builder/1.0 (https://trunorth.app; contact: aron@trunorth.app)";
const RATE_LIMIT_MS = 600; // ~1.6 req/sec; OFF policy is 100/min
const PAGE_SIZE = 50;       // per OFF search query
const MAX_PER_BRAND = 50;   // we won't keep more than this per query
const SOFT_BUDGET_KB = 480; // stop adding when JSON would exceed this

// ─────────────────────────────────────────────────────────────────────────────
// Priority brand queries.
// Each entry: { q: "search term sent to OFF", hint: "<normalized brand key
// fallback if OFF's `brands` field is empty or noisy>" }
// Keep the list compact — we lean on OFF popularity sort + dedupe.
// ─────────────────────────────────────────────────────────────────────────────
const QUERIES = [
  // ── Mondelez / Nabisco snacks ─────────────────────────────────────────────
  { q: "Oreo" }, { q: "Nabisco" }, { q: "Chips Ahoy" }, { q: "Ritz" },
  { q: "Triscuit" }, { q: "Wheat Thins" }, { q: "Honey Maid" }, { q: "BelVita" },
  { q: "Nutter Butter" }, { q: "Nilla Wafers" }, { q: "Teddy Grahams" },
  { q: "Toblerone" }, { q: "Cadbury" }, { q: "Trident" }, { q: "Sour Patch Kids" },
  { q: "Swedish Fish" }, { q: "Halls Cough Drops" }, { q: "Premium Saltines" },
  { q: "Tate's Bake Shop" }, { q: "Newtons" }, { q: "Easy Cheese" },

  // ── PepsiCo / Frito-Lay / Quaker ──────────────────────────────────────────
  { q: "Pepsi" }, { q: "Diet Pepsi" }, { q: "Mountain Dew" }, { q: "Mtn Dew" },
  { q: "Gatorade" }, { q: "Tropicana" }, { q: "Naked Juice" }, { q: "Aquafina" },
  { q: "Lay's" }, { q: "Lays" }, { q: "Doritos" }, { q: "Cheetos" },
  { q: "Tostitos" }, { q: "Fritos" }, { q: "Ruffles" }, { q: "Sun Chips" },
  { q: "Stacy's Pita Chips" }, { q: "Smartfood" }, { q: "Cracker Jack" },
  { q: "Rold Gold" }, { q: "Sabra Hummus" },
  { q: "Quaker Oats" }, { q: "Quaker" }, { q: "Cap'n Crunch" }, { q: "Life Cereal" },
  { q: "Rice-A-Roni" }, { q: "Pasta Roni" }, { q: "Aunt Jemima" },
  { q: "Pearl Milling Company" },

  // ── Coca-Cola ─────────────────────────────────────────────────────────────
  { q: "Coca-Cola" }, { q: "Coke" }, { q: "Diet Coke" }, { q: "Coke Zero" },
  { q: "Sprite" }, { q: "Fanta" }, { q: "Dasani" }, { q: "Smartwater" },
  { q: "Powerade" }, { q: "Minute Maid" }, { q: "Simply Orange" },
  { q: "Honest Tea" }, { q: "Vitaminwater" }, { q: "Fairlife" }, { q: "Topo Chico" },
  { q: "Costa Coffee" }, { q: "Gold Peak Tea" },

  // ── Kraft Heinz ───────────────────────────────────────────────────────────
  { q: "Kraft" }, { q: "Heinz" }, { q: "Oscar Mayer" }, { q: "Velveeta" },
  { q: "Philadelphia Cream Cheese" }, { q: "Kraft Mac" }, { q: "Kool-Aid" },
  { q: "Capri Sun" }, { q: "Jell-O" }, { q: "Maxwell House" },
  { q: "Planters" }, { q: "Lunchables" }, { q: "Ore-Ida" }, { q: "Smart Ones" },
  { q: "Classico" }, { q: "Bagel Bites" }, { q: "Grey Poupon" },
  { q: "A1 Steak Sauce" }, { q: "Lea Perrins" }, { q: "Country Time Lemonade" },
  { q: "Crystal Light" },

  // ── Unilever ──────────────────────────────────────────────────────────────
  { q: "Hellmann's" }, { q: "Hellmanns" }, { q: "Knorr" }, { q: "Lipton" },
  { q: "Best Foods" }, { q: "Ben & Jerry's" }, { q: "Breyers" },
  { q: "Magnum Ice Cream" }, { q: "Klondike" }, { q: "Talenti" },
  { q: "Popsicle" }, { q: "Country Crock" }, { q: "I Can't Believe It's Not Butter" },
  { q: "Dove" }, { q: "Axe" }, { q: "Degree Deodorant" },
  { q: "Suave" }, { q: "TRESemme" }, { q: "TRESemmé" }, { q: "Nexxus" },
  { q: "Vaseline" }, { q: "Pond's" }, { q: "St. Ives" }, { q: "Q-tips" },
  { q: "Sun Detergent" }, { q: "Hidden Valley Ranch" },

  // ── Procter & Gamble ──────────────────────────────────────────────────────
  { q: "Tide" }, { q: "Bounty" }, { q: "Charmin" }, { q: "Pampers" },
  { q: "Gain" }, { q: "Dawn" }, { q: "Cascade" }, { q: "Mr. Clean" },
  { q: "Febreze" }, { q: "Swiffer" }, { q: "Bounce" }, { q: "Downy" },
  { q: "Tide Pods" }, { q: "Ariel Detergent" },
  { q: "Crest" }, { q: "Oral-B" }, { q: "Pantene" }, { q: "Head & Shoulders" },
  { q: "Head and Shoulders" }, { q: "Olay" }, { q: "Old Spice" },
  { q: "Gillette" }, { q: "Venus Razor" }, { q: "Secret Deodorant" },
  { q: "Always Pads" }, { q: "Tampax" }, { q: "Vicks" },
  { q: "Pepto-Bismol" }, { q: "Metamucil" }, { q: "Prilosec" }, { q: "Puffs Tissues" },
  { q: "Luvs" }, { q: "Bounty Paper Towels" },

  // ── Colgate-Palmolive ─────────────────────────────────────────────────────
  { q: "Colgate" }, { q: "Palmolive" }, { q: "Speed Stick" }, { q: "Irish Spring" },
  { q: "Softsoap" }, { q: "Ajax" }, { q: "Fabuloso" }, { q: "Hill's Pet" },

  // ── Johnson & Johnson / Kenvue ────────────────────────────────────────────
  { q: "Johnson's Baby" }, { q: "Tylenol" }, { q: "Listerine" }, { q: "Neutrogena" },
  { q: "Aveeno" }, { q: "Band-Aid" }, { q: "Motrin" }, { q: "Zyrtec" },
  { q: "Benadryl" }, { q: "Sudafed" }, { q: "Visine" }, { q: "Imodium" },
  { q: "Lubriderm" }, { q: "Clean & Clear" },

  // ── General Mills ─────────────────────────────────────────────────────────
  { q: "Cheerios" }, { q: "Honey Nut Cheerios" }, { q: "Lucky Charms" },
  { q: "Trix" }, { q: "Cinnamon Toast Crunch" }, { q: "Cocoa Puffs" },
  { q: "Wheaties" }, { q: "Chex" }, { q: "Kix Cereal" }, { q: "Total Cereal" },
  { q: "Pillsbury" }, { q: "Betty Crocker" }, { q: "Bisquick" }, { q: "Hamburger Helper" },
  { q: "Old El Paso" }, { q: "Progresso" }, { q: "Yoplait" }, { q: "Nature Valley" },
  { q: "Fiber One" }, { q: "Annie's Homegrown" }, { q: "Häagen-Dazs" },
  { q: "Haagen-Dazs" }, { q: "Larabar" }, { q: "Cascadian Farm" }, { q: "Muir Glen" },

  // ── Kellogg's / Post / Quaker ─────────────────────────────────────────────
  { q: "Kellogg's" }, { q: "Kelloggs" }, { q: "Frosted Flakes" }, { q: "Special K" },
  { q: "Froot Loops" }, { q: "Rice Krispies" }, { q: "Corn Flakes" }, { q: "Raisin Bran" },
  { q: "Mini-Wheats" }, { q: "Apple Jacks" }, { q: "Pop-Tarts" }, { q: "Eggo" },
  { q: "Pringles" }, { q: "Cheez-It" }, { q: "Cheez It" }, { q: "Kashi" },
  { q: "Bear Naked" }, { q: "MorningStar Farms" }, { q: "Special K Bars" },
  { q: "Post Cereal" }, { q: "Honey Bunches of Oats" }, { q: "Grape-Nuts" },
  { q: "Pebbles Cereal" }, { q: "Fruity Pebbles" }, { q: "Cocoa Pebbles" },
  { q: "Great Grains" },

  // ── Hershey / Mars ───────────────────────────────────────────────────────
  { q: "Hershey's" }, { q: "Hersheys" }, { q: "Reese's" }, { q: "Reeses" },
  { q: "Kit Kat" }, { q: "KitKat" }, { q: "Twizzlers" }, { q: "Almond Joy" },
  { q: "Mounds" }, { q: "Jolly Rancher" }, { q: "Heath Bar" }, { q: "Whoppers" },
  { q: "York Peppermint" }, { q: "Mr. Goodbar" }, { q: "Skor" }, { q: "Take 5" },
  { q: "Ice Breakers" }, { q: "Brookside Chocolate" },
  { q: "Mars" }, { q: "Snickers" }, { q: "M&M's" }, { q: "M&Ms" }, { q: "Twix" },
  { q: "Milky Way" }, { q: "3 Musketeers" }, { q: "Skittles" }, { q: "Starburst" },
  { q: "Dove Chocolate" }, { q: "Combos" },

  // ── Bush's, Conagra, Campbell, Smucker ───────────────────────────────────
  { q: "Bush's Best" }, { q: "Bushs Best" }, { q: "Bush's Baked Beans" },
  { q: "Bush Brothers" },
  { q: "Conagra" }, { q: "Chef Boyardee" }, { q: "Marie Callender's" },
  { q: "Healthy Choice" }, { q: "Hunt's" }, { q: "Hunts" }, { q: "PAM Cooking Spray" },
  { q: "Slim Jim" }, { q: "Banquet" }, { q: "Reddi-wip" }, { q: "Birds Eye" },
  { q: "Vlasic" }, { q: "Duncan Hines" }, { q: "Orville Redenbacher's" },
  { q: "Act II Popcorn" }, { q: "Swiss Miss" }, { q: "Wesson Oil" },
  { q: "Campbell's" }, { q: "Campbells" }, { q: "Pepperidge Farm" }, { q: "Goldfish" },
  { q: "V8 Juice" }, { q: "Prego" }, { q: "Pace Salsa" }, { q: "Swanson Broth" },
  { q: "Smucker's" }, { q: "Smuckers" }, { q: "Jif" }, { q: "Folgers" },
  { q: "Dunkin' Coffee" }, { q: "Café Bustelo" }, { q: "Crisco" }, { q: "Uncrustables" },
  { q: "Milk-Bone" }, { q: "9Lives" }, { q: "Meow Mix" }, { q: "Kibbles 'n Bits" },
  { q: "Pup-Peroni" },

  // ── Nestlé / Purina ───────────────────────────────────────────────────────
  { q: "Nestle" }, { q: "Nestlé" }, { q: "Nescafe" }, { q: "Nesquik" },
  { q: "Coffee-Mate" }, { q: "Coffee Mate" }, { q: "Toll House" }, { q: "Stouffer's" },
  { q: "Lean Cuisine" }, { q: "DiGiorno" }, { q: "Hot Pockets" }, { q: "Lean Pockets" },
  { q: "Buitoni" }, { q: "Drumstick" }, { q: "Edy's" }, { q: "Dreyer's" },
  { q: "Outshine" }, { q: "Skinny Cow" }, { q: "Carnation" }, { q: "La Lechera" },
  { q: "Maggi" }, { q: "Cheerios Nestle" },
  { q: "Purina" }, { q: "Friskies" }, { q: "Fancy Feast" }, { q: "Beneful" },
  { q: "Pro Plan" }, { q: "Tidy Cats" }, { q: "Alpo" }, { q: "Beggin' Strips" },
  { q: "San Pellegrino" }, { q: "Perrier" }, { q: "Poland Spring" },
  { q: "Acqua Panna" }, { q: "Pure Life Water" },

  // ── Keurig Dr Pepper ──────────────────────────────────────────────────────
  { q: "Dr Pepper" }, { q: "Dr. Pepper" }, { q: "7UP" }, { q: "Canada Dry" },
  { q: "Snapple" }, { q: "A&W Root Beer" }, { q: "Sunkist" }, { q: "Crush Soda" },
  { q: "Mott's Apple Juice" }, { q: "Hawaiian Punch" }, { q: "Clamato" },
  { q: "Schweppes" }, { q: "Keurig" }, { q: "Green Mountain Coffee" },
  { q: "The Original Donut Shop Coffee" },

  // ── Clorox, Church & Dwight, Reckitt, S.C. Johnson ───────────────────────
  { q: "Clorox" }, { q: "Pine-Sol" }, { q: "Tilex" }, { q: "Glad Bags" },
  { q: "Hidden Valley" }, { q: "Brita" }, { q: "KC Masterpiece" }, { q: "Liquid-Plumr" },
  { q: "Burt's Bees" }, { q: "Kingsford" }, { q: "Fresh Step" }, { q: "S.O.S Pads" },
  { q: "Arm & Hammer" }, { q: "OxiClean" }, { q: "Trojan Condoms" }, { q: "Nair" },
  { q: "Orajel" }, { q: "Vitafusion" }, { q: "Waterpik" }, { q: "First Response" },
  { q: "Lysol" }, { q: "Air Wick" }, { q: "Finish Dishwasher" }, { q: "Woolite" },
  { q: "Easy-Off" }, { q: "Mucinex" }, { q: "Delsym" }, { q: "Clearasil" },
  { q: "Windex" }, { q: "Glade" }, { q: "Ziploc" }, { q: "Saran Wrap" },
  { q: "Pledge" }, { q: "Raid" }, { q: "Off! Repellent" }, { q: "Scrubbing Bubbles" },
  { q: "Shout Stain Remover" }, { q: "Drano" },

  // ── Tyson, Hormel, JBS, Pilgrim's ─────────────────────────────────────────
  { q: "Tyson" }, { q: "Jimmy Dean" }, { q: "Hillshire Farm" }, { q: "Ball Park" },
  { q: "State Fair" }, { q: "Sara Lee Meats" }, { q: "Wright Brand Bacon" },
  { q: "Hormel" }, { q: "Spam" }, { q: "Skippy Peanut Butter" }, { q: "Dinty Moore" },
  { q: "Compleats" }, { q: "Chi-Chi's" }, { q: "Lloyd's BBQ" }, { q: "Applegate" },
  { q: "Justin's Nut Butter" }, { q: "Mary Kitchen" }, { q: "Black Label Bacon" },

  // ── Kimberly-Clark ────────────────────────────────────────────────────────
  { q: "Kleenex" }, { q: "Huggies" }, { q: "Pull-Ups" }, { q: "Scott Tissue" },
  { q: "Cottonelle" }, { q: "Viva Paper Towels" }, { q: "Kotex" }, { q: "Depend" },
  { q: "Poise" },

  // ── Coffee, snacks, dairy, frozen ─────────────────────────────────────────
  { q: "Starbucks Coffee" }, { q: "Frappuccino" },
  { q: "Land O Lakes" }, { q: "Land O'Lakes" }, { q: "Tillamook" },
  { q: "Daisy Sour Cream" }, { q: "Chobani" }, { q: "Fage" }, { q: "Dannon" },
  { q: "Activia" }, { q: "International Delight" }, { q: "Silk Soy Milk" },
  { q: "Horizon Organic" }, { q: "Oikos" }, { q: "Two Good" },
  { q: "Dole" }, { q: "Del Monte" }, { q: "Mott's" },
  { q: "Eggo Waffles" }, { q: "Toaster Strudel" },
  { q: "Newman's Own" }, { q: "Annie's" }, { q: "Amy's Kitchen" },
  { q: "Talenti Gelato" }, { q: "Halo Top" },

  // ── Sauces / condiments ──────────────────────────────────────────────────
  { q: "French's Mustard" }, { q: "Frank's RedHot" }, { q: "Tabasco" },
  { q: "Sweet Baby Ray's" }, { q: "Stubb's BBQ" }, { q: "Ken's Dressing" },
  { q: "Wishbone Dressing" }, { q: "Marie's Dressing" }, { q: "Cholula Hot Sauce" },
  { q: "Sriracha Huy Fong" }, { q: "McCormick" }, { q: "Lawry's" },

  // ── Pet / household misc ─────────────────────────────────────────────────
  { q: "Pedigree" }, { q: "Iams" }, { q: "Eukanuba" }, { q: "Whiskas" },
  { q: "Greenies" }, { q: "Temptations Cat Treats" }, { q: "Sheba" },
  { q: "Cesar Dog Food" },

  // ── Snacks / candy / cookies tail ─────────────────────────────────────────
  { q: "Sour Patch" }, { q: "Welch's Fruit Snacks" }, { q: "Mott's Fruit Snacks" },
  { q: "Hi-Chew" }, { q: "Werther's Original" }, { q: "Ferrara" }, { q: "Brach's" },
  { q: "Lifesavers" }, { q: "Tic Tac" }, { q: "Mentos" }, { q: "Ferrero Rocher" },
  { q: "Nutella" }, { q: "Tootsie Roll" }, { q: "Tootsie Pop" }, { q: "Charms Blow Pop" },
  { q: "Dum Dums" }, { q: "Atomic Fireball" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function isValidUpc(code) {
  if (typeof code !== "string") return false;
  if (!/^\d+$/.test(code)) return false;
  const len = code.length;
  // OFF stores EAN-13s with leading zeros; allow 8, 12, 13, also accept 14
  // (case packs / GTIN-14) but normalize to last-13 before validation.
  return len === 8 || len === 12 || len === 13;
}

function normalizeUpc(code) {
  if (typeof code !== "string") return null;
  const t = code.trim();
  if (!/^\d+$/.test(t)) return null;
  // Strip 14-digit GTIN leading zero down to 13 if applicable.
  if (t.length === 14 && t[0] === "0") return t.slice(1);
  return t;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function fileAge(p) {
  try {
    const st = await fs.stat(p);
    return Date.now() - st.mtimeMs;
  } catch {
    return Infinity;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFF fetch — with on-disk cache so re-runs are fast and don't hammer the API.
// ─────────────────────────────────────────────────────────────────────────────

async function loadOffCache() {
  if ((await fileAge(OFF_CACHE)) > CACHE_TTL_MS) return {};
  try {
    return await readJson(OFF_CACHE);
  } catch {
    return {};
  }
}

async function saveOffCache(cache) {
  await ensureDir(CACHE_DIR);
  await writeJson(OFF_CACHE, cache);
}

async function offSearch(query) {
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("action", "process");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(PAGE_SIZE));
  url.searchParams.set("sort_by", "popularity_key");
  // US-only filter so we don't end up with EU/JP/AU SKUs that won't scan here.
  url.searchParams.set("tagtype_0", "countries");
  url.searchParams.set("tag_contains_0", "contains");
  url.searchParams.set("tag_0", "united-states");
  // Trim payload: only the fields we use.
  url.searchParams.set("fields", "code,brands,brand_owner,product_name,countries_tags,popularity_key");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OFF ${res.status} for ${query}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[upc-cache] loading index + brand-parent-map");
  const index = await readJson(INDEX_JSON);
  const slugSet = new Set(index.map(c => c.slug).filter(Boolean));
  const brandMap = await readJson(BRAND_MAP_JSON);
  // Only HIGH-confidence brand→parent mappings — we don't want the scanner
  // to silently misroute a product for a low-confidence wikidata guess.
  const brandToSlug = new Map();
  for (const [k, v] of Object.entries(brandMap)) {
    if (k === "_doc" || !v || typeof v !== "object") continue;
    if (v.confidence !== "high") continue;
    if (!v.parent || !slugSet.has(v.parent)) continue;
    brandToSlug.set(k, v.parent);
  }
  console.log(`[upc-cache] ${slugSet.size} slugs, ${brandToSlug.size} high-conf brand keys`);

  const offCache = await loadOffCache();
  const cacheHits = Object.keys(offCache).length;

  /** out: { upc: { slug, brand, name } } */
  const out = {};
  /** Track which queries fed which slug count for the PR body. */
  const slugCounts = new Map();
  const skippedNoSlug = new Set();
  const queriedAt = new Date().toISOString();

  let queryIdx = 0;
  for (const { q } of QUERIES) {
    queryIdx++;
    let payload = offCache[q];
    if (!payload) {
      try {
        console.log(`[upc-cache] (${queryIdx}/${QUERIES.length}) querying "${q}"`);
        payload = await offSearch(q);
        offCache[q] = { ts: Date.now(), count: payload.count, products: payload.products || [] };
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        console.warn(`[upc-cache] FAIL "${q}":`, err.message);
        await sleep(RATE_LIMIT_MS * 2);
        continue;
      }
    } else {
      console.log(`[upc-cache] (${queryIdx}/${QUERIES.length}) cache hit "${q}" (${payload.products?.length || 0} prods)`);
    }
    const products = payload.products || payload?.products || [];
    let kept = 0;
    for (const p of products) {
      if (kept >= MAX_PER_BRAND) break;
      const upc = normalizeUpc(p.code);
      if (!upc || !isValidUpc(upc)) continue;
      if (out[upc]) continue; // dedupe — first hit wins

      // Try each brand token; first that resolves to a known slug wins.
      const brandRaw = p.brands || p.brand_owner || "";
      const tokens = String(brandRaw).split(/[,|;\/]/).map(s => s.trim()).filter(Boolean);
      // Also try the query term itself as a fallback (e.g. OFF returned
      // brand=""). We normalize and look up the same way.
      tokens.push(q);
      let slug = null;
      let matchedBrand = null;
      for (const t of tokens) {
        const k = normKey(t);
        if (!k) continue;
        if (brandToSlug.has(k)) {
          slug = brandToSlug.get(k);
          matchedBrand = t;
          break;
        }
      }
      if (!slug) {
        skippedNoSlug.add(normKey(tokens[0] || q));
        continue;
      }
      const name = (p.product_name || "").trim().slice(0, 80) || matchedBrand;
      out[upc] = { slug, brand: matchedBrand || brandRaw, name };
      slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
      kept++;
    }
  }

  await saveOffCache(offCache);

  // ── Size budget: trim until pretty-printed output fits SOFT_BUDGET_KB. ──
  // The on-disk file is pretty-printed (2-space indent) so it's ~2x the
  // compact JSON size. We measure the actual pretty-printed bytes.
  // Strategy: cap entries-per-slug at a descending limit, so we keep broad
  // coverage across many parents instead of dropping all small ones first.
  const measure = () => Buffer.byteLength(JSON.stringify(out, null, 2), "utf8");
  let bytes = measure();
  if (bytes > SOFT_BUDGET_KB * 1024) {
    console.log(`[upc-cache] over budget (${(bytes / 1024).toFixed(1)} KB pretty) — capping per-slug entries`);
    // Pre-group UPCs by slug, preserving insertion order (= OFF popularity rank).
    const bySlug = new Map();
    for (const [upc, v] of Object.entries(out)) {
      if (!bySlug.has(v.slug)) bySlug.set(v.slug, []);
      bySlug.get(v.slug).push(upc);
    }
    // Step down the per-slug cap until we fit. Start generous so the cache
    // uses the available budget for broad coverage.
    for (let cap = 200; cap >= 5; cap -= 5) {
      const trimmed = {};
      const newCounts = new Map();
      for (const [slug, upcs] of bySlug) {
        for (const upc of upcs.slice(0, cap)) {
          trimmed[upc] = out[upc];
          newCounts.set(slug, (newCounts.get(slug) || 0) + 1);
        }
      }
      const newBytes = Buffer.byteLength(JSON.stringify(trimmed, null, 2), "utf8");
      if (newBytes <= SOFT_BUDGET_KB * 1024) {
        for (const k of Object.keys(out)) delete out[k];
        Object.assign(out, trimmed);
        slugCounts.clear();
        for (const [s, n] of newCounts) slugCounts.set(s, n);
        bytes = newBytes;
        console.log(`[upc-cache] capped at ${cap} per slug → ${Object.keys(out).length} UPCs, ${(bytes / 1024).toFixed(1)} KB`);
        break;
      }
    }
  }

  // ── Pretty-print with a leading _doc field so the file self-documents ──
  const docComment = `B-? UPC→slug static cache. Built ${queriedAt} by scripts/build-upc-cache.mjs from Open Food Facts US product search. Each value: { slug: parent in public/data/index.json, brand: OFF brand string at fetch time, name: OFF product_name }. The scanner (src/App.jsx BarcodeScanner.lookup) checks this BEFORE hitting the OFF API so common scans resolve offline. Rebuild monthly.`;
  const payload = { _doc: docComment, ...out };
  // Strip _doc from the size budget; final on-disk file includes it.
  await writeJson(OUT_JSON, payload);

  const finalCount = Object.keys(out).length;
  const finalKb = (Buffer.byteLength(JSON.stringify(payload, null, 2), "utf8") / 1024).toFixed(1);
  const topSlugs = [...slugCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  console.log(`\n[upc-cache] DONE — wrote ${finalCount} UPCs to ${path.relative(ROOT, OUT_JSON)} (${finalKb} KB)`);
  console.log(`[upc-cache] queries: ${QUERIES.length}, OFF cache hits at start: ${cacheHits}`);
  console.log(`[upc-cache] top parents:`);
  for (const [slug, n] of topSlugs) console.log(`  ${n.toString().padStart(4)}  ${slug}`);
  console.log(`[upc-cache] unresolved brand keys skipped: ${skippedNoSlug.size}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
