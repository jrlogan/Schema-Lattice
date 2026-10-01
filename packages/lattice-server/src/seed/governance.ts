// Seeds the reserved `governance` context (data-sensitivity classes +
// the attestation record shape). Idempotent, same pattern as the
// skeleton seed; runs after it because governance nodes attach to
// skeleton parents via `broader`.

import type { Store } from "../storage/db.ts";
import {
  hashConcept,
  hashContext,
  conceptUri,
  contextUri,
} from "../hashing/hash.ts";
import type { ConceptRecord, ContextRecord } from "../hashing/types.ts";
import type { SeedResult } from "./seed.ts";
import {
  GOVERNANCE_CONTEXT_SLUG,
  GOVERNANCE_CONTEXT_LABEL,
  GOVERNANCE_CONTEXT_DEFINITION,
  GOVERNANCE_NODES,
  DATA_CLASS_NODES,
  PROVENANCE_NODES,
} from "./governance-data.ts";

export interface GovernanceSeedResult {
  contextUri: string;
  conceptUris: Map<string, string>; // slug -> uri
  /** slug -> sensitivityRank, for profile computation. */
  ranks: Map<string, number>;
  /** slug -> assuranceRank, for capture-provenance classes. */
  assurance: Map<string, number>;
  createdConcepts: number;
}

export function seedGovernance(
  store: Store,
  skeleton: SeedResult,
): GovernanceSeedResult {
  const ctxRecord: ContextRecord = {
    type: "ConceptScheme",
    prefLabel: { en: GOVERNANCE_CONTEXT_LABEL },
    definition: { en: GOVERNANCE_CONTEXT_DEFINITION },
  };
  const ctxHash = hashContext(ctxRecord);
  const ctxUri = contextUri(GOVERNANCE_CONTEXT_SLUG, ctxHash);
  if (!store.hasContext(ctxUri)) {
    store.insertContext({
      uri: ctxUri,
      slug: GOVERNANCE_CONTEXT_SLUG,
      hash: ctxHash,
      record: { ...ctxRecord, uri: ctxUri },
    });
  }

  const bySlug = new Map<string, string>();
  const ranks = new Map<string, number>();
  const assurance = new Map<string, number>();
  let created = 0;

  for (const node of GOVERNANCE_NODES) {
    const broaderUri = skeleton.conceptUris.get(node.broaderSkeletonSlug);
    if (!broaderUri) {
      throw new Error(
        `governance seed: skeleton slug ${node.broaderSkeletonSlug} not found for ${node.slug}`,
      );
    }
    const record: ConceptRecord = {
      type: "Concept",
      inScheme: ctxUri,
      prefLabel: { en: node.prefLabel },
      definition: { en: node.definition },
      broader: [broaderUri],
      ...(node.closeMatch.length ? { closeMatch: node.closeMatch } : {}),
      conceptKind: node.conceptKind,
      ...(node.sensitivityRank !== undefined
        ? { sensitivityRank: node.sensitivityRank }
        : {}),
      ...(node.assuranceRank !== undefined
        ? { assuranceRank: node.assuranceRank }
        : {}),
      ...(node.structure ? { structure: node.structure } : {}),
      rootAncestor: broaderUri,
    };
    const hash = hashConcept(record);
    const uri = conceptUri(GOVERNANCE_CONTEXT_SLUG, node.slug, hash);
    bySlug.set(node.slug, uri);
    if (node.sensitivityRank !== undefined) ranks.set(node.slug, node.sensitivityRank);
    if (node.assuranceRank !== undefined) assurance.set(node.slug, node.assuranceRank);

    if (store.hasConcept(uri)) continue;
    store.insertConcept({
      uri,
      contextSlug: GOVERNANCE_CONTEXT_SLUG,
      conceptSlug: node.slug,
      hash,
      record: { ...record, uri },
    });
    created++;
  }

  store.logEvent("seed-governance", {
    context: ctxUri,
    createdConcepts: created,
  });

  return { contextUri: ctxUri, conceptUris: bySlug, ranks, assurance, createdConcepts: created };
}

export function dataClassSlugs(): string[] {
  return DATA_CLASS_NODES.map((n) => n.slug);
}

export function provenanceSlugs(): string[] {
  return PROVENANCE_NODES.map((n) => n.slug);
}
