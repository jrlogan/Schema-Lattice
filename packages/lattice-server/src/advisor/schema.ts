/** Conservative translation of lattice structure fields to OpenAPI 3.1 schemas. */
export type JsonObject = Record<string, any>;
export interface SchemaIssue { field: string; message: string }
const TYPES: Record<string, string> = {string:'string',text:'string',integer:'integer',number:'number',boolean:'boolean',object:'object',array:'array',date:'string',datetime:'string','date-time':'string',uri:'string',url:'string'};
export function fieldSchema(field: JsonObject, path: string, issues: SchemaIssue[], depth=0): JsonObject {
 if(depth>12){issues.push({field:path,message:'Nesting exceeds the supported depth; schema left unconstrained.'});return {};}
 const enumValues=field.values??field.enum;
 const type=TYPES[field.type]??(field.type==='enum'&&Array.isArray(enumValues)&&enumValues.length>0&&enumValues.every((v:unknown)=>typeof v==='string')?'string':undefined);
 const schema: JsonObject = {'x-lattice-field-definition':field};
 if(type)schema.type=type;else issues.push({field:path,message:`Unsupported or missing type ${JSON.stringify(field.type)}; no type or conversion inferred.`});
 if(typeof field.description==='string')schema.description=field.description;
 if(['date','datetime','date-time','uri','url'].includes(field.type))schema.format=({date:'date',datetime:'date-time','date-time':'date-time',uri:'uri',url:'uri'} as JsonObject)[field.type];
 if(typeof field.format==='string')schema.format=field.format;
 const values=field.values??field.enum;
 if(Array.isArray(values)&&values.length){schema.enum=values;if(!type&&field.type==='enum'&&values.every(v=>typeof v==='string'))schema.type='string';}
 if(field.nullable===true&&schema.type)schema.type=[schema.type,'null'];
 for(const key of ['minimum','maximum','minLength','maxLength','pattern'])if(field[key]!==undefined){
  const value=field[key];
  let valid=key==='pattern'?typeof value==='string':typeof value==='number'&&Number.isFinite(value);
  if(['minLength','maxLength'].includes(key))valid=valid&&Number.isInteger(value)&&value>=0;
  if(key==='pattern'&&valid){try{new RegExp(value,'u')}catch{valid=false}}
  if(valid)schema[key]=value;else issues.push({field:path,message:'Invalid '+key+' retained in field metadata, not emitted as a schema constraint.'});
 }
 if(field.unit!==undefined)schema['x-unit']=field.unit;
 if(type==='object'){
  if(Array.isArray(field.fields))Object.assign(schema,objectSchema(field.fields,path,issues,depth+1));
  else issues.push({field:path,message:'Object properties are unspecified; review before implementation.'});
 }
 if(type==='array'){
  if(field.items&&typeof field.items==='object'&&!Array.isArray(field.items))schema.items=fieldSchema(field.items,path+'[]',issues,depth+1);
  else if(typeof field.items==='string')schema.items=fieldSchema({type:field.items},path+'[]',issues,depth+1);
  else {schema.items={};issues.push({field:path,message:'Array item structure is unspecified.'});}
 }
 if(field.ref||field.conceptUri){schema['x-lattice-reference']=field.ref??field.conceptUri;issues.push({field:path,message:'Concept reference retained; identifier versus embedded-object representation needs review.'});}
 return schema;
}
export function objectSchema(fields: JsonObject[], path: string, issues: SchemaIssue[], depth=0): JsonObject {
 const properties: JsonObject=Object.create(null), required:string[]=[];
 for(const f of fields){
  if(!f||typeof f.name!=='string'||!f.name){issues.push({field:path,message:'Invalid field definition omitted.'});continue;}
  if(Object.hasOwn(properties,f.name)){issues.push({field:path+'.'+f.name,message:'Duplicate field name; definition requires review.'});continue;}
  properties[f.name]=fieldSchema(f,path?path+'.'+f.name:f.name,issues,depth);
  if(f.required===true)required.push(f.name);
 }
 return {type:'object',properties,...(required.length?{required}:{}),additionalProperties:false};
}
/** Validate generated envelopes, local refs and resource schemas; not behavioral conformance. */
export function validateOpenApi(document: JsonObject): string[] {
 const errors:string[]=[];
 if(document.openapi!=='3.1.0')errors.push('Expected OpenAPI 3.1.0');
 if(!document.info?.title||!document.info?.version)errors.push('Missing API title/version');
 const ops=new Set<string>();
 for(const [path,item] of Object.entries(document.paths??{}) as [string,JsonObject][]){
  if(!path.startsWith('/'))errors.push('Invalid path '+path);
  for(const [method,op] of Object.entries(item) as [string,JsonObject][]){
   if(!['get','post','put','patch','delete','head','options','trace'].includes(method))continue;
   if(!op.operationId||ops.has(op.operationId))errors.push('Missing/duplicate operationId');ops.add(op.operationId);
   if(!op.responses?.['200']?.description)errors.push('Missing response description');
   for(const m of path.matchAll(/\{([^}]+)\}/g))if(!(op.parameters??[]).some((p:JsonObject)=>p.in==='path'&&p.name===m[1]&&p.required===true))errors.push('Missing path parameter '+m[1]);
  }
 }
 const visit=(value:any)=>{
  if(!value||typeof value!=='object')return;
  if(value.$ref){const parts=String(value.$ref).split('/');let target:any=document;if(parts.shift()!=='#'){errors.push('Non-local $ref unsupported');return;}for(const p of parts)target=target?.[p.replace(/~1/g,'/').replace(/~0/g,'~')];if(target===undefined)errors.push('Unresolved reference '+value.$ref);}
  if(value.type==='object')for(const name of value.required??[])if(!Object.hasOwn(value.properties??{},name))errors.push('Required field absent: '+name);
  for(const [key,child] of Object.entries(value))if(!key.startsWith('x-'))visit(child);
 };
 visit(document);return errors;
}
