import { useState } from "react";

const COMPANIES = [
  { emoji:"🛒", bg:"#1a1a2e", name:"Amazon",    meta:"Retail · E-commerce",  grade:"C", gradeStyle:{background:"#2e2a1a",color:"#fde68a"}, details:[{label:"🌿 Environment",pct:70,color:"#4ade80",grade:"B"},{label:"⚖️ Labor",pct:30,color:"#fca5a5",grade:"D"},{label:"🏳️ DEI",pct:72,color:"#a99ff7",grade:"B"}] },
  { emoji:"🧥", bg:"#1a2e1a", name:"Patagonia", meta:"Outdoor · Apparel",    grade:"A", gradeStyle:{background:"#1a3a2a",color:"#4ade80"}, details:[{label:"🌿 Environment",pct:95,color:"#4ade80",grade:"A+"},{label:"⚖️ Labor",pct:88,color:"#4ade80",grade:"A"},{label:"❤️ Charity",pct:90,color:"#4ade80",grade:"A"}] },
  { emoji:"⛽", bg:"#2e1a1a", name:"ExxonMobil",meta:"Energy · Oil & Gas",   grade:"D", gradeStyle:{background:"#2e1e1a",color:"#fca5a5"}, details:[{label:"🌿 Environment",pct:12,color:"#fca5a5",grade:"F"},{label:"⚖️ Labor",pct:40,color:"#fde68a",grade:"C"}] },
];

const CATEGORIES = [
  { emoji:"🗳️", bg:"#1e2e3e", name:"Political Donations", desc:"Where executives & PACs send money", pct:65 },
  { emoji:"🌿", bg:"#1e3e2e", name:"Environment",         desc:"EPA violations, carbon pledges",      pct:80 },
  { emoji:"⚖️", bg:"#2e2a1e", name:"Labor Practices",     desc:"OSHA & NLRB violations, wages",       pct:55 },
  { emoji:"🏳️‍🌈",bg:"#2a1e3e", name:"DEI",               desc:"HRC index, representation data",      pct:70 },
  { emoji:"❤️", bg:"#2e1e2e", name:"Charitable Giving",   desc:"% of profits donated, causes",        pct:45 },
];

