#!/usr/bin/env node
/**
 * ToS;DR fetcher (E-2 / Lever 4c, 2026-06-11).
 *
 * Pulls every service from api.tosdr.org/service/v3 (paginated) and keeps the
 * ones with a real letter rating (A–E). Writes public/data/tosdr.json.
 *
 * LICENSE (verified 2026-06-11): the ToS;DR dataset is CC BY-SA 3.0. We ingest
 * GRADES ONLY (uncopyrightable facts) and attribute — we do NOT ingest or
 * display their point/case prose, which is what share-alike would attach to.
 * Attribution renders in the privacy narrative + Sources tab. Guest API tier:
 * 15 req/s, 15,000/day — full crawl is ~25 pages, far inside limits.
 *
 * UA + politeness per repo convention (1 req/sec).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/data/tosdr.json");
const UA = "TruNorth-TOSDR/1.0 (data pipeline; contact@trunorthapp.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RATED = new Set(["A", "B", "C", "D", "E"]);
// Page-level resume cache — the guest tier's hourly window can interrupt a
// full crawl; completed pages are never refetched within 7 days.
const CACHE_DIR = path.join(ROOT, "data/raw/tosdr");
const PAGE_CACHE = path.join(CACHE_DIR, "pages.json");
fs.mkdirSync(CACHE_DIR, { recursive: true });
let pageCache = {};
try {
  const pc = JSON.parse(fs.readFileSync(PAGE_CACHE, "utf8"));
  if (Date.parse(pc.fetchedAt || 0) > Date.now() - 7 * 24 * 3600 * 1000) pageCache = pc.pages || {};
} catch {}
const services = [];
let page = 1;
let kept = 0, seen = 0;

let backoffs = 0;
for (;;) {
  let json;
  if (pageCache[page]) {
    json = pageCache[page];
  } else {
    const res = await fetch(`https://api.tosdr.org/service/v3/?page=${page}`, {
      headers: { "User-Agent": UA },
    });
    if (res.status === 429) {
      // The hourly guest window (1,000 req/hr) is the real limiter — wait it
      // out in 10-minute steps. Page cache means interrupted runs resume.
      if (++backoffs > 8) throw new Error(`tosdr: still 429 after ${backoffs} long backoffs at page ${page} — resume later, pages cached`);
      process.stdout.write(`\r[tosdr] 429 on page ${page} — waiting 10 min (${backoffs}/8)   `);
      await sleep(10 * 60 * 1000);
      continue;
    }
    if (!res.ok) {
      // API returns 400 (not 404) for a page past the end — both mean done.
      if (res.status === 404 || res.status === 400) break;
      throw new Error(`tosdr page ${page}: HTTP ${res.status}`);
    }
    backoffs = 0;
    json = await res.json();
    pageCache[page] = { services: (json.services || []).map(s => ({ id: s.id, name: s.name, slug: s.slug, rating: s.rating, is_comprehensively_reviewed: s.is_comprehensively_reviewed, urls: s.urls })) };
    fs.writeFileSync(PAGE_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), pages: pageCache }));
  }
  const batch = Array.isArray(json.services) ? json.services : [];
  if (batch.length === 0) break;
  seen += batch.length;
  for (const s of batch) {
    const rating = String(s.rating || "").toUpperCase();
    if (!RATED.has(rating)) continue;
    services.push({
      id: s.id,
      name: s.name,
      tosdrSlug: s.slug,
      rating,
      reviewed: !!s.is_comprehensively_reviewed,
      urls: Array.isArray(s.urls) ? s.urls.slice(0, 5) : [],
    });
    kept++;
  }
  process.stdout.write(`\r[tosdr] page ${page} · seen ${seen} · rated ${kept}   `);
  page++;
  await sleep(1000);
}

// Guard convention (B-60/61/62): never overwrite a good snapshot with a
// suspiciously empty one — a sandboxed/no-network run must fail loudly.
if (kept < 50) {
  console.error(`\n[tosdr] FATAL: only ${kept} rated services — refusing to write (expected hundreds). Network or API problem?`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  source: "ToS;DR (tosdr.org)",
  license: "CC BY-SA 3.0 — grades ingested as facts with attribution; point/case texts NOT ingested",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  fetchedAt: new Date().toISOString(),
  count: services.length,
  services,
}, null, 2));
console.log(`\n[tosdr] wrote ${services.length} rated services to public/data/tosdr.json`);
