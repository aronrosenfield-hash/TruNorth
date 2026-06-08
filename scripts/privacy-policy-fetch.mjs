#!/usr/bin/env node
/**
 * Privacy policy text fetcher + ToS;DR rating mirror (quarterly).
 *
 * For each of the top-N most-popular brands in our index, this script:
 *   1. Resolves a candidate domain from the company file's `wiki.website`
 *      (falling back to <slug>.com if wiki gives nothing usable).
 *   2. Tries a small ordered list of well-known policy URL patterns:
 *         /privacy
 *         /privacy-policy
 *         /legal/privacy
 *         /privacy-statement
 *      ...stopping at the first 2xx HTML response that contains the word
 *      "privacy" and is at least a few KB (rejecting silent home-page 200s).
 *   3. Caches the raw HTML body (capped at 200KB to keep the repo sane) in
 *         public/data/_cache/privacy-policy/<slug>.html
 *      and a per-slug summary record (URL, fetch ts, ToS;DR rating if any)
 *      in
 *         public/data/_cache/privacy-policy/<slug>.json
 *   4. Pulls the ToS;DR community grade (A-F) from api.tosdr.org as a
 *      complementary signal — see https://tosdr.org.
 *
 * Output (aggregate, written by --apply AND --dry):
 *   data/raw/privacy-policy/<YYYY-MM-DD>.json
 *
 * Per-record shape:
 *   {
 *     slug,
 *     name,
 *     domain,            // resolved host (e.g. "apple.com")
 *     policyUrl,         // first successful URL or null
 *     fetchedAt,         // ISO timestamp
 *     bytes,             // HTML body length (uncapped)
 *     htmlSha256,        // sha256 of the raw HTML (reproducibility check)
 *     tosdrGrade,        // "A" | "B" | "C" | "D" | "E" | null
 *     tosdrUrl,          // tos;dr service page URL or null
 *     status,            // "ok" | "no_policy" | "no_domain" | "error"
 *     error,             // string if status==="error"
 *   }
 *
 * License notes:
 *   - Privacy policies are public web pages. We record the source URL and
 *     fetch timestamp with every cached file. We do NOT redistribute the
 *     HTML beyond the per-slug cache the merger consumes (truncated to 200KB).
 *   - ToS;DR data is CC BY-SA. We store grade letters + service URL only.
 *
 * Flags:
 *   --dry      (default) — NO network. Replays cache for already-fetched
 *                          slugs so the merger can be developed offline.
 *   --apply    — actually call the network. 1 req/sec courtesy throttle
 *                between brands.
 *   --slug X   — only run for slug X (debug/iteration).
 *   --top N    — override the default top-2000 target window.
 *
 * Locally:
 *   node scripts/privacy-policy-fetch.mjs                # dry
 *   node scripts/privacy-policy-fetch.mjs --apply        # real fetch
 *   node scripts/privacy-policy-fetch.mjs --slug apple   # one brand
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const COMP_DIR   = path.join(ROOT, "public/data/companies");
const CACHE_DIR  = path.join(ROOT, "public/data/_cache/privacy-policy");
const OUT_DIR    = path.join(ROOT, "data/raw/privacy-policy");

const UA = "TruNorth-Privacy/1.0 (+https://www.trunorthapp.com; policy-audit)";
const RATE_LIMIT_MS = 1000;        // 1 req/sec between brands
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 200_000;    // cap per-policy HTML in cache
const DEFAULT_TOP_N = 2000;

// Paths tried in order. First 2xx HTML that smells like a privacy policy wins.
export const POLICY_PATHS = [
  "/privacy",
  "/privacy-policy",
  "/legal/privacy",
  "/privacy-statement",
];

// CLI ────────────────────────────────────────────────────────────────────────
const argv  = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY   = !APPLY;
const SLUG_ARG = (() => {
  const i = argv.indexOf("--slug");
  return i >= 0 ? argv[i + 1] : null;
})();
const TOP_N = (() => {
  const i = argv.indexOf("--top");
  return i >= 0 ? Math.max(1, parseInt(argv[i + 1], 10) || DEFAULT_TOP_N) : DEFAULT_TOP_N;
})();

// Domain resolution ──────────────────────────────────────────────────────────

/**
 * Pull a clean host out of a company's `wiki.website` field, which is
 * frustratingly inconsistent in our dataset:
 *   "https://apple.com/at/"
 *   "100thieves.com 100thieves.com"          (duplicate, no scheme)
 *   "1017Records.comthenew1017records.com"   (concatenated typo)
 *   "http://www.47brand.com/"
 *
 * Strategy: pull the first http-ish token; if none, take the first run of
 * characters that looks like a domain (contains a dot, ASCII, no spaces).
 * Strip leading "www." and lowercase. Return null if we can't get something
 * with a TLD.
 */
