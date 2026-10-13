// Fictional app/legacy system in a temporary catalog; no production catalog writes.
import {LatticeInstance} from '../../src/server/instance.ts';
import {hashConcept,conceptUri} from '../../src/hashing/hash.ts';
import type {ConceptRecord} from '../../src/hashing/types.ts';
import {readFileSync} from 'node:fs';
import type {DesignRequest} from '../../src/advisor/advisor.ts';
export async function seedAdvisorDemo(instance:LatticeInstance){
 const record:ConceptRecord={type:'Concept',inScheme:instance.contextUri(),prefLabel:{en:'Demo Service Request'},definition:{en:'Fictional application service request used only to exercise the API advisor.'},broader:[instance.skeletonUri('record')!],structure:{kind:'entity',fields:[
  {name:'requestId',type:'string',required:true,description:'Identifier scoped to one jurisdiction.'},
  {name:'jurisdiction',type:'string',required:true},
  {name:'description',type:'string',maxLength:4000},
  {name:'state',type:'string',values:['new','assigned','resolved']},
  {name:'createdAt',type:'datetime',required:true},
  {name:'latitude',type:'number',minimum:-90,maximum:90},
  {name:'longitude',type:'number',minimum:-180,maximum:180},
  {name:'collectionDay',type:'string',description:'App extension, not a service request field in Open311.'}
 ]}};
 const hash=hashConcept(record),uri=conceptUri('advisor-demo','service-request',hash);
 instance.store.insertConcept({uri,contextSlug:'advisor-demo',conceptSlug:'service-request',hash,record});
 const registration=instance.registry.registerApp({slug:'waste-service-demo',name:'Waste Service Demo (fictional)',unit:'Demo',owner:'Local example',status:'experiment',concepts:[{uri,status:'originated'}]});
 instance.registry.registerApp({slug:'peer-demo',name:'Peer Demo (fictional)',unit:'Demo',owner:'Local example',status:'experiment',concepts:[{uri,status:'adopted'}]});
 const standards=JSON.parse(readFileSync(new URL('../public-sources/standards.json',import.meta.url),'utf8'));
 const open311=standards.find((s:any)=>s.slug==='open311-georeport-v2');
 await instance.sources.propose(open311,'operator');
 instance.sources.map({source:open311.slug,conceptUri:uri,role:'record',fields:[{from:'requests.service_request_id',to:'requestId'},{from:'requests.description',to:'description'},{from:'requests.status',to:'state',conversion:'open or closed; finer workflow states require explicit mapping and retention in status_notes'},{from:'requests.requested_datetime',to:'createdAt'},{from:'requests.lat',to:'latitude'},{from:'requests.long',to:'longitude'}]},'operator');
 await instance.sources.propose({slug:'legacy-demo-export',kind:'dataset',title:'Legacy export (fictional comparison fixture)',publisher:'Fictional demo municipality',jurisdiction:'US-CT',accessUrl:'https://example.invalid/demo-legacy-export',platform:'manual',recordDescription:'Fictional legacy request export; not a real publisher or verified adoption.',conformsTo:[open311.slug],fields:[{name:'REQUEST_ID',type:'string'},{name:'DETAIL',type:'string'},{name:'STATE',type:'string'}]},'operator');
 instance.sources.map({source:'legacy-demo-export',conceptUri:uri,role:'record',fields:[{from:'REQUEST_ID',to:'requestId'},{from:'DETAIL',to:'description'},{from:'STATE',to:'state',conversion:'Legacy enumeration has not been verified'}]},'operator');
 const request:DesignRequest={app:'waste-service-demo',purpose:'Expose service requests for pickup support while preserving richer workflow states and collection schedule extensions.',consumers:['Resident reminder application','Municipal service-request integration'],resources:[{conceptUri:uri,path:'/v1/requests',idField:'requestId',fieldNames:{createdAt:'created_at'}}]};
 return {request,uri,registration};
}
