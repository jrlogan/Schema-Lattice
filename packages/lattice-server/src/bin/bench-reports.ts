#!/usr/bin/env node
export {};
// Deliberately small read-only probe, never a sustained load generator.
const index=process.argv.indexOf('--target');
if(index<0||!process.argv[index+1])throw Error('Usage: npm run bench:reports -- --target https://schemalattice.com');
const target=new URL(process.argv[index+1]);
if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('Expected HTTP(S) URL without credentials');
async function measure(path:string, body?:unknown){
 const start=performance.now();
 const response=await fetch(new URL(path,target),{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(65000)});
 const result=await response.json() as any;
 if(!response.ok||result.error)throw Error(`${path}: HTTP ${response.status}`);
 return {ms:Math.round((performance.now()-start)*10)/10,result};
}
const first=await measure('/api/tools/lattice_portfolio_report',{});
const concurrent=await Promise.all(Array.from({length:8},()=>measure('/api/tools/lattice_portfolio_report',{})));
const mixed=await Promise.all([measure('/api/tools/lattice_portfolio_report',{}),...Array.from({length:4},()=>measure('/health'))]);
console.log(JSON.stringify({target:target.origin,measuredAt:new Date().toISOString(),apps:first.result.apps.length,firstReportMs:first.ms,concurrentReportsMs:concurrent.map(r=>r.ms),healthDuringRepeatedReportMs:mixed.slice(1).map(r=>r.ms),note:'Small read-only probe; first request may already be cached. Includes network latency. No capacity claim.'},null,2));
