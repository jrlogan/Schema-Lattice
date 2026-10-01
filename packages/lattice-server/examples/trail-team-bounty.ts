// Trail Team × PlacePrize pilot — can the lattice carry a real
// two-system integration contract?
//
// Trail Team (volunteer trail stewardship) is negotiating a bounty
// integration with PlacePrize (a photo-verified prize service). This
// script replays what a builder would try against a private instance:
//
//   1. Import the live civic Issue Report concept (read-only fetch).
//   2. Discover it from a trail-steward's description of an issue.
//   3. Fork it into a Trail Issue, with a lifecycle and photo provenance.
//   4. Originate a Bounty, which nothing in the catalog covers.
//   5. Compare the fork with its parent: the readable diff two
//      negotiating parties actually need.
//
// Nothing is published to schemalattice.com: the parent is fetched read-only
// and everything else lands in a throwaway local instance.
// Run with `npm run demo:trail-team`.
//
// See examples/trail-team-bounty-pilot.md in the repo root for findings.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { embeddingText } from "../src/publish/publish.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";
import type { ConceptRecord, ContextRecord } from "../src/hashing/types.ts";

const LIVE = "https://schemalattice.com";
const PARENT_CONTEXT = `${LIVE}/s/civic-issue-reporting@bde775164c09`;
const PARENT = `${LIVE}/c/civic-issue-reporting/issue-report@6ab5cb338457`;

