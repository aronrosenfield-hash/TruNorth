// Product Hunt launch gallery assets for TruNorth.
// Generates 6 deliverables under docs/producthunt/gallery/.
//
// Uses sharp for compositing + SVG overlays. Falls back gracefully on failure.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/final';
const OUT_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/producthunt/gallery';

const SCREENS = {
  search:    path.join(SRC_DIR, '01-search.png'),
  quiz:      path.join(SRC_DIR, '02-quiz.png'),
  topPicks:  path.join(SRC_DIR, '03-top-picks.png'),
  scanner:   path.join(SRC_DIR, '04-scanner.png'),
  account:   path.join(SRC_DIR, '05-account.png'),
};

const CAPTIONS = {
  search:   '11,000+ brands graded with public records',
  quiz:     '30-second quiz tunes every score to you',
  topPicks: 'Personalized Top Picks for your values',
  scanner:  'Scan any barcode in-store',
  account:  'Your values archetype, your fingerprint',
};

const PURPLE_LIGHT = '#7c6dfa';
const PURPLE_DARK = '#5b4ed7';
const DARK_BG = '#0a0a0a';

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Purple gradient background SVG (top to bottom)
function gradientBgSvg(w, h) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${PURPLE_LIGHT}"/>
        <stop offset="100%" stop-color="${PURPLE_DARK}"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
  </svg>`;
}

function solidBgSvg(w, h, color) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${color}"/>
  </svg>`;
}

// Wordmark "TruNorth" rendered as SVG. Returns {buffer, width, height}
async function wordmarkSvg({ size = 64, lightColor = '#f2f2f2', accentColor = PURPLE_LIGHT, includeMark = true } = {}) {
  const markSize = Math.round(size * 0.95);
  const markRadius = Math.round(markSize * 0.18);
  const arrowSize = Math.round(size * 0.7);
  const markX = 0;
  const markY = 0;
  const textX = includeMark ? markSize + Math.round(size * 0.28) : 0;
  // Approximate text widths for the wordmark
  const charW = size * 0.5;
  const totalTextW = Math.round('TruNorth'.length * charW);
  const svgW = textX + totalTextW + 20;
  const svgH = Math.max(markSize, size) + 10;

  return `<svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
    ${includeMark ? `
      <rect x="${markX}" y="${markY}" width="${markSize}" height="${markSize}" rx="${markRadius}" ry="${markRadius}" fill="${accentColor}"/>
      <text x="${markX + markSize/2}" y="${markY + markSize/2 + arrowSize*0.32}" font-family="${FONT_STACK}" font-weight="900" font-size="${arrowSize}" fill="#ffffff" text-anchor="middle">↑</text>
    ` : ''}
    <text x="${textX}" y="${size * 0.78 + 5}" font-family="${FONT_STACK}" font-weight="800" font-size="${size}" letter-spacing="-0.5">
      <tspan fill="${lightColor}">Tru</tspan><tspan fill="${accentColor}">North</tspan>
    </text>
  </svg>`;
}

