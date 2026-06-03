#!/usr/bin/env node
/**
 * MSHA (Mine Safety and Health Administration) — weekly bulk-data fetch.
 *
 * Downloads three official MSHA open-government datasets (pipe-delimited
 * text inside ZIPs, updated weekly on Fridays) and aggregates per-brand
 * statistics for every entry in /public/data/top-500-brands.txt.
 *
 *   Mines:      https://arlweb.msha.gov/OpenGovernmentData/DataSets/Mines.zip
 *   Violations: https://arlweb.msha.gov/OpenGovernmentData/DataSets/Violations.zip
 *   Accidents:  https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip
 *
 * Background:
 *   MSHA regulates US mining operations (coal + metal/non-metal). The
 *   datasets cover every citation, fatality, and inspection at every
 *   US mine since 2000. Most TruNorth brands won't appear at all —
 *   only companies with actual mining operations (or that own a mining
 *   subsidiary) will. The Violations file in particular is enormous
 *   (~1.4 GB uncompressed) so we stream-parse it.
 *
 * Output: /public/data/msha-incidents.json (overwritten weekly)
 *
 * Per-brand aggregates:
 *   - total_citations         all-time matched violations
 *   - fatalities_5y           accident records with DEGREE_INJURY=FATALITY
 *                             in the last 5 years
 *   - total_penalties_usd     summed PROPOSED_PENALTY across matched
 *                             violations
 *   - significant_substantial sum of "S&S" citations (a flag MSHA uses
 *                             to mark severe violations)
 *   - sample_citations        5 most-recent citations (date, mine,
 *                             section, S&S, penalty)
 *   - sample_fatalities       5 most-recent fatal accidents
 *
 * Matching strategy: we test brand-token-set membership against the
 * normalized CONTROLLER_NAME and OPERATOR_NAME fields (and VIOLATOR_NAME
 * for the violations file). A hand-curated BRAND_MATCHERS table covers
 * the obvious industrial brands; the rest fall through to a generic
 * brand-name match (only kicks in for unique names >= 5 chars).
 *
 * Honor-system courtesy: 1 req/sec between zip downloads,
 * UA "TruNorth-MSHA/1.0".
 *
 * Runs via .github/workflows/msha-weekly.yml Monday 06:00 UTC.
 *
 * Locally:    node scripts/msha-fetch.mjs
 * Smoke test: node scripts/msha-fetch.mjs --smoke
 *             (runs against just a handful of mining-heavy brands)
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT        = path.resolve(__dirname, "..");
const BRANDS_FILE = path.join(ROOT, "public/data/top-500-brands.txt");
const OUT_FILE    = path.join(ROOT, "public/data/msha-incidents.json");

const UA       = "TruNorth-MSHA/1.0 (+https://www.trunorthapp.com)";
const HOST     = "https://arlweb.msha.gov";
const VIOLATIONS_URL = `${HOST}/OpenGovernmentData/DataSets/Violations.zip`;
const ACCIDENTS_URL  = `${HOST}/OpenGovernmentData/DataSets/Accidents.zip`;
const MINES_URL      = `${HOST}/OpenGovernmentData/DataSets/Mines.zip`;

const SMOKE = process.argv.includes("--smoke");
// Brands known to have (or have had) US mining operations. The MSHA
// universe is small — the smoke set covers the obvious heavy-industry
// names + a few oil majors that operate quarries and aggregate sites.
const SMOKE_SLUGS = new Set([
  "caterpillar",
  "exxonmobil",
  "chevron",
  "conocophillips",
]);

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── brand loading ────────────────────────────────────────────────────────
async function loadBrands() {
  const raw = await fs.readFile(BRANDS_FILE, "utf-8");
  const brands = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [slug, name] = l.split("|").map((s) => s.trim());
      return { slug, name };
    })
    .filter((b) => b.slug && b.name);

  if (SMOKE) {
    // For smoke we also load every full brand entry whose slug is in the
    // smoke set; if none of them appear in top-500 we still want them to
    // exist so the smoke test is meaningful.
    const filtered = brands.filter((b) => SMOKE_SLUGS.has(b.slug));
    const have = new Set(filtered.map((b) => b.slug));
    for (const slug of SMOKE_SLUGS) {
      if (!have.has(slug)) {
        filtered.push({ slug, name: slug.replace(/-/g, " ") });
      }
    }
    return filtered;
  }
  return brands;
}

// ─── name matching ────────────────────────────────────────────────────────
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hand-curated tokens. For mining specifically: the MSHA-registered
// operator/controller name often differs from the brand name (e.g.
// ExxonMobil's mining ops are registered as "Imperial Trona Corp",
// Caterpillar's as "Caterpillar Inc"). Each entry is { matchAny: [tokens] }:
// any of the tokens must appear as a substring of the normalized
// controller/operator/violator name to count as a match.
const BRAND_MATCHERS = {
  // Heavy industrials commonly seen in MSHA data
  "caterpillar":      { matchAny: ["caterpillar"] },
  "exxonmobil":       { matchAny: ["exxon mobil", "exxonmobil", "imperial trona"] },
  "chevron":          { matchAny: ["chevron mining", "chevron usa", "chevron u s a"] },
  "conocophillips":   { matchAny: ["conocophillips", "conoco phillips"] },
  // Mining-pure operators (may not be in top-500 today but harmless if so)
  "us-steel":         { matchAny: ["united states steel", "u s steel", "us steel"] },
  "newmont":          { matchAny: ["newmont"] },
  "peabody-energy":   { matchAny: ["peabody"] },
  "alcoa":            { matchAny: ["alcoa"] },
  "nucor":            { matchAny: ["nucor"] },
  "cleveland-cliffs": { matchAny: ["cleveland cliffs", "cliffs natural", "cliffs mining"] },
  "freeport-mcmoran": { matchAny: ["freeport mcmoran", "freeport mc moran", "freeport mcm"] },
  "martin-marietta":  { matchAny: ["martin marietta"] },
  "vulcan-materials": { matchAny: ["vulcan construction", "vulcan materials", "vulcan lands"] },
  "cemex":            { matchAny: ["cemex"] },
  "halliburton":      { matchAny: ["halliburton"] },
  "baker-hughes":     { matchAny: ["baker hughes"] },
  "schlumberger":     { matchAny: ["schlumberger"] },
  "3m":               { matchAny: ["3m company", "3m mining", "minnesota mining"] },
  "dupont":           { matchAny: ["e i du pont", "dupont de nemours", "du pont"] },
  "dow-chemical":     { matchAny: ["dow chemical"] },
  "john-deere":       { matchAny: ["deere and company", "deere co", "john deere"] },
  "general-electric": { matchAny: ["general electric"] },
};

function matchersFor(brand) {
  const m = BRAND_MATCHERS[brand.slug];
  if (m) return m.matchAny;
  // Default: normalized brand name, only if reasonably unique
  const n = norm(brand.name);
  return n.length >= 5 ? [n] : [];
}

// ─── HTTP / download ──────────────────────────────────────────────────────
async function downloadZip(url, destPath) {
  await sleep(1000); // 1 req/sec
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  if (!res.body) throw new Error(`${url} empty body`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

async function unzipTo(zipPath, destDir) {
  await execFileP("unzip", ["-o", zipPath, "-d", destDir], { maxBuffer: 1024 * 1024 * 1024 });
  const files = await fs.readdir(destDir);
  const txt = files.find((f) => f.toLowerCase().endsWith(".txt"));
  if (!txt) throw new Error(`No .txt found after unzipping ${zipPath}`);
  return path.join(destDir, txt);
}

// ─── streaming pipe-delimited parse ───────────────────────────────────────
// MSHA files: pipe-delimited, fields optionally double-quoted, "" → "
// escapes. No embedded newlines observed but the parser handles them.
async function parsePipe(filePath, onRow) {
  const handle = await fs.open(filePath, "r");
  const stream = handle.createReadStream({ encoding: "utf-8" });

  let header = null;
  let buf = "";
  let inQuotes = false;
  let field = "";
  let row = [];

  const finishField = () => { row.push(field); field = ""; };
  const finishRow = () => {
    if (!header) {
      header = row;
    } else if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? "";
      onRow(obj);
    }
    row = [];
  };

  for await (const chunk of stream) {
    buf += chunk;
    let i = 0;
    while (i < buf.length) {
      const c = buf[i];
      if (inQuotes) {
        if (c === '"') {
          if (buf[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === "|") { finishField(); i++; continue; }
      if (c === "\n") { finishField(); finishRow(); i++; continue; }
      if (c === "\r") { i++; continue; }
      field += c; i++;
    }
    buf = "";
  }
  if (field.length > 0 || row.length > 0) { finishField(); finishRow(); }
  await handle.close();
}

// ─── helpers ──────────────────────────────────────────────────────────────
// Dates in MSHA are "MM/DD/YYYY"
function parseMshaDate(raw) {
  if (!raw) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const [, mm, dd, yyyy] = m;
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMoney(raw) {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function tryMatch(matchers, ...candidateNames) {
  for (const name of candidateNames) {
    const n = norm(name);
    if (!n) continue;
    for (const { brand, tokens } of matchers) {
      for (const t of tokens) {
        if (n.includes(t)) return brand.slug;
      }
    }
  }
  return null;
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`MSHA fetcher starting${SMOKE ? " (SMOKE)" : ""}...`);

  const brands = await loadBrands();
  console.log(`Loaded ${brands.length} brand${brands.length === 1 ? "" : "s"}`);

  const matchers = brands.map((b) => ({ brand: b, tokens: matchersFor(b) }))
                         .filter((m) => m.tokens.length > 0);
  console.log(`${matchers.length} brands with matcher tokens`);

  const violations    = new Map(brands.map((b) => [b.slug, []]));
  const accidents     = new Map(brands.map((b) => [b.slug, []]));

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "msha-"));

  // 1. Violations (largest file)
  const viozip = path.join(tmp, "violations.zip");
  console.log(`Downloading violations: ${VIOLATIONS_URL}`);
  await downloadZip(VIOLATIONS_URL, viozip);
  const violationsTxt = await unzipTo(viozip, tmp);
  const viostat = await fs.stat(violationsTxt);
  console.log(`Violations.txt: ${(viostat.size / 1024 / 1024).toFixed(0)} MB`);

  let vioRows = 0;
  let vioMatched = 0;
  await parsePipe(violationsTxt, (r) => {
    vioRows++;
    const slug = tryMatch(
      matchers,
      r["CONTROLLER_NAME"],
      r["VIOLATOR_NAME"],
    );
    if (slug) {
      violations.get(slug).push({
        date:          r["VIOLATION_ISSUE_DT"],
        controller:    r["CONTROLLER_NAME"],
        violator:      r["VIOLATOR_NAME"],
        mine_id:       r["MINE_ID"],
        mine_name:     r["MINE_NAME"],
        mine_type:     r["MINE_TYPE"],
        section:       r["PART_SECTION"],
        cit_ord_safe:  r["CIT_ORD_SAFE"],
        sig_sub:       r["SIG_SUB"],   // "Y" or "N"
        likelihood:    r["LIKELIHOOD"],
        inj_illness:   r["INJ_ILLNESS"],
        negligence:    r["NEGLIGENCE"],
        proposed:      parseMoney(r["PROPOSED_PENALTY"]),
        amount_paid:   parseMoney(r["AMOUNT_PAID"]),
        violation_no:  r["VIOLATION_NO"],
      });
      vioMatched++;
    }
  });
  console.log(`Violations: parsed ${vioRows.toLocaleString()} rows, matched ${vioMatched.toLocaleString()}`);
  // Free the giant file before downloading the next one
  try { await fs.rm(violationsTxt, { force: true }); } catch {}
  try { await fs.rm(viozip, { force: true }); } catch {}

  // 2. Accidents
  const accZip = path.join(tmp, "accidents.zip");
  console.log(`Downloading accidents: ${ACCIDENTS_URL}`);
  await downloadZip(ACCIDENTS_URL, accZip);
  const accTxt = await unzipTo(accZip, tmp);
  const accStat = await fs.stat(accTxt);
  console.log(`Accidents.txt: ${(accStat.size / 1024 / 1024).toFixed(0)} MB`);

  let accRows = 0;
  let accMatched = 0;
  await parsePipe(accTxt, (r) => {
    accRows++;
    const slug = tryMatch(
      matchers,
      r["CONTROLLER_NAME"],
      r["OPERATOR_NAME"],
    );
    if (slug) {
      accidents.get(slug).push({
        date:          r["ACCIDENT_DT"],
        controller:    r["CONTROLLER_NAME"],
        operator:      r["OPERATOR_NAME"],
        mine_id:       r["MINE_ID"],
        subunit:       r["SUBUNIT"],
        degree_injury: r["DEGREE_INJURY"],
        classification: r["CLASSIFICATION"],
        accident_type: r["ACCIDENT_TYPE"],
        no_injuries:   Number(r["NO_INJURIES"]) || 0,
        occupation:    r["OCCUPATION"],
        narrative:     (r["NARRATIVE"] || "").slice(0, 500),
        coal_metal:    r["COAL_METAL_IND"],
      });
      accMatched++;
    }
  });
  console.log(`Accidents: parsed ${accRows.toLocaleString()} rows, matched ${accMatched.toLocaleString()}`);
  try { await fs.rm(accTxt, { force: true }); } catch {}
  try { await fs.rm(accZip, { force: true }); } catch {}

  // 3. Aggregate
  const now = Date.now();
  const fatalCutoff = now - FIVE_YEARS_MS;

  const results = brands.map((b) => {
    const vios = violations.get(b.slug) || [];
    const accs = accidents.get(b.slug) || [];
    if (vios.length === 0 && accs.length === 0) {
      return { slug: b.slug, name: b.name, status: "no_records" };
    }

    let totalPenalty = 0;
    let sigSub = 0;
    for (const v of vios) {
      totalPenalty += v.proposed || 0;
      if (v.sig_sub === "Y") sigSub++;
    }

    const fatalities = accs.filter((a) => {
      const d = parseMshaDate(a.date);
      return d && d.getTime() >= fatalCutoff && /fatal/i.test(a.degree_injury || "");
    });

    const sortByDateDesc = (a, b) => {
      const da = parseMshaDate(a.date)?.getTime() ?? 0;
      const db = parseMshaDate(b.date)?.getTime() ?? 0;
      return db - da;
    };

    const sampleCitations = vios.slice().sort(sortByDateDesc).slice(0, 5).map((v) => ({
      date:         v.date,
      mine_name:    v.mine_name,
      mine_type:    v.mine_type,
      section:      v.section,
      type:         v.cit_ord_safe,
      sig_sub:      v.sig_sub === "Y",
      likelihood:   v.likelihood,
      proposed_penalty_usd: v.proposed,
      violator:     v.violator,
      violation_no: v.violation_no,
    }));

    const sampleFatalities = accs
      .filter((a) => /fatal/i.test(a.degree_injury || ""))
      .sort(sortByDateDesc)
      .slice(0, 5)
      .map((a) => ({
        date:       a.date,
        mine_id:    a.mine_id,
        subunit:    a.subunit,
        accident_type: a.accident_type,
        occupation: a.occupation,
        narrative:  a.narrative,
        coal_metal: a.coal_metal === "C" ? "coal" : a.coal_metal === "M" ? "metal" : null,
      }));

    return {
      slug:                 b.slug,
      name:                 b.name,
      status:               "ok",
      total_citations:      vios.length,
      total_penalties_usd:  Math.round(totalPenalty),
      significant_substantial: sigSub,
      fatalities_5y:        fatalities.length,
      total_accidents:      accs.length,
      sample_citations:     sampleCitations,
      sample_fatalities:    sampleFatalities,
      scraped_at:           new Date().toISOString(),
    };
  });

  const withRecords = results.filter((r) => r.status === "ok").length;
  const noRecords   = results.filter((r) => r.status === "no_records").length;

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify({
    generated_at:       new Date().toISOString(),
    source_urls:        { violations: VIOLATIONS_URL, accidents: ACCIDENTS_URL, mines: MINES_URL },
    violations_rows:    vioRows,
    accidents_rows:     accRows,
    brand_count:        brands.length,
    with_records_count: withRecords,
    no_records_count:   noRecords,
    brands:             results,
  }, null, 2));

  // 4. Cleanup
  try { await fs.rm(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  With records: ${withRecords}`);
  console.log(`  No records:   ${noRecords}`);

  if (SMOKE) {
    console.log("\nSMOKE summary:");
    for (const r of results) {
      if (r.status !== "ok") {
        console.log(`  ${r.slug.padEnd(20)} status=${r.status}`);
        continue;
      }
      console.log(
        `  ${r.slug.padEnd(20)} citations=${String(r.total_citations).padStart(5)} ` +
        `fatal5y=${String(r.fatalities_5y).padStart(3)} ` +
        `penalty=$${r.total_penalties_usd.toLocaleString()} ` +
        `S&S=${r.significant_substantial}`,
      );
    }
  }
}

main().catch((err) => {
  console.error("msha-fetch failed:", err);
  process.exit(1);
});
