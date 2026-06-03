# A-4: Backfill personalization signal — runbook

**Status:** Procedure documented, awaiting full execution.

**Why:** The Jun 1 audit (H2) found 88% of the 11,209 companies have all-neutral scores in every category. As a result the quiz can't actually personalize — every brand gets the same letter no matter what the user picks. To make the quiz feel useful at launch we need at least the top 100 most-likely-searched brands to have real, filled-in scoring data.

**Sample I took on 2026-06-03:**
- Top-100 brands from `public/data/top-500-brands.txt`:
  - 41 / 100 have a `companies/<slug>.json` file at all
  - 17 / 100 have ANY real score
  - 24 / 100 have a file but every category is `neutral`/`unknown`
- The other 59 are sub-brands (Sprite, Mountain Dew, etc.) waiting on B-22 sub-brand→parent mapping

## Cost & time

| Batch | API cost | Wall time |
|---|---|---|
| 25 brands | ~$15 | ~30 min |
| 100 brands | ~$60 | ~2 hr |

Cost is mostly Claude Sonnet narrative bakes (~$0.50/brand). Free-API calls (FEC, OSHA, NLRB, EPA) are unlimited but rate-limited to ~1 req/sec each.

## Prerequisites

```bash
# In hybrid-pipeline/.env (already set on 2026-06-02):
ANTHROPIC_API_KEY=sk-ant-api03-...    # rotated 2026-06-02
FEC_API_KEY=GnIIVO...                  # still valid
POSTHOG_PERSONAL_API_KEY=phx_...       # rotated 2026-06-02
```

## Procedure

### 1. Identify target brands

```bash
cd /Users/aronrosenfield/Developer/trunorth
node -e '
const fs = require("fs");
const brands = fs.readFileSync("public/data/top-500-brands.txt","utf-8")
  .split("\n").filter(l => l.trim() && !l.startsWith("#"))
  .map(l => l.split("|").map(s => s.trim()))
  .filter(p => p.length >= 2);
const targets = [];
for (const [slug, name] of brands.slice(0, 200)) {
  const file = "public/data/companies/"+slug+".json";
  if (!fs.existsSync(file)) continue;
  const d = JSON.parse(fs.readFileSync(file, "utf-8"));
  const filled = Object.values(d.sc||{}).filter(v => v && !["neutral","unknown","na","n/a","?"].includes(String(v).toLowerCase().trim()));
  if (filled.length === 0) targets.push(name);
  if (targets.length >= 25) break;
}
fs.writeFileSync("/tmp/a4-targets.txt", targets.join("\n"));
console.log("Wrote", targets.length, "brands to /tmp/a4-targets.txt");
'
```

### 2. Run the pipeline per brand

```bash
cd /Users/aronrosenfield/Developer/hybrid-pipeline
source .env

# Sequential — pipeline.js doesn't safely parallelize the API rate limiters.
while IFS= read -r brand; do
  echo "=== $brand ==="
  node pipeline.js --company "$brand" 2>&1 | tail -5
done < /tmp/a4-targets.txt
```

Or for a quick proof-of-concept with just 3 brands:

```bash
for b in "Tide" "Charmin" "Crest"; do
  node pipeline.js --company "$b" --only ai
done
```

### 3. Merge source data into per-company files

```bash
cd /Users/aronrosenfield/Developer/hybrid-pipeline
node merge-enrichment.mjs
node export.js
```

### 4. Copy enriched files to trunorth

`export.js` writes to a configured output path. Inspect the script for the destination, then:

```bash
# Verify a sample brand actually got real scores
node -e '
const d = require("/Users/aronrosenfield/Developer/trunorth/public/data/companies/tide.json");
console.log(JSON.stringify(d.sc, null, 2));
'
```

### 5. Rebuild the split bundle

```bash
cd /Users/aronrosenfield/Developer/hybrid-pipeline
node build-split-bundle.mjs
```

### 6. Commit + ship

```bash
cd /Users/aronrosenfield/Developer/trunorth
git add public/data/companies/ public/data/companies-index.json
git commit -m "data(scoring): backfill top-25 personalization signal — A-4"
git push origin main
# Vercel auto-deploys
```

## Validation

After the backfill, re-run the diagnostic from step 1 — the count of "all-neutral" brands in the top 100 should drop from 24 to near zero.

## Open questions for the next run

- Does `pipeline.js` write directly to `trunorth/public/data/companies/` or to `hybrid-pipeline/output/`? Need to trace the export path.
- Is there a cheaper-tier rebake using Haiku instead of Sonnet for the personalization-signal pass only? Could cut cost ~10x for the narrative step.
- After the top-100 backfill, does the quiz actually feel different? PostHog event `quiz_personalization_score` should show variance increase.
