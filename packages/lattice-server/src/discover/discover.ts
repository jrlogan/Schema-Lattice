// `lattice_discover` core — specs/mcp-tools.md "lattice_discover".
//
// Embed the natural-language description, nearest-neighbor over the
// vector index, hydrate summaries, re-rank. Per DECISIONS.md
// ("Ranking blends vector similarity and adoption"), similarity is the
// primary key and adoption count the tie-breaker; an optional
// contextHint gives a small ranking bump without touching the reported
// similarity score.

import { randomUUID } from "node:crypto";
import type { Store } from "../storage/db.ts";
import type { Embedder } from "./embedder.ts";
import type { VectorIndex } from "./vectors.ts";

export interface DiscoverOptions {
  /**
   * Contexts holding reserved vocabularies (e.g. `governance` data
   * classes). Their concepts are for tagging fields, not for adopting as
   * domain concepts, so they never compete in discovery — unless the
   * caller asks for that context by name via contextHint.
   */
  reservedContexts?: string[];
}

export interface DiscoverInput {
  description: string;
  contextHint?: string;
  limit?: number;
  /**
   * Restrict candidates to these context URIs (already resolved from slugs
   * by the caller). A reserved context named here is searched like any
   * other — asking for it by name is the explicit opt-in.
   */
  contexts?: string[];
  /** Caller session id; logged so R2 can verify discover-before-publish. */
  sessionId?: string;
  /**
   * When true, the query TEXT is not recorded — the event still logs
   * (so publishing under this sessionId works) but the wording never
   * appears in demand reports. For exploring ideas you aren't ready
   * to share even in aggregate.
   */
  ephemeral?: boolean;
}

export interface DiscoverCandidate {
  uri: string;
  prefLabel: string;
  definitionExcerpt: string;
  context: { uri: string; title: string };
  similarity: number;
  adoptionCount: number;
  forkCount: number;
  lineageDepth: number;
  forkedFrom?: string;
  nearestNeighborsCount: number;
}

/** The decision-tree band the top result falls in (specs/ai-checkpoints.md). */
export type DiscoverVerdict = "adopt" | "fork" | "distant" | "no-match";

export interface DiscoverResponse {
  query: string;
  /**
   * Band of the TOP result, so a caller cannot mistake the least-bad
   * candidate for a match. On "no-match" the results are still listed (they
   * are the nearest things that exist) but none of them should be adopted
   * or forked.
   */
  verdict: DiscoverVerdict;
  /** One-sentence instruction matching the verdict. */
  guidance: string;
  /** Echo of the context filter, when one was applied. */
  contexts?: string[];
  results: DiscoverCandidate[];
  suggestions: { refinements: string[] };
  /**
   * The session id this search was logged under — the caller's own, or a
   * server-generated one when none was supplied. Publishing requires
   * evidence of a prior discover under the same id (R2), so clients must
   * quote this back in publish calls.
   */
  sessionId: string;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const CONTEXT_HINT_BONUS = 0.03;
/** Neighborhood-crowding threshold for nearestNeighborsCount. */
const NEIGHBOR_SIM = 0.8;
/**
 * Below this, the top result is treated as "no usable match" and
 * refinements are suggested. Calibrated to bge-small-en-v1.5, whose
 * cosine floor for unrelated short texts sits around 0.43–0.51:
 * near-duplicates score ~0.94, good candidates ~0.65–0.75, unrelated
 * ~0.45–0.51. Matches the decision-tree bands in
 * specs/ai-checkpoints.md; recalibrate if the embedding model changes.
 */
const NO_MATCH_SIM = 0.55;
/** Bands above NO_MATCH_SIM, same source as above. */
const ADOPT_SIM = 0.85;
const FORK_SIM = 0.65;

function verdictFor(top: number | undefined): DiscoverVerdict {
  if (top === undefined || top < NO_MATCH_SIM) return "no-match";
  if (top < FORK_SIM) return "distant";
  if (top < ADOPT_SIM) return "fork";
  return "adopt";
}

function guidanceFor(verdict: DiscoverVerdict, ephemeral: boolean, filtered: boolean): string {
  switch (verdict) {
    case "adopt":
      return "The top result is a near-exact match: resolve it and adopt its URI if the fields fit.";
    case "fork":
      return "The top result is close but not exact: resolve it and fork with an explicit changeset if its meaning is the same.";
    case "distant":
      return "The top result is only loosely related: resolve it and decide by meaning, not score; reject it if the referent differs.";
    case "no-match":
      return (
        "Nothing in the catalog" + (filtered ? " (within the requested contexts)" : "") +
        " matches. Do NOT adopt or fork any listed result — they are only the nearest existing concepts. " +
        "Refine the description once, then mine open-source sources or proceed under your own model." +
        (ephemeral ? "" : " This query is recorded in the public demand report as unmet vocabulary.")
      );
  }
}

function firstLang(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

export async function discover(
  store: Store,
  vectors: VectorIndex,
  embedder: Embedder,
  input: DiscoverInput,
  options: DiscoverOptions = {},
): Promise<DiscoverResponse> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  // Without a caller-supplied session id, mint one and hand it back —
  // otherwise a casual GET /discover would silently fail R2's
  // discover-before-publish check at publish time.
  const sessionId = input.sessionId?.trim() || `sess-${randomUUID()}`;
  const reserved = new Set(options.reservedContexts ?? []);
  const only = input.contexts && input.contexts.length > 0 ? new Set(input.contexts) : null;
  const [queryVec] = await embedder.embed([input.description]);

  // Over-fetch so re-ranking has room to work. A context filter can discard
  // most of the global neighborhood, so then scan the whole index — the
  // catalog is small and knn over it is cheap next to embedding the query.
  const neighbors = vectors.knn(queryVec, only ? vectors.count() : Math.max(limit * 2, 20));

  const candidates: DiscoverCandidate[] = [];
  for (const n of neighbors) {
    const record = store.getConcept(n.uri);
    const meta = store.getConceptMeta(n.uri);
    if (!record || !meta) continue;

    const contextUri = (record.inScheme as string) ?? "";
    if (only && !only.has(contextUri)) continue;
    // Reserved vocabularies are excluded unless explicitly asked for.
    if (reserved.has(contextUri) && input.contextHint !== contextUri && !only?.has(contextUri)) {
      continue;
    }
    const contextTitle = firstLang(
      store.getContext(contextUri)?.prefLabel as Record<string, string> | undefined,
    );

    // Fork lineage depth: hops up the forkedFrom chain.
    let lineageDepth = 0;
    let cursor = record.forkedFrom as string | undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor) && lineageDepth < 64) {
      seen.add(cursor);
      lineageDepth++;
      cursor = store.getConcept(cursor)?.forkedFrom as string | undefined;
    }

