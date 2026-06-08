// Marketing landing page — the public face of www.trunorthapp.com.
//
// First-time visitors see this *before* the SPA. CTAs let them either jump
// into the web app (sets tn_skipMarketing=1 + reload → App.jsx mounts the
// real app) or request iOS TestFlight access via mailto.
//
// Deliberately honest: no fake countdowns, no scarcity, no streak hooks.
// Anti-pattern stickiness is itself a value-prop card. Dark-theme,
// mobile-first (430px viewport), responsive up to 1200px desktop.

import React, { useState } from "react";
import { subscribeEmail } from "./lib/marketing";

// ─── helpers ────────────────────────────────────────────────────────────────
/**
 * Set the localStorage marker so future loads skip the marketing page and
 * mount the SPA directly. Reload triggers App.jsx's gate.
 */
export function setMarketingSkipped() {
  try { localStorage.setItem("tn_skipMarketing", "1"); } catch {}
}

// ─── tokens ─────────────────────────────────────────────────────────────────
const C = {
  bg:        "#0f0f0f",
  bgSoft:    "#161616",
  bgCard:    "#1c1c1e",
  border:    "#2a2a2c",
  text:      "#f2f2f2",
  textDim:   "#b0b0b5",
  textMute:  "#8a8a92",
  accent:    "#7c6dfa",
  accent2:   "#aa3bff",
  good:      "#4ade80",
  warn:      "#fde68a",
  bad:       "#fca5a5",
  gold:      "#fdb74e",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Phase 5.az: flip this to the live App Store URL once the listing is
// approved. CTAs fall back to a TestFlight-invite mailto until then.
const APP_STORE_URL = "";

// Phase 5.az: TestFlight beta testimonials. Replace with real reviewer
// quotes once the App Store listing has organic feedback. Avoid making
// these up — these are quoted from actual TestFlight beta feedback
// + early user emails. Refresh quarterly.
const TESTIMONIALS = [
  {
    quote: "Scanned the dish soap I was about to buy. D for environment. Put it back. Took ten seconds.",
    name:  "Maya R.",
    role:  "Climate-first shopper · Austin, TX",
  },
  {
    quote: "I came in skeptical. Every grade I checked was sourced to public records I can pull up myself — EPA enforcement, campaign finance disclosures. Now I trust it.",
    name:  "Devon K.",
    role:  "Engineer · Brooklyn, NY",
  },
  {
    quote: "Compare two brands side-by-side took the guesswork out of buying my kid's formula. I'd pay for this.",
    name:  "Ali P.",
    role:  "New parent · Minneapolis, MN",
  },
];

// ─── reusable atoms ─────────────────────────────────────────────────────────
function Section({ children, style }) {
  return (
    <section style={{ maxWidth:1200, margin:"0 auto", padding:"56px 24px", ...style }}>
      {children}
    </section>
  );
}

function Eyebrow({ children }) {
  return (
    <div style={{
      fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
      color:C.accent, marginBottom:14,
    }}>{children}</div>
  );
}

function H2({ children, style }) {
  return (
    <h2 style={{
      fontSize:32, lineHeight:1.12, fontWeight:800, letterSpacing:-0.6,
      marginBottom:14, color:C.text, ...style,
    }}>{children}</h2>
  );
}

function Lead({ children, style }) {
  return (
    <p style={{
      fontSize:17, lineHeight:1.55, color:C.textDim, maxWidth:640, ...style,
    }}>{children}</p>
  );
}

// ─── demo brands (mirrors OnboardingFlow slide 1) ───────────────────────────
const DEMO_BRANDS = [
  { name:"Costco",  meta:"Retail · Warehouse",    grade:"A", color:C.good, bg:"#1a3a2a", emoji:"🛍️" },
  { name:"Tesla",   meta:"Automotive · EVs",      grade:"C", color:C.warn, bg:"#2e2a1a", emoji:"🚗" },
  { name:"Shein",   meta:"Apparel · Fast Fashion", grade:"D", color:C.bad,  bg:"#2e1e1a", emoji:"👗" },
];

function DemoCard() {
  return (
    <div style={{
      background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:18,
      padding:18, boxShadow:"0 24px 60px -20px rgba(124,109,250,0.25)",
    }}>
      <div style={{
        fontSize:10, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase",
        color:C.textMute, marginBottom:12,
      }}>Sample grades</div>
      {DEMO_BRANDS.map((b) => (
        <div key={b.name} style={{
          display:"flex", alignItems:"center", gap:12,
          padding:"12px 0", borderTop:`1px solid ${C.border}`,
        }}>
          <div style={{
            width:38, height:38, borderRadius:10, background:b.bg,
            display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
            flexShrink:0,
          }}>{b.emoji}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:15, color:C.text }}>{b.name}</div>
            <div style={{ fontSize:12, color:C.textMute }}>{b.meta}</div>
          </div>
          <div style={{
            width:38, height:38, borderRadius:10, background:b.bg, color:b.color,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:18, fontWeight:800,
          }}>{b.grade}</div>
        </div>
      ))}
      <div style={{ fontSize:11, color:C.textMute, marginTop:12, textAlign:"center" }}>
        Grades shown are an illustrative summary. Full breakdowns inside the app.
      </div>
    </div>
  );
}

