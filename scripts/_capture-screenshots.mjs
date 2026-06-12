// Capture App Store screenshots from the local dev server.
// R2 edition (2026-06-12): five scenes off the Civic Premium four-surface
// app — Today (clash-led card), Lens verdict (Patagonia), the Match
// (ENVIRONMENT tension card), Ledger (switch receipts), the Reveal.
//
// iPhone: 430×932 @3x → 1290×2796 (6.7" class)
// iPad:   1024×1366 @2x → 2048×2732 (12.9" class)   (--ipad)
//
// Runs against http://localhost:5173 (start `npm run dev` first).
// Uses puppeteer-core + system Chrome — no bundled browser download.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const IPAD = process.argv.includes('--ipad');
const ROOT = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots';
const OUT_DIR = path.join(ROOT, IPAD ? 'raw-ipad' : 'raw');
const BASE = 'http://localhost:5173';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const VIEWPORT = IPAD
  ? { width: 1024, height: 1366, deviceScaleFactor: 2 }
  : { width: 430, height: 932, deviceScaleFactor: 3 };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Profile shape MUST match normalizeProfile v2 (lean/deiLean/animalTesting/
// guns/unionSupport/weights/dealBreakers). Values-forward, non-partisan —
// store screenshots should demo the product, not a politics.
const PROFILE = {
  v: 2,
  lean: 'neutral', deiLean: 'neutral', animalTesting: 'prefer_not',
  guns: 'neutral', unionSupport: 'neutral',
  weights: { political: 3, charity: 3, environment: 5, labor: 4, dei: 2, animals: 3, guns: 2, privacy: 4, execPay: 3 },
  dealBreakers: ['forcedLabor', 'childLabor'],
};
const BASKET = ['patagonia', 'costco', 'trader-joe-s', 'walmart'];
const SWITCHES = [
  { from: 'walmart', fromName: 'Walmart', to: 'costco', toName: 'Costco', monthly: 60, at: Date.now() - 86400000 * 8 },
  { from: 'shein', fromName: 'SHEIN', to: 'patagonia', toName: 'Patagonia', monthly: 25, at: Date.now() - 86400000 * 2 },
];

function initScript({ profile = true, basket = true, switches = false } = {}) {
  return `
    try {
      localStorage.clear();
      localStorage.setItem('tn_hasOnboarded', '1');
      ${profile ? `localStorage.setItem('tn_profile', ${JSON.stringify(JSON.stringify(PROFILE))});` : ''}
      ${basket ? `localStorage.setItem('tn_saved', ${JSON.stringify(JSON.stringify(BASKET))});` : ''}
      ${switches ? `localStorage.setItem('tn_switches', ${JSON.stringify(JSON.stringify(SWITCHES))});` : ''}
    } catch (e) {}
  `;
}

// Dismiss the deep-link welcome modal if it's up.
async function dismissWelcome(page) {
  try {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes("Let's go"));
      if (b) b.click();
    });
  } catch {}
  await pause(600);
}

async function tapByText(page, text, { exact = false } = {}) {
  const ok = await page.evaluate(({ text, exact }) => {
    const btns = [...document.querySelectorAll('button')];
    const b = btns.find((x) => exact ? x.textContent.trim() === text : x.textContent.includes(text));
    if (b) { b.click(); return true; }
    return false;
  }, { text, exact });
  await pause(700);
  return ok;
}

async function newPage(browser, seeds) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(VIEWPORT);
  await page.evaluateOnNewDocument(initScript(seeds));
  return { page, context };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, name) });
  console.log('  ✓', name);
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

  // 1 · TODAY — clash-led compass card + story + shelf
  {
    const { page, context } = await newPage(browser, { switches: false });
    await page.goto(`${BASE}/?tab=today`, { waitUntil: 'networkidle2' });
    await pause(2500); await dismissWelcome(page); await pause(800);
    await shot(page, '01-today.png');
    await context.close();
  }

  // 2 · LENS VERDICT — Patagonia expanded (serif sentence + receipts + seal)
  {
    const { page, context } = await newPage(browser, {});
    await page.goto(`${BASE}/company/patagonia`, { waitUntil: 'networkidle2' });
    await pause(3000); await dismissWelcome(page); await pause(1200);
    await shot(page, '02-verdict.png');
    await context.close();
  }

  // 3 · THE MATCH — ENVIRONMENT tension card (card 2; politics skipped)
  {
    const { page, context } = await newPage(browser, { profile: false });
    await page.goto(`${BASE}/?tab=today`, { waitUntil: 'networkidle2' });
    await pause(2500); await dismissWelcome(page); await pause(600);
    await tapByText(page, 'Start the Match');
    await pause(900);
    await tapByText(page, 'independent / no preference — skip');
    await pause(900);
    await shot(page, '03-match.png');
    await context.close();
  }

  // 4 · LEDGER — dial + Redirected counter + switch receipts
  {
    const { page, context } = await newPage(browser, { switches: true });
    await page.goto(`${BASE}/?tab=library`, { waitUntil: 'networkidle2' });
    await pause(2500); await dismissWelcome(page); await pause(800);
    await shot(page, '04-ledger.png');
    await context.close();
  }

  // 5 · THE REVEAL — drive the full Match, land on the archetype
  {
    const { page, context } = await newPage(browser, { profile: false });
    await page.goto(`${BASE}/?tab=today`, { waitUntil: 'networkidle2' });
    await pause(2500); await dismissWelcome(page); await pause(600);
    await tapByText(page, 'Start the Match');
    await pause(900);
    const answers = [
      'independent / no preference — skip', // politics
      'Dealbreaker',                        // environment
      'Forgivable',                         // workers
      'no preference — skip',               // unions
      'no preference — skip',               // diversity
      'It matters to me',                   // giving
      'Not a priority',                     // animals
      'no preference — skip',               // firearms
      'Dealbreaker',                        // privacy
      'Forgivable',                         // CEO pay
    ];
    for (const a of answers) { await tapByText(page, a); }
    await tapByText(page, 'Forced labor in supply chain');
    await tapByText(page, 'Child labor in supply chain');
    await tapByText(page, 'finish');
    await pause(2500);
    await shot(page, '05-reveal.png');
    await context.close();
  }

  await browser.close();
  console.log(`done → ${OUT_DIR}`);
})();
