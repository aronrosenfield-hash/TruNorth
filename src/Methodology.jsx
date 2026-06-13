// Methodology — the public, plain-English explanation of exactly how
// TruNorth grades work (2026-06-11 trust-layer review item). This page is
// simultaneously the #1 trust asset and the legal posture: grades framed as
// opinions derived from disclosed criteria over cited public records
// (Browne v. Avvo line of cases), with the one genuine editorial judgment
// (political-money model) disclosed rather than discovered.
// Mounts standalone at /methodology (web) and from the Account tab (app).

import React from "react";

const C = {
  bg: "#0E0F12", bgSoft: "#16181D", bgCard: "#16181D", border: "#23262C",
  text: "#EDE9E0", textDim: "#A9A498", textMute: "#9A9489", accent: "#38C0CE",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function H2({ children }) {
  return <h2 style={{ fontSize: 22, fontWeight: 800, color: C.text, marginTop: 36, marginBottom: 12, letterSpacing: -0.3 }}>{children}</h2>;
}
function P({ children }) {
  return <p style={{ fontSize: 15, lineHeight: 1.65, color: C.textDim, marginBottom: 14 }}>{children}</p>;
}
function UL({ children }) {
  return <ul style={{ fontSize: 15, lineHeight: 1.65, color: C.textDim, marginBottom: 14, paddingLeft: 22 }}>{children}</ul>;
}
function Code({ children }) {
  return <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13.5, background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 6, padding: "1px 6px", color: C.text }}>{children}</span>;
}

