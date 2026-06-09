import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(`
  window.Capacitor = { isNativePlatform: () => true, platform: 'ios', getPlatform: () => 'ios' };
`);
const page = await ctx.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await new Promise(r => setTimeout(r, 4000));
const info = await page.evaluate(() => ({
  cap: !!window.Capacitor,
  capIsNative: window.Capacitor?.isNativePlatform?.(),
  ua: navigator.userAgent.slice(0,60),
  bodyText: document.body.innerText.slice(0, 400),
  hasMarketing: document.body.innerText.toLowerCase().includes('shop with') || document.body.innerText.toLowerCase().includes('clear conscience'),
  bottomNavTabs: Array.from(document.querySelectorAll('button')).map(el => el.textContent?.trim()).filter(t => t && t.length < 30 && t.length > 1).slice(0, 20),
  hasInputs: document.querySelectorAll('input').length,
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
