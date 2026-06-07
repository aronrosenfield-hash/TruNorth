#!/usr/bin/env node
/**
 * Brazil "Lista Suja" — Ministry of Labor's official forced-labor employer
 * register ("Lista de Transparência sobre Trabalho Escravo").
 *
 * Brazil's Ministério do Trabalho e Emprego (MTE) publishes this list of
 * employers caught using slave-like labor conditions ("trabalho análogo ao
 * escravo"). It's the strongest public-records signal for forced-labor risk
 * in Brazilian supply chains (coffee, beef, soy, cotton, charcoal, mining).
 *
 * Updated semi-annually (typically April + October). Listed employers face
 * federal procurement restrictions and reputational consequences.
 *
 *   Landing page (gov.br):
 *     https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/
 *       areas-de-atuacao/combate-ao-trabalho-escravo-1/
 *       lista-de-transparencia-sobre-trabalho-escravo
 *   RADAR SIT search portal:
 *     https://sit.trabalho.gov.br/radar/
 *   NGO mirror (InPACTO):
 *     https://inpacto.org.br/lista-suja-do-trabalho-escravo/
 *
 * Fetch strategy:
 *   1. Try the gov.br landing page; scrape for the latest CSV/PDF link.
 *   2. If gov.br fails or no link is found, fall back to InPACTO's HTML
 *      mirror and parse the embedded table.
 *   3. Parse rows into structured records (employer name, CNPJ,
 *      municipality, state, addition date, infraction details).
 *   4. Write a snapshot to data/raw/brazil-lista-suja/<date>.json.
 *
 * Per-row record shape:
 *   {
 *     employerName, cnpj, municipality, state,
 *     addedDate, infractionDescription, workersFreed,
 *   }
 *
 * License: Public information under Brazil's Lei de Acesso à Informação
 * (LAI 12527/2011). Source: Ministério do Trabalho e Emprego.
 *
 * Flags:
 *   --apply        — perform the real network fetch and write the snapshot.
 *   --dry          — (default) read the most recent snapshot in data/raw/
 *                    if present, otherwise emit a synthetic 3-row preview.
 *   --out PATH     — write to PATH instead of the default snapshot path.
 *                    Useful for standalone test runs.
 *   --source URL   — force a specific source URL (inpacto | govbr).
 *
 * Locally:
 *   node scripts/brazil-lista-suja-fetch.mjs                   # dry
 *   node scripts/brazil-lista-suja-fetch.mjs --apply           # real fetch
 *   node scripts/brazil-lista-suja-fetch.mjs --apply --out /tmp/test.json
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RAW_DIR = path.join(ROOT, "data/raw/brazil-lista-suja");

const GOVBR_LANDING =
  "https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/inspecao-do-trabalho/areas-de-atuacao/combate-ao-trabalho-escravo-1/lista-de-transparencia-sobre-trabalho-escravo";
const INPACTO_LANDING =
  "https://inpacto.org.br/lista-suja-do-trabalho-escravo/";
const RADAR_PORTAL = "https://sit.trabalho.gov.br/radar/";

const UA =
  "TruNorth-BrazilListaSuja/1.0 (+https://www.trunorthapp.com; contact@trunorthapp.com)";
const REQUEST_TIMEOUT_MS = 30_000;
const LICENSE_TAG =
  "Lei de Acesso à Informação (Brazil LAI 12527/2011), Ministério do Trabalho e Emprego";

// ─────────────────────────── CLI parsing ────────────────────────────
const argv = process.argv.slice(2);
function flagArg(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const APPLY = argv.includes("--apply");
const DRY = !APPLY;
const OUT_PATH = flagArg("--out");
const SOURCE_FORCE = flagArg("--source"); // "govbr" | "inpacto"

// ─────────────────────────── normalization ──────────────────────────

/**
 * Strip Portuguese accents/diacritics, lowercase, collapse whitespace,
 * and drop common corporate suffixes. Used both for employer-name
 * matching and for de-duping rows that appear in two different
 * source-list snapshots with cosmetic differences.
 */
