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

test("guard: viewport zoom lock intact in index.html", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(/maximum-scale=1(\.0)?/.test(html) && /user-scalable=no/.test(html),
    "Viewport zoom lock removed — accidental pinch will leave the iOS WebView stuck zoomed (Build 55 bug).");
});

test("guard: subset icon font in use (not the 457KB full webfont)", () => {
  const main = fs.readFileSync("src/main.jsx", "utf8");
  assert.ok(main.includes("tabler-subset.css"), "main.jsx no longer imports the subset css");
  assert.ok(!main.includes("icons-webfont/dist/tabler-icons"), "full tabler webfont import is back (457KB)");
  assert.ok(fs.existsSync("src/assets/tabler-subset.woff2"), "subset woff2 missing");
});
