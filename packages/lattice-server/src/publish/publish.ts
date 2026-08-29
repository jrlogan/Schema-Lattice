// The unified publish entry point — v0.1 M2.
//
// Gate order (see REQUIREMENTS.md "Cross-cutting"):
//   1. R1 ancestry                      [ENFORCED]
//   2. R2 metadata friction             [ENFORCED — M2]
//   3. R3 shard target                  [TODO M3]
//   4. Changeset op validation          [TODO — fork path only]
//   5. Canonicalize + hash
//   6. Duplicate detection              [ENFORCED — M2, warning not block]
//   7. Write blob + metadata + vector
//   8. Emit `published` event            [for R4 Local Register pull]

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { hashConcept, conceptUri, validateSlug } from "../hashing/hash.ts";
import { assertAncestry, type AncestryContext } from "./ancestry.ts";
import { assertFrictionSync, assertPriorDiscover } from "./friction.ts";
import { assertValidClassifications } from "./classification.ts";
import { PublishError } from "./errors.ts";
import type { Embedder } from "../discover/embedder.ts";
import type { VectorIndex } from "../discover/vectors.ts";
import type { GovernanceSeedResult } from "../seed/governance.ts";

/** Cosine similarity at or above which a publish gets a duplicate warning. */
export const DUPLICATE_WARN_SIMILARITY = 0.85;

export interface PublishDeps {
  store: Store;
  ancestryCtx: AncestryContext;
  embedder: Embedder;
  vectors: VectorIndex;
  governance: GovernanceSeedResult;
}

export interface PublishConceptInput {
  contextSlug: string;
  conceptSlug: string;
  record: ConceptRecord;
  /** Session id matching a prior lattice_discover call (R2). */
  sessionId?: string;
}

export interface DuplicateWarning {
  uri: string;
  prefLabel: string;
  similarity: number;
}

export interface PublishConceptOk {
  ok: true;
  uri: string;
  hash: string;
  rootAncestor: string;
  duplicateWarnings: DuplicateWarning[];
}

function firstLang(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

/** Text embedded for the discovery index: label + definition. */
export function embeddingText(record: ConceptRecord): string {
  const label = firstLang(record.prefLabel);
  const def = firstLang(record.definition as Record<string, string> | undefined);
  return def ? `${label}. ${def}` : label;
}

export async function publishConcept(
  deps: PublishDeps,
  input: PublishConceptInput,
): Promise<PublishConceptOk> {
  const { store, ancestryCtx, embedder, vectors } = deps;
  validateSlug(input.contextSlug);
  validateSlug(input.conceptSlug);

  // Required shape checks.
  if (!input.record.prefLabel || Object.keys(input.record.prefLabel).length === 0) {
    throw new PublishError("ERR_MISSING_PREFLABEL", "prefLabel is required");
  }
  if (!input.record.definition || Object.keys(input.record.definition).length === 0) {
    throw new PublishError("ERR_MISSING_DEFINITION", "definition is required");
  }
  if (!input.record.inScheme) {
    throw new PublishError("ERR_MISSING_INSCHEME", "inScheme is required");
  }

  // Gate 1 — R1 ancestry.
  const ancestry = assertAncestry(store, input.record, ancestryCtx);

  // Gate 2 — R2 metadata friction. Evidence-of-discover first (cheap),
  // then content checks; the semantic check reuses embeddings computed
  // once here and shared with duplicate detection below.
  assertPriorDiscover(store, input.sessionId);
  const label = firstLang(input.record.prefLabel);
  const def = firstLang(input.record.definition as Record<string, string>);
  const indexText = embeddingText(input.record);
  const [labelVec, defVec, indexVec] = await embedder.embed([label, def, indexText]);
  assertFrictionSync(input.record, labelVec, defVec);

  // Field classifications, when present, must name known data classes
  // (specs/data-classification.md). Absence is fine — advisory scheme.
  assertValidClassifications(deps.governance, input.record);

  // Gate 3 — R3 shard target. TODO M3.
  // Gate 4 — changeset op validation. TODO with publish_fork.

  // Gate 5 — canonicalize + hash.
  const stamped: ConceptRecord = {
    ...input.record,
    rootAncestor: ancestry.rootAncestor,
  };
  const hash = hashConcept(stamped);
  const uri = conceptUri(input.contextSlug, input.conceptSlug, hash);

  if (store.hasConcept(uri)) {
    // Idempotent: identical content re-published is a no-op.
    return { ok: true, uri, hash, rootAncestor: ancestry.rootAncestor, duplicateWarnings: [] };
  }

  // Gate 6 — duplicate detection: warn, never block.
  const duplicateWarnings: DuplicateWarning[] = vectors
    .knn(indexVec, 10)
    .filter((n) => n.similarity >= DUPLICATE_WARN_SIMILARITY)
    .map((n) => ({
      uri: n.uri,
      prefLabel: firstLang(store.getConcept(n.uri)?.prefLabel),
      similarity: Number(n.similarity.toFixed(4)),
    }));

  // Gate 7 — write blob, metadata, vector.
  store.insertConcept({
    uri,
    contextSlug: input.contextSlug,
    conceptSlug: input.conceptSlug,
    hash,
    record: { ...stamped, uri },
  });
  vectors.add(uri, indexVec);

  // Gate 8 — advisory event.
  store.logEvent("published", {
    uri,
    hash,
    rootAncestor: ancestry.rootAncestor,
    sessionId: input.sessionId ?? null,
    duplicateWarningCount: duplicateWarnings.length,
  });

  return { ok: true, uri, hash, rootAncestor: ancestry.rootAncestor, duplicateWarnings };
}
