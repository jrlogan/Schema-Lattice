// lattice_publish_context — mint a new ConceptScheme to hold concepts.
//
// Contexts are content-addressed like concepts, but carry no ancestry or
// friction gates: the gatekeeping here is naming discipline (domain-generic
// slugs, per specs/mcp-tools.md § lattice_publish_context) plus a
// slug-collision guard so the catalog does not accumulate near-duplicate
// homes for the same vocabulary.

import type { Store } from "../storage/db.ts";
import { hashContext, contextUri, validateSlug } from "../hashing/hash.ts";
import type { ContextRecord } from "../hashing/types.ts";
import { PublishError } from "./errors.ts";

/** Slugs the lattice keeps for itself or for vocabularies it seeds. */
export const RESERVED_CONTEXT_SLUGS = new Set([
  "skos",
  "pav",
  "schemalattice",
  "system",
  "test",
]);

export interface PublishContextInput {
  slug: string;
  title: string;
  definition: string;
  parentContextUris?: string[];
}

export interface PublishContextOk {
  uri: string;
  slug: string;
  title: string;
  published: boolean;
  /** Set when an existing context already claimed this slug. */
  existing?: { uri: string; title: string };
}

export function publishContext(
  store: Store,
  input: PublishContextInput,
): PublishContextOk {
  const slug = input.slug.trim().toLowerCase();
  try {
    validateSlug(slug);
  } catch {
    throw new PublishError(
      "ERR_INVALID_SLUG",
      `context slug must match ^[a-z][a-z0-9-]{1,39}$ (got ${JSON.stringify(input.slug)})`,
    );
  }
  if (RESERVED_CONTEXT_SLUGS.has(slug)) {
    throw new PublishError("ERR_RESERVED_SLUG", `context slug "${slug}" is reserved`);
  }
  const title = input.title?.trim() ?? "";
  const definition = input.definition?.trim() ?? "";
  if (!title) {
    throw new PublishError("ERR_MISSING_TITLE", "context title is required");
  }
  if (definition.length < 40) {
    throw new PublishError(
      "ERR_DEFINITION_LENGTH",
      "context definition must be at least 40 characters — say what vocabulary lives here and who it is for",
    );
  }

  for (const parent of input.parentContextUris ?? []) {
    if (!store.hasContext(parent)) {
      throw new PublishError(
        "ERR_UNKNOWN_PARENT_CONTEXT",
        `parent context not found: ${parent}`,
        { parent },
      );
    }
  }

  const record: ContextRecord = {
    type: "ConceptScheme",
    prefLabel: { en: title },
    definition: { en: definition },
  };
  if (input.parentContextUris?.length) {
    record.parentContexts = input.parentContextUris;
  }

  const hash = hashContext(record);
  const uri = contextUri(slug, hash);

  // Identical content re-published is a no-op.
  if (store.hasContext(uri)) {
    return { uri, slug, title, published: false };
  }

  // Same slug, different content: hand back the incumbent rather than
  // minting a second home for the same vocabulary.
  const collisions = store.contextsWithSlug(slug);
  if (collisions.length > 0) {
    const first = collisions[0];
    const existing = store.getContext(first.uri);
    return {
      uri: first.uri,
      slug,
      title,
      published: false,
      existing: {
        uri: first.uri,
        title: existing?.prefLabel?.en ?? slug,
      },
    };
  }

  store.insertContext({ uri, slug, hash, record: { ...record, uri } });
  store.logEvent("publish_context", { uri, slug, hash });
  return { uri, slug, title, published: true };
}
