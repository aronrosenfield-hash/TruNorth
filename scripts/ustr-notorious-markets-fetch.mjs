#!/usr/bin/env node
/**
 * USTR Notorious Markets List — annual fetch.
 *
 * The Office of the U.S. Trade Representative publishes an annual
 * "Notorious Markets List" identifying online + physical markets
 * engaged in commercial-scale piracy or trademark counterfeiting.
 * The list calls out specific operators (Alibaba/Taobao,
 * ByteDance/Douyin, Baidu, JD.com subsidiaries, Pinduoduo, etc.)
 * that consumer-facing brands sit underneath.
 *
 * Source:
 *   https://ustr.gov/issue-areas/intellectual-property/notorious-markets-list
 *   2025 PDF (released January 2026):
 *   https://ustr.gov/sites/default/files/files/Press/Releases/2026/2025%20Notorious%20Markets%20List%20(final).pdf
 *
 * STRATEGY
 *   This source is intentionally low-cardinality (~35 online markets,
 *   ~20 physical-market country sections per year). We hand-curate
 *   the parent-corporate attribution for each market because the
 *   PDF's prose form makes reliable extraction brittle. The fetcher's
 *   job is to:
 *     1. Download the latest PDF.
 *     2. Verify each curated market name still appears in the prose
 *        (catches removals — flagged in stats).
 *     3. Write the curated record + verification status to raw.
 *
 *   `--fixture` reads scripts/fixtures/ustr-notorious-markets/sample.txt
 *   so unit tests don't hit the network.
 *
 * OUTPUT
 *   data/raw/ustr-notorious-markets/<YYYY-MM-DD>.json
 *   {
 *     _license: "U.S. Federal Government — public domain",
 *     _source: "ustr-notorious-markets",
 *     _source_url: "...PDF URL...",
 *     _list_year: 2025,
 *     _published_at: "2026-01-...",
 *     _generated_at: "<iso>",
 *     _stats: { total, verified, missing },
 *     markets: [{
 *       slugKey,         // canonical slug for the operator (e.g. "alibaba")
 *       marketName,      // "Taobao"
 *       category,        // "online" | "physical"
 *       operator,        // "Alibaba Group Holding Ltd"
 *       country,         // "China"
 *       concern,         // "counterfeit goods" | "piracy" | "both"
 *       verified,        // bool — name still appears in PDF text
 *       sourceUrl,
 *       listYear
 *     }]
 *   }
 *
 * Locally:
 *   node scripts/ustr-notorious-markets-fetch.mjs
 *   node scripts/ustr-notorious-markets-fetch.mjs --fixture
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR     = path.join(ROOT, "data/raw/ustr-notorious-markets");
const FIXTURE_DIR = path.join(ROOT, "scripts/fixtures/ustr-notorious-markets");

// Released January 2026 covering calendar year 2025.
export const LIST_YEAR = 2025;
export const PUBLISHED_AT = "2026-01-29";
export const PDF_URL =
  "https://ustr.gov/sites/default/files/files/Press/Releases/2026/2025%20Notorious%20Markets%20List%20(final).pdf";
export const LANDING_URL =
  "https://ustr.gov/issue-areas/intellectual-property/notorious-markets-list";

const UA = "TruNorth-USTR/1.0 (+https://www.trunorthapp.com; public-records pipeline)";
const FIXTURE_MODE = process.argv.includes("--fixture");

/**
 * Curated operator attribution for markets where a publicly-traded or
 * consumer-facing parent is identifiable from USTR prose. Markets with
 * no consumer-brand attribution (1337x, FlokiNET, Sci-Hub, etc.) are
 * intentionally omitted — they have no TruNorth slug to enrich.
 */
