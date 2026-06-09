#!/usr/bin/env node
/**
 * Wikipedia controversies-section scraper.
 *
 * For each TruNorth brand, fetch its English Wikipedia page and pull the
 * editorial sections that map to TruNorth's category dimensions:
 *
 *   - Controversies / Criticism / Lawsuits / Legal issues   → governance
 *   - Environmental impact / Sustainability                 → environment
 *   - Labor practices / Working conditions / Union          → labor
 *   - Privacy concerns / Data breaches                      → privacy
 *   - Animal welfare                                        → animals
 *   - Health and safety / Product safety                    → health
 *   - Political donations / Lobbying                        → political
 *   - Philanthropy / Charitable giving                      → charity
 *   - Diversity and inclusion                               → dei
 *
 * We also pull the page's category list — flags like
 * `Category:Companies_accused_of_X` / `Category:Certified_B_Corporations`
 * are fast bulk binary signals.
 *
 * Pipeline:
 *   1. Read public/data/index.json + the cached title→QID map from the
 *      wikidata fetcher (when present) for free page-title resolution.
 *      For brands missing from that map, fall back to a direct title
 *      probe (same way wikidata-mass-fetch resolves).
 *   2. For each brand → page, fetch:
 *        a. The TOC (`parse?prop=sections`) — to discover section indices.
 *        b. Per matching section, the wikitext (`parse?section=N`).
 *        c. Categories (`query?prop=categories`).
 *   3. Persist raw responses under .cache/wikipedia/ + emit a flat bundle
 *      at data/raw/wikipedia/<YYYY-MM-DD>.json.
 *
 * Hard rules honored:
 *   - Don't follow redirects beyond 1 hop (MW redirects=1 does exactly that)
 *   - Don't scrape user-talk pages — we only ever hit the main namespace
 *   - Cap section text at 800 chars in raw / 200 chars in narrative output
 *
 * Rate limit: 500ms between requests (2 req/sec) with the TruNorth UA.
 *
 * CLI:
 *   node scripts/wikipedia-controversies-fetch.mjs --limit 100
 *   node scripts/wikipedia-controversies-fetch.mjs --dry
 *   node scripts/wikipedia-controversies-fetch.mjs --cache
 *   node scripts/wikipedia-controversies-fetch.mjs --apply
 *
 * License: Wikipedia text is CC BY-SA — every record carries the section URL.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/wikipedia");
const CACHE_DIR = path.join(ROOT, ".cache/wikipedia");
const FIXTURE = path.join(ROOT, "scripts/fixtures/wikipedia/sample.json");
const INDEX_FILE = path.join(ROOT, "public/data/index.json");
// We piggyback on the wikidata fetcher's resolved title list when it's
// available, which means most pages are pre-resolved for free.
const WIKIDATA_RAW_DIR = path.join(ROOT, "data/raw/wikidata");

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const UA = "TruNorth-Wikipedia/1.0 (https://www.trunorthapp.com; aron@trunorthapp.com)";
const RATE_MS = 250;            // 4 req/sec — within WMF guidance for a
                                // polite UA on a one-off enrichment pass.
const MAX_SECTION_CHARS = 800;  // store first 800 chars per section
export const LICENSE = "CC BY-SA 4.0 — Wikipedia, https://en.wikipedia.org";

// Section headings → TruNorth category. Headings are matched
// case-insensitively against the section line.
export const SECTION_PATTERNS = [
  { rx: /^controvers(y|ies)$/i,                            cat: "governance"  },
  { rx: /^criticism$/i,                                    cat: "governance"  },
  { rx: /^lawsuits?$/i,                                    cat: "governance"  },
  { rx: /^legal (issues?|proceedings|matters)$/i,          cat: "governance"  },
  { rx: /^litigation$/i,                                   cat: "governance"  },
  { rx: /^scandals?$/i,                                    cat: "governance"  },
  { rx: /^antitrust$/i,                                    cat: "governance"  },
  { rx: /^environment(al)?( impact| record| issues?)?$/i,  cat: "environment" },
  { rx: /^sustainability$/i,                               cat: "environment" },
  { rx: /^carbon emissions?$/i,                            cat: "environment" },
  { rx: /^pollution$/i,                                    cat: "environment" },
  { rx: /^climate( change)?$/i,                            cat: "environment" },
  { rx: /^deforestation$/i,                                cat: "environment" },
  { rx: /^labor( practices| relations| issues?)?$/i,       cat: "labor"       },
  { rx: /^labour( practices| relations| issues?)?$/i,      cat: "labor"       },
  { rx: /^working conditions$/i,                           cat: "labor"       },
  { rx: /^employment practices$/i,                         cat: "labor"       },
  { rx: /^unioni[sz]ation$/i,                              cat: "labor"       },
  { rx: /^worker rights?$/i,                               cat: "labor"       },
  { rx: /^supply chain$/i,                                 cat: "labor"       },
  { rx: /^privacy( concerns?| issues?)?$/i,                cat: "privacy"     },
  { rx: /^data breach(es)?$/i,                             cat: "privacy"     },
  { rx: /^surveillance$/i,                                 cat: "privacy"     },
  { rx: /^animal welfare$/i,                               cat: "animals"     },
  { rx: /^animal testing$/i,                               cat: "animals"     },
  { rx: /^animal( rights)?$/i,                             cat: "animals"     },
  { rx: /^(product )?safety( concerns?)?$/i,               cat: "health"      },
  { rx: /^health (and|&) safety$/i,                        cat: "health"      },
  { rx: /^recalls?$/i,                                     cat: "health"      },
  { rx: /^political (donations?|contributions?|activity)$/i, cat: "political" },
  { rx: /^lobbying$/i,                                     cat: "political"   },
  { rx: /^philanthropy$/i,                                 cat: "charity"     },
  { rx: /^charitable (giving|activities|contributions?)$/i,cat: "charity"     },
  { rx: /^diversity( and inclusion)?$/i,                   cat: "dei"         },
  { rx: /^discrimination$/i,                               cat: "dei"         },
];

// Wikipedia category-name patterns we treat as fast binary signals.
// Hits are sourced once per page from the page's `categories` list.
export const CATEGORY_PATTERNS = [
  { rx: /B Lab.?certified corporations|Certified B Corporations/i, signal: "bcorp",                    cat: "environment", positive: true  },
  { rx: /Companies accused of/i,                                   signal: "accused",                  cat: "governance",  positive: false },
  { rx: /Companies disestablished due to fraud|Corporate scandals/i, signal: "fraud_scandal",          cat: "governance",  positive: false },
  { rx: /Companies involved in price.?fixing/i,                    signal: "price_fixing",             cat: "governance",  positive: false },
  { rx: /Companies fined for|Companies that have filed for bankruptcy/i, signal: "fined_bankrupt",     cat: "governance",  positive: false },
  { rx: /Animal welfare/i,                                         signal: "animal_welfare_topic",     cat: "animals",     positive: false },
  { rx: /Privacy controvers|Internet privacy/i,                    signal: "privacy_controversy",      cat: "privacy",     positive: false },
  { rx: /Worker.?owned|Cooperative federation|Employee.?owned/i,   signal: "worker_owned",             cat: "labor",       positive: true  },
];

// ─────────────────────────── CLI ────────────────────────────────────────
export function parseArgs(argv) {
  const args = { limit: null, out: null, cache: false, dry: false, apply: false, skip: 0, sort: "low-first" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") args.limit = Math.max(1, Number(argv[++i]) || 100);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--cache") args.cache = true;
    else if (a === "--dry") args.dry = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--skip") args.skip = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--sort") args.sort = argv[++i];
  }
  return args;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function cachedFetchJson(url, cacheName, useCache) {
  const cf = path.join(CACHE_DIR, cacheName);
  if (useCache && existsSync(cf)) {
    return JSON.parse(await fs.readFile(cf, "utf-8"));
  }
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const payload = await res.json();
  if (useCache) {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cf, JSON.stringify(payload));
  }
  return payload;
}

// ─────────────────────────── section discovery ──────────────────────────
// Fetch the TOC for `title` and return the subset of sections whose
// heading matches our patterns.
export function classifySection(line) {
  if (!line) return null;
  const norm = String(line).replace(/\s+/g, " ").trim();
  for (const p of SECTION_PATTERNS) {
    if (p.rx.test(norm)) return p.cat;
  }
  return null;
}

export async function fetchSectionList(title, { cache } = {}) {
  const u = new URL(WIKIPEDIA_API);
  u.searchParams.set("action", "parse");
  u.searchParams.set("page", title);
  u.searchParams.set("prop", "sections");
  u.searchParams.set("format", "json");
  u.searchParams.set("redirects", "1");
  const key = `sec_${hashStr(title)}.json`;
  let payload;
  try {
    payload = await cachedFetchJson(u.toString(), key, cache);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return [];
    throw e;
  }
  if (payload.error) return [];
  const sections = payload.parse?.sections || [];
  return sections
    .map(s => ({ index: s.index, line: s.line, anchor: s.anchor, level: Number(s.toclevel) || 0 }))
    .filter(s => classifySection(s.line) != null)
    .map(s => ({ ...s, category: classifySection(s.line) }));
}

// Fetch wikitext for one section index. Returns { wikitext, refCount, externalLinks }.
export async function fetchSectionText(title, sectionIndex, { cache } = {}) {
  const u = new URL(WIKIPEDIA_API);
  u.searchParams.set("action", "parse");
  u.searchParams.set("page", title);
  u.searchParams.set("section", String(sectionIndex));
  u.searchParams.set("prop", "wikitext|externallinks");
  u.searchParams.set("format", "json");
  u.searchParams.set("redirects", "1");
  const key = `wt_${hashStr(title)}_${sectionIndex}.json`;
  let payload;
  try {
    payload = await cachedFetchJson(u.toString(), key, cache);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return null;
    throw e;
  }
  const wt = payload.parse?.wikitext?.["*"] || "";
  const refCount = (wt.match(/<ref[\s>]/gi) || []).length;
  const externalLinks = payload.parse?.externallinks || [];
  return { wikitext: wt, refCount, externalLinks };
}

// Fetch page categories.
export async function fetchPageCategories(title, { cache } = {}) {
  const u = new URL(WIKIPEDIA_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("titles", title);
  u.searchParams.set("prop", "categories");
  u.searchParams.set("cllimit", "max");
  u.searchParams.set("redirects", "1");
  u.searchParams.set("formatversion", "2");
  const key = `cat_${hashStr(title)}.json`;
  let payload;
  try {
    payload = await cachedFetchJson(u.toString(), key, cache);
  } catch (e) {
    if (/HTTP 404/.test(e.message)) return [];
    throw e;
  }
  const pages = payload.query?.pages || [];
  if (!pages.length || pages[0].missing) return [];
  return (pages[0].categories || []).map(c => c.title);
}

// Convert wikitext → plain-ish text. We strip:
//   - References  <ref ...>...</ref>  and  {{Cite ...}}
//   - File links   [[File:...]]
//   - Templates    {{...}}  (matched non-greedily; nested left for later)
//   - Comments     <!-- ... -->
//   - HTML tags    <br />, <small>, etc.
// Then collapse whitespace + strip links to display text.
export function stripWikitext(wt) {
  if (!wt) return "";
  let s = String(wt);
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<ref[^>]*\/>/gi, "");
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Strip nested templates iteratively until none remain.
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\{\{[^{}]*?\}\}/g, "");
    if (next === s) break;
    s = next;
  }
  // File:/Image: links can nest other [[ links inside (captions). Strip
  // them iteratively too so the caption text doesn't leak.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\[\[(?:File|Image):[^\[\]]*(?:\[\[[^\[\]]*\]\][^\[\]]*)*\]\]/gi, "");
    if (next === s) break;
    s = next;
  }
  // Wiki-internal links → display text:  [[Foo|Bar]] → Bar,  [[Foo]] → Foo
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // External  [https://… text]  → text
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1");
  s = s.replace(/\[https?:\/\/\S+\]/g, "");
  // HTML tags
  s = s.replace(/<\/?[a-z][^>]*>/gi, "");
  // Top-level + nested headings (==…==, ===…===, etc.). Drop the heading
  // text rather than try to preserve it — it just clutters narrative.
  s = s.replace(/={2,}\s*[^=]+\s*={2,}/g, "");
  // Stray leftover bracket / pipe artifacts from imperfect template strips
  s = s.replace(/[\[\]]+/g, " ");
  // Bold/italic
  s = s.replace(/'{2,5}/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ─────────────────────────── title resolution ───────────────────────────
// Pull resolved titles from every wikidata raw bundle on disk (cheap).
// We merge so that running the fetcher after multiple low/high-first
// wikidata batches gives Wikipedia full coverage.
async function loadWikidataResolved() {
  if (!existsSync(WIKIDATA_RAW_DIR)) return new Map();
  const files = (await fs.readdir(WIKIDATA_RAW_DIR))
    .filter(f => f.endsWith(".json"))
    .sort();
  const m = new Map();
  for (const f of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(WIKIDATA_RAW_DIR, f), "utf-8"));
      for (const r of raw.resolved || []) {
        if (!m.has(r.slug)) m.set(r.slug, r.title);
      }
    } catch { /* skip */ }
  }
  return m;
}

