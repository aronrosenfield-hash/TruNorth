// Phase 3.1: companies.js is loaded LAZILY (dynamic import) so the 8.8MB module
// only enters the bundle when the split-bundle path is OFF. With flag ON, the
// import never fires and the app downloads only /data/index.json (~287 KB).
import React, { useState, useEffect, useMemo } from "react";
import SplashScreen from "./SplashScreen";
import OnboardingFlow from "./OnboardingFlow";
import { initAnalytics, track } from "./lib/analytics";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { isSplitBundleEnabled, loadCompanyIndex, loadCompanyDetail } from "./lib/dataSource";
import { subscribeEmail, getStoredEmail } from "./lib/marketing";
import { T } from "./lib/theme";

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html { background: #1a1a1a; height: var(--app-height, 100dvh); width: 100%; max-width: 100%; }
  body, #root { background: #1a1a1a; height: 100%; overflow: hidden; width: 100%; max-width: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; color: #f2f2f2; }
  input, textarea, select, button { font-family: inherit; }
  input:focus, textarea:focus, select:focus { outline: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 0.7s linear infinite; display: inline-block; }
  ::placeholder { color: #555; }
  /* UX 8A: visually hide labels but keep them for screen readers */
  .sr-only {
    position: absolute !important;
    width: 1px !important; height: 1px !important;
    padding: 0 !important; margin: -1px !important;
    overflow: hidden !important; clip: rect(0,0,0,0) !important;
    white-space: nowrap !important; border: 0 !important;
  }
  /* UX 8C: honor reduced-motion preference */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
    .spin { animation: none !important; }
  }
`;

// T moved to ./lib/theme

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

// ─── BARCODE SCANNER (Phase 5.y / UX 7B) ──────────────────────────────────────
// In-store killer feature. Camera scans a product barcode, we look up the
// brand via Open Food Facts (free, no auth, 2M+ products), then route to that
// company's profile. Strategy:
//   1. Open camera via getUserMedia (rear-facing on phones).
//   2. Try the native BarcodeDetector API (Chrome on Android, Safari iOS 17+).
//   3. Fall back to ZXing-wasm if BarcodeDetector isn't available (server-loaded
//      on first scan, ~200KB gzipped).
//   4. On code detected → fetch https://world.openfoodfacts.org/api/v0/product/<barcode>.json
//      Pull `brands`, normalize, fuzzy-match to our company index, navigate.
//   5. If brand isn't in our index, show "We don't have this brand yet — suggest?".
//
// Privacy: camera stream stays local. Open Food Facts lookup sends only the
// barcode (UPC/EAN/etc.) — no PII. We never store the barcode.
function BarcodeScanner({ onClose, onMatch, companies }) {
  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const detectorRef = React.useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | lookup | nomatch | error
  const [error, setError] = useState(null);
  const [lastCode, setLastCode] = useState(null);
  const [lookupBrand, setLookupBrand] = useState(null);

  // Build a quick brand→slug lookup once.
  const brandIndex = useMemo(() => {
    const m = new Map();
    (companies || []).forEach(c => {
      const k = (c.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (k) m.set(k, c);
    });
    return m;
  }, [companies]);

  const resolveBrand = (rawBrand) => {
    if (!rawBrand) return null;
    // Try each brand token in the comma/pipe-separated list, prefer first match
    const candidates = rawBrand.split(/[,|;\/]/).map(s => s.trim()).filter(Boolean);
    for (const cand of candidates) {
      const k = cand.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (brandIndex.has(k)) return brandIndex.get(k);
      // Word-prefix fallback: e.g. "Coca-Cola Company" → "cocacola" → match "cocacola"
      for (const [bk, bv] of brandIndex) {
        if (bk.length >= 4 && (bk.startsWith(k) || k.startsWith(bk))) return bv;
      }
    }
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    let rafId = null;
    let intervalId = null;

    async function start() {
      try {
        // 1. Start camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // 2. Set up detector
        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          detectorRef.current = new window.BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code"],
          });
        } else {
          // Browser doesn't support native BarcodeDetector — show graceful message
          setStatus("error");
          setError("Your browser doesn't support barcode scanning. Try Chrome on Android or Safari iOS 17+.");
          return;
        }

        setStatus("scanning");

        // 3. Poll the video frame for codes ~5x/sec
        const scan = async () => {
          if (cancelled || !videoRef.current || !detectorRef.current) return;
          try {
            const codes = await detectorRef.current.detect(videoRef.current);
            if (codes && codes.length > 0) {
              const code = codes[0].rawValue;
              if (code && code !== lastCode) {
                setLastCode(code);
                lookup(code);
                return; // stop polling once we have one
              }
            }
          } catch { /* detect can throw transiently — ignore */ }
        };
        intervalId = setInterval(scan, 200);
      } catch (err) {
        console.error("[scanner] camera error:", err);
        setStatus("error");
        setError(err.name === "NotAllowedError"
          ? "Camera access denied. Grant permission in your browser settings to scan."
          : "Couldn't start the camera. Make sure you're using HTTPS and have a working camera.");
      }
    }

    async function lookup(code) {
      setStatus("lookup");
      try {
        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`);
        const data = await res.json();
        if (data?.status === 1 && data?.product) {
          const brand = data.product.brands || data.product.brand_owner || data.product.product_name;
          setLookupBrand(brand);
          const match = resolveBrand(brand);
          if (match) {
            onMatch(match, { barcode: code, brand });
            return;
          }
          setStatus("nomatch");
        } else {
          setStatus("nomatch");
        }
      } catch (err) {
        setStatus("error");
        setError("Couldn't reach the product database. Check your connection.");
      }
    }

    start();
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (intervalId) clearInterval(intervalId);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position:"fixed", inset:0, background:"#000", zIndex:300, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"calc(12px + env(safe-area-inset-top, 0px)) 16px 12px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ color:"#fff", fontSize:16, fontWeight:700 }}>Scan barcode</div>
        <button onClick={onClose} aria-label="Close scanner" style={{ width:36, height:36, padding:0, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.12)", color:"#fff", fontSize:22, cursor:"pointer" }}>×</button>
      </div>
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <video ref={videoRef} playsInline muted style={{ width:"100%", height:"100%", objectFit:"cover" }} />
        {/* Aim reticle */}
        {status === "scanning" && (
          <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
            <div style={{ width:"70%", maxWidth:280, aspectRatio:"1.6", border:"2px solid rgba(255,255,255,0.7)", borderRadius:18, boxShadow:"0 0 0 9999px rgba(0,0,0,0.4)" }} />
          </div>
        )}
        {(status === "lookup" || status === "nomatch" || status === "error" || status === "starting") && (
          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.65)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, textAlign:"center", color:"#fff" }}>
            {status === "starting" && <div style={{ fontSize:14 }}>Starting camera…</div>}
            {status === "lookup" && (
              <>
                <div className="spin" style={{ width:36, height:36, border:"3px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", marginBottom:14 }} />
                <div style={{ fontSize:14 }}>Looking up barcode {lastCode}…</div>
              </>
            )}
            {status === "nomatch" && (
              <>
                <i className="ti ti-package-off" style={{ fontSize:34, color:T.gold, marginBottom:10 }} aria-hidden="true" />
                <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>Not in our catalog yet</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", marginBottom:18, maxWidth:280, lineHeight:1.5 }}>
                  Barcode {lastCode}{lookupBrand ? ` (${lookupBrand})` : ""} isn't tracked. Try another product or suggest it.
                </div>
                <button onClick={() => { setStatus("scanning"); setLastCode(null); setLookupBrand(null); }} style={{ padding:"10px 18px", borderRadius:10, border:"none", background:"#fff", color:"#000", fontSize:13, fontWeight:700, cursor:"pointer" }}>Scan another</button>
              </>
            )}
            {status === "error" && (
              <>
                <i className="ti ti-camera-off" style={{ fontSize:34, color:T.rep, marginBottom:10 }} aria-hidden="true" />
                <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>Can't scan</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.75)", marginBottom:18, maxWidth:300, lineHeight:1.5 }}>{error}</div>
                <button onClick={onClose} style={{ padding:"10px 18px", borderRadius:10, border:"none", background:"#fff", color:"#000", fontSize:13, fontWeight:700, cursor:"pointer" }}>Close</button>
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ padding:"12px 16px calc(12px + env(safe-area-inset-bottom, 0px))", textAlign:"center", color:"rgba(255,255,255,0.7)", fontSize:11 }}>
        Aim at a UPC/EAN barcode on any product. Powered by Open Food Facts.
      </div>
    </div>
  );
}

