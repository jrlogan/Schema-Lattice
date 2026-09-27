# Spec: JSON-LD `@context`

**Status:** Locked for v0.1. Key renames break every existing record;
key additions are cheap and expected.

## Goal

Define the canonical mapping from short JSON keys used in concept
records to the full URIs of the properties they represent. This is the
file every client fetches once and every AI sees as the authoritative
vocabulary.

## Published location

```
https://schemalattice.com/context/v1.jsonld
```

Every concept and context record references this URL in its `@context`
field:

```json
{
  "@context": "https://schemalattice.com/context/v1.jsonld",
  "type": "Concept",
  ...
}
```

Clients SHOULD cache this file. It changes only on major version
updates, and such updates introduce `/context/v2.jsonld` rather than
mutating v1.

## The mapping

```json
{
  "@context": {
    "@version": 1.1,

    "skos": "http://www.w3.org/2004/02/skos/core#",
    "pav":  "http://purl.org/pav/",
    "dct":  "http://purl.org/dc/terms/",
    "sl":   "https://schemalattice.com/ns/v1#",
    "xsd":  "http://www.w3.org/2001/XMLSchema#",

    "Concept":       "skos:Concept",
    "ConceptScheme": "skos:ConceptScheme",

    "uri":          "@id",
    "type":         "@type",

    "prefLabel":    {"@id": "skos:prefLabel",    "@container": "@language"},
    "altLabel":     {"@id": "skos:altLabel",     "@container": "@language"},
    "hiddenLabel":  {"@id": "skos:hiddenLabel",  "@container": "@language"},
    "definition":   {"@id": "skos:definition",   "@container": "@language"},
    "scopeNote":    {"@id": "skos:scopeNote",    "@container": "@language"},
    "example":      {"@id": "skos:example",      "@container": "@language"},
    "changeNote":   {"@id": "skos:changeNote",   "@container": "@language"},

    "inScheme":     {"@id": "skos:inScheme",     "@type": "@id"},
    "topConceptOf": {"@id": "skos:topConceptOf", "@type": "@id"},

    "broader":      {"@id": "skos:broader",      "@type": "@id", "@container": "@set"},
    "narrower":     {"@id": "skos:narrower",     "@type": "@id", "@container": "@set"},
    "related":      {"@id": "skos:related",      "@type": "@id", "@container": "@set"},

    "closeMatch":   {"@id": "skos:closeMatch",   "@type": "@id", "@container": "@set"},
    "broadMatch":   {"@id": "skos:broadMatch",   "@type": "@id", "@container": "@set"},
    "narrowMatch":  {"@id": "skos:narrowMatch",  "@type": "@id", "@container": "@set"},
    "relatedMatch": {"@id": "skos:relatedMatch", "@type": "@id", "@container": "@set"},

    "createdOn":      {"@id": "pav:createdOn",      "@type": "xsd:dateTime"},
    "createdBy":      {"@id": "pav:createdBy",      "@container": "@set"},
    "authoredBy":     {"@id": "pav:authoredBy",     "@container": "@set"},
    "lastUpdatedOn":  {"@id": "pav:lastUpdatedOn",  "@type": "xsd:dateTime"},
    "derivedFrom":    {"@id": "pav:derivedFrom",    "@type": "@id"},
    "previousVersion":{"@id": "pav:previousVersion","@type": "@id"},
    "hasCurrentVersion":{"@id": "pav:hasCurrentVersion","@type": "@id"},
    "version":        "pav:version",
    "importedFrom":   {"@id": "pav:importedFrom",   "@type": "@id"},

    "forkedFrom":     {"@id": "sl:forkedFrom",     "@type": "@id"},
    "coRefersWith":   {"@id": "sl:coRefersWith",   "@type": "@id", "@container": "@set"},
    "entryLevel":     {"@id": "sl:entryLevel",     "@type": "xsd:integer"},
    "collapsesTo":    {"@id": "sl:collapsesTo",    "@type": "@id", "@container": "@set"},
    "conceptKind":    {"@id": "sl:conceptKind"},
    "structure":      {"@id": "sl:structure"},
    "changeset":      {"@id": "sl:changeset"},
    "upgradable":     {"@id": "sl:upgradable",     "@type": "xsd:boolean"},

    "sourceLicense":  {"@id": "sl:sourceLicense"},
    "sourceNotes":    {"@id": "sl:sourceNotes"},
    "designNote":     {"@id": "sl:designNote"},
    "inspiredBySources": {"@id": "sl:inspiredBySources", "@container": "@set"},
    "adoptionCount":  {"@id": "sl:adoptionCount",  "@type": "xsd:integer"},
    "forkCount":      {"@id": "sl:forkCount",      "@type": "xsd:integer"}
  }
}
```

## The `conceptKind` discriminator

`sl:conceptKind` is an optional string field distinguishing broad
categories of concept. Accepted values:

| Value | Meaning | Typical example |
|---|---|---|
| `entity` | A persistent thing with identity and state | LibraryItem, Battery, Vessel |
| `event` | Something that happens at a point in time | Dive, LibraryTransaction, Inspection |
| `classification` | A label, enum, or taxonomy entry | ItemStatus, LibraryAction, InspectionOutcome |
| `workflow` | A process definition with states and transitions | LendingWorkflow, DiveExecutionPlan |
| `measurement` | A quantity with units | Depth, Duration, Pressure |
| `agent` | Something that can take purposeful action | Person, Organization, Member |
| `place` | A physical location | Marina, DiveSite, Trailhead |

The values correspond loosely to the classical continuant /
occurrent split from upper ontologies, but SchemaLattice does not
adopt BFO/DOLCE formally. Values are intended for discovery
filtering and default-field hints, not philosophical rigor.

Optional in v0.1 (backward compatible — records without
`conceptKind` remain valid). The root skeleton
(`specs/root-skeleton.md`) uses it consistently so discovery can
filter by kind from day one. Recommended for all new concepts in
v0.2.

## What this accomplishes

- **SKOS** terms (`skos:prefLabel`, `skos:broader`, etc.) get short,
  JSON-friendly keys so records are easy for AIs to emit and parse.
- **PAV** terms for provenance and versioning are similarly shortened.
- **Three SchemaLattice-specific** namespaces: `sl:forkedFrom`,
  `sl:coRefersWith`, `sl:entryLevel`, `sl:collapsesTo`. These live
  under `https://schemalattice.com/ns/v1#` to make clear what's ours.
- **No prefixes in record bodies.** A record writes `prefLabel` not
  `skos:prefLabel`; the `@context` resolves the shortening.

## Adding keys in v0.1

Adding new short keys is allowed and backward compatible. Existing
clients ignore keys they don't recognize. Process for adding:

1. Propose the new key in a GitHub issue against `specs/json-ld-context.md`
2. Confirm it resolves to an existing vocabulary where possible (SKOS,
   PAV, Dublin Core, SPDX)
3. Only add to the `sl:` namespace if no existing vocabulary fits
4. Update the mapping, bump a counter in a `version` comment, deploy

## Renaming or removing keys in v0.1

Not allowed. Any need to rename a key indicates v2 and moves to
`/context/v2.jsonld`.

## Why we don't ship a full JSON-LD processor

For v0.1, records are treated as plain JSON with a frozen `@context`
reference. Clients that need full RDF round-trip can run `jsonld.js`
or equivalent — the records are valid JSON-LD. But SchemaLattice's
server and default client do not require a JSON-LD processor at
runtime. This was a deliberate velocity choice.
