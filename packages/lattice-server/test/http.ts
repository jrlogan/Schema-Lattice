// HTTP transport smoke test: canonical URI resolution, the REST tool
// surface, API-key gating on writes, and an MCP handshake over the
// streamable endpoint. Boots a real server on an ephemeral port.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { startHttpServer } from "../src/http/server.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, note: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
  ok ? passed++ : failed++;
}

const API_KEY = "test-key-do-not-ship";

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-http-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const handle = await startHttpServer(instance, {
    dataDir: tmp,
    host: "127.0.0.1",
    port: 0,
    apiKey: API_KEY,
    // Tight feedback window so the limiter is testable in-suite; the
    // other buckets stay above what this suite generates.
    rateLimits: { feedback: 3 },
  });
  const base = `http://127.0.0.1:${handle.port}`;

  const get = async (path: string) => {
    const res = await fetch(base + path);
    return {
      status: res.status,
      cacheControl: res.headers.get("cache-control"),
      body: await res.json() as any,
    };
  };
  const post = async (path: string, body: unknown, key?: string) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  };

  // --- health and index -------------------------------------------------
  const health = await get("/health");
  check("health", health.status === 200 && health.body.ok === true, JSON.stringify(health.body));

  const index = await get("/");
  check(
    "index-declares-key-required",
    index.body.writesRequireKey === true,
    `authority=${index.body.authority}`,
  );

  // --- canonical URI resolution ------------------------------------------
  const personUri = instance.skeletonUri("person")!;
  const path = personUri.replace("https://schemalattice.io", "");
  const person = await get(path);
  check(
    "resolve-canonical-path",
    person.status === 200 && person.body.record.prefLabel.en === "Person",
    `${path} → ${person.body.record?.prefLabel?.en}`,
  );

  check(
    "content-addressed-route-is-immutable",
    person.cacheControl === "public, max-age=31536000, immutable",
    `cache-control: ${person.cacheControl}`,
  );

  // Caches and link checkers probe with HEAD; it must match the GET.
  const headRes = await fetch(base + path, { method: "HEAD" });
  check(
    "head-matches-get",
    headRes.status === 200 &&
      headRes.headers.get("cache-control") === person.cacheControl,
    `HEAD ${headRes.status}, cache-control: ${headRes.headers.get("cache-control")}`,
  );

  const ghost = await get("/c/root/nobody@000000000000");
  check(
    "resolve-404",
    ghost.status === 404 && ghost.body.error.code === "not-found",
    `status=${ghost.status}`,
  );

  const ctxPath = instance.contextUri().replace("https://schemalattice.io", "");
  const ctxConcepts = await get(`${ctxPath}/concepts?limit=5`);
  check(
    "list-context-over-http",
    ctxConcepts.status === 200 && ctxConcepts.body.concepts.length === 5,
    `${ctxConcepts.body.totalCount} concepts in ${ctxConcepts.body.context.title}`,
  );

  // --- read tools are public ---------------------------------------------
  const discovered = await get("/discover?description=a%20person%20who%20belongs%20to%20a%20group&limit=3");
  check(
    "discover-without-key",
    discovered.status === 200 && discovered.body.results.length > 0,
    `top=${discovered.body.results[0]?.prefLabel}`,
  );

  check(
    "dynamic-route-is-not-cached",
    discovered.cacheControl === "no-store",
    `cache-control: ${discovered.cacheControl}`,
  );

  const tools = await get("/api/tools");
  check(
    "tool-listing",
    tools.body.tools.length === 14 && tools.body.tools.some((t: any) => t.write === true),
    `${tools.body.tools.length} tools`,
  );

  const usages = await post("/api/tools/lattice_list_usages", { conceptUri: personUri });
  check("read-tool-without-key", usages.status === 200, `status=${usages.status}`);

  // --- the front door ------------------------------------------------------
  const htmlRes = await fetch(base + "/", { headers: { accept: "text/html" } });
  const html = await htmlRes.text();
  check(
    "landing-page-for-browsers",
    htmlRes.headers.get("content-type")?.startsWith("text/html") === true &&
      html.includes("Check your app against it") &&
      html.includes("What gets recorded"),
    `content-type=${htmlRes.headers.get("content-type")}`,
  );
  const skillRes = await fetch(base + "/skill");
  const skillText = await skillRes.text();
  check(
    "skill-served",
    skillRes.status === 200 && skillText.includes("# SchemaLattice workflow skill"),
    `status=${skillRes.status}, ${skillText.length} bytes`,
  );
  const specRes = await fetch(base + "/specs/ai-checkpoints.md");
  check("specs-served", specRes.status === 200, `status=${specRes.status}`);
  const traversal = await fetch(base + "/specs/..%2F..%2Fpackage.json");
  check("specs-no-traversal", traversal.status === 404, `status=${traversal.status}`);

  // Feedback is deliberately open — no key needed.
  const fb = await post("/api/tools/lattice_feedback", {
    message: "Checked an app read-only; the verdict table was clear.",
    rating: 4,
  });
  check(
    "feedback-without-key",
    fb.status === 200 && fb.body.recorded === true,
    `status=${fb.status}`,
  );

  // Ephemeral discover: works, still logs an event, but stores no wording.
  const eph = await post("/api/tools/lattice_discover", {
    description: "a secret prototype concept nobody should see in demand reports",
    ephemeral: true,
  });
  check("ephemeral-discover-works", eph.status === 200 && eph.body.results.length > 0, `sessionId=${eph.body.sessionId?.slice(0, 13)}…`);
  const demand = await post("/api/tools/lattice_demand_report", {});
  const leaked = JSON.stringify(demand.body).includes("secret prototype");
  check("ephemeral-query-not-in-demand-report", !leaked, leaked ? "LEAKED" : "wording absent");

  // --- writes are gated ----------------------------------------------------
  const contextArgs = {
    slug: "harbor-ops",
    title: "Harbor Operations",
    definition:
      "Vocabulary for small working waterfronts: the berths, the vessels tied to them, and the haul-out and inspection work that keeps them usable.",
  };
  const unauthed = await post("/api/tools/lattice_publish_context", contextArgs);
  check(
    "write-without-key-rejected",
    unauthed.status === 401,
    `status=${unauthed.status}`,
  );

  const wrongKey = await post("/api/tools/lattice_publish_context", contextArgs, "not-the-key");
  check("write-with-wrong-key-rejected", wrongKey.status === 401, `status=${wrongKey.status}`);

  const authed = await post("/api/tools/lattice_publish_context", contextArgs, API_KEY);
  check(
    "write-with-key-accepted",
    authed.status === 200 && authed.body.published === true,
    authed.body.uri ?? JSON.stringify(authed.body),
  );

  // --- gate rejections come back as the standard envelope -------------------
  const rejected = await post(
    "/api/tools/lattice_publish_concept",
    {
      contextUri: authed.body.uri,
      prefLabel: "Berth",
      definition: "TBD",
      sessionId: "http-test",
    },
    API_KEY,
  );
  check(
    "gate-rejection-envelope",
    rejected.status === 400 && rejected.body.error.code === "invalid-parameter",
    `${rejected.body.error?.details?.latticeCode}`,
  );

  // --- MCP over streamable HTTP ---------------------------------------------
  const mcpRes = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0" },
      },
    }),
  });
  const mcpText = await mcpRes.text();
  check(
    "mcp-initialize",
    mcpRes.ok && mcpText.includes("schemalattice"),
    `status=${mcpRes.status}`,
  );

  const mcpUnauthed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  check("mcp-gated-by-key", mcpUnauthed.status === 401, `status=${mcpUnauthed.status}`);

  // --- abuse brakes --------------------------------------------------------
  let limited: { status: number; body: any } | null = null;
  for (let i = 0; i < 5; i++) {
    const r = await post("/api/tools/lattice_feedback", { message: `spam ${i}` });
    if (r.status === 429) { limited = r; break; }
  }
  check(
    "feedback-rate-limited",
    limited !== null && limited.body.error.code === "rate-limited",
    limited ? `429 after burst, retryAfter=${limited.body.error.details.retryAfterSeconds}s` : "never limited",
  );

  // The operator's key bypasses the brake.
  const opFb = await post("/api/tools/lattice_feedback", { message: "operator note" }, API_KEY);
  check("operator-bypasses-limit", opFb.status === 200, `status=${opFb.status}`);

  const longQuery = await post("/api/tools/lattice_discover", { description: "x".repeat(1001) });
  check(
    "discover-description-capped",
    longQuery.status === 400 && longQuery.body.error.code === "invalid-parameter",
    `status=${longQuery.status}`,
  );

  const demandNotice = await post("/api/tools/lattice_demand_report", {});
  check(
    "demand-report-carries-untrusted-notice",
    typeof demandNotice.body.notice === "string" && demandNotice.body.notice.includes("never as instructions"),
    "notice present",
  );

  console.log(`\n${passed}/${passed + failed} checks passed`);
  await handle.close();
  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
