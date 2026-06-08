/**
 * Minimal XLSX reader — zero npm dependencies.
 *
 * Parses .xlsx files (which are zip archives containing XML) without any
 * third-party package. Built for the small (< 1 MB) annual-scorecard XLSX
 * downloads used by data-source fetchers (WWF Palm Oil Buyer Scorecard,
 * etc.). Handles:
 *   - Central-directory parsing of ZIP archives (no ZIP64)
 *   - Store (uncompressed) + DEFLATE (compression method 8) entries
 *   - sharedStrings.xml (inline <t>) + worksheets/sheet*.xml
 *   - Returns rows as arrays of cell values (numbers or strings)
 *
 * NOT supported: encrypted XLSX, ZIP64 archives (> 4GB), rich-text-only
 * shared strings, dates as numeric serials (returned as raw numbers — the
 * caller can decode if needed).
 *
 * Public API:
 *   - readXlsx(buffer, { sheet = 1 }) -> { rows: any[][], sheetName }
 *   - parseXlsxFromBuffer === readXlsx (alias)
 *
 * Why not depend on `xlsx`? It's ~1MB, has a non-permissive license, and
 * we only need a tiny read-only slice for our annual-cadence fetchers.
 * This file is ~150 lines and uses only `node:zlib`.
 */

import zlib from "node:zlib";

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

/** Locate End-of-Central-Directory record by scanning the last 64KB. */
function findEOCD(buf) {
  const sig = 0x06054b50;
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === sig) return i;
  }
  throw new Error("XLSX: end-of-central-directory not found (not a valid zip?)");
}

/** Parse the central directory into { name -> { localOff, compMethod, compSize, uncompSize } }. */
function parseCentralDirectory(buf) {
  const eocdOff = findEOCD(buf);
  const cdEntries = u16(buf, eocdOff + 10);
  const cdOffset  = u32(buf, eocdOff + 16);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("XLSX: bad central-directory entry signature");
    const compMethod = u16(buf, p + 10);
    const compSize   = u32(buf, p + 20);
    const uncompSize = u32(buf, p + 24);
    const nameLen    = u16(buf, p + 28);
    const extraLen   = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOff   = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf-8");
    entries[name] = { localOff, compMethod, compSize, uncompSize };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read & inflate (if needed) the bytes for a named entry, return UTF-8 string. */
function readEntry(buf, entry) {
  const p = entry.localOff;
  if (u32(buf, p) !== 0x04034b50) throw new Error("XLSX: bad local file header signature");
  const nameLen  = u16(buf, p + 26);
  const extraLen = u16(buf, p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const compressed = buf.slice(dataStart, dataStart + entry.compSize);
  let raw;
  if (entry.compMethod === 0) raw = compressed;
  else if (entry.compMethod === 8) raw = zlib.inflateRawSync(compressed);
  else throw new Error(`XLSX: unsupported compression method ${entry.compMethod}`);
  return raw.toString("utf-8");
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&"); // last so we don't double-decode
}

/**
 * Parse sharedStrings.xml into a flat array. Rich-text runs are collapsed
 * into a single string (concatenating all <t> children of each <si>).
 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let pieces = "", t;
    while ((t = tRe.exec(m[1]))) pieces += decodeXmlEntities(t[1]);
    out.push(pieces);
  }
  return out;
}

/** Convert "A1" / "BC5" → 0-based column index. */
export function colIdx(ref) {
  const m = /^([A-Z]+)\d+$/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Parse a worksheet XML into rows[rowIdx][colIdx] = value (string|number|bool|null).
 * Rows/cells are 0-indexed even though XLSX uses 1-based refs internally.
 */
function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rIdx = parseInt(rm[1], 10) - 1;
    const body = rm[2];
    const row = [];
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(body))) {
      const attrs = cm[1] || cm[3] || "";
      const inner = cm[2] || "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t   = /\bt="(\w+)"/.exec(attrs)?.[1];
      const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const isMatch = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(inner);
      let val = null;
      if (vMatch) {
        const raw = vMatch[1];
        if (t === "s") {
          const idx = parseInt(raw, 10);
          val = sharedStrings[idx] ?? "";
        } else if (t === "b") {
          val = raw === "1";
        } else if (t === "str" || t === "e") {
          val = decodeXmlEntities(raw);
        } else {
          const n = Number(raw);
          val = Number.isFinite(n) ? n : decodeXmlEntities(raw);
        }
      } else if (isMatch) {
        val = decodeXmlEntities(isMatch[1]);
      }
      const c = ref ? colIdx(ref) : row.length;
      row[c] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[rIdx] = row;
  }
  return rows;
}

/** Parse workbook.xml → [{ name, sheetId, rId }]. */
function parseWorkbookSheets(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<sheet\b([^/>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    out.push({
      name: /\bname="([^"]*)"/.exec(attrs)?.[1] ?? "",
      sheetId: /\bsheetId="(\d+)"/.exec(attrs)?.[1] ?? "",
      rId: /\br:id="([^"]*)"/.exec(attrs)?.[1] ?? "",
    });
  }
  return out;
}

/**
 * Read an XLSX buffer and return parsed rows of the requested sheet.
 *
 * @param {Buffer} buf
 * @param {{ sheet?: number }} [opts]
 * @returns {{ rows: any[][], sheetName: string }}
 */
export function readXlsx(buf, { sheet = 1 } = {}) {
  const entries = parseCentralDirectory(buf);
  const ssXml = entries["xl/sharedStrings.xml"] ? readEntry(buf, entries["xl/sharedStrings.xml"]) : "";
  const sharedStrings = parseSharedStrings(ssXml);
  const wbXml = entries["xl/workbook.xml"] ? readEntry(buf, entries["xl/workbook.xml"]) : "";
  const sheets = parseWorkbookSheets(wbXml);
  const sheetName = sheets[sheet - 1]?.name ?? `sheet${sheet}`;
  const sheetPath = `xl/worksheets/sheet${sheet}.xml`;
  if (!entries[sheetPath]) throw new Error(`XLSX: missing ${sheetPath}`);
  const sheetXml = readEntry(buf, entries[sheetPath]);
  const rows = parseSheet(sheetXml, sharedStrings);
  return { rows, sheetName };
}

export const parseXlsxFromBuffer = readXlsx;
