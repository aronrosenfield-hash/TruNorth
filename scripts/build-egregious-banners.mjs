// Build all "Egregious Rotation" marketing assets from
// public/data/_meta/egregious-facts.json.
//
// Outputs (one of each per fact):
//   docs/marketing/egregious/banner-website-{slug}.png   (1280 x  320)
//   docs/marketing/egregious/banner-email-{slug}.png     ( 600 x  200)
//   docs/marketing/egregious/social-{slug}.png           (1200 x  675)
//   docs/marketing/egregious/ios-splash-{slug}.png       (1320 x 2868)
//   docs/marketing/egregious/contact-sheet-{surface}.png (grid for QA)
//
// Brand logos (unmodified) are composited from
//   docs/marketing/egregious/logos/<slug>.{svg,png}
// produced by scripts/_fetch-brand-logos.mjs. If a logo isn't on disk,
// we render the banner without it (graceful fallback).
//
// Design pass June 2026:
//   - Brand name is co-equal hero with the stat number (~2.5× prior size).
//   - Brand logo composited top-left/center, unmodified, ~40–60 px tall.
//   - Nominative fair-use disclaimer on every surface.
//   - Positive-polarity facts use a green accent; negative stays purple.
//   - Type breathing room, layout hierarchy matched to the social card.
//
// No headless browser, no npm deps beyond sharp.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = path.join(ROOT, 'docs/marketing/egregious');
const LOGO_DIR = path.join(OUT_DIR, 'logos');
const FACTS_JSON = path.join(ROOT, 'public/data/_meta/egregious-facts.json');
const LOGO_CLASS_JSON = path.join(ROOT, 'public/data/_meta/egregious-logo-classification.json');

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Brand palette
// Negative-polarity gradient. Picked 2026-06-08 PM after Aron reviewed 4 swatches
// (deeper plum #4a3a8c / charcoal #1a1a2e / desat-purple #5d54a6 / burgundy #6b2737)
// against the original neon #7c6dfa — desaturated purple won for keeping brand
// continuity while taking down the video-game-y saturation.
// Env-var overrides preserved for future preview rounds:
//   PURPLE=<hex> PURPLE_DEEP=<hex> ONLY_SLUG=<slug> ONLY_SURFACE=<ios|website|social|email> node scripts/build-egregious-banners.mjs
const PURPLE = process.env.PURPLE || '#5d54a6';
const PURPLE_DEEP = process.env.PURPLE_DEEP || '#463f7d';
const GREEN = '#4caf82';      // positive accent (matches app)
const GREEN_DEEP = '#358a64';
const DARK = '#0a0a0a';
const DARK_2 = '#141327';
const TEXT = '#f2f2f2';
const TEXT_DIM = '#a8a8a8';

const DISCLAIMER = "Brand names and logos are trademarks of their respective owners. Used for editorial identification under nominative fair use.";

const xml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function accent(fact) {
  return fact.polarity === 'positive' ? GREEN : PURPLE;
}
function accentDeep(fact) {
  return fact.polarity === 'positive' ? GREEN_DEEP : PURPLE_DEEP;
}

function gradientDefs(id, fact) {
  const a = accent(fact);
  const b = accentDeep(fact);
  return `<defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${a}"/>
      <stop offset="100%" stop-color="${b}"/>
    </linearGradient>
    <linearGradient id="${id}-dark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${DARK}"/>
      <stop offset="100%" stop-color="${DARK_2}"/>
    </linearGradient>
  </defs>`;
}

