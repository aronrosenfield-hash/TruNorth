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
 *
 * Env: MAILERLITE_API_KEY (required for both modes — the dry run still reads
 *      the subscriber list), MAILERLITE_GROUP_ID (optional, scopes the read).
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
  return res.json();
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

async function main() {
  const newly = readNewlyGraded();
  console.log(`[notify] ${newly.length} newly-graded brand(s) in weekly_changes.json`);
  if (!newly.length) {
    console.log("[notify] nothing to announce — exiting cleanly.");
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

  // NOTE: MailerLite campaigns target groups, not arbitrary address lists, so
  // an --apply implementation needs a per-run group (or the transactional API).
  // Deliberately left unimplemented rather than half-built: sending is
  // irreversible, and the recipient matching above is the part that needed
  // proving. See docs/ANDROID_LAUNCH_PLAN.md-style setup notes in BACKLOG B-81.
  console.error(
    "[notify] --apply is not wired yet: the recipient set is computed and verifiable above, " +
      "but the send path needs a MailerLite delivery decision (per-run group vs transactional API). " +
      "Refusing to guess at an irreversible action."
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(`[notify] failed: ${err.message}`);
  process.exit(1);
});
