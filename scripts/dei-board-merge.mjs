#!/usr/bin/env node
/**
 * DEI / board diversity / executive compensation — merge step.
 *
 * Reads latest data/raw/dei-board/<date>.json and writes
 * data/derived/dei-board-augment.json keyed by TruNorth slug.
 *
 * Routing ladder per entry: slugHint → direct slug → alias → parent → orphan.
 *
 * Aggregation per slug:
 *   - certifications: dedup human-readable badges
 *     ("DiversityInc Top 50 #5", "Pay ratio 1,675:1", "Catalyst champion")
 *   - sources: dedup list of inner source keys (equilar-100, paywatch, …)
 *   - bestStatus rollup per category: "leader" | "positive" | "mixed" |
 *     "concern", driven by the same ladder used by farm-welfare-merge.
 *
 * Categories written:
 *   - dei    (primary — DiversityInc, NAACP, Catalyst, Paradigm-Parity,
 *             SpencerStuart, Working-Mother, Lean-In, Supplier-Div,
 *             Equilar 100 [no DEI signal, so omitted from dei])
 *   - labor  (pay-ratio signals: AFL-CIO Paywatch, SEC §953(b),
 *             As You Sow Most Overpaid, Equilar 100 [as labor concern
 *             only when the ratio is extreme])
 *
 * Severity rules:
 *   - DiversityInc Top 10               → leader
 *   - DiversityInc Top 50 (non-Top-10)  → positive
 *   - NAACP Grade A                     → leader
 *   - NAACP Grade B                     → positive
 *   - NAACP Grade C                     → mixed
 *   - NAACP Grade D / F                 → concern
 *   - Catalyst champion / 30%+ Coalition→ leader
 *   - Paradigm-Parity / Lean-In         → positive
 *   - Working-Mother 100 Best           → positive
 *   - SpencerStuart highlighted         → positive
 *   - Supplier-div ≥$5B                 → leader
 *   - Supplier-div ≥$1B                 → positive
 *
 *   - Equilar 100                       → concern (labor, by virtue of
 *                                         being on the highest-paid list)
 *   - Paywatch pay ratio ≥1000:1        → concern
 *   - Paywatch pay ratio 250-999:1      → mixed
 *   - Paywatch pay ratio <250:1         → positive (relative to peers)
 *   - SEC §953(b) ≤10:1                 → leader (rare)
 *   - SEC §953(b) ≤50:1                 → positive
 *   - SEC §953(b) ≤250:1                → mixed
 *   - SEC §953(b) >250:1                → concern
 *   - AYS overpaid Top 25               → concern
 *   - AYS overpaid Top 50               → mixed
 *
 * Output shape (consumable by apply-augments-to-companies.mjs):
 *   companies: {
 *     "<slug>": {
 *       dei?: {
 *         certifications: [...],
 *         sources: [...],
 *         bestStatus: "leader" | "positive" | "mixed" | "concern",
 *         narrative: string
 *       },
 *       labor?: { same shape },
 *       _sources: ["dei-board"],
 *       _innerSources: ["equilar-100", "paywatch", ...],
 *       _routedVia: "slugHint" | "direct" | "alias" | "parent",
 *       _entries: number,
 *       _lastUpdated: <iso>
 *     }
 *   }
 *
 * Locally:
 *   node scripts/dei-board-merge.mjs
 *   node scripts/dei-board-merge.mjs --in /tmp/raw.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/dei-board");
const INDEX_FILE  = path.join(ROOT, "public/data/index.json");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const COMP_DIR    = path.join(ROOT, "public/data/companies");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const OUT_FILE    = path.join(DERIVED_DIR, "dei-board-augment.json");

const argv = process.argv.slice(2);
const inIdx  = argv.indexOf("--in");
const outIdx = argv.indexOf("--out");
const IN_OVERRIDE  = inIdx  >= 0 ? argv[inIdx + 1]  : null;
const OUT_OVERRIDE = outIdx >= 0 ? argv[outIdx + 1] : null;

/* -------------------------------- helpers ------------------------------- */

