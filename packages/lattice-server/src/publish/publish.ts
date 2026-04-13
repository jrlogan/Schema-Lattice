// The unified publish entry point for v0.1 M1.
//
// Gate order (see REQUIREMENTS.md "Cross-cutting"):
//   1. R1 ancestry                      [ENFORCED HERE]
//   2. R2 metadata friction             [TODO M2]
//   3. R3 shard target                  [TODO M3]
//   4. Changeset op validation          [TODO — fork path only]
//   5. Canonicalize + hash
//   6. Duplicate detection               [TODO M2 — needs embeddings]
//   7. Write blob + metadata
//   8. Emit `published` event            [for R4 Local Register pull]

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { hashConcept, conceptUri, validateSlug } from "../hashing/hash.ts";
import { assertAncestry, type AncestryContext } from "./ancestry.ts";
import { PublishError } from "./errors.ts";

export interface PublishConceptInput {
  contextSlug: string;
  conceptSlug: string;
  record: ConceptRecord;
}

export interface PublishConceptOk {
  ok: true;
  uri: string;
  hash: string;
  rootAncestor: string;
}

export function publishConcept(
  store: Store,
  ancestryCtx: AncestryContext,
  input: PublishConceptInput,
): PublishConceptOk {
  validateSlug(input.contextSlug);
  validateSlug(input.conceptSlug);

  // Required shape check: label + definition must exist. Full R2
  // friction validation lands in M2.
  if (!input.record.prefLabel || Object.keys(input.record.prefLabel).length === 0) {
    throw new PublishError("ERR_MISSING_PREFLABEL", "prefLabel is required");
  }
  if (!input.record.definition || Object.keys(input.record.definition).length === 0) {
    throw new PublishError(
      "ERR_MISSING_DEFINITION",
      "definition is required (full R2 friction check lands in M2)",
    );
  }
  if (!input.record.inScheme) {
    throw new PublishError("ERR_MISSING_INSCHEME", "inScheme is required");
  }

  // R1 — ancestry gate.
  const ancestry = assertAncestry(store, input.record, ancestryCtx);

  // Stamp the resolved root ancestor onto the record before hashing
  // so the identity is self-describing.
  const stamped: ConceptRecord = {
    ...input.record,
    rootAncestor: ancestry.rootAncestor,
  };

  // R2 TODO (M2): friction validation (definition quality, coRefersWith,
  //              closeMatch, prior discover in session).
  // R3 TODO (M3): shard gate — inScheme must name a writable shard.

  const hash = hashConcept(stamped);
  const uri = conceptUri(input.contextSlug, input.conceptSlug, hash);

  if (store.hasConcept(uri)) {
    // Idempotent: identical content re-published is a no-op.
    return { ok: true, uri, hash, rootAncestor: ancestry.rootAncestor };
  }

  store.insertConcept({
    uri,
    contextSlug: input.contextSlug,
    conceptSlug: input.conceptSlug,
    hash,
    record: { ...stamped, uri },
  });
  store.logEvent("published", { uri, hash, rootAncestor: ancestry.rootAncestor });

  return { ok: true, uri, hash, rootAncestor: ancestry.rootAncestor };
}
