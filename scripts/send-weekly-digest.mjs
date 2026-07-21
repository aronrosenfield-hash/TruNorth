/**
 * Phase 5.as — Sunday weekly email digest.
 *
 * Reads public/data/weekly_changes.json and POSTs a campaign to MailerLite
 * to every subscriber in the configured group. Sent every Sunday 14:00 UTC
 * (~9am ET — peak email-open window per industry data) via GitHub Actions.
 *
 * Anti-pattern compliance: ONE email per week, no streaks, no leaderboards,
 * journalism cadence (NYT/FT). Unsubscribe link is auto-injected by MailerLite.
 *
 * Env required:
 *   MAILERLITE_API_KEY=ml_...       # MailerLite API token (Subscribers + Campaigns scope)
 *   MAILERLITE_GROUP_ID=12345       # group of digest subscribers
 *   APP_URL=https://trunorthapp.com # links inside the email
 *   DRY_RUN=true                    # optional — render but don't send
 *
 * Skips gracefully if MAILERLITE_API_KEY is unset, so first runs before
 * the secret is added to GitHub don't error the workflow.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const KEY      = process.env.MAILERLITE_API_KEY;
const GROUP_ID = process.env.MAILERLITE_GROUP_ID;
const APP_URL  = process.env.APP_URL || "https://trunorthapp.com";
const DRY_RUN  = String(process.env.DRY_RUN || "").toLowerCase() === "true";

if (!KEY) {
  console.error("⚠️  MAILERLITE_API_KEY not set — skipping weekly digest. Add the secret to enable.");
  process.exit(0);
}
if (!GROUP_ID) {
  console.error("❌ MAILERLITE_GROUP_ID not set.");
  process.exit(1);
}

const changesPath = path.resolve(__dirname, "..", "public", "data", "weekly_changes.json");
if (!fs.existsSync(changesPath)) {
  console.log(`(No weekly_changes.json at ${changesPath} — nothing to send.)`);
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(changesPath, "utf8"));
if (!data.changes?.length) {
  console.log("(weekly_changes.json has no changes this week — skipping digest.)");
  process.exit(0);
}

// Pick top 3 grade drops, top 3 grade rises, 1 recall, 1 editorial brand-of-the-week.
const drops    = data.changes.filter(c => c.type === "grade_drop").slice(0, 3);
const rises    = data.changes.filter(c => c.type === "grade_up").slice(0, 3);
const recalls  = data.changes.filter(c => c.type === "new_recall").slice(0, 1);
const scandals = data.changes.filter(c => c.type === "new_scandal").slice(0, 1);

const weekOf = data.weekOf || new Date().toISOString().slice(0,10);
const subject = `TruNorth · This week: ${data.stats?.gradeChanges || 0} grade changes, ${data.stats?.newRecalls || 0} recalls`;

const row = (c) => {
  const tint = c.severity === "alert" ? "#e24a4a"
            : c.severity === "warn"  ? "#f0a030"
            : "#7c6dfa";
  const url = `${APP_URL}/?slug=${encodeURIComponent(c.slug)}`;
  return `
    <tr><td style="padding:10px 14px;background:#161616;border-radius:10px;color:#f2f2f2">
      <a href="${url}" style="color:#f2f2f2;text-decoration:none">
        <div style="font-size:14px;font-weight:600">${escapeHtml(c.name)}</div>
        <div style="font-size:12px;color:#888;margin-top:3px">${escapeHtml(c.detail || "")}</div>
      </a>
    </td></tr>
    <tr><td style="height:8px"></td></tr>
  `;
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function section(title, color, items) {
  if (!items.length) return "";
  return `
    <div style="font-size:11px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin:24px 0 8px">
      ${title}
    </div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%">
      ${items.map(row).join("")}
    </table>
  `;
}

const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f2f2f2">
  <div style="max-width:540px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:24px">
      <a href="${APP_URL}" style="color:#7c6dfa;text-decoration:none;font-size:18px;font-weight:800;letter-spacing:-0.5px">TruNorth</a>
    </div>
    <div style="font-size:11px;color:#7c6dfa;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">
      Week of ${escapeHtml(weekOf)}
    </div>
    <h1 style="font-size:24px;font-weight:800;margin:0 0 8px;line-height:1.2">This week in conscious consumption.</h1>
    <p style="font-size:14px;color:#888;line-height:1.5;margin:0 0 16px">
      One email per week. No streaks. Open it when you want — every brand below links into the app.
    </p>
    ${section("Grade rises", "#4caf82", rises)}
    ${section("Grade drops", "#e24a4a", drops)}
    ${section("New recalls", "#e24a4a", recalls)}
    ${section("New news flags", "#f0a030", scandals)}
    <div style="text-align:center;margin:32px 0 8px">
      <a href="${APP_URL}" style="display:inline-block;background:#7c6dfa;color:#fff;text-decoration:none;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:700">
        Open TruNorth →
      </a>
    </div>
    <div style="font-size:11px;color:#555;text-align:center;margin-top:32px;line-height:1.5">
      Sent because you joined TruNorth. <a href="{$unsubscribe}" style="color:#888">Unsubscribe</a> · <a href="${APP_URL}/account" style="color:#888">Settings</a>
    </div>
  </div>
</body></html>`;

if (DRY_RUN) {
  const outPath = path.resolve(__dirname, "..", "build", "digest-preview.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`✅ DRY RUN — wrote preview to ${outPath}`);
  process.exit(0);
}

// 2026-07-21: this sent from "Aron@trunorth.com" — trunorth.com, NOT the
// authenticated trunorthapp.com. MailerLite rejects (or spam-folders) a sender
// on an unauthenticated domain, so the digest could never have delivered. It
// went unnoticed because the digest had nothing to send for five weeks (B-70).
// Shared with scripts/notify-newly-graded.mjs via the same env var.
const FROM_EMAIL = process.env.TRUNORTH_FROM_EMAIL || "aron@trunorthapp.com";

// ── Create campaign ──────────────────────────────────────────────────────────
async function ml(endpoint, body, method = "POST") {
  const res = await fetch(`https://connect.mailerlite.com/api/${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`MailerLite ${endpoint} ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

console.log("📧 Creating MailerLite campaign…");
const campaign = await ml("campaigns", {
  name: `Weekly digest · ${weekOf}`,
  type: "regular",
  emails: [{
    subject,
    from_name: "TruNorth",
    from: FROM_EMAIL,
    content: html,
  }],
  groups: [GROUP_ID],
});

const campaignId = campaign?.data?.id;
if (!campaignId) throw new Error(`Campaign create returned no id: ${JSON.stringify(campaign).slice(0,300)}`);

console.log(`✅ Campaign created (id: ${campaignId}). Scheduling immediate send…`);
await ml(`campaigns/${campaignId}/schedule`, { delivery: "instant" });

console.log(`✅ Sent. Campaign ${campaignId} → group ${GROUP_ID}`);