export default function OnboardingFlow({ onComplete }) {
  const [slide, setSlide]           = useState(0);
  const [authMode, setAuthMode]     = useState("signup");
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [errors, setErrors]         = useState({});
  const [expandedCo, setExpandedCo] = useState(null);
  const [fading, setFading]         = useState(false);

  function goTo(n) {
    setFading(true);
    setTimeout(() => { setSlide(n); setFading(false); }, 280);
  }

  function handleNext() {
    if (slide < 2) { goTo(slide + 1); return; }
    const errs = {};
    if (!email.trim())    errs.email = true;
    if (!password.trim()) errs.password = true;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    localStorage.setItem("tn_hasOnboarded", "1");
    localStorage.setItem("tn_user", JSON.stringify({ email }));
    onComplete({ email, isGuest: false });
  }

  function handleGuest() {
    localStorage.setItem("tn_hasOnboarded", "1");
    onComplete({ email: null, isGuest: true });
  }

  const btnLabel = slide === 0 ? "Let's go →" : slide === 1 ? "Next →" : authMode === "signup" ? "Create account →" : "Sign in →";

  return (
    <div style={s.wrap}>
      <div style={{ ...s.slideWrap, opacity: fading ? 0 : 1, transform: fading ? "translateX(-20px)" : "translateX(0)", transition: "opacity 0.28s ease, transform 0.28s ease" }}>
        {slide === 0 && (
          <div style={s.slide}>
            <div style={s.eyebrow}>Know where your money goes</div>
            <h1 style={s.headline}>Your wallet<br />is a <em style={{ color:"#7c6dfa", fontStyle:"normal" }}>vote.</em><br />Cast it wisely.</h1>
            <p style={s.subtext}>See how every brand scores on what matters to you, before you buy.</p>
            <div style={s.demoCard}>
              <div style={s.demoLabel}>Live example — tap a company</div>
              {COMPANIES.map(co => (
                <div key={co.name}>
                  <div style={s.companyRow} onClick={() => setExpandedCo(expandedCo === co.name ? null : co.name)}>
                    <div style={{ ...s.coLogo, background: co.bg }}>{co.emoji}</div>
                    <div style={{ flex:1 }}>
                      <div style={s.coName}>{co.name}</div>
                      <div style={s.coMeta}>{co.meta}</div>
                    </div>
                    <div style={{ ...s.gradeBadge, ...co.gradeStyle }}>{co.grade}</div>
                  </div>
                  {expandedCo === co.name && (
                    <div style={s.expandedDetail}>
                      {co.details.map(d => (
                        <div key={d.label} style={s.detailRow}>
                          <span style={s.detailLabel}>{d.label}</span>
                          <div style={s.detailBarWrap}><div style={{ ...s.detailBarFill, width:`${d.pct}%`, background:d.color }} /></div>
                          <span style={{ ...s.detailGrade, color:d.color }}>{d.grade}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div style={s.tapHint}><div style={s.tapDot} /><span style={{ fontSize:11, color:"#555" }}>Tap any company to see their breakdown</span></div>
          </div>
        )}

        {slide === 1 && (
          <div style={s.slide}>
            <h2 style={{ ...s.headline, fontSize:30 }}>5 things<br />that matter.</h2>
            <p style={{ ...s.subtext, marginBottom:24 }}>Real data from the FEC, EPA, OSHA, NLRB, and more — not opinions.</p>
            {CATEGORIES.map(cat => (
              <div key={cat.name} style={s.catItem}>
                <div style={{ ...s.catIcon, background:cat.bg }}>{cat.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={s.catName}>{cat.name}</div>
                  <div style={s.catDesc}>{cat.desc}</div>
                </div>
                <div style={s.catBar}><div style={{ ...s.catFill, width:`${cat.pct}%` }} /></div>
              </div>
            ))}
          </div>
        )}

        {slide === 2 && (
          <div style={s.slide}>
            <div style={s.ctaArt}><div style={s.ctaArtInner}><svg width="36" height="36" viewBox="0 0 48 48"><polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/></svg></div></div>
            <h2 style={{ ...s.headline, fontSize:28, textAlign:"center" }}>Shop with a<br /><em style={{ color:"#7c6dfa", fontStyle:"normal" }}>clear conscience.</em></h2>
            <p style={{ ...s.subtext, textAlign:"center", marginBottom:20 }}>685 companies scored. Free to start — create an account to save your preferences.</p>
            <div style={s.statsRow}>
              {[["685","Companies"],["5","Categories"],["20+","Sources"]].map(([num,label]) => (
                <div key={label} style={{ textAlign:"center" }}>
                  <div style={s.statNum}>{num}</div>
                  <div style={s.statLabel}>{label}</div>
                </div>
              ))}
            </div>
            <div style={s.authTabs}>
              {["signup","login"].map(mode => (
                <button key={mode} style={{ ...s.authTab, ...(authMode===mode ? s.authTabActive : {}) }} onClick={() => setAuthMode(mode)}>
                  {mode === "signup" ? "Create account" : "Sign in"}
                </button>
              ))}
            </div>
            <input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={{ ...s.authInput, borderColor: errors.email ? "#fca5a5" : "#2a2a2a" }} />
            <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...s.authInput, borderColor: errors.password ? "#fca5a5" : "#2a2a2a" }} />
            <div style={s.divider}><div style={s.dividerLine}/><span style={{ color:"#444", fontSize:11 }}>or</span><div style={s.dividerLine}/></div>
            <button style={s.btnGhost} onClick={handleGuest}>Continue as guest</button>
            <p style={s.terms}>By continuing you agree to our <a href="#" style={{ color:"#7c6dfa", textDecoration:"none" }}>Terms</a> & <a href="#" style={{ color:"#7c6dfa", textDecoration:"none" }}>Privacy Policy</a>.</p>
          </div>
        )}
      </div>

      <div style={s.bottom}>
        <div style={s.dots}>
          {[0,1,2].map(i => <div key={i} style={{ ...s.dot, ...(i===slide ? s.dotActive : {}) }} />)}
        </div>
        <button style={s.btnPrimary} onClick={handleNext}>{btnLabel}</button>
        {slide < 2 && <button style={s.btnSkip} onClick={() => goTo(2)}>Skip</button>}
      </div>
    </div>
  );
}

const s = {
  wrap:            { position:"fixed", inset:0, background:"#0f0f0f", display:"flex", flexDirection:"column", fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color:"#f2f2f2", zIndex:1000, overflow:"hidden" },
  slideWrap:       { flex:1, overflow:"hidden", position:"relative" },
  slide:           { padding:"52px 24px 24px", display:"flex", flexDirection:"column", height:"100%", overflowY:"auto" },
  eyebrow:         { fontSize:11, fontWeight:600, letterSpacing:2, textTransform:"uppercase", color:"#7c6dfa", marginBottom:16 },
  headline:        { fontSize:36, fontWeight:800, lineHeight:1.08, letterSpacing:-1, marginBottom:14 },
  subtext:         { fontSize:15, lineHeight:1.6, color:"#888" },
  demoCard:        { marginTop:28, background:"#1a1a1a", borderRadius:20, padding:18, border:"1px solid #2a2a2a", borderTop:"2px solid #7c6dfa" },
  demoLabel:       { fontSize:10, fontWeight:600, letterSpacing:1.5, textTransform:"uppercase", color:"#555", marginBottom:12 },
  companyRow:      { display:"flex", alignItems:"center", gap:12, padding:"9px 0", borderBottom:"1px solid #232323", cursor:"pointer" },
  coLogo:          { width:34, height:34, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 },
  coName:          { fontSize:13, fontWeight:600, color:"#f2f2f2" },
  coMeta:          { fontSize:10, color:"#555", marginTop:1 },
  gradeBadge:      { width:34, height:34, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:17, flexShrink:0 },
  expandedDetail:  { background:"#161616", borderRadius:10, padding:12, marginTop:8, marginBottom:4 },
  detailRow:       { display:"flex", alignItems:"center", marginBottom:9 },
  detailLabel:     { fontSize:11, color:"#666", width:90, flexShrink:0 },
  detailBarWrap:   { flex:1, margin:"0 10px", height:5, background:"#222", borderRadius:3, overflow:"hidden" },
  detailBarFill:   { height:"100%", borderRadius:3 },
  detailGrade:     { fontSize:11, fontWeight:700, width:22, textAlign:"right" },
  tapHint:         { display:"flex", alignItems:"center", gap:6, marginTop:10 },
  tapDot:          { width:6, height:6, borderRadius:"50%", background:"#7c6dfa" },
  catItem:         { display:"flex", alignItems:"center", gap:14, padding:14, background:"#161616", borderRadius:14, marginBottom:9, border:"1px solid #222" },
  catIcon:         { width:38, height:38, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, flexShrink:0 },
  catName:         { fontSize:13, fontWeight:600, color:"#f2f2f2" },
  catDesc:         { fontSize:11, color:"#555", marginTop:2 },
  catBar:          { width:44, height:5, background:"#222", borderRadius:3, overflow:"hidden" },
  catFill:         { height:"100%", borderRadius:3, background:"linear-gradient(90deg,#7c6dfa,#a99ff7)" },
  ctaArt:          { width:100, height:100, background:"radial-gradient(circle,rgba(124,109,250,0.2) 0%,transparent 70%)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px" },
  ctaArtInner:     { width:70, height:70, background:"#7c6dfa", borderRadius:20, display:"flex", alignItems:"center", justifyContent:"center" },
  statsRow:        { display:"flex", justifyContent:"space-around", marginBottom:24 },
  statNum:         { fontSize:22, fontWeight:800, color:"#7c6dfa", textAlign:"center" },
  statLabel:       { fontSize:10, color:"#555", marginTop:2, letterSpacing:0.5, textAlign:"center" },
  authTabs:        { display:"flex", background:"#1a1a1a", borderRadius:12, padding:4, marginBottom:14, border:"1px solid #222" },
  authTab:         { flex:1, padding:9, border:"none", background:"transparent", color:"#555", fontFamily:"inherit", fontSize:13, fontWeight:600, cursor:"pointer", borderRadius:9 },
  authTabActive:   { background:"#7c6dfa", color:"#fff" },
  authInput:       { width:"100%", padding:"13px 16px", background:"#1a1a1a", border:"1px solid", borderRadius:12, color:"#f2f2f2", fontFamily:"inherit", fontSize:14, marginBottom:10 },
  divider:         { display:"flex", alignItems:"center", gap:10, margin:"12px 0" },
  dividerLine:     { flex:1, height:1, background:"#222" },
  btnGhost:        { width:"100%", padding:14, background:"transparent", border:"1px solid #2a2a2a", borderRadius:14, color:"#888", fontFamily:"inherit", fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:12 },
  terms:           { fontSize:10, color:"#444", textAlign:"center", lineHeight:1.5 },
  bottom:          { padding:"0 24px 40px" },
  dots:            { display:"flex", justifyContent:"center", gap:6, marginBottom:16 },
  dot:             { width:6, height:6, borderRadius:3, background:"#333", transition:"all 0.3s ease" },
  dotActive:       { width:20, background:"#7c6dfa" },
  btnPrimary:      { width:"100%", padding:16, background:"#7c6dfa", border:"none", borderRadius:14, color:"#fff", fontFamily:"inherit", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:10 },
  btnSkip:         { width:"100%", padding:10, background:"transparent", border:"none", color:"#444", fontFamily:"inherit", fontSize:13, cursor:"pointer" },
};