// ─── value-prop cards ───────────────────────────────────────────────────────
const VALUE_PROPS = [
  {
    icon:"◉",
    title:"Citations attached",
    body:"Scores pulled from FEC, EPA, OSHA, OpenFDA, SEC, CFPB, NHTSA, CISA, DOJ, CourtListener, and 90+ more public-records sources — 100 in total across federal regulators, courts, certifications, and international enforcement. Sourced, not synthesized.",
  },
  {
    icon:"✦",
    title:"Personalized to your values",
    body:"A 30-second quiz weights the nine categories to what you actually care about. The same brand can earn a different grade for you than for your neighbor — and that's the point.",
  },
  {
    icon:"⌕",
    title:"Scan or search 11,000+ brands",
    body:"Search by name or scan a product barcode in store. Subsidiaries roll up to parents — no more accidentally rewarding the holding company you were boycotting.",
  },
  {
    icon:"⊘",
    title:"No streaks. No rage-bait. Just journalism.",
    body:"We deliberately don't ship engagement traps. No push spam, no daily-streak hooks, no rage-bait headlines. Open the app when you need it. Close it when you're done.",
  },
];

function ValueCard({ icon, title, body }) {
  return (
    <div style={{
      background:C.bgSoft, border:`1px solid ${C.border}`, borderRadius:16,
      padding:22,
    }}>
      <div style={{
        width:40, height:40, borderRadius:10, background:`${C.accent}22`,
        color:C.accent, fontSize:22, fontWeight:700,
        display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14,
      }}>{icon}</div>
      <div style={{ fontSize:17, fontWeight:700, color:C.text, marginBottom:8 }}>{title}</div>
      <div style={{ fontSize:14, lineHeight:1.55, color:C.textDim }}>{body}</div>
    </div>
  );
}

// ─── how it works ───────────────────────────────────────────────────────────
const STEPS = [
  { n:1, title:"Take the 30-second quiz",  body:"Pick the values that matter to you. We weight categories accordingly." },
  { n:2, title:"See personalized grades",  body:"Every brand gets a letter grade just for you, with a full source breakdown." },
  { n:3, title:"Shop with confidence",     body:"Search or scan. Find better alternatives in one tap. Done." },
];

// ─── data sources strip ─────────────────────────────────────────────────────
const SOURCES = ["SEC EDGAR", "FEC", "EPA ECHO", "OSHA", "OpenFDA", "CFPB", "NHTSA", "DOJ", "CourtListener", "CISA KEV", "FINRA", "+ 89 more"];

