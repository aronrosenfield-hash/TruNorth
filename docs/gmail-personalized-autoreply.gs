/**
 * TruNorth Support — Personalized Auto-Reply
 * --------------------------------------------------------------------------
 * Replaces the static "Support Auto-Reply" canned response with a smart,
 * keyword-aware reply that addresses the sender by first name.
 *
 * HOW IT WORKS
 *   1. Time-based trigger fires every 5 minutes (configured via UI).
 *   2. Searches Gmail for unread threads labeled "Support" that have NOT
 *      yet been labeled "Support/Replied".
 *   3. For each thread, looks at the FIRST message (so we don't reply to
 *      mid-thread messages from Aron himself), pulls the sender's first
 *      name, detects a keyword category (billing / bug / press / feature
 *      / generic), and sends a personalized reply.
 *   4. Applies the "Support/Replied" sublabel + stars the thread so Aron
 *      knows it's awaiting his personal follow-up.
 *
 * SAFETY
 *   - Errors per-thread are caught + logged; the trigger keeps going.
 *   - Threads already containing a sent message from Aron are skipped
 *     (defense-in-depth on top of the Replied label).
 *
 * MODIFYING TEMPLATES
 *   - Scroll to the TEMPLATES section. Each function returns a plain-text
 *     body. Use \n for line breaks. {{FIRSTNAME}} is replaced automatically.
 * --------------------------------------------------------------------------
 */

// ===== CONFIG =================================================================

/** Email address replies are sent FROM. Must be a verified send-as alias. */
var FROM_ADDRESS = 'Aron@trunorthapp.com';

/** Display name shown as the sender. */
var FROM_NAME = 'Aron Rosenfield';

/** Subject prefix prepended to replies (Gmail will collapse threads). */
var REPLY_SUBJECT_PREFIX = 'Re: ';

/** Label applied to incoming support email (already exists in Aron's Gmail). */
var SUPPORT_LABEL = 'Support';

/** Sublabel applied after we reply, so we never double-reply. */
var REPLIED_LABEL = 'Support/Replied';

/** Max threads processed per trigger run (Apps Script quota guard). */
var MAX_THREADS_PER_RUN = 25;

/** Placeholder until Aron sets up a Calendly link. */
var CALENDLY_URL = 'https://calendly.com/trunorth/press'; // TODO: replace once live

/** Logo shown at the bottom of every HTML reply. Must be publicly fetchable. */
var LOGO_URL = 'https://www.trunorthapp.com/email-signature-logo.png';

/** Width the logo is displayed at, in pixels. */
var LOGO_WIDTH = 160;

// ===== ENTRY POINT ============================================================

/**
 * Main function. Wire this to a time-based trigger (every 5 min).
 */
function processSupportInbox() {
  var repliedLabel = getOrCreateLabel_(REPLIED_LABEL);

  // Gmail search: unread, labeled Support, NOT yet labeled Support/Replied.
  // Using -label: with the slash-form works for sublabels.
  var query = 'is:unread label:"' + SUPPORT_LABEL + '" -label:"' + REPLIED_LABEL + '"';
  var threads = GmailApp.search(query, 0, MAX_THREADS_PER_RUN);

  Logger.log('Found ' + threads.length + ' candidate thread(s).');

  for (var i = 0; i < threads.length; i++) {
    try {
      handleThread_(threads[i], repliedLabel);
    } catch (err) {
      // Per-thread defensive: log and continue so one bad message doesn't kill the run.
      Logger.log('ERROR on thread ' + threads[i].getId() + ': ' + err);
    }
  }
}

// ===== CORE LOGIC =============================================================

/**
 * Process a single thread: decide whether to reply, build the body, send it,
 * then label + star the thread.
 */
