/**
 * Phase 5.aq — Trending Now nightly refresh.
 *
 * Pulls top-viewed companies from PostHog and writes /public/data/trending.json.
 * Runs in CI (.github/workflows/trending-refresh.yml) every night at 06:00 UTC.
 *
 * Env required:
 *   POSTHOG_API_KEY=phx_...     # read-only personal key from PostHog
 *   POSTHOG_PROJECT_ID=442021   # TruNorth project id (default fallback baked in)
 *   POSTHOG_HOST=https://us.posthog.com  # optional; defaults to us.posthog.com
 *
 * Local usage:
 *   POSTHOG_API_KEY=phx_xxx node scripts/refresh-trending.mjs
 *
 * The CI workflow commits trending.json back to main if it changed, so the
 * next Vercel deploy serves fresh trending data automatically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY = process.env.POSTHOG_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "442021";
const HOST = process.env.POSTHOG_HOST || "https://us.posthog.com";
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS || 7);
const LIMIT = Number(process.env.LIMIT || 15);

if (!KEY) {
  console.error("❌ POSTHOG_API_KEY not set — skipping trending refresh.");
  process.exit(0); // exit clean so CI doesn't fail on first runs before secret is set
}

async function hogql(query) {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog HTTP ${res.status} — ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  return json.results || json.result || [];
}

async function main() {
  console.log(`📊 Querying top ${LIMIT} brands (last ${LOOKBACK_DAYS} days)…`);
  const rows = await hogql(`
    SELECT
      properties.slug AS slug,
      properties.name AS name,
      count() AS views,
      uniq(distinct_id) AS unique_viewers
    FROM events
    WHERE event = 'company_view'
      AND timestamp > now() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND properties.slug IS NOT NULL
    GROUP BY slug, name
    ORDER BY views DESC
    LIMIT ${LIMIT}
  `);

  if (!rows.length) {
    console.log("(No company_view events in the lookback window — leaving trending.json alone.)");
    return;
  }

  // 2026-06-10 (QA fix): company_view events sometimes carry name but a null
  // slug (the HogQL IS NOT NULL filter doesn't exclude explicit nulls the way
  // we assumed) — which shipped 15/15 null-slug entries and left the app's
  // Trending row permanently on its hardcoded fallback. Resolve missing slugs
  // by exact name match against index.json; drop rows that still don't resolve.
  const indexPath = path.resolve(__dirname, "..", "public", "data", "index.json");
  const nameToSlug = new Map(
    JSON.parse(fs.readFileSync(indexPath, "utf8")).map((c) => [String(c.name || "").toLowerCase(), c.slug])
  );
  const resolved = rows
    .map(([slug, name, views, uniques]) => ({
      slug: slug || nameToSlug.get(String(name || "").toLowerCase()) || null,
      name, views, uniques,
    }))
    .filter((b) => b.slug && b.name);
  if (!resolved.length) {
    console.log("(No rows resolved to a known slug — leaving trending.json alone.)");
    return;
  }
  console.log(`   resolved ${resolved.length}/${rows.length} rows to slugs`);

  const out = {
    generatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    brands: resolved,
  };

  const outPath = path.resolve(__dirname, "..", "public", "data", "trending.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(`✅ Wrote ${rows.length} brands to public/data/trending.json`);
  rows.slice(0, 5).forEach(([slug, name, views]) =>
    console.log(`   · ${String(name || slug).padEnd(28)} ${views} views`)
  );
}

main().catch((err) => {
  console.error("❌ Trending refresh failed:", err.message);
  process.exit(1);
});
