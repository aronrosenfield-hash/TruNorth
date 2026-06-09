// Composite each raw screenshot with a TruNorth-purple caption band.
// Output: 1290×2796 PNGs ready for App Store Connect.
//
// Layout:
//   ┌─────────────────────────────┐ ← 1290 wide
//   │  TruNorth purple band       │   320 tall
//   │  CAPTION TEXT (white bold)  │
//   ├─────────────────────────────┤
//   │                             │   2476 tall (the screenshot)
//   │   App screen (scaled in)    │
//   │                             │
//   └─────────────────────────────┘   total: 2796 tall

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/raw';
const OUT_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/final';

const W = 1290;
const H = 2796;
const BAND_H = 320;
const APP_H = H - BAND_H; // 2476

const PURPLE = '#7c6dfa';
const DARK = '#0f0f0f';

const CAPTIONS = [
  { src: '01-search.png',     out: '01-search.png',     text: '11,000+ brands graded with public records' },
  { src: '02-quiz.png',       out: '02-quiz.png',       text: '30-second quiz tunes every score to you' },
  { src: '03-top-picks.png',  out: '03-top-picks.png',  text: 'Personalized Top Picks for your values' },
  { src: '04-scanner.png',    out: '04-scanner.png',    text: 'Scan any barcode in-store' },
  { src: '05-account.png',    out: '05-account.png',    text: 'Your values archetype, your fingerprint' },
];

// Generate an SVG band with the caption text — sharp composites SVG → PNG cleanly
function captionBandSvg(text) {
  // Word-wrap to roughly 2 lines if needed (split at ~32 chars)
  const words = text.split(/\s+/);
  let lines = [text];
  if (text.length > 32) {
    let line1 = '', line2 = '';
    for (const w of words) {
      if (line1.length + w.length + 1 <= 32) line1 += (line1 ? ' ' : '') + w;
      else line2 += (line2 ? ' ' : '') + w;
    }
    lines = [line1, line2];
  }
  const fontSize = lines.length === 1 ? 72 : 60;
  const lineHeight = fontSize * 1.15;
  const totalTextH = lineHeight * lines.length;
  const startY = (BAND_H - totalTextH) / 2 + fontSize * 0.85;
  const tspans = lines.map((l, i) => `<tspan x="${W/2}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(l)}</tspan>`).join('');
  return `<svg width="${W}" height="${BAND_H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#7c6dfa"/>
        <stop offset="100%" stop-color="#5b4ed7"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${BAND_H}" fill="url(#bg)"/>
    <text x="${W/2}" y="${startY}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif" font-weight="800" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="alphabetic">${tspans}</text>
  </svg>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Safety check: if a file in final/ is NEWER than its source in raw/, the
  // user probably put their phone screenshot directly into final/ by
  // mistake. Abort instead of silently overwriting.
  let warnings = [];
  for (const c of CAPTIONS) {
    const srcPath = path.join(SRC_DIR, c.src);
    const outPath = path.join(OUT_DIR, c.out);
    try {
      const srcStat = await fs.stat(srcPath);
      const outStat = await fs.stat(outPath);
      if (outStat.mtimeMs > srcStat.mtimeMs + 1000) {
        warnings.push(`  ${c.out} in final/ is NEWER than raw/ source — looks like you may have dropped a fresh screenshot into the wrong folder`);
      }
    } catch {} // missing files are fine
  }
  if (warnings.length > 0) {
    console.error('⚠️  ABORTING — would overwrite newer files in final/:');
    console.error(warnings.join('\n'));
    console.error('\nIf this is intentional, delete the affected files in final/ and re-run.');
    console.error('Source files go in: ' + SRC_DIR);
    process.exit(1);
  }

  for (const c of CAPTIONS) {
    const srcPath = path.join(SRC_DIR, c.src);
    const outPath = path.join(OUT_DIR, c.out);
    // Resize the raw screenshot to fit the 2476-tall app area, anchored top-left
    const appBuf = await sharp(srcPath).resize(W, APP_H, { fit: 'cover', position: 'top' }).png().toBuffer();
    const bandBuf = Buffer.from(captionBandSvg(c.text));
    // Composite: caption band at top (y=0), app screenshot below (y=BAND_H)
    await sharp({ create: { width: W, height: H, channels: 4, background: DARK } })
      .composite([
        { input: bandBuf, top: 0,      left: 0 },
        { input: appBuf,  top: BAND_H, left: 0 },
      ])
      .png()
      .toFile(outPath);
    console.log(`  ✓ ${c.out}  (${c.text})`);
  }
  console.log(`\nFinal screenshots in: ${OUT_DIR}`);
})();
