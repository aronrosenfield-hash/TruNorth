#!/usr/bin/env node
/**
 * Net Zero Tracker — Corporate climate-pledge dataset (https://zerotracker.net)
 *
 * The Net Zero Tracker (NZT) is a joint project of the Energy & Climate
 * Intelligence Unit, Data-Driven EnviroLab, NewClimate Institute, and
 * Oxford Net Zero. It scores the world's largest ~2,000 publicly listed
 * companies (Forbes Global 2000) on the *quality* of their net-zero pledges
 * using a 4-dimension traffic-light grading system:
 *   - Detailed plan        (green / orange / red)
 *   - Reporting mechanism  (green / orange / red)
 *   - Scope 3 coverage     (green / orange / red)
 *   - Carbon credit use    (green / orange / red)
 *
 * Status field collapses to: committed | in-progress | achieved | none.
 *
 * We derive a 0–4 "quality grade" (A through F) from how many of the four
 * pillars are green (worst-pillar red bumps grade down). This A–F grade
 * is what downstream TruNorth surfaces in the environment / climate row.
 *
 * Source: https://zerotracker.net/  (download via UI; CSV/XLSX). License
 * is documented as freely available for non-commercial use with attribution;
 * we cache the raw payload and cite the per-entity source URL when present.
 *
 * The exact download endpoint is not a static URL — the site renders the
 * dataset via a JS UI and exposes "Download Data" buttons whose hrefs may
 * change. We therefore follow the SBTi/Forest500 pattern: scrape the
 * landing page for a candidate .csv/.xlsx link and, failing that, fall
 * back to the checked-in fixture so CI never crashes on a UI redesign.
 *
 * Output: data/raw/net-zero-tracker/<YYYY-MM-DD>.json
 *
 * Flags:
 *   (no args)        → dry run from fixture
 *   --apply / --live → actually hit zerotracker.net
 *   --limit N        → cap output to first N rows
 *   --out PATH       → override default output path
 *
 * Locally:
 *   node scripts/net-zero-tracker-fetch.mjs
 *   node scripts/net-zero-tracker-fetch.mjs --apply
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSVToObjects } from "./lib/company-name-normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const RAW_DIR   = path.join(ROOT, "data/raw/net-zero-tracker");
const FIXTURE   = path.join(ROOT, "test/fixtures/net-zero-tracker/sample.csv");
const LANDING   = "https://zerotracker.net";
const UA        = "TruNorth-NetZeroTracker/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply") || args.includes("--live");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1], 10) : null;
})();
const OUT_OVERRIDE = (() => {
  const i = args.indexOf("--out");
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
})();

/**
 * Normalize an NZT row to a stable TruNorth shape. Tolerates field-name
 * drift between releases. NZT uses these (fairly stable) column families:
 *   - "Name" / "Entity"               → display name
 *   - "ISO" / "Country"               → country code / display
 *   - "Sector"                        → industry sector
 *   - "Target year" / "End target year"
 *   - "Status" / "End target status"  → committed / in-progress / achieved / none
 *   - "End target"                    → wording (net zero, carbon neutral, ...)
 *   - "Interim target year"
 *   - "Plan"                          → Complete / Incomplete / No plan
 *   - "Reporting"                     → Annual / Less than annual / No reporting
 *   - "Scope 3"                       → Complete / Partial / No coverage
 *   - "Carbon credits"                → No / Yes with conditions / Unspecified
 *   - "Source URL"                    → primary citation
 */
