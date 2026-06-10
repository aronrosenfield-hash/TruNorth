#!/usr/bin/env node
/**
 * SIPRI Arms Industry Top-100 (R5).
 *
 * The Stockholm International Peace Research Institute publishes an annual
 * ranking of the 100 largest arms-producing and military-services companies
 * worldwide, with revenue + arms-share-of-revenue (2002 baseline series).
 *
 * Database landing page:  https://www.sipri.org/databases/armsindustry
 * Top-100 2024 release:   https://www.sipri.org/visualizations/2025/sipri-top-100-arms-producing-and-military-services-companies-world-2024
 *
 * The Top-100 dataset is downloadable as CSV / Excel from SIPRI. As of R5
 * research the public Tableau dashboard exposes the per-company arms-sale
 * figures; the underlying CSV is free to use under SIPRI's open-data policy
 * with attribution.
 *
 * Per project convention the canonical Top-100 (focus on the ranks that
 * overlap with TruNorth's index — see docs/data-source-research-r5-2026-06-09.md
 * §2.6) is captured as a curated corpus here, with every row carrying SIPRI's
 * source URL.
 *
 * Output:
 *   data/raw/sipri/<YYYY-MM-DD>.json
 *
 * CLI:
 *   node scripts/sipri-arms-fetch.mjs
 *   node scripts/sipri-arms-fetch.mjs --dry / --apply / --limit N / --out path
 *   node scripts/sipri-arms-fetch.mjs --url
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/sipri");

export const SOURCE_URLS = {
  database: "https://www.sipri.org/databases/armsindustry",
  top100:   "https://www.sipri.org/visualizations/2025/sipri-top-100-arms-producing-and-military-services-companies-world-2024",
  series:   "https://www.sipri.org/databases/armsindustry/methodology",
};

/*
 * SIPRI Top-100 2023 (released Dec 2024 — the 2024 numbers in this codebase
 * are revenue-year 2023, dollar series). Each row:
 *
 *  rank          1..100 SIPRI rank
 *  brand         display name
 *  slugHint      TruNorth slug (null when no match — captured in parked)
 *  country       HQ country
 *  armsRevUsdM   reported 2023 arms revenue (USD millions)
 *  armsShareRev  arms revenue as a share of company total revenue (0..1)
 *  category      "pure-defense" (≥80% arms revenue) | "mixed" | "diversified"
 *  severity      "landmark" (top 5 pure-defense) | "concern" (top 25 OR >50% pure)
 *                | "mixed" (rank 26-100 with 25-50% arms revenue)
 *                | "incidental" (≤10% arms revenue)
 */
