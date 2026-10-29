import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import {LatticeInstance} from '../../src/server/instance.ts';
import {seedAdvisorDemo} from './fixture.ts';
const tmp=mkdtempSync(join(tmpdir(),'lattice-api-advisor-'));
// Boot a disposable fixture without loading an embedding model. The advisor itself never embeds.
const embedder={id:'advisor-demo-fixture',dim:4,embed:async(texts:string[])=>texts.map(()=>new Float32Array([1,0,0,0]))};
const instance=await LatticeInstance.create({dataDir:tmp,embedder});
try{
 const {request}=await seedAdvisorDemo(instance);
 const proposal=instance.advisor.propose(request);
 await SwaggerParser.validate(structuredClone(proposal.openapi) as any,{resolve:{external:false}});
 const out=resolve(process.argv[2]??'examples/api-advisor/output');mkdirSync(out,{recursive:true});
 for(const [name,value] of Object.entries({'request.json':request,'proposal.json':proposal,'openapi.json':proposal.openapi,'snapshot.json':instance.advisor.snapshot(request)}))writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
 const lines=['API DESIGN REVIEW — FICTIONAL WASTE-SERVICE APP',`Advisor: ${proposal.advisorVersion}`,`Proposal: ${proposal.proposalId}`,'','Generated OpenAPI 3.1 validated with Swagger Parser. No API deployed. No decision accepted.','',...proposal.candidates.flatMap(c=>[c.title,`  ${c.kind}; ${c.coverage.mapped}/${c.coverage.total} app fields aligned by recorded meaning.`,`  Unmapped app fields: ${c.unmappedAppFields.join(', ')}`,`  ${c.mappings.filter((m:any)=>m.status==='review-required').length} mappings require conversion/type/constraint review.`,...(c.implementationGuide?.requirements??[]).map((r:string)=>'  '+r),'']),proposal.adapterPolicy,'','All app/peer/legacy examples are fictional. Open311 source definitions come from the repository’s captured official-specification field list.'];
 writeFileSync(join(out,'review.txt'),lines.join('\n')+'\n');console.log(lines.join('\n'));console.log('\nArtifacts: '+out);
}finally{instance.close();rmSync(tmp,{recursive:true,force:true})}
