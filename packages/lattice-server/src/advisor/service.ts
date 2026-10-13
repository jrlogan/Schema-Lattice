import type {LatticeInstance} from '../server/instance.ts';
import {OPERATOR,actorOf,type Principal} from '../server/principals.ts';
import {InvalidParameter,NotFound} from '../tools/errors.ts';
import {adviseApi,digest,parseDesignRequest,type DesignRequest,type AdvisorSnapshot} from './advisor.ts';
export class ApiAdvisor {
 constructor(private instance:LatticeInstance){
  instance.store.db.exec(`CREATE TABLE IF NOT EXISTS api_design_decisions (
   id TEXT PRIMARY KEY, app_slug TEXT NOT NULL, proposal_id TEXT NOT NULL,
   evidence_hash TEXT NOT NULL, actor TEXT NOT NULL, recorded_at TEXT NOT NULL,
   choices TEXT NOT NULL, rationale TEXT NOT NULL, proposal TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_api_design_app ON api_design_decisions(app_slug);
   CREATE INDEX IF NOT EXISTS idx_api_design_latest ON api_design_decisions(app_slug, recorded_at);`);
 }
 snapshot(request:DesignRequest):AdvisorSnapshot {
  const i=this.instance,app=i.store.db.prepare('SELECT slug, name, status FROM apps WHERE slug=?').get(request.app) as AdvisorSnapshot['app'] | undefined;
  if(!app)throw new NotFound('No registered app: '+request.app);
  const usages=i.registry.usagesOf(request.app),selected=new Set(request.resources?.map(r=>r.conceptUri)??usages.map(u=>u.uri));
  for(const uri of selected)if(!usages.some(u=>u.uri===uri))throw new InvalidParameter('Resource is not a registered app concept: '+uri);
  if(selected.size>30)throw new InvalidParameter('Select at most 30 concepts with explicit resources');
  const concepts=[...selected].sort().map(uri=>{const record=i.store.getConcept(uri);if(!record)throw new NotFound('Missing registered concept: '+uri);return {uri,record}});
  const sourceIds=i.sources.advisorCandidates([...selected],request.candidateSlugs);
  if(sourceIds.length>100)throw new InvalidParameter('More than 100 source candidates; provide candidateSlugs to bound the comparison.');
  const sources=sourceIds.map(slug=>i.sources.resolve(slug,true)!).filter(Boolean);
  const peerApps=i.store.db.prepare(`SELECT u.app_slug AS app, u.concept_uri AS conceptUri FROM app_usages u
   JOIN apps a ON a.slug=u.app_slug WHERE u.concept_uri IN (SELECT value FROM json_each(?)) AND a.slug<>? AND a.status<>'retired'
   ORDER BY u.concept_uri, u.app_slug`).all(JSON.stringify([...selected].sort()),request.app) as AdvisorSnapshot['peerApps'];
  // Fetch only the latest decision per active peer via an ordered index, never its full history.
  const choices=i.store.db.prepare(`SELECT a.slug AS app, d.choices FROM apps a JOIN api_design_decisions d ON d.rowid=(
   SELECT rowid FROM api_design_decisions WHERE app_slug=a.slug ORDER BY recorded_at DESC, rowid DESC LIMIT 1)
   WHERE a.status<>'retired' AND a.slug<>? ORDER BY a.slug`).all(request.app) as Array<{app:string;choices:string}>;
  const acceptedChoices=choices.flatMap(({app,choices})=>(JSON.parse(choices) as Array<{source:string|null}>).filter(c=>c.source&&sourceIds.includes(c.source)).map(c=>({app,source:c.source!}))).sort((a,b)=>a.app.localeCompare(b.app)||a.source.localeCompare(b.source));
  return {app:{slug:app.slug,name:app.name,status:app.status},concepts,sources,peerApps,acceptedChoices};
 }
 export(raw:unknown){return this.snapshot(parseDesignRequest(raw))}
 propose(raw:unknown){const request=parseDesignRequest(raw);return adviseApi(this.snapshot(request),request)}
 accept(raw:unknown,principal:Principal=OPERATOR){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InvalidParameter('Decision must be an object');
  const input=raw as Record<string,any>;
  if(Object.keys(input).some(k=>!['request','proposalId','choices','rationale'].includes(k)))throw new InvalidParameter('Unknown decision property');
  const request=parseDesignRequest(input.request);
  if(principal.anonymous||(principal.tier!=='operator'&&principal.app!==request.app))throw new InvalidParameter('Only the app owner or operator can record its API design decision');
  if(typeof input.proposalId!=='string'||!/^[a-f0-9]{64}$/.test(input.proposalId))throw new InvalidParameter('Expected proposalId from lattice_advise_api');
  if(typeof input.rationale!=='string'||!input.rationale.trim()||input.rationale.length>2000)throw new InvalidParameter('A review rationale of 1–2000 characters is required');
  const proposal=this.propose(request);
  if(proposal.proposalId!==input.proposalId)throw new InvalidParameter('Proposal is stale or was changed. Generate and review a fresh proposal before accepting.');
  if(proposal.validation.errors.length)throw new InvalidParameter('Cannot record a structurally invalid design');
  if(!Array.isArray(input.choices)||input.choices.length!==proposal.resources.length)throw new InvalidParameter('Choose one target per resource; source:null explicitly keeps the native API');
  const seen=new Set<string>();
  for(const choice of input.choices){
   if(!choice||typeof choice!=='object'||Array.isArray(choice)||Object.keys(choice).some(k=>!['conceptUri','source'].includes(k))||typeof choice.conceptUri!=='string'||!(choice.source===null||typeof choice.source==='string'))throw new InvalidParameter('Invalid resource choice');
   if(seen.has(choice.conceptUri)||!proposal.resources.some(r=>r.conceptUri===choice.conceptUri))throw new InvalidParameter('Duplicate or unknown resource choice');seen.add(choice.conceptUri);
   if(choice.source!==null&&!proposal.candidates.some(c=>c.conceptUri===choice.conceptUri&&c.source===choice.source))throw new InvalidParameter('Selected target was not compared in this proposal');
  }
  const choices=[...input.choices].sort((a,b)=>a.conceptUri.localeCompare(b.conceptUri));
  const id=digest({proposalId:proposal.proposalId,choices,rationale:input.rationale,actor:actorOf(principal)});
  const recordedAt=new Date().toISOString();
  const result=this.instance.store.db.prepare('INSERT OR IGNORE INTO api_design_decisions (id,app_slug,proposal_id,evidence_hash,actor,recorded_at,choices,rationale,proposal) VALUES (?,?,?,?,?,?,?,?,?)').run(id,request.app,proposal.proposalId,proposal.evidenceHash,actorOf(principal),recordedAt,JSON.stringify(choices),input.rationale,JSON.stringify(proposal));
  return {id,app:request.app,proposalId:proposal.proposalId,created:result.changes===1,choices,status:'design-accepted',notice:'Records a design intention only. No API was deployed, no adapter was executed, and no standards conformance was asserted.'};
 }
 decisions(app:string){
  if(!this.instance.store.db.prepare('SELECT 1 FROM apps WHERE slug=?').get(app))throw new NotFound('No registered app: '+app);
  const rows=this.instance.store.db.prepare('SELECT id,proposal_id AS proposalId,evidence_hash AS evidenceHash,actor,recorded_at AS recordedAt,choices,rationale FROM api_design_decisions WHERE app_slug=? ORDER BY recorded_at, rowid').all(app) as Array<{id:string;proposalId:string;evidenceHash:string;actor:string;recordedAt:string;choices:string;rationale:string}>;
  return {app,decisions:rows.map(r=>({...r,choices:JSON.parse(r.choices)})),notice:'Design choices are not implementation or standards-conformance evidence.'};
 }
}
