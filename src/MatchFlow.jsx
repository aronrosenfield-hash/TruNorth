// The Match (R2, brief flow B) — replaces the quiz grid forever.
// Eleven full-screen tension cards: one per scoring axis (politics gets a
// side card; labor gets a record card AND a unions side card) plus the
// dealbreakers finale. Two giant tap targets, skip as small text — never a
// third button. The compass draws itself in the corner, one spoke per
// answered axis, so the user literally watches their values take shape.
//
// NEUTRALITY BY CONSTRUCTION: side cards (politics, diversity, firearms,
// unions) render both options with IDENTICAL styling — the app must never
// look like it has a preferred answer. Record cards (pollution, wage theft,
// privacy, CEO pay, giving) may use primary/secondary styling because
// neither button is a political position.
//
// OUTPUT CONTRACT: onComplete receives the EXACT shape Quiz produced —
// { lean, deiLean, animalTesting, guns, unionSupport, weights, dealBreakers }
// — so computeScore, fingerprints, and profile persistence are untouched.
// Weights are DERIVED, never asked: Dealbreaker→5 (giving 4), Forgivable→2,
// skip→category default; stanced axes get the quiz's fixed 3.

import React, { useEffect, useMemo, useState } from "react";
import { T, SERIF, MONO } from "./lib/theme";
import { COMPASS_AXES } from "./CompassSeal";
import { track } from "./lib/analytics";

// Card order (2026-06-12 review): open with concrete, non-tribal RECORD
// trade-offs to build investment before any stance question — the partisan
// Democrats/Republicans card used to be slot 1, which contradicted the
// project's own "politics never first" research note and primed a partisan
// lens for every card after it. Politics now sits at slot 10, just before the
// dealbreaker finale. Output mapping is keyed by id/axis, not position, so the
// engine is unaffected; DRAFT_V is bumped so in-flight drafts don't restore a
// now-wrong index.
const CARDS = [
  { id: "environment", axis: "environment", kicker: "ENVIRONMENT", type: "record",
    serif: "A company pollutes — but it's the cheapest option on the shelf.",
    sub: "EPA penalties are public record. Price is price. Which decides?",
    forgive: 2, dealbreak: 5, skip: 3 },
  { id: "labor", axis: "labor", kicker: "WORKERS", type: "record",
    serif: "Wage theft on the federal record — but the product is great.",
    sub: "DOL and OSHA publish every violation. Which decides?",
    forgive: 2, dealbreak: 5, skip: 3 },
  { id: "unionSupport", axis: "labor", kicker: "UNIONS", type: "side",
    serif: "Where do you land on organized labor?",
    sub: "Union drives, elections, and disputes are NLRB public record.",
    a: { label: "Pro-union", value: "pro" }, b: { label: "Anti-union", value: "anti" },
    skipLabel: "no preference — skip" },
  { id: "charity", axis: "charity", kicker: "GIVING", type: "record",
    serif: "Billions in profit. Zero documented giving.",
    sub: "Foundation grants are IRS-990 public filings. Does it move you?",
    aLabel: "Doesn't bother me", bLabel: "It matters to me",
    forgive: 2, dealbreak: 4, skip: 2 },
  { id: "execPay", axis: "execPay", kicker: "CEO PAY", type: "record",
    serif: "The CEO makes a thousand times the median worker.",
    sub: "SEC proxy statements disclose the exact ratio. Does it change the purchase?",
    forgive: 2, dealbreak: 5, skip: 2 },
  { id: "deiLean", axis: "dei", kicker: "DIVERSITY", type: "side",
    serif: "Workplace diversity programs.",
    sub: "Some buyers seek them out. Some avoid them. The app takes no side — you do.",
    a: { label: "I support them", value: "pro" }, b: { label: "I avoid them", value: "anti" },
    skipLabel: "no preference — skip" },
  { id: "animalTesting", axis: "animals", kicker: "ANIMALS", type: "side",
    serif: "A great product — tested on animals.",
    sub: "Certifications and testing policies are documented. Still buying?",
    a: { label: "Not a priority", value: "prefer_not" }, b: { label: "I'm out", value: "dealbreaker" },
    skipLabel: "no preference — skip" },
  { id: "privacy", axis: "privacy", kicker: "PRIVACY", type: "record",
    serif: "The fine print sells your data.",
    sub: "FTC actions and breach records are public. Which decides?",
    forgive: 2, dealbreak: 5, skip: 2 },
  { id: "guns", axis: "guns", kicker: "FIREARMS", type: "side",
    serif: "Brands in the firearms business.",
    sub: "Federal firearms licenses are public. Which way do your dollars go?",
    a: { label: "I support them", value: "support" }, b: { label: "I avoid them", value: "avoid" },
    skipLabel: "no preference — skip" },
  { id: "political", axis: "political", kicker: "POLITICS", type: "side",
    serif: "Your money has a politics.",
    sub: "Brand PACs and executives fund campaigns — all on the federal record. Pick the side your dollars should favor.",
    a: { label: "Democrats", value: "left" }, b: { label: "Republicans", value: "right" },
    skipLabel: "independent / no preference — skip" },
  { id: "dealBreakers", kicker: "LINES", type: "multi",
    serif: "Lines you won't cross.",
    sub: "Brands with documented records here take a hard penalty for you. Skipping is fine.",
    opts: [
      { v: "forcedLabor", l: "Forced labor in supply chain" },
      { v: "childLabor", l: "Child labor in supply chain" },
      { v: "privacy", l: "Privacy abuse" },
      { v: "monopoly", l: "Monopoly behavior" },
      { v: "foreignOwn", l: "Foreign-owned parent company" },
    ] },
];

