// Privacy policy — standalone screen, GDPR/CCPA-aware, plain-English.
// Mounts as a sibling of <MarketingLanding /> when the hash route is #privacy.
// No app dependencies — readable on its own.

import React from "react";

const C = {
  bg:       "#0E0F12",
  bgSoft:   "#16181D",
  bgCard:   "#16181D",
  border:   "#23262C",
  text:     "#EDE9E0",
  textDim:  "#A9A498",
  textMute: "#9A9489",
  accent:   "#38C0CE",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function H2({ children }) {
  return (
    <h2 style={{
      fontSize:22, fontWeight:800, color:C.text, marginTop:36, marginBottom:12,
      letterSpacing:-0.3,
    }}>{children}</h2>
  );
}

function P({ children }) {
  return (
    <p style={{ fontSize:15, lineHeight:1.65, color:C.textDim, marginBottom:14 }}>
      {children}
    </p>
  );
}

function UL({ children }) {
  return (
    <ul style={{
      fontSize:15, lineHeight:1.65, color:C.textDim, marginBottom:14,
      paddingLeft:22,
    }}>{children}</ul>
  );
}

export default function PrivacyPolicy({ onBack }) {
  const handleBack = () => {
    if (onBack) return onBack();
    if (typeof window !== "undefined") {
      window.location.hash = "";
      window.location.reload();
    }
  };

  return (
    <div style={{
      background:C.bg, color:C.text, fontFamily:FONT,
      // 2026-06-01 fix: index.html sets `body { overflow: hidden }` for the
      // iOS app shell — that traps any direct child under 100vh and clipped
      // the privacy page on web. Owning our own scroll container (height +
      // overflowY) bypasses the parent rule on every browser.
      height:"100vh",
      overflowY:"auto",
      WebkitOverflowScrolling:"touch",
      WebkitFontSmoothing:"antialiased",
    }}>
      {/* Header */}
      <header style={{
        maxWidth:720, margin:"0 auto", padding:"22px 24px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <button onClick={handleBack} style={{
          background:"none", border:"none", color:C.accent,
          fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT, padding:0,
        }}>
          ← Back
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <img src="/apple-touch-icon.png" alt="" width={28} height={28} style={{ borderRadius:7 }} />
          <div style={{ fontWeight:700, fontSize:15 }}>TruNorth</div>
        </div>
      </header>

      {/* Body */}
      <main style={{ maxWidth:720, margin:"0 auto", padding:"24px 24px 80px" }}>
        <div style={{
          fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
          color:C.accent, marginBottom:12,
        }}>Privacy Policy</div>
        <h1 style={{
          fontSize:36, fontWeight:800, letterSpacing:-1, lineHeight:1.1,
          marginBottom:8, color:C.text,
        }}>How we handle your data</h1>
        <div style={{ fontSize:13, color:C.textMute, marginBottom:24 }}>
          Last updated: June 9, 2026
        </div>

        <H2>Intro</H2>
        <P>
          TruNorth (the “Service”) is operated by TruNorthApp LLC (“we”, “us”, “our”). This policy explains what data we collect, why, what we do with it, and the choices you have. We've tried to write it like a human, not a lawyer — if anything is unclear, email <a href="mailto:Aron@trunorthapp.com" style={{ color:C.accent }}>Aron@trunorthapp.com</a>.
        </P>
        <P>
          TruNorth is designed to be useful without an account. You can browse, search, and view brand grades without signing up, signing in, or telling us anything about yourself.
        </P>

        <H2>Data we collect</H2>
        <P>The data we collect falls into three buckets:</P>
        <UL>
          <li><strong>On your device only.</strong> Your quiz answers, saved companies, recent searches, and preferences live in your browser/device storage (localStorage). We never see this unless you explicitly send it to us (e.g., via the in-app Submit form).</li>
          <li><strong>Anonymous analytics.</strong> We use PostHog to understand which features people use and where they get stuck. PostHog assigns an anonymous device identifier — we don't tie it to your name, email, or any personal identifier unless you provide one.</li>
          <li><strong>Email (only if you give it).</strong> If you subscribe to launch updates or upgrade to Pro, we store your email address with our email provider (MailerLite) to send those updates. We never sell it, never share it, and you can unsubscribe in one click.</li>
        </UL>

        <H2>How we use it</H2>
        <UL>
          <li>To run the app — your quiz answers, locally, determine your personalized grades.</li>
          <li>To improve the product — anonymous analytics help us prioritize fixes and features.</li>
          <li>To communicate — if you opted into email updates, we'll send occasional product notes (never marketing for third parties).</li>
          <li>To respond to you — if you email us or submit a data correction, we use your message to reply.</li>
        </UL>

        <H2>Sharing — we don't sell your data</H2>
        <P>
          We do not sell, rent, or trade your personal information to anyone. We do not "share" your personal information for cross-context behavioral advertising as those terms are defined under the California Consumer Privacy Act (CCPA/CPRA). We do not run third-party ad networks. The only third parties that touch your data are the service providers we use to operate the app:
        </P>
        <UL>
          <li><strong>PostHog</strong> — anonymized product analytics.</li>
          <li><strong>MailerLite</strong> — email delivery for users who opted in.</li>
          <li><strong>Vercel</strong> — web hosting (standard server logs).</li>
          <li><strong>Apple App Store</strong> — iOS distribution and (optional) in-app purchases.</li>
          <li><strong>Open Food Facts</strong> — when you use the in-app barcode scanner, we send the scanned barcode (no personal data) to their public API to look up product brand info.</li>
        </UL>
        <P>
          We may also disclose information if legally required (subpoena, court order) — but we've designed the app to collect very little to begin with, so there's not much to disclose.
        </P>

        <H2>Cookies and similar tech</H2>
        <P>
          We use <strong>localStorage</strong> (not traditional cookies) to remember your settings and quiz results on your device. PostHog uses a first-party cookie/identifier for anonymous session continuity. We do not use third-party advertising cookies.
        </P>

        <H2>Children's privacy</H2>
        <P>
          TruNorth is not directed to children under 13, and we do not knowingly collect personal information from anyone under 13. If you believe a child has provided us with personal information, please contact us at <a href="mailto:Aron@trunorthapp.com" style={{ color:C.accent }}>Aron@trunorthapp.com</a> and we'll delete it.
        </P>

        <H2>Your rights (GDPR / CCPA / and just-good-defaults)</H2>
        <P>You have the right to:</P>
        <UL>
          <li><strong>Access</strong> — ask what data we have associated with your email (likely just: your email, your opt-in source, and any Pro purchase record).</li>
          <li><strong>Delete</strong> — ask us to remove your email from our lists. Local device data you can clear yourself by clearing browser storage or deleting the app.</li>
          <li><strong>Opt out</strong> — unsubscribe from emails at any time via the link in any email we send.</li>
          <li><strong>Object</strong> — to our anonymous analytics. Most browsers let you block analytics scripts, and we honor the Global Privacy Control (GPC) signal where supported.</li>
          <li><strong>Portability</strong> — request a copy of your data in a machine-readable format.</li>
        </UL>
        <P>To exercise any of these, email <a href="mailto:Aron@trunorthapp.com" style={{ color:C.accent }}>Aron@trunorthapp.com</a>. We aim to respond within 30 days.</P>
        <P>
          <strong>EU/UK users:</strong> our legal basis for processing your email is <em>consent</em> (you opted in); for anonymous analytics, <em>legitimate interest</em> (improving the product). You have the right to lodge a complaint with your local data protection authority — find yours at <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" style={{ color:C.accent }} target="_blank" rel="noopener noreferrer">edpb.europa.eu</a> or, in the UK, the <a href="https://ico.org.uk/" style={{ color:C.accent }} target="_blank" rel="noopener noreferrer">ICO</a>. We do not have a designated Data Protection Officer (we're small enough that the legal threshold doesn't apply) — Aron handles privacy requests directly.
        </P>
        <P>
          <strong>California users:</strong> you have the right to know what we collect, request deletion, correct inaccuracies, opt out of any "sale" or "sharing" (we don't do either), and limit use of sensitive personal information (we don't collect any). To exercise these rights, email the address above. We will not discriminate against you for exercising your rights.
        </P>

        <H2>Data retention</H2>
        <P>
          Subscriber emails are kept until you unsubscribe. Anonymous analytics are retained per PostHog's default (currently 7 years aggregated, less if you've opted out). Server logs at Vercel rotate per their standard policy.
        </P>

        <H2>International users</H2>
        <P>
          Our service providers operate primarily in the United States. By using TruNorth, you acknowledge that your data may be processed in the U.S. We rely on Standard Contractual Clauses (SCCs) with our processors where required.
        </P>

        <H2>Changes to this policy</H2>
        <P>
          If we change this policy in a material way, we'll update the “Last updated” date at the top and, if you're on our email list, send you a note. Continued use of the app after a change means you accept the updated policy.
        </P>

        <H2>Contact</H2>
        <P>
          Questions, requests, corrections, or complaints:<br/>
          <a href="mailto:Aron@trunorthapp.com" style={{ color:C.accent }}>Aron@trunorthapp.com</a><br/>
          TruNorthApp LLC
        </P>

        <div style={{
          marginTop:48, paddingTop:24, borderTop:`1px solid ${C.border}`,
          fontSize:13, color:C.textMute,
        }}>
          <button onClick={handleBack} style={{
            background:"none", border:"none", color:C.accent,
            fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:FONT, padding:0,
          }}>
            ← Back to TruNorth
          </button>
        </div>
      </main>
    </div>
  );
}
