/**
 * destagger-crons.mjs — B-120 fix (option b, adapted).
 *
 * ROOT CAUSE: all 126 data crons share concurrency group `data-pipeline-commit`
 * (1 running + 1 pending max), and ~90 are bunched in the 4–7 UTC window, so
 * GitHub cancels ~88 as superseded. Confirmed live: 20 cancelled + 15 failure.
 *
 * FIX (workflow-timing only — NO data/grade change; the pipeline revives as each
 * cron next fires in an uncontended slot):
 *   1. Destagger the time-of-day of every shared-group cron to an EVEN spread
 *      across 24h (preserving cadence fields DoM/Month/DoW), so short crons no
 *      longer pile up.
 *   2. Move the LONG-RUNNERS (timeout-minutes >= LONG_MIN) OFF the shared group
 *      onto a per-workflow group `${{ github.workflow }}`. A shared group can't
 *      absorb a 240-min or 150-min-weekly job — it would block every other cron
 *      for hours regardless of spacing. Short crons KEEP the shared group (their
 *      pushes stay serialized, minimal contention), so this preserves option b's
 *      low-push-storm intent while removing the pathological blocking.
 *
 * SAFETY: DRY RUN BY DEFAULT (Aron's rule). Prints the full remap. --apply writes.
 *   node scripts/destagger-crons.mjs           # preview
 *   node scripts/destagger-crons.mjs --apply    # write
 *
 * Only touches files whose concurrency group is `data-pipeline-commit`. Skips
 * multi-cron files (reported for manual handling). Never changes cadence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WF = path.resolve(__dirname, "..", ".github", "workflows");
const APPLY = process.argv.includes("--apply");
const LONG_MIN = 60; // timeout-minutes at/above which a cron leaves the shared group
const SHARED = "data-pipeline-commit";
const PERWF = "${{ github.workflow }}";

// Keep these at their CURRENT time — score-rebake must run after news-rss (grades
// depend on the fresh digest; documented in score-rebake-weekly.yml). They still
// move off the shared group below so they're never cancelled.
const PIN_TIME = new Set(["score-rebake-weekly.yml", "news-rss-nightly.yml"]);
// Always give these a per-workflow group even if short — protect the grade pipeline.
const FORCE_PERWF = new Set(["score-rebake-weekly.yml"]);

const files = fs.readdirSync(WF).filter((f) => f.endsWith(".yml"));

const jobs = [];
const skipped = [];
for (const f of files) {
  const p = path.join(WF, f);
  const src = fs.readFileSync(p, "utf8");
  if (!src.includes(`group: ${SHARED}`)) continue;
  const cronLines = [...src.matchAll(/^(\s*- cron:\s*)(["'])([^"']+)\2/gm)];
  if (cronLines.length === 0) continue;
  if (cronLines.length > 1) { skipped.push(`${f} (${cronLines.length} cron lines)`); continue; }
  const to = [...src.matchAll(/timeout-minutes:\s*(\d+)/g)].map((m) => +m[1]);
  jobs.push({ f, p, src, cron: cronLines[0][3].trim(), timeout: to.length ? Math.max(...to) : 0 });
}

// Deterministic order, even spread across the 1440 minutes of the day.
jobs.sort((a, b) => a.f.localeCompare(b.f));
const N = jobs.length;
for (let i = 0; i < N; i++) {
  const minuteOfDay = Math.round((i * 1440) / N) % 1440;
  jobs[i].newH = Math.floor(minuteOfDay / 60);
  jobs[i].newM = minuteOfDay % 60;
  jobs[i].pinTime = PIN_TIME.has(jobs[i].f);
  jobs[i].leaveGroup = jobs[i].timeout >= LONG_MIN || FORCE_PERWF.has(jobs[i].f);
}

let retimed = 0, movedOff = 0, pinned = 0;
console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${N} shared-group scheduled crons:\n`);
for (const j of jobs) {
  const parts = j.cron.split(/\s+/);
  if (parts.length < 5) { console.log(`  ⚠️ skip ${j.f} — unparseable cron "${j.cron}"`); continue; }
  const [oldM, oldH, ...rest] = parts;
  const oldTimeStr = `${String(+oldH || 0).padStart(2, "0")}:${String(+oldM || 0).padStart(2, "0")}`;
  let out = j.src;
  let timeStr = oldTimeStr;

  if (j.pinTime) {
    pinned++;
  } else {
    const newCron = `${j.newM} ${j.newH} ${rest.join(" ")}`;
    timeStr = `${String(j.newH).padStart(2, "0")}:${String(j.newM).padStart(2, "0")}`;
    // Rewrite the cron AND its trailing comment together, so the comment never
    // describes a stale time. Uniform "HH:MM UTC · spread (B-120)".
    out = out.replace(
      /^(\s*- cron:\s*)(["'])([^"']+)\2[^\n]*$/m,
      (m, pre, q) => `${pre}${q}${newCron}${q}   # ${timeStr} UTC · spread (B-120)`
    );
    retimed++;
  }

  if (j.leaveGroup) { out = out.replace(`group: ${SHARED}`, `group: ${PERWF}`); movedOff++; }

  const notes = [j.pinTime ? "PINNED (rebake↔news dep)" : `${oldTimeStr}→${timeStr}`,
                 j.leaveGroup ? `per-workflow group (${j.timeout || "protected"}min)` : "shared group"].join(" · ");
  console.log(`  ${j.f.padEnd(40)} ${notes}`);
  if (APPLY && out !== j.src) fs.writeFileSync(j.p, out);
}

console.log(`\n  ${retimed} re-timed · ${pinned} pinned · ${movedOff} on per-workflow group · ${N - movedOff} on shared group.`);
if (skipped.length) console.log(`  ⚠️ skipped (multi-cron, handle manually): ${skipped.join(", ")}`);
if (!APPLY) console.log(`\n  (dry run — re-run with --apply to write)`);
