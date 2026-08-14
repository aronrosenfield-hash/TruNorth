#!/usr/bin/env node
/**
 * fix-payratio-narratives.mjs — repair publicly-visible pay-ratio claims that
 * CONTRADICT the authoritative structured record.
 *
 * WHY (found 2026-08-10): a brand can carry up to three different pay ratios.
 * `payRatio` is the authoritative structured object (ratio + ceoPay +
 * medianWorkerPay + the SEC filing URL). `enriched.execPay` comes from the
 * sec-def14a bulk parser and is unreliable — it drops a leading "1"
 * (Coca-Cola 1739 -> 739, McDonald's 1082 -> 82, Starbucks 1794 -> 794) and in
 * one case parsed the filing YEAR as the ratio (Home Depot -> "2026:1", with
 * ceoTotal $2,027 and ceoName "Carbon Disclosure Project CEO"). The
 * user-visible narrative `execPay.s` was written from the BAD value, so the app
 * and the SEO pages publish a false, checkable claim about a real company.
 *
 * SCOPE — deliberately narrow. This script ONLY rewrites the ratio NUMBER
 * inside a narrative that already makes an explicit "<N>:1" pay-ratio claim
 * which disagrees with `payRatio.ratio`. It does NOT:
 *   - touch narratives that make no ratio claim (e.g. Allstate's NAIC-complaint
 *     record, or an honest "No public record found.")
 *   - invent a narrative where none exists
 *   - rewrite any other sentence, source list, or field
 * An earlier, broader version of this script would have destroyed legitimate
 * narratives on 177 brands. Keep the blast radius small on purpose.
 *
 * NOTE: this repairs the DATA. The upstream sec-def14a parser still needs
 * fixing or these values regress on its next successful run (it is currently
 * failing — see BACKLOG B-107/B-123).
 *
 * Usage:
 *   node scripts/fix-payratio-narratives.mjs           # DRY RUN (default)
 *   node scripts/fix-payratio-narratives.mjs --apply   # write changes
 */
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const COMPS = path.join(process.cwd(), "public/data/companies");

const usdCompact = (n) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `$${Math.round(n / 1e3)}K`
  : `$${Math.round(n)}`;

const fmtRatio = (r) => (Number.isInteger(r) ? String(r) : String(r));

const changes = [];
const purged = [];
for (const f of fs.readdirSync(COMPS).filter((x) => x.endsWith(".json"))) {
  const p = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }

  const pr = d.payRatio;
  if (!pr || typeof pr.ratio !== "number" || !(pr.ratio > 0)) continue;

  // STEP 1 — purge contradicting enriched values. This runs INDEPENDENTLY of the
  // narrative check below: once a narrative has been corrected it stops matching,
  // and an enriched-only cleanup nested inside that branch would silently never
  // run again (exactly what let Home Depot's payRatio 2026 survive a rebase and
  // trip the C-6 gate).
  if (d.enriched?.execPay && typeof d.enriched.execPay.payRatio === "number"
      && Math.abs(d.enriched.execPay.payRatio - pr.ratio) > 1) {
    const e = d.enriched.execPay;
    for (const k of ["payRatio", "ceoTotal", "ceoBaseSalary", "ceoBonus", "ceoStockAwards",
                     "ceoOptionAwards", "ceoNonEquityIncentive", "ceoAllOtherComp", "ceoName", "year"]) {
      delete e[k];
    }
    e._supersededBy = "payRatio";
    e._note = "sec-def14a parse contradicted the authoritative payRatio record; bad values removed";
    purged.push(d.name);
    if (APPLY) fs.writeFileSync(p, JSON.stringify(d, null, 2));
  }

  const s = d.execPay?.s;
  if (typeof s !== "string" || !s) continue;

  // STEP 2 — only act on an EXPLICIT ratio claim in the narrative.
  const m = s.match(/(ratio\s+)([\d][\d,]*(?:\.\d+)?)(\s*:\s*1)/i);
  if (!m) continue;
  const claimed = Number(m[2].replace(/,/g, ""));
  if (!(Math.abs(claimed - pr.ratio) > 1)) continue; // consistent enough

  let next = s.replace(m[0], `${m[1]}${fmtRatio(pr.ratio)}${m[3]}`);

  // If the same sentence also quotes a CEO comp figure that contradicts the
  // authoritative ceoPay (Home Depot's "$2K" vs the real $16.2M), fix it too.
  let ceoFixed = null;
  if (typeof pr.ceoPay === "number" && pr.ceoPay > 0) {
    const cm = next.match(/(CEO total compensation\s+)(\$[\d.,]+[KMB]?)/i);
    if (cm) {
      const want = usdCompact(pr.ceoPay);
      if (cm[2] !== want) { next = next.replace(cm[0], `${cm[1]}${want}`); ceoFixed = `${cm[2]} -> ${want}`; }
    }
  }

  if (next === s) continue;

  changes.push({
    name: d.name,
    slug: d.slug || f.replace(/\.json$/, ""),
    was: claimed, now: pr.ratio, ceoFixed,
    oldS: s, newS: next,
  });

  if (APPLY) {
    d.execPay.s = next;
    fs.writeFileSync(p, JSON.stringify(d, null, 2));
  }
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"} — ${changes.length} narrative(s) corrected, ${purged.length} corrupt enriched.execPay block(s) purged\n`);
if (purged.length) console.log(`   purged: ${purged.join(", ")}\n`);
for (const c of changes) {
  console.log(`${c.name}  (${c.was}:1  ->  ${c.now}:1)${c.ceoFixed ? `   CEO comp ${c.ceoFixed}` : ""}`);
  console.log(`   old: ${c.oldS.slice(0, 150)}`);
  console.log(`   new: ${c.newS.slice(0, 150)}\n`);
}
if (!APPLY) console.log("Re-run with --apply to write these changes.");
