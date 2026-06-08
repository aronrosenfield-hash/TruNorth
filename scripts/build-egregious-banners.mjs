// Build all "5 Most Egregious" marketing assets from
// public/data/_meta/egregious-facts.json.
//
// Outputs:
//   docs/marketing/egregious/banner-website-{1..5}.png   (1280 x  320)
//   docs/marketing/egregious/banner-email-{1..5}.png     ( 600 x  200)
//   docs/marketing/egregious/social-{1..5}.png           (1200 x  675)
//   docs/marketing/egregious/ios-splash-{1..5}.png       (1320 x 2868)
//   docs/marketing/egregious/contact-sheet-website.png   (3 cols x 2 rows grid)
//
// Re-run any time the JSON changes. Type-driven, no clip-art, journalistic.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'docs/marketing/egregious');
const FACTS_JSON = path.join(ROOT, 'public/data/_meta/egregious-facts.json');

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Brand palette
const PURPLE = '#7c6dfa';
const PURPLE_DEEP = '#5b4ed7';
const DARK = '#0a0a0a';
const TEXT = '#f2f2f2';
const TEXT_DIM = '#a8a8a8';

const xml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// Shared SVG fragments ------------------------------------------------------

function gradientDefs(id = 'bg') {
  return `<defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PURPLE}"/>
      <stop offset="100%" stop-color="${PURPLE_DEEP}"/>
    </linearGradient>
    <linearGradient id="${id}-dark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#141327"/>
    </linearGradient>
  </defs>`;
}

// TruNorth wordmark+mark as inline SVG. `scale` 1 = ~ 22px tall.
function logoLockup({ x, y, scale = 1, lightOnDark = true }) {
  const s = scale;
  const markSize = 28 * s;
  const radius = 9 * s;
  const wordSize = 22 * s;
  const arrowSize = 18 * s;
  const tnFill = lightOnDark ? TEXT : '#101010';
  const northFill = PURPLE;
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${markSize}" height="${markSize}" rx="${radius}" ry="${radius}" fill="${PURPLE}"/>
    <text x="${markSize/2}" y="${markSize/2 + arrowSize*0.36}" font-family="${FONT_STACK}" font-weight="800" font-size="${arrowSize}" fill="#ffffff" text-anchor="middle">↑</text>
    <text x="${markSize + 8*s}" y="${markSize*0.72}" font-family="${FONT_STACK}" font-weight="800" font-size="${wordSize}" letter-spacing="-0.2" fill="${tnFill}">Tru<tspan fill="${northFill}">North</tspan></text>
  </g>`;
}

// --- WEBSITE banner: 1280 x 320 -------------------------------------------

function websiteBannerSvg(fact) {
  const W = 1280, H = 320;
  const padX = 56;
  // Stat number: enormous, left
  const statY = 230;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g')}
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <!-- subtle radial accent -->
    <circle cx="${W-220}" cy="${H/2}" r="320" fill="#ffffff" opacity="0.04"/>

    <!-- Top row: lens chip + brand line -->
    <text x="${padX}" y="58" font-family="${FONT_STACK}" font-weight="700" font-size="14" letter-spacing="2" fill="#ffffff" opacity="0.85">${xml(fact.lens.toUpperCase())}</text>
    <text x="${padX}" y="92" font-family="${FONT_STACK}" font-weight="800" font-size="28" letter-spacing="-0.3" fill="#ffffff">${xml(fact.brandName)}</text>

    <!-- HERO stat number -->
    <text x="${padX}" y="${statY}" font-family="${FONT_STACK}" font-weight="900" font-size="170" letter-spacing="-6" fill="#ffffff">${xml(fact.statNumber)}<tspan font-size="100" font-weight="900" fill="#ffffff" opacity="0.85">${xml(fact.statUnit || '')}</tspan></text>

    <!-- Right column: kicker + source + CTA -->
    <text x="${W-padX}" y="120" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="#ffffff">${xml(fact.statKicker)}</text>
    <text x="${W-padX}" y="158" text-anchor="end" font-family="${FONT_STACK}" font-weight="500" font-size="16" fill="#ffffff" opacity="0.82">${xml(fact.shortContext)}</text>

    <!-- CTA pill (visual only) -->
    <g transform="translate(${W-padX-220},${H-110})">
      <rect x="0" y="0" width="220" height="46" rx="23" ry="23" fill="#ffffff"/>
      <text x="110" y="30" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="16" fill="${PURPLE_DEEP}">${xml(fact.cta)} →</text>
    </g>

    <!-- Source line -->
    <text x="${W-padX}" y="${H-32}" text-anchor="end" font-family="${FONT_STACK}" font-weight="500" font-size="12" fill="#ffffff" opacity="0.7">Source: ${xml(fact.source)}</text>

    <!-- TruNorth wordmark, bottom-left -->
    ${logoLockup({ x: padX, y: H-56, scale: 1 })}
  </svg>`;
}

