#!/usr/bin/env node
/**
 * CA Prop 65 — Merge notices into a per-slug augment file.
 *
 * Reads the most recent data/raw/ca-prop65/notices-<date>.json, normalizes
 * each defendant name, resolves it to a slug in public/data/index.json (with
 * slug-alias and brand-parent-map fallbacks), and writes a single derived
 * file keyed by slug:
 *
 *   data/derived/ca-prop65-augment.json
 *   {
 *     _license: "Public, California OEHHA / OAG",
 *     generated_at: "...",
 *     source_window: { from, to },
 *     min_notice_threshold: 2,
 *     count: N,
 *     bySlug: {
 *       <slug>: {
 *         prop65: {
 *           noticeCount: 6,
 *           recentNotices: [{ date, plaintiff, chemical, productType, url }, ...],
 *           chemicalsCited: ["Lead", "Phthalates (DEHP)", ...],
 *         }
 *       }
 *     }
 *   }
 *
 * NOISE THRESHOLD: only slugs with 2+ notices in the past 12 months are
 * emitted. A single notice from a known bounty-hunter plaintiff is too low
 * signal to flag a brand — but a pattern of 2+ is a real signal.
 *
 * Locally:
 *   node scripts/ca-prop65-merge.mjs                       # default paths
 *   node scripts/ca-prop65-merge.mjs --notices /tmp/n.json --out /tmp/aug.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/ca-prop65");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const META_DIR = path.join(ROOT, "public/data/_meta");

const DEFAULT_OUT = path.join(DERIVED_DIR, "ca-prop65-augment.json");
const MIN_NOTICES = 2; // noise threshold per spec

const argv = process.argv.slice(2);
const NOTICES_ARG = (() => {
  const i = argv.indexOf("--notices");
  return i >= 0 ? argv[i + 1] : null;
})();
const OUT_ARG = (() => {
  const i = argv.indexOf("--out");
  return i >= 0 ? argv[i + 1] : null;
})();

/* --------------------------- slug utilities ----------------------------- */

export function slugify(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Strip common corporate suffixes (mirrors ca-ag-merge.mjs)
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|l\.l\.c|lp|llp|ltd|limited|plc|sa|nv|ag|holdings|holding|group|stores|n\.a|na|usa|america|international|intl)\b\.?/g, " ")
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

/**
 * Resolve a defendant name to a slug in the index. Returns { slug, routed_via }
 * where routed_via is one of: direct | raw | alias | parent | first-token | orphan.
 */
export function resolveSlug(defendantName, knownSlugs, maps) {
  const slug = slugify(defendantName);
  const raw  = rawSlugify(defendantName);
  if (!slug && !raw) return { slug: null, routed_via: "no-slug" };

  if (knownSlugs.has(slug)) return { slug, routed_via: "direct" };
  if (knownSlugs.has(raw))  return { slug: raw, routed_via: "raw" };

  for (const cand of [slug, raw]) {
    const alias = maps.aliases?.[cand];
    if (alias && knownSlugs.has(alias)) return { slug: alias, routed_via: "alias" };
    const parent = maps.parents?.[cand]?.parent;
    if (parent && knownSlugs.has(parent)) return { slug: parent, routed_via: "parent" };
  }

  // First-token fallback: "Walmart Stores Inc" → "walmart-stores" → "walmart"
  const first = slug.split("-")[0];
  if (first.length >= 4 && first !== slug && knownSlugs.has(first)) {
    return { slug: first, routed_via: "first-token" };
  }
  return { slug: null, routed_via: "orphan" };
}

/* ------------------------------- merge --------------------------------- */

async function findLatestNoticesFile() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^notices-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

export function aggregateBySlug(notices, knownSlugs, maps) {
  const buckets = new Map(); // slug -> { notices: [], routed_via, defendants: Set }
  const orphans = new Map(); // raw defendant name -> count

  for (const n of notices) {
    if (!n.defendant) continue;
    const { slug, routed_via } = resolveSlug(n.defendant, knownSlugs, maps);
    if (!slug) {
      orphans.set(n.defendant, (orphans.get(n.defendant) || 0) + 1);
      continue;
    }
    const cur = buckets.get(slug) || { notices: [], routed_via, defendants: new Set() };
    cur.notices.push(n);
    cur.defendants.add(n.defendant);
    buckets.set(slug, cur);
  }

  const bySlug = {};
  let kept = 0, dropped = 0;
  for (const [slug, b] of buckets) {
    if (b.notices.length < MIN_NOTICES) { dropped++; continue; }
    kept++;
    const sorted = [...b.notices].sort((a, b) => (b.notice_date || "").localeCompare(a.notice_date || ""));
    const chemicals = Array.from(new Set(
      b.notices.map(n => n.chemical_alleged).filter(Boolean)
    )).sort();
    bySlug[slug] = {
      prop65: {
        noticeCount: b.notices.length,
        recentNotices: sorted.slice(0, 10).map(n => ({
          date: n.notice_date,
          plaintiff: n.plaintiff,
          chemical: n.chemical_alleged,
          productType: n.product_type,
          agNumber: n.ag_number,
          url: n.url,
        })),
        chemicalsCited: chemicals,
        defendantsMatched: Array.from(b.defendants),
        routedVia: b.routed_via,
      },
    };
  }

  return { bySlug, kept, dropped, orphans };
}

async function main() {
  console.log("CA Prop 65 merge starting…");

  // Resolve inputs
  const noticesFile = NOTICES_ARG || await findLatestNoticesFile();
  if (!noticesFile || !existsSync(noticesFile)) {
    console.error(`No notices file. Run ca-prop65-fetch.mjs first, or pass --notices <path>.`);
    process.exit(2);
  }
  const outFile = OUT_ARG || DEFAULT_OUT;

  const raw = JSON.parse(await fs.readFile(noticesFile, "utf-8"));
  const notices = raw.notices || [];
  console.log(`Loaded ${notices.length} notices from ${noticesFile}`);

  // Load known slugs from index.json
  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const knownSlugs = new Set(index.map(r => r.slug));
  console.log(`Loaded ${knownSlugs.size} known company slugs`);

  const maps = await loadMaps();

  const { bySlug, kept, dropped, orphans } = aggregateBySlug(notices, knownSlugs, maps);

  // Sort orphans by count desc for the log
  const orphanList = Array.from(orphans.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([name, count]) => ({ defendant: name, notice_count: count }));

  const payload = {
    _license: "Public, California OEHHA / OAG",
    generated_at: new Date().toISOString(),
    source_file: path.relative(ROOT, noticesFile),
    source_window: raw.window || null,
    min_notice_threshold: MIN_NOTICES,
    count: kept,
    bySlug,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log(`  matched slugs (≥${MIN_NOTICES} notices): ${kept}`);
  console.log(`  matched slugs below threshold (dropped): ${dropped}`);
  console.log(`  orphan defendants (no slug match): ${orphans.size}`);

  // Top cited companies
  const top = Object.entries(bySlug)
    .map(([slug, v]) => ({ slug, count: v.prop65.noticeCount }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (top.length) {
    console.log(`\nTop ${top.length} cited slugs:`);
    for (const t of top) console.log(`  ${String(t.count).padStart(4)}  ${t.slug}`);
  }
  if (orphanList.length) {
    console.log(`\nTop orphan defendants (would benefit from slug-aliases entries):`);
    for (const o of orphanList.slice(0, 10)) {
      console.log(`  ${String(o.notice_count).padStart(4)}  ${o.defendant}`);
    }
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("ca-prop65-merge failed:", err);
    process.exit(1);
  });
}
