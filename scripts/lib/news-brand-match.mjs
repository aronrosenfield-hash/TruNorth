/**
 * Shared brand-matching utility for news / fact-check augment fetchers.
 *
 * The challenge: a story headline contains free-text brand mentions
 * ("Walmart sued for...", "PolitiFact rates Pfizer's claim False").
 * We need to resolve those mentions to TruNorth slugs that exist in
 * /public/data/companies/<slug>.json.
 *
 * Strategy (in order of precedence):
 *   1. Direct slug match against /public/data/top-500-brands.txt names
 *      (loaded with normalizeForMatch — same logic as news-rss-collect).
 *   2. Slug alias resolution (/public/data/_meta/slug-aliases.json) —
 *      maps "mcdonalds" → "mcdonald-s" etc.
 *   3. Brand-parent map fallback (/public/data/_meta/brand-parent-map.json)
 *      — resolves sub-brands ("oreo" → "mondelez-international") for the
 *      long tail. Only used when the direct match fails.
 *
 * We pull from NEEDS_CONTEXT_BRANDS + NEGATIVE_CONTEXT lists patterned
 * after news-rss-collect.mjs to keep false positives down on common-word
 * brand names like Apple, Meta, Target, Amazon, Shell.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Brands whose names collide with common English words/phrases. We require
// extra context to accept a match. Mirrors NEEDS_CONTEXT_BRANDS in
// scripts/news-rss-collect.mjs (deliberately duplicated rather than
// imported to keep this helper standalone).
// Keyed by the RAW BRAND SLUG (as it appears in top-500-brands.txt), not the
// canonicalized parent slug. matchBrands() consults this BEFORE
// canonicalize() runs.
// Keyed by the RAW BRAND SLUG (as it appears in top-500-brands.txt), not the
// canonicalized parent slug. matchBrands() consults this BEFORE
// canonicalize() runs.
const NEEDS_CONTEXT = new Set([
  "apple", "meta", "mars", "target", "prime", "amazon", "shell", "tide",
  "dove", "ford", "tesla", "honda", "axe", "raid", "joy", "ivory", "dawn",
  "windex", "pledge", "shout", "guess", "kind", "fox", "circle", "fortune",
  "century", "bang", "gem", "ace", "true-value", "eldorado",
  // Additional common-word collisions found post-launch
  "fossil", "budget", "nationwide", "costco", "zoom", "google", "gap",
  "camel", "champion", "patron", "burberry", "polo", "warrior", "diesel",
  "twitter", "x", "facebook",
]);

const NEGATIVE_CONTEXT = {
  mars:   ["spacex", "planet mars", "mars rover", "mars mission", "mars colony", "nasa"],
  apple:  ["apple pie", "apple tree", "rotten apple", "candied apple"],
  target: ["on target", "off target", "target audience", "easy target", "missile target"],
  amazon: ["amazon rainforest", "amazon river", "amazon basin", "amazon jungle"],
  shell:  ["seashell", "shell shock", "egg shell"],
  prime:  ["prime minister", "prime suspect", "prime time", "subprime"],
  meta:   ["meta-analysis", "meta description", "metadata", "meta level"],
  fox:    ["arctic fox", "red fox", "silver fox"],
  ford:   ["henry ford", "harrison ford", "tom ford", "rob ford"],
  tesla:  ["nikola tesla", "tesla coil"],
  joy:    ["tears of joy", "pure joy", "joy of"],
  // The Fossil watch brand vs "fossil fuel" / "fossil record" / fossil discovery.
  fossil: ["fossil fuel", "fossil record", "fossil discovery", "climate", "carbon", "oil and gas"],
  // Budget rental car vs federal budget / household budget.
  budget: ["federal budget", "state budget", "household budget", "budget deficit", "budget cut", "annual budget", "budget process"],
  // Nationwide insurance vs "nationwide" adverb.
  nationwide: ["nationwide impact", "nationwide effort", "nationwide ban", "nationwide search", "nationwide push", "nationwide trend"],
  // Costco was matched only via "Welcome to Costco" debunk; require business context.
  costco: ["fake image", "banner", "viral"],
  // Zoom Court / Zoom call as generic video-conf reference vs Zoom Video Communications corporate action.
  zoom:  ["zoom court", "zoom call", "zoom meeting", "via zoom", "on zoom"],
  // "Google AI" added text appended by Lead Stories debunkings — not about Google.
  google: ["added by google", "google ai content", "google search result", "via google"],
  // Camel cigarette vs camel milk / animal.
  camel: ["camel milk", "camel hair", "camel ride", "live camel"],
  // Gap (clothing) vs "filling a gap", "wage gap", "achievement gap".
  gap:   ["fill a gap", "wage gap", "achievement gap", "knowledge gap", "data gap", "trust gap", "gender gap", "gap year", "gap analysis", "skills gap", "gap in coverage"],
  // Twitter / X — generic mentions are usually about the platform as a medium ("X posts said"), not corporate actions.
  twitter: ["twitter post", "twitter user", "tweeted", "on twitter"],
  x:       ["x post", "x user", "x account", "x platform"],
  // Facebook as rumor medium ("Facebook pages claimed...") vs Meta corporate action.
  facebook: ["facebook post", "facebook page", "facebook user", "facebook group", "on facebook", "via facebook"],
};

const BUSINESS_CONTEXT = [
  "company", "corp", "corporation", "inc", "ltd", "llc", "holdings", "group",
  "ceo", "cfo", "earnings", "revenue", "shareholder", "stock", "store",
  "lawsuit", "sued", "settlement", "fine", "violation", "recall", "investigation",
  "fda", "ftc", "sec", "doj", "epa", "osha", "nlrb", "court", "charged",
];

function normalizeText(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’‚‛'`]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

let CACHE = null;
async function loadResolver() {
  if (CACHE) return CACHE;
  const brandsRaw = await fs.readFile(path.join(ROOT, "public/data/top-500-brands.txt"), "utf-8");
  const brands = brandsRaw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name, normName: normalizeText(name) };
    })
    .filter(b => b.slug && b.name);

  // Slug aliases ({ "mcdonalds": "mcdonald-s", ... })
  let aliases = {};
  try {
    aliases = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/_meta/slug-aliases.json"), "utf-8"));
  } catch {}

  // Brand-parent map ({ "oreo": { parent: "mondelez-international" }, ... })
  let parentMap = {};
  try {
    parentMap = JSON.parse(await fs.readFile(path.join(ROOT, "public/data/_meta/brand-parent-map.json"), "utf-8"));
  } catch {}

  // Build index of EXISTING company slugs so we never resolve to a slug
  // that has no /public/data/companies/<slug>.json behind it.
  const compDir = path.join(ROOT, "public/data/companies");
  const compFiles = await fs.readdir(compDir);
  const validSlugs = new Set(compFiles.filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));

  // Index: longest brand names first (so "coca-cola" matches before "coca").
  brands.sort((a, b) => b.normName.length - a.normName.length);

  CACHE = { brands, aliases, parentMap, validSlugs };
  return CACHE;
}

/**
 * Resolve a slug through alias / parent-map / company-index lookup.
 * Returns the canonical TruNorth slug or null if it doesn't exist.
 */
