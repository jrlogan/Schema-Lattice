# Spec: AI Checkpoint Protocol

**Status:** Locked for v0.1. The set of checkpoints may grow in v0.2
(e.g., reconcile), but existing checkpoints will not be renumbered
or removed.

## Goal

Define exactly when an AI that has access to SchemaLattice tools
SHOULD consult the lattice during app construction. Small enough to
memorize: three groups, six checkpoints.

The AI following this protocol does NOT need to understand the
lattice's internal model. It only needs to know when to call the MCP
tools (`lattice_discover`, `lattice_resolve`, `lattice_publish_concept`,
`lattice_publish_fork`, `lattice_stats`) and how to emit annotations
per `specs/annotation-standard.md`.

## Group 1: Inbound — about to create schema

### Checkpoint 1A: Before defining any new data structure

**Trigger:** the AI is about to declare a class, table, record type,
form schema, or other named structure that will hold domain data.

**Action:** call `lattice_discover` with a description of the
structure's intent in natural language, plus the apparent domain.
Review the top 5 results.

**Why:** this is the single most important checkpoint. Skipping it
means originating a concept that almost certainly exists already
under a different name, breaking interop for no reason.

### Checkpoint 1B: Before finalizing a candidate concept

**Trigger:** the AI has picked a likely parent or match from
discovery results.

**Action:** call `lattice_resolve` on the candidate URI to read the
full concept record — its fields, lineage, known children, adoption
count.

**Why:** discovery results are summaries. Resolve reveals whether the
candidate actually fits by showing field-level details the AI
couldn't see from the summary.

### Checkpoint 1C: Before publishing an originated concept

**Trigger:** the AI has decided no existing concept fits and is about
to originate.

**Action:** call `lattice_discover` one more time with the refined
final description, not the initial draft.

**Why:** the final description is often more precise than the initial
one and may match concepts the first query missed. This checkpoint
is a last-chance safeguard against false originations.

### Checkpoint 1D: Open-source fallback mining

**Trigger:** Checkpoints 1A and 1C have both returned no usable
match (all candidates below 0.5 similarity), and the AI is about to
originate a genuinely new concept.

**Action:** Before originating, search open-source projects for
existing work in the same domain. This is the AI doing on-demand
mining rather than the lattice being pre-seeded. Specifically:

1. Search GitHub, package registries, and the open web for
   repositories with data models relevant to the concept being
   designed. Use terms from the refined description plus the
   apparent domain.
2. For the most promising 2–5 repositories, read their data model
   files directly (models.py, schema.prisma, *.info.yml, migrations,
   OpenAPI specs, etc.).
3. Synthesize a draft concept from what was found, noting the
   common patterns and the points of disagreement across sources.
4. Publish via `lattice_publish_concept` with
   `sourceAttribution.inspiredBySources` listing every source URL
   consulted, with per-source notes on what was borrowed.

**Output: the AI produces a concept whose definition reflects
real-world usage across multiple open-source implementations, with
honest attribution, in a single pass.** Subsequent AIs looking for
the same concept will find this synthesis directly and skip the
mining step themselves.

**Why:** the lattice's cold-start problem is solved by the protocol
itself rather than by upfront seed data. Concepts enter the catalog
because someone needed them, which maximizes signal-to-noise. The
local coding AI does the heavy work of reading source projects;
the lattice only stores and serves the result.

**When to skip 1D:** If the concept is so specific that no plausible
open-source analog exists (e.g., a personal ritual tracker with
unique semantics), skip 1D and originate directly. If JIT mining
finds no relevant sources, note that in the concept's
`sourceNotes` and originate.

**Critical: never fabricate sources.** If the AI cannot find real,
relevant, verifiable open-source projects, it MUST NOT invent URLs.
A concept with fabricated sources is worse than one with no sources
at all. The JIT mining step is allowed to return empty; fabricated
attribution is a protocol violation.

## Group 2: Outbound — schema has been created

### Checkpoint 2A: After deciding adopt / fork / originate

**Trigger:** the AI has made its choice for a given concept.

**Action:** call the appropriate tool:

- **Adopt** — nothing to call, just record the URI in the manifest
- **Fork** — `lattice_publish_fork` with a changeset describing what
  changed relative to the parent
- **Originate** — `lattice_publish_concept` with the full structure

