# SchemaLattice Roadmap

**Status:** v0.1 design, pre-code. This roadmap supersedes the earlier
"single-instance, hint-not-cage" framing in several places — see the
cross-references to `ARCHITECTURE.md`, `specs/root-skeleton.md`, and
`specs/changeset-format.md` for what tightens.

The five constraints below are load-bearing for v0.1 and must be
enforced at the MCP tool layer before a concept hash is accepted.

---

## 1. Foundational Primitives — inheritance, not suggestion

**What changes from today.** `specs/root-skeleton.md` currently frames
the 16 seed concepts as a "hint, not a cage." For v0.1 we tighten this:
every new concept published through the MCP tool MUST declare a
`rootAncestor` that resolves — via zero or more `pav:derivedFrom` /
`skos:broader` edges — to exactly one of the following skeleton roots:

- **Agent** (→ Person, Organization)
- **Location** (treated as the skeleton's `Place`)
- **Event** (→ Activity / Transaction — `Action` maps here)
- **PhysicalObject** (→ Asset)
- **Concept** (→ Classification, Credential, Workflow)
- **Quantity**
- **Record**

The legacy four "Base Concepts" the user names (Person, Place, Event,
Action) map onto `Person`, `Location`, `Event`, `Activity`
respectively. The skeleton is the canonical set; the four-name
shorthand is just a discovery alias.

**Enforcement point.** `lattice_publish_concept` rejects any payload
whose lineage chain does not terminate at a skeleton URI. This is a
hash-blocking check — no URI is minted, no blob is written. See
REQUIREMENTS §R1.

**Milestone:** v0.1-M1 (server seed + publish validator).

---

## 2. Metadata Friction — definitions and co-reference before hash

Concept hashes are cheap to generate and that's the problem: an AI
spamming near-duplicates with auto-generated labels degrades the
vector space faster than the catalog can recover. v0.1 introduces a
deliberate friction gate on the publish path.

**Protocol.** Before `lattice_publish_concept` will mint a URI, the
MCP tool requires the caller to supply:

1. A **human-readable `definition`** (≥ 40 chars, ≤ 600 chars, natural
   English, not a restatement of the label). The server runs a
   cheap heuristic check (label-not-in-definition, sentence-shaped,
   no placeholder tokens like `TODO`/`lorem`) and a semantic check
   (embedding of definition must be ≥ 0.3 cosine distance from the
   label embedding — i.e. the definition must add information).
2. At least one **`:coRefersWith` mapping** OR an explicit
   `coRefersWith: []` with a `coRefersRationale` string explaining
   why no co-reference exists. This forces the AI to actively search
   for related concepts rather than publish in isolation. The search
   is scaffolded by a mandatory prior `lattice_discover` call in the
   same session (logged via the `events` table, `specs/ai-checkpoints.md`
   Checkpoint 2B).
3. A `closeMatch` or `broadMatch` to at least one external vocabulary
   (schema.org, Wikidata, SKOS, etc.) — same list as the skeleton uses.

**Enforcement point.** All three checks run in
`packages/lattice-server/src/publish/validate.ts` (to be built) before
canonicalization. Failure returns a structured error the MCP tool
surfaces back to the AI as a **retry with guidance**, not a hard fail.
See REQUIREMENTS §R2.

**Milestone:** v0.1-M2 (publish validator + friction tests in
`packages/lattice-evals`).

---

## 3. Federated Sharding — Domain Shards

**What changes from today.** `ARCHITECTURE.md` says "Single-instance
by choice." That remains true for the *server binary*, but the
*catalog* is now partitioned into **Domain Shards** from v0.1, so
federation in v0.2+ is a configuration change rather than a rewrite.

**Shard model.**

- A Domain Shard is a `skos:ConceptScheme` at the top level (e.g.
  `schemalattice:marine`, `schemalattice:iot`, `schemalattice:civic`)
  plus the subtree of concepts whose `inScheme` resolves beneath it.
- Shards inherit from the skeleton (§1) but are otherwise independent:
  each has its own SQLite attachment file, its own vector index
  segment, and its own blob directory under
  `store/shards/<shard-id>/`.
- `lattice_discover` takes an optional `shards: string[]` filter.
  Default is "all local shards." Cross-shard results are tagged so
  the AI can see the provenance.
- Publishing always targets exactly one shard. Cross-shard references
  are allowed via URI but cannot create `skos:broader` edges — only
  `:coRefersWith`, `closeMatch`, or `pav:derivedFrom`.

**Launch shards for v0.1.** `schemalattice` (root skeleton, reserved),
`marine`, `iot`, `civic`. Additional shards are created by CLI
(`lattice-cli shard create <name>`) and require a one-line manifest
with title, description, and parent skeleton roots the shard commits
to using.

**Enforcement point.** Storage layer refuses writes to a shard that
doesn't exist; `lattice_publish_concept` requires an explicit `shard`
argument (no default). See REQUIREMENTS §R3.

**Milestone:** v0.1-M3 (shard-aware storage + CLI).

---

## 4. The Local Register & Audit Loop

Beyond the catalog server, every *developer* running `lattice-client`
in their apps gets a **Local Register** — a sqlite file at
`~/.schemalattice/register.db` — that tracks which lattice concepts
which of their local projects use, and when.

**What it tracks.**

- `projects` — name, repo path, last-seen timestamp.
- `usages` — `(project_id, concept_uri, field_path, annotation_source,
  first_seen, last_seen)`. Populated from `schemalattice.json` sidecar
  manifests and `[lattice:SHORT_NAME]` inline marker tags
  (`specs/annotation-standard.md`) during a `lattice-cli scan` pass.
- `audits` — findings surfaced by the audit loop (below), with
  timestamps and dismissed/acted states.

**The Audit Loop.** On `lattice-cli audit` (and optionally on every
scan), the CLI runs:

1. **Drift audit.** For each concept URI used by ≥ 2 projects, compare
   the field set actually referenced in each project's annotations.
   Diverging field usage on the same URI → suggest a fork (if one
   project is consistently using a superset) or a rename (if the
   fields are incompatible).
2. **Stale-version audit.** Any project pinned to a concept URI whose
   `latest-pointer` has moved → suggest review of the changeset
   between pinned and latest.
3. **Fork-instead-of-reuse audit.** If project A published a fork
   whose changeset ops are a subset of fields project B already uses
   on the parent, suggest merging — i.e. B adopt A's fork or A
   withdraw it.
4. **Cross-shard co-reference audit.** If the same real-world referent
   appears in two shards without a `:coRefersWith` edge, suggest
   creating one.

Audit output is advisory. Nothing is auto-fixed. Each finding links
to the concept URIs and the specific source files (via the annotation
spec's sidecar manifest) so the developer can act in their editor.

**Enforcement point.** This is a developer-side tool; no enforcement
on the server. But the server MUST expose a
`lattice_list_usages(concept_uri)` MCP tool so the Local Register can
reconcile its view with the catalog state. See REQUIREMENTS §R4.

**Milestone:** v0.1-M4 (CLI + client library + `list_usages` tool).

---

## 5. Build-Time Focus

**Decision.** All reconciliation, mapping, duplicate-detection, and
lens logic in v0.1 is optimized for the **coding phase** — i.e. when
an AI is generating or modifying an app in a developer's editor. It
is explicitly NOT optimized for runtime translation between live apps.

**Concretely this means.**

- The MCP server can be slow (~100ms publish, ~200ms discover) — that's
  fine inside an editor turn, not fine on a request path.
- The client library (`lattice-client`) does NOT ship a runtime
  translator. Data migrations happen at coding time via generated
  code the AI commits into the app's repo, not at request time.
- The v0.2 `/reconcile` endpoint remains deferred and, when it lands,
  is framed as a **build-time bar-scene negotiator** (AI-to-AI during
  authoring), not a live RPC layer. `DECISIONS.md` should be updated
  to reflect this framing; this roadmap is the authoritative source
  until then.
- Embeddings, vector search, and duplicate detection run locally on
  the developer's machine whenever possible. The public
  `schemalattice.io` instance is a convenience, not a dependency.

**Enforcement point.** Code review discipline, plus an eval in
`packages/lattice-evals` that fails if `lattice-client` grows a
request-path translation API. See REQUIREMENTS §R5.

---

## How the Git-style diff format holds all this together

`specs/changeset-format.md` already defines the op set
(`add`/`remove`/`rename`/`retype`/`wrap`/`unwrap`/`nest`/`hoist`/
`extend`), the `upgradable` flag, and the rule that a changeset is
part of a forked concept's hashed canonical form — meaning the diff
is *identity-bearing*, not a commit note.

The five new constraints slot into the existing lattice-push workflow
as gates on that same publish path, in this order:

1. **Skeleton-ancestry gate (§1).** Before canonicalization, walk the
   parent chain. If it doesn't terminate at a skeleton root, reject
   with `ERR_NO_ROOT_ANCESTOR`. Forks inherit their parent's root
   ancestor for free; originals must name one.
2. **Metadata-friction gate (§2).** Require `definition`,
   `coRefersWith` (or rationale), and `closeMatch`/`broadMatch`.
   For forks specifically: if the changeset contains any `add` or
   `extend` op whose new field plausibly co-refers with fields in
   sibling forks, the server returns a soft warning the AI must
   either act on or explicitly dismiss with a `coRefersRationale`
   before the hash is minted.
3. **Shard gate (§3).** The publish call must name a shard. The
   canonical form includes `inScheme: <shard-uri>`, so the same
   concept published into two shards produces two different hashes
   — shards are identity-bearing, exactly like the changeset itself.
4. **Upgradability check (existing).** The server recomputes
   `upgradable` from the ops and rejects mismatched claims. Unchanged
   from `specs/changeset-format.md` — but now it runs *after* the
   three new gates so errors surface in a useful order.
5. **Local Register update (§4).** On successful publish, the server
   emits a `published` event. The developer's `lattice-client`, on
   next scan, picks this up and updates `usages`/`audits`. The server
   itself does not push — the register pulls, keeping the server
   stateless with respect to developer machines.

Gates 1–3 are **hash-blocking**: they run before the content hash is
computed, so a rejected concept leaves no trace in the blob store and
no orphan URIs. Gate 4 is also hash-blocking and already specified.
Gate 5 is post-hash and purely advisory.

The existing changeset ops don't change. What changes is that a
valid changeset is now *necessary but not sufficient* for a publish
to succeed — the concept it describes must also pass gates 1–3.

---

## Milestone summary

| Milestone | Deliverable | Spec source |
|---|---|---|
| v0.1-M1 | Skeleton seed + ancestry validator | §1, root-skeleton.md |
| v0.1-M2 | Friction validator + eval scenarios | §2, ai-checkpoints.md |
| v0.1-M3 | Shard-aware storage + `lattice-cli shard` | §3, uri-scheme.md |
| v0.1-M4 | `lattice-client` Local Register + `audit` CLI | §4, annotation-standard.md |
| v0.1-M5 | Build-time eval guardrails | §5, test-harness.md |

v0.2 items (deferred): Cambria lens upgrade path, `/reconcile`,
multi-instance federation across shards, governance/endorsement.