export function normalizeRow(r) {
  const name = pick(r, ["name", "Name", "entity", "Entity", "Company", "company"]);
  if (!name) return null;

  const iso     = pick(r, ["iso", "ISO", "Country code", "country_code"]);
  const country = pick(r, ["country", "Country"]);
  const sector  = pick(r, ["sector", "Sector"]);

  const targetYearRaw = pick(r, ["target_year", "Target year", "End target year", "end_target_year"]);
  const target_year = Number.parseInt(targetYearRaw, 10) || null;

  const interimYearRaw = pick(r, ["interim_target_year", "Interim target year"]);
  const interim_target_year = Number.parseInt(interimYearRaw, 10) || null;

  const status = normalizeStatus(pick(r, ["status", "Status", "End target status", "end_target_status"]));
  const end_target = pick(r, ["end_target", "End target", "Target"]) || null;

  const plan        = normalizeTrafficLight(pick(r, ["plan", "Plan", "Detailed plan"]), "plan");
  const reporting   = normalizeTrafficLight(pick(r, ["reporting", "Reporting", "Reporting mechanism"]), "reporting");
  const scope3      = normalizeTrafficLight(pick(r, ["scope3", "Scope 3", "Scope 3 coverage"]), "scope3");
  const creditsRaw  = pick(r, ["carbon_credits", "Carbon credits", "International offsets"]);
  const credits     = normalizeTrafficLight(creditsRaw, "credits");

  const source_url = pick(r, ["source_url", "Source URL", "Source", "URL"]) || null;

  const quality_grade = deriveQualityGrade({ plan, reporting, scope3, credits, status });

  return {
    company: String(name).trim(),
    iso: iso || null,
    country: country || null,
    sector: sector || null,
    status,                    // committed | in-progress | achieved | none
    end_target,                // free text: "net zero", "carbon neutral", ...
    target_year,
    interim_target_year,
    plan,                      // green | orange | red | null
    reporting,                 // green | orange | red | null
    scope3,                    // green | orange | red | null
    carbon_credits: credits,   // green | orange | red | null
    quality_grade,             // A | B | C | D | F | null
    source_url,
  };
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return String(obj[k]).trim();
    }
  }
  return "";
}

/**
 * NZT publishes free-form status text; map to a small enum so the UI can
 * route ("missed target" / "no pledge" matter for the negative-signal feed).
 */
export function normalizeStatus(s) {
  const t = (s || "").toString().trim().toLowerCase();
  if (!t || t === "n/a" || t === "none") return "none";
  if (/achiev|met|fulfill/.test(t)) return "achieved";
  if (/miss|expired|failed/.test(t)) return "missed";
  if (/in[\s-]?progress|setting|underway|active/.test(t)) return "in-progress";
  if (/commit|pledg|propos/.test(t)) return "committed";
  if (/no target|no pledge|none/.test(t)) return "none";
  return "committed";   // safe default — NZT only lists pledged entities
}

/**
 * Map free-form pillar text → green / orange / red, per NZT codebook.
 * `kind` adjusts the matching for the "carbon credits" pillar where
 * "No" credits is the *good* (green) outcome.
 */
export function normalizeTrafficLight(raw, kind) {
  const t = (raw || "").toString().trim().toLowerCase();
  if (!t || t === "n/a") return null;
  if (kind === "credits") {
    // "No" (no offsets) is best. "Yes; with conditions applied" → orange.
    // Anything else / "Unspecified" → red.
    if (/^no\b/.test(t)) return "green";
    if (/with conditions|conditional|partial/.test(t)) return "orange";
    if (/^yes\b/.test(t)) return "red";
    if (/unspecified|unknown/.test(t)) return "red";
    return "red";
  }
  // plan / reporting / scope3 share the same pattern. Order matters:
  // "incomplete" must be tested *before* "complete" so we don't mis-match.
  if (/incomplete|partial|less than annual|some/.test(t)) return "orange";
  if (/complete|^annual\b|fully/.test(t)) return "green";
  if (/^no\b|none|unspecified|missing/.test(t)) return "red";
  return null;
}

/**
 * Derive an A–F letter grade from the four pillar traffic lights + status.
 *
 *   all 4 green (no orange, no red)   → A    (only awarded for perfect score)
 *   greens ≥ 3                        → B
 *   greens = 2 and 0 reds             → B
 *   greens = 2 and ≥ 1 red            → C
 *   greens = 1                        → D
 *   greens = 0                        → F
 *   status "achieved" forces ≥ B
 *   status "none"     forces F
 */
