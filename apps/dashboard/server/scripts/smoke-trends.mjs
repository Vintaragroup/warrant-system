#!/usr/bin/env node
/*
 smoke-trends.mjs
 Quick smoke script to fetch /dashboard/trends for several day spans and print basic stats.
 Useful for verifying trends aggregation performance and shape after deployments.

 Usage:
   node scripts/smoke-trends.mjs [--base http://localhost:8080/api] [--spans 7,14,30]
*/
import process from 'node:process';

const args = new Map();
for (let i=2;i<process.argv.length;i+=1){
  const a = process.argv[i];
  if (a.startsWith('--')) { const [k,v='true']=a.replace(/^--/,'').split('='); args.set(k,v); }
}
const API_BASE=(args.get('base')||process.env.API_BASE||'http://localhost:8080/api').replace(/\/$/,'');
const spans=(args.get('spans')||'7,14,30').split(',').map(s=>parseInt(s.trim(),10)).filter(n=>n>0);

async function getJSON(path){
  const res = await fetch(`${API_BASE}${path}`);
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

(async()=>{
  const started=Date.now();
  for(const days of spans){
    const t0=Date.now();
    try {
      const data=await getJSON(`/dashboard/trends?days=${days}`);
      const ms=Date.now()-t0;
      const labels=(data?.labels||data?.dates||[]).length;
      const rows=Array.isArray(data?.rows)?data.rows:[];
      // Derive simple volume per county
      const byCounty=new Map();
      rows.forEach(r=>{ const c=r.county; if(!byCounty.has(c)) byCounty.set(c,{count:0,bond:0}); const o=byCounty.get(c); o.count+=Number(r.count||0); o.bond+=Number(r.bondSum||r.bond_sum||0); });
      const summary=Array.from(byCounty.entries()).map(([c,v])=>`${c}:${v.count}/${v.bond}`).join(', ');
      console.log(`SPAN ${days}d ok labels=${labels} rows=${rows.length} counties=${byCounty.size} (${summary}) in ${ms}ms`);
    } catch(e) {
      console.log(`SPAN ${days}d FAIL: ${e.message}`);
    }
  }
  console.log(`Done in ${Date.now()-started}ms`);
})();
