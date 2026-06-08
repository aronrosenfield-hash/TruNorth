#!/usr/bin/env node
/**
 * EU Transparency Register — fetcher (B-data-eu1).
 *
 * The EU Transparency Register is the EU analog of the US Senate LD-2
 * lobbying disclosure database. Mandatory registration for organisations
 * that try to influence EU policymaking. It discloses:
 *
 *   - Who the registrant lobbies for (member orgs, clients)
 *   - Policy fields of interest (codes like AGRI, ENVI, COMP, TAXA, ...)
 *   - Annual EU lobbying expenditure (EUR, banded or precise)
 *   - Number of accredited lobbyists with EP access passes
 *
 * ~17,000+ registrants. Free reuse under the EU PSI Directive
 * (© European Union, attribution required).
 *
 *   Site:        https://transparency-register.europa.eu
 *   Bulk dump:   https://ec.europa.eu/transparencyregister/public/files/ODP/download/XML/latest
 *
 * NOTE: The EU retired the JSON bulk dump some time before 2026-06. Only
 * the XML dump is now published (refreshes daily, ~106 MB, 17,266 orgs as
 * of 2026-06-07). This fetcher parses that XML and emits the same
 * downstream JSON shape as the prior JSON-based fetcher, so the merger
 * (scripts/eu-transparency-merge.mjs) does NOT need to change.
 *
 * Override the URL at runtime with EU_TRANSPARENCY_BULK_URL=<url> if it
 * moves again.
 *
 * DIFFERENCES vs. US Senate LD-2:
 *   - LD-2 is filing-centric (one row per quarter per filing).
 *     EU register is registrant-centric (one row per organisation with the
 *     latest declared annual figure).
 *   - LD-2 reports income to lobbying firms in USD.
 *     EU register reports annual lobbying COST INCURRED BY the registrant
 *     in EUR, often as a band (e.g. "100,000 - 199,999 EUR"). We coerce
 *     to a single EUR midpoint for `annualSpendEur` so it's directly
 *     sortable downstream.
 *   - LD-2 has 3-letter issue codes (e.g. "TAX", "DEF").
 *     EU register uses descriptive fields of interest (e.g. "Taxation",
 *     "Competition") under EU policy areas. We pass through verbatim.
 *   - LD-2 names a `client`. EU register names `members` (trade
 *     associations) and `interests` (the policy areas being lobbied).
 *   - LD-2 amounts are mandatory. EU `annualSpendEur` is self-declared
 *     and may be null; the existence of a registration is itself signal.
 *
 * Output (raw dump for the day):
 *   /data/raw/eu-transparency/<YYYY-MM-DD>.json
 *
 * Flags:
 *   --dry        (default) — no network. Reads the 30-org fixture at
 *                            scripts/fixtures/eu-transparency/sample.xml
 *                            (or sample.json — backward compat) and emits
 *                            the same shape the live path emits.
 *   --fixture              — alias for --dry, explicit.
 *   --live                 — actually fetches the bulk dump.
 *   --limit N              — stop after N kept entries (post-filter).
 *                            Useful for smoke tests.
 *   --out PATH             — override output path (otherwise the dated
 *                            file under data/raw/eu-transparency/).
 *
 * Standalone:
 *   node scripts/eu-transparency-fetch.mjs                            # dry
 *   node scripts/eu-transparency-fetch.mjs --live                     # live
 *   node scripts/eu-transparency-fetch.mjs --limit 500 --live
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/eu-transparency");
const FIXTURE_XML = path.join(ROOT, "scripts/fixtures/eu-transparency/sample.xml");
const FIXTURE_JSON = path.join(ROOT, "scripts/fixtures/eu-transparency/sample.json");

const DEFAULT_BULK_URL =
  process.env.EU_TRANSPARENCY_BULK_URL ||
  "https://ec.europa.eu/transparencyregister/public/files/ODP/download/XML/latest";

const UA = "TruNorth-EUTransparency/1.0 (+https://www.trunorthapp.com)";

/* ------------------------ CLI ------------------------ */
const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(name);
}
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const LIVE = flag("--live");
const DRY = !LIVE; // --dry / --fixture / default
const LIMIT = opt("--limit") ? Math.max(1, Number(opt("--limit"))) : null;
const OUT_OVERRIDE = opt("--out");

