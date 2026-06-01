# TruNorth Support Auto-Reply — 5-Minute Setup

Replaces the static "Support Auto-Reply" Gmail filter response with a personalized, keyword-aware Apps Script reply. Sender's first name is pulled from the From header, and the body varies based on whether the email is about billing, a bug, press, a feature request, or general support.

---

## 1. Create the Apps Script project (1 min)

1. Go to https://script.google.com while signed in as **Aron@trunorthapp.com**.
2. Click **New project** (top left).
3. Rename the project (top of page) to: `TruNorth Support Auto-Reply`.
4. Delete the placeholder `function myFunction() { ... }` in the editor.
5. Open `docs/gmail-personalized-autoreply.gs` from this repo, copy the entire file, and paste it into the Apps Script editor.
6. **File → Save** (or `Cmd+S`).

---

## 2. Authorize Gmail access (1 min)

1. In the Apps Script toolbar, set the function dropdown to `processSupportInbox`.
2. Click **Run**.
3. A consent screen appears — click **Review permissions**, choose the `Aron@trunorthapp.com` account, click **Advanced → Go to TruNorth Support Auto-Reply (unsafe)**, then **Allow**.
4. The script will run once against your current inbox. If you have unread Support-labeled threads, it will reply to them and apply the `Support/Replied` label. To test without sending live replies, see Step 5 first.

---

## 3. Install the 5-minute trigger (30 sec)

1. In the function dropdown, choose `installTrigger`.
2. Click **Run**.
3. Verify by clicking the clock icon (Triggers) in the left sidebar — you should see one trigger for `processSupportInbox`, time-based, every 5 minutes.

To pause auto-replies later, run `uninstallTrigger` from the same dropdown.

---

## 4. Disable the old static auto-reply filter (30 sec)

The existing Gmail filter sends a canned "Support Auto-Reply" template. Leave the label-applying part — kill only the canned-response part.

1. Open Gmail → **Settings (gear icon) → See all settings → Filters and Blocked Addresses**.
2. Find the filter that targets `support@trunorthapp.com` (or whatever criteria you used).
3. Click **edit**.
4. Keep the checkbox for **Apply the label: Support**.
5. **Uncheck** the box for **Send template: Support Auto-Reply** (or whichever template was selected).
6. Click **Update filter**.

The Apps Script is now the sole reply path.

---

## 5. Test it (1 min)

Easiest end-to-end test:

1. From your personal Gmail (not Aron@trunorthapp.com), send an email to `support@trunorthapp.com` with subject `Test — billing question`.
2. Wait up to 5 minutes for the trigger to fire (or, in the Apps Script editor, manually run `processSupportInbox` to fire immediately).
3. Check your personal inbox — you should receive a personalized reply that:
   - Addresses you by first name
   - Uses the **billing** template (since "billing" was in the subject)
   - Comes from `Aron@trunorthapp.com` with display name `Aron Rosenfield`
4. In Aron's Gmail, the original thread should be **starred** and labeled `Support/Replied`.

Try variations to confirm the keyword routing:
- Subject `App keeps crashing` → bug template
- Subject `Interview request for podcast` → press template
- Subject `Feature idea: dark mode` → feature template
- Subject `Just saying hi` → generic template

---

## 6. Modifying templates later

Open the `.gs` file in the Apps Script editor and scroll to the **TEMPLATES** section. Each template is a JavaScript array of strings (joined with `\n` for line breaks). The `{{FIRSTNAME}}` token is replaced automatically.

To change keyword routing, edit the regexes inside `detectCategory_()`. First match wins, so order matters — higher-priority categories should appear first.

To swap the placeholder Calendly link, edit `CALENDLY_URL` at the top of the file.

---

## Troubleshooting

- **No replies going out?** Open the Apps Script editor → **Executions** (left sidebar) and inspect the most recent runs. Failed runs show the error inline.
- **Replies coming from the wrong address?** Confirm `Aron@trunorthapp.com` is set up as a **Send mail as** alias under Gmail → Settings → Accounts and Import. Apps Script can only send from verified aliases.
- **Threads being replied to twice?** Confirm the `Support/Replied` label exists (the script will auto-create it on first run). If you renamed it, update `REPLIED_LABEL` at the top of the script.
- **Script catching replies meant for Aron's own thread responses?** It only processes the FIRST message of each thread, and skips any thread that already has a sent message from `Aron@trunorthapp.com`. Safe.

---

## Quota notes

Google Apps Script consumer accounts get 100 emails/day via `GmailApp`. Workspace accounts get 1,500/day. At 5-min intervals capped at 25 threads/run, the upper bound is well under both limits.