// Render a phone screenshot scaled to target height, optionally rotated.
// Returns the buffer + final width/height after rotation.
async function preparePhone(srcPath, targetHeight, rotateDeg = 0) {
  const phoneRaw = await sharp(srcPath).resize({ height: targetHeight }).png().toBuffer();
  const meta = await sharp(phoneRaw).metadata();
  // Add rounded corners + drop shadow effect via SVG mask + extension
  // For simplicity: just rotate with transparent bg
  if (rotateDeg === 0) {
    return { buffer: phoneRaw, width: meta.width, height: meta.height };
  }
  const rotated = await sharp(phoneRaw)
    .rotate(rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const rMeta = await sharp(rotated).metadata();
  return { buffer: rotated, width: rMeta.width, height: rMeta.height };
}

// Drop shadow: render a slightly larger dark blurred rectangle behind a phone.
// Returns a composite list entry (we render shadow then phone).
async function phoneWithShadow(srcPath, targetHeight, rotateDeg = 0, shadowOpacity = 0.45) {
  const phone = await preparePhone(srcPath, targetHeight, rotateDeg);
  // Make a shadow by darkening + blurring the phone silhouette
  const shadow = await sharp(phone.buffer)
    .ensureAlpha()
    .composite([{ input: Buffer.from(`<svg><rect width="${phone.width}" height="${phone.height}" fill="#000" opacity="${shadowOpacity}"/></svg>`), blend: 'in' }])
    .blur(18)
    .png()
    .toBuffer();
  return { phone, shadow };
}

// ============================================================
// 1. gallery-hero.png — 1270x760 with 3 angled phones
// ============================================================
async function buildHero() {
  const W = 1270, H = 760;
  const bg = Buffer.from(gradientBgSvg(W, H));
  const phoneH = 600;

  // Three phones: left (-8°), center (0°), right (+8°)
  const left = await phoneWithShadow(SCREENS.search, phoneH, -8);
  const center = await phoneWithShadow(SCREENS.topPicks, phoneH, 0);
  const right = await phoneWithShadow(SCREENS.scanner, phoneH, 8);

  // Layout: phones overlap slightly. Center phone in middle, others flank.
  const centerX = W / 2;
  const phoneCenterY = 420;

  const leftX = Math.round(centerX - 360 - left.phone.width / 2);
  const leftY = Math.round(phoneCenterY - left.phone.height / 2);
  const centerXpos = Math.round(centerX - center.phone.width / 2);
  const centerY = Math.round(phoneCenterY - center.phone.height / 2);
  const rightX = Math.round(centerX + 360 - right.phone.width / 2);
  const rightY = Math.round(phoneCenterY - right.phone.height / 2);

  // Wordmark + tagline overlay (top-left)
  const wordmark = await wordmarkSvg({ size: 56, lightColor: '#ffffff', accentColor: '#ffffff', includeMark: true });
  const taglineSvg = `<svg width="700" height="80" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="50" font-family="${FONT_STACK}" font-weight="700" font-size="38" fill="#ffffff" letter-spacing="-0.5">Grade any brand on what each company does.</text>
  </svg>`;
  // Subtitle line
  const subSvg = `<svg width="700" height="40" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="28" font-family="${FONT_STACK}" font-weight="500" font-size="20" fill="#e6e0ff" opacity="0.95">11,209 brands · 113 public-record sources</text>
  </svg>`;

  await sharp(bg)
    .composite([
      // Shadows first (offset down-right slightly)
      { input: left.shadow, left: leftX + 8, top: leftY + 14 },
      { input: right.shadow, left: rightX + 8, top: rightY + 14 },
      { input: center.shadow, left: centerXpos + 6, top: centerY + 18 },
      // Phones
      { input: left.phone.buffer, left: leftX, top: leftY },
      { input: right.phone.buffer, left: rightX, top: rightY },
      { input: center.phone.buffer, left: centerXpos, top: centerY },
      // Text overlays
      { input: Buffer.from(await wordmark), left: 60, top: 50 },
      { input: Buffer.from(taglineSvg), left: 60, top: 130 },
      { input: Buffer.from(subSvg), left: 60, top: 190 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-hero.png'));
  console.log('  ✓ gallery-hero.png');
}

// ============================================================
// 2. gallery-2-up.png — 1270x760, two phones side by side
// ============================================================
async function build2Up() {
  const W = 1270, H = 760;
  const bg = Buffer.from(gradientBgSvg(W, H));
  const phoneH = 580;

  const leftP = await phoneWithShadow(SCREENS.quiz, phoneH, 0);
  const rightP = await phoneWithShadow(SCREENS.account, phoneH, 0);

  const gap = 60;
  const totalW = leftP.phone.width + rightP.phone.width + gap;
  const startX = Math.round((W - totalW) / 2);
  const phoneY = Math.round((H - phoneH) / 2) + 40;

  const leftX = startX;
  const rightX = startX + leftP.phone.width + gap;

  // Caption centered above
  const captionSvg = `<svg width="${W}" height="100" xmlns="http://www.w3.org/2000/svg">
    <text x="${W/2}" y="60" font-family="${FONT_STACK}" font-weight="800" font-size="44" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5">30-second quiz → Your values fingerprint</text>
  </svg>`;

  await sharp(bg)
    .composite([
      { input: leftP.shadow, left: leftX + 8, top: phoneY + 14 },
      { input: rightP.shadow, left: rightX + 8, top: phoneY + 14 },
      { input: leftP.phone.buffer, left: leftX, top: phoneY },
      { input: rightP.phone.buffer, left: rightX, top: phoneY },
      { input: Buffer.from(captionSvg), left: 0, top: 40 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-2-up.png'));
  console.log('  ✓ gallery-2-up.png');
}

// ============================================================
// 3. gallery-data-sources.png — 1270x760, dark bg + source grid
// ============================================================
async function buildDataSources() {
  const W = 1270, H = 760;
  const bg = Buffer.from(solidBgSvg(W, H, DARK_BG));

  const sources = [
    'FEC', 'EPA', 'OSHA', 'SEC',
    'NLRB', 'OpenFDA', 'USAspending', 'B Corp',
    'OpenSecrets', 'IRS 990', 'EEOC', 'NHTSA',
    'CPSC', 'DOL WHD', 'PETA', 'Leaping Bunny',
    'BBB', 'Glassdoor', 'CDP', 'DOJ',
  ];

  // 4 columns × 5 rows grid
  const cols = 4, rows = 5;
  const gridStartY = 220;
  const gridH = 460;
  const cellW = (W - 160) / cols;
  const cellH = gridH / rows;
  const cellPadX = 80;

  let badgesXml = '';
  sources.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = cellPadX + col * cellW + cellW / 2;
    const y = gridStartY + row * cellH + cellH / 2;
    // Rounded rect badge
    const badgeW = Math.min(cellW - 40, 240);
    const badgeH = 56;
    badgesXml += `
      <g transform="translate(${x - badgeW/2}, ${y - badgeH/2})">
        <rect width="${badgeW}" height="${badgeH}" rx="12" ry="12" fill="#1a1a1f" stroke="${PURPLE_LIGHT}" stroke-width="2"/>
        <text x="${badgeW/2}" y="${badgeH/2 + 8}" font-family="${FONT_STACK}" font-weight="700" font-size="20" fill="#ffffff" text-anchor="middle">${escapeXml(name)}</text>
      </g>`;
  });

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${W/2}" y="100" font-family="${FONT_STACK}" font-weight="800" font-size="48" fill="#ffffff" text-anchor="middle" letter-spacing="-0.5">Built on 113 public-record data sources</text>
    <text x="${W/2}" y="150" font-family="${FONT_STACK}" font-weight="500" font-size="22" fill="${PURPLE_LIGHT}" text-anchor="middle">No surveys. No vendor self-reports. Just the receipts.</text>
    ${badgesXml}
    <text x="${W/2}" y="${H - 40}" font-family="${FONT_STACK}" font-weight="500" font-size="18" fill="#888" text-anchor="middle">+ 93 more sources spanning labor, environment, civil rights, political spend, and product safety</text>
  </svg>`;

  await sharp(bg)
    .composite([{ input: Buffer.from(overlaySvg), left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT_DIR, 'gallery-data-sources.png'));
  console.log('  ✓ gallery-data-sources.png');
}

// ============================================================
// 4. social-twitter-card.png — 1200x675 with PH callout
// ============================================================
async function buildTwitterCard() {
  const W = 1200, H = 675;
  const bg = Buffer.from(gradientBgSvg(W, H));
  const phoneH = 520;

  const left = await phoneWithShadow(SCREENS.search, phoneH, -6);
  const center = await phoneWithShadow(SCREENS.topPicks, phoneH, 0);
  const right = await phoneWithShadow(SCREENS.scanner, phoneH, 6);

  const phoneCenterY = 400;
  const centerX = W / 2;
  const leftX = Math.round(centerX - 300 - left.phone.width / 2);
  const leftY = Math.round(phoneCenterY - left.phone.height / 2);
  const centerXpos = Math.round(centerX - center.phone.width / 2);
  const centerY = Math.round(phoneCenterY - center.phone.height / 2);
  const rightX = Math.round(centerX + 300 - right.phone.width / 2);
  const rightY = Math.round(phoneCenterY - right.phone.height / 2);

  const wordmark = await wordmarkSvg({ size: 48, lightColor: '#ffffff', accentColor: '#ffffff', includeMark: true });
  const taglineSvg = `<svg width="700" height="80" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="45" font-family="${FONT_STACK}" font-weight="700" font-size="34" fill="#ffffff" letter-spacing="-0.5">Grade any brand on what each company does.</text>
  </svg>`;

  // PH callout — lower right
  const phCalloutSvg = `<svg width="380" height="100" xmlns="http://www.w3.org/2000/svg">
    <rect width="380" height="100" rx="14" ry="14" fill="#ffffff" opacity="0.95"/>
    <text x="22" y="38" font-family="${FONT_STACK}" font-weight="800" font-size="18" fill="#da552f">LAUNCHING ON PRODUCT HUNT</text>
    <text x="22" y="72" font-family="${FONT_STACK}" font-weight="700" font-size="26" fill="#1a1a1f">June 23, 2026</text>
  </svg>`;

  await sharp(bg)
    .composite([
      { input: left.shadow, left: leftX + 6, top: leftY + 12 },
      { input: right.shadow, left: rightX + 6, top: rightY + 12 },
      { input: center.shadow, left: centerXpos + 6, top: centerY + 14 },
      { input: left.phone.buffer, left: leftX, top: leftY },
      { input: right.phone.buffer, left: rightX, top: rightY },
      { input: center.phone.buffer, left: centerXpos, top: centerY },
      { input: Buffer.from(await wordmark), left: 50, top: 40 },
      { input: Buffer.from(taglineSvg), left: 50, top: 105 },
      { input: Buffer.from(phCalloutSvg), left: W - 400, top: H - 120 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'social-twitter-card.png'));
  console.log('  ✓ social-twitter-card.png');
}

// ============================================================
// 5. social-linkedin-banner.png — 1200x627
// ============================================================
async function buildLinkedIn() {
  const W = 1200, H = 627;
  const bg = Buffer.from(gradientBgSvg(W, H));
  const phoneH = 500;

  // Two phones — leave text room on the left
  const p1 = await phoneWithShadow(SCREENS.search, phoneH, -4);
  const p2 = await phoneWithShadow(SCREENS.topPicks, phoneH, 4);

  const phoneY = Math.round((H - phoneH) / 2);
  const p1X = W - p1.phone.width - 280;
  const p2X = W - p2.phone.width - 60;

  const wordmark = await wordmarkSvg({ size: 44, lightColor: '#ffffff', accentColor: '#ffffff', includeMark: true });

  const headlineSvg = `<svg width="640" height="200" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="50" font-family="${FONT_STACK}" font-weight="800" font-size="38" fill="#ffffff" letter-spacing="-0.5">
      <tspan x="0" dy="0">Built by one founder.</tspan>
      <tspan x="0" dy="46">Powered by 113 public</tspan>
      <tspan x="0" dy="46">records — not surveys.</tspan>
    </text>
  </svg>`;

  const subSvg = `<svg width="640" height="120" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="34" font-family="${FONT_STACK}" font-weight="500" font-size="22" fill="#e6e0ff">11,209 consumer brands graded across 9 values categories.</text>
    <text x="0" y="74" font-family="${FONT_STACK}" font-weight="700" font-size="22" fill="#ffffff">Launching on Product Hunt · June 23, 2026</text>
  </svg>`;

  await sharp(bg)
    .composite([
      { input: p1.shadow, left: p1X + 6, top: phoneY + 12 },
      { input: p2.shadow, left: p2X + 6, top: phoneY + 12 },
      { input: p1.phone.buffer, left: p1X, top: phoneY },
      { input: p2.phone.buffer, left: p2X, top: phoneY },
      { input: Buffer.from(await wordmark), left: 60, top: 50 },
      { input: Buffer.from(headlineSvg), left: 60, top: 130 },
      { input: Buffer.from(subSvg), left: 60, top: 440 },
    ])
    .png()
    .toFile(path.join(OUT_DIR, 'social-linkedin-banner.png'));
  console.log('  ✓ social-linkedin-banner.png');
}

// ============================================================
// 6. 5up-contact-sheet.png — 1270x760, all 5 screens in a row
// ============================================================
async function buildContactSheet() {
  const W = 1270, H = 760;
  const bg = Buffer.from(gradientBgSvg(W, H));

  const order = ['search', 'quiz', 'topPicks', 'scanner', 'account'];
  const captions = order.map(k => CAPTIONS[k]);

  const gap = 16;
  const sidePad = 24;
  const topPad = 60;
  const captionH = 100;
  const phoneH = H - topPad - captionH - 40;
  const cellW = (W - sidePad * 2 - gap * 4) / 5;

  const composites = [];

  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const p = await preparePhone(SCREENS[key], phoneH, 0);
    // If phone width exceeds cellW, scale down by width
    let phoneBuf = p.buffer;
    let pw = p.width, ph = p.height;
    if (pw > cellW) {
      phoneBuf = await sharp(p.buffer).resize({ width: Math.round(cellW) }).png().toBuffer();
      const m = await sharp(phoneBuf).metadata();
      pw = m.width; ph = m.height;
    }
    const cellX = sidePad + i * (cellW + gap);
    const phoneX = Math.round(cellX + (cellW - pw) / 2);
    const phoneY = topPad;
    composites.push({ input: phoneBuf, left: phoneX, top: phoneY });

    // Caption SVG under each phone
    const capSvg = `<svg width="${Math.round(cellW)}" height="${captionH}" xmlns="http://www.w3.org/2000/svg">
      <text x="${Math.round(cellW/2)}" y="28" font-family="${FONT_STACK}" font-weight="800" font-size="16" fill="#ffffff" text-anchor="middle">${i + 1}. ${escapeXml(captions[i].split(' ').slice(0, 3).join(' '))}</text>
      <foreignObject x="0" y="36" width="${Math.round(cellW)}" height="${captionH - 36}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:${FONT_STACK};font-weight:500;font-size:13px;color:#e6e0ff;text-align:center;line-height:1.3;padding:0 4px;">${escapeXml(captions[i])}</div>
      </foreignObject>
    </svg>`;
    composites.push({ input: Buffer.from(capSvg), left: Math.round(cellX), top: topPad + phoneH + 12 });
  }

  // Header
  const headerSvg = `<svg width="${W}" height="50" xmlns="http://www.w3.org/2000/svg">
    <text x="${W/2}" y="34" font-family="${FONT_STACK}" font-weight="800" font-size="22" fill="#ffffff" text-anchor="middle" letter-spacing="-0.3">TruNorth — App Store screenshots (contact sheet)</text>
  </svg>`;
  composites.unshift({ input: Buffer.from(headerSvg), left: 0, top: 10 });

  await sharp(bg)
    .composite(composites)
    .png()
    .toFile(path.join(OUT_DIR, '5up-contact-sheet.png'));
  console.log('  ✓ 5up-contact-sheet.png');
}

// ============================================================
// Main
// ============================================================
(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const builders = [
    ['hero', buildHero],
    ['2-up', build2Up],
    ['data-sources', buildDataSources],
    ['twitter', buildTwitterCard],
    ['linkedin', buildLinkedIn],
    ['contact-sheet', buildContactSheet],
  ];

  for (const [name, fn] of builders) {
    try {
      await fn();
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      console.error(e.stack);
    }
  }

  // Verify
  const files = await fs.readdir(OUT_DIR);
  const pngs = files.filter(f => f.endsWith('.png'));
  let totalBytes = 0;
  for (const f of pngs) {
    const stat = await fs.stat(path.join(OUT_DIR, f));
    totalBytes += stat.size;
  }
  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(`\nWROTE ${pngs.length} FILES TO docs/producthunt/gallery/ — Total size ${mb} MB`);
})();
