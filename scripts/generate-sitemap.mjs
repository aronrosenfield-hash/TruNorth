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
  { loc: BASE + "/#privacy",  priority: "0.5", changefreq: "monthly" },
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
  // index is array of { slug, name, cat, init, ab, ac, ... }
  const lastmod = new Date().toISOString().slice(0, 10);

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
  ].join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}
</urlset>
`;

  fs.writeFileSync(OUT_PATH, xml);
  console.log(`✅ Wrote ${OUT_PATH}`);
  console.log(`   ${HARDCODED_PAGES.length} static pages + ${index.length} companies = ${HARDCODED_PAGES.length + index.length} URLs`);
}

main().catch(err => {
  console.error("❌ Sitemap generation failed:", err.message);
  process.exit(1);
});
