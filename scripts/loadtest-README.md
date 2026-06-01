# TruNorth load testing

Can the site handle **1,000 concurrent users**? This setup answers that with [k6](https://k6.io), an open-source load tester from Grafana Labs.

The test simulates a realistic user journey at scale:

1. Hit the landing page (`/`)
2. Fetch the companies manifest (`/data/index.json`, ~2.5MB gzipped)
3. Open 3 individual company JSON files
4. Render a values share-card via the edge function (`/api/og/values`)

Per-request jitter and a ramp-up period keep the load realistic — not a thundering herd.

---

## Running locally

You need k6 installed (it's a single Go binary, not an npm package):

```bash
brew install k6                              # macOS
# or: https://k6.io/docs/get-started/installation/
```

Then:

```bash
# Default: hits production at https://trunorthapp.com
k6 run scripts/loadtest.js

# Point at staging or a Vercel preview
k6 run -e BASE_URL=https://trunorth-git-foo.vercel.app scripts/loadtest.js
```

Don't want to install k6? Run it via Docker:

```bash
docker run --rm -i \
  -e BASE_URL=https://trunorthapp.com \
  grafana/k6 run - <scripts/loadtest.js
```

---

## Running via GitHub Actions

Load tests are **manual-trigger only** — they burn Vercel bandwidth and can trip third-party rate limits, so we never run them on push.

1. Go to the **Actions** tab in the repo:
   `https://github.com/<owner>/<repo>/actions/workflows/loadtest.yml`
2. Click **Run workflow** (top-right).
3. Optionally override `target_url` (defaults to production).
4. Wait ~5 minutes for the run to finish. Results appear:
   - As a summary table in the run page (rendered into the job summary)
   - As a downloadable `k6-loadtest-results` artifact containing `run.log`, `summary.json`, and full `raw.json` event stream

---

## Reading the results

k6 prints a summary at the end. The numbers that matter:

| Metric | What it means | Pass criteria |
|---|---|---|
| `vus_max` | Peak concurrent virtual users reached | Should hit 1000 |
| `http_reqs` | Total HTTP requests sent | Sanity check — should be tens of thousands |
| `http_req_duration` | Per-request latency. **p(95)** is the one to watch. | **p(95) < 1500ms** |
| `http_req_failed` | Fraction of requests that errored (non-2xx/3xx) | **< 1%** |
| `journey_errors` | Custom metric — fraction of user journeys with *any* failed step | **< 1%** |
| `iteration_duration` | How long one full user journey takes end-to-end | Informational |

The script enforces these as **thresholds** — if any fail, k6 exits non-zero and the GitHub Action goes red.

### Per-endpoint breakdown

We tag each request (`index_html`, `companies_bundle`, `company_json`, `og_values`), so the k6 output shows latency per endpoint. The OG endpoint will be slowest (it's a real serverless function rendering a PNG); the rest hit Vercel's CDN and should be sub-100ms once warm.

---

## What to do if thresholds fail

**If `http_req_duration p(95)` blows past 1500ms:**

- Check the per-endpoint breakdown. If it's `og_values`, the edge function is the bottleneck — consider caching at the CDN layer (already cacheable via querystring) or pre-warming.
- If it's `companies_bundle`, the CDN is cold for that region. Vercel will warm up; re-run.
- If everything is slow, you're probably saturating *your own* outbound bandwidth (the GitHub Actions runner has limits). Try splitting across multiple runners or running from a beefier box.

**If `http_req_failed` > 1%:**

- Check the failure mix in the log. 429s mean rate limiting; 5xx means the origin is unhappy.
- Vercel's edge will rate-limit aggressive traffic from a single IP (the runner). This is *not* a real-world failure mode — production traffic comes from thousands of IPs.

**If `journey_errors` > 1% but `http_req_failed` is fine:**

- Some assertion failed (e.g., wrong content type on the OG endpoint). Check the run log.

---

## Vercel bandwidth — read this before running

The Vercel **Hobby (free)** plan caps at **100GB/month** of bandwidth. One full run of this test will consume roughly:

- Landing HTML: ~30KB × ~30k requests = ~900MB
- Companies bundle: ~2.5MB × ~30k requests = ~75GB (!) if CDN-missed every time
- Company JSON: ~5KB × ~90k requests = ~450MB
- OG images: ~150KB × ~30k requests = ~4.5GB

**Worst case: ~80GB.** In practice the CDN caches aggressively and the bundle gets served from edge memory after the first hit per region, so realistic usage is **10–20GB per run**. Still — don't run this casually on free-tier production. Recommendations:

- Run against a **preview deployment** when possible.
- If running against prod, do it **once** to establish a baseline, not on every PR.
- Upgrade to Vercel **Pro** ($20/mo, 1TB bandwidth) if you want to run this regularly.

The serverless `/api/og/values` function also counts against your **Edge Function execution** quota (Hobby: 500k invocations/month). One run = ~30k invocations, so you have headroom but not unlimited.

PostHog (free tier 1M events/mo) is **not** hit by this test — k6 doesn't execute JS, so client-side analytics never fire. Same for OpenFoodFacts (only triggered by barcode scans).

---

## Tweaking the test

Open `scripts/loadtest.js` and edit the `options.stages` block to change the load profile:

```js
stages: [
  { duration: "60s",  target: 1000 },  // ramp up
  { duration: "180s", target: 1000 },  // hold
  { duration: "60s",  target: 0 },     // ramp down
],
```

To smoke-test at low load before the full run:

```bash
k6 run --vus 10 --duration 30s scripts/loadtest.js
```

(Flags override `options.stages`.)