// TruNorth wordmark+mark. scale 1 = ~28px mark.
function logoLockup({ x, y, scale = 1, lightOnDark = true, fact }) {
  const s = scale;
  const a = accent(fact);
  const markSize = 28 * s;
  const radius = 9 * s;
  const wordSize = 22 * s;
  const arrowSize = 18 * s;
  const tnFill = lightOnDark ? TEXT : '#101010';
  return `<g transform="translate(${x},${y})">
    <rect x="0" y="0" width="${markSize}" height="${markSize}" rx="${radius}" ry="${radius}" fill="${a}"/>
    <text x="${markSize/2}" y="${markSize/2 + arrowSize*0.36}" font-family="${FONT_STACK}" font-weight="800" font-size="${arrowSize}" fill="#ffffff" text-anchor="middle">↑</text>
    <text x="${markSize + 8*s}" y="${markSize*0.72}" font-family="${FONT_STACK}" font-weight="800" font-size="${wordSize}" letter-spacing="-0.2" fill="${tnFill}">Tru<tspan fill="${a}">North</tspan></text>
  </g>`;
}

// --- Brand-logo composite helpers -----------------------------------------

async function findLogoFile(slug) {
  for (const ext of ['.png', '.svg']) {
    const p = path.join(LOGO_DIR, `${slug}${ext}`);
    try {
      const st = await fs.stat(p);
      if (st.size > 200) return { path: p, ext };
    } catch { /* miss */ }
  }
  return null;
}

// Produce a transparent PNG buffer of the brand logo, fit into (maxW × maxH).
async function renderLogoBuffer(slug, maxW, maxH) {
  const found = await findLogoFile(slug);
  if (!found) return null;
  try {
    return await sharp(found.path, { density: 300 })
      .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    console.warn(`  ! logo render failed for ${slug}: ${err.message}`);
    return null;
  }
}

// --- WEBSITE banner: 1280 x 320 -------------------------------------------
// Returns { svg, logoBox } so the main loop knows where to composite the logo.
//   - hasTextInLogo=true (and logo present)  → big logo, no text label
//   - hasTextInLogo=false (or logo missing)  → small mark + text label

function websiteBannerLayout({ logoPresent, hasTextInLogo }) {
  const W = 1280, H = 320;
  const padX = 56;
  const useWordmark = logoPresent && hasTextInLogo;
  if (useWordmark) {
    // Logo takes the space of the brand-name text — left half, vertically centered.
    return { W, H, padX, useWordmark, logoBox: { x: padX, y: 60, w: 540, h: 180 } };
  }
  // Mark only (or no logo): small mark above the brand-name text.
  return { W, H, padX, useWordmark, logoBox: logoPresent ? { x: padX, y: 36, w: 160, h: 56 } : null };
}

