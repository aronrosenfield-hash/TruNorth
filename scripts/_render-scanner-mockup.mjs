// Render a marketing-style mockup of the scanner screen.
// Output: docs/app-store-screenshots/sim/04-scanner.png at 1320×2868
// (matches the other iPhone 17 Pro Max simulator captures).

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = '/Users/aronrosenfield/Developer/trunorth/docs/app-store-screenshots/sim/04-scanner.png';

// iPhone 17 Pro Max physical: 1320 × 2868. Viewport at 440×956 with DPR 3 = 1320×2868.
const VIEWPORT = { width: 440, height: 956 };
const DPR = 3;

const HTML = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #0a0a0a; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #f2f2f2;
    -webkit-font-smoothing: antialiased;
    position: relative;
  }

  /* Status bar (iOS-style) */
  .status-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 54px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 28px 0;
    font-size: 17px; font-weight: 600; color: #f2f2f2;
  }
  .status-bar .icons { display: flex; align-items: center; gap: 7px; font-size: 16px; }

  /* TruNorth header */
  .header {
    position: absolute; top: 54px; left: 0; right: 0;
    padding: 18px 22px 16px;
    display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid #1a1a1a;
  }
  .logo-mark {
    width: 36px; height: 36px; border-radius: 9px;
    background: #7c6dfa;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 18px;
  }
  .logo-mark::before { content: '↑'; }
  .brand { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; }
  .brand-tn { color: #f2f2f2; }
  .brand-north { color: #7c6dfa; }
  .close-btn {
    margin-left: auto; width: 32px; height: 32px; border-radius: 50%;
    background: rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: center;
    color: #a8a8a8; font-size: 18px;
  }
  .close-btn::before { content: '×'; line-height: 1; margin-top: -3px; }

  /* Scanner viewfinder area — fills the middle of the screen */
  .scanner-area {
    position: absolute; top: 130px; left: 0; right: 0; bottom: 240px;
    background:
      radial-gradient(circle at center, rgba(124,109,250,0.06) 0%, transparent 60%),
      linear-gradient(180deg, #050505 0%, #0a0a0a 100%);
    overflow: hidden;
  }
  .scanner-area::before {
    /* Subtle simulated camera-feed noise */
    content: ''; position: absolute; inset: 0;
    background-image:
      radial-gradient(rgba(255,255,255,0.015) 1px, transparent 1.5px),
      radial-gradient(rgba(255,255,255,0.015) 1px, transparent 1.5px);
    background-size: 4px 4px, 8px 8px;
    background-position: 0 0, 2px 2px;
  }

  /* The simulated product (cereal box edge with a barcode visible) */
  .product {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-3deg);
    width: 280px; height: 380px;
    background: linear-gradient(135deg, #2a2a2a 0%, #1f1f1f 100%);
    border-radius: 8px;
    box-shadow: 0 30px 80px rgba(0,0,0,0.6);
    overflow: hidden;
  }
  .product::before {
    /* fake product wrap label */
    content: 'ORGANIC'; position: absolute; top: 24px; left: 0; right: 0;
    text-align: center; font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.45);
    letter-spacing: 4px;
  }
  /* Barcode */
  .barcode {
    position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
    width: 200px; height: 70px;
    background: linear-gradient(90deg,
      #fff 0 3px, #000 3px 6px, #fff 6px 8px, #000 8px 9px, #fff 9px 14px,
      #000 14px 17px, #fff 17px 19px, #000 19px 22px, #fff 22px 28px, #000 28px 30px,
      #fff 30px 35px, #000 35px 39px, #fff 39px 41px, #000 41px 47px, #fff 47px 50px,
      #000 50px 53px, #fff 53px 58px, #000 58px 61px, #fff 61px 67px, #000 67px 71px,
      #fff 71px 74px, #000 74px 77px, #fff 77px 80px, #000 80px 86px, #fff 86px 90px,
      #000 90px 92px, #fff 92px 99px, #000 99px 102px, #fff 102px 107px, #000 107px 110px,
      #fff 110px 113px, #000 113px 118px, #fff 118px 121px, #000 121px 127px, #fff 127px 130px,
      #000 130px 133px, #fff 133px 139px, #000 139px 143px, #fff 143px 146px, #000 146px 149px,
      #fff 149px 155px, #000 155px 159px, #fff 159px 162px, #000 162px 165px, #fff 165px 171px,
      #000 171px 174px, #fff 174px 178px, #000 178px 182px, #fff 182px 188px, #000 188px 192px,
      #fff 192px 200px);
    border-radius: 2px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  }
  .barcode-num {
    position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%);
    font-family: monospace; font-size: 11px; color: rgba(255,255,255,0.5);
    letter-spacing: 1px;
  }

  /* Targeting reticle (the iconic four-corner brackets) */
  .reticle {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 320px; height: 320px;
  }
  .reticle::before, .reticle::after,
  .reticle > .tl, .reticle > .tr, .reticle > .bl, .reticle > .br {
    content: ''; position: absolute; width: 44px; height: 44px;
    border: 4px solid #7c6dfa;
    border-radius: 8px;
  }
  .reticle > .tl { top: 0; left: 0; border-right: none; border-bottom: none; border-top-left-radius: 12px; }
  .reticle > .tr { top: 0; right: 0; border-left: none; border-bottom: none; border-top-right-radius: 12px; }
  .reticle > .bl { bottom: 0; left: 0; border-right: none; border-top: none; border-bottom-left-radius: 12px; }
  .reticle > .br { bottom: 0; right: 0; border-left: none; border-top: none; border-bottom-right-radius: 12px; }
  .reticle::before, .reticle::after { display: none; } /* unused base content */

  /* Hint text */
  .hint {
    position: absolute; bottom: 248px; left: 50%; transform: translateX(-50%);
    font-size: 13px; color: rgba(242,242,242,0.7);
    background: rgba(0,0,0,0.55);
    padding: 8px 18px; border-radius: 999px;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.08);
    white-space: nowrap;
  }

  /* Just-scanned result card */
  .result-card {
    position: absolute; left: 16px; right: 16px; bottom: 100px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 16px;
    padding: 16px;
    display: flex; align-items: center; gap: 14px;
    box-shadow: 0 -8px 40px rgba(0,0,0,0.6);
  }
  .result-logo {
    width: 56px; height: 56px; border-radius: 12px;
    background: #2a2a2a;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
  }
  .result-meta { flex: 1; min-width: 0; }
  .result-name { font-size: 18px; font-weight: 700; color: #f2f2f2; margin-bottom: 2px; }
  .result-cat { font-size: 12px; color: #888; }
  .result-grade {
    width: 52px; height: 52px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; font-weight: 800;
    background: #e24a4a; color: #fff;
    box-shadow: 0 2px 8px rgba(226,74,74,0.3);
  }

  /* Bottom nav (matching the app) */
  .bottom-nav {
    position: absolute; bottom: 0; left: 0; right: 0; height: 88px;
    background: #0f0f0f;
    border-top: 1px solid #1a1a1a;
    display: flex; align-items: flex-start; justify-content: space-around;
    padding: 12px 8px 24px;
  }
  .nav-item {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    font-size: 10px; color: #6c6c72;
  }
  .nav-item.active { color: #7c6dfa; }
  .nav-icon {
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    font-size: 18px;
  }
</style>
</head>
<body>

<!-- iOS status bar -->
<div class="status-bar">
  <div>9:41</div>
  <div class="icons">
    <span>●●●●</span>
    <span>📶</span>
    <span>🔋</span>
  </div>
</div>

<!-- Header -->
<div class="header">
  <div class="logo-mark"></div>
  <div class="brand"><span class="brand-tn">Tru</span><span class="brand-north">North</span></div>
  <div class="close-btn"></div>
</div>

<!-- Scanner camera area -->
<div class="scanner-area">
  <!-- Simulated product in view -->
  <div class="product">
    <div class="barcode"></div>
    <div class="barcode-num">8 41887 02103 4</div>
  </div>
  <!-- Targeting reticle -->
  <div class="reticle">
    <div class="tl"></div><div class="tr"></div><div class="bl"></div><div class="br"></div>
  </div>
  <!-- Hint text -->
  <div class="hint">Point at any product barcode</div>
</div>

<!-- Just-scanned result card preview -->
<div class="result-card">
  <div class="result-logo">🌿</div>
  <div class="result-meta">
    <div class="result-name">Patagonia</div>
    <div class="result-cat">Outdoor · Apparel</div>
  </div>
  <div class="result-grade" style="background:#22a06b;">A</div>
</div>

<!-- Bottom nav -->
<div class="bottom-nav">
  <div class="nav-item"><div class="nav-icon">⭐</div><div>Top Picks</div></div>
  <div class="nav-item active"><div class="nav-icon">🔍</div><div>Search</div></div>
  <div class="nav-item"><div class="nav-icon">▦</div><div>Browse</div></div>
  <div class="nav-item"><div class="nav-icon">🔖</div><div>Library</div></div>
  <div class="nav-item"><div class="nav-icon">👤</div><div>Account</div></div>
</div>

</body></html>
`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: DPR,
  });
  const page = await ctx.newPage();
  await page.setContent(HTML);
  await page.waitForLoadState('networkidle');
  await new Promise(r => setTimeout(r, 200));
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: false, omitBackground: false });
  console.log(`✓ ${OUT}`);
  await browser.close();
})();
