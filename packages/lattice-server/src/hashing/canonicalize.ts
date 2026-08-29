// Canonicalization per specs/hashing-rules.md.
//
// Produces the exact byte sequence that gets SHA-256'd.

import type { ConceptRecord, ContextRecord } from "./types.ts";

const CONCEPT_HASHED_FIELDS = new Set([
  "type",
  "inScheme",
  "prefLabel",
  "altLabel",
  "hiddenLabel",
  "definition",
  "scopeNote",
  "broader",
  "narrower",
  "related",
  "closeMatch",
  "broadMatch",
  "narrowMatch",
  "relatedMatch",
  "derivedFrom",
  "forkedFrom",
  "previousVersion",
  "importedFrom",
  "coRefersWith",
  "entryLevel",
  "collapsesTo",
  "structure",
  // Fork changesets are part of the child's identity: the same labels and
  // definition arrived at by a different diff is a different record.
  "changeset",
]);

const CONTEXT_HASHED_FIELDS = new Set([
  "type",
  "prefLabel",
  "definition",
  "derivedFrom",
  // Broader contexts this one specializes (lattice_publish_context's
  // `parentContextUris`). Absent on the skeleton context, so adding it
  // here leaves existing context hashes untouched.
  "parentContexts",
  "entryLevelAllowedRange",
]);

const TEXT_FIELDS = new Set([
  "prefLabel",
  "altLabel",
  "hiddenLabel",
  "definition",
  "scopeNote",
]);

const URI_ARRAY_FIELDS = new Set([
  "broader",
  "narrower",
  "related",
  "closeMatch",
  "broadMatch",
  "narrowMatch",
  "relatedMatch",
  "coRefersWith",
  "collapsesTo",
  "parentContexts",
]);

function normalizeText(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ");
}

function normalizeLangMap(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") continue;
    const text = normalizeText(v);
    if (text.length === 0) continue;
    out[k.toLowerCase()] = text;
  }
  return out;
}

// Strip excluded fields, normalize values, drop empties.
function filterRecord(
  record: Record<string, unknown>,
  allowed: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!allowed.has(k)) continue;
    if (k.startsWith("_")) continue;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v as object).length === 0
    ) {
      continue;
    }

    if (TEXT_FIELDS.has(k) && typeof v === "object" && !Array.isArray(v)) {
      const norm = normalizeLangMap(v as Record<string, string>);
      if (Object.keys(norm).length > 0) out[k] = norm;
      continue;
    }

    if (URI_ARRAY_FIELDS.has(k) && Array.isArray(v)) {
      const arr = (v as string[]).slice().sort();
      if (arr.length > 0) out[k] = arr;
      continue;
    }

    out[k] = v;
  }
  return out;
}

// JSON.stringify produces lexicographically sorted keys recursively,
// with ASCII escaping for non-ASCII codepoints and no inter-token whitespace.
function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in hashed field");
    if (Number.isInteger(value)) return value.toString();
    // Spec says no floats in hashed fields for v0.1; be strict.
    throw new Error("float values are not permitted in hashed fields at v0.1");
  }
  if (typeof value === "string") return encodeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(encodeString(k) + ":" + canonicalJSON(v));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`unsupported value type for canonicalization: ${typeof value}`);
}

function encodeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0c) out += "\\f";
    else if (c === 0x0d) out += "\\r";
    else if (c < 0x20 || c > 0x7e) {
      out += "\\u" + c.toString(16).padStart(4, "0");
    } else {
      out += s[i];
    }
  }
  return out + '"';
}

export function canonicalizeConcept(record: ConceptRecord): string {
  const filtered = filterRecord(
    record as unknown as Record<string, unknown>,
    CONCEPT_HASHED_FIELDS,
  );
  return canonicalJSON(filtered);
}

export function canonicalizeContext(record: ContextRecord): string {
  const filtered = filterRecord(
    record as unknown as Record<string, unknown>,
    CONTEXT_HASHED_FIELDS,
  );
  return canonicalJSON(filtered);
}
