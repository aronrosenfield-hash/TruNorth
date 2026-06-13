// GEO landing surface — /alternatives/<slug>
//
// Targets the literal query people type into answer engines:
// "ethical alternatives to <brand>", "better-graded brands than <brand>".
// Served as a fast, crawler-readable static content page (no SPA mount) with
// ItemList + FAQPage structured data and links into each brand's /company page.
//
// Alternatives = same category, higher TruNorth overall grade. Prefers the
// brand's own listed competitors when they out-grade it; falls back to the
// best-graded peers in the category.

export const config = { runtime: "edge" };

const BASE = "https://www.trunorthapp.com";

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
  // scripts/rebake-scoring.mjs gradeFromOverall: A>=62, B>=50, C>=38, D>=33.
  const n = Number(score);
  if (!isFinite(n)) return "\u2014";
  if (n >= 62) return "A";
  if (n >= 50) return "B";
  if (n >= 38) return "C";
  if (n >= 33) return "D";
  return "F";
}

let _indexCache = null;
async function getIndex(origin) {
  if (_indexCache) return _indexCache;
  try {
    const r = await fetch(`${origin}/data/index.json`);
    if (r.ok) _indexCache = await r.json();
  } catch {}
  return _indexCache || [];
}

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug")
    || url.pathname.replace(/^\/alternatives\//, "").replace(/\/$/, "")).toLowerCase();

  if (!slug) return Response.redirect(BASE + "/", 302);

  let company = null;
  try {
    const r = await fetch(`${url.origin}/data/companies/${encodeURIComponent(slug)}.json`);
    if (r.ok) company = await r.json();
  } catch {}
  if (!company) return Response.redirect(BASE + "/", 302);

  const name = company.name || slug;
  const cat = company.cat || "";
  const overall = Number(company.overall);
  const overallG = isFinite(overall) ? grade(overall, company.realCats) : null;

  const index = await getIndex(url.origin);
  const compSet = new Set((company.competitors || []).map(c => String(c).toLowerCase()));

  // Candidates: same category, strictly higher grade than this brand.
  let peers = index.filter(co => {
    const s = (co.slug || co.id || "").toLowerCase();
    if (s === slug) return false;
    if ((co.cat || "") !== cat) return false;
    const o = Number(co.overall ?? co.score);
    return isFinite(o) && (!isFinite(overall) || o > overall);
  });
  // Rank: own competitors first, then by grade desc.
  peers.sort((a, b) => {
    const aw = compSet.has((a.slug || a.id || "").toLowerCase()) ? 1 : 0;
    const bw = compSet.has((b.slug || b.id || "").toLowerCase()) ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return Number(b.overall ?? b.score) - Number(a.overall ?? a.score);
  });
  const alts = peers.slice(0, 8).map(co => ({
    slug: co.slug || co.id,
    name: co.name,
    overall: Number(co.overall ?? co.score),
    g: grade(co.overall ?? co.score, co.realCats),
  }));

  const title = `Higher-graded alternatives to ${name}${cat ? " (" + cat + ")" : ""} | TruNorth`;
  const intro = alts.length
    ? `${name}${overallG ? ` holds a TruNorth grade of ${overallG}` : ""} based on public records. In ${cat || "its category"}, these brands grade higher on the nine values categories TruNorth tracks — political donations, environment, labor, DEI, charity, animal welfare, firearms, privacy, and executive pay — each scored from public records (FEC, EPA, OSHA, SEC, NLRB, and more).`
    : `TruNorth could not find a higher-graded ${cat || ""} alternative to ${name} in its catalog of 12,000+ brands at this time.`;
  const description = `Public-records alternatives to ${name} that grade higher on TruNorth: ${alts.slice(0, 4).map(a => `${a.name} (${a.g})`).join(", ") || "see the full list"}.`;

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Higher-graded alternatives to ${name}`,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    numberOfItems: alts.length,
    itemListElement: alts.map((a, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE}/company/${encodeURIComponent(a.slug)}`,
      name: `${a.name} — TruNorth grade ${a.g}`,
    })),
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [{
      "@type": "Question",
      name: `What are higher-graded alternatives to ${name}?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: alts.length
          ? `Based on public records, ${cat || "category"} brands that grade higher than ${name} on TruNorth include ${alts.map(a => `${a.name} (grade ${a.g})`).join(", ")}.`
          : `TruNorth does not currently list a higher-graded alternative to ${name} in ${cat || "its category"}.`,
      },
    }],
  };

  const rows = alts.map(a => `
    <li style="border-top:1px solid #2a2a2a;padding:16px 0;display:flex;align-items:center;gap:14px">
      <span style="font-size:22px;font-weight:800;color:#7c6dfa;min-width:28px">${esc(a.g)}</span>
      <span style="flex:1">
        <a href="/company/${encodeURIComponent(a.slug)}" style="color:#fff;font-size:17px;font-weight:700;text-decoration:none">${esc(a.name)}</a>
        <span style="display:block;color:#8a8a8a;font-size:13px">Overall ${isFinite(a.overall) ? a.overall + "/100" : "—"} · ${esc(cat)}</span>
      </span>
    </li>`).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${BASE}/alternatives/${encodeURIComponent(slug)}" />
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${BASE}/alternatives/${encodeURIComponent(slug)}" />
<meta property="og:site_name" content="TruNorth" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script type="application/ld+json">${JSON.stringify(itemList).replace(/</g, "\\u003c")}</script>
<script type="application/ld+json">${JSON.stringify(faq).replace(/</g, "\\u003c")}</script>
</head>
<body style="background:#0f0f0f;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<main style="padding:28px 24px 56px;max-width:720px;margin:0 auto;color:#f2f2f2">
  <a href="/" style="color:#7c6dfa;text-decoration:none;font-size:13px">← TruNorth</a>
  <h1 style="font-size:28px;margin:14px 0 10px;font-weight:800">Higher-graded alternatives to ${esc(name)}</h1>
  <p style="font-size:15px;line-height:1.65;color:#cfcfcf;margin:0 0 8px">${esc(intro)}</p>
  <div style="font-size:12px;color:#7a7a7a;margin-bottom:8px">Graded by TruNorth from public records. <a href="/company/${encodeURIComponent(slug)}" style="color:#9a8dff">See ${esc(name)}'s full record →</a></div>
  <ul style="list-style:none;padding:0;margin:18px 0 0">${rows}</ul>
  <div style="border-top:1px solid #2a2a2a;margin-top:24px;padding-top:20px;text-align:center">
    <p style="font-size:13px;color:#8a8a8a;margin:0 0 14px">Get personalized grades for these brands on the values you care about.</p>
    <a href="/" style="display:inline-block;background:#7c6dfa;color:#fff;padding:12px 24px;border-radius:10px;font-weight:700;text-decoration:none">Open TruNorth →</a>
  </div>
</main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
