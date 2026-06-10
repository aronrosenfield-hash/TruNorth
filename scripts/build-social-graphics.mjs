#!/usr/bin/env node
/**
 * Social-graphic generator for the 14-day launch ramp.
 *
 * Outputs 3 PNG cards at 1200×1200 (universal square — crops well to
 * LinkedIn 1.91:1, X 16:9, Threads 4:5, Bluesky 1.91:1):
 *
 *   1. source-count-200.png — the "200+ public-records sources" card
 *   2. category-stack.png   — 9 values categories + sample sources
 *   3. grade-card-patagonia.png — mock brand grade card for "what does
 *      the app actually show you" curiosity
 *
 * Brand palette mirrors src/lib/theme.js + the egregious-banner builder.
 *
 * Run:
 *   node scripts/build-social-graphics.mjs
 *
 * Output:
 *   docs/marketing/social/*.png
 */

import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT_DIR = path.join(ROOT, "docs/marketing/social");

const SIZE = 1200;
const P = {
  bg: "#0f0f0f",
  bgCard: "#1a1a1a",
  bgCard2: "#222",
  border: "#2a2a2a",
  txt: "#f2f2f2",
  txt2: "#a8a8ad",
  txt3: "#6c6c72",
  purple: "#7c6dfa",
  purpleDeep: "#5d54a6",
  green: "#4caf82",
  greenSoft: "rgba(76,175,130,0.12)",
  amber: "#f0a030",
  red: "#e24a4a",
};

// ---------- shared helpers ----------

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function renderSvg(svgString, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svgString)).png().toFile(outPath);
  const stat = await fs.stat(outPath);
  console.log(`✓ ${path.relative(ROOT, outPath)} (${Math.round(stat.size / 1024)} KB)`);
}

// TruNorth wordmark in SVG (matches the in-app lockup)
function wordmark(x, y, size = 36) {
  const arrowSize = size * 0.95;
  const offset = arrowSize / 2;
  return `
    <g transform="translate(${x},${y})">
      <rect x="0" y="0" width="${arrowSize}" height="${arrowSize}" rx="${arrowSize * 0.22}" fill="${P.purple}"/>
      <polygon points="${offset},${arrowSize * 0.15} ${arrowSize * 0.78},${arrowSize * 0.62} ${arrowSize * 0.62},${arrowSize * 0.62} ${arrowSize * 0.62},${arrowSize * 0.85} ${arrowSize * 0.38},${arrowSize * 0.85} ${arrowSize * 0.38},${arrowSize * 0.62} ${arrowSize * 0.22},${arrowSize * 0.62}" fill="#fff"/>
      <text x="${arrowSize + 12}" y="${arrowSize * 0.72}" font-family="-apple-system, BlinkMacSystemFont, Helvetica, sans-serif" font-size="${size * 0.7}" font-weight="800" fill="${P.txt}">Tru<tspan fill="${P.purple}">North</tspan></text>
    </g>
  `;
}

// ============================================================
// 1. SOURCE-COUNT CARD
// ============================================================

async function buildSourceCount() {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#161616"/>
      <stop offset="1" stop-color="#0a0a0a"/>
    </linearGradient>
    <linearGradient id="bigNum" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.purple}"/>
      <stop offset="1" stop-color="${P.purpleDeep}"/>
    </linearGradient>
  </defs>

  <rect width="${SIZE}" height="${SIZE}" fill="url(#bgGrad)"/>

  ${wordmark(60, 60, 40)}

  <!-- Eyebrow -->
  <text x="${SIZE / 2}" y="280" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="22" font-weight="700"
        fill="${P.txt3}" letter-spacing="6">
    PUBLIC-RECORDS SOURCES
  </text>

  <!-- The number -->
  <text x="${SIZE / 2}" y="510" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="280" font-weight="900"
        fill="url(#bigNum)" letter-spacing="-12">
    200+
  </text>

  <!-- Subhead -->
  <text x="${SIZE / 2}" y="580" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="32" font-weight="600"
        fill="${P.txt2}">
    powering 11,000+ brand grades
  </text>

  <!-- Source strip header -->
  <text x="${SIZE / 2}" y="700" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="20" font-weight="700"
        fill="${P.txt3}" letter-spacing="3">
    INCLUDES
  </text>

  <!-- 3 rows of source pills -->
  ${renderPillRow(60, 740, ["FEC", "EPA", "SEC", "OSHA", "NLRB", "NHTSA", "CFPB", "DOJ"])}
  ${renderPillRow(60, 820, ["CISA", "CPSC", "FDA", "CMS", "USDA", "EEOC", "HHS-OIG", "FCC"])}
  ${renderPillRow(60, 900, ["Carbon Majors", "Norway GPFG", "Banking on Climate Chaos", "KnowTheChain", "Forest 500"])}

  <!-- "...and 175+ more" -->
  <text x="${SIZE / 2}" y="1015" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="700"
        fill="${P.purple}">
    …and 175+ more
  </text>

  <!-- Footer URL -->
  <text x="${SIZE / 2}" y="1130" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="28" font-weight="600"
        fill="${P.txt2}">
    Real records, not opinions
  </text>
  <text x="${SIZE / 2}" y="1170" text-anchor="middle"
        font-family="-apple-system, Helvetica, sans-serif" font-size="24" font-weight="700"
        fill="${P.purple}">
    trunorthapp.com
  </text>
