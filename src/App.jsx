// Phase 3.1: companies.js is loaded LAZILY (dynamic import) so the 8.8MB module
// only enters the bundle when the split-bundle path is OFF. With flag ON, the
// import never fires and the app downloads only /data/index.json (~287 KB).
import React, { useState, useEffect, useMemo } from "react";
import SplashScreen from "./SplashScreen";
import OnboardingFlow from "./OnboardingFlow";
import MarketingLanding from "./MarketingLanding";
import PrivacyPolicy from "./PrivacyPolicy";
import { initAnalytics, track } from "./lib/analytics";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { isSplitBundleEnabled, loadCompanyIndex, loadCompanyDetail, loadSearchIndex } from "./lib/dataSource";
import { computeFingerprint, persistFingerprint, getStoredFingerprint } from "./lib/fingerprint";
import { useConfirm, usePrompt, useAlert } from "./components/ConfirmModal";
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
  const zxingControlsRef = React.useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | lookup | nomatch | error
  const [error, setError] = useState(null);
  const [lastCode, setLastCode] = useState(null);
  const [lookupBrand, setLookupBrand] = useState(null);
  // Phase 5.aj: bumping scanRound restarts the camera + decoder (used by
  // the "Scan another" button after a no-match). The useEffect below is
  // keyed off scanRound so changing it re-runs start() with a fresh
  // ZXing controller + fresh getUserMedia stream.
  const [scanRound, setScanRound] = useState(0);

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
      // ── Native iOS via Capacitor: use Google ML Kit ──────────────────
      // Phase 5.ao: ML Kit massively beats ZXing on damaged/glare/curved
      // grocery barcodes. Capacitor's WebView camera is also flaky, so
      // when running in the iOS shell we ALWAYS prefer the native plugin.
      let capacitor = null;
      try {
        const mod = await import("@capacitor/core");
        capacitor = mod.Capacitor;
      } catch { /* not in Capacitor build */ }

      if (capacitor?.isNativePlatform?.()) {
        try {
          const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
          // First-run: prompt for camera permission.
          const perm = await BarcodeScanner.requestPermissions();
          if (cancelled) return;
          if (perm?.camera !== "granted" && perm?.camera !== "limited") {
            setStatus("error");
            setError("Camera access denied. Grant permission in iOS Settings → TruNorth.");
            return;
          }
          setStatus("scanning");
          // Native UI takes over the screen for the scan. When the user
          // either scans a code or cancels, we get the result here.
          const result = await BarcodeScanner.scan({
            formats: ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128", "CODE_39", "CODE_93", "QR_CODE"],
          });
          if (cancelled) return;
          const code = result?.barcodes?.[0]?.rawValue;
          if (!code) {
            // User canceled the native scanner — close our overlay too.
            onClose?.();
            return;
          }
          // iOS quirk: ML Kit returns UPC-A as a 13-digit EAN-13 with a
          // leading zero. Open Food Facts accepts both, so we don't strip.
          setLastCode(code);
          await lookup(code);
          return;
        } catch (mlkitErr) {
          console.error("[scanner] ML Kit failed, falling back:", mlkitErr);
          // Fall through to browser path
        }
      }

      const useNative = typeof window !== "undefined" && "BarcodeDetector" in window;
      try {
        if (useNative) {
          // ── Native fast path (Chrome / Edge / Chrome Android) ───────────
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
          setStatus("scanning");
          detectorRef.current = new window.BarcodeDetector({
            formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "qr_code"],
          });
          const scan = async () => {
            if (cancelled || !videoRef.current || !detectorRef.current) return;
            try {
              const codes = await detectorRef.current.detect(videoRef.current);
              if (codes && codes.length > 0) {
                const code = codes[0].rawValue;
                if (code && code !== lastCode) {
                  setLastCode(code);
                  lookup(code);
                  return;
                }
              }
            } catch { /* detect can throw transiently — ignore */ }
          };
          intervalId = setInterval(scan, 200);
        } else {
          // ── Universal fallback: let ZXing OWN the camera ────────────────
          // Previously we pre-opened getUserMedia and handed the video
          // element to ZXing, but that double-bound the stream and ZXing
          // never received decode-able frames on iOS Safari. Now ZXing
          // calls getUserMedia itself with our preferred constraints and
          // drives the video element directly.
          const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import("@zxing/library");
          if (cancelled) return;
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
            BarcodeFormat.CODE_93, BarcodeFormat.QR_CODE,
          ]);
          const reader = new BrowserMultiFormatReader(hints, /* timeBetweenScansMillis */ 250);
          setStatus("scanning");

          let stopFn = null;
          const onResult = (result, _err) => {
            if (cancelled) return;
            if (!result) return; // null result = no barcode this frame, ZXing will retry
            const code = result.getText();
            if (!code || code === lastCode) return;
            console.info("[scanner] decoded:", code);
            setLastCode(code);
            lookup(code);
            if (stopFn) { try { stopFn(); } catch {} }
            else if (reader.reset) { try { reader.reset(); } catch {} }
          };

          // Prefer the modern API (returns IScannerControls with .stop()).
          // Fall back to the legacy continuous method on older library
          // versions. Either way, ZXing opens its own camera via the
          // constraints and binds it to videoRef.current.
          const constraints = { video: { facingMode: { ideal: "environment" } } };
          try {
            if (typeof reader.decodeFromConstraints === "function") {
              const controls = await reader.decodeFromConstraints(constraints, videoRef.current, onResult);
              stopFn = controls?.stop ? () => controls.stop() : () => reader.reset();
            } else if (typeof reader.decodeFromVideoDevice === "function") {
              // Older API — opens default rear camera (deviceId=undefined),
              // attaches to videoRef, callback every frame.
              await reader.decodeFromVideoDevice(undefined, videoRef.current, onResult);
              stopFn = () => reader.reset();
            } else {
              throw new Error("@zxing/library is missing both decodeFromConstraints and decodeFromVideoDevice");
            }
          } catch (camErr) {
            console.error("[scanner] zxing camera open failed:", camErr);
            setStatus("error");
            setError(camErr?.name === "NotAllowedError"
              ? "Camera access denied. Grant permission in your browser settings to scan."
              : "Couldn't start the camera. Make sure you're on HTTPS and grant camera permission.");
            return;
          }
          zxingControlsRef.current = { stop: stopFn };
        }
      } catch (err) {
        console.error("[scanner] start failed:", err);
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
      // Stop the ZXing continuous decoder if it was used (fallback path).
      if (zxingControlsRef.current?.stop) {
        try { zxingControlsRef.current.stop(); } catch {}
      }
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [scanRound]); // eslint-disable-line react-hooks/exhaustive-deps

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
                <button onClick={() => { setStatus("starting"); setLastCode(null); setLookupBrand(null); setError(null); setScanRound(n => n + 1); }} style={{ padding:"10px 18px", borderRadius:10, border:"none", background:"#fff", color:"#000", fontSize:13, fontWeight:700, cursor:"pointer" }}>Scan another</button>
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
// Phase 5.ai: Alt-B is now the DEFAULT (and only) quiz. Order + copy
// derived from research synthesis (Krosnick, Pew polarization, evergreen
// survey-design literature, Coglode onboarding research). Locked in after
// user picked alt-b over v1 and alt-a.
//
// Screen order is INTENTIONALLY soft-to-hard, not topic-first:
//   1. "Things you'd rather not buy"  — foot-in-the-door (low-stakes avoids)
//   2. "Rank what matters most"       — values-mindset anchoring
//   3. "Your positions"                — identity questions AFTER commitment
//                                        (Politics never first — see research)
//   4. "Lines you won't cross"         — peak-end commitment device
//
// "No preference" replaces "Don't care" everywhere — research found
// "don't care" reads as morally dismissive on values topics like child labor.
const QUIZ_STEPS_ALT_B = [
  // ── Screen 1 (was screen 2): low-stakes avoids — foot-in-the-door ──────
  { id:"stances_avoid", type:"tri-single",
    q:"Things you'd rather not buy",
    subs:[
      { id:"animalTesting", title:"Animal testing",
        opts:[
          {v:"dealbreaker",l:"Cruelty-free",   icon:"ti-paw"},
          {v:"prefer_not", l:"Not a priority", icon:"ti-paw"},
          {v:"neutral",    l:"No preference",  icon:null},
        ]},
      { id:"guns", title:"Firearms",
        opts:[
          {v:"avoid",   l:"Gun-industry-free", icon:"ti-x"},
          {v:"support", l:"Supportive",        icon:"ti-check"},
          {v:"neutral", l:"No preference",     icon:null},
        ]},
    ]},
  // ── Screen 2 (was screen 3): importance grid ────────────────────────────
  { id:"importances", type:"importance-grid",
    q:"Rank what matters most",
    rows:[
      // Lead with broadly-endorsed categories (anchoring high), CEO pay last
      // (most ideologically charged of the five — straightlining risk).
      { id:"envImportance",     label:"Environment",           icon:"ti-leaf" },
      { id:"laborImportance",   label:"Worker treatment",      icon:"ti-users" },
      { id:"charityImportance", label:"Charitable giving",     icon:"ti-heart" },
      { id:"privacy",           label:"Data privacy",          icon:"ti-lock" },
      { id:"execPay",           label:"CEO-to-worker pay gap", icon:"ti-coin" },
    ]},
  // ── Screen 3 (was screen 1): identity questions — Politics LAST ────────
  // Reassurance microcopy added per research (reduces social-desirability
  // distortion on the most sensitive screen).
  { id:"stances_identity", type:"tri-single",
    q:"Your positions",
    sub:"Stays on your device. We never sell or share this.",
    subs:[
      { id:"deiLean", title:"Workplace diversity programs",
        opts:[
          {v:"pro",    l:"Support",       icon:"ti-heart"},
          {v:"anti",   l:"Avoid",         icon:"ti-x"},
          {v:"neutral",l:"No preference", icon:null},
        ]},
      { id:"unionSupport", title:"Labor unions",
        opts:[
          {v:"pro",    l:"Pro-union",     icon:"ti-users"},
          {v:"anti",   l:"Anti-union",    icon:"ti-x"},
          {v:"neutral",l:"No preference", icon:null},
        ]},
      // Politics has 4 options — adds "Mixed" so the ~40% of Americans
      // with cross-cutting views aren't forced into a false binary
      // (Pew). Mixed scores the same as Neutral (no left/right boost)
      // but lets the user opt in honestly instead of lying or quitting.
      // Phase 5.as (QA bug #6): "Mixed" and "No preference" used to both
      // return v:"neutral", which made them visually co-select (UI keys
      // by value) and stored identical weights — teaches users that
      // their answers are theater. "Mixed" now uses v:"mixed" → halves
      // the political weight rather than zeroing it; the scoring engine
      // treats unrecognized values as neutral so this remains safe.
      { id:"politicalLean", title:"Politics",
        opts:[
          {v:"left",   l:"Progressive",   icon:"dem"},
          {v:"right",  l:"Conservative",  icon:"rep"},
          {v:"mixed",  l:"Mixed",         icon:null},
          {v:"neutral",l:"No preference", icon:null},
        ]},
    ]},
  // ── Screen 4: dealbreakers — peak-end commitment ─────────────────────
  { id:"dealBreakers", type:"multi",
    q:"Lines you won't cross",
    sub:"Companies with poor records here get heavily penalized. Skipping is fine.",
    opts:[
      // Universal-moral first, geopolitical last (most divisive)
      {v:"forcedLabor",  l:"Forced labor in supply chain",      icon:"ti-link"},
      {v:"childLabor",   l:"Child labor in supply chain",        icon:"ti-baby-carriage"},
      {v:"privacy",      l:"Privacy abuse",                      icon:"ti-lock"},
      {v:"monopoly",     l:"Monopoly behavior",                  icon:"ti-crown"},
      {v:"foreignOwn",   l:"Made in adversary nations",          icon:"ti-world"},
    ]},
];

// Phase 5.ai: alt-b is now the universal quiz. v1 and alt-a are removed —
// the experiment is over, the winner picked. Keeping this as a tiny helper
// in case we ever want to re-enable variants for an A/B test.
function getQuizSteps() { return QUIZ_STEPS_ALT_B; }
const QUIZ_STEPS = QUIZ_STEPS_ALT_B; // back-compat for any direct refs elsewhere

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
  // Phase 5.aa: SYMMETRIC user-preference boosts. A user who picks a clear
  // side (Left / Right / Pro-DEI / Anti-DEI / Pro-Gun / Anti-Gun / Union pro
  // / Union anti) gets that axis weighted higher, regardless of which side
  // they picked. Previously only guns and union got boosts which created an
  // implicit bias toward letting labor + environment dominate everyone else.
  // Now political and DEI also boost when the user has a clear stance.
  const politicalBoost = profile.lean         && profile.lean         !== "neutral" ? 2 : 1;
  const deiBoost       = profile.deiLean      && profile.deiLean      !== "neutral" ? 2 : 1;
  const animalBoost    = profile.animalTesting && profile.animalTesting !== "neutral" ? 2 : 1;
  const gunBoost       = profile.guns         && profile.guns         !== "neutral" ? 4 : 1;
  const unionBoost     = profile.unionSupport && profile.unionSupport !== "neutral" ? 2 : 1;
  const baseWeights = {
    political:    (profile.weights?.political    || 3) * politicalBoost,
    charity:      profile.weights?.charity      || 2,
    environment:  profile.weights?.environment  || 3,
    labor:        (profile.weights?.labor       || 3) * unionBoost,
    dei:          (profile.weights?.dei          || 3) * deiBoost,
    animals:      (profile.weights?.animals      || 2) * animalBoost,
    guns:         (profile.weights?.guns        || 2) * gunBoost,
    privacy:      profile.weights?.privacy      || 2,
    execPay:      profile.weights?.execPay      || 2,
  };
  // Phase 5.ac — "neutral" enum means NO DATA SIGNAL for that category and is
  // ALWAYS excluded from the weighted score. (Previously we kept it when the
  // user had a strong preference — that pulled scores toward C even when the
  // company was clearly aligned on the only axis with data.)
  //
  // Principle requested by user: "If we don't have data, we shouldn't be
  // scoring them as neutral for any area. If only one area matches, they
  // should get the grade on that one." So: score is computed ONLY on
  // categories where we have a real signal (positive, negative, mixed, or
  // a definite-stance enum like cruelty_free/sells_guns/left/right).
  //
  // The display layer still uses "neutral" badges where data is absent, but
  // those badges are informational only — they don't contribute to the grade.
  let weightedSum  = 0;
  let weightUsed   = 0;
  for (const k of CAT_KEYS) {
    const v = co.sc[k];
    if (getDataState(k, v) === "unknown") continue;
    if (String(v || "").toLowerCase() === "neutral") continue;
    weightedSum += scoreCat(k, v, profile) * baseWeights[k];
    weightUsed  += baseWeights[k];
  }
  // If nothing scored, fall back to the overall (un-personalized) score so the
  // app doesn't show a misleading "50" for companies with no data at all.
  const ws = weightUsed > 0 ? weightedSum / weightUsed : (co.overall || 50);
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
    // Phase 5.aj: fire upgrade_clicked at the moment the user commits — this
    // is the funnel-conversion event that paywall_shown should convert into.
    // PostHog diagnostic on 2026-05-31 showed 43 paywall_shown / 0
    // upgrade_clicked because this event was never being emitted.
    track("upgrade_clicked", { email_provided: true, source: "paywall" });
    setLoading(true);
    // 4.7: capture the email to MailerLite (gracefully no-ops if unconfigured)
    await subscribeEmail(email, "paywall", { intendsToSubscribe: true });
    // In production: call Stripe Checkout API here.
    setTimeout(() => {
      setLoading(false);
      // Phase 5.as (#11): pass the email up so parent can persist it to
      // tn_user → Account auto-populates.
      onSubscribe(email);
    }, 1500);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:T.bg2, borderRadius:"24px 24px 0 0", border:`1px solid ${T.border2}`, padding:"16px 18px calc(28px + env(safe-area-inset-bottom, 0px))", width:"100%", maxWidth:430, maxHeight:"92vh", overflowY:"auto" }}>
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

        {/* Phase 5.as (QA friction #5): fontSize ≥16 keeps iOS Safari + Android Chrome from auto-zooming on focus, which previously broke the 430px paywall column at the conversion moment. */}
        <form onSubmit={e=>{e.preventDefault();handleSubscribe();}} autoComplete="on" style={{width:"100%"}}><input type="email" autoComplete="email" name="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your email to subscribe" style={{ width:"100%", background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:10, color:T.txt, fontSize:16, padding:"11px 13px", marginBottom:10 }} /><button type="submit" style={{display:"none"}} /></form>

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


// FilterPanel — Design B (bottom-sheet drawer). User picked this from the
// 6 alternatives explored in Phase 5.ab. Single compact "Filter (N)" button
// with active chips alongside; tap opens the full FilterSheet bottom drawer.
function FilterPanel({ leanFilter, setLeanFilter, catFilters, setCatFilters, toggleCat, flagFilters, toggleFlag, setFlagFilters, lc }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const totalActive = (leanFilter !== "all" ? 1 : 0) + catFilters.length + flagFilters.length;
  return (
    <div style={{ background:T.bg2, borderBottom:`1px solid ${T.border}` }}>
      <div style={{ display:"flex", alignItems:"center", padding:"10px 16px", gap:8 }}>
        <button onClick={() => setSheetOpen(true)}
          style={{ display:"flex", alignItems:"center", gap:6, padding:"9px 14px", borderRadius:22, border:`1px solid ${totalActive>0 ? T.accent : T.border}`, background: totalActive>0 ? T.accentBg : T.bg3, color: totalActive>0 ? T.accent2 : T.txt2, fontSize:13, fontWeight:600, cursor:"pointer" }}>
          <i className="ti ti-adjustments-horizontal" />
          Filter
          {totalActive > 0 && <span style={{ background:T.accent, color:"#fff", padding:"1px 7px", borderRadius:12, fontSize:11 }}>{totalActive}</span>}
        </button>
        {totalActive > 0 && (
          <>
            <div style={{ flex:1, display:"flex", gap:6, overflowX:"auto", WebkitOverflowScrolling:"touch", scrollbarWidth:"none" }}>
              {leanFilter !== "all" && (
                <button onClick={() => setLeanFilter("all")} style={chipStyle()}>
                  {leanFilter === "left" ? "Left" : leanFilter === "right" ? "Right" : leanFilter === "bi" ? "Bipartisan" : "Neutral"} ×
                </button>
              )}
              {catFilters.map(k => (
                <button key={k} onClick={() => toggleCat(k)} style={chipStyle()}>
                  {CAT_LABELS[k]} ×
                </button>
              ))}
              {flagFilters.map(id => {
                const f = FLAG_FILTERS.find(x => x.id === id);
                return <button key={id} onClick={() => toggleFlag(id)} style={chipStyle()}>{f?.label || id} ×</button>;
              })}
            </div>
            <button onClick={() => { setLeanFilter("all"); setCatFilters([]); setFlagFilters([]); }}
              style={{ background:"none", border:"none", color:T.rep, fontSize:12, cursor:"pointer", padding:"6px 0" }}>
              Clear
            </button>
          </>
        )}
      </div>
      {sheetOpen && (
        <FilterSheet
          onClose={() => setSheetOpen(false)}
          leanFilter={leanFilter} setLeanFilter={setLeanFilter}
          catFilters={catFilters} toggleCat={toggleCat}
          flagFilters={flagFilters} toggleFlag={toggleFlag}
          lc={lc}
        />
      )}
    </div>
  );
}
const chipStyle = () => ({ flexShrink:0, padding:"5px 10px", borderRadius:12, fontSize:11, fontWeight:600, background:T.accentBg, color:T.accent2, border:`1px solid ${T.accent}`, cursor:"pointer", whiteSpace:"nowrap" });

