#!/usr/bin/env node
/**
 * HIBP breaches merge — group by domain → company slug, aggregate.
 *
 * Reads newest data/raw/hibp-breaches/<date>.json
 *   → data/derived/hibp-breaches-augment.json
 *
 * Keyed by company slug. Aggregates total accounts pwned, breach count,
 * earliest + latest breach, severity (sensitive = SSN/credit-card/passport),
 * and 3 sample breaches.
 *
 * Domain → slug mapping is conservative: we map each known domain to its
 * canonical TruNorth slug(s). When a breach belongs to a subsidiary, we
 * emit BOTH the subsidiary and the parent (e.g. myfitnesspal.com →
 * "myfitnesspal" AND "under-armour"), letting apply-augments pick whichever
 * slug exists in public/data/companies/.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/hibp-breaches");
const DERIVED = path.join(ROOT, "data/derived/hibp-breaches-augment.json");

const args = process.argv.slice(2);
function val(n, fb = null) { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fb; }

// Conservative domain → slug(s) map. Emit multiple slugs when both the
// brand and its known parent are in our company set.
const DOMAIN_TO_SLUGS = {
  "yahoo.com":          ["yahoo"],
  "adobe.com":          ["adobe"],
  "linkedin.com":       ["linkedin", "microsoft"],
  "myfitnesspal.com":   ["myfitnesspal", "under-armour"],
  "marriott.com":       ["marriott", "marriott-international"],
  "facebook.com":       ["meta-platforms", "meta-facebook", "facebook"],
  "twitter.com":        ["twitter", "x-corp"],
  "t-mobile.com":       ["t-mobile", "tmobile", "t-mobile-us"],
  "equifax.com":        ["equifax"],
  "target.com":         ["target"],
  "homedepot.com":      ["home-depot"],
  "underarmour.com":    ["under-armour"],
  "ebay.com":           ["ebay", "ebay-inc"],
  "dropbox.com":        ["dropbox"],
  "uber.com":           ["uber", "uber-technologies"],
  "sony.com":           ["sony", "sony-group"],
  "capitalone.com":     ["capital-one"],
  "tjx.com":            ["tjx", "tjx-companies", "tj-maxx", "marshalls", "homegoods"],
  "att.com":            ["att", "at-t", "att-inc"],
  "anthem.com":         ["anthem", "anthem-elevance-health", "elevance-health"],
  "jpmorganchase.com":  ["jpmorgan-chase", "jpmorgan", "chase"],
  "wendys.com":         ["wendys", "wendy-s"],
  "chipotle.com":       ["chipotle", "chipotle-mexican-grill"],
  "doordash.com":       ["doordash"],
  "robinhood.com":      ["robinhood"],
  "twitch.tv":          ["twitch", "amazon"],
  "slack.com":          ["slack", "salesforce"],
  "zoom.us":            ["zoom"],
  "discord.com":        ["discord"],
  "snapchat.com":       ["snap", "snapchat", "snap-inc"],
};

async function newestRaw(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No raw files in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

export function buildAugment(records) {
  const by = {};
  for (const r of records) {
    const domain = (r.domain || "").toLowerCase();
    const slugs = DOMAIN_TO_SLUGS[domain];
    if (!slugs) continue;
    for (const slug of slugs) {
      if (!by[slug]) {
        by[slug] = {
          breach_count: 0,
          total_pwned: 0,
          first_breach: null,
          last_breach: null,
          sensitive_count: 0,
          sample_breaches: [],
          source: "hibp-breaches",
          source_url: "https://haveibeenpwned.com/PwnedWebsites",
        };
      }
      const agg = by[slug];
      agg.breach_count += 1;
      agg.total_pwned += Number(r.pwn_count || 0);
      if (r.is_sensitive) agg.sensitive_count += 1;
      const d = r.breach_date || "";
      if (d) {
        if (!agg.first_breach || d < agg.first_breach) agg.first_breach = d;
        if (!agg.last_breach || d > agg.last_breach) agg.last_breach = d;
      }
      if (agg.sample_breaches.length < 3) {
        agg.sample_breaches.push({
          title: r.title,
          date: r.breach_date,
          accounts: r.pwn_count,
          is_sensitive: r.is_sensitive,
          data_classes: r.data_classes,
        });
      }
    }
  }
  for (const slug of Object.keys(by)) {
    by[slug].sample_breaches.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }
  return by;
}

async function main() {
  const inPath = val("--in", null) ?? (existsSync(RAW_DIR) ? await newestRaw(RAW_DIR) : null);
  if (!inPath || !existsSync(inPath)) { console.error("Run hibp-breaches-fetch.mjs first."); process.exit(2); }
  const raw = JSON.parse(await fs.readFile(inPath, "utf-8"));
  const augment = buildAugment(raw.records || []);
  const outPath = val("--out", null) ?? DERIVED;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "hibp-breaches",
    source_url: "https://haveibeenpwned.com/PwnedWebsites",
    input: path.relative(ROOT, inPath),
    company_count: Object.keys(augment).length,
    companies: augment,
  }, null, 2));
  console.log(`Wrote ${Object.keys(augment).length} companies -> ${outPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error("hibp-breaches-merge failed:", err); process.exit(1); });
}
