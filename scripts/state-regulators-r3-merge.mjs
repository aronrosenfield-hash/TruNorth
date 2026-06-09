#!/usr/bin/env node
/**
 * Round-3 state-regulators merge.
 *
 * Reads:   data/raw/state-regulators-r3/<latest>.json
 * Writes:  data/derived/state-regulators-r3-augment.json
 *          data/derived/state-regulators-r3-unmatched.json
 *
 * Slug resolution copies round-2 with the explicit "no first-token fallback"
 * guard from state-regulators-merge.mjs — defendant strings here come from
 * free-text titles, so misattribution risk is real ("Senior Enforcement
 * Counsel" → senior, "James' Office" → james, etc.).
 *
 * Categories per source (final mapping happens in apply-augments-to-companies):
 *   ca-ag / fl-ag / il-ag / wa-ag / oh-ag / pa-ag / nj-ag / ga-ag / nc-ag
 *     → consumer-protection (privacy/labor/political category in scoring)
 *   cppa → privacy-enforcement (privacy category in scoring)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/state-regulators-r3");
const DERIVED    = path.join(ROOT, "data/derived");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const META_DIR   = path.join(ROOT, "public/data/_meta");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const OUT_FILE        = path.join(DERIVED, "state-regulators-r3-augment.json");
const UNMATCHED_FILE  = path.join(DERIVED, "state-regulators-r3-unmatched.json");

const SOURCE_URLS = {
  "ca-ag":  "https://oag.ca.gov/news",
  "cppa":   "https://cppa.ca.gov/announcements/",
  "fl-ag":  "https://www.myfloridalegal.com/newsreleases",
  "il-ag":  "https://illinoisattorneygeneral.gov/news-room/",
  "wa-ag":  "https://www.atg.wa.gov/news/news-releases-rss",
  "oh-ag":  "https://www.ohioattorneygeneral.gov/Media/News-Releases",
  "pa-ag":  "https://www.attorneygeneral.gov/taking-action/",
  "nj-ag":  "https://www.njoag.gov/feed/",
  "ga-ag":  "https://law.georgia.gov/press-releases",
  "nc-ag":  "https://ncdoj.gov/category/news-releases/",
};

/* ─────────────────────────── CLI args ───────────────────────────── */

function parseArgs(argv) {
  const args = { raw: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--raw") args.raw = argv[++i];
  }
  return args;
}

/* ─────────────────────── slug utilities ─────────────────────────── */

const CORP_SUFFIX_RE = /\b(inc|incorporated|corp|corporation|co|company|companies|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america|americas|services|technologies|labs|laboratories|international|global)\b\.?/g;