function FilterSheet({ onClose, leanFilter, setLeanFilter, catFilters, toggleCat, flagFilters, toggleFlag, lc }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:200, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.bg, borderTopLeftRadius:20, borderTopRightRadius:20, padding:"6px 16px 24px", paddingBottom:"calc(24px + env(safe-area-inset-bottom, 0px))", maxHeight:"82dvh", overflowY:"auto" }}>
        <div style={{ width:38, height:4, background:T.border2, borderRadius:2, margin:"6px auto 14px" }} />
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>Filters</div>
          <button onClick={onClose} style={{ background:T.bg3, border:"none", color:T.txt, width:28, height:28, borderRadius:14, fontSize:16, cursor:"pointer" }}>×</button>
        </div>
        <div style={{ fontSize:11, fontWeight:700, color:T.txt3, letterSpacing:0.6, marginBottom:8 }}>POLITICAL LEAN</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:18 }}>
          {[{id:"all",l:"All"},{id:"left",l:`Left (${lc.left})`},{id:"right",l:`Right (${lc.right})`},{id:"bi",l:`Bipartisan (${lc.bi})`},{id:"neutral",l:`Neutral`}].map(o => (
            <button key={o.id} onClick={()=>setLeanFilter(o.id)}
              style={{ padding:"7px 13px", borderRadius:18, fontSize:12, fontWeight:600, cursor:"pointer", background: leanFilter===o.id ? T.accent : T.bg3, color: leanFilter===o.id ? "#fff" : T.txt2, border:`1px solid ${leanFilter===o.id ? T.accent : T.border2}` }}>
              {o.l}
            </button>
          ))}
        </div>
        <div style={{ fontSize:11, fontWeight:700, color:T.txt3, letterSpacing:0.6, marginBottom:8 }}>CATEGORIES</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:18 }}>
          {CAT_KEYS.map(k => {
            const a = catFilters.includes(k);
            return (
              <button key={k} onClick={()=>toggleCat(k)}
                style={{ padding:"7px 12px", borderRadius:18, fontSize:12, fontWeight:600, cursor:"pointer", background: a ? T.accent : T.bg3, color: a ? "#fff" : T.txt2, border:`1px solid ${a ? T.accent : T.border2}`, display:"flex", alignItems:"center", gap:5 }}>
                <i className={`ti ${CAT_ICONS[k]}`} /> {CAT_LABELS[k]}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize:11, fontWeight:700, color:T.txt3, letterSpacing:0.6, marginBottom:8 }}>CONCERNS</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {FLAG_FILTERS.map(f => {
            const a = flagFilters.includes(f.id);
            return (
              <button key={f.id} onClick={()=>toggleFlag(f.id)}
                style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:10, fontSize:13, cursor:"pointer", background: a ? T.accentBg : T.bg3, color: a ? T.accent2 : T.txt, border:`1px solid ${a ? T.accent : T.border}`, textAlign:"left" }}>
                <i className={`ti ${f.icon}`} style={{ fontSize:16, color: a ? T.accent2 : T.txt3 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600 }}>{f.label}</div>
                  <div style={{ fontSize:11, color:T.txt3, marginTop:1 }}>{f.desc}</div>
                </div>
                {a && <i className="ti ti-check" style={{ color:T.accent2 }} />}
              </button>
            );
          })}
        </div>
        <button onClick={onClose} style={{ width:"100%", marginTop:18, padding:13, borderRadius:12, border:"none", background:T.accent, color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer" }}>
          Done
        </button>
      </div>
    </div>
  );
}


