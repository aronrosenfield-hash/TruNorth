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

function grade(score, realCats) {
  // SCORING V3 (2026-06-11): signal-count cap removed — evidence confidence
  // is priced in by shrinkage when scores are baked (rebake-scoring.mjs), so
  // realCats is kept for call-site compatibility but unused. Thresholds
  // frozen from the one-time V3 recalibration. MUST stay in sync with
  // src/App.jsx scoreGrade, scripts/finalize-bundle.mjs scoreGrade,
  // scripts/rebake-scoring.mjs gradeFromOverall: A>=63, B>=56, C>=46, D>=41.
  const n = Number(score);
  if (!isFinite(n)) return "\u2014";
  if (n >= 63) return "A";
  if (n >= 56) return "B";
  if (n >= 46) return "C";
  if (n >= 41) return "D";
  return "F";
}

function ratingPercentile(score) {
  // Google's AggregateRating wants a 0-5 scale typically
  const n = Number(score);
  if (!isFinite(n)) return null;
  return (n / 20).toFixed(1); // 0-100 → 0-5
}

// ── GEO helpers ────────────────────────────────────────────────────────────
// TruNorth's canonical self-description — keep in sync with /llms.txt and the
// homepage Organization JSON-LD in index.html.
const TRUNORTH_ORG = {
  "@type": "Organization",
  "@id": `${BASE}/#org`,
  name: "TruNorth",
  url: BASE,
  sameAs: ["https://x.com/TruNorthapp"],
};

// Sources that are NOT public records. We must never present these as
// citations — doing so would undercut the "only public records" positioning
// (and the neutrality/honesty work, BACKLOG B-59). They can still inform the
// narrative, but provenance/quotable lines only ever name real records.
const NON_RECORD_SOURCE = /claude|synthesis|\bai\b|gpt|\bllm\b|inferred|editorial|internal/i;

// Display labels for common internal source IDs → human/citable names.
const SOURCE_LABELS = {
  "fec.gov": "FEC", "fec": "FEC", "epa": "EPA", "osha": "OSHA", "sec": "SEC",
  "cfpb": "CFPB", "nlrb": "NLRB", "doj": "DOJ", "nhtsa": "NHTSA", "cpsc": "CPSC",
  "cisa": "CISA", "courtlistener": "CourtListener", "irs990": "IRS Form 990",
  "bcorp": "B Lab", "hrc-cei": "HRC Corporate Equality Index",
  "fair-trade": "Fair Trade USA", "corporate-giving": "corporate giving disclosures",
  "fashion-revolution": "Fashion Revolution", "fair-labor-association": "Fair Labor Association",
  "uk-modern-slavery": "UK Modern Slavery registry", "one-percent-planet": "1% for the Planet",
};
function sourceLabel(id) {
  const k = String(id || "").toLowerCase().trim();
  return SOURCE_LABELS[k] || id;
}
function realSources(arr) {
  return Array.isArray(arr)
    ? [...new Set(arr.filter(s => s && !NON_RECORD_SOURCE.test(String(s))).map(sourceLabel))]
    : [];
}

function fmtDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// One self-contained, quotable, attributed sentence-set. LLMs preferentially
// lift sentences that carry a number + a named source + a date.
function buildQuotable(company, name, overallG, overall, when) {
  const parts = [];
  parts.push(
    `As of ${when}, TruNorth grades ${name} ${
      overallG && overallG !== "—" ? `an overall ${overallG} (${overall}/100)` : "from public records"
    } across nine values categories.`
  );
  const cand = [];
  for (const key of ["labor", "environment", "political", "privacy", "charity", "dei"]) {
    const c = company[key];
    if (!c || !c.s || /no public record/i.test(c.s)) continue;
    const srcs = realSources(c.sources);
    if (!srcs.length) continue; // only facts backed by a real public record
    const first = c.s.trim().split(/(?<=[.!?])\s/)[0];
    cand.push({ s: first, src: srcs[0], numeric: /\d/.test(first) ? 1 : 0 });
  }
  cand.sort((a, b) => b.numeric - a.numeric);
  for (const f of cand.slice(0, 2)) parts.push(`${f.s} (source: ${f.src}).`);
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 400).trim();
}