export function slugify(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(CORP_SUFFIX_RE, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rawSlugify(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/* ─────────────────────── slug resolution ────────────────────────── */

async function loadJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const aliases = (await loadJson(path.join(META_DIR, "slug-aliases.json"))) || {};
  const parentMap = (await loadJson(path.join(META_DIR, "brand-parent-map.json"))) || {};
  const indexRaw = (await loadJson(INDEX_FILE)) || [];
  const indexSlugs = new Set();
  const indexByName = new Map();
  for (const entry of indexRaw) {
    if (entry && entry.slug) {
      indexSlugs.add(entry.slug);
      if (entry.name) indexByName.set(entry.name.toLowerCase(), entry.slug);
    }
  }
  return { aliases, parentMap, indexSlugs, indexByName };
}

function hasCompanyFile(slug) {
  if (!slug) return false;
  return existsSync(path.join(COMP_DIR, `${slug}.json`));
}

function existsInIndex(slug, maps) {
  return maps.indexSlugs.has(slug) || hasCompanyFile(slug);
}

export function resolveSlug(defendant, maps) {
  if (!defendant) return { slug: null, via: "no-input" };

  const slug = slugify(defendant);
  const raw  = rawSlugify(defendant);

  for (const cand of [slug, raw]) {
    if (cand && existsInIndex(cand, maps)) return { slug: cand, via: "direct" };
  }

  const nameKey = String(defendant).toLowerCase().trim();
  if (maps.indexByName.has(nameKey)) {
    return { slug: maps.indexByName.get(nameKey), via: "index-name" };
  }
  const stripped = defendant.replace(CORP_SUFFIX_RE, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (maps.indexByName.has(stripped)) {
    return { slug: maps.indexByName.get(stripped), via: "index-name-stripped" };
  }

  for (const cand of [slug, raw]) {
    const alias = maps.aliases[cand];
    if (alias && existsInIndex(alias, maps)) return { slug: alias, via: "alias" };
  }

  for (const cand of [slug, raw]) {
    const node = maps.parentMap[cand];
    const parent = node?.parent;
    if (parent && existsInIndex(parent, maps)) return { slug: parent, via: "parent" };
  }

  // NO first-token fallback. AG free-text yields too many false positives.
  return { slug: null, via: "orphan" };
}

/* ────────────────────────── main merge ──────────────────────────── */

async function pickLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) return null;
  return path.join(RAW_DIR, files[files.length - 1]);
}

// Defendant strings that obviously aren't a company name (extended from r2
// list with state-specific noise: "Carolina Families", "New Jerseyans", etc.)
const TRASH_DEFENDANT_RE = /^(?:the\s+|a\s+|an\s+|in\s+|to\s+|of\s+|for\s+|that\s+|nearly\s+|inc\.?$|llc$|corp\.?$|first\s+|second\s+|third\s+|new\s+(?:round|set|wave)\s+|additional\s+|former\s+|ex-?)|^(?:city of|county of|state of|town of|village of|department of|office of|school|district|isd\b|board|university|college|government|administration|commission|agency|hospital|center|industry|industries\b|companies\b|corporations\b|manufacturers\b|company\b|business(?:es)?\b|firms?\b|drone\s+company|chemical\s+manufacturer|trucking|protein\s+powder|world['']s|north\s+texas|dfw\s+area|houston-area|austin\s+isd|texas|sheriff|lying\b|illegally\b|data\s+from|nearly\s+\d|corporate giants|home\s+solar|capital\s+region|hudson\s+valley|new\s+york|landlords?|merchants?|brokers?|lender|dealers?|dealership|operators?|owners?|landlord|carolina(?:\s+families)?|north\s+carolinians?|new\s+jerseyans?|new\s+jerseyites?|californians?|floridians?|illinoisans?|illinois\s+residents|washingtonians?|ohioans?|pennsylvanians?|georgians?|the\s+trump\s+administration|trump\s+administration|the\s+federal\s+government|federal\s+government|the\s+u\.?s\.?\s+department|u\.?s\.?\s+department|attorney\s+general|ag(?:'s)?\s+office|coalition\s+of|states?\s+attorneys?|multi-?state|other\s+states|attorneys?\s+general|ftc\b|fdic\b|cfpb\b|sec\b|fcc\b|epa\b|hhs\b|dot\b|doj\b|fbi\b|ice\b|cbp\b|opm\b|hud\b|usda\b|cppa\b|nydfs\b|calprivacy\b|servicemembers?|veterans?|active\s+duty|patients?|tenants?|students?|borrowers?|investors?|seniors?|elderly|minors?|teen(?:s|agers)?|children|nation\b|country\b|nation['']s|country['']s|public|consumers?\s+alike|statement\b|consumer\s+alert\b|legal\s+alert\b|updated\s+guidance\b|guidance\b|advisory\b|alert\b|reminder\b|warning\b|enforcement\s+(?:action|advisory|division|strike)|press\s+release|news\s+release|announcement\b|fortune\s+\d+\s+company|marketing\s+firm\b|data\s+broker\b|investment\s+advisers?|chemical\s+manufacturer\b|drone\s+company\b|laboratory\s+owner\b|ringleader\b|conspirators?\b|man\b|woman\b|men\b|women\b|defendant\b|suspect\b|trafficker\b|fugitive\b|inmate\b|teacher\b|doctor\b|nurse\b|fiduciary\b|jeweler\b|driver\b|owner\b|director\b|executive\b|ceo\b|cfo\b|attorney\b|lawyer\b|fraudsters?\b|scammers?\b|gangs?\b|cartels?\b|task\s+force\b|coalition\b|bureau\b|division\b|unit\b)/i;
const TRASH_EXACT = new Set([
  "fifa", "the", "and", "or", "for", "to", "inc.", "llc", "corp.",
  "purdue pharma",
  // Politicians / officials regularly captured by title verbs:
  "trump", "biden", "harris", "newsom", "desantis", "bonta",
  "uthmeier", "ag campbell", "ag bonta", "ag jackson", "ag carr", "ag sunday",
  "ag uthmeier", "ag raoul", "raoul", "yost", "wilson", "davenport",
  "jeff jackson", "kwame raoul", "andrea campbell", "andy wilson",
  "andy yost", "dave sunday", "james uthmeier", "rob bonta", "ken paxton",
  "letitia james", "matthew platkin", "nick brown", "chris carr",
]);

function isTrashDefendant(d) {
  if (!d || d.length < 3 || d.length > 140) return true;
  if (TRASH_EXACT.has(d.toLowerCase().trim())) return true;
  if (TRASH_DEFENDANT_RE.test(d)) return true;
  // Drop "X Company" / "X Manufacturer" patterns where X is a generic noun —
  // these are AG-style descriptors ("Pool Company", "Drug Company") not
  // real brand names.
  if (/^[A-Za-z]+\s+(?:company|manufacturer|firm|business|operator|owner|dealer|broker|seller|retailer|maker|provider|service|contractor)$/i.test(d)) return true;
  return false;
}

/**
 * Slugs that are too generic to credit a real brand from free-text scraping.
 * If resolveSlug returns one of these via "direct" stripping, we treat it
 * as a false positive ("Pool Company" → "pool" via corp-suffix strip is wrong).
 * Listed here are common-word slugs that ARE real companies in the DB but
 * would generate constant noise from generic news headlines.
 */
const DENY_SLUGS = new Set([
  "pool", "target", "amazon", "apple", "ford", "shell", "delta", "united",
  "gap", "subway", "kfc", "old", "new", "big", "small", "world", "national",
  "general", "american", "global", "premier", "elite", "first", "second",
  "north", "south", "east", "west", "central", "main", "core", "prime",
  "alpha", "beta", "gamma", "express", "direct", "rapid", "instant", "smart",
  "quick", "easy", "simple", "free", "ace", "max", "pro", "plus", "key",
  "city", "county", "state", "town", "village", "rural", "metro", "suburban",
  "modern", "classic", "vintage", "traditional", "premium", "luxury",
]);

/**
 * Expand "Foo, Bar, and Baz Inc." into ["Foo, Bar, and Baz Inc.", "Foo", "Bar",
 * "Baz Inc."] so we can credit each entity. Title-only mining often returns
 * compound strings like "OpenAI, CEO Sam Altman" — we want to try "OpenAI"
 * alone as well. Conservative: only split on commas/semicolons, only keep
 * sub-tokens that look brand-shaped (cap word + length).
 */
export function expandCandidate(d) {
  const out = new Set([d]);
  const parts = String(d).split(/\s*[,;]\s*|\s+(?:and|&|\/|vs\.?|v\.|formerly known as|d\/b\/a|aka|a\.k\.a\.)\s+/i);
  for (const p of parts) {
    let t = p.trim();
    // Strip leading honorifics, titles, and connector phrases that survived
    // the split point ("Formerly Known as 23andMe" → "23andMe").
    t = t.replace(/^(?:CEO|CFO|COO|CTO|Chairman|Founder|President|Director|Owner|formerly\s+known\s+as|formerly|known\s+as|now|aka|d\/?b\/?a|a\.k\.a\.|f\/?k\/?a)\s+/i, "").trim();
    if (!t || t.length < 3) continue;
    // Require at least one cap-letter word OR digit-led brand (e.g. "23andMe", "7-Eleven").
    if (!/[A-Z][a-z]/.test(t) && !/^\d/.test(t)) continue;
    out.add(t);
  }
  return out;
}

export function buildAugment(records, maps) {
  const augment = {};
  const unmatched = [];

  for (const r of records) {
    const candidates = new Set();
    for (const d of r.defendants || []) {
      for (const sub of expandCandidate(d)) {
        if (!isTrashDefendant(sub)) candidates.add(sub);
      }
    }

    const matchedSlugs = new Set();
    const trace = [];
    for (const cand of candidates) {
      const { slug, via } = resolveSlug(cand, maps);
      if (slug) {
        matchedSlugs.add(slug);
        trace.push({ defendant: cand, slug, via });
      } else {
        trace.push({ defendant: cand, slug: null, via });
      }
    }

    const actionRecord = {
      source:    r.source,
      caseTitle: r.caseTitle,
      date:      r.date,
      amountUsd: r.amountUsd,
      summary:   r.summary,
      category:  r.category,
      sourceUrl: r.sourceUrl,
    };
    for (const slug of matchedSlugs) {
      if (!augment[slug]) augment[slug] = { actions: [], categoryHints: {} };
      if (!augment[slug].actions.some(a => a.sourceUrl === r.sourceUrl)) {
        augment[slug].actions.push(actionRecord);
        augment[slug].categoryHints[r.category] = (augment[slug].categoryHints[r.category] || 0) + 1;
      }
    }
    if (matchedSlugs.size === 0) {
      unmatched.push({
        source:    r.source,
        caseTitle: r.caseTitle,
        defendantsTried: [...candidates],
        trace,
        date:      r.date,
        amountUsd: r.amountUsd,
        sourceUrl: r.sourceUrl,
      });
    }
  }

  for (const slug of Object.keys(augment)) {
    augment[slug].actions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  return { augment, unmatched };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawFile = args.raw || (await pickLatestRaw());
  if (!rawFile || !existsSync(rawFile)) {
    console.error(`No raw state-regulators-r3 file found. Run scripts/state-regulators-r3-fetch.mjs first.`);
    process.exit(2);
  }
  console.log(`Reading ${rawFile}`);
  const records = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  console.log(`  ${records.length} raw enforcement records`);

  const maps = await loadMaps();
  const { augment, unmatched } = buildAugment(records, maps);

  const matchedCompanies = Object.keys(augment).length;
  const header = {
    _license:           "Public records (US state attorneys-general + CalPrivacy)",
    _generated:         new Date().toISOString(),
    _source_urls:       SOURCE_URLS,
    _action_count:      records.length,
    _matched_companies: matchedCompanies,
    _per_source:        Object.fromEntries(
      Object.keys(SOURCE_URLS).map(s => [s, records.filter(r => r.source === s).length])
    ),
  };
  const outPayload = { ...header, ...augment };

  await fs.mkdir(DERIVED, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(outPayload, null, 2));
  await fs.writeFile(UNMATCHED_FILE, JSON.stringify({
    _generated:      new Date().toISOString(),
    _source_urls:    SOURCE_URLS,
    unmatched_count: unmatched.length,
    unmatched,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  companies matched: ${matchedCompanies}`);
  console.log(`Wrote ${UNMATCHED_FILE}`);
  console.log(`  unmatched: ${unmatched.length}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("state-regulators-r3-merge failed:", err);
    process.exit(1);
  });
}
