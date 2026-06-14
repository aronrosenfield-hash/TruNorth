// Phase 3.1: companies.js is loaded LAZILY (dynamic import) so the 8.8MB module
// only enters the bundle when the split-bundle path is OFF. With flag ON, the
// import never fires and the app downloads only /data/index.json (~287 KB).
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useModalA11y } from "./lib/useModalA11y";
import SplashScreen from "./SplashScreen";
import OnboardingFlow from "./OnboardingFlow";
import MatchFlow from "./MatchFlow";
import MarketingLanding from "./MarketingLanding";
import PrivacyPolicy from "./PrivacyPolicy";
import Methodology from "./Methodology";
import { initAnalytics, track } from "./lib/analytics";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { isSplitBundleEnabled, loadCompanyIndex, loadCompanyDetail, loadSearchIndex, loadBrandParentMap, loadUpcCache, loadFeatureFlags, featureFlagsEnabled, fetchAppData, getNativeDataSource, apiUrl } from "./lib/dataSource";
import { getCategoryFlagRender, isCategoryExcludedByFlags } from "./lib/scoringFlags";
import { computeFingerprint, persistFingerprint, getStoredFingerprint } from "./lib/fingerprint";
import { useConfirm, usePrompt, useAlert } from "./components/ConfirmModal";
import { subscribeEmail, getStoredEmail } from "./lib/marketing";
import { T, SERIF, MONO, GRADE_COLORS } from "./lib/theme";
import CompassSeal, { COMPASS_AXES } from "./CompassSeal";