// Same fallback as wikidata-mass-fetch.brandCandidates — match the title
// against the brand name directly (1 redirect hop).
async function resolveTitle(name, { cache }) {
  const candidates = [name, `${name} (company)`];
  const u = new URL(WIKIPEDIA_API);
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("titles", candidates.join("|"));
  u.searchParams.set("redirects", "1");
  u.searchParams.set("ppprop", "wikibase_item|disambiguation");
  u.searchParams.set("prop", "pageprops");
  u.searchParams.set("formatversion", "2");
  const key = `wp_resolve_${hashStr(candidates.join("|"))}.json`;
  let payload;
  try {
    payload = await cachedFetchJson(u.toString(), key, cache);
  } catch { return null; }
  for (const page of (payload.query?.pages || [])) {
    if (page.missing) continue;
    if (page.pageprops?.disambiguation != null) continue;
    return page.title;
  }
  return null;
}

// ─────────────────────────── dry-run replay ─────────────────────────────
export async function replayFixture(fixturePath = FIXTURE) {
  return JSON.parse(await fs.readFile(fixturePath, "utf-8"));
}

// ─────────────────────────── runner ─────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const outFile = args.out || path.join(RAW_DIR, `${today}.json`);
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  console.log(`Wikipedia controversies fetcher starting...   (mode=${args.dry ? "DRY" : "LIVE"})`);
  console.log(`License: ${LICENSE}`);

  if (args.dry) {
    const bundle = await replayFixture();
    await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
    console.log(`[dry] wrote ${outFile} with ${(bundle.pages || []).length} fixture pages`);
    return;
  }

  const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf-8"));
  const sorted = [...index].sort((a, b) =>
    args.sort === "high-first"
      ? (b.realCats || 0) - (a.realCats || 0)
      : (a.realCats || 0) - (b.realCats || 0)
  );
  const offset = args.skip;
  const cap = args.apply ? sorted.length : (args.limit ?? 100);
  const brands = sorted.slice(offset, offset + cap);

  // Free pre-resolution from the wikidata fetcher's output.
  const wdTitles = await loadWikidataResolved();
  console.log(`Pre-resolved ${wdTitles.size} titles from wikidata raw output`);

  const pages = [];
  let processed = 0;
  let resolved = 0;
  let withSections = 0;

  for (const b of brands) {
    processed++;
    let title = wdTitles.get(b.slug);
    if (!title) {
      title = await resolveTitle(b.name, { cache: args.cache });
      await sleep(RATE_MS);
      if (!title) continue;
    }
    resolved++;

    let sections = [];
    try {
      sections = await fetchSectionList(title, { cache: args.cache });
    } catch (e) {
      // continue — page existed but TOC failed
    }
    await sleep(RATE_MS);
    if (!sections.length) continue;

    const sectionTexts = [];
    for (const s of sections) {
      try {
        const t = await fetchSectionText(title, s.index, { cache: args.cache });
        if (t) {
          const text = stripWikitext(t.wikitext).slice(0, MAX_SECTION_CHARS);
          sectionTexts.push({
            heading: s.line,
            category: s.category,
            anchor: s.anchor,
            text,
            ref_count: t.refCount,
            external_link_count: (t.externalLinks || []).length,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}#${s.anchor}`,
          });
        }
      } catch (e) {
        // skip
      }
      await sleep(RATE_MS);
    }

    let categories = [];
    try {
      categories = await fetchPageCategories(title, { cache: args.cache });
    } catch {}
    await sleep(RATE_MS);

    // Filter to only signal-bearing categories
    const matchedCats = [];
    for (const c of categories) {
      const hit = CATEGORY_PATTERNS.find(p => p.rx.test(c));
      if (hit) matchedCats.push({ category_title: c, signal: hit.signal, cat: hit.cat, positive: hit.positive });
    }

    if (sectionTexts.length || matchedCats.length) withSections++;
    pages.push({
      slug: b.slug,
      name: b.name,
      title,
      page_url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      sections: sectionTexts,
      categories: matchedCats,
    });

    if (processed % 100 === 0 || processed === brands.length) {
      console.log(`  ${processed}/${brands.length}  resolved=${resolved}  hits=${withSections}  pages_emitted=${pages.length}`);
    }
  }

  const bundle = {
    _license: LICENSE,
    _source: "https://en.wikipedia.org",
    _generated_at: new Date().toISOString(),
    _stats: {
      brands_probed:    brands.length,
      pages_resolved:   resolved,
      pages_with_hits:  withSections,
      pages_emitted:    pages.length,
    },
    pages,
  };
  await fs.writeFile(outFile, JSON.stringify(bundle, null, 2));
  console.log(`\nWrote ${outFile}  (${pages.length} pages, ${withSections} with hits)`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(e => { console.error("wikipedia-controversies-fetch failed:", e); process.exit(1); });
}
