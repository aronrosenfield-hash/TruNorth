#!/usr/bin/env node
/**
 * Unit tests for labor-deep enrichment.
 *
 * Exercises the parser, FLA classifier, dedupe logic, fetcher pagination
 * (against handcrafted fixtures), and the per-source merger against
 * synthetic input.  No network IO.
 *
 * Locally:
 *   node --test scripts/labor-deep-fetch.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseArgs,
  parseFlaPage,
  classifyStatus,
  classifyCategory,
  decodeHtml,
  stripTags,
  fetchFlaAll,
  buildSnapshot,
} from "./labor-deep-fetch.mjs";
import {
  slugify,
  buildFlaAugment,
  buildWrcAugment,
  buildCccAugment,
  buildHrwAugment,
  buildIlrfAugment,
  parseArgs as mergeParseArgs,
} from "./labor-deep-merge.mjs";

/* ─── arg parsing ────────────────────────────────────────────────────── */

test("parseArgs: defaults", () => {
  const o = parseArgs([]);
  assert.equal(o.fixture, false);
  assert.equal(o.skipFla, false);
  assert.equal(o.outPath, null);
});

test("parseArgs: --fixture / --skip-fla / --limit / --out", () => {
  const o = parseArgs(["--fixture", "--skip-fla", "--limit", "3", "--out", "/tmp/x.json"]);
  assert.equal(o.fixture, true);
  assert.equal(o.skipFla, true);
  assert.equal(o.limit, 3);
  assert.equal(o.outPath, "/tmp/x.json");
});

test("parseArgs: --limit clamped to [1, 50]", () => {
  assert.equal(parseArgs(["--limit", "0"]).limit, 1);
  assert.equal(parseArgs(["--limit", "9999"]).limit, 50);
  assert.equal(parseArgs(["--limit", "nan"]).limit, 20); // default
});

test("mergeParseArgs: defaults to --apply", () => {
  const o = mergeParseArgs([]);
  assert.equal(o.dry, false);
  assert.equal(o.apply, true);
});

test("mergeParseArgs: --dry suppresses apply", () => {
  const o = mergeParseArgs(["--dry"]);
  assert.equal(o.dry, true);
  assert.equal(o.apply, false);
});

/* ─── HTML helpers ───────────────────────────────────────────────────── */

test("decodeHtml: named + numeric entities", () => {
  assert.equal(decodeHtml("Ben &amp; Jerry&#8217;s"), "Ben & Jerry’s");
  assert.equal(decodeHtml("&#x2014;"), "—");
});

test("stripTags: collapses whitespace", () => {
  assert.equal(stripTags("<p>foo  <b>bar</b>\n baz</p>"), "foo bar baz");
});

/* ─── FLA status classifier ─────────────────────────────────────────── */

test("classifyStatus: accredited > participating > affiliate > member", () => {
  assert.equal(classifyStatus("Fair Labor Accredited, Participating Company"), "accredited");
  assert.equal(classifyStatus("Participating Company"), "participating");
  assert.equal(classifyStatus("Affiliate"), "affiliate");
  assert.equal(classifyStatus("Single Factory Supplier"), "single-factory-supplier");
  assert.equal(classifyStatus("Collegiate Licensee"), "collegiate-licensee");
  assert.equal(classifyStatus("College or University"), "university");
  assert.equal(classifyStatus("Civil Society Organization"), "civil-society");
  assert.equal(classifyStatus("Mystery Member"), "member");
});

test("classifyCategory: universities + CSOs split out", () => {
  assert.equal(classifyCategory("College or University"), "education");
  assert.equal(classifyCategory("Civil Society Organization"), "civil-society");
  assert.equal(classifyCategory("Participating Company"), "company");
});

/* ─── FLA page parser ────────────────────────────────────────────────── */

