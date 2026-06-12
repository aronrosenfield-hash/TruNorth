// The Compass — TruNorth's hero object (R1: static radar seal).
// Spec: docs/design/REDESIGN_BRIEF.md §2 "The Compass". Aron picked the
// radar-polygon geometry (2026-06-11). R1 ships the STATIC seal — the
// motion/haptic set (needle settle, stroke draw) is R3.
//
// Two modes:
//   <CompassSeal weights={profile.weights..} />          — identity seal:
//     spoke length = the user's per-category weight (your values' shape).
//   <CompassSeal values={{political:72,…}} grade="D" />  — verdict seal:
//     spoke length = brand alignment per axis (0-100); the single worst
//     axis below the clash threshold fractures oxblood; the letter grade
//     engraves in the center (serif).
//
// Axis order is FIXED (brief): political, environment, labor, dei,
// charity, animals, guns, privacy, execPay — so two seals are always
// visually comparable.

import React from "react";
import { GRADE_COLORS, SERIF } from "./lib/theme";

export const COMPASS_AXES = ["political", "environment", "labor", "dei", "charity", "animals", "guns", "privacy", "execPay"];

const TAU = Math.PI * 2;
const CLASH_THRESHOLD = 25; // axis value below this fractures oxblood

function spokePoints(vals, cx, cy, R) {
  return vals.map((v, i) => {
    const ang = -Math.PI / 2 + (i / vals.length) * TAU; // start at 12 o'clock
    const r = 0.18 * R + 0.82 * R * Math.max(0.06, Math.min(1, v)); // floor so the shape never collapses
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  });
}

export default function CompassSeal({
  weights,            // identity mode: {cat: 1..5}
  values,             // verdict mode: {cat: 0..100} (missing axes render short+muted)
  grade,              // optional letter engraved center (verdict mode)
  size = 84,
  glow = false,       // verdigris drop-glow (reveal moment)
  title,              // a11y label
}) {
  const cx = 50, cy = 50, R = 42;
  const isVerdict = !!values;

  const vals = COMPASS_AXES.map((k) => {
    if (isVerdict) {
      const v = values[k];
      return typeof v === "number" ? v / 100 : null; // null = no data on axis
    }
    const w = weights?.[k];
    return typeof w === "number" ? Math.max(0, Math.min(1, (w - 1) / 4)) * 0.8 + 0.2 : 0.45;
  });

  const pts = spokePoints(vals.map((v) => (v == null ? 0.10 : v)), cx, cy, R);
  const polygon = pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ");

  // Verdict mode: find the single worst real axis under the threshold.
  let clashIdx = -1;
  if (isVerdict) {
    let worst = CLASH_THRESHOLD / 100;
    vals.forEach((v, i) => { if (v != null && v < worst) { worst = v; clashIdx = i; } });
  }

  const gc = grade ? (GRADE_COLORS[grade] || GRADE_COLORS["?"]) : null;
  const stroke = "#3DD6B5";

  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100" role="img"
      aria-label={title || (grade ? `Compass verdict: grade ${grade}` : "Your values compass")}
      style={glow ? { filter: "drop-shadow(0 0 16px rgba(61,214,181,0.28))" } : undefined}
    >
      {/* outer ring */}
      <circle cx={cx} cy={cy} r={R + 4} fill="none" stroke="#23262C" strokeWidth="1" />
      {/* the seal */}
      <polygon
        points={polygon}
        fill="rgba(61,214,181,0.10)"
        stroke={stroke}
        strokeWidth={isVerdict ? 1.8 : 2.2}
        strokeLinejoin="round"
        opacity={isVerdict ? 0.85 : 1}
      />
      {/* faint spokes for structure */}
      <g stroke={stroke} strokeWidth="0.8" opacity="0.35">
        {pts.map((p, i) => (vals[i] == null ? null : <line key={i} x1={cx} y1={cy} x2={p[0]} y2={p[1]} />))}
      </g>
      {/* missing axes: muted stubs (honesty — no data ≠ low score) */}
      <g stroke="#2A2E35" strokeWidth="1.2" strokeDasharray="2 2">
        {vals.map((v, i) => {
          if (v != null) return null;
          const ang = -Math.PI / 2 + (i / vals.length) * TAU;
          return <line key={i} x1={cx} y1={cy} x2={cx + 0.5 * R * Math.cos(ang)} y2={cy + 0.5 * R * Math.sin(ang)} />;
        })}
      </g>
      {/* clash fracture: worst sub-threshold axis in oxblood */}
      {clashIdx >= 0 && (() => {
        const ang = -Math.PI / 2 + (clashIdx / vals.length) * TAU;
        const x2 = cx + R * Math.cos(ang), y2 = cy + R * Math.sin(ang);
        const mx = cx + 0.72 * R * Math.cos(ang), my = cy + 0.72 * R * Math.sin(ang);
        const px = -Math.sin(ang) * 5, py = Math.cos(ang) * 5;
        return (
          <g stroke="#E0524D" strokeLinecap="round">
            <line x1={cx} y1={cy} x2={x2} y2={y2} strokeWidth="2.6" />
            <line x1={mx - px} y1={my - py} x2={mx + px} y2={my + py} strokeWidth="1.8" />
          </g>
        );
      })()}
      {/* center: grade engraving (verdict) or hub (identity) */}
      {grade ? (
        <text x={cx} y={cy + 8} textAnchor="middle" fontFamily={SERIF} fontSize="24" fill={gc.text}>{grade}</text>
      ) : (
        <circle cx={cx} cy={cy} r="3" fill="#EDE9E0" />
      )}
    </svg>
  );
}