export function slugify(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function tryReadJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return null; }
}

async function loadMaps() {
  const [aliases, parents] = await Promise.all([
    tryReadJson(path.join(META_DIR, "slug-aliases.json")),
    tryReadJson(path.join(META_DIR, "brand-parent-map.json")),
  ]);
  return { aliases: aliases || {}, parents: parents || {} };
}

async function loadKnownSlugs() {
  const idx = await tryReadJson(INDEX_FILE);
  if (Array.isArray(idx) && idx.length) return new Set(idx.map(r => r.slug));
  // Fallback: list public/data/companies/*.json
  try {
    const files = await fs.readdir(COMP_DIR);
    return new Set(files.filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, "")));
  } catch {
    return new Set();
  }
}

async function latestRawFile() {
  if (IN_OVERRIDE) return IN_OVERRIDE;
  try {
    const files = (await fs.readdir(RAW_DIR))
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
  } catch { return null; }
}

export function resolveBrand(entry, { knownSlugs, aliases, parents }) {
  if (entry.slugHint && knownSlugs.has(entry.slugHint)) {
    return { slug: entry.slugHint, routedVia: "slugHint" };
  }
  const raw = slugify(entry.brand);
  if (raw && knownSlugs.has(raw)) return { slug: raw, routedVia: "direct" };
  if (raw && aliases[raw] && knownSlugs.has(aliases[raw])) {
    return { slug: aliases[raw], routedVia: "alias" };
  }
  if (raw && parents[raw]?.parent && knownSlugs.has(parents[raw].parent)) {
    return { slug: parents[raw].parent, routedVia: "parent" };
  }
  return { slug: null, routedVia: "orphan" };
}

/* ------------------------- per-source classifiers ----------------------- */

/**
 * Pure mapping: (entry) → list of { badge, severity, category }.
 * Most entries return one row; equilar-100 returns two (a labor concern
 * + an inert dei row we drop).
 */
