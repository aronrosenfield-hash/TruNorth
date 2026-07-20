// /api/subscribe — server-side MailerLite write proxy.
//
// CRITICAL FIX (audit 2026-06-01): the previous design used
// VITE_MAILERLITE_API_KEY directly from the client bundle — but any VITE_-
// prefixed value is inlined into the public JS at build time. The moment
// the env var was populated on Vercel, the write key would have been
// publicly extractable (MailerLite write keys can drain subscriber lists
// and burn sender reputation).
//
// This edge function holds the API key server-side (MAILERLITE_API_KEY,
// NO VITE_ prefix) and accepts the same { email, source, ...metadata }
// payload the client used to POST directly. CORS-restricted to our own
// origin. Gracefully no-ops if the env var is unset.

export const config = { runtime: "edge" };

const ML_ENDPOINT = "https://connect.mailerlite.com/api/subscribers";

// Per-IP rate limit: 5 requests per 60s window (in-memory; resets on edge
// cold-start, which is fine for spam protection).
const _hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) { if (!v.some?.(t => now - t < 60_000) && !(typeof v === 'number' && now - v < 60_000)) _hits.delete(k); }
  }
  const windowMs = 60_000;
  const max = 5;
  const arr = (_hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  _hits.set(ip, arr);
  return false;
}

export default async function handler(req) {
  // Basic origin check — only accept calls from our own deploys.
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = [
    "https://www.trunorthapp.com",
    "https://trunorthapp.com",
  ];
  // 2026-07-20 (v1.2 review): this hard-coded "capacitor://localhost", but
  // capacitor.config.json sets ios.scheme "TruNorth" — so the SHIPPING iOS
  // webview sends TruNorth://localhost and never matched, 403'ing native email
  // capture on the live build. Android (Capacitor 8) serves https://localhost,
  // also absent — which would have killed the Delete Account endpoint that
  // Google Play's data-deletion policy requires. Accept any origin whose host
  // is localhost regardless of scheme/port, plus the literal "null" that some
  // custom-scheme WKWebViews send.
  const isLocalShell = (o) => {
    if (o === "null") return true;
    try {
      const h = new URL(o).hostname;
      return h === "localhost" || h === "127.0.0.1";
    } catch { return false; }
  };
  const isAllowed = !origin || allowedOrigins.includes(origin) || isLocalShell(origin); // empty origin = same-origin

  // QA fix 2026-06-10: the handler 405'd OPTIONS, so any cross-origin caller
  // (the capacitor:// native shell, the apex→www domain) failed CORS
  // preflight and the email never reached MailerLite. Also: every error
  // response below now carries CORS headers — without them the browser
  // can't read the status and the client treated rate-limits as network
  // failures.
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: isAllowed ? 204 : 403,
      headers: { ...corsHeaders(origin), "Access-Control-Max-Age": "86400" },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders(origin) });
  }
  if (!isAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  // Rate limit per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400, headers: corsHeaders(origin) }); }

  const email = String(body?.email || "").trim().toLowerCase();
  const source = String(body?.source || "unknown").slice(0, 64);
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  if (!email.includes("@") || !email.includes(".") || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const ML_KEY = process.env.MAILERLITE_API_KEY;
  const ML_GROUP_ID = process.env.MAILERLITE_GROUP_ID;

  // Graceful no-op when key isn't configured (lets local dev + early
  // production work without breaking the funnel).
  if (!ML_KEY) {
    return new Response(JSON.stringify({ ok: true, source, warning: "mailerlite_not_configured" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  try {
    const payload = {
      email,
      fields: { source, ...sanitizeMetadata(metadata) },
      // 2026-06-05: opt EVERY subscriber into double-opt-in by default.
      // MailerLite recognizes status:"unconfirmed" → automatically sends
      // a "Please confirm your subscription" email with a click-through
      // link. Until the user clicks, the subscriber stays "unconfirmed"
      // and won't receive campaigns. This:
      //   1. Stops fake/typo emails (a@a.com) from clogging our list
      //   2. Improves sender reputation (only verified humans → lower
      //      spam complaint rate → better inbox placement)
      //   3. Provides GDPR / CASL "explicit consent" audit trail
      //   4. Costs nothing — MailerLite free tier includes confirmation
      //      emails with our brand
      status: "unconfirmed",
    };
    if (ML_GROUP_ID) payload.groups = [ML_GROUP_ID];

    const res = await fetch(ML_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ML_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[subscribe] mailerlite", res.status, text.slice(0, 200));
      return new Response(JSON.stringify({ ok: true, warning: `mailerlite_${res.status}` }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    // Signal to the client that the user needs to confirm via email
    // before they're on the list — drives the "check your inbox" UX.
    return new Response(JSON.stringify({ ok: true, source, requiresVerification: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (err) {
    console.warn("[subscribe] network", err?.message || err);
    return new Response(JSON.stringify({ ok: true, warning: "mailerlite_network" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// Strip anything that doesn't look like a simple flat key:string|number|bool
// — prevents abuse of MailerLite's fields object as a data dump.
function sanitizeMetadata(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    if (typeof k !== "string" || k.length > 64) continue;
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.slice(0, 256);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}