// Phase 4.9: one-shot announcement modal — shown once per WHATSNEW_VERSION.
// Bump the version string when there's a new milestone to re-trigger.
const WHATSNEW_VERSION = "2026-06-launch-day";
function WhatsNewModal({ companyCount }) {
  const [show, setShow] = useState(() => {
    // Phase 5.y: ?skipOnboarding=1 also dismisses the What's New modal so
    // simulator/QA URLs go straight to the app surface they want to inspect.
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams(window.location.search);
      if (qp.has("skipOnboarding") || qp.has("noWhatsnew")) return false;
      // Deep-link arrivals (/company/<slug>) get the company immediately —
      // throwing a "what's new" modal over their target is poor UX. Skip it.
      if (/^\/company\//.test(window.location.pathname)) return false;
    }
    // Phase 5.ab: if the user previously checked "Don't show again", honor
    // it across sessions. Otherwise show once per session (Phase 5.aa).
    try {
      if (localStorage.getItem("tn_whatsnew_optout") === WHATSNEW_VERSION) return false;
      // Phase 5.ag: a first-time user just landed — "What's NEW" is meaningless
      // (they have no baseline). Suppress on the session that immediately
      // follows onboarding; show on session 2+.
      const justOnboarded = sessionStorage.getItem("tn_justOnboarded");
      if (justOnboarded) {
        const age = Date.now() - parseInt(justOnboarded, 10);
        if (age < 5 * 60 * 1000) return false; // 5-min window
      }
      return sessionStorage.getItem("tn_whatsnew_session") !== WHATSNEW_VERSION;
    } catch { return false; }
  });
  const [dontShowAgain, setDontShowAgain] = useState(false);
  useEffect(() => {
    if (show) track("whatsnew_shown", { version: WHATSNEW_VERSION });
  }, [show]);
  if (!show) return null;
  const dismiss = () => {
    // Phase 5.aa: track per-session dismissal so the modal still shows on
    // the user's NEXT login (the requested behavior).
    try { sessionStorage.setItem("tn_whatsnew_session", WHATSNEW_VERSION); } catch {}
    // Phase 5.ab: respect "Don't show again" — persists across sessions.
    if (dontShowAgain) {
      try { localStorage.setItem("tn_whatsnew_optout", WHATSNEW_VERSION); } catch {}
    }
    track("whatsnew_dismissed", { version: WHATSNEW_VERSION, dontShowAgain });
    setShow(false);
  };
  return (
    <div onClick={dismiss} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, padding:"32px 12px", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:400, width:"100%", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, padding:20, color:T.txt }}>
        {/* 2026-06-01: Launch-mode rewrite. The pre-launch "what's new" was
            a dev-internal changelog ("5,000+ new companies", "new filter
            drawer"). Re-cast as a welcome / value-prop card for the wave of
            new users arriving from ProductHunt + press. Bumped
            WHATSNEW_VERSION above so returning users see it once. */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <i className="ti ti-sparkles" style={{ fontSize:24, color:T.accent2 }} aria-hidden="true" />
          <div style={{ fontSize:18, fontWeight:700 }}>Welcome to TruNorth</div>
        </div>
        <div style={{ background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:10, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ fontSize:28, fontWeight:800, color:T.accent2, lineHeight:1.1 }}>{companyCount.toLocaleString()}+</div>
          <div style={{ fontSize:13, color:T.txt2, marginTop:4, lineHeight:1.4 }}>Companies graded across 9 value categories — using only public records.</div>
        </div>
        <ul style={{ listStyle:"none", padding:0, margin:0, fontSize:13.5, color:T.txt2, lineHeight:1.65 }}>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>No opinions — just public records.</b> FEC donations, OSHA violations, EPA enforcement, SEC filings.</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Tailored to your values.</b> 30-second quiz reweights every grade so what matters to you, counts.</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Scan any barcode in-store.</b> Get the verdict before you pay.</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Free forever.</b> No ads, no affiliate links, no selling your data.</span>
          </li>
        </ul>
        <button onClick={dismiss} style={{ width:"100%", marginTop:18, padding:13, borderRadius:10, border:"none", background:T.accent2, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
          Let's go →
        </button>
        {/* Phase 5.ab: opt-out checkbox — small, below CTA. Persists across
            sessions when checked. */}
        <label style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, fontSize:12, color:T.txt3, cursor:"pointer", justifyContent:"center" }}>
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={e => setDontShowAgain(e.target.checked)}
            style={{ width:14, height:14, accentColor:T.accent, cursor:"pointer" }}
          />
          <span>Don't show this again</span>
        </label>
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

  // Phase 5.z: Compare modal now properly height-constrained so on smaller
  // iPhones the suggestion grid doesn't push content off-screen. The outer
  // wrapper uses 100dvh and the inner card scrolls internally when tall.
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:100, padding:"calc(20px + env(safe-area-inset-top, 0px)) 12px calc(20px + env(safe-area-inset-bottom, 0px))", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:430, width:"100%", margin:"0 auto", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, color:T.txt, display:"flex", flexDirection:"column", overflow:"hidden", maxHeight:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px 10px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>Compare</div>
        <button onClick={onClose} style={{ width:32, height:32, padding:0, borderRadius:8, border:"none", background:T.bg3, color:T.txt, fontSize:18, cursor:"pointer" }} aria-label="Close">×</button>
      </div>
      <div style={{ padding:16, overflowY:"auto", flex:1, minHeight:0, WebkitOverflowScrolling:"touch" }}>

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
                // Phase 5.z: 4 instead of 6 — keeps the suggestion grid above
                // the fold on small iPhones and avoids needing to scroll inside
                // an already-modal experience.
                return suggestions.slice(0, 4).map(co => (
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
  // Phase 5.af: prefer the curated logoUrl from the pipeline's logo harvester
  // (Wikidata P154 > Wikipedia infobox > DuckDuckGo favicon, picked at build
  // time). Falls back to the favicon-API providers when no curated URL exists.
  const providers = [
    ...(company?.logoUrl ? [company.logoUrl] : []),
    ...(domain ? [
      `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
      `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    ] : []),
  ];
  const [providerIdx, setProviderIdx] = React.useState(0);
  const [errored, setErrored] = React.useState(providers.length === 0);
  React.useEffect(() => {
    setErrored(providers.length === 0);
    setProviderIdx(0);
  }, [company?.slug || company?.id, company?.logoUrl]); // eslint-disable-line react-hooks/exhaustive-deps
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

// Phase 5.z: CategoryRow — YUKA-style progressive disclosure.
//
// Collapsed (default): category icon + name + a colored spectrum bar with a
//   dot positioned at the company's score. One-line scan. No paragraph text.
// Expanded (after tap): rationale, source pills, and the original badge.
//
// The spectrum is the same blue→grey→red gradient we already use for political
// donations, generalized so every category gets the same visual treatment.
// Each category has its own "lo → hi" semantic (e.g. labor: "violations" →
// "clean record"; environment: "documented harm" → "verified leader"). The
// dot position is derived from scoreCat() so it reflects the SAME numeric
// score that feeds the overall grade.
function categorySpectrumPos(k, v, profile) {
  // Returns a 0..1 position on the left-right axis (left = "bad-for-user",
  // right = "good-for-user"). For political: left = Democratic, right = Rep.
  // For everything else: left = documented-negative, right = verified-positive.
  // Returns null when the value is unknown (no dot rendered).
  if (getDataState(k, v) === "unknown") return null;
  if (k === "political") {
    const lean = String(v || "").toLowerCase();
    if (lean === "left")          return 0.10;
    if (lean === "left-leaning")  return 0.28;
    if (lean === "right")         return 0.90;
    if (lean === "right-leaning") return 0.72;
    if (["bipartisan","mixed","neutral"].includes(lean)) return 0.50;
    return null;
  }
  // For other categories, map scoreCat()'s 0–100 to 0–1.
  // We pass a temporary profile context so the spectrum reflects the user's
  // alignment too (e.g. a "right" donator on a "left" user's profile lands
  // far-left on their personal spectrum — same as the political case).
  const sc = scoreCat(k, v, profile);
  if (sc == null) return null;
  return Math.max(0, Math.min(1, sc / 100));
}

// Phase 5.ah: spectrum-bar color now varies by axis TYPE.
//   "universal" axes — environment, labor, privacy — keep red→green
//   because more violations / more breaches are objectively worse for
//   every user.
//   "stance" axes — politics, DEI, animals, firearms, charity, exec pay —
//   use a NEUTRAL gray→accent gradient. Position is shown without value
//   judgment (the personalized GRADE on the row carries the verdict
//   relative to the user's quiz answers).
function CategorySpectrum({ pos, leftLabel, rightLabel, axisType = "stance" }) {
  if (pos == null) return null;
  const isUniversal = axisType === "universal";
  const dotColor = isUniversal
    ? (pos < 0.35 ? "#e24a4a" : pos > 0.65 ? "#4caf82" : "#9b8ff0")
    : "#9b8ff0";
  const gradient = isUniversal
    ? "linear-gradient(to right, #e24a4a 0%, #e24a4a 22%, #555 38%, #555 62%, #4caf82 78%, #4caf82 100%)"
    : "linear-gradient(to right, #3a3a3a 0%, #555 50%, #6a5dca 100%)";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, width:"100%" }}>
      <div style={{
        position:"relative", width:"100%", height:6, borderRadius:3,
        background: gradient,
      }} aria-hidden="true">
        <div style={{
          position:"absolute", top:-3, left:`calc(${pos*100}% - 6px)`,
          width:12, height:12, borderRadius:"50%",
          background:dotColor, border:"2px solid #fff",
          boxShadow:"0 0 0 1px rgba(0,0,0,0.4)",
        }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#888", lineHeight:1.2 }}>
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

// Per-category spectrum endpoint labels + axis type.
//
// LABEL POLICY: describe the AXIS factually, never the verdict.
//   - "Limited" / "Active" (not "Rolled back" — implies they once had it)
//   - "Left" / "Right" (not "Liberal" / "Conservative" — partisan)
//   - "No record" — they may be charitable; we just don't have data
//
// AXIS TYPE:
//   "universal" → red→green coloring; more violations objectively worse
//   "stance"    → neutral gray→accent; position-only, no value implied
const SPECTRUM_LABELS = {
  political:   { lo: "Left",         hi: "Right",          axisType: "stance"    },
  charity:     { lo: "No record",    hi: "Active giving",  axisType: "stance"    },
  environment: { lo: "Violations",   hi: "Certified",      axisType: "universal" },
  labor:       { lo: "Violations",   hi: "Clean record",   axisType: "universal" },
  dei:         { lo: "Limited",      hi: "Active",         axisType: "stance"    },
  animals:     { lo: "Tests",        hi: "Cruelty-free",   axisType: "stance"    },
  guns:        { lo: "Makes guns",   hi: "No guns",        axisType: "stance"    },
  privacy:     { lo: "Breaches",     hi: "No breaches",    axisType: "universal" },
  execPay:     { lo: ">300:1",       hi: "<50:1",          axisType: "stance"    },
};

function CategoryRow({ cat: k, enriched, profile }) {
  const [expanded, setExpanded] = useState(false);
  const v = enriched.sc?.[k];
  const d = enriched[k] || {};
  const state = getDataState(k, v);
  const isUnknown = state === "unknown";
  const disp = getDisplay(k, v, profile);
  const pos = categorySpectrumPos(k, v, profile);
  const labels = SPECTRUM_LABELS[k];

  // Phase 5.aa: vertical-stacked layout. Top row is just icon + name + chevron;
  // the spectrum bar lives on its own line below so long names like "DEI &
  // social equity" don't wrap or get overlapped by the bar.
  return (
    <div style={{ marginBottom:10, paddingBottom:10, borderBottom:`1px solid ${T.border}`, opacity: isUnknown ? 0.6 : 1 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{ display:"block", padding:"6px 0", background:"none", border:"none", cursor:"pointer", color:T.txt, width:"100%", textAlign:"left" }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <i className={`ti ${CAT_ICONS[k]}`} style={{ fontSize:16, color:T.txt3, width:18, flexShrink:0 }} aria-hidden="true" />
          <div style={{ fontSize:13, fontWeight:600, color:T.txt2, letterSpacing:0.2, flex:1, minWidth:0 }}>{CAT_FULL[k]}</div>
          {isUnknown && <span style={{ fontSize:11, color:T.txt3, fontStyle:"italic", marginRight:6 }}>No data</span>}
          <i className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
        </div>
        {!isUnknown && (
          <div style={{ paddingLeft:28, paddingRight:4 }}>
            <CategorySpectrum pos={pos} leftLabel={labels?.lo || ""} rightLabel={labels?.hi || ""} axisType={labels?.axisType || "stance"} />
          </div>
        )}
      </button>
      {expanded && (
        <div style={{ paddingTop:8, paddingLeft:28 }}>
          {!isUnknown ? (
            <>
              <div style={{ fontSize:13, color:T.txt2, lineHeight:1.6 }}>{stripCites(d.s || d.summary || "")}</div>
              {!isUnknown && disp?.label && (
                <div style={{ marginTop:6, fontSize:11, color:T.txt3 }}>
                  Signal: <span style={{ color:T.txt2, fontWeight:600 }}>{disp.label}</span>
                </div>
              )}
              {(d.sources||[]).length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                  {d.sources.map(src => <span key={src} style={{ padding:"2px 7px", fontSize:10, borderRadius:20, background:T.accentBg, color:T.accent2, border:`1px solid ${T.accent}` }}>{src}</span>)}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize:11, color:T.txt3, fontStyle:"italic" }}>
              No public record found yet. This category is excluded from the overall grade.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Phase 5.ag: memoize CompanyCard so root re-renders (every keystroke in the
// search input) don't cascade into re-rendering every visible card. The
// custom equality function intentionally IGNORES callback props (onUpgrade,
// onToggleSave, onToggleCompare, onCompareWith) — they're recreated on every
// parent render but are functionally identical (just closures over the same
// stable parent state). Comparing the data props that actually drive the
// render is enough.
const CompanyCard = React.memo(function CompanyCard({ company, catFilter, profile, isPaid, onUpgrade, isSaved, onToggleSave, inCompare, onToggleCompare, onCompareWith, onNavigate, allCompanies, initiallyOpen }) {
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
    // Phase 5.as (QA fleet round 2): paywall now has a 3/week quota AND
    // a 4-hour dismiss cooldown. Without the cooldown, users who dismiss
    // re-trigger the paywall on every subsequent tap — abusive UX that
    // teaches dismiss-and-leave. With cooldown, post-dismiss browsing
    // stays free until the next session (or 4h, whichever is sooner).
    if (!isPaid && !open) {
      const slug = company.slug || company.id;
      const now = new Date();
      const weekKey = `${now.getUTCFullYear()}-W${Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(),0,1)) / (7*86_400_000))}`;
      let log = {};
      try { log = JSON.parse(localStorage.getItem("tn_freeViewed") || "{}"); } catch {}
      if (log.week !== weekKey) log = { week: weekKey, slugs: [] };
      // Dismiss cooldown: if user closed paywall within last 4 hours, treat
      // the request as if they're still in their free quota — record the
      // view but don't re-fire the paywall.
      const dismissedAt = Number(sessionStorage.getItem("tn_paywallDismissedAt") || 0);
      const inCooldown = dismissedAt && (Date.now() - dismissedAt) < 4 * 60 * 60 * 1000;
      const alreadyViewed = log.slugs.includes(slug);
      if (!alreadyViewed && log.slugs.length >= 3 && !inCooldown) {
        track("paywall_shown", { reason: "free_quota_exhausted", slug, viewed_this_week: log.slugs.length });
        onUpgrade();
        return;
      }
      if (!alreadyViewed) {
        log.slugs.push(slug);
        try { localStorage.setItem("tn_freeViewed", JSON.stringify(log)); } catch {}
      }
    }
    // Phase 5.al (item #2): record view to local History list — capped
    // at 100, most-recent first, dedup by slug so re-views bump rather
    // than duplicate. Powers the new History bottom-nav tab.
    if (!open) {
      try {
        const slug = company.slug || company.id;
        const raw = JSON.parse(localStorage.getItem("tn_viewHistory") || "[]");
        const filtered = raw.filter(e => e.slug !== slug);
        filtered.unshift({ slug, name: company.name, cat: company.cat, viewedAt: Date.now() });
        if (filtered.length > 100) filtered.length = 100;
        localStorage.setItem("tn_viewHistory", JSON.stringify(filtered));
      } catch {}
    }
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
      {/* Phase 5.af: slim closed-row layout — save + compare moved INTO the
          expanded profile so the company name gets ~70px more horizontal
          space and long names like "Pennsylvania Real Estate Investment
          Trust" stop getting cut off. */}
      <div onClick={handleTap} style={{ display:"flex", alignItems:"center", gap:10, padding:"11px 14px", cursor:"pointer" }}>
        <CompanyLogo company={company} size={36} />
        <div style={{ flex:1, minWidth:0 }}>
          <div title={company.name} style={{ fontSize:16, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.name}</div>
          <div style={{ fontSize:13, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{company.cat}</div>
        </div>
        <div style={{ flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>
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
          {/* Phase 5.ag (item G): "Better for your values" recommendation.
              YUKA's single highest-leverage retention feature — when the
              current grade is C/D/F for the user, surface 2-3 same-category
              brands that score noticeably higher FOR THEIR VALUES. Without
              this, users get the verdict but no next step, and 94% of YUKA's
              behavior-change comes from exactly this nudge.

              Visual treatment: green callout (signals "switch to this"),
              full company card style (logo + name + their grade), tap to
              jump to that profile. Conditional on profile presence AND a
              bad grade — for A/B grades we DON'T show alternatives (would
              undermine the positive verdict). For users without a profile,
              show neutral "Direct competitors" as before. */}
          {(() => {
            const comps = Array.isArray(enriched.competitors) ? enriched.competitors : [];
            if (!comps.length || !allCompanies?.length) return null;
            const lookup = new Map(allCompanies.map(c => [c.slug || c.id, c]));
            const competitorsResolved = comps.map(slug => lookup.get(slug)).filter(Boolean);
            // Branch on profile + grade.
            const isBadGrade = profile && ["C","D","F"].includes(grade);
            const display = profile
              ? competitorsResolved
                  .map(c => ({ co: c, score: computeScore(c, profile) }))
                  .filter(x => x.score >= ps + 7)
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 3)
              : competitorsResolved.slice(0, 4).map(c => ({ co: c, score: c.overall }));
            if (!display.length) return null;
            // Bad-grade users get the prominent green "Better for your values"
            // call-to-switch. Everyone else gets neutral competitor chips.
            if (isBadGrade) {
              return (
                <div style={{ background:"rgba(76,175,130,0.08)", border:"1.5px solid rgba(76,175,130,0.4)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#4caf82", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                    <i className="ti ti-arrow-up-right" aria-hidden="true" /> Better for your values
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {display.map(({ co: alt, score: altScore }) => {
                      const altGrade = scoreGrade(altScore);
                      return (
                        <button
                          key={alt.slug || alt.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            track("better_alt_pick", { from: enriched.slug || enriched.id, to: alt.slug || alt.id, fromScore: ps, toScore: altScore });
                            // Phase 5.ag (QA fix #1): route via the parent's
                            // navigation callback. Previously pushed history
                            // + dispatched popstate, but nothing listened —
                            // the click was a silent no-op.
                            if (onNavigate) onNavigate(alt.slug || alt.id);
                          }}
                          style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", width:"100%" }}
                        >
                          <CompanyLogo company={alt} size={32} />
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{alt.name}</div>
                            <div style={{ fontSize:11, color:T.txt3 }}>{altScore - ps}+ points better for you</div>
                          </div>
                          <div style={{ padding:"4px 10px", borderRadius:8, background:altGrade === "A" ? "#0d2318" : "#1a2810", color: altGrade === "A" ? "#4caf82" : "#8bc34a", fontSize:13, fontWeight:700 }}>{altGrade}</div>
                          <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }
            // Non-bad-grade fallback: neutral competitor chips (old behavior)
            return (
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px", marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:700, color:T.accent2, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:8, display:"flex", alignItems:"center", gap:5 }}>
                  <i className="ti ti-arrows-left-right" aria-hidden="true" /> Direct competitors
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {display.map(({ co: alt }) => (
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
          {/* Phase 5.z: progressive disclosure — like YUKA's nutrition cards.
              Each category shows ONLY a colored spectrum bar + dot by default.
              Tap to expand → rationale, sources, raw data. This collapses the
              cognitive load and matches the YUKA "score first, click for why"
              pattern the user asked for. */}

          {/* Phase 5.al (item #3): Risk-signal preview row. Per the
              stickiness audit, recalls + breaches + lawsuits are
              "verdict → why → what to do" decision-critical signals
              that belong at the TOP of the profile, not buried in the
              About block. Compact chip strip — full detail still lives
              in the About-this-company section below. */}
          {(() => {
            const recalls = enriched.recalls;
            const breaches = enriched.privacy_hibp_breaches;
            const litigation = enriched.litigation_courtlistener;
            const hasAny = (recalls?.recalls?.length > 0) ||
                           (breaches?.breachCount > 0) ||
                           (litigation?.caseCount24mo > 0);
            if (!hasAny) return null;
            return (
              <div style={{ marginBottom:14, display:"flex", flexWrap:"wrap", gap:6 }}>
                {recalls?.recalls?.length > 0 && (
                  <div style={{ flex:"1 1 130px", padding:"8px 10px", borderRadius:8, background: recalls.severityMax === "high" ? "rgba(226,74,74,0.15)" : "rgba(240,160,48,0.12)", border:`1px solid ${recalls.severityMax === "high" ? "rgba(226,74,74,0.5)" : "rgba(240,160,48,0.5)"}` }}>
                    <div style={{ fontSize:10, color: recalls.severityMax === "high" ? "#e24a4a" : "#f0a030", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
                      <i className="ti ti-rosette" aria-hidden="true" /> Recalls
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginTop:2 }}>
                      {recalls.recallCount24mo} in 24mo
                    </div>
                  </div>
                )}
                {breaches?.breachCount > 0 && (
                  <div style={{ flex:"1 1 130px", padding:"8px 10px", borderRadius:8, background:"rgba(226,74,74,0.12)", border:"1px solid rgba(226,74,74,0.4)" }}>
                    <div style={{ fontSize:10, color:"#e24a4a", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
                      <i className="ti ti-shield-off" aria-hidden="true" /> Breaches
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginTop:2 }}>
                      {breaches.breachCount} · {breaches.totalRecordsLost >= 1e6 ? `${(breaches.totalRecordsLost/1e6).toFixed(1)}M` : `${(breaches.totalRecordsLost/1e3).toFixed(0)}K`} records
                    </div>
                  </div>
                )}
                {litigation?.caseCount24mo > 0 && (
                  <div style={{ flex:"1 1 130px", padding:"8px 10px", borderRadius:8, background:"rgba(240,160,48,0.10)", border:"1px solid rgba(240,160,48,0.4)" }}>
                    <div style={{ fontSize:10, color:"#f0a030", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
                      <i className="ti ti-gavel" aria-hidden="true" /> Lawsuits
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginTop:2 }}>
                      {litigation.caseCount24mo} · 24mo
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {CAT_KEYS.map(k => (
            <CategoryRow
              key={k}
              cat={k}
              enriched={enriched}
              profile={profile}
            />
          ))}

          {/* Phase 5.ae: About-this-company enrichment block.
              Pulled from Wikipedia infoboxes, BBB/SEC complaint counts, and
              GDELT news mentions. Each subsection only renders if data
              exists, so old/unenriched companies show nothing. */}
          {(enriched.wiki || enriched.bbb || enriched.secComplaints || enriched.news || enriched.payRatio || enriched.deiBadges || enriched.animalCerts || enriched.products || enriched.storeFootprint || enriched.recalls || enriched.origin || enriched.ownership || enriched.charity_irs990 || enriched.firearms_atf_ffl || enriched.privacy_hibp_breaches || enriched.litigation_courtlistener) && (
            <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, padding:14, marginTop:4 }}>
              <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginBottom:10, letterSpacing:0.2 }}>
                About this company
              </div>

              {enriched.wiki && (
                <div style={{ marginBottom:10 }}>
                  {(enriched.wiki.founded || enriched.wiki.hq || enriched.wiki.employees || enriched.wiki.revenue || enriched.wiki.industry || enriched.wiki.parent) && (
                    <div style={{ display:"grid", gridTemplateColumns:"110px 1fr", rowGap:4, columnGap:8, fontSize:12, color:T.txt2, marginBottom:8 }}>
                      {enriched.wiki.founded   && (<><div style={{ color:T.txt3 }}>Founded</div><div>{enriched.wiki.founded}</div></>)}
                      {enriched.wiki.hq        && (<><div style={{ color:T.txt3 }}>HQ</div><div>{enriched.wiki.hq}</div></>)}
                      {enriched.wiki.industry  && (<><div style={{ color:T.txt3 }}>Industry</div><div>{enriched.wiki.industry}</div></>)}
                      {enriched.wiki.employees && (<><div style={{ color:T.txt3 }}>Employees</div><div>{enriched.wiki.employees}</div></>)}
                      {enriched.wiki.revenue   && (<><div style={{ color:T.txt3 }}>Revenue</div><div>{enriched.wiki.revenue}</div></>)}
                      {enriched.wiki.parent    && (<><div style={{ color:T.txt3 }}>Parent</div><div>{enriched.wiki.parent}</div></>)}
                    </div>
                  )}
                  {enriched.wiki.extract && (
                    <div style={{ fontSize:12, color:T.txt2, lineHeight:1.5 }}>
                      {enriched.wiki.extract}
                      {enriched.wiki.wikipediaUrl && (
                        <> <a href={enriched.wiki.wikipediaUrl} target="_blank" rel="noreferrer" style={{ color:T.accent2, textDecoration:"none" }}>Wikipedia →</a></>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(enriched.bbb || enriched.secComplaints) && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom: enriched.news ? 10 : 0 }}>
                  {enriched.bbb?.rating && (
                    <a
                      href={enriched.bbb.profileUrl || "#"}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize:11, padding:"4px 8px", borderRadius:6, background:T.bg3, border:`1px solid ${T.border}`, color:T.txt2, textDecoration:"none" }}
                    >
                      BBB <b style={{ color:T.txt }}>{enriched.bbb.rating}</b>
                      {typeof enriched.bbb.complaintCount === "number" && enriched.bbb.complaintCount > 0 && (
                        <> · {enriched.bbb.complaintCount} complaints</>
                      )}
                    </a>
                  )}
                  {enriched.secComplaints?.count > 0 && (
                    <span style={{ fontSize:11, padding:"4px 8px", borderRadius:6, background:T.bg3, border:`1px solid ${T.border}`, color:T.txt2 }}>
                      SEC filings: <b style={{ color:T.txt }}>{enriched.secComplaints.count}</b>
                    </span>
                  )}
                </div>
              )}

              {enriched.news && (enriched.news.mentionCount90d > 0 || (enriched.news.scandalSignals?.length > 0)) && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize:11, color:T.txt3, marginBottom:6 }}>
                    News last 90d: <b style={{ color:T.txt2 }}>{enriched.news.mentionCount90d || 0}</b> mentions
                    {typeof enriched.news.avgTone === "number" && (
                      <> · tone <b style={{ color: enriched.news.avgTone < -2 ? "#e24a4a" : enriched.news.avgTone > 2 ? "#4caf82" : T.txt2 }}>{enriched.news.avgTone.toFixed(1)}</b></>
                    )}
                  </div>
                  {enriched.news.scandalSignals?.length > 0 && (
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                      {enriched.news.scandalSignals.slice(0, 5).map((s, i) => (
                        <span key={i} style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"rgba(226,74,74,0.12)", border:"1px solid rgba(226,74,74,0.3)", color:"#e24a4a", textTransform:"uppercase", letterSpacing:0.3 }}>{s}</span>
                      ))}
                    </div>
                  )}
                  {enriched.news.topArticles?.length > 0 && (
                    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                      {enriched.news.topArticles.slice(0, 3).map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent2, textDecoration:"none", lineHeight:1.4 }}>
                          → {a.title || a.url}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Phase 5.aj: Reputation history — HIBP breaches + CourtListener litigation.
                  Universal-truth axes (breaches and lawsuits are objectively bad for
                  everyone), so red/gold coloring per bias-fix policy is allowed here.
                  Defensive sanity check on litigation: the upstream CourtListener
                  pull was flagged as broken (every entry had caseCount24mo=20 with
                  generic case names). We require a non-generic mostRecentCase and
                  explicitly reject the sentinel value while the fixup workflow lands. */}
              {(() => {
                const br = enriched.privacy_hibp_breaches;
                const lt = enriched.litigation_courtlistener;
                const mrc = lt?.mostRecentCase ? String(lt.mostRecentCase).trim() : "";
                const litLooksLegit = !!(
                  lt &&
                  lt.caseCount24mo > 0 &&
                  mrc.length > 8 &&
                  !/^(case|lawsuit|filing|complaint|matter|action)\s*\d*$/i.test(mrc) &&
                  lt.caseCount24mo !== 20 // sentinel from the broken pull
                );
                const hasBreach = !!(br && br.breachCount > 0);
                if (!hasBreach && !litLooksLegit) return null;

                const now = Date.now();
                const threeYearsMs = 3 * 365 * 24 * 60 * 60 * 1000;
                const breachAgeMs = br?.mostRecentBreach ? (now - new Date(br.mostRecentBreach).getTime()) : null;
                const breachStale = breachAgeMs != null && breachAgeMs > threeYearsMs;
                const breachSevere = hasBreach && (br.totalRecordsLost > 1_000_000 || br.hasSensitiveBreach);
                const breachColor = breachStale ? T.txt3 : breachSevere ? "#e24a4a" : "#f0a030";
                const breachBg = breachStale ? T.bg3
                                : breachSevere ? "rgba(226,74,74,0.12)"
                                : "rgba(240,160,48,0.10)";
                const breachBorder = breachStale ? T.border
                                    : breachSevere ? "rgba(226,74,74,0.5)"
                                    : "rgba(240,160,48,0.4)";

                const litSevere = litLooksLegit && lt.classActionCount > 0;
                const litWarn = litLooksLegit && !litSevere && lt.caseCount24mo > 5;
                const litColor = litSevere ? "#e24a4a" : litWarn ? "#f0a030" : T.txt3;
                const litBg = litSevere ? "rgba(226,74,74,0.12)"
                             : litWarn ? "rgba(240,160,48,0.10)"
                             : T.bg3;
                const litBorder = litSevere ? "rgba(226,74,74,0.5)"
                                 : litWarn ? "rgba(240,160,48,0.4)"
                                 : T.border;

                const fmt = (d) => {
                  if (!d) return "—";
                  try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d).slice(0, 10); }
                };

                return (
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:11, color:T.txt3, marginBottom:6, textTransform:"uppercase", letterSpacing:0.4, fontWeight:600 }}>
                      Reputation history
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {hasBreach && (
                        <div style={{ padding:"10px 12px", borderRadius:10, background:breachBg, border:`1.5px solid ${breachBorder}` }}>
                          <div style={{ fontSize:11, fontWeight:700, color:breachColor, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                            <i className="ti ti-shield-lock" aria-hidden="true" />
                            {br.breachCount} data breach{br.breachCount === 1 ? "" : "es"}
                            {br.totalRecordsLost > 0 && (
                              <> · {br.totalRecordsLost >= 1_000_000 ? `${(br.totalRecordsLost/1e6).toFixed(1)}M` : br.totalRecordsLost >= 1_000 ? `${Math.round(br.totalRecordsLost/1e3)}k` : br.totalRecordsLost} records</>
                            )}
                            {br.hasSensitiveBreach && <> · sensitive data</>}
                          </div>
                          {br.breaches?.length > 0 && (
                            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                              {[...br.breaches]
                                .sort((a, b) => new Date(b.breachDate || 0) - new Date(a.breachDate || 0))
                                .slice(0, 3)
                                .map((b, i) => (
                                  <div key={i} style={{ fontSize:11, color:T.txt2, lineHeight:1.4 }}>
                                    <span style={{ fontWeight:600, color:T.txt }}>{fmt(b.breachDate)}</span>
                                    {b.name ? <> · {b.name}</> : null}
                                    {b.pwnCount > 0 && (
                                      <> · {b.pwnCount >= 1_000_000 ? `${(b.pwnCount/1e6).toFixed(1)}M` : b.pwnCount >= 1_000 ? `${Math.round(b.pwnCount/1e3)}k` : b.pwnCount} accounts</>
                                    )}
                                    {b.dataClasses?.length > 0 && (
                                      <span style={{ color:T.txt3 }}> · {b.dataClasses.slice(0, 3).join(", ")}</span>
                                    )}
                                  </div>
                                ))}
                              {br.breaches.length > 3 && (
                                <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>+{br.breaches.length - 3} more</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {litLooksLegit && (
                        <div style={{ padding:"10px 12px", borderRadius:10, background:litBg, border:`1.5px solid ${litBorder}` }}>
                          <div style={{ fontSize:11, fontWeight:700, color:litColor, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                            <i className="ti ti-gavel" aria-hidden="true" />
                            {lt.caseCount24mo} federal case{lt.caseCount24mo === 1 ? "" : "s"} in 24 months
                            {lt.classActionCount > 0 && (
                              <> · {lt.classActionCount} class action{lt.classActionCount === 1 ? "" : "s"}</>
                            )}
                          </div>
                          {lt.cases?.length > 0 && (
                            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                              {[...lt.cases]
                                .sort((a, b) => new Date(b.dateFiled || 0) - new Date(a.dateFiled || 0))
                                .slice(0, 3)
                                .map((c, i) => {
                                  const Tag = c.sourceUrl ? "a" : "div";
                                  return (
                                    <Tag
                                      key={i}
                                      {...(c.sourceUrl ? { href: c.sourceUrl, target: "_blank", rel: "noreferrer" } : {})}
                                      style={{ fontSize:11, color:T.txt2, lineHeight:1.4, textDecoration:"none" }}
                                    >
                                      <span style={{ fontWeight:600, color:T.txt }}>{fmt(c.dateFiled)}</span>
                                      {c.caseName ? <> · {c.caseName}</> : null}
                                      {c.court && <span style={{ color:T.txt3 }}> · {c.court}</span>}
                                      {c.natureOfSuit && <span style={{ color:T.txt3 }}> · {c.natureOfSuit}</span>}
                                    </Tag>
                                  );
                                })}
                              {lt.cases.length > 3 && (
                                <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>+{lt.cases.length - 3} more</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Phase 5.af: SEC DEF 14A pay-ratio */}
              {enriched.payRatio && (enriched.payRatio.ratioDisplay || enriched.payRatio.ratio) && (
                <div style={{ marginBottom:10, fontSize:11, color:T.txt3 }}>
                  CEO-to-median pay ratio: <b style={{ color: enriched.payRatio.ratio > 250 ? "#e24a4a" : enriched.payRatio.ratio > 50 ? T.gold : "#4caf82" }}>{enriched.payRatio.ratioDisplay || `${Math.round(enriched.payRatio.ratio)}:1`}</b>
                  {enriched.payRatio.ceoPay && (
                    <> · CEO ${(enriched.payRatio.ceoPay/1e6).toFixed(1)}M</>
                  )}
                  {enriched.payRatio.medianWorkerPay && (
                    <> · median ${(enriched.payRatio.medianWorkerPay/1000).toFixed(0)}k</>
                  )}
                  {enriched.payRatio.sourceUrl && (
                    <> · <a href={enriched.payRatio.sourceUrl} target="_blank" rel="noreferrer" style={{ color:T.accent2, textDecoration:"none" }}>SEC {enriched.payRatio.sourceForm} ({enriched.payRatio.year})</a></>
                  )}
                </div>
              )}

              {/* Phase 5.af: DEI badges from CEI / Disability:IN / Bloomberg */}
              {enriched.deiBadges?.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11, color:T.txt3, marginBottom:4 }}>DEI recognition</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {enriched.deiBadges.map((b, i) => {
                      const label = b.scoreType === "hrc_cei" ? "HRC CEI"
                                  : b.scoreType === "disability_in" ? "Disability:IN"
                                  : b.scoreType === "bloomberg_gei" ? "Bloomberg GEI"
                                  : b.scoreType;
                      const scoreOk = typeof b.score === "number" && b.score >= 80;
                      const Tag = b.sourceUrl ? "a" : "span";
                      return (
                        <Tag key={i} href={b.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background: scoreOk ? "rgba(76,175,130,0.12)" : T.bg3, border:`1px solid ${scoreOk ? "rgba(76,175,130,0.4)" : T.border}`, color: scoreOk ? "#4caf82" : T.txt2, textDecoration:"none" }}>
                          {label} {b.score != null ? `· ${b.score}` : ""} {b.year ? `· ${b.year}` : ""}
                        </Tag>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Phase 5.af: Animal-testing certifications */}
              {enriched.animalCerts?.length > 0 && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11, color:T.txt3, marginBottom:4 }}>Animal testing</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {enriched.animalCerts.map((c, i) => {
                      const negative = c.certified === false || c.certifyingBody === "peta_tests";
                      const label = c.certifyingBody === "peta_cf" ? "PETA Cruelty-Free"
                                  : c.certifyingBody === "leaping_bunny" ? "Leaping Bunny"
                                  : c.certifyingBody === "cfi" ? "Cruelty Free International"
                                  : c.certifyingBody === "peta_tests" ? "PETA: Tests on animals"
                                  : c.certifyingBody;
                      const Tag = c.sourceUrl ? "a" : "span";
                      return (
                        <Tag key={i} href={c.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background: negative ? "rgba(226,74,74,0.12)" : "rgba(76,175,130,0.12)", border:`1px solid ${negative ? "rgba(226,74,74,0.4)" : "rgba(76,175,130,0.4)"}`, color: negative ? "#e24a4a" : "#4caf82", textDecoration:"none" }}>
                          {negative ? "✗ " : "✓ "}{label}
                        </Tag>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Phase 5.ah: Recalls — top-5 search-volume gap. Always
                  prominent (red border for high-severity, gold otherwise)
                  because recall events are real safety signals users want. */}
              {enriched.recalls?.recalls?.length > 0 && (
                <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:10, background: enriched.recalls.severityMax === "high" ? "rgba(226,74,74,0.12)" : "rgba(240,160,48,0.10)", border:`1.5px solid ${enriched.recalls.severityMax === "high" ? "rgba(226,74,74,0.5)" : "rgba(240,160,48,0.4)"}` }}>
                  <div style={{ fontSize:11, fontWeight:700, color: enriched.recalls.severityMax === "high" ? "#e24a4a" : "#f0a030", textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                    <i className="ti ti-rosette" aria-hidden="true" /> {enriched.recalls.recallCount24mo} recall{enriched.recalls.recallCount24mo === 1 ? "" : "s"} in 24 months
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                    {enriched.recalls.recalls.slice(0, 3).map((r, i) => (
                      <a key={i} href={r.recallUrl || "#"} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.txt2, lineHeight:1.4, textDecoration:"none" }}>
                        <span style={{ fontWeight:600, color:T.txt }}>{r.date || "—"}</span> · {r.agency} · {r.reason || r.productName || "recall issued"}
                      </a>
                    ))}
                  </div>
                  {enriched.recalls.recalls.length > 3 && (
                    <div style={{ fontSize:10, color:T.txt3, marginTop:6 }}>+{enriched.recalls.recalls.length - 3} more</div>
                  )}
                </div>
              )}

              {/* Phase 5.ah: BDS factual disclosure — NEVER a score, just a
                  citable flag for users who care. Per anti-pattern memory:
                  factual framing only, source link required. */}
              {enriched.ownership?.bdsListed && (
                <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:10, background:T.bg3, border:`1px solid ${T.border}` }}>
                  <div style={{ fontSize:11, color:T.txt2, marginBottom:4 }}>
                    <b style={{ color:T.txt }}>Listed on the BDS target list</b> ({enriched.ownership.bdsListed.category || "Awareness"})
                  </div>
                  {enriched.ownership.bdsListed.sourceUrl && (
                    <a href={enriched.ownership.bdsListed.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent2, textDecoration:"none" }}>
                      Source · bdsmovement.net →
                    </a>
                  )}
                </div>
              )}

              {/* Phase 5.ah: Ownership identity badges (positive signals only) */}
              {enriched.ownership && (enriched.ownership.blackOwned || enriched.ownership.womenOwned || enriched.ownership.minorityOwned || enriched.ownership.lgbtOwned || enriched.ownership.smallBusiness) && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontSize:11, color:T.txt3, marginBottom:4 }}>Ownership</div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {enriched.ownership.blackOwned    && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(124,109,250,0.12)", border:"1px solid rgba(124,109,250,0.4)", color:"#9d91ff" }}>Black-owned</span>}
                    {enriched.ownership.womenOwned    && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(124,109,250,0.12)", border:"1px solid rgba(124,109,250,0.4)", color:"#9d91ff" }}>Women-owned</span>}
                    {enriched.ownership.minorityOwned && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(124,109,250,0.12)", border:"1px solid rgba(124,109,250,0.4)", color:"#9d91ff" }}>Minority-owned</span>}
                    {enriched.ownership.lgbtOwned     && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(124,109,250,0.12)", border:"1px solid rgba(124,109,250,0.4)", color:"#9d91ff" }}>LGBT-owned</span>}
                    {enriched.ownership.smallBusiness && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:T.bg3, border:`1px solid ${T.border}`, color:T.txt2 }}>Small business</span>}
                  </div>
                </div>
              )}

              {/* Phase 5.aj: Charity / foundation giving from IRS 990 filings.
                  Stance axis (giving is a value, not a universal good) — neutral
                  chip styling only, no red/green. Source link to ProPublica
                  Nonprofit Explorer so the user can verify the filing. */}
              {enriched.charity_irs990?.totalGrants > 0 && (() => {
                const c = enriched.charity_irs990;
                const fmt = (n) => {
                  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
                  if (n >= 1e6) return `$${Math.round(n / 1e6)}M`;
                  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
                  return `$${n}`;
                };
                return (
                  <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:10, background:T.bg3, border:`1px solid ${T.border}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:T.txt, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
                      <i className="ti ti-heart" aria-hidden="true" /> Foundation giving
                    </div>
                    <div style={{ fontSize:12, color:T.txt2, lineHeight:1.4 }}>
                      <b style={{ color:T.txt }}>{c.foundationName}</b> granted{" "}
                      <b style={{ color:T.txt }}>{fmt(c.totalGrants)}</b>
                      {c.givingAsPctRev != null && (
                        <> ({(c.givingAsPctRev * 100).toFixed(2)}% of revenue)</>
                      )}
                      {c.fiscalYear && <> in FY{c.fiscalYear}</>}
                    </div>
                    {c.propublicaUrl && (
                      <a href={c.propublicaUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent2, textDecoration:"none", marginTop:4, display:"inline-block" }}>
                        Source · ProPublica IRS 990 →
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Phase 5.ah: Manufacturing origin + forced-labor risk */}
              {enriched.origin && (enriched.origin.primaryCountries?.length > 0 || enriched.origin.uflpaListed) && (
                <div style={{ marginBottom:10, fontSize:11, color:T.txt3 }}>
                  Made in:{" "}
                  <span style={{ color:T.txt2 }}>{(enriched.origin.primaryCountries || []).slice(0, 3).join(" · ") || "unknown"}</span>
                  {enriched.origin.forcedLaborRisk === "high" && (
                    <span style={{ marginLeft:8, padding:"2px 6px", borderRadius:4, background:"rgba(226,74,74,0.15)", border:"1px solid rgba(226,74,74,0.4)", color:"#e24a4a", fontSize:10, fontWeight:700 }}>
                      ⚠ Forced-labor risk
                    </span>
                  )}
                </div>
              )}

              {/* Phase 5.aj: ATF Federal Firearms License — factual disclosure
                  only. Per bias-fix policy this is a stance axis (pro-2A vs
                  anti-firearms), so NO color coding and neutral verbiage.
                  Defense primes with primaryRole='destructive_devices' get
                  softened framing ("manufacturer of regulated products") since
                  the literal ATF term is alarming out of context. */}
              {enriched.firearms_atf_ffl?.licenseCount > 0 && (() => {
                const ffl = enriched.firearms_atf_ffl;
                const roleLabels = {
                  manufacturer: "Manufacturer",
                  importer: "Importer",
                  dealer: "Dealer",
                  collector: "Collector",
                  destructive_devices: "Manufacturer of regulated products",
                };
                const roleLabel = roleLabels[ffl.primaryRole] || null;
                const stateCount = ffl.states?.length || 0;
                return (
                  <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:10, background:T.bg3, border:`1px solid ${T.border}` }}>
                    <div style={{ fontSize:11, color:T.txt2, marginBottom:4, display:"flex", alignItems:"center", gap:6 }}>
                      <i className="ti ti-target" aria-hidden="true" style={{ color:T.txt3 }} />
                      <span>
                        <b style={{ color:T.txt }}>Federal firearms license</b>
                        {roleLabel ? <> · {roleLabel}</> : null}
                        {" · "}{ffl.licenseCount} active{stateCount > 0 ? <> in {stateCount} state{stateCount === 1 ? "" : "s"}</> : null}
                      </span>
                    </div>
                    {ffl.sourceUrl && (
                      <a href={ffl.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:11, color:T.accent2, textDecoration:"none" }}>
                        Source · ATF FFL list{ffl.sourceMonth ? ` (${ffl.sourceMonth})` : ""} →
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* Phase 5.af: Top products (from Open Food Facts) */}
              {enriched.products?.length > 0 && (
                <div style={{ marginBottom:10, fontSize:11, color:T.txt3 }}>
                  Top products: <span style={{ color:T.txt2 }}>{enriched.products.slice(0, 5).join(" · ")}</span>
                </div>
              )}

              {/* Phase 5.af: OSM store footprint */}
              {enriched.storeFootprint?.usStoreCount > 0 && (
                <div style={{ marginBottom:10, fontSize:11, color:T.txt3 }}>
                  US footprint: <b style={{ color:T.txt2 }}>{enriched.storeFootprint.usStoreCount.toLocaleString()}</b> locations
                  {enriched.storeFootprint.byState && Object.keys(enriched.storeFootprint.byState).length > 0 && (() => {
                    const top = Object.entries(enriched.storeFootprint.byState).sort((a,b) => b[1]-a[1]).slice(0, 3);
                    return <> · most in <span style={{ color:T.txt2 }}>{top.map(([s,n]) => `${s} (${n})`).join(", ")}</span></>;
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Phase 5.ag (item J): "I bought it / I skipped it" toggle.
              Single tap. Optional. Builds the data spine for the monthly
              recap (item M) without forcing receipt-forwarding. Audit
              specifically warned: never auto-enable, never push for it,
              never gate features behind it. Pure self-tracking. */}
          {(() => {
            const slug = enriched.slug || enriched.id;
            const lsKey = "tn_purchaseLog";
            let log = {};
            try { log = JSON.parse(localStorage.getItem(lsKey) || "{}"); } catch {}
            const current = log[slug]?.action || null; // "bought" | "skipped" | null
            const setAction = (action) => {
              try {
                const updated = { ...log };
                if (current === action) delete updated[slug]; // toggle off
                else updated[slug] = { action, at: Date.now(), name: enriched.name, grade, score: ps };
                localStorage.setItem(lsKey, JSON.stringify(updated));
                track("purchase_log", { slug, action: current === action ? "cleared" : action, grade });
              } catch {}
            };
            const btn = (action, label, icon, color) => (
              <button
                onClick={(e) => { e.stopPropagation(); setAction(action); }}
                style={{ flex:1, padding:"7px 8px", fontSize:11, fontWeight:600, borderRadius:8, cursor:"pointer", border:`1px solid ${current === action ? color : T.border}`, background: current === action ? `${color}22` : T.bg3, color: current === action ? color : T.txt3, display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}
              >
                <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize:12 }} /> {label}
              </button>
            );
            return (
              <div style={{ marginTop:8, display:"flex", gap:6 }}>
                {btn("bought",  "I bought it",  "ti-shopping-cart", "#4caf82")}
                {btn("skipped", "I skipped it", "ti-arrow-back",    "#f0a030")}
              </div>
            );
          })()}

          {/* Phase 5.af: Recency + Report-correction footer.
              Always rendered so every profile shows a freshness signal and a
              way to flag bad data — no infra beyond mailto: for now. */}
          {(() => {
            const ts = enriched.lastUpdated;
            const slug = enriched.slug || enriched.id;
            const subject = encodeURIComponent(`TruNorth correction: ${enriched.name}`);
            const body = encodeURIComponent(
              `Company: ${enriched.name}\nProfile: https://www.trunorthapp.com/company/${slug}\n\nWhich category is wrong (Political / Charity / Environment / Labor / DEI / Animals / Firearms / Privacy / ExecPay / Flags)?\n\n\nWhat is the correct information, and where can we verify it (source URL)?\n\n\n— Sent from TruNorth\n`
            );
            const mailto = `mailto:corrections@trunorthapp.com?subject=${subject}&body=${body}`;
            let recencyLabel = "";
            if (ts) {
              const ageMs = Date.now() - new Date(ts).getTime();
              const days = Math.floor(ageMs / 86_400_000);
              if (days < 1)        recencyLabel = "Updated today";
              else if (days < 7)   recencyLabel = `Updated ${days}d ago`;
              else if (days < 30)  recencyLabel = `Updated ${Math.floor(days/7)}w ago`;
              else if (days < 365) recencyLabel = `Updated ${Math.floor(days/30)}mo ago`;
              else                 recencyLabel = `Updated ${Math.floor(days/365)}y ago`;
            }
            return (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginTop:8, paddingTop:8, borderTop:`1px dashed ${T.border}`, fontSize:11, color:T.txt3 }}>
                <span title={ts ? new Date(ts).toLocaleString() : ""}>
                  {recencyLabel || "Update history unavailable"}
                </span>
                <a
                  href={mailto}
                  onClick={() => track("report_correction_clicked", { slug, name: enriched.name })}
                  style={{ color:T.accent2, textDecoration:"none", display:"inline-flex", alignItems:"center", gap:4 }}
                >
                  <i className="ti ti-flag" aria-hidden="true" style={{ fontSize:11 }} />
                  Report incorrect info
                </a>
              </div>
            );
          })()}

          {/* Phase 5.af: Save + Compare buttons live in the expanded profile
              (not the closed row) so the company name has room to breathe. */}
          {(onToggleSave || onToggleCompare) && (
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              {onToggleSave && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
                  style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:isSaved ? T.goldBg : T.bg3, border:`1px solid ${isSaved ? T.gold : T.border}`, color: isSaved ? T.gold : T.txt2 }}
                >
                  <span aria-hidden="true">{isSaved ? "★" : "☆"}</span> {isSaved ? "Saved" : "Save"}
                </button>
              )}
              {onToggleCompare && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
                  style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:inCompare ? T.accentBg : T.bg3, border:`1px solid ${inCompare ? T.accent : T.border}`, color: inCompare ? T.accent2 : T.txt2 }}
                >
                  <i className="ti ti-arrows-left-right" aria-hidden="true" /> {inCompare ? "In compare" : "Compare"}
                </button>
              )}
            </div>
          )}

          {/* Share button — UX 2A. Uses Web Share API on iOS Safari/PWA;
              falls back to copying a URL to the clipboard on desktop browsers.
              Phase 5.ag (item I): every share URL now carries UTM params +
              a per-user `from` hash so we can attribute K-factor by channel
              and by user. Channel inferred from navigator.share availability;
              `from` is a short stable hash of the user's slug-history so we
              can spot which users drive the most shares without leaking PII. */}
          <div style={{ display:"flex", gap:8 }}>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const channel = (typeof navigator !== "undefined" && navigator.share) ? "native_share" : "clipboard";
                // Lightweight user hash — stable per device but no PII; used only
                // for cohort analysis of which sharers drive activations.
                let fromHash = "";
                try {
                  const stable = localStorage.getItem("tn_user_hash") || (Math.random().toString(36).slice(2, 10));
                  localStorage.setItem("tn_user_hash", stable);
                  fromHash = stable;
                } catch {}
                const utm = new URLSearchParams({
                  utm_source: "share",
                  utm_medium: channel,
                  utm_campaign: "company_profile",
                  ...(fromHash ? { from: fromHash } : {}),
                });
                const shareUrl = `https://www.trunorthapp.com/company/${encodeURIComponent(enriched.slug || enriched.id)}?${utm.toString()}`;
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
}, (prev, next) => (
  // Custom equality — only re-render when the data that actually drives the
  // visible card changes. Callbacks are intentionally NOT compared (they're
  // recreated on every parent render but are functionally identical closures).
  prev.company       === next.company       &&
  prev.catFilter     === next.catFilter     &&
  prev.profile       === next.profile       &&
  prev.isPaid        === next.isPaid        &&
  prev.isSaved       === next.isSaved       &&
  prev.inCompare     === next.inCompare     &&
  prev.initiallyOpen === next.initiallyOpen &&
  prev.allCompanies  === next.allCompanies
));

// ─── QUIZ ─────────────────────────────────────────────────────────────────────
function Quiz({ onComplete, onSkip }) {
  // Phase 5.ag: resolve QUIZ_STEPS at mount via URL param ?quiz=alt-a or
  // the cached preference. Switching mid-quiz isn't supported (resets the
  // answer state), so the choice is captured once on mount.
  const steps = React.useMemo(getQuizSteps, []);
  // Phase 5.as (QA bug #7): quiz answers used to live in useState only,
  // so iOS Safari aggressively backgrounding the tab under memory pressure
  // would dump the entire quiz back to step 0. Persist answers + step to
  // localStorage on every change; restore on mount.
  const [step, setStep] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tn_quiz_draft") || "{}").step || 0; }
    catch { return 0; }
  });
  const [answers, setAnswers] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tn_quiz_draft") || "{}").answers || {}; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("tn_quiz_draft", JSON.stringify({ step, answers, at: Date.now() })); } catch {}
  }, [step, answers]);
  const isWelcome = step === 0;
  const current = isWelcome ? null : steps[step-1];
  const isLast = step === steps.length;
  const prog = (step / steps.length) * 100;
  // Phase 5.y bug fix: combined-question pages were advancing when ONLY the
  // primary question had an answer. Now every sub-question must be answered.
  // Phase 5.ag: tri-single requires every sub answered before advancing.
  const canAdvance = isWelcome || current?.type === "multi"
    || (current?.type === "scale"  && answers[current?.id] !== undefined)
    || (current?.type === "single" && answers[current?.id] !== undefined)
    || (current?.type === "single+scale" && answers[current?.id] !== undefined && answers[current?.scaleId] !== undefined)
    || (current?.type === "scale+single" && answers[current?.id] !== undefined && answers[current?.singleId] !== undefined)
    || (current?.type === "scale+scale"  && answers[current?.id] !== undefined && answers[current?.scale2Id] !== undefined)
    || (current?.type === "tri-single"   && (current.subs || []).every(sub => answers[sub.id] !== undefined))
    || (current?.type === "importance-grid" && (current.rows || []).every(r => answers[r.id] !== undefined));

  const advance = () => {
    if (isLast) {
      // Phase 5.as: clear the draft once the quiz completes so a retake
      // starts fresh.
      try { localStorage.removeItem("tn_quiz_draft"); } catch {}
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
    // Phase 5.z: full-height column with constrained inner scroll. The CRITICAL
    // bit is `minHeight:0` on the flex child — without it, the inner scroller
    // grows to fit its content instead of letting overflow:auto kick in. This
    // is why the dealbreakers page wouldn't scroll on iPhone.
    <div style={{ display:"flex", flexDirection:"column", height:"100dvh", paddingTop:"env(safe-area-inset-top, 0px)", overflow:"hidden" }}>
      <div style={{ padding:"10px 16px 0", flexShrink:0 }}>
        <div style={{ height:4, background:T.bg3, borderRadius:4 }}>
          <div style={{ height:4, background:T.accent, borderRadius:4, width:`${prog}%`, transition:"width 0.3s" }} />
        </div>
        {step > 0 && <div style={{ fontSize:11, color:T.txt3, textAlign:"right", marginTop:5 }}>{step} of {steps.length}</div>}
      </div>

      <div style={{ flex:1, minHeight:0, padding:"12px 16px 24px", overflowY:"auto", WebkitOverflowScrolling:"touch" }}>
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
              Answer 4 quick steps. Every company's score recalculates based on what you actually care about — politics, DEI, animal testing, guns, privacy, and more.
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

        {/* Phase 5.ag/ai: tri-single — multiple quick single-selects on one
            screen. Pill row wraps to 2 lines when there are 4 options
            (Politics) on narrow screens. Sub-question microcopy ("Stays on
            your device…") is the reassurance line on the identity screen. */}
        {current?.type === "tri-single" && (
          <>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:current.sub ? 6 : 16, lineHeight:1.4 }}>{current.q}</div>
            {current.sub && (
              <div style={{ fontSize:12, color:T.txt3, marginBottom:16, lineHeight:1.5 }}>{current.sub}</div>
            )}
            {(current.subs || []).map((sub) => (
              <div key={sub.id} style={{ marginBottom:18 }}>
                <div style={{ fontSize:12, fontWeight:700, color:T.txt2, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>{sub.title}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {sub.opts.map((opt, i) => {
                    const sel = answers[sub.id] === opt.v;
                    // 4-option rows (politics) wrap to 2x2; others stay 1 row
                    const minWidth = sub.opts.length >= 4 ? "calc(50% - 3px)" : "0";
                    return (
                      <button
                        key={i}
                        onClick={() => set(sub.id, opt.v)}
                        style={{ flex:"1 1 0", minWidth, padding:"10px 8px", borderRadius:10, border:`1.5px solid ${sel ? T.accent : T.border}`, background: sel ? T.accentBg : T.bg2, color: sel ? T.accent2 : T.txt, fontSize:12, fontWeight: sel ? 700 : 500, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}
                      >
                        {opt.icon && opt.icon !== "dem" && opt.icon !== "rep" && (
                          <i className={`ti ${opt.icon}`} style={{ fontSize:14 }} aria-hidden="true" />
                        )}
                        <span>{opt.l}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {/* Phase 5.ah: importance-grid — N categories, each with a 1-5
            compact pill row. Reuses the tri-single look-and-feel but for
            importance (not stance). All rows on one screen for speed. */}
        {current?.type === "importance-grid" && (
          <>
            <div style={{ fontSize:17, fontWeight:600, color:T.txt, marginBottom:6, lineHeight:1.4 }}>{current.q}</div>
            <div style={{ fontSize:12, color:T.txt3, marginBottom:18 }}>1 = not at all · 5 = critical</div>
            {(current.rows || []).map(row => {
              const v = answers[row.id];
              return (
                <div key={row.id} style={{ marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                  <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:6 }}>
                    {row.icon && <i className={`ti ${row.icon}`} style={{ fontSize:14, color:T.txt3, flexShrink:0 }} aria-hidden="true" />}
                    <span style={{ fontSize:13, color:T.txt, fontWeight:500 }}>{row.label}</span>
                  </div>
                  <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                    {[1,2,3,4,5].map(n => {
                      const sel = v === n;
                      return (
                        <button
                          key={n}
                          onClick={() => set(row.id, n)}
                          style={{ width:34, height:34, borderRadius:8, border:`1.5px solid ${sel ? T.accent : T.border}`, background: sel ? T.accent : T.bg2, color: sel ? "#fff" : T.txt3, fontSize:13, fontWeight:700, cursor:"pointer" }}
                        >{n}</button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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

      <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"12px 16px", paddingBottom:"calc(12px + env(safe-area-inset-bottom, 0px))", borderTop:`1px solid ${T.border}`, background:T.bg, flexShrink:0 }}>
        <div style={{ display:"flex", gap:10 }}>
          {step > 0 && <button onClick={()=>setStep(s=>s-1)} style={{ padding:"11px 16px", borderRadius:12, border:`1px solid ${T.border}`, background:T.bg3, color:T.txt2, fontSize:14, fontWeight:600, cursor:"pointer" }}>←</button>}
          <button onClick={advance} disabled={!canAdvance}
            style={{ flex:1, padding:13, borderRadius:12, border:"none", background:canAdvance?T.accent:T.bg3, color:canAdvance?"#fff":T.txt3, fontSize:15, fontWeight:700, cursor:canAdvance?"pointer":"default", opacity:canAdvance?1:0.4 }}>
            {isWelcome ? "Let's go →" : isLast ? "See my scores →" : "Next →"}
          </button>
        </div>
        {/* Phase 5.z: Skip lives in the Quiz footer so it's always reachable
            and doesn't extend the page below the viewport (the old bug). */}
        {onSkip && (
          <button onClick={onSkip} style={{ width:"100%", padding:9, borderRadius:10, border:"none", background:"transparent", color:T.txt3, fontSize:12, cursor:"pointer" }}>
            Skip — see baseline scores. You can take the quiz anytime from Account.
          </button>
        )}
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
    track("submit_company", { type, category: cat, companyName: company.trim() });
    // Phase 5.as r2: actually deliver the submission (was being dropped).
    // /api/submit is a Vercel edge function that emails Aron@trunorth.com
    // via Resend (with a console-log fallback if Resend isn't configured).
    // Non-blocking — UI confirms regardless of API success so the user is
    // never penalized for our infra hiccups.
    try {
      const storedEmail = (typeof localStorage !== "undefined" && localStorage.getItem("tn_email")) || "";
      fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          category: cat,
          company:  company.trim(),
          detail:   detail.trim(),
          source:   source.trim(),
          email:    storedEmail,
        }),
      }).catch(() => {});
    } catch {}
    setSent(true); setCompany(""); setDetail(""); setSource("");
    setTimeout(() => setSent(false), 4000);
  };

  // Phase 5.as (QA friction #5): fontSize ≥16 prevents iOS/Android focus-zoom.
  const inp = { width:"100%", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:8, color:T.txt, fontSize:16, padding:"11px 13px", marginBottom:14 };
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
  // Phase 5.au: themed alert/confirm/prompt — replaces native browser dialogs
  // that render as "trunorthapp.com says:" scam popups on Android Chrome.
  const { confirm } = useConfirm();
  const { prompt:themedPrompt } = usePrompt();
  const { alert:themedAlert } = useAlert();

  // Dev-only QA helper: ?skipOnboarding=1 and ?pro=1 let the simulator + Chrome
  // tests bypass onboarding without persisting state on real production users.
  const __qp = (typeof window !== "undefined") ? new URLSearchParams(window.location.search) : new URLSearchParams();
  // Phase 5.y: ?skipOnboarding=1 now works in production builds too — it's
  // useful for QA/simulator testing and for sharing direct-to-content links
  // where forcing onboarding hurts the experience. The flag only sets a
  // localStorage marker, no security implication (it doesn't grant any access).
  if (__qp.has("skipOnboarding")) {
    try { localStorage.setItem("tn_hasOnboarded", "1"); } catch {}
  }
  // Phase 5.z: deep-link arrivals (/company/<slug>) skip onboarding too. A
  // first-time visitor who taps a shared company link expects to LAND on
  // that company, not be forced through a 3-slide intro that loses the
  // target. Onboarding still surfaces from the homepage on first visit.
  if (typeof window !== "undefined" && /^\/company\//.test(window.location.pathname)) {
    try { localStorage.setItem("tn_hasOnboarded", "1"); } catch {}
  }
  const hasOnboarded = localStorage.getItem("tn_hasOnboarded");

  // Phase 5.au: stamp install timestamp on first ever launch (powers the
  // Day-7 reflection card in the Search tab). Idempotent — only sets once.
  try {
    if (!localStorage.getItem("tn_installedAt")) {
      localStorage.setItem("tn_installedAt", String(Date.now()));
    }
  } catch {}

  // ─── Marketing landing gate ─────────────────────────────────────────────
  // Phase 5.av: The user decided to direct ALL web visitors to download the
  // iOS app rather than offer the web app as a primary surface. Strategy:
  //   - Root URL (www.trunorthapp.com) → MarketingLanding ALWAYS (no shortcut)
  //   - Deep-link path (/company/<slug>, /c/<slug>) → web app (so share
  //     links still work)
  //   - Any query string (?slug=, ?skipOnboarding, ?tab=) → web app
  //   - Hash #privacy → standalone PrivacyPolicy
  //
  // Migration note: any legacy tn_skipMarketing flag is intentionally
  // IGNORED now so previous visitors who clicked the old "Try the Web App"
  // button see the new landing on next visit (and won't be lost in the SPA).
  const __pathname = (typeof window !== "undefined") ? window.location.pathname : "/";
  const __hash     = (typeof window !== "undefined") ? window.location.hash     : "";
  const __search   = (typeof window !== "undefined") ? window.location.search   : "";
  const __isRoot   = __pathname === "/" || __pathname === "";
  const __hasDeepLink = /^\/(company|c)\//.test(__pathname);
  // Phase 5.ax: detect Capacitor native shell with MULTIPLE signals — relying
  // only on window.Capacitor.isNativePlatform() failed in build 12 because
  // the bridge sometimes isn't initialized before React's first render.
  // We check ALL of these and return true if ANY succeed:
  //   1. window.Capacitor.isNativePlatform() — the official API
  //   2. URL protocol capacitor:// or ionic:// — set by Capacitor iOS shell
  //   3. URL hostname "localhost" with iOS UA (Capacitor's default config)
  //   4. window.webkit.messageHandlers — WKWebView native bridge
  //   5. presence of cordova/Capacitor globals
  const __isCapacitorNative = (() => {
    if (typeof window === "undefined") return false;
    try {
      const cap = window.Capacitor;
      if (cap?.isNativePlatform?.()) return true;
      if (cap?.platform && cap.platform !== "web") return true;
      const loc = window.location || {};
      if (loc.protocol === "capacitor:" || loc.protocol === "ionic:") return true;
      const ua = (navigator?.userAgent || "").toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(ua);
      if (isIOS && (loc.hostname === "localhost" || loc.protocol === "file:")) return true;
      // WKWebView native bridge — present on iOS Capacitor apps
      if (window.webkit?.messageHandlers?.bridge) return true;
      // Cordova-style globals (Capacitor still respects these)
      if (window.cordova || window._cordovaNative) return true;
      return false;
    } catch { return false; }
  })();
  // Clean up stale flag from the previous flow if present.
  try { localStorage.removeItem("tn_skipMarketing"); } catch {}
  const [marketingScreen, setMarketingScreen] = useState(() => {
    if (__hash.replace(/^#/, "") === "privacy") return "privacy";
    // Native shell ALWAYS goes to the app — no marketing landing on iOS.
    if (__isCapacitorNative) return "app";
    if (__isRoot && !__hasDeepLink && !__search) return "landing";
    return "app";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (h === "privacy") setMarketingScreen("privacy");
      else if (marketingScreen === "privacy") {
        // Same rule: native always to app, web back to landing or app based on URL
        if (__isCapacitorNative) setMarketingScreen("app");
        else setMarketingScreen(__isRoot && !__hasDeepLink && !__search ? "landing" : "app");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [marketingScreen, __isRoot, __hasDeepLink, __search, __isCapacitorNative]);

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
  // Phase 5.ag (perf): use React 18 useDeferredValue instead of a manual
  // 150ms setTimeout debounce. useDeferredValue keeps the input itself at
  // high render priority while the heavy filter+map of 11k items happens
  // at transition priority — yields to keystrokes so typing feels instant
  // even on slower devices. The 150ms debounce was a fixed delay regardless
  // of device speed; deferred adapts.
  const [queryRaw, setQueryRaw] = useState("");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const query = React.useDeferredValue(queryRaw);
  // Legacy setQuery shim — used by recent-search and trending button clicks
  // that want to set both the input and the filter immediately. With
  // deferred, just calling setQueryRaw is enough (query catches up on next
  // tick). Kept as a thin alias so existing call sites don't need to change.
  const setQuery = setQueryRaw;

  // Phase 5.as (QA fleet bug #5): wire the MiniSearch fuzzy index into the
  // search filter. The index is already loaded into every bundle but Search
  // was using naive .includes() — unlocks typo tolerance ("amazn" → Amazon),
  // prefix matching, and ranked relevance for FREE (the asset is already
  // paid for in the bundle).
  const [searchIndex, setSearchIndex] = useState(null);
  useEffect(() => {
    if (!isSplitBundleEnabled()) return;
    let cancelled = false;
    // Defer the index load by 800ms so first-paint isn't slowed
    const t = setTimeout(() => {
      loadSearchIndex()
        .then(ix => { if (!cancelled) setSearchIndex(ix); })
        .catch(err => console.warn("[search-index] load failed:", err));
    }, 800);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  // Resolve query → Set<slug> of MiniSearch hits. Memo so the filter
  // chain just does a Set.has() check per company instead of re-searching.
  const searchHits = useMemo(() => {
    const q = (query || "").trim();
    if (!q || !searchIndex) return null;
    try {
      const results = searchIndex.search(q, { boost: { name: 2 }, prefix: true, fuzzy: 0.2 });
      return new Set(results.map(r => r.slug || r.id));
    } catch (err) {
      console.warn("[search-index] search failed:", err);
      return null;
    }
  }, [query, searchIndex]);

  // Phase 5.aj: switched to immediate-paywall; the free-quota state is gone.
  // Clean up the orphaned localStorage key for users who hit the old code.
  useEffect(() => {
    try { localStorage.removeItem("tn_freeViewed"); } catch {}
  }, []);
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
  // Phase 5.ak (item #6): industryBucket filter — set when user taps a
  // Browse-tab category tile. Stricter than the loose name-match the
  // search input does (so "Airline" doesn't pull in companies whose
  // name happens to contain the word).
  const [industryBucket, setIndustryBucket] = useState(null);

  // Phase 5.ah: in-app weekly digest. Fetched once per session; gracefully
  // null when the file isn't there yet (early days / dev). Cron rebuilds
  // it every Sunday via the weekly workflow.
  const [weeklyChanges, setWeeklyChanges] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/weekly_changes.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setWeeklyChanges(d); })
      .catch(() => { /* file just doesn't exist yet — fine */ });
    return () => { cancelled = true; };
  }, []);

  // Phase 5.au: editorial.json — hand-curated weekly Brand-of-the-Day
  // rotation. Falls back to algorithmic pool if no story matches today.
  const [editorial, setEditorial] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/editorial.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setEditorial(d); })
      .catch(() => { /* missing = silently fall back to algorithmic pool */ });
    return () => { cancelled = true; };
  }, []);

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
  // Phase 5.aj: when scanner matches OR Better-Alts taps a brand, we want
  // the search to show JUST that one company — not a list of name-matches.
  // focusedSlug overrides the filter chain entirely and pops a "Clear ×"
  // banner so the user can return to normal search.
  const [focusedSlug, setFocusedSlug] = useState(null);
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
    // Phase 5.ag (QA fix #4): clear after a beat so the CompanyCard has time
    // to mount and consume initiallyOpen, but stale-auto-open on later tab
    // returns doesn't happen.
    const t = setTimeout(() => setDeepLinkSlug(null), 800);
    return () => clearTimeout(t);
  }, [deepLinkSlug, companies]);

  // UX 1A: memoize the dedupe/filter/sort chain so it doesn't rerun on unrelated state changes
  const deduped = useMemo(
    () => (companies || []).filter((c,i,a) => a.findIndex(x=>x.name===c.name)===i),
    [companies]
  );

  const filtered = useMemo(() => {
    // Phase 5.aj: focusedSlug bypasses the whole filter chain. Used when the
    // scanner matches a single brand or a Better-Alts row routes — we want
    // EXACTLY one company shown, never a list of similarly-named matches.
    if (focusedSlug) {
      const co = deduped.find(c => (c.slug || c.id) === focusedSlug);
      return co ? [co] : [];
    }
    return deduped
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
        // Phase 5.as: if the MiniSearch index is loaded, use its fuzzy/
        // prefix-aware hits. Falls back to naive .includes() while the
        // index is still loading so the user can search immediately.
        if (searchHits) {
          const slug = c.slug || c.id;
          if (!searchHits.has(slug)) return false;
        } else {
          const q = query.toLowerCase();
          if (!c.name.toLowerCase().includes(q) && !c.cat.toLowerCase().includes(q) && getBucket(c.cat).toLowerCase() !== q) return false;
        }
      }
      // UX 7A: saved-only filter
      if (showSavedOnly && !savedSet.has(c.slug || c.id)) return false;
      // Phase 5.ak (item #6): industry-bucket filter — strict bucket match
      if (industryBucket && getBucket(c.cat || "") !== industryBucket) return false;
      return true;
    })
    .sort((a,b) => {
      if (sort==="score") return computeScore(b,profile) - computeScore(a,profile);
      if (sort==="name") return a.name.localeCompare(b.name);
      const o={left:0,"left-leaning":1,bipartisan:2,mixed:3,neutral:4,right:6,"right-leaning":6};
      return (o[(a.sc.political||"").toLowerCase()]??5) - (o[(b.sc.political||"").toLowerCase()]??5);
    });
  },
    [deduped, leanFilter, catFilters, flagFilters, query, searchHits, sort, profile, showSavedOnly, savedSet, focusedSlug, industryBucket]
  );

  // Phase 5.ag (perf): cap rendered company cards. Creating 11,000+ JSX
  // elements on every keystroke (even with memo'd cards) blows out the
  // render budget. Show the first N matches and a "Show more" button.
  const VISIBLE_BATCH = 200;
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_BATCH);
  useEffect(() => { setVisibleLimit(VISIBLE_BATCH); }, [query, leanFilter, catFilters, flagFilters, sort, showSavedOnly, industryBucket]);
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);

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

  // Phase 5.as (#12 + #13): memoize Top Picks ranking + cap visible cards.
  // The previous in-render sort over 11K companies was the source of the
  // multi-second delay when entering the Top tab. Memo invalidates only
  // on profile / deduped change. topPicksLimit lets the user "Show more"
  // without re-blowing the budget on every screen visit.
  const topPicksRanked = useMemo(
    () => [...deduped]
      .map(c => ({ co: c, score: computeScore(c, profile) }))
      .sort((a, b) => b.score - a.score)
      .map(({ co }) => co),
    [deduped, profile]
  );
  const [topPicksLimit, setTopPicksLimit] = useState(50);

  // Phase 5.ak (item #6): filter junk categories from the Browse grid.
  // "Other", "Various", "NA", "Uncategorized", null, and tiny categories
  // with fewer than 3 companies aren't worth a tile.
  const cats = useMemo(() => {
    const JUNK = new Set(["other","various","na","n/a","uncategorized","unknown","misc","miscellaneous",""]);
    const counts = {};
    for (const c of deduped) {
      const b = getBucket(c.cat || "");
      counts[b] = (counts[b] || 0) + 1;
    }
    return Object.entries(counts)
      .filter(([b, n]) => b && !JUNK.has(b.toLowerCase()) && n >= 3)
      .map(([b]) => b)
      .sort();
  }, [deduped]);

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

  // Phase 5.am: combined "library" tab replacing the separate History tab.
  // User asked to surface Favorites prominently (was buried in Account)
  // + couldn't find the History tab. Library is one tab with two sub-tabs
  // (Saved | History) — both made first-class without crowding the bottom
  // nav past 5 slots. Sources still reachable via Account → Data Sources.
  const TABS = ["search","browse","top","library","account"];
  const TAB_LABELS = {search:"Search",browse:"Browse",top:"Top picks",library:"Library",account:"Account"};
  // Which sub-tab is active inside Library. Defaults to "saved".
  const [librarySubtab, setLibrarySubtab] = useState("saved");
  // Phase 5.as (QA friction #6): saved sort + category filter
  const [savedSortMode, setSavedSortMode] = useState("recent");
  const [savedCategoryFilter, setSavedCategoryFilter] = useState("all");



  // ─── Marketing / privacy early-returns ──────────────────────────────────
  // These run AFTER every hook above, so React's rules-of-hooks stay happy.
  if (marketingScreen === "privacy") {
    return <PrivacyPolicy onBack={() => {
      try { window.location.hash = ""; } catch {}
      setMarketingScreen(__skipMarketing || !__isRoot ? "app" : "landing");
    }} />;
  }
  if (marketingScreen === "landing") {
    // Phase 5.av: no onEnterApp — landing is iOS-download-driven only.
    return <MarketingLanding
      onOpenPrivacy={() => {
        try { window.location.hash = "#privacy"; } catch {}
        setMarketingScreen("privacy");
      }}
    />;
  }

  if (screen === "splash") {
  return <SplashScreen onDone={() => setScreen(hasOnboarded ? "main" : "onboarding")} />;
}

if (screen === "onboarding") {
  return (
    <OnboardingFlow
      onComplete={(user) => {
        setCurrentUser(user);
        // Phase 5.ag (item A): quiz is now the default first-run experience.
        // Previously onboarding routed straight to "main", leaving the
        // personalized values quiz (TruNorth's differentiating mechanic)
        // discoverable only via 4 buried entry points. Most users never
        // found it — meaning most users never saw personalized grades —
        // meaning the moat was invisible by default. Now: new users land
        // in the quiz immediately, see their personalized "top match"
        // celebration, then enter the main app.
        track("quiz_started", { from: "onboarding_rail" });
        setScreen("quiz");
      }}
    />
  );
}
  if (screen === "reveal") {
    // Phase 5.ag (item C): Quiz completion celebration.
    //
    // The user just finished the quiz (peak emotional investment moment).
    // We compute their top-3 best-matched companies from the bundle by
    // applying the new profile to every entry's computeScore, sort by
    // personalized score, and surface the winner as the "aha" moment.
    //
    // Why a dedicated screen instead of a toast: per the stickiness audit,
    // peak emotion is the highest-converting share/CTA moment in the entire
    // funnel. Dumping the user straight into the search list (the old
    // behavior) wasted the moment. Wave 3 will add a "share my values"
    // PNG card on this screen.
    const top3 = (companies || [])
      .filter(c => {
        // Only consider companies with at least one scored category — exclude
        // unknown-only entries so the reveal feels substantive.
        const sc = c.sc || {};
        return Object.keys(sc).some(k => sc[k] && String(sc[k]).toLowerCase() !== "neutral" && String(sc[k]).toLowerCase() !== "unknown");
      })
      .map(c => ({ co: c, score: computeScore(c, profile) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const winner = top3[0];
    return (
      <div style={{ height:"100dvh", maxWidth:430, margin:"0 auto", display:"flex", flexDirection:"column", overflow:"hidden", background:T.bg, paddingTop:"env(safe-area-inset-top,0px)" }}>
        <div style={{ flex:1, overflowY:"auto", padding:"32px 20px 12px", display:"flex", flexDirection:"column", alignItems:"center", boxSizing:"border-box", width:"100%" }}>
          <div style={{ width:64, height:64, borderRadius:"50%", background:T.accentBg, border:`2px solid ${T.accent}`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16 }}>
            <i className="ti ti-sparkles" style={{ fontSize:28, color:T.accent2 }} aria-hidden="true" />
          </div>
          {/* Phase 5.au: Values Fingerprint card — the #1 stickiness play.
              Coined identity ("The Climate Pragmatist") derived from quiz
              weights, with a 4-letter shareable codename and a 1-sentence
              blurb. Pinned to Account; resurfaced every 14 days. */}
          {(() => {
            const fp = computeFingerprint(profile);
            if (!fp) return null;
            return (
              <div style={{ width:"100%", maxWidth:340, marginBottom:18, padding:"16px 18px", background:T.accentBg, border:`1.5px solid ${T.accent}`, borderRadius:16, textAlign:"center" }}>
                <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>
                  Your values archetype
                </div>
                <div style={{ fontSize:22, fontWeight:800, color:T.txt, lineHeight:1.2, marginBottom:4 }}>{fp.name}</div>
                <div style={{ fontSize:11, color:T.accent2, fontFamily:"ui-monospace, Menlo, monospace", letterSpacing:1.5, marginBottom:10 }}>{fp.codename}</div>
                <div style={{ fontSize:12.5, color:T.txt2, lineHeight:1.5 }}>{fp.blurb}</div>
              </div>
            );
          })()}
          <div style={{ fontSize:22, fontWeight:700, color:T.txt, textAlign:"center", marginBottom:6, maxWidth:340, width:"100%", paddingLeft:8, paddingRight:8, boxSizing:"border-box" }}>Your values are set.</div>
          {/* 2026-06-01 fix: was maxWidth:"100%" which inherited parent width
              and let the italic "you" overflow past the viewport on narrow
              iPhones. Constrained to 340 to match the archetype card above. */}
          <div style={{ fontSize:14, color:T.txt2, textAlign:"center", marginBottom:24, lineHeight:1.4, maxWidth:340, width:"100%", paddingLeft:8, paddingRight:8, boxSizing:"border-box" }}>
            Every grade you see is now tailored to <em style={{ color:T.accent2, fontStyle:"normal", fontWeight:600 }}>you</em>.
          </div>
          {winner && (
            <>
              <div style={{ fontSize:11, color:T.txt3, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Your top match</div>
              <div
                onClick={() => { setDeepLinkSlug(winner.co.slug || winner.co.id); setScreen("main"); }}
                style={{ width:"100%", maxWidth:340, background:T.bg2, border:`2px solid ${T.accent}`, borderRadius:16, padding:18, cursor:"pointer", display:"flex", alignItems:"center", gap:14, marginBottom:14 }}
              >
                <CompanyLogo company={winner.co} size={48} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:700, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{winner.co.name}</div>
                  <div style={{ fontSize:12, color:T.txt3, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{winner.co.cat}</div>
                </div>
                {/* Phase 5.ag QA fix #5: badge color matches the actual
                    grade, not always green. With sparse-data profiles the
                    winner could legitimately be a B or C — don't lie. */}
                {(() => {
                  const wg = scoreGrade(winner.score);
                  const palette = {
                    A: { bg:"#0d2318", border:"#1e3e2e", text:"#4caf82" },
                    B: { bg:"#1a2810", border:"#2e3e1e", text:"#8bc34a" },
                    C: { bg:"#2a2210", border:"#3e321e", text:"#f0a030" },
                    D: { bg:"#2a1810", border:"#3e2818", text:"#ff7043" },
                    F: { bg:"#2a0d0d", border:"#3e1e1e", text:"#e24a4a" },
                  }[wg] || { bg:T.bg3, border:T.border2, text:T.txt3 };
                  return (
                    <div style={{ width:44, height:44, borderRadius:10, background:palette.bg, border:`1px solid ${palette.border}`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <div style={{ fontSize:18, fontWeight:700, color:palette.text, lineHeight:1 }}>{wg}</div>
                      <div style={{ fontSize:9, color:palette.text, opacity:0.7 }}>{winner.score}</div>
                    </div>
                  );
                })()}
              </div>
              {top3.length > 1 && (
                <>
                  <div style={{ fontSize:11, color:T.txt3, marginBottom:6 }}>Runners-up</div>
                  <div style={{ width:"100%", maxWidth:340, display:"flex", flexDirection:"column", gap:6 }}>
                    {top3.slice(1).map(({ co, score }) => (
                      <div
                        key={co.slug || co.id}
                        onClick={() => { setDeepLinkSlug(co.slug || co.id); setScreen("main"); }}
                        style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}
                      >
                        <CompanyLogo company={co} size={28} />
                        <div style={{ flex:1, minWidth:0, fontSize:13, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.name}</div>
                        <div style={{ fontSize:13, fontWeight:700, color:"#8bc34a" }}>{scoreGrade(score)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <div style={{ padding:"12px 16px calc(20px + env(safe-area-inset-bottom, 0px))", borderTop:`1px solid ${T.border}`, background:T.bg, display:"flex", flexDirection:"column", gap:8 }}>
          {/* Phase 5.ag (item C cont'd, growth-loop unlock): "Share my values"
              button at peak emotion. Generates a URL pointing at the OG-image
              endpoint with the user's profile encoded — friend who opens the
              link sees the user's values fingerprint as a rich preview, then
              lands on the quiz with utm_source=share_card. */}
          <button
            onClick={async () => {
              if (!profile) return;
              const qp = new URLSearchParams({
                p:   profile.lean         || "neutral",
                d:   profile.deiLean      || "neutral",
                a:   profile.animalTesting || "neutral",
                g:   profile.guns         || "neutral",
                env: String(profile.weights?.environment || 3),
                lab: String(profile.weights?.labor       || 3),
                pri: String(profile.weights?.privacy     || 3),
                exp: String(profile.weights?.execPay     || 3),
                cha: String(profile.weights?.charity     || 3),
                ...(winner?.co?.name ? { top: winner.co.name } : {}),
              });
              // Stable per-device sharer hash so we can attribute K-factor
              let fromHash = "";
              try {
                const stable = localStorage.getItem("tn_user_hash") || Math.random().toString(36).slice(2, 10);
                localStorage.setItem("tn_user_hash", stable);
                fromHash = stable;
              } catch {}
              // Bundle profile params + UTM into a single query string. Both
              // are needed: profile params drive the dynamic og:image via
              // middleware (so the rich preview shows the user's actual
              // values card); UTM drives attribution in PostHog.
              const combined = new URLSearchParams(qp);
              combined.set("utm_source",   "share");
              combined.set("utm_medium",   "share_card");
              combined.set("utm_campaign", "values_fingerprint");
              if (fromHash) combined.set("from", fromHash);
              const shareUrl = `https://www.trunorthapp.com/?${combined.toString()}`;
              const shareData = {
                title: "My TruNorth values",
                text:  "I just mapped out what I care about as a shopper — see yours in 60 seconds.",
                url:   shareUrl,
              };
              let method = "unknown";
              try {
                if (navigator.share && navigator.canShare?.(shareData) !== false) {
                  await navigator.share(shareData);
                  method = "native_share";
                } else if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(shareUrl);
                  method = "clipboard";
                }
              } catch (err) {
                if (err?.name !== "AbortError") console.error("share failed:", err);
                method = err?.name === "AbortError" ? "user-cancelled" : "error";
              }
              track("values_card_shared", { method, top: winner?.co?.slug || winner?.co?.id || null });
              // (For the curious: the OG image actually previewed by social
              // platforms is /api/og/values?<qp> — we don't push it in the
              // share intent because Web Share API only supports url+text.
              // The destination page sets the og:image meta dynamically.)
              console.info("[share] og image url:", `/api/og/values?${qp.toString()}`);
            }}
            style={{ width:"100%", padding:14, borderRadius:12, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
          >
            <i className="ti ti-share" aria-hidden="true" /> Share my values
          </button>
          <button
            onClick={() => setScreen("main")}
            style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.accent2, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer" }}
          >
            Explore all 11,000+ brands →
          </button>
        </div>
      </div>
    );
  }

  if (screen === "quiz") {
    // UX 4A: quiz is now open to all users. Free users complete it and get
    // personalized letter grades; Pro users get personalized number scores
    // + breakdowns + sources. The Pro upsell moves downstream to those features.
    // Phase 5.z: parent owns 100dvh so Quiz's inner scroll can pin its footer
    // and scroll the rest. The "Skip" button moved INTO Quiz (welcome screen)
    // so the Quiz fully fills the viewport.
    return (
      <div style={{ height:"100dvh", maxWidth:430, margin:"0 auto", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {showPaywall && <PaywallScreen
          initialEmail={currentUser?.email||""}
          onSubscribe={(paidEmail)=>{
            setIsPaid(true);
            // Phase 5.as (#11): when sign-in was killed from onboarding, the
            // paywall became the only place we collect email. Persist it
            // to tn_user so Account screen auto-populates without the user
            // having to re-enter it.
            if (paidEmail) {
              const updated = { ...(currentUser || {}), email: paidEmail };
              try { localStorage.setItem("tn_user", JSON.stringify(updated)); } catch {}
              setCurrentUser(updated);
            }
            setShowPaywall(false);
            window.scrollTo(0,0);
            setScreen("main");
          }}
          onClose={()=>{
            // Phase 5.as r2: cooldown timestamp — stops paywall from re-firing
            // on every subsequent tap until 4h have passed.
            try { sessionStorage.setItem("tn_paywallDismissedAt", String(Date.now())); } catch {}
            setShowPaywall(false);
            setScreen("main");
          }}
        />}
        <Quiz
          onComplete={(p) => {
            setProfile(p);
            // Phase 5.au: mint the Values Fingerprint at quiz completion.
            // Pure derivation from quiz weights — no PII, deterministic,
            // safe to share. Becomes the user's "identity card" — pinned to
            // Account, shown on the share PNG, resurfaces every 14 days
            // ("Still feel right? [Re-take]").
            const fp = computeFingerprint(p);
            persistFingerprint(fp);
            track("quiz_completed", { isPaid, archetype: fp?.id, codename: fp?.codename });
            setScreen("reveal");
          }}
          onSkip={() => setScreen("main")}
        />
      </div>
    );
  }

  return (
    <div style={{ height:"100%", width:"100%", maxWidth:430, margin:"0 auto", background:T.bg2, display:"flex", flexDirection:"column" }}>
      {showPaywall && <PaywallScreen initialEmail={currentUser?.email||""} onSubscribe={(paidEmail)=>{
        setIsPaid(true);
        // Phase 5.as (#11): persist paywall email to Account.
        if (paidEmail) {
          const updated = { ...(currentUser || {}), email: paidEmail };
          try { localStorage.setItem("tn_user", JSON.stringify(updated)); } catch {}
          setCurrentUser(updated);
        }
        setShowPaywall(false);
        window.scrollTo(0,0);
        // Phase 5.y: don't force a quiz retake if the user already personalized.
        // Previously this always sent them back to step 0 of the 9-question quiz,
        // wiping the experience they just paid for.
        if (!profile) setScreen("quiz");
      }} onClose={()=>{
        try { sessionStorage.setItem("tn_paywallDismissedAt", String(Date.now())); } catch {}
        setShowPaywall(false);
      }} />}
      {/* UX 7B: barcode scanner overlay — opens camera, decodes, routes to match */}
      {showScanner && (
        <BarcodeScanner
          companies={companies || []}
          onClose={() => setShowScanner(false)}
          onMatch={(co, meta) => {
            setShowScanner(false);
            track("scanner_match", { slug: co.slug || co.id, name: co.name, barcode: meta?.barcode });
            // Phase 5.aj: focus on exactly that one company — no list.
            // Clear other filters so the focused view isn't double-restricted.
            setQueryRaw("");
            setQuery("");
            setLeanFilter("all");
            setCatFilters([]);
            setFlagFilters([]);
            setShowSavedOnly(false);
            setTab("search");
            setFocusedSlug(co.slug || co.id);
            setDeepLinkSlug(co.slug || co.id);
          }}
        />
      )}
      <WhatsNewModal companyCount={companies?.length || 11000} />

      {/* UX 8B: aria-live region for screen readers — announces filtered count
          and which tab is active without visual clutter. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {tab === "search" && (query.trim() || leanFilter !== "all" || catFilters.length > 0 || showSavedOnly)
          ? `${filtered.length} compan${filtered.length === 1 ? "y" : "ies"} match your filters`
          : `${tab} tab`}
      </div>

      {/* Header — Phase 5.y: title is true-centered now (3-column grid) so the
          Pro/Upgrade chip width on the right can't shift it off-center. */}
      <div style={{ padding:"calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px", background:T.bg, flexShrink:0, zIndex:10, borderBottom:`1px solid ${T.border}` }}>
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
          <div style={{ position:"relative" }}>
            <div style={{ background:T.bg3, borderRadius:16, padding:"0 14px", display:"flex", alignItems:"center", gap:10, border:`1px solid ${T.border}` }}>
              <i className="ti ti-search" style={{ fontSize:18, color:T.txt3 }} aria-hidden="true" />
              <label htmlFor="tn-search" className="sr-only">Search companies</label>
              <input id="tn-search" value={queryRaw} onChange={e=>{setQueryRaw(e.target.value);setTab("search");}} placeholder={`Search ${deduped.length} companies...`}
                autoComplete="off"
                onFocus={() => setShowSearchDropdown(true)}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 200)}
                style={{ background:"transparent", border:"none", color:T.txt, fontSize:16, padding:"12px 0", flex:1 }} />
              {queryRaw && <button onClick={()=>{setQueryRaw("");setQuery("");}} style={{ background:"none", border:"none", color:T.txt3, fontSize:18, cursor:"pointer", minWidth:44, minHeight:44, display:"flex", alignItems:"center", justifyContent:"center" }} aria-label="Clear search">×</button>}
              {typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia && (
                <button
                  onClick={() => { setShowScanner(true); track("scanner_open", { tab }); }}
                  aria-label="Scan barcode"
                  title="Scan a product barcode"
                  style={{ background:"none", border:"none", color:T.accent2, fontSize:20, cursor:"pointer", padding:"6px 0", minWidth:44, minHeight:44, display:"flex", alignItems:"center", justifyContent:"center" }}
                >
                  <i className="ti ti-scan" aria-hidden="true" />
                </button>
              )}
            </div>
            {/* Phase 5.au (QA round 2 #4): inline typeahead dropdown. The
                MiniSearch index was wired for filtering in Phase 5.as but the
                UX asked for a 5-row suggestion list while typing. Renders
                below the input, taps route to the brand. Closes on blur. */}
            {showSearchDropdown && queryRaw.trim().length >= 1 && searchHits && (() => {
              const suggestions = [...searchHits].slice(0, 5)
                .map(slug => deduped.find(c => (c.slug || c.id) === slug))
                .filter(Boolean);
              if (!suggestions.length) return null;
              return (
                <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, boxShadow:"0 8px 24px rgba(0,0,0,0.4)", zIndex:50, overflow:"hidden" }}>
                  {suggestions.map(co => {
                    const g = co.overall != null ? scoreGrade(co.overall) : "?";
                    const gradeColor = { A:"#4caf82", B:"#8bc34a", C:"#f0a030", D:"#ff7043", F:"#e24a4a" }[g] || T.txt3;
                    return (
                      <button
                        key={co.slug || co.id}
                        onMouseDown={(e) => { e.preventDefault(); }}
                        onClick={() => {
                          track("search_typeahead_clicked", { slug: co.slug || co.id });
                          setQueryRaw("");
                          setShowSearchDropdown(false);
                          setFocusedSlug(co.slug || co.id);
                          setDeepLinkSlug(co.slug || co.id);
                          setTab("search");
                        }}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"none", border:"none", borderBottom:`1px solid ${T.border}`, cursor:"pointer", width:"100%", textAlign:"left", minHeight:44 }}
                      >
                        <CompanyLogo company={co} size={28} />
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.name}</div>
                          <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.cat}</div>
                        </div>
                        <div style={{ fontSize:14, fontWeight:700, color: gradeColor, minWidth:20, textAlign:"center" }}>{g}</div>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
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
          <button onClick={()=>{ track("quiz_started", { from: "profile_strip_edit" }); setScreen("quiz"); }} style={{ marginLeft:"auto", fontSize:10, color:T.accent2, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Edit</button>
        </div>
      )}

      {/* SEARCH */}
      {tab === "search" && (
        <ErrorBoundary name="search">
          {/* Phase 5.au (QA #14): Day-7 reflection card. Letterboxd-style.
              On the first Search visit ≥7 days after install, surface a
              one-time dismissible card with: top 3 viewed brands from
              tn_viewHistory, dominant category, identity line from
              fingerprint. Replaces nothing — pure delight + ritual
              reinforcement. Self-suppresses after dismiss or view. */}
          {(() => {
            try {
              const dismissed = localStorage.getItem("tn_day7Seen") === "1";
              if (dismissed) return null;
              const installedAt = Number(localStorage.getItem("tn_installedAt") || 0);
              if (!installedAt) {
                // Backfill if missing — set now (resets the 7-day clock for legacy users)
                localStorage.setItem("tn_installedAt", String(Date.now()));
                return null;
              }
              const daysSince = (Date.now() - installedAt) / 86_400_000;
              if (daysSince < 7) return null;
              const history = JSON.parse(localStorage.getItem("tn_viewHistory") || "[]");
              if (history.length < 3) return null;
              const fp = getStoredFingerprint() || (profile ? computeFingerprint(profile) : null);
              // Compute dominant category from history
              const catCounts = {};
              history.forEach(h => { if (h.cat) catCounts[h.cat] = (catCounts[h.cat]||0)+1; });
              const topCat = Object.entries(catCounts).sort((a,b) => b[1]-a[1])[0];
              const topBrands = history.slice(0, 3);
              return (
                <div style={{ margin:"12px 16px", padding:"14px 16px", background:T.accentBg, border:`1.5px solid ${T.accent}`, borderRadius:14, position:"relative" }}>
                  <button
                    onClick={() => {
                      localStorage.setItem("tn_day7Seen", "1");
                      track("day7_card_dismissed");
                      // Force re-render by toggling a state — easiest: setTopPicksLimit (innocent reset)
                      setTopPicksLimit(n => n);
                    }}
                    aria-label="Dismiss"
                    style={{ position:"absolute", top:6, right:6, width:28, height:28, padding:0, borderRadius:14, border:"none", background:"transparent", color:T.txt3, fontSize:16, cursor:"pointer" }}
                  >×</button>
                  <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>Your first week on TruNorth</div>
                  <div style={{ fontSize:16, fontWeight:700, color:T.txt, marginBottom:10, lineHeight:1.3 }}>
                    {Math.floor(daysSince)} days · {history.length} brands viewed
                  </div>
                  <div style={{ fontSize:12, color:T.txt2, lineHeight:1.55, marginBottom:8 }}>
                    Most-viewed:{" "}
                    {topBrands.map((b, i) => (
                      <span key={b.slug}>
                        <button
                          onClick={() => { track("day7_brand_clicked", { slug: b.slug }); setDeepLinkSlug(b.slug); setTab("search"); }}
                          style={{ background:"none", border:"none", color:T.accent2, fontWeight:600, cursor:"pointer", padding:0, textDecoration:"underline" }}
                        >{b.name}</button>
                        {i < topBrands.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                  {topCat && (
                    <div style={{ fontSize:12, color:T.txt3, lineHeight:1.5 }}>
                      You've been shopping <strong style={{color:T.txt}}>{topCat[0]}</strong> the most ({topCat[1]} views).
                      {fp && <> Aligns with <strong style={{color:T.accent2}}>{fp.name}</strong>.</>}
                    </div>
                  )}
                </div>
              );
            } catch { return null; }
          })()}
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

          {/* Phase 5.aj: paywall now fires immediately on every non-paid
              tap, so the banner is a single clear upsell instead of a
              quota counter. */}
          {!isPaid && (
            <div onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ margin:"10px 16px 0", padding:"10px 14px", background:T.goldBg, border:`1px solid ${T.gold}`, borderRadius:12, cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
              <i className="ti ti-crown" style={{ fontSize:18, color:T.gold, flexShrink:0 }} aria-hidden="true" />
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:T.gold }}>Unlock personalized scores</div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>Pro · $1.99/mo · narratives, sources & full profiles</div>
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
              <>
                {focusedSlug && (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:8, marginBottom:8 }}>
                    <span style={{ fontSize:12, color:T.accent2 }}>
                      <i className="ti ti-target" aria-hidden="true" style={{ marginRight:6 }} /> Showing 1 brand
                    </span>
                    <button onClick={() => { setFocusedSlug(null); track("focused_cleared"); }} style={{ background:"none", border:"none", color:T.accent2, fontSize:12, cursor:"pointer", padding:0 }}>
                      ✕ Clear
                    </button>
                  </div>
                )}
                {industryBucket && (
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:8, marginBottom:8 }}>
                    <span style={{ fontSize:12, color:T.accent2 }}>
                      <i className="ti ti-category" aria-hidden="true" style={{ marginRight:6 }} /> {industryBucket} · {filtered.length} {filtered.length === 1 ? "brand" : "brands"}
                    </span>
                    <button onClick={() => { setIndustryBucket(null); track("industry_cleared"); }} style={{ background:"none", border:"none", color:T.accent2, fontSize:12, cursor:"pointer", padding:0 }}>
                      ✕ Clear
                    </button>
                  </div>
                )}
                {visibleFiltered.map(co => <CompanyCard key={co.id} company={co} catFilter={catFilters.length===1?catFilters[0]:"all"} profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} onNavigate={(slug) => { setFocusedSlug(slug); setDeepLinkSlug(slug); setTab("search"); }} initiallyOpen={deepLinkSlug && (co.slug || co.id) === deepLinkSlug} />)}
                {filtered.length > visibleLimit && (
                  <button
                    onClick={() => { setVisibleLimit(n => n + VISIBLE_BATCH); track("show_more", { from: visibleLimit, total: filtered.length }); }}
                    style={{ marginTop:8, padding:14, borderRadius:12, background:T.bg3, border:`1px solid ${T.border}`, color:T.txt2, fontSize:13, fontWeight:600, cursor:"pointer", width:"100%" }}
                  >
                    Show more · {filtered.length - visibleLimit} remaining
                  </button>
                )}
              </>
            )}
          </div>
        </ErrorBoundary>
      )}

      {/* BROWSE */}
      {tab === "browse" && (
        <ErrorBoundary name="browse">{(() => {
          // Phase 5.al (item #7): 3 Browse layouts behind ?browse= URL toggle
          //   ?browse=v1     (default) — original tile grid (current)
          //   ?browse=alt-a  — list with featured-brand chips per category
          //   ?browse=alt-b  — search-first + horizontal category chips
          //   ?browse=alt-c  — curated editorial collections
          // Cached in localStorage so navigation preserves the choice.
          const browseVariant = (() => {
            if (typeof window === "undefined") return "v1";
            try {
              const qs = new URLSearchParams(window.location.search).get("browse");
              if (qs && ["v1","alt-a","alt-b","alt-c"].includes(qs)) {
                localStorage.setItem("tn_browseVariant", qs);
                return qs;
              }
              return localStorage.getItem("tn_browseVariant") || "v1";
            } catch { return "v1"; }
          })();

          // Helper: top-N brands in a bucket, sorted by overall score desc
          const topBrandsIn = (cat, n = 3) => deduped
            .filter(c => getBucket(c.cat) === cat)
            .sort((a, b) => (b.overall || 0) - (a.overall || 0))
            .slice(0, n);

          const openBucket = (cat, count) => {
            setIndustryBucket(cat); setQueryRaw(""); setQuery("");
            setTab("search"); track("browse_category_open", { bucket: cat, count, variant: browseVariant });
          };

          // ── ALT-A: List view with featured brands per category ────────────
          if (browseVariant === "alt-a") {
            return (
              <div style={{ padding:"8px 0 80px" }}>
                {cats.map((cat, i) => {
                  const icon = Object.entries(catIconMap).find(([k])=>cat.includes(k))?.[1]||"ti-briefcase";
                  const count = deduped.filter(c=>getBucket(c.cat)===cat).length;
                  const featured = topBrandsIn(cat, 4);
                  return (
                    <div key={cat} onClick={() => openBucket(cat, count)}
                      style={{ background:T.bg2, borderTop:`1px solid ${T.border}`, padding:"14px 16px", cursor:"pointer" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:8 }}>
                        <div style={{ width:36, height:36, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", background:catBgs[i%catBgs.length], flexShrink:0 }}>
                          <i className={`ti ${icon}`} style={{ fontSize:18, color:catFgs[i%catFgs.length] }} aria-hidden="true" />
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:15, fontWeight:600, color:T.txt }}>{cat}</div>
                          <div style={{ fontSize:11, color:T.txt3, marginTop:1 }}>{count} {count === 1 ? "brand" : "brands"}</div>
                        </div>
                        <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
                      </div>
                      {featured.length > 0 && (
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingLeft:48 }}>
                          {featured.map(f => (
                            <span key={f.slug || f.id} style={{ fontSize:11, padding:"3px 8px", borderRadius:12, background:T.bg3, color:T.txt2, border:`1px solid ${T.border2}` }}>
                              {f.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          }

          // ── ALT-B: Search-first + horizontal scrolling category chips ────
          if (browseVariant === "alt-b") {
            return (
              <div style={{ padding:"16px 0 80px" }}>
                <div style={{ padding:"0 16px 18px" }}>
                  <div style={{ fontSize:22, fontWeight:700, color:T.txt, lineHeight:1.2, marginBottom:6 }}>Find a brand or browse</div>
                  <div style={{ fontSize:13, color:T.txt3, marginBottom:14 }}>{deduped.length.toLocaleString()} companies scored</div>
                  <button onClick={()=>setTab("search")} style={{ width:"100%", padding:"12px 16px", borderRadius:12, background:T.bg3, border:`1px solid ${T.border2}`, color:T.txt3, fontSize:14, textAlign:"left", cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
                    <i className="ti ti-search" style={{ fontSize:16 }} aria-hidden="true" /> Search brands…
                  </button>
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.5, padding:"0 16px 8px" }}>Categories</div>
                <div style={{ overflowX:"auto", whiteSpace:"nowrap", padding:"0 16px 12px", display:"flex", gap:8 }}>
                  {cats.map((cat, i) => {
                    const count = deduped.filter(c=>getBucket(c.cat)===cat).length;
                    const icon = Object.entries(catIconMap).find(([k])=>cat.includes(k))?.[1]||"ti-briefcase";
                    return (
                      <button key={cat} onClick={() => openBucket(cat, count)} style={{ flexShrink:0, padding:"10px 14px", borderRadius:20, background:catBgs[i%catBgs.length], border:`1px solid ${T.border}`, color:catFgs[i%catFgs.length], fontSize:13, fontWeight:600, cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 }}>
                        <i className={`ti ${icon}`} style={{ fontSize:13 }} aria-hidden="true" />
                        {cat} · {count}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.5, padding:"18px 16px 8px" }}>Suggested by category</div>
                <div style={{ padding:"0 16px" }}>
                  {cats.slice(0, 6).map((cat, i) => {
                    const top = topBrandsIn(cat, 3);
                    if (!top.length) return null;
                    return (
                      <div key={cat} style={{ marginBottom:14 }}>
                        <div style={{ fontSize:12, fontWeight:600, color:T.txt2, marginBottom:6 }}>{cat}</div>
                        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                          {top.map(b => (
                            <button key={b.slug || b.id} onClick={() => { setFocusedSlug(b.slug || b.id); setDeepLinkSlug(b.slug || b.id); setTab("search"); }} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:8, cursor:"pointer", textAlign:"left" }}>
                              <CompanyLogo company={b} size={26} />
                              <span style={{ flex:1, minWidth:0, fontSize:13, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{b.name}</span>
                              <span style={{ fontSize:13, fontWeight:700, color:scoreGrade(b.overall) === "A" ? "#4caf82" : scoreGrade(b.overall) === "F" ? "#e24a4a" : T.txt3 }}>{profile ? scoreGrade(computeScore(b, profile)) : "?"}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          // ── ALT-C: Curated editorial collections ─────────────────────────
          if (browseVariant === "alt-c") {
            const collections = [
              { id: "topA", title: "A-graded standouts", subtitle: "Brands scoring highest overall", filter: c => scoreGrade(c.overall) === "A", color: "#4caf82" },
              { id: "worstF", title: "F-graded watch list", subtitle: "Brands with the worst records", filter: c => scoreGrade(c.overall) === "F", color: "#e24a4a" },
              { id: "russia", title: "Still operating in Russia", subtitle: "Yale CELI list", filter: c => c.stillInRussia, color: "#f0a030" },
              { id: "childLab", title: "Child labor risk", subtitle: "BHRRC-flagged supply chain", filter: c => c.childLabor, color: "#e24a4a" },
              { id: "foreign", title: "Foreign-owned brands", subtitle: "Parented outside the US", filter: c => c.foreignOwned, color: "#9b8ff0" },
              { id: "antitrust", title: "Antitrust spotlight", subtitle: "Active antitrust history", filter: c => c.antitrust, color: "#f0a030" },
            ];
            return (
              <div style={{ padding:"16px 16px 80px" }}>
                <div style={{ fontSize:13, color:T.txt3, marginBottom:14, lineHeight:1.5 }}>
                  Curated lists across the catalog, beyond traditional industry categories. Tap any list to explore.
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {collections.map(coll => {
                    const matched = deduped.filter(coll.filter);
                    if (!matched.length) return null;
                    const top3 = matched.slice(0, 3);
                    return (
                      <div key={coll.id} onClick={() => {
                        // Set the flag filter the existing chain understands
                        if (coll.id === "russia") { setFlagFilters(["stillInRussia"]); }
                        else if (coll.id === "childLab") { setFlagFilters(["childLabor"]); }
                        else if (coll.id === "foreign") { setFlagFilters(["foreignOwned"]); }
                        else if (coll.id === "antitrust") { setFlagFilters(["antitrust"]); }
                        // For grade-based collections, no flag — use search seed
                        setTab("search"); track("browse_collection_open", { id: coll.id, count: matched.length });
                      }} style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:14, padding:"12px 14px", cursor:"pointer" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                          <div style={{ width:8, height:32, borderRadius:2, background:coll.color, flexShrink:0 }} />
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:14, fontWeight:700, color:T.txt }}>{coll.title}</div>
                            <div style={{ fontSize:11, color:T.txt3, marginTop:1 }}>{coll.subtitle} · {matched.length} brand{matched.length === 1 ? "" : "s"}</div>
                          </div>
                          <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
                        </div>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingLeft:18 }}>
                          {top3.map(c => (
                            <span key={c.slug || c.id} style={{ fontSize:10, padding:"2px 7px", borderRadius:10, background:T.bg3, color:T.txt2, border:`1px solid ${T.border2}` }}>{c.name}</span>
                          ))}
                          {matched.length > 3 && (
                            <span style={{ fontSize:10, padding:"2px 7px", color:T.txt3 }}>+{matched.length - 3} more</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          // ── V1 (default, current): tile grid ─────────────────────────────
          return (
            <div style={{ padding:16, display:"grid", gridTemplateColumns:"calc(50% - 5px) calc(50% - 5px)", gap:10 }}>
              {cats.map((cat, i) => {
                const icon = Object.entries(catIconMap).find(([k])=>cat.includes(k))?.[1]||"ti-briefcase";
                const count = deduped.filter(c=>getBucket(c.cat)===cat).length;
                return (
                  <div key={cat} onClick={() => openBucket(cat, count)}
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
          );
        })()}</ErrorBoundary>
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
          {/* Phase 5.au (QA round 2 friction #1): The QA fleet flagged that
              Top Picks was burying the ranked list under 400-540px of
              editorial chrome — on iPhone SE users saw ZERO ranked cards
              above the fold. Now: top 3 ranked picks render FIRST, then
              editorial cards collapse below under "More for you this week".
              The headline value of the tab — ranked picks for ME — finally
              owns the first viewport. */}
          {profile && topPicksRanked.length > 0 && (
            <div style={{ padding:"12px 16px 4px" }}>
              <div style={{ fontSize:11, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>
                Your top picks
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {topPicksRanked.slice(0, 3).map(co => (
                  <CompanyCard
                    key={`leadpick-${co.id}`}
                    company={co} catFilter="all" profile={profile} isPaid={isPaid}
                    onUpgrade={()=>setShowPaywall(true)}
                    isSaved={savedSet.has(co.slug || co.id)}
                    onToggleSave={() => toggleSaved(co.slug || co.id, co.name)}
                    inCompare={isInCompare(co.slug || co.id)}
                    onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)}
                    allCompanies={companies}
                    onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }}
                    onNavigate={(slug) => { setFocusedSlug(slug); setDeepLinkSlug(slug); setTab("search"); }}
                  />
                ))}
              </div>
              <div style={{ fontSize:11, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, marginTop:18, marginBottom:2, paddingBottom:4, borderBottom:`1px solid ${T.border}` }}>
                More for you this week
              </div>
            </div>
          )}
          {/* Phase 5.aj (Tier 3 L — in-app version): "Updates on brands you've saved".
              Per user verbiage correction — instead of "Brand X was recalled"
              push notification, we surface in-app: "There is new recall data
              on a brand you've saved." Web Push infra can come later as a
              separate sprint; this is the safe pre-launch surface that
              delivers the same value through the app rather than the OS.

              Filters the weekly_changes digest down to ONLY brands in the
              user's saved-set, so power users with 20+ saved brands get a
              personally-relevant view of what changed. */}
          {weeklyChanges && weeklyChanges.changes && savedSet.size > 0 && (() => {
            const savedChanges = weeklyChanges.changes.filter(c => savedSet.has(c.slug));
            if (!savedChanges.length) return null;
            return (
              <div style={{ margin:"12px 16px", padding:"12px 14px", background:T.goldBg, border:`1.5px solid ${T.gold}`, borderRadius:14 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <div style={{ fontSize:10, color:T.gold, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, display:"flex", alignItems:"center", gap:5 }}>
                    <i className="ti ti-bell" aria-hidden="true" /> Updates on brands you've saved
                  </div>
                  <div style={{ fontSize:10, color:T.txt3 }}>{savedChanges.length} update{savedChanges.length === 1 ? "" : "s"}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {savedChanges.slice(0, 5).map((c, i) => {
                    // Phase 5.aj: corrected verbiage per user — "there is recall
                    // data on a brand you just saved", not "brand was recalled".
                    const verbiage = c.type === "new_recall"  ? `New recall data on ${c.name}`
                                   : c.type === "new_scandal" ? `News flag on ${c.name}: ${c.detail}`
                                   : c.type === "grade_drop"  ? `${c.name} grade changed: ${c.detail}`
                                   : c.type === "grade_up"    ? `${c.name} grade improved: ${c.detail}`
                                   : c.detail;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          track("saved_update_clicked", { slug: c.slug, type: c.type });
                          setFocusedSlug(c.slug);
                          setDeepLinkSlug(c.slug);
                          setTab("search");
                        }}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", width:"100%" }}
                      >
                        <i className="ti ti-rosette" style={{ fontSize:14, color: c.severity === "alert" ? "#e24a4a" : T.gold, flexShrink:0 }} aria-hidden="true" />
                        <div style={{ flex:1, minWidth:0, fontSize:12, color:T.txt2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{verbiage}</div>
                        <i className="ti ti-chevron-right" style={{ fontSize:12, color:T.txt3 }} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Phase 5.ah (item K): "This week" in-app digest. Reads
              weekly_changes.json (built every Sunday by cron from a
              raw.json week-over-week diff). Only renders when there's at
              least one change to show. Each item taps into the brand.
              Anti-pattern compliance: not a feed, not infinite scroll —
              a capped, dated weekly summary card. */}
          {weeklyChanges && weeklyChanges.changes && weeklyChanges.changes.length > 0 && (
            <div style={{ margin:"12px 16px", padding:"12px 14px", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:14 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6 }}>
                  This week
                </div>
                <div style={{ fontSize:10, color:T.txt3 }}>
                  {weeklyChanges.stats?.gradeChanges || 0} grade · {weeklyChanges.stats?.newScandals || 0} scandal · {weeklyChanges.stats?.newRecalls || 0} recall
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {weeklyChanges.changes.slice(0, 5).map((c, i) => {
                  const tint = c.severity === "alert" ? "#e24a4a"
                            : c.severity === "warn"  ? "#f0a030"
                            : T.accent2;
                  const icon = c.type === "grade_drop"   ? "ti-trending-down"
                            : c.type === "grade_up"     ? "ti-trending-up"
                            : c.type === "new_scandal"  ? "ti-alert-triangle"
                            : c.type === "new_recall"   ? "ti-rosette"
                            : c.type === "new_brand"    ? "ti-sparkles"
                            : "ti-circle";
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        track("weekly_digest_clicked", { slug: c.slug, type: c.type });
                        setDeepLinkSlug(c.slug);
                        setTab("search");
                      }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", width:"100%" }}
                    >
                      <i className={`ti ${icon}`} style={{ fontSize:14, color: tint, flexShrink:0 }} aria-hidden="true" />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.name}</div>
                        <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.detail}</div>
                      </div>
                      <i className="ti ti-chevron-right" style={{ fontSize:12, color:T.txt3 }} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              {weeklyChanges.changes.length > 5 && (
                <div style={{ fontSize:11, color:T.txt3, textAlign:"center", marginTop:8 }}>
                  +{weeklyChanges.changes.length - 5} more changes this week
                </div>
              )}
            </div>
          )}

          {/* Phase 5.ag (item N): "Brand of the day" — one curated brand
              per day with a short framing line. Deterministic rotation based
              on date so all users see the same brand on the same day (good
              for shareability) but it changes daily (rewards return visits).
              Pick rotates through: well-known A-graders (positive surprise),
              well-known F-graders (the worst-day callout already exists for
              search), and a "category spotlight" pull from a random cat.

              Audit warning: this is the SAFE version of variable reward —
              one item, journalism framing, no infinite scroll, no streak.
              Builds a daily-open ritual without the doomscroll downside. */}
          {(() => {
            // Phase 5.au (QA round 2 #6): editorial-curated Brand of the
            // Day. Reads /public/data/editorial.json — hand-curated
            // journalism stories with a clear headline + 1-3 sentence
            // blurb. Falls back to the top-200 curated-pool rotation if
            // no editorial story exists for today.
            const todayIso = new Date().toISOString().slice(0, 10);
            let story = null;
            try {
              if (editorial?.stories) {
                story = editorial.stories.find(s =>
                  Array.isArray(s.displayDays) && s.displayDays.includes(todayIso)
                );
              }
            } catch {}

            // If we have an editorial story today, look up the company
            // record to render the logo + grade.
            if (story) {
              const co = deduped.find(c => (c.slug || c.id) === story.slug);
              if (co) {
                const pickScore = computeScore(co, profile);
                const pickGrade = scoreGrade(pickScore);
                const flavor = {
                  A: { color:"#4caf82", bgTint:"rgba(76,175,130,0.08)", borderTint:"rgba(76,175,130,0.4)", chipBg:"#0d2318" },
                  B: { color:"#8bc34a", bgTint:"rgba(139,195,74,0.08)", borderTint:"rgba(139,195,74,0.4)", chipBg:"#1a2810" },
                  C: { color:"#f0a030", bgTint:"rgba(240,160,48,0.08)", borderTint:"rgba(240,160,48,0.4)", chipBg:"#2a2210" },
                  D: { color:"#ff7043", bgTint:"rgba(255,112,67,0.08)", borderTint:"rgba(255,112,67,0.4)", chipBg:"#2a1810" },
                  F: { color:"#e24a4a", bgTint:"rgba(226,74,74,0.08)", borderTint:"rgba(226,74,74,0.4)", chipBg:"#2a0d0d" },
                }[pickGrade] || { color:"#f0a030", bgTint:"rgba(240,160,48,0.08)", borderTint:"rgba(240,160,48,0.4)", chipBg:"#2a2210" };
                return (
                  <div
                    onClick={() => {
                      track("editorial_clicked", { slug: co.slug || co.id, story_id: story.id });
                      setDeepLinkSlug(co.slug || co.id);
                      setTab("search");
                    }}
                    style={{ margin:"12px 16px", padding:"14px 16px", background:flavor.bgTint, border:`1.5px solid ${flavor.borderTint}`, borderRadius:14, cursor:"pointer" }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
                      <CompanyLogo company={co} size={40} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:10, color:flavor.color, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6 }}>Brand of the day · {story.tag || "Worth knowing"}</div>
                        <div style={{ fontSize:15, fontWeight:700, color:T.txt, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{story.name || co.name}</div>
                      </div>
                      <div style={{ padding:"6px 12px", borderRadius:10, background:flavor.chipBg, color:flavor.color, fontSize:18, fontWeight:800, flexShrink:0 }}>{profile ? pickGrade : "?"}</div>
                    </div>
                    <div style={{ fontSize:14, fontWeight:600, color:T.txt2, marginBottom:6, lineHeight:1.35 }}>{story.headline}</div>
                    <div style={{ fontSize:12.5, color:T.txt3, lineHeight:1.55 }}>{story.blurb}</div>
                  </div>
                );
              }
            }

            // Fallback: curated top-200 rotation (Phase 5.as r2)
            const day = Math.floor(Date.now() / 86_400_000);
            const JUNK = new Set(["Other","Various","NA","Uncategorized","Industrial Equipment Manufacturing","Forest Products"]);
            const wellKnown = deduped
              .filter(c => c.overall != null && c.cat && !JUNK.has(c.cat))
              .filter(c => c.logo || c.hasLogo || (c.name && c.name.length <= 30))
              .filter(c => ["A","B","C","D","F"].includes(scoreGrade(c.overall)))
              .sort((a, b) => {
                const score = (c) => Object.values(c.sc || {}).filter(v => v && String(v).toLowerCase() !== "neutral" && String(v).toLowerCase() !== "unknown").length;
                return score(b) - score(a);
              })
              .slice(0, 200);
            if (!wellKnown.length) return null;
            const pick = wellKnown[day % wellKnown.length];
            const pickScore = computeScore(pick, profile);
            const pickGrade = scoreGrade(pickScore);
            const flavorByGrade = {
              A: { tag: "Worth knowing", color: "#4caf82", bgTint: "rgba(76,175,130,0.08)", borderTint: "rgba(76,175,130,0.4)" },
              B: { tag: "Worth knowing", color: "#8bc34a", bgTint: "rgba(139,195,74,0.08)", borderTint: "rgba(139,195,74,0.4)" },
              C: { tag: "Mixed signal",  color: "#f0a030", bgTint: "rgba(240,160,48,0.08)", borderTint: "rgba(240,160,48,0.4)" },
              D: { tag: "Worth a look",  color: "#ff7043", bgTint: "rgba(255,112,67,0.08)", borderTint: "rgba(255,112,67,0.4)" },
              F: { tag: "Worth a look",  color: "#e24a4a", bgTint: "rgba(226,74,74,0.08)", borderTint: "rgba(226,74,74,0.4)" },
            };
            const fl = flavorByGrade[pickGrade] || flavorByGrade.C;
            return (
              <div
                onClick={() => {
                  track("brand_of_day_clicked", { slug: pick.slug || pick.id, grade: pickGrade, day });
                  setDeepLinkSlug(pick.slug || pick.id);
                  setTab("search");
                }}
                style={{ margin:"12px 16px", padding:"12px 14px", background:fl.bgTint, border:`1.5px solid ${fl.borderTint}`, borderRadius:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
              >
                <CompanyLogo company={pick} size={44} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:10, color:fl.color, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6 }}>Brand of the day · {fl.tag}</div>
                  <div style={{ fontSize:15, fontWeight:700, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginTop:2 }}>{pick.name}</div>
                  <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{pick.cat}</div>
                </div>
                <div style={{ padding:"6px 12px", borderRadius:10, background: pickGrade === "A" ? "#0d2318" : pickGrade === "B" ? "#1a2810" : pickGrade === "C" ? "#2a2210" : pickGrade === "D" ? "#2a1810" : "#2a0d0d", color: fl.color, fontSize:18, fontWeight:800, flexShrink:0 }}>{profile ? pickGrade : "?"}</div>
              </div>
            );
          })()}

          {/* Phase 5.ag (item M-partial): personal monthly stats card.
              Reads tn_purchaseLog (populated by the I-bought/skipped toggle
              from item J) and surfaces a tiny "your month" summary on the
              Top Picks tab — building toward the full Year-in-Review
              eventually. Only renders if the user has logged ≥3 actions
              this month (otherwise it's not enough data to be interesting). */}
          {(() => {
            let log = {};
            try { log = JSON.parse(localStorage.getItem("tn_purchaseLog") || "{}"); } catch {}
            const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
            const monthMs = monthStart.getTime();
            const entries = Object.values(log).filter(e => e?.at >= monthMs);
            if (entries.length < 3) return null;
            const bought  = entries.filter(e => e.action === "bought").length;
            const skipped = entries.filter(e => e.action === "skipped").length;
            const skippedF = entries.filter(e => e.action === "skipped" && ["D","F"].includes(e.grade)).length;
            return (
              <div style={{ margin:"0 16px 12px", padding:"14px", background:T.bg3, border:`1px solid ${T.border}`, borderRadius:12 }}>
                <div style={{ fontSize:10, color:T.txt3, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>Your month so far</div>
                <div style={{ display:"flex", gap:16 }}>
                  <div style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:"#4caf82" }}>{bought}</div>
                    <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>BOUGHT</div>
                  </div>
                  <div style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:"#f0a030" }}>{skipped}</div>
                    <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>SKIPPED</div>
                  </div>
                  <div style={{ flex:1, textAlign:"center" }}>
                    <div style={{ fontSize:22, fontWeight:800, color:T.accent2 }}>{skippedF}</div>
                    <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>SKIPPED D / F</div>
                  </div>
                </div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:10, textAlign:"center", lineHeight:1.4 }}>
                  Tap "I bought it" or "I skipped it" on any brand profile to track your month.
                </div>
              </div>
            );
          })()}

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
                onClick={()=>{ track("personalized_teaser_clicked", { slug: teaserCompany.slug || teaserCompany.id, name: teaserCompany.name }); track("quiz_started", { from: "personalized_teaser" }); setScreen("quiz"); }}
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
            {/* Phase 5.as (#12 + #13): the previous render computed score for
                all 11K companies and sorted them on every render. That hit
                ~280K computeScore calls per Top Picks render — the source
                of the "slow to navigate" delay. Now memoized + capped at
                top 50. Tap "Show all" to expand to the full list (rare). */}
            {topPicksRanked.slice(0, topPicksLimit).map((co) => (
              <CompanyCard key={co.id} company={co} catFilter="all" profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} onNavigate={(slug) => { setFocusedSlug(slug); setDeepLinkSlug(slug); setTab("search"); }} />
            ))}
            {topPicksLimit < topPicksRanked.length && (
              <button
                onClick={() => { setTopPicksLimit(n => n + 100); track("top_picks_show_more", { from: topPicksLimit }); }}
                style={{ marginTop:8, padding:"12px 16px", borderRadius:10, border:`1px solid ${T.border}`, background:T.bg2, color:T.accent2, fontSize:13, fontWeight:600, cursor:"pointer" }}
              >
                Show {Math.min(100, topPicksRanked.length - topPicksLimit)} more · {topPicksRanked.length - topPicksLimit} remaining
              </button>
            )}
          </div>
        </ErrorBoundary>
      )}

      {/* SOURCES — Pro only */}
      {/* Phase 5.am: LIBRARY tab — Saved + History sub-tabs. Replaces the
          standalone History tab; lifts Favorites out of Account → much more
          discoverable in the bottom nav. */}
      {tab === "library" && (
        <ErrorBoundary name="library">
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, background:T.bg2 }}>
            {[
              { id:"saved",   label:"Saved",   icon:"ti-star",     count: savedSet.size },
              { id:"history", label:"History", icon:"ti-history",  count: (() => { try { return JSON.parse(localStorage.getItem("tn_viewHistory") || "[]").length; } catch { return 0; } })() },
            ].map(s => {
              const active = librarySubtab === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setLibrarySubtab(s.id)}
                  style={{ flex:1, padding:"12px 8px", background:"none", border:"none", borderBottom:`2px solid ${active ? T.accent2 : "transparent"}`, color: active ? T.accent2 : T.txt3, fontSize:13, fontWeight: active ? 700 : 500, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                >
                  <i className={`ti ${s.icon}`} style={{ fontSize:14 }} aria-hidden="true" />
                  {s.label}
                  {s.count > 0 && <span style={{ fontSize:11, padding:"1px 6px", borderRadius:10, background: active ? T.accentBg : T.bg3, color: active ? T.accent2 : T.txt3, fontWeight:600 }}>{s.count}</span>}
                </button>
              );
            })}
          </div>

          {/* ── SAVED sub-tab ─────────────────────────────────────────── */}
          {librarySubtab === "saved" && (() => {
            const savedSlugs = Array.from(savedSet);
            let savedCos = savedSlugs.map(s => deduped.find(c => (c.slug || c.id) === s)).filter(Boolean);
            // Phase 5.as (QA friction #6): sort + category filter for Library/Saved.
            // A user with 20+ saved brands can't find anything in a flat dump.
            if (savedSortMode === "grade") {
              savedCos = [...savedCos].sort((a,b) => computeScore(b, profile) - computeScore(a, profile));
            } else if (savedSortMode === "name") {
              savedCos = [...savedCos].sort((a,b) => (a.name||"").localeCompare(b.name||""));
            } else if (savedSortMode === "category") {
              savedCos = [...savedCos].sort((a,b) => (a.cat||"").localeCompare(b.cat||"") || (a.name||"").localeCompare(b.name||""));
            } // default: "recent" (insertion order, already correct)
            if (savedCategoryFilter !== "all") {
              savedCos = savedCos.filter(c => getBucket(c.cat || "") === savedCategoryFilter);
            }
            const savedCategoryOptions = Array.from(new Set(savedSlugs.map(s => {
              const co = deduped.find(c => (c.slug || c.id) === s);
              return co ? getBucket(co.cat || "") : null;
            }).filter(Boolean))).sort();
            if (!savedSlugs.length) {
              return (
                <div style={{ padding:"60px 24px", textAlign:"center", color:T.txt3 }}>
                  <i className="ti ti-star" style={{ fontSize:48, color:T.txt3, marginBottom:14 }} aria-hidden="true" />
                  <div style={{ fontSize:15, fontWeight:600, color:T.txt2 }}>No saved brands yet</div>
                  <div style={{ fontSize:12, marginTop:6, lineHeight:1.4 }}>
                    Tap the ☆ on any brand to save it for later.
                  </div>
                  <button
                    onClick={() => setTab("search")}
                    style={{ marginTop:18, padding:"10px 18px", borderRadius:10, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2, fontSize:13, fontWeight:600, cursor:"pointer" }}
                  >
                    Find brands to save →
                  </button>
                </div>
              );
            }
            return (
              <div style={{ padding:"0 0 80px" }}>
                {/* Sort + category filter bar */}
                <div style={{ padding:"10px 16px", display:"flex", gap:8, alignItems:"center", borderBottom:`1px solid ${T.border}`, background:T.bg2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
                  <select
                    value={savedSortMode}
                    onChange={e => setSavedSortMode(e.target.value)}
                    style={{ background:T.bg3, color:T.txt, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 8px", fontSize:12, flexShrink:0 }}
                    aria-label="Sort saved brands"
                  >
                    <option value="recent">Recently saved</option>
                    <option value="grade">Grade (best first)</option>
                    <option value="name">Name (A–Z)</option>
                    <option value="category">Category</option>
                  </select>
                  {savedCategoryOptions.length > 1 && (
                    <>
                      <button
                        onClick={() => setSavedCategoryFilter("all")}
                        style={{ flexShrink:0, padding:"5px 10px", borderRadius:14, border:"none", fontSize:11, fontWeight:600, cursor:"pointer", background: savedCategoryFilter === "all" ? T.accent : T.bg3, color: savedCategoryFilter === "all" ? "#fff" : T.txt3 }}
                      >All</button>
                      {savedCategoryOptions.map(cat => (
                        <button
                          key={cat}
                          onClick={() => setSavedCategoryFilter(cat === savedCategoryFilter ? "all" : cat)}
                          style={{ flexShrink:0, padding:"5px 10px", borderRadius:14, border:"none", fontSize:11, fontWeight:600, cursor:"pointer", background: savedCategoryFilter === cat ? T.accent : T.bg3, color: savedCategoryFilter === cat ? "#fff" : T.txt3 }}
                        >{cat}</button>
                      ))}
                    </>
                  )}
                </div>
                {savedCos.length === 0 ? (
                  <div style={{ padding:"40px 24px", textAlign:"center", color:T.txt3, fontSize:13 }}>
                    No saved brands in <strong>{savedCategoryFilter}</strong>. <button onClick={() => setSavedCategoryFilter("all")} style={{ background:"none", border:"none", color:T.accent2, textDecoration:"underline", cursor:"pointer" }}>Clear filter</button>
                  </div>
                ) : savedCos.map(co => {
                  const ps = computeScore(co, profile);
                  const g = scoreGrade(ps);
                  const colors = { A:"#4caf82", B:"#8bc34a", C:"#f0a030", D:"#ff7043", F:"#e24a4a", "?":T.txt3 };
                  // Phase 5.au (QA #12): "Updates since you saved" badge.
                  // Counts weekly_changes entries for this brand. Promotes
                  // Saved from passive list → active dossier (journalism loop).
                  const slugKey = co.slug || co.id;
                  const changeCount = weeklyChanges?.changes
                    ? weeklyChanges.changes.filter(c => c.slug === slugKey).length
                    : 0;
                  return (
                    <button
                      key={co.slug || co.id}
                      onClick={() => { setFocusedSlug(co.slug || co.id); setDeepLinkSlug(co.slug || co.id); setTab("search"); track("library_saved_clicked", { slug: co.slug || co.id, change_count: changeCount }); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 16px", background:T.bg2, border:"none", borderBottom:`1px solid ${T.border}`, cursor:"pointer", textAlign:"left", width:"100%" }}
                    >
                      <CompanyLogo company={co} size={32} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.name}</div>
                          {changeCount > 0 && (
                            <span style={{ flexShrink:0, fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:10, background:T.goldBg, color:T.gold, border:`1px solid ${T.gold}` }}>
                              {changeCount} new
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{co.cat}</div>
                      </div>
                      <div style={{ fontSize:14, fontWeight:700, color: colors[profile ? g : "?"], marginLeft:8 }}>{profile ? g : "?"}</div>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSaved(co.slug || co.id, co.name); }}
                        style={{ background:"none", border:"none", color:T.gold, fontSize:18, cursor:"pointer", padding:"0 4px" }}
                        aria-label="Remove from saved"
                      >★</button>
                      <i className="ti ti-chevron-right" style={{ fontSize:12, color:T.txt3 }} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── HISTORY sub-tab — Yuka-style chronological view list ──── */}
          {librarySubtab === "history" && (() => {
            let history = [];
            try { history = JSON.parse(localStorage.getItem("tn_viewHistory") || "[]"); } catch {}
            if (!history.length) {
              return (
                <div style={{ padding:"60px 24px", textAlign:"center", color:T.txt3 }}>
                  <i className="ti ti-history" style={{ fontSize:48, color:T.txt3, marginBottom:14 }} aria-hidden="true" />
                  <div style={{ fontSize:15, fontWeight:600, color:T.txt2 }}>No history yet</div>
                  <div style={{ fontSize:12, marginTop:6, lineHeight:1.4 }}>
                    Brands you view will appear here in order, most recent first.
                  </div>
                  <button
                    onClick={() => setTab("search")}
                    style={{ marginTop:18, padding:"10px 18px", borderRadius:10, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2, fontSize:13, fontWeight:600, cursor:"pointer" }}
                  >
                    Start exploring →
                  </button>
                </div>
              );
            }
            // Group by date (Today / Yesterday / older)
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const yesterday = today - 86_400_000;
            const groups = { today: [], yesterday: [], older: [] };
            for (const e of history) {
              if (e.viewedAt >= today) groups.today.push(e);
              else if (e.viewedAt >= yesterday) groups.yesterday.push(e);
              else groups.older.push(e);
            }
            const renderGroup = (label, items) => items.length > 0 && (
              <div key={label} style={{ marginBottom:18 }}>
                <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.5, margin:"0 16px 8px" }}>{label}</div>
                <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                  {items.map((e, i) => {
                    const fullCo = deduped.find(c => (c.slug || c.id) === e.slug);
                    const ago = (() => {
                      const mins = Math.floor((Date.now() - e.viewedAt) / 60_000);
                      if (mins < 60)  return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24)   return `${hrs}h ago`;
                      const days = Math.floor(hrs / 24);
                      return `${days}d ago`;
                    })();
                    return (
                      <button
                        key={e.slug + i}
                        onClick={() => { setFocusedSlug(e.slug); setDeepLinkSlug(e.slug); setTab("search"); track("history_clicked", { slug: e.slug }); }}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 16px", background:T.bg2, border:"none", borderBottom:`1px solid ${T.border}`, cursor:"pointer", textAlign:"left", width:"100%" }}
                      >
                        {fullCo && <CompanyLogo company={fullCo} size={32} />}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.name}</div>
                          <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.cat || ""} · {ago}</div>
                        </div>
                        {fullCo && (() => {
                          const ps = computeScore(fullCo, profile);
                          const g = scoreGrade(ps);
                          const colors = { A:"#4caf82", B:"#8bc34a", C:"#f0a030", D:"#ff7043", F:"#e24a4a", "?":T.txt3 };
                          return <div style={{ fontSize:14, fontWeight:700, color: colors[profile ? g : "?"], marginLeft:8 }}>{profile ? g : "?"}</div>;
                        })()}
                        <i className="ti ti-chevron-right" style={{ fontSize:12, color:T.txt3 }} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
            return (
              <div style={{ paddingTop:12, paddingBottom:80 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 16px 12px" }}>
                  <div style={{ fontSize:13, color:T.txt3 }}>{history.length} brand{history.length === 1 ? "" : "s"} viewed</div>
                  <button
                    onClick={async () => {
                      // Phase 5.au: themed confirm replaces window.confirm
                      const ok = await confirm({
                        title: "Clear your history?",
                        body: `This will delete ${history.length} viewed brand${history.length === 1 ? "" : "s"} from this device. Saved brands aren't affected.`,
                        confirmLabel: "Clear history",
                        cancelLabel: "Keep",
                        danger: true,
                      });
                      if (!ok) return;
                      try { localStorage.removeItem("tn_viewHistory"); } catch {}
                      track("history_cleared", { count: history.length });
                      setTab("library");
                      setLibrarySubtab("history");
                      // No reload — state change triggers re-render
                    }}
                    style={{ background:"none", border:"none", color:T.rep, fontSize:11, cursor:"pointer", padding:0, minHeight:32 }}
                  >
                    Clear all
                  </button>
                </div>
                {renderGroup("Today",     groups.today)}
                {renderGroup("Yesterday", groups.yesterday)}
                {renderGroup("Earlier",   groups.older)}
              </div>
            );
          })()}
        </ErrorBoundary>
      )}

      {tab === "sources" && (
        <ErrorBoundary name="sources">{
        !isPaid ? (
          // Phase 5.as (#14): B+C combo for free users. Show source
          // CATEGORIES + the top 5 most authoritative named sources
          // (the credibility anchors). Hide the long-tail source names
          // and URLs so competitors can't trivially replicate our
          // pipeline and we don't advertise heavy use of sources that
          // might rate-limit us. Full list unlocks at Pro.
          <div style={{ padding:16 }}>
            <p style={{ fontSize:13, color:T.txt3, marginBottom:14, lineHeight:1.6 }}>
              Every score is researched from public databases across 11 categories.
            </p>
            {/* Top 5 anchor names — proof of credibility */}
            <div style={{ padding:"12px 14px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>
                Verified by
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {["SEC EDGAR","FEC.gov","EPA","OSHA","OpenFDA"].map(n => (
                  <span key={n} style={{ fontSize:11, fontWeight:600, padding:"5px 10px", borderRadius:8, background:T.bg3, color:T.txt2, border:`1px solid ${T.border}` }}>{n}</span>
                ))}
                <span style={{ fontSize:11, color:T.txt3, padding:"5px 4px" }}>+ 20 more (Pro)</span>
              </div>
            </div>
            {/* Category groups — no individual source names, just the
                shape of the pipeline */}
            <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>
              Source categories
            </div>
            {SOURCES_DATA.map(g => (
              <div key={g.group} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, marginBottom:6 }}>
                <i className={`ti ${g.icon}`} style={{ fontSize:16, color:T.txt3 }} aria-hidden="true" />
                <div style={{ flex:1, fontSize:13, fontWeight:600, color:T.txt }}>{g.group}</div>
                <div style={{ fontSize:11, color:T.txt3 }}>{g.items.length} source{g.items.length === 1 ? "" : "s"}</div>
              </div>
            ))}
            <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ width:"100%", marginTop:14, padding:"13px 24px", borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
              <i className="ti ti-crown" style={{ marginRight:6 }} aria-hidden="true" />
              Unlock all 25+ named sources — $1.99/mo
            </button>
            <div style={{ fontSize:11, color:T.txt3, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
              Pro shows every source name, URL, and how it feeds each category.
            </div>
          </div>
        ) : (
        <div style={{ padding:16 }}>
          <p style={{ fontSize:13, color:T.txt3, marginBottom:4, lineHeight:1.6 }}>All scores are researched from these databases. The Live update button on each company uses real-time web search.</p>
          <div style={{ padding:"8px 12px", background:T.bg3, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:12, fontSize:12, color:T.txt3, lineHeight:1.6 }}>
            <strong style={{color:T.txt2}}>About data freshness:</strong> Government-derived signals (FEC donations, EPA enforcement, OSHA, NLRB, Violation Tracker, HIBP) refresh nightly via automated workflows. Per-company narratives are re-researched monthly to incorporate new public records. Political donation totals reflect the current election cycle; environmental enforcement totals span 2000–present. For breaking news, tap "Live update" on any company card.
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

          {/* Phase 5.au: Values Fingerprint card — pinned to Account so it's
              always visible. Shows the user's archetype + 4-letter codename
              + 1-sentence blurb. Source of identity in the app — every
              return visit reinforces "this is who I am". */}
          {profile && (() => {
            const fp = getStoredFingerprint() || computeFingerprint(profile);
            if (!fp) return null;
            return (
              <div style={{ background:T.accentBg, border:`1.5px solid ${T.accent}`, borderRadius:16, padding:16, marginBottom:12 }}>
                <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:6 }}>Your values archetype</div>
                <div style={{ fontSize:18, fontWeight:800, color:T.txt, lineHeight:1.2 }}>{fp.name}</div>
                <div style={{ fontSize:10, color:T.accent2, fontFamily:"ui-monospace, Menlo, monospace", letterSpacing:1.5, marginTop:2, marginBottom:8 }}>{fp.codename}</div>
                <div style={{ fontSize:12, color:T.txt2, lineHeight:1.5 }}>{fp.blurb}</div>
              </div>
            );
          })()}
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
                <button onClick={()=>{ track("quiz_started", { isPaid, from: "account_retake" }); setScreen("quiz"); }} style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer" }}>
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

          {/* Phase 5.am: Saved-companies card removed from Account. Lives in
              the new Library tab now (bottom nav · Saved sub-tab). */}

          {/* Login details — always show so guest users can sign out */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
              <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>Account details</div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Email</span>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:T.txt, fontWeight:500 }}>{currentUser?.email || "Guest"}</span>
                  {/* Phase 5.ak (item #8): change-email button. Prompts for a
                      new address, validates loosely, persists to localStorage. */}
                  <button
                    onClick={async () => {
                      const next = await themedPrompt({
                        title: currentUser?.email ? "Update email" : "Add email",
                        body: "We'll use this to email you product updates and the Sunday digest.",
                        placeholder: "you@example.com",
                        defaultValue: currentUser?.email || "",
                        confirmLabel: "Save",
                      });
                      if (next === null) return;
                      const trimmed = String(next).trim();
                      if (!trimmed.includes("@") || !trimmed.includes(".")) {
                        await themedAlert({ title: "Invalid email", body: "Please enter a valid email address.", kind: "error" });
                        return;
                      }
                      const updated = { ...(currentUser || {}), email: trimmed };
                      try { localStorage.setItem("tn_user", JSON.stringify(updated)); } catch {}
                      setCurrentUser(updated);
                      track("email_changed");
                      try { subscribeEmail(trimmed, "account_email_change"); } catch {}
                      await themedAlert({ title: "Email saved", body: trimmed, kind: "success" });
                    }}
                    style={{ fontSize:11, color:T.accent2, background:"none", border:"none", cursor:"pointer", textDecoration:"underline", padding:0 }}
                  >
                    {currentUser?.email ? "Edit" : "Add"}
                  </button>
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Plan</span>
                <span style={{ color:isPaid ? T.gold : T.txt2, fontWeight:600 }}>{isPaid ? "Pro" : "Free"}</span>
              </div>
              <button style={{ width:"100%", marginTop:12, padding:10, borderRadius:10, border:`1px solid ${T.border2}`, background:"transparent", color:T.txt3, fontSize:13, cursor:"pointer" }}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Sign out?",
                    body: "Your saved brands and preferences stay on this device. You can sign back in any time.",
                    confirmLabel: "Sign out",
                    cancelLabel: "Stay",
                    danger: true,
                  });
                  if (!ok) return;
                  ["tn_hasOnboarded","tn_user"].forEach(k => { try { localStorage.removeItem(k); } catch {} });
                  window.location.reload();
                }}>
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
      <div style={{ flexShrink:0, background:T.bg2, borderTop:`1px solid ${T.border}`, display:"flex", paddingBottom:"calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
        {[
          // Phase 5.am: bottom-nav had 4 icons but TABS array had 5 — that's
          // why the new History tab from 5.al never appeared. Library tab
          // now wraps Saved + History sub-tabs into one slot.
          {id:"top",     icon:"ti-star",            label:"Top Picks"},
          {id:"search",  icon:"ti-search",          label:"Search"},
          {id:"browse",  icon:"ti-apps",            label:"Browse"},
          {id:"library", icon:"ti-bookmarks",       label:"Library"},
          {id:"account", icon:"ti-user",            label:"Account"},
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
