#!/usr/bin/env node
/**
 * B-data4 (3/3) — Merge Senate LD-2 + FARA data into per-company JSON.
 *
 * Reads:
 *   public/data/senate-ld2.json   (from senate-ld2-fetch.mjs)
 *   public/data/fara.json         (from fara-fetch.mjs)
 *
 * Writes per company:
 *   co.enriched.political.lobbying = {
 *     total_USD_last_4q,             // sum across last 4 quarters
 *     total_USD_last_8q,             // sum across last 8 quarters
 *     top_issues:        ["Health Issues", "Taxation", ...],
 *     primary_lobby_firm,            // most-used lobbying firm
 *     primary_lobby_firm_USD,
 *     agencies_lobbied:  ["Treasury", "FDA", ...],
 *     filings_count,
 *     by_quarter:        { "2026Q1": 3200000, ... },
 *     fara_active:       boolean,
 *     fara_foreign_principals: [{ name, country, type, registrant }],
 *     fara_match_via:    "direct" | "us-affiliate" | null,
 *     sourceUrl,
 *     lastUpdated:       ISO ts,
 *   }
 *   co.dataLastUpdated.lobbying = ISO
 *
 * Name resolution:
 *   1. Direct slug match against client.name (suffix-stripped + raw)
 *   2. slug-aliases.json
 *   3. brand-parent-map.json
 *   4. first-token fallback (same as ca-ag-merge.mjs)
 *
 * Modes:
 *   --dry   (default) — read existing public/data/senate-ld2.json + fara.json
 *                       (you ran the fetchers in dry mode first).
 *                       Limits writes to BRAND_ALLOWLIST + does NOT mutate
 *                       per-company files; instead emits a write-preview log.
 *   --live            — write into companies/<slug>.json for real.
 *   --allow=slug1,slug2,...  override the allow-list.
 *
 * Locally:
 *   node scripts/lobbying-merge.mjs                  # dry preview, top-50 only
 *   node scripts/lobbying-merge.mjs --live           # commit to disk
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LD2_FILE  = path.join(ROOT, "public/data/senate-ld2.json");
const FARA_FILE = path.join(ROOT, "public/data/fara.json");
const COMP_DIR  = path.join(ROOT, "public/data/companies");
const META_DIR  = path.join(ROOT, "public/data/_meta");
const LOG_FILE  = path.join(META_DIR, "lobbying-merge-log.json");

const DRY = !process.argv.includes("--live");
const ALLOW_ARG = process.argv.find(a => a.startsWith("--allow="));

// Top-50 DRY-RUN allow-list. Brands are listed as their TruNorth slugs.
// The merger's name-resolver also routes via slug-aliases + brand-parent-map,
// so e.g. an LD-2 filing for "Google LLC" → slug "google" → parent map →
// "google-alphabet". Both the LD-2 source-slug and its resolved target may
// appear here so the dry-run touches the correct files.
const DEFAULT_ALLOWLIST = [
  // pharma
  "pfizer","moderna","johnson-johnson","johnson-and-johnson",
  "abbott","abbott-laboratories","merck","eli-lilly",
  "bristol-myers-squibb","gilead","gilead-sciences","regeneron",
  // tech (parent-routed targets included)
  "google","google-alphabet","alphabet","meta","meta-facebook",
  "apple","amazon","microsoft","oracle","oracle-cloud","ibm",
  // defense
  "lockheed-martin","rtx","raytheon-technologies","boeing","northrop-grumman",
  "general-dynamics","l3harris-technologies",
  // oil
  "exxonmobil","chevron","shell","shell-usa",
  // finance
  "jpmorgan-chase","goldman-sachs","citi","citibank-n-a","bank-of-america",
  "wells-fargo","blackrock","vanguard",
  // telecom
  "att","at-t","verizon","t-mobile","comcast",
  // automakers
  "gm","general-motors","ford","stellantis","toyota","toyota-usa",
  // FARA-relevant
  "tiktok","samsung-usa",
];

const ALLOWLIST = ALLOW_ARG
  ? ALLOW_ARG.replace("--allow=", "").split(",").map(s => s.trim()).filter(Boolean)
  : DEFAULT_ALLOWLIST;

/* --------------------------- slug utilities ----------------------------- */

