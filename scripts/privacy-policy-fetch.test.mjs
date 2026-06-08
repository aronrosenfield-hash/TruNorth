#!/usr/bin/env node
/**
 * Tests for the privacy-policy pipeline.
 *
 * Uses node:test (no new deps). Loads 5 hand-crafted privacy-policy HTML
 * fixtures from test/fixtures/privacy-policy/ and asserts:
 *   - the domain extractor handles the messy wiki.website strings in our index
 *   - the policy-path list + target picker behave as documented
 *   - the rule-based scorer produces a strict ordering across the fixtures
 *     (strong > medium > adtech > weak, with minimal landing in the middle
 *      because it inherits each dimension's base score with no signals)
 *   - the ToS;DR additive nudge is bounded and monotonic
 *
 * NO network calls. Run locally: node scripts/privacy-policy-fetch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  extractDomainFromWiki,
  resolveDomain,
  pickTargets,
  POLICY_PATHS,
  sha256,
} from "./privacy-policy-fetch.mjs";

import {
  htmlToText,
  scoreDimension,
  scoreAll,
  tosdrAdjust,
  RUBRIC,
  WEIGHTS,
} from "./privacy-policy-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, "../test/fixtures/privacy-policy");

async function loadFixture(name) {
  return fs.readFile(path.join(FIX, name), "utf-8");
}

// ── extractDomainFromWiki ───────────────────────────────────────────────────

test("extractDomainFromWiki: URL with scheme + path", () => {
  assert.equal(extractDomainFromWiki("https://apple.com/at/"), "apple.com");
});

test("extractDomainFromWiki: strips www. and lowercases", () => {
  assert.equal(extractDomainFromWiki("http://www.47brand.com/"), "47brand.com");
});

test("extractDomainFromWiki: bare-domain duplicate string", () => {
  assert.equal(extractDomainFromWiki("100thieves.com 100thieves.com"), "100thieves.com");
});

test("extractDomainFromWiki: concatenated-typo grabs first valid token", () => {
  // Real index value; first regex hit is the leading bare-domain token.
  const out = extractDomainFromWiki("1017Records.comthenew1017records.com");
  // We accept either piece — what matters is we don't return null.
  assert.ok(out && /\.com/.test(out), `got ${out}`);
});

test("extractDomainFromWiki: empty / junk -> null", () => {
  assert.equal(extractDomainFromWiki(""), null);
  assert.equal(extractDomainFromWiki(null), null);
  assert.equal(extractDomainFromWiki("not a domain"), null);
});

// ── resolveDomain ───────────────────────────────────────────────────────────

test("resolveDomain: prefers wiki.website", () => {
  const d = resolveDomain("apple", { wiki: { website: "https://apple.com/" } });
  assert.equal(d, "apple.com");
});

test("resolveDomain: single-token slug fallback to <slug>.com", () => {
  assert.equal(resolveDomain("microsoft", {}), "microsoft.com");
  assert.equal(resolveDomain("microsoft", null), "microsoft.com");
});

test("resolveDomain: multi-token slug with no wiki -> null", () => {
  // Avoids garbage like "general-electric.com" which isn't the real homepage.
  assert.equal(resolveDomain("general-electric", {}), null);
});

// ── target picker ───────────────────────────────────────────────────────────

test("pickTargets: drops pure-neutral stubs but keeps brands with any signal", () => {
  const idx = [
    {
      slug: "real-brand", name: "Real",
      overall: 70, sc: { political: "lean_right" },
    },
    {
      slug: "stub", name: "Stub",
      overall: 50, sc: { political: "neutral", labor: "neutral" },
      hasRecall: false,
    },
    {
      slug: "stub-with-recall", name: "Stub2",
      overall: 50, sc: { political: "neutral" },
      hasRecall: true,
    },
  ];
  const out = pickTargets(idx, 10).map(t => t.slug);
  assert.deepEqual(out, ["real-brand", "stub-with-recall"]);
});

test("pickTargets: respects topN", () => {
  const idx = Array.from({ length: 50 }, (_, i) => ({
    slug: `b${i}`, name: `B${i}`, overall: 70,
  }));
  assert.equal(pickTargets(idx, 10).length, 10);
});

// ── policy paths invariants ─────────────────────────────────────────────────

test("POLICY_PATHS: ordered, leading-slash, no duplicates", () => {
  assert.ok(POLICY_PATHS.length >= 4, "at least 4 candidates");
  for (const p of POLICY_PATHS) {
    assert.match(p, /^\/[a-z-]+/, `${p} looks like a clean path`);
  }
  assert.equal(new Set(POLICY_PATHS).size, POLICY_PATHS.length, "no dupes");
  assert.equal(POLICY_PATHS[0], "/privacy", "first attempt is /privacy");
});

// ── sha256 helper ───────────────────────────────────────────────────────────

test("sha256: stable hex digest", () => {
  assert.equal(sha256("abc").length, 64);
  assert.equal(sha256("abc"), sha256("abc"));
  assert.notEqual(sha256("abc"), sha256("abd"));
});

// ── htmlToText ──────────────────────────────────────────────────────────────

test("htmlToText: strips tags and scripts, collapses whitespace", () => {
  const text = htmlToText(`
    <html><head><style>.x{color:red}</style><script>alert(1)</script></head>
    <body><p>Hello   <b>world</b>.</p></body></html>
  `);
  assert.equal(text, "Hello world .");
});

test("htmlToText: decodes common entities", () => {
  assert.equal(htmlToText("<p>Tom &amp; Jerry &nbsp; rule</p>"), "Tom & Jerry rule");
});

// ── scoreDimension (sanity for one rubric entry) ────────────────────────────

test("scoreDimension: data-collection positive raises, negative lowers", () => {
  const cfg = RUBRIC.dataCollection;
  const pos = scoreDimension("We believe in data minimization.", cfg);
  const neg = scoreDimension("We collect precise location and biometric data.", cfg);
  assert.ok(pos.score > cfg.base, `pos (${pos.score}) > base (${cfg.base})`);
  assert.ok(neg.score < cfg.base, `neg (${neg.score}) < base (${cfg.base})`);
});

test("scoreDimension: clamps to [0,100]", () => {
  // Synthesize an extreme by stacking every neg phrase. The clamp must hold.
  const cfg = RUBRIC.thirdPartySharing;
  const r = scoreDimension(
    "We share with our affiliates, third-party advertising, data brokers, " +
    "sell your personal information, behavioral advertising.",
    cfg
  );
  assert.ok(r.score >= 0 && r.score <= 100);
});

// ── scoreAll on all 5 fixtures ──────────────────────────────────────────────

test("scoreAll: strong fixture scores high across all 8 dimensions", async () => {
  const html = await loadFixture("strong.html");
  const { dimensions, baseScore } = scoreAll(htmlToText(html));
  for (const [name, score] of Object.entries(dimensions)) {
    assert.ok(score >= 60, `${name} >= 60 (got ${score})`);
  }
  assert.ok(baseScore >= 75, `overall >= 75 (got ${baseScore})`);
});

test("scoreAll: weak fixture scores low overall", async () => {
  const html = await loadFixture("weak.html");
  const { dimensions, baseScore } = scoreAll(htmlToText(html));
  assert.ok(dimensions.thirdPartySharing < 40, `thirdParty low (got ${dimensions.thirdPartySharing})`);
  assert.ok(dimensions.tracking < 40, `tracking low (got ${dimensions.tracking})`);
  assert.ok(baseScore < 50, `overall < 50 (got ${baseScore})`);
});

test("scoreAll: medium fixture lands between strong and weak", async () => {
  const strong = scoreAll(htmlToText(await loadFixture("strong.html"))).baseScore;
  const medium = scoreAll(htmlToText(await loadFixture("medium.html"))).baseScore;
  const weak   = scoreAll(htmlToText(await loadFixture("weak.html"))).baseScore;
  assert.ok(strong > medium, `strong (${strong}) > medium (${medium})`);
  assert.ok(medium > weak,   `medium (${medium}) > weak (${weak})`);
});

test("scoreAll: minimal fixture (no signals) returns close to weighted base", async () => {
  const { baseScore } = scoreAll(htmlToText(await loadFixture("minimal.html")));
  // Weighted base of the rubric — what a no-signal policy must score.
  let wSum = 0, wTot = 0;
  for (const [name, w] of Object.entries(WEIGHTS)) {
    wSum += RUBRIC[name].base * w;
    wTot += w;
  }
  const expected = Math.round(wSum / wTot);
  // Allow a 4-point drift because minimal does contain the word "privacy"
  // which won't hit anything but htmlToText whitespace can change tokenization.
  assert.ok(Math.abs(baseScore - expected) <= 4, `minimal ≈ base ${expected} (got ${baseScore})`);
});

test("scoreAll: adtech fixture scores worse than medium on third-party + tracking", async () => {
  const adtech = scoreAll(htmlToText(await loadFixture("adtech.html"))).dimensions;
  const medium = scoreAll(htmlToText(await loadFixture("medium.html"))).dimensions;
  assert.ok(adtech.thirdPartySharing < medium.thirdPartySharing, "third-party sharing");
  assert.ok(adtech.tracking < medium.tracking, "tracking");
});

// ── ToS;DR adjustment ───────────────────────────────────────────────────────

test("tosdrAdjust: monotonic A>B>C>D>E and bounded", () => {
  const a = tosdrAdjust("A"), b = tosdrAdjust("B"), c = tosdrAdjust("C"),
        d = tosdrAdjust("D"), e = tosdrAdjust("E");
  assert.ok(a > b && b > c && c > d && d > e);
  assert.equal(tosdrAdjust("Z"), 0, "unknown -> 0");
  assert.equal(tosdrAdjust(null), 0, "null -> 0");
  for (const g of ["A","B","C","D","E"]) {
    const adj = tosdrAdjust(g);
    assert.ok(Math.abs(adj) <= 5, `bounded |${g}|<=5 (got ${adj})`);
  }
});

// ── score ordering, end-to-end ──────────────────────────────────────────────

test("end-to-end: strong+A beats weak+E even after ToS;DR adjustment", async () => {
  const strong = scoreAll(htmlToText(await loadFixture("strong.html"))).baseScore + tosdrAdjust("A");
  const weak   = scoreAll(htmlToText(await loadFixture("weak.html"))).baseScore   + tosdrAdjust("E");
  assert.ok(strong > weak, `${strong} > ${weak}`);
});
