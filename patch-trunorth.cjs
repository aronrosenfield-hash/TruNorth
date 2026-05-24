/**
 * patch-trunorth.cjs
 * Run from: ~/trunorth/
 * Command: node patch-trunorth.cjs
 *
 * Fixes:
 * 1. Header safe-area padding (logo cut off on iPhone)
 * 2. Splash arrow matches app logo arrow (SVG polygon)
 * 3. Union question wording fixed
 * 4. Email input autocomplete for saved emails
 * 5. Paywall screen fits without scrolling
 * 6. Remove Live Update button from company cards
 * 7. Scoring spread improved (more A/B/F, fewer C)
 * 8. Account screen - slim About, add login details section
 */

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "src", "App.jsx");
const SPLASH = path.join(__dirname, "src", "SplashScreen.jsx");

let app = fs.readFileSync(APP, "utf8");
let splash = fs.readFileSync(SPLASH, "utf8");

let changes = [];

// ─── FIX 1: Header safe-area top padding ─────────────────────────────────────
// Add paddingTop that accounts for iPhone notch/dynamic island
const oldHeader = `padding:"16px 16px 12px", background:T.bg, position:"sticky", top:0, zIndex:10, borderBottom:\`1px solid \${T.border}\``;
const newHeader = `padding:"env(safe-area-inset-top, 16px) 16px 12px", background:T.bg, position:"sticky", top:0, zIndex:10, borderBottom:\`1px solid \${T.border}\``;
if (app.includes(oldHeader)) {
  app = app.replace(oldHeader, newHeader);
  changes.push("✅ Fix 1: Header safe-area padding added");
} else {
  changes.push("⚠️  Fix 1: Header padding pattern not found — check manually");
}

// ─── FIX 2: App logo in header — replace leaf icon with SVG arrow ─────────────
// The header currently shows a leaf icon, replace with the same SVG polygon as splash
const oldLogoIcon = `<i className="ti ti-leaf" style={{ fontSize:18, color:T.accent2 }} aria-hidden="true" />`;
const newLogoIcon = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#7c6dfa"/></svg>`;
if (app.includes(oldLogoIcon)) {
  app = app.replace(oldLogoIcon, newLogoIcon);
  changes.push("✅ Fix 2: App header logo now uses SVG arrow matching splash");
} else {
  changes.push("⚠️  Fix 2: Leaf icon pattern not found — check manually");
}

// ─── FIX 3: Union question wording ───────────────────────────────────────────
const oldUnion = `{v:"anti",   l:"I avoid companies that operate without union involvement",         icon:"ti-x"},`;
const newUnion = `{v:"anti",   l:"I prefer companies that operate without union involvement",        icon:"ti-x"},`;
if (app.includes(oldUnion)) {
  app = app.replace(oldUnion, newUnion);
  changes.push("✅ Fix 3: Union question wording fixed");
} else {
  changes.push("⚠️  Fix 3: Union question pattern not found — check manually");
}

// ─── FIX 4: Email input autocomplete ─────────────────────────────────────────
const oldEmailInput = `<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your email to subscribe"
          style={{ width:"100%", background:T.bg3, border:\`1px solid \${T.border2}\`, borderRadius:10, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:10 }} />`;
const newEmailInput = `<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your email to subscribe"
          style={{ width:"100%", background:T.bg3, border:\`1px solid \${T.border2}\`, borderRadius:10, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:10 }} />`;
if (app.includes(oldEmailInput)) {
  app = app.replace(oldEmailInput, newEmailInput);
  changes.push("✅ Fix 4: Paywall email input has autocomplete='email'");
} else {
  changes.push("⚠️  Fix 4: Email input pattern not found — check manually");
}

// ─── FIX 5: Paywall screen — reduce padding so it fits without scrolling ──────
const oldPaywallPad = `padding:"24px 20px 40px", width:"100%", maxWidth:430, maxHeight:"90vh", overflowY:"auto"`;
const newPaywallPad = `padding:"16px 18px 28px", width:"100%", maxWidth:430, maxHeight:"92vh", overflowY:"auto"`;
if (app.includes(oldPaywallPad)) {
  app = app.replace(oldPaywallPad, newPaywallPad);
  changes.push("✅ Fix 5a: Paywall padding tightened");
} else {
  changes.push("⚠️  Fix 5a: Paywall padding pattern not found — check manually");
}

// Also reduce the feature list padding
const oldFeaturePad = `padding:"10px 14px", marginBottom:16`;
const newFeaturePad = `padding:"8px 12px", marginBottom:10`;
if (app.includes(oldFeaturePad)) {
  app = app.replace(oldFeaturePad, newFeaturePad);
  changes.push("✅ Fix 5b: Paywall feature list padding tightened");
} else {
  changes.push("⚠️  Fix 5b: Feature pad pattern not found");
}

