/**
 * Phase 5.ag — /api/og/values
 *
 * Serverless OG-image endpoint that renders a user's values fingerprint
 * as a 1200×630 PNG suitable for Twitter cards, Open Graph previews,
 * Instagram Stories, etc.
 *
 * Encoded via querystring so the URL is fully cacheable:
 *
 *   /api/og/values
 *     ?p=political     (lean: left|right|neutral)
 *     &d=dei           (pro|anti|neutral)
 *     &a=animals       (dealbreaker|prefer_not|neutral)
 *     &g=guns          (avoid|support|neutral)
 *     &u=union         (pro|anti|neutral)
 *     &env=4           (importance 0–5)
 *     &lab=5           (importance 0–5)
 *     &pri=4
 *     &exp=3
 *     &cha=2
 *     &top=BrandName   (their top-matched brand, URL-encoded)
 *
 * Built with @vercel/og (Edge runtime, Satori under the hood, fast).
 */

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const ACCENT  = "#9d91ff";
const ACCENT2 = "#7c6dfa";
const BG      = "#0f0f0f";
const BG2     = "#1a1a1a";
const TXT     = "#f2f2f2";
const TXT2    = "#a8a8a8";
const TXT3    = "#666666";
const GREEN   = "#4caf82";
const GOLD    = "#f0c040";

const LEAN_LABEL = {
  left:    { label: "Progressive",   color: "#4a90e2" },
  right:   { label: "Conservative",  color: "#e24a4a" },
  neutral: { label: "Independent",   color: TXT2     },
};
const DEI_LABEL = {
  pro:     { label: "Pro-DEI",   color: GREEN },
  anti:    { label: "Anti-DEI",  color: "#e24a4a" },
  neutral: { label: "Neutral",   color: TXT2 },
};
const ANIMAL_LABEL = {
  dealbreaker: { label: "Cruelty-free", color: GREEN },
  prefer_not:  { label: "Prefers CF",   color: "#8bc34a" },
  neutral:     { label: "Neutral",      color: TXT2 },
};
const GUN_LABEL = {
  avoid:   { label: "Anti-firearms",  color: "#e24a4a" },
  support: { label: "Pro-2A",         color: "#4a90e2" },
  neutral: { label: "Neutral",        color: TXT2 },
};

function bar({ label, value, max = 5, color = ACCENT }) {
  const pct = Math.max(0, Math.min(1, (value || 0) / max));
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", gap: 4, width: "100%" },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", fontSize: 16, color: TXT2 },
            children: [
              { type: "div", props: { style: { flex: 1 }, children: label } },
              { type: "div", props: { style: { color, fontWeight: 700 }, children: `${value}/${max}` } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", height: 10, background: "#2a2a2a", borderRadius: 5, overflow: "hidden" },
            children: [
              { type: "div", props: { style: { width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 5 } } },
            ],
          },
        },
      ],
    },
  };
}

function chip({ label, color }) {
  return {
    type: "div",
    props: {
      style: { display: "flex", padding: "6px 14px", borderRadius: 8, background: `${color}22`, border: `1.5px solid ${color}55`, color, fontSize: 18, fontWeight: 600 },
      children: label,
    },
  };
}

export default function handler(req) {
  const u = new URL(req.url);
  const p = u.searchParams.get("p") || "neutral";
  const d = u.searchParams.get("d") || "neutral";
  const a = u.searchParams.get("a") || "neutral";
  const g = u.searchParams.get("g") || "neutral";
  const env = parseInt(u.searchParams.get("env") || "3", 10);
  const lab = parseInt(u.searchParams.get("lab") || "3", 10);
  const pri = parseInt(u.searchParams.get("pri") || "3", 10);
  const exp = parseInt(u.searchParams.get("exp") || "3", 10);
  const cha = parseInt(u.searchParams.get("cha") || "3", 10);
  const top = u.searchParams.get("top") || "";

  const lean = LEAN_LABEL[p] || LEAN_LABEL.neutral;
  const dei  = DEI_LABEL[d]  || DEI_LABEL.neutral;
  const ani  = ANIMAL_LABEL[a] || ANIMAL_LABEL.neutral;
  const gun  = GUN_LABEL[g]  || GUN_LABEL.neutral;

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
          // Header — brand mark
          {
            type: "div",
            props: {
              style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 30 },
              children: [
                { type: "div", props: { style: { display: "flex", fontSize: 36, fontWeight: 800 }, children: [
                  { type: "span", props: { style: { color: TXT }, children: "Tru" } },
                  { type: "span", props: { style: { color: ACCENT2 }, children: "North" } },
                ] } },
                { type: "div", props: { style: { fontSize: 18, color: TXT3, marginTop: 8 }, children: "values fingerprint" } },
              ],
            },
          },
          // Headline
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 },
              children: [
                { type: "div", props: { style: { fontSize: 44, fontWeight: 700, lineHeight: 1.1 }, children: "Here's what matters to me." } },
                top
                  ? { type: "div", props: { style: { display: "flex", fontSize: 22, color: TXT2 }, children: [
                      { type: "span", props: { children: "Top match: " } },
                      { type: "span", props: { style: { color: GREEN, fontWeight: 700, marginLeft: 6 }, children: top } },
                    ] } }
                  : { type: "div", props: { style: { display: "flex", fontSize: 22, color: TXT2 }, children: "Take the 60-second quiz to see yours." } },
              ],
            },
          },
          // Two-column body: stances (left) + scale bars (right)
          {
            type: "div",
            props: {
              style: { display: "flex", gap: 40, flex: 1 },
              children: [
                // Stances column
                {
                  type: "div",
                  props: {
                    style: { display: "flex", flexDirection: "column", gap: 12, width: 360 },
                    children: [
                      { type: "div", props: { style: { fontSize: 14, color: TXT3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }, children: "My stances" } },
                      chip({ label: `Politics: ${lean.label}`, color: lean.color }),
                      chip({ label: `DEI: ${dei.label}`,       color: dei.color  }),
                      chip({ label: `Animals: ${ani.label}`,   color: ani.color  }),
                      chip({ label: `Firearms: ${gun.label}`,  color: gun.color  }),
                    ],
                  },
                },
                // Scales column
                {
                  type: "div",
                  props: {
                    style: { display: "flex", flexDirection: "column", gap: 18, flex: 1 },
                    children: [
                      { type: "div", props: { style: { fontSize: 14, color: TXT3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }, children: "How much it matters" } },
                      bar({ label: "Environment", value: env, color: GREEN }),
                      bar({ label: "Labor",       value: lab, color: ACCENT }),
                      bar({ label: "Privacy",     value: pri, color: ACCENT }),
                      bar({ label: "Exec Pay",    value: exp, color: GOLD }),
                      bar({ label: "Charity",     value: cha, color: GREEN }),
                    ],
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
                { type: "div", props: { style: { fontSize: 18, color: TXT3 }, children: "trunorthapp.com — what matters, in your wallet" } },
                { type: "div", props: { style: { display: "flex", padding: "10px 22px", background: ACCENT, color: "#000", borderRadius: 10, fontSize: 20, fontWeight: 700 }, children: "Take the quiz →" } },
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
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
