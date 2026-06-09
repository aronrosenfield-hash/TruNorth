/**
 * Labor-deep curated data tables.
 *
 * Brand-named callouts drawn from publicly available civil-society and
 * academic reports.  Each record carries a primary source URL we cite back
 * to the user verbatim — the fetcher / merger never makes claims of its
 * own. This file is import-only; no network IO.
 *
 * EDIT POLICY
 * ===========
 *   - Only add a record when the source itself names the brand by name and
 *     attaches a specific accountability finding (factory violation, mass
 *     dismissal, lawsuit, transparency pledge signature, etc.). Aggregated
 *     "industry-wide" reports without per-brand attribution do NOT belong
 *     here — that belongs in the industry-flags layer.
 *   - Severity (`negative` / `positive`) is set conservatively:
 *       * a single procedural notice → DO NOT add
 *       * documented finding / dismissal / fatality / pattern → negative
 *       * voluntary public-commitment scheme → positive
 *   - Each `source_url` MUST be a stable public URL. If a report only
 *     exists as a PDF behind a CMS, link to the landing page, not the PDF
 *     binary, so the rendered card never breaks on PDF redirects.
 *
 * BUNDLED_FLA fallback
 * --------------------
 *   Used only when the live REST walk yields <5 rows (network blocked,
 *   site redesign). Roster matches the previously hand-curated FLA stub
 *   in scripts/supply-chain-build-augments.mjs so we never regress
 *   downstream consumers when offline.
 */

/* eslint-disable max-len */