function handleThread_(thread, repliedLabel) {
  var messages = thread.getMessages();
  if (messages.length === 0) return;

  // Use the FIRST message — that's the customer's original email. Replying to
  // any later message risks responding to our own thread or to back-and-forth.
  var firstMsg = messages[0];

  // Defense-in-depth: if Aron has already sent anything in this thread,
  // skip it. Catches the case where the Replied label is missing but a
  // human reply went out.
  for (var i = 0; i < messages.length; i++) {
    var from = messages[i].getFrom().toLowerCase();
    if (from.indexOf(FROM_ADDRESS.toLowerCase()) !== -1) {
      Logger.log('Skipping thread ' + thread.getId() + ' — already has a reply from ' + FROM_ADDRESS);
      thread.addLabel(repliedLabel); // backfill the label so we don't re-check
      return;
    }
  }

  // Skip thread if its FIRST message isn't unread — that means we either
  // already saw it or Aron read it manually. The filter labels new mail
  // as unread, so an already-read first message = not a fresh ticket.
  if (!firstMsg.isUnread()) {
    Logger.log('Skipping thread ' + thread.getId() + ' — first message already read.');
    return;
  }

  var fromHeader = firstMsg.getFrom();
  var firstName = extractFirstName_(fromHeader);

  var subject = firstMsg.getSubject() || '';
  var bodySnippet = (firstMsg.getPlainBody() || '').substring(0, 500);
  var category = detectCategory_(subject, bodySnippet);

  Logger.log('Replying to "' + fromHeader + '" — name=' + firstName + ', category=' + category);

  var body = buildReplyBody_(category, firstName);
  var replySubject = REPLY_SUBJECT_PREFIX + stripRePrefix_(subject);

  // Use reply on the first message so Gmail keeps it threaded.
  // Specifying from + name routes it through the support alias.
  // IMPORTANT: the FIRST positional argument is the plain-text body — the
  // options object's `body` field is ignored by GmailMessage.reply(). Pass
  // the body positionally so the recipient doesn't get an empty reply.
  // htmlBody is a real option — that's where the logo-styled version lives.
  firstMsg.reply(body, {
    from: FROM_ADDRESS,
    name: FROM_NAME,
    subject: replySubject,
    htmlBody: buildHtmlReplyBody_(body)
  });

  // Mark thread as handled.
  thread.addLabel(repliedLabel);
  thread.markRead();        // optional: comment out if Aron prefers to manually mark read
  // Star so Aron's eye is drawn to threads awaiting a real personal reply.
  // (Gmail thread-level star surfaces in the Starred view.)
  GmailApp.starMessage(firstMsg);
}

// ===== FROM-HEADER PARSING ====================================================

/**
 * Extract a first name from a From header.
 *
 * Handles:
 *   "Jane Doe <jane@example.com>"       -> "Jane"
 *   "Doe, Jane <jane@example.com>"      -> "Jane"   (Last, First format)
 *   "jane@example.com"                  -> "Jane"   (capitalize local-part)
 *   "<jane@example.com>"                -> "Jane"
 *   ""                                  -> "there"  (graceful fallback)
 */
function extractFirstName_(fromHeader) {
  if (!fromHeader) return 'there';

  // Try "Display Name <email>" format
  var displayMatch = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<.+>\s*$/);
  if (displayMatch && displayMatch[1]) {
    var display = displayMatch[1].trim();
    // Skip if display is itself just an email (some clients do this).
    if (display.indexOf('@') === -1) {
      // Handle "Last, First" format used by some corporate mail systems.
      if (display.indexOf(',') !== -1) {
        var parts = display.split(',');
        if (parts.length >= 2 && parts[1].trim()) {
          return capitalize_(parts[1].trim().split(/\s+/)[0]);
        }
      }
      // Otherwise first token of display name.
      var firstToken = display.split(/\s+/)[0];
      if (firstToken) return capitalize_(firstToken);
    }
  }

  // Fall back to local-part of the email.
  var emailMatch = fromHeader.match(/([\w.+-]+)@[\w.-]+/);
  if (emailMatch && emailMatch[1]) {
    // Use the part before any dot or plus — "jane.doe" -> "jane".
    var local = emailMatch[1].split(/[.+_-]/)[0];
    if (local && !/^\d+$/.test(local)) return capitalize_(local);
  }

  return 'there';
}