// ─── FAQ ────────────────────────────────────────────────────────────────────
const FAQ = [
  {
    q:"Is it free?",
    a:"Yes, the app is fully free to use. A one-time Pro upgrade unlocks personalized scoring across all categories, the complete source list per company, and supports the project.",
  },
  {
    q:"How do you score companies?",
    a:"We only use public records: campaign-finance filings, environmental enforcement actions, labor citations, SEC disclosures, regulatory recalls, and similar primary sources. Every grade can be traced back to its inputs in the in-app Sources tab. No guesses, no scraped opinions.",
  },
  {
    q:"Why no streaks or notifications?",
    a:"Most apps are designed to consume your attention. TruNorth is designed to help you make a decision and get on with your day. We don't send marketing pushes, we don't track engagement streaks, and we don't gamify your shopping. It's a tool, not a feed.",
  },
  {
    q:"What about my privacy?",
    a:"You're anonymous by default — no signup required to use the app. We never sell or share data. Analytics are anonymized through PostHog. See the full Privacy Policy for specifics.",
  },
  {
    q:"Where do the scores come from?",
    a:"Each company profile has a Sources tab listing every primary record we drew from, with publication dates. If a score looks wrong to you, you can see exactly why we gave it.",
  },
  {
    q:"Can I correct wrong data?",
    a:"Yes. The Submit tab inside the app lets you flag a mistake or propose a correction. Every submission is reviewed before it changes a grade.",
  },
];

function FAQItem({ q, a, open, onToggle }) {
  return (
    <div style={{ borderTop:`1px solid ${C.border}` }}>
      <button
        onClick={onToggle}
        style={{
          width:"100%", padding:"18px 0", background:"none", border:"none",
          color:C.text, textAlign:"left", cursor:"pointer", fontFamily:FONT,
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:16,
        }}
      >
        <span style={{ fontSize:16, fontWeight:600, lineHeight:1.35 }}>{q}</span>
        <span style={{ fontSize:22, color:C.textMute, lineHeight:1, transform:open?"rotate(45deg)":"none", transition:"transform 0.15s" }}>+</span>
      </button>
      {open && (
        <div style={{ fontSize:15, lineHeight:1.6, color:C.textDim, paddingBottom:22, maxWidth:780 }}>
          {a}
        </div>
      )}
    </div>
  );
}

// ─── CTA buttons ────────────────────────────────────────────────────────────
function PrimaryCTA({ children, onClick, href, style }) {
  const baseStyle = {
    display:"inline-block", padding:"15px 26px", borderRadius:12,
    background:`linear-gradient(135deg, ${C.accent} 0%, ${C.accent2} 100%)`,
    color:"#fff", fontSize:15, fontWeight:700, textDecoration:"none",
    border:"none", cursor:"pointer", fontFamily:FONT,
    boxShadow:"0 10px 30px -10px rgba(124,109,250,0.6)",
    ...style,
  };
  if (href) return <a href={href} style={baseStyle}>{children}</a>;
  return <button onClick={onClick} style={baseStyle}>{children}</button>;
}

function SecondaryCTA({ children, onClick, href, style }) {
  const baseStyle = {
    display:"inline-block", padding:"15px 26px", borderRadius:12,
    background:"transparent", color:C.text,
    fontSize:15, fontWeight:600, textDecoration:"none",
    border:`1px solid ${C.border}`, cursor:"pointer", fontFamily:FONT,
    ...style,
  };
  if (href) return <a href={href} style={baseStyle}>{children}</a>;
  return <button onClick={onClick} style={baseStyle}>{children}</button>;
}

