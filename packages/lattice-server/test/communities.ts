// Communities (specs/communities-and-sub-lattices.md, tier 1): who may create and change one,
// stewards creating contexts, membership through registration, community-scoped discover and
// demand, and the report and pages. Boots a real server.

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

const API_KEY = "test-operator-key";

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-communities-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const handle = await startHttpServer(instance, { dataDir: tmp, host: "127.0.0.1", port: 0, apiKey: API_KEY });
  const base = `http://127.0.0.1:${handle.port}`;
  const call = async (tool: string, args: unknown, key?: string) => {
    const res = await fetch(`${base}/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(args),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const code = (r: { body: any }) => r.body?.error?.details?.latticeCode ?? r.body?.error?.code;

  // Two apps: one will steward, one will not. Both self-registered, so low tier.
  const register = async (slug: string, extra: Record<string, unknown> = {}, key?: string) =>
    call("lattice_register_app", { slug, name: slug, unit: "Civic", owner: "volunteers", status: "pilot", concepts: [], ...extra }, key);
  const stewardKey = (await register("ward-watch")).body.apiKey as string;
  const otherKey = (await register("home-check")).body.apiKey as string;

  const ctx = await call("lattice_publish_context", {
    slug: "civic-issues", title: "Civic Issues",
    definition: "Problems residents report to a city — potholes, broken streetlights — and how the city answers them.",
  }, API_KEY);
  check("operator-creates-a-context", ctx.status === 200, ctx.body.uri ?? JSON.stringify(ctx.body).slice(0, 100));

  const charter = "Apps, people and open data about New Haven's places, services and government.";
  const byApp = await call("lattice_publish_community", { slug: "new-haven-civic", title: "New Haven civic", charter }, stewardKey);
  check("only-the-operator-creates-a-community", byApp.status === 403 && code(byApp) === "ERR_OPERATOR_ONLY", `${byApp.status} ${code(byApp)}`);

  const created = await call("lattice_publish_community", {
    slug: "new-haven-civic", title: "New Haven civic", charter, contexts: ["civic-issues"],
    jurisdictions: ["US-CT/new-haven"], stewards: ["ward-watch"],
  }, API_KEY);
  check("operator-creates-a-community", created.status === 200 && created.body.created === true &&
    created.body.community.stewards[0] === "ward-watch", JSON.stringify(created.body).slice(0, 120));

  const badCtx = await call("lattice_publish_community", { slug: "x-y", title: "X", charter, contexts: ["no-such-context"] }, API_KEY);
  check("unknown-contexts-refused", badCtx.status !== 200 && code(badCtx) === "ERR_UNKNOWN_CONTEXT", String(code(badCtx)));

  const edit = await call("lattice_publish_community", { slug: "new-haven-civic", charter: `${charter} Stewarded by its builders.` }, stewardKey);
  check("steward-edits-the-charter", edit.status === 200 && edit.body.community.charter.endsWith("builders."), `${edit.status}`);
  const grab = await call("lattice_publish_community", { slug: "new-haven-civic", stewards: ["ward-watch", "home-check"] }, stewardKey);
  check("steward-cannot-change-stewards", grab.status === 403 && code(grab) === "ERR_OPERATOR_ONLY", `${grab.status} ${code(grab)}`);
  const outsider = await call("lattice_publish_community", { slug: "new-haven-civic", title: "Mine now" }, otherKey);
  check("non-steward-cannot-edit", outsider.status === 403 && code(outsider) === "ERR_NOT_STEWARD", `${outsider.status} ${code(outsider)}`);

  // Stewards may create a context inside their community without contributor tier.
  const contextArgs = {
    slug: "street-conditions", title: "Street Conditions",
    definition: "Observations of sidewalks, street trees and lights made by residents and volunteers, with where and when.",
  };
  const noCommunity = await call("lattice_publish_context", contextArgs, stewardKey);
  check("steward-still-needs-the-community-argument", noCommunity.status === 403 && code(noCommunity) === "ERR_TIER_TOO_LOW", String(code(noCommunity)));
  const notSteward = await call("lattice_publish_context", { ...contextArgs, community: "new-haven-civic" }, otherKey);
  check("non-steward-cannot-create-a-community-context", notSteward.status === 403 && code(notSteward) === "ERR_TIER_TOO_LOW", String(code(notSteward)));
  const stewardCtx = await call("lattice_publish_context", { ...contextArgs, community: "new-haven-civic" }, stewardKey);
  const afterCtx = instance.communities.get("new-haven-civic")!;
  check("steward-creates-a-community-context", stewardCtx.status === 200 && afterCtx.contexts.includes("street-conditions"),
    `${stewardCtx.status}; contexts ${afterCtx.contexts.join(",")}`);

  // Membership comes from an app's own registration.
  const unknown = await register("home-check", { communities: ["nowhere"] }, otherKey);
  check("unknown-community-refused-before-registering", unknown.status === 400 && instance.communities.of("home-check").length === 0, `${unknown.status}`);
  const joined = await register("home-check", { communities: ["new-haven-civic"] }, otherKey);
  check("app-joins-through-registration", joined.status === 200 && instance.communities.get("new-haven-civic")!.members.includes("home-check"),
    instance.communities.get("new-haven-civic")!.members.join(","));
  await register("home-check", {}, otherKey);
  check("omitting-communities-keeps-membership", instance.communities.of("home-check").includes("new-haven-civic"), instance.communities.of("home-check").join(","));

  // One concept inside the community, so a scoped search has something to find.
  const sessionId = "sess-communities";
  await call("lattice_discover", { description: "a pothole or broken streetlight a resident reports to the city", sessionId });
  const issue = await call("lattice_publish_concept", {
    contextUri: ctx.body.uri, prefLabel: "Street Issue Report",
    definition: "A problem a resident reports to the city about a street, such as a pothole or a dark streetlight, with where it is and how the city answered.",
    conceptKind: "event", broader: [instance.skeletonUri("event")!], closeMatch: ["wd:Q1580844"], coRefersWith: [], coRefersRationale: "Test fixture.",
    structure: { kind: "entity", fields: [{ name: "location", type: "string" }, { name: "reportedAt", type: "datetime" }] },
    sessionId,
  }, API_KEY);
  check("concept-published-in-the-community", issue.status === 200, issue.body.uri ?? JSON.stringify(issue.body).slice(0, 120));

  // Community-scoped discover, and its unmet searches.
  const scoped = await fetch(`${base}/discover?community=new-haven-civic&description=${encodeURIComponent("a ward boundary polygon with its alder")}`).then((r) => r.json()) as any;
  const civicUris = new Set(instance.communities.contextUris("new-haven-civic"));
  check("discover-searches-only-the-community", Array.isArray(scoped.results) && scoped.results.length > 0 &&
    scoped.results.every((r: any) => civicUris.has(r.context.uri)), `${scoped.results?.length} results, top ${scoped.results?.[0]?.prefLabel}`);
  const badScope = await call("lattice_discover", { description: "anything", community: "nowhere" });
  check("unknown-community-in-discover-refused", badScope.status === 400, `${badScope.status}`);
  await call("lattice_discover", { description: "an unrelated scuba dive log", limit: 3 });
  const demand = await call("lattice_demand_report", { community: "new-haven-civic" });
  const asked = (demand.body.clusters ?? []).map((k: any) => k.representative);
  check("community-demand-counts-its-own-searches", asked.some((q: string) => q.includes("ward boundary")) && !asked.some((q: string) => q.includes("scuba")),
    asked.join(" | "));

  // The report and the pages.
  const report = await call("lattice_community_report", { slug: "new-haven-civic" });
  check("report-has-contexts-apps-and-backlog", report.status === 200 && report.body.contexts.length === 2 &&
    report.body.recentConcepts.some((c: any) => c.prefLabel === "Street Issue Report") &&
    report.body.apps.some((a: any) => a.slug === "home-check") && report.body.unmetSearches.clusters.length >= 1,
    `${report.body.contexts?.length} contexts, ${report.body.apps?.length} apps`);
  const list = await call("lattice_community_report", {});
  check("report-without-slug-lists-communities", list.body.communities?.[0]?.slug === "new-haven-civic", JSON.stringify(list.body).slice(0, 80));
  const page = await fetch(`${base}/community/new-haven-civic`).then(async (r) => ({ status: r.status, text: await r.text() }));
  check("community-page-renders", page.status === 200 && page.text.startsWith("# New Haven civic") && page.text.includes("## Unmet searches"), `${page.status}`);
  const index = await fetch(`${base}/community`).then((r) => r.text());
  const missing = await fetch(`${base}/community/nowhere`);
  check("index-and-missing-pages", index.includes("new-haven-civic") && missing.status === 404, `${missing.status}`);

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
