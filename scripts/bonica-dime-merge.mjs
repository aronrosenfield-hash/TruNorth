#!/usr/bin/env node
/**
 * Bonica DIME — Step 2: Aggregate employer → TruNorth slug + merge.
 *
 * Reads /public/data/bonica-dime-aggregate.json produced by
 * bonica-dime-fetch.mjs and writes per-company:
 *
 *   co.enriched.political.dime = {
 *     total_contributions_USD_last_4y: number,
 *     donor_count:                    number,
 *     avg_recipient_cfscore:          number,    // -1..+1
 *     pct_to_dem:                     number,    // 0..1
 *     pct_to_rep:                     number,    // 0..1
 *     last_cycle_year:                number,
 *     employer_string_matched:        string,
 *     match_method:                   "direct" | "alias" | "parent" | "fuzzy",
 *     source_url:                     "https://data.stanford.edu/dime",
 *     last_updated:                   ISO,
 *   }
 *
 * Fuzzy matching strategy (in order):
 *   1. Direct: normalizeEmployer(raw) → /companies/<slug>.json exists.
 *   2. Alias: normalized hits slug-aliases.json.
 *   3. Parent: normalized matches a sub-brand in brand-parent-map.json,
 *      route to that parent's company file.
 *   4. Token-overlap fuzzy: for unmatched employers, compute a
 *      token-Jaccard score against the company-slug universe; require
 *      ≥0.6 AND a unique top match (no tie).
 *
 * Everything that *still* doesn't match gets logged to the review queue at
 * /public/data/_meta/bonica-dime-review.json so a human (or follow-up
 * task) can curate slug-aliases.json.
 *
 * DRY-RUN MODE (default): writes the per-company DIME block to a
 * shadow JSON at /public/data/_meta/bonica-dime-dryrun.json instead of
 * mutating /companies/<slug>.json. Use --apply to actually write.
 *
 * Top-50 brand sampler (--top50-only) restricts the merge to the brands
 * in TOP50_PROBE — used as the dry-run smoke test for politically-active
 * companies.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeEmployer } from "./bonica-dime-fetch.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IN_FILE     = path.join(ROOT, "public/data/bonica-dime-aggregate.json");
const COMP_DIR    = path.join(ROOT, "public/data/companies");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const LOG_FILE    = path.join(META_DIR, "bonica-dime-merge-log.json");
const REVIEW_FILE = path.join(META_DIR, "bonica-dime-review.json");
const DRYRUN_FILE = path.join(META_DIR, "bonica-dime-dryrun.json");

// The "politically active" sampler from the B-DATA3 brief. These are brands
// where we expect non-trivial DIME signal so the dry-run is meaningful.
const TOP50_PROBE = [
  "walmart", "target", "amazon", "google", "microsoft", "meta-platforms",
  "apple", "koch-inc", "charles-schwab", "blackrock", "vanguard",
  "jpmorgan-chase", "goldman-sachs", "citigroup", "bank-of-america",
  "wells-fargo", "american-express", "capital-one", "fedex", "ups",
  "boeing", "lockheed-martin", "exxon-mobil", "chevron", "anheuser-busch",
  "comcast", "atandt", "verizon", "twitter", "x-corp", "snap", "tiktok",
  "openai", "anthropic", "tesla", "spacex", "palantir", "oracle",
  "salesforce", "nvidia", "dell", "hp", "cisco", "intel", "qualcomm",
  "broadcom", "ibm", "accenture", "deloitte", "kpmg",
  "mckinsey-and-company",
];

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const TOP50_ONLY = args.includes("--top50-only") || !APPLY; // dry default narrows
const VERBOSE = args.includes("--verbose");

async function loadMaps() {
  const tryLoad = async (full) => {
    try { return JSON.parse(await fs.readFile(full, "utf-8")); }
    catch { return {}; }
  };
  const dimeAliasFile = path.join(__dirname, "bonica-dime-employer-aliases.json");
  return {
    aliases:     await tryLoad(path.join(META_DIR, "slug-aliases.json")),
    parents:     await tryLoad(path.join(META_DIR, "brand-parent-map.json")),
    dimeAliases: await tryLoad(dimeAliasFile),
  };
}

async function loadCompanySlugs() {
  const files = await fs.readdir(COMP_DIR);
  return new Set(files.filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)));
}

/**
 * Token Jaccard, plus a bonus for prefix matches. Used only for fuzzy
 * fallback when none of direct/alias/parent matched.
 */
