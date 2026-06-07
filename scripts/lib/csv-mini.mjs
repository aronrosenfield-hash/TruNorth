/**
 * Tiny RFC-4180-ish CSV parser used by the DW-7…DW-12 waitlist pipelines.
 *
 * Why not csv-parse? The repo is intentionally dependency-light (see
 * package.json — no parsers, no fetchers, just Vite + Capacitor + React).
 * Federal datasets we consume (OFAC SDN, BIS Entity List exports, DOL WHD
 * WHISARD, Energy Star registries) are well-behaved CSV — quoted fields
 * with "" escapes are the only complication. ~50 lines is plenty.
 *
 * Tolerates:
 *   - CRLF or LF line endings
 *   - Quoted fields with embedded commas and "" escapes
 *   - A leading UTF-8 BOM
 *   - Trailing blank lines
 *
 * Does NOT handle multi-line fields with embedded raw newlines inside
 * quotes. None of the DW-7…DW-12 sources use them. If you hit a source
 * that does, switch to csv-parse and don't apologise.
 */

export function parseCSV(text) {
  if (typeof text !== "string") return [];
  const clean = text.replace(/^﻿/, "");
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field); field = "";
      } else if (ch === "\r") {
        // swallow CR; LF (next char) closes the row
      } else if (ch === "\n") {
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === "") continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    out.push(obj);
  }
  return out;
}

/** YYYY-MM-DD in UTC. Used to stamp the per-day raw snapshot file. */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}