// Tighten logo area
const oldLogoArea = `marginBottom:20 }}>`;
const newLogoArea = `marginBottom:12 }}>`;
// Only replace first occurrence (in paywall)
const logoIdx = app.indexOf(oldLogoArea);
if (logoIdx !== -1) {
  app = app.slice(0, logoIdx) + newLogoArea + app.slice(logoIdx + oldLogoArea.length);
  changes.push("✅ Fix 5c: Paywall logo margin tightened");
}

// ─── FIX 6: Remove Live Update button and panel from CompanyCard ──────────────
// Remove the live update state variables
const oldLiveState = `  const [showLive, setShowLive] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [liveState, setLiveState] = useState("idle");`;
const newLiveState = ``;
if (app.includes(oldLiveState)) {
  app = app.replace(oldLiveState, newLiveState);
  changes.push("✅ Fix 6a: Live update state variables removed");
} else {
  changes.push("⚠️  Fix 6a: Live state vars not found");
}

// Remove doLive function
const oldDoLive = `  const doLive = async () => {
    setShowLive(true);
    setLiveState("loading");
    const d = await fetchLiveData(company.name);
    setLiveData(d);
    setLiveState(d ? "done" : "error");
  };`;
if (app.includes(oldDoLive)) {
  app = app.replace(oldDoLive, "");
  changes.push("✅ Fix 6b: doLive function removed");
} else {
  changes.push("⚠️  Fix 6b: doLive function not found");
}

// Remove the Actions buttons div (Live update + Share)
const oldActions = `          {/* Actions */}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={doLive} style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.demBg, border:\`1px solid \${T.dem}\`, color:T.dem }}>
              <i className={\`ti ti-refresh\${liveState==="loading"?" spin":""}\`} aria-hidden="true" />
              Live update
            </button>
            <button style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.accentBg, border:\`1px solid \${T.accent}\`, color:T.accent2 }}>
              <i className="ti ti-share" aria-hidden="true" />
              Share
            </button>
          </div>`;
if (app.includes(oldActions)) {
  app = app.replace(oldActions, `          {/* Share button */}
          <div style={{ display:"flex", gap:8 }}>
            <button style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.accentBg, border:\`1px solid \${T.accent}\`, color:T.accent2 }}>
              <i className="ti ti-share" aria-hidden="true" />
              Share
            </button>
          </div>`);
  changes.push("✅ Fix 6c: Live update button removed, Share kept");
} else {
  changes.push("⚠️  Fix 6c: Actions div not found");
}

// Remove live panel
const oldLivePanel = `          {/* Live panel */}
          {showLive && (
            <div style={{ background:T.bg3, borderRadius:12, border:\`1px solid \${T.dem}\`, padding:14, marginTop:10 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.dem, display:"flex", alignItems:"center", gap:6 }}>
                  <i className={\`ti ti-refresh\${liveState==="loading"?" spin":""}\`} aria-hidden="true" />
                  {liveState==="loading" ? \`Searching for latest on \${company.name}...\` : \`Latest on \${company.name}\`}
                </div>
                <button onClick={()=>setShowLive(false)} style={{ background:"none", border:"none", color:T.txt3, fontSize:20, cursor:"pointer" }}>×</button>
              </div>
              {liveState==="error" && <p style={{ fontSize:13, color:T.rep }}>Could not fetch live data. Try again.</p>}
              {liveState==="done" && liveData && (
                <>
                  {["political","environment","labor","dei","animals"].filter(f=>liveData[f]).map(f=>(
                    <div key={f} style={{ display:"flex", gap:8, fontSize:13, color:T.txt2, lineHeight:1.6, marginBottom:8 }}>
                      <i className={\`ti \${CAT_ICONS[f]}\`} style={{ fontSize:13, color:T.txt3, flexShrink:0, marginTop:2 }} aria-hidden="true" />
                      <div><span style={{ fontWeight:600, color:T.txt3, fontSize:11, textTransform:"uppercase" }}>{CAT_LABELS[f]}: </span>{liveData[f]}</div>
                    </div>
                  ))}
                  {!["political","environment","labor","dei","animals"].some(f=>liveData[f]) && (
                    <p style={{ fontSize:13, color:T.txt3 }}>No major recent updates found.</p>
                  )}
                </>
              )}
            </div>
          )}`;
if (app.includes(oldLivePanel)) {
  app = app.replace(oldLivePanel, "");
  changes.push("✅ Fix 6d: Live panel removed");
} else {
  changes.push("⚠️  Fix 6d: Live panel not found");
}

