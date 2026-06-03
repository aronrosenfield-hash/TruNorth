#!/usr/bin/env node
/**
 * Option A — Step 2: AI extraction from high-signal news items
 *
 * Reads /public/data/news/YYYY-MM-DD.json (produced by news-rss-collect.mjs)
 * and runs each high-signal item through Claude to classify:
 *   - category (labor / environment / privacy / political / safety / legal / other)
 *   - severity (high / medium / low)
 *   - score impact (which TruNorth scoring category, direction, magnitude)
 *   - neutral 1-sentence summary
 *   - evidence strength (how confident the article is)
 *
 * Output: /public/data/news/YYYY-MM-DD.extracted.json — used by the merge
 * layer (next step) to fold real-world events back into per-company scores.
 *
 * Cost: ~$0.50-1.00 per nightly run with Sonnet 4.5 (batches of 20 items).
 *
 * Runs after news-rss-collect.mjs in the same workflow. Locally:
 *   node scripts/news-rss-extract.mjs                # today
 *   node scripts/news-rss-extract.mjs 2026-06-02    # specific day
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NEWS_DIR = path.join(ROOT, "public/data/news");

// claude-sonnet-4-6 is the current Sonnet alias (1M context, $3/$15 per 1M).
// claude-sonnet-4-5-20250929 still works (legacy active) but the API surface
// changes between versions — 4.6 supports adaptive thinking out of the box
// and is the recommended target for new code.
const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 20;
const MAX_RETRIES = 2;

// JSON Schema enforced via Anthropic tool use — guarantees structured output
const EXTRACTION_TOOL = {
  name: "record_extracted_items",
  description: "Record the structured analysis for a batch of news items.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The article URL — used as the unique key. MUST exactly match one of the input URLs.",
            },
            category: {
              type: "string",
              enum: ["labor", "environment", "privacy", "political", "product_safety", "legal", "ethics", "governance", "other"],
              description: "Primary ESG category this news event touches.",
            },
            severity: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "How materially does this event affect the brand's reputation? High = settlement >$100M, mass layoff, criminal charges. Medium = fine <$100M, regulatory action, executive scandal. Low = ongoing minor dispute, opinion piece.",
            },
            score_impact: {
              type: "object",
              properties: {
                trunorth_category: {
                  type: "string",
                  enum: ["labor", "environment", "privacy", "political", "ethics", "health", "values_alignment", "none"],
                  description: "Which TruNorth scoring category this maps to. Use 'none' if it doesn't affect any score.",
                },
                direction: {
                  type: "string",
                  enum: ["positive", "negative", "neutral"],
                },
                magnitude: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  description: "How much to shift the score: 0 = no impact, 0.1 = mild, 0.3 = moderate, 0.5+ = major. Most should be 0.1-0.3.",
                },
              },
              required: ["trunorth_category", "direction", "magnitude"],
            },
            summary: {
              type: "string",
              description: "ONE neutral sentence describing what happened. No editorializing. No 'critics say' or 'allegedly'. State facts.",
            },
            evidence_strength: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "high = official source / court filing / regulator press release. medium = reputable outlet, single source. low = opinion / unconfirmed / single-source rumor.",
            },
            is_actually_about_brand: {
              type: "boolean",
              description: "Set false if the article only TANGENTIALLY mentions the brand (e.g. NASCAR Coca-Cola 600 race, sponsorship news, brand listed in a roundup). Set true only when the brand is the actual subject.",
            },
          },
          required: ["url", "category", "severity", "score_impact", "summary", "evidence_strength", "is_actually_about_brand"],
        },
      },
    },
    required: ["items"],
  },
};

const SYSTEM_PROMPT = `You are an ESG news analyst for TruNorth, a consumer-values shopping app. You analyze news articles about consumer brands and extract structured signals that can move a brand's TruNorth score.

You will be given a batch of news articles. For each one:
1. Decide if it's actually about the brand (vs. a tangential mention / sponsorship / race named after the brand). Set is_actually_about_brand accordingly.
2. Classify into ONE primary ESG category.
3. Assess severity based on real-world impact (dollar amount, worker count, geographic scope).
4. Map to ONE TruNorth scoring category. Use 'none' if the event is real news but doesn't affect any score.
5. Write a NEUTRAL one-sentence summary. State facts only. No "critics say", no "allegedly" unless it's actually alleged. No editorializing.
6. Rate evidence strength — official sources/court filings = high, reputable single-source = medium, opinion/unverified = low.

Critical rules:
- A brand defending itself in court (e.g. "Apple fights antitrust case") is still negative, just less severe than losing.
- Strikes, layoffs, and union news are LABOR.
- Data breaches are PRIVACY.
- Recalls + safety defects are PRODUCT_SAFETY.
- Donations and PAC contributions are POLITICAL.
- Sponsorships and brand marketing (NASCAR, Olympics, etc.) are NOT corporate news → set is_actually_about_brand: false.

Return ALL items in the same order they were given. Do NOT skip items.`;

async function loadDigest(dateStr) {
  const file = path.join(NEWS_DIR, `${dateStr}.json`);
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw);
}

async function extractBatch(batch, apiKey, attempt = 0) {
  const userPrompt = `Analyze these ${batch.length} news articles. For each, call the record_extracted_items tool with the full classification.

${batch.map((item, i) => `[${i + 1}] BRAND: ${item.brand_name} (${item.brand_slug})
    TITLE: ${item.title}
    URL: ${item.url}
    OUTLET: ${item.outlet || "unknown"} (bias: ${item.bias})
    DATE: ${item.pub_date}`).join("\n\n")}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: "tool", name: "record_extracted_items" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      // Detect the retired-model 404 pattern so we fail loudly with a clear hint.
      if (res.status === 404 && /not_found_error|model/i.test(err)) {
        throw new Error(`Retired or unknown model "${MODEL}". Update MODEL to a current alias from https://platform.claude.com/docs/en/about-claude/models/overview . Raw: ${err.slice(0, 200)}`);
      }
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 400)}`);
    }
    const data = await res.json();

    // Defensive: log the full response shape when content is missing. The bug
    // we hit on 2026-06-03 was `data.content.find is not a function` — that
    // happens when the API returns {type:"error",...} with HTTP 200 (rare but
    // possible), or when the response shape changed across model versions.
    if (!Array.isArray(data.content)) {
      throw new Error(`Unexpected response shape (no content array). type=${data.type} error=${JSON.stringify(data.error || {}).slice(0, 200)} keys=${Object.keys(data).join(",")}`);
    }

    const toolUse = data.content.find(b => b.type === "tool_use");
    if (!toolUse) {
      // Could be a refusal — log the stop_reason and the first text block so
      // the failure is diagnosable from CI logs.
      const text = data.content.find(b => b.type === "text")?.text || "";
      throw new Error(`No tool_use in response. stop_reason=${data.stop_reason} stop_details=${JSON.stringify(data.stop_details || {})} first_text=${text.slice(0, 200)}`);
    }

    // 2026-06-03: defensive check on tool_use.input shape. Sonnet 4.6 has
    // returned tool_use blocks where `input.items` is missing — causing
    // the caller's `.find` on the return value to crash with a generic
    // TypeError. Surface the actual input shape so we can diagnose.
    if (!Array.isArray(toolUse.input?.items)) {
      throw new Error(`tool_use.input.items missing or wrong shape. input_keys=${Object.keys(toolUse.input || {}).join(",")} input_sample=${JSON.stringify(toolUse.input).slice(0, 400)}`);
    }
    return toolUse.input.items;
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.warn(`  ⚠ retry ${attempt + 1}/${MAX_RETRIES}: ${err.message}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      return extractBatch(batch, apiKey, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const dateArg = process.argv[2];
  const today = dateArg || new Date().toISOString().slice(0, 10);

  console.log(`🤖 News extraction starting for ${today}…`);
  const digest = await loadDigest(today);
  const items = digest.items_for_ai || [];
  console.log(`📋 ${items.length} high-signal items to classify`);

  if (items.length === 0) {
    console.log("⚠ No items to extract — skipping");
    return;
  }

  // Batch and process serially (parallel hits Anthropic rate limits)
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }
  console.log(`📦 ${batches.length} batches of up to ${BATCH_SIZE} items`);

  const results = [];
  const failures = [];
  let totalInputTokens = 0, totalOutputTokens = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  batch ${i + 1}/${batches.length} (${batch.length} items)… `);
    try {
      const extracted = await extractBatch(batch, apiKey);
      // Join input metadata with extracted classification by URL
      for (const item of batch) {
        const ex = extracted.find(e => e.url === item.url);
        if (ex) {
          results.push({
            ...ex,
            brand_slug: item.brand_slug,
            brand_name: item.brand_name,
            title:      item.title,
            outlet:     item.outlet,
            bias:       item.bias,
            pub_date:   item.pub_date,
          });
        } else {
          failures.push({ ...item, error: "no extraction returned" });
        }
      }
      console.log(`✓`);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      batch.forEach(it => failures.push({ ...it, error: err.message }));
    }
    // tiny pause between batches to be polite
    if (i + 1 < batches.length) await new Promise(r => setTimeout(r, 500));
  }

  // Filter out items that aren't actually about the brand
  const real = results.filter(r => r.is_actually_about_brand);
  const tangential = results.filter(r => !r.is_actually_about_brand);

  const outFile = path.join(NEWS_DIR, `${today}.extracted.json`);
  await fs.writeFile(outFile, JSON.stringify({
    extracted_at:    new Date().toISOString(),
    model:           MODEL,
    source_digest:   `${today}.json`,
    total_input:     items.length,
    extracted:       results.length,
    real_news:       real.length,
    tangential:      tangential.length,
    failures:        failures.length,
    items:           real,
    tangential_items: tangential,
    failed_items:    failures,
  }, null, 2));

  console.log(`\n✅ Wrote ${outFile}`);
  console.log(`   Real news:     ${real.length}`);
  console.log(`   Tangential:    ${tangential.length}  (NASCAR, sponsorships, etc.)`);
  console.log(`   Failed:        ${failures.length}`);

  // Quick category breakdown
  const byCategory = {};
  const bySeverity = {};
  real.forEach(r => {
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
  });
  console.log(`\n   Category breakdown:`);
  Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).forEach(([c,n]) => console.log(`     ${String(n).padStart(3)}  ${c}`));
  console.log(`   Severity breakdown:`);
  Object.entries(bySeverity).sort((a,b)=>b[1]-a[1]).forEach(([s,n]) => console.log(`     ${String(n).padStart(3)}  ${s}`));
}

main().catch(err => {
  console.error("❌ news-rss-extract failed:", err);
  process.exit(1);
});