// Machine-readable per-category claims with provenance, as schema.org
// PropertyValue nodes. measurementTechnique names the public record(s).
function provenanceProps(company, labels) {
  const out = [];
  for (const [key, label] of Object.entries(labels)) {
    const c = company[key];
    if (!c || !c.s || /no public record/i.test(c.s)) continue;
    const srcs = realSources(c.sources);
    out.push({
      "@type": "PropertyValue",
      name: label,
      value: c.s,
      ...(srcs.length ? { measurementTechnique: "Public records: " + srcs.join(", ") } : {}),
    });
  }
  return out;
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

  // Resolve the hashed SPA asset URLs BEFORE rendering (see ensureSpa below).
  await ensureSpa();

  const name        = company.name || slug;
  const overall     = company.overall ?? null;
  const overallG    = overall != null ? grade(overall, company.realCats) : null;
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
  // B66 fix (Aron's iMessage repro): a PERSONALIZED share carries ?g=<their
  // grade>. The link preview's title was showing the baked baseline grade
  // ("Waffle House — C grade") right under a message saying "grades A on my
  // values" — three different signals in one bubble. For personal shares the
  // preview becomes the tease (matching the "?" og-image); organic search
  // visits (no g param) keep the baseline-grade title for SEO CTR.
  const sharedG = (url.searchParams.get("g") || "").toUpperCase();
  const isPersonalShare = ["A", "B", "C", "D", "F"].includes(sharedG);
  const description = isPersonalShare
    ? `A friend's TruNorth grades ${name} ${sharedG} on THEIR values. Grades are personal — answer nine quick choices and see what ${name} grades on yours.`
    : buildDesc();
  const title = isPersonalShare
    ? `${name} — what does it grade on YOUR values? | TruNorth`
    : `${name} — ${overallG ? overallG + " grade · " : ""}${cat || "Consumer values"} | TruNorth`;

  // Freshness + quotable summary (used in both JSON-LD and the visible body)
  const lastUpdated = company.lastUpdated || company.dataLastUpdated || null;
  const updatedLabel = fmtDate(lastUpdated) || fmtDate(new Date().toISOString());
  const quotable = buildQuotable(company, name, overallG, overall, updatedLabel);

  // Link the brand entity to its own canonical web presence (strong GEO/entity
  // signal — lets engines resolve "<brand>" to the real-world company).
  const brandSameAs = [];
  if (company.wiki?.website) brandSameAs.push(company.wiki.website);
  if (company.wiki?.wikipediaUrl) brandSameAs.push(company.wiki.wikipediaUrl);

  // JSON-LD structured data. The page is TruNorth's sourced assessment OF the
  // brand: an Organization (the brand) carrying per-category claims with
  // provenance + a Review authored & published by TruNorth. This replaces the
  // old self-referential AggregateRating (ratingCount:1 read as self-serving).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": canonical + "#subject",
    name,
    url: canonical,
    image: company.logoUrl || ogImage,
    ...(cat ? { industry: cat } : {}),
    ...(brandSameAs.length ? { sameAs: brandSameAs } : {}),
    additionalProperty: provenanceProps(company, CATEGORY_LABELS),
    subjectOf: {
      "@type": "Review",
      name: `TruNorth public-records assessment of ${name}`,
      author: TRUNORTH_ORG,
      publisher: TRUNORTH_ORG,
      reviewBody: quotable,
      ...(lastUpdated ? { datePublished: lastUpdated, dateModified: lastUpdated } : {}),
      itemReviewed: { "@type": "Organization", name },
      ...(overall != null
        ? {
            reviewRating: {
              "@type": "Rating",
              ratingValue: ratingPercentile(overall),
              bestRating: "5",
              worstRating: "1",
              ...(overallG && overallG !== "—" ? { alternateName: `Grade ${overallG}` } : {}),
            },
          }
        : {}),
    },
  };

  // 2026-06-05 (PageSpeed Tier 2): the SEO body used to live inside
  // <noscript>, which meant JS-enabled browsers (i.e. every real visitor)
  // saw a blank screen until React loaded + parsed + hydrated — pushing
  // LCP to 8.5s on /company/walmart.
  //
  // New approach: render the brand content INSIDE the visible #root div
  // (no <noscript> wrapper). The browser paints it immediately when the
  // SEO HTML arrives → LCP fires at FCP time (~2s). React's createRoot()
  // then replaces the entire #root subtree on hydrate, so the SPA still
  // takes over for interactivity.
  //
  // There's a brief flash when React mounts, which is the only UX cost.
  // Worth it: brand-page Lighthouse Perf jumps ~34 → ~75. Crawlers still
  // get the content (they see whatever's in the served HTML, whether
  // <noscript> or not).
  const seoFallbackBody = `
    <header style="padding:24px;max-width:720px;margin:0 auto;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      <h1 style="font-size:32px;margin:0 0 8px;font-weight:800">${esc(name)}</h1>
      <div style="color:#a8a8a8;font-size:14px">${esc(cat)}</div>
      ${overallG && overallG !== "—" ? `<div style="margin-top:14px;font-size:18px;color:#f2f2f2"><strong>Overall: ${overallG}</strong> · ${overall}/100</div>` : ""}
      <p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#cfcfcf">${esc(quotable)}</p>
      <div style="margin-top:10px;font-size:12px;color:#7a7a7a">Last updated ${esc(updatedLabel)} · TruNorth (trunorthapp.com)</div>
    </header>
    <main style="padding:0 24px 48px;max-width:720px;margin:0 auto;color:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
      ${Object.entries(CATEGORY_LABELS).map(([key, label]) => {
        const c = company[key];
        if (!c || !c.s) return "";
        const srcs = realSources(c.sources);
        return `
          <section style="border-top:1px solid #2a2a2a;padding:18px 0">
            <h2 style="font-size:16px;margin:0 0 6px;color:#fff;font-weight:700">${esc(label)}</h2>
            <p style="font-size:14px;line-height:1.6;color:#a8a8a8;margin:0">${esc(c.s)}</p>
            ${srcs.length ? `<div style="font-size:12px;color:#6f6f6f;margin-top:6px">Source: ${esc(srcs.join(" · "))}</div>` : ""}
          </section>
        `;
      }).join("")}
      <section style="border-top:1px solid #2a2a2a;padding:18px 0">
        <h2 style="font-size:16px;margin:0 0 6px;color:#fff;font-weight:700">Data sources</h2>
        <p style="font-size:13px;color:#8a8a8a;line-height:1.55">Researched from 200+ public-records sources: FEC · EPA · OSHA · SEC · CFPB · NHTSA · CISA · DOJ · CourtListener · and 190+ more. See the in-app Sources tab for the full list.</p>
      </section>
      <section style="border-top:1px solid #2a2a2a;padding:18px 0;text-align:center">
        <p style="font-size:13px;color:#8a8a8a;line-height:1.55;margin:0 0 14px">Get the full personalized grade for ${esc(name)} on TruNorth iOS</p>
        <a href="/" style="display:inline-block;background:#7c6dfa;color:#fff;padding:12px 24px;border-radius:10px;font-weight:700;text-decoration:none">Open TruNorth →</a>
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
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>

<!-- SPA shell hydrate target — Vite's index.html mounts here -->
<script type="module" crossorigin src="${getSpaScript()}"></script>
<link rel="stylesheet" crossorigin href="${getSpaStyle()}" />
</head>
<body style="background:#0f0f0f;margin:0;padding:0">
<div id="root">${seoFallbackBody}</div>
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
let _spaPromise = null;
// M3 (2026-06-11): the looked-up asset hash was cached in isolate memory
// FOREVER — after every Vercel deploy, old isolates kept emitting the
// previous deploy's /assets/index-<hash>.js (now 404) until the isolate
// died, so /company/<slug> pages rendered but never hydrated. 60s TTL keeps
// the lookup cheap while bounding the post-deploy outage window.
let _spaFetchedAt = 0;
const SPA_TTL_MS = 60_000;
async function lookupSpa() {
  try {
    const r = await fetch("https://www.trunorthapp.com/index.html");
    const html = await r.text();
    const scriptMatch = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
    const styleMatch  = html.match(/href="(\/assets\/index-[^"]+\.css)"/);
    _spaScript = scriptMatch?.[1] || "/assets/index.js";
    _spaStyle  = styleMatch?.[1]  || "/assets/index.css";
    if (!scriptMatch) _spaPromise = null; // no real hash found — retry on next request
  } catch {
    _spaScript = "/assets/index.js";
    _spaStyle  = "/assets/index.css";
    _spaPromise = null; // don't cache the failure
  }
}
// QA fix 2026-06-10: lookupSpa() was fire-and-forget on cold start, so the
// first request rendered <script src="/assets/index.js"> — a 404, since Vite
// hashes every bundle — and the CDN cached that broken HTML for an hour
// (s-maxage=3600). The handler now awaits ensureSpa() before rendering.
function ensureSpa() {
  if (!_spaPromise || Date.now() - _spaFetchedAt > SPA_TTL_MS) {
    _spaFetchedAt = Date.now();
    _spaPromise = lookupSpa();
  }
  return _spaPromise;
}
function getSpaScript() { return _spaScript || "/assets/index.js"; }
function getSpaStyle()  { return _spaStyle  || "/assets/index.css"; }
