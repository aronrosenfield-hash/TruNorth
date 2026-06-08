#!/usr/bin/env node
/**
 * Privacy policy merger — rule-based scoring across 8 dimensions.
 *
 * Reads:
 *   - data/raw/privacy-policy/<latest>.json   (per-record fetch summaries)
 *   - public/data/_cache/privacy-policy/<slug>.html   (the cached HTML bodies)
 *
 * Writes:
 *   data/derived/privacy-policy-augment.json
 *
 * Output shape, keyed by slug:
 *   {
 *     <slug>: {
 *       privacy: {
 *         score: 0-100,
 *         dimensions: {
 *           dataCollection,     // 0-100, higher == less invasive
 *           thirdPartySharing,  // 0-100, higher == more restrictive
 *           retention,          // 0-100, higher == clearer/shorter
 *           userRights,         // 0-100, higher == more user control
 *           coppa,              // 0-100, higher == better kids' privacy
 *           ccpaDoNotSell,      // 0-100, higher == explicit opt-out
 *           tracking,           // 0-100, higher == clearer disclosure
 *           breachHistory       // 0-100, higher == no incident language
 *         },
 *         policyUrl,
 *         lastFetched,
 *         tosdrGrade
 *       }
 *     }
 *   }
 *
 * Scoring is 100% deterministic — pure regex/keyword counts. NO LLM in the
 * scoring path. Each dimension lists positive (good-for-privacy) and negative
 * (bad-for-privacy) signals; the dimension score is:
 *
 *     base + (pos_hits * step) - (neg_hits * step), clamped to [0, 100]
 *
 * The overall `score` is a weighted average of the 8 dimensions, then a small
 * additive nudge from the ToS;DR community grade (A=+5, B=+3, C=0, D=-3, E=-5).
 *
 * Flags:
 *   --dry      (default) — write to a sibling file `*-DRY.json` and print
 *                          a top/bottom-5 summary.
 *   --apply    — overwrite data/derived/privacy-policy-augment.json.
 *   --raw F    — use a specific raw file (defaults to newest by name).
 *
 * Locally:
 *   node scripts/privacy-policy-merge.mjs              # dry
 *   node scripts/privacy-policy-merge.mjs --apply      # write augment
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR    = path.join(ROOT, "data/raw/privacy-policy");
const CACHE_DIR  = path.join(ROOT, "public/data/_cache/privacy-policy");
const OUT_FILE   = path.join(ROOT, "data/derived/privacy-policy-augment.json");
const DRY_FILE   = path.join(ROOT, "data/derived/privacy-policy-augment-DRY.json");

const argv  = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY   = !APPLY;
const RAW_OVERRIDE = (() => {
  const i = argv.indexOf("--raw");
  return i >= 0 ? argv[i + 1] : null;
})();

// ── Scoring rubric ──────────────────────────────────────────────────────────
//
// Each dimension is a `{ base, step, pos, neg }` config. Hits are counted with
// case-insensitive regex; a phrase counts once per dimension regardless of how
// many times it appears (binary signal, not a frequency competition).
//
// The phrasing patterns below are intentionally conservative — they match the
// kind of plain-English clauses that appear in the FTC's model privacy policy
// language, in industry-standard CCPA/GDPR notices, and in COPPA-compliant
// kids-section disclaimers. They will under-detect rather than over-detect
// (the better failure mode for a public-facing score).

export const RUBRIC = {
  dataCollection: {
    base: 60, step: 8,
    pos: [
      /minimum (?:amount of )?(?:personal )?(?:data|information)/i,
      /only (?:the )?(?:data|information) (?:we|that is) (?:need|necessary)/i,
      /data minimi[sz]ation/i,
      /we do not collect|we don['']t collect/i,
      /you (?:can|may) use .{0,40}without (?:providing|sharing)/i,
    ],
    neg: [
      /collect (?:any|all) (?:information|data) (?:you|that you) provide/i,
      /precise (?:location|geolocation)/i,
      /biometric (?:data|information|identifier)/i,
      /(?:browsing|search|app(?:lication)?) (?:history|activity)/i,
      /device (?:identifier|fingerprint)/i,
      /microphone|camera access/i,
      /contacts list|address book/i,
      /inferences (?:about|drawn) (?:you|from)/i,
    ],
  },
  thirdPartySharing: {
    base: 55, step: 9,
    pos: [
      /we do not (?:sell|rent|trade) (?:your )?(?:personal )?(?:information|data)/i,
      /(?:we|do) not (?:share|disclose) (?:your )?(?:personal )?(?:information|data) (?:with|to) third part/i,
      /only (?:share|disclose) .{0,30}with your (?:consent|permission)/i,
      /service providers? (?:are )?bound by/i,
    ],
    neg: [
      /share .{0,60}with (?:our )?(?:affiliates|partners|advertisers|marketing)/i,
      /third[- ]party (?:advertis|marketing|analytics)/i,
      /(?:data )?brokers?/i,
      /sell (?:your )?(?:personal )?(?:information|data)/i,
      /(?:cross[- ]context )?behavioral advertising/i,
    ],
  },
  retention: {
    base: 50, step: 10,
    pos: [
      /retain.{0,60}only as long as (?:necessary|needed)/i,
      /delete.{0,40}after (?:\d+ )?(?:days?|months?|years?)/i,
      /retention (?:period|schedule)/i,
      /anonymi[sz]e|de[- ]identif(?:y|ied)/i,
    ],
    neg: [
      /retain.{0,40}indefinitely/i,
      /no (?:specific )?retention (?:period|limit)/i,
      /as long as (?:we |your account|the account)/i,
    ],
  },
  userRights: {
    base: 45, step: 6,
    pos: [
      /right to (?:access|delete|deletion|portability|rectif|correct|object|restrict)/i,
      /(?:request|submit) .{0,30}(?:deletion|access|copy) (?:of|request)/i,
      /(?:download|export) (?:your|a copy of your) (?:data|information)/i,
      /opt[- ]out/i,
      /withdraw (?:your )?consent/i,
      /privacy (?:dashboard|center|controls)/i,
      /data subject (?:access )?request|dsar/i,
    ],
    neg: [
      /we may (?:refuse|decline|deny) .{0,40}request/i,
    ],
  },
  coppa: {
    base: 50, step: 12,
    pos: [
      /(?:children|child)(?:ren['']?s)? online privacy protection act|coppa/i,
      /(?:we|our service) (?:do |does )?not (?:knowingly )?(?:collect|target) .{0,30}(?:children|minors|under 13)/i,
      /(?:under (?:the age of )?13|13 years (?:of age|old))/i,
      /parental (?:consent|permission)/i,
    ],
    neg: [
      /collect .{0,40}(?:information from|data from) (?:children|minors)/i,
      /content directed (?:to|at) children/i,
    ],
  },
  ccpaDoNotSell: {
    base: 50, step: 12,
    pos: [
      /do not sell (?:or share )?my (?:personal )?(?:information|data)/i,
      /california consumer privacy act|ccpa/i,
      /right to opt[- ]out of (?:the )?(?:sale|sharing)/i,
      /(?:we|do) not sell (?:your )?personal information/i,
      /global privacy control|gpc/i,
    ],
    neg: [
      /we may sell (?:your )?(?:personal )?(?:information|data)/i,
    ],
  },
  tracking: {
    base: 55, step: 7,
    pos: [
      /(?:cookie|tracking) (?:settings|preferences|controls|center)/i,
      /(?:you can|may) (?:disable|reject|opt[- ]out of) (?:cookies|tracking)/i,
      /respect (?:the )?(?:do[- ]not[- ]track|dnt)/i,
      /we (?:do |use )?not (?:track|use trackers) across/i,
    ],
    neg: [
      /(?:third[- ]party )?(?:tracking|advertising) (?:pixels?|tags?|beacons?)/i,
      /(?:cross[- ]site|cross[- ]device) tracking/i,
      /(?:facebook|meta|google|tiktok) (?:pixel|tag)/i,
      /session replay|fingerprint/i,
    ],
  },
  breachHistory: {
    base: 80, step: 15,
    pos: [
      /(?:we|have) (?:not )?experienced (?:no )?(?:material )?(?:data )?(?:breach|incident)/i,
      /notify (?:you |affected (?:individuals|users) )?.{0,40}(?:without undue delay|within 72 hours)/i,
    ],
    neg: [
      /(?:previous|prior|past) (?:data )?breach/i,
      /security incident (?:occurred|involving)/i,
    ],
  },
};

// Weights for the overall score (sum doesn't have to be 1; we normalize).
export const WEIGHTS = {
  dataCollection:    1.4,
  thirdPartySharing: 1.6,
  retention:         1.0,
  userRights:        1.4,
  coppa:             0.8,
  ccpaDoNotSell:     1.2,
  tracking:          1.2,
  breachHistory:     0.4,
};

// Strip HTML tags + collapse whitespace. We deliberately do NOT decode every
// HTML entity (we only care about pattern hits in the human text); browsers
// will leave plain ASCII in the body for the words we look for.
export function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Words that, when they precede a negative phrase within ~50 chars, invert
// its meaning ("we do NOT share with data brokers" should not count as a
// shared-with-data-brokers signal). Applied only to negative-bucket hits.
const NEGATION_LOOKBACK = /\b(?:not|never|don['']?t|doesn['']?t|won['']?t|without)\b[^.]{0,80}$/i;

function hasUnnegatedMatch(text, pattern) {
  let m;
  // We need indices so we have to use a fresh global pattern.
  const g = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  while ((m = g.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    if (!NEGATION_LOOKBACK.test(before)) return true;
    if (m.index === g.lastIndex) g.lastIndex++;  // safety vs. zero-width
  }
  return false;
}

export function scoreDimension(text, cfg) {
  let pos = 0, neg = 0;
  for (const p of cfg.pos) if (p.test(text)) pos++;
  for (const n of cfg.neg) if (hasUnnegatedMatch(text, n)) neg++;
  const raw = cfg.base + pos * cfg.step - neg * cfg.step;
  return { score: clamp(Math.round(raw), 0, 100), posHits: pos, negHits: neg };
}

export function scoreAll(text) {
  const dims = {};
  const hits = {};
  for (const [name, cfg] of Object.entries(RUBRIC)) {
    const { score, posHits, negHits } = scoreDimension(text, cfg);
    dims[name] = score;
    hits[name] = { posHits, negHits };
  }
  let wSum = 0, wTotal = 0;
  for (const [name, w] of Object.entries(WEIGHTS)) {
    wSum   += dims[name] * w;
    wTotal += w;
  }
  return { dimensions: dims, hits, baseScore: Math.round(wSum / wTotal) };
}

// ToS;DR adjustment: small additive nudge, never overrides the rubric.
export function tosdrAdjust(letter) {
  switch ((letter || "").toUpperCase()) {
    case "A": return +5;
    case "B": return +3;
    case "C": return  0;
    case "D": return -3;
    case "E": case "F": return -5;
    default:  return  0;
  }
}

async function pickRawFile() {
  if (RAW_OVERRIDE) return path.resolve(ROOT, RAW_OVERRIDE);
  if (!existsSync(RAW_DIR)) throw new Error(`No raw dir: ${RAW_DIR}`);
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No raw files in ${RAW_DIR}. Run privacy-policy-fetch.mjs first.`);
  return path.join(RAW_DIR, files[files.length - 1]);
}

async function loadHtmlForSlug(slug) {
  const p = path.join(CACHE_DIR, `${slug}.html`);
  if (!existsSync(p)) return null;
  try { return await fs.readFile(p, "utf-8"); }
  catch { return null; }
}

async function main() {
  console.log(`privacy-policy-merge starting... (mode=${DRY ? "DRY" : "APPLY"})`);

  const rawFile = await pickRawFile();
  console.log(`Reading ${path.relative(ROOT, rawFile)}`);
  const raw = JSON.parse(await fs.readFile(rawFile, "utf-8"));
  const records = raw.records || [];

  const augment = {};
  let scored = 0, skipped = 0;
  const allScores = [];

  for (const r of records) {
    if (r.status !== "ok" || !r.policyUrl) { skipped++; continue; }
    const html = await loadHtmlForSlug(r.slug);
    if (!html) { skipped++; continue; }

    const text = htmlToText(html);
    const { dimensions, baseScore } = scoreAll(text);
    const adj = tosdrAdjust(r.tosdrGrade);
    const score = clamp(baseScore + adj, 0, 100);

    augment[r.slug] = {
      privacy: {
        score,
        dimensions,
        policyUrl: r.policyUrl,
        lastFetched: r.fetchedAt,
        tosdrGrade: r.tosdrGrade ?? null,
      },
    };
    scored++;
    allScores.push({ slug: r.slug, name: r.name, score });
  }

  allScores.sort((a, b) => b.score - a.score);
  const top5    = allScores.slice(0, 5);
  const bottom5 = allScores.slice(-5).reverse();

  const out = {
    _license: "Rule-based scoring of public privacy policies + ToS;DR (CC BY-SA). See per-slug policyUrl.",
    _generated_at: new Date().toISOString(),
    _source_file: path.relative(ROOT, rawFile),
    _rubric_version: "1.0.0",
    _stats: {
      raw_records: records.length,
      scored,
      skipped,
    },
    companies: augment,
  };

  const target = DRY ? DRY_FILE : OUT_FILE;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(out, null, 2));

  console.log(`\nScored ${scored} / ${records.length} (skipped ${skipped})`);
  console.log(`Wrote ${path.relative(ROOT, target)}`);
  if (top5.length) {
    console.log("\nTop 5 by score:");
    for (const t of top5) console.log(`  ${String(t.score).padStart(3)}  ${t.slug}  (${t.name})`);
    console.log("\nBottom 5 by score:");
    for (const b of bottom5) console.log(`  ${String(b.score).padStart(3)}  ${b.slug}  (${b.name})`);
  }
  if (DRY) console.log("\n(DRY — wrote *-DRY.json. Use --apply to overwrite the real augment file.)");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("privacy-policy-merge failed:", err);
    process.exit(1);
  });
}
