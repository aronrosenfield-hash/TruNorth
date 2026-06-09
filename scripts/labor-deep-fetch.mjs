#!/usr/bin/env node
/**
 * Labor Deep Enrichment fetcher (round 4).
 *
 * Pulls per-brand labor-rights and labor-enforcement data from a curated set
 * of public, civil-society and academic sources that round 3 did NOT cover
 * at depth:
 *
 *   1. Fair Labor Association (FLA) — live REST API walk of fairlabor.org.
 *      Replaces the previously hand-curated 19-entry FLA stub with the full
 *      2026 affiliate roster (~205 brands across "accredited", "participating",
 *      "single-factory", "collegiate-licensee" categories). POSITIVE labor
 *      signal — voluntary uptake of independent monitoring.
 *      Endpoint: https://www.fairlabor.org/wp-json/fla/v1/members?page=N
 *      Source page: https://www.fairlabor.org/members/
 *
 *   2. Worker Rights Consortium (WRC) factory investigations — curated list
 *      of brand-specific accountability findings from
 *      https://www.workersrights.org/factory-investigations/ . Each record
 *      cites the WRC investigation URL. NEGATIVE.
 *
 *   3. Clean Clothes Campaign (CCC) Transparency Pledge signatories —
 *      brands that committed to publishing tier-1 supplier disclosure per
 *      the CCC pledge.  POSITIVE.
 *      Source: https://cleanclothes.org/file-repository/transparency-transparency-pledge
 *
 *   4. Human Rights Watch (HRW) corporate accountability callouts — brand-
 *      named investigations from https://www.hrw.org/business . Each record
 *      cites the specific HRW report URL.  NEGATIVE.
 *
 *   5. International Labor Rights Forum (ILRF) corporate target campaigns —
 *      ongoing brand callouts on https://laborrights.org .  NEGATIVE.
 *
 * Architecture: this is a single "deep" fetcher that emits ONE raw snapshot
 * combining all sub-sources. The merger downstream routes each sub-source's
 * records into its own per-source augment file, keeping the apply-augments
 * writer mapping clean (one writer per source name).
 *
 * RUN MODES:
 *   node scripts/labor-deep-fetch.mjs                      # live FLA + bundled curated
 *   node scripts/labor-deep-fetch.mjs --fixture            # offline / fixture
 *   node scripts/labor-deep-fetch.mjs --skip-fla           # use bundled FLA snapshot
 *   node scripts/labor-deep-fetch.mjs --limit 50           # cap FLA pages
 *   node scripts/labor-deep-fetch.mjs --out /tmp/out.json  # alt output path
 *
 * OUTPUT  data/raw/labor-deep/<YYYY-MM-DD>.json:
 *   {
 *     _generated_at,
 *     _sources: {
 *       fla:      { url, status, count, fetched: bool, signal: "positive" },
 *       wrc:      { url, count, mode: "curated", signal: "negative" },
 *       ccc:      { url, count, mode: "curated", signal: "positive" },
 *       hrw:      { url, count, mode: "curated", signal: "negative" },
 *       ilrf:     { url, count, mode: "curated", signal: "negative" },
 *     },
 *     fla_members:     [{ name, status, category, source_url }],
 *     wrc_findings:    [{ brand, factory, country, year, finding, source_url }],
 *     ccc_signatories: [{ brand, year, source_url }],
 *     hrw_reports:     [{ brand, year, title, source_url, severity }],
 *     ilrf_campaigns:  [{ brand, campaign, year, source_url }],
 *   }
 *
 * THROTTLE: 1.2s between FLA API pages. Hard cap of 20 pages (~400 members,
 * comfortably above the present roster).  Curated sub-sources do no network IO.
 *
 * CONSERVATIVE SEVERITY (per spec):
 *   - WRC/HRW/ILRF findings are flagged severity "negative" only when they
 *     involve a documented finding, fatality, mass dismissal, or pattern of
 *     violations.  Procedural notices alone are not promoted to negative.
 *   - FLA & CCC entries are explicit "positive" signals — voluntary uptake
 *     of independent monitoring / public disclosure regimes.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CURATED_WRC, CURATED_CCC, CURATED_HRW, CURATED_ILRF, BUNDLED_FLA,
} from "./labor-deep-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/labor-deep");
const FIXTURE_DIR = path.join(ROOT, "test/fixtures/labor-deep");

const UA = "TruNorth-LaborDeep/1.0 (+https://www.trunorthapp.com; labor rights enrichment)";
const FLA_API_BASE = "https://www.fairlabor.org/wp-json/fla/v1/members";
const FLA_SOURCE_URL = "https://www.fairlabor.org/members/all-members/";
const REQ_DELAY_MS = 1200;
const MAX_FLA_PAGES = 20;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------- arg parsing */

export function parseArgs(argv) {
  const opt = { fixture: false, skipFla: false, limit: MAX_FLA_PAGES, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fixture") opt.fixture = true;
    else if (a === "--skip-fla") opt.skipFla = true;
    else if (a === "--limit") {
      const v = Number(argv[++i]);
      opt.limit = Number.isFinite(v) ? Math.max(1, Math.min(50, v)) : MAX_FLA_PAGES;
    }
    else if (a === "--out") opt.outPath = argv[++i];
  }
  return opt;
}

