// Simulate wiring each enriched footprint dimension into the scoring engine and
// measure grade drift. Faithful to the engine: shrinkage toward 50 with K=1.5,
// W = realCats (current contributing weight), thresholds A62/B50/C38/D33/F<33,
// 1-signal cap [46,61]. Adding a dimension = one more category (weight 1).
//
// Marginal-add identity (from overall = (S + 50K)/(W+K)):
//   new = (overall*(W+K) + sX) / (W + 1 + K)
// For currently-"?" brands (W=0): new = (sX + 50K)/(1+K), then 1-signal cap/floor.
import fs from "node:fs";
const dir = "public/data/companies";
const K = 1.5;
const clamp = (n,a,b)=>Math.max(a,Math.min(b,n));
const grade = n => n==null ? "?" : n>=62?"A":n>=50?"B":n>=38?"C":n>=33?"D":"F";

// --- hypothetical scoring rules per dimension (illustrative, stated to user) ---
const RULES = {
  tax: e=>{ if(e.effectiveFederalTaxRate==null) return null; const r=e.effectiveFederalTaxRate, z=e.zeroTaxYears||0;
    let b = r>=.21?70: r>=.10?55: r>=.05?42: r>=0?32:22; return clamp(b - z*3, 12, 80); },
  secTax: e=>{ if(e.effectiveTaxRate==null) return null; const r=e.effectiveTaxRate;
    return r>=.21?70: r>=.10?55: r>=.05?42: r>=0?32:22; },
  supplyChain: e=> e.conflictMineralsFiler ? 35 : null,           // NAIVE: penalize the disclosure (the unfair case)
  openfdaRecalls: e=>{ const c=e.recallCount||0, ci=e.classI||0; return c>0? clamp(60-c*2-ci*8,12,70):null; },
  privacy: e=>{ const b=e.breaches?.count||0, dbr=e.dataBroker?.registered; if(!(b>0||dbr))return null;
    let s=55-b*6; if(dbr)s-=15; return clamp(s,12,70); },
  pharmaConduct: e=> e.opioidSettlementUsd>0?18 : (e.sunshineActPaymentsUsd>0?45:null),
  laborWages: e=>{ let s=null; if(e.backWagesUsd>0)s=32; if(e.warnLayoffs>0)s=(s??50)-Math.min(20,e.warnLayoffs/1000); return s!=null?clamp(s,15,60):null; },
  oshaSevereInjury: e=>{ const inj=e.totalSevereInjuries2y||0, amp=e.totalAmputations2y||0, rec=e.totalRecordsAllTime||0;
    return rec>0? clamp(55-inj*4-amp*10-Math.min(15,rec*0.5),12,70):null; },
  fedReserve: e=> (e.totalPenaltiesDollars>0||e.totalActions>0)?25:null,
  secLitigation: e=> e.totalReleasesLifetime>0?28:null,
  animalCerts: e=> e.certifications?.length?90:null,              // POSITIVE (already wired) — contrast
};
const NEGATIVE = ["tax","secTax","supplyChain","openfdaRecalls","privacy","pharmaConduct","laborWages","oshaSevereInjury","fedReserve","secLitigation"];

// add one signal of score sX to a company at (overall, W)
function addOne(overall, W, sX){
  if (W===0 || overall==null){ // currently "?" → becomes 1-signal
    let raw=(sX+50*K)/(1+K);
    return sX<20 ? Math.min(raw,61) : clamp(raw,46,61);
  }
  return (overall*(W+K)+sX)/(W+1+K);
}

const companies=[];
for(const f of fs.readdirSync(dir)){ if(!f.endsWith(".json"))continue;
  let c; try{c=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));}catch{continue;}
  companies.push({slug:c.slug||f.replace(/\.json$/,""), name:c.name, overall:c.overall??null, W:c.realCats||0, e:c.enriched||{}});
}
console.log("ASSUMPTIONS: shrinkage K=1.5, W=realCats, thresholds A62/B50/C38/D33/F<33, 1-signal cap[46,61].");
console.log("Rules are ILLUSTRATIVE (stated below). 'naive' = additive as a new category (the wire-all the B-23 analysis warned against).\n");

