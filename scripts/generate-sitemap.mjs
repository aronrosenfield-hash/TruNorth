/**
 * Phase 5.ba — Sitemap generator.
 *
 * Reads /public/data/index.json (the compact company list) and writes
 * /public/sitemap.xml with one URL per company. Runs as part of the
 * Vite build pipeline (added to npm run build).
 *
 * Why a sitemap matters: Google's crawler discovers ~50K URLs/day for
 * a domain on its own. A sitemap tells it "here are 11,000 valid URLs
 * to crawl" and bumps that to ~all-of-them within a week. Also signals
 * <lastmod> so re-crawls happen when data changes.
 *
 * Submission:
 *   1. Google Search Console → Sitemaps → "Add a new sitemap" →
 *      enter "sitemap.xml" → Submit
 *   2. Bing Webmaster Tools does the same
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "public", "data", "index.json");
const OUT_PATH   = path.join(ROOT, "public", "sitemap.xml");
const BASE       = "https://www.trunorthapp.com";

const HARDCODED_PAGES = [
  { loc: BASE + "/",          priority: "1.0", changefreq: "daily"   },
  // QA fix 2026-06-10: was "/#privacy" — crawlers strip fragments, so this
  // was a duplicate homepage entry and the policy page was uncrawlable.
  // /privacy is a real rewrite (vercel.json) and the app now routes it.
  { loc: BASE + "/privacy",   priority: "0.5", changefreq: "monthly" },
  { loc: BASE + "/methodology", priority: "0.7", changefreq: "monthly" },
];

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`❌ Catalog not found at ${INDEX_PATH}`);
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  // index is array of { slug, name, cat, init, ab, ac, overall, competitors, ... }
  const lastmod = new Date().toISOString().slice(0, 10);

  // ── GEO landing URLs ──────────────────────────────────────────────────────
  // /alternatives/<slug>: only for GRADED brands that (a) grade below B (<65)
  // and (b) have at least MIN_PEERS higher-graded same-category peers — i.e. the
  // brands users actually seek alternatives to, and only where the page has
  // enough real content to be worth indexing. /compare/<a>-vs-<b>: from each
  // brand's listed competitors, as canonical alphabetical pairs, deduped, and
  // ONLY where BOTH brands are graded.
  //
  // 2026-08-26 null-coercion fix. `Number(null)` is 0 — which IS finite — so the
  // previous `Number(co.overall ?? co.score)` + `isFinite()` pair treated every
  // ungraded brand as a 0-scoring "F" and emitted a page for it. That published
  // 10,273 /alternatives/ URLs and 6,691 /compare/ URLs carrying a fabricated
  // failing grade on companies with no public record at all. Absence of a record
  // is NOT a score, and it must never generate an indexable URL.
  const MIN_PEERS = 3;
  const slugOf = (co) => co.slug || co.id;
  const overallOf = (co) => {
    const v = co.overall ?? co.score;
    if (v == null || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };
  const isGraded = (co) => overallOf(co) != null;
  const valid = new Set(index.map(slugOf).filter(Boolean).map(String));
  const gradedSlugs = new Set(index.filter(isGraded).map(slugOf).filter(Boolean).map(String));

  const byCat = new Map();
  for (const co of index) {
    const c = co.cat || "";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(co);
  }

  const altSlugs = [];
  for (const co of index) {
    const o = overallOf(co);
    if (o == null) continue;              // ungraded — nothing to offer an alternative TO
    if (o >= 65) continue;                // B and above don't need an alternatives page
    const peers = byCat.get(co.cat || "") || [];
    const higher = peers.filter(p => {
      if (slugOf(p) === slugOf(co)) return false;
      const po = overallOf(p);
      return po != null && po > o;
    }).length;
    if (higher >= MIN_PEERS) altSlugs.push(String(slugOf(co)));
  }

  const comparePairs = new Set();
  for (const co of index) {
    const a = String(slugOf(co) || "");
    if (!a || !gradedSlugs.has(a)) continue;   // subject must be graded
    for (const comp of co.competitors || []) {
      const b = String(comp || "").toLowerCase();
      if (!b || !valid.has(b) || b === a) continue;
      if (!gradedSlugs.has(b)) continue;       // and so must the counterparty
      const [x, y] = [a, b].sort();
      comparePairs.add(`${x}-vs-${y}`);
    }
  }

  const urls = [
    ...HARDCODED_PAGES.map(p => `
  <url>
    <loc>${esc(p.loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join(""),
    ...index.map(co => `
  <url>
    <loc>${BASE}/company/${esc(co.slug || co.id)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join(""),
    ...altSlugs.map(s => `
  <url>
    <loc>${BASE}/alternatives/${esc(s)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`).join(""),
    ...[...comparePairs].map(pair => `
  <url>
    <loc>${BASE}/compare/${esc(pair)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>`).join(""),
  ].join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>
`;

  fs.writeFileSync(OUT_PATH, xml);
  const total = HARDCODED_PAGES.length + index.length + altSlugs.length + comparePairs.size;
  const gradedCount = index.filter(isGraded).length;
  console.log(`✅ Wrote ${OUT_PATH}`);
  console.log(`   ${HARDCODED_PAGES.length} static + ${index.length} companies + ${altSlugs.length} alternatives + ${comparePairs.size} comparisons = ${total} URLs`);
  console.log(`   catalog: ${gradedCount} graded / ${index.length} tracked — GEO URLs are emitted for graded brands only`);
}

main().catch(err => {
  console.error("❌ Sitemap generation failed:", err.message);
  process.exit(1);
});
