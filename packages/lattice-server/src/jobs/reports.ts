import {Worker} from 'node:worker_threads';
import type {LatticeInstance} from '../server/instance.ts';
import {installReportRevision, reportRevision} from './revision.ts';
import {InvalidParameter} from '../tools/errors.ts';

/** One worker, bounded queue/cache, and one shared promise for identical requests.
 * Results describe one SQLite read snapshot; a subsequent write invalidates them. */
export class BackgroundReports {
  private worker?: Worker;
  private sequence = 0;
  private closed = false;
  private pending = new Map<number, {resolve: (result: any) => void; reject: (error: Error) => void}>();
  private inflight = new Map<string, Promise<any>>();
  private cache = new Map<string, {revision: number; report: any; bytes: number}>();
  private cacheBytes = 0;
  constructor(private instance: LatticeInstance) { installReportRevision(instance.store.db); }

  private start(): Worker {
    if (this.worker) return this.worker;
    const i = this.instance;
    const worker = new Worker(new URL('./report-worker.mjs', import.meta.url), {resourceLimits: {maxOldGenerationSizeMb: 128}, workerData: {
      store: {dbPath: i.store.db.name, blobDir: i.store.blobDir},
      dim: i.embedder.dim, model: i.embedder.id, governance: i.governance,
    }});
    this.worker = worker;
    worker.on('message', ({id, error, ...result}) => {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (error) pending.reject(new Error(error)); else pending.resolve(result);
      if (!this.pending.size) worker.unref();
    });
    const failed = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    worker.on('error', failed);
    worker.on('exit', code => failed(new Error(`Report worker exited (${code})`)));
    return worker;
  }

  async get(app?: string): Promise<any> {
    if (this.closed) throw new Error('Report service is closed');
    const revision = reportRevision(this.instance.store.db), key = JSON.stringify(app ?? null);
    const hit = this.cache.get(key);
    if (hit?.revision === revision) return structuredClone(hit.report);
    const flightKey = JSON.stringify([key, revision]);
    const existing = this.inflight.get(flightKey);
    if (existing) return structuredClone(await existing);
    if (this.pending.size >= 16) throw new InvalidParameter('Report queue is full; retry shortly.');
    const worker = this.start(), id = ++this.sequence;
    worker.ref();
    const job = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Terminating the worker also rejects queued work; a later request starts a fresh one.
        for (const pending of this.pending.values()) pending.reject(new Error('Report exceeded its 60 second time limit'));
        this.pending.clear();
        this.worker = undefined;
        void worker.terminate();
      }, 60_000);
      this.pending.set(id, {
        resolve: result => { clearTimeout(timeout); resolve(result); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      worker.postMessage({id, app});
    }).then(({revision: computedRevision, report}) => {
      const bytes = Buffer.byteLength(JSON.stringify(report));
      if (bytes <= 10_000_000) {
        const old = this.cache.get(key);
        if (old) { this.cacheBytes -= old.bytes; this.cache.delete(key); }
        while (this.cache.size >= 32 || this.cacheBytes + bytes > 10_000_000) {
          const first = this.cache.keys().next().value!;
          this.cacheBytes -= this.cache.get(first)!.bytes; this.cache.delete(first);
        }
        this.cache.set(key, {revision: computedRevision, report, bytes}); this.cacheBytes += bytes;
      }
      return report;
    }).finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, job);
    return structuredClone(await job);
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new Error('Report service closed'));
    this.pending.clear(); this.cache.clear(); this.cacheBytes = 0;
    if (this.worker) { const worker = this.worker; this.worker = undefined; void worker.terminate(); }
  }
}
