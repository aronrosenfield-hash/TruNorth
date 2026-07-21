/**
 * B-81 — deliver on "we'll email you the moment <brand> is graded".
 *
 * THE GAP THIS CLOSES: the app has captured that promise since Build 79, and
 * a grep for brand_grade_notify / intendsBrandNotification across scripts/,
 * api/ and .github/workflows/ returned ZERO consumers. Every request was a
 * dead letter — on the product whose single mitigation for its #1 problem
 * (the 9,776-brand "?" wall) is exactly this promise.
 *
 * HOW IT WORKS — it reuses the pipeline B-70 repaired rather than adding a
 * parallel one. `snapshotFromIndex` in compute-weekly-changes.mjs keeps ONLY
 * graded brands, so a brand crossing "?" → A–F is absent from last week's
 * snapshot and already emits `type: "new_brand"` in weekly_changes.json.
 * That IS the newly-graded signal; this script consumes it.
 *
 *   weekly_changes.json  ──(type:"new_brand")──►  match against each
 *   subscriber's `brands_requested` field  ──►  one email per person
 *
 * SAFETY: DRY RUN BY DEFAULT. Sending email is irreversible and outward-facing,
 * so nothing leaves the building without --apply. The dry run prints exactly
 * who would be mailed about what.
 *
 *   node scripts/notify-newly-graded.mjs            # dry run (default)
 *   node scripts/notify-newly-graded.mjs --apply    # actually send
 *   node scripts/notify-newly-graded.mjs --apply --force   # bypass the blast guard
 *
 * HOW --apply SENDS: MailerLite campaigns target GROUPS, not arbitrary address
 * lists. So this sends ONE CAMPAIGN PER NEWLY-GRADED BRAND, to a throwaway
 * group holding only the people who asked about that brand. That is what lets
 * the email say "the brand YOU asked about is graded" rather than a generic
 * blast — which is the promise the app actually made.
 *
 * Three rails, because an email cannot be recalled:
 *   1. Dry run is the DEFAULT. --apply is required to send anything.
 *   2. Blast guard — refuses above NOTIFY_MAX_RECIPIENTS (default 500) unless
 *      --force. A poisoned upstream diff (see B-94, where a stale snapshot
 *      produced 60 false grade claims) must not become a mass mailing.
 *   3. Idempotency — a fulfilled brand is REMOVED from that subscriber's
 *      brands_requested after a successful send, so a re-run or next week's
 *      cron can never notify the same person about the same brand twice.
 *
 * Env: MAILERLITE_API_KEY (required for both modes — the dry run still reads
 *      the subscriber list), MAILERLITE_GROUP_ID (optional, scopes the read),
 *      TRUNORTH_FROM_EMAIL (defaults to aron@trunorthapp.com, the AUTHENTICATED
 *      domain — shared with send-weekly-digest.mjs), NOTIFY_MAX_RECIPIENTS.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGES = path.join(ROOT, "public", "data", "weekly_changes.json");
const APPLY = process.argv.includes("--apply");
const ML_KEY = process.env.MAILERLITE_API_KEY;
const ML_GROUP = process.env.MAILERLITE_GROUP_ID;
const API = "https://connect.mailerlite.com/api";
const SITE = "https://www.trunorthapp.com";
const BRANDS_FIELD = "brands_requested";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function readNewlyGraded() {
  if (!fs.existsSync(CHANGES)) return [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(CHANGES, "utf8"));
  } catch (err) {
    console.error(`[notify] cannot parse weekly_changes.json: ${err.message}`);
    process.exit(1);
  }
  return (doc.changes || []).filter((c) => c.type === "new_brand");
}

async function ml(pathname, opts = {}) {
  const res = await fetch(`${API}/${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${ML_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MailerLite ${pathname} → ${res.status} ${body.slice(0, 200)}`);
  }
  // Group-assign and schedule return 200/204 with an empty body; res.json()
  // would throw on those. Parse defensively.
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Every subscriber carrying a brands_requested value. Paginates. */
async function fetchWaiting() {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ limit: "200" });
    if (ML_GROUP) qs.set("filter[group]", ML_GROUP);
    if (cursor) qs.set("cursor", cursor);
    const data = await ml(`subscribers?${qs}`);
    for (const s of data.data || []) {
      const brands = s.fields && s.fields[BRANDS_FIELD];
      if (!brands) continue;
      // Only mail confirmed subscribers — unconfirmed means they never
      // completed double opt-in, and mailing them would burn sender reputation.
      if (s.status && s.status !== "active") continue;
      out.push({ email: s.email, brands: String(brands).split("|").map((b) => b.trim()).filter(Boolean) });
    }
    cursor = data.meta && data.meta.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/**
 * --audit: read the waiting list and report DEMAND, independent of whether
 * anything was graded this week. Two uses:
 *   1. verify the brands_requested plumbing actually works against live
 *      MailerLite without needing a grading event to coincide;
 *   2. answer the question v1.2 actually cares about — WHICH of the 9,776
 *      ungraded brands are users asking for? That is the cleanest signal for
 *      what to grade next, and we were collecting it without ever reading it.
 * Sends nothing, ever.
 */