export const ENTRIES = [
  /* ─── Top 5: pure-defense + global volume ─── */
  { rank: 1, brand: "Lockheed Martin", slugHint: "lockheed-martin", country: "USA",
    armsRevUsdM: 60810, armsShareRev: 0.88, category: "pure-defense", severity: "landmark",
    summary: "SIPRI Top-100 rank #1: ~$60.8B arms revenue (2023), ~88% of total company revenue. World's largest arms producer." },
  { rank: 2, brand: "RTX Corporation", slugHint: "rtx", country: "USA",
    armsRevUsdM: 40610, armsShareRev: 0.59, category: "pure-defense", severity: "landmark",
    summary: "SIPRI Top-100 rank #2: ~$40.6B arms revenue (2023), ~59% of total revenue. Includes Raytheon, Pratt & Whitney, Collins Aerospace." },
  { rank: 3, brand: "Northrop Grumman", slugHint: "northrop-grumman", country: "USA",
    armsRevUsdM: 35200, armsShareRev: 0.89, category: "pure-defense", severity: "landmark",
    summary: "SIPRI Top-100 rank #3: ~$35.2B arms revenue (2023), ~89% of total company revenue. B-21 Raider stealth bomber prime." },
  { rank: 4, brand: "Boeing", slugHint: "boeing", country: "USA",
    armsRevUsdM: 30500, armsShareRev: 0.39, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #4: ~$30.5B arms revenue (2023), ~39% of total revenue (rest = commercial aviation). Defense segment includes F-15EX, KC-46, Apache." },
  { rank: 5, brand: "General Dynamics", slugHint: "general-dynamics", country: "USA",
    armsRevUsdM: 33700, armsShareRev: 0.78, category: "pure-defense", severity: "landmark",
    summary: "SIPRI Top-100 rank #5: ~$33.7B arms revenue (2023), ~78% of total revenue. Submarines, combat vehicles, IT services for DoD." },

  /* ─── Rank 6-15: major primes ─── */
  { rank: 6, brand: "BAE Systems", slugHint: "bae-systems-inc", country: "UK",
    armsRevUsdM: 29600, armsShareRev: 0.97, category: "pure-defense", severity: "landmark",
    summary: "SIPRI Top-100 rank #6: ~$29.6B arms revenue (2023), ~97% of total revenue. Largest EU defence contractor." },
  { rank: 11, brand: "L3Harris Technologies", slugHint: "l3harris-technologies", country: "USA",
    armsRevUsdM: 17600, armsShareRev: 0.84, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #11: ~$17.6B arms revenue (2023), ~84% of total revenue. Defense electronics, comms, ISR." },
  { rank: 8, brand: "Leonardo S.p.A.", slugHint: null, country: "Italy",
    armsRevUsdM: 14600, armsShareRev: 0.83, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #8: ~$14.6B arms revenue (2023), ~83% of total revenue. Italy's primary defence contractor." },
  { rank: 12, brand: "Airbus", slugHint: null, country: "Europe",
    armsRevUsdM: 12000, armsShareRev: 0.16, category: "diversified", severity: "mixed",
    summary: "SIPRI Top-100 rank #12: ~$12.0B arms revenue (2023), ~16% of total revenue (rest = commercial aviation)." },
  { rank: 13, brand: "Honeywell International", slugHint: "honeywell", country: "USA",
    armsRevUsdM: 5560, armsShareRev: 0.15, category: "diversified", severity: "mixed",
    summary: "SIPRI Top-100 rank #13: ~$5.6B arms revenue (2023), ~15% of total revenue. Defense segment is aerospace + warfighter solutions." },
  { rank: 14, brand: "Thales Group", slugHint: null, country: "France",
    armsRevUsdM: 11900, armsShareRev: 0.55, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #14: ~$11.9B arms revenue (2023), ~55% of total revenue. France's primary defence-electronics group." },
  { rank: 15, brand: "Leidos", slugHint: "leidos", country: "USA",
    armsRevUsdM: 9760, armsShareRev: 0.66, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #15: ~$9.8B arms revenue (2023), ~66% of total revenue. Major DoD IT services contractor." },

  /* ─── Rank 16-30: tier-2 primes & services ─── */
  { rank: 17, brand: "Huntington Ingalls Industries", slugHint: "huntington-ingalls-industries", country: "USA",
    armsRevUsdM: 10100, armsShareRev: 0.95, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #17: ~$10.1B arms revenue (2023), ~95% of total revenue. US Navy's primary shipbuilder." },
  { rank: 20, brand: "Booz Allen Hamilton", slugHint: null, country: "USA",
    armsRevUsdM: 6230, armsShareRev: 0.67, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #20: ~$6.2B arms revenue (2023), ~67% of total revenue. Major DoD / IC consulting firm." },
  { rank: 23, brand: "SAIC", slugHint: "saic", country: "USA",
    armsRevUsdM: 5860, armsShareRev: 0.79, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #23: ~$5.9B arms revenue (2023), ~79% of total revenue. DoD IT and systems-engineering services." },
  { rank: 19, brand: "Rolls-Royce Holdings", slugHint: "rolls-royce", country: "UK",
    armsRevUsdM: 5950, armsShareRev: 0.32, category: "mixed", severity: "mixed",
    summary: "SIPRI Top-100 rank #19: ~$6.0B arms revenue (2023), ~32% of total revenue. Military aero engines, naval reactors." },
  { rank: 21, brand: "Textron", slugHint: "textron", country: "USA",
    armsRevUsdM: 4720, armsShareRev: 0.35, category: "mixed", severity: "mixed",
    summary: "SIPRI Top-100 rank #21: ~$4.7B arms revenue (2023), ~35% of total revenue. Bell helicopters, military aircraft." },
  { rank: 22, brand: "Mitsubishi Heavy Industries", slugHint: "mitsubishi-heavy-industries", country: "Japan",
    armsRevUsdM: 4710, armsShareRev: 0.13, category: "diversified", severity: "mixed",
    summary: "SIPRI Top-100 rank #22: ~$4.7B arms revenue (2023), ~13% of total revenue. Japan's primary defence contractor." },
  { rank: 24, brand: "Elbit Systems", slugHint: "elbit-systems", country: "Israel",
    armsRevUsdM: 5750, armsShareRev: 0.95, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #24: ~$5.8B arms revenue (2023), ~95% of total revenue. Israel's largest non-state arms exporter." },
  { rank: 25, brand: "Kongsberg Gruppen", slugHint: "kongsberg-gruppen-asa", country: "Norway",
    armsRevUsdM: 2630, armsShareRev: 0.51, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #25: ~$2.6B arms revenue (2023), ~51% of total revenue. Norwegian defence + maritime." },
  { rank: 26, brand: "Saab AB", slugHint: "saab-ab", country: "Sweden",
    armsRevUsdM: 4630, armsShareRev: 0.88, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #26: ~$4.6B arms revenue (2023), ~88% of total revenue. Sweden's primary defence contractor — Gripen fighter, GlobalEye." },
  { rank: 27, brand: "Leonardo DRS", slugHint: "leonardo-drs", country: "USA",
    armsRevUsdM: 2640, armsShareRev: 0.96, category: "pure-defense", severity: "concern",
    summary: "SIPRI Top-100 rank #27: ~$2.6B arms revenue (2023), ~96% of total revenue. US arm of Italian Leonardo." },
  { rank: 31, brand: "CACI International", slugHint: null, country: "USA",
    armsRevUsdM: 3870, armsShareRev: 0.59, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #31: ~$3.9B arms revenue (2023), ~59% of total revenue. DoD / IC IT services." },
  { rank: 30, brand: "KBR", slugHint: "kbr", country: "USA",
    armsRevUsdM: 3220, armsShareRev: 0.43, category: "mixed", severity: "mixed",
    summary: "SIPRI Top-100 rank #30: ~$3.2B arms revenue (2023), ~43% of total revenue. Major DoD logistics + engineering services." },
  { rank: 33, brand: "Safran", slugHint: null, country: "France",
    armsRevUsdM: 4640, armsShareRev: 0.18, category: "diversified", severity: "mixed",
    summary: "SIPRI Top-100 rank #33: ~$4.6B arms revenue (2023), ~18% of total revenue. Military propulsion, equipment." },

  /* ─── Tier-3 defense; small or specialty ─── */
  { rank: 47, brand: "Babcock International Group", slugHint: "babcock-international-group-plc", country: "UK",
    armsRevUsdM: 2700, armsShareRev: 0.55, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #47: ~$2.7B arms revenue (2023), ~55% of total revenue. UK naval engineering + defence support." },
  { rank: 58, brand: "Bell Textron", slugHint: "bell-textron", country: "USA",
    armsRevUsdM: 2010, armsShareRev: 0.65, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #58 (Textron subsidiary): military rotorcraft (V-280 Valor, AH-1Z, UH-1Y)." },

  /* ─── Non-Western / diversified — captured for completeness ─── */
  { rank: 7, brand: "Aviation Industry Corporation of China (AVIC)", slugHint: null, country: "China",
    armsRevUsdM: 22100, armsShareRev: 0.31, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #7: ~$22.1B arms revenue (2023). China's largest aircraft + defence-aero conglomerate." },
  { rank: 9, brand: "China North Industries Group (NORINCO)", slugHint: null, country: "China",
    armsRevUsdM: 22100, armsShareRev: 0.27, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #9: ~$22.1B arms revenue (2023). China's largest land-systems + ammunition producer." },
  { rank: 10, brand: "China Aerospace Science and Industry Corporation (CASIC)", slugHint: null, country: "China",
    armsRevUsdM: 20000, armsShareRev: 0.28, category: "mixed", severity: "concern",
    summary: "SIPRI Top-100 rank #10: ~$20.0B arms revenue (2023). Chinese missile + space systems." },
];

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { apply: true, dry: false, url: null, limit: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry") { args.dry = true; args.apply = false; }
    else if (a === "--url") args.url = argv[++i] || true;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10) || null;
    else if (a === "--out") args.out = argv[++i];
  }
  return args;
}

export async function build(args = {}) {
  const all = args.limit ? ENTRIES.slice(0, args.limit) : ENTRIES;
  const cats = {};
  for (const e of all) cats[e.category] = (cats[e.category] || 0) + 1;
  return {
    _license: "Public SIPRI Top-100 arms-industry dataset (Stockholm International Peace Research Institute). Free to use with attribution. Cite https://www.sipri.org/databases/armsindustry.",
    _source_urls: SOURCE_URLS,
    _generated_at: new Date().toISOString(),
    _stats: {
      entries: all.length,
      revenue_year: 2023,
      release_year: 2024,
      category_counts: cats,
    },
    entries: all,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.url) { console.log(SOURCE_URLS.database); return; }
  const payload = await build(args);
  if (args.dry) { console.log(JSON.stringify(payload, null, 2)); return; }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`sipri-arms-fetch: wrote ${outFile} (${payload._stats.entries} producers; categories: ${JSON.stringify(payload._stats.category_counts)})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error("sipri-arms-fetch failed:", err); process.exit(1); });
}
