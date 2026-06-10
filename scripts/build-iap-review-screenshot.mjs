#!/usr/bin/env node
/**
 * App Store Connect IAP Review Screenshot generator.
 *
 * Apple's IAP review requires a 1024×1024 image showing what users see
 * when they trigger the subscription. This script generates a clean
 * paywall mockup that mirrors the in-app PaywallScreen UI.
 *
 * 2026-06-10 (X-2): shipped for the TruNorth Pro Annual + Monthly IAP
 * submissions. One image works for both — the only thing that changes
 * between them is the headline price, but Apple just wants to see the
 * paywall context, not exact per-plan screenshots.
 *
 * Output: docs/marketing/iap-review/paywall-1024.png
 */

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "docs/marketing/iap-review");

// Apple's IAP Review Screenshot requires iPhone-format dimensions, not
// a 1024×1024 square (that's for the promotional Image field). Using the
// iPhone 6.5" / 11 Pro Max format which Apple accepts universally for
// review screenshots regardless of newer device sizes.
const W = 1242;
const H = 2688;

const P = {
  bg:        "#0f0f0f",
  bgCard:    "#1a1a1a",
  bgCard2:   "#222",
  border:    "#2a2a2a",
  txt:       "#f2f2f2",
  txt2:      "#a8a8ad",
  txt3:      "#6c6c72",
  purple:    "#7c6dfa",
  purpleSoft:"rgba(124,109,250,0.18)",
  gold:      "#f0a030",
  goldBg:    "rgba(240,160,48,0.18)",
  green:     "#4caf82",
  greenSoft: "rgba(76,175,130,0.18)",
};

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wordmark(x, y, size = 28) {
  const a = size * 0.95;
  return `
    <g transform="translate(${x},${y})">
      <rect x="0" y="0" width="${a}" height="${a}" rx="${a*0.22}" fill="${P.purple}"/>
      <polygon points="${a*0.5},${a*0.15} ${a*0.78},${a*0.62} ${a*0.62},${a*0.62} ${a*0.62},${a*0.85} ${a*0.38},${a*0.85} ${a*0.38},${a*0.62} ${a*0.22},${a*0.62}" fill="#fff"/>
      <text x="${a+10}" y="${a*0.72}" font-family="-apple-system, Helvetica, sans-serif" font-size="${size*0.72}" font-weight="800" fill="${P.txt}">Tru<tspan fill="${P.purple}">North</tspan></text>
    </g>
  `;
}

const BENEFITS = [
  { icon: "✓", txt: "Personalized A–F grades on 11,000+ brands" },
  { icon: "✓", txt: "In-store barcode scanner — scan & decide" },
  { icon: "✓", txt: "Tailored to YOUR values via 30-sec quiz" },
  { icon: "✓", txt: "Public-record citations on every grade" },
  { icon: "✓", txt: "Brand-of-the-day + weekly digest" },
];

