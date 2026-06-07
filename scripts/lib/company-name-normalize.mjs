/**
 * Company-name normalization helper shared across data-source mergers.
 *
 * The goal is to take a raw, source-supplied legal/trade name (e.g.
 * "The Boeing Company", "Walmart, Inc.", "JPMorgan Chase & Co.") and
 * collapse it to a slug-style key that matches the TruNorth company
 * file convention under /public/data/companies/<slug>.json.
 *
 * This is intentionally simple and conservative — when in doubt, the
 * merger should leave the record as an orphan rather than over-match
 * a parent company that doesn't actually own the brand. Mergers that
 * need stricter routing should also consult /public/data/_meta/
 * slug-aliases.json and brand-parent-map.json.
 *
 * Exported:
 *   - normalizeCompanyName(name) -> string  (lowercase, suffix-stripped)
 *   - toSlug(name) -> string                (kebab-case, ascii-safe)
 */

// Common legal-entity suffixes to strip. Order matters: longer ones first
// so e.g. "Co., Ltd." is removed before "Co." would partially match.
const SUFFIX_PATTERNS = [
  /\b(public limited company|pte\.? ltd\.?|co\.,?\s*ltd\.?|s\.a\.r\.l\.?|s\.a\.s\.?)\b/gi,
  /\b(limited liability company|llc|l\.l\.c\.|llp|l\.l\.p\.)\b/gi,
  /\b(holdings?|group|corp\.?|corporation|incorporated|inc\.?|company|co\.?)\b/gi,
  /\b(ltd\.?|limited|gmbh|s\.a\.|s\.p\.a\.|n\.v\.|b\.v\.|p\.l\.c\.|plc|ag|sa|spa|nv|bv|kk|kg)\b/gi,
  /\b(the)\b/gi,
];

export function normalizeCompanyName(name) {
  if (!name || typeof name !== "string") return "";
  let s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")     // strip diacritics
    .replace(/[&]/g, " and ")
    .replace(/[''`]/g, "'")
    .replace(/[.,;:()\[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const pat of SUFFIX_PATTERNS) {
    s = s.replace(pat, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

export function toSlug(name) {
  const norm = normalizeCompanyName(name);
  return norm
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Tiny streaming-friendly CSV parser. Handles double-quoted cells,
 * embedded commas, embedded newlines, and "" escape inside quotes.
 *
 * Returns rows as arrays of strings. An empty trailing row is dropped.
 * Used by the DW-* fetchers that read fixture CSVs without pulling in
 * a heavy dependency.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cell += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { row.push(cell); cell = ""; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === '\r') { /* skip */ }
      else { cell += c; }
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (rows.length && !rows[rows.length - 1].some(x => x.length)) rows.pop();
  return rows;
}

/**
 * Parse CSV text into an array of objects keyed by the first row's
 * (trimmed) headers. Missing cells in a row become empty strings so
 * consumers never see undefined.
 */
export function parseCSVToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows.shift().map(h => h.trim());
  return rows.map(r => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
    return obj;
  });
}
