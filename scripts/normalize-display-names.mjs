#!/usr/bin/env node
/**
 * normalize-display-names.mjs — turn raw EDGAR shouting into human names (V-2).
 *
 * WHY: 1,744 brands are displayed exactly as the SEC filer wrote them —
 * "CLOROX CO", "J M SMUCKER", "ALGONQUIN POWER & UTILITIES", "KIMBERLY CLARK".
 * 732 of them are graded, so they surface in search results next to properly
 * cased consumer brands and make the catalog look like a database dump rather
 * than a product.
 *
 * SAFETY: acronyms must survive. IBM, 3M, AT&T, CVS, UPS, HP, KLA, PNC and the
 * corporate suffixes are preserved via an allowlist plus a short-token rule, and
 * anything already mixed-case is never touched. Only `name` changes — slugs,
 * grades, scores and every other field are left alone, so this cannot move a
 * grade. Search is unaffected because MiniSearch lowercases at index time.
 *
 * Usage:
 *   node scripts/normalize-display-names.mjs           # DRY RUN
 *   node scripts/normalize-display-names.mjs --apply
 */
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const COMPS = path.join(process.cwd(), "public/data/companies");

// Tokens that must stay uppercase when they appear inside a longer name.
const KEEP_UPPER = new Set([
  "IBM", "AT&T", "CVS", "UPS", "USA", "US", "UK", "EU", "HP", "GE", "3M", "BP",
  "KLA", "PNC", "AMD", "SAP", "TJX", "CBS", "NBC", "ABC", "ESPN", "HBO", "MGM",
  "BMW", "GM", "VF", "PPG", "DXC", "EOG", "APA", "CSX", "NRG", "DTE", "AES",
  "CME", "ICE", "MSCI", "S&P", "JPMORGAN", "USG", "AECOM", "NCR", "ADT", "ADP",
  "ING", "UBS", "BNP", "HSBC", "NYSE", "NASDAQ", "FTI", "EMCOR", "MDU", "ONEOK",
  "II", "III", "IV", "LLC", "LP", "LLP", "PLC", "NV", "SA", "AG", "AB", "ASA",
  "SE", "NA", "FSB", "REIT", "ETF", "TV", "AI", "IT", "HR", "PC", "RV", "ATV",
]);
// Corporate suffixes that read better title-cased.
const SUFFIX = { CO: "Co", INC: "Inc", CORP: "Corp", CORPORATION: "Corporation",
  LTD: "Ltd", HOLDINGS: "Holdings", GROUP: "Group", COMPANY: "Company",
  INTERNATIONAL: "International", INDUSTRIES: "Industries", SYSTEMS: "Systems",
  TECHNOLOGIES: "Technologies", PARTNERS: "Partners", BRANDS: "Brands" };
const LOWER_WORDS = new Set(["and", "of", "the", "for", "de", "la"]);

function titleCaseWord(w, i) {
  const bare = w.replace(/[^A-Za-z0-9&.'-]/g, "");
  if (!bare) return w;
  if (KEEP_UPPER.has(bare)) return w;
  if (SUFFIX[bare]) return w.replace(bare, SUFFIX[bare]);
  // A short all-letter token that isn't a known word is probably an initialism
  // ("J M SMUCKER", "H&R") — leave it.
  if (bare.length <= 2 && /^[A-Z]+$/.test(bare)) return w;
  // Ordinals read as words: 1ST -> 1st, 2ND -> 2nd.
  if (/^\d+(ST|ND|RD|TH)$/.test(bare)) return w.replace(bare, bare.toLowerCase());
  if (/\d/.test(bare) && /[A-Z]/.test(bare)) return w; // 3M, 7UP, A2Z
  const lower = bare.toLowerCase();
  if (i > 0 && LOWER_WORDS.has(lower)) return w.replace(bare, lower);
  // Handle internal punctuation: O'BRIEN -> O'Brien, WAL-MART -> Wal-Mart
  const cased = lower.replace(/(^|[\s'’\-./])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return w.replace(bare, cased);
}

function normalize(name) {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters.length <= 4) return name;                    // IBM, 3M, AT&T, KLA
  if (letters !== letters.toUpperCase()) return name;      // already mixed-case
  return name.split(/(\s+)/).map((tok, i) => (/^\s+$/.test(tok) ? tok : titleCaseWord(tok, i / 2))).join("");
}

const changes = [];
for (const f of fs.readdirSync(COMPS).filter((x) => x.endsWith(".json"))) {
  const p = path.join(COMPS, f);
  let d;
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { continue; }
  const before = String(d.name || "");
  if (!before) continue;
  const after = normalize(before);
  if (after === before) continue;
  changes.push({ before, after, graded: typeof d.overall === "number" });
  if (APPLY) { d.name = after; fs.writeFileSync(p, JSON.stringify(d, null, 2)); }
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"} — ${changes.length} display names normalized (${changes.filter((c) => c.graded).length} graded)\n`);
const step = Math.max(1, Math.floor(changes.length / 40));
changes.filter((_, i) => i % step === 0).slice(0, 40)
  .forEach((c) => console.log(`   ${c.before}\n     -> ${c.after}`));
if (!APPLY) console.log("\nRe-run with --apply, then re-run finalize-bundle.");
