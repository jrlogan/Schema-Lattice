# SchemaLattice Technical Requirements

Authoritative list of v0.1 requirements derived from `ROADMAP.md`.
Each requirement has an ID, an enforcement point in code, and a test
hook in `packages/lattice-evals`.

## R1 — Skeleton-ancestry enforcement

**Requirement.** Every concept accepted by `lattice_publish_concept`
MUST have a lineage chain that resolves to exactly one of the 16
skeleton roots in `specs/root-skeleton.md`. Forks inherit the parent's
root ancestor automatically. Original (non-forked) concepts MUST
declare `rootAncestor` explicitly, and the server verifies it is a
reserved skeleton URI.

**Enforcement.** `packages/lattice-server/src/publish/ancestry.ts`
(to be built). Runs before canonicalization. Error code:
`ERR_NO_ROOT_ANCESTOR`.

**Test hook.** `packages/lattice-evals/scenarios/ancestry-*.json`.

## R2 — Metadata friction validator

**Requirement.** `lattice_publish_concept` MUST reject any payload
that does not include all of:

- `definition`: 40–600 chars, English sentence-shaped, not containing
  the `prefLabel` as a substring, embedding ≥ 0.3 cosine distance
  from the label embedding.
- At least one `closeMatch` or `broadMatch` IRI from an approved
  external-vocabulary prefix list (same list as root-skeleton.md §
  "External vocabulary prefixes").
- Either ≥ 1 `coRefersWith` mapping OR an explicit empty array plus
  a non-empty `coRefersRationale`.
- Evidence of a prior `lattice_discover` call in the same MCP session
  (checked via the `events` table — see `specs/ai-checkpoints.md`
  Checkpoint 2B).

**Enforcement.** `packages/lattice-server/src/publish/friction.ts`.
Failures return structured errors the MCP tool surfaces as guided
retries, not hard failures.

**Test hook.** `packages/lattice-evals/scenarios/friction-*.json`
including adversarial cases (label-stuffed definitions, lorem ipsum,
missing discover call).

## R3 — Shard model

**Requirement.**

- Storage is partitioned by shard. Each shard owns its own SQLite
  attachment, vector index segment, and blob directory.
- The reserved shard `schemalattice` contains only the root skeleton
  and is read-only after seeding.
- `lattice_publish_concept` requires an explicit `shard` argument.
- `lattice_discover` accepts an optional `shards: string[]` filter;
  default is all local shards. Cross-shard hits are tagged.
- Cross-shard edges are restricted to `coRefersWith`, `closeMatch`,
  and `pav:derivedFrom`. Cross-shard `skos:broader` is rejected.
- `lattice-cli shard create <name>` creates a new shard with a
  one-line manifest (title, description, committed skeleton roots).
- v0.1 ships with `schemalattice`, `marine`, `iot`, `civic`.

**Enforcement.** `packages/lattice-server/src/storage/shard.ts`.

**Test hook.** `packages/lattice-evals/scenarios/shard-isolation-*.json`.

## R4 — Local Register & Audit Loop

**Requirement.**

- `lattice-client` maintains `~/.schemalattice/register.db` with
  `projects`, `usages`, `audits` tables.
- `lattice-cli scan` walks a project for `schemalattice.json`
  sidecars and `[lattice:SHORT_NAME]` inline markers and updates
  `usages`.
- `lattice-cli audit` runs the four audits in ROADMAP §4 (drift,
  stale-version, fork-instead-of-reuse, cross-shard coref) and
  writes findings to `audits`.
- Audits are advisory. Nothing is auto-fixed.
- The server MUST expose `lattice_list_usages(concept_uri)` so the
  register can reconcile against catalog state.

**Enforcement.** `packages/lattice-client/src/register/*.ts` and
`packages/lattice-cli/src/commands/{scan,audit}.ts`.

**Test hook.** `packages/lattice-evals/scenarios/audit-drift-*.json`
using synthetic multi-project fixtures.

## R5 — Build-time focus guardrail

**Requirement.**

- `lattice-client` MUST NOT expose a request-path data translation
  API. All data migrations are generated at coding time as code the
  AI commits into the consuming app's repo.
- Embeddings, duplicate detection, and discover all run locally by
  default. Remote calls to `schemalattice.io` are opt-in via
  explicit client configuration.
- The v0.2 `/reconcile` endpoint is framed as a build-time
  AI-to-AI negotiator, not a runtime RPC. `DECISIONS.md` should be
  updated to reflect this; ROADMAP.md is authoritative until then.

**Enforcement.** Static check in `packages/lattice-evals` that
greps the published `lattice-client` surface for forbidden symbols
(`translate`, `migrate`, `runtimeConvert`, etc.) and fails CI if any
appear outside the build-time code-gen module.

## Cross-cutting: publish-pipeline gate order

Every `lattice_publish_concept` call runs gates in this fixed order:

1. R1 — skeleton ancestry
2. R2 — metadata friction (definition / coRefersWith / closeMatch /
   prior discover)
3. R3 — shard target valid and writable
4. Existing: changeset op validation (`specs/changeset-format.md`),
   including `upgradable` recomputation
5. Existing: canonicalization + content hashing
6. Existing: duplicate detection (cosine ≥ 0.85 → warning, not block)
7. Write blob + update SQLite
8. R4 advisory: emit `published` event for Local Register pull

Gates 1–3 are hash-blocking and leave no trace on rejection. Gates
4–6 are the existing pipeline, unchanged in order. Gate 8 is
post-hash and never blocks.
