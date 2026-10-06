// Builder contributions phase 1 (specs/builder-contributions.md): builders
// who cannot publish send back the types they designed, and independent
// contributions of the same type cluster into a concept candidate.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { ANONYMOUS, OPERATOR } from "../src/server/principals.ts";
import { ContributionRejected, normalizeFieldName } from "../src/evidence/contributions.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err instanceof ContributionRejected ? err.message : `unexpected: ${(err as Error).message}`;
  }
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-contrib-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const c = instance.contributions;
  const EVENT = instance.seed.conceptUris.get("event")!;
  const LOCATION = instance.seed.conceptUris.get("location")!;

  const appointment = (label: string, start: string, values: string[], extra: Array<Record<string, unknown>> = []) => ({
    label,
    broader: EVENT,
    definition: "One booked grooming session for one dog at a set time with a named groomer.",
    fields: [
      { name: start, type: "timestamp", required: true },
      { name: "status", type: "enum", values },
      { name: "petId", type: "reference" },
      ...extra,
    ],
  });

  // --- validation ----------------------------------------------------------
  check(
    "broader-must-be-a-root",
    (await rejects(() => c.submit({ types: [{ ...appointment("Appointment", "startsAt", []), broader: "https://example.com/x" }] }, "net:a"))) !== null,
  );
  check(
    "definition-must-say-something",
    (await rejects(() => c.submit({ types: [{ ...appointment("Appointment", "startsAt", []), definition: "..." }] }, "net:a"))) !== null,
  );
  check(
    "unknown-field-type-rejected",
    (await rejects(() => c.submit({ types: [appointment("Appointment", "startsAt", [], [{ name: "x", type: "banana" }])] }, "net:a"))) !== null,
  );
  check("field-names-normalize", normalizeFieldName("startsAt") === normalizeFieldName("starts_at") && normalizeFieldName("Pets") === "pet");

  // --- one source: stored, private ------------------------------------------
  const first = await c.submit(
    { types: [appointment("Appointment", "startsAt", ["booked", "done", "no_show", "vip_gold"])], sourceQuery: "dog grooming appointment booking" },
    "net:a",
  );
  check("submit-accepted", first.accepted.length === 1 && first.withdrawToken.startsWith("wd_"), JSON.stringify(first.accepted));
  check("timestamp-alias-normalized", c.candidates({ operator: true })[0]?.fields.find((f) => f.name === "startsAt")?.type === "datetime");
  check("single-source-hidden-from-public", c.candidates().length === 0 && c.candidates({ operator: true }).length === 1);

  // The same source again counts once.
  await c.submit({ types: [appointment("Appointment", "startsAt", ["booked", "done"])] }, "net:a");
  check("same-source-counts-once", c.candidates().length === 0 && c.candidates({ operator: true })[0].sources === 1);

  // --- a second, independent builder -----------------------------------------
  await c.submit({ types: [appointment("GroomingBooking", "starts_at", ["booked", "done", "cancelled"])] }, "net:b");
  const [cand] = c.candidates();
  check("independent-sources-make-a-public-candidate", cand?.sources === 2 && cand.broader.uri === EVENT, JSON.stringify(cand?.labels));
  const status = cand?.fields.find((f) => f.name === "status");
  check(
    "public-sees-only-shared-enum-values",
    status?.values?.booked === 2 && status.values.done === 2 && status.values.vip_gold === undefined && status.values.cancelled === undefined,
    JSON.stringify(status?.values),
  );
  check(
    "spellings-merge-into-one-field",
    cand?.fields.filter((f) => normalizeFieldName(f.name) === "start_at").length === 1 &&
      cand.fields.find((f) => normalizeFieldName(f.name) === "start_at")?.sources === 2,
  );
  check("source-query-kept", cand?.sourceQueries.includes("dog grooming appointment booking") === true);

  // A similar text under a different root is a different candidate.
  await c.submit({ types: [{ ...appointment("Grooming Salon", "openedAt", []), broader: LOCATION, definition: "A grooming salon where dogs are booked in for a groomer." }] }, "net:c");
  check("roots-never-cluster-together", c.candidates({ operator: true }).length === 2);

  // --- demand report and tools ------------------------------------------------
  const publicReport = (await callTool(instance, "lattice_demand_report", {}, ANONYMOUS)) as { candidates: unknown[] };
  const operatorReport = (await callTool(instance, "lattice_demand_report", {}, OPERATOR)) as { candidates: unknown[] };
  check("demand-report-public-view", publicReport.candidates.length === 1, `${publicReport.candidates.length}`);
  check("demand-report-operator-view", operatorReport.candidates.length === 2, `${operatorReport.candidates.length}`);

  const viaTool = (await callTool(instance, "lattice_contribute", { types: [appointment("Appt", "startTime", ["booked"])] }, ANONYMOUS, { clientAddress: "203.0.113.9" })) as { accepted?: unknown[] };
  check("contribute-tool-anonymous", viaTool.accepted?.length === 1, JSON.stringify(viaTool).slice(0, 200));

  // --- withdrawal ---------------------------------------------------------------
  const before = c.counts().contributions;
  const removed = c.withdraw(first.withdrawToken);
  check("withdraw-removes-submission", removed.removed === 1 && c.counts().contributions === before - 1);
  check("withdraw-token-single-use", (await rejects(async () => c.withdraw(first.withdrawToken))) !== null);

  const beforePurge = c.counts().contributions;
  const purged = c.purgeSource("net:b");
  check("operator-purge-source", purged.removed === 1 && c.counts().contributions === beforePurge - 1);

  instance.store.close?.();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
