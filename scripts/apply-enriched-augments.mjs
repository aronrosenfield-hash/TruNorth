#!/usr/bin/env node
/**
 * Apply the Build-76 "display-first" enriched augments → per-company JSON.
 *
 * The wave-1/2 source builds each wrote a derived augment
 * (data/derived/<src>-augment.json) keyed by company slug, but deliberately
 * did NOT touch company files (so parallel builds couldn't collide). This is
 * the single, controlled apply step: it reads each augment and writes its
 * per-company payload into company.enriched.<field>. It does NOT touch
 * category narratives or scores — purely additive display data.
 *
 * Run this in an ISOLATED git worktree on origin/main (clean base) so the only
 * company-file changes are these enriched.* additions — the shared working
 * tree is contested by parallel sessions.
 *
 * Each augment's per-slug payload shape differs slightly, so `pick` normalises
 * it to the flat object we store under enriched.<field>. Meta keys (matchCount,
 * generatedAt, _source, …) are skipped automatically because they have no
 * matching company file.
 *
 * Flags:
 *   --dry    (default) report how many companies WOULD get each field
 *   --apply  write into public/data/companies/<slug>.json
 *   --only A,B   restrict to specific augment fields (e.g. --only secTax,privacy)
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT     = path.resolve(__dirname, "..");
const AUG_DIR  = path.join(ROOT, "data/derived");
const COMP_DIR = path.join(ROOT, "public/data/companies");

// augment file → { field on enriched, pick(entry) → stored object }.
const AUGMENTS = [
  { file: "sec-tax-augment.json",            field: "secTax",        pick: (e) => e.sec?.tax || e },
  { file: "supply-chain-augment.json",       field: "supplyChain",   pick: (e) => e },
  { file: "openfda-recalls-augment.json",    field: "openfdaRecalls", pick: (e) => e },
  { file: "privacy-enforcement-augment.json", field: "privacy",       pick: (e) => e },
  { file: "pharma-conduct-augment.json",     field: "pharmaConduct", pick: (e) => e },
  { file: "labor-wages-augment.json",        field: "laborWages",    pick: (e) => e },
  { file: "animal-certs-augment.json",       field: "animalCerts",   pick: (e) => e },
];

function parseArgs() {
  const a = process.argv.slice(2);
  const apply = a.includes("--apply");
  const oi = a.indexOf("--only");
  const only = oi >= 0 ? new Set((a[oi + 1] || "").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  return { apply, dry: !apply, only };
}

// Drop augment-level metadata keys; a real slug always has a company file.
function isSlugKey(k, v) {
  return k && !k.startsWith("_") && v && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  const { apply, only } = parseArgs();
  const now = new Date().toISOString();
  console.log(`apply-enriched-augments — mode=${apply ? "APPLY" : "DRY"}${only ? ` only=${[...only].join(",")}` : ""}`);

  // Accumulate per-company patches so each file is read+written ONCE even when
  // multiple augments target it.
  const patches = new Map(); // slug → { field: payload }
  const stats = [];

  for (const cfg of AUGMENTS) {
    if (only && !only.has(cfg.field)) continue;
    const p = path.join(AUG_DIR, cfg.file);
    if (!existsSync(p)) { console.warn(`  [${cfg.field}] missing ${cfg.file} — skip`); continue; }
    let aug;
    try { aug = JSON.parse(await fs.readFile(p, "utf-8")); }
    catch (e) { console.warn(`  [${cfg.field}] parse error: ${e.message}`); continue; }

    let matched = 0, orphan = 0;
    for (const [k, v] of Object.entries(aug)) {
      if (!isSlugKey(k, v)) continue;
      if (!existsSync(path.join(COMP_DIR, `${k}.json`))) { orphan++; continue; }
      const payload = cfg.pick(v);
      if (payload == null) continue;
      if (!patches.has(k)) patches.set(k, {});
      patches.get(k)[cfg.field] = payload;
      matched++;
    }
    stats.push({ field: cfg.field, matched, orphan });
    console.log(`  [${cfg.field}] ${matched} companies (+${orphan} slugs without a company file)`);
  }

  console.log(`\nDistinct companies touched: ${patches.size}`);
  if (!apply) { console.log("DRY — re-run with --apply to write."); return; }

  let written = 0, errors = 0;
  for (const [slug, fields] of patches) {
    const file = path.join(COMP_DIR, `${slug}.json`);
    let raw, c;
    try { raw = await fs.readFile(file, "utf-8"); c = JSON.parse(raw); }
    catch (e) { errors++; continue; }
    c.enriched = c.enriched || {};
    for (const [field, payload] of Object.entries(fields)) c.enriched[field] = payload;
    if (typeof c.dataLastUpdated !== "object" || c.dataLastUpdated === null) {
      c.dataLastUpdated = c.dataLastUpdated ? { legacy: c.dataLastUpdated } : {};
    }
    c.dataLastUpdated.enrichedAugments = now;
    // Preserve the file's existing format (mixed pretty/minified in the repo)
    // so the apply diff is only the added fields, not a whole-file reformat.
    await fs.writeFile(file, JSON.stringify(c, null, /\n {2}/.test(raw) ? 2 : 0));
    written++;
  }
  console.log(`Applied → ${written} company files written (${errors} errors).`);
}

main().catch((e) => { console.error("apply-enriched-augments failed:", e); process.exit(1); });
