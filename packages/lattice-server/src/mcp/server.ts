// MCP wrapper over the shared tool table.
//
// Deliberately thin: everything a client can do here it can also do over
// HTTP, because both mount src/tools/tools.ts.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { LatticeInstance } from "../server/instance.ts";
import { TOOLS, callTool } from "../tools/tools.ts";
import { isToolError } from "../tools/errors.ts";

export const SERVER_INFO = {
  name: "schemalattice",
  version: "0.1.0",
} as const;

export function createMcpServer(instance: LatticeInstance): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await callTool(instance, name, (args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      // Gate rejections are results the AI must read and act on, not
      // transport failures — but flagging them lets clients retry sensibly.
      isError: isToolError(result),
    };
  });

  return server;
}