function websiteBannerSvg(fact, { logoPresent, hasTextInLogo }) {
  const { W, H, padX, useWordmark, logoBox } = websiteBannerLayout({ logoPresent, hasTextInLogo });
  const statY = H - 110;
  const brandNameY = (logoBox ? logoBox.y + logoBox.h + 56 : 100);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g', fact)}
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="${W-220}" cy="${H/2}" r="320" fill="#ffffff" opacity="0.05"/>

    <text x="${padX}" y="32" font-family="${FONT_STACK}" font-weight="700" font-size="12" letter-spacing="2" fill="#ffffff" opacity="0.85">${xml(fact.lens.toUpperCase())}</text>

    ${logoBox ? `<rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.w}" height="${logoBox.h}" fill="transparent"/>` : ''}

    ${useWordmark ? '' : `<text x="${padX}" y="${brandNameY}" font-family="${FONT_STACK}" font-weight="900" font-size="56" letter-spacing="-1.2" fill="#ffffff">${xml(fact.brandName)}</text>`}

    <text x="${W-padX}" y="${statY}" text-anchor="end" font-family="${FONT_STACK}" font-weight="900" font-size="120" letter-spacing="-4" fill="#ffffff">${xml(fact.statNumber)}<tspan font-size="76" font-weight="900" fill="#ffffff" opacity="0.85">${xml(fact.statUnit || '')}</tspan></text>

    <text x="${W-padX}" y="${statY+38}" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="18" fill="#ffffff" opacity="0.95">${xml(fact.statKicker)}</text>

    <text x="${padX}" y="${H-46}" font-family="${FONT_STACK}" font-weight="500" font-size="11" fill="#ffffff" opacity="0.78">Source: ${xml(fact.source)}</text>
    <text x="${padX}" y="${H-28}" font-family="${FONT_STACK}" font-weight="500" font-size="9" fill="#ffffff" opacity="0.55">${xml(DISCLAIMER)}</text>

    ${logoLockup({ x: W-padX-160, y: H-44, scale: 0.62, fact })}
  </svg>`;
}

// --- EMAIL banner: 600 x 200 ----------------------------------------------

function emailBannerLayout({ logoPresent, hasTextInLogo }) {
  const W = 600, H = 200;
  const padX = 24;
  const useWordmark = logoPresent && hasTextInLogo;
  if (useWordmark) {
    return { W, H, padX, useWordmark, logoBox: { x: padX, y: 32, w: 300, h: 96 } };
  }
  return { W, H, padX, useWordmark, logoBox: logoPresent ? { x: padX, y: 18, w: 96, h: 36 } : null };
}

function emailBannerSvg(fact, { logoPresent, hasTextInLogo }) {
  const { W, H, padX, useWordmark, logoBox } = emailBannerLayout({ logoPresent, hasTextInLogo });
  const brandNameY = (logoBox ? logoBox.y + logoBox.h + 30 : 64);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g', fact)}
    <rect width="${W}" height="${H}" fill="url(#g)"/>

    <text x="${padX}" y="14" font-family="${FONT_STACK}" font-weight="700" font-size="9" letter-spacing="2" fill="#ffffff" opacity="0.85">${xml(fact.lens.toUpperCase())}</text>

    ${logoBox ? `<rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.w}" height="${logoBox.h}" fill="transparent"/>` : ''}

    ${useWordmark ? '' : `<text x="${padX}" y="${brandNameY}" font-family="${FONT_STACK}" font-weight="900" font-size="28" letter-spacing="-0.6" fill="#ffffff">${xml(fact.brandName)}</text>`}

    <text x="${W-padX}" y="${H-66}" text-anchor="end" font-family="${FONT_STACK}" font-weight="900" font-size="60" letter-spacing="-2" fill="#ffffff">${xml(fact.statNumber)}<tspan font-size="34" font-weight="900" opacity="0.85">${xml(fact.statUnit || '')}</tspan></text>

    <text x="${W-padX}" y="${H-44}" text-anchor="end" font-family="${FONT_STACK}" font-weight="700" font-size="11" fill="#ffffff" opacity="0.95">${xml(fact.statKicker)}</text>

    <text x="${padX}" y="${H-26}" font-family="${FONT_STACK}" font-weight="500" font-size="8" fill="#ffffff" opacity="0.78">Source: ${xml(fact.source)}</text>
    <text x="${padX}" y="${H-12}" font-family="${FONT_STACK}" font-weight="500" font-size="7" fill="#ffffff" opacity="0.55">${xml(DISCLAIMER)}</text>
  </svg>`;
}

// --- SOCIAL card: 1200 x 675 ----------------------------------------------

function socialCardLayout({ logoPresent, hasTextInLogo }) {
  const W = 1200, H = 675;
  const padX = 72;
  const useWordmark = logoPresent && hasTextInLogo;
  if (useWordmark) {
    // Logo occupies the area that would have held mark+text (top ~96 → ~280).
    return { W, H, padX, useWordmark, logoBox: { x: padX, y: 96, w: 560, h: 200 } };
  }
  return { W, H, padX, useWordmark, logoBox: logoPresent ? { x: padX, y: 96, w: 280, h: 90 } : null };
}

function socialCardSvg(fact, { logoPresent, hasTextInLogo }) {
  const { W, H, padX, useWordmark, logoBox } = socialCardLayout({ logoPresent, hasTextInLogo });
  const a = accent(fact);
  // Brand-name text sits just below the logo box (for mark-only) — for wordmark it's omitted.
  const brandNameY = (logoBox ? logoBox.y + logoBox.h + 56 : 200);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g', fact)}
    <rect width="${W}" height="${H}" fill="url(#g-dark)"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="${DARK_2}" opacity="0.4"/>
    <rect x="0" y="0" width="${W}" height="8" fill="${a}"/>

    <text x="${padX}" y="74" font-family="${FONT_STACK}" font-weight="700" font-size="16" letter-spacing="3" fill="${a}">${xml(fact.lens.toUpperCase())}</text>

    ${logoBox ? `<rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.w}" height="${logoBox.h}" fill="transparent"/>` : ''}

    ${useWordmark ? '' : `<text x="${padX}" y="${brandNameY}" font-family="${FONT_STACK}" font-weight="900" font-size="56" letter-spacing="-1" fill="${TEXT}">${xml(fact.brandName)}</text>`}

    <text x="${padX}" y="450" font-family="${FONT_STACK}" font-weight="900" font-size="190" letter-spacing="-6" fill="${TEXT}">${xml(fact.statNumber)}<tspan font-size="130" font-weight="900" fill="${a}">${xml(fact.statUnit || '')}</tspan></text>

    <text x="${padX}" y="500" font-family="${FONT_STACK}" font-weight="700" font-size="24" fill="${TEXT}">${xml(fact.statKicker)}</text>
    <text x="${padX}" y="535" font-family="${FONT_STACK}" font-weight="500" font-size="17" fill="${TEXT_DIM}">${xml(fact.shortContext)}</text>

    <text x="${padX}" y="${H-78}" font-family="${FONT_STACK}" font-weight="500" font-size="14" fill="${TEXT_DIM}">Source: ${xml(fact.source)}</text>
    <text x="${padX}" y="${H-58}" font-family="${FONT_STACK}" font-weight="500" font-size="11" fill="${TEXT_DIM}" opacity="0.7">${xml(DISCLAIMER)}</text>

    ${logoLockup({ x: padX, y: H-44, scale: 0.9, fact })}

    <g transform="translate(${W-padX-320},92)">
      <rect width="320" height="64" rx="12" fill="${a}"/>
      <text x="160" y="28" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="12" letter-spacing="2" fill="#ffffff" opacity="0.9">LAUNCHING ON PRODUCT HUNT</text>
      <text x="160" y="52" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#ffffff">June 23, 2026</text>
    </g>

    <g transform="translate(${W-padX-260},${H-104})">
      <rect width="260" height="56" rx="28" fill="${a}"/>
      <text x="130" y="36" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#ffffff">${xml(fact.cta)} →</text>
    </g>
  </svg>`;
}

// --- iOS splash: 1320 x 2868 ----------------------------------------------
//
// Bug fix (Jun 2026): the purple→indigo gradient previously ended at
// H*0.32 ≈ y=918, but the brand-name text label (font-size 140) was
// centered at y≈980, so it visibly straddled the gradient/dark seam.
// Resolution: extend the gradient down to y≈1130 so the entire brand
// identity area (TruNorth lockup, lens chip, brand logo, brand name)
// sits fully on the gradient and the dark surface begins cleanly after.

function iosSplashLayout({ logoPresent, hasTextInLogo }) {
  const W = 1320, H = 2868;
  const useWordmark = logoPresent && hasTextInLogo;
  if (useWordmark) {
    // Wordmark replaces the brand-name text — bigger and centered higher.
    const w = 1000, h = 440;
    return { W, H, useWordmark, logoBox: { x: (W - w) / 2, y: 560, w, h } };
  }
  if (logoPresent) {
    // Mark above brand-name text — current sizing.
    const w = 800, h = 240;
    return { W, H, useWordmark, logoBox: { x: (W - w) / 2, y: 580, w, h } };
  }
  return { W, H, useWordmark, logoBox: null };
}

function iosSplashSvg(fact, { logoPresent, hasTextInLogo }) {
  const { W, H, useWordmark, logoBox } = iosSplashLayout({ logoPresent, hasTextInLogo });
  const a = accent(fact);
  // Gradient height extended from H*0.32 (918) to H*0.40 (≈1147) so the
  // brand-identity block fully sits on the gradient.
  const gradH = Math.round(H * 0.40);
  // Brand-name text y (only when not a wordmark replacement).
  // Sits in the gradient zone, well above the seam at y=gradH.
  const brandNameY = logoBox ? 980 : 720;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gradientDefs('g', fact)}
    <rect width="${W}" height="${H}" fill="${DARK}"/>
    <rect x="0" y="0" width="${W}" height="${gradH}" fill="url(#g)"/>

    <g transform="translate(${W/2 - 220},170)">
      <rect x="0" y="0" width="84" height="84" rx="27" fill="#ffffff" opacity="0.18"/>
      <rect x="6" y="6" width="72" height="72" rx="22" fill="${a}"/>
      <text x="42" y="62" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="52" fill="#ffffff">↑</text>
      <text x="104" y="60" font-family="${FONT_STACK}" font-weight="800" font-size="56" letter-spacing="-0.6" fill="#ffffff">Tru<tspan fill="#ffffff" opacity="0.85">North</tspan></text>
    </g>

    <g transform="translate(${W/2 - 220},340)">
      <rect width="440" height="56" rx="28" fill="#ffffff" opacity="0.18"/>
      <text x="220" y="38" text-anchor="middle" font-family="${FONT_STACK}" font-weight="700" font-size="22" letter-spacing="2" fill="#ffffff">${xml(fact.lens.toUpperCase())}</text>
    </g>

    ${logoBox ? `<rect x="${logoBox.x}" y="${logoBox.y}" width="${logoBox.w}" height="${logoBox.h}" fill="transparent"/>` : ''}

    ${useWordmark ? '' : `<text x="${W/2}" y="${brandNameY}" text-anchor="middle" font-family="${FONT_STACK}" font-weight="900" font-size="140" letter-spacing="-2.5" fill="#ffffff">${xml(fact.brandName)}</text>`}

    <text x="${W/2}" y="1500" text-anchor="middle" font-family="${FONT_STACK}" font-weight="900" font-size="460" letter-spacing="-18" fill="${TEXT}">${xml(fact.statNumber)}<tspan font-size="280" font-weight="900" fill="${a}">${xml(fact.statUnit || '')}</tspan></text>

    ${wrapCenteredText(fact.statKicker, { cx: W/2, y: 1640, maxChars: 24, fontSize: 56, color: TEXT, weight: 700, lineGap: 1.15 })}
    ${wrapCenteredText(fact.context, { cx: W/2, y: 1860, maxChars: 36, fontSize: 38, color: TEXT_DIM, weight: 500, lineGap: 1.3 })}

    <text x="${W/2}" y="2280" text-anchor="middle" font-family="${FONT_STACK}" font-weight="600" font-size="26" fill="${a}">Source</text>
    ${wrapCenteredText(fact.source, { cx: W/2, y: 2320, maxChars: 38, fontSize: 26, color: TEXT_DIM, weight: 500, lineGap: 1.3 })}

    <g transform="translate(${(W-820)/2},2480)">
      <rect width="820" height="120" rx="60" fill="${a}"/>
      <text x="410" y="78" text-anchor="middle" font-family="${FONT_STACK}" font-weight="800" font-size="44" fill="#ffffff">Tap to see the receipt →</text>
    </g>

    ${wrapCenteredText(DISCLAIMER, { cx: W/2, y: 2700, maxChars: 60, fontSize: 18, color: TEXT_DIM, weight: 500, lineGap: 1.3 })}
    <text x="${W/2}" y="2820" text-anchor="middle" font-family="${FONT_STACK}" font-weight="500" font-size="20" fill="${TEXT_DIM}" opacity="0.7">TruNorth · 11,000+ brands · 100 public-records sources</text>
  </svg>`;
}

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

