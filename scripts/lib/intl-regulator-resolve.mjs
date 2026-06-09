/**
 * Slug-resolution helper shared by the international-regulator mergers
 * (uk-cma, uk-fca, uk-hse, asic, jftc, cci-india, cccs, nz-comcom).
 *
 * Routes a respondent / defendant name to a canonical TruNorth company slug
 * via the same precedence as ca-prop65-merge / cisa-kev-merge:
 *
 *   1. Direct (slugify-suffixes-stripped match)
 *   2. Raw   (slugify-no-suffix-stripping match)
 *   3. slug-aliases.json
 *   4. brand-parent-map.json
 *   5. First-token fallback (e.g. "tesco-stores-ltd" → "tesco")
 *   6. Manual seed (overrides for known non-trivial mappings — same idea as
 *      stanford-scac-merge's hardcoded knownAliases)
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const META_DIR  = path.resolve(__dirname, "../../public/data/_meta");

export function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|gmbh|kk|pte|pty|holdings|holding|group|stores|n\.a|na|usa|america|international|intl|aktiengesellschaft|gk|sarl)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function rawSlugify(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

export async function loadKnownSlugs(companiesDir) {
  if (!existsSync(companiesDir)) return new Set();
  const files = await fs.readdir(companiesDir);
  return new Set(files.filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));
}

/**
 * Hardcoded fallback seed for known intl regulator subsidiary → parent
 * mappings that the alias / parent-map don't yet cover. Conservative —
 * only entities where the regulator's named respondent unambiguously
 * traces to a known TruNorth slug.
 */
export const INTL_SEED_ALIASES = {
  // UK
  "tesco-stores":                     "tesco",
  "tesco-personal-finance":           "tesco",
  "barclays-bank":                    "barclays",
  "barclays-bank-plc":                "barclays",
  "hsbc-bank":                        "hsbc-holdings",
  "hsbc-bank-plc":                    "hsbc-holdings",
  "standard-chartered-bank":          "standard-chartered",
  "goldman-sachs-international":      "goldman-sachs",
  "citigroup-global-markets":         "citigroup",
  "jpmorgan-chase-bank-n-a":          "jpmorgan-chase",
  "deutsche-bank":                    "deutsche-bank-aktiengesellschaft",
  "santander-uk":                     "banco-santander-s-a",
  "natwest":                          "natwest-group",
  "sainsbury-s-supermarkets":         "sainsbury-s",
  "coca-cola-european-partners-gb":   "coca-cola",
  "whirlpool-uk-appliances":          "whirlpool-corp",
  "dhl-services":                     "dhl-usa",
  "amazon-com":                       "amazon",
  // Australia (ASIC)
  "westpac-banking":                  "westpac",
  "commonwealth-bank-of-australia":   "commonwealth-bank",
  "anz-banking":                      "anz",
  "anz-bank-new-zealand":             "anz",
  "ri-advice-anz":                    "anz",
  "amp-financial-planning-pty":       "amp",
  "national-australia-bank":          "national-australia-bank-ltd",
  "macquarie-bank":                   "macquarie",
  "volkswagen-aktiengesellschaft":    "volkswagen-usa",
  "mercedes-benz-australia-pacific-pty": "mercedes-benz-usa",
  "tesla-motors-australia-pty":      "tesla",
  "vanguard-investments-australia":  "vanguard",
  "mercer-superannuation-australia": "mercer-international",
  // Japan (JFTC)
  "amazon-japan-g-k":                "amazon",
  "toyota-motor":                    "toyota-usa",
  "mitsubishi-electric":             "mitsubishi-electric-corporation",
  // India (CCI)
  "amazon-com-investment":           "amazon",
  "hyundai-motor-india":             "hyundai-usa",
  "whatsapp":                        "whatsapp-llc",
  // Singapore (CCCS)
  "uber-singapore-technology":       "uber",
  "hitachi-asia":                    "hitachi",
  "panasonic-industrial-devices-sunx-singapore": "panasonic-usa",
  // NZ (ComCom)
  "vodafone-nz":                     "vodafone-group-plc",
  "conoco-phillips-uk":               "conocophillips",
  "conoco-phillips":                  "conocophillips",
};

/**
 * Generic single-token slugs that should NEVER be the target of first-token
 * fallback (they're real but different entities). E.g. "Standard Chartered"
 * → first-token "standard" would erroneously match the Retail "Standard"
 * brand. Block these.
 */
export const INTL_FIRST_TOKEN_BLOCKLIST = new Set([
  "standard", "commonwealth", "conoco", "national", "general", "international",
  "central", "united", "american", "first", "global", "world", "pacific",
  "asian", "european", "atlantic", "western", "northern", "southern", "eastern",
  "best", "premier", "royal", "metro", "mid", "new", "old", "great", "grand",
  "core", "key", "prime", "main", "smart",
]);

/**
 * Resolve a respondent / defendant name to a canonical TruNorth slug.
 * Returns { slug, routed_via } where routed_via is one of:
 *   direct | raw | alias | parent | seed | first-token | orphan
 */
export function resolveSlug(name, knownSlugs, maps) {
  const slug = slugify(name);
  const raw  = rawSlugify(name);
  if (!slug && !raw) return { slug: null, routed_via: "no-slug" };

  if (knownSlugs.has(slug)) return { slug, routed_via: "direct" };
  if (knownSlugs.has(raw))  return { slug: raw, routed_via: "raw" };

  for (const cand of [slug, raw]) {
    const alias = maps.aliases?.[cand];
    if (alias && knownSlugs.has(alias)) return { slug: alias, routed_via: "alias" };
    const parent = maps.parents?.[cand]?.parent;
    if (parent && knownSlugs.has(parent)) return { slug: parent, routed_via: "parent" };
    const seed = INTL_SEED_ALIASES[cand];
    if (seed && knownSlugs.has(seed)) return { slug: seed, routed_via: "seed" };
  }

  const first = slug.split("-")[0];
  if (first.length >= 4 && first !== slug && knownSlugs.has(first) && !INTL_FIRST_TOKEN_BLOCKLIST.has(first)) {
    return { slug: first, routed_via: "first-token" };
  }
  return { slug: null, routed_via: "orphan" };
}