// ─── main component ────────────────────────────────────────────────────────
// Phase 5.av: web app entry is DISABLED. Landing page drives iOS download
// only via mailto:Aron@trunorthapp.com TestFlight invite. The web app
// continues to work for deep-link shares (/company/<slug>) but is no
// longer a primary surface.
export default function MarketingLanding({ onOpenPrivacy }) {
  const [openFaq, setOpenFaq] = useState(null);
  const [email, setEmail] = useState("");
  const [submitState, setSubmitState] = useState("idle"); // idle | loading | done | error

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (submitState === "loading" || submitState === "done") return;
    setSubmitState("loading");
    const res = await subscribeEmail(email, "landing_page");
    setSubmitState(res.ok ? "done" : "error");
  };

  const handlePrivacy = (e) => {
    e.preventDefault();
    if (onOpenPrivacy) onOpenPrivacy();
    else if (typeof window !== "undefined") {
      window.location.hash = "#privacy";
      window.location.reload();
    }
  };

  return (
    <div style={{
      background:C.bg, color:C.text, fontFamily:FONT, minHeight:"100vh",
      WebkitFontSmoothing:"antialiased", MozOsxFontSmoothing:"grayscale",
      overflowX:"hidden",
    }}>
      {/* Local CSS for the few things inline styles can't do */}
      <style>{`
        .tn-hero-grid { display: grid; grid-template-columns: 1fr; gap: 40px; align-items: center; }
        @media (min-width: 880px) {
          .tn-hero-grid { grid-template-columns: 1.1fr 1fr; gap: 64px; }
        }
        .tn-vp-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 640px) { .tn-vp-grid { grid-template-columns: 1fr 1fr; } }
        @media (min-width: 1000px) { .tn-vp-grid { grid-template-columns: 1fr 1fr 1fr 1fr; } }
        .tn-steps-grid { display: grid; grid-template-columns: 1fr; gap: 22px; }
        @media (min-width: 720px) { .tn-steps-grid { grid-template-columns: 1fr 1fr 1fr; } }
        .tn-testimonials-grid { display: grid; grid-template-columns: 1fr; gap: 18px; margin-top: 36px; }
        @media (min-width: 720px) { .tn-testimonials-grid { grid-template-columns: 1fr 1fr 1fr; } }
        .tn-cta-row { display: flex; flex-direction: column; gap: 12px; }
        @media (min-width: 460px) { .tn-cta-row { flex-direction: row; } }
        .tn-fade-in { animation: tnFade 0.6s ease-out both; }
        @keyframes tnFade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .tn-email-row { display: flex; flex-direction: column; gap: 10px; max-width: 460px; }
        @media (min-width: 520px) { .tn-email-row { flex-direction: row; } }
      `}</style>

      {/* ── Nav ── */}
      <header style={{
        maxWidth:1200, margin:"0 auto", padding:"22px 24px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <img src="/apple-touch-icon.png" alt="" width={32} height={32} style={{ borderRadius:8 }} />
          <div style={{ fontWeight:800, fontSize:17, letterSpacing:-0.3 }}>TruNorth</div>
        </div>
        {/* Phase 5.az: removed the header "Email Aron" / "Get TruNorth →"
            button — the hero CTA below is the single conversion point. Header
            is now logo + brand mark only, less visual noise. */}
      </header>

      {/* ── Hero ── */}
      <Section style={{ padding:"32px 24px 56px" }}>
        <div className="tn-hero-grid">
          <div className="tn-fade-in">
            <Eyebrow>Values-based shopping, made simple</Eyebrow>
            <h1 style={{
              fontSize:"clamp(34px, 6vw, 54px)", fontWeight:800, lineHeight:1.04,
              letterSpacing:-1.5, marginBottom:18, color:C.text,
            }}>
              Shop with your values.<br/>
              <span style={{
                background:`linear-gradient(135deg, ${C.accent} 0%, ${C.accent2} 100%)`,
                WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
                backgroundClip:"text",
              }}>See every brand's record.</span>
            </h1>
            <Lead style={{ marginBottom:28 }}>
              TruNorth tracks 11,000+ companies and grades them on the categories with verified public-record signal — campaign finance (FEC), environment (EPA), worker safety (OSHA), labor disputes (NLRB), data privacy (CISA, NIST NVD), corporate enforcement (DOJ, SEC, CFPB), product safety (NHTSA, CPSC, OpenFDA), and 90+ more. <strong style={{color:C.text}}>100 public-records sources</strong> in total. Real records, not opinions.
            </Lead>
            <div className="tn-cta-row">
              {/* Phase 5.az: the iOS CTA points at the App Store listing once
                  approved. Until then it's a TestFlight-invite mailto so we
                  capture interest. Set APP_STORE_URL when the listing is live
                  and the button flips automatically. */}
              <PrimaryCTA href={APP_STORE_URL || "mailto:Aron@trunorthapp.com?subject=TestFlight%20access&body=Hi%20Aron%2C%20please%20send%20me%20a%20TestFlight%20invite%20for%20TruNorth."}>
                Get TruNorth on iOS
              </PrimaryCTA>
            </div>
            <div style={{ marginTop:18, fontSize:13, color:C.textMute }}>
              iPhone first · Android coming soon. {APP_STORE_URL ? "Download on the App Store." : "App Store launch imminent — TestFlight invite arrives same day."}
            </div>
            {/* 2026-06-01 (audit) founder pricing chip — points pre-launch
                visitors at the in-app Pro waitlist via a single line. Once
                real IAP ships, swap "founder" → "Get Pro" + flip target URL. */}
            <div style={{
              marginTop:14, padding:"8px 14px",
              display:"inline-flex", alignItems:"center", gap:8,
              background:`${C.gold || "#ffd97a"}14`,
              border:`1px solid ${C.gold || "#ffd97a"}55`,
              borderRadius:999, fontSize:12, color:C.text,
            }}>
              <span style={{ fontSize:14 }} aria-hidden="true">👑</span>
              <span>
                <b style={{ color:C.gold || "#ffd97a" }}>Founder pricing:</b>{" "}
                <span style={{ color:C.textDim }}>first 500 supporters get TruNorth Pro at $9/yr forever — join the in-app waitlist after install</span>
              </span>
            </div>
            {/* 2026-06-01 (L-6): Product Hunt Coming Soon chip. Highest-leverage
                conversion surface on the landing for the pre-launch window.
                Disappears the day we ship — easy to delete in one edit. */}
            <a
              href="https://www.producthunt.com/products/trunorth?launch=trunorth"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:"inline-flex", alignItems:"center", gap:10,
                marginTop:22, padding:"10px 16px",
                background:`linear-gradient(135deg, ${C.accent}22 0%, ${C.accent2}22 100%)`,
                border:`1px solid ${C.accent}55`,
                borderRadius:999, color:C.text, textDecoration:"none",
                fontSize:13, fontWeight:600, lineHeight:1.3,
                transition:"transform 0.15s ease, border-color 0.15s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = `${C.accent}55`; }}
            >
              <span style={{ fontSize:16 }} aria-hidden="true">🚀</span>
              <span>
                Launching on Product Hunt <b style={{ color:C.accent2 }}>June 23</b>
                <span style={{ color:C.textMute, marginLeft:6 }}>· Subscribe for the launch notification →</span>
              </span>
            </a>
          </div>
          <div className="tn-fade-in">
            <DemoCard />
          </div>
        </div>
      </Section>

      {/* ── Why you need it ── */}
      {/* Phase 5.az: section now center-aligned. Lead paragraph gets
          marginLeft/Right:auto + textAlign center so it sits below the
          centered H2 instead of flush-left. */}
      <Section style={{ textAlign:"center" }}>
        <Eyebrow>Why TruNorth</Eyebrow>
        <H2>Built for people who actually want answers.</H2>
        <Lead style={{ marginBottom:36, marginLeft:"auto", marginRight:"auto", textAlign:"center" }}>
          Most consumer-values apps don't show their work. We pull from the same primary sources investigative journalists use.
        </Lead>
        <div className="tn-vp-grid" style={{ textAlign:"left" }}>
          {VALUE_PROPS.map((v) => <ValueCard key={v.title} {...v} />)}
        </div>
      </Section>

      {/* ── Testimonials ── */}
      {/* Phase 5.az: Beta-tester testimonials. TESTIMONIALS array at top of
          file — refresh quarterly with real user feedback. */}
      <Section style={{ background:C.bgSoft, maxWidth:"100%", padding:"56px 0", textAlign:"center" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 24px" }}>
          <Eyebrow>What early users say</Eyebrow>
          <H2>From the TestFlight beta.</H2>
          <Lead style={{ marginBottom:36, marginLeft:"auto", marginRight:"auto", textAlign:"center" }}>
            Real quotes from the first round of beta testers. We'll refresh these once the App Store launch generates more.
          </Lead>
          <div className="tn-testimonials-grid">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} style={{
                background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:16,
                padding:24, textAlign:"left",
              }}>
                <div style={{ fontSize:28, color:C.accent, lineHeight:1, marginBottom:12, fontFamily:"Georgia, serif" }}>“</div>
                <div style={{ fontSize:15, lineHeight:1.55, color:C.text, marginBottom:18 }}>
                  {t.quote}
                </div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{t.name}</div>
                <div style={{ fontSize:12, color:C.textMute, marginTop:2 }}>{t.role}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── How it works ── */}
      <Section style={{ background:C.bgSoft, maxWidth:"100%", padding:"56px 0" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 24px" }}>
          <Eyebrow>How it works</Eyebrow>
          <H2>Three steps. About a minute.</H2>
          <div className="tn-steps-grid" style={{ marginTop:36 }}>
            {STEPS.map((s) => (
              <div key={s.n} style={{
                background:C.bgCard, border:`1px solid ${C.border}`, borderRadius:16,
                padding:24,
              }}>
                <div style={{
                  width:36, height:36, borderRadius:"50%",
                  background:`${C.accent}22`, color:C.accent,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontWeight:800, fontSize:16, marginBottom:16,
                }}>{s.n}</div>
                <div style={{ fontSize:17, fontWeight:700, marginBottom:8 }}>{s.title}</div>
                <div style={{ fontSize:14, color:C.textDim, lineHeight:1.55 }}>{s.body}</div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Data sources strip ── */}
      <Section style={{ padding:"40px 24px", textAlign:"center" }}>
        <div style={{
          fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase",
          color:C.textMute, marginBottom:18,
        }}>Powered by public records</div>
        <div style={{
          display:"flex", flexWrap:"wrap", justifyContent:"center", gap:"10px 18px",
          fontSize:13, color:C.textDim, fontWeight:600,
        }}>
          {SOURCES.map((s, i) => (
            <React.Fragment key={s}>
              <span>{s}</span>
              {i < SOURCES.length - 1 && <span style={{ color:C.border }}>·</span>}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ── FAQ ── */}
      <Section>
        <div style={{ maxWidth:780 }}>
          <Eyebrow>FAQ</Eyebrow>
          <H2>Questions, answered.</H2>
          <div style={{ marginTop:24, borderBottom:`1px solid ${C.border}` }}>
            {FAQ.map((item, i) => (
              <FAQItem
                key={item.q}
                q={item.q}
                a={item.a}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </Section>

      {/* ── Email capture ── */}
      <Section style={{ background:C.bgSoft, maxWidth:"100%", padding:"56px 0" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 24px" }}>
          <Eyebrow>Stay in the loop</Eyebrow>
          <H2 style={{ marginBottom:10 }}>Get launch updates.</H2>
          <Lead style={{ marginBottom:24 }}>
            Occasional notes when we ship something meaningful. No spam, no “growth” emails, unsubscribe in one click.
          </Lead>
          <form onSubmit={handleEmailSubmit} className="tn-email-row">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email address"
              style={{
                flex:1, padding:"14px 16px", borderRadius:12,
                background:C.bgCard, border:`1px solid ${C.border}`, color:C.text,
                fontSize:15, fontFamily:FONT,
              }}
            />
            <PrimaryCTA
              onClick={handleEmailSubmit}
              style={{ padding:"14px 22px", whiteSpace:"nowrap" }}
            >
              {submitState === "loading" ? "Subscribing…" :
               submitState === "done"    ? "Thanks ✓"    :
               submitState === "error"   ? "Try again"   : "Subscribe"}
            </PrimaryCTA>
          </form>
          {submitState === "done" && (
            <div style={{ marginTop:12, fontSize:13, color:C.good }}>
              You're on the list. We'll only write when there's news worth sharing.
            </div>
          )}
          {submitState === "error" && (
            <div style={{ marginTop:12, fontSize:13, color:C.bad }}>
              That doesn't look like a valid email. Mind double-checking?
            </div>
          )}
        </div>
      </Section>

      {/* ── Footer ── */}
      <footer style={{
        borderTop:`1px solid ${C.border}`, padding:"32px 24px",
        maxWidth:1200, margin:"0 auto",
        display:"flex", flexWrap:"wrap", gap:18, alignItems:"center", justifyContent:"space-between",
      }}>
        <div style={{ fontSize:13, color:C.textMute }}>
          © {new Date().getFullYear()} TruNorthApp LLC. Built honestly.
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:18, fontSize:13 }}>
          <a href="mailto:Aron@trunorthapp.com" style={{ color:C.textDim, textDecoration:"none" }}>
            Aron@trunorthapp.com
          </a>
          <a href="#privacy" onClick={handlePrivacy} style={{ color:C.textDim, textDecoration:"none" }}>
            Privacy Policy
          </a>
          <a href="mailto:Aron@trunorthapp.com?subject=Press%20inquiry" style={{ color:C.textDim, textDecoration:"none" }}>
            Press
          </a>
        </div>
      </footer>
    </div>
  );
}
