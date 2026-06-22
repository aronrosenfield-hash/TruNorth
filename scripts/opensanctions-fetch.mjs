#!/usr/bin/env node
/**
 * OpenSanctions — Consolidated Sanctions bulk download (monthly)
 *
 * OpenSanctions (https://www.opensanctions.org) consolidates 220+ international
 * enforcement sources into a single FollowTheMoney (FTM) JSON Lines feed:
 *   - UN, EU, UK, US (OFAC SDN+CSL), Switzerland, Canada, Australia, Japan, etc.
 *   - Ukraine NSDC, Israel, Singapore, plus dozens of national lists.
 *   - Asset freezes, travel bans, trade restrictions, terror designations.
 *
 * We stream the bulk "sanctions" dataset (~340MB JSONL), filter to
 * corporate-shaped entities (Company / Organization / LegalEntity), and write
 * a JSONL snapshot under `data/raw/opensanctions/<date>.jsonl`. PEPs and
 * individuals are skipped at parse time so the file stays focused on
 * brand-level signal.
 *
 * STREAMING: the FTM file is too large to load in memory. We pull it as a
 * web stream, decode UTF-8 chunks, hand-roll a line splitter, and JSON.parse
 * one entity at a time. Memory stays flat regardless of file size.
 *
 * LICENSE: OpenSanctions is CC-BY-NC 4.0 (Creative Commons, non-commercial).
 * ⚠️ TRIGGER FIRED (2026-06-22) — the "currently free, so NC is in bounds"
 * assumption is now STALE: the paid Pro tier shipped (com.trunorthapp.app.pro.
 * {annual,monthly}; App Store-approved Build 75, 2026-06-18). CC-BY-NC bars
 * use "primarily directed toward commercial advantage," which a freemium app
 * with paid subscriptions plausibly crosses. NC review is OPEN — do NOT merge
 * future refreshes into the shipped product until resolved: (a) buy the
 * OpenSanctions commercial license (€500–2k/yr), (b) leave dormant / remove,
 * or (c) accept-with-legal-signoff.
 *
 * NOTE: this feed currently contributes ZERO data to the product — no
 * opensanctions-augment.json is committed and no company file carries a
 * `sanctions` key (the monthly cron has not landed merged output, and US
 * consumer brands ~never appear on sanctions lists by design). The underlying
 * lists (OFAC, EU, UN) are public-domain government works ingested directly
 * elsewhere (ofac-sdn-fetch.mjs, eu-sanctions-fetch.mjs) and carry NO NC
 * restriction — only OpenSanctions' aggregated FTM packaging does. The license
 * is stamped into the merge output and flagged in the workflow PR.
 *
 * Standalone usage:
 *   node scripts/opensanctions-fetch.mjs                          # default: ./data/raw/opensanctions/<date>.jsonl
 *   node scripts/opensanctions-fetch.mjs --limit 1000 --out /tmp/test.jsonl
 *   node scripts/opensanctions-fetch.mjs --url file:///tmp/x.jsonl  # local file (for tests)
 *
 * Flags:
 *   --limit N    cap entities written (after filtering). Default: no cap.
 *   --out PATH   override output path.
 *   --url URL    override source URL. Supports `file://` for testing.
 */

import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DEFAULT_INDEX_URL =
  "https://data.opensanctions.org/datasets/latest/sanctions/index.json";
const DEFAULT_ENTITIES_URL =
  "https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json";

const UA = "TruNorth-OpenSanctions/1.0 (+https://www.trunorthapp.com)";

// FTM schemas we keep. OpenSanctions tags every entity with a FollowTheMoney
// schema; the corporate-shaped ones are Company, Organization, LegalEntity
// (umbrella), and PublicBody (state-owned enterprises that look like
// companies — e.g. sanctioned state oil firms). We deliberately drop:
//   Person   — PEPs / individuals (huge volume, not consumer brands)
//   Vessel   — ships (covered, but rarely useful for brand matching)
//   Airplane — same
//   Address  — pure addresses, no entity attached
const KEEP_SCHEMAS = new Set([
  "Company",
  "Organization",
  "LegalEntity",
  "PublicBody",
]);

