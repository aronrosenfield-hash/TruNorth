/**
 * UI regression guards (2026-06-11) — static locks for bugs that have
 * recurred across builds. ship-ios.sh runs this as a PREFLIGHT and refuses
 * to ship on failure, so these cannot silently revert again.
 *
 * Guard 1: global border-box. The quiz-reveal right-edge-cutoff bug
 *   (Builds ≤57) came from width:100%+maxWidth+padding cards defaulting to
 *   content-box. The global rule in src/index.css ends the class.
 * Guard 2: viewport zoom lock (accidental pinch left the WebView zoomed).
 * Guard 3: subset icon font (457KB full font must not sneak back).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("guard: global box-sizing border-box rule present in src/index.css", () => {
  const css = fs.readFileSync("src/index.css", "utf8");
  assert.match(css, /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;?\s*\}/,
    "GLOBAL border-box rule removed — the quiz-reveal right-edge-cutoff bug WILL return. See the comment in index.css.");
});

test("guard: viewport allows pinch-zoom (a11y) in index.html", () => {
  // 2026-06-14 (QA-9): the zoom lock was intentionally removed for a11y —
  // pinch-zoom is a WCAG requirement; input auto-zoom is handled via fontSize:16
  // on inputs, and Capacitor/WKWebView blocks pinch natively in the native app.
  // Guard INVERTED + scoped to the actual <meta viewport> tag (the old version
  // matched the explanatory comment text, a false positive). Catches anyone
  // re-adding user-scalable=no / maximum-scale to the viewport meta.
  const html = fs.readFileSync("index.html", "utf8");
  const viewportTag = (html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i) || [""])[0];
  assert.ok(!/user-scalable=no/.test(viewportTag) && !/maximum-scale/.test(viewportTag),
    "Viewport zoom lock re-added — pinch-zoom is a WCAG a11y requirement (QA-9). Remove user-scalable=no / maximum-scale from the viewport meta.");
});

test("guard: Civic Premium — the retired purple (#7c6dfa) never returns", () => {
  // R1 (2026-06-11): the old gray+purple skin is retired by the Compass
  // redesign (docs/design/REDESIGN_BRIEF.md). Any reappearance of the old
  // accent means a component was pasted from a pre-R1 commit.
  const files = ["src/App.jsx", "src/OnboardingFlow.jsx", "src/Methodology.jsx",
    "src/PrivacyPolicy.jsx", "src/SplashScreen.jsx", "src/lib/theme.js", "index.html"];
  for (const f of files) {
    const txt = fs.readFileSync(f, "utf8").toLowerCase();
    assert.ok(!txt.includes("#7c6dfa") && !txt.includes("#9d91ff"),
      `${f} contains the retired purple accent — use T.accent (verdigris) from lib/theme`);
  }
});

test("guard: subset icon font in use (not the 457KB full webfont)", () => {
  const main = fs.readFileSync("src/main.jsx", "utf8");
  assert.ok(main.includes("tabler-subset.css"), "main.jsx no longer imports the subset css");
  assert.ok(!main.includes("icons-webfont/dist/tabler-icons"), "full tabler webfont import is back (457KB)");
  assert.ok(fs.existsSync("src/assets/tabler-subset.woff2"), "subset woff2 missing");
});

test("guard: cards (width:100% + maxWidth + padding) declare EXPLICIT box-sizing", () => {
  // The reveal right-edge-cutoff bug recurs when a card is added with
  // width:100% + maxWidth + padding but no explicit boxSizing. The global
  // border-box rule (Guard 1) masks it in the web preview, but the native
  // WKWebView renders such a card content-box and shoves it ~30px past the
  // viewport (Aron re-reported on Build 76 — RevealEmailCapture had missed it).
  // Belt-and-suspenders: EVERY card matching that pattern must set boxSizing.
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const chunks = src.split("style={{");
  const offenders = [];
  for (let i = 1; i < chunks.length; i++) {
    const end = chunks[i].indexOf("}}");
    const seg = end >= 0 ? chunks[i].slice(0, end) : chunks[i].slice(0, 500);
    if (/width:\s*"100%"/.test(seg) && /maxWidth:\s*\d/.test(seg) && /padding:/.test(seg)
        && !/boxSizing:\s*"border-box"/.test(seg)) {
      offenders.push(seg.replace(/\s+/g, " ").trim().slice(0, 90));
    }
  }
  assert.equal(offenders.length, 0,
    `Card(s) with width:100%+maxWidth+padding missing explicit boxSizing (reveal right-edge cutoff pattern — see reveal-screen-overflow-guard):\n  ${offenders.join("\n  ")}`);
});
