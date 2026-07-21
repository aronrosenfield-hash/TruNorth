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

test("guard: index.html carries the INLINE native-WKWebView overflow safety net", () => {
  // 2026-07-02: the bundled index.css box-sizing rule is empirically NOT reaching
  // some inline-styled cards in the native WKWebView → content-box → ~30px right-
  // edge cutoff that cascades to every screen (Aron re-reported on Build 77 basket
  // screens). The fix is an INLINE <style> in index.html <head> (can't be missed
  // like the bundle) + a document-level overflow-x clamp. Removing it brings the
  // whole-app-sideways-shift back on device even though the web preview looks fine.
  const html = fs.readFileSync("index.html", "utf8");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /<style>[^<]*box-sizing:\s*border-box/,
    "index.html <head> lost its INLINE box-sizing rule — the native WKWebView right-edge cutoff returns (bundled index.css doesn't reliably reach native).");
  assert.match(head, /<style>[^<]*overflow-x:\s*hidden/,
    "index.html <head> lost its INLINE overflow-x:hidden clamp — a wide card can shift the whole app sideways in native again.");
});

test("guard: no two brands share a name with CONTRADICTORY grades (the 'Exxon is a D and a B' bug)", () => {
  // 2026-07-03 (diligence review): ExxonMobil shipped as exxon=F / exxon-mobil=D
  // / exxonmobil=B — the SAME company at three grades. One search screenshot
  // refutes the "objective public records" positioning. dedup-brands.mjs merged
  // them (canonical = best-evidenced entry). This guard fails the build if any
  // two index entries normalize to the same company name AND carry divergent
  // non-"?" letter grades, so the class can never ship again. Same-name entries
  // that AGREE (or are "?") are allowed — only contradictions fail.
  const idx = JSON.parse(fs.readFileSync("public/data/index.json", "utf8"));
  const arr = Array.isArray(idx) ? idx : (idx.companies || Object.values(idx));
  const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\b(incorporated|inc|corp|corporation|company|co|holdings|holding|group|plc|ltd|limited|llc|the)\b/g, " ")
    .replace(/\s+/g, "");
  const byName = {};
  for (const c of arr) { const n = norm(c.name); if (n && n.length >= 3) (byName[n] = byName[n] || []).push(c); }
  const offenders = Object.entries(byName)
    .map(([k, v]) => [k, [...new Set(v.filter(c => c.grade && c.grade !== "?").map(c => c.grade))], v])
    .filter(([, grades]) => grades.length > 1)
    .map(([k, grades, v]) => `  "${k}" → ${v.map(c => `${c.slug}=${c.grade}`).join(", ")}`);
  assert.equal(offenders.length, 0,
    `Duplicate companies with contradictory grades (run scripts/dedup-brands.mjs):\n${offenders.join("\n")}`);
});

test("guard: landing + onboarding DEMO grades match the live data (no marketing/app drift)", () => {
  // 2026-07-03 (diligence): the landing DemoCard + OnboardingFlow demo showed
  // Costco A / Shein D while the app actually graded them B / C — a trust
  // product with provably-wrong sample grades on its own front door. This locks
  // the demo top-line grades to index.json so they can't silently drift again.
  const idx = JSON.parse(fs.readFileSync("public/data/index.json", "utf8"));
  const arr = Array.isArray(idx) ? idx : (idx.companies || Object.values(idx));
  const bySlug = Object.fromEntries(arr.map(c => [c.slug, c]));
  const DEMOS = { Costco: "costco", Tesla: "tesla", Shein: "shein" };
  const mismatches = [];
  for (const f of ["src/MarketingLanding.jsx", "src/OnboardingFlow.jsx"]) {
    const src = fs.readFileSync(f, "utf8");
    for (const [name, slug] of Object.entries(DEMOS)) {
      const m = src.match(new RegExp(`name:\\s*"${name}"[^}]*?grade:\\s*"([A-F])"`));
      if (!m) continue; // brand isn't used as a demo in this file
      const real = bySlug[slug]?.grade;
      if (real && m[1] !== real) mismatches.push(`${f}: ${name} shows ${m[1]}, data says ${real}`);
    }
  }
  assert.equal(mismatches.length, 0,
    `Marketing/onboarding demo grades drifted from index.json:\n  ${mismatches.join("\n  ")}`);
});

test("guard: no new hand-written grade palettes in App.jsx (B-91)", () => {
  // B-91 (2026-07-20): App.jsx carried FIVE hand-written copies of the A-F
  // palette. None of the A-F values had drifted yet — but OnboardingFlow's copy
  // HAD, rendering a C in D's amber and both D rows in F's red, so the very
  // first screen a user sees contradicted the app's own colour scale. Duplicated
  // palettes drift; that is what they do. All five now derive from GRADE_COLORS
  // via gradeChip() / gradeChipHero() in src/lib/theme.js.
  //
  // This bans the SHAPE that regresses it: an object literal keyed A/B/C/D/F
  // whose values are raw grade hexes. Deriving from GRADE_COLORS still passes.
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const GRADE_HEX = ["#38C0CE", "#9CC98A", "#A9A498", "#E8A04C", "#E0524D"];
  const offenders = [];
  for (const letter of ["A", "B", "C", "D", "F"]) {
    for (const hex of GRADE_HEX) {
      // e.g.  A: { bg:"#0E2126", text:"#38C0CE" }   or   A: { color:"#38C0CE"
      const re = new RegExp(`\\b${letter}:\\s*\\{[^}]*(?:text|color|bg|background)\\s*:\\s*"${hex}"`);
      if (re.test(src)) offenders.push(`${letter}: { …"${hex}" }`);
    }
  }
  assert.equal(
    offenders.length, 0,
    "New hand-written grade palette in App.jsx — derive from GRADE_COLORS " +
      `(gradeChip/gradeChipHero in src/lib/theme.js) instead:\n  ${offenders.join("\n  ")}`
  );
});

test("guard: the C grade never renders in D's amber (#E8A04C) — C is bone-gray", () => {
  // 2026-07-04 (diligence): grade badges hand-inlined C and D BOTH as #E8A04C
  // amber, so a "mixed" C and a "below-average" D were indistinguishable in a
  // color-coded-grade product. C is now bone-gray (#A9A498 / T.txt2). This bans
  // C from ever taking D's amber again across the ~9 inlined grade palettes.
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const offenders = [];
  if (/C:\s*"#E8A04C"/.test(src)) offenders.push('flat map  C:"#E8A04C"');
  if (/C:\s*\{[^}]*(?:text|color):\s*"#E8A04C"/.test(src)) offenders.push('object    C:{ …:"#E8A04C" }');
  if (/grade:\s*"C"[^}]*color:\s*"#E8A04C"/.test(src)) offenders.push('legend    grade:"C" … color:"#E8A04C"');
  assert.equal(offenders.length, 0,
    `C grade is using D's amber (#E8A04C) — it must be bone-gray #A9A498:\n  ${offenders.join("\n  ")}`);
});
