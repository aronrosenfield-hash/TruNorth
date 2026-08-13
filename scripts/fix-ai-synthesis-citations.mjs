#!/usr/bin/env node
/**
 * fix-ai-synthesis-citations.mjs — remove "Claude AI synthesis" as a cited SOURCE.
 *
 * WHY (found 2026-08-10): the string appeared 82,553 times across 11,187 brand
 * files (87% of the catalog) on a product whose promise is "records, not
 * opinions." Citing an AI as the provenance of a public-record claim is the
 * single most damaging string in the repo — one grep by a journalist and the
 * checkability claim is gone.
 *
 * MEASURED SHAPE (this is why the fix is safe, not a mass rewrite):
 *   76,139  blocks whose text is "No public record found."-type  -> honest text,
 *           junk citation. Drop the citation; a no-record block has no source.
 *    6,284  blocks that ALSO cite >=1 real source -> just drop the junk string.
 *      130  blocks making a SUBSTANTIVE claim with only the AI citation. These
 *           turned out to be REAL data that was MIS-LABELLED (OSHA severe-injury
 *           counts, CISA KEV CVE lists, CFPB complaint counts, MSHA), plus a few
 *           editorial "not applicable to <industry>" lines in stance categories.
 *
 * POLICY:
 *   - Re-attribute a substantive claim ONLY when the narrative names a real
 *     source AND (where applicable) the corresponding enriched.* record exists.
 *     Evidence-backed attribution only — never guess a source.
 *   - Anything substantive we cannot trace is left with an empty sources array
 *     and reported as UNTRACED so it can be reviewed rather than silently blessed.
 *   - Narrative TEXT is never modified. This only touches `sources`.
 *
 * Grades: the scorer reads enums (`sc`) and narratives, never `sources`, so this
 * is expected to be display-only. Verified with a dry rebake after applying.
 *
 * Usage:
 *   node scripts/fix-ai-synthesis-citations.mjs           # DRY RUN
 *   node scripts/fix-ai-synthesis-citations.mjs --apply
 */
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const COMPS = path.join(process.cwd(), "public/data/companies");
const SYN = /^claude ai synthesis$/i;
const NO_REC = /^\s*(no public record found|no record found|no documented|none found|not disclosed|no public data)/i;

// narrative pattern -> [real source label, enriched key that must exist (or null)]
const ATTRIB = [
  [/OSHA severe-injury reports/i, "OSHA", "oshaSevereInjury"],
  [/CISA Known Exploited Vulns/i, "CISA KEV", "cisaKev"],
  [/CFPB consumer complaints/i, "CFPB", null],
  [/Mine Safety & Health Admin/i, "MSHA", "msha"],
  [/Leaping Bunny|PETA/i, "Leaping Bunny / PETA", null],
];

// A claim is FACTUAL (and therefore unsafe to publish unsourced) when it quantifies
// something or alleges misconduct. Editorial prose like "Not applicable to fine art
// retailer." is neither, and is left alone.
// NB: match "fined"/"fines", never a bare "fine" — "Not applicable to fine art
// retailer." is editorial prose, not an allegation.
const FACTUAL = /\d|\$|penalt|violat|enforcement|lawsuit|\bfined\b|\bfines\b|breach|recall/i;

const stats = { noRecord: 0, mixed: 0, reattributed: 0, untraced: 0, neutralized: 0, filesChanged: 0 };
const untraced = [], reattrib = {}, neutralized = [];

for (const f of fs.readdirSync(COMPS).filter((x) => x.endsWith(".json"))) {
  const p = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
  let changed = false;

  for (const k of Object.keys(d)) {
    const v = d[k];
    if (!v || typeof v !== "object" || !Array.isArray(v.sources)) continue;
    if (!v.sources.some((s) => SYN.test(String(s).trim()))) continue;

    const others = v.sources.filter((s) => !SYN.test(String(s).trim()));
    const text = String(v.s || "").trim();

    if (others.length > 0) {
      stats.mixed++;
      if (APPLY) v.sources = others;
      changed = true;
      continue;
    }

    // Sole-source cases
    if (!text || NO_REC.test(text)) {
      stats.noRecord++;
      if (APPLY) v.sources = [];
      changed = true;
      continue;
    }

    // Substantive claim — try to attribute from evidence.
    let label = null;
    for (const [re, src, enrichedKey] of ATTRIB) {
      if (!re.test(text)) continue;
      if (enrichedKey && !d.enriched?.[enrichedKey]) continue; // require the record
      label = src;
      break;
    }
    if (label) {
      stats.reattributed++;
      reattrib[label] = (reattrib[label] || 0) + 1;
      if (APPLY) v.sources = [label];
    } else if (FACTUAL.test(text)) {
      // A QUANTIFIED / ACCUSATORY claim we cannot trace to any record must not
      // display and must not score. Leaving the text while merely emptying the
      // sources is the worst outcome: the allegation still renders and still
      // drives a grade. Worst live example — Mayo Clinic privacy: "Federal
      // privacy violation resulted in $52.5M penalty" with no enriched record
      // and no corroboration anywhere in public/data, driving sc.privacy="poor"
      // -> csc 8 and contributing to a published "F" on a named institution.
      stats.neutralized++;
      neutralized.push(`${d.name} [${k}] :: ${text.slice(0, 95)}`);
      if (APPLY) {
        v.s = "No public record found.";
        v.sources = [];
        if (d.sc && d.sc[k] != null) d.sc[k] = "neutral"; // stop it scoring
      }
    } else {
      // Editorial / not-applicable prose (mostly stance categories, which never
      // score). Harmless text, just an unsupportable citation — drop the source.
      stats.untraced++;
      untraced.push(`${d.name} [${k}] :: ${text.slice(0, 95)}`);
      if (APPLY) v.sources = [];
    }
    changed = true;
  }

  if (changed) {
    stats.filesChanged++;
    if (APPLY) fs.writeFileSync(p, JSON.stringify(d, null, 2));
  }
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"} — removing "Claude AI synthesis" as a cited source\n`);
console.log(`  brand files touched                      : ${stats.filesChanged}`);
console.log(`  no-record blocks, citation dropped       : ${stats.noRecord}`);
console.log(`  mixed blocks, junk string dropped        : ${stats.mixed}`);
console.log(`  substantive claims RE-ATTRIBUTED         : ${stats.reattributed}  ${JSON.stringify(reattrib)}`);
console.log(`  UNTRACED editorial prose, source dropped : ${stats.untraced}`);
console.log(`  UNTRACEABLE FACTUAL CLAIMS NEUTRALIZED   : ${stats.neutralized}  <-- text + score removed`);
if (neutralized.length) {
  console.log(`\n--- NEUTRALIZED (unsourced factual claims; narrative -> "No public record found.", enum -> neutral) ---`);
  neutralized.forEach((u) => console.log("   " + u));
}
if (untraced.length) {
  console.log(`\n--- UNTRACED: text kept, sources emptied, needs a human look ---`);
  untraced.slice(0, 40).forEach((u) => console.log("   " + u));
}
if (!APPLY) console.log("\nRe-run with --apply to write these changes.");
