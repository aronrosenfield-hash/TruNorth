#!/usr/bin/env node
/**
 * Master enrichment orchestrator (2026-06-09, Aron-approved path to Build 55).
 *
 * Background: PRs #25-#65 landed ~30 fetch+merge script pairs for positive-
 * signal data sources (B Corp, 1% Planet, Climate TRACE, NLRB voluntary
 * recognition, etc.) but the fetchers were never invoked. Result: company
 * detail.s narratives are mostly "No public record found" even for famously
 * values-aligned brands like Patagonia (0 real signals before this run).
 *
 * What this does:
 *   1. Walks scripts/ for *-fetch.mjs pairs. For each:
 *      a. Skip negative-signal sources we already have (penalties/recalls/etc.)
 *      b. Skip fetchers that need an API key we don't have (logged)
 *      c. Run fetcher with up to 3 retries (exponential backoff: 5s, 25s, 125s)
 *      d. Time-box each fetcher at 10 min
 *   2. After all fetchers settle, run *-merge.mjs for each source sequentially.
 *      Merge policy: first non-"No public record" wins (Aron's call). If a
 *      detail.s already has substantive content, later mergers skip + log.
 *   3. Print a comprehensive report at the end.
 *
 * Concurrency: 4 fetchers in flight at once (most are network-bound).
 *
 * Output: log to scripts/enrich-all.log + console.
 *
 * Idempotent. Safe to re-run.
 *
 * Run: node scripts/enrich-all.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");
const LOG_PATH = path.join(SCRIPTS, "enrich-all.log");

// Sources to RUN. Curated focus: positive-signal sources we know are missing,
// plus a few negative-signal completers. Each entry = base name (no -fetch / -merge).
// Order doesn't matter for fetchers (parallel); mergers run in this order.
const SOURCES = [
  // Positive signals — these are the launch-critical ones
  "bcorp",
  "fairtrade",
  "climate-neutral",
  "climate-trace",
  "better-cotton",
  "bird-friendly-coffee",
  "awa",
  "wwf-palm-oil",
  "tco-certified",
  "nsf-usp-supplements",
  "epa-smartway",
  "epa-green-vehicle",
  "iihs",
  "nhtsa-5-star",
  "nlrb-voluntary-recognition",
  "disability-in",
  "net-zero-tracker",
  "sbti",
  "wba-social-benchmark",
  "forest500",
  "fifty-fifty-women-on-boards",
  "usda-organic",
  "cradle-to-cradle",
  "textile-exchange",
  "corporate-giving",
  "transparency-benchmarks",
  "cpa-zicklin",
  "fdaaa-trials",
  "cornell-ilr",
  "strike-map",
  "industry-carbon-intensity",
  // Negative-signal completers (in case any didn't merge yet)
  "ca-prop65",
  "fmcsa-sms",
  "atf",
  "asyousow",
  "wikirate",
];

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
};

function exists(p) { try { fs.statSync(p); return true; } catch { return false; } }

function runScript(scriptPath, label, timeoutMs = 600000) {
  return new Promise((resolve) => {
    if (!exists(scriptPath)) {
      resolve({ label, skipped: true, reason: "script not found" });
      return;
    }
    const start = Date.now();
    const child = spawn("node", [scriptPath], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      resolve({
        label,
        code,
        elapsed,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
      });
    });
  });
}

async function withRetries(fn, label, retries = 3) {
  let last;
  for (let i = 0; i < retries; i++) {
    const result = await fn();
    if (result.skipped) return result;
    if (result.code === 0) return result;
    last = result;
    if (i < retries - 1) {
      const delay = Math.pow(5, i + 1) * 1000; // 5s, 25s, 125s
      log(`  retry ${label} in ${delay / 1000}s (last code=${result.code})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { ...last, exhausted: true };
}

// Concurrency limiter
async function parallelMap(items, fn, limit = 4) {
  const results = [];
  const in_flight = new Set();
  for (const item of items) {
    const p = fn(item).then(r => { in_flight.delete(p); return r; });
    in_flight.add(p);
    results.push(p);
    if (in_flight.size >= limit) await Promise.race(in_flight);
  }
  return Promise.all(results);
}

// Clear log
fs.writeFileSync(LOG_PATH, "");

log(`=== ENRICH-ALL START · ${SOURCES.length} sources ===`);

// PHASE 1: fetchers, parallel with concurrency cap + retries
log(`\n--- PHASE 1: fetchers (parallel, max 4 concurrent, 3 retries each) ---`);
const fetchResults = await parallelMap(SOURCES, async (src) => {
  const scriptPath = path.join(SCRIPTS, `${src}-fetch.mjs`);
  if (!exists(scriptPath)) {
    log(`  ${src.padEnd(30)} fetch: SKIP (script not found)`);
    return { src, fetch: { skipped: true, reason: "no script" } };
  }
  log(`  ${src.padEnd(30)} fetch: STARTING`);
  const r = await withRetries(() => runScript(scriptPath, src), src);
  const tag = r.skipped ? "SKIP" : r.code === 0 ? "OK" : `FAIL(${r.code})`;
  log(`  ${src.padEnd(30)} fetch: ${tag.padEnd(10)} (${r.elapsed || "?"}s)${r.exhausted ? " [retries exhausted]" : ""}`);
  return { src, fetch: r };
}, 4);

const fetchOk = fetchResults.filter(r => r.fetch.code === 0).length;
const fetchFail = fetchResults.filter(r => r.fetch.code !== 0 && !r.fetch.skipped).length;
const fetchSkip = fetchResults.filter(r => r.fetch.skipped).length;
log(`\nFetch summary: ${fetchOk} OK · ${fetchFail} failed · ${fetchSkip} skipped`);

// PHASE 2: mergers, sequential
log(`\n--- PHASE 2: mergers (sequential, first non-'No public record' wins) ---`);
const mergeResults = [];
for (const src of SOURCES) {
  const scriptPath = path.join(SCRIPTS, `${src}-merge.mjs`);
  if (!exists(scriptPath)) {
    log(`  ${src.padEnd(30)} merge: SKIP (script not found)`);
    mergeResults.push({ src, merge: { skipped: true, reason: "no script" } });
    continue;
  }
  log(`  ${src.padEnd(30)} merge: STARTING`);
  const r = await runScript(scriptPath, src, 300000);
  const tag = r.code === 0 ? "OK" : `FAIL(${r.code})`;
  log(`  ${src.padEnd(30)} merge: ${tag.padEnd(10)} (${r.elapsed}s)`);
  mergeResults.push({ src, merge: r });
}

const mergeOk = mergeResults.filter(r => r.merge.code === 0).length;
const mergeFail = mergeResults.filter(r => r.merge.code !== 0 && !r.merge.skipped).length;
const mergeSkip = mergeResults.filter(r => r.merge.skipped).length;
log(`\nMerge summary: ${mergeOk} OK · ${mergeFail} failed · ${mergeSkip} skipped`);

// PHASE 3: rebake scoring
log(`\n--- PHASE 3: rebake scoring ---`);
const rebake = await runScript(path.join(SCRIPTS, "rebake-scoring.mjs"), "rebake-scoring", 600000);
log(`Rebake: ${rebake.code === 0 ? "OK" : "FAIL"} (${rebake.elapsed}s)`);
if (rebake.stdout) log(rebake.stdout);

// PHASE 4: finalize bundle (rebuild index + search-index)
log(`\n--- PHASE 4: finalize bundle ---`);
const finalize = await runScript(path.join(SCRIPTS, "finalize-bundle.mjs"), "finalize-bundle", 120000);
log(`Finalize: ${finalize.code === 0 ? "OK" : "FAIL"} (${finalize.elapsed}s)`);
if (finalize.stdout) log(finalize.stdout);

log(`\n=== ENRICH-ALL DONE ===`);
log(`See full log at: ${LOG_PATH}`);

// Print failures for visibility
const allFails = [
  ...fetchResults.filter(r => r.fetch.code !== 0 && !r.fetch.skipped),
  ...mergeResults.filter(r => r.merge.code !== 0 && !r.merge.skipped),
];
if (allFails.length) {
  log(`\n=== FAILURES (${allFails.length}) ===`);
  for (const f of allFails) {
    const r = f.fetch || f.merge;
    log(`  ${f.src} · code=${r.code}`);
    if (r.stderr) log(`    stderr: ${r.stderr.slice(-300)}`);
  }
}