    // Neighborhood crowding: how many OTHER concepts sit close to this one.
    let nearestNeighborsCount = 0;
    const ownVec = vectors.vectorOf(n.uri);
    if (ownVec) {
      nearestNeighborsCount = vectors
        .knn(ownVec, 25)
        .filter((m) => m.uri !== n.uri && m.similarity >= NEIGHBOR_SIM).length;
    }

    candidates.push({
      uri: n.uri,
      prefLabel: firstLang(record.prefLabel),
      definitionExcerpt: firstLang(record.definition).slice(0, 200),
      context: { uri: contextUri, title: contextTitle },
      similarity: Number(n.similarity.toFixed(4)),
      adoptionCount: meta.adoptionCount,
      forkCount: store.forkCount(n.uri),
      lineageDepth,
      ...(record.forkedFrom ? { forkedFrom: record.forkedFrom as string } : {}),
      nearestNeighborsCount,
    });
  }

  candidates.sort((a, b) => {
    const aScore =
      a.similarity + (input.contextHint && a.context.uri === input.contextHint ? CONTEXT_HINT_BONUS : 0);
    const bScore =
      b.similarity + (input.contextHint && b.context.uri === input.contextHint ? CONTEXT_HINT_BONUS : 0);
    if (bScore !== aScore) return bScore - aScore;
    return b.adoptionCount - a.adoptionCount;
  });

  const results = candidates.slice(0, limit);

  const refinements: string[] = [];
  const top = results[0];
  if (!top || top.similarity < NO_MATCH_SIM) {
    refinements.push(
      "Include the domain in the description (e.g. 'scuba', 'civic permitting', 'equipment lending'), not just the record type.",
      "Describe what the record captures (its key fields) rather than the app that uses it.",
    );
  }

  store.logEvent("discover", {
    sessionId,
    query: input.ephemeral ? null : input.description,
    resultCount: results.length,
    topUri: top?.uri ?? null,
    topSimilarity: top?.similarity ?? null,
  });

  const verdict = verdictFor(top?.similarity);
  return {
    query: input.description,
    verdict,
    guidance: guidanceFor(verdict, input.ephemeral === true, only !== null),
    ...(only ? { contexts: [...only] } : {}),
    results,
    suggestions: { refinements },
    sessionId,
  };
}