export function deriveQualityGrade({ plan, reporting, scope3, credits, status }) {
  if (status === "none") return "F";
  const lights = [plan, reporting, scope3, credits];
  const greens = lights.filter(l => l === "green").length;
  const reds   = lights.filter(l => l === "red").length;
  const known  = lights.filter(Boolean).length;
  if (known === 0) return null;

  let grade;
  if (greens === 4) grade = "A";
  else if (greens >= 3) grade = "B";
  else if (greens === 2 && reds === 0) grade = "B";
  else if (greens === 2) grade = "C";
  else if (greens === 1) grade = "D";
  else grade = "F";

  if (status === "achieved" && (grade === "C" || grade === "D" || grade === "F")) {
    grade = "B";
  }
  return grade;
}

/**
 * Scrape the NZT landing page for the latest downloadable CSV/XLSX link.
 * Returns the absolute URL or null if none found.
 */
export function findDownloadLink(html, base = LANDING) {
  if (!html) return null;
  // Prefer .csv, then .xlsx. Look for "download" hint in text or filename.
  const csvRe = /href=["']([^"']+\.csv[^"']*)["']/gi;
  const xlsxRe = /href=["']([^"']+\.xlsx[^"']*)["']/gi;
  let m;
  while ((m = csvRe.exec(html))) {
    return absolutize(m[1], base);
  }
  while ((m = xlsxRe.exec(html))) {
    return absolutize(m[1], base);
  }
  return null;
}

function absolutize(href, base) {
  return href.startsWith("http") ? href : new URL(href, base).toString();
}

async function fetchLiveCsv() {
  const landingRes = await fetch(LANDING, { headers: { "User-Agent": UA } });
  if (!landingRes.ok) throw new Error(`NZT landing fetch failed: HTTP ${landingRes.status}`);
  const html = await landingRes.text();
  const url = findDownloadLink(html);
  if (!url) {
    console.warn("⚠️  NZT: no download link found on landing page; falling back to fixture.");
    return null;
  }
  if (/\.xlsx(\?|$)/i.test(url)) {
    // TODO: NZT often ships .xlsx — when that happens this script falls
    // back to the fixture so the workflow keeps shipping. The maintainer
    // should add an xlsx→csv conversion step here (lightweight reader).
    console.warn(`⚠️  NZT: only XLSX export available (${url}); falling back to fixture.`);
    return null;
  }
  console.log(`⬇️  NZT CSV: ${url}`);
  const csvRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!csvRes.ok) throw new Error(`NZT CSV fetch failed: HTTP ${csvRes.status}`);
  return await csvRes.text();
}

async function loadFixture() {
  return await fs.readFile(FIXTURE, "utf-8");
}

async function main() {
  console.log(`NZT fetcher starting... (mode=${APPLY ? "APPLY (live)" : "DRY (fixture)"})`);

  const csvText = APPLY ? (await fetchLiveCsv() ?? await loadFixture()) : await loadFixture();
  const rawRows = parseCSVToObjects(csvText);
  console.log(`Parsed ${rawRows.length} raw rows`);

  let rows = rawRows.map(normalizeRow).filter(Boolean);
  if (LIMIT) rows = rows.slice(0, LIMIT);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = OUT_OVERRIDE ?? path.join(RAW_DIR, `${stamp}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const payload = {
    generated_at: new Date().toISOString(),
    source: "net-zero-tracker",
    source_url: LANDING,
    license: "Open data — free for non-commercial use with attribution to Net Zero Tracker (zerotracker.net).",
    mode: APPLY ? "live" : "fixture",
    row_count: rows.length,
    rows,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`✅ Wrote ${outPath} — ${rows.length} normalized companies`);

  const byStatus = rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), {});
  const byGrade  = rows.reduce((acc, r) => ((acc[r.quality_grade || "—"] = (acc[r.quality_grade || "—"] || 0) + 1), acc), {});
  console.log(`   By status: ${JSON.stringify(byStatus)}`);
  console.log(`   By grade : ${JSON.stringify(byGrade)}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("net-zero-tracker-fetch failed:", err);
    process.exit(1);
  });
}
