#!/usr/bin/env node
/**
 * UN B&HR — Step 2: Merge UN communications into the TruNorth slug space.
 *
 * Reads the latest raw scrape from data/raw/un-bhr/ (or --in path),
 * normalises every named company string, slug-matches against
 *   public/data/index.json                (canonical slugs)
 *   public/data/_meta/slug-aliases.json   (hand-curated aliases)
 *   public/data/_meta/brand-parent-map.json (sub-brand → parent fallback)
 *
 * Writes:
 *   data/derived/un-bhr-augment.json
 *
 * Output shape:
 *   {
 *     _license: "Public, OHCHR",
 *     _source: "https://spcommreports.ohchr.org/Tmsearch/TMDocuments",
 *     _generated_at: "...",
 *     _stats: {...},
 *     companies: {
 *       <slug>: {
 *         unCommunications: [
 *           { date, type, summary, sourceUrl, country, topic, ref }
 *         ]
 *       }
 *     }
 *   }
 *
 * Standalone:
 *   node scripts/un-bhr-merge.mjs --in data/raw/un-bhr/2026-06-07.json
 *   node scripts/un-bhr-merge.mjs               (picks newest raw file)
 *   node scripts/un-bhr-merge.mjs --out /tmp/x.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR  = path.join(ROOT, "data/raw/un-bhr");
const OUT_FILE = path.join(ROOT, "data/derived/un-bhr-augment.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const ALIAS_FILE = path.join(ROOT, "public/data/_meta/slug-aliases.json");
const PARENT_FILE = path.join(ROOT, "public/data/_meta/brand-parent-map.json");

const argv = process.argv.slice(2);
function getArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const IN_ARG  = getArg("--in");
const OUT_ARG = getArg("--out");

/* ---------------------------- helpers ----------------------------------- */

// TruNorth slug rule (lifted from rebuild-bundle-index.mjs): lowercase,
// strip diacritics, replace non-[a-z0-9] runs with '-', strip leading/
// trailing hyphens. This must match the slug rule used everywhere else
// in the pipeline; otherwise our lookups will silently miss.
export function slugify(name) {
  if (!name) return "";
  return String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Strip ONLY unambiguous legal-entity suffixes BEFORE slugifying so
    // "Chevron Corporation" and "Chevron" collapse to the same slug.
    // We deliberately do NOT strip generic English words like "International",
    // "Group", "Industries" or "Holdings" — those are part of brand names
    // ("Google International LLC", "Honda Motor Co.") and stripping them
    // would create dangerous collisions.
    .replace(/\b(corporation|corp\.?|company|co\.?|limited|ltd\.?|llc|l\.l\.c\.?|plc|gmbh|ag|n\.v\.?|s\.a\.r\.l\.?|s\.a\.s?\.?|s\.p\.a\.?|inc\.?|llp|pty\.?\s+ltd\.?|bhd|sdn\.?\s+bhd|pvt\.?\s+ltd\.?|berhad|jsc|pjsc|oao|ooo)\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readJson(p, fallback = null) {
  try { return JSON.parse(await fs.readFile(p, "utf-8")); }
  catch { return fallback; }
}

async function pickNewestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));
  if (files.length === 0) return null;
  files.sort();
  return path.join(RAW_DIR, files[files.length - 1]);
}

/* ----------------------- slug-match the company ------------------------- */

export function buildSlugIndex(index) {
  // canonical slug → row
  const bySlug = new Map();
  // lowercase-name → slug
  const byNameLc = new Map();
  // bare slugified name (no suffixes) → SHORTEST canonical slug. We
  // prefer the shortest because "google" should resolve to `google-alphabet`
  // (the parent) rather than `google-international-llc` (a regional sub).
  const byBareSlug = new Map();
  for (const row of index) {
    if (!row.slug) continue;
    bySlug.set(row.slug, row);
    if (row.name) byNameLc.set(row.name.toLowerCase(), row.slug);
    const bare = slugify(row.name || row.slug);
    if (!bare) continue;
    const existing = byBareSlug.get(bare);
    if (!existing || row.slug.length < existing.length) {
      byBareSlug.set(bare, row.slug);
    }
  }
  return { bySlug, byNameLc, byBareSlug };
}

