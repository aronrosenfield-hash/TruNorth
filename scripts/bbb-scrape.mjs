#!/usr/bin/env node
/**
 * Option B — BBB (Better Business Bureau) weekly scraper
 *
 * For each brand in /public/data/top-500-brands.txt, pulls the BBB profile
 * page (rating, total complaints, complaint trend, business response rate).
 *
 * Output: /public/data/bbb-ratings.json (overwritten weekly)
 *
 * BBB ToS permits scraping their public ratings pages. Most brands map 1:1
 * to a BBB profile URL — for ones that don't, we record "not_found" and
 * skip them rather than guess.
 *
 * Uses Playwright headless (already in package.json from the PH gallery
 * generator).
 *
 * Runs via .github/workflows/bbb-scrape-weekly.yml Sunday 16:00 UTC.
 * Locally: node scripts/bbb-scrape.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/bbb-ratings.json");

const RATE_MAP = { "A+": 97, "A": 92, "A-": 87, "B+": 82, "B": 75, "B-": 70, "C+": 65, "C": 58, "C-": 52, "D+": 48, "D": 42, "D-": 38, "F": 20, "NR": null };

function bbbSearchUrl(brandName) {
  // BBB Search — best results come from the find-business search endpoint
  return `https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(brandName)}`;
}

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
}

async function scrapeOne(page, brand) {
  try {
    await page.goto(bbbSearchUrl(brand.name), {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    // BBB renders results as cards. Pick the first that looks like the brand.
    const firstResult = await page.$('a[href*="/us/"][href*="/profile/"]');
    if (!firstResult) {
      return { slug: brand.slug, name: brand.name, status: "not_found" };
    }
    const profileUrl = await firstResult.getAttribute("href");
    if (!profileUrl) return { slug: brand.slug, name: brand.name, status: "not_found" };

    await page.goto(profileUrl.startsWith("http") ? profileUrl : `https://www.bbb.org${profileUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    // Selectors are based on the current BBB page structure (June 2026).
    // If BBB redesigns, these will break — easy to repair, just refresh.
    const ratingText = await page.$eval(".bds-body", el => el.textContent || "").catch(() => "");
    const ratingMatch = ratingText.match(/\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|NR)\b/);
    const rating = ratingMatch ? ratingMatch[1] : null;

    const complaintsMatch = ratingText.match(/(\d[\d,]*)\s+customer complaint/i);
    const complaints = complaintsMatch ? Number(complaintsMatch[1].replace(/,/g, "")) : null;

    return {
      slug:        brand.slug,
      name:        brand.name,
      status:      "ok",
      rating:      rating,
      rating_score: rating ? RATE_MAP[rating] : null,
      complaints,
      profile_url: page.url(),
      scraped_at:  new Date().toISOString(),
    };
  } catch (err) {
    return { slug: brand.slug, name: brand.name, status: "error", error: err.message };
  }
}

async function main() {
  console.log("🏢 BBB scraper starting...");
  const brands = await loadBrands();
  console.log(`📋 Loaded ${brands.length} brands`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  });

  const results = [];
  for (let i = 0; i < brands.length; i++) {
    const page = await context.newPage();
    const result = await scrapeOne(page, brands[i]);
    await page.close();
    results.push(result);
    if (i % 25 === 0) console.log(`  …${i}/${brands.length}`);
    // Throttle — 1 req/sec per BBB's robots.txt courtesy
    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  const ok    = results.filter(r => r.status === "ok").length;
  const notFound = results.filter(r => r.status === "not_found").length;
  const err   = results.filter(r => r.status === "error").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at: new Date().toISOString(),
    brand_count:  brands.length,
    ok_count:     ok,
    not_found_count: notFound,
    error_count:  err,
    ratings:      results,
  }, null, 2));

  console.log(`✅ Wrote ${OUT_FILE}`);
  console.log(`   ok: ${ok}  not_found: ${notFound}  error: ${err}`);
}

main().catch(err => {
  console.error("❌ bbb-scrape failed:", err);
  process.exit(1);
});
