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
 *     ?p / &d / &a / &g   accepted but IGNORED since 2026-08-26 — these were
 *                         the political / DEI / animals / firearms stance
 *                         chips, removed as anti-pattern #4. Old share links
 *                         still render; the chips just no longer appear.
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

const ACCENT  = "#5CD6E0";
const ACCENT2 = "#38C0CE";
const BG      = "#0E0F12";
const BG2     = "#16181D";
const TXT     = "#EDE9E0";
const TXT2    = "#A9A498";
const TXT3    = "#6E6A60";
const GREEN   = "#9CC98A";
const GOLD    = "#C9A86A";

// 2026-08-26 — stance chips REMOVED (locked stickiness anti-pattern #4).
// This card is built to be shared publicly. It used to print the user's
// political lean ("Progressive"/"Conservative"), DEI stance, and firearms
// stance as coloured chips, which turns a shopping tool into a broadcast of
// someone's political identity. The share card reports OUTCOMES and how much
// each issue matters to the user — never which side they are on.
// LEAN_LABEL / DEI_LABEL / ANIMAL_LABEL / GUN_LABEL deleted with it.

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


export default function handler(req) {
  const u = new URL(req.url);
  // p / d / a / g (political lean, DEI, animals, firearms stances) are no
  // longer read — see the anti-pattern note above. Share URLs already in the
  // wild still carry them; unknown params are simply ignored, so old links
  // keep rendering, just without the stance chips.
  const env = parseInt(u.searchParams.get("env") || "3", 10);
  const lab = parseInt(u.searchParams.get("lab") || "3", 10);
  const pri = parseInt(u.searchParams.get("pri") || "3", 10);
  const exp = parseInt(u.searchParams.get("exp") || "3", 10);
  const cha = parseInt(u.searchParams.get("cha") || "3", 10);
  const top = u.searchParams.get("top") || "";


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
          // Single full-width body: how much each issue matters. The former
          // "My stances" column was removed 2026-08-26 (anti-pattern #4).
          {
            type: "div",
            props: {
              style: { display: "flex", gap: 40, flex: 1 },
              children: [
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
