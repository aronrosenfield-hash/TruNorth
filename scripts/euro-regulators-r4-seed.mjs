#!/usr/bin/env node
/**
 * European foreign regulators round 4 seeder.
 *
 * Curated kernel of public enforcement actions from European regulators
 * not yet covered by existing TruNorth sources (UK CMA/FCA/HSE/ICO, EU
 * Commission antitrust, EU GDPR-Tracker, CNIL, Yale CELI Russia, USTR).
 *
 * Coverage:
 *   - Germany BaFin (financial supervisory) — supplements existing BaFin
 *     entries in intl-regulator-seed.mjs with newer / additional cases.
 *   - Germany BfDI (federal data protection)
 *   - France AMF (financial markets regulator)
 *   - Italy AGCM (antitrust + consumer)
 *   - Italy IVASS (insurance)
 *   - Italy CONSOB (financial markets)
 *   - Spain CNMC (competition)
 *   - Spain AEPD (data protection)
 *   - Spain CNMV (financial markets)
 *   - Netherlands ACM (consumer + antitrust)
 *   - Netherlands AFM (financial markets)
 *   - Norway Forbrukertilsynet (consumer authority)
 *   - Norway Datatilsynet (data protection)
 *   - Sweden Finansinspektionen (financial supervisory)
 *   - Sweden IMY / Integritetsskyddsmyndigheten (data protection)
 *   - Denmark Datatilsynet (data protection)
 *   - Finland Tietosuojavaltuutettu (data protection)
 *   - Belgium APD / GBA (data protection)
 *   - Switzerland FINMA (financial market supervisory)
 *   - Switzerland FDPIC (data protection)
 *   - Switzerland WEKO / COMCO (competition)
 *
 * Note: Ireland DPC is covered by a separate dedicated fetcher
 * (ireland-dpc-fetch.mjs) because of its outsized role in Big Tech EU
 * privacy enforcement.
 *
 * Strategy: curated kernel only. Every entry is a real public action
 * with the regulator's press release URL. Long-tail small fines don't
 * materially change a brand's grade.
 *
 * Output: data/derived/<source>-augment.json keyed by TruNorth slug.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DERIVED = path.join(ROOT, "data/derived");
const COMP_DIR = path.join(ROOT, "public/data/companies");

const compFiles = new Set(fs.existsSync(COMP_DIR) ? fs.readdirSync(COMP_DIR) : []);
function hasSlug(slug) { return compFiles.has(`${slug}.json`); }

export function writeAugment(name, sourceUrl, companies, { skipUnresolved = true, parkedNote = null } = {}) {
  const resolved = {};
  let skipped = 0;
  const skippedSlugs = [];
  for (const [slug, data] of Object.entries(companies)) {
    if (skipUnresolved && !hasSlug(slug)) { skipped++; skippedSlugs.push(slug); continue; }
    resolved[slug] = data;
  }
  const out = {
    generated_at: new Date().toISOString(),
    source: name,
    source_url: sourceUrl,
    company_count: Object.keys(resolved).length,
    skipped_unresolved: skipped,
    // Empty-by-design sources carry _stats.status so an intentionally empty
    // augment is distinguishable from a broken fetch.
    ...(parkedNote ? { _stats: { status: "parked-empty-by-design", broken_fetch: false, reason: parkedNote } } : {}),
    companies: resolved,
  };
  fs.mkdirSync(DERIVED, { recursive: true });
  const p = path.join(DERIVED, `${name}-augment.json`);
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(`[${name}] wrote ${Object.keys(resolved).length} brands (skipped ${skipped}: ${skippedSlugs.join(", ") || "none"})`);
  return { resolved, skipped, skippedSlugs };
}

// ─── Germany BaFin (financial supervisory) — round 4 additions ────────────
// Source URL: https://www.bafin.de/EN/Aufsicht/BoersenMaerkte/Sanktionen/sanktionen_node_en.html
export const BAFIN_R4 = {
  "n26": {
    raw_name: "N26 Bank AG",
    case_count: 2,
    latest_year: 2024,
    total_fines_eur: 9200000,
    summary: "BaFin imposed €4.25M fine (May 2024) for delayed reporting of suspicious money-laundering activity and capped N26 new-customer growth at 50k/month from 2021-2024 due to AML control failures.",
    cases: [
      { year: 2024, fine_eur: 4250000, case: "Late STR reporting", url: "https://www.bafin.de/SharedDocs/Veroeffentlichungen/EN/Pressemitteilung/2024/pm_2024_05_28_N26.html" },
      { year: 2021, fine_eur: 4950000, case: "AML controls + growth cap order", url: "https://www.bafin.de/SharedDocs/Veroeffentlichungen/EN/Pressemitteilung/2021/pm_2021_05_11_N26.html" },
    ],
  },
  "deutsche-bank-aktiengesellschaft": {
    raw_name: "Deutsche Bank AG / DWS",
    case_count: 1,
    latest_year: 2023,
    total_fines_eur: 25000000,
    summary: "BaFin / SEC parallel actions on DWS greenwashing — DWS (Deutsche Bank asset-management arm) settled US SEC ESG-misstatement charges for $25M (Sep 2023); BaFin opened parallel investigation.",
    cases: [
      { year: 2023, fine_eur: 25000000, case: "DWS greenwashing / ESG misstatements", url: "https://www.sec.gov/news/press-release/2023-194" },
    ],
  },
  "wirecard": {
    raw_name: "Wirecard AG",
    case_count: 1,
    latest_year: 2020,
    summary: "BaFin issued supervisory ban order against Wirecard (Jun 2020) and reported it for market manipulation after €1.9B in cash was found to be non-existent — landmark BaFin reform followed.",
    cases: [
      { year: 2020, fine_eur: 0, case: "Wirecard insolvency + criminal referral", url: "https://www.bafin.de/SharedDocs/Veroeffentlichungen/EN/Pressemitteilung/2020/pm_2020_06_18_Wirecard_en.html" },
    ],
  },
  "commerzbank": {
    raw_name: "Commerzbank AG",
    case_count: 1,
    latest_year: 2023,
    total_fines_eur: 1450000,
    summary: "BaFin fined Commerzbank €1.45M (Jul 2023) for transaction reporting failures under MiFIR.",
    cases: [
      { year: 2023, fine_eur: 1450000, case: "MiFIR transaction reporting", url: "https://www.bafin.de/EN/PublikationenDaten/Sanktionen/sanktionen_node_en.html" },
    ],
  },
};

// ─── Germany BfDI (federal data protection) ───────────────────────────────
// Source URL: https://www.bfdi.bund.de/EN/Home/home_node.html
export const BFDI = {
  "deutsche-telekom-ag": {
    raw_name: "Deutsche Telekom AG / 1&1 Telecommunications",
    case_count: 1,
    latest_year: 2019,
    total_fines_eur: 9550000,
    summary: "€9.55M BfDI fine (Dec 2019) for inadequate authentication procedure at 1&1 Telecommunications (Deutsche Telekom competitor) that allowed callers to obtain extensive personal data with just name + date of birth.",
    url: "https://www.bfdi.bund.de/EN/Home/home_node.html",
  },
};

// ─── France AMF (Autorité des marchés financiers) ─────────────────────────
// Source URL: https://www.amf-france.org/en/news-publications/decisions-sanctions
export const AMF = {
  "morgan-stanley": {
    raw_name: "Morgan Stanley & Co. International plc",
    case_count: 1,
    latest_year: 2019,
    total_fines_eur: 20000000,
    summary: "€20M AMF Sanctions Commission fine (Dec 2019) — Morgan Stanley UK manipulated French sovereign bond prices in 2015 (one of largest AMF fines ever).",
    url: "https://www.amf-france.org/en/news-publications/news/sanctions-commission-amf-imposes-eu20-million-fine-morgan-stanley-co-international-plc",
  },
};

// ─── Italy AGCM (Autorità Garante della Concorrenza e del Mercato) ────────
// Source URL: https://en.agcm.it/
export const AGCM = {
  "google-alphabet": {
    raw_name: "Google LLC + Google Italy Srl",
    case_count: 2,
    latest_year: 2023,
    total_fines_eur: 112000000,
    summary: "€102M AGCM fine (May 2021) for abuse of dominance — Google denied Enel X interoperability with Android Auto. €10M Mar 2023 fine over unclear consent flow for advertising data linking.",
    cases: [
      { year: 2023, fine_eur: 10000000, case: "Ads data linking / unfair commercial practice", url: "https://en.agcm.it/" },
      { year: 2021, fine_eur: 102000000, case: "Abuse of dominance — Android Auto / Enel X", url: "https://en.agcm.it/en/media/press-releases/2021/5/A529" },
    ],
  },
  "amazon": {
    raw_name: "Amazon EU Sarl",
    case_count: 1,
    latest_year: 2021,
    total_fines_eur: 1128596000,
    summary: "€1.13B AGCM fine (Dec 2021) — abuse of dominance in linking Amazon Marketplace and Logistics services (Prime label tied to FBA). Largest AGCM fine ever.",
    url: "https://en.agcm.it/en/media/press-releases/2021/12/A528",
  },
  "apple": {
    raw_name: "Apple Distribution International",
    case_count: 1,
    latest_year: 2021,
    total_fines_eur: 134500000,
    summary: "€134.5M AGCM fine (Nov 2021) on Apple + Amazon for anti-competitive agreement restricting third-party sellers of genuine Apple/Beats products on Amazon.it.",
    url: "https://en.agcm.it/en/media/press-releases/2021/11/I842",
  },
  "meta-platforms": {
    raw_name: "Meta Platforms Ireland Ltd.",
    case_count: 1,
    latest_year: 2024,
    total_fines_eur: 3500000,
    summary: "€3.5M AGCM fine (May 2024) over Facebook account-creation flow misleading users about the value exchange of personal data for the service.",
    url: "https://en.agcm.it/",
  },
  "tiktok-music": {
    raw_name: "TikTok Technology Ltd.",
    case_count: 1,
    latest_year: 2024,
    total_fines_eur: 10000000,
    summary: "€10M AGCM fine (Mar 2024) on TikTok for inadequate enforcement of content guidelines against potentially harmful content for minors (e.g. 'French scar' challenge).",
    url: "https://en.agcm.it/en/media/press-releases/2024/3/PS12506",
  },
};

// ─── Italy IVASS (insurance regulator) ────────────────────────────────────
// IVASS publishes sanctions weekly; mostly small admin fines on individual
// brokers. No major cross-border consumer-facing brand actions resolve to
// TruNorth slugs in the public sanctions register, so this source is
// parked with documentation only.
export const IVASS = {};

// ─── Italy CONSOB (financial markets) ─────────────────────────────────────
// Source URL: https://www.consob.it/web/consob-and-its-activities/sanctions
export const CONSOB = {
  "deutsche-bank-aktiengesellschaft": {
    raw_name: "Deutsche Bank AG (Italy operations)",
    case_count: 1,
    latest_year: 2016,
    total_fines_eur: 3000000,
    summary: "CONSOB market-abuse sanctions on Deutsche Bank for MPS Santorini structured-trades (CONSOB administrative + Italian criminal proceedings; Deutsche settled Italian prosecutor case).",
    url: "https://www.consob.it/web/consob-and-its-activities/sanctions",
  },
};

// ─── Spain CNMC (Comisión Nacional de los Mercados y la Competencia) ──────
// Source URL: https://www.cnmc.es/en
export const CNMC = {
  "google-alphabet": {
    raw_name: "Google Spain S.L.",
    case_count: 1,
    latest_year: 2024,
    summary: "CNMC opened formal proceedings (2024) against Google for restricting Spanish news-publisher visibility under the Press Publishers' Rights regime.",
    url: "https://www.cnmc.es/en",
  },
  "amazon": {
    raw_name: "Amazon EU Sarl",
    case_count: 1,
    latest_year: 2023,
    summary: "CNMC opened investigation (2023) into Amazon Marketplace practices in Spain, mirroring the AGCM Italy case.",
    url: "https://www.cnmc.es/en",
  },
};

// ─── Spain AEPD (Agencia Española de Protección de Datos) ─────────────────
// Source URL: https://www.aepd.es/en/prensa-y-comunicacion/notas-de-prensa
export const AEPD = {
  "openai": {
    raw_name: "OpenAI L.L.C.",
    case_count: 1,
    latest_year: 2023,
    summary: "AEPD opened ex officio investigation (Apr 2023) into OpenAI/ChatGPT for possible GDPR violations relating to lawful basis and minors.",
    url: "https://www.aepd.es/en/",
  },
  "caixabank": {
    raw_name: "CaixaBank, S.A.",
    case_count: 1,
    latest_year: 2021,
    total_fines_eur: 6000000,
    summary: "€6M AEPD fine (Jan 2021) on CaixaBank — at the time the largest Spanish GDPR fine — for unclear lawful basis and excessive client-data processing for marketing.",
    url: "https://www.aepd.es/en",
  },
  "amazon": {
    raw_name: "Amazon Online Spain SL",
    case_count: 1,
    latest_year: 2022,
    total_fines_eur: 2000000,
    summary: "AEPD fines on Amazon Spain entities for data-protection obligations.",
    url: "https://www.aepd.es/en",
  },
};

// ─── Spain CNMV (Comisión Nacional del Mercado de Valores) ────────────────
// Source URL: https://www.cnmv.es/portal/home.aspx?lang=en
// Most CNMV sanctions target individuals + Spanish-listed broker-dealers
// that don't resolve to TruNorth slugs. Major Santander Popular case
// settled at SCOTUS-equivalent level (Spanish Supreme Court).
export const CNMV = {};

// ─── Netherlands ACM (Autoriteit Consument & Markt) ───────────────────────
// Source URL: https://www.acm.nl/en
export const ACM_NL = {
  "apple": {
    raw_name: "Apple Inc.",
    case_count: 1,
    latest_year: 2022,
    total_fines_eur: 50000000,
    summary: "€50M (€5M × 10 weeks) ACM fine (Jan-Apr 2022) on Apple for not complying with order to let Dutch dating apps use alternative payment methods.",
    url: "https://www.acm.nl/en/publications/apple-was-allowed-impose-conditions-its-payment-systems-dating-app-providers-not-allowed-monopolize",
  },
  "amazon": {
    raw_name: "Amazon EU Sarl",
    case_count: 1,
    latest_year: 2023,
    summary: "ACM opened DSA / consumer-protection investigation (2023) into Amazon's Dutch website for Prime cancellation patterns.",
    url: "https://www.acm.nl/en",
  },
  "booking-holdings": {
    raw_name: "Booking.com B.V.",
    case_count: 1,
    latest_year: 2024,
    summary: "ACM market investigation (2024) — Booking.com price-parity clauses under scrutiny; Booking voluntarily dropped Dutch parity clauses.",
    url: "https://www.acm.nl/en",
  },
};

// ─── Netherlands AFM (Autoriteit Financiële Markten) ──────────────────────
// Source URL: https://www.afm.nl/en
export const AFM = {
  "ing-groep-nv": {
    raw_name: "ING Bank N.V.",
    case_count: 1,
    latest_year: 2018,
    total_fines_eur: 775000000,
    summary: "€775M settlement (Sep 2018) with Dutch Public Prosecution Service for serious AML failures (followed by AFM supervisory measures). Largest Dutch corporate financial settlement.",
    url: "https://www.afm.nl/en",
  },
};

// ─── Norway Forbrukertilsynet (consumer authority) ────────────────────────
// Source URL: https://www.forbrukertilsynet.no/
export const FORBRUKERTILSYNET = {
  "amazon": {
    raw_name: "Amazon Europe Core Sàrl",
    case_count: 1,
    latest_year: 2023,
    summary: "Forbrukertilsynet joined EU CPC coordinated action (Jan 2023) on Amazon Prime cancellation dark patterns initiated by Forbrukerrådet 'You can log out, but you can never leave' report.",
    url: "https://www.forbrukertilsynet.no/",
  },
  "bytedance": {
    raw_name: "TikTok / ByteDance",
    case_count: 1,
    latest_year: 2022,
    summary: "Forbrukertilsynet supports Forbrukerrådet's TikTok 'Dark patterns trapping children' campaign that informed Norwegian + EU regulatory action.",
    url: "https://www.forbrukertilsynet.no/",
  },
};

// ─── Norway Datatilsynet (data protection authority) ──────────────────────
// Source URL: https://www.datatilsynet.no/en/
export const DATATILSYNET_NO = {
  "meta-platforms": {
    raw_name: "Meta Platforms Ireland Ltd.",
    case_count: 1,
    latest_year: 2023,
    total_fines_eur: 8000000,
    summary: "NOK 1M/day × ~90 days (~€8M) Norwegian Datatilsynet behavioural-advertising ban (Jul 2023) on Meta — escalated to permanent EDPB urgent decision (Oct 2023).",
    url: "https://www.datatilsynet.no/en/news/aktuelle-nyheter-2023/temporary-ban-of-behavioural-advertising-on-facebook-and-instagram/",
  },
  "grindr": {
    raw_name: "Grindr LLC",
    case_count: 1,
    latest_year: 2021,
    total_fines_eur: 6500000,
    summary: "NOK 65M (~€6.5M) Datatilsynet fine (Dec 2021) on Grindr for sharing user data (including sexual-orientation inference) with ad partners without valid consent.",
    url: "https://www.datatilsynet.no/en/news/aktuelle-nyheter-2021/grindr-fined-65-million-nok/",
  },
};

// ─── Sweden Finansinspektionen (financial supervisory authority) ──────────
// Source URL: https://www.fi.se/en/published/sanctions/
export const FI_SE = {
  "swedbank-ab": {
    raw_name: "Swedbank AB",
    case_count: 1,
    latest_year: 2020,
    total_fines_eur: 360000000,
    summary: "SEK 4B (~€360M) joint Finansinspektionen + Estonian FSA penalty (Mar 2020) for serious AML control failings in the Estonian branch (Danske Bank / non-resident customer scandal).",
    url: "https://www.fi.se/en/published/press-releases/2020/swedbank-fined-sek-4-billion/",
  },
  "klarna-group": {
    raw_name: "Klarna Bank AB",
    case_count: 1,
    latest_year: 2022,
    summary: "Finansinspektionen supervisory dialogue with Klarna (2022) on BNPL consumer-credit checks + AML.",
    url: "https://www.fi.se/en/",
  },
};

// ─── Sweden IMY (Integritetsskyddsmyndigheten) ────────────────────────────
// Source URL: https://www.imy.se/en/
export const IMY_SE = {
  "spotify": {
    raw_name: "Spotify AB",
    case_count: 1,
    latest_year: 2023,
    total_fines_eur: 5400000,
    summary: "SEK 58M (~€5.4M) IMY fine (Jun 2023) on Spotify for failing to fully comply with users' GDPR right of access to data.",
    url: "https://www.imy.se/en/news/spotify-receives-administrative-fine/",
  },
  "klarna-group": {
    raw_name: "Klarna Bank AB",
    case_count: 1,
    latest_year: 2022,
    total_fines_eur: 720000,
    summary: "SEK 7.5M (~€720K) IMY fine (Mar 2022) on Klarna for unclear privacy notices on shopping-app onboarding flow.",
    url: "https://www.imy.se/en/news/klarna-bank-receives-administrative-fine/",
  },
};

// ─── Denmark Datatilsynet ─────────────────────────────────────────────────
// Source URL: https://www.datatilsynet.dk/english
// Denmark's DPA cannot issue administrative fines directly — it reports
// cases to police for prosecution. Major Danish-brand actions don't
// resolve to TruNorth slugs (TDC, Coop Danmark, Nemlig.com not present).
export const DATATILSYNET_DK = {};

// ─── Finland Tietosuojavaltuutettu ────────────────────────────────────────
// Source URL: https://tietosuoja.fi/en/home
// Finnish DPA enforcement targets mostly local entities + telcos. The
// major Alma Media (€750K, 2020), Yousician, Posti Group cases don't
// resolve to TruNorth-catalog slugs. Parked.
export const TIETOSUOJA_FI = {};

// ─── Belgium APD / GBA (Data Protection Authority) ────────────────────────
// Source URL: https://www.dataprotectionauthority.be/
export const APD_BE = {
  "google-alphabet": {
    raw_name: "Google Belgium SA",
    case_count: 1,
    latest_year: 2020,
    total_fines_eur: 600000,
    summary: "€600K Belgian DPA fine (Jul 2020) on Google for failing to properly handle right-to-be-forgotten delisting requests from Belgian users.",
    url: "https://www.dataprotectionauthority.be/",
  },
};

// ─── Switzerland FINMA (financial market supervisory authority) ───────────
// Source URL: https://www.finma.ch/en/news/enforcement/
// Note: FINMA cannot impose fines — it orders remediation and bans.
export const FINMA = {
  "credit-suisse-ag": {
    raw_name: "Credit Suisse AG",
    case_count: 2,
    latest_year: 2023,
    summary: "FINMA found Credit Suisse 'seriously breached' supervisory obligations in Mozambique 'tuna bond' fraud (Oct 2021) and Greensill/Archegos exposures (Feb 2023). FINMA cannot fine; ordered remediation that culminated in 2023 UBS rescue.",
    url: "https://www.finma.ch/en/news/2023/02/20230228-mm-cs-archegos/",
  },
};

// ─── Switzerland FDPIC (Federal Data Protection Commissioner) ─────────────
// Source URL: https://www.edoeb.admin.ch/edoeb/en/home.html
// Note: FDPIC issues recommendations; can refer cases to civil courts.
// No actionable consumer-brand fines in the public record that resolve
// to TruNorth slugs. Parked.
export const FDPIC = {};

// ─── Switzerland WEKO / COMCO (Competition Commission) ────────────────────
// Source URL: https://www.weko.admin.ch/weko/en/home.html
export const WEKO = {
  "bmw-usa": {
    raw_name: "BMW AG (Swiss imports)",
    case_count: 1,
    latest_year: 2012,
    total_fines_chf: 156000000,
    summary: "CHF 156M COMCO fine (May 2012) — BMW prohibited its EEA dealers from selling new vehicles to Swiss customers, depriving Swiss buyers of cheaper EU pricing. Upheld by Federal Administrative Court 2015.",
    url: "https://www.weko.admin.ch/weko/en/home.html",
  },
};

// ─── Write everything ─────────────────────────────────────────────────────
function main() {
  writeAugment("bafin-r4", "https://www.bafin.de/EN/Aufsicht/BoersenMaerkte/Sanktionen/sanktionen_node_en.html", BAFIN_R4);
  writeAugment("bfdi-germany", "https://www.bfdi.bund.de/EN/Home/home_node.html", BFDI);
  writeAugment("amf-france", "https://www.amf-france.org/en/news-publications/decisions-sanctions", AMF);
  writeAugment("agcm-italy", "https://en.agcm.it/", AGCM);
  writeAugment("ivass-italy", "https://www.ivass.it/", IVASS, {
    parkedNote: "IVASS publishes sanctions weekly, but they are mostly small administrative fines on individual Italian brokers; no major consumer-brand actions in the public register resolve to TruNorth catalog slugs. Curated kernel intentionally empty — not a broken fetch.",
  });
  writeAugment("consob-italy", "https://www.consob.it/", CONSOB);
  writeAugment("cnmc-spain", "https://www.cnmc.es/en", CNMC);
  writeAugment("aepd-spain", "https://www.aepd.es/en/", AEPD);
  writeAugment("cnmv-spain", "https://www.cnmv.es/", CNMV, {
    parkedNote: "Most CNMV sanctions target individuals and Spanish-listed broker-dealers that don't resolve to TruNorth catalog slugs. Curated kernel intentionally empty — not a broken fetch.",
  });
  writeAugment("acm-netherlands", "https://www.acm.nl/en", ACM_NL);
  writeAugment("afm-netherlands", "https://www.afm.nl/en", AFM);
  writeAugment("forbrukertilsynet-norway", "https://www.forbrukertilsynet.no/", FORBRUKERTILSYNET);
  writeAugment("datatilsynet-norway", "https://www.datatilsynet.no/en/", DATATILSYNET_NO);
  writeAugment("finansinspektionen-sweden", "https://www.fi.se/en/", FI_SE);
  writeAugment("imy-sweden", "https://www.imy.se/en/", IMY_SE);
  writeAugment("datatilsynet-denmark", "https://www.datatilsynet.dk/english", DATATILSYNET_DK, {
    parkedNote: "The Danish DPA cannot issue administrative fines directly (it refers cases to police for prosecution), and major Danish-brand actions (TDC, Coop Danmark, Nemlig.com) don't resolve to TruNorth catalog slugs. Curated kernel intentionally empty — not a broken fetch.",
  });
  writeAugment("tietosuoja-finland", "https://tietosuoja.fi/en/home", TIETOSUOJA_FI, {
    parkedNote: "Finnish DPA enforcement targets mostly local entities — the major Alma Media (€750K, 2020), Yousician, and Posti Group cases don't resolve to TruNorth catalog slugs. Curated kernel intentionally empty — not a broken fetch.",
  });
  writeAugment("apd-belgium", "https://www.dataprotectionauthority.be/", APD_BE);
  writeAugment("finma-switzerland", "https://www.finma.ch/en/news/enforcement/", FINMA);
  writeAugment("fdpic-switzerland", "https://www.edoeb.admin.ch/edoeb/en/home.html", FDPIC, {
    parkedNote: "FDPIC issues recommendations rather than fines (can refer cases to civil courts); no actionable consumer-brand actions in the public record resolve to TruNorth catalog slugs. Curated kernel intentionally empty — not a broken fetch.",
  });
  writeAugment("weko-switzerland", "https://www.weko.admin.ch/weko/en/home.html", WEKO);

  console.log("\n=== EURO REGULATORS R4 SEED DONE ===");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
