import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {LatticeInstance} from '../src/server/instance.ts';
import {seedAdvisorDemo} from '../examples/api-advisor/fixture.ts';
import {queuedFetcher} from '../src/jobs/fetch-queue.ts';
import {reportRevision} from '../src/jobs/revision.ts';
import {adviseApi} from '../src/advisor/advisor.ts';
import {startHttpServer} from '../src/http/server.ts';
let instance: LatticeInstance, dir: string;
let fixture: Awaited<ReturnType<typeof seedAdvisorDemo>>;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lattice-scaling-'));
  instance = await LatticeInstance.create({dataDir:dir, embedder:{id:'scaling-test',dim:4,embed:async texts=>texts.map(()=>new Float32Array([1,0,0,0]))}});
  fixture = await seedAdvisorDemo(instance);
});
after(() => {instance.close();rmSync(dir,{recursive:true,force:true});});

test('background reports preserve results; concurrent identical requests share work', async () => {
  const expected = instance.registry.portfolioReport();
  const before = (instance.reports as any).sequence;
  const reports = await Promise.all(Array.from({length:8},()=>instance.reports.get()));
  assert.equal((instance.reports as any).sequence, before+1);
  for (const report of reports) assert.deepEqual(report,expected);
  reports[0].apps.length=0;
  assert.deepEqual(await instance.reports.get(),expected);
  const app = await instance.reports.get(fixture.request.app);
  assert.deepEqual(app.overlaps,expected.overlaps.filter(o=>o.a===fixture.request.app||o.b===fixture.request.app));
  assert.deepEqual(app.score,instance.registry.scoreApp(fixture.request.app));
});

test('unknown app reports do not collide with the portfolio cache', async () => {
  const report=await instance.reports.get('*');
  assert.equal(report.app,'*');assert.deepEqual(report.overlaps,[]);assert.equal(report.apps,undefined);
  assert.ok((await instance.reports.get()).apps.length);
});

test('event traffic retains cache; another connection changing registry invalidates it', async () => {
  const version=reportRevision(instance.store.db), sequence=(instance.reports as any).sequence;
  instance.store.logEvent('resolve',{uri:fixture.uri});
  await instance.reports.get();
  assert.equal(reportRevision(instance.store.db),version);
  assert.equal((instance.reports as any).sequence,sequence);
  const writer=new Database(join(dir,'dev.db'));
  try {writer.prepare('UPDATE apps SET name=? WHERE slug=?').run('Updated civic app',fixture.request.app);} finally {writer.close();}
  assert.ok(reportRevision(instance.store.db)>version);
  const report=await instance.reports.get();
  assert.equal(report.apps.find((a:any)=>a.slug===fixture.request.app).name,'Updated civic app');
  assert.equal((instance.reports as any).sequence,sequence+1);
});

test('rollback does not invalidate reports; committed usage and attestation changes do', async () => {
  const db=instance.store.db, version=reportRevision(db);
  assert.throws(()=>db.transaction(()=>{db.prepare('UPDATE apps SET name=? WHERE slug=?').run('Rolled back',fixture.request.app);throw Error('rollback');})());
  assert.equal(reportRevision(db),version);
  db.prepare("UPDATE app_usages SET status='adopted' WHERE app_slug=?").run(fixture.request.app);
  const report=await instance.reports.get(fixture.request.app);
  assert.equal(report.score.reuse,1);
  instance.registry.recordAttestation(fixture.request.app,{gate:'test',result:'pass',performedBy:'test',performedOn:'2026-10-13'});
  assert.equal((await instance.reports.get(fixture.request.app)).attestations.length,1);
});

test('advisor avoids global overviews and join graphs; snapshot replays exactly', () => {
  const sources=instance.sources, original=sources.overview;
  sources.overview=()=>{throw Error('Full catalog scan');};
  try {
    const snapshot=instance.advisor.export(fixture.request);
    assert.deepEqual(adviseApi(snapshot,fixture.request),instance.advisor.propose(fixture.request));
    assert.ok(snapshot.sources.every(s=>s.related.length===0&&s.overlays.length===0));
    const oldCandidates=original.call(sources).filter(s=>s.concepts.some(c=>c.conceptUri===fixture.uri)).map(s=>s.slug).sort();
    assert.deepEqual(sources.advisorCandidates([fixture.uri]),oldCandidates);
  } finally {sources.overview=original;}
});

test('outbound fetch queue bounds concurrency, coalesces URLs, and releases failed jobs', async () => {
  let active=0, peak=0, calls=0;
  const release: Array<()=>void>=[];
  const fetcher=queuedFetcher(async url=>{
    calls++;active++;peak=Math.max(peak,active);
    await new Promise<void>(resolve=>release.push(resolve));active--;
    if(url==='fail')throw Error('upstream failed');return {url};
  },2,1);
  const a=fetcher('a'), same=fetcher('a'), b=fetcher('b'), c=fetcher('c');
  await assert.rejects(fetcher('overflow'),/queue is full/);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(calls,2);release.shift()!();release.shift()!();
  await new Promise<void>(resolve=>setImmediate(resolve));release.shift()!();
  const results=await Promise.all([a,same,b,c]);
  assert.equal(peak,2);assert.equal(calls,3);assert.deepEqual(results[0],results[1]);assert.notEqual(results[0],results[1]);
  const failure=fetcher('fail');const check=assert.rejects(failure,/upstream failed/);
  await new Promise<void>(resolve=>setImmediate(resolve));release.shift()!();await check;
  const retry=fetcher('a');await new Promise<void>(resolve=>setImmediate(resolve));release.shift()!();await retry;
  assert.equal(calls,5);
});

test('batched rescoring yields and matches the synchronous ledger result', async () => {
  const now=new Date('2026-10-14T00:00:00Z');
  instance.evidence.rescore(now);
  const expected=instance.store.db.prepare('SELECT * FROM claim_state ORDER BY state_key').all();
  let yielded=false;setImmediate(()=>{yielded=true;});
  const first=instance.evidence.rescoreInBackground(now);
  assert.equal(first,instance.evidence.rescoreInBackground(now));
  await first;assert.ok(yielded);
  assert.deepEqual(instance.store.db.prepare('SELECT * FROM claim_state ORDER BY state_key').all(),expected);
});

test('HTTP health stays responsive during concurrent reports; both mesh and advisor remain exposed', async () => {
  const handle=await startHttpServer(instance,{dataDir:dir,host:'127.0.0.1',port:0,apiKey:'test'});
  try {
    instance.store.db.prepare('UPDATE apps SET updated_at=?').run(new Date().toISOString());
    const post=(name:string,body:unknown)=>fetch(handle.url+'/api/tools/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const requests=Array.from({length:8},()=>post('lattice_portfolio_report',{}));
    const health=await fetch(handle.url+'/health');assert.equal(health.status,200);
    for(const response of await Promise.all(requests)){assert.equal(response.status,200);assert.ok((await response.json() as any).apps.length);}
    const names=(await (await fetch(handle.url+'/api/tools')).json() as any).tools.map((t:any)=>t.name);
    for(const name of ['lattice_mesh_report','lattice_advise_api','lattice_api_design_snapshot'])assert.ok(names.includes(name));
    const snapshot=await (await post('lattice_api_design_snapshot',fixture.request)).json() as any;
    assert.equal(adviseApi(snapshot,fixture.request).proposalId,instance.advisor.propose(fixture.request).proposalId);
  } finally {await handle.close();}
});
