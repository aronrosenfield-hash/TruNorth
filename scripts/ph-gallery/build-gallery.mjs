// Product Hunt launch gallery assets for TruNorth — Civic Premium refresh (2026-06-22).
// Rebuilt for the redesigned app (Build 65+): ink palette, teal signal, brass receipts,
// serif verdict voice. Sources the CLEAN (uncaptioned) screenshots in
// docs/app-store-screenshots/raw/ and composites 1270x760 landscape PH cards.
//
// Run: node scripts/ph-gallery/build-gallery.mjs
// Writes 6 deliverables to docs/producthunt/gallery/ (overwrites the stale purple set).

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = '/Users/aronrosenfield/Developer/trunorth';
const SRC_DIR = path.join(ROOT, 'docs/app-store-screenshots/raw');
const OUT_DIR = path.join(ROOT, 'docs/producthunt/gallery');

// Current redesign surfaces (clean, no baked-in captions)
const SCREENS = {
  today:   path.join(SRC_DIR, '01-today.png'),
  verdict: path.join(SRC_DIR, '02-verdict.png'),
  match:   path.join(SRC_DIR, '03-match.png'),
  ledger:  path.join(SRC_DIR, '04-ledger.png'),
  reveal:  path.join(SRC_DIR, '05-reveal.png'),
};

// Civic Premium palette
const INK = '#0E0F12';
const INK_TOP = '#15171C';
const INK_BOT = '#0A0B0E';
const CARD = '#16181D';
const BONE = '#EDE9E0';
const DIM = '#A9A498';
const SIGNAL = '#38C0CE'; // teal
const BRASS = '#C9A86A';
const EDGE = '#2A2D34';   // hairline border against ink

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',Times,serif";

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Ink background with a faint teal glow near the top-center, for depth.
function inkBgSvg(w, h) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ink" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${INK_TOP}"/>
        <stop offset="100%" stop-color="${INK_BOT}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="14%" r="62%">
        <stop offset="0%" stop-color="${SIGNAL}" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="${SIGNAL}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#ink)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
  </svg>`;
}

// Text wordmark "TruNorth" — bone + teal "North" (matches the in-app header)
function wordmarkSvg({ size = 50 } = {}) {
  const w = Math.round('TruNorth'.length * size * 0.6) + 20;
  const h = size + 18;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="${size}" font-family="${SANS}" font-weight="800" font-size="${size}" letter-spacing="-0.5">
      <tspan fill="${BONE}">Tru</tspan><tspan fill="${SIGNAL}">North</tspan>
    </text>
  </svg>`;
}

