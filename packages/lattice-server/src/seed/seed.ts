import type { Store } from "../storage/db.ts";
import {
  hashConcept,
  hashContext,
  conceptUri,
  contextUri,
} from "../hashing/hash.ts";
import type { ConceptRecord, ContextRecord } from "../hashing/types.ts";
import {
  SKELETON_CONTEXT_SLUG,
  SKELETON_CONTEXT_LABEL,
  SKELETON_CONTEXT_DEFINITION,
  SKELETON_NODES,
} from "./skeleton-data.ts";

export interface SeedResult {
  contextUri: string;
  conceptUris: Map<string, string>; // slug -> uri
  createdContext: boolean;
  createdConcepts: number;
}

export function seedSkeleton(store: Store): SeedResult {
  // 1. Seed the reserved context.
  const ctxRecord: ContextRecord = {
    type: "ConceptScheme",
    prefLabel: { en: SKELETON_CONTEXT_LABEL },
    definition: { en: SKELETON_CONTEXT_DEFINITION },
  };
  const ctxHash = hashContext(ctxRecord);
  const ctxUri = contextUri(SKELETON_CONTEXT_SLUG, ctxHash);
  let createdContext = false;
  if (!store.hasContext(ctxUri)) {
    store.insertContext({
      uri: ctxUri,
      slug: SKELETON_CONTEXT_SLUG,
      hash: ctxHash,
      record: { ...ctxRecord, uri: ctxUri },
    });
    createdContext = true;
  }

  // 2. Seed concepts in order (parents first — SKELETON_NODES is
  //    declared in dependency order).
  const bySlug = new Map<string, string>();
  let created = 0;

  for (const node of SKELETON_NODES) {
    let broaderUri: string | undefined;
    if (node.broaderSlug) {
      broaderUri = bySlug.get(node.broaderSlug);
      if (!broaderUri) {
        throw new Error(
          `skeleton seed: broader slug ${node.broaderSlug} not yet seeded for ${node.slug}`,
        );
      }
    }

    // Thing is its own root ancestor; everything else walks up the
    // broader chain. During seeding we can resolve this locally.
    const rootAncestorSlug = node.broaderSlug
      ? walkRoot(node.broaderSlug)
      : node.slug;
    const rootAncestorUri = bySlug.get(rootAncestorSlug) ?? undefined;

    const record: ConceptRecord = {
      type: "Concept",
      inScheme: ctxUri,
      prefLabel: { en: node.prefLabel },
      definition: { en: node.definition },
      ...(broaderUri ? { broader: [broaderUri] } : {}),
      ...(node.closeMatch.length ? { closeMatch: node.closeMatch } : {}),
      ...(node.conceptKind ? { conceptKind: node.conceptKind } : {}),
      ...(rootAncestorUri ? { rootAncestor: rootAncestorUri } : {}),
    };
    const hash = hashConcept(record);
    const uri = conceptUri(SKELETON_CONTEXT_SLUG, node.slug, hash);

    bySlug.set(node.slug, uri);

    if (store.hasConcept(uri)) continue;

    store.insertConcept({
      uri,
      contextSlug: SKELETON_CONTEXT_SLUG,
      conceptSlug: node.slug,
      hash,
      record: { ...record, uri },
    });
    created++;
  }

  store.logEvent("seed", {
    context: ctxUri,
    createdContext,
    createdConcepts: created,
  });

  return {
    contextUri: ctxUri,
    conceptUris: bySlug,
    createdContext,
    createdConcepts: created,
  };
}

function walkRoot(slug: string): string {
  let cur = slug;
  const seen = new Set<string>();
  while (true) {
    if (seen.has(cur)) throw new Error(`skeleton cycle at ${cur}`);
    seen.add(cur);
    const node = SKELETON_NODES.find((n) => n.slug === cur);
    if (!node) throw new Error(`skeleton node not found: ${cur}`);
    if (!node.broaderSlug) return cur;
    cur = node.broaderSlug;
  }
}

// URI-set helper used by the R1 ancestry gate to identify skeleton roots.
export function skeletonRootUris(seed: SeedResult): Set<string> {
  const roots = new Set<string>();
  for (const node of SKELETON_NODES) {
    if (!node.broaderSlug) {
      const uri = seed.conceptUris.get(node.slug);
      if (uri) roots.add(uri);
    }
  }
  return roots;
}

// All skeleton URIs — any of which is a valid terminal for ancestry
// walks. Per the roadmap R1 gate, we accept the full 16 as valid
// roots (the "skeleton" is the terminal set, not just `thing`).
export function skeletonUris(seed: SeedResult): Set<string> {
  return new Set(seed.conceptUris.values());
}
