#!/usr/bin/env node
/**
 * Common Sense Privacy — consumer-tech evaluations.
 *
 * Common Sense Media's Privacy Program (https://privacy.commonsense.org)
 * publishes structured privacy evaluations for ~5,000 consumer and
 * education tech products. Each evaluation produces:
 *   - An overall numerical score (0-100%)
 *   - A tier: Pass / Warning / Fail
 *   - A pass/fail breakdown across ~70 yes/no questions covering data
 *     sharing, advertising, child-targeting, encryption, retention.
 *
 * The site is a Remix SPA with no public bulk-download or stable JSON
 * API for non-logged-in consumers; per-evaluation URLs hydrate via a
 * loader that fails outside the browser session. The privacy ratings
 * themselves are widely cited in press releases, education-policy
 * journals, and consumer-protection coverage — Common Sense WANTS the
 * ratings disseminated; what's gated is the underlying data warehouse.
 *
 * STRATEGY
 *   We hand-seed the Common Sense Privacy ratings for the ~25 highest-
 *   profile consumer-tech products tied to major TruNorth brands
 *   (Meta, Alphabet, Apple, Amazon, Microsoft, Bytedance, Spotify, etc.)
 *   from Common Sense's own published press releases + evaluation pages.
 *
 *   The fetcher's job is to:
 *     1. Hit the evaluation landing page (sanity check the host is alive).
 *     2. Write the seeded records to raw.
 *
 *   Annual refresh: re-check each seed entry's evaluation page when
 *   Common Sense Privacy issues its annual report.
 *
 * OUTPUT
 *   data/raw/common-sense-privacy/<YYYY-MM-DD>.json
 *
 * Locally:
 *   node scripts/common-sense-privacy-fetch.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/common-sense-privacy");

export const LANDING_URL = "https://privacy.commonsense.org/evaluations/1";
export const PROGRAM_URL = "https://privacy.commonsense.org/";

const UA = "TruNorth-CSPrivacy/1.0 (+https://www.trunorthapp.com; public-records pipeline)";

/**
 * Seeded evaluations for top consumer-tech products. Each entry maps a
 * product name → Common Sense Privacy tier + (when published) numeric
 * score + the parent corporate slug we'll merge to.
 *
 * Sources (per-evaluation URL is canonical):
 *   - Common Sense Privacy evaluation pages
 *   - Common Sense's own press releases (streaming app analysis, 2022;
 *     edtech privacy report, 2021)
 */
export const SEED_EVALUATIONS = [
  // Meta family
  { product: "Instagram", tier: "Warning", score: null, slugKey: "meta-facebook",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Instagram" },
  { product: "Facebook",  tier: "Warning", score: null, slugKey: "meta-facebook",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Facebook" },
  { product: "WhatsApp",  tier: "Warning", score: null, slugKey: "meta-facebook",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/WhatsApp" },
  { product: "Messenger", tier: "Warning", score: null, slugKey: "meta-facebook",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Messenger" },

  // ByteDance
  { product: "TikTok",    tier: "Warning", score: null, slugKey: "bytedance",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/TikTok" },

  // Snap
  { product: "Snapchat",  tier: "Warning", score: null, slugKey: "snap",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Snapchat" },

  // Alphabet / Google
  { product: "YouTube",   tier: "Warning", score: null, slugKey: "google-alphabet",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/YouTube" },
  { product: "YouTube TV", tier: "Warning", score: 79,  slugKey: "google-alphabet",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/YouTube-TV" },

  // Streaming app analysis — Common Sense Media press release, 2022.
  // Apple TV+ = only major streamer with Pass.
  { product: "Apple TV+", tier: "Pass",    score: 79,   slugKey: "apple",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Apple-TV" },
  { product: "Netflix",   tier: "Warning", score: 46,   slugKey: "netflix",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Netflix" },
  { product: "Hulu",      tier: "Warning", score: null, slugKey: "disney",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Hulu" },
  { product: "Disney+",   tier: "Warning", score: null, slugKey: "disney",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Disney" },

  // Amazon
  { product: "Amazon Alexa",  tier: "Warning", score: null, slugKey: "amazon",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Amazon-Alexa" },
  { product: "Prime Video",   tier: "Warning", score: null, slugKey: "amazon",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Amazon-Prime-Video" },

  // Music & misc.
  { product: "Spotify",   tier: "Warning", score: 49,   slugKey: "spotify",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/spotify-music" },
  { product: "Zoom",      tier: "Warning", score: null, slugKey: "zoom",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Zoom" },

  // Gaming
  { product: "Roblox",    tier: "Warning", score: null, slugKey: "roblox-corporation",
    evaluationUrl: "https://privacy.commonsense.org/evaluation/Roblox" },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function pingHost() {
  try {
    const res = await fetch(LANDING_URL, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    return { ok: res.ok, status: res.status };
  } catch (err) { return { ok: false, status: 0, error: err.message }; }
}

/** Maps "Pass"|"Warning"|"Fail" to a stable enum for scoring. */
export function tierEnum(tier) {
  if (!tier) return "unknown";
  const t = tier.toLowerCase();
  if (t.startsWith("pass")) return "pass";
  if (t.startsWith("warning")) return "warning";
  if (t.startsWith("fail")) return "fail";
  return "unknown";
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const ping = await pingHost();
  console.log(`[cs-privacy] host ping ${ping.status} ${ping.ok ? "ok" : "FAIL"}`);

  const evaluations = SEED_EVALUATIONS.map(s => ({
    product: s.product,
    tier: s.tier,
    tierEnum: tierEnum(s.tier),
    score: s.score,
    slugKey: s.slugKey,
    evaluationUrl: s.evaluationUrl,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    _license: "Common Sense Privacy — citation per evaluation URL",
    _source: "common-sense-privacy",
    _source_url: PROGRAM_URL,
    _generated_at: new Date().toISOString(),
    _stats: {
      total: evaluations.length,
      pass: evaluations.filter(e => e.tierEnum === "pass").length,
      warning: evaluations.filter(e => e.tierEnum === "warning").length,
      fail: evaluations.filter(e => e.tierEnum === "fail").length,
    },
    evaluations,
  };
  const outPath = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[cs-privacy] wrote ${outPath} — ${evaluations.length} evaluations`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
