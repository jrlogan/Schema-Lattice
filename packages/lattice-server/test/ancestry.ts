// R1 ancestry eval runner. Loads the three scenario JSONs from
// packages/lattice-evals/scenarios/ancestry/ and runs each against a
// fresh temp-dir LatticeInstance.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  contextSlug: string;
  conceptSlug: string;
  broaderSkeletonSlug?: string;
  record: ConceptRecord;
}

const SCENARIOS_DIR = resolve(
  import.meta.dirname ?? __dirname,
  "../../lattice-evals/scenarios/ancestry",
);

const SCENARIO_FILES = [
  "ancestry-valid-fork-01.json",
  "ancestry-orphan-original-02.json",
  "ancestry-broken-chain-03.json",
];

interface Outcome {
  id: string;
  pass: boolean;
  note: string;
}

function runOne(instance: LatticeInstance, s: Scenario): Outcome {
  const record: ConceptRecord = {
    ...s.record,
    inScheme: instance.contextUri(),
  };
  if (s.broaderSkeletonSlug) {
    const parent = instance.skeletonUri(s.broaderSkeletonSlug);
    if (!parent) {
      return {
        id: s.id,
        pass: false,
        note: `skeleton slug ${s.broaderSkeletonSlug} not found`,
      };
    }
    record.broader = [...(record.broader ?? []), parent];
  }

  try {
    const result = instance.publishConcept({
      contextSlug: s.contextSlug,
      conceptSlug: s.conceptSlug,
      record,
    });
    if (s.expect === "ok") {
      return {
        id: s.id,
        pass: true,
        note: `published ${result.uri} (root=${result.rootAncestor})`,
      };
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
    return {
      id: s.id,
      pass: false,
      note: `unexpected error: ${(err as Error).message}`,
    };
  }
}

function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-m1-"));
  const instance = new LatticeInstance({ dataDir: tmp });

  console.log(`context: ${instance.contextUri()}`);
  console.log(`tmp: ${tmp}`);

  const outcomes: Outcome[] = [];
  for (const file of SCENARIO_FILES) {
    const raw = readFileSync(join(SCENARIOS_DIR, file), "utf8");
    const scenario = JSON.parse(raw) as Scenario;
    outcomes.push(runOne(instance, scenario));
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
