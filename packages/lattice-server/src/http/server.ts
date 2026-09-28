// HTTP transport: canonical URI resolution, a REST tool surface, and a
// streamable MCP endpoint — all over the same tool table as the stdio server.
//
// Read is public; write requires the API key (DECISIONS.md § Infrastructure).
// Canonical URIs stay `https://schemalattice.com/...` regardless of which
// host actually serves them, so the resolution routes match on path only.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { LatticeInstance } from "../server/instance.ts";
import type { LatticeConfig } from "../server/config.ts";
import { createMcpServer } from "../mcp/server.ts";
import { TOOLS, TOOLS_BY_NAME, callTool, type CallContext } from "../tools/tools.ts";
import { isToolError } from "../tools/errors.ts";
import { BASE_AUTHORITY } from "../hashing/hash.ts";
import { listContext } from "../query/stats.ts";
import { landingPage } from "./landing.ts";
import { RateLimiter, clientKey, DEFAULT_LIMITS, type RateLimits, type Bucket } from "./ratelimit.ts";
import { REPO_ROOT } from "../server/config.ts";
import {
  OPERATOR, actorOf, anonymousBecause, credentialGuidance, checkCapability, looksLikeAppKey, matchesOperatorKey,
  type Principal,
} from "../server/principals.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MAX_BODY_BYTES = 1_000_000;

export interface HttpServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * A concept or context URI contains the content hash of the record it names,
 * so the body at that path can never change. Saying so lets a CDN absorb the
 * resolution traffic — the dominant read path — without ever asking the
 * origin twice. Everything else is dynamic and says so.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";
const DYNAMIC = "no-store";

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  cacheControl: string = DYNAMIC,
): void {
  const payload = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": cacheControl,
    // Public read surface; anyone may resolve a URI from a browser.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, mcp-session-id",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(payload);
}

function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  cacheControl: string = DYNAMIC,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": cacheControl,
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

type Presented = { token: string } | { problem: "none" | "empty" | "malformed" };

function bearer(req: IncomingMessage): Presented {
  const header = req.headers.authorization;
  if (header === undefined) return { problem: "none" };
  const match = header.match(/^Bearer(?:\s+(.*))?$/i);
  if (!match) return header.trim() === "" ? { problem: "empty" } : { problem: "malformed" };
  const token = (match[1] ?? "").trim();
  return token ? { token } : { problem: "empty" };
}

/**
 * Resolve the caller. Two kinds of key: the single operator token from the
 * environment, and a per-app key minted by lattice_register_app and stored as a
 * hash. No key at all is ANONYMOUS — which can still read everything, and can
 * still register a new app to get a key.
 *
 * With no operator key configured (local dev) every caller is the operator, so
 * a laptop instance behaves as it always has.
 */
function resolvePrincipal(req: IncomingMessage, config: LatticeConfig, instance: LatticeInstance): Principal {
  if (!config.apiKey) return OPERATOR;
  const presented = bearer(req);
  if ("problem" in presented) return anonymousBecause(presented.problem);
  const { token } = presented;
  if (looksLikeAppKey(token)) {
    return instance.registry.principalForKey(token) ?? anonymousBecause("unrecognised");
  }
  return matchesOperatorKey(token, config.apiKey) ? OPERATOR : anonymousBecause("unrecognised");
}

/**
 * Access denials are still the standard tool-error envelope — the specific
 * reason travels in `details.latticeCode`, exactly as gate rejections do, so a
 * client has one place to look. Only the HTTP status differentiates them.
 */
const DENIAL_STATUS: Record<string, number> = {
  ERR_NOT_AUTHENTICATED: 401,
  ERR_TIER_TOO_LOW: 403,
  ERR_OPERATOR_ONLY: 403,
  ERR_APP_NOT_YOURS: 403,
  ERR_ORIGINATE_BUDGET: 429,
};

function denialStatus(result: unknown, fallback: number): number {
  const details = (result as { error?: { details?: { latticeCode?: string } } })?.error?.details;
  const code = details?.latticeCode;
  if (code === undefined) return fallback;
  return DENIAL_STATUS[code] ?? fallback;
}

