/**
 * scripts/lib/parent-map-guards.mjs
 *
 * Shared guards for brand-parent-map.json edges. Both failure modes below are
 * rooted in Wikidata's P127 ("owned by") returning the largest *shareholder*
 * or a stale/equity stake rather than the operating parent:
 *
 *   1. NON_OPERATING_PARENTS — passive institutional holders (index funds,
 *      asset managers, activist hedge-fund stakes). A non-high-confidence edge
 *      onto one of these is almost always "BlackRock is Tesco's biggest
 *      shareholder", NOT "BlackRock owns Tesco". Those are dropped — but a
 *      HIGH-confidence (hand-curated) edge is KEPT, so a deliberate house-brand
 *      edge like iShares→blackrock can still be asserted on purpose.
 *
 *   2. BAD_EDGES — specific same-name collisions onto *operating* parents that
 *      the type rule can't catch (e.g. "Asna" the vegan-food brand colliding
 *      onto general-motors via a Wikidata homonym). Dropped at any confidence.
 *
 * Audited 2026-06-27 (B-63-adjacent brand-parent-map audit). Keys are
 * alphanumeric-lowercase (resolveBrand normalization in src/App.jsx). The
 * Tier-2 generic-slug and Tier-3 PE/holding edges from that audit are left in
 * deliberately (they point at the right referent); revisit under the same lens.
 */

/** Passive holders / stake-takers that should never be an *implied* parent. */
export const NON_OPERATING_PARENTS = new Set([
  // Index funds / passive asset managers
  "blackrock",
  "vanguard", "the-vanguard-group", "vanguard-group",
  "state-street", "state-street-global-advisors",
  "fidelity-investments", "fmr",
  "capital-group", "geode-capital-management", "t-rowe-price",
  "northern-trust", "franklin-resources", "invesco",
  "schroders", "abrdn", "legal-and-general",
  // Activist / event-driven hedge funds (take stakes, not operating ownership)
  "pershing-square", "elliott-management", "third-point", "trian-partners",
]);

/**
 * child (alphanumeric key) → the WRONG parent slug to block. Only that exact
 * pair is blocked, so a future correct edge for the same child to a different
 * parent is unaffected.
 */
export const BAD_EDGES = new Map([
  ["asna", "general-motors"],            // Asna = vegan-food brand, not a GM marque (homonym)
  ["duyvis", "akzonobel"],               // Duyvis = PepsiCo nut snack, not a Dutch industrial co
  ["rainx", "shell-usa"],                // Rain-X = ITW since 2011 (Shell sold it)
  ["usmile", "petrochina"],              // usmile = Guangzhou Stars Pulse oral-care brand
  ["firebirdsoftware", "bt-group"],      // Firebird = open-source SQL DB (InterBase fork)
  ["phillips66", "berkshire-hathaway"],  // Phillips 66 = independent S&P 500 co; Berkshire exited its stake
]);

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * True when a brand→parent edge should be dropped/ignored.
 * @param {string} childKey   brand key (any casing/format; normalized internally)
 * @param {string} parentSlug resolved parent slug
 * @param {string} [confidence] "high" | "medium" | "low"
 */
export function isBlockedEdge(childKey, parentSlug, confidence) {
  const k = norm(childKey);
  if (BAD_EDGES.get(k) === parentSlug) return true;
  if (NON_OPERATING_PARENTS.has(parentSlug) && confidence !== "high") return true;
  return false;
}

/**
 * Apply the guards to a whole brand-parent-map object. Pure — does not mutate
 * the input. Preserves `_doc` and any non-edge scalar fields untouched.
 * @returns {{ clean: object, dropped: Array<{key,parent,confidence,reason}> }}
 */
export function sanitizeParentMap(map) {
  const clean = {};
  const dropped = [];
  for (const [k, v] of Object.entries(map)) {
    if (k === "_doc" || !v || typeof v !== "object" || !v.parent) {
      clean[k] = v;
      continue;
    }
    if (isBlockedEdge(k, v.parent, v.confidence)) {
      const reason = BAD_EDGES.get(norm(k)) === v.parent
        ? "bad-edge (same-name collision)"
        : "non-operating parent (passive holder)";
      dropped.push({ key: k, parent: v.parent, confidence: v.confidence, reason });
      continue;
    }
    clean[k] = v;
  }
  return { clean, dropped };
}
