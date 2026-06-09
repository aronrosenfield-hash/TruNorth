// Pad iPhone screenshots to 13-inch iPad display dimensions (2064 × 2752).
// Centers each phone screenshot on a TruNorth-purple gradient background.
//
// Apple's 13-inch iPad display slot expects 2064 × 2752 (M4 iPad Pro 13",
// 2024+). It also accepts 2048 × 2732 (older 12.9" iPad Pro). We use the
// newer 2064 × 2752 spec to match the listing's "13-inch" label.

import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/final';
const OUT_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/final-ipad';

const IPAD_W = 2064;
const IPAD_H = 2752;

// Phone source is 1290 × 2796 — scale to fit the iPad height with a small
// margin, then center horizontally on the purple canvas.
const TARGET_H = 2500; // gives 126px top + bottom margin on the iPad canvas
const SCALE = TARGET_H / 2796; // ~0.894
const TARGET_W = Math.round(1290 * SCALE); // ~1153

const FILES = [
  '01-search.png',
  '02-quiz.png',
  '03-top-picks.png',
  '04-scanner.png',
  '05-account.png',
];

// TruNorth-purple gradient background as an SVG (cleanly composited by sharp).
const bgSvg = `<svg width="${IPAD_W}" height="${IPAD_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#7c6dfa"/>
      <stop offset="100%" stop-color="#5b4ed7"/>
    </linearGradient>
  </defs>
  <rect width="${IPAD_W}" height="${IPAD_H}" fill="url(#bg)"/>
</svg>`;

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const f of FILES) {
    const src = path.join(SRC_DIR, f);
    const dst = path.join(OUT_DIR, f);
    const phoneBuf = await sharp(src).resize(TARGET_W, TARGET_H, { fit: 'fill' }).png().toBuffer();
    const left = Math.round((IPAD_W - TARGET_W) / 2);
    const top  = Math.round((IPAD_H - TARGET_H) / 2);
    await sharp(Buffer.from(bgSvg))
      .composite([{ input: phoneBuf, left, top }])
      .png()
      .toFile(dst);
    console.log(`  ✓ ${f}  (centered phone at left=${left}, top=${top})`);
  }
  console.log(`\nDone. iPad screenshots in: ${OUT_DIR}`);
})();