export function extractDomainFromWiki(website) {
  if (!website || typeof website !== "string") return null;
  const s = website.trim();
  if (!s) return null;

  // Prefer a URL token.
  const urlMatch = s.match(/https?:\/\/([^\s/?#]+)/i);
  let host = urlMatch ? urlMatch[1] : null;

  if (!host) {
    // Bare-domain hunt: first space-delimited token that has a dot.
    const tokens = s.split(/\s+/);
    for (const t of tokens) {
      const m = t.match(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/i);
      if (m) { host = m[0]; break; }
    }
  }
  if (!host) return null;

  host = host.toLowerCase().replace(/^www\./, "");
  if (!/\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

/**
 * Resolve a target domain for a slug, in this order:
 *   1. company.wiki.website -> extractDomainFromWiki
 *   2. <slug>.com   (only single-token slugs; avoids garbage like
 *      "general-electric.com" which isn't the real homepage).
 */
export function resolveDomain(slug, company) {
  const fromWiki = extractDomainFromWiki(company?.wiki?.website);
  if (fromWiki) return fromWiki;
  if (slug && !slug.includes("-")) return `${slug}.com`;
  return null;
}

// Network ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        ...(opts.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function tryPolicyUrl(domain, p) {
  const url = `https://${domain}${p}`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, url, status: res.status };
    const ctype = res.headers.get("content-type") || "";
    if (!/html/i.test(ctype)) return { ok: false, url, status: res.status, note: `not-html (${ctype})` };
    const text = await res.text();
    // Cheap heuristic — many sites silently 200 their home page on unknown
    // routes. Demand at least one privacy-policy-shaped keyword AND a few KB.
    if (text.length < 1500) return { ok: false, url, status: res.status, note: "body-too-small" };
    if (!/privacy/i.test(text)) return { ok: false, url, status: res.status, note: "no-privacy-keyword" };
    return { ok: true, url, status: res.status, body: text };
  } catch (err) {
    return { ok: false, url, error: err.message };
  }
}

async function fetchPolicy(domain) {
  for (const p of POLICY_PATHS) {
    const r = await tryPolicyUrl(domain, p);
    if (r.ok) return r;
  }
  return { ok: false };
}

/**
 * ToS;DR public REST: https://api.tosdr.org/service/v3?slug=<host>
 * Response (simplified): { rating: { letter: "B" }, id: 182, ... }
 * Returns { letter, serviceUrl } or null on any error / unknown grade.
 */
async function fetchTosdrGrade(domain) {
  const url = `https://api.tosdr.org/service/v3?slug=${encodeURIComponent(domain)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const letter = data?.rating?.letter
                ?? data?.parameters?.rating?.letter
                ?? null;
    const id = data?.id ?? data?.parameters?.id;
    const serviceUrl = id ? `https://tosdr.org/en/service/${id}` : null;
    if (!letter) return null;
    return { letter: String(letter).toUpperCase(), serviceUrl };
  } catch {
    return null;
  }
}

// Cache helpers ──────────────────────────────────────────────────────────────

export function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function readCompany(slug) {
  const f = path.join(COMP_DIR, `${slug}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(await fs.readFile(f, "utf-8")); }
  catch { return null; }
}

// Target selection ──────────────────────────────────────────────────────────

/**
 * Choose the top-N targets from the index. Our index.json is ordered
 * alphabetically by slug (no popularity column), so we deliberately widen
 * the net AND drop pure neutral-default stubs (the Wikidata long-tail) so
 * the network budget goes to brands users are more likely to look up.
 */
export function pickTargets(index, topN) {
  const real = index.filter(c => {
    if (!c.slug) return false;
    if (c.overall === 50 && c.sc) {
      const vals = Object.values(c.sc);
      const allBoring = vals.every(v => v === "neutral" || v === "na");
      if (allBoring && !c.hasRecall) return false;
    }
    return true;
  });
  return real.slice(0, topN).map(c => ({ slug: c.slug, name: c.name }));
}

// Runner ────────────────────────────────────────────────────────────────────

async function processOne(target) {
  const company = await readCompany(target.slug);
  const domain = resolveDomain(target.slug, company);

  const base = {
    slug: target.slug,
    name: target.name,
    domain,
    policyUrl: null,
    fetchedAt: new Date().toISOString(),
    bytes: 0,
    htmlSha256: null,
    tosdrGrade: null,
    tosdrUrl: null,
    status: "no_domain",
  };
  if (!domain) return base;

  if (DRY) {
    // Replay cache if present so dev iteration on the merger is realistic.
    const cachePath = path.join(CACHE_DIR, `${target.slug}.json`);
    if (existsSync(cachePath)) {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8"));
      return { ...cached, _source: "cache" };
    }
    return { ...base, status: "no_policy", _source: "dry-no-cache" };
  }

  try {
    const policy = await fetchPolicy(domain);
    const tosdr = await fetchTosdrGrade(domain);
    const rec = {
      ...base,
      tosdrGrade: tosdr?.letter ?? null,
      tosdrUrl: tosdr?.serviceUrl ?? null,
    };
    if (policy.ok) {
      rec.policyUrl = policy.url;
      rec.bytes = policy.body.length;
      rec.htmlSha256 = sha256(policy.body);
      rec.status = "ok";

      await fs.mkdir(CACHE_DIR, { recursive: true });
      const truncated = policy.body.slice(0, MAX_BODY_BYTES);
      await fs.writeFile(path.join(CACHE_DIR, `${target.slug}.html`), truncated);
    } else {
      rec.status = "no_policy";
    }

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(CACHE_DIR, `${target.slug}.json`),
      JSON.stringify(rec, null, 2),
    );
    return rec;
  } catch (err) {
    return { ...base, status: "error", error: err.message };
  }
}

async function main() {
  console.log(`privacy-policy-fetch starting... (mode=${DRY ? "DRY (no network)" : "APPLY (real fetch)"})`);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  let targets = pickTargets(index, TOP_N);
  if (SLUG_ARG) targets = targets.filter(t => t.slug === SLUG_ARG);
  if (targets.length === 0) {
    console.error(SLUG_ARG ? `No target matching slug "${SLUG_ARG}"` : "No targets");
    process.exit(2);
  }
  console.log(`Processing ${targets.length} target brand(s) (top ${TOP_N} window)`);

  const records = [];
  let ok = 0, noPolicy = 0, noDomain = 0, errors = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const rec = await processOne(t);
    records.push(rec);
    if (rec.status === "ok") ok++;
    else if (rec.status === "no_policy") noPolicy++;
    else if (rec.status === "no_domain") noDomain++;
    else errors++;

    if ((i + 1) % 50 === 0 || i === targets.length - 1) {
      console.log(`  ${(i + 1).toString().padStart(4)}/${targets.length}  ok=${ok} no_policy=${noPolicy} no_domain=${noDomain} error=${errors}`);
    }

    if (APPLY && i < targets.length - 1) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `${today}.json`);
  const aggregate = {
    _license: "Privacy policies are public web pages. ToS;DR data CC BY-SA, https://tosdr.org",
    _source_urls: {
      tosdr: "https://api.tosdr.org/service/v3",
      policies: "fetched from each brand's own domain (see per-record policyUrl)",
    },
    _generated_at: new Date().toISOString(),
    _mode: DRY ? "dry" : "apply",
    _stats: {
      total: records.length,
      ok,
      no_policy: noPolicy,
      no_domain: noDomain,
      error: errors,
    },
    records,
  };
  await fs.writeFile(outFile, JSON.stringify(aggregate, null, 2));
  console.log(`\nWrote ${path.relative(ROOT, outFile)}`);
  console.log(`Summary: ok=${ok} no_policy=${noPolicy} no_domain=${noDomain} error=${errors}`);
  if (DRY) console.log("(DRY — no network. Use --apply to actually fetch.)");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("privacy-policy-fetch failed:", err);
    process.exit(1);
  });
}
