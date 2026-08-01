/**
 * audit-ungraded.mjs — Root-cause segmentation of the "?" wall.
 *
 * Classifies every ungraded brand (index overall == null) by the SINGLE reason
 * it isn't graded, using the SAME gate the real scorer uses. A brand is graded
 * iff >=1 SCOREABLE category produces a signal. Scoreable categories are ONLY
 * {charity, environment, labor, privacy, execPay} — stance categories
 * (political, dei, animals, guns) return null from baseScoreCat and never
 * contribute to the un-quizzed baseline (rebake-scoring.mjs:296). A signal is:
 *   - "real":         sc[k] is a recognized non-neutral value baseScoreCat scores
 *   - "inferred":     flags._inferred + recognized value
 *   - "narrativeOnly": enum neutral/unknown + a non-"No public record" narrative
 * If none of the 5 scoreable cats yields a signal -> overall stays null -> "?".
 *
 * READ-ONLY. Writes nothing. Prints a JSON report to stdout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const META = path.join(ROOT, "public/data/_meta");

const idx = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/index.json"), "utf8"));
const parentMap = JSON.parse(fs.readFileSync(path.join(META, "brand-parent-map.json"), "utf8"));
const aliases = JSON.parse(fs.readFileSync(path.join(META, "slug-aliases.json"), "utf8"));

const gradedSet = new Set(idx.filter(c => c.overall != null).map(c => c.slug));
const total = idx.length;
const ungraded = idx.filter(c => c.overall == null);

const SCOREABLE = ["charity", "environment", "labor", "privacy", "execPay"];
const STANCE = ["political", "dei", "animals", "guns"];
const NO_RECORD = /^\s*no public record found\.?\s*$/i;
const RECOGNIZED = {
  charity: ["positive","excellent","strong","good","active_giving","mixed","negative","poor","below average","very poor"],
  environment: ["positive","excellent","strong","good","mixed","negative","poor","below average","very poor"],
  labor: ["positive","excellent","strong","good","mixed","negative","poor","below average","very poor"],
  privacy: ["good","mixed","poor"],
  execPay: ["fair","good","mixed","poor"],
};

// Does a scoreable category currently produce a signal? (Mirrors classifyCategory
// + baseScoreCat.) Returns the state string when it DOES, else null.
function scoreableSignal(d, k) {
  const sc = d.sc || {};
  const flags = (d.flags || {})[k] || {};
  const detail = d[k] || {};
  const val = String(sc[k] || "").toLowerCase();
  const narrative = String(detail.s || "");
  const hasNarrative = narrative && !NO_RECORD.test(narrative);

  if (flags.na === true || val === "na" || val === "n/a") return null;
  if (flags.notDisclosed === true && !hasNarrative) return null;
  if (narrative && NO_RECORD.test(narrative)) return null;
  // neutral enum + real narrative -> narrativeOnly (always scores for scoreable cats)
  if ((!val || val === "neutral" || val === "unknown") && hasNarrative) return "narrativeOnly";
  if (!val || val === "neutral" || val === "unknown") return null;
  // real/inferred enum -> only a signal if baseScoreCat recognizes the value
  if (execPaySpecial(k, d)) return "real";
  if (RECOGNIZED[k] && RECOGNIZED[k].includes(val)) return flags._inferred ? "inferred" : "real";
  return null; // unrecognized enum vocabulary
}
function execPaySpecial(k, d) {
  if (k !== "execPay") return false;
  // baseScoreCat scores execPay when a parseable pay ratio exists even w/o enum.
  const pr = d.payRatio;
  if (typeof pr === "number" && pr > 0) return true;
  return false;
}

// ---- raw convertible evidence detectors (dark data not wired to scoring) ----
function convertibleDark(d) {
  const hits = [];
  const sc = d.sc || {};
  const e = d.enriched || {};
  // privacy breaches (HIBP) present but privacy enum neutral
  const brc = e.privacy && e.privacy.breaches && e.privacy.breaches.count;
  if (brc && Number(brc) > 0 && (String(sc.privacy||"").toLowerCase()==="neutral"||!sc.privacy)) hits.push("privacy_breaches");
  if (d.privacy_hibp_breaches && Array.isArray(d.privacy_hibp_breaches) && d.privacy_hibp_breaches.length &&
      (String(sc.privacy||"").toLowerCase()==="neutral"||!sc.privacy)) hits.push("privacy_hibp");
  // WARN layoffs (labor) present but labor enum neutral
  const warn = e.laborWages && e.laborWages.warnLayoffs;
  if (warn && Number(warn) > 0 && (String(sc.labor||"").toLowerCase()==="neutral"||!sc.labor)) hits.push("labor_warn");
  // DOL WHD wage violations
  if (d.labor_dol_whd && (d.labor_dol_whd.cases || d.labor_dol_whd.backWages || (Array.isArray(d.labor_dol_whd)&&d.labor_dol_whd.length)) &&
      (String(sc.labor||"").toLowerCase()==="neutral"||!sc.labor)) hits.push("labor_dol");
  // OSHA / NLRB
  if (d.osha && ((d.osha.inspections||d.osha.violations) || (Array.isArray(d.osha)&&d.osha.length)) &&
      (String(sc.labor||"").toLowerCase()==="neutral"||!sc.labor)) hits.push("labor_osha");
  // charity IRS990 grants
  const c990 = d.charity_irs990;
  if (c990 && (c990.grantsPaid || c990.totalGiving || c990.grants) &&
      (String(sc.charity||"").toLowerCase()==="neutral"||!sc.charity)) hits.push("charity_990");
  // environment EPA / EJScreen / violationTracker env penalties
  if (d.epa && (d.epa.penalties || d.epa.violations || (Array.isArray(d.epa)&&d.epa.length)) &&
      (String(sc.environment||"").toLowerCase()==="neutral"||!sc.environment)) hits.push("env_epa");
  return hits;
}

function execPayNoRatio(d) {
  // execPay comp disclosed but no ratio -> structurally na under current rule
  const e = d.enriched || {};
  const hasComp = (e.execPay && (e.execPay.ceoTotal || e.execPay.ceoName)) ||
                  (d.execPay && d.execPay.s && /compensation|pay/i.test(String(d.execPay.s)));
  const noRatio = !(typeof d.payRatio === "number" && d.payRatio > 0) &&
                  !(e.execPay && typeof e.execPay.payRatio === "number" && e.execPay.payRatio > 0);
  return hasComp && noRatio;
}

// ---------------- classification ----------------
const buckets = {};
const bump = (b) => (buckets[b] = (buckets[b] || 0) + 1);
const attrs = { private: 0, public: 0, hasWiki: 0, hasBBB: 0, hasSEC: 0, hasEnriched: 0,
                hasAnyIdentity: 0, gradedParentAvailable: 0, sanityScoreableSignal: 0 };
const examples = {};
const addEx = (b, slug) => { (examples[b] = examples[b] || []); if (examples[b].length < 8) examples[b].push(slug); };

for (const c of ungraded) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(COMPS, c.slug + ".json"), "utf8")); }
  catch { bump("z_unreadable"); continue; }

  const sc = d.sc || {};
  const isPublic = d.isPublic === true;
  isPublic ? attrs.public++ : attrs.private++;
  const hasWiki = !!d.wiki && Object.keys(d.wiki).length > 0;
  const hasBBB = !!d.bbb && (d.bbb.rating || d.bbb.profileUrl);
  const hasSEC = !!(d.sec || d.cik || (d.secComplaints));
  const hasEnriched = !!d.enriched && Object.keys(d.enriched).length > 0;
  const hasIdentity = hasWiki || hasBBB || hasSEC;
  if (hasWiki) attrs.hasWiki++;
  if (hasBBB) attrs.hasBBB++;
  if (hasSEC) attrs.hasSEC++;
  if (hasEnriched) attrs.hasEnriched++;
  if (hasIdentity) attrs.hasAnyIdentity++;

  // sanity: no scoreable cat should produce a signal (else it'd be graded)
  let anySignal = false;
  for (const k of SCOREABLE) if (scoreableSignal(d, k)) { anySignal = true; break; }
  if (anySignal) attrs.sanityScoreableSignal++;

  // stance-only: any non-neutral recognized stance value
  let stanceSignal = false;
  for (const k of STANCE) {
    const v = String(sc[k] || "").toLowerCase();
    if (v && v !== "neutral" && v !== "na" && v !== "n/a" && v !== "unknown") { stanceSignal = true; break; }
  }

  // unrecognized scoreable enum: non-neutral scoreable value the scorer drops
  let unrecognized = false;
  for (const k of SCOREABLE) {
    const v = String(sc[k] || "").toLowerCase();
    if (v && v !== "neutral" && v !== "na" && v !== "n/a" && v !== "unknown" &&
        !(RECOGNIZED[k] && RECOGNIZED[k].includes(v)) && !execPaySpecial(k, d)) { unrecognized = true; break; }
  }

  const dark = convertibleDark(d);
  const pInfo = parentMap[c.slug];
  const parentSlug = pInfo && pInfo.parent;
  const gradedParent = parentSlug && gradedSet.has(parentSlug) && parentSlug !== c.slug;
  if (gradedParent) attrs.gradedParentAvailable++;
  const isAlias = Object.prototype.hasOwnProperty.call(aliases, c.slug);

  // ---- assign to ONE bucket, best-conversion-path first ----
  let b;
  if (isAlias) b = "1_alias_duplicate";
  else if (dark.length) b = "2_dark_scoreable_evidence";
  else if (unrecognized) b = "3_unrecognized_enum_vocab";
  else if (gradedParent) b = "4_graded_parent_not_inherited";
  else if (execPayNoRatio(d)) b = "5_execpay_no_ratio";
  else if (stanceSignal) b = "6_stance_only_neutrality_wall";
  else if (hasIdentity || hasEnriched) b = "7_identity_only_no_category_evidence";
  else b = "8_genuinely_empty";
  bump(b);
  addEx(b, c.slug);
}

// B-104 self-check: this file MIRRORS the scorer's gate (SCOREABLE cats,
// RECOGNIZED enums, execPay ratio) rather than importing it, so it can drift if
// rebake-scoring.mjs changes. sanityScoreableSignal counts ungraded brands the
// mirror thinks SHOULD score — it must be ~0. Warn loudly on stderr (keep stdout
// pure JSON so the report stays pipeable) so drift surfaces instead of quietly
// corrupting the segmentation.
if (attrs.sanityScoreableSignal > 0) {
  console.error(
    `[audit-ungraded] ⚠ mirror drift: ${attrs.sanityScoreableSignal} ungraded brand(s) ` +
    `pass the scoreable gate here but are ungraded in index.json — the RECOGNIZED enums / ` +
    `gate logic no longer match rebake-scoring.mjs. Re-sync before trusting the buckets.`
  );
}

const N = ungraded.length;
const pct = (n) => ((n / N) * 100).toFixed(1) + "%";
const rows = Object.keys(buckets).sort().map(b => ({ bucket: b, count: buckets[b], pct: pct(buckets[b]) }));

console.log(JSON.stringify({
  totalTracked: total,
  gradedCount: gradedSet.size,
  ungradedCount: N,
  buckets: rows,
  attributes: attrs,
  examples,
}, null, 2));
