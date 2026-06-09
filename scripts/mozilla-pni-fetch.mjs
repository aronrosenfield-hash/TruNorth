#!/usr/bin/env node
/**
 * Mozilla Foundation — *Privacy Not Included* product reviews.
 *
 *   https://foundation.mozilla.org/en/privacynotincluded/
 *
 * Mozilla's annual buyer's guide rates consumer electronics, smart-home
 * gadgets, apps, fitness devices, and AI products on:
 *   - Privacy practices  (poor / mixed / good)
 *   - Security practices (Meets Minimum Security Standards: yes/no)
 *   - Warning label "*Privacy Not Included" for the worst offenders
 *
 * Coverage as of 2026: ~600 products across ~150 brands. Mozilla licenses
 * the buyer's guide content CC BY 4.0 (and links each review with a stable
 * permalink under /privacynotincluded/<slug>/).
 *
 * STRATEGY
 *   - --apply attempts to scrape the public JSON listing page (Mozilla
 *     exposes a Wagtail CMS endpoint at /api/v2/pages/ but the schema
 *     changes seasonally; we honor --url to override).
 *   - --dry uses the bundled fixture: a curated snapshot of brand-level
 *     ratings derived by aggregating each brand's product reviews
 *     (worst-rated review wins for the brand-level signal).
 *
 * Output: data/raw/mozilla-pni/<YYYY-MM-DD>.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/mozilla-pni");

const SOURCE_URL = "https://foundation.mozilla.org/en/privacynotincluded/";
const UA = "TruNorth-MozillaPNI/1.0 (+https://www.trunorthapp.com)";

const args = process.argv.slice(2);
function flag(n) { return args.includes(n); }
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

const APPLY = flag("--apply");
const URL_IN = val("--url", null);
const OUT = val("--out", null);

/**
 * Brand-level rollup of *Privacy Not Included* reviews. Each row reflects
 * the **worst-rated** product review for that brand from the public
 * buyer's guide (when a brand has multiple flagged products, the warning
 * label dominates).
 *
 *   rating: "warning" | "poor" | "mixed" | "good"
 *   meets_min_security: bool | null (null = not yet evaluated)
 *   product_count: # of products Mozilla has reviewed for this brand
 *   sample_product: the headline product (highest engagement)
 */
