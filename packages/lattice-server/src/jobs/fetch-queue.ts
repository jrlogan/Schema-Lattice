import {SourceFetchError, type JsonFetcher} from '../sources/fetch.ts';

/** Across all callers: at most two outbound fetches and 32 waiting URLs.
 * Identical in-flight URLs share a fetch; failures are never retained. */
export function queuedFetcher(fetcher: JsonFetcher, concurrency = 2, maxWaiting = 32): JsonFetcher {
  let active = 0;
  const waiting: Array<() => void> = [];
  const pending = new Map<string, Promise<unknown>>();
  return url => {
    const existing = pending.get(url);
    if (existing) return existing.then(value => structuredClone(value));
    if (active >= concurrency && waiting.length >= maxWaiting) return Promise.reject(new SourceFetchError('Source fetch queue is full; retry shortly'));
    const job = new Promise<unknown>((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve().then(() => fetcher(url)).then(resolve, reject).finally(() => {
          active--; waiting.shift()?.();
        });
      };
      if (active < concurrency) run(); else waiting.push(run);
    }).finally(() => pending.delete(url));
    pending.set(url, job);
    return job.then(value => structuredClone(value));
  };
}
