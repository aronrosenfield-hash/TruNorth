#!/usr/bin/env node
/**
 * HHS OIG (Office of Inspector General) enforcement integration.
 *
 * Two data sources:
 *
 *   1. LEIE — List of Excluded Individuals/Entities (CSV bulk download).
 *      Single CSV with ~83k rows of providers excluded from Medicare/Medicaid.
 *      We index by BUSNAME and match brand display names (and child entity
 *      names from brand-parent-map) via case-insensitive substring.
 *
 *      https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv
 *
 *   2. Enforcement actions — paginated HTML list of fraud actions.
 *      Each page has ~10 cards: title, URL, date, type tags.
 *      We walk pages until we cross the 24-month cutoff (~110 pages).
 *
 *      https://oig.hhs.gov/fraud/enforcement/?page=N
 *
 * For each of 528 brands we emit:
 *   {
 *     slug, name,
 *     is_excluded:            bool,
 *     exclusion_count:        number,
 *     exclusion_sample:       [{ busname, exclDate, exclType, state, city }],
 *     recent_fraud_actions_24mo: number,
 *     sample_actions:         [{ date, title, action_type, fine_amount, url }]
 *   }
 *
 * Output: /public/data/hhs-oig.json (overwritten monthly).
 *
 * Run: node scripts/hhs-oig-fetch.mjs                # full run (528 brands)
 *      node scripts/hhs-oig-fetch.mjs --smoke         # 3-brand smoke test
 *      node scripts/hhs-oig-fetch.mjs --max-pages=20  # limit enforcement crawl
 *
 * Runs via .github/workflows/hhs-oig-monthly.yml — 1st of month, 03:00 UTC.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const META_DIR    = path.join(ROOT, "public/data/_meta");
const OUT_FILE    = path.join(ROOT, "public/data/hhs-oig.json");

const UA = "TruNorth-HHS-OIG/1.0 (+https://www.trunorthapp.com)";
const LEIE_URL = "https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv";
const ENFORCE_URL = "https://oig.hhs.gov/fraud/enforcement/";
const TWENTY_FOUR_MO_MS = 24 * 30 * 24 * 60 * 60 * 1000;

const SMOKE_SLUGS = new Set(["johnson-johnson", "pfizer", "unitedhealth"]);

// ────────────────────────────────────────────────────────────────────────
// Argument parsing
// ────────────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const SMOKE = ARGS.includes("--smoke");
const MAX_PAGES_ARG = ARGS.find(a => a.startsWith("--max-pages="));
const MAX_PAGES = MAX_PAGES_ARG ? parseInt(MAX_PAGES_ARG.split("=")[1], 10) : null;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return fetchText(url, attempt + 1);
    }
    throw err;
  }
}

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw.split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map(l => {
      const [slug, name, category] = l.split("|").map(s => s.trim());
      return { slug, name, category };
    })
    .filter(b => b.slug && b.name);
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

// Build list of name variants per brand to widen substring matching.
// Pulls in child entity names from brand-parent-map if any child resolves
// to this slug as parent.
function buildBrandAliases(brands, maps) {
  // Reverse-index brand-parent-map: parent slug → [child names]
  const childrenByParent = {};
  for (const [childSlug, entry] of Object.entries(maps.parents || {})) {
    const parentSlug = entry?.parent;
    if (!parentSlug) continue;
    (childrenByParent[parentSlug] ||= []).push(entry.name || childSlug);
  }
  // Reverse-index slug-aliases: target slug → [alias slug-as-readable]
  const aliasesBySlug = {};
  for (const [aliasSlug, targetSlug] of Object.entries(maps.aliases || {})) {
    (aliasesBySlug[targetSlug] ||= []).push(aliasSlug.replace(/-/g, " "));
  }

  return brands.map(b => {
    const names = new Set([b.name]);
    // Strip common corporate suffixes for matching, but keep originals too
    for (const child of childrenByParent[b.slug] || []) names.add(child);
    for (const alias of aliasesBySlug[b.slug] || []) names.add(alias);
    return { ...b, matchNames: [...names] };
  });
}

// Cheap, robust CSV parser for the LEIE file (handles quoted fields).
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function loadLeie() {
  console.log("⬇  Downloading LEIE CSV…");
  const res = await fetch(LEIE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`LEIE download failed: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map(h => h.trim().toUpperCase());
  const busIdx = header.indexOf("BUSNAME");
  const idx = {
    BUSNAME: header.indexOf("BUSNAME"),
    EXCLDATE: header.indexOf("EXCLDATE"),
    EXCLTYPE: header.indexOf("EXCLTYPE"),
    CITY: header.indexOf("CITY"),
    STATE: header.indexOf("STATE"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = parseCsvLine(lines[i]);
    const bus = (cells[busIdx] || "").trim();
    if (!bus) continue;
    rows.push({
      busname:  bus,
      busLower: bus.toLowerCase(),
      exclDate: cells[idx.EXCLDATE] || "",
      exclType: cells[idx.EXCLTYPE] || "",
      city:     cells[idx.CITY] || "",
      state:    cells[idx.STATE] || "",
    });
  }
  console.log(`   ${rows.length} LEIE business-entity exclusions loaded`);
  return rows;
}

// Parse one enforcement-action listing page. Returns array of
// { title, url, date (ms), dateStr, actionTypes[] }.
function parseEnforcementPage(html) {
  const cards = [];
  // Cards look like:
  //   <h2 class="usa-card__heading"><a href="…">Title</a></h2>
  //   …
  //   <span class="text-base-dark padding-right-105">June 2, 2026</span>
  //   <ul …><li …>Criminal and Civil Actions</li>…</ul>
  const headRe = /<h2 class="usa-card__heading">\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/h2>([\s\S]*?)<\/header>/g;
  let m;
  while ((m = headRe.exec(html)) !== null) {
    const url   = m[1];
    const title = m[2].trim();
    const tail  = m[3];
    const dateM = /text-base-dark padding-right-105">([^<]+)</.exec(tail);
    const dateStr = dateM ? dateM[1].trim() : "";
    const dateMs = dateStr ? Date.parse(dateStr) : NaN;
    const types = [];
    const tagRe = /<li class="display-inline-block usa-tag[^"]*"[^>]*>([^<]+)<\/li>/g;
    let tm;
    while ((tm = tagRe.exec(tail)) !== null) types.push(tm[1].trim());
    cards.push({
      title,
      url:     url.startsWith("http") ? url : `https://oig.hhs.gov${url}`,
      dateStr,
      dateMs,
      actionTypes: types,
    });
  }
  return cards;
}

// Walk enforcement pages until we cross the 24-month cutoff or hit the
// safety cap. 1 req / sec.
async function crawlEnforcement() {
  console.log("⬇  Crawling enforcement actions (24mo window)…");
  const cutoff = Date.now() - TWENTY_FOUR_MO_MS;
  const cap = MAX_PAGES ?? 140;
  const all = [];
  for (let page = 1; page <= cap; page++) {
    const url = `${ENFORCE_URL}?page=${page}`;
    let html;
    try { html = await fetchText(url); }
    catch (err) {
      console.warn(`   page ${page}: fetch failed (${err.message}), stopping`);
      break;
    }
    const cards = parseEnforcementPage(html);
    if (cards.length === 0) { console.log(`   page ${page}: 0 cards, stopping`); break; }
    all.push(...cards);
    const oldest = cards.reduce((a, c) => Math.min(a, c.dateMs || a), Infinity);
    if (page % 10 === 0 || page === 1) {
      const newest = cards[0]?.dateStr || "?";
      console.log(`   page ${page}: +${cards.length} (newest: ${newest})`);
    }
    if (Number.isFinite(oldest) && oldest < cutoff) {
      console.log(`   crossed 24mo cutoff on page ${page}, stopping`);
      break;
    }
    await sleep(1000);
  }
  // Drop anything older than cutoff
  const filtered = all.filter(c => Number.isFinite(c.dateMs) && c.dateMs >= cutoff);
  console.log(`   ${all.length} cards crawled, ${filtered.length} within 24mo`);
  return filtered;
}

// Extract dollar amount from action title (e.g. "Pay Over $2M", "$32M",
// "$11.2 Million", "$190,000", "1.5 billion"). Returns USD as number or null.
function extractFineAmount(title) {
  // $<num>[.<num>] (M|B|Million|Billion)
  const m1 = /\$([\d,]+(?:\.\d+)?)\s*(M|B|K|million|billion|thousand)\b/i.exec(title);
  if (m1) {
    const v = parseFloat(m1[1].replace(/,/g, ""));
    const u = m1[2].toLowerCase();
    if (u.startsWith("b")) return v * 1e9;
    if (u.startsWith("m")) return v * 1e6;
    if (u.startsWith("k") || u.startsWith("t")) return v * 1e3;
  }
  // Bare $123,456 / $1,234,567
  const m2 = /\$([\d]{1,3}(?:,\d{3})+(?:\.\d+)?)/.exec(title);
  if (m2) return parseFloat(m2[1].replace(/,/g, ""));
  return null;
}

// Case-insensitive substring match: does any name in `names` appear in `text`?
// Returns the longest matching name (best signal) or null.
function matchAny(textLower, names) {
  let best = null;
  for (const name of names) {
    if (!name) continue;
    const nLower = name.toLowerCase();
    // Skip 1-word generic names (e.g. "Target", "Apple") — too noisy here.
    // Heuristic: require >= 4 chars and either multi-word or distinctive.
    if (nLower.length < 4) continue;
    if (textLower.includes(nLower)) {
      if (!best || nLower.length > best.length) best = name;
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────────────────────
// Match per-brand
// ────────────────────────────────────────────────────────────────────────
function matchBrand(brand, leie, actions) {
  const names = brand.matchNames || [brand.name];

  // LEIE: count business entities whose BUSNAME contains any brand name.
  const exclusionMatches = [];
  for (const row of leie) {
    if (matchAny(row.busLower, names)) exclusionMatches.push(row);
  }

  // Enforcement actions: titles containing any brand name.
  const actionMatches = [];
  for (const a of actions) {
    if (matchAny(a.title.toLowerCase(), names)) actionMatches.push(a);
  }
  actionMatches.sort((a, b) => b.dateMs - a.dateMs);

  return {
    slug: brand.slug,
    name: brand.name,
    is_excluded: exclusionMatches.length > 0,
    exclusion_count: exclusionMatches.length,
    exclusion_sample: exclusionMatches.slice(0, 5).map(r => ({
      busname:  r.busname,
      exclDate: r.exclDate,
      exclType: r.exclType,
      city:     r.city,
      state:    r.state,
    })),
    recent_fraud_actions_24mo: actionMatches.length,
    sample_actions: actionMatches.slice(0, 5).map(a => ({
      date:        a.dateStr,
      title:       a.title,
      action_type: a.actionTypes[0] || null,
      fine_amount: extractFineAmount(a.title),
      url:         a.url,
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("📋 HHS OIG fetcher starting…");
  if (SMOKE) console.log("   (smoke-test mode: 3 brands)");

  const allBrands = await loadBrands();
  const maps = await loadMaps();
  const brandsWithAliases = buildBrandAliases(allBrands, maps);
  const brands = SMOKE
    ? brandsWithAliases.filter(b => SMOKE_SLUGS.has(b.slug))
    : brandsWithAliases;
  console.log(`   ${brands.length} brand(s) to match`);

  const leie    = await loadLeie();
  await sleep(1000);
  const actions = await crawlEnforcement();

  const results = brands.map(b => matchBrand(b, leie, actions));

  const excluded   = results.filter(r => r.is_excluded).length;
  const withAction = results.filter(r => r.recent_fraud_actions_24mo > 0).length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:               new Date().toISOString(),
    brand_count:                brands.length,
    leie_rows:                  leie.length,
    enforcement_actions_24mo:   actions.length,
    excluded_brand_count:       excluded,
    with_recent_action_count:   withAction,
    sources: {
      leie:              LEIE_URL,
      enforcement_index: ENFORCE_URL,
    },
    results,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  console.log(`   Brands with exclusion match: ${excluded}`);
  console.log(`   Brands with recent action:   ${withAction}`);

  if (SMOKE) {
    console.log("\nSmoke results:");
    for (const r of results) {
      console.log(`  ${r.slug}: excluded=${r.is_excluded} (×${r.exclusion_count}), recent24mo=${r.recent_fraud_actions_24mo}`);
      if (r.sample_actions[0]) {
        console.log(`    most recent: ${r.sample_actions[0].date} — ${r.sample_actions[0].title.slice(0, 80)}`);
      }
    }
  }
}

main().catch(err => {
  console.error("❌ hhs-oig-fetch failed:", err);
  process.exit(1);
});