const DEFAULT_W = { political: 3, charity: 2, environment: 3, labor: 3, dei: 2, animals: 2, guns: 2, privacy: 2, execPay: 2 };

// Bump whenever the CARDS order or shape changes so a draft saved against the
// old layout is discarded rather than restoring a now-wrong card index.
const DRAFT_V = 2;

// Map an existing profile back onto card answers so a retake starts from
// what the user already told us (H10 parity with the old quiz).
function answersFromProfile(p) {
  if (!p) return {};
  const a = {};
  if (p.lean && p.lean !== "neutral" && p.lean !== "mixed") a.political = p.lean;
  if (p.unionSupport && p.unionSupport !== "neutral") a.unionSupport = p.unionSupport;
  if (p.deiLean && p.deiLean !== "neutral") a.deiLean = p.deiLean;
  if (p.animalTesting && p.animalTesting !== "neutral") a.animalTesting = p.animalTesting;
  if (p.guns && p.guns !== "neutral") a.guns = p.guns;
  const w = p.weights || {};
  for (const c of CARDS) {
    if (c.type !== "record") continue;
    const k = c.axis;
    if (typeof w[k] !== "number") continue;
    if (w[k] >= c.dealbreak) a[c.id] = "dealbreak";
    else if (w[k] <= c.forgive && w[k] < (DEFAULT_W[k] ?? 2)) a[c.id] = "forgive";
  }
  if (Array.isArray(p.dealBreakers) && p.dealBreakers.length) a.dealBreakers = [...p.dealBreakers];
  return a;
}

function buildProfile(answers) {
  const stance = (id) => answers[id] || "neutral";
  const rec = (id) => {
    const card = CARDS.find(c => c.id === id);
    if (answers[id] === "dealbreak") return card.dealbreak;
    if (answers[id] === "forgive") return card.forgive;
    return card.skip;
  };
  const deiLean = stance("deiLean"), animals = stance("animalTesting"), guns = stance("guns");
  return {
    lean: stance("political"),
    deiLean,
    animalTesting: animals,
    guns,
    unionSupport: stance("unionSupport"),
    weights: {
      political: DEFAULT_W.political,
      environment: rec("environment"),
      labor: rec("labor"),
      charity: rec("charity"),
      privacy: rec("privacy"),
      execPay: rec("execPay"),
      dei: deiLean !== "neutral" ? 3 : 2,
      animals: animals !== "neutral" ? 3 : 2,
      guns: guns !== "neutral" ? 3 : 2,
    },
    dealBreakers: Array.isArray(answers.dealBreakers) ? answers.dealBreakers : [],
  };
}

