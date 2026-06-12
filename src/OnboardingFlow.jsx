import { useState } from "react";

// QA fix 2026-06-10: these hardcoded "live example" grades had drifted from
// the real bundle (Tesla showed C, actual B; Shein showed D, actual C) — the
// FIRST thing a new user checks is whether the app agrees with itself. Grades
// + detail rows below now mirror public/data/index.json. If a rebake moves
// any of these brands a letter, update this array.
const COMPANIES = [
  { emoji:"🛍️", bg:"#1a2e1a", name:"Costco",    meta:"Retail · Warehouse",     grade:"A", gradeStyle:{background:"#1a3a2a",color:"#4ade80"}, details:[{label:"🌿 Environment",pct:80,color:"#4ade80",grade:"B+"},{label:"🏳️ DEI",pct:82,color:"#4ade80",grade:"A-"},{label:"❤️ Charity",pct:78,color:"#4ade80",grade:"B+"}] },
  { emoji:"🚗", bg:"#1a1a2e", name:"Tesla",     meta:"Automotive · EVs",       grade:"B", gradeStyle:{background:"#1a2810",color:"#8bc34a"}, details:[{label:"🌿 Environment",pct:78,color:"#4ade80",grade:"B+"},{label:"🏳️ DEI",pct:65,color:"#8bc34a",grade:"B"},{label:"⚖️ Labor",pct:35,color:"#fca5a5",grade:"D"}] },
  { emoji:"👗", bg:"#2e1a1a", name:"Shein",     meta:"Apparel · Fast Fashion", grade:"C", gradeStyle:{background:"#2e2a1a",color:"#fde68a"}, details:[{label:"🔒 Privacy",pct:25,color:"#fca5a5",grade:"F"},{label:"🐰 Animals",pct:30,color:"#fca5a5",grade:"D"},{label:"⚖️ Labor",pct:48,color:"#fde68a",grade:"C"}] },
];

const CATEGORIES = [
  { emoji:"🗳️", bg:"#1e2e3e", name:"Political Donations", desc:"FEC: PAC contributions to parties",   pct:65 },
  { emoji:"🌿", bg:"#1e3e2e", name:"Environment",         desc:"EPA violations, pollution penalties",  pct:80 },
  { emoji:"⚖️", bg:"#2e2a1e", name:"Labor Practices",     desc:"OSHA, NLRB, Violation Tracker fines",  pct:55 },
  { emoji:"🏳️‍🌈",bg:"#2a1e3e", name:"DEI",                desc:"Public programs & rollbacks",          pct:70 },
  { emoji:"❤️", bg:"#2e1e2e", name:"Charitable Giving",   desc:"Documented programs & amounts",        pct:45 },
  { emoji:"🐰", bg:"#2e2a1e", name:"Animal Testing",      desc:"PETA & Leaping Bunny certifications", pct:50 },
  { emoji:"🔫", bg:"#3e1e1e", name:"Firearms",            desc:"Sells or manufactures guns",           pct:30 },
  { emoji:"🔒", bg:"#1e2e3e", name:"Data Privacy",        desc:"HIBP breaches, FTC actions",           pct:60 },
  { emoji:"💵", bg:"#1e3e2e", name:"Executive Pay",       desc:"CEO-to-worker pay ratio",              pct:40 },
];

export default function OnboardingFlow({ onComplete }) {
  // Review fix (2026-06-11): was 3 slides before the quiz (7 screens total
  // before a user touched a real brand). Slide 1 (the 9-category tour)
  // duplicated what the quiz itself teaches, and slide 2 was a second value
  // prop. Now ONE screen: hook + interactive live example + proof stats +
  // consent line → straight to the app. Time-to-first-brand: 2 taps.
  const [expandedCo, setExpandedCo] = useState(null);

  function handleNext() {
    localStorage.setItem("tn_hasOnboarded", "1");
    try { sessionStorage.setItem("tn_justOnboarded", String(Date.now())); } catch {}
    onComplete({ email: null, isGuest: true });
  }

  return (
    <div style={s.wrap}>
      <div style={s.slideWrap}>
        <div style={s.slide}>
          <div style={s.eyebrow}>Know where your money goes</div>
          <h1 style={s.headline}>Your wallet<br />is a <em style={{ color:"#7c6dfa", fontStyle:"normal" }}>vote.</em><br />Cast it wisely.</h1>
          <p style={s.subtext}>Every brand graded on 9 things that matter — politics, environment, labor & more — from public records only. Real records, not opinions.</p>
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
          <div style={{ ...s.statsRow, marginTop:22 }}>
            {[["12,000+","Companies"],["9","Categories"],["200+","Public sources"]].map(([num,label]) => (
              <div key={label} style={{ textAlign:"center" }}>
                <div style={s.statNum}>{num}</div>
                <div style={s.statLabel}>{label}</div>
              </div>
            ))}
          </div>
          <p style={{ ...s.terms, marginTop:14 }}>By continuing you agree to our <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer" style={{ color:"#7c6dfa", textDecoration:"none" }}>Terms</a> & <a href="https://www.trunorthapp.com/#privacy" target="_blank" rel="noopener noreferrer" style={{ color:"#7c6dfa", textDecoration:"none" }}>Privacy Policy</a>.</p>
        </div>
      </div>

      <div style={s.bottom}>
        <button style={s.btnPrimary} onClick={handleNext}>Start exploring →</button>
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
  bottom:          { padding:"0 24px calc(40px + env(safe-area-inset-bottom, 0px))" },
  dots:            { display:"flex", justifyContent:"center", gap:6, marginBottom:16 },
  dot:             { width:6, height:6, borderRadius:3, background:"#333", transition:"all 0.3s ease" },
  dotActive:       { width:20, background:"#7c6dfa" },
  btnPrimary:      { width:"100%", padding:16, background:"#7c6dfa", border:"none", borderRadius:14, color:"#fff", fontFamily:"inherit", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:10 },
  btnSkip:         { width:"100%", padding:10, background:"transparent", border:"none", color:"#444", fontFamily:"inherit", fontSize:13, cursor:"pointer" },
};
