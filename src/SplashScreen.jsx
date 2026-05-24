import { useEffect } from "react";

export default function SplashScreen({ onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div style={styles.outer}>
      <div style={styles.wrap}>
        <style>{`
          @keyframes tn-pop {
            from { transform: scale(0.7); opacity: 0; }
            to   { transform: scale(1);   opacity: 1; }
          }
          @keyframes tn-arrow {
            0%   { transform: translateY(0); }
            50%  { transform: translateY(-5px); }
            100% { transform: translateY(0); }
          }
          @keyframes tn-fade-out {
            to { opacity: 0; }
          }
          .tn-splash-logo { animation: tn-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both; }
          .tn-splash-icon { animation: tn-arrow 0.6s ease 0.8s both; }
          .tn-splash-wrap  { animation: tn-fade-out 0.4s ease 1.6s forwards; }
        `}</style>
        <div className="tn-splash-wrap" style={styles.inner}>
          <div className="tn-splash-logo" style={styles.logo}>
            <div className="tn-splash-icon" style={styles.icon}>
              <svg width="28" height="28" viewBox="0 0 48 48" aria-hidden="true">
                <polygon points="24,6 36,30 28,30 28,42 20,42 20,30 12,30" fill="#fff"/>
              </svg>
            </div>
            <div style={styles.wordmark}>
              <span style={{ color: "#f2f2f2" }}>Tru</span>
              <span style={{ color: "#7c6dfa" }}>North</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  outer: { position:"fixed", inset:0, background:"#0f0f0f", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 },
  wrap:  { width:"100%", maxWidth:430, height:"100%", display:"flex", alignItems:"center", justifyContent:"center" },
  inner: { display:"flex", alignItems:"center", justifyContent:"center", width:"100%", height:"100%" },
  logo:  { display:"flex", alignItems:"center", gap:12 },
  icon:  { width:52, height:52, background:"#7c6dfa", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:26, color:"#fff" },
  wordmark: { fontFamily:"-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", fontSize:30, fontWeight:800, letterSpacing:-0.5 },
};
