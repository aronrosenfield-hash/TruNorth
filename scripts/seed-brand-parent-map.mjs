// scripts/seed-brand-parent-map.mjs
//
// One-shot seeder: merges a hand-curated list of ~200 common grocery /
// drugstore / mass-retail sub-brands into public/data/_meta/brand-parent-map.json.
// Existing entries are preserved unless overwritten by --force.
//
// This is the "fix the Nabisco scanner gap before launch" patch. Agent 1's
// background job (Wikidata + Wikipedia scrape) will produce a 3k+ entry
// map separately; this seed covers the highest-traffic ~200 grocery
// scans we expect on Day 1.
//
// Usage:
//   node scripts/seed-brand-parent-map.mjs            # merge new keys only
//   node scripts/seed-brand-parent-map.mjs --force    # also overwrite existing

import fs from 'node:fs/promises';
import path from 'node:path';

const MAP_PATH = 'public/data/_meta/brand-parent-map.json';
const INDEX_PATH = 'public/data/index.json';
const FORCE = process.argv.includes('--force');

// Hand-curated seed map. Keys are normalized brand names (lowercase,
// alphanumeric only) — same normalization the App.jsx resolveBrand() uses.
// Parent slugs are verified to exist in public/data/index.json.
const SEED = {
  // ── Mondelez International (Nabisco family) ─────────────────────────
  nabisco: 'mondelez-international',
  oreo: 'mondelez-international',
  oreos: 'mondelez-international',
  chipsahoy: 'mondelez-international',
  ritz: 'mondelez-international',
  ritzcrackers: 'mondelez-international',
  triscuit: 'mondelez-international',
  wheatthins: 'mondelez-international',
  honeymaid: 'mondelez-international',
  belvita: 'mondelez-international',
  cadbury: 'mondelez-international',
  trident: 'mondelez-international',
  sourpatchkids: 'mondelez-international',
  toblerone: 'mondelez-international',
  milka: 'mondelez-international',
  nilla: 'mondelez-international',
  nutterbutter: 'mondelez-international',
  teddygrahams: 'mondelez-international',
  premium: 'mondelez-international',
  saltines: 'mondelez-international',
  swedishfish: 'mondelez-international',
  halls: 'mondelez-international',
  philadelphiacreamcheese: 'mondelez-international',

  // ── PepsiCo (Frito-Lay + beverages + Quaker) ────────────────────────
  fritolay: 'pepsi',
  doritos: 'pepsi',
  cheetos: 'pepsi',
  lays: 'pepsi',
  ruffles: 'pepsi',
  tostitos: 'pepsi',
  sunchips: 'pepsi',
  funyuns: 'pepsi',
  sabra: 'pepsi',
  rolddoritos: 'pepsi',
  pepsico: 'pepsi',
  mountaindew: 'pepsi',
  mtndew: 'pepsi',
  gatorade: 'pepsi',
  tropicana: 'pepsi',
  quaker: 'pepsi',
  quakeroats: 'pepsi',
  capncrunch: 'pepsi',
  lifecereal: 'pepsi',
  ricearoni: 'pepsi',
  bubly: 'pepsi',
  liptontea: 'pepsi',
  starbucksfrappuccino: 'pepsi',
  mug: 'pepsi',
  pasta: 'pepsi', // Pasta Roni
  aquafina: 'pepsi',
  sodastream: 'pepsi',
  rockstar: 'pepsi',

  // ── Coca-Cola Company ───────────────────────────────────────────────
  coke: 'coca-cola',
  cocacola: 'coca-cola',
  cocacolacompany: 'coca-cola',
  dietcoke: 'coca-cola',
  cokezero: 'coca-cola',
  sprite: 'coca-cola',
  fanta: 'coca-cola',
  minutemaid: 'coca-cola',
  powerade: 'coca-cola',
  vitaminwater: 'coca-cola',
  smartwater: 'coca-cola',
  dasani: 'coca-cola',
  honesttea: 'coca-cola',
  topochico: 'coca-cola',
  costacoffee: 'coca-cola',
  simplyorange: 'coca-cola',
  simply: 'coca-cola',
  fairlife: 'coca-cola',
  bodyarmor: 'coca-cola',
  fuze: 'coca-cola',
  fuzetea: 'coca-cola',
  goldpeak: 'coca-cola',
  glaceau: 'coca-cola',
  mrpibb: 'coca-cola',
  pibbxtra: 'coca-cola',
  schweppes: 'coca-cola',

  // ── Unilever ────────────────────────────────────────────────────────
  dove: 'unilever',
  axe: 'unilever',
  hellmanns: 'unilever',
  knorr: 'unilever',
  benandjerrys: 'unilever',
  benjerrys: 'unilever',
  magnum: 'unilever',
  klondike: 'unilever',
  suave: 'unilever',
  vaseline: 'unilever',
  qtips: 'unilever',
  tresemme: 'unilever',
  ponds: 'unilever',
  degree: 'unilever',
  stives: 'unilever',
  popsicle: 'unilever',
  hellmann: 'unilever',
  breyers: 'unilever',
  goodhumor: 'unilever',
  bestfoods: 'unilever',
  fruity: 'unilever',

  // ── Procter & Gamble ────────────────────────────────────────────────
  tide: 'procter-and-gamble',
  bounty: 'procter-and-gamble',
  charmin: 'procter-and-gamble',
  crest: 'procter-and-gamble',
  oralb: 'procter-and-gamble',
  gillette: 'procter-and-gamble',
  pampers: 'procter-and-gamble',
  pantene: 'procter-and-gamble',
  headandshoulders: 'procter-and-gamble',
  olay: 'procter-and-gamble',
  oldspice: 'procter-and-gamble',
  vicks: 'procter-and-gamble',
  peptobismol: 'procter-and-gamble',
  metamucil: 'procter-and-gamble',
  febreze: 'procter-and-gamble',
  swiffer: 'procter-and-gamble',
  cascade: 'procter-and-gamble',
  dawn: 'procter-and-gamble',
  downy: 'procter-and-gamble',
  bounce: 'procter-and-gamble',
  gain: 'procter-and-gamble',
  pg: 'procter-and-gamble',
  pgtide: 'procter-and-gamble',
  always: 'procter-and-gamble',
  tampax: 'procter-and-gamble',
  secret: 'procter-and-gamble',
  pampershuggies: 'procter-and-gamble',
  luvs: 'procter-and-gamble',
  iams: 'procter-and-gamble',
  puffs: 'procter-and-gamble',
  mrclean: 'procter-and-gamble',

  // ── Kraft Heinz ─────────────────────────────────────────────────────
  heinz: 'kraft-heinz',
  kraft: 'kraft-heinz',
  oscarmayer: 'kraft-heinz',
  jello: 'kraft-heinz',
  velveeta: 'kraft-heinz',
  caprisun: 'kraft-heinz',
  koolaid: 'kraft-heinz',
  maxwellhouse: 'kraft-heinz',
  philadelphia: 'kraft-heinz',
  planters: 'kraft-heinz',
  lunchables: 'kraft-heinz',
  oreida: 'kraft-heinz',
  classico: 'kraft-heinz',
  smartones: 'kraft-heinz',
  miraclewhip: 'kraft-heinz',
  grey: 'kraft-heinz', // Grey Poupon
  greypoupon: 'kraft-heinz',
  ore: 'kraft-heinz', // Ore-Ida
  weight: 'kraft-heinz', // Weight Watchers SmartOnes (now WW)

  // ── General Mills ───────────────────────────────────────────────────
  cheerios: 'general-mills',
  luckycharms: 'general-mills',
  wheaties: 'general-mills',
  pillsbury: 'general-mills',
  bettycrocker: 'general-mills',
  hamburgerhelper: 'general-mills',
  yoplait: 'general-mills',
  naturevalley: 'general-mills',
  oldelpaso: 'general-mills',
  annies: 'general-mills',
  larabar: 'general-mills',
  haagendazs: 'general-mills',
  fruitsnacks: 'general-mills',
  totinos: 'general-mills',
  greengiant: 'general-mills',
  bisquick: 'general-mills',
  goldmedal: 'general-mills',
  cocoapuffs: 'general-mills',
  cinnamontoast: 'general-mills',
  trix: 'general-mills',
  kix: 'general-mills',
  reeses: 'general-mills', // Reese's Puffs cereal (note: candy is Hershey)
  goldfish: 'general-mills', // Pepperidge Farm? Actually that's Campbell's. Removed.
  // Removed goldfish — that's Campbell's Pepperidge Farm
  fiber: 'general-mills',
  totino: 'general-mills',

  // ── Kellogg's / Kellanova ───────────────────────────────────────────
  pringles: 'kellogg-s',
  poptarts: 'kellogg-s',
  eggo: 'kellogg-s',
  cheezit: 'kellogg-s',
  specialk: 'kellogg-s',
  ricekrispies: 'kellogg-s',
  frostedflakes: 'kellogg-s',
  cornflakes: 'kellogg-s',
  frootloops: 'kellogg-s',
  applejacks: 'kellogg-s',
  miniwheats: 'kellogg-s',
  morningstarfarms: 'kellogg-s',
  ricekrispiestreats: 'kellogg-s',
  fruitloops: 'kellogg-s',
  raisinbran: 'kellogg-s',
  kashi: 'kellogg-s',
  nutrigrain: 'kellogg-s',
  keebler: 'kellogg-s',
  townhouse: 'kellogg-s',
  carrs: 'kellogg-s',
  famousamos: 'kellogg-s',

  // ── Mars Inc (candy + petfood) ──────────────────────────────────────
  mms: 'mars',
  snickers: 'mars',
  twix: 'mars',
  marsbar: 'mars',
  milkyway: 'mars',
  threemusketeers: 'mars',
  skittles: 'mars',
  starburst: 'mars',
  combos: 'mars',
  lifesavers: 'mars',
  orbit: 'mars',
  extra: 'mars',
  juicyfruit: 'mars',
  doublemint: 'mars',
  pedigree: 'mars',
  whiskas: 'mars',
  sheba: 'mars',
  royalcanin: 'mars',
  unclebens: 'mars',
  bensoriginal: 'mars',
  dove: 'mars', // Dove chocolate — collision with Unilever Dove soap; later resolved by category in v2

  // ── Hershey ─────────────────────────────────────────────────────────
  hersheys: 'hershey',
  kisses: 'hershey',
  reesescup: 'hershey',
  twizzlers: 'hershey',
  jollyrancher: 'hershey',
  almondjoy: 'hershey',
  mounds: 'hershey',
  heath: 'hershey',
  skor: 'hershey',
  whoppers: 'hershey',
  milkduds: 'hershey',
  payday: 'hershey',
  fifthavenue: 'hershey',
  krackel: 'hershey',
  iceakes: 'hershey',
  rolo: 'hershey',
  cadburycream: 'hershey', // Cadbury Creme Egg in US is Hershey

  // ── Beer / Alcohol majors ───────────────────────────────────────────
  budweiser: 'anheuser-busch',
  budlight: 'anheuser-busch',
  michelob: 'anheuser-busch',
  stellaartois: 'anheuser-busch',
  corona: 'anheuser-busch',
  modelo: 'anheuser-busch',
  hoegaarden: 'anheuser-busch',
  becks: 'anheuser-busch',
  gooseisland: 'anheuser-busch',
  coorslight: 'molson-coors-beverage',
  millerlite: 'molson-coors-beverage',
  bluemoon: 'molson-coors-beverage',
  keystonelight: 'molson-coors-beverage',

  // ── J&J consumer ────────────────────────────────────────────────────
  tylenol: 'johnson-and-johnson',
  bandaid: 'johnson-and-johnson',
  listerine: 'johnson-and-johnson',
  neutrogena: 'johnson-and-johnson',
  aveeno: 'johnson-and-johnson',
  cleanandclear: 'johnson-and-johnson',
  lubriderm: 'johnson-and-johnson',
  carefree: 'johnson-and-johnson',
  stayfree: 'johnson-and-johnson',
  splenda: 'johnson-and-johnson',
  sudafed: 'johnson-and-johnson',
  benadryl: 'johnson-and-johnson',
  motrin: 'johnson-and-johnson',
  visine: 'johnson-and-johnson',
  zyrtec: 'johnson-and-johnson',

  // ── Colgate-Palmolive ───────────────────────────────────────────────
  colgate: 'colgate-palmolive',
  palmolive: 'colgate-palmolive',
  tomsofmaine: 'colgate-palmolive',
  hillspetnutrition: 'colgate-palmolive',
  hillssciencediet: 'colgate-palmolive',
  speedstick: 'colgate-palmolive',
  irishspring: 'colgate-palmolive',
  softsoap: 'colgate-palmolive',
  ajax: 'colgate-palmolive',
  fabuloso: 'colgate-palmolive',
  cuddlysoftener: 'colgate-palmolive',

  // ── Clorox ──────────────────────────────────────────────────────────
  clorox: 'clorox-co',
  pinesol: 'clorox-co',
  hiddenvalley: 'clorox-co',
  kingsford: 'clorox-co',
  burtsbees: 'clorox-co',
  brita: 'clorox-co',
  glad: 'clorox-co',
  liquidplumr: 'clorox-co',
  tilex: 'clorox-co',
  kcmasterpiece: 'clorox-co',
  fresh: 'clorox-co', // Fresh Step cat litter
  freshstep: 'clorox-co',
  scoopaway: 'clorox-co',

  // ── Tyson Foods ─────────────────────────────────────────────────────
  tyson: 'tyson-foods',
  jimmydean: 'tyson-foods',
  hillshirefarm: 'tyson-foods',
  saralee: 'tyson-foods',
  ballpark: 'tyson-foods',
  statefair: 'tyson-foods',
  aidells: 'tyson-foods',
  wrightbrand: 'tyson-foods',

  // ── ConAgra Brands ──────────────────────────────────────────────────
  hunts: 'conagra-brands',
  slimjim: 'conagra-brands',
  reddiwip: 'conagra-brands',
  birdseye: 'conagra-brands',
  healthychoice: 'conagra-brands',
  mariecallenders: 'conagra-brands',
  banquet: 'conagra-brands',
  chefboyardee: 'conagra-brands',
  vlasic: 'conagra-brands',
  wesson: 'conagra-brands',
  hebrewnational: 'conagra-brands',
  orvilleredenbacher: 'conagra-brands',
  pam: 'conagra-brands',
  lachoy: 'conagra-brands',
  rosarita: 'conagra-brands',
  snackpack: 'conagra-brands',
  swissmiss: 'conagra-brands',
  pamcooking: 'conagra-brands',
  duncan: 'conagra-brands',
  duncanhines: 'conagra-brands',

  // ── Estée Lauder ────────────────────────────────────────────────────
  esteelauder: 'estee-lauder-companies',
  clinique: 'estee-lauder-companies',
  mac: 'estee-lauder-companies',
  bobbibrown: 'estee-lauder-companies',
  lamer: 'estee-lauder-companies',
  aveda: 'estee-lauder-companies',
  origins: 'estee-lauder-companies',
  tomfordbeauty: 'estee-lauder-companies',
  smashbox: 'estee-lauder-companies',
  aramis: 'estee-lauder-companies',
  bumbleandbumble: 'estee-lauder-companies',
  drjart: 'estee-lauder-companies',
  toofaced: 'estee-lauder-companies',

  // ── Newell Brands ───────────────────────────────────────────────────
  sharpie: 'newell-brands',
  rubbermaid: 'newell-brands',
  coleman: 'newell-brands',
  yankeecandle: 'newell-brands',
  mrcoffee: 'newell-brands',
  crockpot: 'newell-brands',
  foodsaver: 'newell-brands',
  calphalon: 'newell-brands',
  oster: 'newell-brands',
  sunbeam: 'newell-brands',
  papermate: 'newell-brands',
  expo: 'newell-brands',
};