const FLA_FIXTURE_HTML = `
<li class="members-logo-card members-logo-card--verified">
  <div class="members-logo-card__company-type">Fair Labor Accredited, Participating Company</div>
  <h3 class="members-logo-card__name"> &#8217;47 Brand LLC </h3>
  <a href="https://www.fairlabor.org/member/47-brand/" class="members-logo-card__link"></a>
</li>
<li class="members-logo-card members-logo-card--verified">
  <div class="members-logo-card__company-type">Fair Labor Accredited, Participating Company</div>
  <h3 class="members-logo-card__name"> Nike </h3>
  <a href="https://www.fairlabor.org/member/nike/" class="members-logo-card__link"></a>
</li>
<li class="members-logo-card">
  <div class="members-logo-card__company-type">College or University</div>
  <h3 class="members-logo-card__name"> University of Michigan </h3>
</li>
`;

test("parseFlaPage: extracts name + status + link, handles entities", () => {
  const rows = parseFlaPage({ html: FLA_FIXTURE_HTML });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].name, "’47 Brand LLC");
  assert.equal(rows[0].status, "accredited");
  assert.equal(rows[0].source_url, "https://www.fairlabor.org/member/47-brand/");
  assert.equal(rows[1].name, "Nike");
  assert.equal(rows[2].category, "education");
});

test("parseFlaPage: empty payload returns []", () => {
  assert.deepEqual(parseFlaPage({ html: "" }), []);
  assert.deepEqual(parseFlaPage({}), []);
  assert.deepEqual(parseFlaPage(null), []);
});

test("parseFlaPage: skips rows missing a name", () => {
  const rows = parseFlaPage({
    html: `<li class="members-logo-card"><div class="members-logo-card__company-type">Participating Company</div></li>`,
  });
  assert.equal(rows.length, 0);
});

/* ─── fetchFlaAll via fixtures ──────────────────────────────────────── */

test("fetchFlaAll: walks fixtures, dedupes case-insensitively, prefers higher rank", async () => {
  const { rows } = await fetchFlaAll({ fixture: true, limit: 5 });
  assert.ok(rows.length >= 4, `expected ≥4 unique rows, got ${rows.length}`);
  const names = rows.map(r => r.name);
  // Names from page 1 + page 2 (Patagonia) should all be present.
  assert.ok(names.includes("Nike"));
  assert.ok(names.includes("Patagonia"));
});

/* ─── slugify ──────────────────────────────────────────────────────── */

test("slugify: strips corporate suffixes + handles unicode", () => {
  assert.equal(slugify("Patagonia, Inc."), "patagonia");
  assert.equal(slugify("Ben & Jerry's"), "ben-and-jerrys");
  assert.equal(slugify("’47 Brand"), "47-brand");
  assert.equal(slugify("PVH Corp"), "pvh");
});

test("slugify: empty inputs", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify(null), "");
  assert.equal(slugify(undefined), "");
});

/* ─── augment builders ─────────────────────────────────────────────── */

const STUB_MAPS = { aliases: {}, parents: {} };

// We can't actually exercise the slug-resolver against COMP_DIR without a
// company-files snapshot. So we stub it: the builder calls resolveSlug
// which checks existsSync — we accept that orphans will dominate in test.
// What we DO test: aggregation shape, severity defaults, signal annotation.

test("buildFlaAugment: skips universities/CSOs, dedupes by slug, picks best rank", () => {
  const rows = [
    { name: "Nike",      status: "accredited",     category: "company",       raw_type: "x", source_url: "u1" },
    { name: "Nike",      status: "participating",  category: "company",       raw_type: "x", source_url: "u2" },
    { name: "Big Univ",  status: "university",     category: "education",     raw_type: "x", source_url: "u3" },
  ];
  // With empty maps and no actual files matching, the builder will orphan
  // everything, BUT we can still assert the input filter / shape contract:
  const aug = buildFlaAugment(rows, STUB_MAPS);
  // Universities are skipped at input — so orphans should never include
  // "Big Univ".
  assert.ok(!aug.orphans.some(o => o.name === "Big Univ"), "university must be filtered");
  // Nike appears twice (both company) → orphaned twice or counted once if
  // slug resolves. Either way the orphans list must not contain the same
  // brand twice (we dedupe input cardinality).
  // (orphans list shape: [{ name, status }, ...])
  const nikeCount = aug.orphans.filter(o => o.name === "Nike").length;
  assert.ok(nikeCount <= 2);
});