/* ------------------------ filtering ------------------------ */
// We keep only the two categories most relevant to consumer-brand grading:
// individual companies and trade/business associations representing them.
// Other registrant categories (NGOs, think-tanks, law firms, academic,
// religious) are dropped — they don't match against our 11k consumer-brand
// index and add noise.
//
// EU 2026 XML categories observed:
//   Companies & groups
//   Trade and business associations
//   Trade unions and professional associations
//   Non-governmental organisations, platforms and networks and similar (drop)
//   Professional consultancies (drop)
//   Law firms (drop)
//   Academic institutions (drop)
//   Think tanks and research institutions (drop)
//   ... etc.
const KEEP_CATEGORIES = new Set([
  // Section II categories per EU register taxonomy
  "Company",
  "Companies",
  "Companies & groups",
  "In-house lobbyists and trade/business/professional associations",
  "Trade and business associations",
  "Trade and business organisations",
  "Trade unions and professional associations",
]);

// Annual lobby spend is often reported as a band string. Map to EUR midpoint.
// Bands from the EU register data dictionary (v2):
//   "<10,000", "10,000 - 24,999", "25,000 - 49,999", "50,000 - 99,999",
//   "100,000 - 199,999", "200,000 - 299,999", "300,000 - 399,999",
//   "400,000 - 499,999", "500,000 - 599,999", "600,000 - 699,999",
//   "700,000 - 799,999", "800,000 - 899,999", "900,000 - 999,999",
//   "1,000,000 - 1,249,999", ... ">=10,000,000"
export function parseSpendEur(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).replace(/[ \s]/g, "").replace(/€|EUR/gi, "");
  if (!s) return null;
  // Pure number
  const n = Number(s.replace(/,/g, ""));
  if (Number.isFinite(n) && !/[<>=–-]/.test(s)) return Math.round(n);
  // <10,000 → 5,000
  const lt = s.match(/^<\s*([\d,]+)/);
  if (lt) return Math.round(Number(lt[1].replace(/,/g, "")) / 2);
  // >=10,000,000 → 10,000,000 (lower bound)
  const ge = s.match(/^>=?\s*([\d,]+)/);
  if (ge) return Math.round(Number(ge[1].replace(/,/g, "")));
  // "100,000 - 199,999" or "100,000–199,999" → midpoint
  const band = s.match(/([\d,]+)\s*[-–]\s*([\d,]+)/);
  if (band) {
    const lo = Number(band[1].replace(/,/g, ""));
    const hi = Number(band[2].replace(/,/g, ""));
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return Math.round((lo + hi) / 2);
    }
  }
  return null;
}

