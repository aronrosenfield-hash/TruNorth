// The Compass — TruNorth's hero object (R1.1).
// Spec: docs/design/REDESIGN_BRIEF.md §2 "The Compass".
//
// GEOMETRY REVISION (2026-06-12, Aron's Adobe screenshot): the radar
// polygon collapses into a "what the hell is that" shard on real data —
// sparse axes (most brands score 3-6 of 9) and extreme scores (8s next to
// 97s) make concave fragments. A seal must ALWAYS look like a seal, at any
// data density. So:
//
//   VERDICT mode  → segmented RING: nine fixed arc slots (one per category,
//     order fixed clockwise from 12). Arc presence = data exists; arc color
//     = alignment (verdigris ramp); the single worst sub-threshold axis
//     renders oxblood (the clash); missing axes are faint dashed stubs.
//     Grade engraved serif center. A perfect circle every time.
//
//   IDENTITY mode → radar polygon (the user's own weights) — structurally
//     safe here: always 9 axes, weights bounded 1-5, convex by construction.
//     This is the shape Aron approved from the mockups, kept where it works.

import React from "react";
import { GRADE_COLORS, SERIF } from "./lib/theme";

export const COMPASS_AXES = ["political", "environment", "labor", "dei", "charity", "animals", "guns", "privacy", "execPay"];

const TAU = Math.PI * 2;
const CLASH_THRESHOLD = 25;

// SVG arc path for a ring segment (degrees from 12 o'clock, clockwise).
function arcPath(cx, cy, r, startDeg, endDeg) {
  const a0 = ((startDeg - 90) / 360) * TAU;
  const a1 = ((endDeg - 90) / 360) * TAU;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Alignment color ramp: low scores sit bone-muted, high scores verdigris.
// (Oxblood is reserved for the single clash axis — not a general ramp.)
function arcColor(v) {
  if (v >= 0.75) return { stroke: "#3DD6B5", opacity: 1 };
  if (v >= 0.55) return { stroke: "#3DD6B5", opacity: 0.62 };
  if (v >= 0.40) return { stroke: "#A9A498", opacity: 0.75 };
  return { stroke: "#A9A498", opacity: 0.45 };
}

export default function CompassSeal({
  weights,            // identity mode: {cat: 1..5}
  values,             // verdict mode: {cat: 0..100}; missing = no data
  grade,              // letter engraved center (verdict mode)
  size = 84,
  glow = false,
  title,
}) {
  const cx = 50, cy = 50;
  const isVerdict = !!values;

  if (isVerdict) {
    const R = 40, GAP = 6; // degrees of gap between segments
    const slot = 360 / COMPASS_AXES.length;
    const vals = COMPASS_AXES.map((k) => (typeof values[k] === "number" ? values[k] / 100 : null));

    // single worst sub-threshold axis = the clash
    let clashIdx = -1, worst = CLASH_THRESHOLD / 100;
    vals.forEach((v, i) => { if (v != null && v < worst) { worst = v; clashIdx = i; } });

    const gc = grade ? (GRADE_COLORS[grade] || GRADE_COLORS["?"]) : GRADE_COLORS["?"];

    return (
      <svg width={size} height={size} viewBox="0 0 100 100" role="img"
        aria-label={title || (grade ? `Compass verdict: grade ${grade}` : "Compass verdict")}
        style={glow ? { filter: "drop-shadow(0 0 16px rgba(61,214,181,0.28))" } : undefined}>
        {/* quiet base ring so the seal reads as one object before data */}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#1F2228" strokeWidth="7" />
        {COMPASS_AXES.map((k, i) => {
          const a0 = i * slot + GAP / 2, a1 = (i + 1) * slot - GAP / 2;
          const v = vals[i];
          if (v == null) {
            return <path key={k} d={arcPath(cx, cy, R, a0, a1)} fill="none"
              stroke="#2A2E35" strokeWidth="2.5" strokeDasharray="2.5 3" strokeLinecap="round" />;
          }
          if (i === clashIdx) {
            return <path key={k} d={arcPath(cx, cy, R, a0, a1)} fill="none"
              stroke="#E0524D" strokeWidth="7" strokeLinecap="round" />;
          }
          const c = arcColor(v);
          return <path key={k} d={arcPath(cx, cy, R, a0, a1)} fill="none"
            stroke={c.stroke} strokeOpacity={c.opacity} strokeWidth="7" strokeLinecap="round" />;
        })}
        {/* inner hairline frames the engraving */}
        <circle cx={cx} cy={cy} r={27} fill="none" stroke="#23262C" strokeWidth="1" />
        <text x={cx} y={cy + 9} textAnchor="middle" fontFamily={SERIF} fontSize="26" fill={gc.text}>{grade || "?"}</text>
      </svg>
    );
  }

  // ── identity mode: radar of the user's weights (full 9 axes, convex) ──
  const R = 42;
  const vals = COMPASS_AXES.map((k) => {
    const w = weights?.[k];
    return typeof w === "number" ? Math.max(0, Math.min(1, (w - 1) / 4)) * 0.8 + 0.2 : 0.45;
  });
  const pts = vals.map((v, i) => {
    const ang = -Math.PI / 2 + (i / vals.length) * TAU;
    const r = 0.2 * R + 0.8 * R * v;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  });
  const polygon = pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img"
      aria-label={title || "Your values compass"}
      style={glow ? { filter: "drop-shadow(0 0 16px rgba(61,214,181,0.28))" } : undefined}>
      <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke="#23262C" strokeWidth="1" />
      <polygon points={polygon} fill="rgba(61,214,181,0.10)" stroke="#3DD6B5" strokeWidth="2.2" strokeLinejoin="round" />
      <g stroke="#3DD6B5" strokeWidth="0.8" opacity="0.35">
        {pts.map((p, i) => <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} />)}
      </g>
      <circle cx={cx} cy={cy} r="3" fill="#EDE9E0" />
    </svg>
  );
}
