// lattice_publish_fork — derive a new concept from an existing one.
//
// A fork is an ordinary concept publish (same ancestry, friction, and
// classification gates) plus a validated structural changeset and a
// `forkedFrom` lineage edge.

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { PublishError } from "./errors.ts";
import { compareConcepts } from "../query/compare.ts";
import {
  checkChangeset,
  structureFieldNames,
  type Changeset,
  type ChangesetWarning,
} from "./changeset.ts";
import {
  publishConcept,
  type PublishDeps,
  type PublishConceptOk,
} from "./publish.ts";

export interface PublishForkInput {
  parentUri: string;
  contextSlug: string;
  conceptSlug: string;
  prefLabel: string;
  definition: string;
  altLabels?: string[];
  changeset: Changeset;
  structure?: unknown;
  coRefersWith?: string[];
  sourceAttribution?: {
    importedFrom?: string;
    authoredBy?: string[];
    sourceLicense?: string;
  };
  sessionId?: string;
  /** Authenticated writer, for the audit log. */
  actor?: string;
}

export interface PublishForkOk extends PublishConceptOk {
  forkedFrom: string;
  upgradable: boolean;
  warnings: ChangesetWarning[];
}

export async function publishFork(
  deps: PublishDeps,
  input: PublishForkInput,
): Promise<PublishForkOk> {
  const parent = deps.store.getConcept(input.parentUri);
  if (!parent) {
    throw new PublishError(
      "ERR_UNKNOWN_PARENT",
      `fork parent not found: ${input.parentUri} — re-run discover, the URI may be stale`,
      { parentUri: input.parentUri },
    );
  }

  const childStructure = input.structure ?? null;
  const check = checkChangeset(
    input.changeset,
    structureFieldNames(parent.structure),
    structureFieldNames(childStructure),
  );

  const inScheme = contextUriFor(deps.store, input.contextSlug, parent.inScheme);

  const record: ConceptRecord = {
    type: "Concept",
    inScheme,
    prefLabel: { en: input.prefLabel },
    definition: { en: input.definition },
    forkedFrom: input.parentUri,
    changeset: { ...input.changeset, upgradable: check.upgradable },
  };
  if (input.altLabels?.length) {
    record.altLabel = { en: input.altLabels.join("; ") };
  }
  if (childStructure) record.structure = childStructure;
  if (input.coRefersWith?.length) record.coRefersWith = input.coRefersWith;
  if (input.sourceAttribution?.importedFrom) {
    record.importedFrom = input.sourceAttribution.importedFrom;
  }
  if (input.sourceAttribution?.authoredBy?.length) {
    record.createdBy = input.sourceAttribution.authoredBy;
  }
  if (input.sourceAttribution?.sourceLicense) {
    record.sourceLicense = input.sourceAttribution.sourceLicense;
  }

  const published = await publishConcept(deps, {
    contextSlug: input.contextSlug,
    conceptSlug: input.conceptSlug,
    record,
    sessionId: input.sessionId,
  });

  // Changeset ops describe field structure only. Sensitivity, capture
  // provenance, invariants and lifecycle changes are hashed into the child
  // but invisible in its ops, so name them here; lattice_compare shows them.
  const semantic = semanticChangesOutsideChangeset(parent, input.parentUri, record, published.uri);
  if (semantic) check.warnings.push(semantic);

  deps.store.logEvent("fork", {
    uri: published.uri,
    parentUri: input.parentUri,
    upgradable: check.upgradable,
    opCount: input.changeset.ops.length,
    sessionId: input.sessionId ?? null,
  }, input.actor ?? null);

  return {
    ...published,
    forkedFrom: input.parentUri,
    upgradable: check.upgradable,
    warnings: check.warnings,
  };
}

/**
 * Resolve the `inScheme` URI for the fork's target context slug. Forks may
 * land in a different context than their parent, so prefer a real context
 * with that slug and fall back to the parent's scheme.
 */
function contextUriFor(store: Store, contextSlug: string, parentScheme: string): string {
  const matches = store.contextsWithSlug(contextSlug);
  if (matches.length > 0) return matches[0].uri;
  return parentScheme;
}

const SEMANTIC_ATTRIBUTES = ["classification", "provenance", "immutableFrom"];

function semanticChangesOutsideChangeset(
  parent: ConceptRecord,
  parentUri: string,
  child: ConceptRecord,
  childUri: string,
): ChangesetWarning | null {
  const cmp = compareConcepts(parentUri, parent, childUri, child);
  const notes: string[] = [];
  for (const row of cmp.fields) {
    if (!row.a || !row.b) continue;
    const changed = row.differences.filter((d) => SEMANTIC_ATTRIBUTES.includes(d));
    if (changed.length) notes.push(`${row.b.name} (${changed.join(", ")})`);
  }
  const lc = cmp.lifecycle;
  if (lc && (!lc.a || !lc.b)) notes.push(lc.b ? "adds a lifecycle" : "drops the lifecycle");
  else if (lc && (lc.statesOnlyA.length || lc.statesOnlyB.length || lc.transitionsOnlyA.length || lc.transitionsOnlyB.length)) {
    notes.push("changes the lifecycle");
  }
  if (notes.length === 0) return null;
  return {
    kind: "semantic-change-outside-changeset",
    message:
      `the fork also changes ${notes.join("; ")}, which changeset ops cannot express. ` +
      "They are part of the fork's identity; call lattice_compare on the parent and the fork to see them side by side.",
  };
}
