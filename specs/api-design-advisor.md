# API design advisor — first implementation

Status: implemented in `packages/lattice-server/src/advisor/`, exposed through the
shared HTTP/MCP tool table and a CLI. The feature operates on a registered app and
listed sources; it neither crawls repositories nor calls an LLM to interpret intent.

## Purpose

A builder should reuse recorded semantic alignments when designing an API, see
which standards and existing implementations connect to that model, and understand
what a conversion would omit. Authority, adoption, usability and transferability
are different evidence dimensions. Missing evidence is not a low authority score.

## Inputs and model boundary

`lattice_advise_api` takes `app`, `purpose`, `consumers`, optional `resources` and
optional `candidateSlugs`. The app must exist. Each resource binds a registered
concept URI to a literal collection path; optional `fieldNames` rename top-level
concept properties and `idField` explicitly selects an identifier for item lookup.
Types, required fields and constraints come from registered concept structures.
Bindings are caller assertions, not a scan of the application's runtime model.
Without bindings, paths and schemas are explicitly concept-derived drafts.

Purpose and consumers are retained as context for review, not interpreted as
instructions or used to manufacture mappings. A field is aligned only through an
exact registered concept URI and concept field in a currently listed source map.
Fork lineage, close matches and similar field names are not field equivalence.

## Outputs

The proposal includes:

- Native OpenAPI 3.1 JSON: local component refs, explicit concept/field annotations,
  list endpoints with a proposed cursor contract, and optional identifier lookup.
  Bearer authentication is a proposed design default, not an assertion about an
  existing app. Field exposure and authorization still require implementation review.
- Candidate comparisons for listed standards and datasets. They remain distinct.
- Mapped fields, app fields absent from the target, target fields without mappings,
  wire-type/format/unit/enum/constraint differences and recorded conversion notes.
- Publisher attribution, declared conformers, peers using the same concept, and
  peers that accepted a design target. None of these imply deployed conformance.
- An evidence hash, deterministic proposal ID, schema issues and review requirements.

Candidates sort by mapped-field coverage, then stable source identity. The advisor
makes no worldwide popularity claim or authority ranking. An official-URL-keyed
Open311 v2 implementation guide provides bounded notes reviewed against its
primary specification; it is not a complete conformance validator. A standard with
no recorded mappings cannot yet receive a semantic compatibility recommendation.

Complex or unsupported types remain explicit schema issues rather than guessed
conversions. Source metadata is data, never executable code. No cross-source adapter
is emitted because the stored mappings do not establish reversible conversions or
record identity. App-only fields stay in the native representation. Candidate
choices designate compatibility targets; they do not rewrite native property names
or replace the native OpenAPI contract with a full standard implementation.

The built-in validator checks generated paths, operation IDs, parameter bindings,
required fields and local references. The test/demo additionally validate the
OpenAPI with Swagger Parser. Neither performs endpoint behavior or data integration
tests. Catalog schema omissions remain review issues even when OpenAPI syntax passes.

## Review and feedback

`lattice_accept_api_design` requires the unchanged design request, proposal ID,
review rationale and one choice per resource (`source:null` keeps the native API).
Only that app's key or the operator can accept. Advice alone never triggers this
write. The service rebuilds the proposal and rejects stale/mismatched evidence.
Repeated identical acceptance is idempotent. Decisions retain the complete reviewed
proposal, evidence hash, actor and timestamp in `api_design_decisions`.

`lattice_api_design_history` returns review history. Acceptance is recorded as
**design intention**; it is not deployment, successful integration, standards
conformance, or permission to publish concepts. Latest peer decisions are a separate
signal in future proposals; self and retired apps do not inflate adoption signals.

## Running and validation

See `packages/lattice-server/examples/api-advisor/README.md`. The demonstration uses
a temporary catalog, a fictional waste-service app, a fictional peer and legacy
export, and the repository's existing Open311 specification field-list capture.
It writes review artifacts but makes no production catalog changes.

Tests cover exact-match boundaries, unknown inputs, omitted fields, conversion and
constraint differences, deterministic replay, independent OpenAPI validation,
withdrawn sources, stale proposals, ownership, idempotence, and HTTP/CLI roundtrips.
