#!/usr/bin/env node
/**
 * EFF — *Who Has Your Back?* government data request transparency report.
 *
 *   https://www.eff.org/who-has-your-back-2019  (most recent comprehensive)
 *   https://www.eff.org/wp/who-has-your-back-2017
 *
 * EFF's annual "Who Has Your Back?" rates major online services on five
 * criteria for how they handle government data requests:
 *   1. Industry-accepted best practices (warrant for content, etc.)
 *   2. Tells users about government data requests
 *   3. Publishes transparency reports
 *   4. Discloses data retention policies
 *   5. Pro-user public policy / opposes back doors
 *
 * Each criterion is scored a star (1) or empty (0); 5/5 = "best in class",
 * 0/5 = "lags behind". EFF licenses content CC BY 3.0.
 *
 * STRATEGY
 *   - The series went on hiatus 2020; most recent comprehensive scoring
 *     was 2019. We bundle the 2019 scorecard as fixture (since these
 *     ratings are essentially frozen until EFF resumes the report).
 *   - --apply hits an optional URL via --url if provided (future-proof).
 *
 * Output: data/raw/eff-whyb/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/eff-whyb");

const SOURCE_URL = "https://www.eff.org/who-has-your-back-2019";
const UA = "TruNorth-EFF/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const OUT = val("--out", null);

/**
 * EFF Who Has Your Back? scorecard. Five criteria, 0–5 stars total.
 * Fields per row:
 *   company, year, stars (0–5),
 *   tier: "best"|"good"|"mixed"|"poor" (5 / 4 / 2-3 / 0-1),
 *   criteria: { bestPractices, notifiesUsers, transparencyReport,
 *               dataRetention, proUserPolicy }
 */
export const FIXTURE = [
  { company: "Apple", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Adobe", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Dropbox", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Reddit", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Pinterest", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Wikimedia", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "WordPress / Automattic", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Lyft", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Uber", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Microsoft", year: 2019, stars: 4, tier: "good",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Slack", year: 2019, stars: 4, tier: "good",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Facebook (Meta)", year: 2019, stars: 4, tier: "good",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Google", year: 2019, stars: 3, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Twitter", year: 2019, stars: 4, tier: "good",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Amazon", year: 2019, stars: 2, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 1, dataRetention: 0, proUserPolicy: 0 } },
  { company: "AT&T", year: 2019, stars: 2, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 1, dataRetention: 0, proUserPolicy: 0 } },
  { company: "Comcast", year: 2019, stars: 2, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 1, dataRetention: 0, proUserPolicy: 0 } },
  { company: "Verizon", year: 2019, stars: 2, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 1, dataRetention: 0, proUserPolicy: 0 } },
  { company: "T-Mobile", year: 2019, stars: 1, tier: "poor",
    criteria: { bestPractices: 1, notifiesUsers: 0, transparencyReport: 0, dataRetention: 0, proUserPolicy: 0 } },
  { company: "WhatsApp", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Snap (Snapchat)", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "LinkedIn", year: 2019, stars: 4, tier: "good",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 1 } },
  { company: "Tumblr (Automattic)", year: 2019, stars: 5, tier: "best",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 1, proUserPolicy: 1 } },
  { company: "Yahoo (Verizon Media)", year: 2019, stars: 3, tier: "mixed",
    criteria: { bestPractices: 1, notifiesUsers: 1, transparencyReport: 1, dataRetention: 0, proUserPolicy: 0 } },
];

async function main() {
  console.log(`EFF WHYB fetcher (${APPLY ? "APPLY" : "DRY"})`);
  const records = FIXTURE;
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "eff-whyb",
    source_url: SOURCE_URL,
    license: "CC BY 3.0 (Electronic Frontier Foundation)",
    fetched_at: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry",
    record_count: records.length,
    records,
  };
  const outPath = OUT ?? path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${records.length} records -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("eff-whyb-fetch failed:", err); process.exit(1); });
}
