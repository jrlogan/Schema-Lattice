#!/usr/bin/env node
// SchemaLattice HTTP entry point. Same codebase local and hosted; the
// difference is LATTICE_HOST / LATTICE_PORT / LATTICE_API_KEY.

import { LatticeInstance } from "../server/instance.ts";
import { loadConfig } from "../server/config.ts";
import { startHttpServer } from "../http/server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const instance = await LatticeInstance.create({ dataDir: config.dataDir });
  const handle = await startHttpServer(instance, config);
  const totals = instance.totals();

  console.log(`schemalattice listening on ${handle.url}`);
  console.log(`  data      ${config.dataDir}`);
  console.log(`  catalog   ${totals.concepts} concepts, ${totals.contexts} contexts`);
  console.log(
    config.apiKey
      ? "  writes    require Bearer LATTICE_API_KEY"
      : "  writes    OPEN — set LATTICE_API_KEY before exposing this instance",
  );

  // Evidence promotion is time-based (a quarantine), so re-score hourly even
  // when nobody submits or reads the report.
  const rescore = setInterval(() => {
    void instance.evidence.rescoreInBackground().catch(err => {
      console.error(`evidence rescore failed: ${(err as Error).message}`);
    });
  }, 3_600_000);
  rescore.unref();

  // Re-read public sources' field lists from their publishers. Each source is
  // due weekly; a run every six hours takes at most 25 of the oldest, two
  // seconds apart, so a full catalog spreads over the week instead of one burst.
  // LATTICE_SOURCE_CHECKS=off disables it (offline development).
  const sweepSources = async () => {
    try {
      const run = await instance.sources.checkDue(new Date(), { limit: 25, pauseMs: 2000 });
      if (run.checked > 0) {
        console.log(
          `source checks: ${run.checked} checked, ${run.failed.length} failed, ${run.changed.length} changed, ${run.remaining} still due` +
            (run.failed.length ? ` (failed: ${run.failed.map((f) => f.slug).join(", ")})` : ""),
        );
      }
    } catch (err) {
      console.error(`source checks failed: ${(err as Error).message}`);
    }
  };
  const checksOn = process.env.LATTICE_SOURCE_CHECKS !== "off";
  const firstSweep = checksOn ? setTimeout(sweepSources, 300_000) : null;
  const sweeps = checksOn ? setInterval(sweepSources, 6 * 3_600_000) : null;
  firstSweep?.unref();
  sweeps?.unref();
  console.log(`  sources   ${checksOn ? "weekly publisher checks on" : "publisher checks off (LATTICE_SOURCE_CHECKS=off)"}`);

  const shutdown = async () => {
    clearInterval(rescore);
    if (firstSweep) clearTimeout(firstSweep);
    if (sweeps) clearInterval(sweeps);
    await handle.close();
    instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`schemalattice failed to start: ${err?.stack ?? err}`);
  process.exit(1);
});