async function main() {
  // Layout scaled to iPhone 6.5" portrait — 1242 × 2688.
  // Status-bar safe area at top (110 px), home-indicator safe area at
  // bottom (75 px). Content lives between.
  const SB = 110;  // status bar
  const HI = 75;   // home indicator safe area
  const CW = W - 160; // content column inner width (80px margins)

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161616"/>
      <stop offset="1" stop-color="#0a0a0a"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Mock iOS status bar (just to make it feel like a real screenshot) -->
  <text x="80" y="${SB - 40}" font-family="-apple-system, Helvetica, sans-serif" font-size="34" font-weight="700" fill="${P.txt}">9:41</text>
  <g transform="translate(${W-260},${SB - 60})">
    <text x="0" y="22" font-family="-apple-system, Helvetica, sans-serif" font-size="28" font-weight="600" fill="${P.txt}">5G</text>
    <rect x="60" y="6" width="30" height="20" rx="3" fill="${P.txt}" opacity="0.85"/>
    <rect x="100" y="0" width="80" height="32" rx="6" fill="none" stroke="${P.txt}" stroke-width="2.5"/>
    <rect x="105" y="5" width="60" height="22" rx="3" fill="${P.txt}"/>
    <rect x="183" y="10" width="6" height="12" rx="1" fill="${P.txt}"/>
  </g>

  <!-- Header wordmark, centered -->
  ${wordmark(W/2 - 130, SB + 70, 50)}

  <!-- Hero star icon + title -->
  <g transform="translate(${W/2}, ${SB + 320})">
    <rect x="-90" y="-90" width="180" height="180" rx="44" fill="${P.purpleSoft}" stroke="${P.purple}" stroke-width="3"/>
    <text x="0" y="32" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="100" font-weight="800" fill="${P.purple}">★</text>
  </g>

  <text x="${W/2}" y="${SB + 530}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="64" font-weight="800" fill="${P.txt}">
    Unlock TruNorth Pro
  </text>

  <text x="${W/2}" y="${SB + 595}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="30" font-weight="500" fill="${P.txt2}">
    Personalized grades · Public-record cited
  </text>

  <!-- Benefits list -->
  ${BENEFITS.map((b, i) => {
    const y = SB + 740 + i * 92;
    return `
      <g>
        <circle cx="170" cy="${y}" r="26" fill="${P.greenSoft}" stroke="${P.green}" stroke-width="2.5"/>
        <text x="170" y="${y+12}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="30" font-weight="800" fill="${P.green}">${esc(b.icon)}</text>
        <text x="222" y="${y+12}" font-family="-apple-system, Helvetica, sans-serif" font-size="32" font-weight="600" fill="${P.txt}">${esc(b.txt)}</text>
      </g>
    `;
  }).join("")}

  <!-- Email input (mock) -->
  <rect x="80" y="${SB + 1310}" width="${CW}" height="90" rx="14" fill="${P.bgCard2}" stroke="${P.border}" stroke-width="2"/>
  <text x="120" y="${SB + 1368}" font-family="-apple-system, Helvetica, sans-serif" font-size="28" font-weight="500" fill="${P.txt3}">
    Enter your email to subscribe
  </text>

  <!-- Primary CTA: Annual -->
  <rect x="80" y="${SB + 1430}" width="${CW}" height="110" rx="18" fill="${P.gold}"/>
  <text x="${W/2}" y="${SB + 1500}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="32" font-weight="800" fill="#000">
    Subscribe — \$14.99/yr · save 42%
  </text>

  <!-- Monthly link -->
  <text x="${W/2}" y="${SB + 1610}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="600" fill="${P.purple}">
    or pay monthly — \$1.99/mo
  </text>

  <!-- Fine print -->
  <text x="${W/2}" y="${SB + 1665}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="22" font-weight="500" fill="${P.txt3}">
    Secure payment via Apple · Cancel anytime
  </text>

  <!-- Restore purchases (Apple required) -->
  <rect x="80" y="${SB + 1715}" width="${CW}" height="80" rx="14" fill="transparent" stroke="${P.border}" stroke-width="2"/>
  <text x="${W/2}" y="${SB + 1764}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="600" fill="${P.txt2}">
    Restore purchases
  </text>

  <!-- Maybe later -->
  <rect x="80" y="${SB + 1815}" width="${CW}" height="80" rx="14" fill="transparent" stroke="${P.border}" stroke-width="2"/>
  <text x="${W/2}" y="${SB + 1864}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="600" fill="${P.txt3}">
    Maybe later
  </text>

  <!-- Home indicator (mock) -->
  <rect x="${W/2 - 140}" y="${H - HI + 25}" width="280" height="8" rx="4" fill="${P.txt2}" opacity="0.6"/>
</svg>
  `.trim();

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "paywall-iphone-65.png");
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  const stat = await fs.stat(outPath);
  console.log(`✓ ${path.relative(ROOT, outPath)} (${Math.round(stat.size/1024)} KB, ${W}×${H})`);
  console.log("");
  console.log("Drop this into:");
  console.log("  App Store Connect → TruNorth Pro Annual → Review Information → Screenshot");
  console.log("  AND the same file into TruNorth Pro Monthly when you create it.");
}

main().catch(err => { console.error(err); process.exit(1); });
