#!/usr/bin/env node
/**
 * CNIL (Commission Nationale de l'Informatique et des Libertés) —
 * French Data Protection Authority enforcement actions.
 *
 *   https://www.cnil.fr/en/cnils-sanctions
 *   https://www.cnil.fr/en/decisions
 *
 * CNIL is the most active EU DPA. While many cases are covered by the
 * gdpr-enforcement (enforcementtracker.com) source, CNIL also issues
 * formal notices (mises en demeure), public reprimands, and cookie /
 * pre-GDPR Loi Informatique sanctions that don't all flow through the
 * tracker. This source captures the most-cited CNIL-specific public
 * fines so consumers see "French regulator action: €X."
 *
 * STRATEGY: fixture-only (real public sanctions). --apply does a HEAD.
 *
 * Output: data/raw/cnil-enforcement/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/cnil-enforcement");
const SOURCE_URL = "https://www.cnil.fr/en/cnils-sanctions";
const UA = "TruNorth-CNIL/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }
const APPLY = flag("--apply");
const LIMIT = Number(val("--limit", 0)) || 0;
const OUT = val("--out", null);
const URL_OVERRIDE = val("--url", SOURCE_URL);

export const FIXTURE = [
  { company: "Google LLC", date: "2022-01-06", fine_eur: 150000000,
    issue: "Cookie consent — opt-out flow harder than opt-in",
    summary: "€150M CNIL fine: Google made refusing cookies significantly harder than accepting them on google.fr and youtube.com.",
    url: "https://www.cnil.fr/en/cookies-google-fined-150-million-euros" },
  { company: "Facebook Ireland / Meta", date: "2022-01-06", fine_eur: 60000000,
    issue: "Cookie consent — opt-out flow harder than opt-in",
    summary: "€60M CNIL fine for the same cookie design pattern on facebook.com.",
    url: "https://www.cnil.fr/en/cookies-facebook-fined-60-million-euros" },
  { company: "Google LLC", date: "2019-01-21", fine_eur: 50000000,
    issue: "Lack of transparency, inadequate information, consent",
    summary: "€50M first major French GDPR fine (CNIL) over Android consent flow obscuring ad-personalisation choices.",
    url: "https://www.cnil.fr/en/cnils-restricted-committee-imposes-financial-penalty-50-million-euros-against-google-llc" },
  { company: "Amazon France", date: "2020-12-07", fine_eur: 35000000,
    issue: "Cookies placed without consent",
    summary: "€35M fine for placing advertising cookies on amazon.fr without consent + insufficient information.",
    url: "https://www.cnil.fr/en/cookies-cnil-fines-amazon-europe-core-35-million-euros" },
  { company: "Google LLC", date: "2020-12-07", fine_eur: 100000000,
    issue: "Cookies placed without consent",
    summary: "€100M fine on Google + €60M on Google Ireland for placing ad cookies without consent on google.fr.",
    url: "https://www.cnil.fr/en/cookies-cnil-fines-google-100-million-euros" },
  { company: "Clearview AI", date: "2022-10-20", fine_eur: 20000000,
    issue: "Facial recognition — unlawful processing",
    summary: "€20M fine; Clearview ignored access requests + scraped images of EU residents without legal basis.",
    url: "https://www.cnil.fr/en/facial-recognition-20-million-euros-penalty-against-clearview-ai" },
  { company: "Microsoft Ireland Operations", date: "2022-12-22", fine_eur: 60000000,
    issue: "Cookie consent on Bing",
    summary: "€60M fine: bing.com placed advertising cookies on user terminals without consent.",
    url: "https://www.cnil.fr/en/cookies-cnil-fines-microsoft-ireland-operations-limited-60-million-euros" },
  { company: "Apple Distribution International", date: "2023-01-04", fine_eur: 8000000,
    issue: "Identifier for Advertisers placed without consent",
    summary: "€8M French fine on Apple iOS 14.6 for storing IDFA identifiers before consent.",
    url: "https://www.cnil.fr/en/personalised-advertising-and-prior-collection-consent-sanction-of-eur8-million-against-apple" },
  { company: "Spartoo", date: "2020-07-28", fine_eur: 250000,
    issue: "Disproportionate retention + recording of full call audio",
    summary: "€250K CNIL fine on Spartoo shoe retailer for excessive employee call recordings + over-collection.",
    url: "https://www.cnil.fr/en/cnil-fines-spartoo-eur250000" },
  { company: "Carrefour France", date: "2020-11-18", fine_eur: 2250000,
    issue: "Loyalty card data + customer rights violations",
    summary: "€2.25M fine on Carrefour France over loyalty programme data minimisation + handling of access requests.",
    url: "https://www.cnil.fr/en/cnil-fines-carrefour-france-and-carrefour-banque" },
  { company: "Criteo SA", date: "2023-06-15", fine_eur: 40000000,
    issue: "Inadequate consent + access rights for ad tracking",
    summary: "€40M French CNIL fine on Criteo (ad-tech retargeting) for lack of valid consent + obstructed user-rights flow.",
    url: "https://www.cnil.fr/en/criteo-40-million-euros-fine-imposed" },
  { company: "Discord Inc.", date: "2022-11-10", fine_eur: 800000,
    issue: "Retention period + password policy",
    summary: "€800K fine on Discord for retaining inactive accounts indefinitely + weak password requirements.",
    url: "https://www.cnil.fr/en/discord-inc-fined-800000-euros" },
];

async function fetchLive() {
  const res = await fetch(URL_OVERRIDE, { method: "HEAD", headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`CNIL HEAD ${res.status}`);
  return FIXTURE;
}

async function main() {
  console.log(`CNIL enforcement fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records;
  if (APPLY) {
    try { records = await fetchLive(); console.log("Live page reachable; using curated fixture"); }
    catch (e) { console.warn(`Live probe failed (${e.message}); using fixture`); records = FIXTURE; }
  } else { records = FIXTURE; }
  if (LIMIT > 0) records = records.slice(0, LIMIT);
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "cnil-enforcement",
    source_url: SOURCE_URL,
    license: "Public record (CNIL France)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} CNIL actions -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error("cnil-enforcement-fetch failed:", err); process.exit(1); });
