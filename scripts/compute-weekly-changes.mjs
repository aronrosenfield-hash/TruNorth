#!/usr/bin/env node
/**
 * compute-weekly-changes.mjs — builds public/data/weekly_changes.json.
 *
 * THE MISSING GENERATOR. The app's "what changed this week" retention loop
 * (basket "X new" badges, the Today compass story, the Ledger feed) and the
 * Sunday email digest all read public/data/weekly_changes.json — but nothing
 * ever wrote it. It was a hand-stub from launch day with `changes: []`, so the
 * loop has shown nothing since v1. weekly-digest.yml's claim that "the data
 * file is rebuilt by other crons" was aspirational; this is that cron.
 *
 * HOW IT WORKS
 *   1. Read the freshly-baked catalog grades from public/data/index.json.
 *   2. Diff them against last run's snapshot (_meta/grade-snapshot.json):
 *        grade_up / grade_drop  — a brand's letter grade moved
 *        new_recall             — hasRecall flipped false → true
 *        new_brand              — a brand became graded that wasn't before
 *   3. Write weekly_changes.json (the shape App.jsx + send-weekly-digest.mjs
 *      consume) and overwrite the snapshot as next week's baseline.
 *
 * Run INSIDE score-rebake-weekly.yml, AFTER finalize-bundle regenerates
 * index.json, so it diffs the grades that were just recomputed and commits
 * atomically with them.
 *
 * USAGE
 *   node scripts/compute-weekly-changes.mjs           # dry-run: print summary
 *   node scripts/compute-weekly-changes.mjs --apply    # write the two files
 *
 * SAFETY (sandboxed-fetch lesson): never overwrite outputs from a suspicious
 * index. If the catalog reads as truncated/empty (far fewer graded brands than
 * the snapshot), abort without touching weekly_changes.json or the snapshot —
 * a bad bake must not wipe the retention loop or reset the baseline.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(ROOT, "public", "data", "index.json");
const SNAP_PATH = path.join(ROOT, "public", "data", "_meta", "grade-snapshot.json");
const OUT_PATH = path.join(ROOT, "public", "data", "weekly_changes.json");

// Cap the emitted list — a normal week is a handful of changes, but a one-off
// catalog expansion could otherwise flood the feed with thousands of
// "new_brand" rows. stats.* still reflect the TRUE totals; only the array
// the app renders is capped.
const CAP = 60;
const MIN_GRADED = 50; // floor below which the index is presumed broken
// B-94: max tolerated disagreement between the prior snapshot and the catalog
// that was actually committed. Real weeks land well under 1%; the poisoned
// baseline that produced the bogus 2026-07-20 feed sat at 5.3% (150/2,845).
const SNAPSHOT_DRIFT_MAX_PCT = 2;
const GRADE_ORDER = { A: 5, B: 4, C: 3, D: 2, F: 1 };

function isGraded(c) {
  return typeof c.overall === "number" && c.grade && c.grade !== "?";
}

/** Load the catalog index as an array of company entries. */
export function loadIndex(p = INDEX_PATH) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Array.isArray(raw) ? raw : raw.companies || raw.items || Object.values(raw);
}

/** Reduce the index to the snapshot we persist: slug → {g grade, o overall, r hasRecall}. */
export function snapshotFromIndex(arr, takenAt) {
  const grades = {};
  for (const c of arr) {
    const slug = c.slug || c.id;
    if (!slug || !isGraded(c)) continue;
    grades[slug] = { g: c.grade, o: c.overall, r: !!c.hasRecall };
  }
  return { takenAt, grades };
}

/**
 * Diff current catalog against the prior snapshot.
 * Returns { changes:[...sorted, newsiest first], stats:{...true totals} }.
 */
export function diffChanges(prevSnap, currArr) {
  const prev = prevSnap?.grades || {};
  const changes = [];
  const stats = { gradeChanges: 0, newScandals: 0, newRecalls: 0, newBrands: 0 };

  for (const c of currArr) {
    const slug = c.slug || c.id;
    if (!slug) continue;
    const before = prev[slug];
    const graded = isGraded(c);

    // New recall: hasRecall flipped on for a brand we were already tracking.
    if (c.hasRecall && before && !before.r) {
      changes.push({ type: "new_recall", slug, name: c.name, detail: "New recall on file", severity: "alert", _rank: 100 });
      stats.newRecalls++;
    }

    if (!before) {
      // Brand wasn't in last snapshot. Only flag it if it's actually graded now
      // (became graded as new data landed) — ungraded "?" brands aren't news.
      if (graded) {
        changes.push({ type: "new_brand", slug, name: c.name, detail: `Newly graded · ${c.grade}`, severity: "info", _rank: 10 + (GRADE_ORDER[c.grade] || 0) });
        stats.newBrands++;
      }
      continue;
    }

    // Grade movement (only meaningful while currently graded).
    if (graded && before.g && before.g !== c.grade) {
      const dropped = (GRADE_ORDER[c.grade] || 0) < (GRADE_ORDER[before.g] || 0);
      if (dropped) {
        changes.push({ type: "grade_drop", slug, name: c.name, detail: `Grade slipped ${before.g} → ${c.grade}`, severity: c.grade === "F" ? "alert" : "warn", _rank: 90 - (GRADE_ORDER[c.grade] || 0) });
      } else {
        changes.push({ type: "grade_up", slug, name: c.name, detail: `Grade rose ${before.g} → ${c.grade}`, severity: "info", _rank: 40 + (GRADE_ORDER[c.grade] || 0) });
      }
      stats.gradeChanges++;
    }
  }

  // Newsiest first: recalls, then steep drops, then rises, then new brands.
  changes.sort((a, b) => (b._rank - a._rank) || String(a.name || "").localeCompare(String(b.name || "")));
  changes.forEach((c) => delete c._rank);
  return { changes, stats };
}

