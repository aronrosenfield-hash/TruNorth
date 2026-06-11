#!/usr/bin/env node
/**
 * SAM.gov Exclusions fetcher (R7 #6, 2026-06-11).
 *
 * Downloads the latest daily Public Extract V2 ZIP (firm + individual federal
 * exclusions/debarments) from the public falextracts S3 bucket — discovered
 * via sam.gov fileextractservices listing; no API key, no login. Keeps
 * ACTIVE, FIRM-classified records only.
 *
 * License: US government public data — no commercial restriction. (The SAM
 * Contract Awards API is NOT used: 10 req/day free tier is impractical —
 * USAspending covers awards instead.)
 *
 * Writes public/data/sam-exclusions.json. Guard: refuses tiny snapshots.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public/data/sam-exclusions.json");
const TMP = "/tmp/sam-exclusions";
const UA = "TruNorth-SAM/1.0 (data pipeline; contact@trunorthapp.com)";

const listing = await (await fetch(
  "https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Exclusions/Public%20V2",
  { headers: { "User-Agent": UA } }
)).json();
const files = (listing?._embedded?.customS3ObjectSummaryList || [])
  .filter((f) => /SAM_Exclusions_Public_Extract_V2_\d+\.ZIP$/i.test(f.key || ""))
  .sort((a, b) => (b.key > a.key ? 1 : -1));
if (!files.length) throw new Error("no V2 exclusion extracts in listing");
const latest = files[0].key;
console.log(`[sam] latest extract: ${latest}`);

fs.mkdirSync(TMP, { recursive: true });
const zipPath = path.join(TMP, "exclusions.zip");
// Direct S3 access 403s — the fileextractservices download route is the
// supported public path (verified 200, ~12MB).
const url = `https://sam.gov/api/prod/fileextractservices/v1/api/download/${latest.split("/").map(encodeURIComponent).join("/")}?privacy=Public`;
const res = await fetch(url, { headers: { "User-Agent": UA } });
if (!res.ok) throw new Error(`S3 ${res.status} ${url}`);
fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync("unzip", ["-o", "-q", zipPath, "-d", TMP]);
const csvFile = fs.readdirSync(TMP).find((f) => /\.csv$/i.test(f));
if (!csvFile) throw new Error("no CSV inside extract zip");

const text = fs.readFileSync(path.join(TMP, csvFile), "utf8");
const lines = text.split(/\r?\n/);
const parseLine = (l) => {
  const out = []; let cur = "", q = false;
  for (const ch of l) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
};
const header = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/"/g, ""));
const col = (n) => header.findIndex((h) => h.includes(n));
const iClass = col("classification");
const iName = col("name");
const iType = col("exclusion type");
const iAgency = col("excluding agency");
const iActive = col("active date");
const iTerm = col("termination date");

const firms = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseLine(lines[i]);
  if (!/firm/i.test(c[iClass] || "")) continue;
  const term = c[iTerm] || "";
  // keep active only (no termination date or far-future "indefinite")
  if (term && !/2[1-9]\d\d|indefinite/i.test(term)) continue;
  firms.push({
    name: c[iName],
    type: c[iType] || null,
    agency: c[iAgency] || null,
    activeDate: c[iActive] || null,
  });
}

if (firms.length < 1000) {
  console.error(`[sam] FATAL: only ${firms.length} active firm exclusions — expected thousands. Refusing to write.`);
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify({
  source: latest,
  license: "US government public data — no commercial restriction",
  fetchedAt: new Date().toISOString(),
  count: firms.length,
  firms,
}));
console.log(`[sam] wrote ${firms.length} active firm exclusions`);
