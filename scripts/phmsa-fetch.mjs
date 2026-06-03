#!/usr/bin/env node
/**
 * PHMSA — Pipeline & Hazardous Materials Safety Administration (weekly)
 *
 * Per brand, queries PHMSA's public enforcement + incident data for pipeline
 * safety actions tied to that operator. Replaces nothing (new source).
 *
 * Output: /public/data/phmsa-incidents.json (overwritten weekly).
 *
 * SOURCE REALITY (2026-06): PHMSA's bulk incident ZIPs at
 *   https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/data_statistics/pipeline/...zip
 * are blocked by AkamaiGHost at the TLS-fingerprint layer (403 for any
 * non-browser client, regardless of User-Agent). The Socrata catalog entries
 * on datahub.transportation.gov are `href` pointers to the same blocked URLs.
 *
 * The two PHMSA endpoints that DO work programmatically are:
 *
 *   1. Enforcement Cases Raw Data (tab-delimited TXT, ~5K rows, ~2MB):
 *        https://primis.phmsa.dot.gov/enforcement-documents/PHMSA%20Pipeline%20Enforcement%20Raw%20Data.txt
 *      Columns include: CPF_Number, Operator_ID, Operator_Name,
 *      Operator_Searchable_Name, Region, Pipeline_Type, Case_Type,
 *      Cited_Regulations, Violation_Category, Proposed_Penalties,
 *      Assessed_Penalties, Collected_Penalties, Case_Status, Opened_Date,
 *      Closed_Date, ... (51 columns).
 *
 *   2. The Gatsby static-site JSON for /enforcement-data/incident-report:
 *        https://primis.phmsa.dot.gov/enforcement-data/page-data/incident-report/page-data.json
 *      This is a curated list (~460 records) of enforcement cases that were
 *      triggered by reportable incidents, each with operatorId, operatorName,
 *      a free-text incidentDetail (commodity, date, state), and dates.
 *
 * What we CANNOT get without a real-browser client (curl-impersonate /
 * Playwright in CI): per-incident fatalities, injuries, dollar damages,
 * commodity volume spilled. Those fields live only in the blocked ZIPs.
 *
 * Per-brand aggregates we DO produce:
 *   - total_enforcement_actions   — all-time count linked to brand
 *   - recent_24mo_actions         — opened in last 24 months
 *   - incident_linked_actions     — actions where PHMSA documented an incident
 *   - proposed_penalties_total_usd
 *   - assessed_penalties_total_usd
 *   - collected_penalties_total_usd
 *   - sample_incidents            — up to 5 enforcement-linked incidents with
 *                                   {date, location, commodity, cause, damage}
 *   - data_limited: true          — flag for the UI: fatalities/injuries/$ are
 *                                   not directly available from PHMSA's open
 *                                   programmatic surface.
 *
 * Runs via .github/workflows/phmsa-weekly.yml Monday 05:00 UTC.
 * Locally: node scripts/phmsa-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/phmsa-incidents.json");

const UA = "TruNorth-PHMSA/1.0 (+https://www.trunorthapp.com)";
const ENFORCE_URL =
  "https://primis.phmsa.dot.gov/enforcement-documents/PHMSA%20Pipeline%20Enforcement%20Raw%20Data.txt";
const INC_PAGE_DATA_URL =
  "https://primis.phmsa.dot.gov/enforcement-data/page-data/incident-report/page-data.json";
// Best-effort attempt at the bulk ZIPs — these typically 403 from Akamai but
// we try in case the policy ever relaxes. We do NOT depend on them.
const BULK_ZIPS = [
  "https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/data_statistics/pipeline/hl2010toPresent.zip",
  "https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/data_statistics/pipeline/gd2010toPresent.zip",
  "https://www.phmsa.dot.gov/sites/phmsa.dot.gov/files/data_statistics/pipeline/gtgg2010toPresent.zip",
];

const TWENTY_FOUR_MONTHS_MS = 730 * 24 * 60 * 60 * 1000;

async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name] = l.split("|").map((s) => s.trim());
      return { slug, name };
    })
    .filter((b) => b.slug && b.name);
}

// Strip surrounding quotes and uppercase for matching.
function norm(s) {
  return (s || "")
    .replace(/^"|"$/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse "$1,234.56" or "1234.56" → 1234.56. Empty → 0.
function parseMoney(s) {
  if (!s) return 0;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Parse "4/29/26" → ISO. PHMSA uses 2-digit year — assume 20xx unless > current+1.
function parseDate(s) {
  if (!s || !s.includes("/")) return null;
  const [m, d, y] = s.split("/").map((x) => x.trim());
  if (!m || !d || !y) return null;
  let year = Number(y);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

// Parse the tab-delimited enforcement TXT. Some fields are wrapped in
// double-quotes and may contain commas; values do NOT contain tabs.
function parseEnforcementTxt(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  const idx = (name) => headers.indexOf(name);
  const I = {
    cpf:      idx("CPF_Number"),
    opId:     idx("Operator_ID"),
    opName:   idx("Operator_Name"),
    opSearch: idx("Operator_Searchable_Name"),
    region:   idx("Region"),
    pipeType: idx("Pipeline_Type"),
    caseType: idx("Case_Type"),
    cited:    idx("Cited_Regulations"),
    violCat:  idx("Violation_Category"),
    propPen:  idx("Proposed_Penalties"),
    asmtPen:  idx("Assessed_Penalties"),
    collPen:  idx("Collected_Penalties"),
    status:   idx("Case_Status"),
    opened:   idx("Opened_Date"),
    closed:   idx("Closed_Date"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    if (cols.length < headers.length / 2) continue;
    rows.push({
      cpf:      cols[I.cpf]    ?? "",
      opId:     cols[I.opId]   ?? "",
      opName:   (cols[I.opName] || "").replace(/^"|"$/g, ""),
      opSearch: (cols[I.opSearch] || "").replace(/^"|"$/g, ""),
      region:   cols[I.region] ?? "",
      pipeType: cols[I.pipeType] ?? "",
      caseType: cols[I.caseType] ?? "",
      cited:    (cols[I.cited] || "").replace(/^"|"$/g, ""),
      violCat:  (cols[I.violCat] || "").replace(/^"|"$/g, ""),
      propPen:  parseMoney(cols[I.propPen]),
      asmtPen:  parseMoney(cols[I.asmtPen]),
      collPen:  parseMoney(cols[I.collPen]),
      status:   cols[I.status] ?? "",
      openedDate: parseDate(cols[I.opened] ?? ""),
      closedDate: parseDate(cols[I.closed] ?? ""),
    });
  }
  return rows;
}

async function fetchEnforcementCases() {
  const res = await fetch(ENFORCE_URL, {
    headers: { "User-Agent": UA, Accept: "text/plain" },
  });
  if (!res.ok) throw new Error(`Enforcement TXT fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  return parseEnforcementTxt(text);
}

async function fetchIncidentLinkedCases() {
  // Gatsby page-data JSON. Shape:
  //   { result: { data: { postgres: { sc_cases: [ {cpfNum, operatorName,
  //     operatorId, typeOfCase, closedDt, openedDt, incidentDetail, istate,
  //     caseStatus, noticeActions, region}, ... ] } } } }
  try {
    const res = await fetch(INC_PAGE_DATA_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const cases = data?.result?.data?.postgres?.sc_cases ?? [];
    return cases.map((c) => ({
      cpf:        c.cpfNum,
      opId:       c.operatorId,
      opName:     c.operatorName,
      caseType:   c.typeOfCase,
      openedDate: c.openedDt,
      closedDate: c.closedDt,
      status:     c.caseStatus,
      noticeActions: c.noticeActions,
      region:     c.region,
      state:      c.istate,
      // Free-text like "HL - 20260123 (Date: 04/15/26; Location: Houston, TX; Commodity: Crude Oil)"
      incidentDetail: c.incidentDetail || "",
    }));
  } catch {
    return [];
  }
}

// Try the bulk ZIPs; expected to 403 from CI. If they ever return data we
// surface the byte counts so a future commit can flip on richer parsing.
async function probeBulkZips() {
  const probes = [];
  for (const url of BULK_ZIPS) {
    try {
      const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": UA } });
      probes.push({ url, status: res.status, ok: res.ok });
    } catch (err) {
      probes.push({ url, status: 0, ok: false, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return probes;
}

// Match a brand name against an operator name. We use a token-overlap rule:
// the brand's first significant token (e.g. "shell", "chevron") must appear
// as a whole word in the operator's searchable name. We also exclude
// false-positive substrings (e.g. "BP" must not match "BPSI").
function operatorMatchesBrand(opName, brand) {
  if (!opName) return false;
  const n = norm(opName);
  const brandN = norm(brand.name);
  if (!brandN) return false;

  // Strict whole-word check on the brand's first token.
  const firstToken = brandN.split(" ")[0];
  if (!firstToken) return false;
  if (firstToken.length < 2) return false;

  // Whole-word boundary check on the normalized operator name.
  const re = new RegExp(`(^|\\s)${firstToken}(\\s|$)`);
  if (!re.test(n)) return false;

  // BP needs disambiguation — it's a 2-char token. Require it to be
  // followed by a recognizable pipeline term to avoid noise.
  if (firstToken === "BP") {
    return /\b(BP)\b\s+(OIL|PIPELINE|AMERICA|EXPLORATION|WEST|USFO|LOGISTICS|NORTH)/.test(n);
  }
  return true;
}

// Try to extract date / location / commodity from PHMSA's free-text
// incidentDetail field, e.g.
//   "HL - 20260123 (Date: 04/15/26; Location: Houston, TX; Commodity: Crude Oil)"
function parseIncidentDetail(detail) {
  if (!detail) return {};
  const out = {};
  const dateM = detail.match(/Date:\s*([^;)]+)/i);
  if (dateM) out.date = dateM[1].trim();
  const locM = detail.match(/Location:\s*([^;)]+)/i);
  if (locM) out.location = locM[1].trim();
  const comM = detail.match(/Commodity:\s*([^;)]+)/i);
  if (comM) out.commodity = comM[1].trim();
  return out;
}

function aggregateBrand(brand, enforcement, incidentLinked) {
  const matches = enforcement.filter((e) =>
    operatorMatchesBrand(e.opName, brand) || operatorMatchesBrand(e.opSearch, brand),
  );
  if (matches.length === 0) {
    return { slug: brand.slug, name: brand.name, status: "no_records" };
  }

  const matchingOpIds = new Set(matches.map((m) => m.opId).filter(Boolean));
  const matchingOpNames = new Set(matches.map((m) => norm(m.opName)).filter(Boolean));

  const cutoff = Date.now() - TWENTY_FOUR_MONTHS_MS;
  const recent = matches.filter((m) => {
    if (!m.openedDate) return false;
    return Date.parse(m.openedDate) >= cutoff;
  });

  // Incident-linked cases (from the Gatsby JSON). Match by operatorId
  // primarily, with name fallback.
  const linkedForBrand = incidentLinked.filter((c) => {
    if (c.opId && matchingOpIds.has(String(c.opId))) return true;
    if (c.opName && matchingOpNames.has(norm(c.opName))) return true;
    return false;
  });

  const sampleSource = [...linkedForBrand, ...matches.filter((m) => m.cited)]
    .sort((a, b) => {
      const da = Date.parse(a.openedDate || "1900-01-01");
      const db = Date.parse(b.openedDate || "1900-01-01");
      return db - da;
    })
    .slice(0, 5);

  const sample_incidents = sampleSource.map((s) => {
    const detail = parseIncidentDetail(s.incidentDetail || "");
    return {
      cpf_number: s.cpf,
      operator:   s.opName,
      date:       detail.date || s.openedDate || null,
      location:   detail.location || s.state || s.region || null,
      commodity:  detail.commodity || s.pipeType || null,
      cause:      s.violCat || s.caseType || s.cited || null,
      // PHMSA's open programmatic surface does not expose per-incident
      // dollar damage; we use the assessed penalty as a proxy when present.
      damage_usd: typeof s.asmtPen === "number" && s.asmtPen > 0 ? s.asmtPen : null,
      status:     s.status || null,
    };
  });

  const sumPenalty = (key) => matches.reduce((acc, m) => acc + (m[key] || 0), 0);

  return {
    slug:                            brand.slug,
    name:                            brand.name,
    status:                          "ok",
    matched_operator_names:          [...new Set(matches.map((m) => m.opName))].slice(0, 20),
    matched_operator_ids:            [...matchingOpIds],
    total_enforcement_actions:       matches.length,
    recent_24mo_actions:             recent.length,
    incident_linked_actions:         linkedForBrand.length,
    // Best-effort — these come from enforcement penalty fields, not
    // the blocked incident-detail bulk ZIPs.
    fatalities_total:                null,
    injuries_total:                  null,
    proposed_penalties_total_usd:    sumPenalty("propPen"),
    assessed_penalties_total_usd:    sumPenalty("asmtPen"),
    collected_penalties_total_usd:   sumPenalty("collPen"),
    total_damage_usd:                null,
    sample_incidents,
    data_limited:                    true,
    data_limited_reason:             "PHMSA bulk incident ZIPs are blocked by AkamaiGHost; only enforcement-case data is reachable. Fatalities/injuries/dollar-damage are unavailable from the open programmatic surface.",
    scraped_at:                      new Date().toISOString(),
  };
}

async function main() {
  console.log("PHMSA pipeline-incident fetcher starting...");
  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brands`);

  console.log("Fetching enforcement raw data...");
  const enforcement = await fetchEnforcementCases();
  console.log(`  enforcement rows: ${enforcement.length}`);
  // 1 req/sec courtesy delay between the two PHMSA endpoints.
  await new Promise((r) => setTimeout(r, 1000));

  console.log("Fetching incident-linked enforcement cases...");
  const incidentLinked = await fetchIncidentLinkedCases();
  console.log(`  incident-linked cases: ${incidentLinked.length}`);
  await new Promise((r) => setTimeout(r, 1000));

  console.log("Probing bulk ZIPs (expected to 403 from CI)...");
  const bulkProbes = await probeBulkZips();
  for (const p of bulkProbes) console.log(`  ${p.status}  ${p.url}`);

  console.log("Aggregating per-brand...");
  const results = [];
  for (let i = 0; i < brands.length; i++) {
    results.push(aggregateBrand(brands[i], enforcement, incidentLinked));
    if (i % 100 === 0) console.log(`  ...${i}/${brands.length}`);
    // No per-brand network call — aggregation is in-memory, no rate-limit
    // needed. The 1 req/sec rule applied to the two source fetches above.
  }

  const withRecords = results.filter((r) => r.status === "ok").length;
  const noRecords   = results.filter((r) => r.status === "no_records").length;

  await fs.writeFile(
    OUT_FILE,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source_endpoints: {
          enforcement_txt:    ENFORCE_URL,
          incident_page_data: INC_PAGE_DATA_URL,
        },
        bulk_zip_status: bulkProbes,
        brand_count: brands.length,
        with_records_count: withRecords,
        no_records_count:   noRecords,
        data_limited:       true,
        data_limited_reason:
          "PHMSA bulk incident ZIPs (hl/gd/gtgg 2010toPresent.zip) are blocked by AkamaiGHost. Fatalities/injuries/dollar-damage per incident require a real-browser client (curl-impersonate/Playwright). What we collect: enforcement-case-level rollups plus PHMSA's curated incident-linked case list.",
        incidents: results,
      },
      null,
      2,
    ),
  );

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`   With records: ${withRecords}`);
  console.log(`   No records:   ${noRecords}`);
}

main().catch((err) => {
  console.error("phmsa-fetch failed:", err);
  process.exit(1);
});
