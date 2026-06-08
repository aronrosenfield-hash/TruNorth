// Render a mockup of the Tesla brand-detail page with the new "Tax Responsibility"
// section that surfaces the ITEP citation. Built to send to Amy Hanauer
// (Executive Director, ITEP) so she can see how their dataset is credited in-app.
//
// Output: docs/marketing/itep-citation-mockup.png at 1320×2868
// (iPhone 17 Pro Max native).

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT = path.resolve(__dirname, '..', 'docs', 'marketing', 'itep-citation-mockup.png');

// iPhone 17 Pro Max physical: 1320 × 2868. Viewport at 440×956 with DPR 3 = 1320×2868.
const VIEWPORT = { width: 440, height: 956 };
const DPR = 3;

const HTML = `<!doctype html>
<html><head>
<meta charset="utf-8" />
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #0a0a0a; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: #f2f2f2;
    -webkit-font-smoothing: antialiased;
    position: relative;
    overflow: hidden;
  }

  /* iOS status bar */
  .status-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 54px;
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 28px 0;
    font-size: 17px; font-weight: 600; color: #f2f2f2;
    z-index: 10;
  }
  .status-bar .icons { display: flex; align-items: center; gap: 7px; font-size: 16px; }

  /* TruNorth header */
  .header {
    position: absolute; top: 54px; left: 0; right: 0;
    padding: 14px 22px 14px;
    display: flex; align-items: center; gap: 12px;
    border-bottom: 1px solid #1a1a1a;
    background: #0a0a0a;
    z-index: 9;
  }
  .back-btn {
    width: 32px; height: 32px; border-radius: 50%;
    background: rgba(255,255,255,0.06);
    display: flex; align-items: center; justify-content: center;
    color: #cfcfcf; font-size: 22px; line-height: 1;
  }
  .back-btn::before { content: '‹'; margin-top: -3px; font-weight: 500; }
  .logo-mark {
    width: 30px; height: 30px; border-radius: 8px;
    background: #7c6dfa;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 800; font-size: 15px;
  }
  .logo-mark::before { content: '↑'; }
  .brand { font-size: 17px; font-weight: 800; letter-spacing: -0.2px; }
  .brand-tn { color: #f2f2f2; }
  .brand-north { color: #7c6dfa; }
  .share-btn {
    margin-left: auto; width: 32px; height: 32px; border-radius: 50%;
    background: rgba(255,255,255,0.06);
    display: flex; align-items: center; justify-content: center;
    color: #cfcfcf; font-size: 14px;
  }
  .share-btn::before { content: '⇪'; }

  /* Scrollable content area */
  .content {
    position: absolute;
    top: 114px;
    left: 0; right: 0;
    bottom: 88px;
    padding: 18px 16px 28px;
    overflow: hidden;
  }

  /* Brand row */
  .brand-row {
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 18px;
  }
  .brand-logo {
    width: 64px; height: 64px; border-radius: 14px;
    background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
    border: 1px solid #2a2a2a;
    display: flex; align-items: center; justify-content: center;
    font-size: 32px; font-weight: 900; color: #e24a4a;
    letter-spacing: -1px;
  }
  .brand-info { flex: 1; min-width: 0; }
  .brand-name {
    font-size: 26px; font-weight: 800; letter-spacing: -0.5px;
    color: #f2f2f2; line-height: 1.1; margin-bottom: 4px;
  }
  .brand-subtitle {
    font-size: 13px; color: #888;
  }
  .grade-circle {
    width: 60px; height: 60px; border-radius: 50%;
    background: #e24a4a;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 800; color: #fff;
    box-shadow: 0 4px 16px rgba(226,74,74,0.35);
  }

  /* Categories overview pills */
  .categories-strip {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-bottom: 22px;
    padding-bottom: 18px;
    border-bottom: 1px solid #1a1a1a;
  }
  .cat-pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 10px; border-radius: 999px;
    background: #141414; border: 1px solid #222;
    font-size: 11px; color: #c8c8c8;
  }
  .cat-pill .dot {
    width: 8px; height: 8px; border-radius: 50%;
  }
  .cat-pill.red .dot { background: #e24a4a; }
  .cat-pill.orange .dot { background: #f0a045; }
  .cat-pill.yellow .dot { background: #d8c441; }
  .cat-pill.green .dot { background: #22a06b; }
  .cat-pill.gray .dot { background: #6c6c72; }

  /* HIGHLIGHT — Tax Responsibility section */
  .tax-section {
    background: linear-gradient(180deg, #1a1530 0%, #15122a 100%);
    border: 1px solid rgba(124,109,250,0.35);
    border-radius: 18px;
    padding: 18px 18px 16px;
    margin-bottom: 18px;
    box-shadow: 0 8px 30px rgba(124,109,250,0.10);
    position: relative;
    overflow: hidden;
  }
  .tax-section::before {
    content: ''; position: absolute; top: -40px; right: -40px;
    width: 140px; height: 140px; border-radius: 50%;
    background: radial-gradient(circle, rgba(124,109,250,0.18) 0%, transparent 70%);
  }
  .tax-header {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px;
    position: relative;
  }
  .tax-icon {
    width: 28px; height: 28px; border-radius: 8px;
    background: #7c6dfa;
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; color: #fff; font-weight: 800;
  }
  .tax-icon::before { content: '⚖'; }
  .tax-title {
    font-size: 14px; font-weight: 700; color: #f2f2f2;
    letter-spacing: -0.1px;
  }
  .tax-grade-mini {
    margin-left: auto;
    padding: 3px 9px; border-radius: 999px;
    background: #e24a4a; color: #fff;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.3px;
  }

  .big-stat {
    font-size: 22px; font-weight: 800; letter-spacing: -0.6px;
    color: #f2f2f2; line-height: 1.15;
    margin-bottom: 6px;
    position: relative;
  }
  .big-stat .amount { color: #ff8a8a; }
  .sub-stat {
    font-size: 13px; color: #b8b3d8; margin-bottom: 12px;
    position: relative;
  }
  .sub-stat strong { color: #f2f2f2; font-weight: 700; }

  .why-matters {
    font-size: 12.5px; color: #cbc5e8; line-height: 1.45;
    padding: 10px 12px;
    background: rgba(0,0,0,0.25);
    border-left: 3px solid #7c6dfa;
    border-radius: 4px 8px 8px 4px;
    margin-bottom: 14px;
    position: relative;
  }
  .why-matters .label {
    display: block; font-size: 10px; font-weight: 700;
    color: #9d92f0; letter-spacing: 0.6px;
    text-transform: uppercase; margin-bottom: 3px;
  }

  /* Source citation block — the part Amy will care about */
  .source-block {
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(124,109,250,0.25);
    border-radius: 12px;
    padding: 12px 14px;
    position: relative;
  }
  .source-label {
    font-size: 10px; font-weight: 700;
    color: #7c6dfa; letter-spacing: 0.8px;
    text-transform: uppercase; margin-bottom: 6px;
    display: flex; align-items: center; gap: 5px;
  }
  .source-label::before {
    content: '✓'; display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px; border-radius: 50%;
    background: #7c6dfa; color: #fff; font-size: 9px; font-weight: 800;
  }
  .source-name {
    font-size: 14px; font-weight: 700; color: #f2f2f2;
    line-height: 1.3; margin-bottom: 3px;
  }
  .source-meta {
    font-size: 11px; color: #8e89a8; margin-bottom: 9px;
  }
  .source-link {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 12px; font-weight: 600; color: #9d92f0;
    text-decoration: none;
  }
  .source-link::after { content: '↗'; font-size: 11px; }

  /* About this data footer */
  .about-data {
    background: #111;
    border: 1px solid #1f1f1f;
    border-radius: 12px;
    padding: 12px 14px;
    margin-bottom: 4px;
  }
  .about-label {
    font-size: 10px; font-weight: 700;
    color: #888; letter-spacing: 0.6px;
    text-transform: uppercase; margin-bottom: 5px;
  }
  .about-text {
    font-size: 11.5px; line-height: 1.45; color: #9a9a9a;
  }

  /* Bottom nav */
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
  <div class="back-btn"></div>
  <div class="logo-mark"></div>
  <div class="brand"><span class="brand-tn">Tru</span><span class="brand-north">North</span></div>
  <div class="share-btn"></div>
</div>

<!-- Scrollable content -->
<div class="content">

  <!-- Brand row -->
  <div class="brand-row">
    <div class="brand-logo">T</div>
    <div class="brand-info">
      <div class="brand-name">Tesla</div>
      <div class="brand-subtitle">Automotive · EV manufacturer</div>
    </div>
    <div class="grade-circle">D</div>
  </div>

  <!-- Categories overview pills -->
  <div class="categories-strip">
    <span class="cat-pill red"><span class="dot"></span>Political</span>
    <span class="cat-pill orange"><span class="dot"></span>Labor</span>
    <span class="cat-pill green"><span class="dot"></span>Environment</span>
    <span class="cat-pill yellow"><span class="dot"></span>Governance</span>
    <span class="cat-pill orange"><span class="dot"></span>Privacy</span>
    <span class="cat-pill red"><span class="dot"></span>Taxes</span>
    <span class="cat-pill yellow"><span class="dot"></span>Supply Chain</span>
    <span class="cat-pill gray"><span class="dot"></span>Animals</span>
    <span class="cat-pill yellow"><span class="dot"></span>Community</span>
  </div>

  <!-- HIGHLIGHT: Tax Responsibility section -->
  <div class="tax-section">
    <div class="tax-header">
      <div class="tax-icon"></div>
      <div class="tax-title">Tax Responsibility</div>
      <div class="tax-grade-mini">0% RATE</div>
    </div>

    <div class="big-stat"><span class="amount">$0</span> federal tax paid</div>
    <div class="sub-stat"><strong>5 of last 5 profitable years</strong> · Effective federal rate: <strong>0.0%</strong></div>

    <div class="why-matters">
      <span class="label">The numbers</span>
      Tesla reported $4.4B in U.S. profits over the 5-year period and paid $0 in federal income tax. The statutory federal corporate tax rate over this period was 21%.
    </div>

    <!-- Source citation -->
    <div class="source-block">
      <div class="source-label">Verified source</div>
      <div class="source-name">Institute on Taxation &amp; Economic Policy (ITEP)</div>
      <div class="source-meta">Corporate Tax Avoidance dataset · Updated 2025</div>
      <a class="source-link" href="#">Read the full report</a>
    </div>
  </div>

  <!-- About this data footer -->
  <div class="about-data">
    <div class="about-label">About this data</div>
    <div class="about-text">
      ITEP analyzes SEC 10-K filings for profitable Fortune 500 companies, calculating effective federal income tax rates after credits and deductions. TruNorth surfaces this directly — no editorial spin.
    </div>
  </div>

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
