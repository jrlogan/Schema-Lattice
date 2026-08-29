// R2 friction-gate eval runner. Loads scenario JSONs from
// packages/lattice-evals/scenarios/friction/ and runs each against a
// fresh temp-dir LatticeInstance (REQUIREMENTS §R2 test hook).

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { PublishError } from "../src/publish/errors.ts";
import type { ConceptRecord } from "../src/hashing/types.ts";

interface Scenario {
  id: string;
  description: string;
  expect: "ok" | "error";
  expectedCode?: string;
  /** When true, the runner does NOT call discover first. */
  skipDiscover?: boolean;
  contextSlug: string;
  conceptSlug: string;
  broaderSkeletonSlug?: string;
  record: ConceptRecord;
}

const SCENARIOS_DIR = resolve(
  import.meta.dirname ?? __dirname,
  "../../lattice-evals/scenarios/friction",
);

interface Outcome {
  id: string;
  pass: boolean;
  note: string;
}

async function runOne(instance: LatticeInstance, s: Scenario): Promise<Outcome> {
  const record: ConceptRecord = {
    ...s.record,
    inScheme: instance.contextUri(),
  };
  if (s.broaderSkeletonSlug) {
    const parent = instance.skeletonUri(s.broaderSkeletonSlug);
    if (!parent) {
      return { id: s.id, pass: false, note: `skeleton slug ${s.broaderSkeletonSlug} not found` };
    }
    record.broader = [...(record.broader ?? []), parent];
  }

  const sessionId = `test-${s.id}`;
  if (!s.skipDiscover) {
    await instance.discover({
      description: (record.definition?.en as string) ?? s.description,
      sessionId,
    });
  }

  try {
    const result = await instance.publishConcept({
      contextSlug: s.contextSlug,
      conceptSlug: s.conceptSlug,
      record,
      sessionId,
    });
    if (s.expect === "ok") {
      return { id: s.id, pass: true, note: `published ${result.uri}` };
    }
    return {
      id: s.id,
      pass: false,
      note: `expected error ${s.expectedCode}, got success ${result.uri}`,
    };
  } catch (err) {
    if (s.expect === "error") {
      if (err instanceof PublishError && err.code === s.expectedCode) {
        return { id: s.id, pass: true, note: `rejected with ${err.code}` };
      }
      const code = err instanceof PublishError ? err.code : "UNKNOWN";
      return {
        id: s.id,
        pass: false,
        note: `expected ${s.expectedCode}, got ${code}: ${(err as Error).message}`,
      };
    }
    return { id: s.id, pass: false, note: `unexpected error: ${(err as Error).message}` };
  }
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-m2-friction-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  console.log(`tmp: ${tmp}`);

  const files = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const outcomes: Outcome[] = [];
  for (const file of files) {
    const scenario = JSON.parse(
      readFileSync(join(SCENARIOS_DIR, file), "utf8"),
    ) as Scenario;
    outcomes.push(await runOne(instance, scenario));
  }

  instance.close();
  rmSync(tmp, { recursive: true, force: true });

  let passed = 0;
  for (const o of outcomes) {
    const mark = o.pass ? "PASS" : "FAIL";
    console.log(`${mark}  ${o.id}  — ${o.note}`);
    if (o.pass) passed++;
  }
  console.log(`\n${passed}/${outcomes.length} scenarios passed`);
  if (passed !== outcomes.length) process.exit(1);
}

main();
