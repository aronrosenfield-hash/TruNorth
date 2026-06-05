// Phase 5.ba — SEO edge function for /company/<slug> URLs.
//
// THE PROBLEM: TruNorth is a Vite SPA. When Googlebot hits
// /company/patagonia, the rewrite serves /index.html — which is the
// generic SPA shell with no company-specific content. Google CAN
// execute JS, but for 11K URLs it's slow + unreliable + we lose ranking.
//
// THE FIX: this Edge function intercepts /company/<slug> and returns
// HTML with:
//   - Per-company <title> + <meta description> + canonical URL
//   - Open Graph + Twitter Card tags (rich link previews)
//   - JSON-LD structured data (Organization + AggregateRating →
//     enables rich snippets in Google search)
//   - <noscript> body with the actual data (crawler-readable even
//     without JS)
//   - SPA script tags so human users get the full interactive app
//
// One file, every company. Generated at request time but cached by
// Vercel's CDN. No build-time pre-rendering needed.

export const config = { runtime: "edge" };

const BASE = "https://www.trunorthapp.com";

const CATEGORY_LABELS = {
  political: "Political donations",
  environment: "Environment",
  labor: "Labor",
  dei: "DEI",
  charity: "Charity",
  animals: "Animal testing",
  guns: "Firearms",
  privacy: "Privacy",
  execPay: "Executive pay",
};

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function grade(score) {
  const n = Number(score);
  if (!isFinite(n)) return "—";
  if (n >= 80) return "A";
  if (n >= 65) return "B";
  if (n >= 50) return "C";
  if (n >= 35) return "D";
  return "F";
}

function ratingPercentile(score) {
  // Google's AggregateRating wants a 0-5 scale typically
  const n = Number(score);
  if (!isFinite(n)) return null;
  return (n / 20).toFixed(1); // 0-100 → 0-5
}

export default async function handler(req) {
  const url = new URL(req.url);
  // The vercel rewrite passes the slug via either pathname or query
  const slug = url.searchParams.get("slug")
    || url.pathname.replace(/^\/(?:company|c)\//, "").replace(/\/$/, "");

  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  // Fetch the company JSON from the same deployment
  let company = null;
  try {
    const dataUrl = `${url.origin}/data/companies/${encodeURIComponent(slug)}.json`;
    const r = await fetch(dataUrl);
    if (r.ok) company = await r.json();
  } catch {}

  // If the company doesn't exist, fall back to the SPA shell so the
  // app can show its "not found" UX. Still 200 (don't 404 actual SPA loads).
  if (!company) {
    const shellRes = await fetch(`${url.origin}/index.html`);
    return new Response(await shellRes.text(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const name        = company.name || slug;
  const overall     = company.overall ?? null;
  const overallG    = overall != null ? grade(overall) : null;
  const cat         = company.cat || "";
  const canonical   = `${BASE}/company/${encodeURIComponent(slug)}`;
  // 2026-06-05: was pointing at /api/og/company which doesn't exist — 404'd
  // silently on every share. Real endpoint is /api/og/brand (see api/og/).
  const ogImage     = `${BASE}/api/og/brand?name=${encodeURIComponent(name)}&cat=${encodeURIComponent(cat)}`;

  // Concise meta description — first non-empty narrative + grade summary
  const buildDesc = () => {
    const parts = [];
    if (overallG && overallG !== "—") parts.push(`Overall grade: ${overallG}.`);
    for (const key of ["political","environment","labor","dei"]) {
      const s = company[key]?.s;
      if (s && !/no public record/i.test(s)) { parts.push(s); break; }
    }
    const txt = parts.join(" ").replace(/\s+/g, " ").slice(0, 160).trim();
    return txt || `${name} — ${cat}. See political donations, labor record, environmental enforcement, and consumer-values grades on TruNorth.`;
  };
  const description = buildDesc();
  const title = `${name} — ${overallG ? overallG + " grade · " : ""}${cat || "Consumer values"} | TruNorth`;

  // JSON-LD structured data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: canonical,
    image: company.logoUrl || ogImage,
    ...(company.wiki?.website ? { sameAs: [company.wiki.website] } : {}),
  };
  if (overall != null) {
    jsonLd["aggregateRating"] = {
      "@type": "AggregateRating",
      ratingValue: ratingPercentile(overall),
      bestRating: "5",
      worstRating: "1",
      ratingCount: "1",
      reviewCount: "1",
    };
  }

  // Crawler-readable body (visible to humans only without JS)
  const noscriptBody = `
    <header style="padding:24px;max-width:720px;margin:0 auto">
      <h1 style="font-size:32px;margin:0 0 8px">${esc(name)}</h1>
      <div style="color:#888">${esc(cat)}</div>
      ${overallG && overallG !== "—" ? `<div style="margin-top:14px;font-size:18px"><strong>Overall: ${overallG}</strong> (${overall}/100)</div>` : ""}
    </header>
    <main style="padding:0 24px 48px;max-width:720px;margin:0 auto">
      ${Object.entries(CATEGORY_LABELS).map(([key, label]) => {
        const cat = company[key];
        if (!cat || !cat.s) return "";
        return `
          <section style="border-top:1px solid #222;padding:18px 0">
            <h2 style="font-size:16px;margin:0 0 6px;color:#fff">${esc(label)}</h2>
            <p style="font-size:14px;line-height:1.6;color:#aaa;margin:0">${esc(cat.s)}</p>
          </section>
        `;
      }).join("")}
      <section style="border-top:1px solid #222;padding:18px 0">
        <h2 style="font-size:16px;margin:0 0 6px">Data sources</h2>
        <p style="font-size:13px;color:#888;line-height:1.55">Researched from public records: SEC EDGAR · FEC · EPA Enforcement · OSHA · NLRB · OpenFDA · Violation Tracker · Have I Been Pwned · Yale CELI · and 20+ more. See the in-app Sources tab for the full list.</p>
      </section>
    </main>
  `;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:site_name" content="TruNorth" />
<meta property="og:image" content="${esc(ogImage)}" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />

<!-- Favicons -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />

<!-- Structured data: Organization + AggregateRating -->
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

<!-- SPA shell hydrate target — Vite's index.html mounts here -->
<script type="module" crossorigin src="${getSpaScript()}"></script>
<link rel="stylesheet" crossorigin href="${getSpaStyle()}" />
</head>
<body>
<div id="root">
<noscript>${noscriptBody}</noscript>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Cache 1 hour at edge, 1 day in browser (data refreshes nightly so this is safe)
      "Cache-Control": "public, s-maxage=3600, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

// Tiny helper to discover the latest Vite-built SPA script/style hashes.
// These change on every build; rather than hardcode we read /index.html
// once per cold start and cache the URLs in memory.
let _spaScript = null;
let _spaStyle  = null;
async function lookupSpa() {
  try {
    const r = await fetch("https://www.trunorthapp.com/index.html");
    const html = await r.text();
    const scriptMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    const styleMatch  = html.match(/href="(\/assets\/index-[^"]+\.css)"/);
    _spaScript = scriptMatch?.[1] || "/assets/index.js";
    _spaStyle  = styleMatch?.[1]  || "/assets/index.css";
  } catch {
    _spaScript = "/assets/index.js";
    _spaStyle  = "/assets/index.css";
  }
}
function getSpaScript() { return _spaScript || "/assets/index.js"; }
function getSpaStyle()  { return _spaStyle  || "/assets/index.css"; }
// Kick off the lookup on cold start (don't await — first request may use defaults)
lookupSpa();
