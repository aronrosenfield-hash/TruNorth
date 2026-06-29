// PROTOTYPE v2: "start-at-A, deduct for documented HARM, behind a coverage gate."
// csc = baked non-stance category scores (0-100, 50=neutral, severity/revenue-normalized).
// Tax is NOT in csc → display-only (legal tax behavior is a datapoint, not a demerit).
//
// Presumption of innocence: only genuinely-bad categories deduct, the WORST issue
// dominates (one severe harm defines you; extra issues compound only mildly), and
// minor/mixed records barely move you off A.
import fs from "node:fs";
const dir="public/data/companies";
const GATE=1;          // need >=GATE non-stance cats on record, else "?"
const BENCH=48;        // only categories scoring BELOW this are "harm" (genuinely bad)
const BREADTH_CAP=18;  // max extra penalty from issues beyond the worst one
const GOOD=78, CREDIT_EACH=3, CREDIT_CAP=10;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const gNow = n => n==null?"?":n>=62?"A":n>=50?"B":n>=38?"C":n>=33?"D":"F";

function startAtA(csc){
  const vals=Object.values(csc||{});
  if(vals.length < GATE) return null;
  const harms=vals.map(s=>Math.max(0, BENCH - s)).filter(h=>h>0).sort((a,b)=>b-a);
  const W=[1,0.6,0.4,0.25];   // worst issue full; severe #2/#3 compound; minor ones fade
  const penalty=harms.reduce((acc,h,i)=>acc+h*(W[i]??0.15),0);
  const credit=Math.min(CREDIT_CAP, vals.filter(s=>s>=GOOD).length*CREDIT_EACH);
  return clamp(100 - penalty + credit, 0, 100);
}

const rows=[];
for(const f of fs.readdirSync(dir)){ if(!f.endsWith(".json"))continue;
  let c; try{c=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));}catch{continue;}
  rows.push({slug:c.slug||f.replace(/\.json$/,""), overall:c.overall??null, csc:c.csc||null});
}
const scored=rows.map(r=>({...r, nv:startAtA(r.csc)})).filter(r=>r.nv!=null);

// histogram of new scores to set thresholds honestly
const buckets={}; for(let b=0;b<=100;b+=10)buckets[b]=0;
scored.forEach(r=>buckets[Math.min(100,Math.floor(r.nv/10)*10)]++);
console.log("PROTOTYPE v2: start-at-A (GATE>="+GATE+", BENCH="+BENCH+", worst-issue-dominates).  Tax excluded (display-only).");
console.log("gradeable (>="+GATE+" cats):", scored.length, "\n");
console.log("new-score histogram (where the gradeable land):");
for(let b=90;b>=0;b-=10) console.log("  "+String(b).padStart(3)+"-"+String(b+9).padStart(3)+": "+"█".repeat(Math.round(buckets[b]/25))+" "+buckets[b]);

// thresholds chosen from the histogram: clean=100=A, real harm pulls down
const gNew = n => n==null?"?":n>=88?"A":n>=70?"B":n>=52?"C":n>=36?"D":"F";
const order=["A","B","C","D","F","?"];
const dNow={}, dNew={}; order.forEach(g=>{dNow[g]=0;dNew[g]=0;});
let up=0,down=0; const exUp=[],exDown=[],exCleanA=[],exF=[];
for(const r of rows){
  const nowG=gNow(r.overall); dNow[nowG]++;
  const nv=startAtA(r.csc); const newG=gNew(nv); dNew[newG]++;
  if(nv!=null&&r.overall!=null){
    const oi=order.indexOf(nowG), ni=order.indexOf(newG);
    if(ni<oi){up++; if(exUp.length<7)exUp.push(`${r.slug} ${nowG}→${newG}`);}
    else if(ni>oi){down++; if(exDown.length<7)exDown.push(`${r.slug} ${nowG}→${newG}`);}
  }
  if(nv===100&&exCleanA.length<7) exCleanA.push(r.slug);
  if(nv!=null&&gNew(nv)==="F"&&exF.length<8) exF.push(`${r.slug}(${nv.toFixed(0)})`);
}
console.log("\nthresholds: A>=88 B>=70 C>=52 D>=36 F<36\n");
console.log("                CURRENT          START-AT-A     (among "+scored.length+" gradeable)");
for(const g of order) if(g!=="?") console.log("   "+g+":  "+String(dNow[g]).padStart(6)+"   →   "+String(dNew[g]).padStart(6)
  +"     ("+(100*dNew[g]/scored.length).toFixed(0)+"% of gradeable)");
console.log("   ?:  "+String(dNow["?"]).padStart(6)+"   →   "+String(dNew["?"]).padStart(6));
console.log("\nmoved UP:", up, "| moved DOWN (real documented harm):", down);
console.log("  ↑ ", exUp.join("  "));
console.log("  ↓ ", exDown.join("  "));
console.log("  clean→A:", exCleanA.join("  "));
console.log("  F (severe documented harm):", exF.join("  "));
