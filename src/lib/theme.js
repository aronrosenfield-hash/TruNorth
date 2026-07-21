// Civic Premium tokens (R1, 2026-06-11) — the Compass redesign skin.
// Spec: docs/design/REDESIGN_BRIEF.md §2. Single source of truth.
//
// Rules: verdigris + oxblood are VERDICT colors only — never decoration.
// Brass marks anything sourced from a public record. Everything else is
// ink and bone. (The old gray+purple palette is retired;
// scripts/ui-guards.test.mjs bans the purple from ever returning.)

export const T = {
  // ink scale (warm near-blacks)
  bg: "#0E0F12", bg2: "#16181D", bg3: "#1F2228", bg4: "#262A31",
  // bone scale (warm paper, not white). txt3 stays ≥4.5:1 on bg for WCAG AA
  // (the 2026-06-05 contrast fix carries over — do not darken below #9A94).
  txt: "#EDE9E0", txt2: "#A9A498", txt3: "#9A9489",
  border: "#23262C", border2: "#2A2E35",
  // verdigris — THE signal color (alignment, compass, progress, links)
  accent: "#38C0CE", accent2: "#5CD6E0", accentBg: "#0E2126",
  // party colors stay semantic (donation facts, not verdicts)
  dem: "#4A90E2", demBg: "#0D1F35",
  // oxblood — clash/violations only
  rep: "#E0524D", repBg: "#291110",
  // brass — records, citations, ledger accents (was gold)
  gold: "#C9A86A", goldBg: "#241D10",
};

// Type system (brief §2): serif = the verdict/identity voice; mono = the
// trust texture for receipts, dates, dollars, ratios, grades-in-ledgers.
export const SERIF = "ui-serif, 'New York', Georgia, 'Times New Roman', serif";
export const MONO = "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace";

// Grade palette — engraving colors for seals/chips. A=verdigris (aligned),
// F=oxblood (clash); B/C/D are bone-and-amber neutrals, NOT signal colors.
export const GRADE_COLORS = {
  A: { text: "#38C0CE", bg: "#0E2126", border: "#1E444A" },
  B: { text: "#9CC98A", bg: "#19230F", border: "#2E4A1E" },
  C: { text: "#A9A498", bg: "#1F2228", border: "#2A2E35" },
  D: { text: "#E8A04C", bg: "#241B0D", border: "#4A381E" },
  F: { text: "#E0524D", bg: "#291110", border: "#4A1E1E" },
  // 2026-07-20 (v1.2 review): "?" is the MOST-rendered grade state in the app
  // (9,776 of 12,833 brands) and #6E6A60 on #16181D is 2.95:1 — below WCAG AA
  // for small text. Raised to the txt3 token (~5.3:1), which also stops this
  // from disagreeing with the other places "?" is drawn.
  "?": { text: "#9A9489", bg: "#16181D", border: "#23262C" },
};

// B-91 — derive every grade chip from GRADE_COLORS above.
//
// App.jsx carried FIVE hand-written copies of this palette. None of the A-F
// values had drifted yet, but OnboardingFlow's copy HAD (it rendered a C in
// D's amber and both D rows in F's red, so the very first screen contradicted
// the app's own colour scale). Duplicated palettes drift; that is what they do.
// These helpers give every call site one source of truth.

/** Standard grade chip: muted border. Used in lists, rows and shelves. */
export function gradeChip(grade) {
  const g = GRADE_COLORS[grade] || GRADE_COLORS["?"];
  return { bg: g.bg, border: g.border, text: g.text };
}

/**
 * Hero variant — the border takes the GRADE colour rather than the muted
 * border, for the large badge on the brand detail card. Deliberately different
 * from gradeChip(); it is emphasis, not drift.
 */
export function gradeChipHero(grade) {
  const g = GRADE_COLORS[grade] || GRADE_COLORS["?"];
  return { bg: g.bg, border: g.text, text: g.text };
}

/** Just the letter colour — for call sites that only need text. */
export function gradeColor(grade) {
  return (GRADE_COLORS[grade] || GRADE_COLORS["?"]).text;
}