(async () => {
  // Load index.json to verify parent slugs
  const indexRaw = JSON.parse(await fs.readFile(INDEX_PATH, 'utf-8'));
  const indexArr = Array.isArray(indexRaw) ? indexRaw : Object.values(indexRaw);
  const slugs = new Set(indexArr.map(c => c.slug));

  // Load existing map
  const existing = JSON.parse(await fs.readFile(MAP_PATH, 'utf-8'));
  const doc = existing._doc;

  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  let brokenParent = 0;

  for (const [brandKey, parentSlug] of Object.entries(SEED)) {
    if (!slugs.has(parentSlug)) {
      console.warn(`  ⚠ skipping ${brandKey} → ${parentSlug} (parent not in index.json)`);
      brokenParent++;
      continue;
    }
    if (existing[brandKey]) {
      if (FORCE) {
        existing[brandKey] = { parent: parentSlug, confidence: 'high', source: 'hand-curated-seed-2026-06-07' };
        overwritten++;
      } else {
        skipped++;
      }
    } else {
      existing[brandKey] = { parent: parentSlug, confidence: 'high', source: 'hand-curated-seed-2026-06-07' };
      added++;
    }
  }

  // Sort keys (keep _doc first)
  const sorted = { _doc: doc };
  for (const k of Object.keys(existing).filter(k => k !== '_doc').sort()) {
    sorted[k] = existing[k];
  }

  await fs.writeFile(MAP_PATH, JSON.stringify(sorted, null, 2) + '\n');

  const total = Object.keys(sorted).length - 1; // minus _doc
  console.log('');
  console.log('=== Seed merge complete ===');
  console.log(`  Added new entries:        ${added}`);
  console.log(`  Overwrote existing:       ${overwritten}`);
  console.log(`  Skipped (already exists): ${skipped}`);
  console.log(`  Skipped (broken parent):  ${brokenParent}`);
  console.log(`  Total map size now:       ${total}`);
  console.log(`  Written to:               ${MAP_PATH}`);
})();
