// Lifecycles, field invariants, capture provenance, the weak-match
// advisory, and lattice_compare (specs/lifecycle-and-provenance.md).
// The scenario is a watering programme — a recurring job with photo
// evidence — so the vocabulary is exercised outside civic reporting.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, note: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
  ok ? passed++ : failed++;
}

function errCode(result: unknown): string {
  if (!isToolError(result)) return "<no error>";
  const details = (result.error.details ?? {}) as { latticeCode?: string };
  return details.latticeCode ?? result.error.code;
}

type Warning = { kind: string; message: string };

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-lifecycle-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const sessionId = "test-lifecycle";
  const call = (name: string, args: Record<string, unknown>) => callTool(instance, name, args);

  const ctx = (await call("lattice_publish_context", {
    slug: "watering",
    title: "Watering Programmes",
    definition:
      "Vocabulary for groups that keep new plantings and stressed trees alive through dry spells: the plantings, the visits, and the evidence each visit happened.",
  })) as { uri: string };
  await call("lattice_discover", { description: "a scheduled visit to water a young tree", sessionId });

  const base = {
    contextUri: ctx.uri,
    definition:
      "One trip by a volunteer to give a young planting a deep soak, recorded with when it happened, which planting it was, and a photo taken on the spot.",
    conceptKind: "event",
    broader: [instance.skeletonUri("event")!],
    closeMatch: ["schema:Event"],
    coRefersWith: [],
    coRefersRationale: "Test scenario; no other perspective exists in a fresh instance.",
    sessionId,
  };
  let n = 0;
  const publish = (structure: unknown, extra: Record<string, unknown> = {}) =>
    call("lattice_publish_concept", {
      ...base,
      prefLabel: `Watering Visit ${++n}`,
      conceptSlug: `watering-visit-${n}`,
      structure,
      ...extra,
    });

  const lifecycle = {
    field: "status",
    initial: "planned",
    states: [{ name: "planned" }, { name: "done", terminal: true }, { name: "skipped", terminal: true }],
    transitions: [
      { from: "planned", to: "done", on: "visit.logged" },
      { from: "planned", to: "skipped", on: "rain.recorded" },
    ],
  };
  const fields = [
    { name: "plantingId", type: "reference" },
    { name: "visitedAt", type: "dateTime", provenance: "device-captured" },
    { name: "photo", type: "binary", provenance: "attested-capture", classification: "public" },
    { name: "gallons", type: "number", immutableFrom: "done" },
    { name: "status", type: "string" },
  ];

  // --- valid shapes ----------------------------------------------------
  const ok = (await publish({ kind: "event", fields, lifecycle })) as { uri: string; warnings: Warning[] };
  check("valid-lifecycle-and-provenance", !isToolError(ok) && ok.warnings.length === 0, isToolError(ok) ? errCode(ok) : ok.uri);

  const byUri = (await publish({
    kind: "event",
    fields: [{ name: "photo", type: "binary", provenance: instance.governanceUri("uploaded") }],
  })) as { uri: string };
  check("provenance-by-uri", !isToolError(byUri), isToolError(byUri) ? errCode(byUri) : "accepted");

  // --- refusals --------------------------------------------------------
  const badProv = await publish({ kind: "event", fields: [{ name: "photo", type: "binary", provenance: "sealed" }] });
  check("unknown-provenance-refused", errCode(badProv) === "ERR_UNKNOWN_PROVENANCE", errCode(badProv));

  const sensitivityAsProv = await publish({ kind: "event", fields: [{ name: "photo", type: "binary", provenance: "public" }] });
  check("data-class-is-not-provenance", errCode(sensitivityAsProv) === "ERR_UNKNOWN_PROVENANCE", errCode(sensitivityAsProv));

  const provAsClass = await publish({ kind: "event", fields: [{ name: "photo", type: "binary", classification: "uploaded" }] });
  check("provenance-is-not-a-data-class", errCode(provAsClass) === "ERR_UNKNOWN_CLASSIFICATION", errCode(provAsClass));

  const badInitial = await publish({ kind: "event", fields, lifecycle: { ...lifecycle, initial: "draft" } });
  check("unknown-initial-refused", errCode(badInitial) === "ERR_LIFECYCLE_INVALID", errCode(badInitial));

  const badEdge = await publish({
    kind: "event",
    fields,
    lifecycle: { ...lifecycle, transitions: [{ from: "planned", to: "finished" }] },
  });
  check("unknown-transition-state-refused", errCode(badEdge) === "ERR_LIFECYCLE_INVALID", errCode(badEdge));

  const dupState = await publish({
    kind: "event",
    fields,
    lifecycle: { ...lifecycle, states: [...lifecycle.states, { name: "done" }] },
  });
  check("duplicate-state-refused", errCode(dupState) === "ERR_LIFECYCLE_INVALID", errCode(dupState));

  const badField = await publish({ kind: "event", fields, lifecycle: { ...lifecycle, field: "state" } });
  check("lifecycle-field-must-exist", errCode(badField) === "ERR_LIFECYCLE_INVALID", errCode(badField));

  const frozenNoLc = await publish({ kind: "event", fields: [{ name: "gallons", type: "number", immutableFrom: "done" }] });
  check("immutable-needs-lifecycle", errCode(frozenNoLc) === "ERR_IMMUTABLE_FROM_UNKNOWN_STATE", errCode(frozenNoLc));

  const frozenBadState = await publish({
    kind: "event",
    fields: fields.map((f) => (f.name === "gallons" ? { ...f, immutableFrom: "closed" } : f)),
    lifecycle,
  });
  check("immutable-state-must-exist", errCode(frozenBadState) === "ERR_IMMUTABLE_FROM_UNKNOWN_STATE", errCode(frozenBadState));

  // --- advisories --------------------------------------------------------
  const odd = (await publish({
    kind: "event",
    fields,
    lifecycle: {
      ...lifecycle,
      states: [...lifecycle.states, { name: "orphan" }],
      transitions: [...lifecycle.transitions, { from: "done", to: "planned" }],
    },
  })) as { warnings: Warning[] };
  const kinds = isToolError(odd) ? [] : odd.warnings.map((w) => w.kind);
  check(
    "lifecycle-advisories",
    kinds.includes("lifecycle-unreachable-state") && kinds.includes("lifecycle-terminal-exit"),
    kinds.join(", ") || errCode(odd),
  );

  const generic = (await publish({ kind: "event", fields, lifecycle }, { closeMatch: ["schema:Thing"] })) as { warnings: Warning[] };
  check(
    "weak-external-match-advisory",
    !isToolError(generic) && generic.warnings.some((w) => w.kind === "weak-external-match"),
    isToolError(generic) ? errCode(generic) : generic.warnings.map((w) => w.kind).join(", "),
  );
  const mixed = (await publish({ kind: "event", fields, lifecycle }, { closeMatch: ["schema:Thing", "schema:Event"] })) as { warnings: Warning[] };
  check(
    "specific-match-clears-advisory",
    !isToolError(mixed) && !mixed.warnings.some((w) => w.kind === "weak-external-match"),
    isToolError(mixed) ? errCode(mixed) : "no advisory",
  );

  // --- fork + compare --------------------------------------------------
  const fork = (await call("lattice_publish_fork", {
    parentUri: ok.uri,
    contextUri: ctx.uri,
    prefLabel: "Deep Watering Visit",
    definition:
      "A watering trip for a stressed established tree rather than a new planting, where the amount given is measured and the soil checked before and after.",
    structure: {
      kind: "event",
      fields: [
        { name: "treeId", type: "reference" },
        { name: "visitedAt", type: "dateTime", provenance: "self-reported" },
        { name: "photo", type: "binary", provenance: "attested-capture", classification: "public" },
        { name: "gallons", type: "number", immutableFrom: "done" },
        { name: "status", type: "string" },
        { name: "soilMoisture", type: "number" },
      ],
      lifecycle: { ...lifecycle, states: [{ name: "planned" }, { name: "done", terminal: true }], transitions: [lifecycle.transitions[0]] },
    },
    changeset: {
      ops: [
        { op: "rename", from: "plantingId", to: "treeId" },
        { op: "add", field: "soilMoisture", type: "number" },
      ],
    },
    sessionId,
  })) as { uri: string; warnings: Warning[] };
  const semantic = isToolError(fork) ? undefined : fork.warnings.find((w) => w.kind === "semantic-change-outside-changeset");
  check(
    "fork-names-semantic-changes",
    !!semantic && semantic.message.includes("visitedAt (provenance)") && semantic.message.includes("changes the lifecycle"),
    semantic?.message ?? errCode(fork),
  );

  const cmp = (await call("lattice_compare", { a: ok.uri, b: fork.uri })) as {
    relation: { kind: string };
    fields: Array<{ change: string; a?: { name: string }; b?: { name: string }; differences: string[] }>;
    lifecycle: { statesOnlyA: string[] } | null;
    summary: string[];
    table: string;
  };
  check("compare-relation", !isToolError(cmp) && cmp.relation.kind === "b-forks-a", isToolError(cmp) ? errCode(cmp) : cmp.relation.kind);
  const renamed = cmp.fields?.find((r) => r.change === "renamed");
  check("compare-pairs-renames", renamed?.a?.name === "plantingId" && renamed?.b?.name === "treeId", JSON.stringify(renamed));
  const prov = cmp.fields?.find((r) => r.b?.name === "visitedAt");
  check("compare-provenance-diff", prov?.change === "changed" && prov.differences.includes("provenance"), JSON.stringify(prov));
  check(
    "compare-lifecycle-diff",
    JSON.stringify(cmp.lifecycle?.statesOnlyA) === JSON.stringify(["skipped"]),
    JSON.stringify(cmp.lifecycle?.statesOnlyA),
  );
  check(
    "compare-table",
    cmp.table?.includes("| plantingId → treeId |") && cmp.summary?.length >= 3,
    `${cmp.summary?.length} summary lines`,
  );

  const reversed = (await call("lattice_compare", { a: fork.uri, b: ok.uri })) as {
    relation: { kind: string };
    fields: Array<{ change: string }>;
  };
  check(
    "compare-reversed",
    reversed.relation?.kind === "a-forks-b" && reversed.fields.filter((r) => r.change === "renamed").length === 1,
    reversed.relation?.kind,
  );

  const missing = await call("lattice_compare", { a: ok.uri, b: `${ok.uri.slice(0, -4)}0000` });
  check("compare-unknown-uri", errCode(missing) === "not-found", errCode(missing));

  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