function tokenSimilarity(a, b) {
  const ta = new Set(a.split("-").filter(x => x.length > 1));
  const tb = new Set(b.split("-").filter(x => x.length > 1));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  const jacc = inter / union;
  const prefixBonus = (a.startsWith(b) || b.startsWith(a)) ? 0.15 : 0;
  return Math.min(1, jacc + prefixBonus);
}

function fuzzyMatch(normalized, slugSet) {
  let best = null;
  let runnerUp = 0;
  for (const slug of slugSet) {
    const score = tokenSimilarity(normalized, slug);
    if (!best || score > best.score) {
      runnerUp = best ? best.score : 0;
      best = { slug, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score < 0.6) return null;
  // Require a clear winner: gap of ≥0.15 over runner-up to avoid lottery
  // matches like "ge" → many GE-prefixed companies.
  if (best.score - runnerUp < 0.05) return null;
  return best;
}

function resolveSlug(normalized, maps, slugSet) {
  // Try the normalized form AND a hyphen-collapsed variant ("wal-mart" → "walmart")
  // because DIME inconsistently hyphenates well-known names.
  const candidates = [normalized, normalized.replace(/-/g, "")];
  for (const c of candidates) {
    if (!c) continue;
    if (slugSet.has(c)) return { slug: c, method: "direct" };
    // DIME-specific employer aliases take precedence — they're the
    // hand-curated source of truth for messy donor disclosures.
    const dimeAlias = maps.dimeAliases[c];
    if (dimeAlias && slugSet.has(dimeAlias)) return { slug: dimeAlias, method: "alias" };
    const alias = maps.aliases[c];
    if (alias && slugSet.has(alias)) return { slug: alias, method: "alias" };
    const parent = maps.parents[c]?.parent;
    if (parent && slugSet.has(parent)) return { slug: parent, method: "parent" };
  }
  const fuzz = fuzzyMatch(normalized, slugSet);
  if (fuzz) return { slug: fuzz.slug, method: "fuzzy", confidence: fuzz.score };
  return null;
}

function buildDimeBlock(entry, match, now) {
  return {
    total_contributions_USD_last_4y: entry.total_amount,
    donor_count: entry.donor_count,
    contribution_count: entry.contribution_count,
    avg_recipient_cfscore: entry.avg_recipient_cfscore,
    pct_to_dem: entry.pct_to_dem,
    pct_to_rep: entry.pct_to_rep,
    pct_to_other: entry.pct_to_other,
    last_cycle_year: entry.last_cycle_year,
    employer_string_matched: entry.employer_raw,
    match_method: match.method,
    match_confidence: match.confidence ?? null,
    source: "bonica-dime",
    source_url: "https://data.stanford.edu/dime",
    last_updated: now,
  };
}

async function main() {
  const now = new Date().toISOString();
  console.log(`🏛️  Bonica DIME merge — ${APPLY ? "APPLY" : "DRY-RUN"}${TOP50_ONLY ? " (top50 only)" : ""}`);

  const data = JSON.parse(await fs.readFile(IN_FILE, "utf-8"));
  console.log(`Aggregate has ${data.employer_count} unique employers`);

  const maps = await loadMaps();
  const slugSet = await loadCompanySlugs();
  const top50 = new Set(TOP50_PROBE);

  const review = [];
  const dryShadow = {};

  // Coalesce: multiple employer strings (e.g. "FACEBOOK" + "META PLATFORMS")
  // can route to the same slug. Sum amounts/donors and amount-weight the
  // cfscore + party splits so the final block reflects the union.
  const bySlug = new Map();
  for (const entry of data.employers) {
    const match = resolveSlug(entry.employer_normalized, maps, slugSet);

    if (!match) {
      review.push({
        employer_raw: entry.employer_raw,
        employer_normalized: entry.employer_normalized,
        total_amount: entry.total_amount,
        donor_count: entry.donor_count,
        reason: "no_match",
      });
      if (VERBOSE) console.log(`  ✗ ${entry.employer_raw.padEnd(30)} no match`);
      continue;
    }

    if (TOP50_ONLY && !top50.has(match.slug)) continue;

    let agg = bySlug.get(match.slug);
    if (!agg) {
      agg = {
        slug: match.slug,
        total_amount: 0,
        donor_count: 0,
        contribution_count: 0,
        weighted_cf_sum: 0,
        weighted_dem_sum: 0,
        weighted_rep_sum: 0,
        weighted_other_sum: 0,
        last_cycle_year: 0,
        employer_strings: [],
        methods: new Set(),
      };
      bySlug.set(match.slug, agg);
    }
    agg.total_amount        += entry.total_amount;
    agg.donor_count         += entry.donor_count;
    agg.contribution_count  += entry.contribution_count;
    agg.weighted_cf_sum     += entry.avg_recipient_cfscore * entry.total_amount;
    agg.weighted_dem_sum    += entry.pct_to_dem * entry.total_amount;
    agg.weighted_rep_sum    += entry.pct_to_rep * entry.total_amount;
    agg.weighted_other_sum  += (entry.pct_to_other || 0) * entry.total_amount;
    agg.last_cycle_year      = Math.max(agg.last_cycle_year, entry.last_cycle_year || 0);
    agg.employer_strings.push(entry.employer_raw);
    agg.methods.add(match.method);
  }

  const merged = [];
  for (const [slug, agg] of bySlug) {
    const denom = agg.total_amount || 1;
    const coalesced = {
      employer_raw: agg.employer_strings.join(" | "),
      employer_normalized: slug,
      total_amount: Math.round(agg.total_amount * 100) / 100,
      donor_count: agg.donor_count,
      contribution_count: agg.contribution_count,
      avg_recipient_cfscore: Math.round((agg.weighted_cf_sum / denom) * 1000) / 1000,
      pct_to_dem: Math.round((agg.weighted_dem_sum / denom) * 1000) / 1000,
      pct_to_rep: Math.round((agg.weighted_rep_sum / denom) * 1000) / 1000,
      pct_to_other: Math.round((agg.weighted_other_sum / denom) * 1000) / 1000,
      last_cycle_year: agg.last_cycle_year,
    };
    // Prefer the strongest match method when multiple combined.
    const method = agg.methods.has("direct") ? "direct"
                 : agg.methods.has("alias")  ? "alias"
                 : agg.methods.has("parent") ? "parent" : "fuzzy";
    const block = buildDimeBlock(coalesced, { method }, now);

    if (APPLY) {
      const file = path.join(COMP_DIR, `${slug}.json`);
      try {
        const company = JSON.parse(await fs.readFile(file, "utf-8"));
        company.enriched = company.enriched || {};
        company.enriched.political = company.enriched.political || {};
        company.enriched.political.dime = block;
        if (typeof company.dataLastUpdated !== "object" || company.dataLastUpdated === null) {
          company.dataLastUpdated = company.dataLastUpdated ? { legacy: company.dataLastUpdated } : {};
        }
        company.dataLastUpdated.bonicaDime = now;
        await fs.writeFile(file, JSON.stringify(company));
      } catch (e) {
        review.push({
          employer_raw: coalesced.employer_raw,
          slug,
          reason: "write_error",
          error: e.message,
        });
        continue;
      }
    } else {
      dryShadow[slug] = block;
    }

    merged.push({
      employer_raw: coalesced.employer_raw,
      slug,
      method,
      total_amount: coalesced.total_amount,
      donor_count: coalesced.donor_count,
      avg_recipient_cfscore: coalesced.avg_recipient_cfscore,
      pct_to_dem: coalesced.pct_to_dem,
      pct_to_rep: coalesced.pct_to_rep,
    });
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at: now,
    source_file: "public/data/bonica-dime-aggregate.json",
    cycle_window: data.cycle_window,
    apply: APPLY,
    top50_only: TOP50_ONLY,
    employer_count: data.employer_count,
    merged_count: merged.length,
    review_count: review.length,
    merged,
  }, null, 2));
  await fs.writeFile(REVIEW_FILE, JSON.stringify({
    generated_at: now,
    count: review.length,
    items: review,
  }, null, 2));

  if (!APPLY) {
    await fs.writeFile(DRYRUN_FILE, JSON.stringify({
      generated_at: now,
      note: "Dry-run shadow. Run `node scripts/bonica-dime-merge.mjs --apply` to commit.",
      count: Object.keys(dryShadow).length,
      blocks: dryShadow,
    }, null, 2));
  }

  console.log(`\n✅ Merged:    ${merged.length}`);
  console.log(`   Review:    ${review.length}`);
  if (merged.length) {
    console.log("\nSample (first 5):");
    for (const m of merged.slice(0, 5)) {
      const lean = m.avg_recipient_cfscore > 0.1 ? "lean-R"
                : m.avg_recipient_cfscore < -0.1 ? "lean-D" : "neutral";
      console.log(
        `  ${m.slug.padEnd(22)} $${m.total_amount.toLocaleString().padStart(10)} ` +
        `cf=${m.avg_recipient_cfscore.toString().padStart(6)} ` +
        `D=${(m.pct_to_dem * 100).toFixed(0)}% R=${(m.pct_to_rep * 100).toFixed(0)}% ` +
        `(${lean}, via ${m.method})`,
      );
    }
  }
}

main().catch(err => { console.error("❌ bonica-dime-merge failed:", err); process.exit(1); });
