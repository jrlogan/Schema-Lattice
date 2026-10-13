// Versions (specs/uri-scheme.md § Immutability): an edit is a new record whose
// previousVersion names the record it replaces. Search shows only the latest,
// the old URI keeps resolving and points forward, lineage stays one line, and
// only the original publisher or the operator may extend it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";
import { OPERATOR, type Principal } from "../src/server/principals.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}
const code = (r: unknown) => (isToolError(r) ? ((r.error.details as { latticeCode?: string })?.latticeCode ?? r.error.code) : "ok");

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-versions-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const appA: Principal = { app: "app-a", tier: "contributor", anonymous: false };
  const appB: Principal = { app: "app-b", tier: "contributor", anonymous: false };
  const call = (name: string, args: Record<string, unknown>, who: Principal = OPERATOR) => callTool(instance, name, args, who) as Promise<any>;

  const sessionId = "sess-versions";
  await call("lattice_discover", { description: "a tool lent out from a shared workshop", sessionId });
  const narrow = await call("lattice_publish_context", { slug: "workshop-ops", title: "Workshop ops", definition: "Test fixture: the vocabulary of one kind of shared workshop, filed too narrowly." });
  const broad = await call("lattice_publish_context", { slug: "shared-facilities", title: "Shared facilities", definition: "Test fixture: the same vocabulary, filed where any shared facility can find it." });
  const concept = (label: string, definition: string, contextUri: string, extra: Record<string, unknown> = {}) => ({
    contextUri, prefLabel: label, definition, conceptKind: "event",
    broader: [instance.skeletonUri("event")!], closeMatch: ["wd:Q1580844"], coRefersWith: [], coRefersRationale: "Test fixture.",
    structure: { kind: "entity", fields: [{ name: "borrower", type: "reference" }, { name: "dueAt", type: "datetime" }] },
    sessionId, ...extra,
  });

  const v1 = await call("lattice_publish_concept", concept("Workshop Tool Loan",
    "A borrowing of a tool to take away from a members' workshop, with who borrowed it and when it is due back.", narrow.uri), appA);
  check("v1-published", !isToolError(v1), code(v1));

  const v2 = await call("lattice_publish_concept", concept("Tool Loan",
    "A borrowing of a shared item to take away from any lending facility, such as a tool library or community workshop, with who borrowed it and when it is due back.",
    broad.uri, { previousVersion: v1.uri }), appA);
  check("v2-new-version-in-broader-context", !isToolError(v2) && v2.uri.includes("/c/shared-facilities/"), code(v2));
  check("v2-not-warned-as-duplicate-of-v1", !(v2.warnings ?? []).some((w: { candidateUri?: string }) => w.candidateUri === v1.uri));

  const old = await call("lattice_resolve", { uri: v1.uri });
  check("old-resolves-and-points-forward", old.supersededBy === v2.uri && !!old.record, JSON.stringify(old.supersededBy));
  const cur = await call("lattice_resolve", { uri: v2.uri });
  check("latest-has-no-forward-pointer", cur.supersededBy === undefined);
  check("record-carries-previous-version", cur.record.previousVersion === v1.uri);

  const found = await call("lattice_discover", { description: "borrowing a tool from a workshop, due back later", sessionId });
  check("search-shows-only-latest", found.results.some((r: { uri: string }) => r.uri === v2.uri) && !found.results.some((r: { uri: string }) => r.uri === v1.uri));

  const stranger = await call("lattice_publish_concept", concept("Lending Record",
    "A stranger's attempt to replace someone else's concept with their own wording of a tool borrowing.", broad.uri, { previousVersion: v2.uri, conceptSlug: "lending-record" }), appB);
  check("only-publisher-may-version", code(stranger) === "ERR_NOT_YOUR_CONCEPT", code(stranger));

  const branch = await call("lattice_publish_concept", concept("Tool Loan Again",
    "A second attempt to replace the first version, which already has a newer version and so cannot branch.", broad.uri, { previousVersion: v1.uri, conceptSlug: "tool-loan-again" }), appA);
  check("no-branching-versions", code(branch) === "ERR_ALREADY_SUPERSEDED", code(branch));

  const unknown = await call("lattice_publish_concept", concept("Ghost Loan",
    "A version of a concept that does not exist, which must be refused rather than silently published.", broad.uri, { previousVersion: "https://schemalattice.com/c/nope/nope@000000000000" }), appA);
  check("unknown-previous-refused", code(unknown) === "ERR_UNKNOWN_PREVIOUS_VERSION", code(unknown));

  const v3 = await call("lattice_publish_concept", concept("Tool Loan",
    "A borrowing of a shared item to take away from any lending facility, recorded with who borrowed it, when it is due back and in what condition it returned.",
    broad.uri, { previousVersion: v2.uri }), OPERATOR);
  check("operator-may-version", !isToolError(v3), code(v3));
  const first = await call("lattice_resolve", { uri: v1.uri });
  check("chain-resolves-to-latest", first.supersededBy === v3.uri, first.supersededBy);

  // A fork can be versioned too.
  const f1 = await call("lattice_publish_fork", {
    parentUri: v3.uri, contextUri: broad.uri, prefLabel: "Kit Loan",
    definition: "A borrowing of a kit of several shared items lent together, with its parts listed so the return can be checked.",
    changeset: { ops: [{ op: "add", field: "parts", type: "array", required: false }] },
    structure: { kind: "entity", fields: [{ name: "borrower", type: "reference" }, { name: "dueAt", type: "datetime" }, { name: "parts", type: "array" }] },
    sessionId,
  }, appA);
  const f2 = await call("lattice_publish_fork", {
    parentUri: v3.uri, contextUri: broad.uri, prefLabel: "Kit Loan", conceptSlug: "kit-loan",
    definition: "A borrowing of a kit of several shared items lent and returned together, with its parts listed so the return can be checked off.",
    changeset: { ops: [{ op: "add", field: "parts", type: "array", required: false }] },
    structure: { kind: "entity", fields: [{ name: "borrower", type: "reference" }, { name: "dueAt", type: "datetime" }, { name: "parts", type: "array" }] },
    sessionId, previousVersion: f1.uri,
  }, appA);
  check("fork-versioned", !isToolError(f1) && !isToolError(f2) && (await call("lattice_resolve", { uri: f1.uri })).supersededBy === f2.uri, code(f2));

  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