// --- Compose: SVG base + logo overlay --------------------------------------

// Build a "logo cartridge" — a rounded white panel sized to the logo box,
// with the logo centered inside. Used on dark surfaces so brand logos in
// any colour (including dark/brown) read clearly without being modified.
// The logo itself is NOT recoloured or filtered.
async function buildLogoCartridge(slug, boxW, boxH, padding = 12) {
  const logo = await renderLogoBuffer(slug, boxW - padding * 2, boxH - padding * 2);
  if (!logo) return null;
  const cartridge = await sharp({
    create: { width: boxW, height: boxH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{
      input: logo.data,
      left: Math.round((boxW - logo.info.width) / 2),
      top: Math.round((boxH - logo.info.height) / 2),
    }])
    .png()
    .toBuffer({ resolveWithObject: true });
  // Round the corners by overlaying a mask.
  const r = 12;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxW}" height="${boxH}"><rect x="0" y="0" width="${boxW}" height="${boxH}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
  );
  const rounded = await sharp(cartridge.data)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer({ resolveWithObject: true });
  return rounded;
}

async function renderWithLogo({ svg, outPath, width, height, slug, logoBox, darkBg = false }) {
  const baseBuf = await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();
  if (!logoBox) {
    await fs.writeFile(outPath, baseBuf);
    return { logoComposited: false };
  }
  // On dark surfaces, wrap the logo in a white rounded cartridge so it
  // reads regardless of the logo's native colour.
  let composite;
  if (darkBg) {
    const cart = await buildLogoCartridge(slug, logoBox.w, logoBox.h, 12);
    if (!cart) {
      await fs.writeFile(outPath, baseBuf);
      return { logoComposited: false };
    }
    composite = { input: cart.data, left: Math.round(logoBox.x), top: Math.round(logoBox.y) };
  } else {
    const logo = await renderLogoBuffer(slug, logoBox.w, logoBox.h);
    if (!logo) {
      await fs.writeFile(outPath, baseBuf);
      return { logoComposited: false };
    }
    composite = {
      input: logo.data,
      left: Math.round(logoBox.x + (logoBox.w - logo.info.width) / 2),
      top:  Math.round(logoBox.y + (logoBox.h - logo.info.height) / 2),
    };
  }
  await sharp(baseBuf)
    .composite([composite])
    .png()
    .toFile(outPath);
  return { logoComposited: true };
}

