import {standardGuide} from './guides.ts';
import {createHash} from 'node:crypto';
import {InvalidParameter,NotFound} from '../tools/errors.ts';
import {objectSchema,validateOpenApi,type JsonObject,type SchemaIssue} from './schema.ts';
export interface DesignRequest {app:string;purpose:string;consumers:string[];resources?:Array<{conceptUri:string;path:string;fieldNames?:Record<string,string>;idField?:string}>;candidateSlugs?:string[]}
export interface AdvisorSnapshot {app:{slug:string;name:string;status:string};concepts:Array<{uri:string;record:JsonObject}>;sources:JsonObject[];peerApps:Array<{app:string;conceptUri:string}>;acceptedChoices:Array<{app:string;source:string}>}
export const ADVISOR_VERSION='api-design-advisor-v1';
function obj(x:unknown):x is JsonObject{return !!x&&typeof x==='object'&&!Array.isArray(x)}
export function parseDesignRequest(raw:unknown):DesignRequest {
 if(!obj(raw))throw new InvalidParameter('Design request must be an object');
 for(const k of Object.keys(raw))if(!['app','purpose','consumers','resources','candidateSlugs'].includes(k))throw new InvalidParameter('Unknown design property: '+k);
 for(const k of ['app','purpose'])if(typeof raw[k]!=='string'||!raw[k].trim()||raw[k].length>2000)throw new InvalidParameter(k+' must be a non-empty string of at most 2000 characters');
 if(!Array.isArray(raw.consumers)||raw.consumers.length<1||raw.consumers.length>20||raw.consumers.some((x:unknown)=>typeof x!=='string'||!x.trim()||x.length>200))throw new InvalidParameter('consumers must contain 1–20 short descriptions');
 if(raw.candidateSlugs!==undefined&&(!Array.isArray(raw.candidateSlugs)||raw.candidateSlugs.length>20||raw.candidateSlugs.some((x:unknown)=>typeof x!=='string'||x.length>60)))throw new InvalidParameter('Invalid candidateSlugs');
 if(raw.resources!==undefined){
  if(!Array.isArray(raw.resources)||!raw.resources.length||raw.resources.length>30)throw new InvalidParameter('resources must contain 1–30 resource bindings');
  const paths=new Set<string>(),uris=new Set<string>();
  for(const r of raw.resources){
   if(!obj(r)||Object.keys(r).some(k=>!['conceptUri','path','fieldNames','idField'].includes(k))||typeof r.conceptUri!=='string'||typeof r.path!=='string'||!/^\/[a-z0-9/-]{1,100}$/.test(r.path)||r.path.endsWith('/')||r.path.includes('//'))throw new InvalidParameter('Resource requires conceptUri and a literal lowercase collection path without parameters');
   if(paths.has(r.path)||uris.has(r.conceptUri))throw new InvalidParameter('Duplicate resource path or concept');paths.add(r.path);uris.add(r.conceptUri);
   if(r.idField!==undefined&&(typeof r.idField!=='string'||r.idField.length>100))throw new InvalidParameter('Invalid idField');
   if(r.fieldNames!==undefined&&(!obj(r.fieldNames)||Object.keys(r.fieldNames).length>200||Object.values(r.fieldNames).some(n=>typeof n!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9]{0,99}$/.test(n as string))))throw new InvalidParameter('fieldNames must map concept fields to literal API property names');
  }
 }
 return structuredClone(raw) as DesignRequest;
}
function stable(value:any):any{return Array.isArray(value)?value.map(stable):obj(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value}
export function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}
function topFields(record:JsonObject):JsonObject[]{return Array.isArray(record.structure?.fields)?record.structure.fields:[]}
function fieldsByPath(fields:JsonObject[],prefix=''):Map<string,JsonObject>{const result=new Map<string,JsonObject>();for(const f of fields){if(typeof f?.name!=='string')continue;const path=prefix?prefix+'.'+f.name:f.name;result.set(path,f);if(Array.isArray(f.fields))for(const [p,v] of fieldsByPath(f.fields,path))result.set(p,v)}return result}
const short=(uri:string)=>uri.split('/').at(-1)!.split('@')[0];
const dateType=(s:string)=>({datetime:'date-time',date:'date',uri:'uri',url:'uri'} as Record<string,string>)[s]??null;
function compatibility(from:JsonObject,to:JsonObject,conversion?:string){
 const reasons:string[]=[];
 if(conversion)reasons.push('Recorded conversion: '+conversion+'; direction, implementation and loss are unverified.');
 const plain=(t:string)=>({text:'string',datetime:'string','date-time':'string',date:'string',uri:'string',url:'string',enum:'string'} as Record<string,string>)[t]??t;
 if(!['string','number','integer','boolean'].includes(plain(from.type))||!['string','number','integer','boolean'].includes(plain(to.type)))reasons.push('At least one field has an unsupported, complex or unspecified wire type.');
 else if(plain(from.type)!==plain(to.type))reasons.push(`Wire type differs: ${from.type} → ${to.type}.`);
 for(const key of ['minimum','maximum','minLength','maxLength','pattern','nullable'])if((from[key]??null)!==(to[key]??null))reasons.push('Constraint differs or is unspecified: '+key+'.');
 if((from.unit??null)!==(to.unit??null))reasons.push('Units differ or are unspecified on one side.');
 if((from.format??dateType(from.type))!==(to.format??dateType(to.type)))reasons.push('Formats differ or are unspecified on one side.');
 if(JSON.stringify(from.values??from.enum??null)!==JSON.stringify(to.values??to.enum??null))reasons.push('Enumeration domains differ or are unspecified on one side.');
 return {status:reasons.length?'review-required':'structurally-aligned',reasons,executable:false};
}
export function adviseApi(snapshot:AdvisorSnapshot,raw:unknown){
 const request=parseDesignRequest(raw);
 if(snapshot.app.slug!==request.app)throw new NotFound('Registered app not found: '+request.app);
 if(snapshot.concepts.length>30)throw new InvalidParameter('Select at most 30 concepts with explicit resources');
 const resources:NonNullable<DesignRequest['resources']>=request.resources??snapshot.concepts.map(({uri},i)=>({conceptUri:uri,path:'/v1/'+short(uri)+'-'+(i+1)}));
 const byUri=new Map(snapshot.concepts.map(c=>[c.uri,c.record]));
 if(!resources.length)throw new InvalidParameter('The app has no registered concepts to design');
 const schemaIssues:SchemaIssue[]=[], schemas:JsonObject=Object.create(null),paths:JsonObject=Object.create(null);
 const candidates:JsonObject[]=[];
 const designResources=resources.map((r,i)=>{
  const record=byUri.get(r.conceptUri);if(!record)throw new InvalidParameter('Resource concept is not in the app manifest: '+r.conceptUri);
  const fields=topFields(record);if(!fields.length)schemaIssues.push({field:r.conceptUri,message:'Concept has no declared fields. Generated schema needs authoring before implementation.'});
  const names=r.fieldNames??{};
  for(const name of Object.keys(names))if(!fields.some(f=>f.name===name))throw new InvalidParameter('fieldNames refers to an unknown top-level concept field: '+name);
  const renamed=fields.map(f=>({...f,name:names[f.name]??f.name,'x-concept-field':f.name}));
  if(new Set(renamed.map(f=>f.name)).size!==renamed.length)throw new InvalidParameter('API property rename collision for '+r.conceptUri);
  const component='Resource'+(i+1),schema=objectSchema(renamed,component,schemaIssues);
  schema['x-lattice-concept']=r.conceptUri;
  for(let n=0;n<renamed.length;n++)schema.properties[renamed[n].name]['x-lattice-field']=fields[n].name;
  schemas[component]=schema;
  const ref={$ref:'#/components/schemas/'+component};
  paths[r.path]={get:{operationId:'list'+component,summary:'List '+(record.prefLabel?.en??short(r.conceptUri)),description:'Proposed cursor pagination contract; implement and test this behavior.',parameters:[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:25}},{name:'cursor',in:'query',schema:{type:'string'}}],responses:{'200':{description:'One page of resources',content:{'application/json':{schema:{type:'object',properties:{items:{type:'array',items:ref},nextCursor:{type:['string','null']}},required:['items','nextCursor'],additionalProperties:false}}}},'401':{description:'Authentication required'},'400':{description:'Invalid query parameters'}}}};
  if(r.idField){
   const id=fields.find(f=>f.name===r.idField);if(!id||!['string','integer'].includes(id.type))throw new InvalidParameter('idField must name an existing top-level string/integer field');
   paths[r.path+'/{id}']={get:{operationId:'get'+component,summary:'Read one resource',parameters:[{name:'id',in:'path',required:true,schema:{type:id.type},description:'Confirm uniqueness scope; preserve upstream identifiers separately.'}],responses:{'200':{description:'Resource',content:{'application/json':{schema:ref}}},'401':{description:'Authentication required'},'404':{description:'Resource not found'}}}};
  }
  const appFields=fieldsByPath(fields);
  const considered=snapshot.sources.filter(s=>s.status==='listed'&&(!request.candidateSlugs||request.candidateSlugs.includes(s.slug)));
  for(const s of considered){
   const mappings=s.fields.flatMap((target:JsonObject)=>(target.means??[]).filter((m:JsonObject)=>m.conceptUri===r.conceptUri&&appFields.has(m.field)).map((m:JsonObject)=>({conceptField:m.field,apiField:m.field.split('.').map((part:string,n:number)=>n===0?(names[part]??part):part).join('.'),targetField:target.name,evidence:{conceptUri:m.conceptUri,source:s.slug,sourceUrl:s.schemaUrl??s.accessUrl,curatedBy:m.curatedBy??null,corroboratedBy:m.corroboratedBy??null},...compatibility(appFields.get(m.field)!,target,m.conversion)})));
   if(!mappings.length)continue;
   const covered=[...new Set(mappings.map((m:JsonObject)=>m.conceptField))] as string[];
   const peers=[...new Set(snapshot.peerApps.filter(p=>p.conceptUri===r.conceptUri&&p.app!==request.app).map(p=>p.app))].sort();
   const choices=[...new Set(snapshot.acceptedChoices.filter(c=>c.source===s.slug&&c.app!==request.app).map(c=>c.app))].sort();
   candidates.push({id:r.conceptUri+'|'+s.slug,conceptUri:r.conceptUri,source:s.slug,title:s.title,kind:s.kind,implementationGuide:s.kind==='standard'?standardGuide(s.accessUrl):null,coverage:{mapped:covered.length,total:appFields.size,ratio:appFields.size?covered.length/appFields.size:0},authority:{publisher:s.publisher,specificationUrl:s.accessUrl,assessment:'Publisher attribution in the catalog; authority has not been independently ranked.'},adoption:{declaredConformers:(s.conformedBy??[]).map((x:JsonObject)=>x.slug).sort(),sharedConceptApps:peers,acceptedDesignApps:choices,meaning:'Catalog observations only. Shared concepts and accepted designs do not prove API implementation or conformance.'},usability:{publisherFieldsVerified:s.fieldsVerified,schemaUrl:s.schemaUrl??null,behaviorTests:'unassessed'},maintenance:{declaredUpdateFrequency:s.updateFrequency??null,fieldsCheckedAt:s.fieldsCheckedAt??null,assessment:'No maintenance or deprecation guarantee.'},mappings,unmappedAppFields:[...appFields.keys()].filter(f=>!covered.includes(f)),unmappedTargetFields:s.fields.filter((f:JsonObject)=>!mappings.some((m:JsonObject)=>m.targetField===f.name)).map((f:JsonObject)=>f.name),conformance:'not-tested',guidance:s.kind==='standard'?'Review this standard as a compatibility target; implement its full endpoint and payload contract separately.':'This is an observed implementation, useful as an integration target but not a standard.'});
  }
  return {conceptUri:r.conceptUri,path:r.path,component,idField:r.idField??null,bindings:fields.map(f=>({conceptField:f.name,apiField:names[f.name]??f.name})),externalReferences:record.closeMatch??[],lineage:record.forkedFrom??null};
 });
 if(request.candidateSlugs)for(const slug of request.candidateSlugs)if(!snapshot.sources.some(s=>s.slug===slug&&s.status==='listed'))throw new InvalidParameter('Candidate is not a listed source: '+slug);
 candidates.sort((a,b)=>b.coverage.ratio-a.coverage.ratio||a.source.localeCompare(b.source)||a.conceptUri.localeCompare(b.conceptUri));
 const openapi={openapi:'3.1.0',info:{title:snapshot.app.name+' API proposal',version:'0.1.0',description:request.purpose+' — review draft; not a deployed or standards-certified API.'},security:[{appBearer:[]}],paths,components:{schemas,securitySchemes:{appBearer:{type:'http',scheme:'bearer',description:'Proposed application authentication; configure authorization and exposure before deployment.'}}},'x-schemalattice':{advisorVersion:ADVISOR_VERSION,app:request.app,consumers:request.consumers,manifestConcepts:designResources.map(r=>r.conceptUri),conformance:'not-tested'}};
 const checks=validateOpenApi(openapi);
 const content={advisorVersion:ADVISOR_VERSION,request,app:snapshot.app,modelBasis:request.resources?'Explicit resource bindings to registered concept fields':'Registered concept structures; actual application schema not inspected',resources:designResources,candidates,ranking:'Descending mapped-field coverage, then source slug; authority and popularity are not blended into a score.',openapi,schemaIssues,validation:{schemaCompleteness:schemaIssues.length?'review-required':'declared-fields-translated',structuralChecks:checks.length?'failed':'passed',errors:checks,behavior:'not-tested',standardsConformance:'not-tested'},recommendations:[...designResources.map(r=>({conceptUri:r.conceptUri,preferredCandidate:candidates.find(c=>c.conceptUri===r.conceptUri)?.source??null,action:candidates.some(c=>c.conceptUri===r.conceptUri)?'Review the highest-coverage candidate and its losses; preserve app-only fields in the native API.':'No exact concept-field alignment recorded. Keep the native schema and research mappings; name similarity is not evidence.'})),{action:'Confirm identifier scope, field exposure, units, enum semantics, pagination and error behavior. A shared meaning does not establish a record join.'}],adapterPolicy:'No executable cross-source adapter emitted: catalog mappings do not establish lossless reversible conversions.',reviewRequired:true};
 const evidenceHash=digest(snapshot);
 return {...content,evidenceHash,proposalId:digest({evidenceHash,content})};
}
