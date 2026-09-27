# Spec: Hashing Rules

**Status:** Locked for v0.1. Changes break every existing URI, so
changes are never.

## Goal

Define exactly how a concept or context record is reduced to a canonical
byte sequence for content hashing, so two independent implementations
compute identical hashes for semantically identical records.

## Algorithm

```
hash = hex(SHA-256(canonicalize(record)))[:12]
```

The first 12 hex characters of SHA-256 over the canonicalized form.

## Canonicalization for Concept records

Only fields that contribute to semantic identity are hashed. Mutable or
metadata fields are excluded.

### Fields INCLUDED in the hash

- `type` (always `"Concept"` for this record type)
- `inScheme` (context URI)
- `prefLabel` (all language variants)
- `altLabel` (all language variants)
- `hiddenLabel` (all language variants)
- `definition` (all language variants)
- `scopeNote` (all language variants)
- `broader` (array of URIs)
- `narrower` (array of URIs)
- `related` (array of URIs)
- `closeMatch` (array of URIs)
- `broadMatch` (array of URIs)
- `narrowMatch` (array of URIs)
- `relatedMatch` (array of URIs)
- `derivedFrom` (URI — `pav:derivedFrom`)
- `forkedFrom` (URI — SchemaLattice-specific fork relation)
- `previousVersion` (URI — `pav:previousVersion`)
- `importedFrom` (URI — `pav:importedFrom`)
- `coRefersWith` (array of URIs — SchemaLattice custom)
- `entryLevel` (integer — SchemaLattice custom)
- `collapsesTo` (array of URIs — SchemaLattice custom)
- `structure` (the embedded field-shape or workflow definition, if any)

### Fields EXCLUDED from the hash

- `uri` (circular — URI contains the hash being computed)
- `createdOn`, `createdAt`, `lastUpdatedOn` (timestamps)
- `createdBy`, `authoredBy` (provenance metadata)
- `sourceLicense` (provenance metadata)
- `sourceNotes`, `designNote` (free-text annotations)
- `adoptionCount`, `forkCount` (mutable social signal)
- `embedding` (re-derivable from description)
- Any field whose name starts with `_` (internal only)

### Why this split

Anything that would change *what the concept means* is hashed.
Anything that's commentary on the concept (who made it, when,
how many people use it) stays mutable. This mirrors git's
commit-content vs commit-metadata split.

## Normalization rules

Before hashing, the record is transformed to a canonical form:

### 1. Remove excluded fields

Strip every field listed under "EXCLUDED" above from the JSON object
before any other processing.

### 2. Sort object keys

All JSON object keys are sorted lexicographically (codepoint order,
UTF-8 encoding). Nested objects are sorted recursively.

### 3. Sort arrays of URIs

For any field whose value is an array of URIs (`broader`, `narrower`,
`related`, `closeMatch`, `coRefersWith`, etc.), sort the array
lexicographically. Order never encodes meaning in SchemaLattice
relation arrays.

Arrays whose order DOES matter (e.g., `structure.fields` ordering)
are NOT sorted. Field ordering in a schema is semantically load-bearing.

### 4. Normalize language tags

Language tags in multilingual fields (`prefLabel`, `definition`, etc.)
are lowercased and stored as an object keyed by tag:

```json
"prefLabel": {
  "en": "Dive Log",
  "es": "Registro de Buceo"
}
```

Before hashing, the language-tag keys are sorted lexicographically
(handled by rule 2, since they're object keys).

### 5. Normalize whitespace in text fields

For `prefLabel`, `altLabel`, `hiddenLabel`, `definition`, `scopeNote`:

- Strip leading and trailing whitespace
- Collapse internal runs of whitespace (spaces, tabs, newlines) to a
  single ASCII space
- Unicode NFC normalization applied to all text

### 6. Numbers

- Integers are serialized without decimal point or exponent
- Floats: SchemaLattice does not use floats in hashed fields at v0.1.
  (Adoption counts and similar are excluded from hashing.)
- `entryLevel` is an integer; serialize as a bare integer.

### 7. Booleans and null

- `true`, `false`, `null` serialize as JSON literals
- Omit fields whose value is `null` (null == absent)
- Omit fields whose value is an empty array or empty object

### 8. JSON serialization

Serialize the canonicalized object with:
- No whitespace between tokens (no spaces after commas or colons)
- ASCII encoding; non-ASCII characters encoded as `\uXXXX` escapes
- Keys sorted (already done in step 2)
- Double-quote strings, escape per JSON spec

This produces one unambiguous byte sequence per record.

### 9. Hash

Apply SHA-256 to the UTF-8 bytes of the serialized form. Take the
first 12 hex characters of the lowercase hex digest.

## Canonicalization for Context (ConceptScheme) records

Context hashing follows the same rules with these included fields:

- `type` (always `"ConceptScheme"`)
- `prefLabel`
- `definition`
- `derivedFrom` (parent context URI, if any)
- `:entryLevelAllowedRange` (min/max entry levels, if constrained)

**Excluded:** membership. A context's URI does NOT change when a new
concept joins it. Membership is discovered by querying "give me every
concept where `inScheme` points at this context."

## Canonicalization for Lens records (v0.2+)

Lens records are not hashed in v0.1. When implemented, their hash will
include:

- `fromConcept` URI
- `toConcept` URI
- `ops` array (in order — order IS semantic for lens ops)

## Worked example

Minimal concept:

```json
{
  "uri": "https://schemalattice.com/c/scuba-ops/dive-log@PLACEHOLDER",
  "type": "Concept",
  "inScheme": "https://schemalattice.com/s/scuba-ops@aabbccddeeff",
  "prefLabel": {"en": "Dive Log"},
  "definition": {"en": "A record of a single scuba diving session."},
  "broader": [
    "https://schemalattice.com/c/activity-log/session@001122334455"
  ],
  "createdOn": "2026-04-12T14:32:00Z",
  "createdBy": ["jrlogan"]
}
```

Canonicalized (pseudo-representation, actual bytes would have no
whitespace):

```json
{
  "broader": [
    "https://schemalattice.com/c/activity-log/session@001122334455"
  ],
  "definition": {"en": "A record of a single scuba diving session."},
  "inScheme": "https://schemalattice.com/s/scuba-ops@aabbccddeeff",
  "prefLabel": {"en": "Dive Log"},
  "type": "Concept"
}
```

Actual byte sequence (whitespace-free, sorted keys):

```
{"broader":["https://schemalattice.com/c/activity-log/session@001122334455"],"definition":{"en":"A record of a single scuba diving session."},"inScheme":"https://schemalattice.com/s/scuba-ops@aabbccddeeff","prefLabel":{"en":"Dive Log"},"type":"Concept"}
```

SHA-256 of this byte sequence, first 12 hex chars → the hash segment
of the URI.

## Reference implementation requirements

Any v0.1 SchemaLattice implementation MUST include a
canonicalization function that passes a shared test vector suite
(to be published in `specs/hashing-test-vectors.json`). Two
implementations disagreeing on the canonical form of a record is a
critical bug; tests must catch it.