</svg>
  `.trim();

  await renderSvg(svg, path.join(OUT_DIR, "source-count-200.png"));
}

function renderPillRow(startX, y, labels) {
  // Pills: pad-x 18, pad-y 10, gap 12, font-size 22
  const pillH = 50;
  const padX = 22;
  const gap = 14;
  const fontSize = 22;
  // Estimate width: ~12.5 px per char + padding
  const widths = labels.map((l) => Math.max(80, Math.round(l.length * 13 + padX * 2)));
  const totalW = widths.reduce((s, w) => s + w, 0) + gap * (labels.length - 1);
  let x = (SIZE - totalW) / 2;
  let out = "";
  for (let i = 0; i < labels.length; i++) {
    const w = widths[i];
    out += `<rect x="${x}" y="${y}" width="${w}" height="${pillH}" rx="${pillH / 2}" fill="${P.bgCard2}" stroke="${P.border}" stroke-width="1"/>`;
    out += `<text x="${x + w / 2}" y="${y + pillH / 2 + 8}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${P.txt}">${esc(labels[i])}</text>`;
    x += w + gap;
  }
  return out;
}

// ============================================================
// 2. CATEGORY-STACK CARD
// ============================================================

async function buildCategoryStack() {
  const CATS = [
    { label: "Political",    sources: "FEC · OpenSecrets · State AGs", icon: "🗳" },
    { label: "Environment",  sources: "EPA · Carbon Majors · CDP A-List", icon: "🌱" },
    { label: "Labor",        sources: "OSHA · NLRB · KnowTheChain", icon: "👥" },
    { label: "Charity",      sources: "IRS Form 990 · Corporate giving", icon: "♡" },
    { label: "Animal welfare", sources: "Leaping Bunny · Open Wing Alliance", icon: "🐾" },
    { label: "Firearms",     sources: "ATF FFL · SIPRI", icon: "⊘" },
    { label: "DEI",          sources: "HRC CEI · Bloomberg GEI · EEOC", icon: "◆" },
    { label: "Data privacy", sources: "HIBP · CISA · Mozilla PNI", icon: "🔒" },
    { label: "Executive pay", sources: "SEC DEF 14A · AFL-CIO Paywatch", icon: "$" },
  ];

  const rowH = 90;
  const startY = 240;

  const rows = CATS.map((c, i) => {
    const y = startY + i * rowH;
    return `
      <g>
        <rect x="60" y="${y}" width="${SIZE - 120}" height="${rowH - 12}" rx="14" fill="${P.bgCard}" stroke="${P.border}"/>
        <circle cx="120" cy="${y + (rowH - 12) / 2}" r="26" fill="${P.greenSoft}" stroke="${P.green}" stroke-width="1.5"/>
        <text x="120" y="${y + (rowH - 12) / 2 + 9}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="800" fill="${P.green}">${esc(c.icon)}</text>
        <text x="170" y="${y + (rowH - 12) / 2 - 4}" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="800" fill="${P.txt}">${esc(c.label)}</text>
        <text x="170" y="${y + (rowH - 12) / 2 + 24}" font-family="-apple-system, Helvetica, sans-serif" font-size="18" font-weight="500" fill="${P.txt3}">${esc(c.sources)}</text>
      </g>
    `;
  }).join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${P.bg}"/>
  ${wordmark(60, 60, 36)}

  <text x="60" y="180" font-family="-apple-system, Helvetica, sans-serif" font-size="44" font-weight="900" fill="${P.txt}">
    9 categories. 200+ sources.
  </text>
  <text x="60" y="220" font-family="-apple-system, Helvetica, sans-serif" font-size="22" font-weight="500" fill="${P.txt3}">
    Every grade traces back to a public-record citation.
  </text>

  ${rows}

  <text x="${SIZE / 2}" y="${SIZE - 50}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="800" fill="${P.purple}">
    trunorthapp.com
  </text>
</svg>
  `.trim();

  await renderSvg(svg, path.join(OUT_DIR, "category-stack.png"));
}

// ============================================================
// 3. GRADE-CARD MOCK
// ============================================================

