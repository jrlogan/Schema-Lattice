// App-registry smoke test (server-side R4). Deliberately non-civic:
// a makerspace with three shop-area apps proves the registry is
// organization-neutral.

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
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-registry-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const sessionId = "test-registry";
  const scheme = instance.contextUri();
  const R = instance.registry;

  const publish = async (slug: string, record: Omit<ConceptRecord, "type" | "inScheme">) => {
    await instance.discover({
      description: (record.definition as Record<string, string>).en,
      sessionId,
    });
    return instance.publishConcept({
      contextSlug: "makerspace",
      conceptSlug: slug,
      record: { type: "Concept", inScheme: scheme, ...record } as ConceptRecord,
      sessionId,
    });
  };

  // --- Concepts three shop-area apps will use ----------------------
  const member = await publish("member-profile", {
    prefLabel: { en: "Member Profile" },
    definition: {
      en: "The standing record for one person who belongs to the organization, holding how to reach them, their standing, and any participation requirements.",
    },
    broader: [instance.skeletonUri("person")!],
    closeMatch: ["schema:Person", "foaf:Person"],
    coRefersWith: [],
    coRefersRationale: "First person-shaped concept in this catalog.",
    conceptKind: "agent",
    structure: {
      kind: "entity",
      fields: [
        { name: "memberId", type: "string", required: true, classification: "internal" },
        { name: "email", type: "string", classification: "personal-contact" },
        { name: "waiverNotes", type: "string", classification: "personal-health" },
      ],
    },
  });

  const checkout = await publish("tool-checkout", {
    prefLabel: { en: "Tool Checkout" },
    definition: {
      en: "A time-bounded borrowing event in which a member takes a piece of shared equipment from an inventory, with due date, condition notes, and return tracking.",
    },
    broader: [instance.skeletonUri("transaction")!],
    closeMatch: ["schema:BorrowAction"],
    coRefersWith: [],
    coRefersRationale: "No sibling perspectives in this catalog yet.",
    conceptKind: "event",
  });

  const classSession = await publish("class-session", {
    prefLabel: { en: "Class Session" },
    definition: {
      en: "A scheduled teaching event at the organization with an instructor, capacity, prerequisites, and a roster of attendees who signed up.",
    },
    broader: [instance.skeletonUri("event")!],
    closeMatch: ["schema:Event"],
    coRefersWith: [],
    coRefersRationale: "No sibling perspectives in this catalog yet.",
    conceptKind: "event",
  });

  // Front-desk team unknowingly rebuilds Member Profile, unlinked.
  const dupMember = await publish("member-record", {
    prefLabel: { en: "Member Record" },
    definition: {
      en: "The stored details for a person belonging to the organization, including how to contact them, their current standing, and participation requirements.",
    },
    broader: [instance.skeletonUri("person")!],
    closeMatch: ["schema:Person"],
    coRefersWith: [],
    coRefersRationale: "No related concept found.", // (it missed one)
    conceptKind: "agent",
  });
  check(
    "near-dup-warned-at-publish",
    dupMember.duplicateWarnings.some((w) => w.uri === member.uri),
    `warnings=${dupMember.duplicateWarnings.map((w) => w.prefLabel).join(",") || "none"}`,
  );

  // --- Registration ------------------------------------------------
  const reg1 = R.registerApp({
    slug: "tool-library",
    name: "Tool Library",
    unit: "Wood Shop",
    owner: "Shop Steward",
    contact: "woodshop@example.org",
    status: "pilot",
    concepts: [
      { uri: member.uri, status: "originated", shortName: "MemberProfile" },
      { uri: checkout.uri, status: "originated", shortName: "ToolCheckout" },
    ],
  });
  check("register-creates", reg1.created === true, `created ${reg1.slug}`);

  R.registerApp({
    slug: "class-signup",
    name: "Class Signup",
    unit: "Education",
    owner: "Education Lead",
    status: "experiment",
    concepts: [
      { uri: member.uri, status: "adopted", shortName: "MemberProfile" },
      { uri: classSession.uri, status: "originated", shortName: "ClassSession" },
    ],
  });
  R.registerApp({
    slug: "door-access",
    name: "Door Access",
    unit: "Front Desk",
    owner: "Front Desk Coordinator",
    status: "experiment",
    concepts: [{ uri: dupMember.uri, status: "originated" }],
  });

  const reg2 = R.registerApp({
    slug: "tool-library",
    name: "Tool Library",
    unit: "Wood Shop",
    owner: "Shop Steward",
    status: "production",
    concepts: [
      { uri: member.uri, status: "originated" },
      { uri: checkout.uri, status: "originated" },
    ],
  });
  check(
    "reregister-updates",
    reg2.created === false && R.listApps().find((a) => a.slug === "tool-library")?.status === "production",
    "status moved pilot → production in place",
  );

  try {
    R.registerApp({
      slug: "ghost-app",
      name: "Ghost",
      unit: "Nowhere",
      owner: "No One",
      status: "experiment",
      concepts: [{ uri: "https://schemalattice.com/c/x/y@000000000000", status: "adopted" }],
    });
    check("unknown-concept-rejected", false, "registration unexpectedly succeeded");
  } catch (e) {
    check(
      "unknown-concept-rejected",
      e instanceof PublishError && e.code === "ERR_UNKNOWN_CONCEPT",
      `rejected with ${e instanceof PublishError ? e.code : "UNKNOWN"}`,
    );
  }

  // --- Usages, scores, overlaps ------------------------------------
  const usages = R.listUsages(member.uri);
  check(
    "list-usages",
    usages.length === 2 && usages.some((u) => u.app === "class-signup" && u.status === "adopted"),
    usages.map((u) => `${u.app}(${u.status})`).join(", "),
  );

  const sSignup = R.scoreApp("class-signup");
  const sDoor = R.scoreApp("door-access");
  check(
    "scores-rank-sensibly",
    sSignup.overall > sDoor.overall && sDoor.dedupe === 0,
    `class-signup=${sSignup.overall} door-access=${sDoor.overall} (dedupe=${sDoor.dedupe})`,
  );

  const ov = R.overlapBetween("tool-library", "class-signup");
  check(
    "overlap-shared-concept",
    ov.sharedUris === 1 && ov.compatibility >= 0.5,
    `sharedUris=${ov.sharedUris} compatibility=${ov.compatibility}`,
  );

  // --- Attestations -------------------------------------------------
  R.recordAttestation("class-signup", {
    gate: "privacy-review",
    gateVersion: "1",
    result: "pass",
    performedBy: "Education Lead",
    performedOn: "2026-08-17",
  });
  try {
    R.recordAttestation("class-signup", {
      gate: "privacy-review",
      result: "maybe" as never,
      performedBy: "x",
      performedOn: "2026-08-17",
    });
    check("attestation-result-validated", false, "invalid result accepted");
  } catch (e) {
    check(
      "attestation-result-validated",
      e instanceof PublishError && e.code === "ERR_ATTESTATION_RESULT_INVALID",
      `rejected with ${e instanceof PublishError ? e.code : "UNKNOWN"}`,
    );
  }

  // --- Audit + portfolio -------------------------------------------
  const findings = R.audit();
  const kinds = findings.map((f) => f.kind);
  check(
    "audit-finds-unlinked-dup",
    findings.some((f) => f.kind === "unlinked-near-duplicate" && f.apps.includes("door-access")),
    findings.find((f) => f.kind === "unlinked-near-duplicate")?.detail ?? "missing",
  );
  check(
    "audit-flags-unattested-sensitive",
    findings.some((f) => f.kind === "unattested-sensitive-profile" && f.apps.includes("tool-library")) &&
      !findings.some((f) => f.kind === "unattested-sensitive-profile" && f.apps.includes("class-signup")),
    "tool-library flagged (personal-health, no attestation); class-signup covered by privacy-review",
  );

  const report = R.portfolioReport();
  check(
    "portfolio-report",
    report.apps.length === 3 &&
      report.overlaps.length === 3 &&
      report.apps.find((a) => a.slug === "tool-library")?.profile.maxClass === "personal-health",
    `${report.apps.length} apps, ${report.overlaps.length} pairs, ${report.findings.length} findings`,
  );

  instance.close();
  rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main();
