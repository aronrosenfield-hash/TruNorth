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

test("guard: no light-on-bright style pair below WCAG AA 4.5:1", () => {
  // 2026-07-21 sweep. Eight inline style pairs shipped below AA: six were
  // #fff on the verdigris accent (2.19:1) — primary CTAs, the filter-count
  // badge, the onboarding auth tab — and two were #fff on the party red
  // (3.83:1) on political-donation badges. White on a bright fill reads fine
  // on a designer's monitor and fails in daylight, which is exactly where an
  // in-store shopper uses this app. All now take the ink token (8.76:1 on the
  // accent, 5.00:1 on the party red).
  //
  // Computes real WCAG relative luminance rather than banning specific hexes,
  // so a NEW bright colour is covered automatically.
  const toRgb = (h) => {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const lum = (rgb) =>
    rgb.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4)))
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (f, b) => {
    const [l1, l2] = [lum(toRgb(f)), lum(toRgb(b))];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const theme = fs.readFileSync("src/lib/theme.js", "utf8");
  const T = {};
  for (const m of theme.matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{3,6})"/g)) T[m[1]] = m[2];

  const offenders = [];
  for (const file of ["src/App.jsx", "src/OnboardingFlow.jsx", "src/MarketingLanding.jsx"]) {
    const src = fs.readFileSync(file, "utf8");
    const local = {};
    const blk = src.match(/const C = \{([\s\S]*?)\n\};/);
    if (blk) for (const m of blk[1].matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)) local[m[1]] = m[2];
    const resolve = (e) => {
      e = e.trim().replace(/,$/, "");
      if (/^"#[0-9A-Fa-f]{3,6}"$/.test(e)) return e.replace(/"/g, "");
      let m = e.match(/^T\.(\w+)$/);
      if (m) return T[m[1]];
      m = e.match(/^C\.(\w+)$/);
      if (m) return local[m[1]];
      return null;
    };
    src.split("\n").forEach((line, i) => {
      const bg = line.match(/background:\s*([^,}]+)/);
      const fg = line.match(/(?<!background)\bcolor:\s*([^,}]+)/);
      if (!bg || !fg) return;
      const b = resolve(bg[1]);
      const c = resolve(fg[1]);
      if (!b || !c) return;
      const r = ratio(c, b);
      if (r < 4.5) offenders.push(`${file}:${i + 1}  ${c} on ${b} = ${r.toFixed(2)}:1`);
    });
  }
  assert.equal(
    offenders.length, 0,
    `Style pair(s) below WCAG AA 4.5:1 — use the ink token on bright fills:\n  ${offenders.join("\n  ")}`
  );
});

test("guard: every rendered grade letter uses ITS OWN colour (all 3 surfaces)", () => {
  // B-91 extension (2026-07-20). The original C-vs-amber guard only read
  // src/App.jsx, so it never looked at the other two surfaces that render grade
  // letters — and MarketingLanding was painting Shein's "C" with C.warn
  // (#E8A04C), which is D's amber, on the PUBLIC landing page. OnboardingFlow
  // had the same class of drift (a C in D's amber, both D rows in F's red).
  //
  // This resolves each demo's colour expression — a raw hex, a local design
  // token like C.warn, or GRADE_COLORS.X.text — and asserts it equals the
  // canonical colour for the grade actually being displayed.
  const canonical = { A: "#38C0CE", B: "#9CC98A", C: "#A9A498", D: "#E8A04C", F: "#E0524D" };
  const offenders = [];

  for (const file of ["src/MarketingLanding.jsx", "src/OnboardingFlow.jsx", "src/App.jsx"]) {
    const src = fs.readFileSync(file, "utf8");

    // Resolve that file's local design tokens (const C = { good: "#...", ... }).
    const tokens = {};
    const block = src.match(/const C = \{([\s\S]*?)\n\};/);
    if (block) {
      for (const line of block[1].split("\n")) {
        const t = line.match(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/);
        if (t) tokens[t[1]] = t[2].toUpperCase();
      }
    }

    // grade:"X" ... color:<expr>   (the demo-card shape on every surface)
    const re = /grade:\s*"([A-F])"\s*,\s*color:\s*([^,}\s]+)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const [, grade, expr] = m;
      let resolved = null;
      if (/^"#[0-9A-Fa-f]{6}"$/.test(expr)) resolved = expr.replace(/"/g, "").toUpperCase();
      else if (/^C\.\w+$/.test(expr)) resolved = tokens[expr.slice(2)] || null;
      else if (/^GRADE_COLORS\.([A-F])\.text$/.test(expr)) {
        const ref = expr.match(/^GRADE_COLORS\.([A-F])\.text$/)[1];
        resolved = canonical[ref];
      } else continue; // gradeTone(...)/helper calls are derived by construction
      if (resolved && resolved !== canonical[grade]) {
        offenders.push(`${file}: grade "${grade}" painted ${expr} = ${resolved}, want ${canonical[grade]}`);
      }
    }
  }

  assert.equal(
    offenders.length, 0,
    `A grade letter is rendered in ANOTHER grade's colour:\n  ${offenders.join("\n  ")}`
  );
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