export const CURATED_MARKETS = [
  // ── Online markets with consumer-brand parents ────────────────────
  {
    marketName: "Taobao",
    aliases: ["TAOBAO", "Taobao"],
    operator: "Alibaba Group Holding Ltd",
    slugKey: "alibaba-group",
    country: "China",
    concern: "counterfeit goods",
    category: "online",
  },
  {
    marketName: "Pinduoduo",
    aliases: ["PINDUODUO", "Pinduoduo"],
    operator: "PDD Holdings (Pinduoduo)",
    slugKey: "pinduoduo",
    country: "China",
    concern: "counterfeit goods",
    category: "online",
  },
  {
    marketName: "DHGate",
    aliases: ["DHGATE", "DHgate"],
    operator: "DHgate.com (Dunhuang Group)",
    slugKey: "dhgate",
    country: "China",
    concern: "counterfeit goods",
    category: "online",
  },
  {
    marketName: "Douyin Mall (Douyin Shangcheng)",
    aliases: ["DOUYIN SHANGCHENG", "Douyin Mall", "Douyin Shangcheng"],
    operator: "ByteDance Ltd",
    slugKey: "bytedance",
    country: "China",
    concern: "counterfeit goods",
    category: "online",
  },
  {
    marketName: "Baidu Wangpan (Baidu Pan)",
    aliases: ["BAIDU WANGPAN", "Baidu Wangpan", "pan.baidu.com"],
    operator: "Baidu Inc",
    slugKey: "baidu",
    country: "China",
    concern: "piracy",
    category: "online",
  },
  {
    marketName: "VK",
    aliases: ["VK", "vk.com"],
    operator: "VK Group",
    slugKey: "vk",
    country: "Russia",
    concern: "piracy",
    category: "online",
  },
  {
    marketName: "IndiaMART",
    aliases: ["INDIAMART", "IndiaMART"],
    operator: "IndiaMART InterMESH Ltd",
    slugKey: "indiamart",
    country: "India",
    concern: "counterfeit goods",
    category: "online",
  },
  {
    marketName: "Avito",
    aliases: ["AVITO", "Avito", "avito.ru"],
    operator: "Avito Holding",
    slugKey: "avito",
    country: "Russia",
    concern: "counterfeit goods",
    category: "online",
  },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPdfText(url) {
  if (FIXTURE_MODE) {
    const fx = path.join(FIXTURE_DIR, "sample.txt");
    if (!existsSync(fx)) return { ok: true, text: "" };
    return { ok: true, text: await fs.readFile(fx, "utf-8") };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/pdf,*/*" },
        redirect: "follow",
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
        return { ok: false, text: "", blocker: `http_${res.status}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = path.join(RAW_DIR, ".latest.pdf");
      await fs.mkdir(RAW_DIR, { recursive: true });
      await fs.writeFile(tmp, buf);
      // Extract text via pdftotext if available; otherwise extract printable
      // ASCII from the binary and rely on the verifier to be lenient.
      let text = "";
      try {
        const { execFile } = await import("node:child_process");
        text = await new Promise((resolve) => {
          execFile("pdftotext", ["-layout", tmp, "-"], { maxBuffer: 50 * 1024 * 1024 },
            (err, stdout) => resolve(err ? "" : stdout));
        });
      } catch { /* pdftotext missing */ }
      if (!text) {
        // Crude fallback: pull readable ASCII runs from the PDF bytes.
        text = buf.toString("latin1").replace(/[^\x20-\x7E\r\n]+/g, " ");
      }
      return { ok: true, text };
    } catch (err) {
      if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; }
      return { ok: false, text: "", blocker: `network:${err.message}` };
    }
  }
  return { ok: false, text: "", blocker: "exhausted_retries" };
}

/** Returns true if any alias appears in the PDF text (case-insensitive). */
export function verifyMarket(text, aliases) {
  if (!text) return false;
  const haystack = text.toLowerCase();
  return aliases.some(a => haystack.includes(a.toLowerCase()));
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  console.log(`[ustr] fetching ${FIXTURE_MODE ? "fixture" : PDF_URL}`);
  const { ok, text, blocker } = await fetchPdfText(PDF_URL);
  if (!ok) {
    console.error(`[ustr] FAIL: ${blocker}`);
    process.exit(1);
  }
  const markets = [];
  let verified = 0;
  let missing = 0;
  for (const m of CURATED_MARKETS) {
    const ver = verifyMarket(text, m.aliases);
    if (ver) verified++;
    else { missing++; console.warn(`[ustr] WARN: ${m.marketName} not found in PDF text`); }
    markets.push({
      slugKey: m.slugKey,
      marketName: m.marketName,
      category: m.category,
      operator: m.operator,
      country: m.country,
      concern: m.concern,
      verified: ver,
      sourceUrl: PDF_URL,
      listYear: LIST_YEAR,
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    _license: "U.S. Federal Government — public domain",
    _source: "ustr-notorious-markets",
    _source_url: PDF_URL,
    _list_year: LIST_YEAR,
    _published_at: PUBLISHED_AT,
    _generated_at: new Date().toISOString(),
    _stats: { total: CURATED_MARKETS.length, verified, missing },
    markets,
  };
  const outPath = path.join(RAW_DIR, `${today}.json`);
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[ustr] wrote ${outPath} — ${verified}/${CURATED_MARKETS.length} verified`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch(err => { console.error(err); process.exit(1); });
