// /api/delete-account — server-side account/data deletion (App Store 5.1.1(v)).
//
// TruNorth is anonymous (no login), but it DOES collect an optional email
// (paywall receipt + Sunday digest + newsletter) which is written to
// MailerLite via /api/subscribe. Apple's Guideline 5.1.1(v) requires that
// any app supporting account creation lets users delete that account/data
// FROM INSIDE THE APP — not by emailing support. This endpoint removes the
// user's email (the only server-side PII) from MailerLite. The in-app
// "Delete Account" flow calls this, then wipes all local data.
//
// The RevenueCat purchase record is intentionally NOT deleted: Apple requires
// purchase/receipt history to be retained so "Restore Purchases" keeps working.
//
// Mirrors subscribe.js: edge runtime, same origin all-list, per-IP rate limit,
// holds MAILERLITE_API_KEY server-side, graceful no-op when unconfigured.

export const config = { runtime: "edge" };

const ML_BASE = "https://connect.mailerlite.com/api/subscribers";

// Per-IP rate limit: 5 requests per 60s window (in-memory; resets on edge
// cold-start, which is fine for abuse protection).
const _hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  if (_hits.size > 5000) {
    for (const [k, v] of _hits) {
      if (Array.isArray(v) && !v.some((t) => now - t < 60_000)) _hits.delete(k);
    }
  }
  const arr = (_hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (arr.length >= 5) return true;
  arr.push(now);
  _hits.set(ip, arr);
  return false;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = [
    "https://www.trunorthapp.com",
    "https://trunorthapp.com",
    "http://localhost:5173", // vite dev
    "capacitor://localhost", // iOS native shell
    "ionic://localhost",
  ];
  const isAllowed = allowedOrigins.includes(origin) || !origin; // empty = same-origin

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
  if (!email.includes("@") || !email.includes(".") || email.length > 320) {
    return new Response(JSON.stringify({ ok: false, error: "invalid_email" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const ML_KEY = process.env.MAILERLITE_API_KEY;
  // Graceful no-op when unconfigured (local dev / early prod) — the in-app
  // local wipe still proceeds; report success so the deletion flow completes.
  if (!ML_KEY) {
    return new Response(JSON.stringify({ ok: true, deleted: false, warning: "mailerlite_not_configured" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const auth = { "Authorization": `Bearer ${ML_KEY}`, "Accept": "application/json" };
  try {
    // 1) Look up the subscriber by email (MailerLite accepts email or numeric id).
    const lookup = await fetch(`${ML_BASE}/${encodeURIComponent(email)}`, { headers: auth });
    if (lookup.status === 404) {
      // Never subscribed (or already deleted) — nothing to remove. Idempotent success.
      return new Response(JSON.stringify({ ok: true, deleted: false, reason: "not_found" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    if (!lookup.ok) {
      const t = await lookup.text().catch(() => "");
      console.warn("[delete-account] lookup", lookup.status, t.slice(0, 160));
      // Don't block the user's in-app deletion on a transient ML error.
      return new Response(JSON.stringify({ ok: true, deleted: false, warning: `mailerlite_lookup_${lookup.status}` }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }
    const data = await lookup.json().catch(() => ({}));
    const id = data?.data?.id;
    if (!id) {
      return new Response(JSON.stringify({ ok: true, deleted: false, reason: "no_id" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    // 2) Delete the subscriber (removes the email + all fields from MailerLite).
    const del = await fetch(`${ML_BASE}/${id}`, { method: "DELETE", headers: auth });
    const deleted = del.ok || del.status === 204;
    if (!deleted) {
      const t = await del.text().catch(() => "");
      console.warn("[delete-account] delete", del.status, t.slice(0, 160));
    }
    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  } catch (err) {
    console.warn("[delete-account] network", err?.message || err);
    // Best-effort: the in-app local wipe still completes the user-facing deletion.
    return new Response(JSON.stringify({ ok: true, deleted: false, warning: "mailerlite_network" }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }
}
