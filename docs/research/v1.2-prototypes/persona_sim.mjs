// PERSONA SIM: same start-at-A model, but with realistic quiz answers (category
// weights + stances). Shows how a brand's grade shifts per real-human profile.
import fs from "node:fs";
const dir="public/data/companies";
const BENCH=48, GOOD=78, Wd=[1,0.6,0.4,0.25,0.15];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const gNew = n => n==null?"?":n>=88?"A":n>=70?"B":n>=52?"C":n>=36?"D":"F";

const BRANDS=["patagonia","nike","exxonmobil","walmart","chick-fil-a","ben-and-jerry-s","apple","costco","dick-s-sporting-goods","amazon"];

const PERSONAS=[
  {name:"Baseline (no quiz)", short:"Base",    w:{}, pol:"none", polW:1, animals:false, aniW:1, guns:"none", gunW:1, dei:false, deiW:1},
  {name:"Climate progressive",short:"Climate", w:{environment:2.2,labor:1.4}, pol:"progressive", polW:1.5, animals:true, aniW:1.2, guns:"avoid", gunW:1.2, dei:"pro", deiW:1.0},
  {name:"Faith conservative",  short:"Faith",  w:{charity:1.6}, pol:"conservative", polW:1.5, animals:false, aniW:1, guns:"support", gunW:1, dei:false, deiW:1},
  {name:"Worker-first (union)",short:"Labor",  w:{labor:2.5,execPay:1.6}, pol:"none", polW:1, animals:false, aniW:1, guns:"none", gunW:1, dei:false, deiW:1},
  {name:"Privacy hawk",        short:"Privacy",w:{privacy:2.8}, pol:"none", polW:1, animals:false, aniW:1, guns:"none", gunW:1, dei:false, deiW:1},
  {name:"Animal advocate",     short:"Animal", w:{environment:1.3}, pol:"none", polW:1, animals:true, aniW:2.5, guns:"avoid", gunW:1.2, dei:false, deiW:1},
  {name:"Conservative anti-DEI",short:"Con·aDEI",w:{}, pol:"conservative", polW:1.5, animals:false, aniW:1, guns:"none", gunW:1, dei:"anti", deiW:1.5},
];

const polScore=(lean,dir)=>{ if(dir==="none")return null; let L=lean||""; L=/left/.test(L)?"left":/right/.test(L)?"right":/bipartisan/.test(L)?"bipartisan":"neutral";
  if(L==="neutral")return null; const m={left:dir==="progressive"?90:22, right:dir==="progressive"?22:90, bipartisan:62}; return m[L]??null; };
const aniScore=(a,cares)=>{ if(!cares)return null; a=a||""; if(/positive|cruelty_free|excellent|good/.test(a))return 92; if(/mixed/.test(a))return 52; if(/negative|poor|tests|bad/.test(a))return 18; return null; };
const gunScore=(g,st)=>{ if(st==="none")return null; g=g||""; const sells=/sells_guns|makes_guns/.test(g), no=/no_guns/.test(g);
  if(st==="avoid"){ if(sells)return 18; if(no)return 85; return null;} if(st==="support"){ if(sells)return 85; return null;} return null; };
const deiScore=(d,dir)=>{ if(dir!=="pro"&&dir!=="anti")return null; d=d||""; const pro=/pro_dei/.test(d),mix=/mixed/.test(d),anti=/anti/.test(d);
  if(dir==="pro"){ if(pro)return 90; if(mix)return 55; if(anti)return 20; }
  else { if(pro)return 22; if(mix)return 48; if(anti)return 90; }   // anti-DEI: pro_dei brands score LOW for this user
  return null; };

function personalGrade(b, p){
  const cats=[];
  for(const [k,s] of Object.entries(b.csc||{})) cats.push({score:s, w:p.w[k]||1});
  const ps=polScore(b.sc.political, p.pol); if(ps!=null)cats.push({score:ps,w:p.polW});
  const as=aniScore(b.sc.animals, p.animals); if(as!=null)cats.push({score:as,w:p.aniW});
  const gs=gunScore(b.sc.guns, p.guns); if(gs!=null)cats.push({score:gs,w:p.gunW});
  const ds=deiScore(b.sc.dei, p.dei); if(ds!=null)cats.push({score:ds,w:p.deiW});
  if(!cats.length) return {g:"?",n:null};
  const harms=cats.map(c=>Math.max(0,BENCH-c.score)*c.w).filter(h=>h>0).sort((a,b)=>b-a);
  const penalty=harms.reduce((acc,h,i)=>acc+h*(Wd[i]??0.1),0);
  const credit=Math.min(10, cats.filter(c=>c.score>=GOOD).length*3);
  const n=clamp(100-penalty+credit,0,100);
  return {g:gNew(n), n};
}

const brands=BRANDS.map(s=>{ const c=JSON.parse(fs.readFileSync(dir+"/"+s+".json","utf8")); return {slug:s, name:c.name, sc:c.sc||{}, csc:c.csc||{}, overall:c.overall}; });

// matrix
const head="brand".padEnd(20)+"liveGrade  "+PERSONAS.map(p=>p.short.padEnd(8)).join("");
console.log(head); console.log("-".repeat(head.length));
const liveG = n=>n==null?"?":n>=62?"A":n>=50?"B":n>=38?"C":n>=33?"D":"F";
for(const b of brands){
  const cells=PERSONAS.map(p=>personalGrade(b,p).g.padEnd(8)).join("");
  console.log(b.name.slice(0,19).padEnd(20)+(liveG(b.overall)+"").padEnd(11)+cells);
}
console.log("\nSPREAD (how much each brand swings across personas):");
for(const b of brands){
  const gs=PERSONAS.map(p=>personalGrade(b,p).g);
  const uniq=[...new Set(gs)];
  console.log("  "+b.name.slice(0,19).padEnd(20)+gs.join(" → ")+"   ("+uniq.length+" distinct)");
}
