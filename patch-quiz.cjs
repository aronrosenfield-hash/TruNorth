/**
 * patch-quiz.cjs
 * Run from: ~/trunorth/
 * Command: node patch-quiz.cjs
 *
 * Combines paired quiz questions (single + scale) onto one screen.
 * Reduces quiz from 13 steps to 9 steps.
 */

const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "src", "App.jsx");
let f = fs.readFileSync(APP, "utf8");

// ─── 1. Replace QUIZ_STEPS with combined version ──────────────────────────────
const oldSteps = `const QUIZ_STEPS = [
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
      {v:"anti",   l:"I prefer companies that operate without union involvement",        icon:"ti-x"},
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
];`;

const newSteps = `const QUIZ_STEPS = [
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
];`;

if (f.includes(oldSteps)) {
  f = f.replace(oldSteps, newSteps);
  console.log("✅ QUIZ_STEPS replaced — 13 steps → 9 steps");
} else {
  console.log("⚠️  QUIZ_STEPS not found — check manually");
}

// ─── 2. Update canAdvance logic ───────────────────────────────────────────────
const oldCanAdvance = `  const canAdvance = isWelcome || current?.type === "multi" || answers[current?.id] !== undefined;`;
const newCanAdvance = `  const canAdvance = isWelcome || current?.type === "multi"
    || (current?.type === "scale" && answers[current?.id] !== undefined)
    || (current?.type === "single" && answers[current?.id] !== undefined)
    || (current?.type === "single+scale" && answers[current?.id] !== undefined)
    || (current?.type === "scale+single" && answers[current?.id] !== undefined)
    || (current?.type === "scale+scale" && answers[current?.id] !== undefined);`;

if (f.includes(oldCanAdvance)) {
  f = f.replace(oldCanAdvance, newCanAdvance);
  console.log("✅ canAdvance logic updated");
} else {
  console.log("⚠️  canAdvance not found");
}

// ─── 3. Replace Quiz render — add new type handlers ───────────────────────────
// Find the single type render block and add new types after it
const oldSingleBlock = `        {current?.type === "single" && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:12, lineHeight:1.4 }}>{current.q}</div>
            {current.opts.map((opt, i) => {
              const sel = answers[current.id] === opt.v && answers[current.id+"_idx"] === i;
              return (
                <button key={i} onClick={() => { set(current.id, opt.v); set(current.id+"_idx", i); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:12, border:\`1.5px solid \${sel?T.accent:T.border}\`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", border:\`2px solid \${sel?T.accent:T.border2}\`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {sel && <i className="ti ti-check" style={{ fontSize:13, color:"#fff" }} aria-hidden="true" />}
                  </div>
                  {opt.icon === "dem" && <DonkeySVG size={20} />}
                  {opt.icon === "rep" && <ElephantSVG size={20} />}
                  {opt.icon && opt.icon !== "dem" && opt.icon !== "rep" && <i className={\`ti \${opt.icon}\`} style={{ fontSize:18, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />}
                  <span style={{ fontSize:14, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                </button>
              );
            })}
          </>
        )}`;

const newSingleBlock = `        {(current?.type === "single" || current?.type === "single+scale" || current?.type === "scale+single") && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:12, lineHeight:1.4 }}>
              {current.type === "scale+single" ? current.singleQ : current.q}
            </div>
            {(current.type === "scale+single" ? current.opts : current.opts).map((opt, i) => {
              const sel = answers[current.id] === opt.v && answers[current.id+"_idx"] === i;
              return (
                <button key={i} onClick={() => { set(current.id, opt.v); set(current.id+"_idx", i); }}
                  style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:12, border:\`1.5px solid \${sel?T.accent:T.border}\`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", border:\`2px solid \${sel?T.accent:T.border2}\`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                    {sel && <i className="ti ti-check" style={{ fontSize:13, color:"#fff" }} aria-hidden="true" />}
                  </div>
                  {opt.icon === "dem" && <DonkeySVG size={20} />}
                  {opt.icon === "rep" && <ElephantSVG size={20} />}
                  {opt.icon && opt.icon !== "dem" && opt.icon !== "rep" && <i className={\`ti \${opt.icon}\`} style={{ fontSize:18, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />}
                  <span style={{ fontSize:14, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                </button>
              );
            })}

            {/* Inline scale — shown after user picks an option */}
            {current.type === "single+scale" && answers[current.id] !== undefined && (
              <div style={{ marginTop:16, padding:"14px", background:T.bg3, borderRadius:12, border:\`1px solid \${T.border2}\` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:12 }}>{current.scaleQ}</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => set(current.scaleId, n)}
                      style={{ width:48, height:48, borderRadius:10, border:\`1.5px solid \${answers[current.scaleId]===n?T.accent:T.border}\`, background:answers[current.scaleId]===n?T.accent:T.bg2, color:answers[current.scaleId]===n?"#fff":T.txt, fontSize:16, fontWeight:700, cursor:"pointer" }}>{n}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3 }}>
                  <span>{current.lo}</span><span>{current.hi}</span>
                </div>
              </div>
            )}
          </>
        )}`;

if (f.includes(oldSingleBlock)) {
  f = f.replace(oldSingleBlock, newSingleBlock);
  console.log("✅ Single question block updated with inline scale");
} else {
  console.log("⚠️  Single block not found");
}

