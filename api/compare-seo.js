// GEO landing surface — /compare/<slugA>-vs-<slugB>
//
// Targets head-to-head answer-engine queries: "<A> vs <B>", "is <A> or <B>
// more ethical", "<A> vs <B> labor record". Crawler-readable static content
// with FAQPage structured data and links into each brand's /company page.

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
  // scripts/rebake-scoring.mjs gradeFromOverall: A>=62, B>=50, C>=38, D>=33.
  const n = Number(score);
  if (!isFinite(n)) return "\u2014";
  if (n >= 62) return "A";
  if (n >= 50) return "B";
  if (n >= 38) return "C";
  if (n >= 33) return "D";
  return "F";
}
async function getCompany(origin, slug) {
  try {
    const r = await fetch(`${origin}/data/companies/${encodeURIComponent(slug)}.json`);
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("slug")
    || url.pathname.replace(/^\/compare\//, "").replace(/\/$/, "")).toLowerCase();

  const m = raw.split("-vs-");
  if (m.length !== 2 || !m[0] || !m[1]) return Response.redirect(BASE + "/", 302);
  const [slugA, slugB] = m;

  const [a, b] = await Promise.all([
    getCompany(url.origin, slugA),
    getCompany(url.origin, slugB),
  ]);
  if (!a || !b) return Response.redirect(BASE + "/", 302);

  const nameA = a.name || slugA, nameB = b.name || slugB;
  const oA = Number(a.overall), oB = Number(b.overall);
  const gA = grade(oA, a.realCats), gB = grade(oB, b.realCats);
  const better = isFinite(oA) && isFinite(oB) ? (oA > oB ? nameA : oB > oA ? nameB : null) : null;

  const title = `${nameA} vs ${nameB} — values & public-records comparison | TruNorth`;
  const verdict = better
    ? `On overall TruNorth grade, ${better} scores higher (${nameA}: ${gA}, ${nameB}: ${gB}).`
    : `${nameA} and ${nameB} grade similarly overall (${nameA}: ${gA}, ${nameB}: ${gB}).`;
  const description = `${nameA} (${gA}) vs ${nameB} (${gB}) compared across nine values categories, graded from public records by TruNorth. ${verdict}`;

  const rows = Object.entries(CATEGORY_LABELS).map(([key, label]) => {
    const ca = a[key], cb = b[key];
    if ((!ca || !ca.s) && (!cb || !cb.s)) return "";
    const cell = (c) => c && c.s && !/no public record/i.test(c.s)
      ? esc(c.s)
      : `<span style="color:#6f6f6f">No public record found.</span>`;
    return `
      <div style="border-top:1px solid #2a2a2a;padding:16px 0">
        <h2 style="font-size:15px;margin:0 0 10px;color:#fff;font-weight:700">${esc(label)}</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><div style="font-size:12px;color:#9a8dff;font-weight:700;margin-bottom:4px">${esc(nameA)}</div><p style="font-size:13px;line-height:1.55;color:#a8a8a8;margin:0">${cell(ca)}</p></div>
          <div><div style="font-size:12px;color:#9a8dff;font-weight:700;margin-bottom:4px">${esc(nameB)}</div><p style="font-size:13px;line-height:1.55;color:#a8a8a8;margin:0">${cell(cb)}</p></div>
        </div>
      </div>`;
  }).join("");

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [{
      "@type": "Question",
      name: `Is ${nameA} or ${nameB} better rated on TruNorth?`,
      acceptedAnswer: { "@type": "Answer", text: `${verdict} Grades come from public records across nine values categories — political donations, environment, labor, DEI, charity, animal welfare, firearms, privacy, and executive pay.` },
    }],
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${BASE}/compare/${encodeURIComponent(slugA)}-vs-${encodeURIComponent(slugB)}" />
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${BASE}/compare/${encodeURIComponent(slugA)}-vs-${encodeURIComponent(slugB)}" />
<meta property="og:site_name" content="TruNorth" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<script type="application/ld+json">${JSON.stringify(faq).replace(/</g, "\\u003c")}</script>
</head>
<body style="background:#0f0f0f;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<main style="padding:28px 24px 56px;max-width:760px;margin:0 auto;color:#f2f2f2">
  <a href="/" style="color:#7c6dfa;text-decoration:none;font-size:13px">← TruNorth</a>
  <h1 style="font-size:26px;margin:14px 0 6px;font-weight:800">${esc(nameA)} vs ${esc(nameB)}</h1>
  <p style="font-size:15px;line-height:1.6;color:#cfcfcf;margin:0 0 6px">${esc(verdict)} Both graded from public records across nine values categories.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0">
    <a href="/company/${encodeURIComponent(slugA)}" style="text-decoration:none;background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:16px;text-align:center"><div style="font-size:30px;font-weight:800;color:#7c6dfa">${esc(gA)}</div><div style="color:#fff;font-weight:700;margin-top:4px">${esc(nameA)}</div><div style="color:#8a8a8a;font-size:12px">${isFinite(oA) ? oA + "/100" : "—"}</div></a>
    <a href="/company/${encodeURIComponent(slugB)}" style="text-decoration:none;background:#161616;border:1px solid #2a2a2a;border-radius:12px;padding:16px;text-align:center"><div style="font-size:30px;font-weight:800;color:#7c6dfa">${esc(gB)}</div><div style="color:#fff;font-weight:700;margin-top:4px">${esc(nameB)}</div><div style="color:#8a8a8a;font-size:12px">${isFinite(oB) ? oB + "/100" : "—"}</div></a>
  </div>
  ${rows}
  <div style="border-top:1px solid #2a2a2a;margin-top:24px;padding-top:20px;text-align:center">
    <p style="font-size:13px;color:#8a8a8a;margin:0 0 14px">Compare any two brands on the values you care about — personalized to your 30-second quiz.</p>
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