export function normalizePtName(s) {
  if (s == null) return "";
  let out = String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  out = out.toLowerCase();
  // Strip Brazilian / Portuguese corporate suffixes.
  out = out
    .replace(/\b(s\.?\s*a\.?|ltda\.?|me\.?|epp\.?|eireli\.?|cia\.?|s\/a)\b/g, " ")
    .replace(/\b(comercio|industria|comercial|industrial|agropecuaria|fazenda)\b/g, " ")
    .replace(/[.,'’"`/&()-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

/**
 * Normalize a CNPJ (Brazilian corporate tax id) to a digit-only string.
 * The official format is XX.XXX.XXX/XXXX-XX (14 digits).
 */
export function normalizeCnpj(s) {
  if (s == null) return "";
  const digits = String(s).replace(/\D+/g, "");
  return digits.length === 14 ? digits : "";
}

/**
 * Format a YYYY-MM-DD date from a Brazilian DD/MM/YYYY string, or
 * pass through an already-ISO string. Returns "" if unparseable.
 */
export function normalizeDate(s) {
  if (!s) return "";
  const str = String(s).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

// ─────────────────────────── HTML helpers ───────────────────────────

/**
 * Strip HTML tags + decode the handful of entities that show up in the
 * gov.br and InPACTO renders. We deliberately stay dependency-free here.
 */
export function stripHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ")
    .replace(/&ccedil;/g, "ç")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract every <table>...</table> block from an HTML document.
 * (We avoid a full DOM parser; the two upstreams use straightforward
 * server-rendered tables.)
 */
export function extractTables(html) {
  const out = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[0]);
  return out;
}

/**
 * Parse one table into an array of arrays of cell text (header included).
 */
export function parseTableRows(tableHtml) {
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let r;
  while ((r = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[hd][\s\S]*?<\/t[hd]>/gi;
    let c;
    while ((c = cellRe.exec(r[0])) !== null) cells.push(stripHtml(c[0]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

// ─────────────────────────── CSV parser ─────────────────────────────

/**
 * Minimal RFC-4180-ish CSV parser. The MTE CSV uses semicolons as field
 * separators (PT-BR convention) — we autodetect ; vs , by sniffing the
 * header line.
 */
export function parseCsv(text) {
  if (!text) return [];
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length >
    (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false; continue;
      }
      field += ch; continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === sep) { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => stripHtml(h).toLowerCase());
  return rows.slice(1)
    .filter((r) => r.some((c) => (c || "").trim() !== ""))
    .map((r) => {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = (r[i] || "").trim();
      return obj;
    });
}

// ─────────────────────────── row-shape mapper ───────────────────────

/**
 * Map a parsed source row (CSV row OR table row keyed by inferred header)
 * to our canonical record shape. Looks for a handful of likely PT-BR
 * column names. Returns null when no employer name can be found.
 */
export function shapeRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
      // Case-insensitive / accent-insensitive fallback
      const knorm = normalizePtName(k);
      for (const rk of Object.keys(row)) {
        if (normalizePtName(rk) === knorm && row[rk] != null && String(row[rk]).trim() !== "") {
          return String(row[rk]).trim();
        }
      }
    }
    return "";
  };

  const employerName = get(
    "empregador", "nome", "razao social", "razão social",
    "nome do empregador", "empresa",
  );
  if (!employerName) return null;

  const cnpj = normalizeCnpj(
    get("cnpj", "cnpj/cpf", "cnpj cpf", "cnpj_cpf", "cpf cnpj"),
  );

  const municipality = get(
    "municipio", "município", "cidade", "localidade", "local",
  );
  const state = get("uf", "estado");

  const addedDate = normalizeDate(
    get("data de inclusao", "data de inclusão", "data inclusao", "data_inclusao",
        "data de publicacao", "data publicação", "data", "inclusao"),
  );

  const infractionDescription = get(
    "atividade economica", "atividade econômica", "atividade",
    "infracao", "infração", "tipo de infracao", "observacoes", "observações",
    "fundamento", "decisao", "decisão",
  );

  const workersFreedRaw = get(
    "trabalhadores envolvidos", "trabalhadores", "trabalhadores resgatados",
    "qtd trabalhadores", "n trabalhadores",
  );
  const workersFreed = workersFreedRaw ? Number(workersFreedRaw.replace(/\D+/g, "")) || null : null;

  return {
    employerName,
    cnpj,
    municipality,
    state,
    addedDate,
    infractionDescription,
    workersFreed,
  };
}

// ─────────────────────────── source: gov.br ─────────────────────────

/**
 * Fetch the gov.br landing page and pick the best CSV / PDF / XLSX link.
 * The MTE rotates the URL each release; we look for hrefs that contain
 * "lista" and end in .csv / .pdf / .xlsx / .xls.
 */
async function discoverGovbrAsset() {
  const res = await fetchWithTimeout(GOVBR_LANDING);
  if (!res.ok) throw new Error(`gov.br landing HTTP ${res.status}`);
  const html = await res.text();
  // Match the first relevant download link.
  const linkRe = /href=["']([^"']+)["'][^>]*>([^<]{0,120})/gi;
  const candidates = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const label = stripHtml(m[2] || "").toLowerCase();
    const hl = href.toLowerCase();
    if (!/\.(csv|xlsx?|pdf)(\?|$)/.test(hl)) continue;
    if (!/lista|transparencia|trabalho|escravo/i.test(href + " " + label)) continue;
    candidates.push({ href: absoluteUrl(href, GOVBR_LANDING), label });
  }
  // Prefer CSV > XLSX > PDF.
  candidates.sort((a, b) => priority(a.href) - priority(b.href));
  function priority(u) {
    if (/\.csv(\?|$)/i.test(u)) return 0;
    if (/\.xlsx?(\?|$)/i.test(u)) return 1;
    return 2;
  }
  return candidates[0] || null;
}

function absoluteUrl(href, base) {
  try { return new URL(href, base).toString(); }
  catch { return href; }
}

async function fetchGovbr() {
  const asset = await discoverGovbrAsset();
  if (!asset) throw new Error("gov.br: no CSV/PDF link found on landing page");
  const ext = asset.href.toLowerCase().match(/\.(csv|xlsx?|pdf)(\?|$)/)?.[1] || "";
  const res = await fetchWithTimeout(asset.href);
  if (!res.ok) throw new Error(`gov.br asset HTTP ${res.status}`);
  if (ext === "csv") {
    const text = await res.text();
    const rows = parseCsv(text).map(shapeRow).filter(Boolean);
    return { rows, sourceUrl: asset.href, sourceKind: "govbr-csv" };
  }
  if (ext === "pdf" || ext === "xls" || ext === "xlsx") {
    // PDF / Excel — out of scope for v1 (no pdf-parse / xlsx in deps).
    throw new Error(`gov.br asset is ${ext.toUpperCase()} (parser not implemented in v1) — falling back to InPACTO`);
  }
  throw new Error(`gov.br asset has unknown extension: ${ext}`);
}

// ─────────────────────────── source: InPACTO ────────────────────────

/**
 * InPACTO publishes the list as an HTML table on a single page. We extract
 * the largest table and map its rows. As a side-benefit, InPACTO usually
 * includes the official source-PDF link at the top of the page.
 */
async function fetchInpacto() {
  const res = await fetchWithTimeout(INPACTO_LANDING);
  if (!res.ok) throw new Error(`InPACTO landing HTTP ${res.status}`);
  const html = await res.text();
  const tables = extractTables(html);
  if (!tables.length) throw new Error("InPACTO: no <table> found");
  // Prefer the largest table by row count — that's the list itself.
  let best = null;
  let bestRows = 0;
  for (const t of tables) {
    const rs = parseTableRows(t);
    if (rs.length > bestRows) { best = rs; bestRows = rs.length; }
  }
  if (!best || best.length < 2) throw new Error("InPACTO: largest table has no data rows");
  // Promote header row to keys.
  const header = best[0].map((h) => stripHtml(h).toLowerCase());
  const rows = best.slice(1).map((r) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = r[i] ?? "";
    return obj;
  });
  const shaped = rows.map(shapeRow).filter(Boolean);
  return { rows: shaped, sourceUrl: INPACTO_LANDING, sourceKind: "inpacto-html" };
}

// ─────────────────────────── network helper ─────────────────────────
async function fetchWithTimeout(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,text/csv,application/pdf,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
  } finally { clearTimeout(t); }
}

// ─────────────────────────── dedupe + emit ──────────────────────────

export function dedupeRows(rows) {
  const seen = new Map();
  for (const r of rows) {
    const key = r.cnpj
      ? `cnpj:${r.cnpj}`
      : `name:${normalizePtName(r.employerName)}|loc:${normalizePtName(r.municipality)}-${(r.state || "").toLowerCase()}`;
    const prior = seen.get(key);
    if (!prior) { seen.set(key, r); continue; }
    // Prefer the row with more populated fields.
    const score = (x) => Object.values(x).filter((v) => v != null && v !== "").length;
    if (score(r) > score(prior)) seen.set(key, r);
  }
  return [...seen.values()];
}

// ─────────────────────────── synthetic preview ──────────────────────
// 3-row preview used by --dry when no cached snapshot is on disk. Names
// here are fictitious and clearly tagged — they exist only so the merger
// can be exercised end-to-end without network traffic.
export const SYNTH_ROWS = [
  {
    employerName: "[SYNTHETIC] Fazenda Boa Vista Ltda",
    cnpj: "",
    municipality: "Açailândia",
    state: "MA",
    addedDate: "2025-10-15",
    infractionDescription: "Pecuária bovina — trabalhadores em alojamento degradante",
    workersFreed: 24,
  },
  {
    employerName: "[SYNTHETIC] Cafeeira Serra do Cipó S.A.",
    cnpj: "",
    municipality: "Patrocínio",
    state: "MG",
    addedDate: "2025-10-15",
    infractionDescription: "Cultivo de café — jornada exaustiva, retenção de documentos",
    workersFreed: 18,
  },
  {
    employerName: "[SYNTHETIC] JBS Carnes Frigorífico Sul Ltda",
    cnpj: "",
    municipality: "Cuiabá",
    state: "MT",
    addedDate: "2025-04-04",
    infractionDescription: "Abate de bovinos — condições análogas à escravidão",
    workersFreed: 41,
  },
];

// ─────────────────────────── runner ─────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function latestSnapshot() {
  if (!existsSync(RAW_DIR)) return null;
  const files = (await fs.readdir(RAW_DIR)).filter((f) => f.endsWith(".json")).sort();
  return files.length ? path.join(RAW_DIR, files[files.length - 1]) : null;
}

