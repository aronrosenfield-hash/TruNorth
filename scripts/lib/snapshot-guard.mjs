/**
 * H5 (2026-06-11): shared empty-snapshot guard for fetchers.
 *
 * The Jun-10 incident class: a sandboxed/no-network/erroring fetch run
 * writes an empty or tiny raw snapshot, which the next merge happily
 * applies, wiping good narratives. Only 15 of 217 fetchers had ad-hoc
 * guards. New/updated fetchers should write snapshots through this.
 *
 * Usage:
 *   import { writeSnapshotGuarded } from "./lib/snapshot-guard.mjs";
 *   writeSnapshotGuarded(outPath, records, { min: 50, label: "cfpb" });
 *
 * Refuses (exit 1) when records < min, OR when an existing snapshot at the
 * same path has >2x the new count (shrink guard). The apply-augments layer
 * has a second, central shrink-guard as backstop for the legacy fetchers.
 */
import fs from "node:fs";

export function writeSnapshotGuarded(outPath, data, { min = 10, label = outPath, countFn } = {}) {
  const count = countFn ? countFn(data)
    : Array.isArray(data) ? data.length
    : Array.isArray(data?.records) ? data.records.length
    : Array.isArray(data?.entries) ? data.entries.length
    : Object.keys(data?.companies || data?.bySlug || data || {}).length;

  if (count < min) {
    console.error(`[snapshot-guard] FATAL ${label}: only ${count} records (< min ${min}) — refusing to write. Network/sandbox problem?`);
    process.exit(1);
  }
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const prevCount = countFn ? countFn(prev)
      : Array.isArray(prev) ? prev.length
      : Array.isArray(prev?.records) ? prev.records.length
      : Array.isArray(prev?.entries) ? prev.entries.length
      : Object.keys(prev?.companies || prev?.bySlug || prev || {}).length;
    if (prevCount >= 10 && count < prevCount * 0.5) {
      console.error(`[snapshot-guard] FATAL ${label}: ${count} records vs ${prevCount} in the existing snapshot (>50% shrink) — refusing to overwrite.`);
      process.exit(1);
    }
  } catch { /* no previous snapshot — fine */ }

  fs.writeFileSync(outPath, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  console.log(`[snapshot-guard] ${label}: wrote ${count} records`);
  return count;
}