/** Capitalize the first letter, lowercase the rest. */
function capitalize_(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Strip leading Re:/Fwd: so we don't end up with "Re: Re: Re: ...". */
function stripRePrefix_(subject) {
  return subject.replace(/^\s*(re|fwd|fw)\s*:\s*/i, '').trim();
}

// ===== KEYWORD CATEGORY DETECTION =============================================

/**
 * Decide which template to use based on subject + body snippet.
 * Order matters — first match wins, so put higher-priority categories first.
 */
function detectCategory_(subject, body) {
  var haystack = ((subject || '') + ' ' + (body || '')).toLowerCase();

  // Billing / refund — money topics get priority.
  if (/\b(billing|refund|charge|charged|invoice|payment|subscription|cancel|unsubscribe)\b/.test(haystack)) {
    return 'billing';
  }
  // Bug / broken — technical issues.
  if (/\b(bug|broken|crash|crashes|crashed|error|doesn'?t work|not working|glitch|freeze|frozen|stuck)\b/.test(haystack)) {
    return 'bug';
  }
  // Press / interview — media inquiries.
  if (/\b(press|interview|journalist|reporter|media|podcast|feature story|article)\b/.test(haystack)) {
    return 'press';
  }
  // Feature / suggestion — product feedback.
  if (/\b(feature|suggest|suggestion|idea|wishlist|wish list|request|improvement)\b/.test(haystack)) {
    return 'feature';
  }
  return 'generic';
}

// ===== TEMPLATES ==============================================================
// Modify the text below freely. {{FIRSTNAME}} is the only token replaced.
// Keep them in a warm, conversational tone matching Aron's voice.

/**
 * Wrap the plain-text body in styled HTML with a trailing TruNorth logo.
 * Plain-text version is the truth; this just adds visual polish + logo.
 */
function buildHtmlReplyBody_(plainBody) {
  // Escape HTML-unsafe chars in the plain-text body, then convert newlines
  // to <br> so the structure carries over visually.
  var escaped = String(plainBody)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  var htmlBody = escaped.replace(/\n/g, '<br>');

  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a1a1a;max-width:600px;">',
    '  <div>' + htmlBody + '</div>',
    '  <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e5e5e5;">',
    '    <a href="https://www.trunorthapp.com" style="display:inline-block;text-decoration:none;">',
    '      <img src="' + LOGO_URL + '" alt="TruNorth" width="' + LOGO_WIDTH + '" style="display:block;border:0;max-width:' + LOGO_WIDTH + 'px;height:auto;" />',
    '    </a>',
    '  </div>',
    '</div>'
  ].join('\n');
}

/** Build the final body string for a given category. */
function buildReplyBody_(category, firstName) {
  var template;
  switch (category) {
    case 'billing': template = TEMPLATE_BILLING; break;
    case 'bug':     template = TEMPLATE_BUG;     break;
    case 'press':   template = TEMPLATE_PRESS;   break;
    case 'feature': template = TEMPLATE_FEATURE; break;
    default:        template = TEMPLATE_GENERIC; break;
  }
  return template.replace(/\{\{FIRSTNAME\}\}/g, firstName);
}

var TEMPLATE_GENERIC = [
  'Hey {{FIRSTNAME}},',
  '',
  'This is Aron — founder of TruNorth, real human behind every reply from this address.',
  '',
  "Your email just landed. I read every one personally; you'll hear back within 24 hours, often a lot sooner.",
  '',
  "If it's time-sensitive, throw 'URGENT' in your subject line.",
  '',
  'A few things in the meantime:',
  '- The app lives at trunorthapp.com',
  '- Want early iOS access via TestFlight? Just ask in your reply.',
  '- Spotted bad data or a missing brand? The Submit tab takes 30 seconds.',
  '',
  'Honestly, hearing from real users is the best part of building this thing. Thanks for writing.',
  '',
  'Talk soon,',
  'Aron Rosenfield',
  'Founder, TruNorthApp LLC'
].join('\n');

var TEMPLATE_BILLING = [
  'Hey {{FIRSTNAME}},',
  '',
  "I see this is about billing — I'll prioritize it. Aron here, founder of TruNorth, replying personally.",
  '',
  "A couple of quick reassurances while I dig in:",
  "- Every refund request gets honored, no friction, no questions about 'why'.",
  "- I'll have a real answer (and any refund processed) within 24 hours, usually a lot faster.",
  "- If you can include the email tied to your account and roughly when the charge happened, that'll save us a round trip.",
  '',
  "If something feels broken or unfair about how you were charged, I want to know. That's on me to fix.",
  '',
  'Talk soon,',
  'Aron Rosenfield',
  'Founder, TruNorthApp LLC'
].join('\n');

var TEMPLATE_BUG = [
  'Hey {{FIRSTNAME}},',
  '',
  "Sounds like something's broken — I want to fix it fast. Aron here, founder of TruNorth.",
  '',
  'A few questions so I can reproduce it:',
  '1. Device + OS version (e.g. iPhone 15, iOS 18.2 — or Chrome on macOS)',
  '2. Where in the app did it happen? (Quiz, Search, a company page, Submit, etc.)',
  '3. What did you do right before it broke? Step-by-step is gold.',
  '4. A screenshot or screen recording if you can grab one — even a blurry one helps.',
  '',
  "I read every bug report personally and ship fixes fast. You'll hear back within 24 hours with either a fix or a workaround.",
  '',
  'Thanks for flagging this — bug reports from real users are the only way the app gets better.',
  '',
  'Talk soon,',
  'Aron Rosenfield',
  'Founder, TruNorthApp LLC'
].join('\n');

var TEMPLATE_PRESS = [
  'Hey {{FIRSTNAME}},',
  '',
  "Thanks for thinking of TruNorth — I'd love to chat. Aron here, founder.",
  '',
  'Quickest path: book a 20-min call at ' + CALENDLY_URL + ' and pick whatever slot works. I can do nights and weekends too — just reply and I\'ll send options.',
  '',
  'Quick backgrounder in case it helps you prep:',
  "TruNorth is a values-first shopping app — it tracks 12,000+ brands and scores ~2,900 of them across nine categories (politics, environment, labor, animal welfare, privacy, health, exec pay, charity, transparency) using only public records, so consumers can spend in line with what they actually care about. I built it solo after getting tired of spreadsheets and 47-tab research sessions every time I wanted to buy toothpaste. We launched publicly earlier this year and the data pipeline is fully open.",
  '',
  "Happy to share metrics, screenshots, founder story, or get into the methodology — whatever serves your piece. Just let me know the angle.",
  '',
  'Talk soon,',
  'Aron Rosenfield',
  'Founder, TruNorthApp LLC'
].join('\n');

var TEMPLATE_FEATURE = [
  'Hey {{FIRSTNAME}},',
  '',
  "I love this — keep going. Aron here, founder of TruNorth.",
  '',
  'Tell me more so I can figure out where it fits on the roadmap:',
  '1. What\'s the actual moment you wished this existed? (e.g. "I was standing in Target trying to decide between two brands and...")',
  '2. How often does this come up for you — daily, weekly, once-in-a-while?',
  "3. If I built it, what would 'great' look like? Describe the version that would actually change your behavior.",
  '',
  "I read every feature request personally and the best ones ship. Real-user input is genuinely how the roadmap gets prioritized — thanks for taking the time.",
  '',
  'Talk soon,',
  'Aron Rosenfield',
  'Founder, TruNorthApp LLC'
].join('\n');

// ===== LABEL HELPER ===========================================================

/**
 * Get a Gmail label by name, creating it (and any parent) if missing.
 * GmailApp.createLabel() handles slash-form nesting automatically.
 */
function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}

// ===== TRIGGER INSTALLER (run once manually) =================================

/**
 * Run this ONCE from the Apps Script editor to install the 5-minute trigger.
 * Safe to re-run — it removes any duplicate triggers for processSupportInbox
 * before creating a new one.
 */
function installTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processSupportInbox') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('processSupportInbox')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Trigger installed: processSupportInbox every 5 minutes.');
}

/**
 * Convenience: remove the trigger (e.g. to pause auto-replies temporarily).
 */
function uninstallTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'processSupportInbox') {
      ScriptApp.deleteTrigger(existing[i]);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' trigger(s).');
}