function canonicalize(slug, resolver) {
  if (!slug) return null;
  const { aliases, parentMap, validSlugs } = resolver;
  let s = slug;
  if (aliases[s]) s = aliases[s];
  if (validSlugs.has(s)) return s;
  // Parent-map fallback (only when alphanumeric stripped key matches).
  const key = s.replace(/[^a-z0-9]/g, "");
  if (parentMap[key]?.parent) {
    const p = parentMap[key].parent;
    if (validSlugs.has(p)) return p;
  }
  return null;
}

/**
 * Scan a free-text string and return the set of brand slugs mentioned,
 * applying NEEDS_CONTEXT / NEGATIVE_CONTEXT guards on common-word brands.
 *
 * @param {string} text - title + summary concatenated
 * @returns {Promise<string[]>} - slugs (canonicalized to valid company files)
 */
export async function matchBrands(text) {
  const resolver = await loadResolver();
  const norm = normalizeText(text);
  if (!norm) return [];

  const hits = new Set();
  for (const brand of resolver.brands) {
    const name = brand.normName;
    if (!name || name.length < 3) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Trailing `s?` allows possessive ("walmarts plans") and plural
    // ("nikes") forms after smart-quote stripping collapses them.
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}s?(?:[^a-z0-9]|$)`);
    if (!re.test(norm)) continue;

    // Negative-context filter.
    const neg = NEGATIVE_CONTEXT[brand.slug];
    if (neg && neg.some(p => norm.includes(p))) continue;

    // Needs-context filter for common-word brands.
    if (NEEDS_CONTEXT.has(brand.slug)) {
      if (!BUSINESS_CONTEXT.some(w => norm.includes(w))) continue;
    }

    const canonical = canonicalize(brand.slug, resolver);
    if (canonical) hits.add(canonical);
  }
  return [...hits];
}

/**
 * Lookup a single brand by slug or display name through the full alias chain.
 * Returns the canonical TruNorth slug or null.
 */
export async function resolveSlug(input) {
  if (!input) return null;
  const resolver = await loadResolver();
  // Try as slug first.
  let candidate = canonicalize(slugify(input), resolver);
  if (candidate) return candidate;
  // Try by exact name match.
  const norm = normalizeText(input);
  for (const b of resolver.brands) {
    if (b.normName === norm) {
      candidate = canonicalize(b.slug, resolver);
      if (candidate) return candidate;
    }
  }
  return null;
}

export { normalizeText, slugify };
