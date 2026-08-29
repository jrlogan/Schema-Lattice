// Runtime configuration, read from the environment so the same build runs
// locally and on the public instance (DECISIONS.md § Infrastructure).

import { resolve, isAbsolute, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** packages/lattice-server, wherever the process happens to be started from. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface LatticeConfig {
  dataDir: string;
  port: number;
  host: string;
  /** Bearer token required for write tools. Unset = local dev, writes open. */
  apiKey: string | null;
}

export function loadConfig(): LatticeConfig {
  const key = process.env.LATTICE_API_KEY?.trim();
  return {
    // A relative data dir is resolved against the package, not the caller's
    // cwd, so the MCP host can launch the server from anywhere.
    dataDir: resolveDataDir(process.env.LATTICE_DATA_DIR ?? "var"),
    port: Number(process.env.LATTICE_PORT ?? 7000),
    host: process.env.LATTICE_HOST ?? "127.0.0.1",
    apiKey: key && key.length > 0 ? key : null,
  };
}

function resolveDataDir(value: string): string {
  return isAbsolute(value) ? value : join(PACKAGE_ROOT, value);
}
