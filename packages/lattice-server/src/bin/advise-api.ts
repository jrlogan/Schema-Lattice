#!/usr/bin/env node
// CLI delegates to the same HTTP tool used by MCP; it never creates or mutates a catalog.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {parseDesignRequest,adviseApi} from '../advisor/advisor.ts';
const args=process.argv.slice(2),get=(key:string)=>{const i=args.indexOf(key);return i>=0?args[i+1]:undefined};
try{
 const endpoint=get('--target'),snapshotFile=get('--snapshot'),file=get('--request'),out=get('--out');
 if((!!endpoint===!!snapshotFile)||!file||!out)throw Error('Usage: npm run advise:api -- (--target http://localhost:7000 | --snapshot snapshot.json) --request request.json --out ./api-proposal');
 const raw=await readFile(file,'utf8');if(raw.length>65536)throw Error('Request exceeds 64 KB');
 const request=parseDesignRequest(JSON.parse(raw));
 let proposal:any, snapshot:any;
 if(snapshotFile){snapshot=JSON.parse(await readFile(snapshotFile,'utf8'));proposal=adviseApi(snapshot,request)}
 else {
  const url=new URL(endpoint!);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Expected an HTTP(S) target without credentials');
  const response=await fetch(new URL('/api/tools/lattice_api_design_snapshot',url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
  snapshot=await response.json();
  if(!response.ok||snapshot.error)throw Error(snapshot.error?.message??`HTTP ${response.status}`);
  proposal=adviseApi(snapshot,request);
 }
 if(!proposal.openapi||!proposal.proposalId)throw Error('Server did not return an API design proposal');
 const directory=resolve(out);await mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries({'snapshot.json':snapshot,'request.json':request,'proposal.json':proposal,'openapi.json':proposal.openapi}))await writeFile(join(directory,name),JSON.stringify(value,null,2)+'\n');
 console.log(`Wrote review draft ${proposal.proposalId} to ${directory}. No design decision accepted or API deployed.`);
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1}
