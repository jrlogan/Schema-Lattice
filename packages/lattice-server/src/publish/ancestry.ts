// R1 ancestry gate — specs/root-skeleton.md + ROADMAP.md §1.
//
// Every publish must resolve (via broader / derivedFrom / forkedFrom
// edges) to a URI in the reserved skeleton context. Walk at most
// MAX_DEPTH hops; cycle-guard via visited set. Return ok=true only
// when we hit a skeleton URI.

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { PublishError } from "./errors.ts";

const MAX_DEPTH = 64;

export interface AncestryContext {
  skeletonUris: Set<string>;
}

export interface AncestryOk {
  ok: true;
  rootAncestor: string;
  depth: number;
}
export interface AncestryFail {
  ok: false;
  reason: string;
  visited: string[];
}
export type AncestryResult = AncestryOk | AncestryFail;

export function checkAncestry(
  store: Store,
  record: ConceptRecord,
  ctx: AncestryContext,
): AncestryResult {
  // Collect the starting frontier: everything the record claims as a parent.
  const frontier: string[] = [];
  for (const u of record.broader ?? []) frontier.push(u);
  if (record.derivedFrom) frontier.push(record.derivedFrom);
  if (record.forkedFrom) frontier.push(record.forkedFrom);
  if (record.rootAncestor) frontier.push(record.rootAncestor);

  if (frontier.length === 0) {
    return {
      ok: false,
      reason:
        "no parent URIs supplied — every original concept must declare a rootAncestor that resolves to the skeleton",
      visited: [],
    };
  }

  const visited = new Set<string>();
  const queue: Array<{ uri: string; depth: number }> = frontier.map((uri) => ({
    uri,
    depth: 1,
  }));

  while (queue.length) {
    const { uri, depth } = queue.shift()!;
    if (visited.has(uri)) continue;
    visited.add(uri);

    if (ctx.skeletonUris.has(uri)) {
      return { ok: true, rootAncestor: uri, depth };
    }
    if (depth >= MAX_DEPTH) continue;

    const parent = store.getConcept(uri);
    if (!parent) {
      // Unknown URI — treat as dead end. We continue walking other
      // branches in case one succeeds.
      continue;
    }
    for (const u of parent.broader ?? []) queue.push({ uri: u, depth: depth + 1 });
    if (parent.derivedFrom) queue.push({ uri: parent.derivedFrom, depth: depth + 1 });
    if (parent.forkedFrom) queue.push({ uri: parent.forkedFrom, depth: depth + 1 });
  }

  return {
    ok: false,
    reason: "no lineage path reaches a skeleton root",
    visited: [...visited],
  };
}

export function assertAncestry(
  store: Store,
  record: ConceptRecord,
  ctx: AncestryContext,
): AncestryOk {
  const result = checkAncestry(store, record, ctx);
  if (!result.ok) {
    throw new PublishError("ERR_NO_ROOT_ANCESTOR", result.reason, {
      visited: result.visited,
    });
  }
  return result;
}
