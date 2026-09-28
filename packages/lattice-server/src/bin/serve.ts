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
    try {
      instance.evidence.rescore();
    } catch (err) {
      console.error(`evidence rescore failed: ${(err as Error).message}`);
    }
  }, 3_600_000);
  rescore.unref();

  const shutdown = async () => {
    clearInterval(rescore);
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
