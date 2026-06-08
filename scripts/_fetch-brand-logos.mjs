// Fetch Wikipedia/Wikimedia logos for each brand in egregious-facts.json,
// cache to docs/marketing/egregious/logos/<slug>.png.
//
// Strategy: prefer Wikidata P154 (logo image) over the REST summary's hero
// image, which often returns a building photo for corporate articles.
//
//   1. Read brandLogoUrl (a Wikipedia article URL) → extract title.
//   2. Resolve title → Wikidata QID (via MediaWiki API).
//   3. Fetch QID claims → look for P154 (logo image) values.
//   4. Pick the first that's clearly a "logo" (filter heuristics on filename).
//   5. Fetch Special:FilePath for that Commons filename to get the binary URL.
//   6. Download. SVGs are converted to PNG by sharp at render time.
//
// Polite throttle: 1 req / sec. Aggressively cached — re-running skips
// any file already on disk. Falls back gracefully if any step fails.
//
// Usage: node scripts/_fetch-brand-logos.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FACTS_JSON = path.join(ROOT, 'public/data/_meta/egregious-facts.json');
const OUT_DIR = path.join(ROOT, 'docs/marketing/egregious/logos');

const UA = 'TruNorth-egregious-bot/1.0 (https://trunorth.app; logos cached for editorial nominative fair use)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function titleFromWikipediaUrl(url) {
  if (!url) return null;
  const m = /https?:\/\/[a-z]+\.wikipedia\.org\/wiki\/([^?#]+)/i.exec(url);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/_/g, ' ');
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function downloadBinary(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!r.ok) throw new Error(`download: HTTP ${r.status} ${url}`);
  const ab = await r.arrayBuffer();
  return { buf: Buffer.from(ab), contentType: r.headers.get('content-type') || '' };
}

// Title (e.g. "Amazon (company)") → Wikidata QID.
async function resolveQid(title) {
  // redirects=1 follows redirects (e.g., "The Home Depot" → "Home Depot",
  // "Williams-Sonoma" → "Williams Sonoma").
  const u = `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(title)}&format=json&formatversion=2&redirects=1`;
  const j = await fetchJson(u);
  const page = j?.query?.pages?.[0];
  return page?.pageprops?.wikibase_item || null;
}

// Hardcoded fallback Commons filenames for brands where Wikidata P154 is
// missing or low-quality. Verified manually from Commons Special:Search.
const LOGO_OVERRIDES = {
  // Brands whose P154 claim is missing from Wikidata, but a freely-licensed
  // logo file exists on Wikimedia Commons. Verified by hand.
  'williams-sonoma': 'Williams-Sonoma logo.svg',
  // No freely-licensed Chipotle logo exists on Commons → render without logo.
};

// QID → array of logo filenames from P154.
async function fetchLogoFilenames(qid) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`;
  const j = await fetchJson(u);
  const ent = j?.entities?.[qid];
  const claims = ent?.claims?.P154 || [];
  const names = [];
  for (const c of claims) {
    const v = c?.mainsnak?.datavalue?.value;
    if (typeof v === 'string') names.push(v);
  }
  return names;
}

// Heuristic: prefer files with "logo" in the name; avoid app-icon / square smiles.
function pickBestLogo(names) {
  if (!names.length) return null;
  const score = (n) => {
    const l = n.toLowerCase();
    let s = 0;
    if (l.includes('logo')) s += 10;
    if (l.includes('wordmark')) s += 5;
    if (/\bapp\b|icon|smile/.test(l)) s -= 8;
    if (l.endsWith('.svg')) s += 2; // sharp handles SVGs cleanly
    return s;
  };
  return [...names].sort((a, b) => score(b) - score(a))[0];
}

function filePathUrl(filename) {
  // Special:FilePath redirects to the actual upload URL on commons/upload.
  // Constrain width so PNG-rendered SVGs come back at a sensible size.
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=512`;
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const raw = JSON.parse(await fs.readFile(FACTS_JSON, 'utf8'));
  const facts = raw.facts;

  const results = [];
  for (const f of facts) {
    const slug = f.brandSlug;
    const outBase = path.join(OUT_DIR, slug);
    const outPng = `${outBase}.png`;
    const outSvg = `${outBase}.svg`;

    // Cache: skip if either is present.
    let cached = null;
    for (const p of [outPng, outSvg]) {
      try {
        const st = await fs.stat(p);
        if (st.size > 200) { cached = { path: p, size: st.size }; break; }
      } catch { /* not cached */ }
    }
    if (cached) {
      results.push({ slug, status: 'cached', size: cached.size, path: path.basename(cached.path) });
      console.log(`  [cache] ${slug} (${cached.size}B)`);
      continue;
    }

    const title = titleFromWikipediaUrl(f.brandLogoUrl);
    if (!title && !LOGO_OVERRIDES[slug]) {
      results.push({ slug, status: 'no-title' });
      console.log(`  [skip ] ${slug} — no Wikipedia URL`);
      continue;
    }

    try {
      let pick = LOGO_OVERRIDES[slug] || null;
      let qid = null;
      if (!pick) {
        qid = await resolveQid(title);
        await sleep(800);
        if (!qid) {
          results.push({ slug, status: 'no-qid', title });
          console.log(`  [skip ] ${slug} — no Wikidata QID (${title})`);
          continue;
        }
        const names = await fetchLogoFilenames(qid);
        await sleep(800);
        pick = pickBestLogo(names);
      }
      if (!pick) {
        results.push({ slug, status: 'no-logo-claim', qid });
        console.log(`  [skip ] ${slug} — Wikidata ${qid} has no P154`);
        continue;
      }
      const url = filePathUrl(pick);
      const { buf, contentType } = await downloadBinary(url);
      const ext = pick.toLowerCase().endsWith('.svg') && contentType.includes('svg') ? '.svg' : '.png';
      const outPath = `${outBase}${ext}`;
      await fs.writeFile(outPath, buf);
      results.push({ slug, status: 'fetched', size: buf.length, qid, file: pick, ext, source: url });
      console.log(`  [fetch] ${slug} ← ${pick} (${buf.length}B, ${ext})`);
    } catch (err) {
      results.push({ slug, status: 'error', error: String(err).slice(0, 200) });
      console.log(`  [error] ${slug} — ${err.message}`);
    }
    await sleep(800);
  }

  const summaryPath = path.join(OUT_DIR, '_fetch-log.json');
  await fs.writeFile(summaryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: results.length,
    fetched: results.filter(r => r.status === 'fetched').length,
    cached: results.filter(r => r.status === 'cached').length,
    skipped: results.filter(r => ['no-title','no-qid','no-logo-claim','error'].includes(r.status)).length,
    results,
  }, null, 2));
  const ok = results.filter(r => ['fetched','cached'].includes(r.status)).length;
  console.log(`Done. ${ok}/${results.length} logos available. Log → ${summaryPath}`);
})().catch(err => { console.error(err); process.exit(1); });