async function buildGradeCard() {
  // Phone-aspect mock 1200×1200 with the brand-detail card centered
  const cardX = 100;
  const cardY = 180;
  const cardW = 1000;
  const cardH = 880;

  const RECORDS = [
    { cat: "Environment", txt: "1% for the Planet member since 2002 · Climate Neutral certified", src: "1% Planet · Climate Neutral", sc: "positive" },
    { cat: "Labor",       txt: "Certified B Corp since 2012 · Fair Trade USA certified", src: "B Lab · Fair Trade USA", sc: "positive" },
    { cat: "Political",   txt: "FEC: \$32K PAC donations, balanced bipartisan", src: "FEC.gov", sc: "neutral" },
    { cat: "Charity",     txt: "1% of revenue → environmental nonprofits", src: "1% for the Planet", sc: "positive" },
    { cat: "Animal welfare", txt: "No animal-derived materials in new product lines", src: "PETA Beauty Without Bunnies", sc: "positive" },
  ];

  const recordsSvg = RECORDS.map((r, i) => {
    const y = 540 + i * 88;
    const dotColor = r.sc === "positive" ? P.green : r.sc === "neutral" ? P.amber : P.red;
    return `
      <g>
        <circle cx="${cardX + 50}" cy="${y + 28}" r="8" fill="${dotColor}"/>
        <text x="${cardX + 80}" y="${y + 20}" font-family="-apple-system, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${P.txt}">${esc(r.cat)}</text>
        <text x="${cardX + 80}" y="${y + 46}" font-family="-apple-system, Helvetica, sans-serif" font-size="16" font-weight="500" fill="${P.txt2}">${esc(r.txt)}</text>
        <text x="${cardX + 80}" y="${y + 68}" font-family="-apple-system, Helvetica, sans-serif" font-size="13" font-weight="600" fill="${P.txt3}">SOURCE: ${esc(r.src.toUpperCase())}</text>
      </g>
    `;
  }).join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${P.bg}"/>
  ${wordmark(60, 60, 36)}

  <text x="60" y="160" font-family="-apple-system, Helvetica, sans-serif" font-size="28" font-weight="800" fill="${P.txt}">
    Here's what a TruNorth grade looks like.
  </text>

  <!-- Card -->
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" fill="${P.bgCard}" stroke="${P.border}" stroke-width="1.5"/>

  <!-- Card header: brand name + grade -->
  <text x="${cardX + 50}" y="${cardY + 90}" font-family="-apple-system, Helvetica, sans-serif" font-size="40" font-weight="900" fill="${P.txt}">Patagonia</text>
  <text x="${cardX + 50}" y="${cardY + 130}" font-family="-apple-system, Helvetica, sans-serif" font-size="20" font-weight="500" fill="${P.txt3}">Apparel · USA · Outdoor / sportswear</text>

  <!-- Grade pill -->
  <rect x="${cardX + cardW - 200}" y="${cardY + 50}" width="150" height="100" rx="20" fill="${P.greenSoft}" stroke="${P.green}" stroke-width="2"/>
  <text x="${cardX + cardW - 125}" y="${cardY + 120}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="68" font-weight="900" fill="${P.green}">A</text>

  <!-- Score row -->
  <text x="${cardX + 50}" y="${cardY + 190}" font-family="-apple-system, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${P.txt3}">OVERALL SCORE</text>
  <text x="${cardX + 50}" y="${cardY + 240}" font-family="-apple-system, Helvetica, sans-serif" font-size="56" font-weight="900" fill="${P.txt}">83<tspan font-size="28" fill="${P.txt3}">/100</tspan></text>

  <!-- Records header -->
  <text x="${cardX + 50}" y="${cardY + 320}" font-family="-apple-system, Helvetica, sans-serif" font-size="18" font-weight="700" fill="${P.txt3}">5 PUBLIC-RECORD CITATIONS</text>

  <!-- Divider -->
  <line x1="${cardX + 50}" y1="${cardY + 340}" x2="${cardX + cardW - 50}" y2="${cardY + 340}" stroke="${P.border}" stroke-width="1.5"/>

  <!-- Records -->
  ${recordsSvg}

  <text x="${SIZE / 2}" y="${SIZE - 50}" text-anchor="middle" font-family="-apple-system, Helvetica, sans-serif" font-size="26" font-weight="800" fill="${P.purple}">
    trunorthapp.com
  </text>
</svg>
  `.trim();

  await renderSvg(svg, path.join(OUT_DIR, "grade-card-patagonia.png"));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log("Building 3 social graphics @ 1200×1200…");
  await fs.mkdir(OUT_DIR, { recursive: true });
  await buildSourceCount();
  await buildCategoryStack();
  await buildGradeCard();
  console.log("");
  console.log(`Done. Output: ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((err) => { console.error("build-social-graphics failed:", err); process.exit(1); });
