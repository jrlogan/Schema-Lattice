import {parentPort, workerData} from 'node:worker_threads';
import {Store} from '../storage/db.ts';
import {VectorIndex} from '../discover/vectors.ts';
import {Registry} from '../registry/registry.ts';
import {reportRevision} from './revision.ts';

// No LatticeInstance, model loading, seeding, migrations or database writes.
const store = new Store({...workerData.store, readonly: true});
const vectors = new VectorIndex(store.db, workerData.dim, workerData.model, true);
const registry = new Registry({store, vectors, governance: workerData.governance}, true);
parentPort!.on('message', ({id, app}: {id: number; app?: string}) => {
  try {
    const result = store.db.transaction(() => ({
      revision: reportRevision(store.db),
      report: app === undefined ? registry.portfolioReport() : registry.appReport(app),
    }))();
    parentPort!.postMessage({id, ...result});
  } catch (error) {
    parentPort!.postMessage({id, error: error instanceof Error ? error.message : String(error)});
  }
});