// Render a phone screenshot: resize by height, round the corners, add a hairline
// edge, then rotate. Returns { buffer, width, height }.
async function makePhone(srcPath, targetHeight, rotateDeg = 0) {
  const base = await sharp(srcPath).resize({ height: targetHeight }).ensureAlpha().png().toBuffer();
  const meta = await sharp(base).metadata();
  const w = meta.width, h = meta.height;
  const r = Math.round(w * 0.085);

  const mask = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
  const border = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" ry="${r}" fill="none" stroke="${EDGE}" stroke-width="2"/></svg>`);

  let phone = await sharp(base)
    .composite([{ input: mask, blend: 'dest-in' }, { input: border }])
    .png()
    .toBuffer();

  if (rotateDeg !== 0) {
    phone = await sharp(phone).rotate(rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  }
  const m2 = await sharp(phone).metadata();
  return { buffer: phone, width: m2.width, height: m2.height };
}

// ============================================================
// 1. gallery-hero.png — 1270x760, 3 angled phones + headline (feed thumbnail)
// ============================================================
async function buildHero() {
  const W = 1270, H = 760;
  const phoneH = 520;

  const left = await makePhone(SCREENS.verdict, phoneH, -8);
  const center = await makePhone(SCREENS.today, phoneH, 0);
  const right = await makePhone(SCREENS.match, phoneH, 8);

  const cx = W / 2;
  const phoneCenterY = 488;
  const place = (p, dx) => ({ input: p.buffer, left: Math.round(cx + dx - p.width / 2), top: Math.round(phoneCenterY - p.height / 2) });

  const wordmark = wordmarkSvg({ size: 46 });
  const textSvg = `<svg width="900" height="180" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="78" font-family="${SERIF}" font-weight="700" font-size="56" fill="${BONE}" letter-spacing="-1">Know where your money goes.</text>
    <text x="2" y="128" font-family="${SANS}" font-weight="500" font-size="23" fill="${DIM}">~2,900 brands graded · 12,000+ tracked · 200+ public-record sources</text>
  </svg>`;

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite([
      place(left, -362),
      place(right, 362),
      place(center, 0),
      { input: Buffer.from(wordmark), left: 64, top: 56 },
      { input: Buffer.from(textSvg), left: 60, top: 110 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-hero.png'));
  console.log('  ✓ gallery-hero.png');
}

// ============================================================
// 2. gallery-2-up.png — 1270x760, Match -> Verdict (personalization arc)
// ============================================================
async function build2Up() {
  const W = 1270, H = 760;
  const phoneH = 568;

  const leftP = await makePhone(SCREENS.match, phoneH, 0);
  const rightP = await makePhone(SCREENS.verdict, phoneH, 0);

  const gap = 72;
  const totalW = leftP.width + rightP.width + gap;
  const startX = Math.round((W - totalW) / 2);
  const phoneY = Math.round((H - phoneH) / 2) + 44;

  const captionSvg = `<svg width="${W}" height="110" xmlns="http://www.w3.org/2000/svg">
    <text x="${W / 2}" y="58" font-family="${SERIF}" font-weight="700" font-size="44" fill="${BONE}" text-anchor="middle" letter-spacing="-0.5">A 45-second values Match tunes every grade to you.</text>
  </svg>`;

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite([
      { input: leftP.buffer, left: startX, top: phoneY },
      { input: rightP.buffer, left: startX + leftP.width + gap, top: phoneY },
      { input: Buffer.from(captionSvg), left: 0, top: 40 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-2-up.png'));
  console.log('  ✓ gallery-2-up.png');
}

// ============================================================
// 3. gallery-data-sources.png — 1270x760, source badge grid on ink
// ============================================================
async function buildDataSources() {
  const W = 1270, H = 760;

  const sources = [
    'FEC', 'EPA', 'OSHA', 'SEC', 'NLRB',
    'OpenFDA', 'FTC', 'CFPB', 'EEOC', 'NHTSA',
    'CPSC', 'DOL WHD', 'OpenSecrets', 'IRS 990', 'ATF',
    'Have I Been Pwned', 'Yale CELI', 'Leaping Bunny', 'B Corp', 'USAspending',
  ];

  const cols = 5, rows = 4;
  const gridStartY = 250;
  const gridH = 400;
  const sidePad = 70;
  const cellW = (W - sidePad * 2) / cols;
  const cellH = gridH / rows;

  let badges = '';
  sources.forEach((name, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = sidePad + col * cellW + cellW / 2;
    const y = gridStartY + row * cellH + cellH / 2;
    const bw = Math.min(cellW - 28, 210), bh = 60;
    const fs = name.length > 12 ? 18 : 21;
    badges += `<g transform="translate(${x - bw / 2}, ${y - bh / 2})">
      <rect width="${bw}" height="${bh}" rx="13" ry="13" fill="${CARD}" stroke="${SIGNAL}" stroke-width="1.5" stroke-opacity="0.55"/>
      <text x="${bw / 2}" y="${bh / 2 + 7}" font-family="${SANS}" font-weight="700" font-size="${fs}" fill="${BONE}" text-anchor="middle">${escapeXml(name)}</text>
    </g>`;
  });

  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${W / 2}" y="108" font-family="${SERIF}" font-weight="700" font-size="50" fill="${BONE}" text-anchor="middle" letter-spacing="-0.5">Built on 200+ public-record sources.</text>
    <text x="${W / 2}" y="160" font-family="${SANS}" font-weight="600" font-size="23" fill="${BRASS}" text-anchor="middle">No surveys. No self-reports. Just the receipts.</text>
    ${badges}
    <text x="${W / 2}" y="${H - 44}" font-family="${SANS}" font-weight="500" font-size="18" fill="${DIM}" text-anchor="middle">+ 180 more across labor, environment, civil rights, political spend, product safety &amp; data privacy</text>
  </svg>`;

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite([{ input: Buffer.from(overlay), left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-data-sources.png'));
  console.log('  ✓ gallery-data-sources.png');
}

// ============================================================
// 4. social-twitter-card.png — 1200x675, 3 phones + PH callout
// ============================================================
async function buildTwitterCard() {
  const W = 1200, H = 675;
  const phoneH = 452;

  const left = await makePhone(SCREENS.verdict, phoneH, -6);
  const center = await makePhone(SCREENS.today, phoneH, 0);
  const right = await makePhone(SCREENS.match, phoneH, 6);

  const cx = W / 2, cy = 432;
  const place = (p, dx) => ({ input: p.buffer, left: Math.round(cx + dx - p.width / 2), top: Math.round(cy - p.height / 2) });

  const wordmark = wordmarkSvg({ size: 40 });
  const headline = `<svg width="760" height="70" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="48" font-family="${SERIF}" font-weight="700" font-size="40" fill="${BONE}" letter-spacing="-0.5">Know where your money goes.</text>
  </svg>`;
  const ph = `<svg width="430" height="92" xmlns="http://www.w3.org/2000/svg">
    <rect width="430" height="92" rx="14" ry="14" fill="${CARD}" stroke="${SIGNAL}" stroke-width="1.5" stroke-opacity="0.6"/>
    <text x="22" y="38" font-family="${SANS}" font-weight="800" font-size="17" fill="${SIGNAL}" letter-spacing="1">LIVE ON PRODUCT HUNT</text>
    <text x="22" y="70" font-family="${SANS}" font-weight="700" font-size="24" fill="${BONE}">June 23, 2026</text>
  </svg>`;

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite([
      place(left, -300), place(right, 300), place(center, 0),
      { input: Buffer.from(wordmark), left: 52, top: 44 },
      { input: Buffer.from(headline), left: 50, top: 96 },
      { input: Buffer.from(ph), left: W - 462, top: H - 124 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'social-twitter-card.png'));
  console.log('  ✓ social-twitter-card.png');
}

// ============================================================
// 5. social-linkedin-banner.png — 1200x627, text-left + 2 phones right
// ============================================================
async function buildLinkedIn() {
  const W = 1200, H = 627;
  const phoneH = 486;

  const p1 = await makePhone(SCREENS.verdict, phoneH, -4);
  const p2 = await makePhone(SCREENS.today, phoneH, 4);

  const phoneY = Math.round((H - phoneH) / 2);
  const p2X = W - p2.width - 56;
  const p1X = p2X - p1.width + 70;

  const wordmark = wordmarkSvg({ size: 40 });
  const headline = `<svg width="640" height="220" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="56" font-family="${SERIF}" font-weight="700" font-size="40" fill="${BONE}" letter-spacing="-0.5">
      <tspan x="0" dy="0">Built by one founder.</tspan>
      <tspan x="0" dy="52">Powered by 200+ public</tspan>
      <tspan x="0" dy="52">records — not surveys.</tspan>
    </text>
  </svg>`;
  const sub = `<svg width="640" height="120" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="34" font-family="${SANS}" font-weight="500" font-size="21" fill="${DIM}">~2,900 brands graded across 9 values categories.</text>
    <text x="0" y="72" font-family="${SANS}" font-weight="700" font-size="21" fill="${SIGNAL}">Live on Product Hunt · June 23, 2026</text>
  </svg>`;

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite([
      { input: p1.buffer, left: p1X, top: phoneY },
      { input: p2.buffer, left: p2X, top: phoneY },
      { input: Buffer.from(wordmark), left: 60, top: 56 },
      { input: Buffer.from(headline), left: 60, top: 128 },
      { input: Buffer.from(sub), left: 60, top: 446 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'social-linkedin-banner.png'));
  console.log('  ✓ social-linkedin-banner.png');
}

// ============================================================
// 6. 5up-contact-sheet.png — 1270x760, all 5 surfaces in a row
// ============================================================
async function buildContactSheet() {
  const W = 1270, H = 760;
  const order = ['today', 'verdict', 'match', 'ledger', 'reveal'];
  const caps = {
    today:   { t: 'Today', s: 'Your basket, judged against your values' },
    verdict: { t: 'The verdict', s: 'One answer, with the public-record receipts' },
    match:   { t: 'The Match', s: '45 seconds tunes every grade to you' },
    ledger:  { t: 'Your basket', s: 'Watch the dollars you redirect add up' },
    reveal:  { t: 'Your archetype', s: 'Every grade, tailored to you' },
  };

  const sidePad = 26, gap = 16, topPad = 70, captionH = 96;
  const phoneH = H - topPad - captionH - 34;
  const cellW = (W - sidePad * 2 - gap * 4) / 5;

  const composites = [];
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    let p = await makePhone(SCREENS[key], phoneH, 0);
    if (p.width > cellW) {
      const buf = await sharp(p.buffer).resize({ width: Math.round(cellW) }).png().toBuffer();
      const m = await sharp(buf).metadata();
      p = { buffer: buf, width: m.width, height: m.height };
    }
    const cellX = sidePad + i * (cellW + gap);
    composites.push({ input: p.buffer, left: Math.round(cellX + (cellW - p.width) / 2), top: topPad });

    const c = caps[key];
    const capSvg = `<svg width="${Math.round(cellW)}" height="${captionH}" xmlns="http://www.w3.org/2000/svg">
      <text x="${Math.round(cellW / 2)}" y="28" font-family="${SANS}" font-weight="800" font-size="18" fill="${SIGNAL}" text-anchor="middle">${i + 1}. ${escapeXml(c.t)}</text>
      <foreignObject x="0" y="40" width="${Math.round(cellW)}" height="${captionH - 40}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${SANS};font-weight:500;font-size:14px;color:${DIM};text-align:center;line-height:1.35;padding:0 6px;">${escapeXml(c.s)}</div>
      </foreignObject>
    </svg>`;
    composites.push({ input: Buffer.from(capSvg), left: Math.round(cellX), top: topPad + phoneH + 12 });
  }

  const header = `<svg width="${W}" height="54" xmlns="http://www.w3.org/2000/svg">
    <text x="${W / 2}" y="36" font-family="${SERIF}" font-weight="700" font-size="26" fill="${BONE}" text-anchor="middle" letter-spacing="-0.3">TruNorth — records, not opinions.</text>
  </svg>`;
  composites.unshift({ input: Buffer.from(header), left: 0, top: 14 });

  await sharp(Buffer.from(inkBgSvg(W, H)))
    .composite(composites)
    .png()
    .toFile(path.join(OUT_DIR, '5up-contact-sheet.png'));
  console.log('  ✓ 5up-contact-sheet.png');
}

// ============================================================
(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const builders = [
    ['hero', buildHero], ['2-up', build2Up], ['data-sources', buildDataSources],
    ['twitter', buildTwitterCard], ['linkedin', buildLinkedIn], ['contact-sheet', buildContactSheet],
  ];
  for (const [name, fn] of builders) {
    try { await fn(); }
    catch (e) { console.error(`  ✗ ${name}: ${e.message}`); console.error(e.stack); }
  }
  const pngs = (await fs.readdir(OUT_DIR)).filter(f => f.endsWith('.png'));
  let bytes = 0;
  for (const f of pngs) bytes += (await fs.stat(path.join(OUT_DIR, f))).size;
  console.log(`\nWROTE ${pngs.length} files to docs/producthunt/gallery/ — ${(bytes / 1024 / 1024).toFixed(2)} MB`);
})();
