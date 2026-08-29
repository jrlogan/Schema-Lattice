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
  /** Caller session id; logged so R2 can verify discover-before-publish. */
  sessionId?: string;
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

export interface DiscoverResponse {
  query: string;
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
  const [queryVec] = await embedder.embed([input.description]);

  // Over-fetch so re-ranking has room to work.
  const neighbors = vectors.knn(queryVec, Math.max(limit * 2, 20));

  const candidates: DiscoverCandidate[] = [];
  for (const n of neighbors) {
    const record = store.getConcept(n.uri);
    const meta = store.getConceptMeta(n.uri);
    if (!record || !meta) continue;

    const contextUri = (record.inScheme as string) ?? "";
    // Reserved vocabularies are excluded unless explicitly hinted at.
    if (reserved.has(contextUri) && input.contextHint !== contextUri) continue;
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
    query: input.description,
    resultCount: results.length,
    topUri: top?.uri ?? null,
    topSimilarity: top?.similarity ?? null,
  });

  return { query: input.description, results, suggestions: { refinements }, sessionId };
}