/* ---------------------------------------------------------- FLA fetcher */

async function fetchJson(url, fixtureName, fixtureMode, attempt = 0) {
  if (fixtureMode) {
    const p = path.join(FIXTURE_DIR, `${fixtureName}.json`);
    if (existsSync(p)) {
      try { return { ok: true, json: JSON.parse(await fs.readFile(p, "utf-8")) }; }
      catch (e) { return { ok: false, error: `fixture parse: ${e.message}` }; }
    }
    return { ok: true, json: { html: "", count: 0, foundPosts: 0, nextUrl: null } };
  }
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    if (!res.ok) {
      if (attempt < 2 && (res.status === 503 || res.status === 429)) {
        await sleep(2000 * Math.pow(2, attempt));
        return fetchJson(url, fixtureName, fixtureMode, attempt + 1);
      }
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true, json: await res.json() };
  } catch (err) {
    if (attempt < 2) {
      await sleep(1500 * Math.pow(2, attempt));
      return fetchJson(url, fixtureName, fixtureMode, attempt + 1);
    }
    return { ok: false, error: `network:${err.message}` };
  }
}

/**
 * Parse one FLA REST `html` payload into `{ name, status, source_url }`
 * records. The payload is server-rendered Plone-style HTML — we extract the
 * member name from `h3.members-logo-card__name` and the company-type tag
 * from `div.members-logo-card__company-type`.  Tolerant to unicode entities.
 */
export function parseFlaPage(payload) {
  const html = String(payload?.html || "");
  if (!html.trim()) return [];

  const rows = [];

  // Each card is wrapped in <li class="members-logo-card ...">…</li>.
  const liRe = /<li\b[^>]*class="[^"]*\bmembers-logo-card\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = liRe.exec(html)) !== null) {
    const inner = m[1];
    const nameMatch = /<h3\b[^>]*class="[^"]*\bmembers-logo-card__name\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/i.exec(inner);
    const typeMatch = /<div\b[^>]*class="[^"]*\bmembers-logo-card__company-type\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(inner);
    // Order-tolerant: href + members-logo-card__link class in either order.
    const linkMatch =
      /<a\b[^>]*class="[^"]*\bmembers-logo-card__link\b[^"]*"[^>]*href="([^"]+)"/i.exec(inner)
      || /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*\bmembers-logo-card__link\b[^"]*"/i.exec(inner);
    if (!nameMatch) continue;
    const name = decodeHtml(stripTags(nameMatch[1])).trim();
    if (!name || name.length > 150) continue;
    const rawType = typeMatch ? decodeHtml(stripTags(typeMatch[1])).trim() : "";
    const status = classifyStatus(rawType);
    const category = classifyCategory(rawType);
    rows.push({
      name,
      status,
      category,
      raw_type: rawType || null,
      source_url: linkMatch ? absUrl(linkMatch[1]) : FLA_SOURCE_URL,
    });
  }
  return rows;
}

function absUrl(href) {
  if (!href) return FLA_SOURCE_URL;
  if (/^https?:/.test(href)) return href;
  return `https://www.fairlabor.org${href.startsWith("/") ? "" : "/"}${href}`;
}

const NAMED = {
  amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ",
  rsquo:"’", lsquo:"‘", rdquo:"”", ldquo:"“",
};
export function decodeHtml(s) {
  if (!s) return "";
  return s
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}
export function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Map FLA's free-form "company-type" string to the enum we surface
 * downstream. Common forms include:
 *   - "Fair Labor Accredited, Participating Company"
 *   - "Participating Company"
 *   - "Affiliate"
 *   - "Single Factory Supplier"
 *   - "Collegiate Licensee"
 *   - "College or University"
 *   - "Civil Society Organization"
 */
export function classifyStatus(raw) {
  const t = (raw || "").toLowerCase();
  if (/accredited/.test(t))                       return "accredited";
  if (/single\s+factory/.test(t))                 return "single-factory-supplier";
  if (/collegiate\s+(licensee|retailer)/.test(t)) return "collegiate-licensee";
  if (/participating\s+(company|brand)/.test(t))  return "participating";
  if (/affiliate/.test(t))                        return "affiliate";
  if (/college|university/.test(t))               return "university";
  if (/civil\s+society|cso/.test(t))              return "civil-society";
  return "member";
}

export function classifyCategory(raw) {
  const t = (raw || "").toLowerCase();
  if (/college|university|collegiate/.test(t)) return "education";
  if (/civil\s+society|cso/.test(t)) return "civil-society";
  return "company";
}

/**
 * Walk paginated FLA REST until empty / hard cap. The API returns
 * `{ html, count, foundPosts, nextUrl }`. We stop on count===0 or limit.
 */
