// M2 discover + duplicate-detection smoke test.
//
// Publishes a small civic catalog against a fresh instance, then
// asserts that (a) semantic discovery ranks the right concept first,
// (b) an off-catalog query scores low and triggers refinement
// suggestions, (c) a near-duplicate publish comes back with a
// duplicate warning ≥ 0.85, and (d) skeleton nodes are discoverable
// from day one (the "meaningful geometry" claim in DECISIONS.md).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import type { ConceptRecord } from "../src/hashing/types.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, note: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
  ok ? passed++ : failed++;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-m2-discover-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const sessionId = "test-discover";
  const scheme = instance.contextUri();

  const publish = async (slug: string, record: Omit<ConceptRecord, "type" | "inScheme">) => {
    await instance.discover({
      description: (record.definition as Record<string, string>).en,
      sessionId,
    });
    return instance.publishConcept({
      contextSlug: "civic",
      conceptSlug: slug,
      record: { type: "Concept", inScheme: scheme, ...record } as ConceptRecord,
      sessionId,
    });
  };

  const inspection = await publish("inspection", {
    prefLabel: { en: "Inspection" },
    definition: {
      en: "A scheduled site visit by a city official to verify that work or conditions at a property comply with applicable codes, producing a pass, fail, or partial result.",
    },
    broader: [instance.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this compliance visit from another perspective yet.",
    conceptKind: "event",
  });

  await publish("facility-reservation", {
    prefLabel: { en: "Facility Reservation" },
    definition: {
      en: "A time-bounded booking of a public amenity by a resident or organization, with requested date, party size, fee, and approval status.",
    },
    broader: [instance.skeletonUri("transaction")!],
    closeMatch: ["schema:Reservation"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this booking from another perspective yet.",
    conceptKind: "event",
  });

  await publish("service-request", {
    prefLabel: { en: "Service Request" },
    definition: {
      en: "A report from a resident asking the city to address a condition such as a pothole or blocked drain, routed to a responsible department and tracked to resolution.",
    },
    broader: [instance.skeletonUri("record")!],
    closeMatch: ["schema:Action"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this resident report from another perspective yet.",
    conceptKind: "workflow",
  });

  // (a) Semantic ranking: an integrator's paraphrase should find Inspection.
  const q1 = await instance.discover({
    description:
      "an official visits a building site to check code compliance and records the outcome",
    sessionId,
  });
  check(
    "discover-ranks-inspection-first",
    q1.results[0]?.uri === inspection.uri && q1.results[0].similarity >= 0.5,
    `top=${q1.results[0]?.prefLabel} sim=${q1.results[0]?.similarity}`,
  );

  // (b) Off-catalog query: low similarity, refinements suggested.
  const q2 = await instance.discover({
    description: "maintenance schedule for an orbital telescope's mirror assembly",
    sessionId,
  });
  check(
    "discover-low-similarity-off-catalog",
    (q2.results[0]?.similarity ?? 0) < 0.55 && q2.suggestions.refinements.length > 0,
    `top sim=${q2.results[0]?.similarity ?? "none"} refinements=${q2.suggestions.refinements.length}`,
  );

  // (c) Near-duplicate publish warns (Gate 6, warn-not-block).
  const dupe = await publish("site-inspection", {
    prefLabel: { en: "Site Inspection" },
    definition: {
      en: "A scheduled site visit by a municipal official to verify that work or conditions at a property comply with applicable regulations, recording a pass, fail, or partial outcome.",
    },
    broader: [instance.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [],
    coRefersRationale: "Deliberate near-duplicate fixture for the duplicate-detection test.",
    conceptKind: "event",
  });
  const warned = dupe.duplicateWarnings.find((w) => w.uri === inspection.uri);
  check(
    "duplicate-publish-warns",
    !!warned && warned.similarity >= 0.85,
    warned
      ? `warned about ${warned.prefLabel} at sim=${warned.similarity}`
      : `no warning (got ${JSON.stringify(dupe.duplicateWarnings)})`,
  );

  // (d) Skeleton geometry: abstract parents are discoverable day one.
  // Wording avoids "contact information" — with the governance
  // vocabulary seeded, that phrase correctly pulls the Personal
  // Contact data class ahead of the Person skeleton node.
  const q3 = await instance.discover({
    description: "an individual human being identified by name, roles, and memberships",
    sessionId,
  });
  check(
    "discover-finds-skeleton-person",
    q3.results[0]?.uri === instance.skeletonUri("person"),
    `top=${q3.results[0]?.prefLabel} sim=${q3.results[0]?.similarity}`,
  );

  instance.close();
  rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main();