async function fetchRecord<T>(uri: string): Promise<T> {
  const res = await fetch(uri, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${uri} → ${res.status}`);
  const body = (await res.json()) as { record: T };
  return body.record;
}

function hashOf(uri: string): string {
  return uri.slice(uri.lastIndexOf("@") + 1);
}

function show(label: string, value: unknown) {
  console.log(`\n── ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-trail-team-"));
  const lattice = await LatticeInstance.create({ dataDir: tmp });
  const call = async (name: string, args: Record<string, unknown>) => {
    const out = await callTool(lattice, name, args);
    if (isToolError(out)) {
      show(`${name} refused`, out.error);
      return null;
    }
    return out as Record<string, unknown>;
  };
  const sessionId = "trail-team-pilot";

  // 1. Import the parent exactly as published (same URIs, same hashes).
  const ctx = await fetchRecord<ContextRecord>(PARENT_CONTEXT);
  lattice.store.insertContext({
    uri: PARENT_CONTEXT,
    slug: "civic-issue-reporting",
    hash: hashOf(PARENT_CONTEXT),
    record: { ...ctx, uri: PARENT_CONTEXT },
  });
  const parent = await fetchRecord<ConceptRecord>(PARENT);
  lattice.store.insertConcept({
    uri: PARENT,
    contextSlug: "civic-issue-reporting",
    conceptSlug: "issue-report",
    hash: hashOf(PARENT),
    record: { ...parent, uri: PARENT },
  });
  const [vec] = await lattice.embedder.embed([embeddingText(parent)]);
  lattice.vectors.add(PARENT, vec);
  console.log(`imported ${PARENT}`);
  console.log(`  parent closeMatch: ${JSON.stringify(parent.closeMatch)}`);

  // 2. Discover from the steward's own words.
  const found = await call("lattice_discover", {
    description:
      "a problem a volunteer noticed on a trail, such as litter, a dry tree or invasive plants, pinned to a spot with photos and tracked until resolved",
    sessionId,
  });
  const top = (found?.results as Array<Record<string, unknown>> | undefined)?.[0];
  show("discover: trail issue", { verdict: found?.verdict, top: top?.prefLabel, similarity: top?.similarity });

  const bountyFound = await call("lattice_discover", {
    description:
      "a cash prize pooled by donors and paid to whoever completes a defined task, once photo proof is judged against a written standard",
    sessionId,
  });
  const btop = (bountyFound?.results as Array<Record<string, unknown>> | undefined)?.[0];
  show("discover: bounty", { verdict: bountyFound?.verdict, top: btop?.prefLabel, similarity: btop?.similarity });

  // A home for Trail Team's vocabulary.
  const home = await call("lattice_publish_context", {
    slug: "trail-stewardship",
    title: "Trail Stewardship",
    definition:
      "Vocabulary for volunteer groups that care for trails and greenways: the problems they find, the work days they run, and the outside services that fund or verify that work.",
  });
  const homeUri = (home?.uri ?? (home?.existing as { uri: string } | undefined)?.uri) as string;

  // 3. Fork Issue Report into a Trail Issue.
  const trailIssueStructure = {
    kind: "entity",
    fields: [
      { name: "latitude", type: "number", classification: "public" },
      { name: "longitude", type: "number", classification: "public" },
      { name: "category", type: "reference", classification: "public" },
      { name: "title", type: "string", classification: "public" },
      { name: "detail", type: "string", classification: "public" },
      { name: "beforePhotos", type: "binary[]", classification: "public", provenance: "device-captured", vouchedBy: "organizer" },
      { name: "afterPhotos", type: "binary[]", classification: "public", provenance: "attested-capture" },
      { name: "status", type: "string", classification: "public" },
      { name: "reporter", type: "reference", classification: "internal" },
      { name: "anonymous", type: "boolean", classification: "public" },
      { name: "created", type: "dateTime", classification: "public" },
      { name: "siteId", type: "reference", classification: "public" },
      { name: "segmentIds", type: "reference[]", classification: "public" },
      { name: "resolutionNote", type: "string", classification: "public" },
      { name: "workLog", type: "array", classification: "internal" },
    ],
    lifecycle: {
      field: "status",
      initial: "open",
      states: [{ name: "open" }, { name: "in-progress" }, { name: "monitoring" }, { name: "resolved", terminal: true }],
      transitions: [
        { from: "open", to: "in-progress", on: "work-started" },
        { from: "in-progress", to: "monitoring", on: "regrowth-expected" },
        { from: "in-progress", to: "resolved", on: "work-verified" },
        { from: "monitoring", to: "in-progress", on: "regrowth-found" },
        { from: "monitoring", to: "resolved", on: "season-closed" },
      ],
    },
  };

  const fork = await call("lattice_publish_fork", {
    parentUri: PARENT,
    contextUri: homeUri,
    prefLabel: "Trail Issue",
    definition:
      "A problem on a trail or greenway spotted by a volunteer — litter, a struggling tree, an invasive patch — pinned to a segment, documented with before and after photos, and worked through repeated rounds until a steward resolves it.",
    structure: trailIssueStructure,
    changeset: {
      ops: [
        { op: "remove", field: "postcode" },
        { op: "remove", field: "bodies" },
        { op: "rename", from: "state", to: "status" },
        { op: "rename", from: "photo", to: "beforePhotos" },
        { op: "wrap", field: "beforePhotos" },
        { op: "add", field: "afterPhotos", type: "binary[]" },
        { op: "add", field: "siteId", type: "reference" },
        { op: "add", field: "segmentIds", type: "reference[]" },
        { op: "add", field: "resolutionNote", type: "string" },
        { op: "extend", field: "workLog", structure: { kind: "array", itemShape: [
          { field: "date", type: "date" },
          { field: "notes", type: "string" },
          { field: "beforePhotos", type: "binary[]" },
          { field: "afterPhotos", type: "binary[]" },
        ] } },
      ],
      note: "Trail stewardship: segments instead of postcodes and civic bodies; recurring work rounds; separate before and after evidence.",
    },
    sessionId,
  });
  show("publish_fork: Trail Issue", fork);

  // 4. Originate the Bounty — nothing in the catalog covers it.
  const bounty = await call("lattice_publish_concept", {
    contextUri: homeUri,
    prefLabel: "Bounty",
    definition:
      "A donor-funded prize attached to one trail problem, paid to whoever completes the work once their sealed photo proof is judged against a written done-spec that is frozen when the pool opens.",
    conceptKind: "workflow",
    broader: [lattice.skeletonUri("workflow")!],
    closeMatch: ["schema:MonetaryGrant"],
    coRefersWith: [],
    coRefersRationale:
      "No concept in the catalog describes an outcome-paid prize; the nearest results were public-procurement awards.",
    structure: {
      kind: "workflow",
      fields: [
        { name: "issue", type: "reference", classification: "public" },
        { name: "doneSpec", type: "string", classification: "public", immutableFrom: "open" },
        { name: "beforePhotos", type: "binary[]", classification: "public", provenance: "device-captured", vouchedBy: "organizer" },
        { name: "poolAmount", type: "number", unit: "USD", classification: "public" },
        { name: "provider", type: "string", classification: "public" },
        { name: "claimUrl", type: "string", classification: "public" },
        { name: "verdict", type: "string", classification: "public" },
        { name: "recordUrl", type: "string", classification: "public" },
        { name: "payee", type: "reference", classification: "personal-financial" },
        { name: "status", type: "string", classification: "public" },
      ],
      lifecycle: {
        field: "status",
        initial: "draft",
        states: [
          { name: "draft" }, { name: "open" }, { name: "claimed" }, { name: "under-review" },
          { name: "paid", terminal: true }, { name: "expired", terminal: true },
        ],
        transitions: [
          { from: "draft", to: "open", on: "challenge.opened" },
          { from: "open", to: "claimed", on: "claim.started" },
          { from: "claimed", to: "under-review", on: "submission.received" },
          { from: "under-review", to: "open", on: "verdict.failed" },
          { from: "under-review", to: "paid", on: "payout.sent" },
          { from: "open", to: "expired", on: "challenge.expired" },
        ],
      },
    },
    sessionId,
  });
  show("publish_concept: Bounty", bounty);

  // 5. The readable diff between parent and fork.
  if (fork?.uri) {
    const cmp = await call("lattice_compare", { a: PARENT, b: fork.uri });
    if (cmp) {
      console.log("\n── compare: Issue Report vs Trail Issue");
      for (const line of cmp.summary as string[]) console.log(`  ${line}`);
      console.log(`\n${cmp.table}`);
    }
  }

  // Typos should not pass silently, and a catch-all external match
  // should be flagged even though it is allowed.
  const visit = (structure: unknown, closeMatch = ["schema:Thing"]) =>
    call("lattice_publish_concept", {
      contextUri: homeUri,
      prefLabel: "Watering Visit",
      definition:
        "One trip by a volunteer to give a new planting or a stressed tree a deep watering, recorded with the time, the place and a photo taken during the visit.",
      conceptKind: "event",
      broader: [lattice.skeletonUri("event")!],
      closeMatch,
      coRefersWith: [],
      coRefersRationale: "Experiment: checking how typos and catch-all matches are handled.",
      structure,
      sessionId,
    });
  show("Watering Visit, provenance typo", await visit({
    kind: "event",
    fields: [{ name: "visitedAt", type: "dateTime" }, { name: "photo", type: "binary", provenance: "seald-capture" }],
  }));
  show("Watering Visit, lifecycle typo", await visit({
    kind: "event",
    fields: [{ name: "visitedAt", type: "dateTime" }, { name: "status", type: "string" }],
    lifecycle: { field: "status", initial: "planned", states: [{ name: "planned" }, { name: "done", terminal: true }], transitions: [{ from: "planned", to: "dun" }] },
  }));
  show("Watering Visit, valid but only schema:Thing", await visit({
    kind: "event",
    fields: [
      { name: "visitedAt", type: "dateTime", provenance: "device-captured" },
      { name: "photo", type: "binary", provenance: "device-captured" },
    ],
  }));

  lattice.close();
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
