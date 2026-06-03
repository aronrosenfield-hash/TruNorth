#!/usr/bin/env node
/**
 * NRC — Nuclear Regulatory Commission Event Reports & Enforcement Actions (weekly)
 *
 * Fetches the last 5 years of:
 *   1. Event Notification Reports
 *      https://www.nrc.gov/reading-rm/doc-collections/event-status/event/YYYY/
 *      Each year contains daily HTML pages (eYYYYMMDD.html) listing reactor
 *      events: licensee/facility, unit, event description, notification time.
 *   2. Enforcement Actions
 *      https://www.nrc.gov/reading-rm/doc-collections/enforcement/actions/YYYY/
 *      Each year contains a list of enforcement actions: licensee, action
 *      type (NOV, civil penalty, severity level), date, EA number.
 *
 * For each nuclear-operator brand in /public/data/top-500-brands.txt
 * (matched by substring + alias list), aggregates:
 *   - total_events_5y       — count of EN reports naming the licensee
 *   - total_violations_5y   — count of enforcement actions naming the licensee
 *   - top_categories        — top 5 event categories (e.g. "Power Reactor",
 *                             "Non-Emergency", "Alert", "10 CFR 50.72(b)(2)(xi)")
 *   - sample_events         — 5 most recent events (date, facility, summary)
 *   - sample_violations     — 5 most recent enforcement actions
 *
 * Output: /public/data/nrc-events.json (overwritten weekly).
 *
 * Rate limit: 1 req/sec, UA "TruNorth-NRC/1.0".
 * Runs via .github/workflows/nrc-weekly.yml Tuesday 03:00 UTC.
 * Locally: node scripts/nrc-fetch.mjs
 *
 * Notes on NRC data shape:
 *   - The "Power Reactor Status" pages list licensees like "Exelon Generation
 *     Company, LLC - Byron Station, Unit 1". We do a case-insensitive
 *     substring match on a curated list of nuclear-operator brand aliases
 *     (Exelon -> "Constellation" post-2022 spinoff, NextEra -> "Florida
 *     Power & Light", Southern -> "Southern Nuclear Operating Company",
 *     Duke -> "Duke Energy Carolinas"/"Duke Energy Florida").
 *   - We are *deliberately* generous on matching: nuclear ops were
 *     reorganized multiple times in the last 5y (Exelon -> Constellation,
 *     Entergy -> Holtec/Vistra/etc.). For the brand health score we want
 *     "events at this brand's nuclear footprint" — including historical
 *     ones for sites the brand has since divested. The merger writes
 *     this with full citation so the UI can disclose it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "public/data/nrc-events.json");

const UA = "TruNorth-NRC/1.0 (+https://www.trunorthapp.com)";
const NRC_BASE = "https://www.nrc.gov";
const EVENT_INDEX = (y) => `${NRC_BASE}/reading-rm/doc-collections/event-status/event/${y}/index.html`;
const ENF_INDEX   = (y) => `${NRC_BASE}/reading-rm/doc-collections/enforcement/actions/${y}/index.html`;

// 1 req/sec courtesy delay. NRC has no documented public rate limit.
const REQ_DELAY_MS = 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Brand -> array of NRC licensee/facility name fragments (case-insensitive
// substring match against the parsed page text). Maintained here rather than
// in /public/data/_meta/ because the mapping is NRC-specific: NRC names
// nuclear operating companies, not retail/consumer brands.
//
// 2026 ownership reality:
//   - Exelon spun off Constellation Energy (Feb 2022) — Constellation now
//     operates all of the former Exelon nuclear fleet. We map BOTH so we
//     catch pre-spinoff events under "exelon" and present-day under
//     "constellation-energy".
//   - Duke Energy operates 11 reactors at 6 sites in NC/SC/FL.
//   - Southern Company's Southern Nuclear Operating Company runs Vogtle +
//     Hatch + Farley.
//   - NextEra Energy Resources operates Seabrook, Point Beach, Duane Arnold
//     (decom), and (via FPL) Turkey Point + St. Lucie.
const NUCLEAR_OPERATORS = [
  {
    slug: "exelon",
    name: "Exelon",
    needles: [
      "exelon generation",
      "exelon nuclear",
    ],
  },
  {
    slug: "constellation-energy",
    name: "Constellation Energy",
    needles: [
      "constellation energy generation",
      "constellation energy",
    ],
  },
  {
    slug: "duke-energy",
    name: "Duke Energy",
    needles: [
      "duke energy carolinas",
      "duke energy florida",
      "duke energy progress",
      "duke energy",
    ],
  },
  {
    slug: "southern-company",
    name: "Southern Company",
    needles: [
      "southern nuclear operating",
      "southern nuclear",
      "southern company",
    ],
  },
  {
    slug: "nextera",
    name: "NextEra Energy",
    needles: [
      "nextera energy resources",
      "nextera energy",
      "florida power & light",
      "florida power and light",
      "fpl ",
    ],
  },
];

function topN(items, n = 5) {
  const counts = {};
  for (const x of items) if (x) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function trim(s, max = 280) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Strip HTML tags, decode the small set of entities NRC uses.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ");
}

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html,*/*" },
    });
    if (res.status === 404) return { ok: false, status: 404, body: "" };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, status: res.status, body: await res.text() };
  } catch (err) {
    if (attempt < 3) {
      await sleep(2000 * attempt);
      return fetchText(url, attempt + 1);
    }
    return { ok: false, status: 0, body: "", error: err.message };
  }
}