// --- EMAIL banner: 600 x 200 ----------------------------------------------

function emailBannerSvg(fact) {
  const W = 600, H = 200;
  const padX = 28;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g')}
    <rect width="${W}" height="${H}" fill="url(#g)"/>

    <text x="${padX}" y="34" font-family="${FONT_STACK}" font-weight="700" font-size="10" letter-spacing="2" fill="#ffffff" opacity="0.85">${xml(fact.lens.toUpperCase())} · ${xml(fact.brandName.toUpperCase())}</text>

    <!-- HERO stat -->
    <text x="${padX}" y="128" font-family="${FONT_STACK}" font-weight="900" font-size="96" letter-spacing="-3" fill="#ffffff">${xml(fact.statNumber)}<tspan font-size="56" font-weight="900" opacity="0.85">${xml(fact.statUnit || '')}</tspan></text>

    <!-- Right column wrap -->
    <text x="${W-padX}" y="64" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="14" fill="#ffffff">${xml(fact.statKicker)}</text>
    <text x="${W-padX}" y="86" text-anchor="end" font-family="${FONT_STACK}" font-weight="500" font-size="11" fill="#ffffff" opacity="0.82">${xml(fact.brandName)}</text>

    <!-- CTA -->
    <g transform="translate(${W-padX-150},${H-66})">
      <rect width="150" height="34" rx="17" fill="#ffffff"/>
      <text x="75" y="22" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="12" fill="${PURPLE_DEEP}">${xml(fact.cta)} →</text>
    </g>

    <text x="${W-padX}" y="${H-18}" text-anchor="end" font-family="${FONT_STACK}" font-weight="500" font-size="9" fill="#ffffff" opacity="0.7">Source: ${xml(fact.source)}</text>

    <!-- Wordmark -->
    ${logoLockup({ x: padX, y: H-44, scale: 0.72 })}
  </svg>`;
}

// --- SOCIAL card: 1200 x 675 ----------------------------------------------

function socialCardSvg(fact) {
  const W = 1200, H = 675;
  const padX = 72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g')}
    <rect width="${W}" height="${H}" fill="url(#g-dark)"/>
    <!-- top accent band -->
    <rect x="0" y="0" width="${W}" height="8" fill="${PURPLE}"/>

    <!-- Lens + brand -->
    <text x="${padX}" y="120" font-family="${FONT_STACK}" font-weight="700" font-size="16" letter-spacing="3" fill="${PURPLE}">${xml(fact.lens.toUpperCase())}</text>
    <text x="${padX}" y="170" font-family="${FONT_STACK}" font-weight="800" font-size="40" letter-spacing="-0.5" fill="${TEXT}">${xml(fact.brandName)}</text>

    <!-- HERO stat -->
    <text x="${padX}" y="430" font-family="${FONT_STACK}" font-weight="900" font-size="280" letter-spacing="-10" fill="${TEXT}">${xml(fact.statNumber)}<tspan font-size="180" font-weight="900" fill="${PURPLE}">${xml(fact.statUnit || '')}</tspan></text>

    <!-- Kicker -->
    <text x="${padX}" y="495" font-family="${FONT_STACK}" font-weight="700" font-size="28" fill="${TEXT}">${xml(fact.statKicker)}</text>
    <text x="${padX}" y="540" font-family="${FONT_STACK}" font-weight="500" font-size="22" fill="${TEXT_DIM}">${xml(fact.shortContext)}</text>

    <!-- Source -->
    <text x="${padX}" y="${H-72}" font-family="${FONT_STACK}" font-weight="500" font-size="14" fill="${TEXT_DIM}">Source: ${xml(fact.source)}</text>

    <!-- Wordmark, bottom-left -->
    ${logoLockup({ x: padX, y: H-44, scale: 0.9 })}

    <!-- PH callout, top-right -->
    <g transform="translate(${W-padX-320},92)">
      <rect width="320" height="64" rx="12" fill="${PURPLE}"/>
      <text x="160" y="28" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="12" letter-spacing="2" fill="#ffffff" opacity="0.9">LAUNCHING ON PRODUCT HUNT</text>
      <text x="160" y="52" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#ffffff">June 23, 2026</text>
    </g>

    <!-- Bottom-right CTA -->
    <g transform="translate(${W-padX-260},${H-104})">
      <rect width="260" height="56" rx="28" fill="${PURPLE}"/>
      <text x="130" y="36" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#ffffff">${xml(fact.cta)} →</text>
    </g>
  </svg>`;
}