export async function fetchFlaAll(opt = {}) {
  const limit = opt.limit ?? MAX_FLA_PAGES;
  const fixtureMode = !!opt.fixture;
  const all = [];
  const sourceLog = [];
  let page = 1;
  while (page <= limit) {
    const url = `${FLA_API_BASE}?page=${page}`;
    const res = await fetchJson(url, `fla-page-${page}`, fixtureMode);
    if (!res.ok) {
      sourceLog.push({ url, status: "error", error: res.error, page });
      break;
    }
    const count = Number(res.json?.count || 0);
    sourceLog.push({ url, status: count > 0 ? "ok" : "empty", count, page });
    if (count <= 0) break;
    const rows = parseFlaPage(res.json);
    all.push(...rows);
    page++;
    if (!fixtureMode && count > 0) await sleep(REQ_DELAY_MS);
  }
  // Dedupe by lowercase name. Prefer accredited > participating > other when
  // a name appears multiple times (e.g. paging transitions).
  const seen = new Map();
  const RANK = {
    "accredited": 0, "participating": 1, "single-factory-supplier": 2,
    "affiliate": 3, "collegiate-licensee": 4,
  };
  for (const r of all) {
    const k = r.name.toLowerCase();
    if (!seen.has(k)) { seen.set(k, r); continue; }
    const ex = seen.get(k);
    if ((RANK[r.status] ?? 5) < (RANK[ex.status] ?? 5)) seen.set(k, r);
  }
  return { rows: [...seen.values()], sourceLog };
}

/* --------------------------------------------------- snapshot builder */

export function buildSnapshot({ flaRows, flaSourceLog, flaFetched, curated }) {
  const c = curated || {
    wrc: CURATED_WRC,
    ccc: CURATED_CCC,
    hrw: CURATED_HRW,
    ilrf: CURATED_ILRF,
  };
  return {
    _license: "Aggregated under fair-use — each record cites its primary public source URL.",
    _generated_at: new Date().toISOString(),
    _doc: "Labor-deep enrichment round 4. Combines live FLA REST API + curated brand-named callouts from WRC, CCC, HRW, ILRF.",
    _sources: {
      fla: {
        url: FLA_SOURCE_URL,
        api_base: FLA_API_BASE,
        count: flaRows.length,
        fetched: !!flaFetched,
        signal: "positive",
        pages: flaSourceLog,
      },
      wrc: {
        url: "https://www.workersrights.org/factory-investigations/",
        count: c.wrc.length,
        mode: "curated",
        signal: "negative",
      },
      ccc: {
        url: "https://cleanclothes.org/file-repository/transparency-transparency-pledge",
        count: c.ccc.length,
        mode: "curated",
        signal: "positive",
      },
      hrw: {
        url: "https://www.hrw.org/business",
        count: c.hrw.length,
        mode: "curated",
        signal: "negative",
      },
      ilrf: {
        url: "https://laborrights.org/",
        count: c.ilrf.length,
        mode: "curated",
        signal: "negative",
      },
    },
    fla_members: flaRows,
    wrc_findings: c.wrc,
    ccc_signatories: c.ccc,
    hrw_reports: c.hrw,
    ilrf_campaigns: c.ilrf,
  };
}

/* ------------------------------------------------------------------ main */

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  console.log(`labor-deep fetch starting (fixture=${opt.fixture}, skipFla=${opt.skipFla})`);
  await fs.mkdir(RAW_DIR, { recursive: true });

  let flaRows = [];
  let flaSourceLog = [];
  let flaFetched = false;
  if (opt.skipFla) {
    flaRows = BUNDLED_FLA;
    flaSourceLog = [{ url: FLA_SOURCE_URL, status: "skipped", note: "--skip-fla; used bundled snapshot" }];
  } else {
    try {
      const { rows, sourceLog } = await fetchFlaAll({ fixture: opt.fixture, limit: opt.limit });
      if (rows.length >= 5) {
        flaRows = rows;
        flaSourceLog = sourceLog;
        flaFetched = true;
      } else {
        console.warn(`  FLA live fetch returned ${rows.length} rows — falling back to bundled snapshot.`);
        flaRows = BUNDLED_FLA;
        flaSourceLog = [...sourceLog, { url: FLA_SOURCE_URL, status: "fallback", note: "live yield <5; used bundled" }];
      }
    } catch (err) {
      console.warn(`  FLA live fetch threw — falling back to bundled snapshot: ${err.message}`);
      flaRows = BUNDLED_FLA;
      flaSourceLog = [{ url: FLA_SOURCE_URL, status: "fallback", error: err.message }];
    }
  }

  const snapshot = buildSnapshot({ flaRows, flaSourceLog, flaFetched });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = opt.outPath || path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`\nFLA members:        ${snapshot._sources.fla.count} (fetched=${flaFetched})`);
  console.log(`WRC findings:       ${snapshot._sources.wrc.count}`);
  console.log(`CCC signatories:    ${snapshot._sources.ccc.count}`);
  console.log(`HRW reports:        ${snapshot._sources.hrw.count}`);
  console.log(`ILRF campaigns:     ${snapshot._sources.ilrf.count}`);
  console.log(`\nWrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("labor-deep-fetch failed:", err); process.exit(1); });
}