export function resolveCompany(name, idx, aliases, parents) {
  if (!name) return { slug: null, via: "empty" };
  const trimmed = name.replace(/[,;.()]+$/g, "").trim();

  // 1. exact name match (case-insensitive)
  const lc = trimmed.toLowerCase();
  if (idx.byNameLc.has(lc)) return { slug: idx.byNameLc.get(lc), via: "name" };

  // 2. slugify + direct slug match
  const s = slugify(trimmed);
  if (!s) return { slug: null, via: "unslug" };
  if (idx.bySlug.has(s)) return { slug: s, via: "direct" };

  // 3. slug → alias
  if (aliases[s]) {
    const a = aliases[s];
    if (idx.bySlug.has(a)) return { slug: a, via: "alias" };
  }

  // 4. bare-slug match (handles "Chevron Corporation" → "chevron")
  if (idx.byBareSlug.has(s)) return { slug: idx.byBareSlug.get(s), via: "bare" };

  // 5. brand-parent-map fallback (the slug we have is a subsidiary)
  const parent = parents[s]?.parent;
  if (parent && idx.bySlug.has(parent)) {
    return { slug: parent, via: "parent" };
  }

  // 6. last-ditch: drop trailing token-by-token and retry (e.g. "Shell USA"
  // → "Shell"). One step only.
  const dropped = s.split("-").slice(0, -1).join("-");
  if (dropped.length >= 3 && idx.bySlug.has(dropped)) {
    return { slug: dropped, via: "trim" };
  }

  return { slug: null, via: "orphan" };
}

/* -------------------------------- main ---------------------------------- */

async function main() {
  const inPath = IN_ARG || await pickNewestRaw();
  if (!inPath || !existsSync(inPath)) {
    console.error(`No raw input found. Run un-bhr-fetch first or pass --in.`);
    process.exit(2);
  }
  console.log(`Reading ${inPath}`);
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const comms = raw.communications || [];
  console.log(`Loaded ${comms.length} communications`);

  const index = await readJson(INDEX_FILE, []);
  const aliases = await readJson(ALIAS_FILE, {});
  const parents = await readJson(PARENT_FILE, {});
  console.log(`Index: ${index.length} brands | aliases: ${Object.keys(aliases).length} | parent-map: ${Object.keys(parents).length}`);

  const idx = buildSlugIndex(index);

  // Walk every communication × every named company. The same slug can
  // appear in multiple communications; we accumulate into an array.
  const companies = {}; // slug → unCommunications: []
  const orphans = new Map(); // raw name → count
  const viaCounts = {};
  const companyCounts = new Map(); // slug → count, for "top-cited" stat
  let totalLinks = 0;

  for (const c of comms) {
    for (const rawName of c.named_companies || []) {
      const { slug, via } = resolveCompany(rawName, idx, aliases, parents);
      viaCounts[via] = (viaCounts[via] || 0) + 1;
      if (!slug) {
        orphans.set(rawName, (orphans.get(rawName) || 0) + 1);
        continue;
      }
      totalLinks++;
      companyCounts.set(slug, (companyCounts.get(slug) || 0) + 1);
      if (!companies[slug]) companies[slug] = { unCommunications: [] };
      // De-dupe: same gId already attached to this slug? skip.
      if (companies[slug].unCommunications.some(u => u.id === c.id)) continue;
      companies[slug].unCommunications.push({
        id: c.id,
        date: c.date,
        type: c.type,
        ref: c.ref,
        summary: (c.summary || "").slice(0, 1000),
        sourceUrl: c.source_url,
        country: c.country,
        topic: c.topic,
      });
    }
  }

  // Sort each slug's communications by date desc.
  for (const slug of Object.keys(companies)) {
    companies[slug].unCommunications.sort((a, b) =>
      (b.date || "").localeCompare(a.date || ""),
    );
  }

  const out = {
    _license: "Public, OHCHR",
    _source: "https://spcommreports.ohchr.org/Tmsearch/TMDocuments",
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, inPath),
    _stats: {
      communication_count: comms.length,
      matched_company_count: Object.keys(companies).length,
      total_links: totalLinks,
      unique_orphan_count: orphans.size,
      via: viaCounts,
    },
    top_companies: [...companyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([slug, count]) => ({ slug, count })),
    top_orphans: [...orphans.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count })),
    companies,
  };

  const outFile = OUT_ARG || OUT_FILE;
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outFile}`);
  console.log(`Matched ${Object.keys(companies).length} TruNorth slugs across ${totalLinks} (slug, communication) links.`);
  console.log(`Via:`, viaCounts);
  if (out.top_companies.length) {
    console.log(`Top cited:`);
    for (const t of out.top_companies) console.log(`  ${t.count}x  ${t.slug}`);
  }
  if (orphans.size) {
    console.log(`${orphans.size} unmatched corporate strings (top 5):`);
    for (const o of out.top_orphans.slice(0, 5)) console.log(`  ${o.count}x  ${o.name}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("un-bhr-merge failed:", err);
    process.exit(1);
  });
}