/* ---------------------------- arg parsing ----------------------------- */

function parseArgs(argv) {
  const out = { limit: null, outPath: null, url: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--url") out.url = argv[++i];
  }
  return out;
}

/* ---------------------------- entity filter --------------------------- */

/**
 * Decide whether to keep an FTM entity. Pure function — used by the
 * fetcher and exercised by the test suite.
 *
 * Rules:
 *   - schema must be in KEEP_SCHEMAS
 *   - properties.topics must include "sanction" (the bulk file IS the
 *     sanctions dataset, but some entries are inferred linked entities
 *     that aren't themselves sanctioned — we drop those)
 *   - must have at least one name (caption or properties.name[0])
 */
export function keepEntity(entity) {
  if (!entity || typeof entity !== "object") return false;
  if (!KEEP_SCHEMAS.has(entity.schema)) return false;
  const topics = entity.properties?.topics || [];
  if (!topics.includes("sanction")) return false;
  const hasName =
    (typeof entity.caption === "string" && entity.caption.trim()) ||
    (Array.isArray(entity.properties?.name) && entity.properties.name[0]);
  if (!hasName) return false;
  return true;
}

/**
 * Reduce an FTM entity to the minimal shape the merger consumes. Keeping
 * the JSONL file lean (a handful of fields per record vs. ~20) brings the
 * snapshot from ~340MB down to a few MB after filtering.
 */
export function projectEntity(entity) {
  const p = entity.properties || {};
  return {
    id: entity.id,
    caption: entity.caption,
    schema: entity.schema,
    datasets: entity.datasets || [],
    first_seen: entity.first_seen || null,
    last_seen: entity.last_seen || null,
    last_change: entity.last_change || null,
    names: Array.from(new Set([
      ...(p.name || []),
      ...(p.alias || []),
      ...(p.weakAlias || []),
      ...(p.previousName || []),
      ...(entity.caption ? [entity.caption] : []),
    ])).filter(Boolean),
    countries: p.country || [],
    topics: p.topics || [],
    programs: p.program || [],
    programIds: p.programId || [],
    sourceUrls: p.sourceUrl || [],
    sectors: p.sector || [],
    // Cross-walk identifiers — the gold for high-confidence matching
    registrationNumbers: p.registrationNumber || [],
    ogrnCodes: p.ogrnCode || [],
    innCodes: p.innCode || [],
    leiCodes: p.leiCode || [],
    wikidataIds: (p.wikidataId || []).concat(
      (entity.referents || []).filter(r => /^Q\d+$/.test(r))
    ),
    secCiks: (p.secCik || []).concat(
      (entity.referents || [])
        .map(r => (/^us-sec-cik-(\d+)$/.exec(r) || [])[1])
        .filter(Boolean)
    ),
  };
}

/* ---------------------------- stream parsing -------------------------- */

/**
 * Open a UTF-8 line iterator over the entities feed. Supports https URLs
 * and file:// URLs (the latter is what the test harness uses to read the
 * bundled fixture without making a network call).
 */
async function openEntityStream(url) {
  if (url.startsWith("file://")) {
    const local = decodeURIComponent(url.slice("file://".length));
    // Use a Node Readable so the underlying fd is closed deterministically
    // when the stream ends — avoids the FileHandle GC-close deprecation
    // warning we'd get from FileHandle.readableWebStream().
    const { createReadStream } = await import("node:fs");
    return createReadStream(local);
  }
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "application/json+ftm,*/*" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`OpenSanctions ${res.status} ${res.statusText} (${url})`);
  }
  if (!res.body) throw new Error("OpenSanctions response had no body");
  return res.body;
}

/**
 * Line splitter on a ReadableStream<Uint8Array>. Yields decoded UTF-8
 * lines, one per JSON entity. Last partial line (no trailing newline) is
 * still flushed at end-of-stream.
 */
async function* readLines(stream) {
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  for await (const chunk of streamToAsync(stream)) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield buf;
}