async function realFetch() {
  // gov.br first, InPACTO as fallback (the user can also force a source).
  const errors = [];
  const order = SOURCE_FORCE === "inpacto" ? ["inpacto"]
    : SOURCE_FORCE === "govbr"   ? ["govbr"]
    : ["govbr", "inpacto"];
  for (const src of order) {
    try {
      if (src === "govbr") return await fetchGovbr();
      if (src === "inpacto") return await fetchInpacto();
    } catch (err) {
      errors.push(`${src}: ${err.message}`);
    }
  }
  throw new Error(`all sources failed — ${errors.join(" | ")}`);
}

async function main() {
  console.log(
    `brazil-lista-suja fetcher starting... (mode=${DRY ? "DRY (no network)" : "APPLY (real fetch)"})`,
  );

  let snapshot;
  let sourceUrl;
  let sourceKind;

  if (DRY) {
    const latest = await latestSnapshot();
    if (latest) {
      console.log(`Reading cached snapshot: ${path.relative(ROOT, latest)}`);
      const cached = JSON.parse(await fs.readFile(latest, "utf-8"));
      snapshot = cached;
    } else {
      console.log("No cached snapshot — emitting synthetic 3-row preview.");
      snapshot = {
        _synthetic: true,
        _license: LICENSE_TAG,
        sourceUrl: GOVBR_LANDING,
        sourceKind: "synthetic",
        fetchedAt: new Date().toISOString(),
        rowCount: SYNTH_ROWS.length,
        rows: SYNTH_ROWS,
      };
    }
  } else {
    const { rows, sourceUrl: u, sourceKind: k } = await realFetch();
    const deduped = dedupeRows(rows);
    sourceUrl = u;
    sourceKind = k;
    snapshot = {
      _license: LICENSE_TAG,
      sourceUrl,
      sourceKind,
      radarPortal: RADAR_PORTAL,
      fetchedAt: new Date().toISOString(),
      rowCount: deduped.length,
      rows: deduped,
    };
  }

  const outPath = OUT_PATH
    ? path.resolve(OUT_PATH)
    : path.join(RAW_DIR, `${todayIso()}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2));

  console.log(`Wrote ${path.relative(ROOT, outPath)} (${snapshot.rowCount} employers).`);
  if (DRY) {
    console.log(
      "(DRY — no network traffic. Re-run with --apply to fetch the real list.)",
    );
  } else {
    console.log(`  Source: ${sourceKind} → ${sourceUrl}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error("brazil-lista-suja-fetch failed:", err);
    process.exit(1);
  });
}
