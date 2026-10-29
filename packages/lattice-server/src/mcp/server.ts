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
import { TOOLS, callTool, type CallContext } from "../tools/tools.ts";
import { OPERATOR, type Principal } from "../server/principals.ts";
import { isToolError } from "../tools/errors.ts";

export const SERVER_INFO = {
  name: "schemalattice",
  version: "0.1.0",
} as const;

/**
 * Tool profiles: which tools a session LISTS. Every listed tool's schema sits in the client's
 * context for the whole session, so 36 tools cost about 9,500 tokens before the first call.
 * A profile only trims the list; calling an unlisted tool still works (the principal decides
 * what is allowed, not the profile). Pick with /mcp?profile=build,sources or ?tools=a,b;
 * stdio reads LATTICE_MCP_PROFILE.
 */
const BUILD = ["lattice_discover", "lattice_resolve", "lattice_list_context", "lattice_propose", "lattice_feedback"];
export const PROFILES: Record<string, string[]> = {
  /** Search before you model, read a candidate, say whether it was right. About 1,100 tokens. */
  build: BUILD,
  /** Publish your own vocabulary: register, originate, fork, see who uses what. */
  publish: [...BUILD, "lattice_compare", "lattice_register_app", "lattice_publish_context", "lattice_publish_concept",
    "lattice_publish_fork", "lattice_list_usages"],
  /** Public datasets: find, map, check, join. */
  sources: [...BUILD, "lattice_find_sources", "lattice_resolve_source", "lattice_propose_source", "lattice_map_source",
    "lattice_check_source", "lattice_place_profile", "lattice_note_source", "lattice_report_join", "lattice_sources_report"],
  /** Reports over apps and the catalog. */
  reports: [...BUILD, "lattice_stats", "lattice_demand_report", "lattice_evidence_report", "lattice_mesh_report",
    "lattice_app_report", "lattice_portfolio_report", "lattice_compare"],
  /** Advice on an app's API design. */
  api: [...BUILD, "lattice_advise_api", "lattice_api_design_snapshot", "lattice_accept_api_design", "lattice_api_design_history"],
  /** Send back types the catalog lacks. */
  contribute: [...BUILD, "lattice_contribute", "lattice_withdraw_contribution"],
  all: TOOLS.map((t) => t.name),
};

/** The default list: builders get the search loop, key holders can publish, the operator sees all. */
export function defaultProfile(principal: Principal): string {
  if (principal.tier === "operator" && !principal.anonymous) return "all";
  return principal.anonymous ? "build" : "publish";
}

/** Tool names for `profile` (comma-separated names, merged) and/or an explicit `tools` list. */
export function toolsFor(profile: string | null | undefined, tools: string | null | undefined, principal: Principal): Set<string> {
  const known = new Set(TOOLS.map((t) => t.name));
  const names = new Set<string>();
  for (const p of (profile || (tools ? "" : defaultProfile(principal))).split(",").map((s) => s.trim()).filter(Boolean)) {
    for (const n of PROFILES[p] ?? []) names.add(n);
  }
  for (const n of (tools ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const full = n.startsWith("lattice_") ? n : `lattice_${n}`;
    if (known.has(full)) names.add(full);
  }
  return names.size > 0 ? names : new Set(PROFILES[defaultProfile(principal)]);
}

const INSTRUCTIONS =
  "SchemaLattice: search a shared catalog of data concepts before you model one. Loop: lattice_discover → " +
  "lattice_resolve the best candidate → adopt, fork or originate → lattice_propose right/wrong. This session lists " +
  "only some tools; reconnect with /mcp?profile=build|publish|sources|reports|api|contribute|all (comma-separate to " +
  "combine). Full workflow: GET /skill.";

/**
 * `principal` is who is calling. The stdio server is a local process run by
 * the operator, so it defaults to OPERATOR; the HTTP transport MUST pass the
 * principal resolved from the request's key, or every key holder would be
 * treated as the operator.
 */
export function createMcpServer(
  instance: LatticeInstance,
  principal: Principal = OPERATOR,
  ctx: CallContext = {},
  listed: Set<string> = toolsFor(null, null, principal),
): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.filter((t) => listed.has(t.name)).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await callTool(instance, name, (args ?? {}) as Record<string, unknown>, principal, ctx);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      // Gate rejections are results the AI must read and act on, not
      // transport failures — but flagging them lets clients retry sensibly.
      isError: isToolError(result),
    };
  });

  return server;
}