// ─── FIX 7: Scoring spread — widen the distribution ──────────────────────────
// Current scoreGrade thresholds create too many C's
// Old: A>=80, B>=70, C>=55, D>=40, F<40
// New: A>=75, B>=62, C>=48, D>=35, F<35
const oldGrade = `function scoreGrade(n) {
  if (n >= 80) return "A";
  if (n >= 70) return "B";
  if (n >= 55) return "C";
  if (n >= 40) return "D";
  return "F";
}`;
const newGrade = `function scoreGrade(n) {
  if (n >= 75) return "A";
  if (n >= 62) return "B";
  if (n >= 48) return "C";
  if (n >= 35) return "D";
  return "F";
}`;
if (app.includes(oldGrade)) {
  app = app.replace(oldGrade, newGrade);
  changes.push("✅ Fix 7: Score thresholds widened (more A/B/F spread)");
} else {
  changes.push("⚠️  Fix 7: scoreGrade function not found");
}

// Also widen scoreCat ranges to give more extreme values
// Boost positives and lower negatives for better spread
const oldPositiveLine = `  if (["positive","excellent","strong","good"].includes(val)) return 90;`;
const newPositiveLine = `  if (["positive","excellent","strong","good"].includes(val)) return 88;`;
if (app.includes(oldPositiveLine)) {
  app = app.replace(oldPositiveLine, newPositiveLine);
}
const oldNegativeLine = `  if (["negative","poor","below average"].includes(val)) return 20;`;
const newNegativeLine = `  if (["negative","poor","below average"].includes(val)) return 18;`;
if (app.includes(oldNegativeLine)) {
  app = app.replace(oldNegativeLine, newNegativeLine);
}

// ─── FIX 8: Account screen — slim About, add login details ───────────────────
const oldAboutSection = `          {/* App info */}
          <div style={{ background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:16, padding:16 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>About TruNorth</div>
            {[
              ["Companies in database", deduped.length.toLocaleString()],
              ["Data sources", "FEC, OSHA, NLRB, SEC, CDP, PETA, HRC"],
              ["Last updated", "May 2026"],
              ["Version", "2.0"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:\`1px solid \${T.border}\`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>{label}</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{val}</span>
              </div>
            ))}
          </div>`;

const newAboutSection = `          {/* Login details */}
          {currentUser && (
            <div style={{ background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:16, padding:16, marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>Account details</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:\`1px solid \${T.border}\`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Email</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{currentUser.email || "Guest"}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:\`1px solid \${T.border}\`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Plan</span>
                <span style={{ color:isPaid ? T.gold : T.txt2, fontWeight:600 }}>{isPaid ? "Pro" : "Free"}</span>
              </div>
              <button style={{ width:"100%", marginTop:12, padding:10, borderRadius:10, border:\`1px solid \${T.border2}\`, background:"transparent", color:T.txt3, fontSize:13, cursor:"pointer" }}
                onClick={() => { if(window.confirm("Sign out?")) { localStorage.clear(); window.location.reload(); } }}>
                Sign out
              </button>
            </div>
          )}

          {/* App info — slimmed */}
          <div style={{ background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:16, padding:16 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>About TruNorth</div>
            {[
              ["Companies", deduped.length.toLocaleString()],
              ["Updated", "May 2026"],
              ["Version", "2.0"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:\`1px solid \${T.border}\`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>{label}</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{val}</span>
              </div>
            ))}
          </div>`;

if (app.includes(oldAboutSection)) {
  app = app.replace(oldAboutSection, newAboutSection);
  changes.push("✅ Fix 8: Account screen updated — login details added, About slimmed");
} else {
  changes.push("⚠️  Fix 8: About section not found — check manually");
}

// ─── FIX SPLASH: Make arrow icon use SVG polygon instead of ↑ text ─────────────
const oldSplashIcon = `<div className="tn-splash-icon" style={styles.icon}>↑</div>`;
const newSplashIcon = `<div className="tn-splash-icon" style={styles.icon}>
              <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/>
              </svg>
            </div>`;
if (splash.includes(oldSplashIcon)) {
  splash = splash.replace(oldSplashIcon, newSplashIcon);
  changes.push("✅ Fix Splash: Arrow now uses SVG polygon matching app logo");
} else {
  changes.push("⚠️  Fix Splash: Splash arrow pattern not found");
}

// Also fix OnboardingFlow slide 2 CTA art inner arrow
// (that's inside OnboardingFlow.jsx which we can't edit here, but note it)

// ─── WRITE FILES ──────────────────────────────────────────────────────────────
fs.writeFileSync(APP, app, "utf8");
fs.writeFileSync(SPLASH, splash, "utf8");

console.log("\n🔧 TruNorth Patch Results");
console.log("─".repeat(50));
changes.forEach(c => console.log(" " + c));
console.log("─".repeat(50));
console.log(`\n✅ Done! Now run:`);
console.log(`   git add -A && git commit -m "Fix UI issues — safe area, scoring, account, live update removed" && git push\n`);
