// R2 — metadata friction gate (REQUIREMENTS §R2, ROADMAP §2).
//
// Runs after R1 ancestry and before canonicalization; failures are
// hash-blocking and structured so the MCP layer can surface them as
// guided retries. Forks (records carrying `forkedFrom`) get the
// definition-quality checks only: external matches and co-reference
// are inheritable from the parent, and fork-specific sibling
// co-reference warnings land with the dedicated publish_fork tool.

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import type { Embedder } from "../discover/embedder.ts";
import { cosine } from "../discover/embedder.ts";
import { PublishError } from "./errors.ts";

// specs/root-skeleton.md § "External vocabulary prefixes".
export const APPROVED_VOCAB_PREFIXES = [
  "schema:",
  "skos:",
  "foaf:",
  "prov:",
  "dolce:",
  "bfo:",
  "wd:",
  "cidoc:",
  "qudt:",
  "openbadges:",
  "w3c-vc:",
  "dcat:",
  "dct:",
  "dpv:",
  "dpv-pd:",
];

const MIN_DEF_LEN = 40;
const MAX_DEF_LEN = 600;
const PLACEHOLDER_RE = /\b(todo|tbd|fixme|lorem|ipsum|placeholder|xxx)\b/i;

// ROADMAP §2 specifies cosine distance ≥ 0.3 between label and
// definition embeddings. Calibration against the 16 skeleton nodes
// (whose definitions are the project's own exemplars) showed good
// definitions landing at 0.28–0.42 distance while degenerate
// label-restatements land at 0.07–0.18, so 0.3 rejects real
// definitions. 0.2 separates the two groups cleanly on
// bge-small-en-v1.5; revisit if the embedding model changes.
const MAX_LABEL_DEF_SIMILARITY = 0.8;

function fail(code: string, message: string, guidance: string): never {
  throw new PublishError(code, message, { guidance });
}

function firstLang(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

function isSentenceShaped(def: string): boolean {
  const words = def.trim().split(/\s+/);
  if (words.length < 5) return false;
  if (!/^[A-Za-z"'(]/.test(def.trim())) return false;
  if (def === def.toUpperCase()) return false;
  return true;
}

export interface FrictionDeps {
  store: Store;
  embedder: Embedder;
}

/**
 * Throws PublishError on any R2 violation. `labelVec`/`defVec` are the
 * already-computed embeddings of the prefLabel and definition text so
 * the publish path embeds each text exactly once.
 */
export function assertFrictionSync(
  record: ConceptRecord,
  labelVec: Float32Array,
  defVec: Float32Array,
): void {
  const label = firstLang(record.prefLabel);
  const def = firstLang(record.definition as Record<string, string> | undefined);
  const isFork = !!record.forkedFrom;

  // 1. Definition length.
  if (def.length < MIN_DEF_LEN || def.length > MAX_DEF_LEN) {
    fail(
      "ERR_DEFINITION_LENGTH",
      `definition must be ${MIN_DEF_LEN}–${MAX_DEF_LEN} chars (got ${def.length})`,
      "Write one to three natural-English sentences describing what the concept means and what distinguishes it.",
    );
  }

  // 2. Sentence-shaped.
  if (!isSentenceShaped(def)) {
    fail(
      "ERR_DEFINITION_NOT_SENTENCE",
      "definition is not sentence-shaped",
      "The definition must read as natural English prose (at least five words, starting with a letter), not a keyword list.",
    );
  }

  // 3. No placeholder tokens.
  if (PLACEHOLDER_RE.test(def)) {
    fail(
      "ERR_DEFINITION_PLACEHOLDER",
      "definition contains placeholder text",
      "Remove TODO/TBD/lorem-style placeholders and write the real definition before publishing.",
    );
  }

  // 4. Label must not appear verbatim in the definition.
  if (label && def.toLowerCase().includes(label.toLowerCase())) {
    fail(
      "ERR_LABEL_IN_DEFINITION",
      `definition restates the prefLabel "${label}" verbatim`,
      "Define the concept without using its own name — say what it IS, not what it is called.",
    );
  }

  // 5. Semantic check: the definition must add information beyond the label.
  const sim = cosine(labelVec, defVec);
  if (sim > MAX_LABEL_DEF_SIMILARITY) {
    fail(
      "ERR_DEFINITION_RESTATES_LABEL",
      `definition embedding is too close to the label embedding (similarity ${sim.toFixed(3)} > ${MAX_LABEL_DEF_SIMILARITY})`,
      "The definition adds almost no information beyond the label. Describe the concept's distinguishing characteristics, typical fields, or role.",
    );
  }

  if (isFork) return;

  // 6. At least one closeMatch/broadMatch into an approved external vocabulary.
  const external = [...(record.closeMatch ?? []), ...(record.broadMatch ?? [])];
  const hasApproved = external.some((iri) =>
    APPROVED_VOCAB_PREFIXES.some((p) => iri.startsWith(p)),
  );
  if (!hasApproved) {
    fail(
      "ERR_NO_EXTERNAL_MATCH",
      "no closeMatch/broadMatch into an approved external vocabulary",
      `Add at least one closeMatch or broadMatch CURIE using an approved prefix: ${APPROVED_VOCAB_PREFIXES.join(" ")}`,
    );
  }

  // 7. Co-reference: at least one mapping, or an explicit empty array
  //    plus a rationale.
  const co = record.coRefersWith;
  const rationale = (record.coRefersRationale as string | undefined)?.trim();
  const hasCo = Array.isArray(co) && co.length > 0;
  const hasExplicitNone = Array.isArray(co) && co.length === 0 && !!rationale;
  if (!hasCo && !hasExplicitNone) {
    fail(
      "ERR_NO_COREFERENCE",
      "coRefersWith missing: supply at least one mapping, or an explicit empty array plus coRefersRationale",
      "Search the catalog for concepts describing the same real-world referent from another perspective. If none exist, publish with coRefersWith: [] and a coRefersRationale explaining why.",
    );
  }
}

/** Evidence-of-discover check (REQUIREMENTS §R2, last bullet). */
export function assertPriorDiscover(store: Store, sessionId: string | undefined): void {
  if (!sessionId || !store.hasDiscoverEvent(sessionId)) {
    fail(
      "ERR_NO_PRIOR_DISCOVER",
      "no lattice_discover call recorded for this session",
      "Call lattice_discover with a description of this concept first (Checkpoint 1A/1C), passing the same sessionId you use to publish.",
    );
  }
}
