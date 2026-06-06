// 2026-06-06 (B-5) — JSDoc typedefs for the Company shape used throughout
// the app. The codebase is JavaScript-not-TypeScript, but modern editors
// (VS Code, Cursor) honor JSDoc @typedef for autocomplete + go-to-def +
// inline type hints. That means future contributors (and Claude in future
// sessions) get IDE help when touching brand data without having to
// reverse-engineer the schema from sample JSONs every time.
//
// HOW TO USE in callers:
//
//     /** @type {import('./lib/types.js').Company} */
//     const co = await loadCompany(slug);
//     co.sc.guns       // → autocomplete + type hint
//     co.firearms_atf_ffl?.primaryRole  // → autocomplete
//
//   or inline on function params:
//
//     /**
//      * @param {import('./lib/types.js').Company} co
//      */
//     function gradeOf(co) { ... }
//
// The Company shape is wide because we've layered ~12 source integrations
// onto the same file over time. Source-of-truth in production is
// /public/data/companies/<slug>.json. The "bundle index" at
// /public/data/index.json carries only the fields needed for the search
// landing UI (slug, name, cat, sc.*, excl).

/**
 * @typedef {"A"|"B"|"C"|"D"|"F"|"—"} Grade
 *   Letter grade rendered in the UI. "—" means insufficient data.
 *
 * @typedef {"left"|"lean-left"|"center"|"lean-right"|"right"|"unknown"} OutletBias
 *   Political bias rating from AllSides for news-extract bias-weighting.
 *
 * @typedef {Object} CategoryNarrative
 *   Per-category narrative + source attribution baked into each brand JSON.
 * @property {string} [s]       Short narrative summary shown in the detail card.
 *                              Empty/missing → category is hidden from the
 *                              brand profile and excluded from grading.
 * @property {Array<{name?: string, url?: string, label?: string}>} [sources]
 *                              Per-grade citation list (visible in the
 *                              brand-level Sources tab — Pro feature post B-33).
 * @property {string} [verdict] One-word verdict like "Strong", "Weak", "N/A".
 *
 * @typedef {Object} ScoreBag
 *   The atomic per-category scoring slots — these drive the spectrum bars
 *   and badge categories in CompanyCard. Each is either a categorical
 *   string ("liberal" | "conservative" | etc.) or a numeric 0-100 slot,
 *   depending on which category. See `CATEGORY_UI_TYPE` in App.jsx for the
 *   render-mode mapping.
 * @property {string} [political]    "liberal" | "conservative" | "neutral" | "mixed"
 * @property {string|number} [environment]
 * @property {string|number} [labor]
 * @property {string} [dei]
 * @property {string} [charity]
 * @property {string} [animals]      "cruelty_free" | "some_testing" | "documents" | etc.
 * @property {string} [guns]         "no_guns" | "sells_guns" | "makes_guns" | "neutral" | "unknown"
 * @property {string|number} [privacy]
 * @property {string|number} [execPay]
 *
 * @typedef {Object} FirearmsATFFFL
 *   Aggregated ATF Federal Firearms Licensee entry — see B-37 for the
 *   systemic rebuild that adds CIK/ticker disambiguation. Until B-37
 *   ships, presence of this field on consumer brands should be treated
 *   as suspect and verified manually.
 * @property {string[]} [fflTypes]         ATF type codes, e.g. ["07"]
 * @property {string[]} [fflTypeNames]     Human-readable type names
 * @property {number}   [licenseCount]
 * @property {string[]} [states]
 * @property {"manufacturer"|"dealer"|"importer"|"pawnbroker"|"ammo_only"|"destructive_devices"} [primaryRole]
 * @property {string}   [sourceMonth]      "YYYY-MM"
 * @property {string}   [sourceUrl]
 *
 * @typedef {Object} NewsEvent
 *   Structured event extracted from news scrapes by the AI pipeline.
 *   See `scripts/news-rss-extract.mjs` for the schema definition.
 * @property {string} title
 * @property {string} url
 * @property {string} outlet
 * @property {OutletBias} bias
 * @property {string} date           ISO date
 * @property {string} category       Matches CATEGORY_LABELS keys
 * @property {number} severity       1-10
 * @property {number} magnitude      1-10
 * @property {number} evidence_strength  1-10
 * @property {string} summary
 *
 * @typedef {Object} EnrichedData
 *   Slot for additive enrichment from non-primary sources (Violation
 *   Tracker, BHRRC, Wikidata, etc.). Read-only from the UI perspective.
 * @property {Object} [laborAPI]
 * @property {Object} [laborAPI.violationTracker]  Good Jobs First — penalties.
 * @property {Object} [supplyChain]                BHRRC supply-chain signals.
 * @property {Object} [origin]                     Russia / sanction flags.
 *
 * @typedef {Object} CompanyMeta
 *   Bookkeeping fields. Mostly diagnostic — not rendered in the UI.
 * @property {string}  [lastFetched]   ISO timestamp from the latest pipeline run.
 * @property {string}  [lastBaked]     When the AI narratives were last regenerated.
 * @property {string}  [scoringVersion]
 *
 * @typedef {Object} Company
 *   Top-level brand record. One JSON file per company under
 *   /public/data/companies/<slug>.json. The slug is also the URL path.
 *
 * @property {string} slug               Canonical URL slug. Stable identifier.
 * @property {string} [id]               Legacy alias for slug — kept for back-compat.
 * @property {string} name               Display name.
 * @property {string} cat                Industry category — drives Browse grouping.
 *                                       See `CAT_LABELS` in App.jsx for valid values.
 * @property {string} [logoUrl]          Square logo for the brand-card thumbnail.
 * @property {number} [overall]          0-100 unpersonalized score.
 * @property {Grade}  [overallGrade]     Cached letter grade derived from `overall`.
 *
 * @property {ScoreBag} [sc]             Per-category atomic scores. See ScoreBag.
 *
 * @property {CategoryNarrative} [political]   Per-category narrative + sources.
 * @property {CategoryNarrative} [environment]
 * @property {CategoryNarrative} [labor]
 * @property {CategoryNarrative} [dei]
 * @property {CategoryNarrative} [charity]
 * @property {CategoryNarrative} [animals]
 * @property {CategoryNarrative} [guns]
 * @property {CategoryNarrative} [privacy]
 * @property {CategoryNarrative} [execPay]
 *
 * @property {string[]} [excl]           Category keys to EXCLUDE from grading
 *                                       even if a score exists. Set when the
 *                                       narrative text is "No public record found"
 *                                       — see scripts/rebuild-bundle-index.mjs.
 *
 * @property {Object} [wiki]             Wikidata identity / parent graph.
 * @property {string} [wiki.parent]      Slug of the parent corporation, if any.
 * @property {string} [wiki.website]
 * @property {string} [wiki.ticker]
 * @property {string} [wiki.cik]
 *
 * @property {NewsEvent[]} [recent_events]
 *                                       Last 90 days of high-signal news events.
 *                                       See scripts/news-extracted-merge.mjs.
 *
 * @property {FirearmsATFFFL} [firearms_atf_ffl]
 *                                       ATF FFL aggregate — see B-37.
 *
 * @property {EnrichedData} [enriched]   Additive enrichment from secondary sources.
 *
 * @property {CompanyMeta} [_meta]       Pipeline / bookkeeping.
 *
 * @typedef {Object} BundleIndexEntry
 *   Compact per-company record in /public/data/index.json. Carries only
 *   the fields needed for the search landing screen — full detail loads
 *   on brand-card expand.
 * @property {string} slug
 * @property {string} name
 * @property {string} cat
 * @property {string} [logoUrl]
 * @property {number} [overall]
 * @property {ScoreBag} sc
 * @property {string[]} excl
 */

// Sentinel export so `import('./lib/types.js')` doesn't fail at module
// resolution. Types-only file — runtime is intentionally empty.
export const TYPES_VERSION = "1.0.0-2026-06-06";
