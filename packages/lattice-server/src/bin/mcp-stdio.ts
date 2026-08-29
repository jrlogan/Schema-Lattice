#!/usr/bin/env node
// SchemaLattice MCP server over stdio — the local-testing entry point.
//
// stdout carries the MCP protocol and nothing else, so every diagnostic
// (including anything the embedding runtime decides to print during model
// load) is redirected to stderr before the instance is built.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LatticeInstance } from "../server/instance.ts";
import { createMcpServer } from "../mcp/server.ts";
import { loadConfig } from "../server/config.ts";

async function main(): Promise<void> {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  // Anything that reaches for console during startup lands on stderr.
  const toStderr = (...args: unknown[]) => {
    process.stderr.write(args.map((a) => String(a)).join(" ") + "\n");
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;

  const config = loadConfig();
  const instance = await LatticeInstance.create({ dataDir: config.dataDir });
  const totals = instance.totals();
  process.stderr.write(
    `schemalattice mcp ready — ${totals.concepts} concepts, ${totals.contexts} contexts, data at ${config.dataDir}\n`,
  );

  // Restore the real stdout writer for the transport only.
  process.stdout.write = stdoutWrite;

  const server = createMcpServer(instance);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = () => {
    instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`schemalattice mcp failed to start: ${err?.stack ?? err}\n`);
  process.exit(1);
});
