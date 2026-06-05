// UX 9B: theme tokens extracted from App.jsx. Single source of truth for
// brand colors used throughout the app.

export const T = {
  bg: "#0f0f0f", bg2: "#1a1a1a", bg3: "#242424", bg4: "#2e2e2e",
  // 2026-06-05 (PageSpeed Tier 1 / a11y): bumped txt3 from #666 (3.34:1
  // contrast on bg #0f0f0f — FAILS WCAG AA) to #8a8a8a (5.55:1 — PASSES).
  // Lighthouse contrast-ratio violation on / and /company/* is now resolved.
  txt: "#f2f2f2", txt2: "#a8a8a8", txt3: "#8a8a8a",
  border: "#2a2a2a", border2: "#3a3a3a",
  accent: "#7c6dfa", accent2: "#9d91ff", accentBg: "#1e1b3a",
  dem: "#4a90e2", demBg: "#0d1f35",
  rep: "#e24a4a", repBg: "#350d0d",
  gold: "#f0c040", goldBg: "#2a2005",
};