console.log("=== PER-DIMENSION DRIFT (wiring ONLY that dimension) ===");
console.log("dim".padEnd(17)+"cover".padStart(6)+" graded↓ graded↑  ?→grade  avgΔ(graded)  worst-drop examples");
for(const dim of [...NEGATIVE,"animalCerts"]){
  const rule=RULES[dim]; let cover=0,down=0,up=0,newg=0,deltas=[],ex=[];
  for(const co of companies){
    const sub=co.e[dim]; const sX = sub? rule(sub): null; if(sX==null) continue; cover++;
    const oldG=grade(co.overall);
    const nv=addOne(co.overall, co.W, sX);
    const newG=grade(nv);
    if(oldG==="?"&&newG!=="?"){ newg++; continue; }
    if(co.overall!=null){ const d=nv-co.overall; deltas.push(d);
      if(newG!==oldG){ if("FDCBA?".indexOf(newG)<"FDCBA?".indexOf(oldG)){}
        const worse = (nv<co.overall); if(worse){down++; ex.push({slug:co.slug,d,o:oldG,n:newG});} else up++; }
    }
  }
  const avg = deltas.length? (deltas.reduce((a,b)=>a+b,0)/deltas.length):0;
  ex.sort((a,b)=>a.d-b.d);
  const exs = ex.slice(0,3).map(x=>`${x.slug}(${x.o}→${x.n})`).join(" ");
  console.log(dim.padEnd(17)+String(cover).padStart(6)+String(down).padStart(8)+String(up).padStart(8)+String(newg).padStart(9)+(avg>=0?"+":"")+avg.toFixed(1).padStart(11)+"  "+exs);
}

console.log("\n=== COMBINED: naive wire of ALL "+NEGATIVE.length+" negative footprint dims at once ===");
let changed=0,droppedLevels=0,newlyGraded=0; const distBefore={}, distAfter={}; const bigDrops=[];
for(const co of companies){
  // collect all applicable negative scores
  const adds=[]; for(const dim of NEGATIVE){ const sub=co.e[dim]; const sX = sub? RULES[dim](sub): null; if(sX!=null) adds.push(sX); }
  const ob=grade(co.overall); distBefore[ob]=(distBefore[ob]||0)+1;
  if(!adds.length){ distAfter[ob]=(distAfter[ob]||0)+1; continue; }
  let nv;
  if(co.W===0||co.overall==null){ const sum=adds.reduce((a,b)=>a+b,0),n=adds.length; let raw=(sum+50*K)/(n+K); nv = Math.min(...adds)<20? Math.min(raw,61): (n>=2?raw:clamp(raw,46,61)); }
  else { const sum=adds.reduce((a,b)=>a+b,0); nv=(co.overall*(co.W+K)+sum)/(co.W+adds.length+K); }
  const na=grade(nv); distAfter[na]=(distAfter[na]||0)+1;
  if(na!==ob){ changed++; if(ob==="?"&&na!=="?")newlyGraded++;
    const ord="FDCBA?"; if(co.overall!=null && ord.indexOf(na)<ord.indexOf(ob)){ droppedLevels++; bigDrops.push({slug:co.slug,o:ob,n:na,d:(nv-co.overall)}); } }
}
console.log("grades CHANGED:",changed," | dropped a letter:",droppedLevels," | newly graded (?→letter):",newlyGraded);
const order=["A","B","C","D","F","?"];
console.log("distribution  before → after:");
for(const g of order) console.log("   "+g+": "+String(distBefore[g]||0).padStart(6)+" → "+String(distAfter[g]||0).padStart(6));
bigDrops.sort((a,b)=>a.d-b.d);
console.log("biggest drops:", bigDrops.slice(0,8).map(x=>`${x.slug}(${x.o}→${x.n})`).join("  "));