// The forming compass — spokes appear as axes get answered. A skipped axis
// draws dim (it exists, you just don't weight it); a chosen one draws in
// verdigris. The center dot fills bone when the finale is done.
function FormingCompass({ answers, size = 46 }) {
  const spokes = COMPASS_AXES.map((axis, i) => {
    const cards = CARDS.filter(c => c.axis === axis);
    const answered = cards.some(c => answers[c.id] !== undefined && answers[c.id] !== "__skip");
    const skipped = !answered && cards.every(c => answers[c.id] !== undefined);
    const ang = -Math.PI / 2 + (i / COMPASS_AXES.length) * Math.PI * 2;
    return { x: 50 + 38 * Math.cos(ang), y: 50 + 38 * Math.sin(ang), answered, skipped };
  });
  const doneCount = spokes.filter(s => s.answered || s.skipped).length;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-label={`Compass forming: ${doneCount} of 9 axes set`}>
      <circle cx="50" cy="50" r="44" fill="none" stroke="#23262C" strokeWidth="2" />
      {spokes.map((s, i) => (s.answered || s.skipped) && (
        <line key={i} x1="50" y1="50" x2={s.x} y2={s.y}
          stroke={s.answered ? "#38C0CE" : "#2A2E35"} strokeWidth={s.answered ? 4 : 2.5} strokeLinecap="round" />
      ))}
      <circle cx="50" cy="50" r="4" fill={answers.dealBreakers !== undefined ? "#EDE9E0" : "#6E6A60"} />
    </svg>
  );
}

