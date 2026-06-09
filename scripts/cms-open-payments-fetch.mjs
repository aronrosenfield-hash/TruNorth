#!/usr/bin/env node
/**
 * CMS Open Payments — pharmaceutical / device company payments to physicians
 *
 * Source: CMS Open Payments program (https://openpaymentsdata.cms.gov),
 *   the federal disclosure database mandated by Sec. 6002 of the Affordable
 *   Care Act ("Sunshine Act"). Drug & device manufacturers and Group
 *   Purchasing Organizations (GPOs) must report every transfer of value
 *   to covered recipients (physicians, teaching hospitals, PAs, NPs).
 *
 * License: U.S. Government Work (https://www.usa.gov/government-works).
 *
 * We use the pre-aggregated "Payments grouped by reporting entities,
 * covered recipient, and nature of payments" CSV (Program Year 2024,
 * published 2026-01-27). ~418 MB / 4.85M rows. We aggregate locally to
 * per-manufacturer totals (1,729 manufacturers).
 *
 *   distribution: PBLCTN_SMRY_BY_AMGPO_BY_CR_BY_NTR_OF_PYMT_PGYR2024_...csv
 *   columns: AMGPO_ID, Recipient_ID, Recipient_Type, Nature_Of_Payment_Type_Code,
 *            Number_of_Transaction, Total_Amount, Recipient_Name, AMGPO_Name
 *
 * Per-manufacturer aggregation produces:
 *     total          — sum(Total_Amount)   (USD)
 *     transactions   — sum(Number_of_Transaction)
 *     recipients     — distinct Recipient_ID count
 *
 * Output: data/raw/cms-open-payments/<YYYY>.json
 *   {
 *     _source, _license, _programYear, _fetched, _manufacturers,
 *     manufacturers: { "<AMGPO_Name>": { total, transactions, recipients } }
 *   }
 *
 * USAGE
 *   node scripts/cms-open-payments-fetch.mjs               # 2024 PGYR (default)
 *   node scripts/cms-open-payments-fetch.mjs --year 2023
 *   node scripts/cms-open-payments-fetch.mjs --out /tmp/out.json
 *   node scripts/cms-open-payments-fetch.mjs --keep-csv    # leave the ~418MB CSV on disk
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data/raw/cms-open-payments");
const UA = "TruNorth-Data/1.0 (+https://www.trunorthapp.com)";

const METASTORE = "https://openpaymentsdata.cms.gov/api/1/metastore/schemas/dataset/items";

// Hardcoded per-year fallback URLs (verified 2026-06-09).
const FALLBACK_BY_YEAR = {
  2024: "https://download.cms.gov/openpayments/SMRY_RPTS_P01232026_01102026/PBLCTN_SMRY_BY_AMGPO_BY_CR_BY_NTR_OF_PYMT_PGYR2024_P01232026_01102026.csv",
};

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  if (i === -1) return dflt;
  return process.argv[i + 1];
}

async function findDistribution(year) {
  const target = `${year} payments grouped by reporting entities`;
  try {
    const r = await fetch(METASTORE + "?show-reference-ids=false", { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`metastore ${r.status}`);
    const items = await r.json();
    const hit = items.find((x) => (x.title || "").toLowerCase().startsWith(target.toLowerCase()));
    if (!hit) throw new Error(`no metastore item titled "${target}…"`);
    const r2 = await fetch(METASTORE + `/${hit.identifier}?show-reference-ids=true`, { headers: { "User-Agent": UA } });
    const meta = await r2.json();
    const dist = (meta.distribution || [])[0];
    const url = dist?.data?.downloadURL || dist?.downloadURL;
    if (!url) throw new Error("no downloadURL in distribution");
    return url;
  } catch (e) {
    console.warn(`[metastore] ${e.message} — using fallback URL`);
    return FALLBACK_BY_YEAR[year];
  }
}

async function downloadCSV(url, outPath) {
  console.log(`[download] ${url}`);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`[download] wrote ${(buf.length / 1024 / 1024).toFixed(0)} MB → ${outPath}`);
}

async function aggregate(csvPath) {
  const agg = new Map();
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let nameIdx = -1, amtIdx = -1, txnIdx = -1, recipIdx = -1;
  let nLines = 0;
  for await (const line of rl) {
    nLines++;
    if (!header) {
      header = parseCsvLine(line);
      nameIdx = header.indexOf("AMGPO_Name");
      amtIdx = header.indexOf("Total_Amount");
      txnIdx = header.indexOf("Number_of_Transaction");
      recipIdx = header.indexOf("Recipient_ID");
      if (nameIdx === -1 || amtIdx === -1) throw new Error("CSV header missing expected columns");
      continue;
    }
    const cols = parseCsvLine(line);
    const name = (cols[nameIdx] || "").trim();
    if (!name) continue;
    const amt = parseFloat(cols[amtIdx]) || 0;
    const txn = parseInt(cols[txnIdx], 10) || 0;
    const recip = cols[recipIdx] || "";
    let a = agg.get(name);
    if (!a) {
      a = { total: 0, transactions: 0, recipients: new Set() };
      agg.set(name, a);
    }
    a.total += amt;
    a.transactions += txn;
    if (recip) a.recipients.add(recip);
  }
  console.log(`[aggregate] ${nLines} lines → ${agg.size} manufacturers`);
  const out = {};
  for (const [name, v] of agg) {
    out[name] = {
      total: Math.round(v.total * 100) / 100,
      transactions: v.transactions,
      recipients: v.recipients.size,
    };
  }
  return out;
}

export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function main() {
  const year = parseInt(arg("--year", "2024"), 10);
  const outPath = arg("--out", path.join(OUT_DIR, `${year}.json`));
  await fsp.mkdir(OUT_DIR, { recursive: true });

  const url = await findDistribution(year);
  if (!url) throw new Error(`no distribution URL for year ${year}`);

  const tmpCsv = path.join(OUT_DIR, `_pgyr${year}.csv`);
  if (!fs.existsSync(tmpCsv)) {
    await downloadCSV(url, tmpCsv);
  } else {
    console.log(`[reuse] ${tmpCsv}`);
  }
  const agg = await aggregate(tmpCsv);

  const top = Object.entries(agg).sort((a, b) => b[1].total - a[1].total).slice(0, 20);
  console.log("Top 20 manufacturers by total payments:");
  for (const [name, v] of top) {
    console.log(`  $${(v.total / 1e6).toFixed(1).padStart(7)}M  ${name}`);
  }

  const payload = {
    _source: "https://openpaymentsdata.cms.gov/dataset/03ac661d-a0a7-426f-aca2-c5916ee55db8",
    _sourceCsv: url,
    _license: "https://www.usa.gov/government-works",
    _programYear: year,
    _fetched: new Date().toISOString().slice(0, 10),
    _manufacturers: Object.keys(agg).length,
    manufacturers: agg,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`[done] wrote ${outPath} (${Object.keys(agg).length} manufacturers)`);

  if (!process.argv.includes("--keep-csv")) {
    try { fs.unlinkSync(tmpCsv); } catch {}
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