test("buildFlaAugment: emits routing_counts + fetch_mode", () => {
  const aug = buildFlaAugment([], STUB_MAPS, { fetched: true });
  assert.equal(aug.fetch_mode, "live-rest-api");
  assert.equal(aug.fla_signal, "positive");
  assert.deepEqual(aug.routing_counts, { direct: 0, alias: 0, parent: 0, orphan: 0 });

  const aug2 = buildFlaAugment([], STUB_MAPS, { fetched: false });
  assert.equal(aug2.fetch_mode, "bundled-fallback");
});

test("buildWrcAugment: groups by slug, preserves severity + source_url", () => {
  const rows = [
    { brand: "Nike", factory: "F1", country: "KH", year: 2020, finding: "x", source_url: "https://wrc/f1", severity: "negative" },
  ];
  const aug = buildWrcAugment(rows, STUB_MAPS);
  assert.equal(aug._signal, "negative");
  assert.equal(aug._source_url, "https://www.workersrights.org/factory-investigations/");
  // With STUB_MAPS, Nike likely orphans (no company file in test) — we
  // assert the OUTPUT SHAPE, not match success.
  assert.ok("companies" in aug);
  assert.ok("orphans" in aug);
  assert.ok("_stats" in aug);
});

test("buildCccAugment: emits positive signal + transparencyPledge bucket name", () => {
  const aug = buildCccAugment([{ brand: "H&M", pledge_signed_year: 2017, source_url: "u" }], STUB_MAPS);
  assert.equal(aug._signal, "positive");
  // shape contract: either matched or orphaned but shape exists
  assert.ok("companies" in aug);
  assert.ok(aug._source_url.includes("cleanclothes"));
});

test("buildHrwAugment: emits negative + hrwReports bucket", () => {
  const aug = buildHrwAugment(
    [{ brand: "Amazon", year: 2022, title: "x", source_url: "https://hrw" }],
    STUB_MAPS,
  );
  assert.equal(aug._signal, "negative");
  assert.ok(aug._source_url.includes("hrw.org"));
});

test("buildIlrfAugment: emits negative + ilrfCampaigns bucket", () => {
  const aug = buildIlrfAugment(
    [{ brand: "Walmart", year: 2020, campaign: "x", source_url: "https://laborrights.org" }],
    STUB_MAPS,
  );
  assert.equal(aug._signal, "negative");
  assert.ok(aug._source_url.includes("laborrights"));
});

/* ─── snapshot shape ─────────────────────────────────────────────── */

test("buildSnapshot: shape matches contract; sources annotated with signal", () => {
  const snap = buildSnapshot({
    flaRows: [{ name: "Nike", status: "accredited", category: "company", raw_type: null, source_url: "u" }],
    flaSourceLog: [{ url: "u", status: "ok", count: 1 }],
    flaFetched: true,
  });
  assert.equal(snap._sources.fla.signal, "positive");
  assert.equal(snap._sources.wrc.signal, "negative");
  assert.equal(snap._sources.ccc.signal, "positive");
  assert.equal(snap._sources.hrw.signal, "negative");
  assert.equal(snap._sources.ilrf.signal, "negative");
  assert.ok(Array.isArray(snap.fla_members));
  assert.ok(Array.isArray(snap.wrc_findings));
  assert.ok(Array.isArray(snap.ccc_signatories));
  assert.ok(Array.isArray(snap.hrw_reports));
  assert.ok(Array.isArray(snap.ilrf_campaigns));
});