// Find all daily Event Notification HTML files linked from a year index.
// Filenames look like en20240315.html, en2024-0315.html, or
// directories like /20240315en.html — we accept any anchor whose href
// matches /event\/YYYY\/.+\.html?$/ and isn't the index itself.
function extractDailyEventLinks(yearIndexHtml, year) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"']+\.html?)["']/gi;
  let m;
  while ((m = re.exec(yearIndexHtml)) !== null) {
    const href = m[1];
    if (/index\.html?$/i.test(href)) continue;
    if (!/\.html?$/i.test(href)) continue;
    // Resolve relative
    let abs = href;
    if (href.startsWith("/")) abs = NRC_BASE + href;
    else if (!/^https?:/i.test(href)) abs = `${NRC_BASE}/reading-rm/doc-collections/event-status/event/${year}/${href}`;
    // Only keep links that look like daily event pages (digits in name)
    if (/\d{6,8}/.test(href)) out.add(abs);
  }
  return [...out];
}

// Find enforcement action page links from a year index. NRC enforcement
// year pages link to per-action HTML/PDF files named like ea-24-001.pdf
// or 2024-001.html; the year index itself usually has the licensee in
// the link text, so we also harvest the text rows.
function extractEnforcementLinks(yearIndexHtml, year) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"']+(?:\.html?|\.pdf))["']/gi;
  let m;
  while ((m = re.exec(yearIndexHtml)) !== null) {
    const href = m[1];
    if (/index\.html?$/i.test(href)) continue;
    let abs = href;
    if (href.startsWith("/")) abs = NRC_BASE + href;
    else if (!/^https?:/i.test(href)) abs = `${NRC_BASE}/reading-rm/doc-collections/enforcement/actions/${year}/${href}`;
    if (/(ea-|action|enforcement|\d{2,4})/i.test(href)) out.add(abs);
  }
  return [...out];
}

// Parse an EN daily page into structured rows. NRC EN pages are tabular
// HTML with one event per row: Facility | Region | Unit | RXType | NRC
// Notified By | Event Date/Time | Event Type | Reactor Mode | Power
// Level | Event Text. We don't need that much fidelity — we extract the
// text of each row and keep the whole row as the description, plus pull
// out an event-date and the event-type (10 CFR cite) as the category.
function parseEventNotificationPage(html, sourceUrl) {
  const text = htmlToText(html);
  // Split by "Event Number:" markers — every event in an EN report
  // begins with this header.
  const blocks = text.split(/Event\s*Number\s*:/i).slice(1);
  return blocks.map((block, idx) => {
    const eventNum = (block.match(/^\s*(\d{4,6})/) || [])[1] || null;
    const facility = (block.match(/Facility\s*:\s*([A-Z][^\n]{2,120})/i) || [])[1] || "";
    const region = (block.match(/Region\s*:\s*(\d)/i) || [])[1] || null;
    const unit = (block.match(/Unit\s*:\s*\[?([^\]\n]{1,40})\]?/i) || [])[1] || "";
    const eventDate = (block.match(/Event\s*Date\s*:\s*([0-9\/\-]{8,12})/i) || [])[1] || "";
    const eventTime = (block.match(/Event\s*Time\s*:\s*([0-9:]{4,8})/i) || [])[1] || "";
    // Notification type / 10 CFR citation, e.g. "10 CFR 50.72(b)(2)(xi)"
    const cite = (block.match(/(10\s*CFR[^\n,;]{1,60})/i) || [])[1] || "";
    const notifType = (block.match(/Notification\s*Type\s*:\s*([^\n]+)/i) || [])[1] || "";
    // The bulk of the text after the header block is the event description.
    // We trim to ~400 chars for storage.
    const desc = trim(block.slice(0, 1200), 400);
    return {
      eventNumber: eventNum,
      facility: trim(facility, 200),
      region,
      unit: trim(unit, 60),
      eventDate,
      eventTime,
      category: trim((cite || notifType).trim(), 120),
      description: desc,
      sourceUrl,
      _searchText: (facility + " " + desc + " " + unit).toLowerCase(),
    };
  }).filter(e => e.facility || e.description);
}

