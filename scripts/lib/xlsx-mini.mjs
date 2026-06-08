/**
 * Minimal XLSX reader for the OFLC LCA pipeline.
 *
 * XLSX files are ZIP archives containing XML parts. We avoid adding the
 * xlsx / exceljs dependency (the repo is intentionally dependency-light —
 * see scripts/lib/csv-mini.mjs) by shelling out to `unzip` (available on
 * every GitHub Actions ubuntu-latest runner and macOS by default) for ZIP
 * extraction and regex-streaming the worksheet XML.
 *
 *   await readXlsxRows(xlsxPath, { sheet = 1, onRow })
 *     — streams rows from the named sheet, invoking `onRow(rowObj, idx)`
 *       per data row. `rowObj` is header-keyed (header taken from first row).
 *       Numeric cells are returned as JS numbers; inline / shared strings
 *       are returned as strings. Empty cells are "".
 *
 * Why a custom parser?
 *   - The LCA disclosure XLSX is ~600K rows × ~90 columns per quarter.
 *     Loading the whole sheet into memory through a library would OOM
 *     on the 7GB GHA runner. Streaming + per-employer aggregation in a
 *     Map keeps peak RAM under a few hundred MB.
 *   - We only read XLSX. We never write.
 *
 * Limitations:
 *   - Single-sheet, well-formed Excel-produced files only.
 *   - Date cells return the raw numeric serial — caller is responsible
 *     for converting (the LCA disclosure files store decision dates as
 *     ISO strings via inlineStr, not serials, so no conversion needed).
 */

import { spawn } from "node:child_process";

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Pipe `unzip -p file member` and return a Readable of the XML bytes. */
function unzipMember(xlsxPath, member) {
  const child = spawn("unzip", ["-p", xlsxPath, member], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += b.toString(); });
  child.on("error", (err) => { child.stdout.destroy(err); });
  child.on("close", (code) => {
    if (code !== 0 && code !== null) {
      child.stdout.destroy(new Error(`unzip exited ${code} for ${member}: ${stderr.trim()}`));
    }
  });
  return child.stdout;
}

async function readSharedStrings(xlsxPath) {
  let xml = "";
  const stream = unzipMember(xlsxPath, "xl/sharedStrings.xml");
  try {
    for await (const chunk of stream) xml += chunk.toString("utf-8");
  } catch (err) {
    if (String(err.message || "").includes("filename not matched")) return [];
    throw err;
  }
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    let s = "";
    let tm;
    tRe.lastIndex = 0;
    while ((tm = tRe.exec(inner)) !== null) s += tm[1];
    out.push(decodeEntities(s));
  }
  return out;
}

async function streamSheet(xlsxPath, sheet, sst, onRow) {
  const stream = unzipMember(xlsxPath, `xl/worksheets/sheet${sheet}.xml`);
  let buf = "";
  let rowIdx = -1;

  const rowOpenRe = /<row\b/;
  const attrRe = /(\w+)="([^"]*)"/g;

  function colFromRef(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break;
      n = n * 26 + (ch - 64);
    }
    return n - 1;
  }

  function parseCell(attrStr, inner) {
    const a = {};
    let am;
    attrRe.lastIndex = 0;
    while ((am = attrRe.exec(attrStr)) !== null) a[am[1]] = am[2];
    const col = a.r ? colFromRef(a.r) : null;
    const type = a.t || "n";
    let value = "";
    if (inner) {
      if (type === "s") {
        const vm = /<v\b[^>]*>([^<]*)<\/v>/.exec(inner);
        if (vm) {
          const idx = parseInt(vm[1], 10);
          value = Number.isFinite(idx) ? (sst[idx] ?? "") : "";
        }
      } else if (type === "inlineStr" || type === "str") {
        let s = "";
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tRe.exec(inner)) !== null) s += tm[1];
        value = decodeEntities(s);
      } else if (type === "b") {
        const vm = /<v\b[^>]*>([^<]*)<\/v>/.exec(inner);
        value = vm && vm[1] === "1";
      } else {
        const vm = /<v\b[^>]*>([^<]*)<\/v>/.exec(inner);
        if (vm) {
          const num = Number(vm[1]);
          value = Number.isFinite(num) ? num : vm[1];
        }
      }
    }
    return { col, value };
  }

  // cell: <c r="A2" s="1" t="s"><v>123</v></c>  or  <c r="A2"/>
  const cellRe = /<c\b([^>]*)(?:>([\s\S]*?)<\/c>|\/>)/g;

  function flushRows(final = false) {
    while (true) {
      const start = buf.search(rowOpenRe);
      if (start < 0) {
        if (!final && buf.length > 4096) buf = buf.slice(-2048);
        return;
      }
      const endIdx = buf.indexOf("</row>", start);
      if (endIdx < 0) {
        if (start > 0) buf = buf.slice(start);
        return;
      }
      const rowXml = buf.slice(start, endIdx + "</row>".length);
      buf = buf.slice(endIdx + "</row>".length);

      let r = null;
      const rm = /<row\b([^>]*)>/.exec(rowXml);
      if (rm) {
        attrRe.lastIndex = 0;
        let am;
        while ((am = attrRe.exec(rm[1])) !== null) if (am[1] === "r") { r = parseInt(am[2], 10); break; }
      }
      const cells = [];
      let cm;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rowXml)) !== null) {
        const attrStr = cm[1] || "";
        const inner = cm[2] || "";
        const { col, value } = parseCell(attrStr, inner);
        if (col == null) cells.push(value);
        else {
          while (cells.length < col) cells.push("");
          cells.push(value);
        }
      }
      rowIdx = r != null ? r - 1 : rowIdx + 1;
      onRow(cells, rowIdx);
    }
  }

  for await (const chunk of stream) {
    buf += chunk.toString("utf-8");
    flushRows();
  }
  flushRows(true);
}

/**
 * Stream rows from sheet `sheet` of the XLSX at `xlsxPath`.
 *
 * Calls `onRow(rowObj, dataRowIdx)` for each row after the header row.
 * `rowObj` keys are taken from the header row.
 */
export async function readXlsxRows(xlsxPath, { sheet = 1, onRow } = {}) {
  if (typeof onRow !== "function") throw new Error("onRow callback required");
  const sst = await readSharedStrings(xlsxPath);
  let header = null;
  let dataRowIdx = -1;
  await streamSheet(xlsxPath, sheet, sst, (cells) => {
    if (header == null) {
      header = cells.map((c) => String(c ?? "").trim());
      return;
    }
    dataRowIdx++;
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = cells[i] == null ? "" : cells[i];
    }
    onRow(obj, dataRowIdx);
  });
  return { headers: header || [], rowCount: dataRowIdx + 1 };
}
