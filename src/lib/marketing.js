// Phase 4.7 — email capture / marketing.
//
// subscribeEmail(email, source, metadata) is the single entry point used at
// every capture touchpoint (paywall, quiz completion, save-prompt, submit form).
// It does three things:
//   1. Fires a PostHog `email_captured` event so the funnel is visible in analytics.
//   2. POSTs to MailerLite (if VITE_MAILERLITE_API_KEY is configured) to add
//      the subscriber to the configured group.
//   3. Stores the email in localStorage `tn_email` so we can prefill future
//      forms and identify the user across sessions.
//
// When MailerLite isn't configured (no env vars), the call resolves successfully
// — analytics fires, localStorage saves, the user flow continues. This keeps
// dev / prod-before-MailerLite-signup working without any feature flag.

import { track, identify } from "./analytics";

const ML_KEY      = import.meta.env.VITE_MAILERLITE_API_KEY;
const ML_GROUP_ID = import.meta.env.VITE_MAILERLITE_GROUP_ID; // optional
const ML_ENDPOINT = "https://connect.mailerlite.com/api/subscribers";

/**
 * Captures an email at a known funnel point.
 * @param {string} email — the user-entered email
 * @param {string} source — short stable identifier ("paywall" | "quiz_complete" | "save_first" | "submit_form")
 * @param {object} [metadata] — extra context (companyName for "save_first", etc.)
 * @returns {Promise<{ok: boolean, error?: string, source: string}>}
 */
export async function subscribeEmail(email, source, metadata = {}) {
  const cleaned = String(email || "").trim().toLowerCase();
  if (!cleaned.includes("@") || !cleaned.includes(".")) {
    return { ok: false, error: "invalid_email", source };
  }

  // 1) Persist so we can prefill / identify on future visits
  try { localStorage.setItem("tn_email", cleaned); } catch {}

  // 2) PostHog identification — links this email to the anonymous distinctId
  try { identify(cleaned, { source, ...metadata }); } catch {}

  // 3) Analytics event (never blocks — never throws)
  try { track("email_captured", { source, ...metadata }); } catch {}

  // 4) MailerLite — only if configured. CORS-friendly call.
  if (ML_KEY) {
    try {
      const body = {
        email: cleaned,
        fields: {
          source,
          ...metadata,
        },
      };
      if (ML_GROUP_ID) body.groups = [ML_GROUP_ID];
      const res = await fetch(ML_ENDPOINT, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${ML_KEY}`,
          "Content-Type":  "application/json",
          "Accept":        "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Non-200 from MailerLite — log but don't block user flow
        const text = await res.text().catch(()=>"");
        console.warn("[marketing] MailerLite responded", res.status, text.slice(0, 200));
        return { ok: true, source, warning: `mailerlite_${res.status}` };
      }
      return { ok: true, source };
    } catch (err) {
      console.warn("[marketing] MailerLite call failed:", err);
      return { ok: true, source, warning: "mailerlite_network" };
    }
  }

  // No MailerLite configured — that's fine, we still captured the email locally + in PostHog
  return { ok: true, source, warning: "mailerlite_not_configured" };
}

/** Prefill helper — returns the stored email if any. */
export function getStoredEmail() {
  try { return localStorage.getItem("tn_email") || ""; }
  catch { return ""; }
}
