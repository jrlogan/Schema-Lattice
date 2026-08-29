// M2.5 data-classification smoke test (specs/data-classification.md).
//
// Uses non-civic domains (makerspace membership, dive-club logs) on
// purpose: the governance vocabulary must be organization-neutral.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { PublishError } from "../src/publish/errors.ts";
import type { ConceptRecord } from "../src/hashing/types.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, note: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
  ok ? passed++ : failed++;
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-m25-class-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const sessionId = "test-classification";
  const scheme = instance.contextUri();

  // Governance vocabulary seeded and discoverable.
  check(
    "governance-seeded",
    instance.governance.conceptUris.size === 10 &&
      !!instance.governanceUri("personal-health") &&
      !!instance.governanceUri("attestation"),
    `${instance.governance.conceptUris.size} governance concepts`,
  );

  const q = await instance.discover({
    description: "medical information about a person such as allergies or injuries",
    sessionId,
  });
  check(
    "discover-finds-data-class",
    q.results[0]?.uri === instance.governanceUri("personal-health"),
    `top=${q.results[0]?.prefLabel} sim=${q.results[0]?.similarity}`,
  );

  const publish = (slug: string, record: Omit<ConceptRecord, "type" | "inScheme">) =>
    instance.publishConcept({
      contextSlug: "makerspace",
      conceptSlug: slug,
      record: { type: "Concept", inScheme: scheme, ...record } as ConceptRecord,
      sessionId,
    });

  // Valid classifications publish cleanly (slug and full-URI forms).
  const member = await publish("member-profile", {
    prefLabel: { en: "Member Profile" },
    definition: {
      en: "The standing record for one person who belongs to the organization, holding how to reach them, their standing, and any participation requirements.",
    },
    broader: [instance.skeletonUri("person")!],
    closeMatch: ["schema:Person", "foaf:Person"],
    coRefersWith: [],
    coRefersRationale: "First person-shaped concept in this test catalog.",
    conceptKind: "agent",
    structure: {
      kind: "entity",
      fields: [
        { name: "memberId", type: "string", required: true, classification: "internal" },
        { name: "email", type: "string", classification: "personal-contact" },
        { name: "phone", type: "string", classification: "personal-contact" },
        { name: "waiverNotes", type: "string", classification: instance.governanceUri("personal-health")! },
        { name: "guardianConsent", type: "boolean", classification: "personal-minor" },
        { name: "displayName", type: "string" },
      ],
    },
  });
  check("valid-classifications-publish", member.ok === true, `published ${member.uri}`);

  const diveLog = await publish("dive-log-entry", {
    prefLabel: { en: "Dive Log Entry" },
    definition: {
      en: "One recorded scuba outing: when and where it happened, how deep and how long, gas mix used, and who was in the water together.",
    },
    broader: [instance.skeletonUri("record")!],
    closeMatch: ["schema:Report"],
    coRefersWith: [],
    coRefersRationale: "No sibling perspectives in this test catalog yet.",
    conceptKind: "event",
    structure: {
      kind: "entity",
      fields: [
        { name: "site", type: "string", classification: "public" },
        { name: "maxDepth", type: "number" },
        { name: "buddyContact", type: "string", classification: "personal-contact" },
      ],
    },
  });

  // Unknown classification value is rejected.
  try {
    await publish("bad-class", {
      prefLabel: { en: "Badly Classified Thing" },
      definition: {
        en: "A fixture whose only purpose is carrying an unknown classification value to prove the publish gate rejects it.",
      },
      broader: [instance.skeletonUri("record")!],
      closeMatch: ["schema:Thing"],
      coRefersWith: [],
      coRefersRationale: "Test fixture; no sibling perspectives.",
      structure: {
        kind: "entity",
        fields: [{ name: "x", type: "string", classification: "super-secret" }],
      },
    });
    check("unknown-class-rejected", false, "publish unexpectedly succeeded");
  } catch (err) {
    check(
      "unknown-class-rejected",
      err instanceof PublishError && err.code === "ERR_UNKNOWN_CLASSIFICATION",
      `rejected with ${err instanceof PublishError ? err.code : "UNKNOWN"}`,
    );
  }

  // Sensitivity profile over a two-concept "manifest".
  const profile = instance.sensitivityProfile([member.uri, diveLog.uri]);
  check(
    "profile-counts",
    profile.totalFields === 9 &&
      profile.classifiedFields === 7 &&
      profile.byClass["personal-contact"] === 3 &&
      profile.byClass["personal-health"] === 1,
    JSON.stringify(profile.byClass),
  );
  check(
    "profile-max-rank",
    profile.maxRank === 5 &&
      (profile.maxClass === "personal-health" || profile.maxClass === "personal-minor"),
    `maxRank=${profile.maxRank} maxClass=${profile.maxClass}`,
  );
  check(
    "profile-coverage-gaps",
    profile.unclassifiedConcepts.length === 0,
    "both concepts contribute classified fields",
  );

  // Reclassifying a field changes identity (structure is hashed).
  const reclassified = await publish("member-profile", {
    prefLabel: { en: "Member Profile" },
    definition: {
      en: "The standing record for one person who belongs to the organization, holding how to reach them, their standing, and any participation requirements.",
    },
    broader: [instance.skeletonUri("person")!],
    closeMatch: ["schema:Person", "foaf:Person"],
    coRefersWith: [],
    coRefersRationale: "First person-shaped concept in this test catalog.",
    conceptKind: "agent",
    structure: {
      kind: "entity",
      fields: [
        { name: "memberId", type: "string", required: true, classification: "internal" },
        { name: "email", type: "string", classification: "personal-contact" },
        { name: "phone", type: "string", classification: "personal-contact" },
        { name: "waiverNotes", type: "string", classification: instance.governanceUri("personal-health")! },
        { name: "guardianConsent", type: "boolean", classification: "confidential" },
        { name: "displayName", type: "string" },
      ],
    },
  });
  check(
    "reclassification-changes-identity",
    reclassified.uri !== member.uri,
    "new URI minted for changed classification",
  );

  instance.close();
  rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main();
