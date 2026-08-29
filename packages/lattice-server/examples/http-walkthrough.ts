// Transport walkthrough — the whole checkpoint protocol driven over HTTP
// with nothing but `fetch`, exactly as an external AI client would drive it.
//
// The scenario is a trail-stewardship nonprofit, deliberately neither civic
// nor makerspace: two apps, built months apart by different people, end up
// sharing vocabulary because the second one searched before it invented.
//
// Run: npm run demo:http

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { startHttpServer } from "../src/http/server.ts";

const API_KEY = "demo-write-key";

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-http-demo-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const server = await startHttpServer(instance, {
    dataDir: tmp,
    host: "127.0.0.1",
    port: 0,
    apiKey: API_KEY,
  });
  const base = `http://127.0.0.1:${server.port}`;
  console.log(`lattice up at ${base}\n`);

  const call = async (tool: string, args: unknown, key = API_KEY) => {
    const res = await fetch(`${base}/api/tools/${tool}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(args),
    });
    return res.json() as Promise<any>;
  };
  const get = async (path: string) =>
    (await fetch(base + path)).json() as Promise<any>;

  const showResults = (label: string, results: any[]) => {
    console.log(`  ${label}`);
    for (const r of results) {
      console.log(
        `    ${r.similarity.toFixed(3)}  ${r.prefLabel.padEnd(18)} ` +
          `adopted by ${r.adoptionCount}, forked ${r.forkCount}×`,
      );
    }
  };

  // ================================================================
  console.log("── App 1: the volunteer coordinator's scheduler ──\n");

  // Checkpoint 1A — search before inventing anything.
  const first = await get(
    "/discover?description=a+scheduled+outing+where+volunteers+do+trail+maintenance&limit=3&sessionId=app-1",
  );
  showResults("discover →", first.results);
  console.log(
    `    nothing above 0.55 — the protocol says originate\n` +
      `    refinement offered: ${first.suggestions.refinements[0]}\n`,
  );

  // Checkpoint 2A pre-step — a domain-generic home, not an app-specific one.
  const ctx = await call("lattice_publish_context", {
    slug: "trail-ops",
    title: "Trail Operations",
    definition:
      "Vocabulary for the groups that build and maintain footpaths: the segments themselves, the work parties that maintain them, and the volunteers who turn up.",
  });
  console.log(`  publish_context → ${ctx.uri}`);

  const workParty = await call("lattice_publish_concept", {
    contextUri: ctx.uri,
    sessionId: "app-1",
    prefLabel: "Work Party",
    definition:
      "A scheduled outing where a crew of volunteers gathers at a meeting point to carry out maintenance tasks on a stretch of footpath under a leader who signs them in and out.",
    conceptKind: "event",
    broader: [instance.skeletonUri("activity")!],
    closeMatch: ["schema:Event"],
    coRefersWith: [],
    coRefersRationale:
      "No concept in this catalog yet describes an organized volunteer maintenance outing.",
    structure: {
      kind: "entity",
      fields: [
        { name: "scheduledFor", type: "dateTime", classification: "public" },
        { name: "meetingPoint", type: "string", classification: "public" },
        { name: "leader", type: "string", classification: "personal-contact" },
        { name: "attendees", type: "reference[]", classification: "personal-contact" },
        { name: "taskSummary", type: "string", classification: "public" },
      ],
    },
  });
  console.log(`  publish_concept → ${workParty.uri}\n`);

  await call("lattice_register_app", {
    slug: "trail-crew",
    name: "Trail Crew Scheduler",
    unit: "stewardship",
    owner: "volunteer coordinator",
    status: "production",
    concepts: [{ uri: workParty.uri, status: "originated", shortName: "WORK_PARTY" }],
  });
  await call("lattice_record_attestation", {
    app: "trail-crew",
    gate: "privacy-review",
    result: "pass",
    performedBy: "privacy lead",
    performedOn: new Date().toISOString().slice(0, 10),
  });
  console.log("  registered trail-crew, privacy-review attested\n");

  // ================================================================
  console.log("── App 2, months later: the safety officer's saw log ──\n");

  const second = await get(
    "/discover?description=an+organized+session+where+a+crew+clears+brush+from+a+path&limit=3&sessionId=app-2",
  );
  showResults("discover →", second.results);
  // Bands are calibrated to bge-small-en-v1.5 (specs/ai-checkpoints.md
   // § "Threshold calibration"): adopt ≥0.85, fork 0.65–0.85,
   // distant 0.55–0.65, no match below 0.55.
  const top = second.results[0];
  const band =
    top.similarity >= 0.85
      ? "adopt as-is"
      : top.similarity >= 0.65
        ? "fork it"
        : top.similarity >= 0.55
          ? "distant — resolve it and judge by hand"
          : "no match, originate";
  console.log(
    `    top candidate at ${top.similarity.toFixed(3)} → ${band}.\n` +
      `    Either way the AI resolves "${top.prefLabel}" and reads it before\n` +
      `    deciding; here the fields are close enough to build on.\n`,
  );

  const fork = await call("lattice_publish_fork", {
    parentUri: workParty.uri,
    contextUri: ctx.uri,
    sessionId: "app-2",
    prefLabel: "Chainsaw Work Party",
    definition:
      "A maintenance outing where power saws are used, so every crew member present must hold a current certification and the outing carries its own incident log.",
    changeset: {
      ops: [
        { op: "add", field: "requiredCertification", type: "string" },
        { op: "add", field: "incidentLog", type: "string" },
        { op: "rename", from: "taskSummary", to: "cuttingPlan" },
      ],
      note: "Certification and incident tracking for powered-tool outings",
    },
    structure: {
      kind: "entity",
      fields: [
        { name: "scheduledFor", type: "dateTime", classification: "public" },
        { name: "meetingPoint", type: "string", classification: "public" },
        { name: "leader", type: "string", classification: "personal-contact" },
        { name: "attendees", type: "reference[]", classification: "personal-contact" },
        { name: "cuttingPlan", type: "string", classification: "public" },
        { name: "requiredCertification", type: "string", classification: "internal" },
        { name: "incidentLog", type: "string", classification: "personal-health" },
      ],
    },
  });
  console.log(
    `  publish_fork → ${fork.uri}\n` +
      `    upgradable=${fork.upgradable} (every op maps to a Cambria lens op,\n` +
      `    so v0.2 can translate between the two apps automatically)\n`,
  );

  await call("lattice_register_app", {
    slug: "saw-log",
    name: "Saw Log",
    unit: "safety",
    owner: "safety officer",
    status: "pilot",
    concepts: [
      { uri: fork.uri, status: "forked", shortName: "SAW_PARTY" },
      { uri: workParty.uri, status: "adopted", shortName: "WORK_PARTY" },
    ],
  });

  // ================================================================
  console.log("── What the program owner sees ──\n");

  const portfolio = await call("lattice_portfolio_report", {});
  for (const app of portfolio.apps) {
    console.log(
      `  ${app.slug.padEnd(12)} ${app.unit.padEnd(12)} ` +
        `score ${String(app.score.overall).padStart(3)}  ` +
        `most sensitive: ${app.profile.maxClass}  ` +
        `attestations: ${app.attestations.length}`,
    );
  }
  console.log();
  for (const finding of portfolio.findings) {
    console.log(`  [${finding.kind}]`);
    console.log(`    ${finding.detail}\n`);
  }

  const usages = await call("lattice_list_usages", { conceptUri: workParty.uri });
  console.log(
    `  list_usages on Work Party → ` +
      usages.usages.map((u: any) => `${u.app} (${u.unit}, ${u.status})`).join(", "),
  );

  // ================================================================
  console.log("\n── The write gate ──\n");
  const refused = await fetch(`${base}/api/tools/lattice_publish_context`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "x", title: "x", definition: "x" }),
  });
  console.log(`  publish without a key → HTTP ${refused.status}`);
  const readOk = await fetch(`${base}/discover?description=anything`);
  console.log(`  read without a key    → HTTP ${readOk.status}`);

  await server.close();
  instance.close();
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
