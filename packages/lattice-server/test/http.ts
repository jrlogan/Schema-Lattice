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
  const path = personUri.replace("https://schemalattice.com", "");
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

  const ctxPath = instance.contextUri().replace("https://schemalattice.com", "");
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
    tools.body.tools.length === 19 && tools.body.tools.some((t: any) => t.write === true),
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
  check(
    "landing-says-what-is-not-built",
    html.includes("Not built yet") && html.includes("/llms.txt") && html.includes("application/ld+json"),
    "honesty and AI entry points present",
  );
  const llms = await fetch(base + "/llms.txt");
  const llmsBody = await llms.text();
  check(
    "llms-txt-for-ai-readers",
    llms.status === 200 && llmsBody.startsWith("# SchemaLattice") && llmsBody.includes("/skill"),
    `status=${llms.status}`,
  );
  const skillRes = await fetch(base + "/skill");
  const skillText = await skillRes.text();
  check(
    "skill-served",
    skillRes.status === 200 && skillText.includes("# SchemaLattice workflow skill"),
    `status=${skillRes.status}, ${skillText.length} bytes`,
  );
  const builderRes = await fetch(base + "/skill/builder");
  const builderText = await builderRes.text();
  check(
    "builder-brief-served",
    builderRes.status === 200 && builderText.includes("# SchemaLattice builder brief"),
    `status=${builderRes.status}, ${builderText.length} bytes`,
  );
  const cliRes = await fetch(base + "/cli/schemalattice.mjs");
  const cliText = await cliRes.text();
  check(
    "client-served",
    cliRes.status === 200 && cliText.includes("export const CLIENT_VERSION"),
    `status=${cliRes.status}, ${cliText.length} bytes`,
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

  // The GET convenience route must honour ephemeral too — probes and
  // browsers use it, and it once dropped the flag and logged their wording.
  const ephGet = await get(
    "/discover?description=" +
      encodeURIComponent("an unshareable get-route prototype of a sextant calibration") +
      "&ephemeral=true",
  );
  const demandAfterGet = await post("/api/tools/lattice_demand_report", {});
  const getLeaked = JSON.stringify(demandAfterGet.body).includes("get-route prototype");
  check(
    "get-discover-honours-ephemeral",
    ephGet.status === 200 && !getLeaked,
    getLeaked ? "LEAKED" : `status=${ephGet.status}, wording absent`,
  );

  const filtered = await get(
    "/discover?description=" + encodeURIComponent("a human being") + "&context=schemalattice",
  );
  check(
    "get-discover-context-filter",
    filtered.status === 200 &&
      filtered.body.results.length > 0 &&
      filtered.body.results.every((r: { context: { uri: string } }) =>
        r.context.uri.includes("/s/schemalattice@"),
      ) &&
      typeof filtered.body.verdict === "string",
    `status=${filtered.status}, verdict=${filtered.body.verdict}, n=${filtered.body.results?.length}`,
  );

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

  // Each way a key can fail to arrive says which, rather than all of them
  // telling an operator with a blank variable to "register your app".
  const rawPost = async (path: string, body: unknown, authorization: string) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  };
  const emptyKey = await rawPost("/api/tools/lattice_publish_context", contextArgs, "Bearer ");
  check(
    "empty-bearer-says-empty",
    emptyKey.status === 401 && /empty key/.test(emptyKey.body.error.message) && !/register your app/i.test(emptyKey.body.error.details.guidance),
    emptyKey.body.error?.message,
  );
  const malformed = await rawPost("/api/tools/lattice_publish_context", contextArgs, "Token abc");
  check(
    "malformed-header-says-malformed",
    malformed.status === 401 && /Bearer <key>/.test(malformed.body.error.message),
    malformed.body.error?.message,
  );
  check(
    "wrong-key-says-unrecognised",
    /does not match any app/.test(wrongKey.body.error.message),
    wrongKey.body.error?.message,
  );
  check(
    "no-key-says-register",
    /no API key was sent/.test(unauthed.body.error.message) && /lattice_register_app/.test(unauthed.body.error.details.guidance),
    unauthed.body.error?.message,
  );
  const mcpEmpty = await rawPost("/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, "Bearer ");
  check("mcp-empty-bearer-says-empty", mcpEmpty.status === 401 && /empty key/.test(mcpEmpty.body.error.message), mcpEmpty.body.error?.message);

  const authed = await post("/api/tools/lattice_publish_context", contextArgs, API_KEY);
  check(
    "write-with-key-accepted",
    authed.status === 200 && authed.body.published === true,
    authed.body.uri ?? JSON.stringify(authed.body),
  );

  // Finding a context to publish into, with no URI in hand.
  const allContexts = await post("/api/tools/lattice_list_context", {});
  const harbor = allContexts.body.contexts?.find((c: { slug: string }) => c.slug === "harbor-ops");
  check(
    "list-every-context-without-a-uri",
    allContexts.status === 200 && harbor?.uri === authed.body.uri && harbor?.latest === true &&
      allContexts.body.contexts.some((c: { slug: string }) => c.slug === "schemalattice"),
    `n=${allContexts.body.contexts?.length}, harbor-ops latest=${harbor?.latest}`,
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

  // --- distributed access: self-serve keys, capped blast radius ------------
  const reg = {
    slug: "bens-app", name: "Ben's App", unit: "independent",
    owner: "Ben", status: "experiment", concepts: [],
  };
  const selfServe = await post("/api/tools/lattice_register_app", reg);
  const benKey: string = selfServe.body.apiKey;
  check(
    "self-registration-issues-a-key-without-approval",
    selfServe.status === 200 && typeof benKey === "string" && benKey.startsWith("slk_"),
    selfServe.status === 200 ? `tier=${selfServe.body.tier}` : JSON.stringify(selfServe.body),
  );

  const hijack = await post("/api/tools/lattice_register_app", { ...reg, owner: "Somebody Else" });
  check(
    "an-existing-slug-cannot-be-re-registered-by-a-stranger",
    hijack.status === 403 && hijack.body.error.details.latticeCode === "ERR_APP_NOT_YOURS",
    `status=${hijack.status} ${hijack.body.error?.details?.latticeCode ?? ""}`,
  );

  const ownUpdate = await post("/api/tools/lattice_register_app", { ...reg, owner: "Ben R" }, benKey);
  check(
    "an-app-can-update-its-own-registration",
    ownUpdate.status === 200 && ownUpdate.body.created === false && ownUpdate.body.apiKey === undefined,
    `created=${ownUpdate.body.created}, key re-issued=${ownUpdate.body.apiKey !== undefined}`,
  );

  const lowContext = await post(
    "/api/tools/lattice_publish_context",
    { ...contextArgs, slug: "bens-namespace" },
    benKey,
  );
  check(
    "low-tier-cannot-create-a-context",
    lowContext.status === 403 && lowContext.body.error.details.latticeCode === "ERR_TIER_TOO_LOW",
    `status=${lowContext.status} ${lowContext.body.error?.details?.latticeCode ?? ""}`,
  );

  const promote = await post("/api/tools/lattice_set_app_tier", { slug: "bens-app", tier: "contributor" }, benKey);
  check(
    "an-app-cannot-promote-itself",
    promote.status === 403 && promote.body.error.details.latticeCode === "ERR_OPERATOR_ONLY",
    `status=${promote.status} ${promote.body.error?.details?.latticeCode ?? ""}`,
  );

  const promoted = await post("/api/tools/lattice_set_app_tier", { slug: "bens-app", tier: "contributor" }, API_KEY);
  check(
    "the-operator-can-promote",
    promoted.status === 200 && promoted.body.tier === "contributor",
    `tier=${promoted.body.tier}`,
  );

  const nowAllowed = await post(
    "/api/tools/lattice_publish_context",
    { ...contextArgs, slug: "bens-namespace" },
    benKey,
  );
  check(
    "promotion-actually-lifts-the-capability",
    nowAllowed.status === 200 && nowAllowed.body.published === true,
    nowAllowed.body.uri ?? JSON.stringify(nowAllowed.body),
  );

  const reissued = await post("/api/tools/lattice_reissue_app_key", { slug: "bens-app" }, API_KEY);
  const staleKey = await post("/api/tools/lattice_register_app", { ...reg, owner: "Ben" }, benKey);
  check(
    "reissuing-a-key-revokes-the-old-one",
    reissued.status === 200 && reissued.body.apiKey !== benKey && staleKey.status === 403,
    `old key now status=${staleKey.status}`,
  );

  // An app key over MCP must carry the app's own tier, not the operator's.
  // (MCP tool calls once defaulted to the operator principal.)
  const lowKey = reissued.body.apiKey as string;
  const mcpCall = async (key: string, name: string, args: Record<string, unknown>) => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }),
    });
    const text = await r.text();
    const json = JSON.parse(text.includes("data:") ? text.split("data:").pop()!.trim() : text);
    return JSON.parse(json.result.content[0].text);
  };
  await post("/api/tools/lattice_set_app_tier", { slug: "bens-app", tier: "low" }, API_KEY);
  const escalate = await mcpCall(lowKey, "lattice_set_app_tier", { slug: "bens-app", tier: "contributor" });
  check(
    "mcp-carries-the-callers-tier",
    escalate?.error?.details?.latticeCode === "ERR_OPERATOR_ONLY",
    JSON.stringify(escalate).slice(0, 120),
  );
  const mcpContext = await mcpCall(lowKey, "lattice_publish_context", { ...contextArgs, slug: "bens-other-namespace" });
  check(
    "mcp-low-tier-cannot-create-a-context",
    mcpContext?.error?.details?.latticeCode === "ERR_TIER_TOO_LOW",
    JSON.stringify(mcpContext).slice(0, 120),
  );

  const writeEvents = instance.store.db
    .prepare("SELECT actor, COUNT(*) AS n FROM events WHERE kind = 'publish_context' GROUP BY actor")
    .all() as Array<{ actor: string | null; n: number }>;
  check(
    "every-write-names-who-caused-it",
    writeEvents.length > 0 && writeEvents.every((r) => r.actor !== null) &&
      writeEvents.some((r) => r.actor === "app:bens-app") &&
      writeEvents.some((r) => r.actor === "operator"),
    writeEvents.map((r) => `${r.actor}=${r.n}`).join(", "),
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