// --- Contact sheets -------------------------------------------------------

async function buildContactSheet(paths, outPath, { cellW, cellH, cols = 5 }) {
  const gutter = 18;
  const rows = Math.ceil(paths.length / cols);
  const W = gutter + cols * (cellW + gutter);
  const H = gutter + rows * (cellH + gutter);
  const composites = [];
  for (let i = 0; i < paths.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const left = gutter + col * (cellW + gutter);
    const top  = gutter + row * (cellH + gutter);
    const buf = await sharp(paths[i]).resize(cellW, cellH, { fit: 'contain', background: '#0a0a0a' }).png().toBuffer();
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

  // Per-brand logo classification. If a brand's logo already contains the
  // brand name as a wordmark, we omit the redundant text label and render
  // the logo larger (taking the space the text would have occupied).
  let logoClass = { brands: {} };
  try {
    logoClass = JSON.parse(await fs.readFile(LOGO_CLASS_JSON, 'utf8'));
  } catch (err) {
    console.warn(`! Could not read ${LOGO_CLASS_JSON} (${err.message}); treating every brand as mark-only.`);
  }
  const brandsMap = logoClass.brands || {};

  console.log(`Rendering ${facts.length} facts → ${OUT_DIR}`);

  const all = { website: [], email: [], social: [], iosSplash: [] };
  let logoOk = 0;
  let wordmarkCount = 0;
  const noLogo = [];

  // Optional filters for fast iteration on a single brand or surface
  // (color preview, layout debugging). Examples:
  //   ONLY_SLUG=exxon-mobil ONLY_SURFACE=ios PURPLE=#4a3a8c node scripts/build-egregious-banners.mjs
  const ONLY_SLUG = process.env.ONLY_SLUG || '';
  const ONLY_SLUGS = ONLY_SLUG ? new Set(ONLY_SLUG.split(',').map(s => s.trim())) : null;
  const ONLY_SURFACE = process.env.ONLY_SURFACE || '';
  const skipContactSheets = !!(ONLY_SLUGS || ONLY_SURFACE);

  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    const slug = f.brandSlug;
    if (ONLY_SLUGS && !ONLY_SLUGS.has(slug)) continue;
    const logoFound = await findLogoFile(slug);
    const logoPresent = !!logoFound;
    const hasTextInLogo = brandsMap[slug] === true;
    const opts = { logoPresent, hasTextInLogo };

    const webPath  = path.join(OUT_DIR, `banner-website-${slug}.png`);
    const mailPath = path.join(OUT_DIR, `banner-email-${slug}.png`);
    const socPath  = path.join(OUT_DIR, `social-${slug}.png`);
    const iosPath  = path.join(OUT_DIR, `ios-splash-${slug}.png`);

    if (!ONLY_SURFACE || ONLY_SURFACE === 'website') {
      const webBox = websiteBannerLayout(opts).logoBox;
      await renderWithLogo({
        svg: websiteBannerSvg(f, opts),
        outPath: webPath, width: 1280, height: 320,
        slug, logoBox: webBox,
      });
    }

    if (!ONLY_SURFACE || ONLY_SURFACE === 'email') {
      const mailBox = emailBannerLayout(opts).logoBox;
      await renderWithLogo({
        svg: emailBannerSvg(f, opts),
        outPath: mailPath, width: 600, height: 200,
        slug, logoBox: mailBox,
      });
    }

    if (!ONLY_SURFACE || ONLY_SURFACE === 'social') {
      const socBox = socialCardLayout(opts).logoBox;
      await renderWithLogo({
        svg: socialCardSvg(f, opts),
        outPath: socPath, width: 1200, height: 675,
        slug, logoBox: socBox, darkBg: true,
      });
    }

    if (!ONLY_SURFACE || ONLY_SURFACE === 'ios') {
      const iosBox = iosSplashLayout(opts).logoBox;
      await renderWithLogo({
        svg: iosSplashSvg(f, opts),
        outPath: iosPath, width: 1320, height: 2868,
        slug, logoBox: iosBox, darkBg: true,
      });
    }

    if (logoFound) logoOk++; else noLogo.push(slug);
    if (logoFound && hasTextInLogo) wordmarkCount++;
    all.website.push(webPath);
    all.email.push(mailPath);
    all.social.push(socPath);
    all.iosSplash.push(iosPath);
    const tag = !logoFound ? 'no-logo' : (hasTextInLogo ? 'wordmark' : 'mark+text');
    console.log(`  [${i+1}/${facts.length}] ${slug} — ${f.brandName} (${f.statNumber}${f.statUnit||''}) ${tag}`);
  }

  // Contact sheets (6 cols × 5 rows) — skip when running with a slug/surface filter
  if (!skipContactSheets) {
    await buildContactSheet(all.website,   path.join(OUT_DIR, 'contact-sheet-website.png'),   { cellW: 320, cellH: 80,  cols: 6 });
    await buildContactSheet(all.email,     path.join(OUT_DIR, 'contact-sheet-email.png'),     { cellW: 240, cellH: 80,  cols: 6 });
    await buildContactSheet(all.social,    path.join(OUT_DIR, 'contact-sheet-social.png'),    { cellW: 320, cellH: 180, cols: 6 });
    await buildContactSheet(all.iosSplash, path.join(OUT_DIR, 'contact-sheet-ios-splash.png'),{ cellW: 200, cellH: 434, cols: 6 });
  }

  console.log(`Done. ${facts.length*4} banners + 4 contact sheets. ${logoOk}/${facts.length} brands with logos. ${wordmarkCount} rendered as wordmark-only (no redundant text label).`);
  if (noLogo.length) console.log(`  No logo (rendered without): ${noLogo.join(', ')}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
