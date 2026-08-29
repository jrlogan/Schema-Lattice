// New Haven civic demo — three city departments building AI-generated
// apps against one shared lattice instance, now through the full M2
// pipeline: discover-before-publish (R2), semantic discovery, friction
// gate, and duplicate warnings.
//
//   Dept A — Building Dept: greenfield permit-tracking app
//   Dept B — Parks & Rec: reservation app that DISCOVERS Dept A's
//            concepts and forks/adopts instead of reinventing
//   Dept C — Public Works: legacy 311 retrofit that gets warned when
//            it tries to publish a near-duplicate
//
// Run: npm run demo:new-haven

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import type { ConceptRecord } from "../src/hashing/types.ts";

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-nh-demo-"));
  const lattice = await LatticeInstance.create({ dataDir: tmp });
  const scheme = lattice.contextUri();

  const publish = async (
    sessionId: string,
    slug: string,
    record: Omit<ConceptRecord, "type" | "inScheme">,
  ) => {
    const res = await lattice.publishConcept({
      contextSlug: "civic",
      conceptSlug: slug,
      record: { type: "Concept", inScheme: scheme, ...record } as ConceptRecord,
      sessionId,
    });
    console.log(`  published civic/${slug} → ${res.uri}`);
    for (const w of res.duplicateWarnings) {
      console.log(
        `    ⚠ duplicate warning: ${w.similarity} similar to ${w.prefLabel} (${w.uri})`,
      );
    }
    return res;
  };

  // ------------------------------------------------------------------
  console.log("\n=== Dept A: Building Department (greenfield permit app) ===");
  const A = "session-building-dept";

  await lattice.discover({
    description: "a legally defined unit of real property with parcel id, address, owner, zoning",
    sessionId: A,
  });
  const parcel = await publish(A, "property-parcel", {
    prefLabel: { en: "Property Parcel" },
    definition: {
      en: "A legally defined unit of real estate within the city, identified in the assessor's database, with an address, owner of record, and zoning designation.",
    },
    broader: [lattice.skeletonUri("location")!],
    closeMatch: ["schema:Place", "wd:Q397059"],
    coRefersWith: [],
    coRefersRationale: "First location concept in the civic catalog; no sibling perspectives yet.",
    conceptKind: "place",
  });

  await lattice.discover({
    description: "municipal authorization request for regulated construction work",
    sessionId: A,
  });
  const permit = await publish(A, "permit-application", {
    prefLabel: { en: "Permit Application" },
    definition: {
      en: "A request submitted by an owner or contractor for municipal authorization to perform regulated work, moving through intake, review, decision, and issuance states.",
    },
    broader: [lattice.skeletonUri("workflow")!],
    closeMatch: ["schema:GovernmentPermit"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this authorization workflow yet.",
    conceptKind: "workflow",
  });

  await lattice.discover({
    description: "official site visit to verify code compliance with pass or fail result",
    sessionId: A,
  });
  const inspection = await publish(A, "inspection", {
    prefLabel: { en: "Inspection" },
    definition: {
      en: "A scheduled site visit by a city official to verify that work or conditions at a property comply with applicable codes, producing a pass, fail, or partial result.",
    },
    broader: [lattice.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this compliance visit from another perspective yet.",
    conceptKind: "event",
  });

  // ------------------------------------------------------------------
  console.log("\n=== Dept B: Parks & Rec (six months later, different AI) ===");
  const B = "session-parks-dept";

  // Checkpoint 1A: the Parks AI describes what it's about to model —
  // and finds the Building Dept's parcel concept.
  const found = await lattice.discover({
    description: "a piece of city land or facility with an identifier and address",
    sessionId: B,
  });
  console.log(`  discover top hit: ${found.results[0]?.prefLabel} (sim=${found.results[0]?.similarity})`);

  // Close match → fork with a changeset (per the calibrated decision tree).
  const facility = await publish(B, "park-facility", {
    prefLabel: { en: "Park Facility" },
    definition: {
      en: "A reservable built amenity within a city park, such as a pavilion, athletic field, court, or meeting room, managed by the parks department.",
    },
    forkedFrom: parcel.uri,
    changeset: [
      { op: "remove", field: "ownerOfRecord" },
      { op: "remove", field: "zoningCode" },
      { op: "add", field: "facilityType", type: "string" },
      { op: "add", field: "capacity", type: "number" },
      { op: "rename", from: "parcelId", to: "facilityId" },
    ],
    conceptKind: "place",
  });

  await lattice.discover({
    description: "a resident's time-bounded booking of a public amenity with fee and approval",
    sessionId: B,
  });
  const reservation = await publish(B, "facility-reservation", {
    prefLabel: { en: "Facility Reservation" },
    definition: {
      en: "A time-bounded booking of a public amenity by a resident or organization, with requested date, party size, fee, and approval status.",
    },
    broader: [lattice.skeletonUri("transaction")!],
    closeMatch: ["schema:Reservation"],
    coRefersWith: [],
    coRefersRationale: "No other concept describes this booking from another perspective yet.",
    conceptKind: "event",
  });

  // ------------------------------------------------------------------
  console.log("\n=== Dept C: Public Works (legacy 311 retrofit) ===");
  const C = "session-public-works";

  await lattice.discover({
    description: "resident report asking the city to fix a condition, routed and tracked",
    sessionId: C,
  });
  const svcRequest = await publish(C, "service-request", {
    prefLabel: { en: "Service Request" },
    definition: {
      en: "A report from a resident asking the city to address a condition such as a pothole or blocked drain, routed to a responsible department and tracked to resolution.",
    },
    broader: [lattice.skeletonUri("record")!],
    importedFrom: "legacy://311-export/issues-table",
    closeMatch: ["schema:Action"],
    coRefersWith: [],
    coRefersRationale: "Extracted from the legacy 311 system; no sibling perspectives yet.",
    conceptKind: "workflow",
    structure: {
      kind: "entity",
      fields: [
        { name: "requestId", type: "string", required: true, classification: "internal" },
        { name: "category", type: "string", classification: "public" },
        { name: "description", type: "string", classification: "internal" },
        { name: "reporterContact", type: "string", classification: "personal-contact" },
      ],
    },
  });

  // A fourth team unknowingly tries to republish "inspections" under a
  // new name — M2's duplicate detection now catches what M1 let through.
  console.log("\n=== Dept D: unaware near-duplicate attempt ===");
  const D = "session-fire-marshal";
  const dupProbe = await lattice.discover({
    description: "a city employee visits a site to check regulation compliance and records the outcome",
    sessionId: D,
  });
  console.log(
    `  discover already surfaces: ${dupProbe.results[0]?.prefLabel} (sim=${dupProbe.results[0]?.similarity}) — adopt/fork territory`,
  );
  const dup = await publish(D, "site-inspection", {
    prefLabel: { en: "Site Inspection" },
    definition: {
      en: "A scheduled site visit by a municipal official to verify that work or conditions at a property comply with applicable regulations, recording a pass, fail, or partial outcome.",
    },
    broader: [lattice.skeletonUri("event")!],
    closeMatch: ["schema:CheckAction"],
    coRefersWith: [inspection.uri],
    conceptKind: "event",
  });
  console.log(
    dup.duplicateWarnings.length > 0
      ? "  → the publish went through (warn-not-block per REQUIREMENTS) but the AI now has grounds to withdraw and adopt."
      : "  → NO WARNING — this would be a regression, M2 dedup should have fired.",
  );

  // ------------------------------------------------------------------
  console.log("\n=== Registry: the program-owner view ===");
  const R = lattice.registry;
  R.registerApp({
    slug: "permit-tracker", name: "Permit Tracker", unit: "Building Department",
    owner: "Building Official", status: "pilot",
    concepts: [
      { uri: parcel.uri, status: "originated" },
      { uri: permit.uri, status: "originated" },
      { uri: inspection.uri, status: "originated" },
    ],
  });
  R.registerApp({
    slug: "park-reservations", name: "Park Reservations", unit: "Parks & Recreation",
    owner: "Parks Director", status: "experiment",
    concepts: [
      { uri: parcel.uri, status: "adopted" },
      { uri: facility.uri, status: "forked" },
      { uri: reservation.uri, status: "originated" },
    ],
  });
  R.registerApp({
    slug: "311-modernization", name: "311 Modernization", unit: "Public Works",
    owner: "PW Systems Lead", status: "experiment",
    concepts: [
      { uri: parcel.uri, status: "adopted" },
      { uri: svcRequest.uri, status: "originated" },
    ],
  });
  R.registerApp({
    slug: "fire-inspections", name: "Fire Inspections", unit: "Fire Marshal",
    owner: "Deputy Fire Marshal", status: "experiment",
    concepts: [{ uri: dup.uri, status: "originated" }],
  });
  R.recordAttestation("park-reservations", {
    gate: "privacy-review", result: "pass",
    performedBy: "City Privacy Officer", performedOn: "2026-08-17",
  });

  const report = R.portfolioReport();
  for (const app of report.apps) {
    const att = app.attestations.map((t) => `${t.gate}:${t.result}`).join(",") || "none";
    console.log(
      `  ${app.slug.padEnd(20)} unit=${app.unit.padEnd(20)} score=${String(app.score.overall).padStart(3)}  maxClass=${app.profile.maxClass ?? "—"}  attestations=${att}`,
    );
  }
  console.log("  overlaps:");
  for (const o of report.overlaps.filter((o) => o.compatibility > 0)) {
    console.log(`    ${o.a} ↔ ${o.b}  compatibility=${o.compatibility}`);
  }
  console.log("  findings:");
  for (const f of report.findings) {
    console.log(`    [${f.kind}] (${f.apps.join(", ")}) ${f.detail}`);
  }

  lattice.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log("\ndone.");
}

main();