// Parse an enforcement action page. NRC enforcement pages have the
// licensee + facility + EA number in the header, severity level, and
// action type (NOV, civil penalty, order).
function parseEnforcementPage(html, sourceUrl) {
  const text = htmlToText(html);
  const licensee = (text.match(/Licensee\s*:\s*([^\n]{3,200})/i) || [])[1] || "";
  const facility = (text.match(/Facility\s*:\s*([^\n]{3,200})/i) || [])[1] || "";
  const ea = (text.match(/EA[-\s]*(\d{2,4}[-\s]*\d{2,4})/i) || [])[1] || "";
  const date = (text.match(/(?:Action|Issue|Date)\s*(?:Date)?\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i) || [])[1] || "";
  const severity = (text.match(/Severity\s*Level\s*[:\s]*([IV]+|[1-4])/i) || [])[1] || "";
  const actionType = (text.match(/(Notice of Violation|Civil Penalty|Confirmatory Order|Order|Chilling Effect|Discrimination)/i) || [])[1] || "";
  const desc = trim(text.slice(0, 1500), 400);

  return {
    eaNumber: ea ? `EA-${ea.replace(/\s+/g, "-")}` : null,
    licensee: trim(licensee, 200),
    facility: trim(facility, 200),
    actionDate: date,
    severityLevel: severity,
    actionType: trim(actionType, 100),
    description: desc,
    sourceUrl,
    _searchText: (licensee + " " + facility + " " + desc).toLowerCase(),
  };
}

function matchOperator(searchText) {
  const matched = [];
  for (const op of NUCLEAR_OPERATORS) {
    for (const needle of op.needles) {
      if (searchText.includes(needle.toLowerCase())) {
        matched.push(op.slug);
        break;
      }
    }
  }
  return matched;
}

async function collectEvents(years) {
  const allEvents = [];
  for (const year of years) {
    console.log(`  Events ${year}…`);
    const idx = await fetchText(EVENT_INDEX(year));
    await sleep(REQ_DELAY_MS);
    if (!idx.ok) {
      console.log(`    skip ${year} (index ${idx.status})`);
      continue;
    }
    const dailyLinks = extractDailyEventLinks(idx.body, year);
    console.log(`    ${dailyLinks.length} daily reports`);
    for (let i = 0; i < dailyLinks.length; i++) {
      const link = dailyLinks[i];
      const page = await fetchText(link);
      await sleep(REQ_DELAY_MS);
      if (!page.ok) continue;
      const events = parseEventNotificationPage(page.body, link);
      // Tag year (used in aggregates) from the URL
      const yearTag = (link.match(/(\d{4})/) || [])[1] || String(year);
      for (const e of events) {
        e.year = Number(yearTag);
        e.matchedOperators = matchOperator(e._searchText);
        if (e.matchedOperators.length) allEvents.push(e);
      }
      if (i && i % 25 === 0) console.log(`      …${i}/${dailyLinks.length}`);
    }
  }
  return allEvents;
}

