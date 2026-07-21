// B-77 — brand-name → company resolution for the scanner.
//
// Extracted from the BarcodeScanner component so it can actually be TESTED
// against the real brand-parent-map (see scripts/resolve-brand.test.mjs).
// It was previously inline, untestable, and wrong for 1 in 4 mapped brands.
//
// THE BUG THIS REPLACES: the old order was
//     exact match → PREFIX LOOP → brand-parent-map
// so a bare prefix scan hijacked the answer before the parent map was ever
// consulted, returning whatever matched first in Map insertion order:
//     "americanspirit" → "America"        (want R.J. Reynolds)
//     "ajax"           → "Ajax Engines"   (want Colgate-Palmolive)
// Measured against the shipped catalog + all 6,694 resolvable map keys:
// 1,699 wrong (25.4%), of which 934 were this hijack. Reordering the map
// ahead of the prefix pass and hardening the pass drops it to 765 (11.4%).
//
// The residual 765 are a DIFFERENT question, deliberately left alone: they are
// exact matches on a sub-brand that exists in the catalog in its own right
// (e.g. "7up" → the 7 Up entry rather than PepsiCo). 1,015 of those have BOTH
// the sub-brand and the parent graded, and 42 would LOSE a grade by rolling up,
// so "always prefer the parent" is a product decision, not a bug fix.

/** Corporate suffixes that may be dropped when prefix-matching a brand name. */
const CORP_SUFFIX =
  /^(company|companies|inc|incorporated|corp|corporation|co|llc|ltd|limited|group|holdings|holding|plc|sa|ag|nv|gmbh|intl|international|brands|the)$/;

/** Normalize a brand string to the index key form: lowercase alphanumerics. */
export function normalizeBrandKey(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve one already-normalized key to a company.
 * @param {string} k                normalized key
 * @param {Map<string,object>} brandIndex  normalized company name → company
 * @param {object} parentMap        brand-parent-map.json
 * @param {Map<string,object>} slugIndex   slug → company
 */
function resolveKey(k, brandIndex, parentMap, slugIndex) {
  if (!k) return null;

  const mapped = parentMap && parentMap[k];
  const mappedParent =
    mapped && mapped.parent && slugIndex.has(mapped.parent) ? slugIndex.get(mapped.parent) : null;

  // 1. Exact company-name match — the strongest possible signal.
  if (brandIndex.has(k)) {
    const exact = brandIndex.get(k);
    // B-77 roll-up (Aron's call, 2026-07-20): prefer the parent ONLY when the
    // exact hit is an ungraded "?" stub and the curated parent IS graded. That
    // is the single case where rolling up strictly improves the answer — the
    // user scanned a real product and would otherwise get a shrug.
    //
    // We deliberately do NOT always roll up, even though the landing copy says
    // "subsidiaries roll up to parents": measured on the shipped catalog, 1,015
    // sub-brands have their OWN grade alongside a graded parent (76 (gas
    // station) is an F where Phillips 66 is a D — the sub-brand is the more
    // precise answer), and 42 would LOSE a grade entirely. This rule captures
    // the ~350 clear wins and makes nothing worse.
    if (exact.overall == null && mappedParent && mappedParent.overall != null) {
      return mappedParent;
    }
    return exact;
  }

  // 2. Brand-parent map. MUST come before the prefix pass: it is curated
  //    (confidence + source per entry), whereas the prefix pass is a guess.
  if (mappedParent) return mappedParent;

  // 3. Prefix fallback — last resort, for names not in the map at all
  //    ("Coca-Cola Company" → "Coca-Cola"). Hardened three ways:
  //      • both sides >= 5 chars, so short keys can't fan out;
  //      • the leftover must be a CORPORATE SUFFIX, so "americanspirit" no
  //        longer matches "america" (leftover "nspirit") while
  //        "cocacolacompany" still matches "cocacola" (leftover "company");
  //      • ambiguity bails to no-match instead of returning whichever entry
  //        happened to be first, preferring a graded company only when it is
  //        the single graded candidate.
  //    A no-match is a strictly better outcome than a confidently wrong brand:
  //    the scanner's no-match panel offers search + "notify me".
  if (k.length < 5) return null;
  const hits = new Map();
  for (const [bk, bv] of brandIndex) {
    if (bk.length < 5) continue;
    let ok = false;
    if (k.startsWith(bk)) ok = CORP_SUFFIX.test(k.slice(bk.length));
    else if (bk.startsWith(k)) ok = CORP_SUFFIX.test(bk.slice(k.length));
    if (ok && bv && bv.slug) hits.set(bv.slug, bv);
  }
  if (hits.size === 1) return [...hits.values()][0];
  if (hits.size > 1) {
    const graded = [...hits.values()].filter((c) => c.overall != null);
    if (graded.length === 1) return graded[0];
  }
  return null;
}

/**
 * Resolve a raw brand string (which may be a comma/pipe/slash-separated list,
 * as Open Food Facts often returns) to a company, or null.
 */
export function resolveBrand(rawBrand, { brandIndex, parentMap, slugIndex }) {
  if (!rawBrand || !brandIndex || !slugIndex) return null;
  const candidates = String(rawBrand)
    .split(/[,|;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const cand of candidates) {
    const hit = resolveKey(normalizeBrandKey(cand), brandIndex, parentMap || {}, slugIndex);
    if (hit) return hit;
  }
  return null;
}
