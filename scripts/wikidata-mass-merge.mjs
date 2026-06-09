#!/usr/bin/env node
/**
 * Wikidata mass-merge — collapse the flat (qid, prop, value) claim list
 * from wikidata-mass-fetch into a per-slug augment file consumed by
 * apply-augments-to-companies.mjs.
 *
 * Reads:
 *   data/raw/wikidata/<YYYY-MM-DD>.json  (latest unless --in)
 *   public/data/index.json               (for slug validation)
 *
 * Writes:
 *   data/derived/wikidata-augment.json
 *
 * Output shape (consumed by apply-augments writer "wikidata"):
 *   {
 *     _license, _source, _generated_at, _stats,
 *     companies: {
 *       "<slug>": {
 *         qid: "Q160746",
 *         title: "Nestlé",
 *         significant_events: [{ qid, label }, ...],
 *         owned_by: { qid, label } | null,
 *         part_of: [{ qid, label }, ...],
 *         owner_of: [{ qid, label }, ...],
 *         member_of: [{ qid, label }, ...],
 *         award_received: [{ qid, label }, ...],
 *         headquarters: [{ qid, label }, ...],
 *         twitter_handle: "Nestle",
 *         narrative_environment: "..." | null,
 *         narrative_labor: "..." | null,
 *         narrative_governance: "..." | null,
 *         severity: "negative" | "mixed" | "positive" | "neutral"
 *       }
 *     }
 *   }
 *
 * CLI:
 *   node scripts/wikidata-mass-merge.mjs              # use latest raw
 *   node scripts/wikidata-mass-merge.mjs --in <file>
 *   node scripts/wikidata-mass-merge.mjs --out <file>
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikidata");
const DERIVED_DIR = path.join(ROOT, "data/derived");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
const DEFAULT_OUT = path.join(DERIVED_DIR, "wikidata-augment.json");
const LICENSE = "CC0 — Wikidata, https://www.wikidata.org";

function parseArgs(argv) {
  const args = { in: null, out: null, allRaw: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    // --all-raw merges every JSON file in data/raw/wikidata. Used when
    // we ran the fetcher multiple times (low-first + high-first batches).
    else if (argv[i] === "--all-raw") args.allRaw = true;
  }
  return args;
}

async function findLatestRaw() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

// ─────────────────────────── categorization ─────────────────────────────
// Map an `award_received` or `member_of` label to a TruNorth category
// where this property might surface as a narrative. We're deliberately
// conservative — only well-known certifications/awards.
//
// Returns "environment" | "labor" | "dei" | "charity" | "governance" | null
const POSITIVE_AWARD_KEYWORDS = [
  // env
  { rx: /b\s*corp|b corporation|certified b/i,                cat: "environment", text: "Certified B Corp" },
  { rx: /fair\s*trade|fairtrade certified/i,                 cat: "labor",       text: "Fair Trade certified" },
  { rx: /rainforest\s*alliance/i,                            cat: "environment", text: "Rainforest Alliance certified" },
  { rx: /forest stewardship council|FSC certif/i,            cat: "environment", text: "FSC certified" },
  { rx: /leed (platinum|gold|silver|certif)/i,               cat: "environment", text: "LEED-certified facility" },
  { rx: /stockholm.{0,5}water (award|prize)/i,               cat: "environment", text: "Stockholm Industry Water Award" },
  { rx: /ethical company|ethics index|world.{0,10}ethical/i, cat: "governance",  text: "Ethical company recognition" },
  { rx: /global compact|UN.{0,5}Global Compact/i,            cat: "governance",  text: "UN Global Compact signatory" },
  // dei / labor
  { rx: /human rights campaign|HRC.{0,5}corporate|equality index/i, cat: "dei",  text: "HRC Corporate Equality Index" },
  { rx: /great place to work/i,                              cat: "labor",       text: "Great Place to Work" },
  { rx: /fortune.{0,5}best.{0,15}companies/i,                cat: "labor",       text: "Fortune Best Companies to Work For" },
];

// "Awards" that are actually anti-awards — receiving one is a negative
// signal. Public Eye Awards (Switzerland) are the world's most-cited
// corporate-irresponsibility "prize"; Big Brother Awards flag privacy
// violators. We map both to a synthetic negative event.
const NEGATIVE_AWARD_KEYWORDS = [
  { rx: /public eye.{0,20}(tax|labour|labor|environment|jury|people).{0,5}award/i,
    cat: "governance", text: "Public Eye award (worst corporate irresponsibility)" },
  { rx: /public eye (award|nomin)/i, cat: "governance", text: "Public Eye award" },
  { rx: /big brother award|bigbrotherawards/i, cat: "privacy",
    text: "Big Brother Award (privacy violation)" },
  { rx: /doublespeak award/i, cat: "governance", text: "Doublespeak Award" },
  { rx: /roger award/i,       cat: "governance", text: "Roger Award (worst transnational)" },
];

// Wikidata significant_event labels we treat as negatives.
const NEGATIVE_EVENT_KEYWORDS = [
  { rx: /data breach|cyberattack|hack(ing)?|leak/i,            cat: "privacy",     verb: "experienced data breach" },
  { rx: /privacy/i,                                            cat: "privacy",     verb: "faced privacy issue" },
  { rx: /scandal/i,                                            cat: "governance",  verb: "involved in scandal" },
  { rx: /lawsuit|class action|antitrust|sue|sued/i,            cat: "governance",  verb: "subject of lawsuit" },
  { rx: /recall|recalled product/i,                            cat: "governance",  verb: "issued product recall" },
  { rx: /oil spill|pollution|pollut(ed|ion)/i,                 cat: "environment", verb: "linked to pollution incident" },
  { rx: /strike|labor dispute|walkout|unionization/i,          cat: "labor",       verb: "experienced labor dispute" },
  { rx: /fine|settlement|penalty|conviction|fraud/i,           cat: "governance",  verb: "faced penalty / fraud finding" },
  { rx: /boycott/i,                                            cat: "governance",  verb: "subject of boycott" },
  { rx: /child labor|forced labor|modern slavery|sweatshop/i,  cat: "labor",       verb: "linked to forced/child labor" },
  { rx: /deforest/i,                                           cat: "environment", verb: "linked to deforestation" },
];

// Negative coalition memberships — appearing on this list shouldn't drag
// a brand down on its own (we treat all as neutral / informational).
// Positive coalitions surface in award_received above.
const COALITION_KEYWORDS = [
  { rx: /roundtable on sustainable palm oil|RSPO/i,        cat: "environment", text: "RSPO member" },
  { rx: /better cotton initiative|BCI/i,                   cat: "environment", text: "Better Cotton Initiative member" },
  { rx: /global compact/i,                                 cat: "governance",  text: "UN Global Compact signatory" },
  { rx: /fair labor association/i,                         cat: "labor",       text: "Fair Labor Association member" },
  { rx: /sustainable apparel coalition/i,                  cat: "environment", text: "Sustainable Apparel Coalition member" },
  { rx: /ethical trading initiative/i,                     cat: "labor",       text: "Ethical Trading Initiative member" },
  { rx: /c40 cities/i,                                     cat: "environment", text: "C40 Cities Climate Leadership Group" },
  { rx: /science.based targets|SBTi/i,                     cat: "environment", text: "Science Based Targets initiative" },
];

// ─────────────────────────── core merge ────────────────────────────────
export function buildAugment(raw, slugSet) {
  const { resolved = [], claims = [] } = raw;
  // index resolved → slug
  const qidToSlug = new Map();
  const qidMeta = new Map();
  for (const r of resolved) {
    if (!slugSet.has(r.slug)) continue;
    qidToSlug.set(r.qid, r.slug);
    qidMeta.set(r.qid, { title: r.title, name: r.name });
  }

  // accumulator
  const companies = {};
  function ensure(slug, qid) {
    if (!companies[slug]) {
      const meta = qidMeta.get(qid) || {};
      companies[slug] = {
        qid,
        title: meta.title || null,
        significant_events: [],
        owned_by: null,
        part_of: [],
        owner_of: [],
        member_of: [],
        award_received: [],
        headquarters: [],
        named_after: null,
        twitter_handle: null,
        narratives: {},
        sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
      };
    }
    return companies[slug];
  }

  for (const c of claims) {
    const slug = qidToSlug.get(c.qid);
    if (!slug) continue;
    const co = ensure(slug, c.qid);
    const lbl = c.valueLabel || c.value;
    switch (c.prop) {
      case "P793":
        co.significant_events.push({ qid: c.value, label: lbl });
        break;
      case "P127":
        if (!co.owned_by) co.owned_by = { qid: c.value, label: lbl };
        break;
      case "P361":
        co.part_of.push({ qid: c.value, label: lbl });
        break;
      case "P1830":
        co.owner_of.push({ qid: c.value, label: lbl });
        break;
      case "P463":
        co.member_of.push({ qid: c.value, label: lbl });
        break;
      case "P166":
        co.award_received.push({ qid: c.value, label: lbl });
        break;
      case "P159":
        co.headquarters.push({ qid: c.value, label: lbl });
        break;
      case "P3938":
        if (!co.named_after) co.named_after = { qid: c.value, label: lbl };
        break;
      case "P2002":
        if (!co.twitter_handle) co.twitter_handle = c.value;
        break;
    }
  }

  // Build conservative per-category narratives.
  // Hard rule from the prompt: don't mark "negative" purely from a single
  // Wikidata claim. Wikidata events frequently lack severity. We DO
  // surface them as informational narratives but tag severity "mixed"
  // unless there are 2+ negative claims in the same category.
  for (const [slug, co] of Object.entries(companies)) {
    // award_received → positives AND anti-awards (negative).
    const positiveAwards = [];
    const negativeAwards = [];
    for (const a of co.award_received) {
      const pos = POSITIVE_AWARD_KEYWORDS.find(k => k.rx.test(a.label || ""));
      if (pos) positiveAwards.push({ ...pos, label: a.label });
      const neg = NEGATIVE_AWARD_KEYWORDS.find(k => k.rx.test(a.label || ""));
      if (neg) negativeAwards.push({ ...neg, label: a.label });
    }
    // member_of → coalition signals (informational).
    const coalitions = [];
    for (const m of co.member_of) {
      const hit = COALITION_KEYWORDS.find(k => k.rx.test(m.label || ""));
      if (hit) coalitions.push({ ...hit, label: m.label });
    }
    // significant_event → negatives.
    const negativeEvents = [];
    for (const ev of co.significant_events) {
      const m = NEGATIVE_EVENT_KEYWORDS.find(k => k.rx.test(ev.label || ""));
      if (m) negativeEvents.push({ ...m, label: ev.label });
    }

    // Bucket by category. Each category produces at most one narrative
    // string with up to 3 examples cited.
    const bucketed = {};
    function push(cat, kind, text, label) {
      (bucketed[cat] ||= { pos: [], neg: [], info: [] })[kind].push({ text, label });
    }
    for (const a of positiveAwards) push(a.cat, "pos", a.text, a.label);
    for (const c of coalitions)     push(c.cat, "info", c.text, c.label);
    for (const e of negativeEvents) push(e.cat, "neg", e.verb, e.label);
    for (const a of negativeAwards) push(a.cat, "neg", a.text, a.label);

    // Optional governance narrative if we know parent / HQ but no other
    // category fired. This is *informational only* — sc:"neutral" — and is
    // what makes the Wikidata pass valuable for the 50%+ of brands where
    // we don't have a parent map entry. Skip when a stronger category
    // narrative already covers governance.
    if (!bucketed.governance && (co.owned_by || co.part_of.length)) {
      const ownerStr = co.owned_by ? co.owned_by.label : (co.part_of[0]?.label || null);
      const hqStr = co.headquarters[0]?.label || null;
      const parts = [];
      if (ownerStr) parts.push(`owned by ${ownerStr}`);
      if (hqStr) parts.push(`HQ ${hqStr}`);
      if (parts.length) push("governance", "info", parts.join("; "), null);
    }

    const narratives = {};
    for (const [cat, b] of Object.entries(bucketed)) {
      const parts = [];
      if (b.pos.length) {
        const items = b.pos.slice(0, 3).map(p => p.label).join("; ");
        parts.push(`Wikidata: ${items}`);
      }
      if (b.neg.length) {
        // Only mark as a real negative if 2+ events in this category.
        const items = b.neg.slice(0, 3).map(p => `${p.text} — ${clip(p.label, 80)}`).join("; ");
        if (b.neg.length >= 2) {
          parts.push(`Wikidata significant events: ${items}.`);
        } else {
          parts.push(`Wikidata records a notable event: ${clip(b.neg[0].label, 100)}.`);
        }
      }
      if (b.info.length && !parts.length) {
        const items = b.info.slice(0, 3).map(p => p.text).join("; ");
        parts.push(`Wikidata: ${items}.`);
      }
      // Default severity rule:
      //   - any positive in category → "positive"
      //   - 2+ negatives → "negative"  (single negative → "mixed")
      //   - else null severity (informational only)
      let sc = "mixed";
      if (b.pos.length) sc = "positive";
      else if (b.neg.length >= 2) sc = "negative";
      else if (b.neg.length === 1) sc = "mixed";
      else if (b.info.length) sc = "neutral";
      if (parts.length) {
        narratives[cat] = { text: parts.join(" "), sc };
      }
    }
    co.narratives = narratives;
  }

  return companies;
}

function clip(s, n) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

// ─────────────────────────── runner ────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  let raw;
  let inDesc;
  if (args.allRaw) {
    // Concat every json in RAW_DIR. Dedup claims by (qid, prop, value).
    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));
    if (!files.length) {
      console.error("No raw files in", RAW_DIR);
      process.exit(2);
    }
    const merged = { resolved: [], claims: [], resolved_count: 0, claim_count: 0 };
    const seenQids = new Set();
    const seenClaims = new Set();
    for (const f of files) {
      const r = JSON.parse(await fs.readFile(path.join(RAW_DIR, f), "utf-8"));
      for (const x of (r.resolved || [])) {
        if (seenQids.has(x.slug)) continue;
        seenQids.add(x.slug); merged.resolved.push(x);
      }
      for (const c of (r.claims || [])) {
        const k = `${c.qid}|${c.prop}|${c.value}`;
        if (seenClaims.has(k)) continue;
        seenClaims.add(k); merged.claims.push(c);
      }
    }
    merged.resolved_count = merged.resolved.length;
    merged.claim_count = merged.claims.length;
    raw = merged;
    inDesc = `${files.length} files (${RAW_DIR})`;
  } else {
    const inFile = args.in || (await findLatestRaw());
    if (!inFile || !existsSync(inFile)) {
      console.error("No raw wikidata file. Run wikidata-mass-fetch.mjs first, or pass --in / --all-raw.");
      process.exit(2);
    }
    raw = JSON.parse(await fs.readFile(inFile, "utf-8"));
    inDesc = inFile;
  }
  console.log(`Wikidata merge starting — input: ${inDesc}`);
  console.log(`  raw: ${raw.resolved_count || 0} resolved, ${raw.claim_count || 0} claims`);

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const slugSet = new Set(index.map(c => c.slug));

  const companies = buildAugment(raw, slugSet);
  const matchedCompanies = Object.keys(companies).length;
  const totalNarratives = Object.values(companies).reduce((s, c) => s + Object.keys(c.narratives).length, 0);

  const byCategory = {};
  for (const c of Object.values(companies)) {
    for (const cat of Object.keys(c.narratives)) byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  const outFile = args.out || DEFAULT_OUT;
  await fs.mkdir(DERIVED_DIR, { recursive: true });
  const bundle = {
    _license: LICENSE,
    _source: "https://www.wikidata.org",
    _generated_at: new Date().toISOString(),
    _source_file: inDesc.startsWith(RAW_DIR) || inDesc.includes(" files (") ? inDesc : path.relative(ROOT, inDesc),
    _stats: {
      raw_resolved: raw.resolved_count || 0,
      raw_claims:   raw.claim_count || 0,
      matched_companies: matchedCompanies,
      narratives_total:  totalNarratives,
      by_category:       byCategory,
    },
    companies,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nMatched companies:    ${matchedCompanies}`);
  console.log(`Narratives produced:  ${totalNarratives}`);
  console.log(`By category:          ${JSON.stringify(byCategory)}`);
  console.log(`Wrote ${outFile}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("wikidata-mass-merge failed:", e); process.exit(1); });
}

export { buildAugment as _buildAugment };