// --- iOS splash: 1320 x 2868 ----------------------------------------------

function iosSplashSvg(fact) {
  const W = 1320, H = 2868;
  const padX = 96;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g')}
    <rect width="${W}" height="${H}" fill="${DARK}"/>
    <!-- top purple band -->
    <rect x="0" y="0" width="${W}" height="${H*0.32}" fill="url(#g)"/>
    <!-- soft fade -->
    <rect x="0" y="${H*0.32 - 80}" width="${W}" height="160" fill="${DARK}" opacity="0.0"/>

    <!-- Status-bar-ish spacer for the notch (just leaves room) -->

    <!-- TruNorth wordmark, centered top -->
    <g transform="translate(${W/2 - 220},170)">
      <rect x="0" y="0" width="84" height="84" rx="27" fill="#ffffff" opacity="0.18"/>
      <rect x="6" y="6" width="72" height="72" rx="22" fill="${PURPLE}"/>
      <text x="42" y="62" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="52" fill="#ffffff">↑</text>
      <text x="104" y="60" font-family="${FONT_STACK}" font-weight="800" font-size="56" letter-spacing="-0.6" fill="#ffffff">Tru<tspan fill="#ffffff" opacity="0.85">North</tspan></text>
    </g>

    <!-- Lens chip -->
    <g transform="translate(${W/2 - 220},340)">
      <rect width="440" height="56" rx="28" fill="#ffffff" opacity="0.18"/>
      <text x="220" y="38" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="22" letter-spacing="2" fill="#ffffff">${xml(fact.lens.toUpperCase())}</text>
    </g>

    <!-- Brand name -->
    <text x="${W/2}" y="540" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="68" letter-spacing="-0.6" fill="#ffffff">${xml(fact.brandName)}</text>

    <!-- HERO stat (massive, centered) -->
    <text x="${W/2}" y="1340" text-anchor="middle" font-family="${FONT_STACK}" font-weight="900" font-size="520" letter-spacing="-22" fill="${TEXT}">${xml(fact.statNumber)}<tspan font-size="320" font-weight="900" fill="${PURPLE}">${xml(fact.statUnit || '')}</tspan></text>

    <!-- Kicker -->
    ${wrapCenteredText(fact.statKicker, { cx: W/2, y: 1480, maxChars: 24, fontSize: 56, color: TEXT, weight: 700, lineGap: 1.15 })}

    <!-- Context, dim -->
    ${wrapCenteredText(fact.context, { cx: W/2, y: 1720, maxChars: 36, fontSize: 38, color: TEXT_DIM, weight: 500, lineGap: 1.3 })}

    <!-- Source citation -->
    <text x="${W/2}" y="2280" text-anchor="middle" font-family="${FONT_STACK}" font-weight="600" font-size="26" fill="${PURPLE}">Source</text>
    ${wrapCenteredText(fact.source, { cx: W/2, y: 2320, maxChars: 38, fontSize: 26, color: TEXT_DIM, weight: 500, lineGap: 1.3 })}

    <!-- Tap to see receipt button -->
    <g transform="translate(${(W-820)/2},2520)">
      <rect width="820" height="120" rx="60" fill="${PURPLE}"/>
      <text x="410" y="78" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="44" fill="#ffffff">Tap to see the receipt →</text>
    </g>

    <!-- Tiny footer -->
    <text x="${W/2}" y="2780" text-anchor="middle" font-family="${FONT_STACK}" font-weight="500" font-size="22" fill="${TEXT_DIM}" opacity="0.7">TruNorth · 11,000+ brands · 100 public-records sources</text>
  </svg>`;
}

// Center-aligned, multi-line text helper (renders <tspan>s)
function wrapCenteredText(text, { cx, y, maxChars, fontSize, color, weight = 600, lineGap = 1.2 }) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur ? cur + ' ' : '') + w;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const lineH = fontSize * lineGap;
  return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="${FONT_STACK}" font-weight="${weight}" font-size="${fontSize}" fill="${color}">${
    lines.map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : lineH}">${xml(l)}</tspan>`).join('')
  }</text>`;
}

// --- Renderer --------------------------------------------------------------

async function renderSvgToPng(svg, outPath, width, height) {
  // Render SVG at exact pixel dims (sharp interprets the viewBox)
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toFile(outPath);
}

async function buildContactSheet(websitePaths, outPath) {
  // 3 cols x 2 rows of 1280x320 tiles, scaled down to ~640x160, with 24px gutters.
  const cell = { w: 640, h: 160 };
  const gutter = 24;
  const cols = 3, rows = 2;
  const W = gutter + cols * (cell.w + gutter);
  const H = gutter + rows * (cell.h + gutter);
  const composites = [];
  for (let i = 0; i < websitePaths.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const left = gutter + col * (cell.w + gutter);
    const top  = gutter + row * (cell.h + gutter);
    const buf = await sharp(websitePaths[i]).resize(cell.w, cell.h).png().toBuffer();
    composites.push({ input: buf, top, left });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: '#0a0a0a' } })
    .composite(composites)
    .png()
    .toFile(outPath);
}

// --- Main ------------------------------------------------------------------

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const raw = JSON.parse(await fs.readFile(FACTS_JSON, 'utf8'));
  const facts = raw.facts;
  console.log(`Rendering ${facts.length} facts → ${OUT_DIR}`);

  const websitePaths = [];
  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    const n = i + 1;

    const webPath   = path.join(OUT_DIR, `banner-website-${n}.png`);
    const mailPath  = path.join(OUT_DIR, `banner-email-${n}.png`);
    const socPath   = path.join(OUT_DIR, `social-${n}.png`);
    const iosPath   = path.join(OUT_DIR, `ios-splash-${n}.png`);

    await renderSvgToPng(websiteBannerSvg(f), webPath,   1280,  320);
    await renderSvgToPng(emailBannerSvg(f),   mailPath,   600,  200);
    await renderSvgToPng(socialCardSvg(f),    socPath,   1200,  675);
    await renderSvgToPng(iosSplashSvg(f),     iosPath,   1320, 2868);

    websitePaths.push(webPath);
    console.log(`  [${n}/${facts.length}] ${f.brandName} — ${f.statNumber}${f.statUnit || ''}`);
  }

  const sheetPath = path.join(OUT_DIR, 'contact-sheet-website.png');
  await buildContactSheet(websitePaths, sheetPath);
  console.log(`  contact sheet → ${sheetPath}`);

  console.log(`Done. ${facts.length * 4 + 1} files written to ${OUT_DIR}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
