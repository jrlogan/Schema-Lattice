// Explicit registration works under Node without inheriting the parent's tsx CLI loader.
import { register } from 'tsx/esm/api';
register();
await import('./report-worker.ts');
