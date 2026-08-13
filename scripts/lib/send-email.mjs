/**
 * send-email.mjs — outbound email for TruNorth (B-121 fix).
 *
 * WHY THIS EXISTS: both outbound paths were dead. MailerLite began returning
 *   422 "Content submission is only available on Premium plan."
 * on POST /campaigns, which is the ONLY call the weekly digest and the
 * "notify me when we grade this brand" job made. Signup was unaffected, so the
 * failure was invisible from the outside while two weekly sends were missed
 * (2026-08-02 and 2026-08-09) and every notify-me signup became a promise the
 * app could not keep.
 *
 * THE FIX (Aron's call, 2026-08-10): keep MailerLite as the LIST STORE — its
 * subscriber endpoints still work fine on the free plan — and deliver through
 * Resend, which is already DNS-verified for trunorthapp.com and already used by
 * api/submit.js. No new vendor, no new cost.
 *
 * Env:
 *   RESEND_API_KEY        — required to actually send (free tier: 100/day)
 *   MAILERLITE_API_KEY    — required to read the subscriber list
 *   MAILERLITE_GROUP_ID   — the group to read
 *   TRUNORTH_FROM_EMAIL   — defaults to aron@trunorthapp.com (MUST be the
 *                           authenticated domain; trunorth.com is not)
 *   DRY_RUN=true          — render + resolve recipients, send nothing
 *
 * Deliverability note: Resend has not sent bulk mail from this domain before.
 * Warm it up with the small existing list well before any launch campaign
 * rather than making the launch the first bulk send.
 */

const RESEND_KEY = process.env.RESEND_API_KEY;
const ML_KEY = process.env.MAILERLITE_API_KEY;
const GROUP_ID = process.env.MAILERLITE_GROUP_ID;
export const FROM_EMAIL = process.env.TRUNORTH_FROM_EMAIL || "aron@trunorthapp.com";
export const DRY_RUN = String(process.env.DRY_RUN || "").toLowerCase() === "true";

/** Read every active subscriber in the configured MailerLite group. */
export async function fetchSubscribers() {
  if (!ML_KEY || !GROUP_ID) {
    throw new Error("MAILERLITE_API_KEY and MAILERLITE_GROUP_ID are required to resolve recipients");
  }
  const out = [];
  let page = 1;
  // Paginate defensively — a truncated list silently under-sends, which is the
  // same class of bug as the LD-2 fetcher keeping 25 of 25,968 rows (B-102).
  for (;;) {
    const url = `https://connect.mailerlite.com/api/groups/${GROUP_ID}/subscribers?limit=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ML_KEY}`, Accept: "application/json" },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`MailerLite subscribers ${res.status}: ${text.slice(0, 300)}`);
    const json = text ? JSON.parse(text) : {};
    const batch = json?.data || [];
    for (const s of batch) {
      const email = s?.email;
      const status = String(s?.status || "active").toLowerCase();
      if (email && status === "active") out.push(email);
    }
    if (batch.length < 100) break;
    page++;
    if (page > 100) break; // 10k ceiling; revisit long before that
  }
  return [...new Set(out)];
}

/**
 * Send one email via Resend. Returns { ok, id?, error? } and never throws, so a
 * single bad address cannot abort a whole run.
 */
export async function sendOne({ to, subject, html, replyTo }) {
  if (DRY_RUN) return { ok: true, id: "dry-run" };
  if (!RESEND_KEY) return { ok: false, error: "RESEND_API_KEY not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `TruNorth <${FROM_EMAIL}>`,
        to: [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
    return { ok: true, id: (text ? JSON.parse(text) : {})?.id };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Send the same email to a list, sequentially with a small delay so we stay
 * under Resend's rate limit. Reports a real summary — a partial failure must be
 * visible, not swallowed, because a green run that delivered nothing is exactly
 * the failure mode this whole migration exists to fix.
 */
export async function sendBulk({ recipients, subject, html, replyTo, delayMs = 120 }) {
  let sent = 0;
  const failures = [];
  for (const to of recipients) {
    const r = await sendOne({ to, subject, html, replyTo });
    if (r.ok) sent++;
    else failures.push(`${to}: ${r.error}`);
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { sent, failed: failures.length, failures };
}