// ─── QUIZ STEPS ───────────────────────────────────────────────────────────────
const QUIZ_STEPS = [
  // Step 1: Political — single + importance scale on same screen
  { id:"politicalLean", type:"single+scale", scaleId:"politicalImportance",
    q:"When a company donates to political campaigns, which direction do you prefer?",
    scaleQ:"How important is this to you?",
    lo:"No influence", hi:"Strong influence",
    opts:[
      {v:"right",  l:"I prefer companies that support Republican / conservative causes", icon:"rep"},
      {v:"left",   l:"I prefer companies that support Democratic / progressive causes",  icon:"dem"},
      {v:"neutral",l:"I prefer companies that stay completely out of politics",           icon:null},
      {v:"neutral",l:"Political donations do not affect where I shop",                   icon:null},
    ]},
  // Step 2: DEI — single + importance scale on same screen
  { id:"deiLean", type:"single+scale", scaleId:"deiImportance",
    q:"How do you feel about DEI (Diversity, Equity and Inclusion) programs at companies?",
    scaleQ:"How important is this to you?",
    lo:"No influence", hi:"Strong influence",
    opts:[
      {v:"pro",    l:"Positive — I seek out companies with strong DEI programs",         icon:"ti-heart"},
      {v:"anti",   l:"Negative — I do not want companies that push DEI agendas",         icon:"ti-x"},
      {v:"neutral",l:"Neutral — DEI programs do not factor into my shopping",            icon:null},
    ]},
  // Step 3: Environment — scale only
  { id:"envImportance", type:"scale", q:"How much does a company's environmental record matter to you?", lo:"Does not concern me", hi:"Major concern" },
  // Step 4: Labor + unions combined
  { id:"laborImportance", type:"scale+single", singleId:"unionSupport",
    q:"How important is it that companies treat their workers well?",
    lo:"Does not concern me", hi:"Major concern",
    singleQ:"How do you feel about organized labor unions?",
    opts:[
      {v:"pro",    l:"I prefer companies that respect and support unions",               icon:"ti-users"},
      {v:"anti",   l:"I prefer companies that operate without union involvement",        icon:"ti-x"},
      {v:"neutral",l:"Union policy does not factor into my shopping",                   icon:null},
    ]},
  // Step 5: Animal testing
  { id:"animalTesting", type:"single", q:"How do you feel about companies that test products on animals?",
    opts:[
      {v:"dealbreaker",l:"Dealbreaker — I will not buy from companies that test on animals", icon:"ti-paw"},
      {v:"prefer_not", l:"I prefer cruelty-free but it is not a dealbreaker",               icon:"ti-paw"},
      {v:"neutral",    l:"Animal testing does not factor into my shopping decisions",        icon:null},
    ]},
  // Step 6: Guns
  { id:"guns", type:"single", q:"How do you feel about companies that sell or manufacture firearms?",
    opts:[
      {v:"support",  l:"I prefer companies that support Second Amendment rights",       icon:"ti-check"},
      {v:"avoid",    l:"I avoid companies that sell or manufacture guns",               icon:"ti-x"},
      {v:"neutral",  l:"Gun sales do not factor into my shopping choices",              icon:null},
    ]},
  // Step 7: Privacy + Exec pay combined
  { id:"privacy", type:"scale+scale", scale2Id:"execPay",
    q:"How much does a company misusing your personal data concern you?",
    lo:"Does not concern me", hi:"Major concern",
    scale2Q:"Does it bother you when CEOs earn hundreds of times more than workers?",
    lo2:"Does not concern me", hi2:"Major concern" },
  // Step 8: Charity
  { id:"charityImportance", type:"scale", q:"How much does a company's charitable giving matter to you?", lo:"Does not concern me", hi:"Major concern" },
  // Step 9: Dealbreakers
  { id:"dealBreakers", type:"multi", q:"Select any absolute dealbreakers for you:",
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

// Phase 3.2 — classify per-category data state.
//   "scored"  — we have a real signal (good/poor/neutral/left/right/etc.)
//   "unknown" — no data ingested for this category yet
// Unknown categories are excluded from the overall grade computation so we don't
// penalize companies for sparse data (and don't artificially boost via fallback=50).
// Note: "neutral" is a real scored value (the company is genuinely neutral), distinct
// from unknown. For Animals, Guns, Privacy, ExecPay — "na" means "not applicable
// to this kind of company" which is a meaningful factual answer, NOT "no data";
// render it as a normal scored badge instead of greyed-out "? No data".
const NA_IS_FACTUAL = new Set(["animals", "guns", "privacy", "execPay"]);
function getDataState(k, v) {
  if (v == null) return "unknown";
  const val = String(v).toLowerCase().trim();
  if (val === "" || val === "unknown" || val === "?") return "unknown";
  if (val === "na" || val === "n/a") return NA_IS_FACTUAL.has(k) ? "scored" : "unknown";
  return "scored";
}

function scoreCat(k, v, profile) {
  const val = (v || "").toLowerCase();

  if (k === "political") {
    const lean = profile?.lean || "neutral";
    if (lean === "left")   { if (["left","left-leaning"].includes(val)) return 97; if (["bipartisan","mixed"].includes(val)) return 62; if (val==="neutral") return 48; return 8; }
    if (lean === "right")  { if (["right","right-leaning"].includes(val)) return 97; if (["bipartisan","mixed"].includes(val)) return 62; if (val==="neutral") return 48; return 8; }
    if (["bipartisan","mixed"].includes(val)) return 80; if (val==="neutral") return 72; return 52;
  }

  if (k === "dei") {
    const deiLean = profile?.deiLean || "neutral";
    if (deiLean === "pro")  { if (val==="pro_dei") return 97; if (val==="mixed") return 52; if (val==="neutral") return 45; return 5; }
    if (deiLean === "anti") { if (val==="anti_dei") return 97; if (val==="mixed") return 52; if (val==="neutral") return 45; return 5; }
    return 62;
  }

  if (k === "animals") {
    const pref = profile?.animalTesting || "neutral";
    if (pref === "dealbreaker") { if (val==="cruelty_free") return 97; if (val==="some_testing") return 15; if (val==="tests_animals") return 0; return 50; }
    if (pref === "prefer_not")  { if (val==="cruelty_free") return 92; if (val==="some_testing") return 52; if (val==="tests_animals") return 20; return 50; }
    return 62;
  }

  if (k === "guns") {
    const pref = profile?.guns || "neutral";
    if (pref === "avoid")   { if (val==="no_guns") return 97; if (val==="sells_guns") return 8; if (val==="makes_guns") return 3; return 45; }
    if (pref === "support") { if (["sells_guns","makes_guns"].includes(val)) return 97; if (val==="no_guns") return 35; return 58; }
    return 62;
  }

  if (k === "labor") {
    const union = profile?.unionSupport || "neutral";
    const base = ["positive","excellent","strong","good"].includes(val) ? 88
      : val==="mixed" ? 55 : val==="neutral" ? 50
      : ["negative","poor","below average"].includes(val) ? 15 : val==="very poor" ? 5 : 50;
    // Union preference modifies labor score
    if (union === "pro")  { if (["positive","excellent","strong","good"].includes(val)) return Math.min(base + 8, 97); if (["negative","poor"].includes(val)) return Math.max(base - 15, 3); }
    if (union === "anti") { if (["positive","excellent","strong","good"].includes(val)) return Math.max(base - 15, 30); if (["negative","poor"].includes(val)) return Math.min(base + 20, 80); if (val==="mixed") return 65; }
    return base;
  }

  if (k === "privacy") {
    if (val==="good") return 92; if (val==="mixed") return 52; if (val==="poor") return 10; return 50;
  }

  if (k === "execPay") {
    if (["fair","good"].includes(val)) return 88; if (val==="mixed") return 58; if (val==="poor") return 15; return 50;
  }

  // charity, environment
  if (["positive","excellent","strong","good"].includes(val)) return 88;
  if (val==="mixed") return 52; if (val==="neutral") return 48;
  if (["negative","poor","below average"].includes(val)) return 15;
  if (val==="very poor") return 3;
  return 50;
}

function computeScore(co, profile) {
  if (!profile) return co.overall;
  // Boost weights for strong preferences, reduce for unimportant ones
  const gunBoost   = profile.guns !== "neutral" ? 4 : 1;
  const unionBoost = profile.unionSupport !== "neutral" ? 2 : 1;
  const baseWeights = {
    political:    profile.weights?.political    || 3,
    charity:      profile.weights?.charity      || 2,
    environment:  profile.weights?.environment  || 3,
    labor:        (profile.weights?.labor       || 3) * unionBoost,
    dei:          profile.weights?.dei          || 3,
    animals:      profile.weights?.animals      || 2,
    guns:         (profile.weights?.guns        || 2) * gunBoost,
    privacy:      profile.weights?.privacy      || 2,
    execPay:      profile.weights?.execPay      || 2,
  };
  // Phase 5.y — exclude both UNKNOWN and NEUTRAL signals from the weighted
  // average. "Neutral" means we have no specific data signal for that category,
  // and treating it as 48-50 was dragging strongly-aligned companies toward C.
  //
  // Real-world example: A "right" company donates 80% to Republicans (FEC).
  // A user who prefers Republican-leaning companies should see this as A-grade
  // on political. But if charity/labor/env/etc. are all "neutral" (no data)
  // they were each contributing 48 to the average, pulling the overall to ~60.
  // Now: only categories with actual signal contribute. Renormalize over those.
  //
  // Exception: an enum-level "neutral" for a CATEGORY where the user has a
  // strong preference (e.g. user wants pro-DEI, company is dei:"neutral") DOES
  // still score — neutrality vs the user's strong preference is meaningful.
  const userCaresAbout = (k) => {
    if (k === "political") return profile.lean && profile.lean !== "neutral";
    if (k === "dei")       return profile.deiLean && profile.deiLean !== "neutral";
    if (k === "animals")   return profile.animalTesting && profile.animalTesting !== "neutral";
    if (k === "guns")      return profile.guns && profile.guns !== "neutral";
    if (k === "labor")     return profile.unionSupport && profile.unionSupport !== "neutral";
    return false;
  };
  let weightedSum  = 0;
  let weightUsed   = 0;
  for (const k of CAT_KEYS) {
    const v = co.sc[k];
    if (getDataState(k, v) === "unknown") continue;
    // Skip "neutral" enum when user has no strong preference on this axis —
    // it's signal-less for grading purposes and only adds noise toward 50.
    if (String(v || "").toLowerCase() === "neutral" && !userCaresAbout(k)) continue;
    weightedSum += scoreCat(k, v, profile) * baseWeights[k];
    weightUsed  += baseWeights[k];
  }
  const ws = weightUsed > 0 ? weightedSum / weightUsed : 50;
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
  if (profile.animalTesting === "dealbreaker" && (co.sc.animals === "tests_animals")) return Math.max(0, Math.min(ws - 40, 30));
  return Math.max(0, Math.min(100, Math.round(ws - pen)));
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────────────────
// Phase 4.11: The display layer reports FACTS, not verdicts.
// - Without a user profile, every symbol is the neutral dot "·" — the app
//   doesn't decide whether testing animals, selling guns, or having a DEI
//   program is good or bad. Users bring their own values via the quiz.
// - With a profile, the ✓/✗ reflect whether THAT user's preferences align with
//   the company's actions, not the app's morality.
// - Labels prefer factual phrasing ("Pay Ratio >300:1") over editorial
//   adjectives ("Extreme Pay Gap").
function getDisplay(k, val, profile) {
  const v = (val || "").toLowerCase();
  // sym() returns "·" without profile or when user has no preference on this axis.
  // With a profile + preference, returns ✓ when company matches user's stance, ✗ when opposed.
  const sym = (alignedWithUser) => {
    if (!profile || alignedWithUser == null) return "·";
    return alignedWithUser ? "✓" : "✗";
  };

  // Political — show donation lean as a fact. Symbol reflects user's lean.
  if (k === "political") {
    const userLean = profile?.lean;
    if (["left","left-leaning"].includes(v))   return { sym: "◀", label: "Donates to Democrats",   icon: "dem", aligned: userLean === "left" };
    if (["right","right-leaning"].includes(v)) return { sym: "▶", label: "Donates to Republicans", icon: "rep", aligned: userLean === "right" };
    if (["bipartisan","mixed"].includes(v))    return { sym: "◆", label: "Bipartisan Donations",   icon: "bi" };
    return { sym: "–", label: "No Significant Donations", icon: null };
  }

  // DEI — neutral by default; symbol depends on user's deiLean.
  if (k === "dei") {
    if (v === "pro_dei")  return { sym: sym(profile?.deiLean === "pro"  ? true : profile?.deiLean === "anti" ? false : null), label: "Public DEI Programs",  icon: null };
    if (v === "anti_dei") return { sym: sym(profile?.deiLean === "anti" ? true : profile?.deiLean === "pro"  ? false : null), label: "Ended DEI Programs",   icon: null };
    if (v === "mixed")    return { sym: "·", label: "Mixed Public Record", icon: null };
    return { sym: "·", label: "No Public Position", icon: null };
  }

  // Animals — symbol depends on user's animalTesting preference.
  if (k === "animals") {
    const cares = ["dealbreaker","prefer_not"].includes(profile?.animalTesting);
    if (v === "cruelty_free")  return { sym: sym(cares ? true  : null), label: "Cruelty-Free Certified",   icon: null };
    if (v === "tests_animals") return { sym: sym(cares ? false : null), label: "Documents Animal Testing", icon: null };
    if (v === "some_testing")  return { sym: "·", label: "Some Animal Testing", icon: null };
    return { sym: "·", label: "Not Applicable", icon: null };
  }

  // Guns — symbol depends on user's gun preference.
  if (k === "guns") {
    const userPref = profile?.guns; // "avoid" | "support" | "neutral" | undefined
    const aligned = (matchesAvoid, matchesSupport) =>
      userPref === "avoid" ? matchesAvoid
      : userPref === "support" ? matchesSupport
      : null;
    if (v === "no_guns")    return { sym: sym(aligned(true,  false)), label: "Does Not Sell Firearms", icon: null };
    if (v === "sells_guns") return { sym: sym(aligned(false, true )), label: "Sells Firearms",        icon: null };
    if (v === "makes_guns") return { sym: sym(aligned(false, true )), label: "Manufactures Firearms", icon: null };
    return { sym: "·", label: "Not Applicable", icon: null };
  }

  // Privacy — factual labels. Most users prefer fewer breaches, but the app
  // doesn't assume — without a profile we just report.
  if (k === "privacy") {
    if (v === "good")  return { sym: sym(profile ? true  : null), label: "No Documented Breaches", icon: null };
    if (v === "mixed") return { sym: "·", label: "Some Breach History", icon: null };
    if (v === "poor")  return { sym: sym(profile ? false : null), label: "Documented Breaches", icon: null };
    return { sym: "·", label: "No Data", icon: null };
  }

  // Exec pay — factual ratios, not editorial labels.
  if (k === "execPay") {
    if (["fair","good"].includes(v)) return { sym: sym(profile ? true  : null), label: "CEO Pay Ratio <50:1",   icon: null };
    if (v === "mixed")               return { sym: "·", label: "CEO Pay Ratio 50–300:1", icon: null };
    if (v === "poor")                return { sym: sym(profile ? false : null), label: "CEO Pay Ratio >300:1", icon: null };
    return { sym: "·", label: "Not Disclosed", icon: null };
  }

  // Charity / Environment / Labor — factual descriptive labels per category.
  const factualLabel = (good) => {
    if (k === "charity")     return good ? "Documented Giving Programs" : "No Documented Giving";
    if (k === "environment") return good ? "Verified Certifications"     : "Documented Violations";
    if (k === "labor")       return good ? "No Major Violations on Record" : "Documented Labor Violations";
    return good ? "On the Record" : "Documented Issues";
  };
  if (["positive","excellent","strong","good"].includes(v)) return { sym: sym(profile ? true  : null), label: factualLabel(true),  icon: null };
  if (v === "mixed")   return { sym: "·", label: "Mixed Record", icon: null };
  if (v === "neutral") return { sym: "·", label: "Limited Public Record", icon: null };
  if (["negative","poor","below average"].includes(v)) return { sym: sym(profile ? false : null), label: factualLabel(false), icon: null };
  if (v === "very poor") return { sym: sym(profile ? false : null), label: "Significant Violations", icon: null };
  return { sym: "·", label: "No Data", icon: null };
}

// Score text grade
function scoreGrade(n) {
  if (n >= 75) return "A";
  if (n >= 62) return "B";
  if (n >= 48) return "C";
  if (n >= 35) return "D";
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
function PaywallScreen({ onSubscribe, onClose, initialEmail="" }) {
  const [loading, setLoading] = useState(false);
  // 4.7: prefill from stored email if we've seen this user before
  const [email, setEmail] = useState(initialEmail || getStoredEmail());

  const handleSubscribe = async () => {
    if (!email.includes("@")) { alert("Please enter a valid email."); return; }
    setLoading(true);
    // 4.7: capture the email to MailerLite (gracefully no-ops if unconfigured)
    await subscribeEmail(email, "paywall", { intendsToSubscribe: true });
    // In production: call Stripe Checkout API here.
    setTimeout(() => {
      setLoading(false);
      onSubscribe();
    }, 1500);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:T.bg2, borderRadius:"24px 24px 0 0", border:`1px solid ${T.border2}`, padding:"16px 18px 28px", width:"100%", maxWidth:430, maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ width:40, height:4, background:T.bg4, borderRadius:2, margin:"0 auto 20px" }} />

        <div style={{ textAlign:"center", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, marginBottom:20 }}>
            <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/>
              </svg>
            </div>
            <div style={{ fontSize:22, fontWeight:800, color:T.txt, letterSpacing:-0.5 }}>Tru<span style={{ color:T.accent }}>North</span></div>
          </div>
          <div style={{ width:44, height:44, background:T.goldBg, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 8px" }}>
            <i className="ti ti-crown" style={{ fontSize:26, color:T.gold }} aria-hidden="true" />
          </div>
          <div style={{ fontSize:17, fontWeight:700, color:T.txt, marginBottom:4 }}>Unlock full details</div>
          <div style={{ fontSize:12, color:T.txt3, lineHeight:1.6, maxWidth:300, margin:"0 auto" }}>
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

        <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, borderRadius:12, padding:"8px 12px", marginBottom:10, textAlign:"center" }}>
          <span style={{ fontSize:22, fontWeight:700, color:T.gold }}>$1.99</span>
          <span style={{ fontSize:13, color:T.txt3 }}> / month · Cancel anytime</span>
        </div>

        <form onSubmit={e=>{e.preventDefault();handleSubscribe();}} autoComplete="on" style={{width:"100%"}}><input type="email" autoComplete="email" name="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your email to subscribe" style={{ width:"100%", background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:10, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:10 }} /><button type="submit" style={{display:"none"}} /></form>

        <button onClick={handleSubscribe} disabled={loading}
          style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer", marginBottom:6 }}>
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

// ─── STRIP CITE TAGS ─────────────────────────────────────────────────────────
// Removes <cite index="...">...</cite> and bare <cite> tags from AI-generated text
function stripCites(s) {
  return (s || "").replace(/<\/?cite[^>]*>/gi, "").trim();
}

// ─── LIVE FETCH ───────────────────────────────────────────────────────────────
async function fetchLiveData(name) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:800,
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
// Boolean flag filters surfaced in the Filter panel (Phase 4.9). Each key
// matches a top-level field on the company record (truthy = bad signal).
const FLAG_FILTERS = [
  { id: "stillInRussia", label: "Still in Russia",     icon: "ti-flag-off",     desc: "Operating in Russia post-invasion (Yale CELI)" },
  { id: "foreignOwned",  label: "Foreign-owned",       icon: "ti-world",        desc: "Parent company headquartered outside the US" },
  { id: "childLabor",    label: "Child-labor risk",    icon: "ti-mood-sad",     desc: "Supply chain flagged by BHRRC / DOL" },
  { id: "antitrust",     label: "Antitrust action",    icon: "ti-gavel",        desc: "Active or recent antitrust enforcement" },
];

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
  {
    id: "flags", label: "Concerns", icon: "ti-alert-triangle",
    options: FLAG_FILTERS,
  },
];

function FilterPanel({ leanFilter, setLeanFilter, catFilters, setCatFilters, toggleCat, flagFilters, toggleFlag, setFlagFilters, lc }) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);
  const hasFilters = leanFilter !== "all" || catFilters.length > 0 || flagFilters.length > 0;
  const totalActive = (leanFilter !== "all" ? 1 : 0) + catFilters.length + flagFilters.length;

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
          <button onClick={e=>{e.stopPropagation();setLeanFilter("all");setCatFilters([]);setFlagFilters([]);setActiveGroup(null);}}
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
            const groupHasFilter =
              group.id === "political" ? leanFilter !== "all"
              : group.id === "flags"    ? flagFilters.length > 0
              : catFilters.length > 0;
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
                    {group.id === "flags" && FLAG_FILTERS.map(f => (
                      <div key={f.id} onClick={()=>toggleFlag(f.id)}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 20px", cursor:"pointer", borderBottom:`1px solid ${T.border}` }}>
                        <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${flagFilters.includes(f.id)?T.accent:T.border2}`, background:flagFilters.includes(f.id)?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          {flagFilters.includes(f.id) && <i className="ti ti-check" style={{fontSize:11,color:"#fff"}} aria-hidden="true" />}
                        </div>
                        <i className={`ti ${f.icon}`} style={{fontSize:14,color:flagFilters.includes(f.id)?T.accent2:T.txt3}} aria-hidden="true" />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, color:flagFilters.includes(f.id)?T.accent2:T.txt }}>{f.label}</div>
                          <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>{f.desc}</div>
                        </div>
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
// Phase 4.9: one-shot announcement modal — shown once per WHATSNEW_VERSION.
// Bump the version string when there's a new milestone to re-trigger.
const WHATSNEW_VERSION = "2026-05-6k-launch";
function WhatsNewModal({ companyCount }) {
  const [show, setShow] = useState(() => {
    // Phase 5.y: ?skipOnboarding=1 also dismisses the What's New modal so
    // simulator/QA URLs go straight to the app surface they want to inspect.
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has("skipOnboarding") || qp.has("noWhatsnew")) return false;
    }
    try { return localStorage.getItem("tn_whatsnew_seen") !== WHATSNEW_VERSION; }
    catch { return false; }
  });
  useEffect(() => {
    if (show) track("whatsnew_shown", { version: WHATSNEW_VERSION });
  }, [show]);
  if (!show) return null;
  const dismiss = () => {
    try { localStorage.setItem("tn_whatsnew_seen", WHATSNEW_VERSION); } catch {}
    track("whatsnew_dismissed", { version: WHATSNEW_VERSION });
    setShow(false);
  };
  return (
    <div onClick={dismiss} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, padding:"32px 12px", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:400, width:"100%", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, padding:20, color:T.txt }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <i className="ti ti-sparkles" style={{ fontSize:24, color:T.accent2 }} aria-hidden="true" />
          <div style={{ fontSize:18, fontWeight:700 }}>What's new</div>
        </div>
        <div style={{ background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:10, padding:"12px 14px", marginBottom:14 }}>
          <div style={{ fontSize:24, fontWeight:800, color:T.accent2 }}>{companyCount.toLocaleString()}</div>
          <div style={{ fontSize:13, color:T.txt2, marginTop:2 }}>Companies tracked on TruNorth — you decide the verdict</div>
        </div>
        <ul style={{ listStyle:"none", padding:0, margin:0, fontSize:13, color:T.txt2, lineHeight:1.7 }}>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>5,000+ new companies</b> added across food, tech, retail, healthcare, energy</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Direct Competitors</b> — every company now shows its top competitors so you can compare</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>New filters</b>: Still in Russia, foreign-owned, child labor, antitrust</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Shareable company links</b> — send any company directly to a friend</span>
          </li>
        </ul>
        <button onClick={dismiss} style={{ width:"100%", marginTop:16, padding:12, borderRadius:10, border:"none", background:T.accent2, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
          Got it
        </button>
      </div>
    </div>
  );
}

// UX 3A: Compare 2 Companies overlay. Shows side-by-side grade + per-category
// comparison with winner highlighted per row.
function CompareView({ companies, list, onClose, onRemove, onAdd, profile, isPaid }) {
  // Resolve each item in `list` to the full company object (from index or detail)
  const [details, setDetails] = useState({});
  useEffect(() => {
    list.forEach(({ slug }) => {
      if (details[slug]) return;
      const fromIndex = companies?.find(c => (c.slug || c.id) === slug);
      // Always pull full detail so we can show narrative bits if we want later
      loadCompanyDetail(slug)
        .then(d => setDetails(prev => ({ ...prev, [slug]: { ...(fromIndex || {}), ...d } })))
        .catch(() => {
          if (fromIndex) setDetails(prev => ({ ...prev, [slug]: fromIndex }));
        });
    });
  }, [list, companies]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolved = list.map(({ slug, name }) => details[slug] || { slug, name, sc: {} });

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:100, padding:"32px 12px", overflowY:"auto" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:430, margin:"0 auto", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, padding:16, color:T.txt }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Compare</div>
          <button onClick={onClose} style={{ width:32, height:32, padding:0, borderRadius:8, border:"none", background:T.bg3, color:T.txt, fontSize:18, cursor:"pointer" }} aria-label="Close">×</button>
        </div>

        {resolved.length < 2 ? (
          <div>
            {/* Show the picked one + suggestions for the second slot */}
            {resolved.length === 1 && (
              <div style={{ background:T.bg2, borderRadius:12, padding:12, border:`1px solid ${T.border}`, marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:resolved[0].ab || T.bg3, color:resolved[0].ac || T.accent2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>{resolved[0].init || "??"}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:T.txt }}>{resolved[0].name}</div>
                  <div style={{ fontSize:11, color:T.txt3 }}>{resolved[0].cat || ""}</div>
                </div>
                <span style={{ color:T.txt3, fontSize:13 }}>vs ?</span>
              </div>
            )}
            <div style={{ fontSize:12, fontWeight:600, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10 }}>
              Suggested matches
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {(() => {
                const pickedSlugs = new Set(list.map(l => l.slug));
                const firstCat = resolved[0]?.cat;
                const firstCompetitors = Array.isArray(resolved[0]?.competitors) ? resolved[0].competitors : [];
                const pool = (companies || []).filter(c => !pickedSlugs.has(c.slug || c.id));
                let suggestions = [];
                // Tier 1: AI-baked direct competitors (most accurate)
                if (firstCompetitors.length) {
                  const compSet = new Set(firstCompetitors);
                  const matched = pool.filter(c => compSet.has(c.slug || c.id));
                  // Preserve order from competitors array (Claude's ranking)
                  matched.sort((a, b) => firstCompetitors.indexOf(a.slug || a.id) - firstCompetitors.indexOf(b.slug || b.id));
                  suggestions.push(...matched);
                }
                const already = new Set(suggestions.map(s => s.slug || s.id));
                // Tier 2: same-category fill (when we still have room)
                if (suggestions.length < 6 && firstCat && firstCat !== "Other") {
                  const sameCat = pool
                    .filter(c => c.cat === firstCat && !already.has(c.slug || c.id))
                    .sort((a, b) => {
                      const aHas = a.sc && Object.values(a.sc).some(v => v && v !== "unknown");
                      const bHas = b.sc && Object.values(b.sc).some(v => v && v !== "unknown");
                      if (aHas !== bHas) return aHas ? -1 : 1;
                      return (b.overall || 0) - (a.overall || 0);
                    });
                  for (const c of sameCat) {
                    if (suggestions.length >= 6) break;
                    suggestions.push(c);
                    already.add(c.slug || c.id);
                  }
                }
                // Tier 3 fallback: only used when nothing matched at all
                if (suggestions.length === 0) {
                  const POPULAR_CATS = new Set(["Technology","Food & Beverage","Retail","Healthcare","Financial Services","Apparel","Grocery"]);
                  suggestions = pool
                    .filter(c => POPULAR_CATS.has(c.cat) && (c.grade === "A" || c.grade === "B"))
                    .sort((a, b) => (b.overall || 0) - (a.overall || 0));
                }
                if (suggestions.length === 0) {
                  return <div style={{ gridColumn:"1 / -1", padding:"16px", textAlign:"center", color:T.txt3, fontSize:12 }}>No close matches yet — try the <i className="ti ti-arrows-left-right" aria-hidden="true" /> icon on another row.</div>;
                }
                return suggestions.slice(0, 6).map(co => (
                  <button
                    key={co.slug || co.id}
                    onClick={() => { onAdd && onAdd(co.slug || co.id, co.name); track("compare_suggest_pick", { slug: co.slug || co.id, name: co.name }); }}
                    style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", color:T.txt }}
                  >
                    <div style={{ width:28, height:28, borderRadius:6, background:co.ab || T.bg3, color:co.ac || T.accent2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, flexShrink:0 }}>{co.init || "??"}</div>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.name}</div>
                      <div style={{ fontSize:10, color:T.txt3 }}>{co.cat || ""} · {co.grade || "?"}</div>
                    </div>
                  </button>
                ));
              })()}
            </div>
            <div style={{ marginTop:14, fontSize:11, color:T.txt3, textAlign:"center" }}>
              Or tap the <i className="ti ti-arrows-left-right" aria-hidden="true" /> icon on any company row.
            </div>
          </div>
        ) : (
          <>
            {/* Headers */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:14 }}>
              {resolved.map(co => {
                const ps = computeScore(co, profile);
                const grade = scoreGrade(ps);
                return (
                  <div key={co.slug} style={{ background:T.bg2, borderRadius:12, padding:12, border:`1px solid ${T.border}`, position:"relative" }}>
                    <button onClick={()=>onRemove(co.slug)} style={{ position:"absolute", top:6, right:6, width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, cursor:"pointer" }} aria-label="Remove">×</button>
                    <div style={{ marginBottom:6 }}><CompanyLogo company={co} size={36} rounded={8} /></div>
                    <div style={{ fontSize:14, fontWeight:700, color:T.txt, lineHeight:1.2 }}>{co.name}</div>
                    <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>{co.cat || ""}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:8 }}>
                      <div style={{ fontSize:28, fontWeight:800, color:profile ? T.txt : T.txt3, lineHeight:1 }}>{profile ? grade : "?"}</div>
                      {isPaid && profile && <div style={{ fontSize:12, color:T.txt3 }}>{ps}/100</div>}
                      {!profile && <div style={{ fontSize:11, color:T.txt3 }}>take quiz</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Category-by-category comparison */}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {CAT_KEYS.map(k => {
                const a = resolved[0], b = resolved[1];
                const sa = scoreCat(k, a.sc?.[k], profile);
                const sb = scoreCat(k, b.sc?.[k], profile);
                const aUnknown = getDataState(k, a.sc?.[k]) === "unknown";
                const bUnknown = getDataState(k, b.sc?.[k]) === "unknown";
                // Winner: higher score (only when both have data)
                let winner = null;
                if (!aUnknown && !bUnknown) {
                  if (sa > sb + 5) winner = 0;
                  else if (sb > sa + 5) winner = 1;
                }
                const da = getDisplay(k, a.sc?.[k], profile);
                const db = getDisplay(k, b.sc?.[k], profile);
                return (
                  <div key={k} style={{ background:T.bg2, borderRadius:10, padding:10, border:`1px solid ${T.border}` }}>
                    <div style={{ fontSize:11, fontWeight:600, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>
                      <i className={`ti ${CAT_ICONS[k]}`} aria-hidden="true" /> {CAT_LABELS[k]}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                      {[a, b].map((co, idx) => {
                        const unknown = idx === 0 ? aUnknown : bUnknown;
                        const disp = idx === 0 ? da : db;
                        const isWinner = winner === idx;
                        return (
                          <div key={idx} style={{
                            padding:"6px 10px",
                            borderRadius:8,
                            fontSize:12,
                            background: isWinner ? T.accentBg : (unknown ? "transparent" : T.bg3),
                            border: isWinner ? `1px solid ${T.accent}` : (unknown ? `1px dashed ${T.border2}` : `1px solid ${T.border}`),
                            color: unknown ? T.txt3 : (isWinner ? T.accent2 : T.txt),
                            fontWeight: isWinner ? 700 : 500,
                            opacity: unknown ? 0.6 : 1,
                            textAlign:"center",
                          }}>
                            {unknown ? "? No data" : (
                              <>{disp.sym} {disp.label}{isWinner && <span style={{marginLeft:6}}>✓</span>}</>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Phase 5.y: real brand logos via Clearbit Logo API.
// Strategy: try logo.clearbit.com/<domain>. If it 404s or errors, fall back to
// the initials avatar (which we always have). The image element handles its
// own error state — no JS coordination needed beyond the onError handler.
//
// Domain inference: prefer company.domain (when we have it from SEC/Wikidata),
// else derive from name (e.g. "Coca-Cola" → "cocacola.com"). Conservative —
// when guessing fails the fallback is just initials, never broken UI.
function guessDomain(co) {
  if (co.domain) return co.domain;
  const name = (co.name || "").toLowerCase()
    .replace(/&/g, "and")
    .replace(/['"`.,]/g, "")
    .replace(/\s+(inc|corp|corporation|company|co|llc|ltd|plc|holdings|group)\b.*/i, "")
    .replace(/[^a-z0-9]+/g, "");
  return name ? name + ".com" : null;
}

function CompanyLogo({ company, size = 36, rounded = 10 }) {
  const domain = guessDomain(company);
  // Two providers tried in sequence. Google favicon API is the most reliable
  // (always returns SOMETHING — at minimum a generic globe). DuckDuckGo's
  // icons.duckduckgo.com is a fallback. We previously used Clearbit but it
  // started 404'ing in 2025 after they deprecated free tier access.
  const providers = domain ? [
    `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ] : [];
  const [providerIdx, setProviderIdx] = React.useState(0);
  const [errored, setErrored] = React.useState(!domain);
  React.useEffect(() => {
    setErrored(!domain);
    setProviderIdx(0);
  }, [company?.slug || company?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialsAvatar = (
    <div style={{
      width:size, height:size, borderRadius:rounded,
      display:"flex", alignItems:"center", justifyContent:"center",
      fontSize: Math.max(10, Math.round(size*0.30)), fontWeight:700, flexShrink:0,
      background:company.ab||T.bg3, color:company.ac||T.accent2,
    }} aria-hidden="true">{company.init}</div>
  );
  if (errored) return initialsAvatar;
  return (
    <div style={{
      width:size, height:size, borderRadius:rounded,
      background:"#fff", flexShrink:0,
      display:"flex", alignItems:"center", justifyContent:"center",
      overflow:"hidden", border:`1px solid ${T.border}`,
    }} aria-hidden="true">
      <img
        src={providers[providerIdx]}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => {
          // Try next provider; fall back to initials when exhausted.
          if (providerIdx + 1 < providers.length) setProviderIdx(providerIdx + 1);
          else setErrored(true);
        }}
        style={{ width:"86%", height:"86%", objectFit:"contain" }}
      />
    </div>
  );
}

function CompanyCard({ company, catFilter, profile, isPaid, onUpgrade, isSaved, onToggleSave, inCompare, onToggleCompare, onCompareWith, allCompanies, initiallyOpen }) {
  const [open, setOpen]     = useState(!!initiallyOpen);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Phase 3.1: when running in split-bundle mode, the row-level `company`
  // only has the compact shape (no narrative/sources). On expand, lazy-load
  // the per-company JSON and merge it in. Use `enriched` everywhere below.
  const enriched = detail || company;
  const ps = computeScore(enriched, profile);
  const grade = scoreGrade(ps);

  const handleTap = () => {
    if (!isPaid) { onUpgrade(); return; }
    setOpen(o => {
      if (!o) {
        // Expanding — track view + lazily fetch detail if needed
        track("company_view", { slug: company.slug || company.id, name: company.name, grade, score: ps, category: company.cat });
        if (isSplitBundleEnabled() && company.slug && !detail && !loadingDetail) {
          setLoadingDetail(true);
          loadCompanyDetail(company.slug)
            .then(d => setDetail(d))
            .catch(err => console.error("[dataSource] detail fetch failed for", company.slug, err))
            .finally(() => setLoadingDetail(false));
        }
      }
      return !o;
    });
  };

  // SEO: update <title> + visible URL when a card is open so the browser
  // shows the right tab name and shareable URL. Reverts on collapse/unmount.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const slug = company.slug || company.id;
    const prevTitle = document.title;
    document.title = `${company.name} — TruNorth`;
    try { window.history.replaceState({}, "", `/company/${slug}`); } catch {}
    return () => {
      document.title = prevTitle;
      try { window.history.replaceState({}, "", "/"); } catch {}
    };
  }, [open, company.name, company.slug, company.id]);



  return (
    <div style={{ background:T.bg2, borderRadius:14, border:`1px solid ${open ? T.accent : T.border}`, overflow:"hidden", marginBottom:1 }}>
      {/* Slim row — always visible */}
      <div onClick={handleTap} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}>
        <CompanyLogo company={company} size={36} />
        <div style={{ display:"none" }}>{/* legacy initials avatar slot (now handled by CompanyLogo) */}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:16, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.name}</div>
          <div style={{ fontSize:13, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.cat}</div>
        </div>
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>
          {/* UX 3A: compare toggle */}
          {onToggleCompare && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
              aria-label={inCompare ? "Remove from compare" : "Add to compare"}
              title={inCompare ? "In compare" : "Compare"}
              style={{ width:28, height:28, padding:0, borderRadius:8, border:`1px solid ${inCompare ? T.accent : "transparent"}`, background:inCompare ? T.accentBg : "transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, lineHeight:1, color: inCompare ? T.accent2 : T.txt3, fontWeight:700 }}
            >
              <i className="ti ti-arrows-left-right" aria-hidden="true" style={{ fontSize:14 }} />
            </button>
          )}
          {/* UX 7A: save/star toggle — Unicode ★/☆ for reliable filled vs outlined rendering */}
          {onToggleSave && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
              aria-label={isSaved ? "Unsave" : "Save"}
              title={isSaved ? "Saved" : "Save for later"}
              style={{ width:28, height:28, padding:0, borderRadius:8, border:"none", background:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, lineHeight:1, color: isSaved ? T.gold : T.txt3 }}
            >
              <span aria-hidden="true">{isSaved ? "★" : "☆"}</span>
            </button>
          )}
          {!isPaid && <i className="ti ti-lock" style={{fontSize:11,color:T.txt3}} aria-hidden="true" />}
          {(() => {
            const gradeRowColors = {
              A: { bg:"#0d2318", border:"#1e3e2e", text:"#4caf82" },
              B: { bg:"#1a2810", border:"#2e3e1e", text:"#8bc34a" },
              C: { bg:"#2a2210", border:"#3e321e", text:"#f0a030" },
              D: { bg:"#2a1810", border:"#3e2818", text:"#ff7043" },
              F: { bg:"#2a0d0d", border:"#3e1e1e", text:"#e24a4a" },
              "?": { bg:T.bg3, border:T.border2, text:T.txt3 },
            };
            const rc = gradeRowColors[profile ? grade : "?"];
            return (
              <div style={{ width:38, height:38, borderRadius:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:rc.bg, border:`1px solid ${rc.border}` }} title={profile ? "Your personalized grade" : "Take the values quiz to see grades"}>
                <div style={{ fontSize:isPaid?17:22, fontWeight:700, color:rc.text, lineHeight:1 }}>{profile ? grade : "?"}</div>
                {isPaid && profile && <div style={{ fontSize:10, color:rc.text, opacity:0.7 }}>{ps}</div>}
              </div>
            );
          })()}
          <i className={`ti ${open ? "ti-chevron-up" : "ti-chevron-down"}`} style={{fontSize:13,color:T.txt3}} aria-hidden="true" />
        </div>
      </div>

      {/* Detail — paid only */}
      {open && isPaid && (
        <div style={{ borderTop:`1px solid ${T.border}`, padding:14, background:T.bg2 }}>
          {/* Phase 3.1: thin loading bar while we fetch full detail */}
          {loadingDetail && (
            <div style={{ height:2, background:T.accent, opacity:0.5, marginBottom:12, borderRadius:1, animation:"pulse 1.5s ease-in-out infinite" }} aria-label="Loading details" />
          )}
          {/* Federal penalty callout. Phase 4.11: now triggers on the FACT
              (≥$5M in penalties), not the app's grade verdict. Lets users
              see the raw data and decide for themselves. */}
          {(() => {
            const vt = enriched.violationTracker;
            const hasSignificantPenalty = vt && vt.totalPenalty && vt.totalPenalty >= 5_000_000; // ≥$5M
            if (!hasSignificantPenalty) return null;
            const penFmt = vt.totalPenalty >= 1e9
              ? `$${(vt.totalPenalty/1e9).toFixed(2)}B`
              : `$${(vt.totalPenalty/1e6).toFixed(1)}M`;
            const topOffense = vt.primaryOffenses?.[0]?.category;
            return (
              <div style={{ background:"#2a0d0d", border:`1px solid ${T.rep}`, borderRadius:10, padding:"10px 12px", marginBottom:12, display:"flex", alignItems:"flex-start", gap:10 }}>
                <i className="ti ti-alert-triangle" style={{ fontSize:18, color:T.rep, flexShrink:0, marginTop:1 }} aria-hidden="true" />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:T.rep, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:2 }}>Federal penalties</div>
                  <div style={{ fontSize:14, fontWeight:600, color:T.txt, lineHeight:1.3 }}>
                    {penFmt} across {vt.totalRecords} record{vt.totalRecords === 1 ? "" : "s"}
                  </div>
                  {topOffense && (
                    <div style={{ fontSize:11, color:T.txt3, marginTop:3, lineHeight:1.4 }}>
                      Top offense: {topOffense}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
          {/* Direct competitors list — Phase 4.11 made this neutral. We no
              longer label them "better alternatives" (a verdict) — just
              "competitors". For users WITH a profile, we surface companies
              that score higher relative to THEIR preferences. */}
          {(() => {
            const comps = Array.isArray(enriched.competitors) ? enriched.competitors : [];
            if (!comps.length || !allCompanies?.length) return null;
            const lookup = new Map(allCompanies.map(c => [c.slug || c.id, c]));
            const competitorsResolved = comps.map(slug => lookup.get(slug)).filter(Boolean);
            // With a profile, filter to those scoring meaningfully higher than
            // the current company (≥7 points, ~one letter grade better).
            // Without a profile, show all competitors so the user can compare.
            const display = profile
              ? competitorsResolved.filter(c => computeScore(c, profile) >= ps + 7).slice(0, 4)
              : competitorsResolved.slice(0, 4);
            if (!display.length) return null;
            return (
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:T.accent2, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8, display:"flex", alignItems:"center", gap:5 }}>
                  <i className="ti ti-arrows-left-right" aria-hidden="true" /> {profile ? "Higher-scoring competitors" : "Direct competitors"}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {display.map(alt => (
                    <button
                      key={alt.slug || alt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onCompareWith) onCompareWith(alt.slug || alt.id, alt.name);
                        track("competitor_pick", { from: enriched.slug || enriched.id, to: alt.slug || alt.id });
                      }}
                      style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"6px 10px", background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:16, cursor:"pointer", color:T.txt, fontSize:12 }}
                    >
                      <span style={{ fontWeight:700 }}>{alt.name}</span>
                      {profile && <span style={{ padding:"1px 6px", borderRadius:8, background:alt.grade === "A" ? "#0d2318" : T.bg, color:alt.grade === "A" ? "#4caf82" : T.txt2, fontSize:10, fontWeight:700 }}>{alt.grade}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {/* Phase 5.x: YUKA-inspired hero score block.
              Big circular grade badge color-coded by letter (green=A, yellow=B,
              orange=C, red=D, dark red=F). Visual-first; the rest of the
              profile flows below it. Pre-quiz users see a neutral grey circle. */}
          {(() => {
            const gradeColors = {
              A: { bg:"#0d2318", border:"#4caf82", text:"#4caf82" },
              B: { bg:"#1a2810", border:"#8bc34a", text:"#8bc34a" },
              C: { bg:"#2a2210", border:"#f0a030", text:"#f0a030" },
              D: { bg:"#2a1810", border:"#ff7043", text:"#ff7043" },
              F: { bg:"#2a0d0d", border:"#e24a4a", text:"#e24a4a" },
              "?": { bg:T.bg3, border:T.border2, text:T.txt3 },
            };
            const gc = gradeColors[profile ? grade : "?"];
            return (
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18, padding:"14px 14px 16px", background:T.bg3, borderRadius:14, border:`1px solid ${T.border}` }}>
                <div style={{
                  width:78, height:78, borderRadius:"50%",
                  background:gc.bg, border:`3px solid ${gc.border}`,
                  display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
                }}>
                  <div style={{ fontSize:38, fontWeight:800, color:gc.text, lineHeight:1 }}>
                    {profile ? grade : "?"}
                  </div>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  {profile ? (
                    <>
                      <div style={{ fontSize:22, fontWeight:700, color:T.txt, lineHeight:1.1 }}>{ps}<span style={{ fontSize:14, color:T.txt3, fontWeight:500 }}>/100</span></div>
                      <div style={{ fontSize:12, color:T.txt3, marginTop:2 }}>{enriched.cat} · your personalized score</div>
                      {(() => {
                        // Phase 5.y "Why this grade?" — surface the 1–2 categories
                        // that moved the needle most on this user's score, derived
                        // from |scoreCat − 50| × weight. Plain English, no judgment.
                        const baseW = {
                          political:profile.weights?.political||3, charity:profile.weights?.charity||2,
                          environment:profile.weights?.environment||3, labor:profile.weights?.labor||3,
                          dei:profile.weights?.dei||3, animals:profile.weights?.animals||2,
                          guns:profile.weights?.guns||2, privacy:profile.weights?.privacy||2,
                          execPay:profile.weights?.execPay||2,
                        };
                        const impacts = CAT_KEYS.map(k => {
                          const v = enriched.sc?.[k];
                          if (getDataState(k, v) === "unknown") return null;
                          if (String(v||"").toLowerCase() === "neutral") return null;
                          const sc = scoreCat(k, v, profile);
                          const delta = sc - 50;
                          return { k, sc, delta, impact: Math.abs(delta) * baseW[k] };
                        }).filter(Boolean).sort((a,b) => b.impact - a.impact);
                        const top = impacts.slice(0, 2);
                        if (!top.length) return null;
                        const reasonFor = (it) => {
                          const cat = CAT_LABELS[it.k];
                          const goodOrBad = it.delta > 0 ? "helped" : "hurt";
                          return `${cat} ${goodOrBad}`;
                        };
                        return (
                          <div style={{ marginTop:8, fontSize:11, color:T.txt2, lineHeight:1.4 }}>
                            <span style={{ color:T.txt3 }}>Why: </span>
                            {top.map((it, i) => (
                              <span key={it.k}>
                                {i > 0 && ", "}
                                <span style={{ color: it.delta > 0 ? "#4caf82" : "#e24a4a", fontWeight:600 }}>{reasonFor(it)}</span>
                              </span>
                            ))}
                            {top[0] && <span style={{ color:T.txt3 }}> most</span>}
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:14, fontWeight:600, color:T.txt, lineHeight:1.2 }}>Take the 30-second quiz</div>
                      <div style={{ fontSize:12, color:T.txt3, marginTop:3, lineHeight:1.4 }}>{enriched.cat} · data shown below; your values set the grade</div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* All categories — symbol + label + detail */}
          {CAT_KEYS.map(k => {
            const d = enriched[k] || {};
            const disp = getDisplay(k, enriched.sc?.[k], profile);
            const state = getDataState(k, enriched.sc?.[k]);
            const isUnknown = state === "unknown";
            // YUKA-inspired color coding: green for positive, red for documented
            // negatives, amber for mixed, neutral grey otherwise. Lifts the
            // visual hierarchy beyond "everything looks the same".
            const enumV = String(enriched.sc?.[k] || "").toLowerCase();
            const POS = ["positive","excellent","strong","good","cruelty_free","fair","pro_dei","bipartisan"];
            const NEG = ["negative","poor","very poor","below average","tests_animals","sells_guns","makes_guns","anti_dei"];
            const MIX = ["mixed","some_testing"];
            const tone = isUnknown ? "unknown"
              : POS.includes(enumV) ? "good"
              : NEG.includes(enumV) ? "bad"
              : MIX.includes(enumV) ? "mid"
              : "neutral";
            const badgeStyle =
              tone === "unknown" ? { background:"transparent", color:T.txt3, border:`1px dashed ${T.border2}`, opacity:0.75 }
              : tone === "good"  ? { background:"#0d2318", color:"#4caf82", border:"1px solid #1e3e2e" }
              : tone === "bad"   ? { background:"#2a0d0d", color:"#e24a4a", border:"1px solid #3e1e1e" }
              : tone === "mid"   ? { background:"#2a1a05", color:"#f0a030", border:"1px solid #3e2a15" }
              : { background:T.bg3, color:T.txt2, border:`1px solid ${T.border2}` };
            return (
              <div key={k} style={{ marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${T.border}`, opacity: isUnknown ? 0.7 : 1 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.05em", display:"flex", alignItems:"center", gap:5 }}>
                    <i className={`ti ${CAT_ICONS[k]}`} aria-hidden="true" />
                    {CAT_FULL[k]}
                  </div>
                  {k === "political" && !isUnknown ? (
                    /* UX 5C: spectrum bar in lieu of the cryptic ◀ ▶ ◆ badge */
                    <PoliticalSpectrum lean={enriched.sc?.political} />
                  ) : (
                    <span
                      title={isUnknown ? "No data ingested yet — this category is excluded from the overall grade." : ""}
                      style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"3px 10px", borderRadius:20, fontSize:12, fontWeight:700, ...badgeStyle }}
                    >
                      {isUnknown ? (
                        <>? No data</>
                      ) : (
                        <>{disp.sym} {disp.label}</>
                      )}
                    </span>
                  )}
                </div>
                {!isUnknown && (
                  <>
                    <div style={{ fontSize:13, color:T.txt2, lineHeight:1.6 }}>{stripCites(d.s || d.summary || "")}</div>
                    {(d.sources||[]).length > 0 && (
                      <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                        {d.sources.map(src => <span key={src} style={{ padding:"2px 7px", fontSize:10, borderRadius:20, background:T.accentBg, color:T.accent2, border:`1px solid ${T.accent}` }}>{src}</span>)}
                      </div>
                    )}
                  </>
                )}
                {isUnknown && (
                  <div style={{ fontSize:11, color:T.txt3, lineHeight:1.5, fontStyle:"italic" }}>
                    Not penalized — excluded from this company's overall grade.
                  </div>
                )}
              </div>
            );
          })}

          {/* Share button — UX 2A. Uses Web Share API on iOS Safari/PWA;
              falls back to copying a URL to the clipboard on desktop browsers. */}
          <div style={{ display:"flex", gap:8 }}>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const shareUrl = `https://www.trunorthapp.com/company/${encodeURIComponent(enriched.slug || enriched.id)}`;
                const shareData = {
                  title: `${enriched.name} on TruNorth`,
                  text:  profile
                    ? `Check out ${enriched.name}'s record on TruNorth — politics, labor, environment, and more.`
                    : `${enriched.name} — see their political donations, labor record, and environmental data on TruNorth.`,
                  url:   shareUrl,
                };
                let method = "unknown";
                try {
                  if (navigator.share && navigator.canShare?.(shareData) !== false) {
                    await navigator.share(shareData);
                    method = "native-share";
                  } else if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(shareUrl);
                    method = "clipboard";
                    // Light feedback for desktop users
                    const btn = e.currentTarget;
                    const orig = btn.innerText;
                    btn.innerText = "✓ Link copied";
                    setTimeout(() => { if (btn) btn.innerText = orig; }, 1500);
                  } else {
                    window.prompt("Copy this link:", shareUrl);
                    method = "prompt-fallback";
                  }
                } catch (err) {
                  // User dismissed share sheet — not an error, just no-op
                  if (err?.name !== "AbortError") {
                    console.error("share failed:", err);
                  }
                  method = err?.name === "AbortError" ? "user-cancelled" : "error";
                }
                track("share_clicked", { slug: enriched.slug || enriched.id, name: enriched.name, grade, method });
              }}
              style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2 }}
            >
              <i className="ti ti-share" aria-hidden="true" />
              Share
            </button>
          </div>


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
  // Phase 5.y bug fix: combined-question pages were advancing when ONLY the
  // primary question had an answer. Now every sub-question must be answered.
  const canAdvance = isWelcome || current?.type === "multi"
    || (current?.type === "scale"  && answers[current?.id] !== undefined)
    || (current?.type === "single" && answers[current?.id] !== undefined)
    || (current?.type === "single+scale" && answers[current?.id] !== undefined && answers[current?.scaleId] !== undefined)
    || (current?.type === "scale+single" && answers[current?.id] !== undefined && answers[current?.singleId] !== undefined)
    || (current?.type === "scale+scale"  && answers[current?.id] !== undefined && answers[current?.scale2Id] !== undefined);

  const advance = () => {
    if (isLast) {
      onComplete({
        lean:            answers.politicalLean || "neutral",
        deiLean:         answers.deiLean       || "neutral",
        animalTesting:   answers.animalTesting || "neutral",
        guns:            answers.guns          || "neutral",
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
    } else {
      // For combined steps, copy secondary answers with correct keys
      if (current?.type === "single+scale" && current.scaleId) {
        // scaleId answer already set via set() — nothing extra needed
      }
      if (current?.type === "scale+single" && current.singleId) {
        // singleId answer already set via set() — nothing extra needed
      }
      setStep(s => s+1);
    }
  };

  const set = (k, v) => setAnswers(a => ({ ...a, [k]: v }));
  const toggleMulti = (k, v) => {
    const cur = answers[k] || [];
    set(k, cur.includes(v) ? cur.filter(x=>x!==v) : [...cur, v]);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100dvh", paddingTop:"env(safe-area-inset-top, 0px)" }}>
      <div style={{ padding:"10px 16px 0" }}>
        <div style={{ height:4, background:T.bg3, borderRadius:4 }}>
          <div style={{ height:4, background:T.accent, borderRadius:4, width:`${prog}%`, transition:"width 0.3s" }} />
        </div>
        {step > 0 && <div style={{ fontSize:11, color:T.txt3, textAlign:"right", marginTop:5 }}>{step} of {QUIZ_STEPS.length}</div>}
      </div>

      <div style={{ flex:1, padding:"12px 16px 24px", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
        {isWelcome && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", paddingTop:20 }}>
            <div style={{ width:64, height:64, background:T.accentBg, borderRadius:18, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:14 }}>
              <svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/>
              </svg>
            </div>
            <div style={{ fontSize:24, fontWeight:800, color:T.txt, letterSpacing:-1, lineHeight:1 }}>Tru<span style={{ color:T.accent }}>North</span></div>
            <div style={{ fontSize:12, color:T.txt3, letterSpacing:2, textTransform:"uppercase", marginTop:4, marginBottom:10 }}>Know where your money goes</div>
            <div style={{ fontSize:14, color:T.txt3, lineHeight:1.7, maxWidth:300 }}>
              Answer 9 quick steps. Every company's score recalculates based on what you actually care about — politics, DEI, animal testing, guns, privacy, and more.
            </div>
          </div>
        )}

        {(current?.type === "single" || current?.type === "single+scale") && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:12, lineHeight:1.4 }}>
              {current.type === "scale+single" ? current.singleQ : current.q}
            </div>
            {(current.type === "scale+single" ? current.opts : current.opts).map((opt, i) => {
              const sel = answers[current.id] === opt.v && answers[current.id+"_idx"] === i;
              return (
                <button key={i} onClick={() => { set(current.id, opt.v); set(current.id+"_idx", i); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:12, border:`1.5px solid ${sel?T.accent:T.border}`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
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

            {/* Inline scale — shown after user picks an option */}
            {current.type === "single+scale" && answers[current.id] !== undefined && (
              <div style={{ marginTop:16, padding:"14px", background:T.bg3, borderRadius:12, border:`1px solid ${T.border2}` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:12 }}>{current.scaleQ}</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => set(current.scaleId, n)}
                      style={{ width:48, height:48, borderRadius:10, border:`1.5px solid ${answers[current.scaleId]===n?T.accent:T.border}`, background:answers[current.scaleId]===n?T.accent:T.bg2, color:answers[current.scaleId]===n?"#fff":T.txt, fontSize:16, fontWeight:700, cursor:"pointer" }}>{n}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3 }}>
                  <span>{current.lo}</span><span>{current.hi}</span>
                </div>
              </div>
            )}
          </>
        )}

        {(current?.type === "scale" || current?.type === "scale+single" || current?.type === "scale+scale") && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:16, lineHeight:1.4 }}>{current.q}</div>
            <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:10 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => set(current.id, n)}
                  style={{ width:52, height:52, borderRadius:12, border:`1.5px solid ${answers[current.id]===n?T.accent:T.border}`, background:answers[current.id]===n?T.accent:T.bg2, color:answers[current.id]===n?"#fff":T.txt, fontSize:17, fontWeight:700, cursor:"pointer" }}>{n}</button>
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3, marginBottom:8 }}>
              <span>{current.lo}</span><span>{current.hi}</span>
            </div>
            {answers[current.id] && (
              <div style={{ textAlign:"center", fontSize:13, fontWeight:600, color:T.accent2, marginBottom:12 }}>
                {["","Not important","Slightly important","Moderately important","Very important","Extremely important"][answers[current.id]]}
              </div>
            )}

            {/* Second scale for scale+scale type */}
            {current.type === "scale+scale" && (
              <div style={{ marginTop:8, padding:"14px", background:T.bg3, borderRadius:12, border:`1px solid ${T.border2}` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:12 }}>{current.scale2Q}</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => set(current.scale2Id, n)}
                      style={{ width:48, height:48, borderRadius:10, border:`1.5px solid ${answers[current.scale2Id]===n?T.accent:T.border}`, background:answers[current.scale2Id]===n?T.accent:T.bg2, color:answers[current.scale2Id]===n?"#fff":T.txt, fontSize:16, fontWeight:700, cursor:"pointer" }}>{n}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3 }}>
                  <span>{current.lo2}</span><span>{current.hi2}</span>
                </div>
              </div>
            )}

            {/* Inline single for scale+single type */}
            {current.type === "scale+single" && (
              <div style={{ marginTop:8, padding:"14px", background:T.bg3, borderRadius:12, border:`1px solid ${T.border2}` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>{current.singleQ}</div>
                {current.opts.map((opt, i) => {
                  const sel = answers[current.singleId] === opt.v && answers[current.singleId+"_idx"] === i;
                  return (
                    <button key={i} onClick={() => { set(current.singleId, opt.v); set(current.singleId+"_idx", i); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10, border:`1.5px solid ${sel?T.accent:T.border}`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
                      <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${sel?T.accent:T.border2}`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {sel && <i className="ti ti-check" style={{ fontSize:11, color:"#fff" }} aria-hidden="true" />}
                      </div>
                      {opt.icon && <i className={`ti ${opt.icon}`} style={{ fontSize:16, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />}
                      <span style={{ fontSize:13, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                    </button>
                  );
                })}
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
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 12px", borderRadius:12, border:`1.5px solid ${sel?T.accent:T.border}`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
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

      <div style={{ display:"flex", gap:10, padding:"12px 16px", paddingBottom:"calc(12px + env(safe-area-inset-bottom, 0px))", borderTop:`1px solid ${T.border}`, background:T.bg, position:"sticky", bottom:0, flexShrink:0 }}>
        {step > 0 && <button onClick={()=>setStep(s=>s-1)} style={{ padding:"11px 16px", borderRadius:12, border:`1px solid ${T.border}`, background:T.bg3, color:T.txt2, fontSize:14, fontWeight:600, cursor:"pointer" }}>←</button>}
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

  const submit = async () => {
    if (!company.trim() || !detail.trim()) { alert("Please fill in company name and description."); return; }
    // 4.7: Pro users submitting are already known to us by email; surface this as
    // a submission event so the pipeline team sees demand. If we collect an email
    // later (free submit), wire it here too.
    track("submit_company", { type, category: cat, companyName: company.trim() });
    setSent(true); setCompany(""); setDetail(""); setSource("");
    setTimeout(() => setSent(false), 4000);
  };

  const inp = { width:"100%", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:8, color:T.txt, fontSize:14, padding:"11px 13px", marginBottom:14 };
  const lbl = { fontSize:12, fontWeight:600, color:T.txt3, marginBottom:6, display:"block", textTransform:"uppercase", letterSpacing:"0.04em" };

  return (
    <div style={{ padding:16 }}>
      <p style={{ fontSize:13, color:T.txt3, marginBottom:16, lineHeight:1.6 }}>Help us keep data accurate. Flag a correction or suggest a company to add.</p>
      {sent && <div style={{ background:"#0d2318", border:"1px solid #4caf82", borderRadius:12, padding:14, color:"#4caf82", fontSize:14, fontWeight:600, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}><i className="ti ti-check" style={{fontSize:18}} aria-hidden="true" /> Submitted — thanks!</div>}
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
  {group:"Company universe",icon:"ti-building",items:[
    {name:"SEC EDGAR",url:"https://www.sec.gov/edgar/searchedgar/companysearch",desc:"Official US filings — pulls every public ticker plus the 10-K Exhibit 21 subsidiary tree for ownership graphs."},
    {name:"Wikidata",url:"https://www.wikidata.org",desc:"Open knowledge graph used to map consumer brands back to their corporate parents (e.g. Aunt Jemima → PepsiCo)."},
    {name:"Open Food Facts",url:"https://world.openfoodfacts.org",desc:"Crowdsourced food product database — adds brand-to-parent links for grocery."},
  ]},
  {group:"Political donations",icon:"ti-flag-2",items:[
    {name:"FEC.gov",url:"https://www.fec.gov",desc:"Official US federal campaign finance API. Maps every company donation and lobbying disclosure to candidate / party / lean."},
    {name:"OpenSecrets.org",url:"https://www.opensecrets.org",desc:"Tracks aggregated political donations, PAC spending, lobbying, and candidate fundraising."},
    {name:"InfluenceMap",url:"https://influencemap.org",desc:"Scores companies on climate-policy lobbying and political influence."},
  ]},
  {group:"Charitable giving",icon:"ti-heart",items:[
    {name:"Charity Navigator",url:"https://www.charitynavigator.org",desc:"Rates 1.8M nonprofits on financial health, accountability, and transparency."},
    {name:"Candid / GuideStar",url:"https://candid.org",desc:"Largest database of nonprofit 990 forms."},
  ]},
  {group:"Environmental",icon:"ti-leaf",items:[
    {name:"CDP (Carbon Disclosure Project)",url:"https://www.cdp.net",desc:"World's largest environmental disclosure system. Companies scored A–D on climate, water, forests."},
    {name:"B Corp Certification",url:"https://www.bcorporation.net",desc:"Rigorous certification for companies meeting high social and environmental standards."},
    {name:"EPA Enforcement",url:"https://www.epa.gov/enforcement",desc:"Federal environmental enforcement actions — Clean Air, Clean Water, Superfund."},
    {name:"Break Free From Plastic",url:"https://www.breakfreefromplastic.org",desc:"Annual Brand Audit ranks top plastic polluters globally."},
  ]},
  {group:"Labor practices",icon:"ti-users",items:[
    {name:"OSHA (osha.gov)",url:"https://www.osha.gov",desc:"Federal workplace safety inspections, violations, and fines."},
    {name:"NLRB (nlrb.gov)",url:"https://www.nlrb.gov",desc:"National Labor Relations Board — unfair labor practice cases and union elections."},
    {name:"Violation Tracker",url:"https://violationtracker.goodjobsfirst.org",desc:"Aggregates federal penalties across 50+ agencies — wage theft, safety, environmental, antitrust."},
    {name:"Oxfam Scorecard",url:"https://www.oxfam.org/en/research/behind-brands",desc:"Rates major food companies on worker rights."},
  ]},
  {group:"Supply-chain & human rights",icon:"ti-world",items:[
    {name:"BHRRC (Business & Human Rights Resource Centre)",url:"https://www.business-humanrights.org",desc:"Tracks human-rights allegations against companies including forced labor, child labor, and modern slavery."},
    {name:"US DOL — List of Goods Produced by Child or Forced Labor",url:"https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods",desc:"Department of Labor's annual list flagging products with documented forced or child-labor risk."},
    {name:"Yale CELI — Russia Exit Tracker",url:"https://som.yale.edu/story/2022/over-1000-companies-have-curtailed-operations-russia-some-remain",desc:"Yale School of Management's grades A–F on whether companies pulled out of Russia after the 2022 invasion."},
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
  {group:"Data privacy & breaches",icon:"ti-lock",items:[
    {name:"Have I Been Pwned",url:"https://haveibeenpwned.com",desc:"Curated database of 1,000+ documented data breaches with account counts and exposed data classes."},
    {name:"EFF (Electronic Frontier Foundation)",url:"https://www.eff.org",desc:"Tracks corporate surveillance practices and data privacy records."},
    {name:"Mozilla Privacy Not Included",url:"https://foundation.mozilla.org/en/privacynotincluded/",desc:"Rates apps and services on data collection and privacy practices."},
  ]},
  {group:"Health & product safety",icon:"ti-stethoscope",items:[
    {name:"OpenFDA",url:"https://open.fda.gov",desc:"Public FDA enforcement API — pulls every food, drug, and device recall, classified by severity (Class I / II / III)."},
  ]},
  {group:"Executive pay",icon:"ti-coin",items:[
    {name:"AFL-CIO Executive Paywatch",url:"https://aflcio.org/paywatch",desc:"Tracks CEO-to-worker pay ratios at major US corporations."},
    {name:"SEC Executive Compensation Proxy",url:"https://www.sec.gov/cgi-bin/browse-edgar",desc:"Official source for executive compensation disclosures."},
  ]},
  {group:"Synthesis & narratives",icon:"ti-cpu",items:[
    {name:"Anthropic Claude (Haiku)",url:"https://www.anthropic.com",desc:"Synthesizes the per-category narratives and competitor lists from the verified data above. We do NOT trust Claude alone — government data overrides any AI claim."},
  ]},
];

// ─── BROWSE BUCKET MAP (module scope — used in filtered search) ───────────────
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
  const lc = c.toLowerCase();
  for (const [bucket, keywords] of Object.entries(CAT_BUCKET_MAP)) {
    // EXACT match only (case-insensitive). The previous bidirectional
    // `includes` check caused "Manufacturing" to match "Apparel Manufacturing"
    // and dump everything into Apparel & Fashion. Strict equality keeps
    // buckets honest at the cost of slightly more "uncategorized" fallback.
    if (keywords.some(k => k.toLowerCase() === lc)) return bucket;
  }
  return c;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// UX 5C: PoliticalSpectrum — visual bar showing exact lean position.
// Replaces the ambiguous ◀ ▶ ◆ symbols on the political category card.
function PoliticalSpectrum({ lean }) {
  // Position 0..1 on a left → right axis
  const positions = {
    "left":           0.10,
    "left-leaning":   0.28,
    "mixed":          0.50,
    "bipartisan":     0.50,
    "neutral":        0.50,
    "right-leaning":  0.72,
    "right":          0.90,
  };
  const pos = positions[(lean || "").toLowerCase()];
  if (pos == null) return null;
  // Color by lean
  const dotColor = pos < 0.4 ? "#4a90e2"
                : pos > 0.6 ? "#e24a4a"
                : "#9b8ff0";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end", minWidth:120 }}>
      <div style={{
        position:"relative", width:120, height:6, borderRadius:3,
        background: "linear-gradient(to right, #4a90e2 0%, #4a90e2 30%, #555 45%, #555 55%, #e24a4a 70%, #e24a4a 100%)",
      }} aria-hidden="true">
        <div style={{
          position:"absolute", top:-3, left:`calc(${pos*100}% - 6px)`,
          width:12, height:12, borderRadius:"50%",
          background:dotColor, border:"2px solid #1a1a1a",
        }} />
      </div>
      <div style={{ fontSize:10, color:"#888", display:"flex", justifyContent:"space-between", width:120 }} aria-hidden="true">
        <span>Left</span><span>Center</span><span>Right</span>
      </div>
    </div>
  );
}

// Phase 5.3: SuggestBrandButton — captures a failed search query so the
// pipeline can pick it up on the next expansion. Stored client-side AND
// surfaced via PostHog so the demand signal is visible in analytics.
function SuggestBrandButton({ query }) {
  const [submitted, setSubmitted] = useState(() => {
    try {
      const pending = JSON.parse(localStorage.getItem("tn_pendingSubmits") || "[]");
      return pending.some(s => s.query.toLowerCase() === query.toLowerCase());
    } catch { return false; }
  });
  const submit = () => {
    try {
      const pending = JSON.parse(localStorage.getItem("tn_pendingSubmits") || "[]");
      if (!pending.some(s => s.query.toLowerCase() === query.toLowerCase())) {
        pending.push({ query, suggestedAt: new Date().toISOString() });
        localStorage.setItem("tn_pendingSubmits", JSON.stringify(pending.slice(-50))); // cap
      }
    } catch {}
    track("failed_search_suggest", { query });
    setSubmitted(true);
  };
  if (submitted) {
    return (
      <div style={{ fontSize:13, color:"#4caf82", display:"inline-flex", alignItems:"center", gap:6 }}>
        <i className="ti ti-check" aria-hidden="true" />
        Thanks — we'll look at adding it
      </div>
    );
  }
  return (
    <button onClick={submit} style={{
      padding:"10px 16px", borderRadius:10, border:`1px solid ${T.accent}`,
      background:T.accentBg, color:T.accent2, fontSize:13, fontWeight:600, cursor:"pointer",
      display:"inline-flex", alignItems:"center", gap:6
    }}>
      <i className="ti ti-plus" aria-hidden="true" />
      Suggest &ldquo;{query}&rdquo; to be added
    </button>
  );
}

export default function App() {
  // Dev-only QA helper: ?skipOnboarding=1 and ?pro=1 let the simulator + Chrome
  // tests bypass onboarding without persisting state on real production users.
  const __qp = (typeof window !== "undefined") ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (import.meta.env.DEV && __qp.has("skipOnboarding")) {
    try { localStorage.setItem("tn_hasOnboarded", "1"); } catch {}
  }
  const hasOnboarded = localStorage.getItem("tn_hasOnboarded");
const [screen, setScreen] = useState("splash");
const [currentUser, setCurrentUser] = useState(() => {
  try { return JSON.parse(localStorage.getItem("tn_user") || "null"); } catch { return null; }
});
// Phase 5.y: persist profile across sessions so a returning user doesn't lose
// their personalization after a reload (and so paying after a quiz doesn't
// trigger a retake).
const [profile, setProfile]   = useState(() => {
  try { return JSON.parse(localStorage.getItem("tn_profile") || "null"); } catch { return null; }
});
useEffect(() => {
  try {
    if (profile) localStorage.setItem("tn_profile", JSON.stringify(profile));
    else         localStorage.removeItem("tn_profile");
  } catch {}
}, [profile]);
  // Dev-only Pro mode for QA: append `?pro=1` to localhost URL. Production-safe
  // because we additionally require import.meta.env.DEV.
  const [isPaid, setIsPaid]     = useState(() =>
    import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("pro")
  );
  const [showPaywall, setShowPaywall] = useState(false);


  const [tab, setTab]           = useState(() => {
    // Dev-only: ?tab=search|browse|top|account|sources opens that tab directly (for QA)
    if (import.meta.env.DEV && typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && ["top","search","browse","account","sources","submit"].includes(t)) return t;
    }
    return "top";
  });
  // UX 1B: debounce — input binds to queryRaw, filter uses query (150ms lag)
  const [queryRaw, setQueryRaw] = useState("");
  const [query, setQuery]       = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(queryRaw), 150);
    return () => clearTimeout(id);
  }, [queryRaw]);
  const [leanFilter, setLeanFilter] = useState("all");
  const [catFilters, setCatFilters] = useState([]); // multi-select — empty = all
  const [flagFilters, setFlagFilters] = useState([]); // multi-select boolean flags
  const toggleFlag = (id) => setFlagFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const [sort, setSort]             = useState("name");

  // UX 7A: saved/favorites — Set of slugs, persisted in localStorage.
  // Declared early so the `filtered` memo below can reference it.
  const [savedSet, setSavedSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("tn_saved") || "[]")); }
    catch { return new Set(); }
  });
  const [showSavedOnly, setShowSavedOnly] = useState(false);

  // UX 3A (Phase 4.6): Compare 2 Companies — array of {slug, name} pairs, max 2.
  const [compareList, setCompareList] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const isInCompare = (slug) => compareList.some(c => c.slug === slug);
  const toggleCompare = (slug, name) => {
    setCompareList(prev => {
      const exists = prev.find(c => c.slug === slug);
      if (exists) {
        track("compare_remove", { slug, name });
        return prev.filter(c => c.slug !== slug);
      }
      // Cap at 2 — replace the older one when a 3rd is added
      const next = [...prev, { slug, name }].slice(-2);
      track("compare_add", { slug, name, total: next.length });
      return next;
    });
  };
  const toggleSaved = (slug, name) => {
    setSavedSet(prev => {
      const next = new Set(prev);
      const wasSaved = next.has(slug);
      if (wasSaved) next.delete(slug); else next.add(slug);
      try { localStorage.setItem("tn_saved", JSON.stringify([...next])); } catch {}
      track(wasSaved ? "unsave_company" : "save_company", { slug, name });
      return next;
    });
  };

  // Analytics — init once, then track key funnel events
  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => {
    if (showPaywall) track("paywall_shown", { tab, isPaid });
  }, [showPaywall]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = globalCSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // Keep --app-height correct after React mounts.
  // Standalone PWA: use screen.height (full physical screen in CSS px).
  //   screen.height NEVER changes when the iOS keyboard opens/closes, which
  //   is critical — window.innerHeight shrinks on keyboard-open and iOS does
  //   not reliably fire a resize event when the keyboard closes, so using
  //   innerHeight causes --app-height to permanently stick at the wrong value.
  // Browser mode: use innerHeight and track resize normally.
  useEffect(() => {
    const standalone = window.navigator.standalone === true;
    if (standalone) {
      // Set once; screen.height is static on iOS, no resize listener needed.
      const h = window.screen.height || window.innerHeight;
      document.documentElement.style.setProperty("--app-height", h + "px");
    } else {
      const setAppHeight = () => {
        document.documentElement.style.setProperty("--app-height", window.innerHeight + "px");
      };
      setAppHeight();
      window.addEventListener("resize", setAppHeight);
      return () => window.removeEventListener("resize", setAppHeight);
    }
  }, []);

  // Phase 3.1: source companies from either the split-bundle loader (flag on,
  // fast initial paint) or the dynamic-imported legacy monolith (flag off).
  // Both paths are async — splash holds until companies is non-null.
  // On primary failure, fall back to the OTHER source so prod stays alive even
  // if one path is broken.
  const [companies, setCompanies] = useState(null);

  // Phase 5.y / UX 7B: barcode scanner modal state. Opened from the search bar.
  const [showScanner, setShowScanner] = useState(false);

  // Deep-link slug: parsed from /company/<slug>. CompanyCard reads it and
  // auto-expands the matching row on first render so shared links open the
  // intended company profile.
  const [deepLinkSlug, setDeepLinkSlug] = useState(() => {
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/^\/company\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  useEffect(() => {
    if (companies) return;
    let cancelled = false;
    const splitFirst = isSplitBundleEnabled();
    const primary  = () => splitFirst ? loadCompanyIndex() : import("./companies.js").then(m => m.COMPANIES);
    const fallback = () => splitFirst ? import("./companies.js").then(m => m.COMPANIES) : loadCompanyIndex();
    primary()
      .then(list => { if (!cancelled) setCompanies(list); })
      .catch(err => {
        console.error("[dataSource] primary failed, trying fallback:", err);
        fallback()
          .then(list => { if (!cancelled) setCompanies(list); })
          .catch(err2 => console.error("[dataSource] fallback also failed:", err2));
      });
    return () => { cancelled = true; };
  }, [companies]);

  // Deep-link: when companies have loaded and we have a slug from the URL,
  // jump to the search tab and seed the search with the company's name so
  // the card surfaces and CompanyCard's initiallyOpen prop expands it.
  useEffect(() => {
    if (!deepLinkSlug || !companies) return;
    const co = companies.find(c => (c.slug || c.id) === deepLinkSlug);
    if (!co) {
      console.warn("[deep-link] slug not found:", deepLinkSlug);
      setDeepLinkSlug(null);
      return;
    }
    setTab("search");
    setQueryRaw(co.name);
    setQuery(co.name);
    track("deep_link_open", { slug: deepLinkSlug, name: co.name });
    // Replace URL with clean root so back-button works as expected
    try { window.history.replaceState({}, "", "/"); } catch {}
  }, [deepLinkSlug, companies]);

  // UX 1A: memoize the dedupe/filter/sort chain so it doesn't rerun on unrelated state changes
  const deduped = useMemo(
    () => (companies || []).filter((c,i,a) => a.findIndex(x=>x.name===c.name)===i),
    [companies]
  );

  const filtered = useMemo(() => deduped
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
      // Phase 4.9: boolean flag filters — every selected flag must be truthy
      if (flagFilters.length > 0) {
        if (!flagFilters.every(f => !!c[f])) return false;
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.cat.toLowerCase().includes(q) && getBucket(c.cat).toLowerCase() !== q) return false;
      }
      // UX 7A: saved-only filter
      if (showSavedOnly && !savedSet.has(c.slug || c.id)) return false;
      return true;
    })
    .sort((a,b) => {
      if (sort==="score") return computeScore(b,profile) - computeScore(a,profile);
      if (sort==="name") return a.name.localeCompare(b.name);
      const o={left:0,"left-leaning":1,bipartisan:2,mixed:3,neutral:4,right:6,"right-leaning":6};
      return (o[(a.sc.political||"").toLowerCase()]??5) - (o[(b.sc.political||"").toLowerCase()]??5);
    }),
    [deduped, leanFilter, catFilters, flagFilters, query, sort, profile, showSavedOnly, savedSet]
  );

  // UX 4E: recent searches (last 5 distinct queries with at least one result)
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tn_recentSearches") || "[]"); }
    catch { return []; }
  });
  // Trending brands — for v1, hardcoded popular brands; will be PostHog-driven later
  // (Phase 5 demand-driven OpenSecrets uses the same signal).
  const TRENDING_BRANDS = ["Patagonia", "Amazon", "Costco", "Tesla", "Nike"];

  // Analytics — fire `search` when debounced query commits + persist recent
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    track("search", { query: q, result_count: filtered.length });
    // Only stash searches that returned something
    if (filtered.length > 0) {
      setRecentSearches(prev => {
        const next = [q, ...prev.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
        try { localStorage.setItem("tn_recentSearches", JSON.stringify(next)); } catch {}
        return next;
      });
    }
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCat = (f) => setCatFilters(prev => prev.includes(f) ? prev.filter(x=>x!==f) : [...prev, f]);

  // UX 1A: lean counts and category list — memoized since deduped is stable
  const lc = useMemo(() => ({
    left: deduped.filter(c=>["left","left-leaning"].includes((c.sc.political||"").toLowerCase())).length,
    right: deduped.filter(c=>["right","right-leaning"].includes((c.sc.political||"").toLowerCase())).length,
    bi: deduped.filter(c=>["bipartisan","mixed"].includes((c.sc.political||"").toLowerCase())).length,
    neutral: deduped.filter(c=>(c.sc.political||"").toLowerCase()==="neutral").length,
  }), [deduped]);

  const cats = useMemo(() => [...new Set(deduped.map(c=>getBucket(c.cat)))].sort(), [deduped]);

  // UX 6A: pick a single company to tease personalization on, sticky per session.
  // Only computed when there's no profile yet (free user, no quiz taken).
  const [teaserDismissed, setTeaserDismissed] = useState(() => {
    try { return sessionStorage.getItem("tn_teaserDismissed") === "1"; } catch { return false; }
  });
  const teaserCompany = useMemo(() => {
    if (profile) return null;
    if (!deduped.length) return null;
    let stored;
    try { stored = sessionStorage.getItem("tn_teaserCompany"); } catch {}
    if (stored) {
      const hit = deduped.find(c => (c.slug || c.id) === stored);
      if (hit) return hit;
    }
    // Prefer a well-known A/B grade company so the tease is compelling
    const candidates = deduped.filter(c => ["A","B"].includes(scoreGrade(c.overall || 50)));
    const pick = (candidates.length ? candidates : deduped)[Math.floor(Math.random() * (candidates.length || deduped.length))];
    try { sessionStorage.setItem("tn_teaserCompany", pick.slug || pick.id); } catch {}
    return pick;
  }, [deduped, profile]);
  const catIconMap = {Retail:"ti-building-store",Food:"ti-chef-hat",Technology:"ti-device-laptop",Grocery:"ti-shopping-cart",Energy:"ti-bolt",Apparel:"ti-shirt",Media:"ti-device-tv",Finance:"ti-building-bank",Healthcare:"ti-heartbeat",Outdoor:"ti-mountain",Consumer:"ti-package",Conglomerate:"ti-building-skyscraper",Auto:"ti-car",Sports:"ti-ball-basketball"};
  const catBgs = ["#1e1535","#0d2318","#0d1f35","#2a0d0d","#2e1a05","#2a1a05"];
  const catFgs = ["#9b8ff0","#4caf82","#4a90e2","#e24a4a","#e8a042","#f0a030"];

  const TABS = ["search","browse","top","sources","account"];
  const TAB_LABELS = {search:"Search",browse:"Browse",top:"Top picks",sources:"Sources",account:"Account"};



  if (screen === "splash") {
  return <SplashScreen onDone={() => setScreen(hasOnboarded ? "main" : "onboarding")} />;
}

if (screen === "onboarding") {
  return (
    <OnboardingFlow
      onComplete={(user) => {
        setCurrentUser(user);
        setScreen("main");
      }}
    />
  );
}
  if (screen === "quiz") {
    // UX 4A: quiz is now open to all users. Free users complete it and get
    // personalized letter grades; Pro users get personalized number scores
    // + breakdowns + sources. The Pro upsell moves downstream to those features.
    return (
      <div style={{ maxWidth:430, margin:"0 auto" }}>
        {showPaywall && <PaywallScreen initialEmail={currentUser?.email||""} onSubscribe={()=>{setIsPaid(true);setShowPaywall(false);window.scrollTo(0,0);setScreen("main");}} onClose={()=>{setShowPaywall(false);setScreen("main");}} />}
        <Quiz onComplete={(p) => {
          setProfile(p);
          track("quiz_completed", { isPaid });
          setScreen("main");
        }} />
        <div style={{ padding:"0 16px 24px" }}>
          <button onClick={()=>setScreen("main")} style={{ width:"100%", padding:12, borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.txt3, fontSize:14, cursor:"pointer" }}>
            Skip — use AI-generated scores
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height:"100%", width:"100%", maxWidth:430, margin:"0 auto", background:T.bg2, display:"flex", flexDirection:"column" }}>
      {showPaywall && <PaywallScreen initialEmail={currentUser?.email||""} onSubscribe={()=>{
        setIsPaid(true);
        setShowPaywall(false);
        window.scrollTo(0,0);
        // Phase 5.y: don't force a quiz retake if the user already personalized.
        // Previously this always sent them back to step 0 of the 9-question quiz,
        // wiping the experience they just paid for.
        if (!profile) setScreen("quiz");
      }} onClose={()=>setShowPaywall(false)} />}
      {/* UX 7B: barcode scanner overlay — opens camera, decodes, routes to match */}
      {showScanner && (
        <BarcodeScanner
          companies={companies || []}
          onClose={() => setShowScanner(false)}
          onMatch={(co, meta) => {
            setShowScanner(false);
            track("scanner_match", { slug: co.slug || co.id, name: co.name, barcode: meta?.barcode });
            setQueryRaw(co.name);
            setQuery(co.name);
            setTab("search");
            setDeepLinkSlug(co.slug || co.id);
          }}
        />
      )}
      <WhatsNewModal companyCount={companies?.length || 6000} />

      {/* UX 8B: aria-live region for screen readers — announces filtered count
          and which tab is active without visual clutter. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {tab === "search" && (query.trim() || leanFilter !== "all" || catFilters.length > 0 || showSavedOnly)
          ? `${filtered.length} compan${filtered.length === 1 ? "y" : "ies"} match your filters`
          : `${tab} tab`}
      </div>

      {/* Header — Phase 5.y: title is true-centered now (3-column grid) so the
          Pro/Upgrade chip width on the right can't shift it off-center. */}
      <div style={{ padding:"env(safe-area-inset-top, 16px) 16px 12px", background:T.bg, flexShrink:0, zIndex:10, borderBottom:`1px solid ${T.border}` }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:10, marginBottom: tab !== "account" ? 12 : 0 }}>
          <div style={{ display:"flex", justifyContent:"flex-start" }}>
            <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/></svg>
            </div>
          </div>
          <div style={{ textAlign:"center", minWidth:0 }}>
            <div style={{ fontSize:18, fontWeight:700, color:T.txt, letterSpacing:-0.3, lineHeight:1.1 }}>TruNorth</div>
            <div style={{ fontSize:11, color:T.txt3, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>Know where your money goes · {deduped.length} companies</div>
          </div>
          <div style={{ display:"flex", justifyContent:"flex-end" }}>
            {isPaid
              ? <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"4px 10px", borderRadius:20, display:"flex", alignItems:"center", gap:4 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Pro</div>
              : <button onClick={()=>setTab("account")} style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"5px 10px", borderRadius:20, cursor:"pointer", display:"flex", alignItems:"center", gap:4 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Upgrade</button>
            }
          </div>
        </div>
        {tab !== "account" && (
          <div style={{ background:T.bg3, borderRadius:16, padding:"0 14px", display:"flex", alignItems:"center", gap:10, border:`1px solid ${T.border}` }}>
            <i className="ti ti-search" style={{ fontSize:18, color:T.txt3 }} aria-hidden="true" />
            <label htmlFor="tn-search" className="sr-only">Search companies</label>
            <input id="tn-search" value={queryRaw} onChange={e=>{setQueryRaw(e.target.value);setTab("search");}} placeholder={`Search ${deduped.length} companies...`}
              autoComplete="off"
              style={{ background:"transparent", border:"none", color:T.txt, fontSize:15, padding:"12px 0", flex:1 }} />
            {queryRaw && <button onClick={()=>{setQueryRaw("");setQuery("");}} style={{ background:"none", border:"none", color:T.txt3, fontSize:18, cursor:"pointer" }}>×</button>}
            {/* Phase 5.y (UX 7B): in-store barcode scanner — opens camera overlay
                and routes to the matched company. Hidden behind feature detection
                so it doesn't appear in browsers without media-devices support. */}
            {typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && (
              <button
                onClick={() => { setShowScanner(true); track("scanner_open", { tab }); }}
                aria-label="Scan barcode"
                title="Scan a product barcode"
                style={{ background:"none", border:"none", color:T.accent2, fontSize:20, cursor:"pointer", padding:"6px 0", display:"flex", alignItems:"center" }}
              >
                <i className="ti ti-scan" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", background:T.bg }}>

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
        <ErrorBoundary name="search">
          {/* ── Collapsible Filter Panel ── */}
          <FilterPanel
            leanFilter={leanFilter} setLeanFilter={setLeanFilter}
            catFilters={catFilters} setCatFilters={setCatFilters} toggleCat={toggleCat}
            flagFilters={flagFilters} toggleFlag={toggleFlag} setFlagFilters={setFlagFilters}
            lc={lc}
          />
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderBottom:`1px solid ${T.border}`, flexWrap:"wrap" }}>
            <span style={{ fontSize:14, color:T.txt3 }}>Sort:</span>
            {["score","name","lean"].map(sv => (
              <button key={sv} onClick={()=>setSort(sv)} style={{ padding:"5px 10px", borderRadius:20, fontSize:12, fontWeight:sort===sv?600:400, border:`1px solid ${sort===sv?T.accent:T.border}`, background:sort===sv?T.accentBg:T.bg3, color:sort===sv?T.accent2:T.txt2, cursor:"pointer" }}>
                {sv==="score"?"Your score":sv==="name"?"A–Z":"Lean"}
              </button>
            ))}
            {/* UX 7A: Saved filter chip (visible only when user has saved at least one) */}
            {savedSet.size > 0 && (
              <button
                onClick={()=>setShowSavedOnly(v=>!v)}
                style={{ padding:"5px 10px", borderRadius:20, fontSize:12, fontWeight:showSavedOnly?700:500, border:`1px solid ${showSavedOnly?T.gold:T.border}`, background:showSavedOnly?T.goldBg:T.bg3, color:showSavedOnly?T.gold:T.txt2, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}
              >
                <i className="ti ti-star-filled" style={{ fontSize:11 }} aria-hidden="true" />
                Saved {showSavedOnly ? "" : `(${savedSet.size})`}
              </button>
            )}
            <span style={{ marginLeft:"auto", fontSize:11, color:T.txt3 }}>{filtered.length}</span>
            {(leanFilter!=="all"||catFilters.length>0||query||showSavedOnly) && (
              <button onClick={()=>{setLeanFilter("all");setCatFilters([]);setQueryRaw("");setQuery("");setShowSavedOnly(false);}} style={{ fontSize:11, color:T.rep, background:T.repBg, border:`1px solid ${T.rep}`, borderRadius:20, padding:"4px 9px", cursor:"pointer" }}>Clear all</button>
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
            {/* UX 4E: when nothing's been typed AND no filters active, show Recent + Trending
                instead of the full A–Z list (Top Picks tab already shows the full list). */}
            {!query.trim() && leanFilter === "all" && catFilters.length === 0 && !showSavedOnly ? (
              <div style={{ padding:"24px 4px" }}>
                {recentSearches.length > 0 && (
                  <div style={{ marginBottom:20 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                      <i className="ti ti-history" aria-hidden="true" /> Recent
                    </div>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                      {recentSearches.map(q => (
                        <button key={q} onClick={()=>{ setQueryRaw(q); setQuery(q); }}
                          style={{ padding:"6px 12px", borderRadius:20, fontSize:13, background:T.bg3, border:`1px solid ${T.border2}`, color:T.txt, cursor:"pointer" }}
                        >{q}</button>
                      ))}
                      <button onClick={()=>{ setRecentSearches([]); try { localStorage.removeItem("tn_recentSearches"); } catch {} }}
                        style={{ padding:"6px 10px", borderRadius:20, fontSize:11, background:"transparent", border:`1px solid ${T.border}`, color:T.txt3, cursor:"pointer" }}
                      >Clear</button>
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                    <i className="ti ti-flame" aria-hidden="true" /> Trending
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {TRENDING_BRANDS.map(b => (
                      <button key={b} onClick={()=>{ setQueryRaw(b); setQuery(b); track("trending_click", { brand: b }); }}
                        style={{ padding:"6px 12px", borderRadius:20, fontSize:13, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2, cursor:"pointer" }}
                      >{b}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop:24, padding:"12px", textAlign:"center", fontSize:12, color:T.txt3 }}>
                  Type to search {deduped.length.toLocaleString()} companies — or <button onClick={()=>setTab("top")} style={{ background:"none", border:"none", color:T.accent2, fontSize:12, textDecoration:"underline", cursor:"pointer", padding:0 }}>browse the full list</button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              // Phase 5.3: failed search → auto-stub. Capture the query so
              // the pipeline's next expansion run can pick up brands users
              // wanted but we didn't have.
              <div style={{ padding:"40px 20px", textAlign:"center", color:T.txt3 }}>
                <i className="ti ti-search" style={{fontSize:36,display:"block",marginBottom:12}} aria-hidden="true" />
                <div style={{ fontSize:14, marginBottom:18 }}>
                  No companies match {query.trim() ? <strong style={{ color:T.txt }}>&ldquo;{query.trim()}&rdquo;</strong> : ""}
                </div>
                {query.trim() && query.trim().length >= 2 && (
                  <SuggestBrandButton query={query.trim()} />
                )}
              </div>
            ) : (
              filtered.map(co => <CompanyCard key={co.id} company={co} catFilter={catFilters.length===1?catFilters[0]:"all"} profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} initiallyOpen={deepLinkSlug && (co.slug || co.id) === deepLinkSlug} />)
            )}
          </div>
        </ErrorBoundary>
      )}

      {/* BROWSE */}
      {tab === "browse" && (
        <ErrorBoundary name="browse"><div style={{ padding:16, display:"grid", gridTemplateColumns:"calc(50% - 5px) calc(50% - 5px)", gap:10 }}>
          {cats.map((cat, i) => {
            const icon = Object.entries(catIconMap).find(([k])=>cat.includes(k))?.[1]||"ti-briefcase";
            const count = deduped.filter(c=>getBucket(c.cat)===cat).length;
            return (
              <div key={cat} onClick={()=>{setQueryRaw(cat);setQuery(cat);setTab("search");}}
                style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:"16px 14px", cursor:"pointer" }}>
                <div style={{ width:44, height:44, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:10, background:catBgs[i%catBgs.length] }}>
                  <i className={`ti ${icon}`} style={{ fontSize:22, color:catFgs[i%catFgs.length] }} aria-hidden="true" />
                </div>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt }}>{cat}</div>
                <div style={{ fontSize:12, color:T.txt3, marginTop:3 }}>{count} companies</div>
              </div>
            );
          })}
        </div></ErrorBoundary>
      )}
      {/* TOP PICKS */}
      {tab === "top" && (
        <ErrorBoundary name="top-picks">
          <FilterPanel
            leanFilter={leanFilter} setLeanFilter={setLeanFilter}
            catFilters={catFilters} setCatFilters={setCatFilters} toggleCat={toggleCat}
            flagFilters={flagFilters} toggleFlag={toggleFlag} setFlagFilters={setFlagFilters}
            lc={lc}
          />
          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontSize:12, color:T.txt3 }}>Ranked by {profile?"your personalized score":"average score"} · Letter grade shown</div>
          </div>
          {/* UX 6A: personalized score teaser */}
          {!profile && !teaserDismissed && teaserCompany && (
            <div style={{ margin:"10px 16px 0", padding:"12px 14px", background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:12, display:"flex", alignItems:"center", gap:12 }}>
              <i className="ti ti-sparkles" style={{ fontSize:20, color:T.accent2, flexShrink:0 }} aria-hidden="true" />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.txt, lineHeight:1.3 }}>See <strong>{teaserCompany.name}</strong>'s score tailored to <em>your</em> values</div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:3 }}>30-second quiz — free</div>
              </div>
              <button
                onClick={()=>{ track("personalized_teaser_clicked", { slug: teaserCompany.slug || teaserCompany.id, name: teaserCompany.name }); setScreen("quiz"); }}
                style={{ padding:"7px 12px", borderRadius:8, border:"none", background:T.accent2, color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", flexShrink:0 }}
              >Take quiz</button>
              <button
                onClick={()=>{ setTeaserDismissed(true); try { sessionStorage.setItem("tn_teaserDismissed","1"); } catch {} track("personalized_teaser_dismissed"); }}
                style={{ width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, cursor:"pointer", flexShrink:0 }}
                aria-label="Dismiss"
              >×</button>
            </div>
          )}
          <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10, overflowX:"hidden" }}>
            {[...deduped].sort((a,b)=>computeScore(b,profile)-computeScore(a,profile)).map((co,i) => (
              <CompanyCard key={co.id} company={co} catFilter="all" profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} />
            ))}
          </div>
        </ErrorBoundary>
      )}

      {/* SOURCES — Pro only */}
      {tab === "sources" && (
        <ErrorBoundary name="sources">{
        !isPaid ? (
          <div style={{ padding:24, textAlign:"center" }}>
            <div style={{ width:56, height:56, background:T.goldBg, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px" }}>
              <i className="ti ti-crown" style={{ fontSize:26, color:T.gold }} aria-hidden="true" />
            </div>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:8 }}>Data sources are Pro only</div>
            <div style={{ fontSize:13, color:T.txt3, marginBottom:20, lineHeight:1.6 }}>Upgrade to see all 25+ research sources we use — SEC EDGAR, FEC, OSHA, NLRB, EPA, BHRRC, Yale CELI, Have I Been Pwned, OpenFDA, Violation Tracker, and more.</div>
            <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ padding:"13px 24px", borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer" }}>Upgrade for $1.99/mo</button>
          </div>
        ) : (
        <div style={{ padding:16 }}>
          <p style={{ fontSize:13, color:T.txt3, marginBottom:4, lineHeight:1.6 }}>All scores are researched from these databases. The Live update button on each company uses real-time web search.</p>
          <div style={{ padding:"8px 12px", background:T.bg3, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:12, fontSize:12, color:T.txt3, lineHeight:1.6 }}>
            <strong style={{color:T.txt2}}>About data freshness:</strong> Government-derived signals (FEC donations, EPA enforcement, OSHA, NLRB, Violation Tracker, HIBP) refresh nightly via automated workflows. AI-synthesized narratives are re-baked monthly to incorporate new public records. Political donation totals reflect the current election cycle; environmental enforcement totals span 2000–present. For breaking news, tap "Live update" on any company card.
          </div>
          {SOURCES_DATA.map(g => (
            <div key={g.group}>
              <div style={{ fontSize:12, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.06em", margin:"16px 0 8px", display:"flex", alignItems:"center", gap:6 }}>
                <i className={`ti ${g.icon}`} aria-hidden="true" />{g.group}
              </div>
              {g.items.map(item => (
                <div key={item.name} style={{ padding:"12px 14px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, marginBottom:8 }}>
                  <div onClick={()=>window.open(item.url,"_blank","noopener,noreferrer")} style={{ fontSize:14, fontWeight:600, color:T.accent2, cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
                    {item.name} <i className="ti ti-external-link" style={{fontSize:12}} aria-hidden="true" />
                  </div>
                  <div style={{ fontSize:12, color:T.txt3, marginTop:4, lineHeight:1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        )
        }</ErrorBoundary>
      )}

      {/* SUBMIT */}

      {/* ACCOUNT */}
      {tab === "submit" && <ErrorBoundary name="submit"><SubmitView isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} /></ErrorBoundary>}

      {tab === "account" && (
        <ErrorBoundary name="account"><div style={{ padding:16 }}>
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
                <button onClick={()=>{ track("quiz_started", { isPaid, from: "account" }); setScreen("quiz"); }} style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  Take the quiz {!isPaid && <span style={{ fontSize:11, marginLeft:4, opacity:0.7 }}>(free)</span>}
                </button>
              </>
            )}
          </div>

          {/* Submit a Company */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:600, color:T.txt3, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Contribute</div>
            <SubmitView isPaid={isPaid} onUpgrade={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} />
          </div>

          {/* Login details — always show so guest users can sign out */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>Account details</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Email</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{currentUser?.email || "Guest"}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Plan</span>
                <span style={{ color:isPaid ? T.gold : T.txt2, fontWeight:600 }}>{isPaid ? "Pro" : "Free"}</span>
              </div>
              <button style={{ width:"100%", marginTop:12, padding:10, borderRadius:10, border:`1px solid ${T.border2}`, background:"transparent", color:T.txt3, fontSize:13, cursor:"pointer" }}
                onClick={() => { if(window.confirm("Sign out?")) { ["tn_hasOnboarded","tn_user"].forEach(k=>localStorage.removeItem(k)); window.location.reload(); } }}>
                Sign out
              </button>
            </div>

          {/* App info — slimmed */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>About TruNorth</div>
            {[
              ["Companies", deduped.length.toLocaleString()],
              ["Updated", "May 2026"],
              ["Version", "2.0"],
            ].map(([label, val]) => (
              <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>{label}</span>
                <span style={{ color:T.txt, fontWeight:500 }}>{val}</span>
              </div>
            ))}
            <div onClick={()=>setTab("sources")} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", fontSize:13, cursor:"pointer" }}>
              <span style={{ color:T.txt3 }}>Data Sources</span>
              <span style={{ color:T.accent2, fontWeight:500, display:"flex", alignItems:"center", gap:3 }}>View <i className="ti ti-chevron-right" style={{fontSize:11}} aria-hidden="true"/></span>
            </div>
          </div>
        </div></ErrorBoundary>
      )}

      </div>{/* end scrollable content */}

      {/* UX 3A: floating Compare bar — appears when at least 1 company is queued */}
      {compareList.length > 0 && (
        <div style={{ flexShrink:0, background:T.accentBg, borderTop:`1px solid ${T.accent}`, padding:"10px 12px", display:"flex", alignItems:"center", gap:10 }}>
          <i className="ti ti-arrows-left-right" style={{ fontSize:18, color:T.accent2 }} aria-hidden="true" />
          <div style={{ flex:1, minWidth:0, fontSize:13, color:T.txt }}>
            <strong>{compareList.length === 1 ? "Compare:" : "Ready to compare:"}</strong>{" "}
            <span style={{ color:T.txt2 }}>{compareList.map(c=>c.name).join(" vs ")}</span>
            {compareList.length === 1 && <span style={{ color:T.txt3, fontSize:11 }}> — pick one more</span>}
          </div>
          {compareList.length === 1 && (
            <button onClick={()=>{ setShowCompare(true); track("compare_suggest_open"); }} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${T.accent}`, background:"transparent", color:T.accent2, fontSize:12, fontWeight:700, cursor:"pointer" }}>Suggest</button>
          )}
          {compareList.length >= 2 && (
            <button onClick={()=>{ setShowCompare(true); track("compare_view", { count: compareList.length }); }} style={{ padding:"6px 12px", borderRadius:8, border:"none", background:T.accent2, color:"#000", fontSize:12, fontWeight:700, cursor:"pointer" }}>View</button>
          )}
          <button onClick={()=>{ setCompareList([]); track("compare_clear"); }} style={{ width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, cursor:"pointer" }} aria-label="Clear compare">×</button>
        </div>
      )}

      {/* UX 3A: Compare overlay */}
      {showCompare && (
        <CompareView
          companies={companies}
          list={compareList}
          profile={profile}
          isPaid={isPaid}
          onClose={()=>setShowCompare(false)}
          onRemove={(slug)=>setCompareList(prev => prev.filter(c => c.slug !== slug))}
          onAdd={(slug, name)=>setCompareList(prev => prev.length >= 2 ? prev : [...prev, { slug, name }])}
        />
      )}

      {/* BOTTOM NAV — in-flow flex child.
          html { height:100dvh } makes the full chain reach the physical screen bottom.
          paddingBottom:env(safe-area-inset-bottom) fills the home indicator zone. */}
      <div style={{ flexShrink:0, background:T.bg2, borderTop:`1px solid ${T.border}`, display:"flex", paddingBottom:"env(safe-area-inset-bottom, 34px)" }}>
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
    </div>
  );
}