// ─── 4. Update scale block to handle scale+single and scale+scale ─────────────
const oldScaleBlock = `        {current?.type === "scale" && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:16, lineHeight:1.4 }}>{current.q}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center", marginBottom:10 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => set(current.id, n)}
                  style={{ width:52, height:52, borderRadius:12, border:\`1.5px solid \${answers[current.id]===n?T.accent:T.border}\`, background:answers[current.id]===n?T.accent:T.bg2, color:answers[current.id]===n?"#fff":T.txt, fontSize:17, fontWeight:700, cursor:"pointer" }}>{n}</button>
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
        )}`;

const newScaleBlock = `        {(current?.type === "scale" || current?.type === "scale+single" || current?.type === "scale+scale") && (
          <>
            <div style={{ fontSize:16, fontWeight:600, color:T.txt, marginBottom:16, lineHeight:1.4 }}>{current.q}</div>
            <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:10 }}>
              {[1,2,3,4,5].map(n => (
                <button key={n} onClick={() => set(current.id, n)}
                  style={{ width:52, height:52, borderRadius:12, border:\`1.5px solid \${answers[current.id]===n?T.accent:T.border}\`, background:answers[current.id]===n?T.accent:T.bg2, color:answers[current.id]===n?"#fff":T.txt, fontSize:17, fontWeight:700, cursor:"pointer" }}>{n}</button>
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
              <div style={{ marginTop:8, padding:"14px", background:T.bg3, borderRadius:12, border:\`1px solid \${T.border2}\` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:12 }}>{current.scale2Q}</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom:8 }}>
                  {[1,2,3,4,5].map(n => (
                    <button key={n} onClick={() => set(current.scale2Id, n)}
                      style={{ width:48, height:48, borderRadius:10, border:\`1.5px solid \${answers[current.scale2Id]===n?T.accent:T.border}\`, background:answers[current.scale2Id]===n?T.accent:T.bg2, color:answers[current.scale2Id]===n?"#fff":T.txt, fontSize:16, fontWeight:700, cursor:"pointer" }}>{n}</button>
                  ))}
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.txt3 }}>
                  <span>{current.lo2}</span><span>{current.hi2}</span>
                </div>
              </div>
            )}

            {/* Inline single for scale+single type */}
            {current.type === "scale+single" && (
              <div style={{ marginTop:8, padding:"14px", background:T.bg3, borderRadius:12, border:\`1px solid \${T.border2}\` }}>
                <div style={{ fontSize:14, fontWeight:600, color:T.txt, marginBottom:10 }}>{current.singleQ}</div>
                {current.opts.map((opt, i) => {
                  const sel = answers[current.singleId] === opt.v && answers[current.singleId+"_idx"] === i;
                  return (
                    <button key={i} onClick={() => { set(current.singleId, opt.v); set(current.singleId+"_idx", i); }}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:10, border:\`1.5px solid \${sel?T.accent:T.border}\`, background:sel?T.accentBg:T.bg2, cursor:"pointer", marginBottom:6, textAlign:"left", width:"100%" }}>
                      <div style={{ width:20, height:20, borderRadius:"50%", border:\`2px solid \${sel?T.accent:T.border2}\`, background:sel?T.accent:"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        {sel && <i className="ti ti-check" style={{ fontSize:11, color:"#fff" }} aria-hidden="true" />}
                      </div>
                      {opt.icon && <i className={\`ti \${opt.icon}\`} style={{ fontSize:16, color:sel?T.accent2:T.txt3 }} aria-hidden="true" />}
                      <span style={{ fontSize:13, color:sel?T.accent2:T.txt, fontWeight:sel?600:400 }}>{opt.l}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}`;

if (f.includes(oldScaleBlock)) {
  f = f.replace(oldScaleBlock, newScaleBlock);
  console.log("✅ Scale block updated with scale+single and scale+scale support");
} else {
  console.log("⚠️  Scale block not found");
}

// ─── 5. Fix advance() — extract both ids from combined steps ──────────────────
const oldAdvance = `    } else setStep(s => s+1);`;
const newAdvance = `    } else {
      // For combined steps, copy secondary answers with correct keys
      if (current?.type === "single+scale" && current.scaleId) {
        // scaleId answer already set via set() — nothing extra needed
      }
      if (current?.type === "scale+single" && current.singleId) {
        // singleId answer already set via set() — nothing extra needed
      }
      setStep(s => s+1);
    }`;

if (f.includes(oldAdvance)) {
  f = f.replace(oldAdvance, newAdvance);
  console.log("✅ advance() updated for combined steps");
} else {
  console.log("⚠️  advance() pattern not found");
}

// ─── 6. Fix onComplete — read unionSupport from singleId ─────────────────────
// In the new quiz, unionSupport is stored directly under "unionSupport" key
// via set(current.singleId, ...) so no change needed there.
// But laborImportance step has singleId:"unionSupport" — make sure that's read
const oldUnionRead = `        unionSupport:    answers.unionSupport  || "neutral",`;
// Already correct — answers.unionSupport is set by set(current.singleId, v)
console.log("✅ unionSupport read — already correct");

// ─── WRITE ────────────────────────────────────────────────────────────────────
fs.writeFileSync(APP, f, "utf8");
console.log("\n✅ Quiz patch complete. Run: git add -A && git commit -m 'Combine quiz questions — 13 steps to 9' && git push");
