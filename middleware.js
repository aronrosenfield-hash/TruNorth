/**
 * Phase 5.ag — Edge middleware for dynamic OG tags.
 *
 * The app is a Vite SPA → every route serves the same index.html with
 * static og:image meta. Social platforms (Twitter, Facebook, iMessage,
 * Slack) scrape the URL on share — they DON'T run client-side JS — so
 * personalized share previews require the response HTML to carry the
 * right og:image at fetch time.
 *
 * This middleware intercepts two route families:
 *
 *   /?p=...&d=...&a=...&g=...&env=...&top=...  (quiz share-card target)
 *     → og:image = /api/og/values?p=...&d=...&...
 *
 *   /company/<slug>?from=<hash>                 (brand share target)
 *     → og:image = /api/og/brand?name=...&cat=...
 *        (grade omitted — recipient may not have a profile)
 *
 * Replaces the static og:image meta in index.html with the dynamic one.
 * Caches at the edge for 24h since the response varies per query.
 */

export const config = {
  matcher: [
    // 2026-06-05 (B-35): widened from `/` to cover landing + privacy +
    // brand pages too, so the geo-block runs everywhere a human would
    // hit the app. Negative lookahead excludes API endpoints (so
    // /api/company-seo still serves SEO HTML for /company/*), static
    // assets, data files, and any URL ending in a recognized static
    // extension. The OG-rewrite logic below stays scoped to `/` via
    // the explicit early-return on /company/*.
    "/((?!api/|_next/|assets/|data/|favicon\\.svg|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.json|apple-touch-icon\\.png|og-image\\.png|email-signature-logo\\.png|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|eot|css|js|json|xml|txt|webmanifest)$).*)",
  ],
};

// 2026-06-05 (B-35): country-level firewall. PostHog showed scraper
// traffic from regions TruNorth doesn't operate in — burning Vercel
// bandwidth quota with zero conversion potential and inflating
// analytics noise. The iOS app is US-only (App Store gates by region),
// so blocking these origins has zero downside.
//
// List combines OFAC-comprehensive-sanctions countries (CU/IR/KP/SY) +
// the highest-noise scraper origins. Tweak by editing this Set —
// middleware reloads on every deploy.
//
// Country codes are ISO 3166-1 alpha-2. Vercel injects them as
// request.geo.country and as the x-vercel-ip-country header.
const BLOCKED_COUNTRIES = new Set([
  "RU", // Russia       — sanctions overlap + heavy scraper origin
  "BY", // Belarus      — sanctions overlap
  "CN", // China        — high scraper origin, no App Store presence
  "KP", // North Korea  — OFAC comprehensive
  "IR", // Iran         — OFAC comprehensive
  "SY", // Syria        — OFAC comprehensive
  "CU", // Cuba         — OFAC comprehensive
  "VE", // Venezuela    — OFAC sectoral + heavy bot origin
]);

function geoBlocked(request) {
  const country =
    (request.geo && request.geo.country) ||
    request.headers.get("x-vercel-ip-country") ||
    "";
  return BLOCKED_COUNTRIES.has(country);
}

// Whitelist of forwardable params so we don't reflect random junk into og:
const VALUES_PARAMS = ["p", "d", "a", "g", "u", "env", "lab", "pri", "exp", "cha", "top"];

export default async function middleware(request) {
  // ── 1. Geo-block first ───────────────────────────────────────────────
  // Runs before any heavier work so blocked traffic doesn't hit our
  // compute budget. 451 Unavailable For Legal Reasons is semantically
  // closer to a geo-block than 403 Forbidden. Googlebot (mostly US) is
  // unaffected.
  if (geoBlocked(request)) {
    return new Response("TruNorth is not available in your region.", {
      status: 451,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  const url = new URL(request.url);

  // ── 2. OG rewrite — scope back down to `/` ───────────────────────────
  // Brand pages get richer SEO HTML from /api/company-seo.js (Phase 5.ba).
  // For /company/* (now in the matcher for geo-block coverage), we
  // simply fall through so the rewrite to /api/company-seo can take over.
  if (url.pathname.startsWith("/company/") || url.pathname.startsWith("/c/")) {
    return;
  }

  // Only rewrite GETs (POSTs, OPTIONS etc. pass through)
  if (request.method !== "GET") return;

  // Build the og:image URL we want to inject
  let ogImageUrl = null;
  let ogTitle = null;
  let ogDesc = null;

  if (url.pathname === "/") {
    // Values share-card target
    const hasValuesShare = VALUES_PARAMS.some(k => url.searchParams.has(k));
    if (hasValuesShare) {
      const ogQp = new URLSearchParams();
      for (const k of VALUES_PARAMS) {
        const v = url.searchParams.get(k);
        if (v) ogQp.set(k, v);
      }
      ogImageUrl = `${url.origin}/api/og/values?${ogQp.toString()}`;
      ogTitle = "Here's what matters to me — see yours";
      ogDesc = "Take the 60-second TruNorth values quiz and find brands that match.";
    }
  } else if (url.pathname.startsWith("/company/")) {
    // Brand share target — need the brand name + cat for the og:image.
    // We fetch the per-company JSON at the edge (already public on the same
    // origin, milliseconds). Falls back gracefully on miss.
    const slug = url.pathname.replace("/company/", "").split("/")[0];
    if (slug) {
      try {
        const dataRes = await fetch(`${url.origin}/data/companies/${encodeURIComponent(slug)}.json`, {
          // Inherit the edge cache; data files are immutable per build.
          cf: { cacheEverything: true },
        });
        if (dataRes.ok) {
          const co = await dataRes.json();
          const ogQp = new URLSearchParams({
            name: co.name || slug,
            cat:  co.cat  || "",
          });
          // Grade is intentionally omitted — recipient may not have taken
          // the quiz; the OG card shows the "two friends see different
          // grades" curiosity hook instead.
          ogImageUrl = `${url.origin}/api/og/brand?${ogQp.toString()}`;
          ogTitle = `${co.name} on TruNorth`;
          ogDesc = `See your personalized grade for ${co.name} — based on what YOU care about.`;
        }
      } catch (err) {
        // Network failure at edge — fall through to no rewrite
      }
    }
  }

  if (!ogImageUrl) return; // Nothing to inject — let the static index.html pass through

  // Fetch the static HTML
  const htmlRes = await fetch(`${url.origin}/index.html`, {
    cf: { cacheEverything: false },
  });
  if (!htmlRes.ok) return;
  let html = await htmlRes.text();

  // Surgical replacement of the og + twitter image meta + titles. The
  // index.html ships with specific og:image / twitter:image lines; rewrite
  // them in place rather than appending, so we don't double up.
  html = html.replace(
    /<meta property="og:image"[^>]*\/>/i,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />`,
  );
  html = html.replace(
    /<meta name="twitter:image"[^>]*\/>/i,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />`,
  );
  if (ogTitle) {
    html = html.replace(
      /<meta property="og:title"[^>]*\/>/i,
      `<meta property="og:title" content="${escapeHtml(ogTitle)}" />`,
    );
    html = html.replace(
      /<meta name="twitter:title"[^>]*\/>/i,
      `<meta name="twitter:title" content="${escapeHtml(ogTitle)}" />`,
    );
  }
  if (ogDesc) {
    html = html.replace(
      /<meta property="og:description"[^>]*\/>/i,
      `<meta property="og:description" content="${escapeHtml(ogDesc)}" />`,
    );
    html = html.replace(
      /<meta name="twitter:description"[^>]*\/>/i,
      `<meta name="twitter:description" content="${escapeHtml(ogDesc)}" />`,
    );
  }

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
