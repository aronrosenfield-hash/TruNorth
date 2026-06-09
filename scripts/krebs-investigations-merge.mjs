#!/usr/bin/env node
/**
 * Krebs investigations merge → data/derived/krebs-investigations-augment.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/krebs-investigations");
const DERIVED = path.join(ROOT, "data/derived/krebs-investigations-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const COMPANY_TO_SLUGS = [
  [/^target/i,     ["target"]],
  [/home depot/i,  ["home-depot"]],
  [/equifax/i,     ["equifax"]],
  [/capital one/i, ["capital-one"]],
  [/solarwinds/i,  ["solarwinds"]],
  [/microsoft/i,   ["microsoft"]],
  [/t-mobile/i,    ["t-mobile", "tmobile", "t-mobile-us"]],
  [/lastpass/i,    ["lastpass", "goto"]],
  [/twilio/i,      ["twilio"]],
  [/^okta/i,       ["okta"]],
  [/mgm/i,         ["mgm-resorts", "mgm-resorts-international"]],
  [/caesars/i,     ["caesars-entertainment", "caesars"]],
  [/snowflake/i,   ["snowflake"]],
  [/at&t|^at\\&t/i,["att", "at-t", "att-inc"]],
  [/ticketmaster|live nation/i, ["ticketmaster", "live-nation", "live-nation-entertainment"]],
];

function slugsForCompany(name) {
  for (const [re, slugs] of COMPANY_TO_SLUGS) if (re.test(name)) return slugs;
  return [];
}

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

const SEV = { moderate: 1, high: 2, severe: 3 };

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const slugs = slugsForCompany(r.company || "");
    if (!slugs.length) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          investigation_count: 0,
          severity_max: "moderate",
          total_individuals: 0,
          first_incident: null,
          last_incident: null,
          investigations: [],
          source: "krebs-investigations",
          source_url: "https://krebsonsecurity.com/",
        };
      }
      const agg = by[slug];
      agg.investigation_count += 1;
      agg.total_individuals += Number(r.individuals_affected || 0);
      if (SEV[r.severity] > SEV[agg.severity_max]) agg.severity_max = r.severity;
      const d = r.date || "";
      if (d) {
        if (!agg.first_incident || d < agg.first_incident) agg.first_incident = d;
        if (!agg.last_incident || d > agg.last_incident) agg.last_incident = d;
      }
      agg.investigations.push({
        date: d, incident_type: r.incident_type, severity: r.severity,
        individuals_affected: r.individuals_affected, summary: r.summary, url: r.url,
      });
    }
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run krebs-investigations-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "krebs-investigations",
    source_url: "https://krebsonsecurity.com/",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("krebs-investigations-merge failed:", err); process.exit(1); });