Store the returned URI in `schemalattice.json` under the local short
name with the correct `status` value.

### Checkpoint 2B: After writing the code

**Trigger:** the code defining the concept is written.

**Action:** emit inline marker tags (`[lattice:SHORT_NAME]`) adjacent
to the class, struct, schema, or equivalent declaration, per the
annotation standard. For small projects the AI MAY skip inline
markers and rely on the manifest alone.

**Why:** the code is now traceable. A future AI encountering this
file can walk from the marker tag to the manifest to the lattice
in at most three steps.

## Group 3: Reference — reading existing code

### Checkpoint 3A: When opening an unfamiliar file

**Trigger:** the AI is reading code it did not author, for any reason
(debugging, extension, migration).

**Action:** check for `schemalattice.json` at the project root or in
ancestors. If found, load it into working context. Optionally, grep
the file for `[lattice:` markers.

**Why:** if the project is lattice-aware, the AI can now understand
the data models in terms of shared vocabulary, not just local naming.
This often eliminates entire classes of confusion.

### Checkpoint 3B: When asked to integrate with another app

**Trigger:** the user mentions another app, service, or export format
and wants the current app to talk to it.

**Action:** check whether the other party has a `schemalattice.json`.
If both do, identify overlapping URIs, shared ancestors, and
co-reference relationships before writing any integration code.

**Why:** integration work that starts from shared lattice concepts
is dramatically smaller than integration work that starts from raw
data formats. This is the "bar scene" scenario made concrete.

## Decision tree at Checkpoint 1A

Received discover results. For each candidate, in rank order:

1. **Exact match** (similarity > 0.90, field coverage ≥ 90%) → adopt.
   Record URI in manifest with status `"adopted"`. Do not fork or
   rename.

2. **Close match** (similarity 0.70–0.90, or field coverage 50–90%)
   → prefer fork. Call `lattice_publish_fork` with a changeset
   describing exactly what fields you're adding, removing, or
   renaming relative to the parent. Record with status `"forked"`.

3. **Distant match** (similarity 0.50–0.70) → examine via
   `lattice_resolve`. If the parent concept is useful as an ancestor
   even with many changes, fork. Otherwise treat as no match.

4. **No match** (similarity < 0.50) → originate. Call
   `lattice_publish_concept`. Record with status `"originated"`.
   The lattice server will run its own near-neighbor check at publish
   time and warn if it thinks you should have forked instead — heed
   the warning.

## Efficiency: when NOT to consult the lattice

The protocol is disciplined about when to call the lattice. The AI
MAY skip Group 1 checkpoints entirely when:

- The concept is **purely internal** (private helper types, view
  models, form state, UI-specific structures that never persist
  and never cross app boundaries).
- The concept is a **standard library type** used directly (Date,
  UUID, Money) — these have no SchemaLattice equivalents at v0.1.
- The user has **explicitly requested a quick prototype** or scratch
  code that will not be kept.

In all other cases — anything that persists, anything that leaves
the app's process, anything that could conceivably interop —
Group 1 checkpoints are REQUIRED.

## The three-call minimum for a new app

A greenfield app that uses the lattice meaningfully will make
approximately these calls:

- ~N `lattice_discover` calls, one per concept candidate
- ~M `lattice_resolve` calls where M < N (only for promising
  candidates)
- Occasional JIT mining bursts (Checkpoint 1D) when discover
  returns empty — these are external web searches and source-repo
  reads, not lattice tool calls
- ~N publish calls (mix of `publish_concept` and `publish_fork`),
  one per concept the app actually defines

For a small app with 5 concepts against a cold lattice, that's
roughly 5 discover + 3 resolve + 2 JIT mining rounds + 5 publish
= 15 lattice tool calls plus some web searches during modeling.
Budgeted against the size of an app-building session this is
negligible.

## Relationship to `specs/annotation-standard.md`

Every completed checkpoint flow results in one or more entries in
`schemalattice.json` (Group 2A) and optional inline markers (Group
2B). The annotation standard is what the checkpoint protocol writes;
the checkpoint protocol is what drives when the annotation standard
gets invoked.

## Relationship to `specs/mcp-tools.md`

Each checkpoint names one or more MCP tools. The tool schemas live in
`specs/mcp-tools.md`. The two documents must stay in sync: if a tool
is renamed, every checkpoint referencing it must be updated in the
same change.