export function parseInt0(raw) {
  if (raw == null) return 0;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : 0;
  const n = Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/* ------------------------ shaping (JSON path) ------------------------
 * Normalise one registrant into the compact record the merger reads.
 * We tolerate the (many) field-name variations the EU register has
 * shipped across schema revisions — the keys observed in published v2
 * dumps include both camelCase ("registrationNumber") and snake_case
 * ("registration_number"); both are read. Used by tests / backward-
 * compat JSON fixture path.
 */
export function shape(entry) {
  const get = (...keys) => {
    for (const k of keys) {
      if (entry[k] != null && entry[k] !== "") return entry[k];
    }
    return null;
  };

  const registrationId = String(
    get("identificationCode", "identification_code",
        "registrationNumber", "registration_number", "id") || ""
  ).trim();
  if (!registrationId) return null;

  const name = String(get("name", "organisationName", "organisation_name") || "").trim();
  if (!name) return null;

  const category = String(get("category", "registrationCategory", "section") || "").trim();

  const headquartersCountry = String(
    get("headOfficeCountry", "head_office_country", "headquartersCountry",
        "countryHeadOffice", "country") || ""
  ).trim() || null;

  // Fields of interest — sometimes an array of strings, sometimes an
  // array of {code, label} objects, sometimes a single comma-separated
  // string. Normalise to a flat string[] (deduped, preserves order).
  const rawFields =
    get("fieldsOfInterest", "fields_of_interest",
        "interests", "policyAreas", "policy_areas") || [];
  const fields = [];
  const seen = new Set();
  const pushField = (s) => {
    const t = String(s || "").trim();
    if (!t) return;
    if (seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    fields.push(t);
  };
  if (Array.isArray(rawFields)) {
    for (const f of rawFields) {
      if (typeof f === "string") pushField(f);
      else if (f && typeof f === "object") pushField(f.label || f.name || f.code);
    }
  } else if (typeof rawFields === "string") {
    for (const f of rawFields.split(/[,;]/)) pushField(f);
  }

  // Annual spend — most registrants declare a band; some declare a number.
  const annualSpendEur = parseSpendEur(
    get("annualLobbyingCostEur", "annualLobbyingCost",
        "annual_lobbying_cost", "annualCosts", "costs",
        "estimatedCostEur", "estimated_cost_eur",
        "costsAnnualLobbying", "annualCost")
  );

  const accreditedLobbyists = parseInt0(
    get("accreditedLobbyists", "accredited_lobbyists",
        "accreditedPersonsCount", "accreditedPersons",
        "passHolders", "lobbyistCount", "epAccredited")
  );

  const lastUpdated = String(
    get("lastUpdated", "last_updated", "updatedAt",
        "lastModified", "last_modified", "registrationDate") || ""
  ).trim() || null;

  const sourceUrl =
    get("registrantUrl", "url", "publicUrl") ||
    `https://transparency-register.europa.eu/searchregister-or-update/organisation-details_en?id=${encodeURIComponent(registrationId)}`;

  return {
    registrationId,
    name,
    category,
    headquartersCountry,
    fields,
    annualSpendEur, // EUR midpoint, or null
    accreditedLobbyists,
    lastUpdated,
    sourceUrl,
  };
}

/* ------------------------ XML parsing (new path) ------------------------
 *
 * The 2026 XML dump is ~106 MB. Each <interestRepresentative> block is
 * ~1-5 KB and the XML uses no inner namespaces (xmlns="" on resultList),
 * so a simple block-iterator + per-block tag regex is robust and uses
 * no external XML dependency.
 *
 * If the dump ever grows past comfortably-in-memory (say >500 MB), swap
 * iterXmlBlocks for a streaming reader using fs.createReadStream and
 * incrementally splicing the buffer at "</interestRepresentative>".
 */

const XML_ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      const hex = ent[1] === "x" || ent[1] === "X";
      const n = parseInt(ent.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(n)) return m;
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return XML_ENTITY_MAP[ent] ?? m;
  });
}

// First match of <tag>...</tag> within block. Non-greedy. Returns inner
// text, entity-decoded, trimmed; or null when missing/empty.
function tagText(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  if (!m) return null;
  const t = decodeXmlEntities(m[1]).trim();
  return t || null;
}

// Return the inner XML of the first <tag>...</tag> (no decode).
function tagInner(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  return m ? m[1] : null;
}

// EU XML reports country names in upper-case ("BELGIUM", "UNITED STATES").
// The JSON-fixture path uses title-case ("Belgium", "United States"). Normalize.
function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse one <interestRepresentative> block (inner XML, surrounding tags
 * stripped) into the downstream shape. Returns null when there is no
 * id/name (drop).
 */
