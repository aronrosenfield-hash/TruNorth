// Vercel Edge Function — receives Submit-tab corrections & company-add requests.
//
// Phase 5.as r2 fix: previously the Submit form fired a track() event and
// THREW AWAY the typed content. For a transparency app, silently /dev/null-ing
// user corrections is a trust-killer. This endpoint delivers them somewhere:
//
//   1. Stamps the payload with timestamp + IP-derived country
//   2. Forwards to RESEND_API_KEY if configured → email to Aron@trunorth.com
//   3. Falls back to console.log (visible in Vercel function logs)
//
// Always returns 200 to avoid noisy errors at the client; the user already
// got their confirmation toast.
//
// Required env (set in Vercel project → Environment Variables):
//   RESEND_API_KEY   — Resend.com API key (free tier = 100 emails/day)
//   SUBMIT_INBOX     — where to deliver, e.g. aron@trunorth.com
//
// Without those, submissions still log to Vercel + return 200 — no broken UX.

export const config = { runtime: "edge" };

// H14 fix (audit 2026-06-01): per-IP rate limit — 5 submits per 60s.
// Without this, a script could flood our Resend quota (100 emails/day free
// tier) in 20 seconds, AND fill the inbox with garbage. In-memory cache
// resets on cold-start which is fine for spam protection.
const _hits = new Map();
function rateLimited(ip, max = 5, windowMs = 60_000) {
  const now = Date.now();
  // M6 (2026-06-11): evict stale IPs so the Map can't grow unbounded in a
  // long-lived isolate (was: every IP ever seen, kept forever).
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) { if (!v.some(t => now - t < windowMs)) _hits.delete(k); }
  }
  const arr = (_hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  _hits.set(ip, arr);
  return false;
}

// M6 (2026-06-11): submit.js had NO origin check — trivial Resend-quota burn
// (100/day free tier) from any curl. Same allowlist as subscribe.js; an
// ABSENT Origin header is allowed only for same-origin form posts, but
// browser cross-site posts and bots that send an Origin must match.
const ALLOWED_ORIGINS = [
  "https://www.trunorthapp.com",
  "https://trunorthapp.com",
];

// 2026-07-20 (v1.2 review): see api/subscribe.js — "capacitor://localhost" never
// matched the shipping iOS webview (capacitor.config.json sets ios.scheme
// "TruNorth"), and Capacitor 8 on Android serves https://localhost. Match any
// localhost host regardless of scheme/port, plus the literal "null" some
// custom-scheme WKWebViews send.
const isLocalShell = (o) => {
  if (o === "null") return true;
  try {
    const h = new URL(o).hostname;
    return h === "localhost" || h === "127.0.0.1";
  } catch { return false; }
};

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin) || isLocalShell(origin);

  // 2026-06-12 review: submit.js had no OPTIONS handler and no CORS headers on
  // its responses, so the native capacitor:// shell (and apex→www) failed the
  // preflight and corrections never reached the function — even once the client
  // started POSTing to the absolute production origin. Mirror subscribe.js.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: isAllowed ? 204 : 403,
      headers: { ...corsHeaders(origin), "Access-Control-Max-Age": "86400" },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
  }
  if (!isAllowed) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden_origin" }), { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
  }

  // Rate limit before parsing any body
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60", ...corsHeaders(origin) },
    });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "bad_json" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } }); }

  const { type, category, company, detail, source, email } = payload || {};
  const cleaned = {
    type:     String(type     || "").slice(0, 50),
    category: String(category || "").slice(0, 100),
    company:  String(company  || "").slice(0, 200),
    detail:   String(detail   || "").slice(0, 4000),
    source:   String(source   || "").slice(0, 500),
    email:    String(email    || "").slice(0, 200),
    receivedAt: new Date().toISOString(),
    country:    req.headers.get("x-vercel-ip-country") || "?",
    userAgent:  req.headers.get("user-agent")?.slice(0, 200) || "?",
  };

  if (!cleaned.company || !cleaned.detail) {
    return new Response(JSON.stringify({ ok: false, error: "missing_fields" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
  }

  // Always log so Vercel function logs capture it even without Resend
  console.log("[submit]", JSON.stringify(cleaned));

  // Forward to Resend if configured
  const RESEND  = process.env.RESEND_API_KEY;
  const INBOX   = process.env.SUBMIT_INBOX || "aron.rosenfield@protonmail.com";
  if (RESEND) {
    try {
      const subject = `TruNorth submit · ${cleaned.type || "?"} · ${cleaned.company}`;
      const html = `
        <h2>New TruNorth submission</h2>
        <table cellpadding="6" style="border-collapse:collapse;font-family:system-ui">
          <tr><td><b>Type</b></td><td>${esc(cleaned.type)}</td></tr>
          <tr><td><b>Company</b></td><td>${esc(cleaned.company)}</td></tr>
          <tr><td><b>Category</b></td><td>${esc(cleaned.category)}</td></tr>
          <tr><td><b>Submitter email</b></td><td>${esc(cleaned.email)}</td></tr>
          <tr><td><b>Country</b></td><td>${esc(cleaned.country)}</td></tr>
          <tr><td><b>Received</b></td><td>${esc(cleaned.receivedAt)}</td></tr>
          <tr><td><b>Detail</b></td><td><pre style="margin:0;white-space:pre-wrap">${esc(cleaned.detail)}</pre></td></tr>
          <tr><td><b>Source</b></td><td>${esc(cleaned.source)}</td></tr>
        </table>
      `;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          // trunorthapp.com is DNS-verified in Resend (DKIM + SPF + MX bounce).
          from:    "TruNorth Submissions <submit@trunorthapp.com>",
          to:      [INBOX],
          subject,
          html,
          reply_to: cleaned.email || undefined,
        }),
      });
      if (!r.ok) {
        const text = await r.text();
        console.warn("[submit] Resend failed:", r.status, text.slice(0, 200));
      }
    } catch (err) {
      console.warn("[submit] Resend exception:", err.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