function buildOutput(changes, stats, nowIso) {
  return {
    generatedAt: nowIso,
    weekOf: nowIso.slice(0, 10),
    changes: changes.slice(0, CAP),
    stats,
  };
}

function main() {
  const apply = process.argv.includes("--apply");
  const nowIso = new Date().toISOString();

  let curr;
  try {
    curr = loadIndex();
  } catch (err) {
    console.error(`[weekly-changes] cannot read index.json: ${err.message}`);
    process.exit(1);
  }

  const currGraded = curr.filter(isGraded).length;
  if (currGraded < MIN_GRADED) {
    console.error(`[weekly-changes] only ${currGraded} graded brands in index — refusing to run (suspect truncated bake).`);
    process.exit(1);
  }

  const prevSnap = fs.existsSync(SNAP_PATH) ? JSON.parse(fs.readFileSync(SNAP_PATH, "utf8")) : null;

  // First-ever run: establish the baseline, emit an honest empty week. We do
  // NOT diff against git history — the recent grade churn is a one-time
  // scoring-methodology overhaul, not real-world news, and flagging it would
  // mislead users into thinking 2,000 brands' behavior changed this week.
  if (!prevSnap) {
    const snap = snapshotFromIndex(curr, nowIso);
    const out = buildOutput([], { gradeChanges: 0, newScandals: 0, newRecalls: 0, newBrands: 0 }, nowIso);
    console.log(`[weekly-changes] BOOTSTRAP — no prior snapshot. Baselining ${Object.keys(snap.grades).length} graded brands; emitting empty week.`);
    if (apply) {
      fs.writeFileSync(SNAP_PATH, JSON.stringify(snap));
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      console.log(`[weekly-changes] wrote ${path.relative(ROOT, SNAP_PATH)} + ${path.relative(ROOT, OUT_PATH)}`);
    } else {
      console.log("[weekly-changes] (dry-run — pass --apply to write)");
    }
    return;
  }

  // Guard: a healthy week never loses half the graded catalog. If it did, the
  // bake is broken — bail before clobbering the snapshot/feed.
  const prevGraded = Object.keys(prevSnap.grades || {}).length;
  if (prevGraded > 0 && currGraded < prevGraded * 0.5) {
    console.error(`[weekly-changes] graded count fell ${prevGraded} → ${currGraded} (>50% drop) — refusing to run.`);
    process.exit(1);
  }

  // B-94 guard (2026-07-20): the snapshot must be a faithful record of the
  // catalog that was actually COMMITTED last run. It wasn't — score-rebake-
  // weekly.yml staged _meta/grade-snapshot.json but not index.json, so the
  // snapshot drifted 150 brands out of sync and sat systematically one grade
  // ABOVE the shipped catalog. Every diff then read as a decline: the feed
  // claimed 60 changes, all "drops", of which 48 were phantom and 0 of the
  // sampled "from" letters were right ("Alcoa slipped C → D" — Alcoa never
  // moved). Reality that week was 33 changes: 19 drops and 14 rises.
  // Comparing the snapshot against the last committed index.json catches that
  // class of poisoning before we publish claims about named companies.
  // Advisory-only when git isn't available (local runs, shallow checkouts).
  try {
    const committedRaw = execSync("git show HEAD:public/data/index.json", {
      cwd: ROOT, maxBuffer: 1024 * 1024 * 512, stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const committed = JSON.parse(committedRaw);
    let compared = 0, disagree = 0;
    for (const c of committed) {
      const slug = c.slug || c.id;
      const snapEntry = prevSnap.grades?.[slug];
      if (!slug || !snapEntry?.g) continue;
      const shipped = isGraded(c) ? c.grade : "?";
      compared++;
      if (snapEntry.g !== shipped) disagree++;
    }
    const pct = compared ? (disagree / compared) * 100 : 0;
    if (compared > 0 && pct > SNAPSHOT_DRIFT_MAX_PCT) {
      console.error(
        `[weekly-changes] snapshot disagrees with the committed index.json on ` +
        `${disagree}/${compared} brands (${pct.toFixed(2)}% > ${SNAPSHOT_DRIFT_MAX_PCT}%). ` +
        `The baseline is stale or was committed without its index — refusing to ` +
        `publish change claims from a poisoned baseline. Re-baseline the snapshot ` +
        `from the shipped catalog, then re-run.`
      );
      process.exit(1);
    }
    console.log(`[weekly-changes] baseline check OK — snapshot matches committed index on ${compared - disagree}/${compared} brands.`);
  } catch (err) {
    console.warn(`[weekly-changes] baseline check skipped (git unavailable): ${err.message.split("\n")[0]}`);
  }

  const { changes, stats } = diffChanges(prevSnap, curr);
  const out = buildOutput(changes, stats, nowIso);
  const snap = snapshotFromIndex(curr, nowIso);

  console.log(`[weekly-changes] ${changes.length} change(s) this week — ${stats.gradeChanges} grade, ${stats.newRecalls} recall, ${stats.newBrands} newly graded.`);
  for (const c of changes.slice(0, 8)) console.log(`  · ${c.type.padEnd(11)} ${c.name} — ${c.detail}`);
  if (changes.length > 8) console.log(`  … +${changes.length - 8} more`);

  if (apply) {
    fs.writeFileSync(SNAP_PATH, JSON.stringify(snap));
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(`[weekly-changes] wrote ${path.relative(ROOT, OUT_PATH)} (+ refreshed snapshot baseline).`);
  } else {
    console.log("[weekly-changes] (dry-run — pass --apply to write)");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
