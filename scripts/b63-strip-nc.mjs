#!/usr/bin/env node
// B-63 surgical NC-license strip. DRY-RUN by default; --apply to write.
// Removes ONLY the NC-source content from per-company files, leaving legitimate
// data intact. Re-apply (after the augment files are git-rm'd) then re-populates
// environment/labor from legit sources where they exist.
import fs from "node:fs";
import path from "node:path";
const APPLY = process.argv.includes("--apply");
const DIR = "/Users/aronrosenfield/Developer/trunorth/public/data/companies";
const NO_REC = "No public record found.";

// NC narrative signatures (direct OR "Via parent company X: <sig>")
const ENV_SIG = /Banking on Climate Chaos|UMass PERI ranks|InfluenceMap LobbyMap|Net-zero pledge|Net Zero Tracker/;
const LABOR_SIG = /Fashion Revolution/;
const FTM_SUFFIX = / \[FollowTheMoney\.org adds state-level totals\.\]/g;
const NC_SOURCES = new Set(["net-zero-tracker","banking-on-climate-chaos","toxic-100","influence-map","followthemoney-state","fashion-revolution"]);

const stat = { env: 0, labor: 0, political: 0, files: 0 };
const samples = [];

function cleanSources(arr, drop) {
  if (!Array.isArray(arr)) return arr;
  return arr.filter(s => !drop.has(s));
}

for (const f of fs.readdirSync(DIR)) {
  if (!f.endsWith(".json")) continue;
  const fp = path.join(DIR, f);
  let d; try { d = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  let changed = false;
  const before = {};

  // ENVIRONMENT — NC narrative is the winner → reset so re-apply re-derives
  if (d.environment && typeof d.environment.s === "string" && ENV_SIG.test(d.environment.s)) {
    before.env = d.environment.s.slice(0, 70);
    d.environment.s = NO_REC;
    if (d.environment.sources) d.environment.sources = cleanSources(d.environment.sources, NC_SOURCES);
    if (d.sc && d.sc.environment) delete d.sc.environment;
    if (d.csc && typeof d.csc.environment === "number") delete d.csc.environment;
    stat.env++; changed = true;
  }
  // LABOR — Fashion Revolution narrative → reset so re-apply re-derives
  if (d.labor && typeof d.labor.s === "string" && LABOR_SIG.test(d.labor.s)) {
    before.labor = d.labor.s.slice(0, 70);
    d.labor.s = NO_REC;
    if (d.labor.sources) d.labor.sources = cleanSources(d.labor.sources, NC_SOURCES);
    if (d.sc && d.sc.labor) delete d.sc.labor;
    if (d.csc && typeof d.csc.labor === "number") delete d.csc.labor;
    stat.labor++; changed = true;
  }
  // POLITICAL — FollowTheMoney is a mergeCrossCite suffix → strip suffix only
  if (d.political && typeof d.political.s === "string" && FTM_SUFFIX.test(d.political.s)) {
    before.pol = "(strip FTM suffix)";
    d.political.s = d.political.s.replace(FTM_SUFFIX, "");
    if (d.political.sources) d.political.sources = cleanSources(d.political.sources, NC_SOURCES);
    stat.political++; changed = true;
  }

  if (changed) {
    stat.files++;
    if (samples.length < 10) samples.push({ slug: f.replace(".json", ""), ...before });
    if (APPLY) fs.writeFileSync(fp, JSON.stringify(d, null, 2));
  }
}

console.log(`[b63-strip] ${APPLY ? "APPLIED" : "DRY-RUN"} — ${stat.files} files touched`);
console.log(`  environment reset: ${stat.env} · labor reset: ${stat.labor} · political suffix stripped: ${stat.political}`);
console.log("  samples:");
for (const s of samples) console.log("   ", s.slug, JSON.stringify({ env: s.env, labor: s.labor, pol: s.pol }));
