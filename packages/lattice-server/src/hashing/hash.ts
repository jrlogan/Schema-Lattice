import { createHash } from "node:crypto";
import { canonicalizeConcept, canonicalizeContext } from "./canonicalize.ts";
import type { ConceptRecord, ContextRecord } from "./types.ts";

export function shortHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 12);
}

export function hashConcept(record: ConceptRecord): string {
  return shortHash(canonicalizeConcept(record));
}

export function hashContext(record: ContextRecord): string {
  return shortHash(canonicalizeContext(record));
}

export const BASE_AUTHORITY = "https://schemalattice.io";

export function conceptUri(contextSlug: string, conceptSlug: string, hash: string): string {
  return `${BASE_AUTHORITY}/c/${contextSlug}/${conceptSlug}@${hash}`;
}

export function contextUri(contextSlug: string, hash: string): string {
  return `${BASE_AUTHORITY}/s/${contextSlug}@${hash}`;
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,39}$/;
export function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`invalid slug: ${JSON.stringify(slug)}`);
  }
}