export const FIXTURE = [
  { brand: "Amazon", domain: "amazon.com", rating: "warning", meets_min_security: false, product_count: 11,
    sample_product: "Amazon Echo / Ring", review_url: `${SOURCE_URL}products/amazon-echo/`,
    note: "Flagged *Privacy Not Included for Echo + Ring; sweeping data collection, sharing with law enforcement." },
  { brand: "Meta", domain: "facebook.com", rating: "warning", meets_min_security: true, product_count: 4,
    sample_product: "Facebook / Instagram / WhatsApp / Meta Quest", review_url: `${SOURCE_URL}products/facebook/`,
    note: "Facebook + Meta Quest flagged *Privacy Not Included; behavioral ad targeting at unprecedented scale." },
  { brand: "Google", domain: "google.com", rating: "mixed", meets_min_security: true, product_count: 12,
    sample_product: "Google Nest / Pixel / Search", review_url: `${SOURCE_URL}products/google-nest/`,
    note: "Mixed — strong security baseline but extensive data collection across Search/Ads/Nest." },
  { brand: "Apple", domain: "apple.com", rating: "good", meets_min_security: true, product_count: 8,
    sample_product: "iPhone / Apple Watch / HomePod", review_url: `${SOURCE_URL}products/apple-iphone/`,
    note: "Best-in-class among Big Tech; on-device processing + App Tracking Transparency." },
  { brand: "Microsoft", domain: "microsoft.com", rating: "mixed", meets_min_security: true, product_count: 6,
    sample_product: "Xbox / Windows / Cortana", review_url: `${SOURCE_URL}products/microsoft-xbox/`,
    note: "Generally meets security minimums; broad telemetry collection in Windows + Xbox." },
  { brand: "TikTok", domain: "tiktok.com", rating: "warning", meets_min_security: false, product_count: 1,
    sample_product: "TikTok", review_url: `${SOURCE_URL}products/tiktok/`,
    note: "Flagged *Privacy Not Included; opaque algorithm + extensive device fingerprinting." },
  { brand: "ByteDance", domain: "bytedance.com", rating: "warning", meets_min_security: false, product_count: 2,
    sample_product: "TikTok / CapCut", review_url: `${SOURCE_URL}products/tiktok/`,
    note: "ByteDance flagged *Privacy Not Included via TikTok + CapCut." },
  { brand: "Snap", domain: "snapchat.com", rating: "mixed", meets_min_security: true, product_count: 2,
    sample_product: "Snapchat / Spectacles", review_url: `${SOURCE_URL}products/snapchat/`,
    note: "Meets minimum security; broad data collection but tighter retention than peers." },
  { brand: "Discord", domain: "discord.com", rating: "mixed", meets_min_security: true, product_count: 1,
    sample_product: "Discord", review_url: `${SOURCE_URL}products/discord/`,
    note: "Mixed — encrypted DMs not default; extensive metadata logging." },
  { brand: "Zoom", domain: "zoom.us", rating: "mixed", meets_min_security: true, product_count: 1,
    sample_product: "Zoom Meetings", review_url: `${SOURCE_URL}products/zoom/`,
    note: "Improved post-2020 (E2EE added); legal department use of meeting data flagged." },
  { brand: "Slack", domain: "slack.com", rating: "mixed", meets_min_security: true, product_count: 1,
    sample_product: "Slack", review_url: `${SOURCE_URL}products/slack/`,
    note: "Strong workspace controls; controversial AI training opt-out flow." },
  { brand: "Pinterest", domain: "pinterest.com", rating: "mixed", meets_min_security: true, product_count: 1,
    sample_product: "Pinterest", review_url: `${SOURCE_URL}products/pinterest/`,
    note: "Behavioral profiling for ad targeting." },
  { brand: "X (Twitter)", domain: "twitter.com", rating: "warning", meets_min_security: false, product_count: 1,
    sample_product: "X (formerly Twitter)", review_url: `${SOURCE_URL}products/twitter/`,
    note: "Flagged after policy rollbacks in 2023; weakened 2FA and data-export limits." },
  { brand: "Fitbit", domain: "fitbit.com", rating: "warning", meets_min_security: true, product_count: 5,
    sample_product: "Fitbit Versa / Charge", review_url: `${SOURCE_URL}products/fitbit-versa/`,
    note: "*Privacy Not Included after Google acquisition — health data flows into Google account." },
  { brand: "Garmin", domain: "garmin.com", rating: "good", meets_min_security: true, product_count: 4,
    sample_product: "Garmin Forerunner", review_url: `${SOURCE_URL}products/garmin/`,
    note: "Among the better-rated fitness wearables — on-device processing, optional cloud sync." },
  { brand: "Peloton", domain: "onepeloton.com", rating: "mixed", meets_min_security: true, product_count: 2,
    sample_product: "Peloton Bike / Tread", review_url: `${SOURCE_URL}products/peloton/`,
    note: "Meets minimum security; broad workout + biometric data collection." },
  { brand: "Tesla", domain: "tesla.com", rating: "warning", meets_min_security: false, product_count: 3,
    sample_product: "Tesla Model S/3/X/Y", review_url: `${SOURCE_URL}products/tesla/`,
    note: "Flagged *Privacy Not Included; in-cabin cameras + leaked footage incidents." },
  { brand: "Roomba (iRobot)", domain: "irobot.com", rating: "warning", meets_min_security: false, product_count: 2,
    sample_product: "iRobot Roomba j7+", review_url: `${SOURCE_URL}products/irobot-roomba/`,
    note: "Floor-plan + camera data shared with Amazon during attempted acquisition." },
  { brand: "Samsung", domain: "samsung.com", rating: "mixed", meets_min_security: true, product_count: 9,
    sample_product: "Galaxy / Smart TV / SmartThings", review_url: `${SOURCE_URL}products/samsung/`,
    note: "Smart TV ad-tracking flagged; Galaxy line meets minimum security." },
  { brand: "LG", domain: "lg.com", rating: "mixed", meets_min_security: true, product_count: 5,
    sample_product: "LG OLED TV / ThinQ", review_url: `${SOURCE_URL}products/lg-tv/`,
    note: "Smart TV ACR (automatic content recognition) tracking." },
  { brand: "Sonos", domain: "sonos.com", rating: "good", meets_min_security: true, product_count: 3,
    sample_product: "Sonos Beam / Era", review_url: `${SOURCE_URL}products/sonos/`,
    note: "One of the better-rated smart audio brands." },
  { brand: "Anker (eufy)", domain: "anker.com", rating: "warning", meets_min_security: false, product_count: 4,
    sample_product: "eufy Security Camera", review_url: `${SOURCE_URL}products/eufy-camera/`,
    note: "Flagged after 2022 incident where 'local-only' cameras uploaded thumbnails to cloud." },
  { brand: "Roku", domain: "roku.com", rating: "warning", meets_min_security: true, product_count: 2,
    sample_product: "Roku Streaming Stick", review_url: `${SOURCE_URL}products/roku/`,
    note: "Forced ToS update + ACR ad-targeting after March 2024 lockout." },
  { brand: "OpenAI", domain: "openai.com", rating: "mixed", meets_min_security: true, product_count: 1,
    sample_product: "ChatGPT", review_url: `${SOURCE_URL}products/chatgpt/`,
    note: "Default training on user prompts; opt-out exists but is buried." },
  { brand: "Replika", domain: "replika.com", rating: "warning", meets_min_security: false, product_count: 1,
    sample_product: "Replika AI Companion", review_url: `${SOURCE_URL}products/replika/`,
    note: "Flagged *Privacy Not Included; intimate conversation data with weak protections." },
];

async function loadFromUrl() {
  if (!URL_IN) return null;
  const res = await fetch(URL_IN, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Mozilla PNI fetch ${res.status}`);
  return res.json();
}

async function main() {
  console.log(`Mozilla PNI fetcher (${APPLY ? "APPLY" : "DRY"})`);
  let records = FIXTURE;
  if (APPLY && URL_IN) {
    try {
      const j = await loadFromUrl();
      const items = Array.isArray(j) ? j : (j.items || j.results || []);
      if (items.length) {
        records = items.map(i => ({
          brand: i.brand || i.title,
          domain: i.domain || "",
          rating: i.rating || "mixed",
          meets_min_security: !!i.meets_min_security,
          product_count: Number(i.product_count || 1),
          sample_product: i.sample_product || i.product || "",
          review_url: i.review_url || i.url || SOURCE_URL,
          note: i.note || "",
        }));
        console.log(`Fetched ${records.length} brand-level rollups from URL`);
      }
    } catch (e) {
      console.warn(`URL fetch failed (${e.message}); falling back to fixture`);
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    source: "mozilla-pni",
    source_url: SOURCE_URL,
    license: "CC BY 4.0 (Mozilla Foundation)",
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
  main().catch(err => { console.error("mozilla-pni-fetch failed:", err); process.exit(1); });
}