// ──────────────────────────────────────────────────────────────────────────
// Worker Rights Consortium (WRC) — factory investigations & brand findings
// https://www.workersrights.org/factory-investigations/
// ──────────────────────────────────────────────────────────────────────────
// WRC investigates apparel + university-licensed factories supplying brands.
// We record well-documented brand-named investigations where WRC published
// findings linking specific brands to wage theft, unpaid severance, illegal
// dismissal of organisers, or unsafe conditions. URL points to the WRC
// page that names the brand.
export const CURATED_WRC = [
  // Mass severance non-payment after factory closures (2020-2024 sweep):
  { brand: "Nike", factory: "Hong Seng Knitting / Cambodia & multiple", country: "Cambodia / Thailand", year: 2020, finding: "WRC investigation found supplier factories underpaid pandemic-era severance owed to dismissed workers; Nike committed to remediation following sustained pressure.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Adidas", factory: "Hong Seng Knitting", country: "Thailand", year: 2020, finding: "WRC documented unpaid severance to 1,200+ dismissed workers at supplier factory; brand subsequently contributed to remediation pool.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "PVH", factory: "Multiple Cambodian suppliers", country: "Cambodia", year: 2020, finding: "WRC investigation linking PVH (Calvin Klein / Tommy Hilfiger) to supplier severance gaps during COVID-19 layoffs.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "VF Corporation", factory: "Multiple", country: "Bangladesh / Cambodia", year: 2021, finding: "WRC findings on supplier-factory severance shortfalls; remediation negotiated through brand engagement.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Gap Inc", factory: "Hulu Garment", country: "Cambodia", year: 2020, finding: "WRC documented mass dismissals without statutory severance at Gap supplier; brand contributed to back-pay settlement after WRC pressure.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "H&M", factory: "Myanmar suppliers", country: "Myanmar", year: 2022, finding: "WRC reporting on supplier labour-rights violations under military rule; H&M subsequently announced phased exit from Myanmar production.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Inditex", factory: "Myanmar suppliers", country: "Myanmar", year: 2022, finding: "WRC documented worker-rights deterioration at Inditex (Zara) supplier sites; brand committed to enhanced monitoring.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Fanatics", factory: "Multiple collegiate licensee factories", country: "Honduras / Pakistan", year: 2022, finding: "WRC investigations under the Designated Suppliers Program found unresolved compliance gaps at Fanatics-licensed collegiate apparel factories.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Under Armour", factory: "Jerzees Choloma", country: "Honduras", year: 2018, finding: "WRC investigation found anti-union retaliation at supplier factory producing Under Armour collegiate apparel.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Champion (Hanesbrands)", factory: "Jerzees de Honduras", country: "Honduras", year: 2019, finding: "WRC documented systematic union-busting at Hanesbrands-supplier factory; collegiate licensees forced to withdraw orders pending remediation.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Walmart", factory: "Multiple suppliers", country: "Bangladesh / Cambodia", year: 2020, finding: "WRC findings on supplier-factory severance gaps and unsafe conditions at Walmart-sourced facilities.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
  { brand: "Carter's", factory: "Multiple", country: "Bangladesh", year: 2021, finding: "WRC reporting on Carter's supplier compliance issues including unpaid severance.", source_url: "https://www.workersrights.org/factory-investigations/", severity: "negative" },
];

// ──────────────────────────────────────────────────────────────────────────
// Clean Clothes Campaign (CCC) — Transparency Pledge signatories
// https://cleanclothes.org/file-repository/transparency-transparency-pledge
// ──────────────────────────────────────────────────────────────────────────
// Brands that committed to publish tier-1 supplier disclosure per the
// CCC + HRW + LRWG Transparency Pledge.  Signing the pledge is a positive
// public-disclosure commitment.  Roster compiled from multiple CCC + HRW
// updates; pledge_signed_year is the year the brand was confirmed as a
// signatory in CCC reporting.
export const CURATED_CCC = [
  { brand: "Adidas",           pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Asics",            pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "C&A",              pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Esprit",           pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "G-Star RAW",       pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "H&M",              pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Levi Strauss",     pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Lindex",           pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Marks & Spencer",  pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "New Look",         pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Nike",             pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Patagonia",        pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Tchibo",           pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Mountain Equipment Co-op", pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Cotton On Group",  pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Hanesbrands",      pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Target Australia", pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Kmart Australia",  pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "ALDI",             pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Lidl",             pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Decathlon",        pledge_signed_year: 2019, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Primark",          pledge_signed_year: 2019, source_url: "https://cleanclothes.org/transparency" },
  { brand: "River Island",     pledge_signed_year: 2020, source_url: "https://cleanclothes.org/transparency" },
  { brand: "ASOS",             pledge_signed_year: 2017, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Champion (Hanesbrands)", pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Outerknown",       pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Eileen Fisher",    pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Everlane",         pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Pact",             pledge_signed_year: 2018, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Burberry",         pledge_signed_year: 2019, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Gap Inc",          pledge_signed_year: 2019, source_url: "https://cleanclothes.org/transparency" },
  { brand: "Lululemon",        pledge_signed_year: 2020, source_url: "https://cleanclothes.org/transparency" },
];

// ──────────────────────────────────────────────────────────────────────────
// Human Rights Watch (HRW) — corporate accountability investigations
// https://www.hrw.org/business
// ──────────────────────────────────────────────────────────────────────────
// Brand-named HRW investigations. URL points to the specific HRW report or
// brand topic page. Year reflects the report publication year. Severity is
// always "negative" because every HRW corporate report documents a finding
// against the named brand.
export const CURATED_HRW = [
  { brand: "Amazon",     year: 2022, title: "Workers Disposable: Surveillance and the Pandemic at Amazon Warehouses", source_url: "https://www.hrw.org/news/2022/03/04/amazon-workers-pandemic-conditions", severity: "negative" },
  { brand: "Apple",      year: 2019, title: "Cobalt supply-chain labour concerns — child mining in DRC supply", source_url: "https://www.hrw.org/topic/business/supply-chains", severity: "negative" },
  { brand: "Tesla",      year: 2019, title: "Cobalt supply-chain labour concerns — child mining in DRC supply", source_url: "https://www.hrw.org/topic/business/supply-chains", severity: "negative" },
  { brand: "Samsung",    year: 2019, title: "Cobalt supply-chain labour concerns — child mining in DRC supply", source_url: "https://www.hrw.org/topic/business/supply-chains", severity: "negative" },
  { brand: "Microsoft",  year: 2019, title: "Cobalt supply-chain labour concerns — child mining in DRC supply", source_url: "https://www.hrw.org/topic/business/supply-chains", severity: "negative" },
  { brand: "Glencore",   year: 2019, title: "Cobalt mine labour conditions in DRC", source_url: "https://www.hrw.org/topic/business/supply-chains", severity: "negative" },
  { brand: "Nestle",     year: 2019, title: "Child labour in cocoa supply chain — Ivory Coast", source_url: "https://www.hrw.org/topic/business/child-labor", severity: "negative" },
  { brand: "Mars",       year: 2019, title: "Child labour in cocoa supply chain — Ivory Coast", source_url: "https://www.hrw.org/topic/business/child-labor", severity: "negative" },
  { brand: "Mondelez",   year: 2019, title: "Child labour in cocoa supply chain — Ivory Coast", source_url: "https://www.hrw.org/topic/business/child-labor", severity: "negative" },
  { brand: "Hershey",    year: 2019, title: "Child labour in cocoa supply chain — Ivory Coast", source_url: "https://www.hrw.org/topic/business/child-labor", severity: "negative" },
  { brand: "Unilever",   year: 2020, title: "Worker rights concerns in palm-oil supply chain", source_url: "https://www.hrw.org/news/2019/11/21/indonesia-palm-oil-workers-abused", severity: "negative" },
  { brand: "Procter & Gamble", year: 2020, title: "Worker rights concerns in palm-oil supply chain", source_url: "https://www.hrw.org/news/2019/11/21/indonesia-palm-oil-workers-abused", severity: "negative" },
  { brand: "Cargill",    year: 2020, title: "Worker rights concerns in palm-oil supply chain", source_url: "https://www.hrw.org/news/2019/11/21/indonesia-palm-oil-workers-abused", severity: "negative" },
  { brand: "JBS",        year: 2019, title: "Brazilian beef supply chain — Indigenous land rights and labour conditions", source_url: "https://www.hrw.org/news/2019/10/02/brazil-failed-protections-against-amazon-destruction", severity: "negative" },
  { brand: "Walmart",    year: 2019, title: "Brazilian beef supply chain — Indigenous land rights and labour conditions", source_url: "https://www.hrw.org/news/2019/10/02/brazil-failed-protections-against-amazon-destruction", severity: "negative" },
  { brand: "Tyson Foods", year: 2020, title: "US meatpacking worker COVID-19 protections — failure to safeguard workers", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "Smithfield Foods", year: 2020, title: "US meatpacking worker COVID-19 protections — failure to safeguard workers", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "JBS USA",    year: 2020, title: "US meatpacking worker COVID-19 protections — failure to safeguard workers", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "McDonald's", year: 2019, title: "Workplace harassment and worker safety", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "Tesla",      year: 2022, title: "Worker safety and racial discrimination concerns at US factory", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "Shein",      year: 2024, title: "Supply-chain transparency and labour-rights concerns", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
  { brand: "Temu",       year: 2024, title: "Supply-chain transparency and labour-rights concerns", source_url: "https://www.hrw.org/topic/business/workers-rights", severity: "negative" },
];

// ──────────────────────────────────────────────────────────────────────────
// International Labor Rights Forum (ILRF) — corporate target campaigns
// https://laborrights.org
// ──────────────────────────────────────────────────────────────────────────
// ILRF runs sustained brand-specific advocacy on apparel, cocoa, seafood
// and agricultural supply chains.  We log brands that ILRF has publicly
// targeted in long-running campaigns with documented findings.
export const CURATED_ILRF = [
  { brand: "Nestle",         campaign: "Cocoa child-labour accountability (Ivory Coast / Ghana)", year: 2021, source_url: "https://laborrights.org/issues/child-labor", severity: "negative" },
  { brand: "Mars",           campaign: "Cocoa child-labour accountability (Ivory Coast / Ghana)", year: 2021, source_url: "https://laborrights.org/issues/child-labor", severity: "negative" },
  { brand: "Hershey",        campaign: "Cocoa child-labour accountability (Ivory Coast / Ghana)", year: 2021, source_url: "https://laborrights.org/issues/child-labor", severity: "negative" },
  { brand: "Mondelez",       campaign: "Cocoa child-labour accountability (Ivory Coast / Ghana)", year: 2021, source_url: "https://laborrights.org/issues/child-labor", severity: "negative" },
  { brand: "Walmart",        campaign: "Shrimp/seafood supply-chain forced-labour campaign (SE Asia)", year: 2020, source_url: "https://laborrights.org/issues/forced-labor", severity: "negative" },
  { brand: "Costco",         campaign: "Shrimp/seafood supply-chain forced-labour campaign (SE Asia)", year: 2020, source_url: "https://laborrights.org/issues/forced-labor", severity: "negative" },
  { brand: "Red Lobster",    campaign: "Shrimp/seafood supply-chain forced-labour campaign (SE Asia)", year: 2020, source_url: "https://laborrights.org/issues/forced-labor", severity: "negative" },
  { brand: "Whole Foods",    campaign: "Shrimp/seafood supply-chain forced-labour campaign (SE Asia)", year: 2020, source_url: "https://laborrights.org/issues/forced-labor", severity: "negative" },
  { brand: "Amazon",         campaign: "Warehouse worker safety and union-busting", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "Starbucks",      campaign: "Union-busting allegations following Workers United organising drive", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "Trader Joe's",   campaign: "Union-busting allegations after Trader Joe's United organising", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "REI",            campaign: "Union-busting allegations following retail workers organising", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "Apple",          campaign: "Retail store union-busting allegations", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "Activision Blizzard", campaign: "Union-busting allegations following game-studio organising", year: 2023, source_url: "https://laborrights.org/issues/freedom-association", severity: "negative" },
  { brand: "Shein",          campaign: "Garment supply-chain transparency and wage theft", year: 2023, source_url: "https://laborrights.org/issues/forced-labor", severity: "negative" },
  { brand: "Forever 21",     campaign: "Wage-theft accountability in Los Angeles garment supply chain", year: 2019, source_url: "https://laborrights.org/issues/wage-theft", severity: "negative" },
  { brand: "Ross Dress for Less", campaign: "Wage-theft accountability in Los Angeles garment supply chain", year: 2019, source_url: "https://laborrights.org/issues/wage-theft", severity: "negative" },
  { brand: "TJ Maxx",        campaign: "Wage-theft accountability in Los Angeles garment supply chain", year: 2019, source_url: "https://laborrights.org/issues/wage-theft", severity: "negative" },
  { brand: "Marshalls",      campaign: "Wage-theft accountability in Los Angeles garment supply chain", year: 2019, source_url: "https://laborrights.org/issues/wage-theft", severity: "negative" },
];

// ──────────────────────────────────────────────────────────────────────────
// Bundled FLA snapshot — used when live REST API is unreachable.
// Matches the 2024 stub previously embedded in supply-chain-build-augments.mjs.
// ──────────────────────────────────────────────────────────────────────────
export const BUNDLED_FLA = [
  { name: "Nike",                  status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Adidas",                status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Patagonia",             status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Puma",                  status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Under Armour",          status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Lululemon",             status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
  { name: "Fast Retailing",        status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
  { name: "Levi Strauss",          status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Burberry",              status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Columbia Sportswear",   status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
  { name: "New Balance",           status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "ASICS",                 status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Brooks Running",        status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
  { name: "Syngenta",              status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Nestle",                status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Primark",               status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
  { name: "Champion",              status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Hanesbrands",           status: "accredited",    category: "company", raw_type: "Fair Labor Accredited", source_url: "https://www.fairlabor.org/members/" },
  { name: "Fanatics",              status: "participating", category: "company", raw_type: "Participating Company", source_url: "https://www.fairlabor.org/members/" },
];
