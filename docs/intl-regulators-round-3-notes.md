# International regulators — round 3 (DW: intl-regulator-enforcement)

Shipped in this PR (canonical fetch + merge + test + writer; fixture-based offline reproducibility):

| Source         | Country    | Fixture rows | Brands matched | Writer category |
| -------------- | ---------- | ------------ | -------------- | --------------- |
| `uk-cma`       | UK         | 12           | 7              | political       |
| `uk-fca`       | UK         | 10           | 8              | execPay         |
| `uk-hse`       | UK         | 12           | 7              | labor           |
| `asic`         | Australia  | 13           | 4              | execPay (+ environment for greenwashing) |
| `jftc`         | Japan      | 13           | 5              | political       |
| `cci-india`    | India      | 11           | 4              | political       |
| `cccs`         | Singapore  | 10           | 3              | political       |
| `nz-comcom`    | NZ         | 10           | 1              | political       |

**Already covered (do NOT duplicate):**
- `accc` (Australian Competition & Consumer Commission) — already on main
- `canada-competition-bureau` — already on main
- `uk-ico` — already on main
- `eu-antitrust` — already on main (EU Commission)
- Yale CELI Russia — already on main

## Parked / blocked sources

Each of these was researched. They aren't viable for inclusion in this round
without significantly more entity-resolution work or a paid API. Reasons:

- **South Korea KFTC** — public press-release archive exists
  (https://www.ftc.go.kr/eng/), but the English mirror is incomplete and
  respondent names appear primarily in Korean. Adding it cleanly requires a
  hangul → romaja transliteration table plus a KFTC-decision → chaebol
  parent-resolution layer that we don't have yet. A static seed
  (`data/derived/kftc-korea-augment.json`, 5 brands) already shipped on
  main; this round didn't add a fetcher.

- **Brazil CADE** — administrative decisions are published on
  https://www.gov.br/cade/pt-br but the case names are Portuguese
  ("ato de concentração") and there's no English mirror. A static seed
  (`data/derived/cade-brazil-augment.json`, 3 brands) already shipped on
  main; full fetcher would need a Portuguese-NER pass to extract corporate
  respondents from procedural metadata.

- **South Africa Competition Commission** — site at
  https://www.compcom.co.za/ publishes monthly newsletters but no
  structured per-decision feed. Static seed already on main; a fetcher
  would need PDF-text extraction.

- **Norway Forbrukerrådet / Datatilsynet** — partially covered by the
  `gdpr-enforcement` augment (already on main, EU-wide). A Norway-only
  fetcher would mostly duplicate existing EU GDPR coverage.

- **OECD anti-bribery** — already shipped as a static seed on main.
  OECD publishes the anti-bribery monitoring reports as PDFs only; a
  fetcher would need OCR.

- **Germany BaFin** — partially covered by `gdpr-enforcement`. Securities
  enforcement is in German-only press releases; defer until we add a
  German-NER pass.

- **Mexico COFECE** — single static-seeded entry on main covers the only
  TruNorth-catalog brand with an active case (Cinépolis); the rest of
  COFECE's docket is domestic-only.

## Architecture decisions

- All 8 new fetchers follow the `canada-competition-bureau-fetch.mjs`
  template: `--apply / --dry / --url / --limit / --out` flags, raw output
  to `data/raw/<source>/YYYY-MM-DD.json`, fixture-based offline fallback
  under `scripts/fixtures/<source>/sample.csv`.

- Mergers use a shared slug-resolution helper
  (`scripts/lib/intl-regulator-resolve.mjs`) that mirrors
  `ca-prop65-merge`'s `resolveSlug`:
  `direct → raw → slug-aliases → brand-parent-map → seed → first-token`
  with a `INTL_FIRST_TOKEN_BLOCKLIST` to prevent generic-token false
  positives ("Standard Chartered" → "standard" Retail brand).

- `INTL_SEED_ALIASES` in the helper hardcodes 40 well-known regulator
  respondent → canonical TruNorth slug mappings. This keeps the slug
  aliases file uncluttered and the resolution logic self-documenting
  for the intl-regulator subsystem.

- Writers wired in `apply-augments-to-companies.mjs` (8 new entries at
  the end of `WRITERS`). All follow the conservative-severity rule:
  single small action → `mixed`; ≥A$10M / ≥£10M / ≥¥1B / equivalent or
  multiple actions → `poor`. Greenwashing actions add an extra
  `environment` writer pass.

- All augments carry `source` + `source_url` per the hard rule. No
  fabrication; every fixture row links to the regulator's own press
  release / decision page.

## Reproducibility

```bash
# Re-fetch and rebuild all 8 augments from fixtures:
for s in uk-cma uk-fca uk-hse asic jftc cci-india cccs nz-comcom; do
  node scripts/$s-fetch.mjs
  node scripts/$s-merge.mjs
done

# Apply to per-company narratives:
node scripts/apply-augments-to-companies.mjs

# Run tests:
node --test scripts/uk-cma-fetch.test.mjs scripts/uk-fca-fetch.test.mjs \
            scripts/uk-hse-fetch.test.mjs scripts/asic-fetch.test.mjs \
            scripts/jftc-fetch.test.mjs scripts/cci-india-fetch.test.mjs \
            scripts/cccs-fetch.test.mjs scripts/nz-comcom-fetch.test.mjs
```