async function audit() {
  if (!ML_KEY) {
    console.error("[audit] MAILERLITE_API_KEY missing — cannot read the waiting list.");
    process.exit(1);
  }
  const waiting = await fetchWaiting();
  console.log(`[audit] ${waiting.length} subscriber(s) carry a ${BRANDS_FIELD} value`);
  if (!waiting.length) {
    console.log(
      `[audit] none yet. Expected if the capture fix only just deployed — the field is\n` +
      `        written on the next "notify me when we grade X" tap, not backfilled.`
    );
    return;
  }
  const demand = new Map();
  for (const s of waiting) {
    for (const b of s.brands) {
      const k = norm(b);
      if (!demand.has(k)) demand.set(k, { label: b, n: 0 });
      demand.get(k).n++;
    }
  }
  const ranked = [...demand.values()].sort((a, b) => b.n - a.n);
  console.log(`[audit] ${ranked.length} distinct brand(s) requested\n`);
  console.log("  MOST-REQUESTED UNGRADED BRANDS (grade these first):");
  for (const d of ranked.slice(0, 25)) console.log(`    ${String(d.n).padStart(4)}×  ${d.label}`);
  const multi = waiting.filter((s) => s.brands.length > 1).length;
  console.log(
    `\n  ${multi} subscriber(s) are waiting on MORE THAN ONE brand — those requests were\n` +
    `  silently overwritten before the append-only fix, so this number should grow.`
  );
}

