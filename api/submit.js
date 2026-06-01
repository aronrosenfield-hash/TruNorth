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

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), { status: 405 });
  }

  let payload;
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "bad_json" }), { status: 400 }); }

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
    return new Response(JSON.stringify({ ok: false, error: "missing_fields" }), { status: 400 });
  }

  // Always log so Vercel function logs capture it even without Resend
  console.log("[submit]", JSON.stringify(cleaned));

  // Forward to Resend if configured
  const RESEND  = process.env.RESEND_API_KEY;
  const INBOX   = process.env.SUBMIT_INBOX || "Aron@trunorth.com";
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
          from:    "TruNorth Submissions <submit@trunorth.com>",
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
    headers: { "Content-Type": "application/json" },
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
