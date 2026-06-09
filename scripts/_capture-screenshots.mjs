// Capture App Store screenshots at iPhone 14 Pro Max resolution (1290×2796)
// by driving the local Vite dev server with Playwright.

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/raw';
const BASE_URL = 'http://localhost:5173/';

const VIEWPORT = { width: 430, height: 932 };
const DPR = 3;

async function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

const PROFILE_PRESEED = {
  political: 'liberal', dei: 'pro', animals: 'dealbreaker', guns: 'avoid', union: 'pro',
  environmentImportance: 5, laborImportance: 4, privacyImportance: 4, execPayImportance: 3, charityImportance: 3,
  topPick: 'Patagonia',
};

const INIT_SCRIPT = `
  // Force the SPA to treat us as a native shell (so we skip the marketing landing).
  // Use Object.defineProperty to prevent the @capacitor/core module from
  // overwriting our mock when it imports later.
  Object.defineProperty(window, 'Capacitor', {
    value: {
      isNativePlatform: () => true,
      platform: 'ios',
      getPlatform: () => 'ios',
      isPluginAvailable: () => false,
      Plugins: {},
    },
    writable: false,
    configurable: false,
  });
  try {
    localStorage.setItem('tn_profile', JSON.stringify(${JSON.stringify(PROFILE_PRESEED)}));
    localStorage.setItem('tn_onboardingComplete', '1');
    localStorage.setItem('tn_onboardingSeen', '1');
    localStorage.setItem('tn_welcomeSeen', '1');
    localStorage.setItem('tn_skipMarketing', '1');
    for (let v = 40; v <= 60; v++) {
      localStorage.setItem('tn_whatsNewSeen_' + v, '1');
    }
  } catch {}
`;

// Click through any onboarding carousel that's blocking the app
async function skipOnboarding(page) {
  for (let i = 0; i < 6; i++) {
    const skipBtn = page.locator('button').filter({ hasText: /^\s*Skip\s*$/i }).first();
    const nextBtn = page.locator('button').filter({ hasText: /Let'?s go|Start exploring|Get started|Continue|Next/i }).first();
    let clicked = false;
    if (await skipBtn.count() > 0) {
      try { await skipBtn.click({ timeout: 1500 }); clicked = true; } catch {}
    }
    if (!clicked && await nextBtn.count() > 0) {
      try { await nextBtn.click({ timeout: 1500 }); clicked = true; } catch {}
    }
    if (!clicked) break;
    await pause(800);
  }
  await pause(1500);
}

async function captureSearch(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pause(2500);
  await skipOnboarding(page);
  // Navigate to Search tab
  try {
    const search = page.locator('input[placeholder*="Search" i], input[type="search"]').first();
    if (await search.count() > 0) {
      await search.click({ timeout: 2000 });
      await search.fill('Patagonia');
      await pause(2000);
    }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '01-search.png'), fullPage: false });
  console.log('  ✓ 01-search.png');
}

async function captureQuiz(page) {
  await page.evaluate(() => { try { localStorage.removeItem('tn_profile'); } catch {} });
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pause(2500);
  await skipOnboarding(page);
  // Try to find a "Take quiz" or values-fingerprint CTA
  try {
    const btn = page.locator('button, a').filter({ hasText: /quiz|tune.*scores|personalize|values fingerprint|find your.*archetype/i }).first();
    if (await btn.count() > 0) { await btn.click({ timeout: 3000 }); await pause(2500); }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '02-quiz.png'), fullPage: false });
  console.log('  ✓ 02-quiz.png');
  await page.evaluate((p) => { try { localStorage.setItem('tn_profile', JSON.stringify(p)); } catch {} }, PROFILE_PRESEED);
}

async function captureTopPicks(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pause(2500);
  await skipOnboarding(page);
  try {
    const btn = page.locator('button, [role="button"]').filter({ hasText: /top picks/i }).first();
    if (await btn.count() > 0) { await btn.click({ timeout: 3000 }); await pause(3000); }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '03-top-picks.png'), fullPage: false });
  console.log('  ✓ 03-top-picks.png');
}

async function captureScanner(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pause(2500);
  await skipOnboarding(page);
  try {
    const btn = page.locator('[aria-label*="scan" i], [title*="scan" i], button:has(i.ti-scan)').first();
    if (await btn.count() > 0) { await btn.click({ timeout: 3000 }); await pause(2500); }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '04-scanner.png'), fullPage: false });
  console.log('  ✓ 04-scanner.png');
}

async function captureAccount(page) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await pause(2500);
  await skipOnboarding(page);
  try {
    const btn = page.locator('button, [role="button"]').filter({ hasText: /^\s*account\s*$/i }).first();
    if (await btn.count() > 0) { await btn.click({ timeout: 3000 }); await pause(3000); }
  } catch {}
  await page.screenshot({ path: path.join(OUT_DIR, '05-account.png'), fullPage: false });
  console.log('  ✓ 05-account.png');
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: DPR,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true, hasTouch: true, locale: 'en-US', timezoneId: 'America/Chicago',
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  page.on('console', () => {});
  page.on('pageerror', () => {});

  console.log(`Capturing → ${OUT_DIR}`);
  console.log(`Viewport: ${VIEWPORT.width}×${VIEWPORT.height} @ ${DPR}x = ${VIEWPORT.width * DPR}×${VIEWPORT.height * DPR}`);

  await captureSearch(page);
  await captureQuiz(page);
  await captureTopPicks(page);
  await captureScanner(page);
  await captureAccount(page);

  await browser.close();
  console.log('\nDone.');
})();