// Node 22's `for await` accepts both WHATWG ReadableStream and Node
// Readable. Normalize so we don't care which we got from openEntityStream.
async function* streamToAsync(stream) {
  if (Symbol.asyncIterator in Object(stream)) {
    for await (const c of stream) yield c;
    return;
  }
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield value;
  }
}

/* -------------------------------- main -------------------------------- */

/**
 * Stream the entities feed, filter + project, write JSONL to disk.
 * Exposed so the test harness can drive it against a local fixture.
 *
 * Returns { kept, scanned, indexMeta }.
 */
export async function fetchAndFilter({
  url = DEFAULT_ENTITIES_URL,
  outPath,
  limit = null,
  indexUrl = DEFAULT_INDEX_URL,
  logFn = () => {},
} = {}) {
  const stream = await openEntityStream(url);
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  let indexMeta = null;
  // Best-effort: fetch dataset metadata for the audit trail. Failures here
  // are non-fatal — we still produce a JSONL snapshot.
  if (indexUrl && !url.startsWith("file://")) {
    try {
      const res = await fetch(indexUrl, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
      });
      if (res.ok) {
        const meta = await res.json();
        indexMeta = {
          version: meta.version,
          updated_at: meta.updated_at,
          entity_count: meta.entity_count,
          target_count: meta.target_count,
        };
      }
    } catch { /* swallow */ }
  }

  const sink = createWriteStream(outPath, { encoding: "utf-8" });
  let scanned = 0;
  let kept = 0;

  for await (const line of readLines(stream)) {
    scanned++;
    let entity;
    try { entity = JSON.parse(line); }
    catch { continue; }   // malformed line — skip
    if (!keepEntity(entity)) continue;
    const proj = projectEntity(entity);
    // Backpressure: when write() returns false, block this loop on one
    // "drain" before pushing the next chunk. (Don't queue N drain promises
    // — that triggers MaxListenersExceededWarning.)
    if (!sink.write(JSON.stringify(proj) + "\n")) {
      await new Promise(r => sink.once("drain", r));
    }
    kept++;
    if (kept % 5000 === 0) logFn(`  ${kept.toLocaleString()} kept / ${scanned.toLocaleString()} scanned`);
    if (limit && kept >= limit) break;
  }

  await new Promise((resolve, reject) => sink.end(err => err ? reject(err) : resolve()));

  return { kept, scanned, indexMeta };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const outPath = args.outPath
    ? path.resolve(args.outPath)
    : path.join(ROOT, "data", "raw", "opensanctions", `${date}.jsonl`);
  const url = args.url || DEFAULT_ENTITIES_URL;

  console.log(`OpenSanctions fetcher starting...`);
  console.log(`  source: ${url}`);
  console.log(`  out:    ${outPath}`);
  if (args.limit) console.log(`  limit:  ${args.limit.toLocaleString()}`);

  const t0 = Date.now();
  const { kept, scanned, indexMeta } = await fetchAndFilter({
    url,
    outPath,
    limit: args.limit,
    logFn: (m) => console.log(m),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${dt}s.`);
  console.log(`  scanned: ${scanned.toLocaleString()}`);
  console.log(`  kept:    ${kept.toLocaleString()} (Company/Organization/LegalEntity/PublicBody w/ topics:sanction)`);
  if (indexMeta) {
    console.log(`  dataset: version=${indexMeta.version} updated_at=${indexMeta.updated_at} target_count=${indexMeta.target_count}`);
  }

  // Sidecar metadata (1 file per snapshot) — captures provenance for the
  // PR description and downstream merge log.
  const metaPath = outPath.replace(/\.jsonl$/, ".meta.json");
  await fs.writeFile(metaPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source_url: url,
    index_url: DEFAULT_INDEX_URL,
    dataset: indexMeta,
    scanned,
    kept,
    license: "CC-BY-NC 4.0 — OpenSanctions",
    license_note: "Non-commercial only. ⚠️ TRIGGERED — paid Pro tier is LIVE (App Store-approved 2026-06-18); NC review open, do not merge into the shipped product until resolved (see fetcher header).",
  }, null, 2));
  console.log(`  meta:    ${metaPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => {
    console.error("opensanctions-fetch failed:", err);
    process.exit(1);
  });
}