// ─── GLOBAL STYLES ───────────────────────────────────────────────────────────
const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  /* QA-6: responsive column — widen the phone-width shells on tablet/desktop
     so the app isn't a 430px strip in a black void. (Full 2-pane = follow-up.) */
  :root { --app-max: 430px; }
  @media (min-width: 768px)  { :root { --app-max: 560px; } }
  @media (min-width: 1024px) { :root { --app-max: 600px; } }
  html { background: #16181D; height: var(--app-height, 100dvh); width: 100%; max-width: 100%; }
  body, #root { background: #16181D; height: 100%; overflow: hidden; width: 100%; max-width: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 15px; color: #EDE9E0; }
  input, textarea, select, button { font-family: inherit; }
  input:focus:not(:focus-visible), textarea:focus:not(:focus-visible), select:focus:not(:focus-visible) { outline: none; }
  :focus-visible { outline: 2px solid #38C0CE; outline-offset: 2px; border-radius: 3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.15; } }
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
function BarcodeScanner({ onClose, onMatch, onSearch, companies }) {
  const dialogRef = useModalA11y({ isOpen: true, onClose });
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

  // Load the brand→parent-slug fallback map once. Open Food Facts often
  // returns sub-brands like "Oreo" or "Nabisco" that aren't top-level
  // companies in our index but DO map to a parent (Mondelez International)
  // that is. Without this fallback the scanner shows "no match" on very
  // recognizable products and looks broken in-store.
  const [brandParentMap, setBrandParentMap] = useState({});
  // Static UPC → { slug, brand, name } cache. Built monthly by
  // scripts/build-upc-cache.mjs from Open Food Facts US data and shipped
  // inside the IPA so the most common in-store scans resolve instantly,
  // even on weak cell. Falls back to the live OFF API on miss.
  const [upcCache, setUpcCache] = useState({});
  useEffect(() => {
    let cancelled = false;
    loadBrandParentMap().then(map => {
      if (!cancelled) setBrandParentMap(map || {});
    });
    loadUpcCache().then(cache => {
      if (!cancelled) setUpcCache(cache || {});
    });
    return () => { cancelled = true; };
  }, []);

  // Build a slug→company index so we can resolve a parent slug from the
  // brand-parent-map back to a full company object.
  const slugIndex = useMemo(() => {
    const m = new Map();
    (companies || []).forEach(c => { if (c.slug) m.set(c.slug, c); });
    return m;
  }, [companies]);

  const resolveBrand = (rawBrand, mapOverride = null) => {
    if (!rawBrand) return null;
    // Build 54: accept a freshly-loaded brandParentMap from lookup() to
    // defeat the race condition where the useState value hasn't propagated
    // yet on first scan after opening the scanner.
    const bpMap = mapOverride || brandParentMap;
    // Try each brand token in the comma/pipe-separated list, prefer first match
    const candidates = rawBrand.split(/[,|;\/]/).map(s => s.trim()).filter(Boolean);
    for (const cand of candidates) {
      const k = cand.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (brandIndex.has(k)) return brandIndex.get(k);
      // Word-prefix fallback: e.g. "Coca-Cola Company" → "cocacola" → match "cocacola"
      for (const [bk, bv] of brandIndex) {
        if (bk.length >= 4 && (bk.startsWith(k) || k.startsWith(bk))) return bv;
      }
      // Brand-parent-map fallback: e.g. "Nabisco" or "Oreo" → mondelez-international
      // This is what makes the scanner work for sub-brands that aren't
      // themselves top-level companies.
      const mapped = bpMap[k];
      if (mapped?.parent && slugIndex.has(mapped.parent)) {
        return slugIndex.get(mapped.parent);
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
            track("scanner_permission_denied", { platform: "native" });
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
          track("scanner_mlkit_fallback", { error: String(mlkitErr?.message || mlkitErr).slice(0, 100) });
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
                  // QA fix 2026-06-10: `lastCode` here is the STALE closure
                  // value from when the effect ran, so this guard never blocked
                  // a repeat — the 200ms interval kept calling lookup(code) for
                  // the same barcode until unmount (duplicate lookups, history
                  // spam, track() double-fires). Kill the interval on first hit;
                  // a re-scan re-mounts the scanner with a fresh interval.
                  if (intervalId) { clearInterval(intervalId); intervalId = null; }
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
      // Build 54: defend against scanner race condition. Aron reported
      // NESCAFÉ → "couldn't match parent" even though the map has the entry.
      // The cause: brandParentMap useState was still {} when the scan
      // completed because loadBrandParentMap() hadn't resolved yet. Await
      // it here and pass the live map into every resolveBrand call so the
      // resolution is correct regardless of how fast the user scanned.
      let liveMap = brandParentMap;
      try {
        const fresh = await loadBrandParentMap();
        if (fresh && Object.keys(fresh).length > 0) {
          liveMap = fresh;
          if (Object.keys(brandParentMap || {}).length === 0) setBrandParentMap(fresh);
        }
      } catch { /* fall through — resolveBrand still has the brandIndex */ }
      // ── Static cache fast path ─────────────────────────────────────────
      // upc-to-slug.json ships in the IPA and covers the top ~3-5k US
      // grocery/household UPCs. If we have a hit we resolve in <1ms with
      // zero network — critical for an in-store experience where cell
      // signal is unreliable. Falls through to the OFF API on miss.
      // The _doc key in the JSON is metadata, not a UPC, so guard for it.
      const cacheEntry = upcCache && code && upcCache[code];
      if (cacheEntry && cacheEntry.slug && slugIndex.has(cacheEntry.slug)) {
        const co = slugIndex.get(cacheEntry.slug);
        setLookupBrand(cacheEntry.brand || cacheEntry.name || "");
        onMatch(co, { barcode: code, brand: cacheEntry.brand, name: cacheEntry.name, source: "upc-cache" });
        return;
      }
      // Tier 2: Open Food Facts (free, ~2M products, US coverage variable)
      let offBrand = null;
      try {
        const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`);
        const data = await res.json();
        if (data?.status === 1 && data?.product) {
          offBrand = data.product.brands || data.product.brand_owner || data.product.product_name;
          if (offBrand) setLookupBrand(offBrand);
          const match = resolveBrand(offBrand, liveMap);
          if (match) {
            onMatch(match, { barcode: code, brand: offBrand, source: "off" });
            return;
          }
        }
      } catch { /* OFF unreachable — fall through to UPCitemdb */ }

      // Tier 3 (Build 53): UPCitemdb trial API — 100 lookups/day per-IP, no key.
      // Catches a lot of US grocery UPCs that Open Food Facts misses entirely.
      // Wrapped in try/catch — non-blocking; if UPCitemdb fails we still get nomatch.
      try {
        const r2 = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
        if (r2.ok) {
          const j2 = await r2.json();
          const item = Array.isArray(j2?.items) ? j2.items[0] : null;
          if (item) {
            const brand2 = item.brand || item.manufacturer || item.title || null;
            if (brand2 && !offBrand) setLookupBrand(brand2);
            const match2 = resolveBrand(brand2, liveMap);
            if (match2) {
              onMatch(match2, { barcode: code, brand: brand2, source: "upcitemdb" });
              return;
            }
          }
        }
      } catch { /* UPCitemdb unreachable or over daily limit — show nomatch */ }

      // Final state: barcode found a brand somewhere but we couldn't map it,
      // OR no source had the barcode at all. lookupBrand may or may not be set.
      //
      // Build 54 (Aron 2026-06-09): emit a no_match event so PostHog can
      // aggregate "top unrecognized barcodes" and "top unmatched brand
      // strings". Drives the post-launch enrichment queue — we'll prioritize
      // adding the brands users actually scan in-store. Privacy: barcode +
      // returned brand string only, no PII. The PostHog dashboard groups
      // by brand string to surface the highest-leverage missing brands.
      try {
        track("scanner_no_match", {
          barcode: code || null,
          brand: offBrand || lookupBrand || null,
          // tier_2_returned_data is true if OFF gave us a brand we couldn't
          // map to a parent — those are the most actionable misses
          tier_2_returned_data: !!offBrand,
        });
      } catch { /* analytics is best-effort */ }
      setStatus("nomatch");
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
        {/* QA 2026-06-10: 36px → 44px to meet the Apple HIG / WCAG 2.5.5
            minimum touch target — this is the only way out of the scanner. */}
        <button onClick={onClose} aria-label="Close scanner" style={{ width:44, height:44, padding:0, borderRadius:"50%", border:"none", background:"rgba(255,255,255,0.12)", color:"#fff", fontSize:22, cursor:"pointer" }}>×</button>
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
                <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>
                  {lookupBrand ? `Found ${lookupBrand}` : "Not in our catalog yet"}
                </div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.7)", marginBottom:18, maxWidth:280, lineHeight:1.5 }}>
                  {lookupBrand
                    ? `We recognized the brand but couldn't match a parent company. Search to grade it directly.`
                    : `Barcode ${lastCode} isn't tracked yet. Try another product or suggest it.`}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:10, width:"100%", maxWidth:280 }}>
                  {/* Build 53 (B): no-match fallback — never show a dead-end. If
                      OFF or UPCitemdb gave us a brand string, jump straight to a
                      search prefilled with that brand. */}
                  {lookupBrand && onSearch && (
                    <button
                      onClick={() => onSearch(lookupBrand)}
                      style={{ padding:"11px 18px", borderRadius:10, border:"none", background:T.accent, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", minHeight:44 }}
                    >
                      Search for "{lookupBrand}"
                    </button>
                  )}
                  <button
                    onClick={() => { setStatus("starting"); setLastCode(null); setLookupBrand(null); setError(null); setScanRound(n => n + 1); }}
                    style={{ padding:"10px 18px", borderRadius:10, border:"none", background:lookupBrand ? "rgba(255,255,255,0.12)" : "#fff", color:lookupBrand ? "#fff" : "#000", fontSize:13, fontWeight:700, cursor:"pointer", minHeight:44 }}
                  >
                    Scan another
                  </button>
                </div>
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

// ─── SCORING ENGINE ───────────────────────────────────────────────────────────
// 2026-06-13 (review): `health` is DROPPED from scoring (Aron's call). It had no
// Match card and no detail-card UI — an invisible grade driver (the review tied
// Denny's D partly to 2018 LA-county health data) — and dropping it was nearly
// distribution-neutral (only 19 health-only brands → "?"). Both engines now
// score the same 9 marketed categories. Must stay in sync with
// rebake-scoring.mjs CAT_KEYS + scripts/lib/index-entry.mjs CATEGORIES.
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

// B-58 (Path B): political differentiation — mirror of rebake-scoring.mjs
// parsePoliticalSignals + politicalScore. Spreads the 80-cluster (bipartisan
// brands) across 55-95 by donation size + tilt, and the 50-cluster (partisan)
// across 35-70. Eliminates the bimodal score distribution by giving every
// brand a unique-to-its-data position on the political axis.
function parsePoliticalSignalsApp(co) {
  const p = co?.political || {};
  let amount = 0, tiltAbs = null, hasData = false;
  if (p.fecData) {
    amount = Number(p.fecData.totalRaised) || 0;
    const rep = Number(p.fecData.repTotal) || 0;
    const dem = Number(p.fecData.demTotal) || 0;
    if (rep + dem > 0) tiltAbs = Math.abs((rep / (rep + dem)) * 100 - 50);
    hasData = true;
  }
  const s = String(p.s || "");
  if (!hasData) {
    const m = s.match(/\$([\d.]+)\s*([KMB]?)/);
    if (m) {
      const n = parseFloat(m[1]);
      const unit = m[2] || "";
      amount = n * (unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1);
    }
  }
  if (tiltAbs == null) {
    const pctR = s.match(/(\d+)%\s+to\s+Republican/i);
    const pctD = s.match(/(\d+)%\s+to\s+Democratic/i);
    if (pctR || pctD) {
      const r = pctR ? +pctR[1] : (pctD ? 100 - +pctD[1] : 50);
      tiltAbs = Math.abs(r - 50);
    } else {
      const lean = s.match(/\+(\d+)\s+across/i);
      if (lean) tiltAbs = Math.min(50, +lean[1]);
      else if (/partisan lean split/i.test(s)) tiltAbs = 5;
    }
  }
  if (amount === 0) amount = 100_000;
  if (tiltAbs == null) tiltAbs = 15;
  return { amount, tiltAbs };
}

function politicalScoreApp(co, val) {
  const { amount, tiltAbs } = parsePoliticalSignalsApp(co);
  // Log-scaled $ factor: positive; subtracted weighted.
  const sizeFactor = Math.log10(Math.max(1, amount / 100_000));
  if (val === "bipartisan" || val === "mixed" || val === "neutral") {
    return Math.max(55, Math.min(95, 85 - tiltAbs * 0.5 - sizeFactor * 7));
  }
  if (val === "left-leaning" || val === "right-leaning") {
    return Math.max(45, Math.min(70, 65 - sizeFactor * 5));
  }
  if (val === "left" || val === "right") {
    return Math.max(35, Math.min(65, 58 - tiltAbs * 0.2 - sizeFactor * 5));
  }
  return null;
}

// B64 fix: documented third-party DEI recognition. Detail JSONs carry the
// deiBadges array; index entries carry the compact deiB flag (see
// scripts/lib/index-entry.mjs) so list rows and detail score identically.
function deiEvidence(co) {
  return !!((Array.isArray(co?.deiBadges) && co.deiBadges.length > 0) || co?.deiB);
}

function scoreCat(k, v, profile, co) {
  // Build 55 (Aron's Excel-rebuild): scores normalized to {8, 50, 97, 100}
  // ranges. Wider separation between match and mismatch, cleaner mental model.
  // Source of truth: docs/scoring-calculator.xlsx · scoreCat sheet.
  // Build 58 (Path B): political category now varies by $ + tilt.
  // SCORING V3 (2026-06-11): universal categories prefer the baked continuous
  // score co.csc[k] (severity-scaled penalties, actual SEC pay ratios, IRS-990
  // grant totals — computed by scripts/rebake-scoring.mjs and carried on both
  // index entries and detail files, so collapsed rows and expanded detail
  // score identically). Enum mappings below remain as fallback for companies
  // not yet rebaked.
  const val = (v || "").toLowerCase();
  const csc = (co?.csc && typeof co.csc[k] === "number") ? co.csc[k] : null;

  if (k === "political") {
    // Build 56 (Aron's WPCR repro): mismatch was a flat 8 with a 1.5× boost —
    // most large consumer brands donate left and run DEI programs, so a
    // right-lean profile saw boosted 8s on nearly every brand → wall of F's.
    // Mismatch is now bad-not-catastrophic and GRADED by intensity: hard
    // opposite 20, leaning opposite 35; match gradient 100/85. Fully
    // symmetric — left and right profiles get identical treatment.
    const lean = profile?.lean || "neutral";
    if (lean === "left")   { if (val==="left") return 100; if (val==="left-leaning") return 85; if (["bipartisan","mixed","neutral"].includes(val)) return 50; if (val==="right-leaning") return 35; if (val==="right") return 20; return 50; }
    if (lean === "right")  { if (val==="right") return 100; if (val==="right-leaning") return 85; if (["bipartisan","mixed","neutral"].includes(val)) return 50; if (val==="left-leaning") return 35; if (val==="left") return 20; return 50; }
    // neutral / no lean — use baked signal-differentiated score (csc fixes the
    // index-vs-detail flicker: politicalScoreApp needs co.political.s, which
    // index entries don't carry, so it used to hit parse defaults on rows).
    return csc ?? politicalScoreApp(co, val) ?? 50;
  }

  if (k === "dei") {
    // Build 56: mismatch 8 → 30 (see political comment — DEI programs are
    // near-universal at large brands; a flat 8 made anti-DEI profiles grade
    // everything F. Symmetric for pro-DEI users on anti_dei brands).
    //
    // B64 fix (Aron's Denny's repro): the badge row shows "Active programs"
    // off third-party recognition (deiBadges: HRC CEI / Disability:IN /
    // Bloomberg GEI) even when sc.dei never got an enum — so an anti-DEI
    // user saw an A next to a green DEI badge and rightly called it a lie.
    // Documented third-party recognition now counts as pro_dei EVIDENCE for
    // stanced users, both directions (pro-DEI users were silently missing
    // the credit too). Neutral users unchanged — stance categories still
    // contribute nothing without a stance.
    const deiLean = profile?.deiLean || "neutral";
    const dv = (!val || val === "neutral" || val === "unknown") && deiEvidence(co) ? "pro_dei" : val;
    if (deiLean === "pro")  { if (dv==="pro_dei") return 100; if (dv==="anti_dei") return 30; return 50; }
    if (deiLean === "anti") { if (dv==="anti_dei") return 100; if (dv==="pro_dei") return 30; return 50; }
    return 50;
  }

  if (k === "animals") {
    const pref = profile?.animalTesting || "neutral";
    if (pref === "dealbreaker") { if (val==="cruelty_free") return 100; if (val==="some_testing") return 15; if (val==="tests_animals") return 0; return 50; }
    if (pref === "prefer_not")  { if (val==="cruelty_free") return 97; if (val==="some_testing") return 50; if (val==="tests_animals") return 20; return 50; }
    return 50;
  }

  if (k === "guns") {
    // Build 56 (100 Thieves repro): 1,626 retailers now carry a factual
    // "no_guns" (Lever 2). For a pro-firearms user, NOT selling guns is not
    // a values violation — at 35 it turned every non-gun retailer into a
    // penalty. no_guns is neutral (50) for supporters; selling/making stays
    // their positive. Avoiders keep the original mapping (explicit stance).
    const pref = profile?.guns || "neutral";
    if (pref === "avoid")   { if (val==="no_guns") return 100; if (["sells_guns","makes_guns"].includes(val)) return 8; return 50; }
    if (pref === "support") { if (val==="no_guns") return 50; if (["sells_guns","makes_guns"].includes(val)) return 100; return 50; }
    return 50;
  }

  if (k === "labor") {
    const union = profile?.unionSupport || "neutral";
    // V3: csc carries the penalty-severity-scaled score (8-40 negatives, 97
    // positives). Pro/neutral users take it as-is (the pro stance already
    // gets a 1.5× weight boost); anti-union users compress toward 50 —
    // labor-board findings matter less to them, mirroring the old softer
    // enum mapping (8→~23, 35→~40, 97→~81).
    if (csc != null) {
      if (union === "anti") return 50 + (csc - 50) * 0.65;
      return csc;
    }
    if (union === "pro")  { if (["positive","excellent","strong","good"].includes(val)) return 97; if (val==="mixed") return 50; if (["negative","poor","below average","very poor"].includes(val)) return 8; return 50; }
    if (union === "anti") { if (["positive","excellent","strong","good"].includes(val)) return 73; if (val==="mixed") return 65; if (["negative","poor","below average"].includes(val)) return 35; if (val==="very poor") return 8; return 50; }
    // neutral
    if (["positive","excellent","strong","good"].includes(val)) return 97;
    if (val==="mixed") return 50;
    if (val==="very poor") return 8;
    if (["negative","poor","below average"].includes(val)) return 35;
    return 50;
  }

  if (k === "privacy") {
    if (csc != null) return csc;
    if (val==="good") return 97; if (val==="mixed") return 50; if (val==="poor") return 8; return 50;
  }

  if (k === "execPay") {
    // V3: csc is the log-curve score of the actual SEC-disclosed pay ratio.
    if (csc != null) return csc;
    if (["fair","good"].includes(val)) return 97; if (val==="mixed") return 50; if (val==="poor") return 8; return 50;
  }

  if (k === "health") {
    if (csc != null) return csc;
    if (["good","positive"].includes(val)) return 100; if (val==="mixed") return 50; if (["poor","negative"].includes(val)) return 8; return 50;
  }

  if (k === "environment") {
    if (csc != null) return csc;
    if (["positive","excellent","strong","good"].includes(val)) return 100;
    if (val==="mixed" || val==="neutral") return 50;
    if (["negative","poor","below average","very poor"].includes(val)) return 8;
    return 50;
  }

  // charity (and fallback)
  if (k === "charity" && csc != null) return csc;
  if (["positive","excellent","strong","good"].includes(val)) return 97;
  if (val==="mixed" || val==="neutral") return 50;
  if (["negative","poor","below average","very poor"].includes(val)) return 8;
  return 50;
}

// B-23 (2026-06-06): apply the scoring_overlay sidecar produced by
// scripts/rebake-scores-from-events.mjs. The overlay is purely additive
// on top of the scoreCat-derived 0-100 — sc.* is never mutated, so the
// rebake is fully reversible by deleting co.scoring_overlay.
// Backward-compatible: companies without a sidecar are unaffected.
function applyOverlay(co, k, baseline0to100) {
  const ov = co.scoring_overlay?.[k];
  if (!ov || typeof ov.delta !== "number") return baseline0to100;
  return Math.max(0, Math.min(100, baseline0to100 + ov.delta));
}

// Build 57 (review): ONE canonical weight scale. The quiz stores ranks 1-5;
// stance axes get 3 (× the 1.5 stance boost = 4.5 — parity with politics,
// never outranking an explicit 5). These defaults fill LEGACY profiles that
// predate per-category weights, and the Why-panel uses the SAME constants —
// it previously defaulted to 3/2 while computeScore used 1.0/1.2, so the
// explanation could disagree with the grade it explained (M7).
export const PROFILE_DEFAULT_WEIGHTS = {
  political: 3, charity: 2, environment: 3, labor: 3, dei: 2,
  animals: 2, guns: 2, privacy: 2, execPay: 2, health: 2,
};

// M7: versioned profile normalization — every read path goes through this,
// so old localStorage shapes can never reach the scoring engine.
function normalizeProfile(p) {
  if (!p || typeof p !== "object") return null;
  if (p.v === 2) return p;
  const weights = { ...PROFILE_DEFAULT_WEIGHTS, ...(p.weights || {}) };
  for (const k of Object.keys(weights)) {
    const n = Number(weights[k]);
    weights[k] = Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : PROFILE_DEFAULT_WEIGHTS[k];
  }
  return { ...p, weights, dealBreakers: Array.isArray(p.dealBreakers) ? p.dealBreakers : [], v: 2 };
}

function computeScore(co, profile) {
  if (!profile) return co.overall;
  // Phase 5.aa: SYMMETRIC user-preference boosts. A user who picks a clear
  // side (Left / Right / Pro-DEI / Anti-DEI / Pro-Gun / Anti-Gun / Union pro
  // / Union anti) gets that axis weighted higher, regardless of which side
  // they picked. Previously only guns and union got boosts which created an
  // implicit bias toward letting labor + environment dominate everyone else.
  // Now political and DEI also boost when the user has a clear stance.
  // Build 55 (Aron's Excel-rebuild): all boosts normalized to 1.5×, default
  // weights flattened to 1.0/1.2. Less variance between categories →
  // grade is less dominated by any single high-weight axis.
  // Source: docs/scoring-calculator.xlsx · Weights sheet.
  const politicalBoost = profile.lean         && profile.lean         !== "neutral" ? 1.5 : 1;
  const deiBoost       = profile.deiLean      && profile.deiLean      !== "neutral" ? 1.5 : 1;
  const animalBoost    = profile.animalTesting && profile.animalTesting !== "neutral" ? 1.5 : 1;
  const gunBoost       = profile.guns         && profile.guns         !== "neutral" ? 1.5 : 1;
  const unionBoost     = profile.unionSupport && profile.unionSupport !== "neutral" ? 1.5 : 1;
  const W0 = PROFILE_DEFAULT_WEIGHTS;
  const baseWeights = {
    political:    (profile.weights?.political    || W0.political) * politicalBoost,
    charity:      profile.weights?.charity      || W0.charity,
    environment:  (profile.weights?.environment  || W0.environment),
    labor:        (profile.weights?.labor       || W0.labor) * unionBoost,
    dei:          (profile.weights?.dei          || W0.dei) * deiBoost,
    animals:      (profile.weights?.animals      || W0.animals) * animalBoost,
    guns:         (profile.weights?.guns        || W0.guns) * gunBoost,
    privacy:      profile.weights?.privacy      || W0.privacy,
    execPay:      profile.weights?.execPay      || W0.execPay,
    health:       profile.weights?.health       || W0.health,
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
  let contributingCats = 0; // evidence breadth — drives shrinkage (Build 57)
  let soleCatScore = null;  // E-10: the lone score when contributingCats===1
  let minUniversal = 100; // worst record-backed category seen (Build 56 floor)
  // PR-3: when the scoring-flags feature is on, exclude categories explicitly
  // marked `flags.<cat>.na` or `flags.<cat>.notDisclosed`. `_inferred` scores
  // still count. When the flag is OFF, this resolves to `false` for every
  // category and the loop behaves byte-identically to before PR-3.
  const flagsOn = featureFlagsEnabled();
  for (const k of CAT_KEYS) {
    if (isCategoryExcludedByFlags(co.flags, k, flagsOn)) continue;
    // SCORING V3 / R4: stance categories (dei / animals / guns) only enter the
    // grade when the user took a side in the quiz. With no stance they would
    // contribute a flat 50 — pure dilution toward C, and a value judgment the
    // app explicitly doesn't make (Phase 4.11: facts, not verdicts). The
    // badges still render; the axes still count once the user opts in.
    if (k === "dei"     && (!profile.deiLean       || profile.deiLean       === "neutral")) continue;
    if (k === "animals" && (!profile.animalTesting || profile.animalTesting === "neutral")) continue;
    if (k === "guns"    && (!profile.guns          || profile.guns          === "neutral")) continue;
    // R7 (Aron, 2026-06-12): political is now a stance category — it enters a
    // personalized grade only when the user picked a side in the Match, exactly
    // like the three above. Neutral-lean users get no political signal, which
    // matches the baked baseline (rebake-scoring.mjs now excludes political).
    if (k === "political" && (!profile.lean || profile.lean === "neutral")) continue;
    const v = co.sc[k];
    const lv = String(v || "").toLowerCase();
    // V3: a baked continuous score (co.csc[k]) counts as a real signal even
    // when the enum is neutral — that's the narrative-salvage cohort (text
    // record present, enum never set). Keeps personalized grades consistent
    // with the neutral baseline, which already scores those records.
    const hasCsc = co.csc && typeof co.csc[k] === "number";
    // B64 fix (Denny's repro): for dei we only reach here when the user IS
    // stanced (neutral-stance users continue'd above) — third-party DEI
    // recognition counts as a signal even with no enum, so the badge the
    // user can SEE always reaches the grade they're shown.
    const deiEv = k === "dei" && deiEvidence(co);
    if (getDataState(k, v) === "unknown" && !hasCsc && !deiEv) continue;
    if (lv === "neutral" && !hasCsc && !deiEv) continue;
    // 2026-06-01 (user-reported bug): 'na' (not applicable, e.g. animal
    // testing on a B2B software company) was being scored as 50 (fallback)
    // because NA_IS_FACTUAL marks it 'scored' for display. But the GRADE
    // should ignore inapplicable categories — they're not a positive OR
    // negative signal, they just don't apply. Exclude them like neutral.
    if (lv === "na" || lv === "n/a") continue;
    // 2026-06-03 (user-reported bug, Walmart): sc.dei = "pro_dei" was
    // dragging the grade down even though dei.s says "No public record
    // found." The category enum exists (often from AI synthesis) but
    // there's no hard public record. Exclude these from the grade too —
    // a categorical guess shouldn't penalize the company.
    //
    // 2026-06-04 (Top Picks grade flicker bug): the bundle index
    // (index.json) doesn't carry the per-category `.s` narrative
    // text — only the per-company detail JSON does. So this exclusion
    // never fired for collapsed rows, but DID fire on expand → grade
    // flickered (Lululemon A→C, Capital One D→B, etc.). The bundle
    // generator (scripts/rebuild-bundle-index.mjs) now bakes an `excl`
    // array of "no public record" category keys into each index entry,
    // so we honor it here regardless of whether co[k].s is present.
    // B64: deiBadges ARE a hard public record (HRC/Disability:IN/Bloomberg
    // publish their lists) — recognition evidence overrides a "no public
    // record" narrative for the dei axis.
    if (Array.isArray(co.excl) && co.excl.includes(k) && !deiEv) continue;
    const detailObj = co[k] || {};
    if (/^\s*no public record found\.?\s*$/i.test(String(detailObj.s || "")) && !deiEv) continue;
    // B-23: apply scoring_overlay delta if present (numeric categories only;
    // categorical categories carry events_agg + excl_stale, not deltas).
    const catScore = applyOverlay(co, k, scoreCat(k, v, profile, co));
    // Build 56 (100 Thieves repro): a stance category sitting at neutral for
    // THIS user (e.g. "doesn't sell firearms" for a firearms supporter) is
    // not a signal — without this, a brand whose only datum is a
    // stance-neutral fact fabricated a whole grade from it.
    if (["political", "dei", "animals", "guns"].includes(k) && Math.abs(catScore - 50) < 5) continue;
    // Build 56: track the worst UNIVERSAL (record-backed) category for the
    // F-requires-misconduct floor below. Stance axes (politics/DEI/animals/
    // guns) are values alignment, not misconduct.
    if (!["political", "dei", "animals", "guns"].includes(k)) {
      minUniversal = Math.min(minUniversal, catScore);
    }
    weightedSum += catScore * baseWeights[k];
    weightUsed  += baseWeights[k];
    contributingCats++;
    soleCatScore = catScore; // only meaningful when contributingCats ends at 1
  }
  // If nothing scored, fall back to the overall (un-personalized) score so the
  // app doesn't show a misleading "50" for companies with no data at all.
  // SCORING V3 / R1: evidence-confidence shrinkage toward neutral (50) — the
  // same estimator the baked baseline uses (scripts/rebake-scoring.mjs). The
  // more weighted evidence behind the score, the more of its raw signal
  // survives; replaces the old hard signal-count grade cap in scoreGrade.
  // co.overall is already shrunk, so the fallback path must NOT re-shrink.
  // Build 57 (review): shrink by EVIDENCE BREADTH (number of contributing
  // categories), not by weight mass — user emphasis changes the mix, never
  // the confidence. Matches the baked engine's semantics exactly (its
  // weights are ~1/category, so weightUsed ≈ count there).
  const K_SHRINK = 1.5;
  const raw = weightUsed > 0 ? weightedSum / weightUsed : null;
  let ws = raw != null
    ? (raw * contributingCats + 50 * K_SHRINK) / (contributingCats + K_SHRINK)
    : (co.overall ?? null);
  // 2026-06-11 (100 Thieves repro): a zero-data brand used to fall through
  // as ||50 → quiz users saw a fabricated "C 50" right next to the
  // private-company "no data isn't a verdict" explainer. No signals → null →
  // grade "?" for personalized users too.
  if (ws == null) return null;
  // Build 56 (Aron's WPCR repro): F is reserved for documented misconduct.
  // If every record-backed category is clean (≥45) and the score only sank
  // below the D line because of stance mismatch (politics/DEI/animals/guns),
  // floor at 41 (D). Values disagreement caps at D; violations — and the
  // user's explicit dealbreakers below — can still drive F. Symmetric: the
  // same floor protects left-lean users on right-donating brands.
  if (ws < 41 && minUniversal >= 45) ws = 41;
  // E-9 (Aron, 2026-06-12): one contributing category caps at B — a single
  // signal (including a lone stance match like no_guns for a gun-avoider)
  // can never mint an A. Matches the published methodology line: "One
  // strong record can earn a B; an A takes a broad, verified track record."
  // Cap is 61 = top of B (A is now ≥62 after the R7.1 recalibration).
  if (contributingCats === 1 && ws > 61) ws = 61;
  // E-10 (Aron, 2026-06-13): symmetric thin-record FLOOR — one moderate
  // negative-only record can't sink below C (46). Punishing data-sparsity
  // (we have a brand's violations but not its positives) isn't conduct. F/D
  // require breadth (2+ records) or severity (a low single score). Mirrors the
  // baked baseline in rebake-scoring.mjs so quizzed ≈ un-quizzed on thin records.
  if (contributingCats === 1 && ws < 46 && (soleCatScore == null || soleCatScore >= 20)) ws = 46;
  // Build 55 (Aron's Excel-rebuild): hard dealbreakers flat -20, soft category
  // dealbreakers flat -10. Animal-testing special-case penalty reduced to -20.
  // Source: docs/scoring-calculator.xlsx · Dealbreakers sheet.
  const pen = (profile.dealBreakers || []).reduce((p, db) => {
    // Soft category dealbreakers (-10): user said "this category matters enough
    // that I want a penalty if it's bad" — small, additive.
    if (["environment","labor","privacy","execPay","animals","guns","charity"].includes(db)) {
      const v = (co.sc[db] || "").toLowerCase();
      const bad = ["negative","poor","very poor","below average","tests_animals","sells_guns","makes_guns"];
      return bad.includes(v) ? p + 10 : p;
    }
    // Hard dealbreakers (-20): structural — about the company, not a single category
    // R7 (2026-06-11): the CBP forced-labor sidecar (UFLPA Entity List /
    // Withhold Release Orders) is direct federal enforcement — it triggers
    // the dealbreaker regardless of the labor enum.
    if (db === "forcedLabor"    && (["poor","very poor"].includes((co.sc.labor||"").toLowerCase()) || co.forcedLaborListed)) return p + 20;
    if (db === "taxAvoidance"   && (co.sc.execPay||"").toLowerCase() === "poor") return p + 20;
    if (db === "predatoryPrice" && (co.sc.labor||"").toLowerCase() === "poor") return p + 20;
    if (db === "darkPatterns"   && (co.sc.privacy||"").toLowerCase() === "poor") return p + 20;
    if (db === "foreignOwn"     && co.foreignOwned) return p + 20;
    if (db === "monopoly"       && co.antitrust) return p + 20;
    if (db === "childLabor"     && co.childLabor) return p + 20;
    return p;
  }, 0);
  // Animal-testing dealbreaker special-case: penalty -20 (was -40).
  // QA fix 2026-06-10: this early-returned `ws - 20` and silently DROPPED the
  // accumulated `pen` from the user's other dealbreakers (and skipped the
  // rounding) — a brand could trip childLabor + animal-testing and only pay
  // for one. Fold it into pen and share the single clamp/round exit.
  let totalPen = pen;
  let cap = 100;
  if (profile.animalTesting === "dealbreaker" && (co.sc.animals === "tests_animals")) {
    totalPen += 20;
    cap = 30; // animal-testing dealbreaker also caps the score at 30 (D range)
  }
  return Math.max(0, Math.min(cap, Math.round(ws - totalPen)));
}

// ─── DISPLAY HELPERS ─────────────────────────────────────────────────────────
// 2026-06-01 (user feedback): everywhere the app shows a company count to
// the user, round DOWN to the nearest thousand and append "+". The exact
// count (e.g. 11,209) reads as precision theater and dates the build.
// "11,000+" is the marketing voice; it's the same number, better punch.
function formatCompanyCount(n) {
  if (!n || n < 1000) return String(n || 0);
  const rounded = Math.floor(n / 1000) * 1000;
  return `${rounded.toLocaleString()}+`;
}

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
    if (["left","left-leaning"].includes(v))   return { sym: "◀", label: "Donates to Democrats (US)",   icon: "dem", aligned: userLean === "left" };
    if (["right","right-leaning"].includes(v)) return { sym: "▶", label: "Donates to Republicans (US)", icon: "rep", aligned: userLean === "right" };
    if (["bipartisan","mixed"].includes(v))    return { sym: "◆", label: "Bipartisan donations (US)",   icon: "bi" };
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
function scoreGrade(n, realCats) {
  // SCORING V3 (2026-06-11): the Build-57 signal-count cap is gone — low
  // evidence is now priced in continuously by K_SHRINK shrinkage inside
  // computeScore / rebake-scoring.mjs, so a one-signal 82 lands ~63 (B)
  // instead of being flattened to the same C as a one-signal 46. The
  // realCats param is kept for call-site compatibility but unused.
  // Thresholds frozen from the one-time V3 recalibration (~A7/B35/C40/D8/F10
  // among graded). Must stay in sync with scripts/rebake-scoring.mjs
  // gradeFromOverall and scripts/lib/index-entry.mjs scoreGrade (shared by
  // rebuild-bundle-index.mjs + finalize-bundle.mjs).
  if (n == null || !Number.isFinite(Number(n))) return "?"; // L1: NaN was falling through to F
  if (n >= 62) return "A";
  if (n >= 50) return "B";
  if (n >= 38) return "C";
  if (n >= 33) return "D";
  return "F";
}

// S3: user-relevant signal count for personalized grades.
// When the user has actively boosted (>1.0) categories in their profile,
// the cap should reflect what THEY care about — not just total signal
// breadth. A user who explicitly weights environment + animals + labor
// shouldn't be blocked from an A on a brand that has rock-solid data
// in those 3 cats but lacks privacy/guns/execPay coverage they never
// asked about.
//
// Rule: count cats that BOTH (a) have a real (non-neutral) signal on this
// brand AND (b) are actively boosted by the user (profile[cat] > 1.0).
// Use the larger of that count and the brand's total realCats — i.e.
// personalization is generous, never stricter than the base cap.
// If there's no profile, fall back to base realCats unchanged.
const CAT_KEYS_FOR_REL = ["political","charity","environment","labor","dei","animals","guns","privacy","execPay"];
// QA fix 2026-06-10: this read profile[k] for weights, but the quiz stores
// rank weights under profile.weights[k] and stance boosts as separate string
// fields (lean / deiLean / animalTesting / guns / unionSupport) — so
// boostedFilled was ALWAYS 0 and the S3 personalized cap never ran. Now
// mirrors computeScore's actual boost logic: a category counts as "actively
// boosted" when its quiz rank weight exceeds the 1.2 default ceiling OR its
// stance field is set away from neutral (the 1.5× boosts).
function userRelevantRealCats(co, profile) {
  if (!profile || !co) return co?.realCats ?? null;
  const sc = co.sc || {};
  const boosted = new Set();
  const w = profile.weights || {};
  for (const k of CAT_KEYS_FOR_REL) {
    if (typeof w[k] === "number" && w[k] > 1.2) boosted.add(k); // above any default
  }
  if (profile.lean          && profile.lean          !== "neutral") boosted.add("political");
  if (profile.deiLean       && profile.deiLean       !== "neutral") boosted.add("dei");
  if (profile.animalTesting && profile.animalTesting !== "neutral") boosted.add("animals");
  if (profile.guns          && profile.guns          !== "neutral") boosted.add("guns");
  if (profile.unionSupport  && profile.unionSupport  !== "neutral") boosted.add("labor");
  let boostedFilled = 0;
  for (const k of boosted) {
    // B64: third-party DEI recognition fills the dei slot for stanced users.
    if (k === "dei" && deiEvidence(co)) { boostedFilled++; continue; }
    const v = sc[k];
    if (!v || v === "neutral" || v === "na" || v === "unknown") continue;
    boostedFilled++;
  }
  return Math.max(boostedFilled, co.realCats ?? 0);
}

// R2 (Today/Ledger): basket alignment — share of the user's saved brands
// whose personalized grade lands A/B. "?" brands are excluded from the
// denominator (no fake alignment from ungraded brands).
function basketAlignment(savedCos, profile) {
  if (!profile || !savedCos.length) return { pct: null, graded: 0, aligned: 0 };
  let graded = 0, aligned = 0;
  for (const co of savedCos) {
    const g = scoreGrade(computeScore(co, profile), userRelevantRealCats(co, profile));
    if (g === "?") continue;
    graded++;
    if (g === "A" || g === "B") aligned++;
  }
  return { pct: graded ? Math.round((aligned / graded) * 100) : null, graded, aligned };
}

// B68 (Aron's call, options A+C): the HEADLINE basket statistic is the clash
// count, not the aligned-%. For stanced users most national brands sit at C —
// "no strong signal for you" — and an A/B-only percentage rendered "mostly
// neutral, one problem" as "0% aligned." Clashes (D/F) are what the engine is
// actually confident about; they're fixable; they're the loop. The math is
// untouched and symmetric — this changes which true number leads.
function basketVerdict(savedCos, profile, allCompanies) {
  const out = { graded: 0, aligned: 0, neutral: 0, clashes: [], best: null, swap: null };
  if (!profile || !savedCos.length) return out;
  for (const co of savedCos) {
    const s = computeScore(co, profile);
    const g = scoreGrade(s, userRelevantRealCats(co, profile));
    if (g === "?") continue;
    out.graded++;
    if (g === "A" || g === "B") {
      out.aligned++;
      if (!out.best || s > out.best.s) out.best = { co, g, s };
    } else if (g === "C") {
      out.neutral++;
    } else {
      out.clashes.push({ co, g, s });
    }
  }
  out.clashes.sort((a, b) => (a.s ?? 99) - (b.s ?? 99)); // worst first
  // The projection (option C): best same-aisle swap for the sharpest clash.
  const worst = out.clashes[0];
  if (worst && Array.isArray(worst.co.competitors) && allCompanies?.length) {
    const lookup = new Map(allCompanies.map(c => [c.slug || c.id, c]));
    let bestAlt = null;
    for (const slug of worst.co.competitors) {
      const alt = lookup.get(slug);
      if (!alt) continue;
      const s2 = computeScore(alt, profile);
      if (s2 == null || s2 < (worst.s ?? 0) + 7) continue;
      const g2 = scoreGrade(s2, userRelevantRealCats(alt, profile));
      if (g2 === "?" || g2 === "D" || g2 === "F") continue;
      if (!bestAlt || s2 > bestAlt.s) bestAlt = { co: alt, g: g2, s: s2 };
    }
    if (bestAlt) out.swap = { from: worst, to: bestAlt };
  }
  return out;
}

// ISO-ish week key for the alignment history (local-time, Monday-agnostic —
// consistency week-over-week matters, not calendar pedantry).
function weekKey(ts) {
  const t = new Date(ts);
  const jan1 = new Date(t.getFullYear(), 0, 1);
  const wk = Math.ceil((((t - jan1) / 864e5) + jan1.getDay() + 1) / 7);
  return `${t.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}

// R2 (Lens verdict card): the serif verdict sentence — one editorial line
// computed from the user's priority axes vs this brand's per-axis scores.
// Axis inclusion mirrors the seal's sealValues loop exactly (na/excl/neutral
// guards) so the sentence never contradicts the ring it sits next to.
function verdictSentence(enriched, profile, grade) {
  const axisScores = {};
  for (const k of COMPASS_AXES) {
    const v = enriched.sc?.[k];
    const lv = String(v || "").toLowerCase();
    const hasCsc = enriched.csc && typeof enriched.csc[k] === "number";
    // B64: stanced users see third-party DEI recognition in ring + sentence.
    const deiEv = k === "dei" && profile?.deiLean && profile.deiLean !== "neutral" && deiEvidence(enriched);
    if (enriched.flags?.[k]?.na) continue;
    if ((getDataState(k, v) === "unknown" || lv === "neutral") && !hasCsc && !deiEv) continue;
    if (lv === "na" || lv === "n/a") continue;
    if (Array.isArray(enriched.excl) && enriched.excl.includes(k) && !deiEv) continue;
    axisScores[k] = scoreCat(k, v, profile, enriched);
  }
  const keys = Object.keys(axisScores);
  if (!keys.length || grade === "?") return "No scoreable public record yet — we don't guess.";
  if (!profile) {
    const strong = keys.filter(k => axisScores[k] >= 60).length;
    const flags = keys.filter(k => axisScores[k] < 25).length;
    let s = `On the record in ${keys.length} ${keys.length === 1 ? "category" : "categories"}`;
    s += strong ? ` — strong in ${strong}` : "";
    s += flags ? `, ${flags === 1 ? "one red flag" : `${flags} red flags`}.` : ".";
    return s;
  }
  // priorities: stanced axes + anything ranked above its default weight
  const pri = new Set();
  const w = profile.weights || {};
  for (const k of COMPASS_AXES) {
    if (typeof w[k] === "number" && w[k] > (PROFILE_DEFAULT_WEIGHTS[k] ?? 2)) pri.add(k);
  }
  if (profile.lean && profile.lean !== "neutral" && profile.lean !== "mixed") pri.add("political");
  if (profile.deiLean && profile.deiLean !== "neutral") pri.add("dei");
  if (profile.animalTesting && profile.animalTesting !== "neutral") pri.add("animals");
  if (profile.guns && profile.guns !== "neutral") pri.add("guns");
  if (profile.unionSupport && profile.unionSupport !== "neutral") pri.add("labor");
  const priWithData = keys.filter(k => pri.has(k));
  const pool = priWithData.length ? priWithData : keys;
  const phrase = priWithData.length
    ? `of your ${pool.length} ${pool.length === 1 ? "priority" : "priorities"}`
    : `of ${pool.length} documented ${pool.length === 1 ? "category" : "categories"}`;
  const aligned = pool.filter(k => axisScores[k] >= 55).length;
  const flags = pool.filter(k => axisScores[k] < 25).length;
  if (flags) return `Aligned on ${aligned} ${phrase} — ${flags === 1 ? "one red flag" : `${flags} red flags`}.`;
  if (aligned === pool.length && pool.length > 1) return `Aligned on all ${pool.length} ${priWithData.length ? "of your priorities" : "documented categories"} — settled.`;
  return `Aligned on ${aligned} ${phrase}.`;
}

// R2 (Lens verdict card): up to three receipt lines — the mono/brass proof
// under the verdict. Every line is a real figure from a named public source;
// when we have a URL we link it. Order: penalties → recalls → money → grants.
function receiptLines(enriched) {
  const fmt$ = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`;
  const out = [];
  const vt = enriched.violationTracker || enriched.laborAPI?.violationTracker;
  if (vt?.totalPenalty && vt.totalRecords) {
    out.push({ src: "FED RECORD", text: `${fmt$(vt.totalPenalty)} penalties · ${vt.totalRecords} records`, sub: vt.primaryOffenses?.[0]?.category });
  }
  const recall = enriched.cpsc?.sampleRecalls?.[0];
  if (recall?.recall_date) {
    out.push({ src: "CPSC", date: String(recall.recall_date).slice(0, 7), text: `recall · ${(recall.title || "").replace(/ Due to.*$/i, "").slice(0, 52)}`, url: enriched.cpsc.sourceUrl });
  }
  if (enriched.fec?.totalRaised) {
    out.push({ src: "FEC", date: enriched.fec.cycle ? String(enriched.fec.cycle) : undefined, text: `${enriched.fec.totalRaisedFmt || fmt$(enriched.fec.totalRaised)} political money · ${enriched.fec.lean || "—"}` });
  }
  if (enriched.charity_irs990?.totalGrants) {
    out.push({ src: "IRS-990", date: enriched.charity_irs990.fiscalYear ? `FY${enriched.charity_irs990.fiscalYear}` : undefined, text: `${fmt$(enriched.charity_irs990.totalGrants)} documented grants`, url: enriched.charity_irs990.propublicaUrl });
  }
  if (enriched.payRatio?.ratio) {
    out.push({ src: "SEC", date: enriched.payRatio.year ? String(enriched.payRatio.year) : undefined, text: `CEO-to-worker pay ${enriched.payRatio.ratioDisplay || `${Math.round(enriched.payRatio.ratio)}:1`}`, url: enriched.payRatio.sourceUrl });
  }
  return out.slice(0, 3);
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

function ElephantSVG({ size=14, col="#E0524D" }) {
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
// 2026-06-01 (audit fix #1): pivoted from fake-Pro-subscription to
// "Pro waitlist" mode. Real Stripe/RevenueCat IAP is blocked on LLC + bank
// account formation. Shipping a fake-charging paywall would:
//   1. Burn user trust if they discover it
//   2. Trigger Apple App Store rejection under Guideline 4.5.3 / IAP rules
//
// Waitlist mode:
//   - "Subscribe" button → "Join the Pro waitlist"
//   - Tapping it captures email to MailerLite with source=pro_waitlist
//   - Promises "first 500 get $9/yr forever" (founder pricing anchor)
//   - User is NOT flipped to Pro (isPaid stays false)
//   - When real IAP launches, flip PRO_WAITLIST_MODE = false and the
//     same component switches back to the real subscription flow.
// X-2 (2026-06-13): flipped to false — real RevenueCat IAP is wired
// (src/lib/payments.js, entitlement "TruNorth Pro"). MUST sandbox-verify a
// purchase/restore/cancel on device before submitting to App Review.
const PRO_WAITLIST_MODE = false;

// App Review fix (2026-06-11 — v1.0 rejected on 2.1.0 / 3.1.1 / 3.1.2):
// until RevenueCat IAP is live (X-0/X-2), the iOS binary must contain NO
// purchase UI, NO subscription pricing, and NO email-waitlist for a future
// paid upgrade — Apple read the "$9/yr founder pricing" waitlist paywall as
// an uncompletable purchase. IAP_SAFE_MODE removes every Pro/Upgrade
// affordance and unlocks the previously-gated features (v1.0 ships fully
// free; Pro returns in 1.1 with real IAP). The founder-pricing waitlist on
// the WEB marketing site is unaffected — Apple doesn't govern the web.
// Flip to false together with PRO_WAITLIST_MODE when RevenueCat goes live.
// X-2 (2026-06-13): flipped to false — the real paywall + Pro feature gating
// are back on now that RevenueCat IAP is live. (v1.0 shipped this true/free
// after the first rejection; Pro returns here with a working purchase flow.)
const IAP_SAFE_MODE = false;

function PaywallScreen({ onSubscribe, onClose, initialEmail="" }) {
  // autoFocus:false — the deferred focus() was scrolling the bottom-sheet down
  // to the email input on open; a sales screen must open at the TOP (value prop
  // + plans), not the entry field. (device bug, 2026-06-14)
  const dialogRef = useModalA11y({ isOpen: true, onClose, autoFocus: false });
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  // 4.7: prefill from stored email if we've seen this user before
  const [email, setEmail] = useState(initialEmail || getStoredEmail());
  // X-2 IAP (2026-06-13): real RevenueCat purchase state.
  const [purchaseError, setPurchaseError] = useState("");
  const [plan, setPlan] = useState("annual"); // "annual" | "monthly"

  // Tighter email validation (audit H8): catches "@@", trailing dots, etc.
  const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(String(s || "").trim());

  const handleSubscribe = async () => {
    if (!isValidEmail(email)) { return; /* button stays disabled — no native alert() */ }
    setPurchaseError("");
    track("upgrade_clicked", {
      email_provided: true,
      source: PRO_WAITLIST_MODE ? "pro_waitlist" : "paywall",
      mode: PRO_WAITLIST_MODE ? "waitlist" : "subscription",
    });
    setLoading(true);
    await subscribeEmail(email, PRO_WAITLIST_MODE ? "pro_waitlist" : "paywall", {
      intendsToSubscribe: true,
      waitlist: PRO_WAITLIST_MODE,
    });
    if (PRO_WAITLIST_MODE) {
      // Don't grant Pro — just confirm the waitlist signup. The user stays
      // free; we surface this to them with a success state, then close.
      setLoading(false);
      setDone(true);
      setTimeout(() => onClose(), 2200);
      return;
    }
    // Real-IAP path (X-2): RevenueCat purchase. Web has no IAP — show an
    // explicit message instead of a silent dead-end (iOS is the only purchase
    // surface at launch). A user *cancel* is NOT a failure.
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) {
      setLoading(false);
      setPurchaseError("Subscriptions are available in the iOS app — get TruNorth on the App Store.");
      return;
    }
    const { setEmailOnCustomer, purchasePro } = await import("./lib/payments");
    await setEmailOnCustomer(email).catch(() => {});
    const result = await purchasePro(plan === "monthly" ? "monthly" : "annual");
    setLoading(false);
    if (result === "purchased") {
      track("subscribe_succeeded", { plan });
      onSubscribe(email);
    } else if (result === "cancelled") {
      track("subscribe_cancelled", { plan }); // keep the paywall open quietly
    } else {
      track("subscribe_failed", { plan });
      setPurchaseError("Purchase didn't go through. Check your App Store connection and try again.");
    }
  };

  // Apple REQUIRES a restore-purchases affordance for auto-renewable subs.
  const handleRestore = async () => {
    track("restore_clicked");
    setPurchaseError("");
    setLoading(true);
    const { restorePurchases } = await import("./lib/payments");
    const ok = await restorePurchases();
    setLoading(false);
    track(ok ? "restore_succeeded" : "restore_failed");
    if (ok) onSubscribe(email);
    else setPurchaseError("No previous purchase found for this Apple ID.");
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="TruNorth Pro upgrade" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div style={{ background:T.bg2, borderRadius:"24px 24px 0 0", border:`1px solid ${T.border2}`, padding:"16px 18px calc(28px + env(safe-area-inset-bottom, 0px))", width:"100%", maxWidth:"var(--app-max, 430px)", maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ width:40, height:4, background:T.bg4, borderRadius:2, margin:"0 auto 20px" }} />

        {done ? (
          // Waitlist success state — shows for ~2.2s then auto-dismisses
          <div style={{ textAlign:"center", padding:"24px 16px 12px" }}>
            <div style={{ width:64, height:64, borderRadius:32, background:T.goldBg, border:`2px solid ${T.gold}`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
              <i className="ti ti-mail-check" style={{ fontSize:32, color:T.gold }} aria-hidden="true" />
            </div>
            <div style={{ fontSize:20, fontWeight:800, color:T.txt, marginBottom:8 }}>You're on the list ✓</div>
            <div style={{ fontSize:13, color:T.txt2, lineHeight:1.55, maxWidth:300, margin:"0 auto" }}>
              We'll email you the moment TruNorth Pro opens. First 500 get founder pricing — $9/year forever.
            </div>
          </div>
        ) : (
        <>
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
          <div style={{ fontSize:17, fontWeight:700, color:T.txt, marginBottom:4 }}>
            {PRO_WAITLIST_MODE ? "TruNorth Pro · Founder pricing" : "Unlock full details"}
          </div>
          <div style={{ fontSize:12, color:T.txt3, lineHeight:1.6, maxWidth:300, margin:"0 auto" }}>
            {PRO_WAITLIST_MODE
              ? "We're finalizing payments. Join the waitlist — the first 500 get founder pricing forever ($9/year)."
              : "Free users see company names and badges. Subscribe to unlock full breakdowns, live updates, and personalized scores."}
          </div>
        </div>

        {/* UX 6B (2026-06-01): side-by-side Free vs Pro comparison table.
            Replaces the single-column Pro feature list. Conversion research
            shows comparison tables convert dramatically better than feature
            lists — readers anchor to the contrast, not the spec sheet. */}
        <div style={{ background:T.bg3, borderRadius:14, padding:"12px 14px 8px", marginBottom:16 }}>
          {/* Header */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 56px 56px", alignItems:"center", paddingBottom:8, borderBottom:`1px solid ${T.border}` }}>
            <div></div>
            <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, textAlign:"center" }}>Free</div>
            <div style={{ fontSize:11, fontWeight:700, color:T.gold, textTransform:"uppercase", letterSpacing:0.6, textAlign:"center" }}>Pro</div>
          </div>
          {[
            { feat: "View brand names + grade",       free: true,  pro: true  },
            { feat: "45-second values Match",          free: true,  pro: true  },
            { feat: "Browse 12,000+ companies",       free: true,  pro: true  },
            { feat: "Personalized scores",            free: false, pro: true, hi: true },
            { feat: "Full grade breakdowns",          free: false, pro: true  },
            { feat: "All 9 value categories",         free: false, pro: true  },
            { feat: "Per-grade citations",            free: false, pro: true  },
            { feat: "In-store barcode scanner",       free: false, pro: true, hi: true },
            { feat: "Live data + Sunday digest",      free: false, pro: true  },
          ].map((row, i, arr) => (
            <div key={i} style={{
              display:"grid", gridTemplateColumns:"1fr 56px 56px", alignItems:"center",
              padding:"7px 0",
              borderBottom: i < arr.length - 1 ? `1px solid ${T.border}` : "none",
              background: row.hi ? `${T.goldBg}` : "transparent",
              borderRadius: row.hi ? 6 : 0,
              marginLeft: row.hi ? -6 : 0,
              marginRight: row.hi ? -6 : 0,
              paddingLeft: row.hi ? 6 : 0,
              paddingRight: row.hi ? 6 : 0,
            }}>
              <span style={{ fontSize:13, color: row.hi ? T.txt : T.txt2, fontWeight: row.hi ? 600 : 400 }}>{row.feat}</span>
              <span style={{ textAlign:"center", fontSize:14, color: row.free ? "#9CC98A" : T.txt3 }}>
                {row.free ? "✓" : "—"}
              </span>
              <span style={{ textAlign:"center", fontSize:14, color: row.pro ? T.gold : T.txt3, fontWeight: row.pro ? 700 : 400 }}>
                {row.pro ? "✓" : "—"}
              </span>
            </div>
          ))}
        </div>

        {PRO_WAITLIST_MODE ? (
          <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, borderRadius:12, padding:"8px 12px", marginBottom:10, textAlign:"center" }}>
            <span style={{ fontSize:22, fontWeight:700, color:T.gold }}>$9</span>
            <span style={{ fontSize:13, color:T.txt3 }}> / year — first 500 only · then $1.99/mo</span>
          </div>
        ) : (
          // X-2: plan selector. Prices mirror App Store Connect (annual $14.99,
          // monthly $1.99). StoreKit shows the user their localized price at the
          // purchase sheet; these are the display anchors.
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            {[
              { id:"annual",  label:"Annual",  price:"$14.99", per:"/yr", sub:"Save 37% · ~$1.25/mo" },
              { id:"monthly", label:"Monthly", price:"$1.99",  per:"/mo", sub:"Cancel anytime" },
            ].map(opt => (
              <button key={opt.id} type="button" onClick={() => setPlan(opt.id)} aria-pressed={plan===opt.id}
                style={{ flex:1, padding:"10px 8px", borderRadius:12, cursor:"pointer", textAlign:"center",
                  background: plan===opt.id ? T.goldBg : T.bg3,
                  border:`1.5px solid ${plan===opt.id ? T.gold : T.border}` }}>
                <div style={{ fontSize:12, fontWeight:700, color: plan===opt.id ? T.gold : T.txt2 }}>{opt.label}</div>
                <div style={{ marginTop:2 }}>
                  <span style={{ fontSize:17, fontWeight:800, color:T.txt }}>{opt.price}</span>
                  <span style={{ fontSize:11, color:T.txt3 }}>{opt.per}</span>
                </div>
                <div style={{ fontSize:10, color:T.txt3, marginTop:2 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
        )}

        {/* fontSize ≥16 keeps iOS Safari + Android Chrome from auto-zooming on focus */}
        <form onSubmit={e=>{e.preventDefault();handleSubscribe();}} autoComplete="on" style={{width:"100%"}}>
          <input type="email" autoComplete="email" name="email" value={email} onChange={e=>setEmail(e.target.value)}
            placeholder={PRO_WAITLIST_MODE ? "Email for the waitlist" : "Enter your email to subscribe"}
            style={{ width:"100%", background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:10, color:T.txt, fontSize:16, padding:"11px 13px", marginBottom:10, boxSizing:"border-box" }}
          />
          <button type="submit" style={{display:"none"}} />
        </form>

        <button onClick={handleSubscribe} disabled={loading || !isValidEmail(email)}
          style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:15, fontWeight:700, cursor: (loading || !isValidEmail(email)) ? "default" : "pointer", opacity: isValidEmail(email) ? 1 : 0.5, marginBottom:6, minHeight:44 }}>
          {loading
            ? (PRO_WAITLIST_MODE ? "Joining…" : "Processing…")
            : (PRO_WAITLIST_MODE ? "Join the Pro waitlist" : (plan === "monthly" ? "Subscribe · $1.99/mo" : "Subscribe · $14.99/yr"))}
        </button>

        {purchaseError && (
          <div role="alert" style={{ fontSize:12, color:T.bad, textAlign:"center", margin:"2px 0 8px", lineHeight:1.45 }}>{purchaseError}</div>
        )}

        {/* Apple 3.1.2 point-of-sale disclosure: price + length + auto-renew
            terms + functional Terms (Apple std EULA) and Privacy links. These
            MUST be on the paywall itself, not just in onboarding — v1.0 was
            rejected on 3.1.2. URLs mirror OnboardingFlow.jsx. */}
        <div style={{ fontSize:11, color:T.txt3, textAlign:"center", marginBottom:10, lineHeight:1.5 }}>
          {PRO_WAITLIST_MODE ? (
            "We email once: when Pro opens. No charges yet · cancel before launch."
          ) : (
            <>
              {plan === "monthly" ? "$1.99/month" : "$14.99/year"}, billed to your Apple Account. Auto-renews unless canceled at least 24 hours before the current period ends. Manage or cancel anytime in your App Store settings.{" "}
              <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noopener noreferrer" style={{ color:T.accent, textDecoration:"none", whiteSpace:"nowrap" }}>Terms of Use</a>
              {" · "}
              <a href="https://www.trunorthapp.com/#privacy" target="_blank" rel="noopener noreferrer" style={{ color:T.accent, textDecoration:"none", whiteSpace:"nowrap" }}>Privacy Policy</a>
            </>
          )}
        </div>

        {/* Apple requires a restore-purchases affordance for auto-renewable subs. */}
        {!PRO_WAITLIST_MODE && (
          <button type="button" onClick={handleRestore} disabled={loading}
            style={{ width:"100%", padding:9, borderRadius:12, border:"none", background:"transparent", color:T.txt2, fontSize:12.5, cursor: loading ? "default" : "pointer", marginBottom:4 }}>
            Restore purchases
          </button>
        )}

        <button onClick={onClose} style={{ width:"100%", padding:11, borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.txt3, fontSize:14, cursor:"pointer", minHeight:44 }}>
          Maybe later
        </button>
        </>
        )}
      </div>
    </div>
  );
}

// ─── STRIP CITE TAGS ─────────────────────────────────────────────────────────
// Removes <cite index="...">...</cite> and bare <cite> tags from AI-generated text
function stripCites(s) {
  return (s || "").replace(/<\/?cite[^>]*>/gi, "").trim();
}

// QA 2026-06-10: removed dead fetchLiveData() — zero call sites, and it
// POSTed to the Anthropic API from the CLIENT with no API key (could never
// succeed; would have leaked a key if one were ever added). Live freshness
// comes from the nightly news pipeline instead.

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
  { id: "childLabor",    label: "Child-labor risk",    icon: "ti-mood-sad",     desc: "Supply chain flagged by the Business & Human Rights Resource Centre or US Department of Labor" },
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
    <div ref={dialogRef} onClick={onClose} role="dialog" aria-modal="true" aria-label="Barcode scanner" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:200, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
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
// B-6 (2026-06-01): soft email capture at the highest-intent moment in the
// entire funnel — right after the user finishes the values quiz. Inline card
// that sits between the runners-up list and the footer CTAs on the Reveal
// screen. Pre-filled from getStoredEmail() so returning users see "✓ on the
// list" instead of being asked again. Dismissible per-session.
function RevealEmailCapture() {
  const prefilled = getStoredEmail();
  const [email, setEmail] = useState(prefilled || "");
  // idle | loading | done | error | dismissed
  // If email is already stored, jump straight to "done" — no point asking again.
  const [status, setStatus] = useState(prefilled ? "done" : "idle");

  // Per-session dismiss — if the user already X'd it on this reveal, don't
  // re-show on quiz retake. Reset across sessions so we get another shot.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("tn_reveal_email_dismissed") === "1") {
        setStatus("dismissed");
      }
    } catch {}
  }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (status === "loading" || status === "done") return;
    setStatus("loading");
    const res = await subscribeEmail(email, "quiz_reveal", { intendsLaunchUpdates: true });
    if (res.ok) {
      setStatus("done");
      try { track("reveal_email_captured", { source: "quiz_reveal" }); } catch {}
    } else {
      setStatus("error");
    }
  };

  const dismiss = () => {
    setStatus("dismissed");
    try { sessionStorage.setItem("tn_reveal_email_dismissed", "1"); } catch {}
    try { track("reveal_email_dismissed", {}); } catch {}
  };

  if (status === "dismissed") return null;

  return (
    <div style={{
      width:"100%", maxWidth:340, marginTop:18, marginBottom:8,
      padding:"14px 16px",
      background:T.bg2, border:`1px solid ${T.border}`, borderRadius:14,
      textAlign:"center",
    }}>
      {status === "done" ? (
        <>
          <div style={{ fontSize:14, fontWeight:700, color:T.accent2, marginBottom:4 }}>
            ✓ You're on the list
          </div>
          <div style={{ fontSize:12, color:T.txt3, lineHeight:1.4 }}>
            We'll email when TruNorth ships on the App Store.
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:14, fontWeight:700, color:T.txt, marginBottom:4 }}>
            Want launch updates?
          </div>
          <div style={{ fontSize:12, color:T.txt3, marginBottom:10, lineHeight:1.4 }}>
            One email when we ship on the App Store. Then quiet — no spam.
          </div>
          <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === "loading"}
              style={{
                width:"100%", boxSizing:"border-box",
                background:T.bg3, border:`1px solid ${T.border2}`,
                borderRadius:10, color:T.txt,
                fontSize:16,   // 16 prevents iOS auto-zoom on focus
                padding:"10px 12px",
              }}
            />
            <div style={{ display:"flex", gap:8 }}>
              <button
                type="submit"
                disabled={status === "loading" || !email}
                style={{
                  flex:1, padding:"10px 12px", borderRadius:10, border:"none",
                  background:T.accent2, color:"#000",
                  fontSize:13, fontWeight:700,
                  cursor: status === "loading" ? "default" : "pointer",
                  opacity: !email ? 0.5 : 1,
                }}
              >
                {status === "loading" ? "Subscribing…" : "Notify me"}
              </button>
              <button
                type="button"
                onClick={dismiss}
                style={{
                  padding:"10px 12px", borderRadius:10,
                  border:`1px solid ${T.border}`, background:"transparent",
                  color:T.txt3, fontSize:12, fontWeight:600, cursor:"pointer",
                }}
              >
                Maybe later
              </button>
            </div>
            {status === "error" && (
              <div style={{ fontSize:11, color:"#E8A04C", marginTop:4 }}>
                Couldn't subscribe — check the email and try again.
              </div>
            )}
          </form>
        </>
      )}
    </div>
  );
}

// Phase 5.ag (item N) + 2026-06-01 (user feedback): extracted to a component
// so it can render ABOVE the top-picks list on the Top Picks tab. Was
// inline below "More for you this week" — moved up because Brand of Day
// is the daily-ritual hook, and burying it under the picks list buries
// the reason a user opens the app on day 2.
//
// Deterministic rotation by date: all users see the same brand on the
// same day (shareability) and it changes daily (return visits). Reads
// /public/data/editorial.json for hand-curated stories; falls back to a
// curated top-200 pool rotation when no story exists for today.
function BrandOfDayCard({ editorial, deduped, profile, openBrand }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  let story = null;
  try {
    if (editorial?.stories) {
      story = editorial.stories.find(s =>
        Array.isArray(s.displayDays) && s.displayDays.includes(todayIso)
      );
    }
  } catch {}

  // Branch 1 — editorial-curated story exists for today
  if (story) {
    const co = deduped.find(c => (c.slug || c.id) === story.slug);
    if (co) {
      const pickScore = computeScore(co, profile);
      const pickGrade = scoreGrade(pickScore, userRelevantRealCats(co, profile));
      const flavor = {
        A: { color:"#38C0CE", bgTint:"rgba(76,175,130,0.08)", borderTint:"rgba(76,175,130,0.4)", chipBg:"#0E2126" },
        B: { color:"#9CC98A", bgTint:"rgba(139,195,74,0.08)", borderTint:"rgba(139,195,74,0.4)", chipBg:"#19230F" },
        C: { color:"#E8A04C", bgTint:"rgba(240,160,48,0.08)", borderTint:"rgba(240,160,48,0.4)", chipBg:"#1F2228" },
        D: { color:"#E8A04C", bgTint:"rgba(255,112,67,0.08)", borderTint:"rgba(255,112,67,0.4)", chipBg:"#241B0D" },
        F: { color:"#E0524D", bgTint:"rgba(226,74,74,0.08)", borderTint:"rgba(226,74,74,0.4)", chipBg:"#291110" },
      }[pickGrade] || { color:"#E8A04C", bgTint:"rgba(240,160,48,0.08)", borderTint:"rgba(240,160,48,0.4)", chipBg:"#1F2228" };
      return (
        <div
          onClick={() => openBrand(co.slug || co.id, { focusDetail: false, trackEvent: "editorial_clicked", trackProps: { story_id: story.id } })}
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

  // Branch 2 — curated top-200 fallback rotation
  const day = Math.floor(Date.now() / 86_400_000);
  const JUNK = new Set(["Other","Various","NA","Uncategorized","Industrial Equipment Manufacturing","Forest Products"]);
  const wellKnown = deduped
    .filter(c => c.overall != null && c.cat && !JUNK.has(c.cat))
    .filter(c => c.logo || c.hasLogo || (c.name && c.name.length <= 30))
    .filter(c => ["A","B","C","D","F"].includes(scoreGrade(c.overall, c.realCats)))
    .sort((a, b) => {
      const score = (c) => Object.values(c.sc || {}).filter(v => v && String(v).toLowerCase() !== "neutral" && String(v).toLowerCase() !== "unknown").length;
      return score(b) - score(a);
    })
    .slice(0, 200);
  if (!wellKnown.length) return null;
  const pick = wellKnown[day % wellKnown.length];
  const pickScore = computeScore(pick, profile);
  const pickGrade = scoreGrade(pickScore, userRelevantRealCats(pick, profile));
  const flavorByGrade = {
    A: { tag: "Worth knowing", color: "#38C0CE", bgTint: "rgba(76,175,130,0.08)", borderTint: "rgba(76,175,130,0.4)" },
    B: { tag: "Worth knowing", color: "#9CC98A", bgTint: "rgba(139,195,74,0.08)", borderTint: "rgba(139,195,74,0.4)" },
    C: { tag: "Mixed signal",  color: "#E8A04C", bgTint: "rgba(240,160,48,0.08)", borderTint: "rgba(240,160,48,0.4)" },
    D: { tag: "Worth a look",  color: "#E8A04C", bgTint: "rgba(255,112,67,0.08)", borderTint: "rgba(255,112,67,0.4)" },
    F: { tag: "Worth a look",  color: "#E0524D", bgTint: "rgba(226,74,74,0.08)", borderTint: "rgba(226,74,74,0.4)" },
  };
  const fl = flavorByGrade[pickGrade] || flavorByGrade.C;
  return (
    <div
      onClick={() => openBrand(pick.slug || pick.id, { focusDetail: false, trackEvent: "brand_of_day_clicked", trackProps: { grade: pickGrade, day } })}
      style={{ margin:"12px 16px", padding:"12px 14px", background:fl.bgTint, border:`1.5px solid ${fl.borderTint}`, borderRadius:14, cursor:"pointer", display:"flex", alignItems:"center", gap:12 }}
    >
      <CompanyLogo company={pick} size={44} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:10, color:fl.color, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6 }}>Brand of the day · {fl.tag}</div>
        <div style={{ fontSize:15, fontWeight:700, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", marginTop:2 }}>{pick.name}</div>
        <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{pick.cat}</div>
      </div>
      <div style={{ padding:"6px 12px", borderRadius:10, background: pickGrade === "A" ? "#0E2126" : pickGrade === "B" ? "#19230F" : pickGrade === "C" ? "#1F2228" : pickGrade === "D" ? "#241B0D" : "#291110", color: fl.color, fontSize:18, fontWeight:800, flexShrink:0 }}>{profile ? pickGrade : "?"}</div>
    </div>
  );
}

// B-3 (2026-06-01): Weekly digest opt-in for Account screen. Sunday
// digest infra already runs via /scripts/send-weekly-digest.mjs +
// GitHub Actions cron + MailerLite campaign. This is the in-app UI
// surface where users explicitly opt in (and we get the email to send
// to). Without an explicit opt-in we don't auto-send — even if we have
// the email from a paywall, that consent was for product updates, not
// a recurring digest. Two-state toggle:
//
//   off / no email  → "Get the weekly digest" + inline email + Subscribe
//   off / has email → "Get the weekly digest" tappable card (one tap)
//   on              → "✓ You're subscribed" + Unsubscribe
function EmailDigestCard() {
  const prefilled = getStoredEmail();
  const [subscribed, setSubscribed] = useState(() => {
    try { return localStorage.getItem("tn_weeklyDigest") === "1"; }
    catch { return false; }
  });
  const [email, setEmail] = useState(prefilled || "");
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const turnOn = async () => {
    const target = email.trim() || prefilled;
    if (!target || !target.includes("@") || !target.includes(".")) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    const res = await subscribeEmail(target, "weekly_digest_optin", { weeklyDigest: true });
    setLoading(false);
    if (res.ok) {
      setSubscribed(true);
      setExpanded(false);
      try { localStorage.setItem("tn_weeklyDigest", "1"); } catch {}
      try { track("weekly_digest_subscribed"); } catch {}
    }
  };

  const turnOff = () => {
    setSubscribed(false);
    try { localStorage.setItem("tn_weeklyDigest", "0"); } catch {}
    try { track("weekly_digest_unsubscribed"); } catch {}
    // We don't auto-remove from MailerLite — that requires their unsubscribe
    // link in the email. This just hides the in-app affordance. Users can
    // hit "unsubscribe" in any digest email to fully remove.
  };

  if (subscribed) {
    return (
      <div style={{ background:T.bg2, border:`1px solid ${T.accent}`, borderRadius:16, padding:16, marginBottom:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:T.accentBg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <i className="ti ti-mail-check" style={{ fontSize:18, color:T.accent2 }} aria-hidden="true" />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt }}>Weekly digest · subscribed</div>
            <div style={{ fontSize:12, color:T.txt3, marginTop:2 }}>One email every Sunday — only when something changed.</div>
          </div>
        </div>
        <button onClick={turnOff} style={{ marginTop:12, fontSize:12, color:T.txt3, background:"none", border:"none", cursor:"pointer", textDecoration:"underline", padding:0 }}>
          Unsubscribe in-app
        </button>
      </div>
    );
  }

  return (
    <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: expanded ? 12 : 0 }}>
        <div style={{ width:36, height:36, borderRadius:10, background:T.bg3, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <i className="ti ti-mail" style={{ fontSize:18, color:T.txt3 }} aria-hidden="true" />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:T.txt }}>Weekly digest</div>
          <div style={{ fontSize:12, color:T.txt3, marginTop:2 }}>Grade changes + new recalls every Sunday. No spam.</div>
        </div>
        {!expanded && prefilled && (
          <button
            onClick={turnOn}
            disabled={loading}
            style={{ padding:"8px 14px", borderRadius:10, border:"none", background:T.accent2, color:"#000", fontSize:12, fontWeight:700, cursor: loading ? "default" : "pointer", flexShrink:0 }}
          >
            {loading ? "…" : "Subscribe"}
          </button>
        )}
        {!expanded && !prefilled && (
          <button
            onClick={() => setExpanded(true)}
            style={{ padding:"8px 14px", borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:12, fontWeight:700, cursor:"pointer", flexShrink:0 }}
          >
            Subscribe
          </button>
        )}
      </div>
      {expanded && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={loading}
            style={{
              width:"100%", boxSizing:"border-box",
              background:T.bg3, border:`1px solid ${T.border2}`,
              borderRadius:10, color:T.txt,
              fontSize:16, padding:"10px 12px",
            }}
          />
          <div style={{ display:"flex", gap:8 }}>
            <button
              onClick={turnOn}
              disabled={loading || !email.trim()}
              style={{
                flex:1, padding:"10px 12px", borderRadius:10, border:"none",
                background:T.accent2, color:"#000",
                fontSize:13, fontWeight:700,
                cursor: loading ? "default" : "pointer",
                opacity: !email.trim() ? 0.5 : 1,
              }}
            >
              {loading ? "Subscribing…" : "Subscribe"}
            </button>
            <button
              onClick={() => { setExpanded(false); setEmail(prefilled || ""); }}
              disabled={loading}
              style={{
                padding:"10px 12px", borderRadius:10,
                border:`1px solid ${T.border}`, background:"transparent",
                color:T.txt3, fontSize:12, fontWeight:600, cursor:"pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WhatsNewModal({ companyCount }) {
  // useModalA11y reads onClose, so we need dismiss declared before. Use a
  // ref that the hook reads on each Tab/ESC — declared right after show.
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
    // 2026-06-12 review fix: this was gated on sessionStorage, which iOS clears
    // on every cold launch — so the modal re-fired on each app open until the
    // user found the "Don't show again" checkbox. Gate on localStorage instead:
    // show exactly ONCE per WHATSNEW_VERSION, and again only when a new version
    // ships (which is the actual point of a "what's new" card).
    try {
      if (localStorage.getItem("tn_whatsnew_optout") === WHATSNEW_VERSION) return false;
      if (localStorage.getItem("tn_whatsnew_seen") === WHATSNEW_VERSION) return false;
      // Phase 5.ag: a first-time user just landed — "What's NEW" is meaningless
      // (they have no baseline). Suppress on the session that immediately
      // follows onboarding; show on session 2+.
      const justOnboarded = sessionStorage.getItem("tn_justOnboarded");
      if (justOnboarded) {
        const age = Date.now() - parseInt(justOnboarded, 10);
        if (age < 5 * 60 * 1000) return false; // 5-min window
      }
      return true;
    } catch { return false; }
  });
  const [dontShowAgain, setDontShowAgain] = useState(false);
  useEffect(() => {
    if (show) track("whatsnew_shown", { version: WHATSNEW_VERSION });
  }, [show]);
  // dismiss declared before the conditional return so useModalA11y can
  // see it as a stable callback at every render (rules of hooks).
  const dismiss = useCallback(() => {
    // Persist per-version so this version's card never re-fires (was sessionStorage,
    // which iOS wiped each cold launch). "Don't show again" additionally opts out
    // of future-version cards.
    try { localStorage.setItem("tn_whatsnew_seen", WHATSNEW_VERSION); } catch {}
    if (dontShowAgain) {
      try { localStorage.setItem("tn_whatsnew_optout", WHATSNEW_VERSION); } catch {}
    }
    track("whatsnew_dismissed", { version: WHATSNEW_VERSION, dontShowAgain });
    setShow(false);
  }, [dontShowAgain]);
  const dialogRef = useModalA11y({ isOpen: show, onClose: dismiss });
  if (!show) return null;
  return (
    <div ref={dialogRef} onClick={dismiss} role="dialog" aria-modal="true" aria-label="What's new" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:200, padding:"32px 12px", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:400, width:"100%", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, padding:20, color:T.txt }}>
        {/* 2026-06-01: Launch-mode rewrite. The pre-launch "what's new" was
            a dev-internal changelog ("5,000+ new companies", "new filter
            drawer"). Re-cast as a welcome / value-prop card for the wave of
            new users arriving from ProductHunt + press. Bumped
            WHATSNEW_VERSION above so returning users see it once. */}
        {/* 2026-06-01 (user feedback): swapped generic sparkles icon for
            the actual TruNorth logo mark to match the brand lockup used
            in email signatures + header + marketing landing. */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/>
            </svg>
          </div>
          <div style={{ fontSize:20, fontWeight:800, color:T.txt, letterSpacing:-0.3 }}>
            Welcome to Tru<span style={{ color:T.accent2 }}>North</span>
          </div>
        </div>
        <div style={{ background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:10, padding:"14px 16px", marginBottom:14 }}>
          <div style={{ fontSize:28, fontWeight:800, color:T.accent2, lineHeight:1.1 }}>12,000+</div>
          {/* 2026-06-01 (user feedback + audit H2): honest framing — we
              TRACK 12,000+ companies but only grade the ones with
              verified public-record signal. Top brands have full coverage. */}
          <div style={{ fontSize:13, color:T.txt2, marginTop:4, lineHeight:1.4 }}>
            Companies tracked. Top brands have full grades across 9 categories using US public records — campaign finance (FEC), environment (EPA), worker safety (OSHA), labor disputes (NLRB), and corporate filings (SEC).
          </div>
        </div>
        <ul style={{ listStyle:"none", padding:0, margin:0, fontSize:13.5, color:T.txt2, lineHeight:1.65 }}>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>No opinions — just public records.</b> Campaign donations, workplace-safety violations, environmental enforcement, corporate filings.</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom:6 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Tailored to your values.</b> The 45-second Match reweights every grade so what matters to you, counts.</span>
          </li>
          <li style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
            <i className="ti ti-circle-check-filled" style={{ color:T.accent2, marginTop:3, flexShrink:0 }} aria-hidden="true" />
            <span><b style={{ color:T.txt }}>Scan any barcode in-store.</b> See the receipt before you buy.</span>
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
  const dialogRef = useModalA11y({ isOpen: true, onClose });
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
    <div ref={dialogRef} onClick={onClose} role="dialog" aria-modal="true" aria-label="Compare brands" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:100, padding:"calc(20px + env(safe-area-inset-top, 0px)) 12px calc(20px + env(safe-area-inset-bottom, 0px))", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ maxWidth:"var(--app-max, 430px)", width:"100%", margin:"0 auto", background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, color:T.txt, display:"flex", flexDirection:"column", overflow:"hidden", maxHeight:"100%" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px 10px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ fontSize:16, fontWeight:700 }}>Versus</div>
        <button onClick={onClose} style={{ width:32, height:32, padding:0, borderRadius:8, border:"none", background:T.bg3, color:T.txt, fontSize:18, minWidth:44, minHeight:44, cursor:"pointer" }} aria-label="Close">×</button>
      </div>
      <div style={{ padding:16, overflowY:"auto", flex:1, minHeight:0, WebkitOverflowScrolling:"touch" }}>

        {resolved.length < 2 ? (
          <div>
            {/* Show the picked one + suggestions for the second slot */}
            {resolved.length === 1 && (
              <div style={{ background:T.bg2, borderRadius:12, padding:12, border:`1px solid ${T.border}`, marginBottom:14, display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:T.bg3, color:T.txt2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>{resolved[0].init || "??"}</div>
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
            {/* B64 (Aron's device repro): the 2x2 grid clipped past the modal
                edge — grid items refuse to shrink below content. One straight
                column, every row full-width. */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8 }}>
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
                    style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", color:T.txt, minWidth:0, width:"100%" }}
                  >
                    <div style={{ width:28, height:28, borderRadius:6, background:T.bg3, color:T.txt2, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, flexShrink:0 }}>{co.init || "??"}</div>
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
                const grade = scoreGrade(ps, userRelevantRealCats(co, profile));
                return (
                  <div key={co.slug} style={{ background:T.bg2, borderRadius:12, padding:12, border:`1px solid ${T.border}`, position:"relative" }}>
                    <button onClick={()=>onRemove(co.slug)} style={{ position:"absolute", top:6, right:6, width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, minWidth:44, minHeight:44, cursor:"pointer" }} aria-label="Remove">×</button>
                    <div style={{ marginBottom:6 }}><CompanyLogo company={co} size={36} rounded={8} /></div>
                    <div style={{ fontSize:14, fontWeight:700, color:T.txt, lineHeight:1.2 }}>{co.name}</div>
                    <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>{co.cat || ""}</div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:6, marginTop:8 }}>
                      <div style={{ fontSize:28, fontWeight:800, color:profile ? T.txt : T.txt3, lineHeight:1 }}>{profile ? grade : "?"}</div>
                      {isPaid && profile && ps != null && <div style={{ fontSize:12, color:T.txt3 }}>{ps}/100</div>}
                      {!profile && <div style={{ fontSize:11, color:T.txt3 }}>take the Match</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* R2 (Versus, brief flow D): one serif verdict line above the
                table — the judgment, then the receipts. Counts only categories
                where BOTH brands have data (no winning on the other's blanks). */}
            {(() => {
              const a = resolved[0], b = resolved[1];
              let aw = 0, bw = 0, n = 0;
              for (const k of CAT_KEYS) {
                if (getDataState(k, a.sc?.[k]) === "unknown" || getDataState(k, b.sc?.[k]) === "unknown") continue;
                const sa = scoreCat(k, a.sc?.[k], profile, a);
                const sb = scoreCat(k, b.sc?.[k], profile, b);
                if (sa > sb + 5) aw++; else if (sb > sa + 5) bw++;
                n++;
              }
              if (!n) return null;
              const lead = aw === bw ? null : (aw > bw ? a.name : b.name);
              return (
                <div style={{ fontFamily:SERIF, fontSize:17, color:T.txt, lineHeight:1.35, textAlign:"center", margin:"0 4px 14px" }}>
                  {lead
                    ? <>{lead} leads on {Math.max(aw, bw)} of {n} comparable {n === 1 ? "category" : "categories"}{profile ? " for you" : ""}.</>
                    : <>A dead heat across {n} comparable {n === 1 ? "category" : "categories"}.</>}
                </div>
              );
            })()}

            {/* Category-by-category comparison */}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {CAT_KEYS.map(k => {
                const a = resolved[0], b = resolved[1];
                const sa = scoreCat(k, a.sc?.[k], profile, a);
                const sb = scoreCat(k, b.sc?.[k], profile, b);
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
  // M4 (2026-06-11 privacy alignment): the old fallback chain called
  // google.com/s2/favicons + icons.duckduckgo.com per rendered brand —
  // leaking each user's browsing list to third parties, in an app marketed
  // as anonymous. Curated pipeline logoUrl or initials only. (The pipeline
  // logo harvester already bakes DuckDuckGo favicons at BUILD time where
  // useful — that lookup happens on our servers, not the user's device.)
  const providers = company?.logoUrl ? [company.logoUrl] : [];
  void domain; // retained for guessDomain callers elsewhere
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
      background:T.bg3, color:T.txt2,
    }} aria-hidden="true">{company.init}</div>
  );
  if (errored) return initialsAvatar;
  return (
    <div style={{
      width:size, height:size, borderRadius:rounded,
      background:"#F4F4F5", flexShrink:0,
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
        style={{ width:"86%", height:"86%", objectFit:"contain", filter:"drop-shadow(0 0 0.5px rgba(0,0,0,0.5))" }}
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
  //
  // 2026-06-03 (user-reported UI fix): when a category has NO real data
  // (neutral / unknown / na / empty / "?"), return EXACTLY 0.5 so the dot
  // is dead-center across every category. Previously scoreCat() applied
  // a per-category profile-influenced default, so the dot landed at
  // category-specific positions (Labor slightly left of center, Animals
  // right of center, etc.) even though the brand had no real data. Center
  // is the only honest position when we don't know.
  const raw = String(v || "").toLowerCase().trim();
  if (!raw || ["neutral","unknown","na","n/a","?"].includes(raw)) return 0.5;
  if (getDataState(k, v) === "unknown") return 0.5;

  if (k === "political") {
    const lean = raw;
    if (lean === "left")          return 0.10;
    if (lean === "left-leaning")  return 0.28;
    if (lean === "right")         return 0.90;
    if (lean === "right-leaning") return 0.72;
    if (["bipartisan","mixed"].includes(lean)) return 0.50;
    return 0.5;
  }
  // For other categories, map scoreCat()'s 0–100 to 0–1.
  // We pass a temporary profile context so the spectrum reflects the user's
  // alignment too (e.g. a "right" donator on a "left" user's profile lands
  // far-left on their personal spectrum — same as the political case).
  const sc = scoreCat(k, v, profile);
  if (sc == null) return 0.5;
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
function CategorySpectrum({ pos, leftLabel, rightLabel, axisType = "stance", unknown = false }) {
  if (pos == null) return null;
  const isUniversal = axisType === "universal";
  // 2026-06-03 (Option B): when `unknown` is set, the bar dims to a flat
  // muted background and the dot becomes a dashed-outline "?" — clearly
  // distinct from a real centered signal.
  // R2: the marker is BONE — a neutral pointer on the axis. Verdigris/oxblood
  // stay reserved for the verdict ends of universal axes (Civic Premium rule:
  // signal colors are never decoration). The old lavender dot was a
  // pre-redesign straggler Aron caught on device (Build 63 screenshot).
  const dotColor = unknown
    ? "transparent"
    : isUniversal
      ? (pos < 0.35 ? "#E0524D" : pos > 0.65 ? "#38C0CE" : "#EDE9E0")
      : "#EDE9E0";
  const gradient = unknown
    ? "#1F2228"
    : isUniversal
      ? "linear-gradient(to right, #E0524D 0%, #E0524D 22%, #555 38%, #555 62%, #38C0CE 78%, #38C0CE 100%)"
      : "linear-gradient(to right, #2A2E35 0%, #4A4E55 50%, #6E6A60 100%)";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, width:"100%", opacity: unknown ? 0.65 : 1 }}>
      <div style={{
        position:"relative", width:"100%", height:6, borderRadius:3,
        background: gradient,
      }} aria-hidden="true">
        <div style={{
          position:"absolute", top: unknown ? -4 : -3, left:`calc(${pos*100}% - ${unknown ? 7 : 6}px)`,
          width: unknown ? 14 : 12, height: unknown ? 14 : 12, borderRadius:"50%",
          background: dotColor, border: unknown ? "2px dashed #6E6A60" : "2px solid #fff",
          boxShadow: unknown ? "none" : "0 0 0 1px rgba(0,0,0,0.4)",
          display: unknown ? "flex" : "block",
          alignItems: "center", justifyContent: "center",
          color: "#6E6A60", fontSize: 8, fontWeight: 700,
        }}>{unknown ? "?" : ""}</div>
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
  labor:       { lo: "Violations",   hi: "No violations",  axisType: "universal" },
  dei:         { lo: "Limited",      hi: "Active",         axisType: "stance"    },
  animals:     { lo: "Tests",        hi: "Cruelty-free",   axisType: "stance"    },
  guns:        { lo: "Makes guns",   hi: "No guns",        axisType: "stance"    },
  privacy:     { lo: "Breaches",     hi: "No breaches",    axisType: "universal" },
  execPay:     { lo: ">300:1",       hi: "<50:1",          axisType: "stance"    },
};

// 2026-06-03 (Option B): mixed UI — sliders for continuous spectrums,
// badges for categorical fields.
//
// A "slider" axis (Environment, Labor, Privacy, Exec pay, Political) has a
// real ordering from one end to the other and a known position. A "badge"
// axis (Charity, DEI, Animals, Firearms) has DISCRETE STATES that can't
// honestly be placed on a continuous scale — "Active Giving" isn't "60% of
// the way between No record and the right side"; it's an unambiguous state.
// Sliders pretended otherwise and made a centered dot look like a real
// signal when it actually meant "we don't know."
const CATEGORY_UI_TYPE = {
  political:   "slider",
  environment: "slider",
  labor:       "slider",
  privacy:     "slider",
  execPay:     "slider",
  charity:     "badge",
  dei:         "badge",
  animals:     "badge",
  guns:        "badge",
};

// Badge-state definitions for categorical categories. Each entry:
//   match(co): which sc value(s) or evidence keys trigger this badge
//   label: text shown on the pill
//   tone:  visual color — "good" | "bad" | "warn" | "neutral" | "muted"
//
// IMPORTANT: tones describe the SIGNAL itself (action vs. absence), NOT a
// verdict. Whether a tone is "good for the user" depends on their profile;
// that's already reflected in the row's overall grade. The tone here is
// just an axis-relative read: action (good=accent), opposition (bad=red),
// mixed (warn=amber), no data (muted).
const CATEGORY_BADGES = {
  charity: {
    states: [
      { key: "active",  label: "Active giving",   tone: "good",
        match: (co) => {
          const v = (co.sc?.charity || "").toLowerCase();
          if (["active_giving","positive","excellent","strong","good"].includes(v)) return true;
          if (co.charity_irs990?.totalGrants > 0) return true;
          return false;
        } },
      { key: "norec",   label: "No public record", tone: "muted",
        match: (co) => {
          const v = (co.sc?.charity || "").toLowerCase();
          return ["","neutral","mixed"].includes(v);
        } },
      { key: "unknown", label: "Unknown",         tone: "muted",
        match: (co) => getDataState("charity", co.sc?.charity) === "unknown" },
    ],
  },
  dei: {
    states: [
      { key: "active",  label: "Active programs", tone: "good",
        match: (co) => {
          const v = (co.sc?.dei || "").toLowerCase();
          if (v === "pro_dei") return true;
          if (Array.isArray(co.deiBadges) && co.deiBadges.length > 0) return true;
          return false;
        } },
      { key: "mixed",   label: "Mixed signals",   tone: "warn",
        match: (co) => (co.sc?.dei || "").toLowerCase() === "mixed" },
      { key: "rolled",  label: "Rolled back",     tone: "bad",
        match: (co) => (co.sc?.dei || "").toLowerCase() === "anti_dei" },
      { key: "unknown", label: "Unknown",         tone: "muted",
        match: (co) => {
          const v = (co.sc?.dei || "").toLowerCase();
          if (Array.isArray(co.deiBadges) && co.deiBadges.length > 0) return false;
          return ["","neutral"].includes(v);
        } },
    ],
  },
  animals: {
    // Third-party certification evidence (Leaping Bunny / PETA Beauty Without
    // Bunnies — B-14) is listed FIRST so it overrides the AI-narrative-based
    // co.sc.animals value when present. The badge resolver returns the first
    // matching state, so a third-party pledge always beats AI inference.
    // See scripts/cruelty-free-merge.mjs for the evidence pipeline.
    states: [
      { key: "cruelty_free_certified", label: "Cruelty-free certified", tone: "good",
        match: (co) => {
          const cf = co.enriched?.cruelty_free;
          return !!(cf && (cf.leaping_bunny === true || cf.peta_dont_test === true));
        } },
      { key: "tests_on_animals",       label: "Confirmed animal testing", tone: "bad",
        match: (co) => co.enriched?.cruelty_free?.peta_do_test === true },
      { key: "cruelty_free", label: "Cruelty-free",       tone: "good",
        match: (co) => (co.sc?.animals || "").toLowerCase() === "cruelty_free" },
      { key: "some",         label: "Some testing",       tone: "warn",
        match: (co) => (co.sc?.animals || "").toLowerCase() === "some_testing" },
      { key: "tests",        label: "Documents testing",  tone: "bad",
        match: (co) => (co.sc?.animals || "").toLowerCase() === "tests_animals" },
      { key: "na",           label: "Not applicable",     tone: "neutral",
        match: (co) => ["na","n/a"].includes((co.sc?.animals || "").toLowerCase()) },
      { key: "unknown",      label: "Unknown",            tone: "muted",
        match: (co) => {
          const v = (co.sc?.animals || "").toLowerCase();
          return ["","neutral","unknown","?"].includes(v);
        } },
    ],
  },
  guns: {
    states: [
      { key: "no_guns",     label: "Does not sell",      tone: "good",
        match: (co) => (co.sc?.guns || "").toLowerCase() === "no_guns" },
      { key: "sells_guns",  label: "Sells firearms",     tone: "warn",
        match: (co) => {
          const v = (co.sc?.guns || "").toLowerCase();
          if (v === "sells_guns") return true;
          // ATF FFL evidence override: brand has active dealer licenses
          if (co.firearms_atf_ffl?.licenseCount > 0 && (co.firearms_atf_ffl?.primaryRole === "dealer" || !co.firearms_atf_ffl?.primaryRole)) return true;
          return false;
        } },
      { key: "makes_guns",  label: "Manufactures",       tone: "bad",
        match: (co) => {
          const v = (co.sc?.guns || "").toLowerCase();
          if (v === "makes_guns") return true;
          if (co.firearms_atf_ffl?.primaryRole === "manufacturer") return true;
          return false;
        } },
      { key: "na",          label: "Not applicable",     tone: "neutral",
        match: (co) => ["na","n/a"].includes((co.sc?.guns || "").toLowerCase()) && !co.firearms_atf_ffl?.licenseCount },
      { key: "unknown",     label: "Unknown",            tone: "muted",
        match: (co) => {
          const v = (co.sc?.guns || "").toLowerCase();
          if (co.firearms_atf_ffl?.licenseCount > 0) return false;
          return ["","neutral","unknown","?"].includes(v);
        } },
    ],
  },
};

// Resolve which state(s) a company falls into for a given badge category.
// Returns the FIRST matching state (states are ordered most-specific first).
function resolveBadgeState(k, co) {
  const def = CATEGORY_BADGES[k];
  if (!def) return null;
  for (const s of def.states) {
    try { if (s.match(co)) return s; } catch { /* swallow — fall through */ }
  }
  // Fallback to "unknown" if no rule matched (shouldn't happen if rules cover all cases)
  return def.states.find(s => s.key === "unknown") || def.states[def.states.length - 1];
}

// B-15 — Industry-membership flags. Read-only disclosure pills shown near
// the top of the brand-detail card. NOT score modifiers — users decide what
// matters. Data lives in co.industry_flags, written by scripts/industry-flags.mjs.
// Flip SHOW_INDUSTRY_FLAGS to false to globally hide the row if a category
// proves controversial post-launch.
const SHOW_INDUSTRY_FLAGS = true;
const INDUSTRY_FLAG_PILLS = [
  { key: "tobacco",           label: "Tobacco industry",     icon: "ti-cigarette",      color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  { key: "fossil_fuel",       label: "Fossil-fuel industry", icon: "ti-flame",          color: "#fb923c", bg: "rgba(251,146,60,0.12)"  },
  { key: "firearms_industry", label: "Firearms industry",    icon: "ti-target",         color: "#ef4444", bg: "rgba(239,68,68,0.12)"   },
  { key: "alcohol",           label: "Alcohol industry",     icon: "ti-glass-cocktail", color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
];

function IndustryFlagsRow({ company }) {
  if (!SHOW_INDUSTRY_FLAGS) return null;
  const f = company?.industry_flags;
  if (!f) return null;
  const active = INDUSTRY_FLAG_PILLS.filter(p => f[p.key] === true);
  if (active.length === 0) return null;
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
      {active.map(p => (
        <span key={p.key}
          title={`Curated industry-membership flag. Public disclosure only; not a score modifier.`}
          style={{
            display:"inline-flex", alignItems:"center", gap:5,
            padding:"4px 9px",
            fontSize:11, fontWeight:600,
            borderRadius:999,
            background: p.bg,
            border:`1px solid ${p.color}`,
            color: p.color,
            letterSpacing:0.2,
            whiteSpace:"nowrap",
          }}>
          <i className={`ti ${p.icon}`} aria-hidden="true" style={{ fontSize:12 }} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

// CategoryBadgeRow — renders all possible states as muted pills, with the
// active state highlighted by tone. Replaces the spectrum bar for categorical
// categories.
function CategoryBadgeRow({ cat: k, company }) {
  const def = CATEGORY_BADGES[k];
  if (!def) return null;
  const active = resolveBadgeState(k, company);
  const toneStyles = {
    good:    { bg:"rgba(52,210,126,0.15)",  bd:"#34d27e", fg:"#34d27e" },
    bad:     { bg:"rgba(255,110,110,0.15)", bd:"#ff6e6e", fg:"#ff6e6e" },
    warn:    { bg:"rgba(255,186,77,0.15)",  bd:"#ffba4d", fg:"#ffba4d" },
    neutral: { bg:"rgba(155,143,240,0.10)", bd:T.accent,  fg:T.accent2 },
    muted:   { bg:"transparent",            bd:T.border,  fg:T.txt3 },
  };
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap", width:"100%" }}>
      {def.states.map(s => {
        const isActive = active && active.key === s.key;
        const tone = isActive ? toneStyles[s.tone] || toneStyles.neutral : toneStyles.muted;
        return (
          <span key={s.key}
            style={{
              padding:"5px 10px",
              fontSize:11,
              fontWeight: isActive ? 700 : 500,
              borderRadius:999,
              background: tone.bg,
              border:`1px solid ${tone.bd}`,
              color: tone.fg,
              letterSpacing:0.2,
              whiteSpace:"nowrap",
            }}>
            {isActive ? "●  " : ""}{s.label}
          </span>
        );
      })}
    </div>
  );
}

function CategoryRow({ cat: k, enriched, profile }) {
  const [expanded, setExpanded] = useState(false);
  const v = enriched.sc?.[k];
  const d = enriched[k] || {};
  const state = getDataState(k, v);
  const uiType = CATEGORY_UI_TYPE[k] || "slider";
  const isBadge = uiType === "badge";

  // PR-3: per-category render decision based on the `flags` block written by
  // scripts/reflag-categories.mjs. Gated on the global scoring-flags feature
  // flag — when OFF this is always `{kind: "default"}` and the component
  // renders exactly today's UI.
  const flagRender = getCategoryFlagRender(enriched.flags, k, featureFlagsEnabled());
  const isFlagNa            = flagRender.kind === "na";
  const isFlagNotDisclosed  = flagRender.kind === "notDisclosed";
  const isFlagInferred      = flagRender.kind === "inferred";

  // For badge categories, "unknown" is just one of the displayable states —
  // we always render the badge row so the user can see all possible values.
  // For sliders, "unknown" means we draw a muted bar with a dashed dot.
  const isUnknown = !isBadge && state === "unknown";

  const disp = getDisplay(k, v, profile);
  const pos = categorySpectrumPos(k, v, profile);
  const labels = SPECTRUM_LABELS[k];
  const badgeState = isBadge ? resolveBadgeState(k, enriched) : null;
  const badgeIsUnknown = badgeState?.key === "unknown";

  // 2026-06-03 (user-reported): if the bar moves (sc has a real value)
  // but the detail text says "No public record found.", the UI
  // contradicts itself — we have *some* signal but display says we
  // don't. Detect this and rewrite the text to acknowledge the
  // directional signal without overstating the evidence.
  const literalNoRecord = /^\s*no public record found\.?\s*$/i.test(String(d?.s || ""));
  const sNarrative = literalNoRecord && !isUnknown && !badgeIsUnknown
    ? "Signal inferred from corporate behavior and public sources — no specific filing or enforcement record in our datasets."
    : stripCites(d.s || d.summary || "");

  // Phase 5.aa: vertical-stacked layout. Top row is just icon + name + chevron;
  // the spectrum bar (or badge row) lives on its own line below so long names
  // like "DEI & social equity" don't wrap or get overlapped.
  //
  // 2026-06-03 (Option B): for categorical categories we render a CategoryBadgeRow
  // instead of a slider. The badge row always shows ALL possible states so
  // the user understands the axis at a glance; the active state is colored.
  // PR-3: na/notDisclosed visually collapse to the same greyed treatment as
  // existing "No data" rows — they're functionally the same thing (no score
  // circle, dimmed) but carry richer copy in the inline label.
  const isFlagSuppressed = isFlagNa || isFlagNotDisclosed;
  const rowDimmed = isUnknown || (isBadge && badgeIsUnknown) || isFlagSuppressed;
  const flagInlineLabel = isFlagSuppressed ? flagRender.label : null;
  return (
    <div style={{ marginBottom:10, paddingBottom:10, borderBottom:`1px solid ${T.border}`, opacity: rowDimmed ? 0.7 : 1 }}>
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        style={{ display:"block", padding:"6px 0", background:"none", border:"none", cursor:"pointer", color:T.txt, width:"100%", textAlign:"left" }}
      >
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
          <i className={`ti ${CAT_ICONS[k]}`} style={{ fontSize:16, color:T.txt3, width:18, flexShrink:0 }} aria-hidden="true" />
          <div style={{ fontSize:13, fontWeight:600, color:T.txt2, letterSpacing:0.2, flex:1, minWidth:0 }}>{CAT_FULL[k]}</div>
          {/* PR-3: prefer flag-driven copy ("Not Applicable for this Industry",
              "Private company — exec comp not publicly disclosed", etc.) over
              the generic "No data" pill when a flag is set. */}
          {flagInlineLabel ? (
            <span style={{ fontSize:11, color:T.txt3, fontStyle:"italic", marginRight:6 }}>{flagInlineLabel}</span>
          ) : rowDimmed ? (
            <span style={{ fontSize:11, color:T.txt3, fontStyle:"italic", marginRight:6 }}>No data</span>
          ) : isFlagInferred ? (
            <span
              title={`Industry typical — based on ${flagRender.basis || "sector"}`}
              aria-label={`Industry typical — based on ${flagRender.basis || "sector"}`}
              style={{ fontSize:11, color:T.txt3, marginRight:6, cursor:"help" }}
            >
              <i className="ti ti-info-circle" aria-hidden="true" /> Industry typical
            </span>
          ) : null}
          <i className={`ti ${expanded ? "ti-chevron-up" : "ti-chevron-down"}`} style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
        </div>
        <div style={{ paddingLeft:28, paddingRight:4 }}>
          {/* PR-3: flag-suppressed rows render NO score circle / no spectrum —
              they're factually "not applicable" or "no disclosure", so showing
              a position bar would be misleading. */}
          {isFlagSuppressed ? null : isBadge ? (
            <CategoryBadgeRow cat={k} company={enriched} />
          ) : isUnknown ? (
            <CategorySpectrum pos={0.5} leftLabel={labels?.lo || ""} rightLabel={labels?.hi || ""} axisType={labels?.axisType || "stance"} unknown />
          ) : (
            <CategorySpectrum pos={pos} leftLabel={labels?.lo || ""} rightLabel={labels?.hi || ""} axisType={labels?.axisType || "stance"} />
          )}
        </div>
      </button>
      {expanded && (
        <div style={{ paddingTop:8, paddingLeft:28 }}>
          {isFlagSuppressed ? (
            <div style={{ fontSize:11, color:T.txt3, fontStyle:"italic" }}>
              {flagRender.label} — this category is excluded from the overall grade.
            </div>
          ) : !isUnknown ? (
            <>
              <div style={{ fontSize:13, color:T.txt2, lineHeight:1.6 }}>{sNarrative}</div>
              {/* B-30: surface "active enforcement" badge on the labor row when
                  VT v2 saw a penalty assessed in the last 6 months.  Render
                  inline above the Signal line.  Silent if vt v2 isn't merged. */}
              {k === "labor" && (() => {
                const vt = enriched.violationTracker || enriched.laborAPI?.violationTracker;
                if (!vt?.active_last_6mo) return null;
                return (
                  <div style={{ marginTop:6, display:"inline-flex", alignItems:"center", gap:6, padding:"2px 8px", fontSize:11, borderRadius:20, background:T.rep, color:"#fff", fontWeight:600 }}>
                    <i className="ti ti-flame" aria-hidden="true" /> Active enforcement in last 6 mo
                  </div>
                );
              })()}
              {!isUnknown && disp?.label && (
                <div style={{ marginTop:6, fontSize:11, color:T.txt3 }}>
                  Signal: <span style={{ color:T.txt2, fontWeight:600 }}>{disp.label}</span>
                </div>
              )}
              {(() => {
                // B64 (Aron): internal synthesis labels never render — the
                // user-facing promise is public records; tooling names are
                // noise that reads as contradiction. Real source names
                // (sec-def14a, corporate-giving, EPA ECHO…) still show.
                const vis = (d.sources || []).filter(src => !/claude|ai synthesis/i.test(String(src)));
                if (!vis.length) return null;
                return (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:6 }}>
                    {vis.map(src => <span key={src} style={{ padding:"2px 7px", fontSize:10, borderRadius:20, background:T.accentBg, color:T.accent2, border:`1px solid ${T.accent}` }}>{src}</span>)}
                  </div>
                );
              })()}
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
const CompanyCard = React.memo(function CompanyCard({ company, catFilter, profile, isPaid, onUpgrade, isSaved, onToggleSave, inCompare, onToggleCompare, onCompareWith, onNavigate, allCompanies, initiallyOpen, onConsumedDeepLink, onCommitSwitch }) {
  const [open, setOpen]     = useState(!!initiallyOpen);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // M5 (2026-06-11): when the detail fetch fails (offline / 404), the card
  // used to render "No public record found yet" for every category — a
  // FACTUAL CLAIM this app must never make in an error state. Track the
  // failure and render a retry block instead.
  const [detailError, setDetailError] = useState(false);
  // R2 (the Switch): null → idle · {to,toName} → asking spend · "done"
  const [switchSheet, setSwitchSheet] = useState(null);

  // QA fix 2026-06-10: tell the deep-link effect its slug was consumed so it
  // stops marking this brand initiallyOpen on future list re-mounts.
  useEffect(() => {
    if (initiallyOpen) onConsumedDeepLink?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 3.1: when running in split-bundle mode, the row-level `company`
  // only has the compact shape (no narrative/sources). On expand, lazy-load
  // the per-company JSON and merge it in. Use `enriched` everywhere below.
  const enriched = detail || company;
  const ps = computeScore(enriched, profile);
  const grade = scoreGrade(ps, userRelevantRealCats(enriched, profile));

  // QA CRITICAL fix 2026-06-10: cards opened ALREADY-EXPANDED (deep links,
  // universal links, scanner match, Better-Alts navigation → initiallyOpen)
  // never ran handleTap, so the detail JSON was never fetched and every
  // category showed "No public record found yet." This effect makes the
  // fetch follow `open` regardless of HOW the card was opened. handleTap's
  // own fetch remains as a fast-path; the !detail/!loadingDetail guards
  // make the two idempotent.
  useEffect(() => {
    if (!open) return;
    if (!isSplitBundleEnabled() || !company.slug) return;
    if (detail || loadingDetail) return;
    let cancelled = false;
    setLoadingDetail(true);
    loadCompanyDetail(company.slug)
      .then(d => { if (!cancelled) { setDetail(d); setDetailError(false); } })
      .catch(err => { console.error("[dataSource] detail fetch failed for", company.slug, err); if (!cancelled) setDetailError(true); })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company.slug]);

  const handleTap = () => {
    // 2026-06-01 (user pick), updated: 1 free company view per DAY, then paywall.
    // Refined from the previous "0 free / paywall on first tap" — that was
    // too aggressive; users couldn't even sample the product before being
    // gated. 1 free view lets them experience the depth of one brand
    // profile, builds the desire, then the paywall asks for $1.99/mo to
    // unlock the rest. Cooldown preserved so dismissers can browse for 4h.
    //
    // Re-opening an already-viewed company doesn't punish the user.
    if (!isPaid && !open) {
      const slug = company.slug || company.id;
      const now = new Date();
      // 2026-06-01 (user pick): switched from 1 free view/week → 1 free
      // view/day. Same field name `log.week` retained but it now holds a
      // YYYY-MM-DD day key.
      // QA fix 2026-06-10: was toISOString() (UTC) — for US users the free
      // view reset at 7-8pm local, granting two views some calendar days and
      // a confusing mid-evening reset. Local-date key resets at the user's
      // own midnight.
      const dayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      let log = {};
      try { log = JSON.parse(localStorage.getItem("tn_freeViewed") || "{}"); } catch {}
      if (log.week !== dayKey) log = { week: dayKey, slugs: [] };
      // H1 fix (audit 2026-06-01): cooldown was sessionStorage (clears on tab
      // close → mobile web reopens evict it instantly → paywall fired every
      // tap, training users to dismiss reflexively). Now localStorage with a
      // 7-day window: dismiss once, get the rest of the free-quota week
      // uninterrupted.
      const dismissedAt = Number(localStorage.getItem("tn_paywallDismissedAt") || 0);
      const inCooldown = dismissedAt && (Date.now() - dismissedAt) < 7 * 24 * 60 * 60 * 1000;
      const alreadyViewed = log.slugs.includes(slug);
      // 1 free view per week: paywall fires on the 2nd unique tap.
      if (!alreadyViewed && log.slugs.length >= 1 && !inCooldown) {
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
            .then(d => { setDetail(d); setDetailError(false); })
            .catch(err => { console.error("[dataSource] detail fetch failed for", company.slug, err); setDetailError(true); })
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
              A: { bg:"#0E2126", border:"#1E444A", text:"#38C0CE" },
              B: { bg:"#19230F", border:"#2E4A1E", text:"#9CC98A" },
              C: { bg:"#1F2228", border:"#2A2E35", text:"#E8A04C" },
              D: { bg:"#241B0D", border:"#4A381E", text:"#E8A04C" },
              F: { bg:"#291110", border:"#4A1E1E", text:"#E0524D" },
              "?": { bg:T.bg3, border:T.border2, text:T.txt3 },
            };
            const rc = gradeRowColors[profile ? grade : "?"];
            return (
              <div style={{ width:38, height:38, borderRadius:10, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:rc.bg, border:`1px solid ${rc.border}` }} title={profile ? "Your personalized grade" : "Take the Match to see grades"}>
                <div style={{ fontSize:isPaid?17:22, fontWeight:700, color:rc.text, lineHeight:1 }}>{profile ? grade : "?"}</div>
                {isPaid && profile && <div style={{ fontSize:10, color:rc.text, opacity:0.7 }}>{ps}</div>}
              </div>
            );
          })()}
          <i className={`ti ${open ? "ti-chevron-up" : "ti-chevron-down"}`} style={{fontSize:13,color:T.txt3}} aria-hidden="true" />
        </div>
      </div>

      {/* Detail — CRITICAL FIX 2026-06-01 (audit): was `open && isPaid &&` which
          gated the entire detail panel on Pro, so free users got nothing when
          they tapped a brand (despite onboarding promising 1 free view/week).
          Now: any expanded row shows the detail. Sources / per-grade citations
          / personalized scores remain individually paywalled below. */}
      {open && (
        <div style={{ borderTop:`1px solid ${T.border}`, padding:14, background:T.bg2 }}>
          {/* Phase 3.1: thin loading bar while we fetch full detail */}
          {loadingDetail && (
            <div style={{ height:2, background:T.accent, opacity:0.5, marginBottom:12, borderRadius:1, animation:"pulse 1.5s ease-in-out infinite" }} aria-label="Loading details" />
          )}
          {/* M5: fetch failed — say so honestly and offer retry. Never let an
              error state read as "no public record" (that's an assertion). */}
          {detailError && !detail && !loadingDetail && (
            <div style={{ padding:"14px 12px", textAlign:"center", marginBottom:10, background:T.bg3, border:`1px solid ${T.border2}`, borderRadius:12 }}>
              <div style={{ fontSize:13, fontWeight:600, color:T.txt2, marginBottom:4 }}>
                <i className="ti ti-wifi-off" aria-hidden="true" style={{ marginRight:6 }} />
                Couldn't load this company's records
              </div>
              <div style={{ fontSize:12, color:T.txt3, marginBottom:10 }}>Check your connection — the records are still there.</div>
              <button
                onClick={() => {
                  setDetailError(false);
                  setLoadingDetail(true);
                  loadCompanyDetail(company.slug)
                    .then(d => { setDetail(d); setDetailError(false); })
                    .catch(() => setDetailError(true))
                    .finally(() => setLoadingDetail(false));
                }}
                style={{ padding:"8px 18px", borderRadius:10, border:`1px solid ${T.accent}`, background:"transparent", color:T.accent2, fontSize:12, fontWeight:700, cursor:"pointer", minHeight:36 }}
              >Retry</button>
            </div>
          )}
          {/* R2 (Lens, brief §3.2): THE VERDICT — one serif sentence + up to
              three mono receipt lines. The card opens with the judgment and
              its proof; everything below is supporting detail. */}
          {(() => {
            const sentence = verdictSentence(enriched, profile, profile ? grade : (enriched.overall != null ? scoreGrade(enriched.overall, enriched.realCats) : "?"));
            const receipts = receiptLines(enriched);
            if (!sentence && !receipts.length) return null;
            return (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: SERIF, fontSize: 18.5, color: T.txt, lineHeight: 1.35 }}>{sentence}</div>
                {receipts.length > 0 && (
                  <div style={{ marginTop: 9 }}>
                    {receipts.map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0", borderBottom: i < receipts.length - 1 ? `1px dashed ${T.border}` : "none", fontFamily: MONO, fontSize: 10.5, color: T.txt2, minWidth: 0 }}>
                        <span style={{ color: T.gold, fontWeight: 600, flexShrink: 0, letterSpacing: "0.04em" }}>{r.src}</span>
                        {r.date && <span style={{ color: T.txt3, flexShrink: 0 }}>{r.date}</span>}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.text}</span>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            aria-label={`Open ${r.src} source record`}
                            style={{ color: T.gold, textDecoration: "none", flexShrink: 0 }}>↗</a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Federal penalty callout. Phase 4.11: now triggers on the FACT
              (≥$5M in penalties), not the app's grade verdict. Lets users
              see the raw data and decide for themselves. */}
          {(() => {
            // B-30 (VT v2): VT lives at two paths historically — root and
            // laborAPI.  Read both, prefer the richer one.
            const vt = enriched.violationTracker || enriched.laborAPI?.violationTracker;
            const hasSignificantPenalty = vt && vt.totalPenalty && vt.totalPenalty >= 5_000_000; // ≥$5M
            if (!hasSignificantPenalty) return null;
            const penFmt = vt.totalPenalty >= 1e9
              ? `$${(vt.totalPenalty/1e9).toFixed(2)}B`
              : `$${(vt.totalPenalty/1e6).toFixed(1)}M`;
            const topOffense = vt.primaryOffenses?.[0]?.category;
            // B-30 NEW fields. All four are optional — UI degrades cleanly when
            // any (or all) are absent, so v1-only brands render exactly as before.
            const active = vt.active_last_6mo === true;
            const byState = vt.violations_by_state && Object.keys(vt.violations_by_state).length
              ? Object.entries(vt.violations_by_state).sort((a, b) => b[1] - a[1]).slice(0, 3)
              : null;
            const recent = Array.isArray(vt.recent_top5) ? vt.recent_top5.slice(0, 3) : null;
            const yoy = vt.yoy_trend && typeof vt.yoy_trend === "object" ? vt.yoy_trend : null;
            const fmtShort = (n) => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B`
                                : n >= 1e6 ? `$${(n/1e6).toFixed(1)}M`
                                : n >= 1e3 ? `$${(n/1e3).toFixed(0)}K`
                                : `$${n}`;
            return (
              <div style={{ background:"#291110", border:`1px solid ${T.rep}`, borderRadius:10, padding:"10px 12px", marginBottom:12, display:"flex", alignItems:"flex-start", gap:10 }}>
                <i className="ti ti-alert-triangle" style={{ fontSize:18, color:T.rep, flexShrink:0, marginTop:1 }} aria-hidden="true" />
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:T.rep, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:2, display:"flex", alignItems:"center", gap:6 }}>
                    Federal penalties
                    {active && (
                      <span title="A penalty was assessed within the last 6 months." style={{ fontSize:9, fontWeight:700, padding:"1px 6px", borderRadius:10, background:T.rep, color:"#fff", letterSpacing:"0.04em" }}>
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:14, fontWeight:600, color:T.txt, lineHeight:1.3 }}>
                    {penFmt} across {vt.totalRecords} record{vt.totalRecords === 1 ? "" : "s"}
                  </div>
                  {topOffense && (
                    <div style={{ fontSize:11, color:T.txt3, marginTop:3, lineHeight:1.4 }}>
                      Top offense: {topOffense}
                    </div>
                  )}
                  {byState && (
                    <div style={{ fontSize:11, color:T.txt3, marginTop:3, lineHeight:1.4 }}>
                      Top states: {byState.map(([st, amt]) => `${st} ${fmtShort(amt)}`).join(" · ")}
                    </div>
                  )}
                  {recent && recent.length > 0 && (
                    <div style={{ fontSize:11, color:T.txt3, marginTop:5, lineHeight:1.4 }}>
                      <div style={{ fontWeight:600, color:T.txt2, marginBottom:2 }}>Recent enforcement</div>
                      {recent.map((r, i) => (
                        <div key={i} style={{ display:"flex", gap:6, opacity:0.9 }}>
                          <span style={{ minWidth:64 }}>{r.date}</span>
                          <span>{r.agency}</span>
                          <span style={{ marginLeft:"auto", color:T.txt2 }}>{fmtShort(r.penalty)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {yoy && Object.keys(yoy).length >= 2 && (() => {
                    const years = Object.keys(yoy).map(Number).sort();
                    const max = Math.max(...years.map(y => yoy[y] || 0)) || 1;
                    return (
                      <div style={{ marginTop:6 }}>
                        <div style={{ fontSize:10, color:T.txt3, marginBottom:2 }}>5-yr trend</div>
                        <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:18 }}>
                          {years.map(y => (
                            <div key={y} title={`${y}: ${fmtShort(yoy[y]||0)}`} style={{ flex:1, height: `${Math.max(2, ((yoy[y]||0)/max)*18)}px`, background:T.rep, opacity:0.65, borderRadius:1 }} />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
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
            // Build 54 (Aron call): show "Better for your values" on EVERY
            // brand-detail card when meaningfully-better alternatives exist —
            // not just C/D/F. Even an A-grade brand might have an A+ competitor
            // for this user. If no alternatives beat ps+7, fall through to the
            // neutral "Direct competitors" chips (still useful for browsing).
            const hasBetterAlts = profile
              ? competitorsResolved
                  .map(c => ({ co: c, score: computeScore(c, profile) }))
                  .filter(x => x.score >= ps + 7).length > 0
              : false;
            const display = profile
              ? competitorsResolved
                  .map(c => ({ co: c, score: computeScore(c, profile) }))
                  .filter(x => x.score >= ps + 7)
                  .sort((a, b) => b.score - a.score)
                  .slice(0, 3)
              : competitorsResolved.slice(0, 4).map(c => ({ co: c, score: c.overall }));
            if (!display.length) return null;
            // Profile + at-least-one-better-alt → green "Better for your values"
            // panel. Otherwise (no profile, or this brand IS the local best) →
            // neutral "Direct competitors" chips.
            if (hasBetterAlts) {
              return (
                <div style={{ background:"rgba(76,175,130,0.08)", border:"1.5px solid rgba(76,175,130,0.4)", borderRadius:12, padding:"12px 14px", marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#38C0CE", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
                    <i className="ti ti-arrow-up-right" aria-hidden="true" /> Better for your values
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {display.map(({ co: alt, score: altScore }) => {
                      const altGrade = scoreGrade(altScore, userRelevantRealCats(alt, profile));
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
                          <div style={{ padding:"4px 10px", borderRadius:8, background:altGrade === "A" ? "#0E2126" : "#19230F", color: altGrade === "A" ? "#38C0CE" : "#9CC98A", fontSize:13, fontWeight:700 }}>{altGrade}</div>
                          <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                  {/* R2 (the Switch): commit the swap right where the better
                      option is staring at you. Spend is asked ONCE, about the
                      brand being left — that's the dollars redirected. */}
                  {onCommitSwitch && (
                    switchSheet === "done" ? (
                      <div style={{ marginTop:10, padding:"10px 12px", borderRadius:10, background:T.accentBg, border:`1px solid ${T.accent}`, fontSize:12, color:T.accent2, fontWeight:600, display:"flex", alignItems:"center", gap:7 }}>
                        <i className="ti ti-check" aria-hidden="true" /> Switch logged — counted in your Basket.
                      </div>
                    ) : switchSheet ? (
                      <div style={{ marginTop:10, padding:"10px 12px", borderRadius:10, background:T.bg3, border:`1px solid ${T.border2}` }}>
                        <div style={{ fontSize:12, color:T.txt2, marginBottom:8 }}>About how much do you spend on <strong style={{ color:T.txt }}>{enriched.name}</strong> a month?</div>
                        <div style={{ display:"flex", gap:6 }}>
                          {[10, 25, 50, 100].map(amt => (
                            <button key={amt}
                              onClick={(e) => { e.stopPropagation(); onCommitSwitch(enriched.slug || enriched.id, enriched.name, switchSheet.to, switchSheet.toName, amt); setSwitchSheet("done"); }}
                              style={{ flex:1, padding:"9px 4px", borderRadius:9, background:T.bg2, border:`1px solid ${T.border}`, color:T.txt, fontFamily:MONO, fontSize:13, fontWeight:600, cursor:"pointer" }}>
                              ${amt}
                            </button>
                          ))}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onCommitSwitch(enriched.slug || enriched.id, enriched.name, switchSheet.to, switchSheet.toName, 0); setSwitchSheet("done"); }}
                          style={{ marginTop:7, background:"none", border:"none", color:T.txt3, fontSize:11, cursor:"pointer", padding:0, textDecoration:"underline" }}>
                          Not sure — log it without an amount
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); const best = display[0].co; setSwitchSheet({ to: best.slug || best.id, toName: best.name }); track("switch_started", { from: enriched.slug || enriched.id, to: best.slug || best.id }); }}
                        style={{ marginTop:10, width:"100%", padding:"12px 10px", borderRadius:11, background:"#EDE9E0", border:"none", color:"#111", fontSize:13.5, fontWeight:700, cursor:"pointer" }}>
                        Make the switch → {display[0].co.name}
                      </button>
                    )
                  )}
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
              A: { bg:"#0E2126", border:"#38C0CE", text:"#38C0CE" },
              B: { bg:"#19230F", border:"#9CC98A", text:"#9CC98A" },
              C: { bg:"#1F2228", border:"#E8A04C", text:"#E8A04C" },
              D: { bg:"#241B0D", border:"#E8A04C", text:"#E8A04C" },
              F: { bg:"#291110", border:"#E0524D", text:"#E0524D" },
              "?": { bg:T.bg3, border:T.border2, text:T.txt3 },
            };
            const gc = gradeColors[profile ? grade : "?"];
            return (
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:18, padding:"14px 14px 16px", background:T.bg3, borderRadius:14, border:`1px solid ${T.border}` }}>
                {/* R1 (Compass redesign): the verdict SEAL replaces the grade
                    circle — spoke length = this user's alignment per axis,
                    worst sub-threshold axis fractures oxblood, grade engraved
                    center. Static in R1; needle-settle motion lands in R3. */}
                {(() => {
                  const sealValues = {};
                  for (const k of COMPASS_AXES) {
                    const v = enriched.sc?.[k];
                    const lv = String(v || "").toLowerCase();
                    const hasCsc = enriched.csc && typeof enriched.csc[k] === "number";
                    // B64: stanced-dei recognition draws the dei arc too.
                    const deiEv = k === "dei" && profile?.deiLean && profile.deiLean !== "neutral" && deiEvidence(enriched);
                    if (enriched.flags?.[k]?.na) continue;
                    if ((getDataState(k, v) === "unknown" || lv === "neutral") && !hasCsc && !deiEv) continue;
                    if (lv === "na" || lv === "n/a") continue;
                    if (Array.isArray(enriched.excl) && enriched.excl.includes(k) && !deiEv) continue;
                    sealValues[k] = scoreCat(k, v, profile, enriched);
                  }
                  return (
                    <div style={{ flexShrink:0 }}>
                      <CompassSeal values={sealValues} grade={profile ? grade : "?"} size={86}
                        title={profile ? `Your verdict: grade ${grade}` : "Take the Match to strike your compass"} />
                    </div>
                  );
                })()}
                <div style={{ flex:1, minWidth:0 }}>
                  {profile ? (
                    <>
                      <div style={{ fontSize:22, fontWeight:700, color:T.txt, lineHeight:1.1 }}>{ps == null ? "—" : ps}<span style={{ fontSize:14, color:T.txt3, fontWeight:500 }}>{ps == null ? "" : "/100"}</span></div>
                      <div style={{ fontSize:12, color:T.txt3, marginTop:2 }}>{enriched.cat} · your personalized score</div>
                      {/* Trust layer (2026-06-11): evidence-depth honesty. 52%
                          of graded brands rest on 1-2 record categories — say
                          so up front instead of letting users discover it. */}
                      {(() => {
                        const n = enriched.realCats ?? 0;
                        if (n <= 0) return null;
                        const limited = n <= 1;
                        return (
                          <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:6, padding:"3px 9px", borderRadius:20, fontSize:10.5, fontWeight:600, whiteSpace:"nowrap", background:limited ? T.bg3 : T.accentBg, border:`1px solid ${limited ? T.border2 : T.accent}`, color: limited ? T.txt3 : T.accent2 }}>
                            <i className={`ti ${limited ? "ti-file" : "ti-files"}`} aria-hidden="true" style={{ fontSize:11 }} />
                            {limited ? `Limited · ${n} category` : `${n} record categories`}
                          </div>
                        );
                      })()}
                      {(() => {
                        // Phase 5.y "Why this grade?" — surface the 1–2 categories
                        // that moved the needle most on this user's score, derived
                        // from |scoreCat − 50| × weight. Plain English, no judgment.
                        //
                        // B-60/B-62 (2026-06-09, Aron-reported): ALSO surface
                        // dealbreaker penalties. Previously a user could see "F
                        // — Why: Political helped most" with no idea their
                        // foreign-ownership dealbreaker silently dropped the
                        // brand 30 points. Now penalties are first-class
                        // citizens in the explanation.
                        // M7 fix: SAME defaults as computeScore (was 3/2 here
                        // vs 1.0/1.2 there — panel could contradict the grade).
                        const baseW = Object.fromEntries(CAT_KEYS.map(k => [k, profile.weights?.[k] || PROFILE_DEFAULT_WEIGHTS[k]]));
                        const impacts = CAT_KEYS.map(k => {
                          const v = enriched.sc?.[k];
                          // B64: stanced-dei recognition shows up in the Why too.
                          const deiEvW = k === "dei" && profile.deiLean && profile.deiLean !== "neutral" && deiEvidence(enriched);
                          if (getDataState(k, v) === "unknown" && !deiEvW) return null;
                          const lv = String(v||"").toLowerCase();
                          if ((lv === "neutral" && !deiEvW) || lv === "na" || lv === "n/a") return null;
                          const detailObj = enriched[k] || {};
                          if (/^\s*no public record found\.?\s*$/i.test(String(detailObj.s || "")) && !deiEvW) return null;
                          // QA fix 2026-06-10: pass `enriched` as the co arg —
                          // scoreCat's overlay/context branches read it; omitting
                          // it made the Why-panel numbers drift from computeScore.
                          const sc = scoreCat(k, v, profile, enriched);
                          const delta = sc - 50;
                          return { k, sc, delta, impact: Math.abs(delta) * baseW[k] };
                        }).filter(Boolean).sort((a,b) => b.impact - a.impact);

                        // B-60: compute dealbreaker penalties the way computeScore
                        // does (App.jsx ~line 871). QA fix 2026-06-10: the points
                        // here were stale Build-54 values (-30/-25/-15/-40) — the
                        // Build 55 Excel rebuild flattened the engine to soft -10 /
                        // hard -20 / animal-testing -20, so the panel was telling
                        // users penalties up to 2× what was actually applied.
                        // These MUST mirror computeScore's reduce() exactly.
                        const dealbreakers = profile.dealBreakers || [];
                        const penalties = [];
                        for (const db of dealbreakers) {
                          if (["environment","labor","privacy","execPay","animals","guns","charity"].includes(db)) {
                            const v = (enriched.sc?.[db] || "").toLowerCase();
                            const bad = ["negative","poor","very poor","below average","tests_animals","sells_guns","makes_guns"];
                            if (bad.includes(v)) penalties.push({ db, label: `${CAT_LABELS[db]} dealbreaker`, points: -10 });
                          } else if (db === "forcedLabor" && (["poor","very poor"].includes((enriched.sc?.labor||"").toLowerCase()) || enriched.forcedLaborListed)) {
                            penalties.push({ db, label: "Forced-labor dealbreaker", points: -20 });
                          } else if (db === "taxAvoidance" && (enriched.sc?.execPay||"").toLowerCase() === "poor") {
                            penalties.push({ db, label: "Tax-avoidance dealbreaker", points: -20 });
                          } else if (db === "predatoryPrice" && (enriched.sc?.labor||"").toLowerCase() === "poor") {
                            penalties.push({ db, label: "Predatory-pricing dealbreaker", points: -20 });
                          } else if (db === "darkPatterns" && (enriched.sc?.privacy||"").toLowerCase() === "poor") {
                            penalties.push({ db, label: "Dark-patterns dealbreaker", points: -20 });
                          } else if (db === "foreignOwn" && enriched.foreignOwned) {
                            penalties.push({ db, label: `Foreign-owned (${enriched.foreignCountry || "non-US"})`, points: -20 });
                          } else if (db === "monopoly" && enriched.antitrust) {
                            penalties.push({ db, label: "Antitrust history", points: -20 });
                          } else if (db === "childLabor" && enriched.childLabor) {
                            penalties.push({ db, label: "Child-labor history", points: -20 });
                          }
                        }
                        if (profile.animalTesting === "dealbreaker" && enriched.sc?.animals === "tests_animals") {
                          penalties.push({ db: "animalTesting", label: "Animal-testing dealbreaker", points: -20 });
                        }
                        penalties.sort((a,b) => a.points - b.points); // most-negative first

                        // 2026-06-11: a neutral-scored category (delta 0, e.g.
                        // no_guns with no firearms stance) used to win top-2 by
                        // default on sparse brands and render "Firearms hurt" —
                        // a zero-delta category neither helped nor hurt. Require
                        // a real move before we explain it.
                        const top = impacts.filter(it => Math.abs(it.delta) >= 5).slice(0, 2);
                        if (!top.length && !penalties.length) return null;
                        const reasonFor = (it) => {
                          const cat = CAT_LABELS[it.k];
                          const goodOrBad = it.delta > 0 ? "helped" : "hurt";
                          return `${cat} ${goodOrBad}`;
                        };
                        return (
                          <div style={{ marginTop:8, fontSize:11, color:T.txt2, lineHeight:1.5 }}>
                            {top.length > 0 && (
                              <div>
                                <span style={{ color:T.txt3 }}>Why: </span>
                                {top.map((it, i) => (
                                  <span key={it.k}>
                                    {i > 0 && ", "}
                                    <span style={{ color: it.delta > 0 ? "#38C0CE" : "#E0524D", fontWeight:600 }}>{reasonFor(it)}</span>
                                  </span>
                                ))}
                                {top[0] && <span style={{ color:T.txt3 }}> most</span>}
                              </div>
                            )}
                            {penalties.length > 0 && (
                              <div style={{ marginTop:4 }}>
                                <span style={{ color:T.txt3 }}>Dealbreakers: </span>
                                {penalties.map((p, i) => (
                                  <span key={p.db}>
                                    {i > 0 && ", "}
                                    <span style={{ color:"#E0524D", fontWeight:600 }}>{p.label}</span>
                                    <span style={{ color:T.txt3 }}> ({p.points})</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:14, fontWeight:600, color:T.txt, lineHeight:1.2 }}>Take the 45-second Match</div>
                      <div style={{ fontSize:12, color:T.txt3, marginTop:3, lineHeight:1.4 }}>{enriched.cat} · data shown below; your values set the grade</div>
                      {/* Trust layer: evidence-depth chip for UN-quizzed users
                          too (the profile branch renders its own copy). */}
                      {(() => {
                        const n = enriched.realCats ?? 0;
                        if (n <= 0) return null;
                        const limited = n <= 1;
                        return (
                          <div style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:6, padding:"3px 9px", borderRadius:20, fontSize:10.5, fontWeight:600, whiteSpace:"nowrap", background:limited ? T.bg3 : T.accentBg, border:`1px solid ${limited ? T.border2 : T.accent}`, color: limited ? T.txt3 : T.accent2 }}>
                            <i className={`ti ${limited ? "ti-file" : "ti-files"}`} aria-hidden="true" style={{ fontSize:11 }} />
                            {limited ? `Limited · ${n} category` : `${n} record categories`}
                          </div>
                        );
                      })()}
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
                    <div style={{ fontSize:10, color: recalls.severityMax === "high" ? "#E0524D" : "#E8A04C", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
                      <i className="ti ti-rosette" aria-hidden="true" /> Recalls
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginTop:2 }}>
                      {recalls.recallCount24mo} in 24mo
                    </div>
                  </div>
                )}
                {breaches?.breachCount > 0 && (
                  <div style={{ flex:"1 1 130px", padding:"8px 10px", borderRadius:8, background:"rgba(226,74,74,0.12)", border:"1px solid rgba(226,74,74,0.4)" }}>
                    <div style={{ fontSize:10, color:"#E0524D", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
                      <i className="ti ti-shield-off" aria-hidden="true" /> Breaches
                    </div>
                    <div style={{ fontSize:13, fontWeight:700, color:T.txt, marginTop:2 }}>
                      {breaches.breachCount} · {breaches.totalRecordsLost >= 1e6 ? `${(breaches.totalRecordsLost/1e6).toFixed(1)}M` : `${(breaches.totalRecordsLost/1e3).toFixed(0)}K`} records
                    </div>
                  </div>
                )}
                {litigation?.caseCount24mo > 0 && (
                  <div style={{ flex:"1 1 130px", padding:"8px 10px", borderRadius:8, background:"rgba(240,160,48,0.10)", border:"1px solid rgba(240,160,48,0.4)" }}>
                    <div style={{ fontSize:10, color:"#E8A04C", fontWeight:700, textTransform:"uppercase", letterSpacing:0.4 }}>
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

          {/* R6 (2026-06-10, Aron request): private-company explainer. A
              zero-data brand used to open onto nine bare "No public record
              found" rows — reads like the APP failed. For privately-held
              companies the truth is structural: SEC pay data, proxy
              statements, and most disclosure regimes only bind public
              companies. Say that, once, up top. Detection mirrors
              reflag-categories: no ticker + not isPublic ⇒ private. */}
          {(() => {
            // Build 56: with a profile, gate on the PERSONALIZED score being
            // null — Aron's repro showed "F 38" stacked on top of "no public
            // records" (realCats counts only baked signals; the user's stance
            // had produced a grade). The card and the grade must agree.
            const zeroData = profile ? ps == null : (enriched.realCats ?? 0) === 0;
            if (!zeroData) return null;
            const isPrivate = !enriched.ticker && !enriched.isPublic;
            // 2026-06-11 (Aron): private + zero-data gets a DISTINCT card, not
            // the generic gray one — users were reading bare empty rows as
            // "the app failed." The truth is structural and worth saying
            // plainly: private companies have no legal duty to publish the
            // records grades draw on, and absence of records is not a verdict.
            if (isPrivate) {
              const subject = encodeURIComponent(`TruNorth record submission: ${enriched.name}`);
              const body = encodeURIComponent(`Company: ${enriched.name}\nLink to the verifiable public record (regulator action, court filing, certification, press release):\n\nWhat it shows:\n`);
              return (
                <div style={{ margin:"4px 0 10px", padding:"14px 15px", borderRadius:12, background:T.bg3, border:`1px solid ${T.accent}33`, borderLeft:`3px solid ${T.accent}` }}>
                  <div style={{ fontSize:10, fontWeight:700, color:T.accent, textTransform:"uppercase", letterSpacing:0.6, marginBottom:5 }}>
                    <i className="ti ti-lock" aria-hidden="true" style={{ marginRight:5 }} />
                    Private company · No public records
                  </div>
                  <div style={{ fontSize:12.5, color:T.txt2, lineHeight:1.55, marginBottom:8 }}>
                    {enriched.name} is privately held. Private companies aren't legally
                    required to publish the disclosures most grades draw on — SEC pay
                    ratios, proxy statements, workforce reports, or annual filings.
                    <b style={{ color:T.txt }}> No data here isn't a verdict</b> — it means
                    nothing is on the public record yet, and TruNorth only grades what
                    public records can verify.
                  </div>
                  <div style={{ fontSize:12, color:T.txt3, lineHeight:1.5, marginBottom:10 }}>
                    We continuously monitor 200+ regulator, court, and certification
                    feeds. If this company appears in any of them — an OSHA citation, an
                    EPA action, an FEC filing, a cruelty-free certification — its record
                    shows up here automatically.
                  </div>
                  <a
                    href={`mailto:corrections@trunorthapp.com?subject=${subject}&body=${body}`}
                    onClick={() => track("private_record_submit_clicked", { slug: enriched.slug, name: enriched.name })}
                    style={{ fontSize:12, fontWeight:700, color:T.accent, textDecoration:"none" }}
                  >
                    Know a verifiable record we missed? Report it <i className="ti ti-arrow-right" aria-hidden="true" />
                  </a>
                </div>
              );
            }
            return (
              <div style={{ margin:"4px 0 10px", padding:"12px 14px", borderRadius:12, background:T.bg3, border:`1px solid ${T.border2}` }}>
                <div style={{ fontSize:12, fontWeight:700, color:T.txt2, marginBottom:4 }}>
                  <i className="ti ti-file-search" aria-hidden="true" style={{ marginRight:5 }} />
                  No public records found yet
                </div>
                <div style={{ fontSize:12, color:T.txt3, lineHeight:1.5 }}>
                  None of our 200+ public-records sources currently report on this brand. Records are added as regulators publish them.
                </div>
              </div>
            );
          })()}

          {!(detailError && !detail) && CAT_KEYS.map(k => (
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
          {/* B-15: industry-membership flags render right before "About
              this company". Read-only disclosure; not score modifiers. */}
          <IndustryFlagsRow company={enriched} />

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
                      <> · tone <b style={{ color: enriched.news.avgTone < -2 ? "#E0524D" : enriched.news.avgTone > 2 ? "#38C0CE" : T.txt2 }}>{enriched.news.avgTone.toFixed(1)}</b></>
                    )}
                  </div>
                  {enriched.news.scandalSignals?.length > 0 && (
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
                      {enriched.news.scandalSignals.slice(0, 5).map((s, i) => (
                        <span key={i} style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"rgba(226,74,74,0.12)", border:"1px solid rgba(226,74,74,0.3)", color:"#E0524D", textTransform:"uppercase", letterSpacing:0.3 }}>{s}</span>
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
                const breachColor = breachStale ? T.txt3 : breachSevere ? "#E0524D" : "#E8A04C";
                const breachBg = breachStale ? T.bg3
                                : breachSevere ? "rgba(226,74,74,0.12)"
                                : "rgba(240,160,48,0.10)";
                const breachBorder = breachStale ? T.border
                                    : breachSevere ? "rgba(226,74,74,0.5)"
                                    : "rgba(240,160,48,0.4)";

                const litSevere = litLooksLegit && lt.classActionCount > 0;
                const litWarn = litLooksLegit && !litSevere && lt.caseCount24mo > 5;
                const litColor = litSevere ? "#E0524D" : litWarn ? "#E8A04C" : T.txt3;
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
                  CEO-to-median pay ratio: <b style={{ color: enriched.payRatio.ratio > 250 ? "#E0524D" : enriched.payRatio.ratio > 50 ? T.gold : "#38C0CE" }}>{enriched.payRatio.ratioDisplay || `${Math.round(enriched.payRatio.ratio)}:1`}</b>
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
                        <Tag key={i} href={b.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background: scoreOk ? "rgba(76,175,130,0.12)" : T.bg3, border:`1px solid ${scoreOk ? "rgba(76,175,130,0.4)" : T.border}`, color: scoreOk ? "#38C0CE" : T.txt2, textDecoration:"none" }}>
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
                        <Tag key={i} href={c.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background: negative ? "rgba(226,74,74,0.12)" : "rgba(76,175,130,0.12)", border:`1px solid ${negative ? "rgba(226,74,74,0.4)" : "rgba(76,175,130,0.4)"}`, color: negative ? "#E0524D" : "#38C0CE", textDecoration:"none" }}>
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
                  <div style={{ fontSize:11, fontWeight:700, color: enriched.recalls.severityMax === "high" ? "#E0524D" : "#E8A04C", textTransform:"uppercase", letterSpacing:0.5, marginBottom:6, display:"flex", alignItems:"center", gap:6 }}>
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
                    {enriched.ownership.blackOwned    && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(56,192,206,0.12)", border:"1px solid rgba(56,192,206,0.4)", color:"#5CD6E0" }}>Black-owned</span>}
                    {enriched.ownership.womenOwned    && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(56,192,206,0.12)", border:"1px solid rgba(56,192,206,0.4)", color:"#5CD6E0" }}>Women-owned</span>}
                    {enriched.ownership.minorityOwned && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(56,192,206,0.12)", border:"1px solid rgba(56,192,206,0.4)", color:"#5CD6E0" }}>Minority-owned</span>}
                    {enriched.ownership.lgbtOwned     && <span style={{ fontSize:10, padding:"3px 7px", borderRadius:5, background:"rgba(56,192,206,0.12)", border:"1px solid rgba(56,192,206,0.4)", color:"#5CD6E0" }}>LGBT-owned</span>}
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
                    <span style={{ marginLeft:8, padding:"2px 6px", borderRadius:4, background:"rgba(226,74,74,0.15)", border:"1px solid rgba(226,74,74,0.4)", color:"#E0524D", fontSize:10, fontWeight:700 }}>
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

          {/* 2026-06-01 (user feedback): removed "I bought it" / "I skipped it"
              toggle. The feedback was "they don't work, and where do they go?"
              They DID save to tn_purchaseLog and feed the monthly recap card
              on Top Picks — but without a visible affordance explaining that,
              the UI just looked broken. Killed both the buttons and the
              monthly card that depended on them. Cleaner. */}

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
          {/* Trust layer (2026-06-11): opinion framing + methodology link on
              every profile — the legal posture (grades = opinions from cited
              records) and the trust asset (published formula) in one line. */}
          <div style={{ marginTop:6, fontSize:10.5, color:T.txt3, lineHeight:1.5 }}>
            Grades are opinions derived from the cited public records.{" "}
            <a
              href="#methodology"
              onClick={() => track("methodology_opened", { from: "card_footer" })}
              style={{ color:T.accent2, textDecoration:"none" }}
            >How grades work →</a>
          </div>

          {/* Phase 5.af: Save + Compare buttons live in the expanded profile
              (not the closed row) so the company name has room to breathe. */}
          {(onToggleSave || onToggleCompare) && (
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              {/* Retention v1 (2026-06-11): brand-grade share — the viral
                  object is "this brand grades X on my values", rendered by
                  the /api/og/brand endpoint for rich previews. */}
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const slug = company.slug || company.id;
                  const myGrade = profile && grade && grade !== "?" ? grade : null;
                  const url = `https://www.trunorthapp.com/company/${slug}?${new URLSearchParams({ ...(myGrade ? { g: myGrade } : {}), utm_source: "share", utm_medium: "brand_card" })}`;
                  const shareData = {
                    title: `${company.name} on TruNorth`,
                    text: myGrade ? `${company.name} grades ${myGrade} on my values. See what it grades on yours:` : `See how ${company.name} scores on what matters to you:`,
                    url,
                  };
                  let method = "clipboard";
                  try {
                    if (navigator.share && navigator.canShare?.(shareData) !== false) { await navigator.share(shareData); method = "native_share"; }
                    else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); }
                  } catch (err) { if (err?.name === "AbortError") method = "cancelled"; }
                  track("brand_card_shared", { slug, grade: myGrade, method });
                }}
                style={{ flex:1, padding:10, borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6, background:T.bg3, border:`1px solid ${T.border}`, color:T.txt2 }}
              >
                <i className="ti ti-share" aria-hidden="true" style={{ fontSize:13 }} />
                Share
              </button>
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
      // apiUrl() rewrites to the production origin on native iOS — a relative
      // /api/submit there hits capacitor://localhost and the correction is lost.
      fetch(apiUrl("/api/submit"), {
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
      {sent && <div style={{ background:"#0E2126", border:"1px solid #38C0CE", borderRadius:12, padding:14, color:"#38C0CE", fontSize:14, fontWeight:600, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}><i className="ti ti-check" style={{fontSize:18}} aria-hidden="true" /> Submitted — thanks!</div>}
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
    {name:"SEC EDGAR",url:"https://www.sec.gov/edgar/searchedgar/companysearch",desc:"Official US Securities and Exchange Commission filings. Every public ticker plus the 10-K Exhibit 21 subsidiary tree for ownership graphs.",cadence:"Quarterly"},
    {name:"Wikidata",url:"https://www.wikidata.org",desc:"Open knowledge graph used to map consumer brands back to their corporate parents (e.g. Aunt Jemima → PepsiCo).",cadence:"Quarterly"},
    {name:"Open Food Facts",url:"https://world.openfoodfacts.org",desc:"Crowdsourced food product database — adds brand-to-parent links for grocery.",cadence:"Annual"},
  ]},
  {group:"Federal enforcement",icon:"ti-gavel",items:[
    {name:"DOJ Press Releases",url:"https://www.justice.gov/news",desc:"Daily stream of US Department of Justice press releases: antitrust, fraud, criminal, civil rights, environment, tax cases. Per-brand mention tracking over 90 days.",cadence:"Weekly"},
    {name:"DOJ FCPA Cases",url:"https://www.justice.gov/criminal/criminal-fraud/foreign-corrupt-practices-act",desc:"DOJ Foreign Corrupt Practices Act enforcement actions — every deferred-prosecution agreement and corporate guilty plea since 1977.",cadence:"Monthly"},
    {name:"DOJ Antitrust Division",url:"https://www.justice.gov/atr/case-document",desc:"DOJ Antitrust case documents — settlements, judgments, merger challenges, cartel cases.",cadence:"Monthly"},
    {name:"SEC Litigation Releases",url:"https://www.sec.gov/litigation/litreleases",desc:"SEC enforcement actions naming defendant companies. Lifetime + recent 24-month counts.",cadence:"Weekly"},
    {name:"CourtListener (RECAP)",url:"https://www.courtlistener.com",desc:"Federal court records via the Free Law Project. Lawsuit counts, case types (antitrust, labor, consumer, IP, securities, environmental).",cadence:"Weekly"},
    {name:"GSA SAM.gov Excluded Parties",url:"https://sam.gov/exclusions",desc:"Federal contractor blacklist. Companies barred from doing business with the US government — rare but extremely high signal.",cadence:"Monthly"},
    {name:"Treasury OFAC Sanctions",url:"https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists",desc:"US Treasury Office of Foreign Assets Control consolidated sanctions list — SDN, SSI, FSE, NS-PLC.",cadence:"Monthly"},
    {name:"OCC Bank Enforcement",url:"https://apps.occ.gov/EnforcementActions/",desc:"Office of the Comptroller of the Currency enforcement actions against national banks.",cadence:"Weekly"},
    {name:"FDIC Enforcement",url:"https://orders.fdic.gov",desc:"FDIC orders and enforcement actions against state-chartered banks.",cadence:"Weekly"},
    {name:"Federal Reserve Enforcement",url:"https://www.federalreserve.gov/supervisionreg/enforcementactions.htm",desc:"Bulk feed of Fed Reserve enforcement actions since 1989 — bank holding companies, state member banks, foreign branches.",cadence:"Monthly"},
    {name:"FINRA Disciplinary Actions",url:"https://brokercheck.finra.org",desc:"BrokerCheck regulatory history for every FINRA-member broker-dealer.",cadence:"Weekly"},
    {name:"CFTC Enforcement",url:"https://www.cftc.gov/PressRoom/PressReleases",desc:"Commodity Futures Trading Commission civil monetary penalties — commodity traders, futures brokers, swap dealers.",cadence:"Monthly"},
    {name:"PCAOB Enforcement",url:"https://pcaobus.org/oversight/enforcement/enforcement-actions",desc:"Public Company Accounting Oversight Board settled disciplinary orders against audit firms.",cadence:"Monthly"},
    {name:"FERC Enforcement",url:"https://www.ferc.gov/enforcement-legal/enforcement/civil-penalty-actions",desc:"Federal Energy Regulatory Commission civil penalty actions against energy traders + utilities.",cadence:"Weekly"},
    {name:"HUD Fair Housing",url:"https://www.hud.gov/program_offices/fair_housing_equal_opp/enforcement",desc:"HUD Fair Housing & Equal Opportunity charges + settlements per landlord/lender (race, disability, redlining).",cadence:"Monthly"},
    {name:"Stanford Securities Class Action Clearinghouse",url:"https://securities.stanford.edu/filings.html",desc:"Every securities class action filed in federal court since 1996.",cadence:"Monthly"},
    {name:"GAO Reports",url:"https://www.gao.gov/reports-testimonies",desc:"Government Accountability Office reports + testimonies + bid protests on federal contractors.",cadence:"Monthly"},
    {name:"Oversight.gov (Inspector General reports)",url:"https://www.oversight.gov/reports",desc:"Aggregates 70+ federal Inspector General offices reporting on contractor + healthcare misconduct.",cadence:"Monthly"},
    {name:"MuckRock FOIA",url:"https://www.muckrock.com",desc:"Public Freedom of Information Act requests — reveals government investigations + activity per brand.",cadence:"Monthly"},
  ]},
  {group:"Consumer protection",icon:"ti-shield",items:[
    {name:"CFPB Consumer Complaint Database",url:"https://www.consumerfinance.gov/data-research/consumer-complaints",desc:"US Consumer Financial Protection Bureau complaints for banks, credit cards, mortgages, debt collection. Per-brand: top issues, products, timely-response rate.",cadence:"Weekly"},
    {name:"CPSC Recalls",url:"https://www.cpsc.gov/Recalls",desc:"Consumer Product Safety Commission product recalls (toys, electronics, appliances) — separate from FDA's food/drug coverage.",cadence:"Weekly"},
    {name:"NHTSA Vehicle Recalls + Complaints",url:"https://www.nhtsa.gov/recalls",desc:"National Highway Traffic Safety Administration vehicle recall records and consumer-filed complaints for every auto brand.",cadence:"Weekly"},
    {name:"FCC Consumer Complaints",url:"https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj",desc:"Federal Communications Commission consumer complaint data — wireless, internet, robocalls, billing.",cadence:"Weekly"},
  ]},
  {group:"Political donations",icon:"ti-flag-2",items:[
    {name:"FEC.gov (Federal Election Commission)",url:"https://www.fec.gov",desc:"Official US campaign finance API. Maps company donations and lobbying disclosures to candidates, parties, and political lean.",cadence:"Monthly"},
    {name:"OpenSecrets.org",url:"https://www.opensecrets.org",desc:"Aggregated political donations, PAC spending, lobbying, and candidate fundraising.",cadence:"Monthly"},
    {name:"InfluenceMap",url:"https://influencemap.org",desc:"Scores companies on climate-policy lobbying and political influence.",cadence:"Annual"},
    {name:"OpenStates",url:"https://openstates.org",desc:"State-level legislation across all 50 states. Picks up lobbying signal beyond federal-only FEC data.",cadence:"Monthly"},
    {name:"CPA-Zicklin Index",url:"https://politicalaccountability.net/cpa-zicklin-index",desc:"Annual S&P 500 ranking on political-spending disclosure and accountability (0-100 + tier label).",cadence:"Annual"},
    {name:"As You Sow",url:"https://www.asyousow.org/reports",desc:"Shareholder-resolution + corporate scorecards: pesticides, plastic, gun safety, racial justice, climate.",cadence:"Annual"},
  ]},
  {group:"Charitable giving",icon:"ti-heart",items:[
    {name:"Charity Navigator",url:"https://www.charitynavigator.org",desc:"Rates 1.8M nonprofits on financial health, accountability, and transparency.",cadence:"Annual"},
    {name:"Candid / GuideStar",url:"https://candid.org",desc:"Largest database of nonprofit 990 forms.",cadence:"Annual"},
  ]},
  {group:"Environmental",icon:"ti-leaf",items:[
    {name:"CDP (Carbon Disclosure Project)",url:"https://www.cdp.net",desc:"World's largest environmental disclosure system. Companies scored A–D on climate, water, forests.",cadence:"Annual"},
    {name:"B Corp Certification",url:"https://www.bcorporation.net",desc:"Rigorous certification for companies meeting high social and environmental standards.",cadence:"Annual"},
    {name:"EPA Enforcement",url:"https://www.epa.gov/enforcement",desc:"US federal environmental enforcement actions — Clean Air, Clean Water, Superfund.",cadence:"Monthly"},
    {name:"EPA ECHO",url:"https://echo.epa.gov",desc:"Enforcement and Compliance History Online — facility-level inspections, violations, formal/informal actions, total federal penalties per company.",cadence:"Weekly"},
    {name:"PHMSA Pipeline Incidents",url:"https://www.phmsa.dot.gov/data-and-statistics/pipeline/pipeline-incident-flagged-files",desc:"Pipeline and Hazardous Materials Safety Administration incident reports — fatalities, injuries, damages per operator.",cadence:"Weekly"},
    {name:"NRC Event Reports",url:"https://www.nrc.gov/reading-rm/doc-collections/event-status",desc:"Nuclear Regulatory Commission event notification reports + enforcement actions per nuclear utility.",cadence:"Weekly"},
    {name:"Break Free From Plastic",url:"https://www.breakfreefromplastic.org",desc:"Annual Brand Audit ranks top plastic polluters globally.",cadence:"Annual"},
    {name:"Climate Action 100+",url:"https://www.climateaction100.org",desc:"List of ~167 focus companies (biggest GHG emitters) with disclosure grade per indicator.",cadence:"Annual"},
  ]},
  {group:"Labor practices",icon:"ti-users",items:[
    {name:"OSHA Violations",url:"https://www.osha.gov",desc:"US federal workplace-safety inspections, violations, and fines.",cadence:"Monthly"},
    {name:"OSHA Severe Injury Reports",url:"https://www.osha.gov/severe-injury-reports",desc:"Per-establishment injury counts (amputations, hospitalizations) — separate dataset from the violations endpoint.",cadence:"Monthly"},
    {name:"MSHA Mine Incidents",url:"https://www.msha.gov/data-reports",desc:"Mine Safety and Health Administration citations, fatalities, and penalties per mine operator.",cadence:"Weekly"},
    {name:"NLRB (National Labor Relations Board)",url:"https://www.nlrb.gov",desc:"US agency that oversees union elections and investigates illegal labor practices.",cadence:"Monthly"},
    {name:"DOL Wage & Hour Division",url:"https://enforcedata.dol.gov",desc:"DOL Wage and Hour Division enforcement actions — back wages, employee impact per case.",cadence:"Monthly"},
    {name:"DOL OFCCP",url:"https://www.dol.gov/agencies/ofccp",desc:"Office of Federal Contract Compliance Programs audits + settlements (race, disability, veteran discrimination).",cadence:"Monthly"},
    {name:"Violation Tracker",url:"https://violationtracker.goodjobsfirst.org",desc:"Aggregates federal penalties across 50+ agencies — wage theft, safety, environmental, antitrust.",cadence:"Monthly"},
    {name:"Oxfam Behind The Brands",url:"https://www.oxfam.org/en/research/behind-brands",desc:"Rates major food companies on worker rights.",cadence:"Annual"},
  ]},
  {group:"Supply-chain & human rights",icon:"ti-world",items:[
    {name:"BHRRC (Business & Human Rights Resource Centre)",url:"https://www.business-humanrights.org",desc:"Tracks human-rights allegations including forced labor, child labor, and modern slavery.",cadence:"Annual"},
    {name:"US Department of Labor — List of Goods Produced by Child or Forced Labor",url:"https://www.dol.gov/agencies/ilab/reports/child-labor/list-of-goods",desc:"Annual government list. Flags products with documented risk of forced labor or child labor.",cadence:"Annual"},
    {name:"Yale CELI — Russia Exit Tracker",url:"https://som.yale.edu/story/2022/over-1000-companies-have-curtailed-operations-russia-some-remain",desc:"Yale School of Management's A–F grades on whether companies pulled out of Russia after the 2022 invasion.",cadence:"Annual"},
    {name:"KnowTheChain",url:"https://knowthechain.org/benchmarks",desc:"Sector benchmarks (ICT, Food & Beverage, Apparel & Footwear) ranking companies on forced-labor risk.",cadence:"Annual"},
    {name:"UK Modern Slavery Act Registry",url:"https://modern-slavery-statement-registry.service.gov.uk",desc:"UK government registry of corporate modern-slavery statements for companies operating in the UK.",cadence:"Annual"},
    {name:"GoodWeave Certification",url:"https://goodweave.org",desc:"Anti-child-labor certification for rugs, textiles, and apparel.",cadence:"Annual"},
    {name:"Fair Trade USA",url:"https://www.fairtradecertified.org",desc:"Directory of Fair Trade Certified consumer brands across coffee, cocoa, produce, apparel.",cadence:"Annual"},
    {name:"Rainforest Alliance",url:"https://www.rainforest-alliance.org",desc:"Certified brand directory across coffee, tea, cocoa, bananas, palm oil.",cadence:"Annual"},
  ]},
  {group:"DEI",icon:"ti-rainbow",items:[
    {name:"HRC Corporate Equality Index",url:"https://www.hrc.org/resources/corporate-equality-index",desc:"Annual scorecard rating companies 0–100 on LGBTQ+ workplace equality.",cadence:"Annual"},
    {name:"EEOC (Equal Employment Opportunity Commission)",url:"https://www.eeoc.gov",desc:"US workplace discrimination enforcement (aggregate data).",cadence:"Annual"},
    {name:"UK Gender Pay Gap Service",url:"https://gender-pay-gap.service.gov.uk",desc:"UK government registry — mean/median gender pay gap + bonus gap for every UK employer >250 staff.",cadence:"Annual"},
  ]},
  {group:"Firearms",icon:"ti-crosshair",items:[
    {name:"ATF Federal Firearms Licenses",url:"https://www.atf.gov/firearms/listing-federal-firearms-licensees",desc:"ATF FFL registry — manufacturers, dealers, and importers of firearms by license type and state.",cadence:"Monthly"},
  ]},
  {group:"Animal testing & welfare",icon:"ti-paw",items:[
    {name:"PETA Beauty Without Bunnies",url:"https://www.peta.org/living/personal-care-fashion/beauty-without-bunnies/",desc:"Database of companies that do and do not test on animals.",cadence:"Annual"},
    {name:"Leaping Bunny",url:"https://www.leapingbunny.org",desc:"Global certification program for cruelty-free companies.",cadence:"Annual"},
    {name:"ASPCA",url:"https://www.aspca.org",desc:"Tracks animal welfare standards in food and agriculture supply chains.",cadence:"Annual"},
    {name:"USDA APHIS Enforcement",url:"https://www.aphis.usda.gov/aphis/ourfocus/animalwelfare/news-info/enforcement",desc:"Animal Welfare Act inspection violations + civil penalties (research orgs, breeders, zoos, entertainment).",cadence:"Monthly"},
  ]},
  {group:"Drug enforcement",icon:"ti-pill",items:[
    {name:"DEA Diversion Control",url:"https://www.federalregister.gov/agencies/drug-enforcement-administration",desc:"DEA Decisions and Orders + Show Cause notices against pharmacies, distributors, manufacturers.",cadence:"Monthly"},
  ]},
  {group:"Data privacy & security",icon:"ti-lock",items:[
    {name:"Have I Been Pwned",url:"https://haveibeenpwned.com",desc:"Curated database of 1,000+ documented data breaches with account counts and exposed data classes.",cadence:"Monthly"},
    {name:"CISA Known Exploited Vulnerabilities",url:"https://www.cisa.gov/known-exploited-vulnerabilities-catalog",desc:"US Cybersecurity and Infrastructure Security Agency catalog of CVEs actively exploited in the wild — per-vendor signal for tech brands.",cadence:"Weekly"},
    {name:"NIST National Vulnerability Database",url:"https://nvd.nist.gov",desc:"Full CVE history per vendor (lifetime + recent 24-month + critical/high counts).",cadence:"Monthly"},
    {name:"OSV (Open Source Vulnerabilities)",url:"https://osv.dev",desc:"Per-package vulnerability records across npm, Maven, NuGet, PyPI, Go, Cargo, ecosystems.",cadence:"Monthly"},
    {name:"GitHub Security Advisories",url:"https://github.com/advisories",desc:"GitHub-published advisories filtered to packages each vendor maintains.",cadence:"Monthly"},
    {name:"CERT Vulnerability Notes",url:"https://kb.cert.org/vuls",desc:"Carnegie Mellon SEI vulnerability notes — per-vendor security disclosures.",cadence:"Monthly"},
    {name:"EFF (Electronic Frontier Foundation)",url:"https://www.eff.org",desc:"Tracks corporate surveillance practices and data privacy records.",cadence:"Annual"},
    {name:"Mozilla Privacy Not Included",url:"https://foundation.mozilla.org/en/privacynotincluded/",desc:"Rates apps and services on data collection and privacy practices.",cadence:"Annual"},
  ]},
  {group:"Health & product safety",icon:"ti-stethoscope",items:[
    {name:"OpenFDA",url:"https://open.fda.gov",desc:"Public FDA enforcement API — food, drug, and device recalls classified by severity (Class I / II / III).",cadence:"Weekly"},
    {name:"FSIS Recalls (USDA)",url:"https://www.fsis.usda.gov/recalls",desc:"USDA Food Safety and Inspection Service recalls for meat, poultry, and egg products — separate from FDA.",cadence:"Weekly"},
    {name:"NTSB Accident Reports",url:"https://data.ntsb.gov",desc:"National Transportation Safety Board investigations across aviation, rail, marine, and highway.",cadence:"Weekly"},
    {name:"FAA Service Difficulty Reports",url:"https://av-info.faa.gov/sdrx",desc:"FAA Service Difficulty Reports + Airworthiness Directives + accident data per aircraft manufacturer.",cadence:"Weekly"},
    {name:"FRA Railroad Incidents",url:"https://railroads.dot.gov/safety-data",desc:"Federal Railroad Administration incident reports — fatalities, hazmat releases per railroad.",cadence:"Weekly"},
    {name:"CDC FoodNet outbreak tracking",url:"https://www.cdc.gov/foodnet",desc:"US Centers for Disease Control multistate foodborne outbreak records — illness counts, hospitalizations, deaths per brand.",cadence:"Monthly"},
    {name:"HHS OIG enforcement",url:"https://oig.hhs.gov/fraud/enforcement",desc:"US Health & Human Services Office of Inspector General — healthcare fraud cases + LEIE exclusions for pharma, hospital, insurance brands.",cadence:"Monthly"},
  ]},
  {group:"Sustainability certifications & rankings",icon:"ti-award",items:[
    {name:"Marine Stewardship Council (MSC)",url:"https://www.msc.org",desc:"Sustainable seafood certification for retailers, restaurants, and brands.",cadence:"Annual"},
    {name:"Forest Stewardship Council (FSC)",url:"https://fsc.org",desc:"Sustainable forestry certification for paper, lumber, packaging brands.",cadence:"Annual"},
    {name:"Cradle to Cradle Certified",url:"https://www.c2ccertified.org",desc:"Bronze/Silver/Gold/Platinum tiered certification for circular-economy products.",cadence:"Annual"},
    {name:"Climate Neutral Certified",url:"https://www.climateneutral.org",desc:"Brand-level carbon-neutral certification with annual offset disclosure.",cadence:"Annual"},
    {name:"UN Global Compact",url:"https://www.unglobalcompact.org/participation",desc:"Participants in the UN's voluntary corporate sustainability initiative — joined year + COP status.",cadence:"Annual"},
    {name:"JUST 100 (JUST Capital)",url:"https://justcapital.com",desc:"Annual Russell 1000 ranking on workers, customers, communities, environment, shareholders.",cadence:"Annual"},
    {name:"Ethisphere World's Most Ethical Companies",url:"https://ethisphere.com/wme",desc:"Annual ~135-company honoree list across 40+ industries.",cadence:"Annual"},
    {name:"Newsweek Most Responsible Companies",url:"https://www.newsweek.com/rankings/americas-most-responsible-companies",desc:"Annual top 600 US ranking on ESG performance.",cadence:"Annual"},
    {name:"WikiRate",url:"https://wikirate.org",desc:"Crowdsourced ESG metrics aggregator (private/public companies, all sectors).",cadence:"Monthly"},
    {name:"ToS;DR",url:"https://tosdr.org",desc:"Terms-of-service privacy grades (A–E), CC BY-SA 3.0 — used with attribution.",cadence:"Monthly"},
    {name:"DOL OFCCP EEO-1",url:"https://www.dol.gov/agencies/ofccp/foia/library/Employment-Information-Reports",desc:"Federal-contractor workforce demographics (FOIA release, FY2016-2020) — reported as facts, never a verdict.",cadence:"One-time"},
    {name:"DHS UFLPA Entity List",url:"https://www.dhs.gov/uflpa-entity-list",desc:"Companies subject to the forced-labor import-ban presumption (19 U.S.C. §1307).",cadence:"Quarterly"},
    {name:"CBP Withhold Release Orders",url:"https://www.cbp.gov/document/stats/withhold-release-orders-findings",desc:"Per-producer forced-labor detention orders and findings.",cadence:"Quarterly"},
    {name:"SAM.gov Exclusions",url:"https://sam.gov/data-services",desc:"Federal debarment registry (manually reviewed before any brand is flagged).",cadence:"Monthly"},
  ]},
  {group:"International regulators",icon:"ti-globe",items:[
    {name:"EU DG Comp Antitrust",url:"https://ec.europa.eu/competition/antitrust",desc:"European Commission antitrust + merger decisions, cartel cases, state-aid actions. Fines in EUR.",cadence:"Monthly"},
    {name:"EU Consolidated Sanctions List",url:"https://www.sanctionsmap.eu",desc:"EU financial sanctions database — entities + programmes per regulation.",cadence:"Monthly"},
    {name:"Canadian Competition Bureau",url:"https://www.canada.ca/en/competition-bureau",desc:"Canadian Competition Bureau enforcement — merger reviews, deceptive marketing, cartels. Fines in CAD.",cadence:"Monthly"},
    {name:"Australian ACCC",url:"https://www.accc.gov.au",desc:"Australian Competition & Consumer Commission enforcement actions and court cases. Fines in AUD.",cadence:"Monthly"},
  ]},
  {group:"Executive pay",icon:"ti-coin",items:[
    {name:"AFL-CIO Executive Paywatch",url:"https://aflcio.org/paywatch",desc:"Tracks CEO-to-worker pay ratios at major US corporations.",cadence:"Annual"},
    {name:"SEC Executive Compensation Proxy",url:"https://www.sec.gov/cgi-bin/browse-edgar",desc:"Official source for executive compensation disclosures.",cadence:"Annual"},
  ]},
  {group:"News & global press",icon:"ti-news",items:[
    {name:"Google News RSS",url:"https://news.google.com",desc:"Daily aggregate of US news mentions per brand across 1000+ outlets.",cadence:"Daily"},
    {name:"AllSides Media Bias",url:"https://www.allsides.com/media-bias",desc:"Bias ratings (left / lean-left / center / lean-right / right) for 33+ news outlets. Used to weight news signals so political lean of source is transparent.",cadence:"Quarterly"},
    {name:"GDELT Project",url:"https://www.gdeltproject.org",desc:"Global news + events database in 100+ languages. Catches international press that US-only sources miss.",cadence:"Weekly"},
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
                : pos > 0.6 ? "#E0524D"
                : "#EDE9E0";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-end", minWidth:120 }}>
      <div style={{
        position:"relative", width:120, height:6, borderRadius:3,
        background: "linear-gradient(to right, #4a90e2 0%, #4a90e2 30%, #555 45%, #555 55%, #E0524D 70%, #E0524D 100%)",
      }} aria-hidden="true">
        <div style={{
          position:"absolute", top:-3, left:`calc(${pos*100}% - 6px)`,
          width:12, height:12, borderRadius:"50%",
          background:dotColor, border:"2px solid #16181D",
        }} />
      </div>
      <div style={{ fontSize:10, color:"#888", display:"flex", justifyContent:"space-between", width:120 }} aria-hidden="true">
        <span>Left</span><span>Center</span><span>Right</span>
      </div>
    </div>
  );
}

// Phase 5.3 + B-11 (2026-06-01): SuggestBrandButton — captures a failed
// search query so the pipeline can pick it up on the next expansion. Now
// also offers a "notify me when added" email opt-in, turning the
// disappointment of "no results" into a MailerLite signup with a specific
// brand-name tag. The tag (brand=<query>) means the user gets a targeted
// email when THAT brand lands, not generic marketing.
//
// Flow:
//   idle  → button "Suggest 'X'"
//   form  → email input + Submit (email optional — can skip)
//   done  → "Thanks — we'll email you when X is added" (or generic if no email)
function SuggestBrandButton({ query }) {
  const prefilledEmail = getStoredEmail();
  const [phase, setPhase] = useState(() => {
    try {
      const pending = JSON.parse(localStorage.getItem("tn_pendingSubmits") || "[]");
      const found = pending.find(s => s.query.toLowerCase() === query.toLowerCase());
      if (found) return found.notifyEmail ? "done_email" : "done_anon";
    } catch {}
    return "idle";
  });
  const [email, setEmail] = useState(prefilledEmail || "");
  const [loading, setLoading] = useState(false);

  // Persist the suggestion locally + fire analytics. Email is optional.
  const finalize = async (withEmail) => {
    try {
      const pending = JSON.parse(localStorage.getItem("tn_pendingSubmits") || "[]");
      if (!pending.some(s => s.query.toLowerCase() === query.toLowerCase())) {
        pending.push({
          query,
          suggestedAt: new Date().toISOString(),
          notifyEmail: withEmail ? email.trim() : null,
        });
        localStorage.setItem("tn_pendingSubmits", JSON.stringify(pending.slice(-50)));
      }
    } catch {}
    track("failed_search_suggest", { query, hasEmail: !!withEmail });

    if (withEmail && email) {
      setLoading(true);
      // brand=<query> tag lets MailerLite segment + send a targeted email
      // to ONLY the people who asked for that brand when it lands.
      await subscribeEmail(email, "failed_search_notify", {
        brand: query,
        intendsBrandNotification: true,
      });
      setLoading(false);
      setPhase("done_email");
    } else {
      setPhase("done_anon");
    }
  };

  if (phase === "done_email") {
    return (
      <div style={{ fontSize:13, color:"#38C0CE", display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"4px 8px" }}>
        <i className="ti ti-mail-check" aria-hidden="true" />
        Thanks — we'll email you when &ldquo;{query}&rdquo; is added
      </div>
    );
  }
  if (phase === "done_anon") {
    return (
      <div style={{ fontSize:13, color:"#38C0CE", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
        <i className="ti ti-check" aria-hidden="true" />
        Thanks — we'll look at adding it
      </div>
    );
  }
  if (phase === "form") {
    return (
      <div style={{
        maxWidth:340, margin:"0 auto",
        padding:14, borderRadius:12,
        background:T.bg2, border:`1px solid ${T.border}`,
        textAlign:"left",
      }}>
        <div style={{ fontSize:13, color:T.txt2, marginBottom:10, lineHeight:1.4 }}>
          Want us to email you when <strong style={{ color:T.txt }}>&ldquo;{query}&rdquo;</strong> is added? (Optional)
        </div>
        <input
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
          style={{
            width:"100%", boxSizing:"border-box",
            background:T.bg3, border:`1px solid ${T.border2}`,
            borderRadius:10, color:T.txt,
            fontSize:16, padding:"10px 12px",
            marginBottom:10,
          }}
        />
        <div style={{ display:"flex", gap:8 }}>
          <button
            onClick={() => finalize(true)}
            disabled={loading || !email.trim()}
            style={{
              flex:1, padding:"10px 12px", borderRadius:10, border:"none",
              background:T.accent2, color:"#000",
              fontSize:13, fontWeight:700,
              cursor: loading ? "default" : "pointer",
              opacity: !email.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Saving…" : "Notify me"}
          </button>
          <button
            onClick={() => finalize(false)}
            disabled={loading}
            style={{
              padding:"10px 12px", borderRadius:10,
              border:`1px solid ${T.border}`, background:"transparent",
              color:T.txt3, fontSize:12, fontWeight:600, cursor:"pointer",
            }}
          >
            Skip — just suggest
          </button>
        </div>
      </div>
    );
  }
  // idle
  return (
    <button onClick={() => setPhase("form")} style={{
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
    // QA fix 2026-06-10: vercel.json rewrites /privacy → index.html and the
    // sitemap lists it, but only the #privacy HASH was detected here — the
    // crawlable /privacy URL rendered the marketing landing instead of the
    // policy. Accept both forms.
    if (__hash.replace(/^#/, "") === "privacy" || __pathname === "/privacy") return "privacy";
    if (__hash.replace(/^#/, "") === "methodology" || __pathname === "/methodology") return "methodology";
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
      else if (h === "methodology") setMarketingScreen("methodology");
      else if (marketingScreen === "privacy" || marketingScreen === "methodology") {
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
  try { return normalizeProfile(JSON.parse(localStorage.getItem("tn_profile") || "null")); } catch { return null; }
});
useEffect(() => {
  try {
    if (profile) localStorage.setItem("tn_profile", JSON.stringify(normalizeProfile(profile)));
    else         localStorage.removeItem("tn_profile");
  } catch {}
}, [profile]);
  // Dev-only Pro mode for QA: append `?pro=1` to localhost URL. Production-safe
  // because we additionally require import.meta.env.DEV.
  // CRITICAL FIX 2026-06-01 (audit): persist Pro entitlement across launches.
  // Was: in-memory only (URLSearchParams + dev-only) — every relaunch reset to
  // Free, breaking the Pro UX entirely for paying users.
  // Now: localStorage `tn_isPaid` reads on init, written on every setIsPaid.
  // Restore Purchase flow still TODO when real IAP lands — for now this at
  // least keeps the demo-paid state sticky across refreshes.
  const [isPaid, _setIsPaidRaw] = useState(() => {
    // IAP_SAFE_MODE: everything unlocked — no purchasable upgrade exists, so
    // nothing may be gated behind one (App Review 2.1.0/3.1.1).
    if (IAP_SAFE_MODE) return true;
    try {
      if (typeof window === "undefined") return false;
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("pro")) return true;
      return localStorage.getItem("tn_isPaid") === "1";
    } catch { return false; }
  });
  const setIsPaid = (val) => {
    _setIsPaidRaw(val);
    try { localStorage.setItem("tn_isPaid", val ? "1" : "0"); } catch {}
  };
  const [showPaywall, setShowPaywall] = useState(false);
  // H3 (2026-06-11): true when the live catalog failed and we fell back to
  // the build-time snapshot (src/companies.js) — grades may be outdated and
  // the user MUST be told. Also set when native iOS serves bundled data
  // offline (see getNativeDataSource in lib/dataSource).
  const [staleDataMode, setStaleDataMode] = useState(false);


  const [tab, setTab]           = useState(() => {
    // Dev-only: ?tab=search|browse|top|account|sources opens that tab directly (for QA)
    if (import.meta.env.DEV && typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && ["today","top","search","browse","library","account","sources","submit"].includes(t)) return t;
    }
    // R2: TODAY is the front door (brief §3.1). "top" and "browse" survive as
    // interior surfaces reachable from Lens — not bottom-nav destinations.
    return "today";
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
      // Build 54: match the server-side build-tuned options. combineWith:AND
      // means multi-word queries ("General Mills") only return companies with
      // BOTH tokens (was returning 290 fuzzy matches before).
      const results = searchIndex.search(q, { boost: { name: 5 }, prefix: true, fuzzy: 0.2, combineWith: "AND" });
      return new Set(results.map(r => r.slug || r.id));
    } catch (err) {
      console.warn("[search-index] search failed:", err);
      return null;
    }
  }, [query, searchIndex]);

  // 2026-06-01 (audit fix): removed the orphaned `tn_freeViewed` cleanup —
  // we DO use that quota now (1 free company view per week, then paywall),
  // and wiping it on every mount broke the quota tracking.
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
  // Retention v1 (2026-06-11 review): local "what changed" feed. We snapshot
  // the user-visible grade of every SAVED brand (localStorage, no backend),
  // and on each launch diff current grades against the snapshot. Changes
  // surface as a card at the top of Library → Saved and a dot on the tab.
  // This converts the daily data pipeline into a visible return-trigger
  // without accounts or push infra (APNs is the post-launch upgrade path).
  const [savedChanges, setSavedChanges] = useState([]);
  // R2 (flow A step 5): "watch my basket" intent, asked at the Reveal.
  // 2026-06-13 (review): this was a silent no-op — nothing read it. It now
  // gates whether basket record-changes surface as the Today story card (the
  // "flag me" promise, in-app since there's no push yet); the Library → Saved
  // feed still shows them regardless. It also seeds the APNs opt-in for when
  // push lands (R3). No OS prompt is burned before push infrastructure exists.
  const [watchBasket, setWatchBasket] = useState(() => {
    try { return localStorage.getItem("tn_watchBasket") === "1"; } catch { return false; }
  });
  // Review fix (2026-06-11): default surfaces exclude non-consumer companies
  // (EDGAR mid-caps, B2B). Search still finds them by exact intent — they
  // rank below consumer matches — and this toggle reveals everything.
  const [showAllCompanies, setShowAllCompanies] = useState(false);
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
    fetchAppData("/data/weekly_changes.json", { cache: "no-cache" })
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
    fetchAppData("/data/editorial.json", { cache: "no-cache" })
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

  // R2 (the Switch, brief flow C): commit a swap. Logs the pair + monthly
  // spend to tn_switches (the Ledger's impact source), and pulls the swap
  // target into the basket so its records are watched from day one. The
  // departed brand stays saved — its future records are exactly the
  // "told you so" the Ledger exists to show.
  const commitSwitch = useCallback((from, fromName, to, toName, monthly) => {
    try {
      const list = JSON.parse(localStorage.getItem("tn_switches") || "[]");
      list.push({ from, fromName, to, toName, monthly: Number(monthly) || 0, at: Date.now() });
      localStorage.setItem("tn_switches", JSON.stringify(list));
    } catch {}
    setSavedSet(prev => {
      if (prev.has(to)) return prev;
      const next = new Set(prev); next.add(to);
      try { localStorage.setItem("tn_saved", JSON.stringify([...next])); } catch {}
      return next;
    });
    track("switch_committed", { from, to, monthly: Number(monthly) || 0 });
  }, []);

  // 2026-06-01: scroll to top whenever the active tab changes. Bottom-nav
  // tap = "fresh view" intent; preserving scroll across tabs felt buggy.
  const tabScrollRef = React.useRef(null);
  useEffect(() => {
    if (tabScrollRef.current) tabScrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    // Also reset window scroll for the rare cases where the inner div
    // delegates to body (older Safari with no overflow ancestor).
    try { window.scrollTo({ top: 0, behavior: "auto" }); } catch {}
  }, [tab]);

  // Analytics — init once, then track key funnel events
  useEffect(() => { initAnalytics(); }, []);

  // 2026-06-12 review: instrument surface navigation. Previously a single
  // capture_pageview fired per SPA load with no per-tab signal, so Today /
  // Lens / Ledger / You engagement and the Today→Ledger loop were invisible.
  useEffect(() => { track("surface_view", { tab }); }, [tab]);

  // PR-3: warm the feature-flag cache as early as possible so the FIRST
  // computeScore() call honors the runtime flag (otherwise iOS would always
  // see flag=off for the first paint, then flicker when the JSON resolves).
  // Triggers a state bump on resolution so any already-mounted CategoryRows
  // re-render with the correct flag state.
  const [, setFeatureFlagsTick] = useState(0);
  useEffect(() => {
    loadFeatureFlags().then(() => setFeatureFlagsTick(t => t + 1)).catch(() => {});
  }, []);

  // B-23 (2026-06-01): Universal Link handler. When iOS opens the app via
  // a tapped https://www.trunorthapp.com/company/<slug> link from iMessage /
  // Safari / Mail / Twitter / etc, the Capacitor App plugin fires
  // 'appUrlOpen' with the full URL. We parse out the slug and navigate
  // directly to the brand — without this, the link would open the app
  // but dump the user on the home screen.
  //
  // Web users hit this same /company/<slug> path via normal navigation;
  // they're already handled by the deep-link logic on first render.
  useEffect(() => {
    if (!__isCapacitorNative) return;
    let unlisten = null;
    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appUrlOpen", (event) => {
          try {
            const url = new URL(event.url);
            // /company/<slug> or /c/<slug>
            const m = url.pathname.match(/^\/(?:company|c)\/([^/?#]+)/);
            if (m && m[1]) {
              const slug = decodeURIComponent(m[1]);
              openBrand(slug, { trackEvent: "universal_link_opened", trackProps: { full_url: event.url } });
            }
          } catch (err) {
            console.warn("[universal-link] failed to parse:", event?.url, err);
          }
        });
        unlisten = () => handle.remove();
      } catch (err) {
        console.warn("[universal-link] App plugin unavailable:", err);
      }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
    // QA fix 2026-06-10: the marketing-landing gate (and vercel rewrites)
    // accept BOTH /company/<slug> and the short /c/<slug> form, but this
    // parser only matched /company/ — so /c/ links entered the app and then
    // silently landed on Top Picks with nothing opened.
    const m = window.location.pathname.match(/^\/(?:company|c)\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  // Phase 5.aj: when scanner matches OR Better-Alts taps a brand, we want
  // the search to show JUST that one company — not a list of name-matches.
  // focusedSlug overrides the filter chain entirely and pops a "Clear ×"
  // banner so the user can return to normal search.
  const [focusedSlug, setFocusedSlug] = useState(null);

  // A-1 (audit H3): Single canonical navigation helper. Every entry point
  // that lands the user on a brand's detail panel routes through here, so
  // behavior stays consistent across Brand-of-Day, Scanner, Library,
  // History, Weekly Digest, Quiz winner, Day-7, Typeahead, Universal Link,
  // and CompanyCard alternatives.
  //
  // Defaults match the most common case (focus + switch to search tab).
  // Edge cases pass options to deviate:
  //   - focusDetail: false   — Brand-of-Day card surfaces brand without
  //                             pinning it (e.g. Day-7 list)
  //   - switchTab: false     — already on the target screen
  //   - setMainScreen: true  — quiz winner exits the quiz overlay first
  //   - clearFilters: true   — Scanner clears filters so the match isn't
  //                             hidden by an active category filter
  //   - clearQuery: true     — Typeahead empties the search box on tap
  //   - trackEvent: 'name'   — fire analytics with consistent shape
  const openBrand = useCallback((slug, options = {}) => {
    if (!slug) return;
    const {
      focusDetail = true,
      switchTab   = true,
      setMainScreen = false,
      clearFilters  = false,
      clearQuery    = false,
      trackEvent    = null,
      trackProps    = {},
    } = options;

    // 2026-06-04 (user-reported): on iOS, the soft keyboard stayed up
    // after tapping a search result because nothing ever blurred the
    // active input. Centralized blur here so EVERY nav entry point
    // (typeahead, search-card click, Top Picks, Compare-with, news
    // related-brand chip, deep link, etc.) dismisses the keyboard.
    try {
      if (typeof document !== "undefined" && document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    } catch {}

    if (trackEvent) track(trackEvent, { slug, ...trackProps });
    setDeepLinkSlug(slug);
    if (focusDetail)  setFocusedSlug(slug);
    if (switchTab)    setTab("search");
    if (setMainScreen) setScreen("main");
    if (clearFilters) {
      setLeanFilter("all");
      setCatFilters([]);
      setFlagFilters([]);
      setShowSavedOnly(false);
    }
    if (clearQuery) {
      setQueryRaw("");
      setQuery("");
    }
  }, []);

  useEffect(() => {
    if (companies) return;
    // 2026-06-05 (PageSpeed Tier 1): don't load the 11k-brand catalog when
    // we're rendering the marketing landing or privacy page — those screens
    // don't need it. Previously the catalog loaded unconditionally on App
    // mount, costing ~600 KB gzipped of parse+execute on every marketing
    // visitor (most of whom never enter the SPA — they tap "Get TruNorth
    // on iOS" instead). PageSpeed TBT on / dropped from 4.6s → ~1s once
    // this gate landed.
    if (marketingScreen === "landing" || marketingScreen === "privacy" || marketingScreen === "methodology") return;
    let cancelled = false;
    const splitFirst = isSplitBundleEnabled();
    const primary  = () => splitFirst ? loadCompanyIndex() : import("./companies.js").then(m => m.COMPANIES);
    const fallback = () => splitFirst ? import("./companies.js").then(m => m.COMPANIES) : loadCompanyIndex();
    primary()
      .then(list => {
        if (cancelled) return;
        setCompanies(list);
        // Native offline: index came from the .ipa's bundled copy → data is
        // as old as the installed build. Same banner as the web fallback.
        if (getNativeDataSource() === "bundled") setStaleDataMode(true);
      })
      .catch(err => {
        console.error("[dataSource] primary failed, trying fallback:", err);
        fallback()
          .then(list => { if (!cancelled) { setCompanies(list); setStaleDataMode(true); } })
          .catch(err2 => console.error("[dataSource] fallback also failed:", err2));
      });
    return () => { cancelled = true; };
  }, [companies, marketingScreen]);

  // Retention v1: diff saved brands' grades vs the last-seen snapshot.
  useEffect(() => {
    if (!companies || savedSet.size === 0) return;
    let snap = {};
    try { snap = JSON.parse(localStorage.getItem("tn_savedGradeSnap") || "{}"); } catch {}
    const next = {};
    const changes = [];
    for (const slug of savedSet) {
      const co = companies.find(c => (c.slug || c.id) === slug);
      if (!co) continue;
      const ps = computeScore(co, profile);
      const g = scoreGrade(ps, userRelevantRealCats(co, profile));
      next[slug] = { g, at: Date.now() };
      const prev = snap[slug];
      if (prev && prev.g && prev.g !== "?" && g !== "?" && prev.g !== g) {
        changes.push({ slug, name: co.name, from: prev.g, to: g });
      }
    }
    // Persist the new snapshot immediately — the in-memory list keeps this
    // session's diffs visible; next launch starts from today's grades.
    try { localStorage.setItem("tn_savedGradeSnap", JSON.stringify(next)); } catch {}
    if (changes.length) {
      setSavedChanges(changes);
      track("saved_grades_changed", { count: changes.length });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, profile]);

  // R2 (Today): record this week's basket-alignment % so Today can show the
  // week-over-week delta and Ledger can sparkline it. Last 12 weeks kept.
  useEffect(() => {
    if (!companies || !profile || savedSet.size === 0) return;
    const savedCos = Array.from(savedSet).map(s => companies.find(c => (c.slug || c.id) === s)).filter(Boolean);
    const { pct } = basketAlignment(savedCos, profile);
    if (pct == null) return;
    try {
      const hist = JSON.parse(localStorage.getItem("tn_alignHist") || "{}");
      hist[weekKey(Date.now())] = pct;
      const keys = Object.keys(hist).sort().slice(-12);
      localStorage.setItem("tn_alignHist", JSON.stringify(Object.fromEntries(keys.map(k => [k, hist[k]]))));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, profile, savedSet]);

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
    // QA fix 2026-06-10: the old 800ms clear timer raced the lazy MiniSearch
    // index — when the search-hits list mounted the card later than 800ms
    // (cold load), initiallyOpen was already false and shared links landed on
    // a COLLAPSED row. Now the card itself reports consumption via
    // onConsumedDeepLink (below); the 15s timer is only a safety net against
    // stale auto-open if the card never mounts at all.
    const t = setTimeout(() => setDeepLinkSlug(null), 15000);
    return () => clearTimeout(t);
  }, [deepLinkSlug, companies]);

  // UX 1A: memoize the dedupe/filter/sort chain so it doesn't rerun on unrelated state changes
  const deduped = useMemo(
    () => (companies || []).filter((() => {
        // H1 (2026-06-11 tech review): was O(n²) findIndex over 12,841
        // entries — measured 577ms on an M2, 1.5-3s of jank on phones,
        // to drop ~6 duplicates. One-pass Set is O(n).
        const seen = new Set();
        return (c) => { if (seen.has(c.name)) return false; seen.add(c.name); return true; };
      })()),
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
      // Consumer gating: hide non-consumer entries from BROWSE surfaces
      // (no query). With a query, keep them — someone typing "gulfport
      // energy" means it — but they sort below consumer matches.
      if (!showAllCompanies && c.consumerFacing === false && !query.trim() && !showSavedOnly) return false;
      // Phase 5.ak (item #6): industry-bucket filter — strict bucket match
      if (industryBucket && getBucket(c.cat || "") !== industryBucket) return false;
      return true;
    })
    .sort((a,b) => {
      // Consumer-first: within any sort, consumer-facing entries rank above
      // non-consumer ones (search for "target" → the retailer, not an
      // obscure same-named entity).
      const ca = a.consumerFacing === false ? 1 : 0;
      const cb = b.consumerFacing === false ? 1 : 0;
      if (ca !== cb) return ca - cb;
      // QA fix 2026-06-10: without a profile computeScore returns co.overall
      // RAW — null/undefined on the ~6,300 stub brands — so score-sort
      // compared NaN and ordered arbitrarily. `?? -1` sinks no-data brands
      // below every real score (which bottoms out at 0).
      if (sort==="score") return (computeScore(b,profile) ?? -1) - (computeScore(a,profile) ?? -1);
      if (sort==="name") return a.name.localeCompare(b.name);
      const o={left:0,"left-leaning":1,bipartisan:2,mixed:3,neutral:4,right:6,"right-leaning":6};
      return (o[(a.sc.political||"").toLowerCase()]??5) - (o[(b.sc.political||"").toLowerCase()]??5);
    });
  },
    [deduped, leanFilter, catFilters, flagFilters, query, searchHits, sort, profile, showSavedOnly, savedSet, focusedSlug, industryBucket, showAllCompanies]
  );

  // Phase 5.ag (perf): cap rendered company cards. Creating 11,000+ JSX
  // elements on every keystroke (even with memo'd cards) blows out the
  // render budget. Show the first N matches and a "Show more" button.
  const VISIBLE_BATCH = 200;
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_BATCH);
  useEffect(() => { setVisibleLimit(VISIBLE_BATCH); }, [query, leanFilter, catFilters, flagFilters, sort, showSavedOnly, industryBucket]);
  const visibleFiltered = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);

  // Build 54: previously this was a useEffect([query]) → setFocusedSlug(null).
  // That fired every time query changed — INCLUDING when openBrand sets the
  // query programmatically (e.g. Brand of the Day tap, scanner match), which
  // immediately cleared the focused-detail state and dumped the user into a
  // fuzzy-search list with their brand way down the page. The fix: release
  // focusedSlug ONLY on real user typing, which we do in the input's onChange
  // handler below (search for "setFocusedSlug(null)" in the input element).

  // UX 4E: recent searches (last 5 distinct queries with at least one result)
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tn_recentSearches") || "[]"); }
    catch { return []; }
  });
  // Trending brands — wired to /public/data/trending.json on 2026-06-01.
  // The nightly cron at scripts/refresh-trending.mjs pulls top brands from
  // PostHog and writes them here. We filter to only brands that EXIST in our
  // index (slug != null) so taps always land somewhere real, and fall back
  // to the curated hardcoded list when:
  //   - fetch fails (offline / first load)
  //   - the file has fewer than 3 matched brands (low-signal day)
  const TRENDING_FALLBACK = ["Patagonia", "Amazon", "Costco", "Tesla", "Nike"];
  const [TRENDING_BRANDS, setTrendingBrands] = useState(TRENDING_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetch("/data/trending.json", { cache: "no-cache" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data?.brands) return;
        // Only matched brands (slug present) — unmatched names like "ARDELYX"
        // would route to a dead search.
        const matched = data.brands
          .filter(b => b.slug && b.name)
          .slice(0, 5)
          .map(b => b.name);
        if (matched.length >= 3) setTrendingBrands(matched);
        // else: keep the curated fallback — better than a 1-brand chip row
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Analytics — fire `search` only after the query SETTLES (M4: the old
  // per-deferred-value event sent every partial keystroke state — "n",
  // "nik", "nike" — to PostHog; one settled event per search intent is
  // enough and far less invasive).
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const settle = setTimeout(() => {
      track("search", { query: q.slice(0, 60), result_count: filtered.length });
      // 2026-06-12 review: this stash used to sit AFTER the cleanup `return`
      // below — unreachable since the M4 settle refactor, so "Recent" never
      // populated for anyone. Record settled, non-empty searches here.
      if (filtered.length > 0) {
        setRecentSearches(prev => {
          const next = [q, ...prev.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
          try { localStorage.setItem("tn_recentSearches", JSON.stringify(next)); } catch {}
          return next;
        });
      }
    }, 1200);
    return () => clearTimeout(settle);
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
  //
  // 2026-06-04 (user-requested): Top Picks is now a CURATED list of the
  // ~50 most household-recognizable US brands. Previously it scored every
  // brand with 3+ filled categories and ranked them — but that made Top
  // Picks unpredictable (a regional bank could outrank Amazon). For a
  // pre-launch consumer app, "Top Picks" should mean "the brands you
  // already know" so first-time users see something they recognize and
  // can immediately compare against their values.
  //
  // Order below is intentional — household frequency-of-use, roughly.
  // Brands missing from the catalog (or with no data) are silently
  // dropped on render. Profile-based ranking still applies WITHIN this
  // curated set so two users get different orderings.
  const TOP_PICKS_CURATED = [
    // Retail / e-commerce
    "amazon", "walmart", "target", "costco", "kroger", "home-depot", "lowe-s",
    "best-buy", "trader-joe-s", "whole-foods", "publix",
    // Food & beverage giants
    "coca-cola", "pepsi", "nestl", "starbucks", "mcdonald-s", "chipotle",
    "subway", "chick-fil-a", "dunkin", "taco-bell", "wendy-s", "burger-king",
    // Tech consumer
    "apple", "google-alphabet", "microsoft", "meta-facebook", "netflix",
    "spotify", "uber", "lyft", "airbnb", "tesla",
    // Apparel & lifestyle
    "nike", "adidas", "lululemon", "gap-inc", "patagonia",
    // Banks & finance
    "jpmorgan-chase", "bank-of-america", "wells-fargo", "capital-one", "american-express",
    "paypal",
    // Travel & hospitality
    "hilton", "marriott", "delta-air-lines", "united-airlines", "american-airlines",
    "southwest-airlines",
    // CPG & household
    "procter-and-gamble", "unilever", "johnson-and-johnson", "kraft-heinz",
    "general-mills",
  ];
  const topPicksRanked = useMemo(() => {
    const idx = new Map(deduped.map(c => [c.slug, c]));
    return TOP_PICKS_CURATED
      .map(slug => idx.get(slug))
      .filter(Boolean)
      .map(c => ({ co: c, score: computeScore(c, profile) ?? -1 }))
      .sort((a, b) => b.score - a.score)
      .map(({ co }) => co);
  }, [deduped, profile]);
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
    const candidates = deduped.filter(c => ["A","B"].includes(scoreGrade(c.overall || 50, c.realCats)));
    const pick = (candidates.length ? candidates : deduped)[Math.floor(Math.random() * (candidates.length || deduped.length))];
    try { sessionStorage.setItem("tn_teaserCompany", pick.slug || pick.id); } catch {}
    return pick;
  }, [deduped, profile]);
  const catIconMap = {Retail:"ti-building-store",Food:"ti-chef-hat",Technology:"ti-device-laptop",Grocery:"ti-shopping-cart",Energy:"ti-bolt",Apparel:"ti-shirt",Media:"ti-device-tv",Finance:"ti-building-bank",Healthcare:"ti-heartbeat",Outdoor:"ti-mountain",Consumer:"ti-package",Conglomerate:"ti-building-skyscraper",Auto:"ti-car",Sports:"ti-ball-basketball"};
  const catBgs = ["#1e1535","#0E2126","#0d1f35","#291110","#2e1a05","#2a1a05"];
  const catFgs = ["#5CD6E0","#38C0CE","#4a90e2","#E0524D","#e8a042","#E8A04C"];

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
  if (marketingScreen === "methodology") {
    return <Methodology onBack={() => {
      try { window.location.hash = ""; } catch {}
      setMarketingScreen(__isCapacitorNative || !__isRoot ? "app" : "landing");
    }} />;
  }
  if (marketingScreen === "privacy") {
    return <PrivacyPolicy onBack={() => {
      try { window.location.hash = ""; } catch {}
      // CRITICAL FIX 2026-06-01 (audit): was referencing __skipMarketing which
      // was never declared — Privacy → Back threw ReferenceError and
      // white-screened the app. Native always returns to app; web returns to
      // landing only when on the root URL.
      setMarketingScreen(__isCapacitorNative || !__isRoot ? "app" : "landing");
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
        // R2 (brief flow A): basket BEFORE the Match — pick what you buy,
        // then your answers immediately have something to judge.
        track("basket_picker_shown", { from: "onboarding_rail" });
        setQueryRaw(""); // start the basket search empty (shows the chip cloud)
        setScreen("basket");
      }}
    />
  );
}

if (screen === "basket") {
  // R2 (brief flow A step 2): "Pick what you actually buy" — a chip cloud of
  // the most-documented household brands. Picks seed the basket (savedSet)
  // so the Reveal can say "your basket: N% aligned" with receipts attached.
  // QA-20: pure-B2B brands (consultancies, commercial fleets, enterprise SaaS)
  // leak into the pool via high record counts + a consumer-ish bucket; exclude
  // the obvious ones by name until consumerFacing data flags cover them. Search
  // results are NOT filtered, so a user can still add one deliberately.
  const BASKET_EXCLUDE_RE = /\b(accenture|brightdrop|deloitte|mckinsey|kpmg|pwc|pricewaterhouse|ernst\s*&?\s*young|booz\s*allen|bain\s*(?:capital|&|company)|boston consulting|cognizant|infosys|capgemini|tata consultancy|wipro|salesforce|servicenow|workday|sap se|oracle)\b/i;
  const pool = (deduped || [])
    .filter(c => c.consumerFacing !== false && (c.realCats ?? 0) >= 5 && !BASKET_EXCLUDE_RE.test(String(c.name || "")) && ["Food & Beverage", "Retail", "Apparel & Fashion", "Beauty & Personal Care", "Software & Technology", "Automotive", "Furniture & Home", "Entertainment & Media", "Hospitality & Travel", "Sports & Fitness", "Pet Care"].includes(getBucket(c.cat || "")))
    .sort((a, b) => (b.realCats ?? 0) - (a.realCats ?? 0) || String(a.name).localeCompare(String(b.name)))
    .slice(0, 40);
  // R2 brief flow A specced search alongside the chip cloud (review): a user who
  // buys none of the 40 household chips was stuck with only the tiny "skip".
  // Substring-filter `deduped` directly — it's already loaded (the chip pool
  // uses it), so this works during first-run even before the lazy MiniSearch
  // index is ready (MiniSearch's searchHits is null then → don't depend on it).
  const _bq = queryRaw.trim().toLowerCase();
  const basketSearchResults = _bq
    ? (deduped || [])
        .filter(c => c.consumerFacing !== false && String(c.name || "").toLowerCase().includes(_bq))
        .sort((a, b) => (b.realCats ?? 0) - (a.realCats ?? 0) || String(a.name).localeCompare(String(b.name)))
        .slice(0, 30)
    : null;
  const basketChips = basketSearchResults || pool;
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100dvh", maxWidth:"var(--app-max, 430px)", margin:"0 auto", paddingTop:"calc(env(safe-area-inset-top, 0px) + 18px)", overflow:"hidden", background:T.bg }}>
      <div style={{ padding:"0 22px", flexShrink:0 }}>
        <div style={{ fontFamily:SERIF, fontSize:26, color:T.txt, lineHeight:1.25 }}>Pick what you actually buy.</div>
        <div style={{ fontSize:13, color:T.txt2, lineHeight:1.5, marginTop:8 }}>
          Tap 5–10 brands. Their public records become your ledger — judged against your values in the next 45 seconds.
        </div>
        <input
          value={queryRaw}
          onChange={(e) => setQueryRaw(e.target.value)}
          placeholder="Search any brand…"
          aria-label="Search for a brand to add to your basket"
          style={{ width:"100%", boxSizing:"border-box", marginTop:14, background:T.bg3, border:`1px solid ${T.border}`, borderRadius:10, color:T.txt, fontSize:16, padding:"11px 13px" }}
        />
      </div>
      <div style={{ flex:1, minHeight:0, overflowY:"auto", WebkitOverflowScrolling:"touch", padding:"16px 22px 12px" }}>
        {!pool.length ? (
          <div style={{ padding:"40px 0", textAlign:"center", color:T.txt3, fontSize:13 }}>Loading brands…</div>
        ) : basketSearchResults && !basketSearchResults.length ? (
          <div style={{ padding:"40px 0", textAlign:"center", color:T.txt3, fontSize:13 }}>No brands match “{queryRaw.trim()}”.</div>
        ) : (
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {basketChips.map(co => {
              const slug = co.slug || co.id;
              const on = savedSet.has(slug);
              return (
                <button key={slug} onClick={() => toggleSaved(slug, co.name)} aria-pressed={on}
                  style={{ display:"inline-flex", alignItems:"center", gap:7, padding:"8px 12px 8px 8px", borderRadius:22, fontSize:12.5, fontWeight:600, cursor:"pointer", background: on ? T.accentBg : T.bg2, color: on ? T.accent2 : T.txt, border:`1px solid ${on ? T.accent : T.border}` }}>
                  <CompanyLogo company={co} size={22} />
                  {co.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ flexShrink:0, padding:"10px 22px calc(env(safe-area-inset-bottom, 0px) + 16px)", borderTop:`1px solid ${T.border}`, background:T.bg }}>
        <button
          onClick={() => { track("basket_picked", { count: savedSet.size }); track("browse_started", { from: "basket_picker" }); setQueryRaw(""); setScreen("main"); }}
          disabled={savedSet.size === 0}
          style={{ width:"100%", padding:"15px 12px", borderRadius:13, background: savedSet.size ? "#EDE9E0" : T.bg3, color: savedSet.size ? "#111" : T.txt3, border:"none", fontSize:15, fontWeight:700, cursor: savedSet.size ? "pointer" : "default" }}>
          {savedSet.size ? `Continue with ${savedSet.size} ${savedSet.size === 1 ? "brand" : "brands"}` : "Pick at least one brand"}
        </button>
        <button onClick={() => { track("basket_skipped", {}); track("browse_started", { from: "basket_picker_skip" }); setQueryRaw(""); setScreen("main"); }}
          style={{ width:"100%", background:"none", border:"none", color:T.txt3, fontSize:11.5, cursor:"pointer", padding:"10px 0 0", textAlign:"center" }}>
          skip for now
        </button>
      </div>
    </div>
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
    // QA fix 2026-06-10: ranked by RAW computeScore while the badge showed the
    // signal-count-CAPPED grade — a sparse 2-category brand could post a 100
    // numeric score, win "Your top match", and render with a C badge above
    // runners-up showing B (Aron repro: BYD CO C/100 over ColourPop B). Now:
    // (1) gate to 3+ real categories (same bar as Top Picks), and (2) rank by
    // the capped grade FIRST, numeric score as tiebreak, so the badge order
    // always matches the list order.
    const GRADE_RANK = { A: 5, B: 4, C: 3, D: 2, F: 1, "?": 0 };
    const top3 = (companies || [])
      .filter(c => {
        if (typeof c.realCats === "number") return c.realCats >= 3;
        const sc = c.sc || {};
        return Object.keys(sc).filter(k => {
          const v = String(sc[k] || "").toLowerCase();
          return v && v !== "neutral" && v !== "unknown" && v !== "na";
        }).length >= 3;
      })
      .map(c => {
        const score = computeScore(c, profile);
        return { co: c, score, grade: scoreGrade(score, userRelevantRealCats(c, profile)) };
      })
      .sort((a, b) => ((GRADE_RANK[b.grade] || 0) - (GRADE_RANK[a.grade] || 0)) || (b.score - a.score))
      .slice(0, 3);
    const winner = top3[0];
    // R2 review — slimmed Reveal to one payoff: archetype → clash → one CTA.
    // If the user has a basket, the sharpest clash is the hook; otherwise their
    // top match is. Never both (showing two payoffs + runners-up + the weighting
    // math was the 9-ask overload the review flagged). Computed once here so the
    // clash card and the top-match gate stay mutually exclusive.
    const savedCos = savedSet.size > 0
      ? Array.from(savedSet).map(s => (companies || []).find(c => (c.slug || c.id) === s)).filter(Boolean)
      : [];
    const basketView = savedCos.length ? basketVerdict(savedCos, profile, companies || []) : null;
    const hasBasketPayoff = !!(basketView && basketView.graded > 0);
    return (
      <div style={{ height:"100dvh", maxWidth:"var(--app-max, 430px)", margin:"0 auto", display:"flex", flexDirection:"column", overflow:"hidden", background:T.bg, paddingTop:"env(safe-area-inset-top,0px)" }}>
        <div style={{ flex:1, overflowY:"auto", padding:"32px 20px 12px", display:"flex", flexDirection:"column", alignItems:"center", boxSizing:"border-box", width:"100%" }}>
          {/* R1: YOUR compass — spoke lengths are the user's own weights.
              This is the identity object the whole redesign hangs on. */}
          <div style={{ marginBottom:16 }}>
            <CompassSeal weights={{ ...PROFILE_DEFAULT_WEIGHTS, ...(profile?.weights || {}) }} size={116} glow
              title="Your values compass" />
          </div>
          {/* Phase 5.au: Values Fingerprint card — the #1 stickiness play.
              Coined identity ("The Climate Pragmatist") derived from quiz
              weights, with a 4-letter shareable codename and a 1-sentence
              blurb. Pinned to Account; resurfaced every 14 days. */}
          {(() => {
            const fp = computeFingerprint(profile);
            if (!fp) return null;
            return (
              <div style={{ width:"100%", maxWidth:340, marginBottom:18, padding:"16px 18px", boxSizing:"border-box", background:T.accentBg, border:`1.5px solid ${T.accent}`, borderRadius:16, textAlign:"center" }}>
                <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:8 }}>
                  Your values archetype
                </div>
                <div style={{ fontFamily:SERIF, fontSize:24, fontWeight:600, color:T.txt, lineHeight:1.2, marginBottom:4 }}>{fp.name}</div>
                <div style={{ fontSize:11, color:T.accent2, fontFamily:MONO, letterSpacing:1.5, marginBottom:3 }}>{fp.codename}</div>
                <div style={{ fontSize:10, color:T.txt3, marginBottom:10 }}>your values code · top categories + lean</div>
                <div style={{ fontSize:12.5, color:T.txt2, lineHeight:1.5 }}>{fp.blurb}</div>
              </div>
            );
          })()}
          {/* R2 review: the per-category weighting math used to render here
              ("Weighing most for you: …"). Cut from the celebration screen —
              the compass seal above already shows those weights as spoke
              lengths, and the numeric breakdown cooled the peak moment. The
              detailed math still lives on the Account fingerprint + Methodology. */}
          {/* R2 (flow A step 4): the basket, judged — the personal payoff.
              The % the user just earned by answering, plus the ONE sharpest
              clash with a route to its receipts (the verdict card has the
              swap + switch waiting one tap away). */}
          {hasBasketPayoff && (() => {
            const bv = basketView;
            const n = bv.clashes.length;
            const worst = bv.clashes[0] || null;
            return (
              <div style={{ width:"100%", maxWidth:340, marginBottom:18, padding:"14px 16px", boxSizing:"border-box", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16 }}>
                <div style={{ fontFamily:MONO, fontSize:10, color:T.gold, letterSpacing:"0.14em", marginBottom:8 }}>YOUR BASKET, JUDGED</div>
                <div style={{ fontFamily:SERIF, fontSize:20, color:T.txt, lineHeight:1.3 }}>
                  {n === 0
                    ? "Nothing in your basket clashes with your compass."
                    : n === 1
                      ? "One of your brands clashes with your compass."
                      : `${n} of your brands clash with your compass.`}
                </div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:4 }}>{bv.graded} of {savedCos.length} graded · <span style={{ color:T.accent2 }}>{bv.aligned} aligned</span> · {bv.neutral} neutral</div>
                {worst && (
                  <button
                    onClick={() => openBrand(worst.co.slug || worst.co.id, { setMainScreen: true, focusDetail: false, switchTab: false })}
                    style={{ marginTop:10, width:"100%", textAlign:"left", padding:"10px 12px", borderRadius:10, background:T.bg3, border:"none", borderLeft:"3px solid #E0524D", cursor:"pointer" }}>
                    <div style={{ fontSize:12.5, color:T.txt, fontWeight:600 }}>Sharpest clash: {worst.co.name} — {worst.g}</div>
                    {bv.swap && (
                      <div style={{ fontFamily:MONO, fontSize:10.5, color:T.gold, marginTop:3 }}>one switch: → {bv.swap.to.co.name} {bv.swap.to.g}</div>
                    )}
                    <div style={{ fontFamily:MONO, fontSize:10.5, color:T.txt3, marginTop:3 }}>tap for the receipts ↗</div>
                  </button>
                )}
                <button
                  onClick={() => {
                    const next = !watchBasket;
                    setWatchBasket(next);
                    try { localStorage.setItem("tn_watchBasket", next ? "1" : "0"); } catch {}
                    track(next ? "watch_basket_on" : "watch_basket_off", { from: "reveal" });
                  }}
                  aria-pressed={watchBasket}
                  style={{ marginTop:10, width:"100%", padding:"10px 12px", borderRadius:10, fontSize:12, fontWeight:600, cursor:"pointer", background: watchBasket ? T.accentBg : "transparent", border:`1px solid ${watchBasket ? T.accent : T.border2}`, color: watchBasket ? T.accent2 : T.txt2, display:"flex", alignItems:"center", gap:7, justifyContent:"center" }}>
                  <i className={`ti ${watchBasket ? "ti-check" : "ti-bell"}`} aria-hidden="true" />
                  {watchBasket ? "Watching your basket for record changes" : "Watch my basket — flag me when records change"}
                </button>
              </div>
            );
          })()}
          {/* R2 review: dropped the redundant "Your values are set." headline —
              the archetype card + compass already deliver the identity beat. Kept
              one functional line so users know grades are now personalized.
              maxWidth:340 (not 100%) so the italic "you" can't overflow on narrow
              iPhones — the 2026-06-01 fix. */}
          <div style={{ fontSize:14, color:T.txt2, textAlign:"center", marginBottom:22, lineHeight:1.4, maxWidth:340, width:"100%", paddingLeft:8, paddingRight:8, boxSizing:"border-box" }}>
            Every grade you see is now tailored to <em style={{ color:T.accent2, fontStyle:"normal", fontWeight:600 }}>you</em>.
          </div>
          {/* R2 review: the top match is the payoff ONLY when there's no basket
              clash to lead with — otherwise the clash card above is the hook, and
              showing both (plus a runners-up list) was the overload the review
              flagged. One payoff, never two. */}
          {!hasBasketPayoff && winner && (
            <>
              <div style={{ fontSize:11, color:T.txt3, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>Your top match</div>
              <div
                onClick={() => openBrand(winner.co.slug || winner.co.id, { setMainScreen: true, focusDetail: false, switchTab: false })}
                style={{ width:"100%", maxWidth:340, boxSizing:"border-box", background:T.bg2, border:`2px solid ${T.accent}`, borderRadius:16, padding:18, cursor:"pointer", display:"flex", alignItems:"center", gap:14, marginBottom:14 }}
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
                  const wg = scoreGrade(winner.score, userRelevantRealCats(winner.co, profile));
                  const palette = {
                    A: { bg:"#0E2126", border:"#1E444A", text:"#38C0CE" },
                    B: { bg:"#19230F", border:"#2E4A1E", text:"#9CC98A" },
                    C: { bg:"#1F2228", border:"#2A2E35", text:"#E8A04C" },
                    D: { bg:"#241B0D", border:"#4A381E", text:"#E8A04C" },
                    F: { bg:"#291110", border:"#4A1E1E", text:"#E0524D" },
                  }[wg] || { bg:T.bg3, border:T.border2, text:T.txt3 };
                  return (
                    <div style={{ width:44, height:44, borderRadius:10, background:palette.bg, border:`1px solid ${palette.border}`, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <div style={{ fontSize:18, fontWeight:700, color:palette.text, lineHeight:1 }}>{wg}</div>
                      <div style={{ fontSize:9, color:palette.text, opacity:0.7 }}>{winner.score}</div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
          {/* B-6 (2026-06-01): soft email ask at the highest-intent moment.
              Quiz completion = peak emotional investment. Component handles
              its own state, suppresses if email already captured. */}
          <RevealEmailCapture />
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
              // QA-12: attach the rendered values card so it actually posts to
              // Stories/Snap/DMs (many apps don't unfurl OG previews). Optional —
              // falls back to url-only share if the fetch or canShare fails.
              try {
                const imgResp = await fetch(`https://www.trunorthapp.com/api/og/values?${qp.toString()}`);
                if (imgResp.ok) {
                  const blob = await imgResp.blob();
                  const file = new File([blob], "my-trunorth-values.png", { type: blob.type || "image/png" });
                  if (navigator.canShare?.({ ...shareData, files: [file] })) shareData.files = [file];
                }
              } catch { /* image optional */ }
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
            /* R2 review: ONE primary CTA. Share is the growth loop but it was a
               second co-equal filled button competing with Explore — demoted to a
               subordinate ghost link so the eye lands on the primary action. */
            style={{ width:"100%", padding:"10px 14px", borderRadius:12, border:"none", background:"transparent", color:T.txt3, fontSize:13, fontWeight:500, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
          >
            <i className="ti ti-share" aria-hidden="true" /> Share my values
          </button>
          <button
            onClick={() => setScreen("main")}
            style={{ width:"100%", padding:14, borderRadius:12, border:"none", background:T.accent2, color:"#000", fontSize:15, fontWeight:700, cursor:"pointer" }}
          >
            Explore all 12,000+ brands →
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
      <div style={{ height:"100dvh", maxWidth:"var(--app-max, 430px)", margin:"0 auto", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {showPaywall && !IAP_SAFE_MODE && <PaywallScreen
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
            try { localStorage.setItem("tn_paywallDismissedAt", String(Date.now())); } catch {}
            setShowPaywall(false);
            setScreen("main");
          }}
        />}
        <MatchFlow
          // R2 (brief flow B): the Match replaces the quiz. Same props
          // contract, same output shape — engine untouched. Retakes hydrate
          // from the existing profile (H10 parity).
          initialProfile={profile}
          onComplete={(p) => {
            setProfile(p);
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
    <div style={{ height:"100%", width:"100%", maxWidth:"var(--app-max, 430px)", margin:"0 auto", background:T.bg2, display:"flex", flexDirection:"column" }}>
      {showPaywall && !IAP_SAFE_MODE && <PaywallScreen initialEmail={currentUser?.email||""} onSubscribe={(paidEmail)=>{
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
        try { localStorage.setItem("tn_paywallDismissedAt", String(Date.now())); } catch {}
        setShowPaywall(false);
      }} />}
      {/* UX 7B: barcode scanner overlay — opens camera, decodes, routes to match */}
      {showScanner && (
        <BarcodeScanner
          companies={companies || []}
          onClose={() => setShowScanner(false)}
          onMatch={(co, meta) => {
            setShowScanner(false);
            track("scanner_match", { slug: co.slug || co.id, name: co.name, barcode: meta?.barcode, source: meta?.source });
            // Phase 5.aj: focus on exactly that one company — no list.
            // openBrand with clearFilters+clearQuery does the full reset.
            openBrand(co.slug || co.id, { clearFilters: true, clearQuery: true });
          }}
          onSearch={(brand) => {
            // Build 53 (B): no-match fallback — close scanner, jump to Search tab
            // with the OFF / UPCitemdb brand string pre-filled. Never shows a dead-end.
            setShowScanner(false);
            track("scanner_search_fallback", { brand });
            setQuery(brand);
            setTab("search");
            // Release any focusedSlug from a prior openBrand so the search query
            // is what filters the list (matches the Build 53 search bug fix at
            // line ~4838).
            setFocusedSlug(null);
          }}
        />
      )}
      <WhatsNewModal companyCount={companies?.length || 12000} />

      {/* UX 8B: aria-live region for screen readers — announces filtered count
          and which tab is active without visual clutter. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {tab === "search" && (query.trim() || leanFilter !== "all" || catFilters.length > 0 || showSavedOnly)
          ? `${filtered.length} compan${filtered.length === 1 ? "y matches" : "ies match"} your filters`
          : `${tab} tab`}
      </div>

      {/* Header — Phase 5.y: title is true-centered now (3-column grid) so the
          Pro/Upgrade chip width on the right can't shift it off-center. */}
      <div style={{ padding:"calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px", background:T.bg, flexShrink:0, zIndex:10, borderBottom:`1px solid ${T.border}` }}>
        {/* 2026-06-01 (user feedback): logo + 'TruNorth' wordmark were
            visually separated by a 3-column grid (logo left / title center /
            upgrade right) — looked disjointed. Now grouped as a single
            unit on the left, matching the email-signature lockup. The
            cut-off 'Know where your money goes · N companies' tagline
            was always being truncated → removed entirely (info already
            lives in marketing landing + search placeholder + About). */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: tab !== "account" ? 12 : 0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
            <div style={{ width:36, height:36, background:T.accentBg, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/></svg>
            </div>
            <div style={{ fontSize:20, fontWeight:800, color:T.txt, letterSpacing:-0.3, lineHeight:1, whiteSpace:"nowrap" }}>
              Tru<span style={{ color:T.accent2 }}>North</span>
            </div>
          </div>
          {/* Build 53 (B-57): Account moved to top-right header so bottom-nav
              middle slot can host the SCAN button — making the killer feature
              the most prominent action in the UI. */}
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            <button
              onClick={()=>setTab("account")}
              aria-label="Account"
              style={{
                width:40, height:40, borderRadius:"50%",
                background: tab === "account" ? T.accentBg : "transparent",
                border:`1px solid ${T.accent}`,
                color: T.accent2,
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", padding:0
              }}
            >
              <i className="ti ti-user-circle" style={{ fontSize:20 }} aria-hidden="true" />
            </button>
            {/* IAP_SAFE_MODE: no Pro chip, no Upgrade button — the App Store
                binary carries zero purchase affordances until IAP is real. */}
            {!IAP_SAFE_MODE && (isPaid
              ? <div style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"4px 10px", borderRadius:20, display:"flex", alignItems:"center", gap:4 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Pro</div>
              : <button onClick={()=>setShowPaywall(true)} style={{ background:T.goldBg, border:`1px solid ${T.gold}`, color:T.gold, fontSize:11, padding:"8px 12px", borderRadius:20, cursor:"pointer", display:"flex", alignItems:"center", gap:4, minHeight:40 }}><i className="ti ti-crown" style={{fontSize:11}} aria-hidden="true" /> Upgrade</button>
            )}
          </div>
        </div>
        {tab !== "account" && (
          <div style={{ position:"relative" }}>
            <div style={{ background:T.bg3, borderRadius:16, padding:"0 14px", display:"flex", alignItems:"center", gap:10, border:`1px solid ${T.border}` }}>
              <i className="ti ti-search" style={{ fontSize:18, color:T.txt3 }} aria-hidden="true" />
              <label htmlFor="tn-search" className="sr-only">Search companies</label>
              <input id="tn-search" value={queryRaw} onChange={e=>{
                  setQueryRaw(e.target.value);
                  setTab("search");
                  // Build 54: release focusedSlug only on real user typing —
                  // never on programmatic query changes (openBrand, deep-link,
                  // scanner match) so detail panels stay open when navigated to.
                  if (focusedSlug) setFocusedSlug(null);
                }} placeholder={`Search ${formatCompanyCount(deduped.length)} companies...`}
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
                    // 2026-06-13 (review): the typeahead leaked baseline letters
                    // while every other surface gates grades behind the Match
                    // (`profile ? grade : "?"`). Respect the gate — and show the
                    // PERSONALIZED grade for quizzed users, like the shelf/rows.
                    const g = profile ? scoreGrade(computeScore(co, profile), userRelevantRealCats(co, profile)) : "?";
                    const gradeColor = { A:"#38C0CE", B:"#9CC98A", C:"#E8A04C", D:"#E8A04C", F:"#E0524D" }[g] || T.txt3;
                    return (
                      <button
                        key={co.slug || co.id}
                        onMouseDown={(e) => { e.preventDefault(); }}
                        onClick={() => {
                          // 2026-06-04 (user-reported): tapping a search
                          // result on iOS left the keyboard up because we
                          // never blurred the input. Explicit blur tears
                          // it down before the brand sheet opens.
                          try { document.getElementById("tn-search")?.blur(); } catch {}
                          setShowSearchDropdown(false);
                          openBrand(co.slug || co.id, { trackEvent: "search_typeahead_clicked", clearQuery: true });
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

      {/* Scrollable content — 2026-06-01: ref'd so we can reset scroll to
          top on tab change. Without this, switching tabs preserves the
          previous tab's scroll position, which confuses users who tap a
          bottom-nav tab expecting to "start over." */}
      {/* 2026-06-01 v2 (still fixing "entire screen moves"): touchAction:
          'pan-y' tells the browser this element handles vertical pan only,
          preventing the body / outer WebView from interpreting the drag.
          overscrollBehavior contain stops momentum from escaping upward
          to body even on iOS where it likes to ignore the rule. */}
      <div ref={tabScrollRef} style={{ flex:1, overflowY:"auto", WebkitOverflowScrolling:"touch", overscrollBehavior:"contain", touchAction:"pan-y", background:T.bg }}>

      {/* Profile strip — locked to v4 (centered pill) on 2026-06-01 per
          user pick. Other variants stripped. Edit takes user back to the
          quiz to update their values. */}
      {profile && (
        <div style={{ padding:"6px 16px", display:"flex", justifyContent:"center", background:T.bg }}>
          <button
            onClick={() => { track("quiz_started", { from: "profile_strip_edit" }); setScreen("quiz"); }}
            style={{
              display:"inline-flex", alignItems:"center", gap:6,
              padding:"5px 12px", borderRadius:999,
              background:T.accentBg, border:`1px solid ${T.accent}`,
              color:T.accent2, fontSize:11, fontWeight:600, cursor:"pointer",
            }}
          >
            <i className="ti ti-sparkles" style={{ fontSize:11 }} aria-hidden="true" />
            Personalized · Tap to edit
          </button>
        </div>
      )}

      {/* H3 (2026-06-11): stale-data honesty banner — shown whenever grades
          on screen may not reflect the latest records (offline native, or
          web fell back to the build-time snapshot). */}
      {staleDataMode && (
        <div style={{ margin:"6px 16px 0", padding:"8px 12px", borderRadius:10, background:T.bg3, border:`1px solid ${T.border2}`, display:"flex", alignItems:"center", gap:8 }}>
          <i className="ti ti-wifi-off" style={{ fontSize:14, color:T.txt3, flexShrink:0 }} aria-hidden="true" />
          <div style={{ fontSize:11, color:T.txt3, lineHeight:1.4 }}>
            Offline — showing saved data. Grades may not reflect the latest public records.
          </div>
        </div>
      )}

      {/* TODAY — the daily pulse (R2, brief §3.1): three cards, no lists.
          1. Compass card — your seal + basket alignment. Tap → Ledger.
          2. Story card — one record-driven story for YOU (brass = receipt).
          3. Shelf card — one curated category, ranked for you. Daily rotate. */}
      {tab === "today" && (
        <ErrorBoundary name="today">
          {(() => {
            const savedCos = Array.from(savedSet).map(s => deduped.find(c => (c.slug || c.id) === s)).filter(Boolean);

            // Story pick: your basket moved → this week's digest → quiet week.
            // 2026-06-13 (review): the basket-change story is gated on the
            // "watch my basket" opt-in — toggling it ON at the Reveal is what
            // surfaces record changes here on Today (the Library → Saved feed
            // shows them regardless). Makes the watch toggle a real control.
            const story = watchBasket ? (savedChanges[0] || null) : null;
            const weeklyStory = !story && weeklyChanges?.changes?.length ? weeklyChanges.changes[0] : null;

            // Shelf: deterministic daily category. WHITELISTED to aisles a
            // person actually shops (no "Professional Services" staffing
            // firms), with a documentation floor (≥3 record categories) so
            // the shelf surfaces household names, not thin-file mid-caps.
            const SHELF_BUCKETS = ["Food & Beverage", "Retail", "Apparel & Fashion", "Beauty & Personal Care", "Software & Technology", "Automotive", "Furniture & Home", "Entertainment & Media", "Hospitality & Travel", "Sports & Fitness", "Pet Care"];
            const day = Math.floor(Date.now() / 864e5);
            const shelfPool = deduped.filter(c => c.consumerFacing !== false && c.overall != null && (c.realCats ?? 0) >= 3);
            const present = SHELF_BUCKETS.filter(b => shelfPool.some(c => getBucket(c.cat || "") === b));
            const bucket = present.length ? present[day % present.length] : null;
            const shelf = bucket
              ? shelfPool
                  .filter(c => getBucket(c.cat || "") === bucket)
                  .map(co => ({ co, s: profile ? computeScore(co, profile) : co.overall }))
                  .filter(x => x.s != null)
                  .sort((a, b) => b.s - a.s)
                  .slice(0, 4)
              : [];

            const card = { background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px 16px" };
            return (
              <div style={{ padding: "10px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* 1 · COMPASS CARD */}
                {!profile ? (
                  <button onClick={() => { track("quiz_started", { from: "today_compass_card" }); setScreen("quiz"); }}
                    style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
                    <CompassSeal weights={null} size={64} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: SERIF, fontSize: 19, color: T.txt, lineHeight: 1.25 }}>Find your bearings.</div>
                      <div style={{ fontSize: 12, color: T.txt2, marginTop: 4, lineHeight: 1.45 }}>Nine quick choices shape your compass — then every brand answers to it.</div>
                      <div style={{ fontSize: 11, color: T.accent2, fontWeight: 600, marginTop: 6 }}>Start the Match · 45 seconds →</div>
                    </div>
                  </button>
                ) : savedCos.length === 0 ? (
                  <button onClick={() => setTab("search")}
                    style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}>
                    <CompassSeal weights={profile.weights} size={64} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: SERIF, fontSize: 19, color: T.txt, lineHeight: 1.25 }}>Your compass is set.</div>
                      <div style={{ fontSize: 12, color: T.txt2, marginTop: 4, lineHeight: 1.45 }}>Save the brands you actually buy and Today starts judging them against it.</div>
                      <div style={{ fontSize: 11, color: T.accent2, fontWeight: 600, marginTop: 6 }}>Build your basket →</div>
                    </div>
                  </button>
                ) : (
                  /* B68 (A+C): clash-led sentence + one-switch projection.
                     The aligned-% punished every strong-stance user with a
                     daily "0%" when the truth was "mostly neutral, one
                     fixable problem." Clashes lead; the compass points at
                     the next move. Same math, different headline. */
                  (() => {
                    const bv = basketVerdict(savedCos, profile, deduped);
                    const n = bv.clashes.length;
                    const headline = bv.graded === 0
                      ? "Your basket awaits its first records."
                      : n === 0
                        ? "Nothing in your basket clashes with your compass."
                        : n === 1
                          ? "One clash on the record. The rest holds steady."
                          : `${n} clashes on the record.`;
                    return (
                      <button onClick={() => setTab("library")}
                        style={{ ...card, textAlign: "left", cursor: "pointer" }}
                        aria-label={`Your basket: ${n} ${n === 1 ? "clash" : "clashes"} of ${bv.graded} graded. Open Basket.`}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <CompassSeal weights={profile.weights} size={64} glow={n === 0} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: T.txt3, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 3 }}>Your basket</div>
                            <div style={{ fontFamily: SERIF, fontSize: 17.5, color: T.txt, lineHeight: 1.3 }}>{headline}</div>
                          </div>
                        </div>
                        {n > 0 && (
                          <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${T.border}` }}>
                            <div style={{ fontSize: 12.5, color: T.txt }}>
                              <span style={{ color: "#E0524D" }}>●</span> {bv.clashes[0].co.name} — {bv.clashes[0].g}
                              {n > 1 && <span style={{ color: T.txt3 }}> · +{n - 1} more</span>}
                            </div>
                            {bv.swap && (
                              <div style={{ fontFamily: MONO, fontSize: 11, color: T.gold, marginTop: 5 }}>
                                one switch: {bv.swap.from.co.name} {bv.swap.from.g} → {bv.swap.to.co.name} {bv.swap.to.g}
                              </div>
                            )}
                          </div>
                        )}
                        {n === 0 && bv.best && (
                          <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${T.border}`, fontSize: 12.5, color: T.txt }}>
                            <span style={{ color: "#38C0CE" }}>●</span> Strongest match: {bv.best.co.name} — {bv.best.g}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: T.txt3, marginTop: 8 }}>{bv.graded} graded · {savedCos.length} in basket · open Basket →</div>
                      </button>
                    );
                  })()
                )}

                {/* 2 · STORY CARD */}
                {story ? (
                  <button onClick={() => openBrand(story.slug)} style={{ ...card, borderLeft: `3px solid ${T.gold}`, textAlign: "left", cursor: "pointer" }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.gold, letterSpacing: "0.12em", marginBottom: 7 }}>YOUR BASKET · RECORD CHANGE</div>
                    <div style={{ fontFamily: SERIF, fontSize: 19, color: T.txt, lineHeight: 1.3 }}>
                      New public records moved {story.name} from {story.from} to {story.to}.
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: T.txt3, marginTop: 8 }}>tap for the receipt ↗</div>
                  </button>
                ) : weeklyStory ? (
                  <button onClick={() => openBrand(weeklyStory.slug)} style={{ ...card, borderLeft: `3px solid ${T.gold}`, textAlign: "left", cursor: "pointer" }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.gold, letterSpacing: "0.12em", marginBottom: 7 }}>THIS WEEK ON THE RECORD</div>
                    <div style={{ fontFamily: SERIF, fontSize: 19, color: T.txt, lineHeight: 1.3 }}>
                      {weeklyStory.name || weeklyStory.slug} moved {weeklyStory.from ? `${weeklyStory.from} → ${weeklyStory.to}` : "this week"}.
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: T.txt3, marginTop: 8 }}>tap for the receipt ↗</div>
                  </button>
                ) : (
                  <div style={{ ...card, borderLeft: `3px solid ${T.border2}` }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.txt3, letterSpacing: "0.12em", marginBottom: 7 }}>THIS WEEK ON THE RECORD</div>
                    <div style={{ fontFamily: SERIF, fontSize: 17, color: T.txt2, lineHeight: 1.35 }}>
                      We're watching {savedCos.length ? "your basket" : "the records"} — no grade changes this week.
                    </div>
                    <div style={{ fontSize: 11, color: T.txt3, marginTop: 7 }}>Records refresh nightly across 200+ public sources.</div>
                  </div>
                )}

                {/* 3 · SHELF CARD */}
                {shelf.length >= 2 && (
                  <div style={{ ...card }}>
                    <div style={{ fontFamily: SERIF, fontSize: 18, color: T.txt, marginBottom: 2 }}>{bucket}, ranked {profile ? "for you" : "by record"}</div>
                    <div style={{ fontSize: 11, color: T.txt3, marginBottom: 12 }}>Today's shelf · rotates daily</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {shelf.map(({ co }) => {
                        const g = profile ? scoreGrade(computeScore(co, profile), userRelevantRealCats(co, profile)) : "?";
                        const gcol = { A: "#38C0CE", B: "#9CC98A", C: T.txt2, D: "#E8A04C", F: "#E0524D", "?": T.txt3 }[g];
                        return (
                          <button key={co.slug || co.id} onClick={() => openBrand(co.slug || co.id)}
                            style={{ flex: 1, minWidth: 0, background: T.bg3, border: `1px solid ${T.border2}`, borderRadius: 12, padding: "10px 4px 8px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                            <CompanyLogo company={co} size={34} />
                            <div style={{ fontSize: 10, color: T.txt2, fontWeight: 600, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.name}</div>
                            <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600, color: gcol }}>{g}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </ErrorBoundary>
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
                    style={{ position:"absolute", top:6, right:6, width:28, height:28, padding:0, borderRadius:14, border:"none", background:"transparent", color:T.txt3, fontSize:16, minWidth:44, minHeight:44, cursor:"pointer" }}
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
                          onClick={() => openBrand(b.slug, { focusDetail: false, trackEvent: "day7_brand_clicked" })}
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
            <button onClick={()=>setShowAllCompanies(v=>!v)} style={{ fontSize:11, color:showAllCompanies?T.accent2:T.txt3, background:showAllCompanies?T.accentBg:"transparent", border:`1px solid ${showAllCompanies?T.accent:T.border2}`, borderRadius:20, padding:"4px 9px", cursor:"pointer" }} title="Include banks, utilities, and other non-consumer companies in browse">{showAllCompanies ? "All companies" : "Consumer brands"}</button>
            {(leanFilter!=="all"||catFilters.length>0||query||showSavedOnly) && (
              <button onClick={()=>{setLeanFilter("all");setCatFilters([]);setQueryRaw("");setQuery("");setShowSavedOnly(false);setShowAllCompanies(false);}} style={{ fontSize:11, color:T.rep, background:T.repBg, border:`1px solid ${T.rep}`, borderRadius:20, padding:"4px 9px", cursor:"pointer" }}>Clear all</button>
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
                instead of the full A–Z list (Top Picks tab already shows the full list).
                2026-06-01 (user feedback) bug fix: must ALSO check industryBucket — when
                the user taps an industry from Browse, openBucket() clears all other
                filters and only sets industryBucket. Without this check, the empty-
                state captured the click and the industry's company list never rendered. */}
            {!query.trim() && leanFilter === "all" && catFilters.length === 0 && !showSavedOnly && !industryBucket ? (
              <div style={{ padding:"24px 4px" }}>
                {/* R2: Browse + Top Picks left the bottom nav — Lens is their
                    front door now. Two quiet chips, always visible pre-query. */}
                <div style={{ display:"flex", gap:8, marginBottom:20 }}>
                  <button onClick={()=>setTab("browse")}
                    style={{ flex:1, padding:"11px 10px", borderRadius:12, fontSize:12.5, fontWeight:600, background:T.bg3, border:`1px solid ${T.border2}`, color:T.txt2, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
                    <i className="ti ti-apps" aria-hidden="true" /> Browse categories
                  </button>
                  <button onClick={()=>setTab("top")}
                    style={{ flex:1, padding:"11px 10px", borderRadius:12, fontSize:12.5, fontWeight:600, background:T.bg3, border:`1px solid ${T.border2}`, color:T.txt2, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 }}>
                    <i className="ti ti-star" aria-hidden="true" /> Top picks
                  </button>
                </div>
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
                  Type to search {formatCompanyCount(deduped.length)} companies — or <button onClick={()=>setTab("top")} style={{ background:"none", border:"none", color:T.accent2, fontSize:12, textDecoration:"underline", cursor:"pointer", padding:0 }}>browse the full list</button>
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
                {visibleFiltered.map(co => <CompanyCard key={co.id} company={co} catFilter={catFilters.length===1?catFilters[0]:"all"} profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} onNavigate={(slug) => openBrand(slug)} onCommitSwitch={commitSwitch} initiallyOpen={deepLinkSlug && (co.slug || co.id) === deepLinkSlug} onConsumedDeepLink={() => setDeepLinkSlug(null)} />)}
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

      {/* BROWSE — locked to v1 (tile grid) on 2026-06-01 per user pick.
          Phase 5.al's 3 alternatives (alt-a / alt-b / alt-c) stripped. */}
      {tab === "browse" && (
        <ErrorBoundary name="browse">{(() => {
          const openBucket = (cat, count) => {
            // 2026-06-01 bug fix: reset EVERY filter so the industry view
            // always shows that bucket's full set, even if the user had
            // filters active from a prior session.
            setIndustryBucket(cat);
            setQueryRaw(""); setQuery("");
            setCatFilters([]); setFlagFilters([]);
            setLeanFilter("all");
            setShowSavedOnly(false);
            setFocusedSlug(null);
            setTab("search");
            track("browse_category_open", { bucket: cat, count });
          };

          // ── V1: tile grid (locked default) ───────────────────────────────
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
          {/* 2026-06-01 (user feedback): Brand of the Day moved ABOVE Top
              Picks. Daily-ritual hook + journalism framing belongs at the
              top of the tab; the ranked list still appears immediately
              below. */}
          <BrandOfDayCard
            editorial={editorial}
            deduped={deduped}
            profile={profile}
            openBrand={openBrand}
          />
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
                    onNavigate={(slug) => openBrand(slug)} onCommitSwitch={commitSwitch}
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
                        onClick={() => openBrand(c.slug, { trackEvent: "saved_update_clicked", trackProps: { type: c.type } })}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, cursor:"pointer", textAlign:"left", width:"100%" }}
                      >
                        <i className="ti ti-rosette" style={{ fontSize:14, color: c.severity === "alert" ? "#E0524D" : T.gold, flexShrink:0 }} aria-hidden="true" />
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
                  {weeklyChanges.stats?.gradeChanges || 0} grade · {weeklyChanges.stats?.newScandals || 0} news flag · {weeklyChanges.stats?.newRecalls || 0} recall
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {weeklyChanges.changes.slice(0, 5).map((c, i) => {
                  const tint = c.severity === "alert" ? "#E0524D"
                            : c.severity === "warn"  ? "#E8A04C"
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
                      onClick={() => openBrand(c.slug, { focusDetail: false, trackEvent: "weekly_digest_clicked", trackProps: { type: c.type } })}
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

          {/* Phase 5.ag (item N) — Brand of Day moved to top of tab on
              2026-06-01 per user feedback. Renders via <BrandOfDayCard />
              above the Top Picks list. */}

          {/* 2026-06-01: removed monthly stats card — depended on the
              I-bought/I-skipped toggle which we just killed. Reintroduce
              after Year-in-Review feature is properly designed. */}

          <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
            <div style={{ fontSize:12, color:T.txt3 }}>Ranked by {profile?"your personalized score":"average score"} · Letter grade shown</div>
          </div>
          {/* UX 6A: personalized score teaser */}
          {!profile && !teaserDismissed && teaserCompany && (
            <div style={{ margin:"10px 16px 0", padding:"12px 14px", background:T.accentBg, border:`1px solid ${T.accent}`, borderRadius:12, display:"flex", alignItems:"center", gap:12 }}>
              <i className="ti ti-sparkles" style={{ fontSize:20, color:T.accent2, flexShrink:0 }} aria-hidden="true" />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:T.txt, lineHeight:1.3 }}>See <strong>{teaserCompany.name}</strong>'s score tailored to <em>your</em> values</div>
                <div style={{ fontSize:11, color:T.txt3, marginTop:3 }}>45-second Match — free</div>
              </div>
              <button
                onClick={()=>{ track("personalized_teaser_clicked", { slug: teaserCompany.slug || teaserCompany.id, name: teaserCompany.name }); track("quiz_started", { from: "personalized_teaser" }); setScreen("quiz"); }}
                style={{ padding:"7px 12px", borderRadius:8, border:"none", background:T.accent2, color:"#000", fontSize:12, fontWeight:700, cursor:"pointer", flexShrink:0 }}
              >Take the Match</button>
              <button
                onClick={()=>{ setTeaserDismissed(true); try { sessionStorage.setItem("tn_teaserDismissed","1"); } catch {} track("personalized_teaser_dismissed"); }}
                style={{ width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, minWidth:44, minHeight:44, cursor:"pointer", flexShrink:0 }}
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
              <CompanyCard key={co.id} company={co} catFilter="all" profile={profile} isPaid={isPaid} onUpgrade={()=>setShowPaywall(true)} isSaved={savedSet.has(co.slug || co.id)} onToggleSave={() => toggleSaved(co.slug || co.id, co.name)} inCompare={isInCompare(co.slug || co.id)} onToggleCompare={() => toggleCompare(co.slug || co.id, co.name)} allCompanies={companies} onCompareWith={(otherSlug, otherName) => { setCompareList([{ slug: co.slug || co.id, name: co.name }, { slug: otherSlug, name: otherName }]); setShowCompare(true); track("compare_via_alt", { from: co.slug || co.id, to: otherSlug }); }} onNavigate={(slug) => openBrand(slug)} onCommitSwitch={commitSwitch} />
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
          {/* R2 (Ledger, brief §3.3): the money's record — alignment dial,
              impact counter, committed switches. Sections render only once
              they have something true to say (no fabricated aggregates). */}
          {(() => {
            const savedCos = Array.from(savedSet).map(s => deduped.find(c => (c.slug || c.id) === s)).filter(Boolean);
            const bv = basketVerdict(savedCos, profile, deduped);
            let switches = [];
            try { switches = JSON.parse(localStorage.getItem("tn_switches") || "[]"); } catch {}
            const monthly = switches.reduce((a, s) => a + (Number(s.monthly) || 0), 0);
            if (bv.graded === 0 && !switches.length) return null;
            return (
              <div style={{ padding:"14px 16px 4px", background:T.bg2, borderBottom:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", gap:10 }}>
                  {bv.graded > 0 && (
                    /* B68 (A+C): clash count leads; aligned/neutral are the
                       quiet sublines. The old aligned-% met every strong-
                       stance user with "0%" — see basketVerdict(). */
                    <div style={{ flex:1, padding:"12px 14px", background:T.bg3, borderRadius:14, border:`1px solid ${bv.clashes.length ? "#4A1E1E" : T.border}` }}>
                      <div style={{ fontSize:10, color:T.txt3, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600 }}>On the record</div>
                      <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                        <span style={{ fontFamily:MONO, fontSize:26, fontWeight:700, color: bv.clashes.length ? "#E0524D" : T.txt }}>{bv.clashes.length}</span>
                        <span style={{ fontSize:10.5, color:T.txt3 }}>{bv.clashes.length === 1 ? "clash" : "clashes"} · {bv.graded} graded</span>
                      </div>
                      <div style={{ fontSize:10.5, color:T.txt3, marginTop:6 }}>
                        <span style={{ color:"#38C0CE" }}>{bv.aligned} aligned</span> · {bv.neutral} neutral
                      </div>
                    </div>
                  )}
                  {switches.length > 0 && (
                    <div style={{ flex:1, padding:"12px 14px", background:T.bg3, borderRadius:14, border:`1px solid ${T.gold}` }}>
                      <div style={{ fontSize:10, color:T.gold, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600 }}>Redirected</div>
                      <div style={{ fontFamily:MONO, fontSize:26, fontWeight:700, color:T.txt }}>{monthly ? `$${monthly}` : "—"}<span style={{ fontSize:11, color:T.txt3, fontWeight:500 }}>{monthly ? "/mo" : ""}</span></div>
                      <div style={{ fontSize:10.5, color:T.txt3, marginTop:2 }}>{monthly ? `$${monthly * 12}/yr · ` : ""}{switches.length} {switches.length === 1 ? "switch" : "switches"}</div>
                    </div>
                  )}
                </div>
                {switches.length > 0 && (
                  <div style={{ marginTop:10, marginBottom:10 }}>
                    {switches.slice(-3).reverse().map((sw, i, arr) => (
                      <div key={i} style={{ display:"flex", alignItems:"baseline", gap:8, padding:"5px 2px", fontFamily:MONO, fontSize:11, color:T.txt2, borderBottom: i < arr.length - 1 ? `1px dashed ${T.border}` : "none" }}>
                        <span style={{ color:T.txt3 }}>{new Date(sw.at).toLocaleDateString(undefined, { month:"short", day:"numeric" })}</span>
                        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{sw.fromName} → <span style={{ color:T.accent2 }}>{sw.toName}</span></span>
                        <span style={{ marginLeft:"auto", color:T.gold }}>{sw.monthly ? `$${sw.monthly}/mo` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`, background:T.bg2 }}>
            {[
              { id:"saved",   label:"Basket",  icon:"ti-star",     count: savedSet.size },
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

          {/* Retention v1: what-changed card — the reason to come back. */}
          {librarySubtab === "saved" && savedChanges.length > 0 && (
            <div style={{ margin:"12px 16px 0", padding:"12px 14px", borderRadius:12, background:T.accentBg, border:`1px solid ${T.accent}` }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.accent2, marginBottom:8 }}>
                <i className="ti ti-bell" aria-hidden="true" style={{ marginRight:5 }} />
                Since your last visit
              </div>
              {savedChanges.slice(0, 6).map(ch => (
                <div key={ch.slug} onClick={() => openBrand(ch.slug)} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", cursor:"pointer", fontSize:13, color:T.txt2 }}>
                  <span style={{ flex:1, fontWeight:600, color:T.txt }}>{ch.name}</span>
                  <span style={{ color:T.txt3 }}>{ch.from}</span>
                  <i className="ti ti-arrow-right" style={{ fontSize:12, color:T.txt3 }} aria-hidden="true" />
                  <span style={{ fontWeight:800, color: "ABC".includes(ch.to) && !"ABC".includes(ch.from) ? "#38C0CE" : ("DF".includes(ch.to) && !"DF".includes(ch.from) ? "#E0524D" : T.txt) }}>{ch.to}</span>
                </div>
              ))}
              <div style={{ fontSize:10.5, color:T.txt3, marginTop:6 }}>Grades moved because new public records arrived for these brands.</div>
            </div>
          )}

          {/* ── SAVED sub-tab ─────────────────────────────────────────── */}
          {librarySubtab === "saved" && (() => {
            const savedSlugs = Array.from(savedSet);
            let savedCos = savedSlugs.map(s => deduped.find(c => (c.slug || c.id) === s)).filter(Boolean);
            // Phase 5.as (QA friction #6): sort + category filter for Library/Saved.
            // A user with 20+ saved brands can't find anything in a flat dump.
            if (savedSortMode === "grade") {
              savedCos = [...savedCos].sort((a,b) => (computeScore(b, profile) ?? -1) - (computeScore(a, profile) ?? -1));
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
                  <div style={{ fontSize:15, fontWeight:600, color:T.txt2 }}>Your basket is empty</div>
                  <div style={{ fontSize:12, marginTop:6, lineHeight:1.4 }}>
                    Tap the ☆ on any brand to add it to your basket.
                  </div>
                  <button
                    onClick={() => setTab("search")}
                    style={{ marginTop:18, padding:"10px 18px", borderRadius:10, background:T.accentBg, border:`1px solid ${T.accent}`, color:T.accent2, fontSize:13, fontWeight:600, cursor:"pointer" }}
                  >
                    Build your basket →
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
                    /* H4 fix: fontSize:16 stops iOS Safari from auto-zooming
                       on focus. The previous 12 looked nicer but trapped
                       users in zoomed-Library state until they pinch out. */
                    style={{ background:T.bg3, color:T.txt, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 8px", fontSize:16, flexShrink:0, minHeight:36 }}
                    aria-label="Sort your basket"
                  >
                    <option value="recent">Recently added</option>
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
                    Nothing in your basket under <strong>{savedCategoryFilter}</strong>. <button onClick={() => setSavedCategoryFilter("all")} style={{ background:"none", border:"none", color:T.accent2, textDecoration:"underline", cursor:"pointer" }}>Clear filter</button>
                  </div>
                ) : savedCos.map(co => {
                  const ps = computeScore(co, profile);
                  const g = scoreGrade(ps, userRelevantRealCats(co, profile));
                  const colors = { A:"#38C0CE", B:"#9CC98A", C:"#E8A04C", D:"#E8A04C", F:"#E0524D", "?":T.txt3 };
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
                      onClick={() => openBrand(co.slug || co.id, { trackEvent: "library_saved_clicked", trackProps: { change_count: changeCount } })}
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
                        aria-label="Remove from basket"
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
                        onClick={() => openBrand(e.slug, { trackEvent: "history_clicked" })}
                        style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 16px", background:T.bg2, border:"none", borderBottom:`1px solid ${T.border}`, cursor:"pointer", textAlign:"left", width:"100%" }}
                      >
                        {fullCo && <CompanyLogo company={fullCo} size={32} />}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:T.txt, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.name}</div>
                          <div style={{ fontSize:11, color:T.txt3, marginTop:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{e.cat || ""} · {ago}</div>
                        </div>
                        {fullCo && (() => {
                          const ps = computeScore(fullCo, profile);
                          const g = scoreGrade(ps, userRelevantRealCats(fullCo, profile));
                          const colors = { A:"#38C0CE", B:"#9CC98A", C:"#E8A04C", D:"#E8A04C", F:"#E0524D", "?":T.txt3 };
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
          // 2026-06-05 (B-33 — full Pro-gate per Aron's call). Free users
          // see 10 household-name anchor sources + a single locked tile
          // "+90 more verified sources" — the source-by-category
          // breakdown that used to render here is now Pro-only.
          // Rationale: prevents competitors from cloning our data pipeline
          // by reading our app. The "100 public-records sources" badge
          // on landing still drives credibility; the recipe stays behind
          // the wall. Per-grade source citations are also Pro-only (see the
          // gated panel below) — consistent with the "Unlock per-grade
          // citations" upsell; the audit trail is a Pro benefit (Aron 2026-06-14).
          //
          // Source count is computed from SOURCES_DATA so it never goes
          // stale as we add more sources.
          (() => {
            const totalSources = SOURCES_DATA.reduce((a, g) => a + g.items.length, 0);
            const ANCHOR_NAMES = ["FEC.gov","OSHA","EPA","SEC EDGAR","NLRB","CFPB","NHTSA","CISA","OpenFDA","DOJ"];
            const remaining = Math.max(0, totalSources - ANCHOR_NAMES.length);
            return (
              <div style={{ padding:16 }}>
                <p style={{ fontSize:13, color:T.txt3, marginBottom:14, lineHeight:1.6 }}>
                  Every score is researched from <strong style={{ color:T.txt2 }}>200+ primary public-record sources</strong> — federal regulators, court records, accredited certifications, independent monitors. The {totalSources} highest-signal feeds are listed below across {SOURCES_DATA.length} categories; the full registry ships in the data pipeline.
                </p>

                {/* Anchor names — proof of credibility */}
                <div style={{ padding:"12px 14px", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:12, marginBottom:14 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>
                    Verified by
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {ANCHOR_NAMES.map(n => (
                      <span key={n} style={{ fontSize:11, fontWeight:600, padding:"5px 10px", borderRadius:8, background:T.bg3, color:T.txt2, border:`1px solid ${T.border}` }}>{n}</span>
                    ))}
                  </div>
                </div>

                {/* 2026-06-05: revised copy — was "Full source list with URLs
                    unlocks at Pro" which oversold what Pro actually shows. The
                    real Pro value-add is the PER-GRADE citation depth on each
                    brand's profile, NOT a global source-name dump. Reframed
                    around what users actually benefit from. */}
                <button
                  onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }}
                  style={{ width:"100%", padding:"14px 16px", background:T.bg2, border:`1px dashed ${T.border2}`, borderRadius:12, marginBottom:14, cursor:"pointer", textAlign:"left" }}
                  aria-label="Unlock per-grade source citations with Pro"
                >
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <i className="ti ti-lock" style={{ fontSize:20, color:T.gold }} aria-hidden="true" />
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:T.txt }}>Per-grade source citations</div>
                      <div style={{ fontSize:11, color:T.txt3, marginTop:2 }}>See the exact filings that drove each brand's grade — unlocks with Pro</div>
                    </div>
                    <i className="ti ti-chevron-right" style={{ fontSize:14, color:T.txt3 }} aria-hidden="true" />
                  </div>
                </button>

                <div style={{ padding:"12px 14px", background:T.bg3, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:14, fontSize:12, color:T.txt3, lineHeight:1.55 }}>
                  <strong style={{ color:T.txt2 }}>Why no full source list here?</strong> Listing every endpoint we depend on makes us trivially replicable. Pro members see source citations on every brand grade — that's the audit trail that matters.
                </div>

                <button onClick={()=>{ window.scrollTo(0,0); setShowPaywall(true); }} style={{ width:"100%", padding:"13px 24px", borderRadius:12, border:"none", background:T.gold, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
                  <i className="ti ti-crown" style={{ marginRight:6 }} aria-hidden="true" />
                  Unlock per-grade citations — $1.99/mo
                </button>
                <div style={{ fontSize:11, color:T.txt3, textAlign:"center", marginTop:8, lineHeight:1.5 }}>
                  Pro shows which specific records drove each brand's grade.
                </div>
              </div>
            );
          })()
        ) : (
        // 2026-06-01 (user feedback): paid Sources tab no longer enumerates
        // individual database names. Itemized lists felt like a spec sheet
        // and exposed the specific endpoints we depend on. Replaced with a
        // narrative explanation grouped by source TYPE — preserves the
        // credibility signal ("we use real public records") without
        // advertising every API. Source URLs remain accessible via the
        // sitemap + per-company Sources tab (which is per-grade citation).
        <div style={{ padding:16 }}>
          <div style={{ fontSize:11, fontWeight:700, color:T.accent2, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>
            How TruNorth grades a brand
          </div>
          {(() => {
            const totalSources = SOURCES_DATA.reduce((a, g) => a + g.items.length, 0);
            return (
              <p style={{ fontSize:14, color:T.txt2, marginBottom:14, lineHeight:1.6 }}>
                Every score in TruNorth is built from <strong style={{ color:T.txt }}>primary public records</strong> — not opinions, not vibes, not AI synthesis. We pull from federal regulators, court records, public financial filings, accredited certifications, and independent monitors across <strong style={{ color:T.txt }}>{totalSources}+ data sources</strong> spanning {SOURCES_DATA.length} categories.
              </p>
            );
          })()}
          <p style={{ fontSize:14, color:T.txt2, marginBottom:14, lineHeight:1.6 }}>
            The result: <strong style={{ color:T.txt }}>every grade is auditable end-to-end.</strong> Tap any company → Sources tab to see the specific filings that drove that brand's score. If a score moves, it's because new public records moved it — not because our editorial position changed.
          </p>
          <div style={{ padding:"12px 14px", background:T.bg3, borderRadius:10, border:`1px solid ${T.border}`, marginBottom:14, fontSize:13, color:T.txt3, lineHeight:1.65 }}>
            <strong style={{ color:T.txt2 }}>About freshness.</strong> News mentions refresh <b>daily</b>. Federal enforcement, consumer complaints, lawsuit filings, vehicle/product recalls, and global news refresh <b>weekly</b>. Per-company narratives, severe-injury reports, foodborne outbreaks, healthcare-fraud actions, state legislation, and exclusion lists refresh <b>monthly</b>. Annual lists (HRC CEI, CDP A-List, Russia tracker, B Corp) re-ingest on their publish dates.
          </div>
          <div style={{ fontSize:11, fontWeight:700, color:T.txt3, textTransform:"uppercase", letterSpacing:0.6, marginTop:18, marginBottom:8 }}>
            Sources by category
          </div>
          {SOURCES_DATA.map(g => (
            <div key={g.group} style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, marginBottom:6, padding:"12px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom: g.items?.length ? 8 : 0 }}>
                <i className={`ti ${g.icon}`} style={{ fontSize:16, color:T.accent2 }} aria-hidden="true" />
                <div style={{ flex:1, fontSize:13, fontWeight:600, color:T.txt }}>{g.group}</div>
                <div style={{ fontSize:11, color:T.txt3 }}>{g.items.length} source{g.items.length === 1 ? "" : "s"}</div>
              </div>
              {g.items?.length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, paddingLeft:26 }}>
                  {g.items.map(it => (
                    <a key={it.name} href={it.url} target="_blank" rel="noreferrer" style={{ fontSize:10.5, padding:"3px 8px", borderRadius:12, background:T.bg3, color:T.txt2, border:`1px solid ${T.border2}`, textDecoration:"none" }}>
                      {it.name}{it.cadence ? <span style={{ color:T.txt3, marginLeft:4 }}>· {it.cadence}</span> : null}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div style={{ fontSize:12, color:T.txt3, marginTop:14, lineHeight:1.55, textAlign:"center" }}>
            Per-grade citations are visible on each brand's profile under "Why this grade?"
          </div>
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
              <div style={{ background:T.accentBg, border:`1.5px solid ${T.accent}`, borderRadius:16, padding:16, marginBottom:12, display:"flex", alignItems:"center", gap:14 }}>
                {/* R2 (YOU, brief §3.4): the identity compass lives with the
                    archetype — serif name, the seal, the codename. */}
                <CompassSeal weights={{ ...PROFILE_DEFAULT_WEIGHTS, ...(profile.weights || {}) }} size={66} title="Your values compass" />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:10, color:T.accent2, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:4 }}>Your values archetype</div>
                  <div style={{ fontFamily:SERIF, fontSize:19, fontWeight:600, color:T.txt, lineHeight:1.2 }}>{fp.name}</div>
                  <div style={{ fontSize:10, color:T.accent2, fontFamily:MONO, letterSpacing:1.5, marginTop:2, marginBottom:2 }}>{fp.codename}</div>
                  <div style={{ fontSize:9, color:T.txt3, marginBottom:6 }}>your values code</div>
                  <div style={{ fontSize:12, color:T.txt2, lineHeight:1.5 }}>{fp.blurb}</div>
                </div>
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
                  Re-run the Match — reshape your compass
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize:13, color:T.txt3, marginBottom:12 }}>Run the Match — nine quick choices personalize every grade in the app.</div>
                <button onClick={()=>{ track("quiz_started", { isPaid, from: "account" }); setScreen("quiz"); }} style={{ width:"100%", padding:11, borderRadius:10, border:`1px solid ${T.accent}`, background:T.accentBg, color:T.accent2, fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  Take the Match {!isPaid && <span style={{ fontSize:11, marginLeft:4, opacity:0.7 }}>(free)</span>}
                </button>
              </>
            )}
          </div>

          {/* B-3 (2026-06-01): Weekly digest opt-in. Sits between the values
              profile card and the Submit form. Hidden by default if the
              user has zero saved brands AND no email captured AND has
              been on the app less than 1 day — too early to ask. */}
          <EmailDigestCard />

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
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"10px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3, flexShrink:0 }}>Email</span>
                <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0, flex:"1 1 auto", justifyContent:"flex-end" }}>
                  <span title={currentUser?.email || "Guest"} style={{ color:T.txt, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>{currentUser?.email || "Guest"}</span>
                  {/* 2026-06-05: "Pending verification" badge. Shows when a
                      user has entered a new email and MailerLite has sent a
                      confirmation link but they haven't clicked it yet. We
                      track this purely via emailVerified===false flag in
                      localStorage; flips to verified when the user later
                      hits an in-app surface that proves they clicked the
                      link (TODO: tn-confirmed=1 query param on app-return
                      deep link — a true confirmation handshake requires
                      MailerLite webhook → /api/verify-confirm). */}
                  {currentUser?.email && currentUser?.emailVerified === false && (
                    <span style={{ fontSize:10, fontWeight:600, padding:"3px 8px", borderRadius:6, background:T.goldBg, color:T.gold, border:`1px solid ${T.gold}`, whiteSpace:"nowrap", flexShrink:0 }}>
                      Pending
                    </span>
                  )}
                  {/* B-31 (2026-06-05): upgraded change-email affordance.
                      Previously a tiny fontSize:11 underline-text "Edit"
                      link that users were missing (per 5.31.26 doc item 7:
                      "There is nowhere for me to change my email"). Now a
                      proper pencil-icon pill button with WCAG-compliant
                      tap target (44×44pt logical area via padding).

                      On save we ALSO call MailerLite via subscribeEmail()
                      with action='account_email_change' — the /api/subscribe
                      edge function upserts on email, so a new address creates
                      a new subscriber and the previous one becomes inert
                      (no duplicate digest sends since groups dedupe). For
                      true rename we'd need MailerLite's PUT /subscribers/{id}
                      endpoint — added to backlog if old-record cleanup
                      becomes a real problem post-launch. */}
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
                      const trimmed = String(next).trim().toLowerCase();
                      if (!trimmed.includes("@") || !trimmed.includes(".") || trimmed.length > 320) {
                        await themedAlert({ title: "Invalid email", body: "Please enter a valid email address.", kind: "error" });
                        return;
                      }
                      const previous = currentUser?.email || null;
                      if (previous && previous === trimmed) {
                        await themedAlert({ title: "No change", body: "That's already your saved email.", kind: "info" });
                        return;
                      }
                      // 2026-06-05 (verification flow):
                      // Save locally as UNVERIFIED, then ping MailerLite which
                      // sends a confirmation email. Until the user clicks the
                      // link in that email, they aren't on our mailing list and
                      // we display a "Pending verification" badge on Account.
                      // No artificial gating — the email is still usable for
                      // local prefs like Sunday digest opt-in display state.
                      const updated = {
                        ...(currentUser || {}),
                        email: trimmed,
                        emailVerified: false,
                        emailPendingSince: Date.now(),
                      };
                      try { localStorage.setItem("tn_user", JSON.stringify(updated)); } catch {}
                      setCurrentUser(updated);
                      track("email_changed", { had_previous: !!previous });
                      let verificationSent = false;
                      try {
                        const result = await subscribeEmail(trimmed, "account_email_change", {
                          previous_email: previous,
                          intendsLaunchUpdates: true,
                        });
                        verificationSent = !!result?.requiresVerification;
                      } catch {}
                      await themedAlert({
                        title: verificationSent ? "Check your inbox" : "Email saved",
                        body: verificationSent
                          ? `We sent a confirmation link to ${trimmed}. Click it to start getting updates and the Sunday digest.`
                          : trimmed,
                        kind: "success",
                      });
                    }}
                    aria-label={currentUser?.email ? "Edit email address" : "Add email address"}
                    style={{
                      display:"flex", alignItems:"center", gap:5,
                      fontSize:12, fontWeight:600,
                      color:T.accent2,
                      background:T.accentBg,
                      border:`1px solid ${T.accent}`,
                      borderRadius:8,
                      padding:"6px 10px",
                      cursor:"pointer",
                      minHeight:32,
                      flexShrink:0,
                    }}
                  >
                    <i className={`ti ${currentUser?.email ? "ti-pencil" : "ti-plus"}`} style={{ fontSize:12 }} aria-hidden="true" />
                    {currentUser?.email ? "Edit" : "Add"}
                  </button>
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:`1px solid ${T.border}`, fontSize:13 }}>
                <span style={{ color:T.txt3 }}>Plan</span>
                <span style={{ color:isPaid ? T.gold : T.txt2, fontWeight:600 }}>{isPaid ? "Pro" : "Free"}</span>
              </div>
              {/* H7 fix (audit 2026-06-01): Sign-out used to leave the email
                  + Values Fingerprint + saved brands + view history all
                  parked in localStorage — that's the user's PII still
                  sitting on the device after they "logged out." Now Sign
                  out clears the PII-laden keys but preserves UX-only
                  preferences (saved brands, history, fingerprint stay
                  unless the user explicitly chooses "Delete my data"). */}
              <button style={{ width:"100%", marginTop:12, padding:10, borderRadius:10, border:`1px solid ${T.border2}`, background:"transparent", color:T.txt3, fontSize:13, cursor:"pointer", minHeight:44 }}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Sign out?",
                    body: "Your basket and preferences stay on this device. To wipe everything, use 'Delete my data' below.",
                    confirmLabel: "Sign out",
                    cancelLabel: "Stay",
                    danger: true,
                  });
                  if (!ok) return;
                  // Clear sign-in identity but keep app-state for next session.
                  ["tn_hasOnboarded","tn_user","tn_email","tn_user_hash","tn_isPaid"].forEach(k => {
                    try { localStorage.removeItem(k); } catch {}
                  });
                  track("signed_out");
                  window.location.reload();
                }}>
                Sign out
              </button>

              {/* H7 (audit) — full GDPR/CCPA-grade data deletion.
                  Wipes EVERY tn_* localStorage key, opts out of PostHog
                  going forward, then hard-reloads. Doesn't touch the
                  MailerLite server-side record (user must email us per
                  the Privacy Policy) — but the in-app surface is now
                  honest and the app behaves like a fresh install. */}
              <button style={{ width:"100%", marginTop:8, padding:10, borderRadius:10, border:`1px solid ${T.rep || "#E0524D"}`, background:"transparent", color:T.rep || "#E0524D", fontSize:13, cursor:"pointer", minHeight:44 }}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete all my data on this device?",
                    body: "Wipes your basket, history, Match answers, archetype, email, and analytics opt-in. The app behaves like a fresh install on next launch. To remove your email from our server, email Aron@trunorthapp.com.",
                    confirmLabel: "Delete everything",
                    cancelLabel: "Cancel",
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    // Wipe everything tn_* — comprehensive across the app
                    for (let i = localStorage.length - 1; i >= 0; i--) {
                      const k = localStorage.key(i);
                      if (k && k.startsWith("tn_")) localStorage.removeItem(k);
                    }
                    // Best-effort PostHog opt-out for this session + going forward
                    try {
                      const posthog = (await import("posthog-js")).default;
                      posthog.opt_out_capturing?.();
                      posthog.reset?.();
                    } catch {}
                  } catch {}
                  track("user_data_deleted"); // last gasp before opt-out lands
                  window.location.reload();
                }}>
                Delete my data on this device
              </button>
            </div>

          {/* UX 5D (2026-06-01): Grade scale legend. Most-asked question in
              early QA was 'what does each letter actually mean?' — surface
              it explicitly so the A-F reads as objective ranges, not
              editorial. */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16, marginBottom:12 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>How grades work</div>
            <div style={{ fontSize:12, color:T.txt3, marginBottom:12, lineHeight:1.55 }}>
              Each category with public-record data is scored 0–100, then combined with a shrinkage toward 50 that prices in how much evidence exists — so one thin signal can't swing a grade. The result maps to fixed, published cut points (not a school curve):
            </div>
            {[
              { grade:"A", range:"62–100", desc:"Best of class — strong across a broad, verified record",  color:"#38C0CE", bg:"#0E2126", border:"#1E444A" },
              { grade:"B", range:"50–61",  desc:"Above average — clearly more positive than negative signals",          color:"#9CC98A", bg:"#19230F", border:"#2E4A1E" },
              { grade:"C", range:"38–49",  desc:"Mixed — meaningful concerns offset by meaningful positives",            color:"#E8A04C", bg:"#1F2228", border:"#2A2E35" },
              { grade:"D", range:"33–37",  desc:"Below average — clear negative signals outweigh the positives",         color:"#E8A04C", bg:"#241B0D", border:"#4A381E" },
              { grade:"F", range:"0–32",   desc:"Substantial negative signals with public-record evidence", color:"#E0524D", bg:"#291110", border:"#4A1E1E" },
            ].map((r) => (
              <div key={r.grade} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0" }}>
                <div style={{ width:34, height:34, borderRadius:8, background:r.bg, border:`1px solid ${r.border}`, color:r.color, fontSize:16, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{r.grade}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:T.txt }}>{r.range}</div>
                  <div style={{ fontSize:11, color:T.txt3, marginTop:1, lineHeight:1.4 }}>{r.desc}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize:11, color:T.txt3, marginTop:10, lineHeight:1.5, paddingTop:10, borderTop:`1px solid ${T.border}` }}>
              Categories without enough data are <strong style={{ color:T.txt2 }}>excluded</strong> from the grade — they don't count for or against the brand.{" "}
              <a href="#methodology" onClick={() => track("methodology_opened", { from: "grade_legend" })} style={{ color:T.accent2, fontWeight:600, textDecoration:"none" }}>Full methodology →</a>
            </div>
          </div>

          {/* App info — slimmed */}
          <div style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:16, padding:16 }}>
            <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>About TruNorth</div>
            {[
              ["Companies", formatCompanyCount(deduped.length)],
              // 2026-06-12 review: was hardcoded "May 2026" (already stale in
              // June). The catalog refreshes continuously via the nightly/weekly
              // crons, so show the current month rather than a frozen date.
              ["Updated", new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })],
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
          <button onClick={()=>{ setCompareList([]); track("compare_clear"); }} style={{ width:24, height:24, padding:0, borderRadius:6, border:"none", background:"transparent", color:T.txt3, fontSize:16, minWidth:44, minHeight:44, cursor:"pointer" }} aria-label="Clear compare">×</button>
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
      {/* B66 fix #2 (Aron's device repro): the scroll area's
          -webkit-overflow-scrolling:touch promotes it to a composited layer
          on iOS WebKit, which painted OVER the Lens circle's protruding top.
          position:relative + zIndex keeps the bar (and the circle) on top. */}
      <div style={{ flexShrink:0, position:"relative", zIndex:10, background:T.bg2, borderTop:`1px solid ${T.border}`, display:"flex", paddingBottom:"calc(env(safe-area-inset-bottom, 0px) + 8px)", overflow:"visible" }}>
        {[
          // R2 (brief §3): four surfaces — TODAY · LENS(center) · LEDGER, with
          // YOU living top-right. Top Picks and Browse fold into Lens (chips
          // in its empty state); the scanner is the camera glyph inside the
          // Lens input, plus a power shortcut: tapping LENS while already on
          // it opens the camera directly (preserves the one-thumb store flow).
          {id:"today",   icon:"ti-location",  label:"Today"},
          {id:"search",  icon:"ti-crosshair", label:"Scan", center:true},
          {id:"library", icon:"ti-shopping-cart", label:"Basket"},
        ].map(t => {
          const isActive = !t.center && tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                // B66 fix #3: the center circle IS the camera — one tap,
                // viewfinder, no tab switch, no keyboard (the autofocus
                // path popped the keyboard + accessory bar on device).
                if (t.center) { setShowScanner(true); track("scanner_open", { tab: "lens_center" }); return; }
                setTab(t.id);
              }}
              aria-label={t.center ? "Scan a product" : t.label}
              style={{ flex:1, padding:"10px 4px 8px", display:"flex", flexDirection:"column", alignItems:"center", gap:3, background:"none", border:"none", cursor:"pointer" }}
            >
              {t.center ? (
                <div style={{
                  width:46, height:46, borderRadius:"50%",
                  background:T.bg3,
                  border:`1.5px solid ${T.accent}`,
                  color:T.accent2,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  marginTop:-14, marginBottom:-2,
                  boxShadow:"0 6px 18px rgba(56,192,206,0.18)"
                }}>
                  <i className={`ti ${t.icon}`} style={{ fontSize:22 }} aria-hidden="true" />
                </div>
              ) : (
                <i className={`ti ${t.icon}`} style={{ fontSize:22, color: isActive ? T.accent2 : T.txt3 }} aria-hidden="true" />
              )}
              <span style={{ fontSize:10, color: isActive || t.center ? T.accent2 : T.txt3, fontWeight: isActive || t.center ? 600 : 400 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
