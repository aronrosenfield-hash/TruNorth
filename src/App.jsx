import { COMPANIES } from './companies.js';
import { useState, useEffect } from "react";

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body, #root { background: #0f0f0f; min-height: 100vh; width: 100%; max-width: 100%; overflow-x: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; color: #f2f2f2; }
  input, textarea, select, button { font-family: inherit; }
  input:focus, textarea:focus, select:focus { outline: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 0.7s linear infinite; display: inline-block; }
  ::placeholder { color: #555; }
`;

const T = {
  bg:"#0f0f0f", bg2:"#1a1a1a", bg3:"#242424", bg4:"#2e2e2e",
  txt:"#f2f2f2", txt2:"#a8a8a8", txt3:"#666",
  border:"#2a2a2a", border2:"#3a3a3a",
  accent:"#7c6dfa", accent2:"#9d91ff", accentBg:"#1e1b3a",
  dem:"#4a90e2", demBg:"#0d1f35",
  rep:"#e24a4a", repBg:"#350d0d",
  gold:"#f0c040", goldBg:"#2a2005",
};

// ─── SYMBOL SYSTEM (replaces color bars) ─────────────────────────────────────
// Instead of colors, we use symbols + plain text labels
const SYMBOLS = {
  positive:    { sym: "✓", label: "Positive"      },
  excellent:   { sym: "✓✓", label: "Excellent"   },
  strong:      { sym: "✓", label: "Strong"        },
  good:        { sym: "✓", label: "Good"          },
  mixed:       { sym: "~", label: "Mixed"         },
  neutral:     { sym: "–", label: "Neutral"       },
  unknown:     { sym: "?", label: "Unknown"       },
  negative:    { sym: "✗", label: "Negative"      },
  poor:        { sym: "✗", label: "Poor"          },
  "very poor": { sym: "✗✗", label: "Very Poor"   },
  "below average":{ sym:"✗", label:"Below Avg"   },
  // political / DEI lean
  left:            { sym: "◀", label: "Left-leaning"  },
  "left-leaning":  { sym: "◀", label: "Left-leaning"  },
  right:           { sym: "▶", label: "Right-leaning" },
  "right-leaning": { sym: "▶", label: "Right-leaning" },
  bipartisan:      { sym: "◆", label: "Bipartisan"    },
  mixed_pol:       { sym: "◆", label: "Mixed"         },
  // DEI stance
  pro_dei:         { sym: "✓", label: "Pro-DEI"       },
  anti_dei:        { sym: "✗", label: "Anti-DEI"      },
  // animal testing
  cruelty_free:    { sym: "✓", label: "Cruelty-Free"  },
  tests_animals:   { sym: "✗", label: "Tests on Animals" },
  some_testing:    { sym: "~", label: "Some Testing"  },
  na:              { sym: "–", label: "N/A"            },
  // guns
  sells_guns:      { sym: "✗", label: "Sells Guns"    },
  makes_guns:      { sym: "✗", label: "Makes Guns"    },
  no_guns:         { sym: "✓", label: "No Gun Sales"  },
};

function getSymbol(val) {
  return SYMBOLS[(val||"").toLowerCase()] || { sym: "–", label: val || "Unknown" };
}

// ─── COMPANY DATA ─────────────────────────────────────────────────────────────

// ─── QUIZ STEPS ───────────────────────────────────────────────────────────────
const QUIZ_STEPS = [
  { id:"politicalLean", type:"single", q:"When a company donates to political campaigns, which direction do you prefer?",
    opts:[
      {v:"right",  l:"I prefer companies that support Republican / conservative causes", icon:"rep"},
      {v:"left",   l:"I prefer companies that support Democratic / progressive causes",  icon:"dem"},
      {v:"neutral",l:"I prefer companies that stay completely out of politics",           icon:null},
      {v:"neutral",l:"Political donations do not affect where I shop",                   icon:null},
    ]},
  { id:"politicalImportance", type:"scale", q:"How much does a company's political lean affect your buying decisions?", lo:"No influence", hi:"Strong influence" },
  { id:"deiLean", type:"single", q:"How do you feel about DEI (Diversity, Equity and Inclusion) programs at companies?",
    opts:[
      {v:"pro",    l:"Positive — I seek out companies with strong DEI programs",         icon:"ti-heart"},
      {v:"anti",   l:"Negative — I do not want companies that push DEI agendas",         icon:"ti-x"},
      {v:"neutral",l:"Neutral — DEI programs do not factor into my shopping",            icon:null},
    ]},
  { id:"deiImportance", type:"scale", q:"How much does a company's DEI stance influence where you shop?", lo:"No influence", hi:"Strong influence" },
  { id:"envImportance", type:"scale", q:"How much does a company's environmental record affect your buying choices?", lo:"Does not concern me", hi:"Major concern" },
  { id:"laborImportance", type:"scale", q:"How important is it that companies treat their workers well?", lo:"Does not concern me", hi:"Major concern" },
  { id:"unionSupport", type:"single", q:"How do you feel about companies and organized labor unions?",
    opts:[
      {v:"pro",    l:"I prefer companies that respect and support unions",               icon:"ti-users"},
      {v:"anti",   l:"I avoid companies that operate without union involvement",         icon:"ti-x"},
      {v:"neutral",l:"Union policy does not factor into my shopping",                   icon:null},
    ]},
  { id:"animalTesting", type:"single", q:"How do you feel about companies that test products on animals?",
    opts:[
      {v:"dealbreaker",l:"Dealbreaker — I will not buy from companies that test on animals", icon:"ti-paw"},
      {v:"prefer_not", l:"I prefer cruelty-free but it is not a dealbreaker",               icon:"ti-paw"},
      {v:"neutral",    l:"Animal testing does not factor into my shopping decisions",        icon:null},
    ]},
  { id:"guns", type:"single", q:"How do you feel about companies that sell or manufacture firearms?",
    opts:[
      {v:"support",  l:"I prefer companies that support Second Amendment rights",       icon:"ti-check"},
      {v:"avoid",    l:"I avoid companies that sell or manufacture guns",               icon:"ti-x"},
      {v:"neutral",  l:"Gun sales do not factor into my shopping choices",              icon:null},
    ]},
  { id:"privacy", type:"scale", q:"How much does a company selling or misusing your personal data concern you?", lo:"Does not concern me", hi:"Major concern" },
  { id:"execPay", type:"scale", q:"Does it bother you when CEOs earn hundreds of times more than their workers?", lo:"Does not concern me", hi:"Major concern" },
  { id:"madeInUSA", type:"single", q:"How important is it that a company manufactures products in the USA?",
    opts:[
      {v:"important",  l:"Very important — I actively seek out Made in USA products",   icon:"ti-flag"},
      {v:"prefer",     l:"I prefer it but it is not a dealbreaker",                     icon:"ti-flag"},
      {v:"neutral",    l:"Country of manufacture does not affect my shopping",          icon:null},
    ]},
  { id:"charityImportance", type:"scale", q:"How much does a company's charitable giving influence where you spend?", lo:"Does not concern me", hi:"Major concern" },
  { id:"dealBreakers", type:"multi", q:"Select any topics that are absolute dealbreakers for you:",
    sub:"Companies with poor records in these areas will be heavily penalized in your scores.",
    opts:[
      {v:"environment",   l:"Environmental violations or pollution",                    icon:"ti-leaf"},
      {v:"labor",         l:"Poor treatment of workers",                               icon:"ti-users"},
      {v:"privacy",       l:"Selling or misusing customer data",                       icon:"ti-lock"},
      {v:"execPay",       l:"Extreme executive pay gaps",                              icon:"ti-coin"},
      {v:"forcedLabor",   l:"Supply chain forced labor or modern slavery",             icon:"ti-link"},
      {v:"taxAvoidance",  l:"Aggressive tax avoidance using offshore havens",          icon:"ti-building-bank"},
      {v:"predatoryPrice",l:"Predatory pricing on essential goods",                    icon:"ti-tag"},
      {v:"darkPatterns",  l:"Addictive design or dark patterns targeting users",       icon:"ti-device-mobile"},
      {v:"foreignOwn",    l:"Owned or controlled by a foreign adversarial government", icon:"ti-world"},
      {v:"monopoly",      l:"Monopolistic behavior or antitrust violations",           icon:"ti-crown"},
      {v:"childLabor",    l:"Child labor in supply chain",                             icon:"ti-baby-carriage"},
    ]},
];

// ─── SCORING ENGINE ───────────────────────────────────────────────────────────
const CAT_KEYS = ["political","charity","environment","labor","dei","animals","guns","privacy","execPay"];
const CAT_LABELS = {political:"Political",charity:"Charity",environment:"Environ.",labor:"Labor",dei:"DEI",animals:"Animal Testing",guns:"Firearms",privacy:"Data Privacy",execPay:"Exec Pay"};
const CAT_ICONS  = {political:"ti-flag-2",charity:"ti-heart",environment:"ti-leaf",labor:"ti-users",dei:"ti-rainbow",animals:"ti-paw",guns:"ti-target",privacy:"ti-lock",execPay:"ti-coin"};
const CAT_FULL   = {political:"Political donations & lobbying",charity:"Charitable giving",environment:"Environmental policy",labor:"Labor practices",dei:"DEI & social equity",animals:"Animal testing",guns:"Firearms policy",privacy:"Data privacy",execPay:"Executive pay ratio"};

function scoreCat(k, v, profile) {
  const val = (v || "").toLowerCase();

  if (k === "political") {
    const lean = profile?.lean || "neutral";
    if (lean === "left")   { if (["left","left-leaning"].includes(val)) return 95; if (["bipartisan","mixed"].includes(val)) return 60; if (val==="neutral") return 50; return 15; }
    if (lean === "right")  { if (["right","right-leaning"].includes(val)) return 95; if (["bipartisan","mixed"].includes(val)) return 60; if (val==="neutral") return 50; return 15; }
    if (["bipartisan","mixed"].includes(val)) return 80; if (val==="neutral") return 75; return 55;
  }

  if (k === "dei") {
    const deiLean = profile?.deiLean || "neutral";
    if (deiLean === "pro")  { if (val==="pro_dei") return 95; if (val==="mixed") return 55; if (val==="neutral") return 50; return 10; }
    if (deiLean === "anti") { if (val==="anti_dei") return 95; if (val==="mixed") return 55; if (val==="neutral") return 50; return 10; }
    return 60; // neutral user — DEI stance doesn't strongly affect score
  }

  if (k === "animals") {
    const pref = profile?.animalTesting || "neutral";
    if (pref === "dealbreaker") { if (val==="cruelty_free") return 95; if (val==="some_testing") return 20; if (val==="tests_animals") return 0; return 50; }
    if (pref === "prefer_not")  { if (val==="cruelty_free") return 90; if (val==="some_testing") return 55; if (val==="tests_animals") return 25; return 50; }
    return 60; // neutral
  }

  if (k === "guns") {
    const pref = profile?.guns || "neutral";
    if (pref === "avoid")   { if (val==="no_guns") return 90; if (val==="sells_guns") return 15; if (val==="makes_guns") return 5; return 50; }
    if (pref === "support") { if (["sells_guns","makes_guns"].includes(val)) return 90; if (val==="no_guns") return 40; return 60; }
    return 60; // neutral
  }

  if (k === "privacy") {
    if (val==="good") return 90; if (val==="mixed") return 55; if (val==="poor") return 15; return 50;
  }

  if (k === "execPay") {
    if (["fair","good"].includes(val)) return 85; if (val==="mixed") return 60; if (val==="poor") return 20; return 50;
  }

  // charity, environment, labor
  if (["positive","excellent","strong","good"].includes(val)) return 90;
  if (val==="mixed") return 55; if (val==="neutral") return 50;
  if (["negative","poor","below average"].includes(val)) return 20;
  if (val==="very poor") return 5;
  return 50;
}

function computeScore(co, profile) {
  if (!profile) return co.overall;
  const baseWeights = {
    political:    profile.weights?.political    || 3,
    charity:      profile.weights?.charity      || 2,
    environment:  profile.weights?.environment  || 3,
    labor:        profile.weights?.labor        || 3,
    dei:          profile.weights?.dei          || 3,
    animals:      profile.weights?.animals      || 2,
    guns:         profile.weights?.guns         || 2,
    privacy:      profile.weights?.privacy      || 2,
    execPay:      profile.weights?.execPay      || 2,
  };
  const total = Object.values(baseWeights).reduce((a,b) => a+b, 0);
  const ws = CAT_KEYS.reduce((sum, k) => sum + scoreCat(k, co.sc[k], profile) * baseWeights[k], 0) / total;
  const pen = (profile.dealBreakers || []).reduce((p, db) => {
    // Standard category dealbreakers
    if (["environment","labor","privacy","execPay","animals","guns","charity"].includes(db)) {
      const v = (co.sc[db] || "").toLowerCase();
      const bad = ["negative","poor","very poor","below average","tests_animals","sells_guns","makes_guns"];
      return bad.includes(v) ? p + 20 : p;
    }
    // Extended dealbreakers — penalize if company has known issues
    if (db === "forcedLabor"    && (co.sc.labor||"").toLowerCase() === "poor") return p + 25;
    if (db === "taxAvoidance"   && (co.sc.execPay||"").toLowerCase() === "poor") return p + 15;
    if (db === "predatoryPrice" && (co.sc.labor||"").toLowerCase() === "poor") return p + 15;
    if (db === "darkPatterns"   && (co.sc.privacy||"").toLowerCase() === "poor") return p + 20;
    if (db === "foreignOwn"     && co.foreignOwned) return p + 30;
    if (db === "monopoly"       && co.antitrust) return p + 25;
    if (db === "childLabor"     && co.childLabor) return p + 30;
    return p;
  }, 0);
  // Animal testing dealbreaker
  if (profile.animalTesting === "dealbreaker" && (co.sc.animals === "tests_animals")) return Math.min(ws - 40, 30);
  return Math.max(0, Math.min(100, Math.round(ws - pen)));
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────────────────
function getDisplay(k, val, profile) {
  const v = (val || "").toLowerCase();

  // Political
  if (k === "political") {
    if (["left","left-leaning"].includes(v)) return { sym: "◀", label: "Left-leaning",  icon: "dem" };
    if (["right","right-leaning"].includes(v)) return { sym: "▶", label: "Right-leaning", icon: "rep" };
    if (["bipartisan","mixed"].includes(v)) return { sym: "◆", label: "Bipartisan / Mixed", icon: "bi" };
    return { sym: "–", label: "Neutral / Unknown", icon: null };
  }

  // DEI — show based on user's stance
  if (k === "dei") {
    if (v === "pro_dei")  return { sym: "✓", label: "Pro-DEI programs",  icon: null };
    if (v === "anti_dei") return { sym: "✗", label: "Anti-DEI / Removed DEI", icon: null };
    return { sym: "~", label: "Mixed / Neutral",  icon: null };
  }

  // Animals
  if (k === "animals") {
    if (v === "cruelty_free")  return { sym: "✓", label: "Cruelty-Free", icon: null };
    if (v === "tests_animals") return { sym: "✗", label: "Tests on Animals", icon: null };
    if (v === "some_testing")  return { sym: "~", label: "Some Testing", icon: null };
    return { sym: "–", label: "N/A", icon: null };
  }

  // Guns
  if (k === "guns") {
    if (v === "no_guns")   return { sym: "✓", label: "Does Not Sell Guns", icon: null };
    if (v === "sells_guns") return { sym: "✗", label: "Sells Guns / Ammo", icon: null };
    if (v === "makes_guns") return { sym: "✗", label: "Manufactures Guns", icon: null };
    return { sym: "–", label: "N/A", icon: null };
  }

  // Privacy
  if (k === "privacy") {
    if (v === "good")  return { sym: "✓", label: "Good Privacy Practices", icon: null };
    if (v === "mixed") return { sym: "~", label: "Mixed Privacy Record",   icon: null };
    if (v === "poor")  return { sym: "✗", label: "Poor Privacy Practices", icon: null };
    return { sym: "–", label: "Unknown", icon: null };
  }

  // Exec pay
  if (k === "execPay") {
    if (["fair","good"].includes(v)) return { sym: "✓", label: "Reasonable Pay Ratio", icon: null };
    if (v === "mixed")  return { sym: "~", label: "Mixed Pay Ratio",    icon: null };
    if (v === "poor")   return { sym: "✗", label: "Extreme Pay Gap",    icon: null };
    return { sym: "–", label: "Not Disclosed", icon: null };
  }

  // Others (charity, environment, labor)
  if (["positive","excellent","strong","good"].includes(v)) return { sym: "✓", label: v.charAt(0).toUpperCase() + v.slice(1), icon: null };
  if (v === "mixed")   return { sym: "~", label: "Mixed",      icon: null };
  if (v === "neutral") return { sym: "–", label: "Neutral",    icon: null };
  if (["negative","poor","below average"].includes(v)) return { sym: "✗", label: v.charAt(0).toUpperCase() + v.slice(1), icon: null };
  if (v === "very poor") return { sym: "✗✗", label: "Very Poor", icon: null };
  return { sym: "–", label: "Unknown", icon: null };
}

// Score text grade
function scoreGrade(n) {
  if (n >= 80) return "A";
  if (n >= 70) return "B";
  if (n >= 55) return "C";
  if (n >= 40) return "D";
  return "F";
}

// ─── SVG ICONS ────────────────────────────────────────────────────────────────
function DonkeySVG({ size=14, col="#4a90e2" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <ellipse cx="30" cy="42" rx="22" ry="14" fill={col}/>
      {/* Head */}
      <ellipse cx="50" cy="34" rx="11" ry="10" fill={col}/>
      {/* Long ears */}
      <ellipse cx="45" cy="22" rx="4" ry="8" fill={col}/>
      <ellipse cx="56" cy="20" rx="3" ry="7" fill={col}/>
      {/* Legs */}
      <rect x="12" y="53" width="6" height="10" rx="3" fill={col}/>
      <rect x="22" y="53" width="6" height="10" rx="3" fill={col}/>
      <rect x="34" y="53" width="6" height="9" rx="3" fill={col}/>
      <rect x="44" y="53" width="6" height="9" rx="3" fill={col}/>
      {/* Tail */}
      <path d="M8 42 Q2 36 8 30" stroke={col} strokeWidth="3" strokeLinecap="round" fill="none"/>
      {/* Eye */}
      <circle cx="54" cy="32" r="1.5" fill="white"/>
      {/* Snout */}
      <ellipse cx="60" cy="38" rx="4" ry="3" fill={col}/>
      <circle cx="59" cy="38" r="1" fill="rgba(0,0,0,0.2)"/>
      <circle cx="61" cy="38" r="1" fill="rgba(0,0,0,0.2)"/>
    </svg>
  );
}

function ElephantSVG({ size=14, col="#e24a4a" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <ellipse cx="34" cy="40" rx="22" ry="16" fill={col}/>
      {/* Head */}
      <circle cx="16" cy="34" r="14" fill={col}/>
      {/* Big ears */}
      <ellipse cx="6" cy="30" rx="7" ry="11" fill={col} opacity="0.7"/>
      {/* Trunk */}
      <path d="M10 42 Q4 48 8 56 Q10 60 14 58 Q12 54 14 48 Q16 44 12 42Z" fill={col}/>
      {/* Tusks */}
      <path d="M14 46 Q8 50 10 56" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.8"/>
      {/* Legs */}
      <rect x="16" y="53" width="7" height="10" rx="3" fill={col}/>
      <rect x="27" y="53" width="7" height="10" rx="3" fill={col}/>
      <rect x="38" y="53" width="7" height="9" rx="3" fill={col}/>
      <rect x="49" y="53" width="7" height="9" rx="3" fill={col}/>
      {/* Tail */}
      <path d="M56 38 Q62 34 58 28" stroke={col} strokeWidth="3" strokeLinecap="round" fill="none"/>
      {/* Eye */}
      <circle cx="12" cy="30" r="2" fill="white"/>
      <circle cx="12" cy="30" r="1" fill="rgba(0,0,0,0.4)"/>
    </svg>
  );
}

// ─── PAYWALL ─────────────────────────────────────────────────────────────────
function PaywallScreen({ onSubscribe, onClose }) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");

  const handleSubscribe = () => {
    if (!email.includes("@")) { alert("Please enter a valid email."); return; }
    setLoading(true);
    // In production: call Stripe Checkout API here
    setTimeout(() => {
      setLoading(false);
      onSubscribe();
    }, 1500);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:T.bg2, borderRadius:"24px 24px 0 0", border:`1px solid ${T.border2}`, padding:"24px 20px 40px", width:"100%", maxWidth:430, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ width:40, height:4, background:T.bg4, borderRadius:2, margin:"0 auto 20px" }} />

        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:20 }}>
            <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#7c6dfa"/>
              </svg>
            </div>
            <div style={{ fontSize:22, fontWeight:800, color:T.txt, letterSpacing:-0.5 }}>Tru<span style={{ color:T.accent }}>North</span></div>
          </div>
          <div style={{ width:56, height:56, background:T.goldBg, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
            <i className="ti ti-crown" style={{ fontSize:26, color:T.gold }} aria-hidden="true" />
          </div>
          <div style={{ fontSize:20, fontWeight:700, color:T.txt, marginBottom:6 }}>Unlock full details</div>
          <div style={{ fontSize:13, color:T.txt3, lineHeight:1.7, maxWidth:300, margin:"0 auto" }}>
            Free users see company names and badges. Subscribe to unlock full breakdowns, live updates, and personalized scores.
          </div>
        </div>

        <div style={{ background:T.bg3, borderRadius:14, padding:14, marginBottom:16 }}>
          {[
            "Full company details on all 9 categories",
            "Personalization quiz — scores based on YOUR values",
            "Live data updates from OpenSecrets, NLRB & more",
            "Animal testing, gun policy, privacy & exec pay data",
            "Multi-category filtering",
            "Full data sources directory",
          ].map((f, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0", borderBottom: i<4 ? `1px solid ${T.border}` : "none" }}>
              <span style={{ color:T.gold, fontSize:14, flexShrink:0 }}>✓</span>
              <span style={{ fontSize:13, color:T.txt2 }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, borderRadius:12, padding:"10px 14px", marginBottom:16, textAlign:"center" }}>
          <span style={{ fontSize:22, fontWeight:700, color:T.gold }}>$1.99</span>
          <span style={{ fontSize:13, color:T.txt3 }}> / month · Cancel anytime</span>
        </div>

        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your email to subscribe"
          style={{ width:"100%", background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:10, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:10 }} />

        <button onClick={handleSubscribe} disabled={loading}
          style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:10 }}>
          {loading ? "Processing..." : "Subscribe for $1.99/mo"}
        </button>

        <div style={{ fontSize:11, color:T.txt3, textAlign:"center", marginBottom:10 }}>
          Secure payment · Cancel anytime · No contracts
        </div>

        <button onClick={onClose} style={{ width:"100%", padding:11, borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.txt3, fontSize:14, cursor:"pointer" }}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ─── LIVE FETCH ───────────────────────────────────────────────────────────────
async function fetchLiveData(name) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:800,
        tools:[{type:"web_search_20250305",name:"web_search"}],
        messages:[{role:"user",content:`For "${name}", give 2-3 sentence updates on any recent 2024-2025 news about political donations, environmental actions, labor disputes, DEI changes, or animal testing controversies. Return ONLY JSON with no markdown: {"political":null,"environment":null,"labor":null,"dei":null,"animals":null,"sources":[]}`}]
      })
    });
    const data = await res.json();
    const text = data.content?.find(b=>b.type==="text")?.text || "{}";
    return JSON.parse(text.replace(/```json|```/g,"").trim());
  } catch { return null; }
}

// ─── COMPANY CARD ─────────────────────────────────────────────────────────────

// ─── PILL COMPONENT ──────────────────────────────────────────────────────────
const Pill = ({ on, bg, color, border, onClick, children }) => (
  <button onClick={onClick} style={{ padding:"7px 12px", borderRadius:20, fontSize:13, fontWeight:on?600:400, border:`1px solid ${on?border:T.border2}`, background:on?bg:T.bg3, color:on?color:T.txt2, cursor:"pointer", display:"flex", alignItems:"center", gap:5, whiteSpace:"nowrap" }}>
    {children}
  </button>
);

// ─── FILTER PANEL ────────────────────────────────────────────────────────────
const FILTER_GROUPS = [
  {
    id: "political", label: "Political Lean", icon: "ti-flag-2",
    options: [
      { id:"left",    label:"Left",       icon:"dem" },
      { id:"right",   label:"Right",      icon:"rep" },
      { id:"bi",      label:"Bipartisan", icon:"bi"  },
      { id:"neutral", label:"Neutral",    icon:null  },
    ]
  },
  {
    id: "categories", label: "Categories", icon: "ti-adjustments-horizontal",
    options: CAT_KEYS.map(k => ({ id:k, label:CAT_LABELS[k], icon:CAT_ICONS[k] }))
  },
];

function FilterPanel({ leanFilter, setLeanFilter, catFilters, setCatFilters, toggleCat, lc }) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);
  const hasFilters = leanFilter !== "all" || catFilters.length > 0;
  const totalActive = (leanFilter !== "all" ? 1 : 0) + catFilters.length;

  const toggleGroup = (id) => setActiveGroup(g => g === id ? null : id);

  return (
    <div style={{ borderBottom:`1px solid ${T.border}`, background:T.bg2 }}>
      {/* Top bar */}
      <div onClick={()=>{ setOpen(o=>!o); if(open) setActiveGroup(null); }} style={{ display:"flex", alignItems:"center", gap:8, padding:"12px 16px", cursor:"pointer" }}>
        <i className="ti ti-adjustments-horizontal" style={{fontSize:16,color:hasFilters?T.accent2:T.txt3}} aria-hidden="true" />
        <span style={{ fontSize:15, fontWeight:600, color:hasFilters?T.accent2:T.txt2 }}>
          Filter {hasFilters ? `(${totalActive} active)` : ""}
        </span>
        {hasFilters && (
          <button onClick={e=>{e.stopPropagation();setLeanFilter("all");setCatFilters([]);setActiveGroup(null);}}
            style={{fontSize:11,color:T.rep,background:T.repBg,border:`1px solid ${T.rep}`,borderRadius:20,padding:"2px 8px",cursor:"pointer",marginLeft:4}}>
            Clear all
          </button>
        )}
        <i className={"ti "+(open?"ti-chevron-up":"ti-chevron-down")} style={{fontSize:13,color:T.txt3,marginLeft:"auto"}} aria-hidden="true" />
      </div>

      {/* Level 1 — Main categories */}
      {open && (
        <div style={{ borderTop:`1px solid ${T.border}` }}>
          {FILTER_GROUPS.map(group => {
            const isActive = activeGroup === group.id;
            const groupHasFilter = group.id === "political" ? leanFilter !== "all" : catFilters.length > 0;
            return (
              <div key={group.id}>
                {/* Group row */}
                <div onClick={()=>toggleGroup(group.id)}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px", cursor:"pointer", background:isActive?T.bg3:T.bg2, borderBottom:`1px solid ${T.border}` }}>
                  <i className={`ti ${group.icon}`} style={{fontSize:15,color:groupHasFilter?T.accent2:T.txt3}} aria-hidden="true" />
                  <span style={{ fontSize:14, fontWeight:500, color:groupHasFilter?T.accent2:T.txt, flex:1 }}>
                    {group.label}
                    {groupHasFilter && <span style={{fontSize:12,color:T.accent2,marginLeft:6}}>●</span>}
                  </span>
                  <i className={`ti ${isActive?"ti-chevron-up":"ti-chevron-right"}`} style={{fontSize:13,color:T.txt3}} aria-hidden="true" />
                </div>

                {/* Level 2 — Options inside group */}
                {isActive && (
                  <div style={{ background:T.bg3, borderBottom:`1px solid ${T.border}` }}>
                    {group.id === "political" && (
                      <>
                        {[
                          {id:"all", label:"All", extra:""},
                          {id:"left", label:"Left", extra:`${lc.left} companies`},
                          {id:"right", label:"Right", extra:`${lc.right} companies`},
                          {id:"bi", label:"Bipartisan", extra:`${lc.bi} companies`},
                          {id:"neutral", label:"Neutral", extra:`${lc.neutral} companies`},
                        ].map(opt => (
                          <div key={opt.id} onClick={()=>setLeanFilter(opt.id)}
                            style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 20px", cursor:"pointer", borderBottom:`1px solid ${T.border}` }}>
                            <div style={{ width:20, height:20, borderRadius:10, border:`2px solid ${leanFilter===opt.id?T.accent:T.border2}`, background:leanFilter===opt.id?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                              {leanFilter===opt.id && <div style={{width:8,height:8,borderRadius:4,background:"#fff"}} />}
                            </div>
                            <span style={{ fontSize:14, color:leanFilter===opt.id?T.accent2:T.txt, flex:1 }}>{opt.label}</span>
                            {opt.extra && <span style={{ fontSize:12, color:T.txt3 }}>{opt.extra}</span>}
                          </div>
                        ))}
                      </>
                    )}
                    {group.id === "categories" && CAT_KEYS.map(k => (
                      <div key={k} onClick={()=>toggleCat(k)}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 20px", cursor:"pointer", borderBottom:`1px solid ${T.border}` }}>
                        <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${catFilters.includes(k)?T.accent:T.border2}`, background:catFilters.includes(k)?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          {catFilters.includes(k) && <i className="ti ti-check" style={{fontSize:11,color:"#fff"}} aria-hidden="true" />}
                        </div>
                        <i className={`ti ${CAT_ICONS[k]}`} style={{fontSize:14,color:catFilters.includes(k)?T.accent2:T.txt3}} aria-hidden="true" />
                        <span style={{ fontSize:14, color:catFilters.includes(k)?T.accent2:T.txt, flex:1 }}>{CAT_LABELS[k]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function CompanyCard({ company, catFilter, profile, isPaid, onUpgrade }) {
  const [open, setOpen] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [liveData, setLiveData] = useState(null);
  const [liveState, setLiveState] = useState("idle");
  const ps = computeScore(company, profile);
  const grade = scoreGrade(ps);
  const shownCats = catFilter === "all" ? ["political","dei","environment","labor"] : [catFilter];

  const handleTap = () => {
    if (!isPaid) { onUpgrade(); return; }
    setOpen(o => !o);
  };

  const doLive = async () => {
    setShowLive(true);
    setLiveState("loading");
    const d = await fetchLiveData(company.name);
    setLiveData(d);
    setLiveState(d ? "done" : "error");
  };

  return (
    <div style={{ background:T.bg2, borderRadius:14, border:`1px solid ${open ? T.accent : T.border}`, overflow:"hidden", marginBottom:1 }}>
      {/* Slim row — always visible */}
      <div onClick={handleTap} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}>
        <div style={{ width:36, height:36, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0, background:company.ab||T.bg3, color:company.ac||T.accent2 }}>{company.init}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.name}</div>
          <div style={{ fontSize:13, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.cat}</div>
        </div>
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>
          {!isPaid && <i className="ti ti-lock" style={{fontSize:11,color:T.txt3}} aria-hidden="true" />}
          <div style={{ width:38, height:38, borderRadius:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:T.bg3, border:`1px solid ${T.border2}` }}>
            <div style={{ fontSize:isPaid?17:22, fontWeight:700, color:T.txt, lineHeight:1 }}>{grade}</div>
            {isPaid && <div style={{ fontSize:10, color:T.txt3 }}>{ps}</div>}
          </div>
          <i className={`ti ${open ? "ti-chevron-up" : "ti-chevron-down"}`} style={{fontSize:13,color:T.txt3}} aria-hidden="true" />
        </div>
      </div>

      {/* Detail — paid only */}
      {open && isPaid && (
        <div style={{ borderTop:`1px solid ${T.border}`, padding:14, background:T.bg2 }}>
          {/* Score summary */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
            <div style={{ background:T.bg3, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:28, fontWeight:700, color:T.txt, lineHeight:1 }}>{grade}</div>
              <div style={{ fontSize:13, color:T.txt3, marginTop:2 }}>{ps}/100 · {profile ? "your score" : "avg score"}</div>
            </div>
            <div style={{ background:T.bg3, borderRadius:10, padding:"10px 12px", border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:12, fontWeight:500, color:T.txt }}>{company.cat}</div>
              <div style={{ fontSize:11, color:T.txt3, marginTop:4, lineHeight:1.5 }}>
                {profile ? `Based on your preferences` : `Based on average scoring`}
              </div>
            </div>
          </div>

          {/* All categories — symbol + label + detail */}
          {CAT_KEYS.map(k => {
            const d = company[k] || {};
            const disp = getDisplay(k, company.sc[k], profile);
            const extra = k==="political" ? `Est. spending: ${d.amt||"N/A"} · Lean: ${d.lean||"N/A"}`
              : k==="charity"   ? `Amount: ${d.amt||"N/A"} · Focus: ${d.focus||"N/A"}`
              : k==="animals"   ? `Verdict: ${d.verdict||"N/A"}`
              : k==="guns"      ? `Verdict: ${d.verdict||"N/A"}`
              : k==="privacy"   ? `Grade: ${d.grade||"N/A"}`
              : k==="execPay"   ? `Ratio: ${d.ratio||"N/A"}`
              : `Rating: ${d.rating||"N/A"}`;
            return (
              <div key={k} style={{ marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.05em", display:"flex", alignItems:"center", gap:5 }}>
                    <i className={`ti ${CAT_ICONS[k]}`} aria-hidden="true" />
                    {CAT_FULL[k]}
                  </div>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:700, background:T.bg3, color:T.txt, border:`1px solid ${T.border2}` }}>
                    {k === "political" && disp.icon === "dem" && <DonkeySVG size={12} />}
                    {k === "political" && disp.icon === "rep" && <ElephantSVG size={12} />}
                    {k === "political" && disp.icon === "bi"  && <span style={{fontSize:11}}>⚖</span>}
                    {disp.sym} {disp.label}
                  </span>
                </div>
                <div style={{ fontSize:13, color:T.txt2, lineHeight:1.6 }}>{d.s || d.summary || ""}</div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:5 }}>{extra}</div>
                {(d.sources||[]).length > 0 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                    {d.sources.map(src => <span key={src} style={{ padding:"2px 7px", fontSize:10, borderRadius:20, background:T.accentBg, color:T.accent2, border:`1px solid ${T.accent}` }}>{src}</span>)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Actions */}
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={doLive} style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.demBg, border:`1px solid ${T.dem}`, color:T.dem }}>
              <i className={`ti ti-refresh${liveState==="loading"?" spin":""}`} aria-hidden="true" />
              Live update
            </button>
            <button style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2 }}>
              <i className="ti ti-share" aria-hidden="true" />
              Share
            </button>
          </div>

          {/* Live panel */}
          {showLive && (
            <div style={{ background:T.bg3, borderRadius:12, border:`1px solid ${T.dem}`, padding:14, marginTop:10 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.dem, display:"flex", alignItems:"center", gap:6 }}>
                  <i className={`ti ti-refresh${liveState==="loading"?" spin":""}`} aria-hidden="true" />
                  {liveState==="loading" ? `Searching for latest on ${company.name}...` : `Latest on ${company.name}`}
                </div>
                <button onClick={()=>setShowLive(false)} style={{ background:"none", border:"none", color:T.txt3, fontSize:20, cursor:"pointer" }}>×</button>
              </div>
              {liveState==="error" && <p style={{ fontSize:13, color:T.rep }}>Could not fetch live data. Try again.</p>}
              {liveState==="done" && liveData && (
                <>
                  {["political","environment","labor","dei","animals"].filter(f=>liveData[f]).map(f=>(
                    <div key={f} style={{ display:"flex", gap:8, fontSize:13, color:T.txt2, lineHeight:1.6, marginBottom:8 }}>
                      <i className={`ti ${CAT_ICONS[f]}`} style={{ fontSize:13, color:T.txt3, flexShrink:0, marginTop:2 }} aria-hidden="true" />
                      <div><span style={{ fontWeight:600, color:T.txt3, fontSize:11, textTransform:"uppercase" }}>{CAT_LABELS[f]}: </span>{liveData[f]}</div>
                    </div>
                  ))}
                  {!["political","environment","labor","dei","animals"].some(f=>liveData[f]) && (
                    <p style={{ fontSize:13, color:T.txt3 }}>No major recent updates found.</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── QUIZ ─────────────────────────────────────────────────────────────────────
function Quiz({ onComplete }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const isWelcome = step === 0;
  const current = isWelcome ? null : QUIZ_STEPS[step-1];
  const isLast = step === QUIZ_STEPS.length;
  const prog = (step / QUIZ_STEPS.length) * 100;
  const canAdvance = isWelcome || current?.type === "multi" || answers[current?.id] !== undefined;

  const advance = () => {
    if (isLast) {
      onComplete({
        lean:            answers.politicalLean || "neutral",
        deiLean:         answers.deiLean       || "neutral",
        animalTesting:   answers.animalTesting || "neutral",
        guns:            answers.guns          || "neutral",
        madeInUSA:       answers.madeInUSA     || "neutral",
        unionSupport:    answers.unionSupport  || "neutral",
        weights: {
          political:    answers.politicalImportance  || 3,
          charity:      answers.charityImportance    || 2,
          environment:  answers.envImportance        || 3,
          labor:        answers.laborImportance      || 3,
          dei:          answers.deiImportance !== undefined ? answers.deiImportance : (answers.deiLean !== "neutral" ? 4 : 2),
          animals:      answers.animalTesting !== "neutral" ? 4 : 2,
          guns:         answers.guns !== "neutral"   ? 4 : 2,
          privacy:      answers.privacy              || 2,
          execPay:      answers.execPay              || 2,
        },
        dealBreakers: answers.dealBreakers || [],
      });
    } else setStep(s => s+1);
  };

  const set = (k, v) => setAnswers(a => ({ ...a, [k]: v }));
  const toggleMulti = (k, v) => {
    const cur = answers[k] || [];
    set(k, cur.includes(v) ? cur.filter(x=>x!==v) : [...cur, v]);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100dvh" }}>
      <div style={{ padding:"16px 16px 0" }}>
        <div style={{ height:4, background:T.bg3, borderRadius:4 }}>
          <div style={{ height:4, background:T.accent, borderRadius:4, width:`${prog}%`, transition:"width 0.3s" }} />
        </div>
        {step > 0 && <div style={{ fontSize:11, color:T.txt3, textAlign:"right", marginTop:5 }}>{step} of {QUIZ_STEPS.length}</div>}
      </div>

      <div style={{ flex:1, padding:"20px 16px 0", overflowY:"auto" }}>
        {isWelcome && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", paddingTop:20 }}>
            <div style={{ width:80, height:80, background:T.accentBg, borderRadius:22, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:20 }}>
              <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#7c6dfa"/>
              </svg>
            </div>
            <div style={{ fontSize:28, fontWeight:800, color:T.txt, letterSpacing:-1, lineHeight:1 }}>Tru<span style={{ color:T.accent }}>North</span></div>
            <div style={{ fontSize:12, color:T.txt3, letterSpacing:2, textTransform:"uppercase", marginTop:6, marginBottom:16 }}>Know where your money goes</div>
            <div style={{ fontSize:14, color:T.txt3, lineHeight:1.7, maxWidth:300 }}>
              Answer 12 quick questions. Every company's score recalculates based on what you actually care about — politics, DEI, animal testing, guns, privacy, and more.
            </div>
          </div>
        )}

        {current?.type === "single" && (
          <>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:18, lineHeight:1.4 }}>{current.q}</div>
            {current.opts.map((opt, i) => {
              const sel = answers[current.id] === opt.v && answers[current.id+"_idx"] === i;
              return (
                <button key={i} onClick={() => { set(current.id, opt.v); set(current.id+"_idx", i); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", borderRadius:12, border:`1.5px solid ${sel?T.accent:T.border}`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:8, textAlign:"left", width:"100%" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", border:`2px solid ${sel?T.accent:T.border2}`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {sel && <i className="ti ti-check" style={{ fontSize:13, color:"#fff" }} aria-hidden="true" />}
                  </div>
                  {opt.icon === "dem" && <DonkeySVG size={20} />}
                  {opt.icon === "rep" && <ElephantSVG size={20} />}
                  {opt.icon && opt.icon !== "dem" && opt.icon !== "rep" && <i className={`ti ${opt.icon}`} style={{ fontSize:18, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />}
                  <span style={{ fontSize:14, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                </button>
              );
            })}
          </>
        )}

        {current?.type === "scale" && (
          <>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:24, lineHeight:1.4 }}>{current.q}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:10 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => set(current.id, n)}
                  style={{ width:52, height:52, borderRadius:12, border:`1.5px solid ${answers[current.id]===n?T.accent:T.border}`, background:answers[current.id]===n?T.accent:T.bg2, color:answers[current.id]===n?"#fff":T.txt, fontSize:17, fontWeight:700, cursor:"pointer" }}>{n}</button>
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3, marginBottom:12 }}>
              <span>{current.lo}</span><span>{current.hi}</span>
            </div>
            {answers[current.id] && (
              <div style={{ textAlign:"center", fontSize:13, fontWeight:600, color:T.accent2 }}>
                {["","Not important","Slightly important","Moderately important","Very important","Extremely important"][answers[current.id]]}
              </div>
            )}
          </>
        )}

        {current?.type === "multi" && (
          <>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:6, lineHeight:1.4 }}>{current.q}</div>
            {current.sub && <div style={{ fontSize:13, color:T.txt3, marginBottom:18, lineHeight:1.5 }}>{current.sub}</div>}
            {current.opts.map((opt, i) => {
              const sel = (answers[current.id]||[]).includes(opt.v);
              return (
                <button key={i} onClick={() => toggleMulti(current.id, opt.v)}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:12, border:`1.5px solid ${sel?T.accent:T.border}`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:8, textAlign:"left", width:"100%" }}>
                  <div style={{ width:22, height:22, borderRadius:5, border:`2px solid ${sel?T.accent:T.border2}`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {sel && <i className="ti ti-check" style={{ fontSize:12, color:"#fff" }} aria-hidden="true" />}
                  </div>
                  <i className={`ti ${opt.icon}`} style={{ fontSize:18, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />
                  <span style={{ fontSize:14, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      <div style={{ display:"flex", gap:10, padding:16, borderTop:`1px solid ${T.border}`, background:T.bg, position:"sticky", bottom:0 }}>
        {step > 0 && <button onClick={()=>setStep(s=>s-1)} style={{ padding:"13px 20px", borderRadius:12, border:`1px solid ${T.border}`, background:T.bg3, color:T.txt2, fontSize:15, fontWeight:600, cursor:"pointer" }}>←</button>}
        <button onClick={advance} disabled={!canAdvance}
          style={{ flex:1, padding:13, borderRadius:12, border:"none", background:canAdvance?T.accent:T.bg3, color:canAdvance?"#fff":T.txt3, fontSize:15, fontWeight:700, cursor:canAdvance?"pointer":"default", opacity:canAdvance?1:0.4 }}>
          {isWelcome ? "Let's go →" : isLast ? "See my scores →" : "Next →"}
        </button>
      </div>
    </div>
  );
}

// ─── SUBMIT FORM ──────────────────────────────────────────────────────────────
function SubmitView({ isPaid, onUpgrade }) {
  const [type, setType] = useState("correction");
  const [company, setCompany] = useState("");
  const [cat, setCat] = useState("political");
  const [detail, setDetail] = useState("");
  const [source, setSource] = useState("");
  const [sent, setSent] = useState(false);

  if (!isPaid) {
    return (
      <div style={{ padding:24, textAlign:"center" }}>
        <div style={{ width:56, height:56, background:T.goldBg, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
          <i className="ti ti-crown" style={{ fontSize:26, color:T.gold }} aria-hidden="true" />
        </div>
        <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:8 }}>Submissions are for subscribers</div>
        <div style={{ fontSize:13, color:T.txt3, marginBottom:20, lineHeight:1.6 }}>Upgrade to help keep our database accurate by flagging corrections or suggesting new companies.</div>
        <button onClick={onUpgrade} style={{ padding:"13px 24px", borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer" }}>Upgrade for $1.99/mo</button>
      </div>
    );
  }

  const submit = () => {
    if (!company.trim() || !detail.trim()) { alert("Please fill in company name and description."); return; }
    setSent(true); setCompany(""); setDetail(""); setSource("");
    setTimeout(() => setSent(false), 4000);
  };

  const inp = { width:"100%", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:8, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:14 };
  const lbl = { fontSize:12, fontWeight:600, color:T.txt3, marginBottom:6, display:"block", textTransform:"uppercase", letterSpacing:"0.04em" };

  return (
    <div style={{ padding:16 }}>
      <p style={{ fontSize:13, color:T.txt3, marginBottom:16, lineHeight:1.6 }}>Help us keep data accurate. Flag a correction or suggest a company to add.</p>
      {sent && <div style={{ background:T.greenBg||"#0d2318", border:"1px solid #4caf82", borderRadius:12, padding:14, color:"#4caf82", fontSize:14, fontWeight:600, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}><i className="ti ti-check" style={{fontSize:18}} aria-hidden="true" /> Submitted — thanks!</div>}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {["correction","new"].map(t => (
          <button key={t} onClick={()=>setType(t)} style={{ padding:"7px 12px", borderRadius:20, fontSize:13, fontWeight:type===t?600:400, border:`1px solid ${type===t?T.accent:T.border2}`, background:type===t?T.accentBg:T.bg3, color:type===t?T.accent2:T.txt2, cursor:"pointer" }}>
            {t==="correction"?"Fix existing data":"Add new company"}
          </button>
        ))}
      </div>
      <label style={lbl}>Company name</label>
      <input style={inp} value={company} onChange={e=>setCompany(e.target.value)} placeholder="e.g. Patagonia" />
      {type==="correction" && (
        <>
          <label style={lbl}>Category to correct</label>
          <select style={inp} value={cat} onChange={e=>setCat(e.target.value)}>
            {CAT_KEYS.map(k => <option key={k} value={k}>{CAT_FULL[k]}</option>)}
          </select>
        </>
      )}
      <label style={lbl}>{type==="correction"?"What should it say?":"Describe the company"}</label>
      <textarea style={{ ...inp, resize:"vertical", minHeight:80, fontFamily:"inherit" }} value={detail} onChange={e=>setDetail(e.target.value)} placeholder={type==="correction"?"Describe the correction...":"Company name, category, and key data points..."} />
      <label style={lbl}>Source (optional)</label>
      <input style={inp} value={source} onChange={e=>setSource(e.target.value)} placeholder="e.g. opensecrets.org/..." />
      <button onClick={submit} style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.accent, color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer" }}>Submit</button>
    </div>
  );
}

// ─── SOURCES ──────────────────────────────────────────────────────────────────
const SOURCES_DATA = [
  {group:"Political donations",icon:"ti-flag-2",items:[
    {name:"OpenSecrets.org",url:"https://www.opensecrets.org",desc:"Tracks all disclosed political donations, PAC spending, lobbying, and candidate fundraising from FEC filings."},
    {name:"FEC.gov",url:"https://www.fec.gov",desc:"Official US government source for all federal campaign finance disclosures."},
    {name:"InfluenceMap",url:"https://influencemap.org",desc:"Scores companies on climate policy lobbying and political influence."},
  ]},
  {group:"Charitable giving",icon:"ti-heart",items:[
    {name:"Charity Navigator",url:"https://www.charitynavigator.org",desc:"Rates 1.8M nonprofits on financial health, accountability, and transparency."},
    {name:"Candid / GuideStar",url:"https://candid.org",desc:"Largest database of nonprofit 990 forms."},
  ]},
  {group:"Environmental",icon:"ti-leaf",items:[
    {name:"CDP (Carbon Disclosure Project)",url:"https://www.cdp.net",desc:"World's largest environmental disclosure system. Companies scored A–D on climate, water, forests."},
    {name:"B Corp Certification",url:"https://www.bcorporation.net",desc:"Rigorous certification for companies meeting high social and environmental standards."},
    {name:"Break Free From Plastic",url:"https://www.breakfreefromplastic.org",desc:"Annual Brand Audit ranks top plastic polluters globally."},
  ]},
  {group:"Labor practices",icon:"ti-users",items:[
    {name:"OSHA (osha.gov)",url:"https://www.osha.gov",desc:"Official US workplace safety database with inspection records, violations, and fines."},
    {name:"NLRB (nlrb.gov)",url:"https://www.nlrb.gov",desc:"National Labor Relations Board — tracks unfair labor practice cases and union elections."},
    {name:"Oxfam Scorecard",url:"https://www.oxfam.org/en/research/behind-brands",desc:"Rates major food companies on worker rights."},
  ]},
  {group:"DEI",icon:"ti-rainbow",items:[
    {name:"HRC Corporate Equality Index",url:"https://www.hrc.org/resources/corporate-equality-index",desc:"Annual scorecard rating companies 0–100 on LGBTQ+ workplace equality."},
    {name:"EEOC (eeoc.gov)",url:"https://www.eeoc.gov",desc:"Official database of discrimination charges and enforcement actions."},
  ]},
  {group:"Animal testing",icon:"ti-paw",items:[
    {name:"PETA Beauty Without Bunnies",url:"https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/",desc:"Database of companies that do and do not test on animals."},
    {name:"Leaping Bunny",url:"https://www.leapingbunny.org",desc:"Global certification program for cruelty-free companies."},
    {name:"ASPCA",url:"https://www.aspca.org",desc:"Tracks animal welfare standards in food and agriculture supply chains."},
  ]},
  {group:"Data privacy",icon:"ti-lock",items:[
    {name:"EFF (Electronic Frontier Foundation)",url:"https://www.eff.org",desc:"Tracks corporate surveillance practices and data privacy records."},
    {name:"Mozilla Privacy Not Included",url:"https://foundation.mozilla.org/en/privacynotincluded/",desc:"Rates apps and services on data collection and privacy practices."},
  ]},
  {group:"Executive pay",icon:"ti-coin",items:[
    {name:"AFL-CIO Executive Paywatch",url:"https://aflcio.org/paywatch",desc:"Tracks CEO-to-worker pay ratios at major US corporations."},
    {name:"SEC Executive Compensation Proxy",url:"https://www.sec.gov/cgi-bin/browse-edgar",desc:"Official source for executive compensation disclosures."},
  ]},
];

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]     = useState("quiz");
  const [profile, setProfile]   = useState(null);
  const [isPaid, setIsPaid]     = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const [tab, setTab]           = useState("top");
  const [query, setQuery]       = useState("");
  const [leanFilter, setLeanFilter] = useState("all");
  const [catFilters, setCatFilters] = useState([]); // multi-select — empty = all
  const [sort, setSort]             = useState("name");

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = globalCSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  const deduped = COMPANIES.filter((c,i,a) => a.findIndex(x=>x.name===c.name)===i);

  const filtered = deduped
    .filter(c => {
      if (leanFilter !== "all") {
        const l = (c.sc.political||"").toLowerCase();
        if (leanFilter==="left"    && !["left","left-leaning"].includes(l)) return false;
        if (leanFilter==="right"   && !["right","right-leaning"].includes(l)) return false;
        if (leanFilter==="bi"      && !["bipartisan","mixed"].includes(l)) return false;
        if (leanFilter==="neutral" && l !== "neutral") return false;
      }
      if (catFilters.length > 0) {
        const allPass = catFilters.every(f => {
          const v = (c.sc[f]||"").toLowerCase();
          return !["neutral","unknown","na"].includes(v);
        });
        if (!allPass) return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.cat.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a,b) => {
      if (sort==="score") return computeScore(b,profile) - computeScore(a,profile);
      if (sort==="name") return a.name.localeCompare(b.name);
      const o={left:0,"left-leaning":1,bipartisan:2,mixed:3,neutral:4,right:6,"right-leaning":6};
      return (o[(a.sc.political||"").toLowerCase()]??5) - (o[(b.sc.political||"").toLowerCase()]??5);
    });

  const toggleCat = (f) => setCatFilters(prev => prev.includes(f) ? prev.filter(x=>x!==f) : [...prev, f]);

  const lc = {
    left: deduped.filter(c=>["left","left-leaning"].includes((c.sc.political||"").toLowerCase())).length,
    right: deduped.filter(c=>["right","right-leaning"].includes((c.sc.political||"").toLowerCase())).length,
    bi: deduped.filter(c=>["bipartisan","mixed"].includes((c.sc.political||"").toLowerCase())).length,
    neutral: deduped.filter(c=>(c.sc.political||"").toLowerCase()==="neutral").length,
  };

  const CAT_BUCKET_MAP = {
    "Apparel & Fashion": ["Apparel","Fashion","Athletic Apparel","Footwear","Apparel & Accessories","Apparel & Equipment","Apparel & Footwear","Apparel Manufacturing","Apparel Retail","Apparel/Fashion Retail","Apparel/Footwear Retail","Apparel/Retail"],
    "Automotive": ["Automotive","Automotive Manufacturing","Automotive Retail","Automotive/E-Commerce","Car Rental"],
    "Beauty & Personal Care": ["Beauty","Beauty & Cosmetics","Beauty & Personal Care","Cosmetics & Personal Care","Personal Care","Personal Care & Cosmetics"],
    "Chemicals & Materials": ["Chemicals","Chemicals & Manufacturing","Chemicals & Materials","Chemicals & Petrochemicals","Materials","Industrial Gases & Welding Supplies"],
    "Defense & Aerospace": ["Aerospace & Defense","Aerospace/Industrial Automation","Defense","Defense & Government Services","Defense Contractor"],
    "Energy": ["Energy","Oil & Gas","Utilities"],
    "Entertainment & Media": ["Digital Media","Entertainment","Media","Media & Entertainment","Media Services","Streaming Services","Software/Digital Media"],
    "Financial Services": ["Financial Services","Financial Software","Financial Technology","Insurance","Legal Services","Legal Technology"],
    "Food & Beverage": ["Beverage","Beverage Alcohol","Beverage Manufacturing","Beverages","Beverages & Spirits","Food & Agriculture","Food & Beverage","Food & Beverages","Food & Delivery","Food Manufacturing","Food Products","Food Service","Food and Beverage","Online Food Delivery","Restaurant","Restaurants","Restaurants & Food Service","Restaurants & Foodservice","Restaurants & Retail","Spirits","Spirits & Beverages","Agriculture"],
    "Furniture & Home": ["Furniture","Furniture Manufacturing","Forest Products","Forest Products & Real Estate","Forestry & Building Products"],
    "Healthcare & Pharma": ["Animal Health","Biopharmaceuticals","Biotechnology","Health","Healthcare","Healthcare Equipment","Healthcare Services","Medical Device Manufacturing","Medical Devices","Pharmaceuticals","Pharmaceuticals & Medical Devices"],
    "Hospitality & Travel": ["Hospitality","Travel & Hospitality","Airlines","Transportation","Transportation & Logistics","Transportation Services","Logistics"],
    "Manufacturing & Industrial": ["Industrial Equipment Manufacturing","Industrial Manufacturing","Industrials","Manufacturing"],
    "Retail": ["Consumer Goods","Consumer Services","E-Commerce","Fashion Retail","Retail","Specialty Retail"],
    "Software & Technology": ["Consumer Electronics","Electronics","Enterprise Software","Financial Technology","Information Technology","Internet Content & Information","Software","Software & Services","Software & Technology","Software/SaaS","Tax Preparation/Software","Technology","Technology & E-Commerce","Telecommunications"],
    "Sports & Fitness": ["Fitness","Fitness & Recreation","Fitness & Wellness","Fitness Centers","Health & Fitness","Recreation & Fitness","Recreational Goods","Sporting Goods","Sports Equipment"],
    "Pet Care": ["Pet Care","Pet Food"],
    "Professional Services": ["Business Services","Education","Government/Postal Services","Nonprofit","Personal Services","Professional Services","Real Estate","Security Services"],
  };
  function getBucket(cat) {
    const c = cat.split(" / ")[0].split(",")[0].trim();
    for (const [bucket, keywords] of Object.entries(CAT_BUCKET_MAP)) {
      if (keywords.some(k => c.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(c.toLowerCase()))) return bucket;
    }
    return c;
  }
  const cats = [...new Set(deduped.map(c=>getBucket(c.cat)))].sort();
  const catIconMap = {Retail:"ti-building-store",Food:"ti-chef-hat",Technology:"ti-device-laptop",Grocery:"ti-shopping-cart",Energy:"ti-bolt",Apparel:"ti-shirt",Media:"ti-device-tv",Finance:"ti-building-bank",Healthcare:"ti-heartbeat",Outdoor:"ti-mountain",Consumer:"ti-package",Conglomerate:"ti-building-skyscraper",Auto:"ti-car",Sports:"ti-ball-basketball"};
  const catBgs = ["#1e1535","#0d2318","#0d1f35","#2a0d0d","#2e1a05","#2a1a05"];
  const catFgs = ["#9b8ff0","#4caf82","#4a90e2","#e24a4a","#e8a042","#f0a030"];

  const TABS = ["search","browse","top","sources","account"];
  const TAB_LABELS = {search:"Search",browse:"Browse",top:"Top picks",sources:"Sources",account:"Account"};



  if (screen === "quiz") {
    return (
      <div style={{ maxWidth:430, margin:"0 auto" }}>
        {showPaywall && <PaywallScreen onSubscribe={()=>{setIsPaid(true);setShowPaywall(false);window.scrollTo(0,0);setScreen("quiz");}} onClose={()=>{setShowPaywall(false);setScreen("main");}} />}
        {isPaid ? (
          <>
            <Quiz onComplete={(p) => { setProfile(p); setScreen("main"); }} />
            <div style={{ padding:"0 16px 24px" }}>
              <button onClick={()=>setScreen("main")} style={{ width:"100%", padding:12, borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.txt3, fontSize:14, cursor:"pointer" }}>
                Skip — use AI-generated scores
              </button>
            </div>
          </>
        ) : (
          <div style={{ padding:"32px 20px", textAlign:"center" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:24 }}>
              <div style={{ width:40, height:40, background:T.accentBg, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true">
                  <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#7c6dfa"/>
                </svg>
              </div>
              <div style={{ fontSize:26, fontWeight:800, color:T.txt, letterSpacing:-0.5 }}>Tru<span style={{ color:"#7c6dfa" }}>North</span></div>
            </div>
            <div style={{ fontSize:22, fontWeight:700, color:T.txt, marginBottom:10 }}>Personalized scores are Pro</div>
            <div style={{ fontSize:14, color:T.txt3, lineHeight:1.7, maxWidth:300, margin:"0 auto 24px" }}>
              Free users see our AI-generated score for each company. Upgrade to take the personalization quiz and get scores based on what you actually care about.
            </div>
            <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ width:"100%", maxWidth:300, padding:14, borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:12 }}>
              Upgrade for $1.99/mo
            </button>
            <button onClick={()=>{window.scrollTo(0,0);setScreen("main");}} style={{ width:"100%", maxWidth:300, padding:12, borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.txt3, fontSize:14, cursor:"pointer" }}>
              Continue with AI scores
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth:430, margin:"0 auto", minHeight:"100dvh", background:T.bg, width:"100%" }}>
      {showPaywall && <PaywallScreen onSubscribe={()=>{setIsPaid(true);setShowPaywall(false);window.scrollTo(0,0);setScreen("quiz");}} onClose={()=>setShowPaywall(false)} />}

      {/* Header */}
      <div style={{ padding:"16px 16px 12px", background:T.bg, position:"sticky", top:0, zIndex:10, borderBottom:`1px solid ${T.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
          <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <i className="ti ti-leaf" style={{ fontSize:18, color:T.accent2 }} aria-hidden="true" />
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:700, color:T.txt, letterSpacing:-0.3 }}>TruNorth</div>
            <div style={{ fontSize:11, color:T.txt3, marginTop:1 }}>Know where your money goes · {deduped.length} companies</div>
          </div>
          {isPaid
            ? <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"4px 10px", borderRadius:20, display:"flex", alignItems:"center", gap:4 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Pro</div>
            : <button onClick={()=>setTab("account")} style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"5px 10px", borderRadius:20, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Upgrade</button>
          }
        </div>
        <div style={{ background:T.bg3, borderRadius:16, padding:"0 14px", display:"flex", alignItems:"center", gap:10, border:`1px solid ${T.border}` }}>
          <i className="ti ti-search" style={{ fontSize:18, color:T.txt3 }} aria-hidden="true" />
          <input value={query} onChange={e=>{setQuery(e.target.value);setTab("search");}} placeholder={`Search ${deduped.length} companies...`}
            style={{ background:"transparent", border:"none", color:T.txt, fontSize:15, padding:"12px 0", flex:1 }} />
          {query && <button onClick={()=>setQuery("")} style={{ background:"none", border:"none", color:T.txt3, fontSize:18, cursor:"pointer" }}>×</button>}
        </div>
      </div>

      {/* Profile strip */}
      {profile && (
        <div style={{ padding:"8px 16px", background:T.accentBg, borderBottom:`1px solid ${T.accent}`, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <i className="ti ti-sparkles" style={{ fontSize:12, color:T.accent2 }} aria-hidden="true" />
          <span style={{ fontSize:11, color:T.accent2, fontWeight:600 }}>Scores personalized</span>
          <span style={{ fontSize:10, color:T.txt2, background:T.bg, border:`1px solid ${T.border}`, borderRadius:20, padding:"2px 8px" }}>
            {profile.lean==="left"?"◀ Left":profile.lean==="right"?"▶ Right":"⚖ Neutral"} politics
          </span>
          <span style={{ fontSize:10, color:T.txt2, background:T.bg, border:`1px solid ${T.border}`, borderRadius:20, padding:"2px 8px" }}>
            {profile.deiLean==="pro"?"✓ Pro-DEI":profile.deiLean==="anti"?"✗ Anti-DEI":"– DEI neutral"}
          </span>
          <button onClick={()=>setScreen("quiz")} style={{ marginLeft:"auto", fontSize:10, color:T.accent2, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Edit</button>
        </div>
      )}

      {/* SEARCH */}
      {tab === "search" && (
        <>
          {/* ── Collapsible Filter Panel ── */}
          <FilterPanel
            leanFilter={leanFilter} setLeanFilter={setLeanFilter}
            catFilters={catFilters} setCatFilters={setCatFilters} toggleCat={toggleCat}
            lc={lc}
          />
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderBottom:`1px solid ${T.border}` }}>
            <span style={{ fontSize:14, color:T.txt3 }}>Sort:</span>
            {["score","name","lean"].map(sv => (
              <button key={sv} onClick={()=>setSort(sv)} style={{ padding:"5px 10px", borderRadius:20, fontSize:12, fontWeight:sort===sv?600:400, border:`1px solid ${sort===sv?T.accent:T.border}`, background:sort===sv?T.accentBg:T.bg3, color:sort===sv?T.accent2:T.txt2, cursor:"pointer" }}>
                {sv==="score"?"Your score":sv==="name"?"A–Z":"Lean"}
              </button>
            ))}
            <span style={{ marginLeft:"auto", fontSize:11, color:T.txt3 }}>{filtered.length}</span>
            {(leanFilter!=="all"||catFilters.length>0||query) && (
              <button onClick={()=>{setLeanFilter("all");setCatFilters([]);setQuery("");}} style={{ fontSize:11, color:T.rep, background:T.repBg, border:`1px solid ${T.rep}`, borderRadius:20, padding:"4px 9px", cursor:"pointer" }}>Clear all</button>
            )}
          </div>

          {/* Paywall notice for free users */}
          {!isPaid && (
            <div onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ margin:"10px 16px 0", padding:"10px 14px", background:T.goldBg, border:`1px solid ${T.gold}`, borderRadius:12, cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
              <i className="ti ti-crown" style={{ fontSize:18, color:T.gold, flexShrink:0 }} aria-hidden="true" />
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:T.gold }}>Tap any company for full details</div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>Upgrade to Pro for $1.99/mo to unlock everything</div>
              </div>
              <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.gold, marginLeft:"auto" }} aria-hidden="true" />
            </div>
          )}

          <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
            {filtered.length === 0
              ? <div style={{ padding:"40px 20px", textAlign:"center", color:T.txt3 }}><i className="ti ti-search" style={{fontSize:36,display:"block",marginBottom:12}} aria-hidden="true" />No companies match</div>
              : filtered.map(co => <CompanyCard key={co.id} company={co} catFilter={catFilters.length===1?catFilters[0]:"all"} profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} />)
            }
          </div>
        </>
      )}

      {/* BROWSE */}
      {tab === "browse" && (
        <div style={{ padding:16, display:"grid", gridTemplateColumns:"calc(50% - 5px) calc(50% - 5px)", gap:10 }}>
          {cats.map((cat, i) => {
            const icon = Object.entries(catIconMap).find(([k])=>cat.includes(k))?.[1]||"ti-briefcase";
            const count = deduped.filter(c=>getBucket(c.cat)===cat).length;
            return (
              <div key={cat} onClick={()=>{setQuery(cat);setTab("search");}}
                style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:"16px 14px", cursor:"pointer" }}>
                <div style={{ width:44, height:44, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:10, background:catBgs[i%catBgs.length] }}>
                  <i className={`ti ${icon}`} style={{ fontSize:22, color:catFgs[i%catFgs.length] }} aria-hidden="true" />
                </div>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt }}>{cat}</div>
                <div style={{ fontSize:12, color:T.txt3, marginTop:3 }}>{count} companies</div>
              </div>
            );
          })}
        </div>
      )}
      {/* TOP PICKS */}
      {tab === "top" && (
        <>
          <FilterPanel
            leanFilter={leanFilter} setLeanFilter={setLeanFilter}
            catFilters={catFilters} setCatFilters={setCatFilters} toggleCat={toggleCat}
            lc={lc}
          />
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontSize:12, color:T.txt3 }}>Ranked by {profile?"your personalized score":"average score"} · Letter grade shown</div>
          </div>
          <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10, overflowX:"hidden" }}>
            {[...deduped].sort((a,b)=>computeScore(b,profile)-computeScore(a,profile)).map((co,i) => (
              <div key={co.id} style={{ display:"flex", alignItems:"flex-start", gap:8, minWidth:0 }}>
                <div style={{ width:24, textAlign:"right", fontSize:14, color:T.txt3, flexShrink:0, paddingTop:14 }}>#{i+1}</div>
                <div style={{ flex:1, minWidth:0 }}><CompanyCard company={co} catFilter="all" profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* SOURCES — Pro only */}
      {tab === "sources" && (
        !isPaid ? (
          <div style={{ padding:24, textAlign:"center" }}>
            <div style={{ width:56, height:56, background:T.goldBg, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <i className="ti ti-crown" style={{ fontSize:26, color:T.gold }} aria-hidden="true" />
            </div>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:8 }}>Data sources are Pro only</div>
            <div style={{ fontSize:13, color:T.txt3, marginBottom:20, lineHeight:1.6 }}>Upgrade to see all 8 research databases we use, including OpenSecrets, CDP, OSHA, NLRB, PETA, HRC, and more.</div>
            <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ padding:"13px 24px", borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer" }}>Upgrade for $1.99/mo</button>
          </div>
        ) : (
        <div style={{ padding:16 }}>
          <p style={{ fontSize:13, color:T.txt3, marginBottom:4, lineHeight:1.6 }}>All scores are researched from these databases. The Live update button on each company uses real-time web search.</p>
          <div style={{ padding:"8px 12px", background:T.bg3, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:12, fontSize:12, color:T.txt3, lineHeight:1.6 }}>
            <strong style={{color:T.txt2}}>About data freshness:</strong> Base scores are researched periodically and reflect information as of early 2025. For breaking news, tap "Live update" on any company card — it searches the web in real time. Political donation data updates after each election cycle (OpenSecrets), environmental data updates annually (CDP), and labor data updates as NLRB and OSHA cases are filed.
          </div>
          {SOURCES_DATA.map(g => (
            <div key={g.group}>
              <div style={{ fontSize:12, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.06em", margin:"16px 0 8px", display:"flex", alignItems:"center", gap:6 }}>
                <i className={`ti ${g.icon}`} aria-hidden="true" />{g.group}
              </div>
              {g.items.map(item => (
                <div key={item.name} style={{ padding:"12px 14px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, marginBottom:8 }}>
                  <div onClick={()=>window.open(item.url,"_blank")} style={{ fontSize:14, fontWeight:600, color:T.accent2, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                    {item.name} <i className="ti ti-external-link" style={{fontSize:12}} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize:12, color:T.txt3, marginTop:4, lineHeight:1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        )
      )}

      {/* SUBMIT */}
      
      {/* ACCOUNT */}
      {tab === "submit" && <SubmitView isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} />}

      {tab === "account" && (
        <div style={{ padding:16 }}>
          {/* Subscription status */}
          <div style={{ background:T.bg2, border:`1px solid ${isPaid ? T.gold : T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <div style={{ width:44, height:44, background:isPaid ? T.goldBg : T.bg3, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <i className={`ti ${isPaid ? "ti-crown" : "ti-user"}`} style={{ fontSize:22, color:isPaid ? T.gold : T.txt3 }} aria-hidden="true" />
              </div>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:T.txt }}>{isPaid ? "TruNorth Pro" : "Free Account"}</div>
                <div style={{ fontSize:12, color:isPaid ? T.gold : T.txt3, marginTop:2 }}>{isPaid ? "All features unlocked" : "Upgrade to unlock full profiles"}</div>
              </div>
            </div>
            {!isPaid && (
              <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ width:"100%", padding:12, borderRadius:10, border:"none", background:T.gold, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                Upgrade to Pro — $1.99/mo
              </button>
            )}
          </div>

          {/* Profile / personalization */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:4 }}>My values profile</div>
            {profile ? (
              <>
                <div style={{ fontSize:13, color:T.txt3, marginBottom:12, lineHeight:1.6 }}>
                  Politics: <strong style={{color:T.txt}}>{profile.lean==="left"?"◀ Left-leaning":profile.lean==="right"?"▶ Right-leaning":"⚖ Neutral"}</strong>
                  {" · "}DEI: <strong style={{color:T.txt}}>{profile.deiLean==="pro"?"Pro-DEI":profile.deiLean==="anti"?"Anti-DEI":"Neutral"}</strong>
                  {" · "}Animals: <strong style={{color:T.txt}}>{profile.animalTesting==="dealbreaker"?"Dealbreaker":profile.animalTesting==="prefer_not"?"Prefer cruelty-free":"Neutral"}</strong>
                </div>
                <button onClick={()=>setScreen("quiz")} style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  Retake personalization quiz
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize:13, color:T.txt3, marginBottom:12 }}>Take the quiz to personalize every company score based on what you care about.</div>
                <button onClick={()=>{ if(isPaid) setScreen("quiz"); else setShowPaywall(true); }} style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  {isPaid ? "Take the quiz" : "Upgrade to personalize scores"}
                </button>
              </>
            )}
          </div>

          {/* Submit a Company */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.txt3, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Contribute</div>
            <SubmitView isPaid={isPaid} onUpgrade={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} />
          </div>

          {/* App info */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>About TruNorth</div>
            {[
              ["Companies in database", deduped.length.toLocaleString()],
              ["Data sources", "FEC, OSHA, NLRB, SEC, CDP, PETA, HRC"],
              ["Last updated", "May 2026"],
              ["Version", "2.0"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>{label}</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BOTTOM NAV BAR */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, width:"100%", background:T.bg2, borderTop:`1px solid ${T.border}`, display:"flex", zIndex:20, paddingBottom:"env(safe-area-inset-bottom, 0px)" }}>
        {[
          {id:"top",    icon:"ti-star",         label:"Top Picks"},
          {id:"search", icon:"ti-search",       label:"Search"},
          {id:"browse", icon:"ti-apps",         label:"Browse"},
          {id:"account",icon:"ti-user",         label:"Account"},
        ].map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ flex:1, padding:"10px 4px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer" }}>
            <i className={`ti ${t.icon}`} style={{ fontSize:22, color:tab===t.id ? T.accent2 : T.txt3 }} aria-hidden="true" />
            <span style={{ fontSize:10, color:tab===t.id ? T.accent2 : T.txt3, fontWeight:tab===t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>
      {/* Spacer so content doesn't hide behind bottom nav */}
      <div style={{ height:80 }} />
    </div>
  );
}