export async function startHttpServer(
  instance: LatticeInstance,
  config: LatticeConfig & { rateLimits?: Partial<RateLimits> },
): Promise<HttpServerHandle> {
  const limiter = new RateLimiter({ ...DEFAULT_LIMITS, ...config.rateLimits });
  const server = createServer((req, res) => {
    handle(req, res, instance, config, limiter).catch((err) => {
      send(res, 500, {
        error: { code: "server-error", message: err?.message ?? String(err) },
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    port,
    url: `http://${config.host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  instance: LatticeInstance,
  config: LatticeConfig,
  limiter: RateLimiter,
): Promise<void> {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const path = decodeURIComponent(url.pathname);

  // The operator's own key bypasses limiting. Everyone else is counted into
  // the bucket their route belongs to — keyed by app when we know who they
  // are, because an IP is a poor proxy for an agent: several friends' agents
  // can share one cloud NAT, and one agent can rotate through many addresses.
  const principal = resolvePrincipal(req, config, instance);
  const isOperator = principal.tier === "operator" && config.apiKey !== null;
  if (!isOperator) {
    const bucket: Bucket =
      path === "/discover" || path === "/api/tools/lattice_discover"
        ? "discover"
        : path === "/api/tools/lattice_feedback"
          ? "feedback"
          : path === "/api/tools/lattice_propose"
            ? "evidence"
            : "general";
    const key = principal.anonymous
      ? clientKey(req.socket.remoteAddress, req.headers["x-forwarded-for"] as string | undefined)
      : actorOf(principal);
    const retryAfter = limiter.hit(key, bucket);
    if (retryAfter !== null) {
      const payload = JSON.stringify({
        error: {
          code: "rate-limited",
          message: `too many ${bucket} requests — retry in ${retryAfter}s`,
          details: { retryAfterSeconds: retryAfter },
        },
      });
      res.writeHead(429, {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfter),
        "access-control-allow-origin": "*",
      });
      res.end(payload);
      return;
    }
  }
  // HEAD must answer exactly as GET would — same status, same headers, no
  // body. Node drops the payload for HEAD responses on its own. Caches and
  // link checkers probe with HEAD, and a 404 there is a cache-poisoning
  // answer for a URI that resolves perfectly well.
  const isRead = req.method === "GET" || req.method === "HEAD";

  // --- MCP over streamable HTTP -------------------------------------
  if (path === "/mcp") {
    if (req.method === "POST" && principal.anonymous) {
      // The MCP surface exposes write tools, so the whole endpoint is gated
      // whenever a key is configured.
      const { message, guidance } = credentialGuidance(principal.credential);
      send(res, 401, {
        error: {
          code: "invalid-parameter",
          message: `the MCP endpoint requires an API key: ${message}`,
          details: { latticeCode: "ERR_NOT_AUTHENTICATED", guidance },
        },
      });
      return;
    }
    await handleMcp(req, res, instance, principal, callContext(req));
    return;
  }

  // --- health / index ------------------------------------------------
  if (path === "/health") {
    send(res, 200, { ok: true, ...instance.totals() });
    return;
  }

  if (path === "/" && isRead) {
    // Browsers get the human front door; API clients get the JSON index.
    if ((req.headers.accept ?? "").includes("text/html")) {
      const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "localhost";
      sendText(res, 200, landingPage(host, instance.totals()), "text/html; charset=utf-8");
      return;
    }
    send(res, 200, {
      service: "schemalattice",
      version: "0.1.0",
      authority: BASE_AUTHORITY,
      totals: instance.totals(),
      transparency: {
        recorded: "search query text (unless ephemeral:true), best match + score, random session id",
        sharedOnward: "unmet queries appear aggregated in lattice_demand_report",
        neverRecorded: "your code, unpublished schemas, identity",
        feedback: "lattice_feedback notes go to maintainers only",
      },
      endpoints: {
        skill: "GET /skill (the workflow instructions for AI clients)",
        builderSkill: "GET /skill/builder (one-page brief for apps built on an existing backend)",
        client: "GET /cli/schemalattice.mjs (publish a platform's vocabulary from its code; vendor it)",
        resolveConcept: "GET /c/{context}/{slug}@{hash}",
        resolveContext: "GET /s/{context}@{hash}",
        listContext: "GET /s/{context}@{hash}/concepts",
        listContexts: "POST /api/tools/lattice_list_context with {} — every context",
        discover: "GET /discover?description=...&limit=10&context=<slug>&ephemeral=true",
        tools: "GET /api/tools",
        callTool: "POST /api/tools/{name}",
        mcp: "POST /mcp",
      },
      writesRequireKey: config.apiKey !== null,
    });
    return;
  }

  // --- served documentation -------------------------------------------
  const SKILLS: Record<string, string> = {
    "/skill": "lattice-workflow.md",
    "/skill/builder": "lattice-builder-brief.md",
  };
  if (Object.hasOwn(SKILLS, path) && isRead) {
    const file = join(REPO_ROOT, "skills", SKILLS[path]);
    if (!existsSync(file)) {
      send(res, 404, { error: { code: "not-found", message: "skill file not deployed" } });
      return;
    }
    sendText(res, 200, readFileSync(file, "utf8"), "text/markdown; charset=utf-8");
    return;
  }

  // The publishing client: one dependency-free file that repositories vendor.
  if (path === "/cli/schemalattice.mjs" && isRead) {
    const file = join(REPO_ROOT, "packages", "lattice-client", "schemalattice.mjs");
    if (!existsSync(file)) {
      send(res, 404, { error: { code: "not-found", message: "client not deployed" } });
      return;
    }
    sendText(res, 200, readFileSync(file, "utf8"), "text/javascript; charset=utf-8");
    return;
  }

  const specMatch = path.match(/^\/specs\/([a-z0-9][a-z0-9-]*\.md)$/);
  if (specMatch && isRead) {
    const file = join(REPO_ROOT, "specs", specMatch[1]);
    if (!existsSync(file)) {
      send(res, 404, { error: { code: "not-found", message: `no spec ${specMatch[1]}` } });
      return;
    }
    sendText(res, 200, readFileSync(file, "utf8"), "text/markdown; charset=utf-8");
    return;
  }

  // --- canonical URI resolution --------------------------------------
  const conceptMatch = path.match(/^\/c\/([^/]+)\/([^/]+)$/);
  if (conceptMatch && isRead) {
    const uri = `${BASE_AUTHORITY}/c/${conceptMatch[1]}/${conceptMatch[2]}`;
    const record = instance.resolve(uri);
    if (!record) {
      send(res, 404, { error: { code: "not-found", message: `no concept at ${uri}` } });
      return;
    }
    // Adoption and fork counts change over time, so they are not part of the
    // immutable body — callers who want them use lattice_stats.
    send(res, 200, { uri, record }, IMMUTABLE);
    return;
  }

  const contextConcepts = path.match(/^\/s\/([^/]+)\/concepts$/);
  if (contextConcepts && isRead) {
    const uri = `${BASE_AUTHORITY}/s/${contextConcepts[1]}`;
    const result = listContext(
      instance.store,
      uri,
      Number(url.searchParams.get("limit") ?? 100),
      Number(url.searchParams.get("offset") ?? 0),
    );
    if (!result) {
      send(res, 404, { error: { code: "not-found", message: `no context at ${uri}` } });
      return;
    }
    send(res, 200, result);
    return;
  }

  const contextMatch = path.match(/^\/s\/([^/]+)$/);
  if (contextMatch && isRead) {
    const uri = `${BASE_AUTHORITY}/s/${contextMatch[1]}`;
    const record = instance.store.getContext(uri);
    if (!record) {
      send(res, 404, { error: { code: "not-found", message: `no context at ${uri}` } });
      return;
    }
    send(res, 200, { uri, record }, IMMUTABLE);
    return;
  }

  // --- convenience read: discover via query string ---------------------
  if (path === "/discover" && isRead) {
    const description = url.searchParams.get("description") ?? "";
    if (!description) {
      send(res, 400, {
        error: { code: "invalid-parameter", message: '"description" query parameter is required' },
      });
      return;
    }
    // `context` may repeat or be comma-separated: ?context=a&context=b or ?context=a,b
    const contexts = url.searchParams
      .getAll("context")
      .flatMap((c) => c.split(","))
      .map((c) => c.trim())
      .filter(Boolean);
    const result = await callTool(instance, "lattice_discover", {
      description,
      limit: url.searchParams.get("limit") ?? undefined,
      contextHint: url.searchParams.get("contextHint") ?? undefined,
      sessionId: url.searchParams.get("sessionId") ?? undefined,
      ...(contexts.length > 0 ? { contexts } : {}),
      ephemeral: url.searchParams.get("ephemeral") === "true",
    }, principal, callContext(req));
    send(res, isToolError(result) ? 400 : 200, result);
    return;
  }

  // --- REST tool surface ----------------------------------------------
  if (path === "/api/tools" && isRead) {
    send(res, 200, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        write: t.write,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }

  const toolCall = path.match(/^\/api\/tools\/([a-z_]+)$/);
  if (toolCall && req.method === "POST") {
    const name = toolCall[1];
    const tool = TOOLS_BY_NAME.get(name);
    if (!tool) {
      send(res, 404, {
        error: {
          code: "not-found",
          message: `unknown tool: ${name}`,
          details: { available: TOOLS.map((t) => t.name) },
        },
      });
      return;
    }
    if (tool.write) {
      const denial = checkCapability(principal, name);
      if (denial) {
        send(res, DENIAL_STATUS[denial.code] ?? 403, {
          error: {
            code: "invalid-parameter",
            message: denial.message,
            details: { latticeCode: denial.code, guidance: denial.guidance },
          },
        });
        return;
      }
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      send(res, 400, {
        error: { code: "invalid-parameter", message: (err as Error).message },
      });
      return;
    }
    const result = await callTool(
      instance,
      name,
      (body ?? {}) as Record<string, unknown>,
      principal,
      callContext(req),
    );
    send(res, isToolError(result) ? denialStatus(result, 400) : 200, result);
    return;
  }

  send(res, 404, { error: { code: "not-found", message: `no route for ${req.method} ${path}` } });
}

/**
 * Stateless MCP: a fresh server and transport per request. The lattice keeps
 * all its state in SQLite, so there is nothing session-scoped to preserve and
 * this avoids leaking transports on a public endpoint.
 */
function callContext(req: IncomingMessage): CallContext {
  return {
    clientAddress: clientKey(req.socket.remoteAddress, req.headers["x-forwarded-for"] as string | undefined),
  };
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  instance: LatticeInstance,
  principal: Principal,
  ctx: CallContext,
): Promise<void> {
  const server = createMcpServer(instance, principal, ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  let body: unknown;
  try {
    body = req.method === "POST" ? await readBody(req) : undefined;
  } catch (err) {
    send(res, 400, {
      error: { code: "invalid-parameter", message: (err as Error).message },
    });
    return;
  }
  await transport.handleRequest(req, res, body);
}