export default function Methodology({ onBack }) {
  return (
    // B66 fix (Aron: page wouldn't scroll in-app): the iOS shell sets
    // body{overflow:hidden}, so document scrolling is dead — the page must
    // OWN its scroll container, same as PrivacyPolicy's 2026-06-01 fix.
    <div style={{ height: "100dvh", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", background: C.bg, color: C.text, fontFamily: FONT }}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "calc(24px + env(safe-area-inset-top,0px)) 22px 80px" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.accent, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "8px 0", marginBottom: 8 }}>← Back</button>
        <h1 style={{ fontFamily: "ui-serif, 'New York', Georgia, serif", fontSize: 32, fontWeight: 600, letterSpacing: -0.5, marginBottom: 6, color: C.text }}>How TruNorth grades work</h1>
        <p style={{ fontSize: 13, color: C.textMute, marginBottom: 24 }}>Methodology, published in full. Last updated June 11, 2026.</p>

        <P>Every grade in TruNorth is computed by the published formula on this page, from public records we cite. No grade is hand-set, no company can pay to change one, and the same math runs identically whether a brand leans left, right, or neither.</P>

        <H2>1. Where the data comes from</H2>
        <P>We pull from 200+ public sources on fixed schedules: federal regulators (FEC, OSHA, EPA, NLRB, SEC, CFPB, CPSC, FDA, ATF, CBP, DOL), court records, state regulators, international enforcement agencies, certification bodies (B Corp, Leaping Bunny, Fair Trade, FSC), and official disclosure filings (SEC pay ratios, IRS-990 grants, EEO-1 workforce reports). Each category on a brand's card names its sources, and the in-app Sources tab lists every feed and its refresh cadence.</P>
        <P>Where a category shows a narrative researched with AI assistance, every claim required a citation URL to a verifiable source before it was written — uncited findings are discarded, and "no public record found" is always a permitted answer.</P>

        <H2>2. From records to category scores</H2>
        <P>Each of the 9 categories gets a 0–100 score from the records, using continuous formulas rather than buckets wherever the data allows:</P>
        <UL>
          <li><b>Executive pay</b> follows the actual SEC-disclosed CEO-to-median-worker ratio on a log curve: 20:1 → 100 · 100:1 → 70 · 300:1 → 45 · 1000:1 → 15.</li>
          <li><b>Labor and environment violations</b> scale with penalty dollars: $10K → 40 · $1M → 24 · $100M+ → 8. A $9K citation never scores like a $100M consent decree.</li>
          <li><b>Charitable giving</b> scales with documented IRS-990 grant totals: $10K → 60 up to $1B+ → 100.</li>
          <li><b>Political donations</b> (baseline, before the Match) score the concentration and scale of money, not its direction — see section 6.</li>
        </UL>

        <H2>3. Evidence confidence — why thin data can't fake a great grade</H2>
        <P>Brands start neutral (50) and every verified record moves them. Formally, the overall score is shrunk toward 50 by the evidence behind it:</P>
        <P><Code>score = (raw × N + 50 × 1.5) / (N + 1.5)</Code> — where <Code>N</Code> is the number of categories with real records. One strong record can earn a B; an A takes a broad, verified track record. This is the same estimator family IMDb uses for its Top 250.</P>
        <P>Brands with no scoreable records show <Code>?</Code> instead of a grade — we never average missing data into a fake C.</P>

        <H2>4. Letter grades — fixed, published thresholds</H2>
        <P><Code>A ≥ 63 · B ≥ 56 · C ≥ 46 · D ≥ 41 · F &lt; 41</Code></P>
        <P>These cut points were calibrated once against the live distribution of all scored brands (June 2026) and then frozen. Grades move only when a brand's own records change — we do not re-curve.</P>

        <H2>5. Your Match changes the mix, never the facts</H2>
        <P>The 45-second Match sets how much each category weighs for <i>you</i> (1–5 ranks, with a 1.5× boost on axes where you took a clear stance). Two users see different grades for the same brand because they weigh the same facts differently — the facts never change. Two guardrails apply to everyone:</P>
        <UL>
          <li><b>Values disagreement caps at D.</b> A brand whose records are clean can't score an F for you just because its politics oppose yours — F requires documented misconduct or one of your explicit dealbreakers.</li>
          <li><b>Symmetry.</b> The engine treats a progressive profile mismatching a conservative brand exactly as it treats the reverse. Same formulas, mirrored.</li>
        </UL>

        <H2>6. Where we make judgment calls — disclosed</H2>
        <P>Almost everything here is records arithmetic, but two modeling choices are genuine judgments, so we're saying them plainly:</P>
        <UL>
          <li>For users with no political preference, the baseline political score treats <i>balanced, smaller-dollar</i> giving as better than <i>concentrated, large-dollar partisan</i> giving. If you take a side in the Match, this baseline is replaced by your own preference entirely.</li>
          <li><b>DEI, animal testing, and firearms are excluded from the neutral baseline grade entirely.</b> We show those facts as badges, but they only move a grade after you take a stance in the Match — the app takes no position on them. Political giving is the one stance-adjacent category we <i>do</i> fold into the baseline, through the balanced-vs-concentrated judgment described just above; the moment you state a political preference, your own weighting replaces that baseline.</li>
        </UL>

        <H2>7. What we don't do</H2>
        <UL>
          <li>No pay-for-grades, no advertiser influence, no sponsored placements — ever.</li>
          <li>No accounts, no sale of personal data, no session recording. The Match lives on your device.</li>
          <li>No editorial overrides: if the records are wrong, we fix the records pipeline, not the letter.</li>
        </UL>

        <H2>8. Corrections</H2>
        <P>If we've mischaracterized a record or matched the wrong company, email <a href="mailto:corrections@trunorthapp.com" style={{ color: C.accent }}>corrections@trunorthapp.com</a> with a link to the underlying record. Verified corrections ship in the next data cycle, typically within a week.</P>

        <div style={{ marginTop: 36, padding: "14px 16px", background: C.bgSoft, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: C.textMute, margin: 0 }}>
            TruNorth grades are opinions derived from the cited public records using the methodology above. Records summarized here are described as filed, settled, or alleged per the issuing agency or court; a settlement is not an admission of wrongdoing unless the record says so.
          </p>
        </div>
      </div>
    </div>
  );
}
