#!/usr/bin/env node
/**
 * Tests for the firearms-industry fetch + merge pipeline (sprint C).
 *
 * Node 22 built-in `node:test` runner. No deps. No network.
 *
 *   node --test scripts/firearms-industry-fetch.test.mjs
 *   node scripts/firearms-industry-fetch.test.mjs
 *
 * Verifies, against the ~30-row checked-in fixture
 * scripts/fixtures/firearms-industry/sample.json:
 *
 *   1. SEED_ENTRIES contains the expected industry-trade tag set.
 *   2. buildSeedSnapshot turns SEED_ENTRIES into a well-shaped raw doc.
 *   3. computeStats counts members/retailers/manufacturers correctly.
 *   4. enrichWithFec sums per-committee totals deterministically when
 *      passed an injected fetchFn (so we never hit api.open.fec.gov).
 *   5. buildAugment gates against company slugs, surfaces orphans, and
 *      keeps language neutral (no "lobby" / "anti-gun" tokens slip in).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SEED_ENTRIES,
  SOURCES,
  FIREARMS_COMMITTEES,
  buildSeedSnapshot,
  computeStats,
  enrichWithFec,
} from "./firearms-industry-fetch.mjs";
import { buildAugment } from "./firearms-industry-merge.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures/firearms-industry/sample.json");

describe("SEED_ENTRIES — curated catalog", () => {
  it("has at least 30 entries", () => {
    assert.ok(SEED_ENTRIES.length >= 30, `Expected >=30 seed entries, got ${SEED_ENTRIES.length}`);
  });

  it("every entry has a slug, name, and at least one sourceUrl", () => {
    for (const e of SEED_ENTRIES) {
      assert.ok(e.slug, `entry missing slug: ${JSON.stringify(e)}`);
      assert.ok(e.name, `entry missing name: ${e.slug}`);
      assert.ok(Array.isArray(e.sourceUrls) && e.sourceUrls.length > 0,
        `entry ${e.slug} missing sourceUrls`);
    }
  });

  it("slugs are unique", () => {
    const seen = new Set();
    for (const e of SEED_ENTRIES) {
      assert.ok(!seen.has(e.slug), `duplicate slug: ${e.slug}`);
      seen.add(e.slug);
    }
  });

  it("retailers list includes Walmart, Bass Pro, Cabela's, Academy", () => {
    const slugs = new Set(SEED_ENTRIES.filter((e) => e.retailsFirearms).map((e) => e.slug));
    for (const s of ["walmart", "bass-pro-shops", "cabela-s-bass-pro", "academy-sports"]) {
      assert.ok(slugs.has(s), `expected ${s} in retailer set`);
    }
  });

  it("manufacturer list includes Sturm Ruger, Smith & Wesson, Vista Outdoor", () => {
    const slugs = new Set(SEED_ENTRIES.filter((e) => e.manufacturesFirearms).map((e) => e.slug));
    for (const s of ["sturm-ruger-and-co", "smith-and-wesson-brands", "vista-outdoor"]) {
      assert.ok(slugs.has(s), `expected ${s} in manufacturer set`);
    }
  });

  it("dicks-sporting-goods is flagged historicalOnly", () => {
    const dks = SEED_ENTRIES.find((e) => e.slug === "dick-s-sporting-goods");
    assert.ok(dks, "expected dicks-sporting-goods in seed");
    assert.equal(dks.historicalOnly, true);
    assert.equal(dks.retailsFirearms, false);
  });

  it("notes never contain politically loaded language", () => {
    const banned = ["gun lobby", "weapons dealer", "anti-gun", "pro-gun", "gun nut", "right-wing"];
    for (const e of SEED_ENTRIES) {
      const text = (e.notes || "").toLowerCase();
      for (const b of banned) {
        assert.ok(!text.includes(b), `entry ${e.slug} note contains banned phrase "${b}"`);
      }
    }
  });
});

describe("buildSeedSnapshot", () => {
  it("produces a license-stamped, sourced raw document", () => {
    const snap = buildSeedSnapshot();
    assert.match(snap._license, /Public records/);
    assert.ok(Array.isArray(snap._source_urls));
    assert.ok(snap._source_urls.includes(SOURCES.NSSF_MEMBERS));
    assert.ok(snap._source_urls.includes(SOURCES.FEC));
    assert.ok(snap._generated_at);
  });

  it("converts every SEED_ENTRY into a seed row, never drops one", () => {
    const snap = buildSeedSnapshot();
    assert.equal(snap.seed_entries.length, SEED_ENTRIES.length);
  });

  it("computes industryMember from organizations correctly", () => {
    const snap = buildSeedSnapshot([
      { slug: "x", name: "X", organizations: ["NSSF"], sourceUrls: ["http://x"] },
      { slug: "y", name: "Y", organizations: ["FFL"], sourceUrls: ["http://y"] },
      { slug: "z", name: "Z", organizations: [], sourceUrls: ["http://z"] },
    ]);
    const byId = Object.fromEntries(snap.seed_entries.map((r) => [r.slug, r]));
    assert.equal(byId.x.industryMember, true, "NSSF → industryMember=true");
    assert.equal(byId.y.industryMember, false, "FFL alone is not industryMember");
    assert.equal(byId.z.industryMember, false, "no orgs → industryMember=false");
  });

  it("sorts organizations deterministically", () => {
    const snap = buildSeedSnapshot([
      { slug: "x", name: "X", organizations: ["OEM", "NSSF", "FFL"], sourceUrls: ["http://x"] },
    ]);
    assert.deepEqual(snap.seed_entries[0].organizations, ["FFL", "NSSF", "OEM"]);
  });
});

describe("computeStats", () => {
  it("counts members, manufacturers, retailers separately", () => {
    const rows = [
      { industryMember: true,  manufacturesFirearms: true,  retailsFirearms: false, pacContributionsUsd: 0,    historicalOnly: false },
      { industryMember: true,  manufacturesFirearms: false, retailsFirearms: true,  pacContributionsUsd: 1000, historicalOnly: false },
      { industryMember: false, manufacturesFirearms: false, retailsFirearms: false, pacContributionsUsd: 0,    historicalOnly: true },
    ];
    const stats = computeStats(rows);
    assert.equal(stats.total_entries, 3);
    assert.equal(stats.industry_members, 2);
    assert.equal(stats.manufacturers, 1);
    assert.equal(stats.retailers, 1);
    assert.equal(stats.historical_only, 1);
    assert.equal(stats.with_pac_contributions, 1);
  });
});

describe("enrichWithFec (no network, injected fetchFn)", () => {
  it("sums per-committee aggregates onto matching seed rows", async () => {
    const rows = buildSeedSnapshot().seed_entries;
    // Inject a deterministic fetcher: every committee/cycle returns one
    // employer aggregate matching Sturm Ruger and one matching Glock.
    const calls = [];
    const fetchFn = async (committeeId, cycle) => {
      calls.push({ committeeId, cycle });
      return [
        { employer: "STURM RUGER AND CO", total: 1000 },
        { employer: "Glock Inc.",         total: 500  },
        { employer: "MOM AND POP DELI",   total: 9999 }, // should not match
      ];
    };
    const before = rows.find((r) => r.slug === "sturm-ruger-and-co").pacContributionsUsd;
    assert.equal(before, 0);

    await enrichWithFec(rows, {
      committees: [{ id: "C00037283", name: "NSSF PAC", org: "NSSF" }],
      windowYears: 2,
      fetchFn,
      delayMs: 0,
      now: new Date("2026-06-07T00:00:00Z"),
    });

    const sturm = rows.find((r) => r.slug === "sturm-ruger-and-co");
    assert.equal(sturm.pacContributionsUsd, 1000);
    assert.equal(sturm.pacContributionsByCommittee["C00037283"], 1000);
    assert.ok(sturm.sourceUrls.includes(SOURCES.FEC),
      "FEC source URL appended on enrichment");

    const glock = rows.find((r) => r.slug === "glock");
    assert.equal(glock.pacContributionsUsd, 500);

    // Random brand name not in employer string ⇒ untouched.
    const magpul = rows.find((r) => r.slug === "magpul");
    assert.equal(magpul.pacContributionsUsd, 0);

    // 2-year window from 2026 ⇒ exactly 1 cycle (2026).
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cycle, 2026);
  });

  it("known FEC committees are well-formed FEC IDs", () => {
    for (const c of FIREARMS_COMMITTEES) {
      assert.match(c.id, /^C\d{8}$/, `committee ${c.name} has malformed id ${c.id}`);
      assert.ok(c.name);
      assert.ok(c.org);
    }
  });
});

describe("buildAugment (merge) — fixture", () => {
  it("loads the 30-row fixture", async () => {
    const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    assert.ok(raw.seed_entries.length >= 30);
  });

  it("keys companies by slug + carries source URLs through", async () => {
    const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    const aug = buildAugment(raw, null /* no gating */);
    assert.equal(aug._stats.matched_companies, raw.seed_entries.length);
    assert.equal(aug._stats.orphan_entries, 0);
    assert.ok(aug.companies["sturm-ruger-and-co"], "sturm-ruger key present");
    const block = aug.companies["sturm-ruger-and-co"].guns;
    assert.equal(block.industryMember, true);
    assert.equal(block.manufacturesFirearms, true);
    assert.ok(block.sourceUrls.length >= 2);
  });

  it("gates against the catalog: unknown slugs land in orphans[]", async () => {
    const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    const catalog = new Set(["walmart", "sturm-ruger-and-co"]); // tiny on-purpose
    const aug = buildAugment(raw, catalog);
    assert.equal(Object.keys(aug.companies).length, 2);
    assert.ok(aug.orphans.length >= raw.seed_entries.length - 2);
    for (const o of aug.orphans) {
      assert.equal(o.reason, "no_company_file");
      assert.ok(o.slug && o.name);
    }
  });

  it("propagates historicalOnly flag onto the gun block", async () => {
    const raw = JSON.parse(await fs.readFile(FIXTURE, "utf-8"));
    const aug = buildAugment(raw, null);
    assert.equal(aug.companies["dick-s-sporting-goods"].guns.historicalOnly, true);
    assert.equal(aug.companies["dick-s-sporting-goods"].guns.retailsFirearms, false);
    // Brands not flagged historical shouldn't carry the field.
    assert.equal(aug.companies["walmart"].guns.historicalOnly, undefined);
  });

  it("dedupes sourceUrls inside the augment", () => {
    const raw = {
      _license: "Public records",
      seed_entries: [{
        slug: "x", name: "X",
        industryMember: false, organizations: [],
        pacContributionsUsd: 0, pacContributionsByCommittee: {},
        retailsFirearms: false, manufacturesFirearms: false,
        sourceUrls: ["http://a", "http://b", "http://a", "", null],
        notes: "",
      }],
    };
    const aug = buildAugment(raw, null);
    assert.deepEqual(aug.companies["x"].guns.sourceUrls, ["http://a", "http://b"]);
  });

  it("preserves license attribution from raw → derived", () => {
    const raw = { _license: "Custom test license", seed_entries: [] };
    const aug = buildAugment(raw, null);
    assert.equal(aug._license, "Custom test license");
  });
});

// Self-run mode (node scripts/foo.test.mjs without --test). The
// describe/it harness above auto-runs in both modes; this only matters
// for the exit-code summary on Node < 22.
if (import.meta.url === `file://${process.argv[1]}`) {
  // node:test auto-handles process.exit when invoked as a module.
}