export function shapeXmlBlock(block) {
  const registrationId = (tagText(block, "identificationCode") || "").trim();
  if (!registrationId) return null;

  // name lives at <name><originalName>...</originalName></name>
  const nameNode = tagInner(block, "name");
  const name = (nameNode
    ? (tagText(nameNode, "originalName") || decodeXmlEntities(nameNode).trim())
    : ""
  ).replace(/\s+/g, " ").trim();
  if (!name) return null;

  const category = (tagText(block, "registrationCategory") || "").trim();

  // headOffice/country
  const headOfficeInner = tagInner(block, "headOffice");
  let headquartersCountry = null;
  if (headOfficeInner) {
    const c = tagText(headOfficeInner, "country");
    headquartersCountry = c ? titleCase(c) : null;
  }

  // interests -> <interest><name>...</name></interest>
  const interestsInner = tagInner(block, "interests") || "";
  const fields = [];
  const seen = new Set();
  const interestRe = /<interest\b[^>]*>([\s\S]*?)<\/interest>/g;
  let im;
  while ((im = interestRe.exec(interestsInner)) !== null) {
    const t = tagText(im[1], "name");
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    fields.push(t);
  }

  // Annual spend: prefer financialData/closedYear/costs/range (min/max).
  // Fall back to currentYear/costs/range. The element is:
  //   <costs type="CostRange" currency="€">
  //     <range><min>N</min><max>M</max></range>
  //   </costs>
  // Sometimes only <max> appears (e.g. "<10000" -> max=10000).
  // Sometimes a precise <amount>N</amount> (rare; older dumps).
  // CAREFUL: <intermediaries> contains <representationCosts> elements
  // with the same range shape — we must NOT count those as the
  // registrant's own annual spend, so strip intermediaries first.
  const financialInner = tagInner(block, "financialData") || "";
  let annualSpendEur = null;
  const closedInner = tagInner(financialInner, "closedYear") || "";
  const currentInner = tagInner(financialInner, "currentYear") || "";
  for (const section of [closedInner, currentInner]) {
    if (!section) continue;
    const sectionNoInt = section.replace(/<intermediaries\b[\s\S]*?<\/intermediaries>/g, "");
    const costsInner = tagInner(sectionNoInt, "costs");
    if (!costsInner) continue;
    const rangeInner = tagInner(costsInner, "range");
    if (rangeInner) {
      const minT = tagText(rangeInner, "min");
      const maxT = tagText(rangeInner, "max");
      const lo = minT != null ? Number(minT) : null;
      const hi = maxT != null ? Number(maxT) : null;
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        annualSpendEur = Math.round((lo + hi) / 2);
      } else if (Number.isFinite(hi) && !Number.isFinite(lo)) {
        // <max=N> only -> "< N" band, midpoint = N/2
        annualSpendEur = Math.round(hi / 2);
      } else if (Number.isFinite(lo) && !Number.isFinite(hi)) {
        // <min=N> only -> ">= N" band, treat as lower bound
        annualSpendEur = Math.round(lo);
      }
      if (annualSpendEur != null) break;
    }
    // Fallback: amount node (older dumps)
    const amt = tagText(costsInner, "amount");
    if (amt != null) {
      const n = Number(amt);
      if (Number.isFinite(n)) {
        annualSpendEur = Math.round(n);
        break;
      }
    }
  }

  const accreditedLobbyists = parseInt0(tagText(block, "EPAccreditedNumber"));

  // EU XML lastUpdateDate is an ISO timestamp; downstream expects YYYY-MM-DD.
  const lastUpdateRaw = tagText(block, "lastUpdateDate");
  const lastUpdated = lastUpdateRaw ? lastUpdateRaw.slice(0, 10) : null;

  const sourceUrl =
    `https://transparency-register.europa.eu/searchregister-or-update/organisation-details_en?id=${encodeURIComponent(registrationId)}`;

  return {
    registrationId,
    name,
    category,
    headquartersCountry,
    fields,
    annualSpendEur, // EUR midpoint, or null
    accreditedLobbyists,
    lastUpdated,
    sourceUrl,
  };
}

/**
 * Iterate over all <interestRepresentative> blocks in an XML string.
 * Yields the raw block content (just the inner XML, no surrounding tags).
 */
export function* iterXmlBlocks(xml) {
  const re = /<interestRepresentative\b[^>]*>([\s\S]*?)<\/interestRepresentative>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    yield m[1];
  }
}

/**
 * Parse a full XML payload and return shaped records (no filtering).
 * Exposed for tests.
 */
export function parseXmlPayload(xml) {
  const out = [];
  for (const block of iterXmlBlocks(xml)) {
    const shaped = shapeXmlBlock(block);
    if (shaped) out.push(shaped);
  }
  return out;
}

/* ------------------------ extraction (JSON path) ------------------------ */
function extractEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.organisations)) return payload.organisations;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function matchesKeepCategory(cat) {
  if (!cat) return true; // unknown — don't drop
  return (
    KEEP_CATEGORIES.has(cat) ||
    /compan(y|ies)/i.test(cat) ||
    /trade.*(business|association)/i.test(cat) ||
    /business.*association/i.test(cat)
  );
}

