#!/usr/bin/env node
/**
 * CMS Open Payments — merge raw manufacturer aggregates into TruNorth slugs.
 *
 * Reads data/raw/cms-open-payments/<YYYY>.json (or --in override) and
 * writes data/derived/cms-open-payments-augment.json keyed by slug.
 *
 * Match strategy (consistent with fdaaa-trials-merge):
 *   1. Direct slug match (slugified AMGPO_Name → index.json slug).
 *   2. Suffix-stripping (drop -inc, -llc, -corp, -corporation, -pharmaceuticals,
 *      -pharma, -co, -ltd, -plc, -ag, -se, -bv, -holdings, -usa, -us, -na,
 *      -north-america, -and-co, -limited, -laboratories, -lp).
 *   3. Hand-curated CMS_ALIASES table for subsidiaries (e.g. all Janssen,
 *      DePuy, Ethicon → johnson-and-johnson; Genentech → roche-holding;
 *      Lilly USA / Eli Lilly Branded Products → eli-lilly; etc.).
 *   4. Brand-parent fallback (public/data/_meta/brand-parent-map.json).
 *
 * Multiple AMGPOs may resolve to the same slug — we AGGREGATE:
 *     total          = sum
 *     transactions   = sum
 *     recipients     = sum (over-counts if same physician paid by multiple
 *                          subs, but CMS doesn't expose a global recipient
 *                          ID across reporting entities — close enough for
 *                          a "pharma influence" magnitude signal.)
 *
 * Output:
 *   {
 *     _license, _generated_at, _source, _programYear,
 *     _routing_counts: { direct, suffix, alias, brand-parent, orphan },
 *     _orphan_top: [{ name, total }],  // by $ — useful to grow alias table
 *     bySlug: {
 *       "<slug>": {
 *         health: {
 *           openPaymentsTotalUsd, openPaymentsTransactions,
 *           openPaymentsRecipients, programYear, sourceUrl,
 *           subsidiaries: ["AMGPO_Name", …]
 *         }
 *       }
 *     }
 *   }
 *
 * USAGE
 *   node scripts/cms-open-payments-merge.mjs
 *   node scripts/cms-open-payments-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cms-open-payments");
const OUT_FILE = path.join(ROOT, "data/derived/cms-open-payments-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const BRAND_PARENT_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

// Subsidiary / alt-name aliases. AMGPO_Name (uppercased, no punctuation
// stripped) → TruNorth slug. These cover the highest-dollar orphans
// identified by the coverage probe (see PR description).
export const CMS_ALIASES = {
  // Johnson & Johnson constellation
  "JANSSEN BIOTECH, INC.": "johnson-and-johnson",
  "JANSSEN PHARMACEUTICALS, INC.": "johnson-and-johnson",
  "JANSSEN PRODUCTS, LP": "johnson-and-johnson",
  "JANSSEN SCIENTIFIC AFFAIRS, LLC": "johnson-and-johnson",
  "DEPUY SYNTHES PRODUCTS, INC.": "johnson-and-johnson",
  "DEPUY SYNTHES SALES, INC.": "johnson-and-johnson",
  "ETHICON ENDO-SURGERY, LLC": "johnson-and-johnson",
  "ETHICON, INC.": "johnson-and-johnson",
  "ETHICON US, LLC": "johnson-and-johnson",
  "ACCLARENT, INC.": "johnson-and-johnson",
  "MEDICAL DEVICE BUSINESS SERVICES, INC.": "johnson-and-johnson",
  "CERENOVUS, INC.": "johnson-and-johnson",
  "BIOSENSE WEBSTER, INC.": "johnson-and-johnson",
  // Roche / Genentech
  "GENENTECH, INC.": "genentech",
  "GENENTECH USA, INC.": "genentech",
  "HOFFMANN-LA ROCHE INC.": "genentech",
  "F. HOFFMANN-LA ROCHE AG": "genentech",
  "HOFFMANN-LA ROCHE LIMITED": "genentech",
  "ROCHE DIAGNOSTICS CORPORATION": "genentech",
  "ROCHE MOLECULAR SYSTEMS, INC.": "genentech",
  "ROCHE DIAGNOSTICS INTERNATIONAL LTD": "genentech",
  "ROCHE PRODUCTS LIMITED": "genentech",
  "ROCHE DIABETES CARE, INC.": "genentech",
  "ROCHE SEQUENCING SOLUTIONS, INC.": "genentech",
  // Merck constellation (Merck & Co)
  "MERCK SHARP & DOHME LLC": "merck-and-co",
  "MERCK SHARP & DOHME CORP.": "merck-and-co",
  "MERCK SHARP & DOHME CORPORATION": "merck-and-co",
  // Eli Lilly
  "LILLY USA, LLC": "eli-lilly",
  "ELI LILLY AND COMPANY": "eli-lilly",
  // AstraZeneca
  "ASTRAZENECA PHARMACEUTICALS LP": "astrazeneca",
  "ASTRAZENECA LP": "astrazeneca",
  "MEDIMMUNE, LLC": "astrazeneca",
  "ALEXION PHARMACEUTICALS, INC.": "astrazeneca",
  // Bristol Myers Squibb
  "E.R. SQUIBB & SONS, L.L.C.": "bristol-myers-squibb",
  "CELGENE CORPORATION": "bristol-myers-squibb",
  // GSK
  "GLAXOSMITHKLINE, LLC.": "gsk",
  "GLAXOSMITHKLINE LLC": "gsk",
  "VIIV HEALTHCARE COMPANY": "gsk",
  // Bayer
  "BAYER HEALTHCARE LLC": "bayer",
  "BAYER HEALTHCARE PHARMACEUTICALS INC.": "bayer",
  "BAYER U.S. LLC": "bayer",
  // Novartis
  "ADVANCED ACCELERATOR APPLICATIONS USA INC": "novartis",
  "ADVANCED ACCELERATOR APPLICATIONS": "novartis",
  // Takeda — no `takeda-pharmaceutical-company` slug; falls through to suffix matcher
  // Sanofi
  "SANOFI-AVENTIS U.S. LLC": "sanofi",
  "SANOFI PASTEUR INC.": "sanofi",
  "GENZYME CORPORATION": "sanofi",
  "REGENERON HEALTHCARE SOLUTIONS, INC.": "regeneron",
  "REGENERON PHARMACEUTICALS, INC.": "regeneron",
  // Boehringer Ingelheim (not a TruNorth slug — orphan if unmatched)
  // Smith & Nephew
  "SMITH+NEPHEW, INC.": "smith-and-nephew",
  "SMITH & NEPHEW, INC.": "smith-and-nephew",
  // Stryker constellation
  "WRIGHT MEDICAL TECHNOLOGY, INC.": "stryker",
  "MAKO SURGICAL CORP.": "stryker",
  // Zimmer Biomet
  "ZIMMER BIOMET HOLDINGS, INC.": "zimmer-biomet",
  "ZIMMER, INC.": "zimmer-biomet",
  "BIOMET, INC.": "zimmer-biomet",
  // Pfizer
  "PFIZER INC.": "pfizer",
  "WYETH PHARMACEUTICALS LLC": "pfizer",
  "HOSPIRA, INC.": "pfizer",
  // AbbVie
  "ABBVIE INC.": "abbvie",
  "ALLERGAN, INC.": "abbvie",
  "ALLERGAN USA, INC.": "abbvie",
  // Abbott Labs (distinct from AbbVie)
  "ABBOTT LABORATORIES INC.": "abbott-laboratories",
  "ABBOTT VASCULAR INC.": "abbott-laboratories",
  // CSL Behring
  "CSL PLASMA INC.": "csl",
  "CSL BEHRING LLC": "csl",
  // UCB — no UCB SA slug; fall through to suffix matcher
  // Galderma
  "GALDERMA LABORATORIES, L.P.": "galderma-group-ag",
  // Boehringer Ingelheim
  "BOEHRINGER INGELHEIM PHARMACEUTICALS, INC.": "boehringer-ingelheim-united-states",
  "BOEHRINGER INGELHEIM VETMEDICA, INC.": "boehringer-ingelheim-united-states",
  // AbbVie (Allergan kept as separate slug — both names exist)
  "ALLERGAN SALES, LLC": "allergan-inc",
  // Janssen alt punctuation (no trailing period)
  "JANSSEN PHARMACEUTICALS, INC": "johnson-and-johnson",
  // AstraZeneca UK
  "ASTRAZENECA UK LIMITED": "astrazeneca",
  // Bausch & Lomb
  "BAUSCH & LOMB AMERICAS INC.": "bausch-and-lomb",
  "BAUSCH & LOMB INCORPORATED": "bausch-and-lomb",
  // BioNTech
  "BIONTECH SE": "biontech-se",
  // Moderna
  "MODERNATX, INC.": "moderna",
  "MODERNA US, INC.": "moderna",
  // Medtronic
  "MEDTRONIC, INC.": "medtronic",
  "MEDTRONIC USA, INC.": "medtronic",
  "MEDTRONIC SOFAMOR DANEK USA, INC.": "medtronic",
  // Boston Scientific
  "BOSTON SCIENTIFIC CORPORATION": "boston-scientific",
  // Intuitive Surgical
  "INTUITIVE SURGICAL, INC.": "intuitive-surgical",
  // Edwards Lifesciences
  "EDWARDS LIFESCIENCES LLC": "edwards-lifesciences",
};

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const STRIP_SUFFIXES = [
  "-inc", "-llc", "-corp", "-corporation", "-pharmaceuticals", "-pharma",
  "-co", "-ltd", "-plc", "-ag", "-se", "-bv", "-holdings", "-usa", "-us",
  "-na", "-north-america", "-and-co", "-limited", "-laboratories", "-lp",
  "-l-p", "-l-l-c", "-company",
];

function suffixVariants(slug) {
  const out = [slug];
  let cur = slug;
  for (let i = 0; i < 6; i++) {
    let changed = false;
    for (const s of STRIP_SUFFIXES) {
      if (cur.endsWith(s)) { cur = cur.slice(0, -s.length); changed = true; }
    }
    if (changed) out.push(cur);
    else break;
  }
  return out;
}

export function resolveMfr(name, indexSlugs, brandParents, aliases = CMS_ALIASES) {
  const alias = aliases[name.toUpperCase()];
  if (alias && indexSlugs.has(alias)) return { slug: alias, via: "alias" };

  const slug = slugify(name);
  if (indexSlugs.has(slug)) return { slug, via: "direct" };

  for (const v of suffixVariants(slug)) {
    if (v && indexSlugs.has(v)) return { slug: v, via: "suffix" };
  }

  // brand-parent fallback — try the alphanum-lowercase key
  const bpKey = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const bp = brandParents[bpKey];
  if (bp && bp.parent && indexSlugs.has(bp.parent)) {
    return { slug: bp.parent, via: "brand-parent" };
  }
  return null;
}

async function main() {
  const year = parseInt(arg("--year", "2024"), 10);
  const inFile = arg("--in", path.join(RAW_DIR, `${year}.json`));
  const outFile = arg("--out", OUT_FILE);

  const raw = JSON.parse(fs.readFileSync(inFile, "utf8"));
  // accept either { manufacturers: { name: {...} } } or flat { name: {...} }
  const manufacturers = raw.manufacturers || raw;
  const programYear = raw._programYear || year;
  const sourceUrl = raw._source || "https://openpaymentsdata.cms.gov";

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const indexSlugs = new Set(index.map((c) => c.slug));
  const brandParents = fs.existsSync(BRAND_PARENT_FILE)
    ? JSON.parse(fs.readFileSync(BRAND_PARENT_FILE, "utf8"))
    : {};

  const routing = { direct: 0, suffix: 0, alias: 0, "brand-parent": 0, orphan: 0 };
  const bySlugAcc = new Map();
  const orphans = [];

  for (const [name, v] of Object.entries(manufacturers)) {
    if (name.startsWith("_")) continue;
    const total = v.total || 0;
    if (total < 1000) continue; // ignore < $1k — saves space, no signal

    const hit = resolveMfr(name, indexSlugs, brandParents);
    if (!hit) {
      routing.orphan++;
      orphans.push({ name, total });
      continue;
    }
    routing[hit.via]++;
    let acc = bySlugAcc.get(hit.slug);
    if (!acc) {
      acc = { total: 0, transactions: 0, recipients: 0, subsidiaries: [] };
      bySlugAcc.set(hit.slug, acc);
    }
    acc.total += v.total || 0;
    acc.transactions += v.transactions || 0;
    acc.recipients += v.recipients || 0;
    acc.subsidiaries.push(name);
  }

  const bySlug = {};
  for (const [slug, acc] of bySlugAcc) {
    bySlug[slug] = {
      health: {
        openPaymentsTotalUsd: Math.round(acc.total * 100) / 100,
        openPaymentsTransactions: acc.transactions,
        openPaymentsRecipients: acc.recipients,
        programYear,
        sourceUrl,
        subsidiaries: acc.subsidiaries.slice(0, 8), // cap for noise
        _license: "https://www.usa.gov/government-works",
      },
    };
  }

  orphans.sort((a, b) => b.total - a.total);
  const out = {
    _license: "https://www.usa.gov/government-works",
    _generated_at: new Date().toISOString(),
    _source: sourceUrl,
    _programYear: programYear,
    _routing_counts: routing,
    _matched_slugs: Object.keys(bySlug).length,
    _orphan_top: orphans.slice(0, 30),
    bySlug,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`[done] ${Object.keys(bySlug).length} slugs matched`);
  console.log(`  routing: ${JSON.stringify(routing)}`);
  console.log(`  top orphans (need alias):`);
  for (const o of orphans.slice(0, 10)) {
    console.log(`    $${(o.total / 1e6).toFixed(1)}M ${o.name}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
