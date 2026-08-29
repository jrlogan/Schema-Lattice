// Field-level data classification (specs/data-classification.md).
//
// Any structure field MAY carry `classification: "<data-class slug>"`
// (or the class's full URI). Absence is fine — classification is
// advisory — but a value that names an unknown class is rejected, so
// profiles computed downstream can be trusted. The classification
// lives inside `structure`, which is hashed: changing a field's
// sensitivity is a semantic change and produces a new concept version.

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import type { GovernanceSeedResult } from "../seed/governance.ts";
import { PublishError } from "./errors.ts";

interface StructureField {
  name?: string;
  classification?: string;
  [k: string]: unknown;
}

function fieldsOf(record: ConceptRecord): StructureField[] {
  const s = record.structure as { fields?: unknown } | undefined;
  if (!s || !Array.isArray(s.fields)) return [];
  return s.fields as StructureField[];
}

/** Resolve a classification value (slug or URI) to a class slug, or null. */
export function resolveClass(
  gov: GovernanceSeedResult,
  value: string,
): string | null {
  if (gov.ranks.has(value)) return value;
  for (const [slug, uri] of gov.conceptUris) {
    if (uri === value && gov.ranks.has(slug)) return slug;
  }
  return null;
}

export function assertValidClassifications(
  gov: GovernanceSeedResult,
  record: ConceptRecord,
): void {
  for (const f of fieldsOf(record)) {
    if (f.classification === undefined) continue;
    if (typeof f.classification !== "string" || !resolveClass(gov, f.classification)) {
      throw new PublishError(
        "ERR_UNKNOWN_CLASSIFICATION",
        `field ${JSON.stringify(f.name ?? "?")} has unknown classification ${JSON.stringify(f.classification)}`,
        {
          guidance: `Use one of the governance data-class slugs (${[...gov.ranks.keys()].join(", ")}) or the class concept's full URI. Resolve the governance context to read their definitions.`,
        },
      );
    }
  }
}

export interface SensitivityProfile {
  totalFields: number;
  classifiedFields: number;
  byClass: Record<string, number>;
  maxRank: number | null;
  maxClass: string | null;
  /** Concepts contributing no classified fields (coverage gaps). */
  unclassifiedConcepts: string[];
}

/**
 * Aggregate the field classifications across a set of concept URIs —
 * typically everything in one project's schemalattice.json manifest.
 * The rank-to-policy mapping (review tiers, handling rules) is the
 * adopting organization's, not the lattice's.
 */
export function sensitivityProfile(
  store: Store,
  gov: GovernanceSeedResult,
  conceptUris: string[],
): SensitivityProfile {
  const byClass: Record<string, number> = {};
  let totalFields = 0;
  let classifiedFields = 0;
  let maxRank: number | null = null;
  let maxClass: string | null = null;
  const unclassifiedConcepts: string[] = [];

  for (const uri of conceptUris) {
    const record = store.getConcept(uri);
    if (!record) continue;
    let sawClassified = false;
    for (const f of fieldsOf(record)) {
      totalFields++;
      if (typeof f.classification !== "string") continue;
      const slug = resolveClass(gov, f.classification);
      if (!slug) continue;
      classifiedFields++;
      sawClassified = true;
      byClass[slug] = (byClass[slug] ?? 0) + 1;
      const rank = gov.ranks.get(slug)!;
      if (maxRank === null || rank > maxRank) {
        maxRank = rank;
        maxClass = slug;
      }
    }
    if (!sawClassified) unclassifiedConcepts.push(uri);
  }

  return { totalFields, classifiedFields, byClass, maxRank, maxClass, unclassifiedConcepts };
}