function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rawSlugify(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function loadMaps() {
  const tryLoad = async (f) => {
    try { return JSON.parse(await fs.readFile(path.join(META_DIR, f), "utf-8")); }
    catch { return {}; }
  };
  return {
    aliases: await tryLoad("slug-aliases.json"),
    parents: await tryLoad("brand-parent-map.json"),
  };
}

function resolveSlug(name, maps) {
  const slug = slugify(name);
  const raw  = rawSlugify(name);
  if (!slug && !raw) return { slug: null, routed_via: "no-slug" };
  for (const cand of [slug, raw]) {
    if (cand && existsSync(path.join(COMP_DIR, `${cand}.json`))) {
      return { slug: cand, routed_via: cand === slug ? "direct" : "raw" };
    }
  }
  for (const cand of [slug, raw]) {
    const alias = maps.aliases?.[cand];
    if (alias && existsSync(path.join(COMP_DIR, `${alias}.json`))) return { slug: alias, routed_via: "alias" };
    const parent = maps.parents?.[cand]?.parent;
    if (parent && existsSync(path.join(COMP_DIR, `${parent}.json`))) return { slug: parent, routed_via: "parent" };
  }
  const first = slug.split("-")[0];
  if (first.length >= 3 && first !== slug) {
    if (existsSync(path.join(COMP_DIR, `${first}.json`))) {
      return { slug: first, routed_via: "first-token" };
    }
    const firstAlias = maps.aliases?.[first];
    if (firstAlias && existsSync(path.join(COMP_DIR, `${firstAlias}.json`))) return { slug: firstAlias, routed_via: "first-token-alias" };
    const firstParent = maps.parents?.[first]?.parent;
    if (firstParent && existsSync(path.join(COMP_DIR, `${firstParent}.json`))) return { slug: firstParent, routed_via: "first-token-parent" };
  }
  return { slug: null, routed_via: "orphan" };
}

/* ------------------------ aggregation -------------------------- */

function topN(arr, n, keyFn = x => x) {
  const counts = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!k) continue;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

function aggregateLD2(filings, allQuarters) {
  // Group by resolved-slug
  const last4 = new Set(allQuarters.slice(-4));
  const last8 = new Set(allQuarters.slice(-8));
  const groups = new Map(); // slug -> { rows[], routed_via, client_name }
  return { last4, last8, groups, filings };
}

function summarizeForSlug(rows, last4, last8) {
  let total4 = 0, total8 = 0;
  const byQuarter = {};
  const issues = [];
  const agencies = [];
  const firmTotals = new Map();
  for (const r of rows) {
    if (last8.has(r.quarter_key) && r.amount_USD) total8 += r.amount_USD;
    if (last4.has(r.quarter_key) && r.amount_USD) {
      total4 += r.amount_USD;
      byQuarter[r.quarter_key] = (byQuarter[r.quarter_key] || 0) + r.amount_USD;
    }
    issues.push(...(r.issues || []));
    agencies.push(...(r.gov_entities || []));
    if (r.registrant) {
      const cur = firmTotals.get(r.registrant) || 0;
      firmTotals.set(r.registrant, cur + (r.amount_USD || 0));
    }
  }
  const firmRanked = [...firmTotals.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total_USD_last_4q: Math.round(total4),
    total_USD_last_8q: Math.round(total8),
    by_quarter:        byQuarter,
    top_issues:        topN(issues, 5),
    agencies_lobbied:  topN(agencies, 8),
    primary_lobby_firm:     firmRanked[0]?.[0] || null,
    primary_lobby_firm_USD: firmRanked[0] ? Math.round(firmRanked[0][1]) : null,
    filings_count:     rows.length,
  };
}

/* ---------------------------- FARA index ---------------------------- */

function buildFaraIndex(regs, maps) {
  // For each registration, decide which TruNorth slug it maps to.
  // Try: foreign_principal_name → slug. Then us_party_name_hint. Then any us_affiliates.
  const bySlug = new Map(); // slug -> [{ registration, match_via }]
  const unresolved = [];
  for (const r of regs) {
    const candidates = [
      ["principal",    r.foreign_principal_name],
      ["us-hint",      r.us_party_name_hint],
      ...((r.us_affiliates || []).map(a => ["us-affiliate", a])),
    ];
    let placed = false;
    for (const [via, candidate] of candidates) {
      if (!candidate) continue;
      const { slug } = resolveSlug(candidate, maps);
      if (slug) {
        const cur = bySlug.get(slug) || [];
        cur.push({ ...r, _match_via: via });
        bySlug.set(slug, cur);
        placed = true;
        break;
      }
    }
    if (!placed) unresolved.push(r.foreign_principal_name);
  }
  return { bySlug, unresolved };
}

function summarizeFaraForSlug(rows) {
  const principals = rows.map(r => ({
    name:       r.foreign_principal_name,
    country:    r.foreign_principal_country,
    type:       r.foreign_principal_type,
    registrant: r.registrant_name,
  }));
  return {
    fara_active:             rows.length > 0,
    fara_foreign_principals: principals,
    fara_match_via:          rows[0]?._match_via || null,
  };
}

/* -------------------------------- main ------------------------------------ */

async function main() {
  const now = new Date().toISOString();
  const mode = DRY ? "DRY" : "LIVE";
  console.log(`Lobbying merge (${mode}) starting…`);

  if (!existsSync(LD2_FILE)) {
    console.error(`Missing ${LD2_FILE}. Run senate-ld2-fetch.mjs first.`);
    process.exit(1);
  }
  if (!existsSync(FARA_FILE)) {
    console.error(`Missing ${FARA_FILE}. Run fara-fetch.mjs first.`);
    process.exit(1);
  }

  const ld2  = JSON.parse(await fs.readFile(LD2_FILE,  "utf-8"));
  const fara = JSON.parse(await fs.readFile(FARA_FILE, "utf-8"));
  const maps = await loadMaps();

  // ---- Group LD-2 filings by resolved slug
  const ld2Groups = new Map(); // slug -> { rows[], client, routed_via }
  const ld2Orphans = [];
  for (const f of ld2.filings) {
    if (!f.client) continue;
    const { slug, routed_via } = resolveSlug(f.client, maps);
    if (!slug) { ld2Orphans.push(f.client); continue; }
    if (!ld2Groups.has(slug)) ld2Groups.set(slug, { rows: [], client: f.client, routed_via });
    ld2Groups.get(slug).rows.push(f);
  }

  // ---- Build FARA index
  const faraIdx = buildFaraIndex(fara.registrations, maps);

  // ---- Union of all slugs to update
  const allSlugs = new Set([...ld2Groups.keys(), ...faraIdx.bySlug.keys()]);

  // Filter to ALLOW_LIST when DRY
  const slugs = DRY ? [...allSlugs].filter(s => ALLOWLIST.includes(s)) : [...allSlugs];

  const results = [];
  const preview = [];
  const last4 = new Set(ld2.quarters.slice(-4));
  const last8 = new Set(ld2.quarters.slice(-8));

  for (const slug of slugs) {
    const ld2Group  = ld2Groups.get(slug);
    const faraGroup = faraIdx.bySlug.get(slug) || [];

    const ld2Summary  = ld2Group  ? summarizeForSlug(ld2Group.rows, last4, last8) : null;
    const faraSummary = summarizeFaraForSlug(faraGroup);

    const lobbying = {
      ...(ld2Summary || {
        total_USD_last_4q: 0,
        total_USD_last_8q: 0,
        by_quarter: {},
        top_issues: [],
        agencies_lobbied: [],
        primary_lobby_firm: null,
        primary_lobby_firm_USD: null,
        filings_count: 0,
      }),
      ...faraSummary,
      source:     "senate-ld2+fara",
      sourceUrl:  ld2Group ? "https://lda.senate.gov/" : "https://efile.fara.gov/",
      lastUpdated: now,
    };

    if (DRY) {
      preview.push({ slug, client: ld2Group?.client || null, routed_via: ld2Group?.routed_via || faraGroup[0]?._match_via || null, lobbying });
      results.push({ slug, status: "preview" });
      continue;
    }

    // LIVE: persist
    const file = path.join(COMP_DIR, `${slug}.json`);
    if (!existsSync(file)) { results.push({ slug, status: "missing-file" }); continue; }
    let co;
    try { co = JSON.parse(await fs.readFile(file, "utf-8")); }
    catch (e) { results.push({ slug, status: "parse_error", error: e.message }); continue; }

    co.enriched = co.enriched || {};
    co.enriched.political = co.enriched.political || {};
    co.enriched.political.lobbying = lobbying;

    if (typeof co.dataLastUpdated !== "object" || co.dataLastUpdated === null) {
      co.dataLastUpdated = co.dataLastUpdated ? { legacy: co.dataLastUpdated } : {};
    }
    co.dataLastUpdated.lobbying = now;

    await fs.writeFile(file, JSON.stringify(co));
    results.push({ slug, status: "merged", total_USD_last_4q: lobbying.total_USD_last_4q });
  }

  await fs.mkdir(META_DIR, { recursive: true });
  await fs.writeFile(LOG_FILE, JSON.stringify({
    merged_at:      now,
    mode,
    quarters:       ld2.quarters,
    ld2_filings:    ld2.filings.length,
    fara_active:    fara.registrations.length,
    slugs_seen:     allSlugs.size,
    slugs_processed: slugs.length,
    ld2_orphans:    [...new Set(ld2Orphans)].slice(0, 50),
    fara_unresolved: [...new Set(faraIdx.unresolved)].slice(0, 50),
    results,
    dry_preview:    DRY ? preview : undefined,
  }, null, 2));

  console.log(`Wrote ${LOG_FILE}`);
  console.log(`  slugs seen:    ${allSlugs.size}`);
  console.log(`  processed:     ${slugs.length}`);
  if (DRY) {
    console.log(`  DRY-RUN preview (no per-company files modified)`);
    for (const p of preview.slice(0, 10)) {
      const l = p.lobbying;
      const fara = l.fara_active
        ? ` | FARA: ${(l.fara_foreign_principals || []).map(x => x.name).slice(0, 2).join(", ")}`
        : "";
      console.log(`   - ${p.slug.padEnd(28)} 4q=$${(l.total_USD_last_4q || 0).toLocaleString().padStart(13)}  issues=${(l.top_issues || []).slice(0,2).join("/")||"-"}  firm=${l.primary_lobby_firm || "-"}${fara}`);
    }
  }
}

main().catch(err => {
  console.error("lobbying-merge failed:", err);
  process.exit(1);
});