export function classify(entry) {
  const { source, tier = "", metric = {} } = entry;
  const t = String(tier).toLowerCase();

  switch (source) {
    case "equilar-100": {
      const rank = metric.rank ?? null;
      // Being on the Equilar 100 is, by itself, a labor concern signal —
      // CEO comp ≥$15M places the company in the top 0.001% of the
      // workforce-wage curve. We do NOT mark this as a dei issue.
      return [{
        badge: rank ? `Equilar 100 #${rank}` : "Equilar 100",
        severity: "concern",
        category: "labor",
      }];
    }

    case "spencerstuart":
      return [{
        badge: "SpencerStuart Board Index highlighted",
        severity: "positive",
        category: "dei",
      }];

    case "catalyst-wob": {
      if (/champion/.test(t)) {
        return [{ badge: "Catalyst champion", severity: "leader", category: "dei" }];
      }
      return [{ badge: "Catalyst 30%+ Coalition", severity: "leader", category: "dei" }];
    }

    case "diversityinc": {
      const rank = metric.rank ?? null;
      if (rank != null && rank <= 10) {
        return [{ badge: `DiversityInc Top 50 #${rank}`, severity: "leader", category: "dei" }];
      }
      return [{ badge: `DiversityInc Top 50`, severity: "positive", category: "dei" }];
    }

    case "working-mother":
      return [{ badge: "Working Mother 100 Best", severity: "positive", category: "dei" }];

    case "paradigm-parity":
      return [{ badge: "Paradigm for Parity signatory", severity: "positive", category: "dei" }];

    case "leanin-wiw":
      return [{ badge: "Lean In Women in the Workplace partner", severity: "positive", category: "dei" }];

    case "naacp-scorecard": {
      const grade = (tier.match(/Grade\s*([A-F])/i) || [])[1] || null;
      if (grade === "A") return [{ badge: `NAACP Scorecard Grade A`, severity: "leader",   category: "dei" }];
      if (grade === "B") return [{ badge: `NAACP Scorecard Grade B`, severity: "positive", category: "dei" }];
      if (grade === "C") return [{ badge: `NAACP Scorecard Grade C`, severity: "mixed",    category: "dei" }];
      if (grade === "D") return [{ badge: `NAACP Scorecard Grade D`, severity: "concern",  category: "dei" }];
      if (grade === "F") return [{ badge: `NAACP Scorecard Grade F`, severity: "concern",  category: "dei" }];
      return [{ badge: "NAACP Scorecard", severity: "mixed", category: "dei" }];
    }

    case "paywatch": {
      const ratio = metric.payRatio ?? null;
      if (ratio == null) {
        return [{ badge: `AFL-CIO Paywatch flagged`, severity: "mixed", category: "labor" }];
      }
      const sev = ratio >= 1000 ? "concern"
                : ratio >= 250  ? "mixed"
                : "positive";
      return [{
        badge: `AFL-CIO Paywatch ${ratio.toLocaleString()}:1`,
        severity: sev,
        category: "labor",
      }];
    }

    case "ays-overpaid": {
      const rank = metric.rank ?? null;
      const sev = (rank != null && rank <= 25) ? "concern"
                : /top\s*25/.test(t) ? "concern"
                : /top\s*50/.test(t) ? "mixed"
                : /top\s*10/.test(t) ? "concern"
                : "mixed";
      return [{
        badge: rank != null
          ? `As You Sow Most Overpaid CEO #${rank}`
          : `As You Sow Most Overpaid CEO (${tier})`,
        severity: sev,
        category: "labor",
      }];
    }

    case "sec-payratio": {
      const ratio = metric.payRatio ?? null;
      if (ratio == null) {
        // Patagonia / private — emit a positive note (low or N/A).
        return [{ badge: `Pay-ratio disclosure: ${tier}`, severity: "positive", category: "labor" }];
      }
      const sev = ratio <= 10  ? "leader"
                : ratio <= 50  ? "positive"
                : ratio <= 250 ? "mixed"
                : "concern";
      return [{
        badge: `SEC pay ratio ${ratio.toLocaleString()}:1`,
        severity: sev,
        category: "labor",
      }];
    }

    case "supplier-div": {
      // Parse "$13B+ diverse-supplier spend" → 13
      const m = tier.match(/\$(\d+)\s*([MB])/i);
      const usd = m ? Number(m[1]) * (m[2].toUpperCase() === "B" ? 1e9 : 1e6) : 0;
      const sev = usd >= 5e9 ? "leader" : usd >= 1e9 ? "positive" : "mixed";
      return [{ badge: `Supplier diversity ${tier}`, severity: sev, category: "dei" }];
    }

    default:
      return [];
  }
}

const SEVERITY_RANK = { concern: 0, mixed: 1, positive: 2, leader: 3 };

/**
 * Same rollup contract as farm-welfare. Mixed wins when concern AND
 * positive/leader both present.
 */
export function rollupSeverity(tags) {
  if (!tags || tags.length === 0) return null;
  const hasConcern = tags.includes("concern");
  const hasUpside  = tags.includes("leader") || tags.includes("positive");
  if (hasConcern && hasUpside) return "mixed";
  if (hasConcern) return "concern";
  let best = "mixed";
  for (const t of tags) {
    if (SEVERITY_RANK[t] > SEVERITY_RANK[best]) best = t;
  }
  return best;
}

/* --------------------------------- main --------------------------------- */