async function main() {
  if (process.argv.includes("--audit")) return audit();

  const newly = readNewlyGraded();
  console.log(`[notify] ${newly.length} newly-graded brand(s) in weekly_changes.json`);
  if (!newly.length) {
    console.log("[notify] nothing to announce — exiting cleanly.");
    console.log("[notify] (run with --audit to inspect the waiting list regardless)");
    return;
  }
  for (const n of newly.slice(0, 10)) console.log(`  · ${n.name} — ${n.detail}`);

  if (!ML_KEY) {
    console.error("[notify] MAILERLITE_API_KEY missing — cannot read the waiting list.");
    process.exit(1);
  }

  const waiting = await fetchWaiting();
  console.log(`[notify] ${waiting.length} subscriber(s) waiting on at least one brand`);

  // Match on the normalized brand name so "Ben & Jerry's" matches "ben jerrys".
  const byName = new Map(newly.map((n) => [norm(n.name), n]));
  const recipients = [];
  for (const sub of waiting) {
    const hits = sub.brands.map((b) => byName.get(norm(b))).filter(Boolean);
    if (hits.length) recipients.push({ email: sub.email, hits });
  }

  console.log(`[notify] ${recipients.length} subscriber(s) have a match`);
  for (const r of recipients.slice(0, 20)) {
    const masked = r.email.replace(/^(.).*(@.*)$/, "$1***$2");
    console.log(`  → ${masked}: ${r.hits.map((h) => `${h.name} (${h.detail})`).join(", ")}`);
  }

  if (!recipients.length) {
    console.log("[notify] no matches — nothing to send.");
    return;
  }

  if (!APPLY) {
    console.log(`\n[notify] DRY RUN — would email ${recipients.length} people. Re-run with --apply to send.`);
    return;
  }

  // ── SEND ────────────────────────────────────────────────────────────────
  // MailerLite campaigns target GROUPS, not arbitrary address lists. So we send
  // ONE CAMPAIGN PER NEWLY-GRADED BRAND, to a throwaway group containing only
  // the people who asked about that brand. That is what makes the email able to
  // say "the brand YOU asked about is graded" instead of a generic blast — and
  // it is the promise the app actually made.
  //
  // Blast guard: a bug upstream (a bad diff, a poisoned snapshot — see B-94)
  // could nominate thousands of "newly graded" brands. Refuse anything above
  // MAX_RECIPIENTS unless --force is passed, because an email cannot be recalled.
  const MAX_RECIPIENTS = Number(process.env.NOTIFY_MAX_RECIPIENTS || 500);
  if (recipients.length > MAX_RECIPIENTS && !process.argv.includes("--force")) {
    console.error(
      `[notify] REFUSING: ${recipients.length} recipients exceeds the ${MAX_RECIPIENTS} blast guard. ` +
        "Verify the newly-graded list is real, then re-run with --force (or raise NOTIFY_MAX_RECIPIENTS)."
    );
    process.exit(2);
  }

  const FROM = process.env.TRUNORTH_FROM_EMAIL || "aron@trunorthapp.com";
  const stamp = new Date().toISOString().slice(0, 10);

  // Invert: brand → the subscribers waiting on it.
  const byBrand = new Map();
  for (const r of recipients) {
    for (const h of r.hits) {
      if (!byBrand.has(h.slug)) byBrand.set(h.slug, { brand: h, emails: [] });
      byBrand.get(h.slug).emails.push(r.email);
    }
  }

  let sent = 0;
  for (const [slug, { brand, emails }] of byBrand) {
    const grade = (brand.detail.match(/·\s*([A-F])\s*$/) || [])[1] || "";
    console.log(`\n[notify] ${brand.name} → ${emails.length} subscriber(s)`);

    // 1. throwaway group scoped to this brand + run
    const group = await ml("groups", {
      method: "POST",
      body: JSON.stringify({ name: `notify · ${slug} · ${stamp}` }),
    });
    const groupId = group?.data?.id;
    if (!groupId) throw new Error(`group create returned no id for ${slug}`);

    // 2. add each waiting subscriber
    for (const email of emails) {
      const sub = await ml(`subscribers/${encodeURIComponent(email)}`).catch(() => null);
      const subId = sub?.data?.id;
      if (!subId) { console.warn(`  ! could not resolve subscriber ${email}`); continue; }
      await ml(`subscribers/${subId}/groups/${groupId}`, { method: "POST" });
    }

    // 3. campaign — plain, factual, links straight to the brand
    const url = `${SITE}/company/${slug}`;
    const html =
      `<p>You asked us to tell you when <strong>${brand.name}</strong> was graded.</p>` +
      `<p>It now grades <strong>${grade || "—"}</strong> on TruNorth, built only from public records.</p>` +
      `<p><a href="${url}">See the record for ${brand.name} →</a></p>` +
      `<p style="color:#888;font-size:12px">You're getting this because you asked to be notified about this brand in the TruNorth app.</p>`;
    const campaign = await ml("campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: `Newly graded · ${brand.name} · ${stamp}`,
        type: "regular",
        emails: [{
          subject: `${brand.name} is now graded on TruNorth`,
          from_name: "TruNorth",
          from: FROM,
          content: html,
        }],
        groups: [groupId],
      }),
    });
    const campaignId = campaign?.data?.id;
    if (!campaignId) throw new Error(`campaign create returned no id for ${slug}`);
    await ml(`campaigns/${campaignId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ delivery: "instant" }),
    });
    console.log(`  ✓ campaign ${campaignId} sent to group ${groupId}`);
    sent++;

    // 4. IDEMPOTENCY — drop the fulfilled brand from each subscriber's list so a
    //    re-run (or next week's cron) can never notify the same person twice.
    for (const email of emails) {
      const sub = await ml(`subscribers/${encodeURIComponent(email)}`).catch(() => null);
      const prior = sub?.data?.fields?.[BRANDS_FIELD];
      if (!prior) continue;
      const remaining = String(prior)
        .split("|")
        .map((b) => b.trim())
        .filter((b) => b && norm(b) !== norm(brand.name))
        .join("|");
      if (remaining === String(prior)) continue;
      await ml("subscribers", {
        method: "POST",
        body: JSON.stringify({ email, fields: { [BRANDS_FIELD]: remaining } }),
      }).catch((e) => console.warn(`  ! could not clear ${brand.name} for a subscriber: ${e.message}`));
    }
  }

  console.log(`\n[notify] done — ${sent} campaign(s) sent across ${recipients.length} subscriber(s).`);
}

main().catch((err) => {
  console.error(`[notify] failed: ${err.message}`);
  process.exit(1);
});
