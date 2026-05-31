/**
 * Phase 5.ag — /api/og/brand
 *
 * Per-brand OG-image endpoint. Renders the brand name + your-personalized
 * grade as a 1200×630 PNG. When the URL omits `g` (grade), it renders the
 * brand-only card with a "See YOUR grade →" CTA — for cold share recipients
 * who haven't taken the quiz.
 *
 * /api/og/brand
 *   ?name=Patagonia
 *   &cat=Apparel
 *   &g=A           (single letter A|B|C|D|F — your personalized grade)
 *   &s=87          (numeric score 0-100, optional)
 *   &from=<hash>   (sharer attribution; not rendered, used for ?from= UTM)
 */

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const ACCENT2 = "#7c6dfa";
const BG = "#0f0f0f";
const BG2 = "#1a1a1a";
const TXT = "#f2f2f2";
const TXT2 = "#a8a8a8";
const TXT3 = "#666666";

const GRADE_COLORS = {
  A: { bg: "#0d2318", border: "#4caf82", text: "#4caf82", verdict: "Aligned with your values" },
  B: { bg: "#1a2810", border: "#8bc34a", text: "#8bc34a", verdict: "Mostly aligned with your values" },
  C: { bg: "#2a2210", border: "#f0a030", text: "#f0a030", verdict: "Mixed signals on your values" },
  D: { bg: "#2a1810", border: "#ff7043", text: "#ff7043", verdict: "Mostly clashes with your values" },
  F: { bg: "#2a0d0d", border: "#e24a4a", text: "#e24a4a", verdict: "Clashes with your values" },
  "?": { bg: "#1a1a1a", border: "#3a3a3a", text: TXT2, verdict: "" },
};

export default function handler(req) {
  const u = new URL(req.url);
  const name = (u.searchParams.get("name") || "this brand").slice(0, 60);
  const cat  = (u.searchParams.get("cat")  || "").slice(0, 40);
  const g    = (u.searchParams.get("g")    || "?").toUpperCase();
  const s    = u.searchParams.get("s");
  const grade = ["A","B","C","D","F"].includes(g) ? g : "?";
  const gc = GRADE_COLORS[grade];
  const hasGrade = grade !== "?";

  return new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          display: "flex", flexDirection: "column",
          width: "100%", height: "100%",
          background: `linear-gradient(135deg, ${BG} 0%, ${BG2} 100%)`,
          padding: 60, color: TXT, fontFamily: "Arial, sans-serif",
        },
        children: [
          // Header
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 50 },
              children: [
                { type: "div", props: { style: { fontSize: 36, fontWeight: 800 }, children: [
                  { type: "span", props: { style: { color: TXT }, children: "Tru" } },
                  { type: "span", props: { style: { color: ACCENT2 }, children: "North" } },
                ] } },
                { type: "div", props: { style: { fontSize: 18, color: TXT3, marginTop: 8 }, children: "where your money goes" } },
              ],
            },
          },
          // Grade hero
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: 40, flex: 1 },
              children: [
                // Big grade circle
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex", flexDirection: "column",
                      width: 240, height: 240, borderRadius: 120,
                      background: gc.bg, border: `6px solid ${gc.border}`,
                      alignItems: "center", justifyContent: "center", flexShrink: 0,
                    },
                    children: [
                      { type: "div", props: { style: { fontSize: 140, fontWeight: 800, color: gc.text, lineHeight: 1 }, children: grade } },
                      s && hasGrade
                        ? { type: "div", props: { style: { fontSize: 22, color: gc.text, opacity: 0.7, marginTop: 6 }, children: `${s}/100` } }
                        : null,
                    ].filter(Boolean),
                  },
                },
                // Brand name + verdict
                {
                  type: "div",
                  props: {
                    style: { display: "flex", flexDirection: "column", gap: 12, flex: 1 },
                    children: [
                      { type: "div", props: { style: { fontSize: 56, fontWeight: 700, lineHeight: 1.1 }, children: name } },
                      cat ? { type: "div", props: { style: { fontSize: 22, color: TXT3 }, children: cat } } : null,
                      hasGrade
                        ? { type: "div", props: { style: { fontSize: 26, color: gc.text, fontWeight: 600, marginTop: 12 }, children: gc.verdict } }
                        : { type: "div", props: { style: { fontSize: 24, color: TXT2, marginTop: 12, lineHeight: 1.3 }, children: "Two friends can see DIFFERENT grades for the same brand — based on what each cares about." } },
                    ].filter(Boolean),
                  },
                },
              ],
            },
          },
          // Footer CTA
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 30, paddingTop: 20, borderTop: "1px solid #2a2a2a" },
              children: [
                { type: "div", props: { style: { fontSize: 20, color: TXT3 }, children: hasGrade ? "Their grade — see YOURS." : "Take the values quiz to see your grade." } },
                { type: "div", props: { style: { display: "flex", padding: "12px 26px", background: ACCENT2, color: "#fff", borderRadius: 12, fontSize: 22, fontWeight: 700 }, children: "trunorthapp.com →" } },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      headers: {
        // Per-brand images are stable; cache aggressively
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    },
  );
}