async function collectEnforcement(years) {
  const allActions = [];
  for (const year of years) {
    console.log(`  Enforcement ${year}…`);
    const idx = await fetchText(ENF_INDEX(year));
    await sleep(REQ_DELAY_MS);
    if (!idx.ok) {
      console.log(`    skip ${year} (index ${idx.status})`);
      continue;
    }
    // The year-index page itself often contains the licensee/EA-number
    // table in plain HTML — try parsing it first.
    const idxText = htmlToText(idx.body);
    // Each row roughly: "EA-24-001 — Licensee Name — Date — Severity"
    const rowRe = /EA[-\s]*(\d{2,4}[-\s]*\d{2,4})[^\n]{0,400}/gi;
    let m;
    while ((m = rowRe.exec(idxText)) !== null) {
      const row = m[0];
      const ea = m[1];
      const desc = trim(row, 400);
      const search = row.toLowerCase();
      const matchedOperators = matchOperator(search);
      if (matchedOperators.length) {
        allActions.push({
          eaNumber: `EA-${ea.replace(/\s+/g, "-")}`,
          licensee: "",
          facility: "",
          actionDate: "",
          severityLevel: "",
          actionType: "",
          description: desc,
          year,
          sourceUrl: ENF_INDEX(year),
          matchedOperators,
        });
      }
    }

    // Then also walk per-action linked pages for richer detail (cap at 80/year)
    const links = extractEnforcementLinks(idx.body, year).slice(0, 80);
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (link.endsWith(".pdf")) continue; // we can't extract text from PDFs here
      const page = await fetchText(link);
      await sleep(REQ_DELAY_MS);
      if (!page.ok) continue;
      const action = parseEnforcementPage(page.body, link);
      action.year = year;
      action.matchedOperators = matchOperator(action._searchText);
      if (action.matchedOperators.length) allActions.push(action);
    }
  }
  // De-dup by eaNumber, keeping the richer (longer description) record.
  const byEa = new Map();
  for (const a of allActions) {
    if (!a.eaNumber) { byEa.set(Symbol(), a); continue; }
    const prev = byEa.get(a.eaNumber);
    if (!prev || (a.description?.length || 0) > (prev.description?.length || 0)) {
      byEa.set(a.eaNumber, a);
    }
  }
  return [...byEa.values()];
}

function aggregateForOperator(slug, events, actions) {
  const myEvents  = events.filter(e => e.matchedOperators.includes(slug));
  const myActions = actions.filter(a => a.matchedOperators.includes(slug));

  // Sort newest first by year + eventDate (best-effort)
  const byDate = (a, b) =>
    (b.year || 0) - (a.year || 0) ||
    String(b.eventDate || b.actionDate || "").localeCompare(String(a.eventDate || a.actionDate || ""));
  myEvents.sort(byDate);
  myActions.sort(byDate);

  return {
    total_events_5y:     myEvents.length,
    total_violations_5y: myActions.length,
    top_categories:      topN(myEvents.map(e => e.category).filter(Boolean), 5),
    top_action_types:    topN(myActions.map(a => a.actionType).filter(Boolean), 5),
    sample_events:       myEvents.slice(0, 5).map(e => ({
      eventNumber:  e.eventNumber,
      facility:     e.facility,
      unit:         e.unit,
      eventDate:    e.eventDate,
      category:     e.category,
      description:  e.description,
      sourceUrl:    e.sourceUrl,
    })),
    sample_violations:   myActions.slice(0, 5).map(a => ({
      eaNumber:       a.eaNumber,
      licensee:       a.licensee,
      facility:       a.facility,
      actionDate:     a.actionDate,
      severityLevel:  a.severityLevel,
      actionType:     a.actionType,
      description:    a.description,
      sourceUrl:      a.sourceUrl,
    })),
  };
}

async function main() {
  console.log("📋 NRC fetcher starting…");
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4];
  console.log(`Years: ${years.join(", ")}`);

  const events  = await collectEvents(years);
  console.log(`Collected ${events.length} matching event records`);

  const actions = await collectEnforcement(years);
  console.log(`Collected ${actions.length} matching enforcement actions`);

  const operators = NUCLEAR_OPERATORS.map(op => {
    const agg = aggregateForOperator(op.slug, events, actions);
    const status =
      agg.total_events_5y === 0 && agg.total_violations_5y === 0
        ? "no_records"
        : "ok";
    return {
      slug:   op.slug,
      name:   op.name,
      status,
      ...agg,
      scraped_at: new Date().toISOString(),
    };
  });

  const withRecords = operators.filter(o => o.status === "ok").length;

  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:        new Date().toISOString(),
    years_covered:       years,
    operator_count:      operators.length,
    with_records_count:  withRecords,
    operators,
  }, null, 2));

  console.log(`\n✅ Wrote ${OUT_FILE}`);
  for (const o of operators) {
    console.log(`   ${o.slug.padEnd(25)} events=${o.total_events_5y} violations=${o.total_violations_5y} (${o.status})`);
  }
}

main().catch(err => {
  console.error("❌ nrc-fetch failed:", err);
  process.exit(1);
});
