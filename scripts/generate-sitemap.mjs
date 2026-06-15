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
  // /alternatives/<slug>: only for brands that (a) grade below B (<65) and
  // (b) have at least one higher-graded same-category peer — i.e. the brands
  // users actually seek alternatives to. /compare/<a>-vs-<b>: from each brand's
  // listed competitors, as canonical alphabetical pairs, deduped.
  const slugOf = (co) => co.slug || co.id;
  const overallOf = (co) => Number(co.overall ?? co.score);
  const valid = new Set(index.map(slugOf).filter(Boolean).map(String));

  const byCat = new Map();
  for (const co of index) {
    const c = co.cat || "";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(co);
  }

  const altSlugs = [];
  for (const co of index) {
    const o = overallOf(co);
    if (!isFinite(o) || o >= 65) continue; // B and above don't need an alternatives page
    const peers = byCat.get(co.cat || "") || [];
    if (peers.some(p => slugOf(p) !== slugOf(co) && overallOf(p) > o)) {
      altSlugs.push(String(slugOf(co)));
    }
  }

  const comparePairs = new Set();
  for (const co of index) {
    const a = String(slugOf(co) || "");
    if (!a) continue;
    for (const comp of co.competitors || []) {
      const b = String(comp || "").toLowerCase();
      if (!b || !valid.has(b) || b === a) continue;
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
  console.log(`✅ Wrote ${OUT_PATH}`);
  console.log(`   ${HARDCODED_PAGES.length} static + ${index.length} companies + ${altSlugs.length} alternatives + ${comparePairs.size} comparisons = ${total} URLs`);
}

main().catch(err => {
  console.error("❌ Sitemap generation failed:", err.message);
  process.exit(1);
});