async function main() {
  console.log("dei-board merge starting...");
  const now = new Date();

  const rawFile = await latestRawFile();
  if (!rawFile) {
    console.error(`No snapshot in ${RAW_DIR}. Run dei-board-fetch.mjs first.`);
    process.exit(2);
  }
  const raw = await tryReadJson(rawFile);
  if (!raw) { console.error(`Could not parse ${rawFile}`); process.exit(2); }

  const knownSlugs = await loadKnownSlugs();
  const maps = await loadMaps();

  const companies = {};
  const orphans = [];
  const routeCounts = { slugHint: 0, direct: 0, alias: 0, parent: 0, orphan: 0 };

  for (const e of raw.entries || []) {
    const { slug, routedVia } = resolveBrand(e, { knownSlugs, ...maps });
    routeCounts[routedVia]++;
    if (!slug) {
      orphans.push({ brand: e.brand, source: e.source, tier: e.tier || null });
      continue;
    }
    const rows = classify(e);
    if (!rows.length) continue;

    let cur = companies[slug];
    if (!cur) {
      cur = companies[slug] = {
        categories: {},
        _routedVia: routedVia,
        _entries: 0,
        _sources: new Set(),
        _lastUpdated: now.toISOString(),
      };
    }
    cur._entries += 1;
    cur._sources.add(e.source);

    const RANK = { slugHint: 0, direct: 0, alias: 1, parent: 2, orphan: 9 };
    if (RANK[routedVia] < RANK[cur._routedVia]) cur._routedVia = routedVia;

    for (const row of rows) {
      let bucket = cur.categories[row.category];
      if (!bucket) {
        bucket = cur.categories[row.category] = {
          certifications: [],
          sources: [],
          severityTags: [],
          narrativeParts: [],
        };
      }
      if (!bucket.certifications.includes(row.badge)) {
        bucket.certifications.push(row.badge);
      }
      if (!bucket.sources.includes(e.source)) {
        bucket.sources.push(e.source);
      }
      bucket.severityTags.push(row.severity);
      if (e.commitment && !bucket.narrativeParts.includes(e.commitment)) {
        bucket.narrativeParts.push(e.commitment);
      }
    }
  }

  const companiesOut = {};
  for (const [slug, c] of Object.entries(companies)) {
    const flat = {
      _sources: ["dei-board"],
      _innerSources: [...c._sources].sort(),
      _routedVia: c._routedVia,
      _entries: c._entries,
      _lastUpdated: c._lastUpdated,
    };
    for (const [cat, b] of Object.entries(c.categories)) {
      flat[cat] = {
        certifications: b.certifications,
        sources: b.sources,
        bestStatus: rollupSeverity(b.severityTags),
        narrative: b.narrativeParts.slice(0, 2).join(" "),
      };
    }
    companiesOut[slug] = flat;
  }

  const payload = {
    _license: raw._license,
    _source_file: path.relative(ROOT, rawFile),
    _source_urls: raw._source_urls,
    _generated_at: now.toISOString(),
    _stats: {
      raw_entries: raw.entries?.length || 0,
      matched_companies: Object.keys(companiesOut).length,
      routed_slugHint: routeCounts.slugHint,
      routed_direct:   routeCounts.direct,
      routed_alias:    routeCounts.alias,
      routed_parent:   routeCounts.parent,
      orphans:         routeCounts.orphan,
    },
    _parked_sources: raw._parked_sources || [],
    companies: companiesOut,
    orphans: orphans.slice(0, 500),
    orphan_total: orphans.length,
  };

  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const outFile = OUT_OVERRIDE || OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));

  console.log(`\nRaw entries:        ${payload._stats.raw_entries}`);
  console.log(`Matched companies:  ${payload._stats.matched_companies}`);
  console.log(`  slugHint:         ${routeCounts.slugHint}`);
  console.log(`  direct:           ${routeCounts.direct}`);
  console.log(`  alias:            ${routeCounts.alias}`);
  console.log(`  parent:           ${routeCounts.parent}`);
  console.log(`Orphans:            ${routeCounts.orphan}`);
  console.log(`\nWrote ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error("dei-board-merge failed:", err);
    process.exit(1);
  });
}
