// Read-only query surfaces: lattice_list_context and lattice_stats.
//
// Neither logs an event — stats lookups during an AI session must not
// pollute the signal they report on.

import type { Store } from "../storage/db.ts";
import type { ConceptRecord } from "../hashing/types.ts";

function firstLang(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

function excerpt(text: string, n = 200): string {
  return text.length <= n ? text : text.slice(0, n - 1) + "…";
}

// ---------------------------------------------------------------
// lattice_list_context

export interface ListContextResponse {
  context: {
    uri: string;
    title: string;
    definition: string;
    parentContexts: string[];
  };
  concepts: Array<{
    uri: string;
    prefLabel: string;
    definitionExcerpt: string;
    adoptionCount: number;
    isTopConcept: boolean;
  }>;
  totalCount: number;
  hasMore: boolean;
}

export function listContext(
  store: Store,
  contextUri: string,
  limit = 100,
  offset = 0,
): ListContextResponse | null {
  const ctx = store.getContext(contextUri);
  if (!ctx) return null;
  const slug = slugOf(contextUri);
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = store.listConceptsInContext(slug, capped, Math.max(offset, 0));
  const totalCount = store.countConceptsInContext(slug);

  const concepts = rows.map((row) => {
    const record = store.getConcept(row.uri);
    const broader = record?.broader ?? [];
    return {
      uri: row.uri,
      prefLabel: firstLang(record?.prefLabel),
      definitionExcerpt: excerpt(
        firstLang(record?.definition as Record<string, string> | undefined),
      ),
      adoptionCount: adoptionCount(store, row.uri),
      // Top concepts have no broader parent inside this same context.
      isTopConcept: broader.every((b) => slugOf(b) !== slug),
    };
  });

  return {
    context: {
      uri: contextUri,
      title: firstLang(ctx.prefLabel),
      definition: firstLang(ctx.definition as Record<string, string> | undefined),
      parentContexts: (ctx.parentContexts as string[] | undefined) ?? [],
    },
    concepts,
    totalCount,
    hasMore: Math.max(offset, 0) + concepts.length < totalCount,
  };
}

/** `.../c/{context}/{slug}@{hash}` or `.../s/{context}@{hash}` → context slug. */
function slugOf(uri: string): string {
  const concept = uri.match(/\/c\/([^/]+)\//);
  if (concept) return concept[1];
  const scheme = uri.match(/\/s\/([^/@]+)@/);
  return scheme ? scheme[1] : "";
}

// ---------------------------------------------------------------
// lattice_stats

export interface ConceptStats {
  uri: string;
  stats: {
    adoptionCount: number;
    forkCount: number;
    directChildren: number;
    totalDescendants: number;
    firstSeen: string;
    lastActivity: string;
  };
  trending: {
    adoptionsLast30Days: number;
    forksLast30Days: number;
  };
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: ConceptStats }>();

/**
 * Adoptions are counted from the app registry: an app that registered a
 * usage with status `adopted` is the only adoption signal the lattice has
 * (publishing a fork is a fork, not an adoption).
 */
function adoptionCount(store: Store, uri: string): number {
  try {
    const row = store.db
      .prepare(
        `SELECT COUNT(*) AS n FROM app_usages
          WHERE concept_uri = ? AND status = 'adopted'`,
      )
      .get(uri) as { n: number };
    return row.n;
  } catch {
    // Registry tables are created lazily by Registry; absent means zero.
    return 0;
  }
}

/**
 * Adoptions recorded in the last window. `app_usages` has no timestamp of
 * its own, so the owning app's last registration stands in for when the
 * usage was declared.
 */
function recentAdoptions(store: Store, uri: string, sinceIso: string): number {
  try {
    const row = store.db
      .prepare(
        `SELECT COUNT(*) AS n FROM app_usages u
           JOIN apps a ON a.slug = u.app_slug
          WHERE u.concept_uri = ? AND u.status = 'adopted' AND a.updated_at >= ?`,
      )
      .get(uri, sinceIso) as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

/** Transitive size of the fork tree below `uri`, excluding `uri` itself. */
function descendantCount(store: Store, uri: string): number {
  const seen = new Set<string>();
  const queue = [uri];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const child of store.forkChildren(current)) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen.size;
}

export function conceptStats(store: Store, uri: string): ConceptStats | null {
  const hit = cache.get(uri);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const meta = store.getConceptMeta(uri);
  if (!meta) return null;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const value: ConceptStats = {
    uri,
    stats: {
      adoptionCount: adoptionCount(store, uri),
      forkCount: store.forkCount(uri),
      directChildren: store.forkChildren(uri).length,
      totalDescendants: descendantCount(store, uri),
      firstSeen: meta.createdAt,
      lastActivity: store.lastEventFor(uri) ?? meta.createdAt,
    },
    trending: {
      adoptionsLast30Days: recentAdoptions(store, uri, thirtyDaysAgo),
      forksLast30Days: store.countEventsSince("fork", uri, thirtyDaysAgo),
    },
  };
  cache.set(uri, { at: Date.now(), value });
  return value;
}

/** Test hook — stats are cached for 60s, which tests need to bypass. */
export function clearStatsCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------

export function conceptSummary(record: ConceptRecord): {
  prefLabel: string;
  definition: string;
} {
  return {
    prefLabel: firstLang(record.prefLabel),
    definition: firstLang(record.definition as Record<string, string> | undefined),
  };
}
