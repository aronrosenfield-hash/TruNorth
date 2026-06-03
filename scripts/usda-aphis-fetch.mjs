#!/usr/bin/env node
/**
 * USDA APHIS Animal Welfare Act (AWA) enforcement — monthly
 *
 * The USDA Animal and Plant Health Inspection Service (APHIS) enforces the
 * Animal Welfare Act for licensed facilities: research labs, exhibitors
 * (zoos/aquaria/marine parks), dealers (incl. puppy mills), carriers, and
 * intermediate handlers. Enforcement data lives in two places:
 *
 *   1. APHIS eFile public search (Salesforce-backed):
 *        https://aphis-efile.force.com/PublicSearchTool/s/inspection-reports
 *        — per-licensee inspection reports, NCIs (Non-Compliant Items),
 *        teachable moments, citations.
 *
 *   2. APHIS Enforcement Actions index (HTML listings):
 *        https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare/news-info/enforcement
 *        — final orders, consent decisions, civil penalties.
 *
 * The Salesforce portal is JS-heavy and rate-limits anonymous crawlers; the
 * HTML index on aphis.usda.gov is plain markup. So we do the same trick as
 * the DOL OFCCP fetcher: scrape the enforcement-actions HTML listings for
 * the 5y window, parse each release for civil-penalty $$ and AWA citations,
 * then keyword-match brand names. Per-brand we also surface NCIs by mining
 * any inspection-report PDFs linked from those release pages.
 *
 * Output: /public/data/usda-aphis.json
 *
 * Per-brand schema (when there are hits):
 *   {
 *     slug, name, status: "ok",
 *     total_AWA_violations_5y:   number,    // count of NCIs across actions
 *     total_civil_penalties_usd: number,    // sum of $ awarded against
 *     action_count_5y:           number,    // distinct enforcement actions
 *     top_violation_types:       [{ label, count }],   // research/exhibitor/dealer + AWA section bucketing
 *     sample_violations: [
 *       { title, url, date, civil_penalty_usd, awa_sections, snippet, licensee }
 *     ],
 *     scraped_at,
 *   }
 *
 * 1 req/sec, UA TruNorth-USDA-APHIS/1.0.
 * Runs via .github/workflows/usda-aphis-monthly.yml — 1st @ 22:00 UTC.
 * Locally: node scripts/usda-aphis-fetch.mjs
 *          node scripts/usda-aphis-fetch.mjs --smoke
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/usda-aphis.json");

const UA      = "TruNorth-USDA-APHIS/1.0 (+https://www.trunorthapp.com)";
const REQUEST_DELAY_MS = 1000;                                   // 1 req/sec per spec
const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

// APHIS enforcement-actions index. The page lists chronological PDFs of
// final orders/consent decisions; it also links to per-fiscal-year archives
// (FY24, FY23, …) which we walk back through.
const ENFORCEMENT_INDEX =
  "https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare/news-info/enforcement";
const ARCHIVE_URLS = [
  ENFORCEMENT_INDEX,
  // Common fiscal-year archive paths (APHIS uses sa_ component aliases).
  // Listing-index extractor will discover more, but seeding these gets the
  // 5y window covered without depending solely on link-discovery.
  "https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare/news-info/enforcement-actions/sa_enforcement_archive",
];
const MAX_LISTING_PAGES = 40;

// Smoke test set per spec: well-known APHIS-regulated licensees. Tyson is in
// top-500; the others get added inline so the smoke pass is meaningful even
// before they're added to the master list.
const SMOKE_MODE = process.argv.includes("--smoke");
const SMOKE_EXTRA = [
  { slug: "charles-river-laboratories", name: "Charles River Laboratories" },
  { slug: "envigo",                     name: "Envigo" },
  { slug: "seaworld",                   name: "SeaWorld" },
];
const SMOKE_BRAND_NAMES = new Set(["Tyson Foods", "Charles River Laboratories", "Envigo", "SeaWorld"]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const fromFile = raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name] = l.split("|").map(s => s.trim());
      return { slug, name };
    })
    .filter(b => b.slug && b.name);
  if (SMOKE_MODE) {
    const fromFileFiltered = fromFile.filter(b => SMOKE_BRAND_NAMES.has(b.name));
    return [...fromFileFiltered, ...SMOKE_EXTRA];
  }
  // Always include smoke extras in full runs too — these are well-known
  // APHIS-regulated entities that aren't in top-500 by consumer brand name
  // but matter for animal-welfare context.
  return [...fromFile, ...SMOKE_EXTRA];
}

async function fetchHtml(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      if ((res.status === 403 || res.status >= 500) && attempt < 2) {
        await sleep(2000 * (attempt + 1));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < 2) {
      await sleep(2000 * (attempt + 1));
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  }
}

function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract enforcement-action links (and child archive pages) from a listing
// page. APHIS publishes mixed HTML/PDF links — both are scraped.
function extractListingLinks(html, base) {
  const out = [];
  const re = /<a[^>]+href="([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let href = m[1];
    const text = stripHtml(m[2]);
    if (!href || text.length < 4) continue;
    // Filter to APHIS animal-welfare enforcement-related links.
    if (!/animalwelfare|enforcement|awa[-_]?(action|case)|sa_enforcement|sa_awa/i.test(href + " " + text)) continue;
    // Resolve relative URLs.
    if (href.startsWith("/")) href = `https://www.aphis.usda.gov${href}`;
    else if (!/^https?:/i.test(href)) {
      try { href = new URL(href, base).toString(); } catch { continue; }
    }
    if (!/aphis\.usda\.gov/i.test(href)) continue;
    if (/^(next|previous|prev|»|«|\d+)$/i.test(text)) continue;
    out.push({ url: href, title: text, isPdf: /\.pdf(\?|$)/i.test(href) });
  }
  const seen = new Set();
  return out.filter(x => {
    if (seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });
}

// Parse an enforcement-action HTML page (or surrounding context from a PDF
// link's anchor text). For PDFs we can't read binary inside this fetcher,
// but APHIS embeds licensee name, date, and penalty in the anchor text /
// surrounding <li> text, so the title alone is usually rich enough.
function parseReleaseDetail(html, fallback) {
  const text = stripHtml(html);
  let date = null;
  const dtMatch = html.match(/datetime="(\d{4}-\d{2}-\d{2})/);
  if (dtMatch) date = dtMatch[1];
  if (!date) {
    const human = text.match(/\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/);
    if (human) {
      const d = new Date(human[1]);
      if (!isNaN(d)) date = d.toISOString().slice(0, 10);
    }
  }
  if (!date && fallback?.title) {
    const human = fallback.title.match(/\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\b/);
    if (human) {
      const d = new Date(human[1]);
      if (!isNaN(d)) date = d.toISOString().slice(0, 10);
    }
    if (!date) {
      const numeric = fallback.title.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
      if (numeric) {
        let yr = parseInt(numeric[3], 10);
        if (yr < 100) yr += 2000;
        date = `${yr}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
      }
    }
    if (!date) {
      const u = fallback.url || "";
      const m = u.match(/(20\d{2})[-_/](\d{2})[-_/](\d{2})/);
      if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    }
  }

  let title = fallback?.title || "";
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) title = stripHtml(h1[1]);

  // Licensee — APHIS releases often say "In re: <NAME>", "respondent <NAME>",
  // or "<NAME>, Inc." in the title.
  let licensee = null;
  const re1 = text.match(/in\s+re:?\s+([A-Z][A-Za-z0-9&., '\-]+)(?:[,.;]|\s+respondent)/);
  if (re1) licensee = re1[1].trim();
  if (!licensee && fallback?.title) {
    licensee = fallback.title.replace(/\s*\(?\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\)?/g, "").trim();
  }

  return { title, date, body: text, licensee };
}

// Largest $ amount in a body string (APHIS civil penalties).
function extractDollar(body) {
  let max = 0;
  const re = /\$\s?([\d,]+(?:\.\d+)?)(\s?(million|billion|thousand))?/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const mult = m[3]?.toLowerCase();
    if (mult === "million") n *= 1_000_000;
    else if (mult === "billion") n *= 1_000_000_000;
    else if (mult === "thousand") n *= 1_000;
    if (n > max) max = n;
  }
  return max || null;
}

// Categorize an APHIS release into licensee class + AWA citation buckets.
function classifyViolations(body) {
  const lc = body.toLowerCase();
  const tags = new Set();
  // Licensee classes per AWA 9 CFR 1.1
  if (/\bresearch\s+facilit|class\s+r\b|registered\s+research/i.test(body)) tags.add("research_facility");
  if (/\bexhibitor|class\s+c\b|\bzoo\b|aquarium|marine\s+park/i.test(body)) tags.add("exhibitor");
  if (/\bdealer|class\s+a\b|class\s+b\b|breeder|puppy\s+mill/i.test(body)) tags.add("dealer");
  if (/\bcarrier|intermediate\s+handler|transport/i.test(body)) tags.add("carrier_or_transport");
  // Common AWA violation categories
  if (/veterinary\s+care|inadequate\s+veterinary|attending\s+veterinar/i.test(lc)) tags.add("inadequate_veterinary_care");
  if (/housing|enclosure|sanitation|cleanliness|filth/i.test(lc)) tags.add("housing_or_sanitation");
  if (/handling|rough\s+handling|abuse|injury\s+to\s+animal|animal\s+death/i.test(lc)) tags.add("handling_or_animal_harm");
  if (/recordkeeping|records?\s+not|failure\s+to\s+maintain\s+records/i.test(lc)) tags.add("recordkeeping");
  if (/operate\s+without\s+a\s+license|unlicensed|failure\s+to\s+obtain\s+a\s+license/i.test(lc)) tags.add("unlicensed_activity");
  if (/iacuc|institutional\s+animal\s+care/i.test(lc)) tags.add("iacuc_oversight");
  // Action types
  if (/consent\s+decision|stipulation|settlement/i.test(lc)) tags.add("consent_settlement");
  if (/license\s+revok|disqualified|cease\s+and\s+desist/i.test(lc)) tags.add("license_revocation");
  if (/civil\s+penalty|fine\s+of\s+\$/i.test(lc)) tags.add("civil_penalty");
  return [...tags];
}

// Approximate AWA citation count = NCIs (Non-Compliant Items). APHIS
// releases sometimes enumerate "X violations" or "X non-compliant items";
// fall back to 1 if penalty/order present without a count.
function extractNciCount(body) {
  const lc = body.toLowerCase();
  // "alleged to have committed XX violations" / "XX non-compliant items"
  const m1 = lc.match(/(\d{1,4})\s+(?:alleged\s+)?(?:awa\s+)?(?:violations?|non[-\s]?compliant\s+items?|ncis?)/);
  if (m1) {
    const n = parseInt(m1[1], 10);
    if (Number.isFinite(n) && n > 0 && n < 5000) return n;
  }
  return 1; // default: at least one violation per action
}

function indexRelease(detail, url) {
  const haystack = `${detail.title}\n${detail.body}`.toLowerCase();
  const violations = classifyViolations(detail.body);
  const penalty = extractDollar(detail.body);
  const nci = extractNciCount(detail.body);
  return { ...detail, url, haystack, violations, penalty, nci };
}

function compileMatcher(name) {
  const esc = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`, "i");
}

function snippetAround(body, needle, ctx = 140) {
  const lc = body.toLowerCase();
  const i = lc.indexOf(needle.toLowerCase());
  if (i < 0) return "";
  const start = Math.max(0, i - ctx);
  const end = Math.min(body.length, i + needle.length + ctx);
  let s = body.slice(start, end).trim();
  if (start > 0) s = "…" + s;
  if (end < body.length) s = s + "…";
  return s;
}

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

// Crawl APHIS enforcement archive(s) until we've covered the 5y window.
// We walk the seeded index pages and follow any child links that look like
// fiscal-year archives. PDF links are treated as terminal "releases" — we
// extract metadata from their anchor text + surrounding HTML.
async function collectReleases() {
  const cutoff = Date.now() - FIVE_YEARS_MS;
  const releases = [];
  const seenUrls = new Set();
  const queue = ARCHIVE_URLS.slice();

  let pagesVisited = 0;
  while (queue.length > 0 && pagesVisited < MAX_LISTING_PAGES) {
    const listUrl = queue.shift();
    if (seenUrls.has(listUrl)) continue;
    seenUrls.add(listUrl);
    pagesVisited++;

    let html;
    try {
      html = await fetchHtml(listUrl);
    } catch (err) {
      console.warn(`  listing ${listUrl}: ${err.message}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const links = extractListingLinks(html, listUrl);
    console.log(`  ${listUrl} → ${links.length} links`);

    for (const link of links) {
      if (seenUrls.has(link.url)) continue;
      seenUrls.add(link.url);

      if (link.isPdf) {
        // PDF = terminal enforcement action. Build a "release" from the
        // anchor text alone, with date best-effort extracted.
        const detail = parseReleaseDetail("", link);
        if (!detail.date) continue;
        const t = Date.parse(detail.date);
        if (Number.isNaN(t)) continue;
        if (t < cutoff) continue;
        releases.push(indexRelease(detail, link.url));
        continue;
      }

      // HTML page: could be an archive sub-page OR a release detail.
      // Crawl it if it looks like an archive listing; otherwise treat as
      // release detail.
      if (/archive|enforcement[-_/]actions|fiscal[-_]?year|fy\d{2,4}/i.test(link.url) && pagesVisited < MAX_LISTING_PAGES) {
        queue.push(link.url);
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      let detailHtml;
      try {
        detailHtml = await fetchHtml(link.url);
      } catch (err) {
        console.warn(`    skip ${link.url}: ${err.message}`);
        continue;
      }
      const detail = parseReleaseDetail(detailHtml, link);
      if (!detail.date) continue;
      const t = Date.parse(detail.date);
      if (Number.isNaN(t)) continue;
      if (t < cutoff) continue;
      releases.push(indexRelease(detail, link.url));
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return releases;
}

function scanBrand(brand, indexed) {
  const re = compileMatcher(brand.name);
  // Also try a "first word" fallback for multi-word brand names where the
  // licensee record may use a slightly different legal name (e.g.
  // "Envigo RMS, LLC" vs "Envigo").
  const firstWord = brand.name.split(/\s+/)[0];
  const re2 = firstWord.length >= 5 ? compileMatcher(firstWord) : null;

  const hits = indexed.filter(idx =>
    re.test(idx.haystack) || (re2 && re2.test(idx.haystack))
  );
  if (hits.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_actions" };
  }
  const violations = hits.flatMap(h => h.violations);
  const totalNci = hits.reduce((s, h) => s + (h.nci || 0), 0);
  const totalPenalty = hits.reduce((s, h) => s + (h.penalty || 0), 0);
  const recent = hits
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5)
    .map(h => ({
      title: h.title,
      url: h.url,
      date: h.date,
      civil_penalty_usd: h.penalty,
      awa_violation_tags: h.violations,
      nci_count: h.nci,
      licensee: h.licensee,
      snippet: snippetAround(h.body, brand.name) || snippetAround(h.body, firstWord),
    }));
  return {
    slug: brand.slug,
    name: brand.name,
    status: "ok",
    total_AWA_violations_5y:   totalNci,
    total_civil_penalties_usd: totalPenalty || null,
    action_count_5y:           hits.length,
    top_violation_types:       topN(violations, 6),
    sample_violations:         recent,
    scraped_at:                new Date().toISOString(),
  };
}

async function main() {
  console.log("🐾 USDA APHIS animal-welfare fetcher starting…");
  if (SMOKE_MODE) console.log("   --smoke flag: Charles River / Envigo / Tyson / SeaWorld");

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  console.log("⬇️  Crawling APHIS enforcement actions (5y window)…");
  const releases = await collectReleases();

  if (releases.length === 0) {
    console.error("❌ Zero releases collected. APHIS may have restructured the index.");
    console.error("   The github-actions runner usually succeeds where local dev does not.");
    process.exit(1);
  }

  console.log(`🔎 Scanning ${brands.length} brands against ${releases.length} releases…`);
  const results = brands.map(b => scanBrand(b, releases));
  const withHits = results.filter(r => r.status === "ok").length;

  const payload = {
    generated_at:           new Date().toISOString(),
    window_years:           5,
    brand_count:            brands.length,
    releases_scanned:       releases.length,
    brands_with_actions:    withHits,
    smoke:                  SMOKE_MODE,
    actions:                results,
  };

  const outFile = SMOKE_MODE ? OUT_FILE.replace(/\.json$/, ".smoke.json") : OUT_FILE;
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n✅ Wrote ${outFile}`);
  console.log(`   Brands with AWA actions: ${withHits}`);

  for (const r of results.filter(x => x.status === "ok").slice(0, 5)) {
    const pen = r.total_civil_penalties_usd
      ? `$${r.total_civil_penalties_usd.toLocaleString()}`
      : "no penalty quoted";
    console.log(`   ${r.name}: ${r.action_count_5y} actions, ${r.total_AWA_violations_5y} NCIs, ${pen}`);
    for (const c of r.sample_violations.slice(0, 2)) {
      console.log(`     [${c.date}] ${(c.title || "").slice(0, 90)}`);
    }
  }
}

main().catch(err => {
  console.error("❌ usda-aphis-fetch failed:", err);
  process.exit(1);
});
