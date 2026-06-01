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
  const windowMs = 60_000;
  const max = 5;
  const arr = (_hits.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  _hits.set(ip, arr);
  return false;
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Basic origin check — only accept calls from our own deploys.
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = [
    "https://www.trunorthapp.com",
    "https://trunorthapp.com",
    "http://localhost:5173", // vite dev
    "capacitor://localhost", // iOS native shell
    "ionic://localhost",
  ];
  const isAllowed = allowedOrigins.includes(origin) || !origin; // empty origin = same-origin
  if (!isAllowed) {
    return new Response("Forbidden", { status: 403 });
  }

  // Rate limit per IP
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const email = String(body?.email || "").trim().toLowerCase();
  const source = String(body?.source || "unknown").slice(0, 64);
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};

  if (!email.includes("@") || !email.includes(".") || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
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
    return new Response(JSON.stringify({ ok: true, source }), {
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
