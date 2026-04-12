# Spec: URI Scheme

**Status:** Locked for v0.1. Changes require migrating every published
concept, so changes are expected to be never.

## Goal

Give every concept, context, and lens a stable, content-addressed,
dereferenceable identifier that can be shared between AI agents, embedded
in code, and resolved by any SchemaLattice instance.

## Canonical URI form

All SchemaLattice URIs share one base authority regardless of which
server physically resolves them:

    https://schemalattice.io

Three resource types, each with a distinct path prefix:

```
Concepts:    https://schemalattice.io/c/{context-slug}/{concept-slug}@{hash}
Contexts:    https://schemalattice.io/s/{context-slug}@{hash}
Lenses:      https://schemalattice.io/l/{lens-id}@{hash}      (v0.2+)
```

### Examples

```
https://schemalattice.io/c/scuba-ops/dive-log@a1b2c3d4e5f6
https://schemalattice.io/c/marina-ops/vessel-inspection@7788aabbccdd
https://schemalattice.io/s/scuba-ops@1122334455ff
```

## Field rules

**`context-slug`**
- Lowercase ASCII letters, digits, and hyphens only
- Must start with a letter
- 2–40 characters
- Matches `^[a-z][a-z0-9-]{1,39}$`
- Examples: `scuba-ops`, `marina-ops`, `volunteer-ops`

**`concept-slug`**
- Same rules as context-slug
- Should reflect the concept's primary label, kebab-cased
- Not required to be unique across the whole catalog — uniqueness is
  scoped to (context-slug, concept-slug, hash)

**`hash`**
- First 12 hexadecimal characters of SHA-256 over the concept's
  canonical form (see `specs/hashing-rules.md`)
- Always 12 chars, always lowercase hex
- Matches `^[0-9a-f]{12}$`

**`lens-id`** (v0.2+)
- UUIDv4 or content-hash-based ID, TBD when lenses are implemented

## Local-server behavior

When running SchemaLattice locally for testing, the canonical URI form
is unchanged. A concept created on `http://localhost:7000` still has
a URI of `https://schemalattice.io/c/...@...`. The local server
resolves these URIs against its own storage.

Client configuration chooses which server resolves a URI. A client
pointed at `http://localhost:7000` will receive local records; a
client pointed at `https://schemalattice.io` will receive the
shared public instance's records.

This separation matters: it means a concept designed locally and
later pushed to the public instance keeps its URI and all inbound
references remain valid.

## Dereferencing

Every canonical URI resolves to a JSON-LD record via HTTP GET, served
by whichever SchemaLattice instance the client is configured against.
The response is the full concept record (see
`specs/json-ld-context.md` for format).

Content negotiation: return `application/json` by default.
`application/ld+json` is equivalent at v0.1 because the plain JSON
already includes an `@context` field.

## Mutable pointers

Alongside content-addressed URIs, the server maintains a mutable
"latest version" pointer for each concept slug:

```
GET https://schemalattice.io/c/scuba-ops/dive-log
    → 302 redirect to /c/scuba-ops/dive-log@<latest-hash>
```

This is exactly how git tag/branch heads point at immutable commits.
Tools that want to always pin to a specific definition reference the
full content-hashed URI. Tools that want to follow edits dereference
the short form.

## Immutability

Once published, a URI of the form `.../{slug}@{hash}` is immutable
forever. If a concept is edited — even a typo fix — a new URI is
assigned and the old one is preserved, with `pav:previousVersion`
linking the new record to the old.

Tombstones: if a concept is withdrawn, the URI still resolves but
the response carries `:status: "withdrawn"` and a reason. v0.1 does
not actually implement withdrawal; all published records are live.

## URI compression in manifests

Inside `schemalattice.json` files and other SchemaLattice-aware
tooling, URIs may be written in compressed form when the base authority
is unambiguous:

```json
"DiveLog": "c/scuba-ops/dive-log@a1b2c3d4e5f6"
```

Equivalent to the full form. Tools expanding manifests MUST prepend
the configured base authority (default: `https://schemalattice.io`).

## Reserved slugs

The following context slugs are reserved and may not be used by
end-user contexts:

- `skos` — mapped to the W3C SKOS vocabulary
- `pav` — mapped to the PAV ontology
- `schemalattice` — reserved for internal use
- `system` — reserved for internal use
- `test` — reserved for v0.1 testing instances

## What is NOT in the URI

Deliberately excluded:
- No version number in the path (hash subsumes versioning)
- No language tag (URIs identify the concept, not the language of
  its labels; language is selected at resolution time)
- No user or namespace prefix (v0.1 is single-publisher)
- No file extension (content type negotiated via Accept header)