export default function MatchFlow({ onComplete, onSkip, initialProfile = null }) {
  const [idx, setIdx] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem("tn_match_draft") || "{}");
      if (d.v !== DRAFT_V) return 0; // stale layout → start fresh
      // 2026-06-12 review: a corrupt/out-of-range idx restored here used to make
      // CARDS[idx] undefined → `card.kicker` TypeError → root-boundary "Try
      // again" re-read the same draft → permanent crash loop on first run.
      // Clamp into range.
      const i = Number(d.idx) || 0;
      return Math.min(Math.max(0, i), CARDS.length - 1);
    } catch { return 0; }
  });
  const [answers, setAnswers] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem("tn_match_draft") || "{}");
      if (d.v === DRAFT_V && d.answers && Object.keys(d.answers).length) return d.answers;
    } catch {}
    return answersFromProfile(initialProfile);
  });
  useEffect(() => {
    try { localStorage.setItem("tn_match_draft", JSON.stringify({ v: DRAFT_V, idx, answers, at: Date.now() })); } catch {}
  }, [idx, answers]);

  const card = CARDS[idx];
  const isLast = idx === CARDS.length - 1;

  const finish = (finalAnswers) => {
    try { localStorage.removeItem("tn_match_draft"); } catch {}
    try { localStorage.removeItem("tn_quiz_draft"); } catch {} // retire any old-quiz draft
    onComplete(buildProfile(finalAnswers));
  };
  const answer = (val) => {
    const next = { ...answers, [card.id]: val };
    // 2026-06-12 review: per-card instrumentation. MatchFlow had zero analytics,
    // so an abandonment cliff inside the 11 cards was undiagnosable (only
    // started/completed were tracked). choice is coarse (no PII).
    track("match_card_answered", {
      idx, id: card.id, axis: card.axis,
      choice: Array.isArray(val) ? `multi:${val.length}` : String(val),
      last: isLast,
    });
    setAnswers(next);
    if (isLast) finish(next);
    else setIdx(i => i + 1);
  };

  // Multi-select state for the finale renders from answers directly.
  const picked = useMemo(() => new Set(Array.isArray(answers.dealBreakers) ? answers.dealBreakers : []), [answers.dealBreakers]);
  const togglePick = (v) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    setAnswers(a => ({ ...a, dealBreakers: [...next] }));
  };

  const bigBtn = {
    width: "100%", padding: "17px 14px", borderRadius: 13, fontSize: 15, fontWeight: 700,
    cursor: "pointer", minHeight: 54, lineHeight: 1.2,
  };
  const inkBtn = { ...bigBtn, background: T.bg3, color: T.txt, border: `1px solid ${T.border2}` };
  const boneBtn = { ...bigBtn, background: "#EDE9E0", color: "#111", border: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)", overflow: "hidden", background: T.bg }}>
      {/* header: back · counter · forming compass */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", flexShrink: 0 }}>
        <button
          onClick={() => idx === 0 ? (onSkip && onSkip()) : setIdx(i => i - 1)}
          aria-label={idx === 0 ? "Exit the Match" : "Previous card"}
          style={{ background: "none", border: "none", color: T.txt3, fontSize: 22, cursor: "pointer", padding: "6px 10px 6px 0", minWidth: 44, minHeight: 44, textAlign: "left" }}>
          ‹
        </button>
        <span style={{ fontFamily: MONO, fontSize: 11, color: T.txt3, letterSpacing: "0.1em" }}>
          {String(idx + 1).padStart(2, "0")} / {String(CARDS.length).padStart(2, "0")}
        </span>
        <FormingCompass answers={answers} />
      </div>

      {/* the tension card */}
      <div key={idx} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "18px 22px", overflowY: "auto", WebkitOverflowScrolling: "touch", animation: "cardIn 0.28s ease" }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: T.gold, letterSpacing: "0.16em", marginBottom: 14 }}>{card.kicker}</div>
        <div style={{ fontFamily: SERIF, fontSize: 26, color: T.txt, lineHeight: 1.28, marginBottom: 10 }}>{card.serif}</div>
        <div style={{ fontSize: 13, color: T.txt2, lineHeight: 1.55 }}>{card.sub}</div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 10, padding: "22px 0 14px" }}>
          {card.type === "side" && (
            <>
              {/* IDENTICAL styling on both sides — neutrality is structural. */}
              <button style={inkBtn} onClick={() => answer(card.a.value)}>{card.a.label}</button>
              <button style={inkBtn} onClick={() => answer(card.b.value)}>{card.b.label}</button>
              <button onClick={() => answer("neutral")}
                style={{ background: "none", border: "none", color: T.txt3, fontSize: 11.5, cursor: "pointer", padding: "8px 0 0", textAlign: "center" }}>
                {card.skipLabel}
              </button>
            </>
          )}
          {card.type === "record" && (
            <>
              <button style={boneBtn} onClick={() => answer("forgive")}>{card.aLabel || "Forgivable"}</button>
              <button style={inkBtn} onClick={() => answer("dealbreak")}>{card.bLabel || "Dealbreaker"}</button>
              <button onClick={() => answer("__skip")}
                style={{ background: "none", border: "none", color: T.txt3, fontSize: 11.5, cursor: "pointer", padding: "8px 0 0", textAlign: "center" }}>
                no preference — skip
              </button>
            </>
          )}
          {card.type === "multi" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
                {card.opts.map(o => {
                  const on = picked.has(o.v);
                  return (
                    <button key={o.v} onClick={() => togglePick(o.v)} aria-pressed={on}
                      style={{ ...bigBtn, padding: "13px 14px", fontSize: 13.5, fontWeight: 600, textAlign: "left", background: on ? T.accentBg : T.bg3, color: on ? T.accent2 : T.txt, border: `1px solid ${on ? T.accent : T.border2}` }}>
                      {on ? "✓ " : ""}{o.l}
                    </button>
                  );
                })}
              </div>
              <button style={boneBtn} onClick={() => answer([...picked])}>
                {picked.size ? `Set ${picked.size} ${picked.size === 1 ? "line" : "lines"} — finish` : "Finish"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
