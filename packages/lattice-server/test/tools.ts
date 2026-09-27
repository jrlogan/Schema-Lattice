// Tool-surface smoke test: the v0.1 tools from specs/mcp-tools.md driven
// through callTool exactly as a transport would drive them, including the
// standard error envelope. Deliberately a trail-stewardship scenario —
// neither civic nor makerspace — so the surface stays organization-neutral.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";
import { clearStatsCache } from "../src/query/stats.ts";

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

/** Surface the envelope when a call that was supposed to succeed did not. */
function note(result: unknown, ok: string): string {
  return isToolError(result) ? `${errCode(result)}: ${result.error.message}` : ok;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-tools-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const sessionId = "test-tools";
  const call = (name: string, args: Record<string, unknown> = {}) =>
    callTool(instance, name, args);

  // --- publish_context -----------------------------------------------
  const ctx = (await call("lattice_publish_context", {
    slug: "trail-ops",
    title: "Trail Operations",
    definition:
      "Vocabulary for the groups that build and maintain footpaths: the segments themselves, the work done on them, and the volunteers who show up.",
  })) as { uri: string; published: boolean };
  check("publish-context", ctx.published === true, `minted ${ctx.uri}`);

  const reserved = await call("lattice_publish_context", {
    slug: "system",
    title: "System",
    definition: "A context that should never be created because the slug is reserved for the lattice itself.",
  });
  check("reserved-slug-rejected", errCode(reserved) === "ERR_RESERVED_SLUG", errCode(reserved));

  const collide = (await call("lattice_publish_context", {
    slug: "trail-ops",
    title: "Trail Ops (second try)",
    definition:
      "A second home for the same vocabulary, which the server should refuse to mint in favour of the incumbent context.",
  })) as { published: boolean; existing?: { uri: string } };
  check(
    "slug-collision-returns-incumbent",
    collide.published === false && collide.existing?.uri === ctx.uri,
    `handed back ${collide.existing?.uri}`,
  );

  // --- discover then publish_concept -----------------------------------
  await call("lattice_discover", {
    description: "a maintained section of footpath between two junctions",
    sessionId,
  });

  const segment = (await call("lattice_publish_concept", {
    contextUri: ctx.uri,
    prefLabel: "Trail Segment",
    definition:
      "A continuous stretch of footpath between two junctions, treated as one unit for maintenance planning, condition reporting, and closure.",
    conceptKind: "place",
    broader: [instance.skeletonUri("location")!],
    closeMatch: ["schema:Place"],
    coRefersWith: [],
    coRefersRationale: "First path-shaped concept in this catalog.",
    structure: {
      kind: "entity",
      fields: [
        { name: "segmentId", type: "string", classification: "public" },
        { name: "lengthMeters", type: "number", classification: "public" },
        { name: "surface", type: "string", classification: "public" },
        { name: "lastInspectedOn", type: "dateTime", classification: "public" },
      ],
    },
    sessionId,
  })) as { uri: string; published: boolean; warnings: unknown[] };
  check("publish-concept", segment.published === true, note(segment, segment.uri));

  const noDiscover = await call("lattice_publish_concept", {
    contextUri: ctx.uri,
    prefLabel: "Orphan Concept",
    definition:
      "A concept published without any prior discover call, which the R2 friction gate must refuse to accept into the catalog.",
    broader: [instance.skeletonUri("thing")!],
    closeMatch: ["schema:Thing"],
    coRefersWith: [],
    coRefersRationale: "Test fixture.",
    sessionId: "never-searched",
  });
  check(
    "publish-without-discover-rejected",
    errCode(noDiscover) === "ERR_NO_PRIOR_DISCOVER",
    errCode(noDiscover),
  );

  const missingParam = await call("lattice_publish_concept", { contextUri: ctx.uri });
  check(
    "missing-parameter-envelope",
    isToolError(missingParam) && missingParam.error.code === "invalid-parameter",
    errCode(missingParam),
  );

  // --- publish_fork ------------------------------------------------------
  await call("lattice_discover", {
    description: "a boardwalk section of trail carried over wetland",
    sessionId,
  });

  const fork = (await call("lattice_publish_fork", {
    parentUri: segment.uri,
    contextUri: ctx.uri,
    prefLabel: "Boardwalk Segment",
    definition:
      "A trail segment carried on an elevated timber structure over wet ground, where the decking itself is the asset that wears out and must be tracked plank by plank.",
    changeset: {
      ops: [
        { op: "rename", from: "surface", to: "deckMaterial" },
        { op: "add", field: "plankCount", type: "integer" },
        { op: "add", field: "loadRatingKg", type: "number" },
      ],
      note: "Boardwalk-specific specialization of a generic trail segment",
    },
    structure: {
      kind: "entity",
      fields: [
        { name: "segmentId", type: "string", classification: "public" },
        { name: "lengthMeters", type: "number", classification: "public" },
        { name: "deckMaterial", type: "string", classification: "public" },
        { name: "lastInspectedOn", type: "dateTime", classification: "public" },
        { name: "plankCount", type: "integer", classification: "public" },
        { name: "loadRatingKg", type: "number", classification: "public" },
      ],
    },
    sessionId,
  })) as { uri: string; upgradable: boolean; forkedFrom: string; warnings: unknown[] };
  check(
    "publish-fork",
    fork.forkedFrom === segment.uri && fork.upgradable === true && fork.warnings.length === 0,
    note(fork, `${fork.uri} upgradable=${fork.upgradable}`),
  );

  const badOp = await call("lattice_publish_fork", {
    parentUri: segment.uri,
    contextUri: ctx.uri,
    prefLabel: "Broken Fork",
    definition:
      "A fork whose changeset renames a field the parent never declared, which changeset validation must catch before anything is written.",
    changeset: { ops: [{ op: "rename", from: "gradient", to: "slope" }] },
    sessionId,
  });
  check(
    "fork-op-on-missing-field-rejected",
    errCode(badOp) === "ERR_CHANGESET_FIELD_MISSING",
    errCode(badOp),
  );

  const badClaim = await call("lattice_publish_fork", {
    parentUri: segment.uri,
    contextUri: ctx.uri,
    prefLabel: "Overclaiming Fork",
    definition:
      "A fork claiming its changeset is upgradable while using an extend op, which the server must recompute and reject as a mismatched claim.",
    changeset: {
      ops: [{ op: "extend", field: "drainageStructures", structure: { kind: "array" } }],
      upgradable: true,
    },
    sessionId,
  });
  check(
    "upgradable-mismatch-rejected",
    errCode(badClaim) === "ERR_CHANGESET_UPGRADABLE_MISMATCH",
    errCode(badClaim),
  );

  await call("lattice_discover", {
    description: "trail drainage structures such as culverts and waterbars",
    sessionId,
  });
  const extendFork = (await call("lattice_publish_fork", {
    parentUri: segment.uri,
    contextUri: ctx.uri,
    prefLabel: "Drained Segment",
    definition:
      "A trail segment carrying its own inventory of drainage structures, each with a type and a clearing schedule, which no parent field can represent.",
    changeset: {
      ops: [
        {
          op: "extend",
          field: "drainageStructures",
          structure: {
            kind: "array",
            itemShape: [
              { field: "kind", type: "string" },
              { field: "clearedOn", type: "dateTime" },
            ],
          },
        },
      ],
    },
    sessionId,
  })) as { upgradable: boolean };
  check(
    "extend-forces-non-upgradable",
    extendFork.upgradable === false,
    `upgradable=${extendFork.upgradable}`,
  );

  const orphanParent = await call("lattice_publish_fork", {
    parentUri: "https://schemalattice.com/c/trail-ops/nothing@000000000000",
    contextUri: ctx.uri,
    prefLabel: "Nowhere Fork",
    definition:
      "A fork of a concept URI that does not resolve, which must come back as a not-found rather than a server error.",
    changeset: { ops: [{ op: "add", field: "x", type: "string" }] },
    sessionId,
  });
  check(
    "unknown-parent-is-not-found",
    isToolError(orphanParent) && orphanParent.error.code === "not-found",
    errCode(orphanParent),
  );

  // --- list_context ------------------------------------------------------
  const listed = (await call("lattice_list_context", { contextUri: ctx.uri })) as {
    totalCount: number;
    concepts: Array<{ prefLabel: string; isTopConcept: boolean }>;
  };
  check(
    "list-context",
    listed.totalCount === 3 && listed.concepts.some((c) => c.prefLabel === "Trail Segment"),
    `${listed.totalCount} concepts: ${listed.concepts.map((c) => c.prefLabel).join(", ")}`,
  );

  // --- resolve and stats -------------------------------------------------
  const resolved = (await call("lattice_resolve", { uri: segment.uri })) as {
    record: { prefLabel: Record<string, string> };
  };
  check("resolve", resolved.record.prefLabel.en === "Trail Segment", segment.uri);

  const stale = await call("lattice_resolve", {
    uri: "https://schemalattice.com/c/trail-ops/ghost@aaaaaaaaaaaa",
  });
  check(
    "resolve-stale-is-not-found",
    isToolError(stale) && stale.error.code === "not-found",
    errCode(stale),
  );

  clearStatsCache();
  const stats = (await call("lattice_stats", { uri: segment.uri })) as {
    stats: { forkCount: number; directChildren: number; totalDescendants: number };
  };
  check(
    "stats-counts-forks",
    stats.stats.forkCount === 2 && stats.stats.totalDescendants === 2,
    `forks=${stats.stats.forkCount} descendants=${stats.stats.totalDescendants}`,
  );

  // Registering an app is the only adoption signal the catalog has.
  await call("lattice_register_app", {
    slug: "trail-log",
    name: "Trail Log",
    unit: "stewardship",
    owner: "trail crew lead",
    status: "pilot",
    concepts: [
      { uri: segment.uri, status: "adopted", shortName: "SEGMENT" },
      { uri: fork.uri, status: "forked", shortName: "BOARDWALK" },
    ],
  });
  clearStatsCache();
  const adopted = (await call("lattice_stats", { uri: segment.uri })) as {
    stats: { adoptionCount: number };
    trending: { adoptionsLast30Days: number };
  };
  check(
    "stats-counts-adoption",
    adopted.stats.adoptionCount === 1 && adopted.trending.adoptionsLast30Days === 1,
    `adoptions=${adopted.stats.adoptionCount} recent=${adopted.trending.adoptionsLast30Days}`,
  );

  const usages = (await call("lattice_list_usages", { conceptUri: segment.uri })) as {
    usages: Array<{ app: string }>;
  };
  check("list-usages", usages.usages[0]?.app === "trail-log", JSON.stringify(usages.usages));

  const catalog = (await call("lattice_stats", {})) as { catalog: { concepts: number } };
  check("catalog-totals", catalog.catalog.concepts > 3, JSON.stringify(catalog.catalog));

  // --- learning loop -----------------------------------------------------
  const anon = (await call("lattice_discover", {
    description: "a berth or mooring space rented at a marina for a season",
  })) as { sessionId: string; results: Array<{ context: { uri: string } }> };
  check(
    "discover-mints-session-id",
    /^sess-[0-9a-f-]{36}$/.test(anon.sessionId),
    anon.sessionId,
  );
  check(
    "governance-excluded-from-discover",
    anon.results.every((r) => !r.context.uri.includes("/s/governance@")),
    `top contexts: ${[...new Set(anon.results.map((r) => r.context.uri.split("/s/")[1]))].join(", ")}`,
  );

  // Second phrasing of the same need, before anything covers it — the
  // demand report should fold both into one cluster.
  await call("lattice_discover", { description: "a berth rented at a marina" });
  const demand = (await call("lattice_demand_report", {})) as {
    unmetQueryCount: number;
    clusters: Array<{ count: number; representative: string; nearestExisting: unknown }>;
  };
  const berthCluster = demand.clusters.find((c) =>
    c.representative.toLowerCase().includes("berth"),
  );
  check(
    "demand-report-clusters-unmet",
    demand.unmetQueryCount > 0 && !!berthCluster && berthCluster.count >= 2,
    `unmet=${demand.unmetQueryCount}, berth cluster count=${berthCluster?.count}`,
  );

  // The server-minted id satisfies R2 at publish time.
  const viaMinted = await call("lattice_publish_concept", {
    contextUri: ctx.uri,
    prefLabel: "Mooring Berth",
    definition:
      "A rentable space at a marina or mooring field where one vessel is kept for a season, with its dimensions and the gear it offers.",
    broader: [instance.skeletonUri("location")!],
    closeMatch: ["schema:Place"],
    coRefersWith: [],
    coRefersRationale: "First berth-shaped concept in this catalog.",
    sessionId: anon.sessionId,
  });
  check(
    "minted-session-satisfies-r2",
    !isToolError(viaMinted),
    note(viaMinted, "published with server-minted sessionId"),
  );

  // And once the concept exists, the same need is met: a repeat query
  // must NOT add to unmet demand.
  await call("lattice_discover", { description: "a berth rented at a marina" });
  const after = (await call("lattice_demand_report", {})) as { unmetQueryCount: number };
  check(
    "published-concept-absorbs-demand",
    after.unmetQueryCount === demand.unmetQueryCount,
    `unmet stayed at ${after.unmetQueryCount} after publishing Mooring Berth`,
  );

  const unknownTool = await call("lattice_nonexistent", {});
  check(
    "unknown-tool-envelope",
    isToolError(unknownTool) && unknownTool.error.code === "not-found",
    errCode(unknownTool),
  );

  console.log(`\n${passed}/${passed + failed} checks passed`);
  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
