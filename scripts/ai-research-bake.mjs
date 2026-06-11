#!/usr/bin/env node
/**
 * Lever 3 / E-7 — web-search-grounded AI research bake (2026-06-11).
 *
 * The Phase-4.11 bake synthesized narratives WITHOUT web search — it could
 * only summarize what the pipeline already had. This bake researches brands
 * with the Claude API + server-side web search and fills empty categories
 * with CITED facts only:
 *
 *   - A category is written ONLY when the model returns at least one http(s)
 *     citation URL for it. Uncited claims are discarded (consistent with the
 *     neutrality rule: no public record → no score).
 *   - Existing real data is NEVER overwritten — we only fill cells whose
 *     narrative is "No public record found."
 *   - Researched cats: environment, labor, charity, dei, animals, privacy.
 *     (political/execPay/guns stay with their structured sources: FEC, SEC,
 *     ATF.)
 *
 * Targets, in priority order: public/data/trending.json brands (PostHog
 * demand) → TOP_PICKS_CURATED (parsed from App.jsx) → brands with 1-3 real
 * cats (some signal, incomplete card). --slugs=a,b,c overrides.
 *
 * Cost control: --max=N brands per run (default 25). State cursor at
 * data/raw/ai-research/state.json makes runs resumable; a brand is retried
 * only after 180 days. Run on GitHub Actions (ai-research-bake.yml) where
 * ANTHROPIC_API_KEY lives; ~$0.10-0.25/brand with web search.
 *
 * Model: claude-opus-4-8 (repo convention for non-news LLM calls).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const COMPS = path.join(ROOT, "public/data/companies");
const STATE_DIR = path.join(ROOT, "data/raw/ai-research");
const STATE = path.join(STATE_DIR, "state.json");
const MODEL = "claude-opus-4-8";
const NO_REC_RE = /^\s*no public record found\.?\s*$/i;
const RESEARCH_CATS = ["environment", "labor", "charity", "dei", "animals", "privacy"];

const MAX = Number((process.argv.find(a => a.startsWith("--max=")) || "").split("=")[1]) || 25;
const SLUG_OVERRIDE = (process.argv.find(a => a.startsWith("--slugs=")) || "").split("=")[1];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("❌ ANTHROPIC_API_KEY not set"); process.exit(1); }

// Enum vocabularies the scoring engine understands, per category.
const ENUMS = {
  environment: ["good", "mixed", "poor"],
  labor: ["good", "mixed", "poor", "very poor"],
  charity: ["positive", "mixed", "negative"],
  dei: ["pro_dei", "mixed", "anti_dei"],
  animals: ["cruelty_free", "some_testing", "tests_animals", "na"],
  privacy: ["good", "mixed", "poor"],
};

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { done: {} }; }
}

function pickTargets(state) {
  if (SLUG_OVERRIDE) return SLUG_OVERRIDE.split(",").map(s => s.trim()).filter(Boolean);
  const targets = [];
  const seen = new Set();
  const push = (slug) => { if (slug && !seen.has(slug)) { seen.add(slug); targets.push(slug); } };

  try {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/trending.json"), "utf8"));
    for (const b of t.brands || []) push(b.slug || b);
  } catch {}
  try {
    const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
    const m = app.match(/TOP_PICKS_CURATED\s*=\s*\[([\s\S]*?)\]/);
    if (m) for (const sm of m[1].matchAll(/["']([a-z0-9-]+)["']/g)) push(sm[1]);
  } catch {}
  // Low-coverage brands with SOME signal (1-3 cats) — most likely to be real
  // consumer brands worth completing. Sorted by name for determinism.
  const files = fs.readdirSync(COMPS).filter(f => f.endsWith(".json")).sort();
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(COMPS, f), "utf8"));
      const rc = d.realCats ?? 0;
      if (rc >= 1 && rc <= 3) push(f.replace(/\.json$/, ""));
    } catch {}
  }
  // Skip already-researched (180-day refresh)
  const cutoff = Date.now() - 180 * 24 * 3600 * 1000;
  return targets.filter(s => !(state.done[s] && Date.parse(state.done[s]) > cutoff));
}

const TOOL_HINT = `You are a corporate-records researcher for TruNorth, a consumer app that grades brands ONLY on verifiable public records. Research the company below with web search and report findings per category. RULES:
- Every claim MUST have a citation URL from a credible source (regulator, court record, certifier, major news org, the company's own published reports). No citation → report found=false for that category.
- Report FACTS, not opinions: violations with penalty dollars, certifications by name, documented programs, public statements. Neutral tone.
- If searches surface nothing solid for a category, found=false. Never guess. Absence of evidence is a fine answer.
- summary: 1-2 sentences, factual, includes specifics ($ amounts, years, cert names). It will be shown to consumers verbatim with your citation.
Respond with ONLY a JSON object, no prose around it:
{"categories": {"<cat>": {"found": true|false, "verdict": "<enum>", "summary": "...", "citations": [{"url": "https://...", "title": "..."}]}}}
Valid verdict enums per category: ${JSON.stringify(ENUMS)}`;

async function researchBrand(d, cats) {
  const userPrompt = `Company: ${d.name}${d.legalName ? ` (legal name: ${d.legalName})` : ""}
Industry: ${d.cat || "unknown"}${d.ticker ? ` · NYSE/Nasdaq ticker: ${d.ticker}` : " · privately held"}
Research THESE categories only: ${cats.join(", ")}
Today: ${new Date().toISOString().slice(0, 10)}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: TOOL_HINT,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      messages: [{ role: "user", content: userPrompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in response");
  return { parsed: JSON.parse(m[0]), usage: data.usage };
}

function isHttpUrl(u) { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; } }

// ─── main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(STATE_DIR, { recursive: true });
const state = loadState();
const targets = pickTargets(state).slice(0, MAX);
console.log(`[ai-bake] researching ${targets.length} brands (max ${MAX}, model ${MODEL})`);

let filled = 0, brandsTouched = 0, inTok = 0, outTok = 0;
for (const slug of targets) {
  const fp = path.join(COMPS, `${slug}.json`);
  let d;
  try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }

  const emptyCats = RESEARCH_CATS.filter(k => {
    const narr = String(d[k]?.s || "");
    const flagNa = d.flags?.[k]?.na === true;
    return !flagNa && (!narr || NO_REC_RE.test(narr));
  });
  if (!emptyCats.length) { state.done[slug] = new Date().toISOString(); continue; }

  try {
    const { parsed, usage } = await researchBrand(d, emptyCats);
    inTok += usage?.input_tokens || 0; outTok += usage?.output_tokens || 0;
    let wrote = false;
    for (const k of emptyCats) {
      const r = parsed.categories?.[k];
      if (!r || r.found !== true) continue;
      const cites = (r.citations || []).filter(c => isHttpUrl(c?.url));
      if (!cites.length) continue;                       // uncited → discarded
      if (!ENUMS[k].includes(r.verdict)) continue;       // unknown enum → discarded
      if (!r.summary || r.summary.length < 20) continue;
      d.sc = d.sc || {};
      d.sc[k] = r.verdict;
      d[k] = d[k] || {};
      d[k].s = r.summary.trim();
      d[k].sources = Array.from(new Set([...(d[k].sources || []), "ai-web-research"]));
      d[k].citations = cites.slice(0, 3).map(c => ({ url: c.url, title: String(c.title || "").slice(0, 120) }));
      filled++; wrote = true;
    }
    if (wrote) { fs.writeFileSync(fp, JSON.stringify(d, null, 2)); brandsTouched++; }
    state.done[slug] = new Date().toISOString();
    fs.writeFileSync(STATE, JSON.stringify(state));
    console.log(`[ai-bake] ${slug}: ${wrote ? "filled" : "no cited findings"} (${emptyCats.join(",")})`);
  } catch (e) {
    console.warn(`[ai-bake] ${slug} FAILED: ${e.message.slice(0, 160)}`);
  }
}
console.log(`[ai-bake] done — ${filled} category fills across ${brandsTouched} brands · tokens in/out ${inTok}/${outTok}`);
console.log(`[ai-bake] remember: run rebake-scoring.mjs + finalize-bundle.mjs to fold fills into grades`);
