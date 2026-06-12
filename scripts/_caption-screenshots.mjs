// Composite each raw screenshot with a Civic Premium caption band.
// iPhone: 1290×2796 (raw/ → final/) · iPad: 2048×2732 (raw-ipad/ → final-ipad/, --ipad)
//
// Band: ink (#0E0F12), bone serif-feel headline, 4px verdigris rule at the
// band's base. No purple anywhere — R2 brand system (docs/design/REDESIGN_BRIEF.md).

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const IPAD = process.argv.includes('--ipad');
const ROOT = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots';
const SRC_DIR = path.join(ROOT, IPAD ? 'raw-ipad' : 'raw');
const OUT_DIR = path.join(ROOT, IPAD ? 'final-ipad' : 'final');

const W = IPAD ? 2048 : 1290;
const H = IPAD ? 2732 : 2796;
const BAND_H = IPAD ? 360 : 320;
const APP_H = H - BAND_H;

const INK = '#0E0F12';
const BONE = '#EDE9E0';
const DIM = '#A9A498';
const VERD = '#38C0CE';

const CAPTIONS = [
  { src: '01-today.png',   out: '01-today.png',   text: 'Your basket, judged against YOUR values' },
  { src: '02-verdict.png', out: '02-verdict.png', text: 'One verdict, with receipts — 200+ public sources' },
  { src: '03-match.png',   out: '03-match.png',   text: 'Nine choices shape your compass' },
  { src: '04-ledger.png',  out: '04-ledger.png',  text: 'Count every dollar you redirect' },
  { src: '05-reveal.png',  out: '05-reveal.png',  text: 'Meet your values archetype' },
];

function bandSvg(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  const maxChars = IPAD ? 46 : 30;
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  const fs1 = IPAD ? 78 : (lines.length > 1 ? 64 : 70);
  const lh = fs1 * 1.18;
  const startY = BAND_H / 2 - ((lines.length - 1) * lh) / 2 + fs1 * 0.35;
  const tspans = lines.map((l, i) =>
    `<text x="${W / 2}" y="${startY + i * lh}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${fs1}" fill="${BONE}">${l.replace(/&/g, '&amp;')}</text>`
  ).join('');
  return Buffer.from(`<svg width="${W}" height="${BAND_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${BAND_H}" fill="${INK}"/>
    ${tspans}
    <rect x="0" y="${BAND_H - 4}" width="${W}" height="4" fill="${VERD}"/>
  </svg>`);
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const c of CAPTIONS) {
    const srcPath = path.join(SRC_DIR, c.src);
    try { await fs.access(srcPath); } catch { console.log('  · skip (no raw):', c.src); continue; }
    const app = await sharp(srcPath).resize(W, APP_H, { fit: 'cover', position: 'top' }).toBuffer();
    await sharp({ create: { width: W, height: H, channels: 3, background: INK } })
      .composite([
        { input: bandSvg(c.text), top: 0, left: 0 },
        { input: app, top: BAND_H, left: 0 },
      ])
      .png()
      .toFile(path.join(OUT_DIR, c.out));
    console.log('  ✓', c.out);
  }
  console.log(`done → ${OUT_DIR}`);
})();