export function filterAndShape(entries, { limit = null } = {}) {
  const out = [];
  for (const raw of entries) {
    const shaped = shape(raw);
    if (!shaped) continue;
    if (KEEP_CATEGORIES.size && shaped.category) {
      if (!matchesKeepCategory(shaped.category)) continue;
    }
    out.push(shaped);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/**
 * Same filter rules as filterAndShape, but consumes already-shaped XML
 * records (skips the JSON `shape()` step).
 */
export function filterShapedXml(records, { limit = null } = {}) {
  const out = [];
  for (const r of records) {
    if (!r) continue;
    if (r.category && !matchesKeepCategory(r.category)) continue;
    out.push(r);
    if (limit && out.length >= limit) break;
  }
  return out;
}

/* ------------------------ live download ------------------------ */
async function fetchBulkLive() {
  const url = DEFAULT_BULK_URL;
  console.log(`Downloading bulk dump from ${url} ...`);
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/xml, text/xml;q=0.9, */*;q=0.5",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const text = await res.text();
  console.log(`  ${(text.length / 1024 / 1024).toFixed(1)} MB downloaded`);
  // Detect content: XML (current) vs JSON (defensive — if EU ever revives
  // the JSON dump, or the override URL points at a JSON endpoint).
  const head = text.trimStart().slice(0, 8);
  if (head.startsWith("<?xml") || head.startsWith("<")) {
    return { kind: "xml", text };
  }
  if (head.startsWith("{") || head.startsWith("[")) {
    return { kind: "json", text };
  }
  throw new Error(`Unrecognized bulk-dump format (starts with ${JSON.stringify(head)})`);
}

async function fetchBulkDry() {
  // Prefer the XML fixture (matches new live shape). Fall back to JSON for
  // backward compat (older fixtures or downstream tooling that still
  // exercises the JSON code path).
  try {
    const xml = await fs.readFile(FIXTURE_XML, "utf-8");
    return { kind: "xml", text: xml };
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try {
    const text = await fs.readFile(FIXTURE_JSON, "utf-8");
    return { kind: "json", text };
  } catch (e) {
    throw new Error(
      `Missing fixture (looked for ${FIXTURE_XML} and ${FIXTURE_JSON}): ${e.message}`,
    );
  }
}

/* ------------------------ main ------------------------ */
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const mode = DRY ? "DRY (fixture)" : "LIVE";
  console.log(`EU Transparency Register fetcher — mode: ${mode}`);
  console.log(`EU TR fetcher mode: XML (was JSON in prior versions)`);

  const { kind, text } = DRY ? await fetchBulkDry() : await fetchBulkLive();
  console.log(`Payload format: ${kind.toUpperCase()}`);

  let totalBulk = 0;
  let shaped;
  if (kind === "xml") {
    const all = parseXmlPayload(text);
    totalBulk = all.length;
    console.log(`Bulk entries:        ${totalBulk}`);
    shaped = filterShapedXml(all, { limit: LIMIT });
  } else {
    let payload;
    try { payload = JSON.parse(text); }
    catch (e) { throw new Error(`Bulk dump is not valid JSON: ${e.message}`); }
    const entries = extractEntries(payload);
    totalBulk = entries.length;
    console.log(`Bulk entries:        ${totalBulk}`);
    shaped = filterAndShape(entries, { limit: LIMIT });
  }
  console.log(`After category filter: ${shaped.length} (companies + trade assocs)`);

  // Top spenders log (helps catch obvious schema drift)
  const ranked = [...shaped]
    .filter(e => Number.isFinite(e.annualSpendEur))
    .sort((a, b) => (b.annualSpendEur || 0) - (a.annualSpendEur || 0));
  console.log(`Top 10 declared annual EU lobby spend:`);
  for (const e of ranked.slice(0, 10)) {
    const eur = (e.annualSpendEur || 0).toLocaleString("en-US");
    console.log(`  €${eur.padStart(12)}  ${e.name}  (${e.headquartersCountry || "??"})`);
  }

  const outPath = OUT_OVERRIDE || path.join(OUT_DIR, `${todayUTC()}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: DRY ? "dry" : "live",
        source: "EU Transparency Register",
        source_url: DEFAULT_BULK_URL,
        source_format: kind,
        license: "EU PSI Directive — © European Union, 2026",
        total_bulk: totalBulk,
        kept: shaped.length,
        registrants: shaped,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${outPath}`);
}

const invokedAsScript =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) {
  main().catch((err) => {
    console.error("eu-transparency-fetch failed:", err);
    process.exit(1);
  });
}
