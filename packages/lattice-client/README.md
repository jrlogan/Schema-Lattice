# schemalattice client

Publish a platform's data vocabulary to SchemaLattice, generated from the platform's own code,
so that AIs building on or against the platform find its concepts when they search.

One file, no dependencies, Node 20+. Vendor it into the repository that uses it:

```bash
mkdir -p tools/lattice
curl -o tools/lattice/schemalattice.mjs https://schemalattice.com/cli/schemalattice.mjs
```

| Command | Does | Network |
|---|---|---|
| `generate` | reads the schema, computes every concept URI, writes the generated file, `schemalattice.json` and any `annotate` targets | no (unless the source is a command that needs it) |
| `check` | fails if any of those files is stale — put it in CI | no |
| `publish` | pushes records the catalog does not hold yet; fails if the catalog would mint a different URI than the committed one | yes, needs `SCHEMALATTICE_KEY` |
| `status` | which committed URIs are live | yes |

## Why URIs are computed locally

A SchemaLattice URI is a hash of the record's content (`specs/hashing-rules.md`), and the client
hashes exactly as the server does (`test/parity.ts` runs in the server's smoke suite). So
`generate` writes the final URIs into the pull request that changes the schema. Reviewers see
them; `publish` runs after merge (typically a CI job) and only pushes what is already committed.
Nothing is ever written back to the repository.

When an entity's content changes, `generate` makes the new version a **fork** of the previous
URI, with a field-level changeset, so every schema change leaves lineage.

## Getting a key

```bash
curl -X POST https://schemalattice.com/api/tools/lattice_register_app \
  -H 'content-type: application/json' \
  -d '{"slug":"my-platform","name":"My Platform","unit":"My Org","owner":"maintainers","status":"pilot","concepts":[]}'
```

The key in the response is shown once; store it as the repository secret `SCHEMALATTICE_KEY`.
Self-registered keys can fork freely and originate a few concepts a day. Creating a context needs
contributor tier: ask the operator.

## `schemalattice.config.json`

```jsonc
{
  "lattice": "https://schemalattice.com",
  "app": { "slug": "my-platform", "name": "My Platform", "unit": "My Org", "owner": "maintainers" },

  // Where the fields come from — see "Sources" below.
  "source": { "format": "flat-fields", "path": "standard/fields.json", "enums": "standard/enums.json" },

  "generated": "tools/lattice/concepts.generated.json",   // committed; holds the exact publish calls
  "manifest": "schemalattice.json",                       // committed; the annotation-standard manifest
  "attribution": { "authoredBy": ["My Org"], "sourceLicense": "MIT" },

  // Conventions applied to top-level fields.
  "omitFields": ["id"],
  "references": { "organization_id": "my-context/organization" },   // field → "context/slug"
  "unitSuffixes": [["M", "meters"], ["Kg", "kilograms"]],

  // New contexts by title + definition, or an existing one by { "uri": … }.
  "contexts": { "my-context": { "title": "…", "definition": "at least 40 characters of what lives here" } },

  // Put current concept URIs into contracts your builders already read (2-space JSON files only).
  "annotate": [{ "file": "public/capabilities.json", "path": "records.concept", "concept": "Record" }],

  // Order matters: a reference to a concept EARLIER in the list carries its URI.
  "concepts": [
    {
      "shortName": "Organization", "entity": "organization", "localLocation": "src/types.ts#Organization",
      "context": "my-context", "slug": "organization", "prefLabel": "Member Organization",
      "definition": "40–600 characters saying what the thing IS, without restating the label.",
      "conceptKind": "agent",                 // entity | event | classification | workflow | measurement | agent | place
      "broader": "organization",              // a root-skeleton slug, or a concept URI
      "broadMatch": ["schema:Organization"],  // closeMatch or broadMatch into an approved vocabulary is required
      "coRefersWith": ["https://schemalattice.com/c/…"],   // same real-world referent, another perspective
      "related": ["https://schemalattice.com/c/…"],
      "altLabels": ["…"],
      "classifications": { "email": "personal-contact" }   // governance data classes
    }
  ]
}
```

Skeleton slugs: `thing`, `agent`, `person`, `organization`, `physical-object`, `asset`,
`location`, `event`, `activity`, `transaction`, `concept`, `classification`, `credential`,
`workflow`, `quantity`, `record`.

Before writing definitions, search the catalog (`/discover?description=…`) for concepts your
entities co-refer with or relate to, and link them. That link is where cross-platform value comes
from.

## Sources

Every adapter produces, per entity, lattice structure fields:
`{ name, type, required?, unit?, values?, ref?, itemType?, fields?, format?, description? }`.

| `format` | Input |
|---|---|
| `flat-fields` | `[{ entity, name, type, required, description, enum_ref }]` plus an enums file, e.g. Entrepreneurship Nexus's `data-standards/v1.1` |
| `json-schema` | a JSON Schema / OpenAPI document; `pointer` selects the schemas map, e.g. `/components/schemas` |
| `dictionary` | a JSON file already in the output shape: `{ "entities": { "<name>": { "fields": [...] } } }` |
| `command` | any program that prints such a dictionary — e.g. a Zod walker (see Boating Systems' `tools/lattice/dictionary.mjs`) |

## Adopters

- **Boating Systems** — Zod via a `command` source; `annotate` keeps Log's `capabilities.json`
  pointing at the current history concept.
- **Entrepreneurship Nexus** — `flat-fields` from its generated data standard; the integration
  brief's "Shared vocabulary" table reads `schemalattice.json`.
