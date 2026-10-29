# Spec: MCP Tool Schemas

**Status:** Locked for v0.1. Tool names and top-level parameter
shapes are external interface and changing them is expensive. Optional
parameters may be added without breaking existing clients.

## Goal

Define the exact MCP tools SchemaLattice exposes, their parameters,
their return shapes, and the descriptions clients (primarily AIs
building apps) will see. This is the interface the
`specs/ai-checkpoints.md` protocol calls.

## Tool set for v0.1

Seven tools, organized by which checkpoint calls them:

| Tool | Called at checkpoint |
|---|---|
| `lattice_discover` | 1A, 1C |
| `lattice_resolve` | 1B |
| `lattice_list_context` | (optional, supporting) |
| `lattice_publish_context` | 2A (pre-step, when no suitable context exists) |
| `lattice_publish_concept` | 2A (originate) |
| `lattice_publish_fork` | 2A (fork) |
| `lattice_stats` | supporting, called at any checkpoint |
| `lattice_compare` | 1B (deciding adopt vs fork), 3B (comparing two projects) |

(`lattice_compare` was added after the original seven; see
`specs/lifecycle-and-provenance.md`.)

## Tool profiles (context budget)

A client keeps every listed tool's schema in context for the whole session. All 38 tools are
about 9,600 tokens, so `/mcp` lists a profile instead (`src/mcp/server.ts` `PROFILES`):

| Profile | Tools | ~Tokens | Default for |
|---|---|---|---|
| `build` | discover, resolve, list_context, propose, feedback | 1,200 | anonymous |
| `publish` | build + compare, register_app, publish_context/concept/fork, list_usages, publish_community | 3,600 | app key |
| `sources` | build + the nine source tools | 4,200 | |
| `reports` | build + stats, demand/evidence/mesh/app/portfolio/community reports, compare | 2,300 | |
| `api` | build + the four API-design tools | 2,300 | |
| `contribute` | build + contribute, withdraw_contribution | 1,600 | |
| `all` | everything (38) | 9,600 | operator key, local stdio |

Choose with `/mcp?profile=build,sources` or `?tools=discover,resolve` (stdio:
`LATTICE_MCP_PROFILE`, `LATTICE_MCP_TOOLS`). Profiles trim the list only: an unlisted tool is
still callable, and the caller's key still decides what is allowed. The MCP-free path is the
skill at `/skill/SKILL.md`, which drives the client's lookup commands.

When adding a tool, put it in the profile its users connect with, and keep its description to
what an agent needs in order to choose and call it. Longer guidance belongs in `skills/`.

## Community tools

Communities are stewarded views over public contexts (`specs/communities-and-sub-lattices.md`).

- **`lattice_publish_community`** (write) takes `{ slug, title?, charter?, contexts?,
  jurisdictions?, stewards?, conventions? }`. The operator creates a community and names its
  stewards (app slugs). A steward may change everything else. Omitted fields keep their values.
  Errors: `ERR_OPERATOR_ONLY`, `ERR_NOT_STEWARD`, `ERR_UNKNOWN_CONTEXT`, `ERR_UNKNOWN_APP`,
  `ERR_JURISDICTION_INVALID`, `ERR_COMMUNITY_CHARTER_TOO_SHORT`.
- **`lattice_community_report`** (read) takes `{ slug? }`. With no slug it lists communities.
  With a slug it returns the charter, contexts with counts, newest concepts, member apps and
  mesh links between them, sources in its jurisdictions, unmet searches, evidence about its
  concepts, and its pack path.
- **`community`** is accepted by `lattice_discover` (search only its contexts; logged for its
  demand report), by `lattice_demand_report` (only its searches) and by
  `lattice_publish_context` (add the new context to it; a steward needs no contributor tier).
  `lattice_register_app` takes **`communities: []`**, which replaces the app's memberships;
  omit it to keep them.

## `lattice_discover`

**Description (shown to AI clients):**

> Semantic search for existing SchemaLattice concepts. Call this
> before creating any new data model concept in your app. Returns a
> ranked list of candidates with similarity scores. Each candidate
> includes enough info to decide whether to adopt, fork, or keep
> looking. If nothing scores above 0.55, the concept probably needs
> to be originated.

**Parameters:**

```typescript
{
  description: string;           // Natural language description of intent
  contextHint?: string;          // Optional context URI to prefer
  contexts?: string[];           // Search ONLY these contexts (slugs or URIs)
  limit?: number;                // Default 10, max 25
  sessionId?: string;            // Stable build-session id (see below)
  ephemeral?: boolean;           // Do not record the query wording
}
```

**Returns:**

```typescript
{
  query: string;
  verdict: "adopt" | "fork" | "distant" | "no-match"; // band of the TOP result
  guidance: string;              // one-sentence instruction for that band
  contexts?: string[];           // resolved context URIs, when filtered
  results: Array<{
    uri: string;
    prefLabel: string;
    definitionExcerpt: string;   // First 200 chars
    context: {
      uri: string;
      title: string;
    };
    similarity: number;          // 0.0 to 1.0
    adoptionCount: number;
    forkCount: number;
    lineageDepth: number;        // How many forks from top
    forkedFrom?: string;         // Parent URI if this is itself a fork
    nearestNeighborsCount: number;
  }>;
  suggestions: {
    refinements: string[];       // Suggested description tweaks
  };
  sessionId: string;
}
```

**Server behavior:**

1. Embed the query using the configured local embedding model.
2. Query the vector index for the top 20 nearest neighbors.
3. Re-rank: similarity is primary, adoption count is a tie-breaker,
   recency is a final tie-breaker.
4. Filter by `contextHint` if provided (but return cross-context
   results too, demoted one rank).
5. If `contexts` is given, keep only candidates in those contexts,
   searching the whole index rather than the top 20. A slug covers
   every version of that context; an unknown slug or URI is an
   `invalid-parameter` error, never a silently empty result. Naming a
   reserved context (e.g. `governance`) here opts in to searching it.
6. Truncate to `limit` and set `verdict` from the top similarity using
   the calibrated bands (`specs/ai-checkpoints.md`): ≥0.85 adopt,
   0.65–0.85 fork, 0.55–0.65 distant, below 0.55 (or no results)
   no-match. On no-match the nearest concepts are still listed, but
   `guidance` says plainly that none of them should be adopted or
   forked — the least-bad candidate is not a match.
7. Log a `discover` event with the session UUID (query wording
   omitted when `ephemeral`).

The REST convenience route mirrors these parameters:
`GET /discover?description=…&context=a,b&ephemeral=true` (`context`
may also repeat).

---

## `lattice_resolve`

**Description:**

> Fetch a single SchemaLattice concept's full record. Use this after
> `lattice_discover` when you need to examine a candidate in detail
> before deciding to adopt or fork. Returns the concept's structure,
> full lineage, known forks, and all related concepts.

**Parameters:**

```typescript
{
  uri: string;                   // Canonical concept URI
  includeNeighbors?: boolean;    // Default true — include 5 nearest related
}
```

**Returns:**

```typescript
{
  uri: string;
  type: "Concept";
  inScheme: { uri: string; title: string };
  prefLabel: Record<string, string>;
  altLabel: Record<string, string[]>;
  definition: Record<string, string>;
  structure?: object;            // The field shape if any
  relations: {
    broader: string[];
    narrower: string[];
    related: string[];
    closeMatch: string[];
    coRefersWith: string[];
  };
  lineage: {
    derivedFrom?: string;
    forkedFrom?: string;
    previousVersion?: string;
    forks: string[];             // URIs of concepts forked from this
    children: string[];          // URIs narrowing this
  };
  provenance: {
    createdOn: string;            // ISO 8601
    createdBy: string[];
    importedFrom?: string;
    sourceLicense?: string;
  };
  stats: {
    adoptionCount: number;
    forkCount: number;
  };
  neighbors?: Array<{
    uri: string;
    prefLabel: string;
    similarity: number;
  }>;
}
```

---

## `lattice_list_context`

**Description:**

> With a contextUri, list all concepts in that SchemaLattice context —
> the full vocabulary, not just semantically-nearest matches. Without
> one, list every context in the catalog (slug, title, concept count,
> and which version is latest), which is how to find an existing
> context to publish into.

**Parameters:**

```typescript
{
  contextUri?: string;           // Omit to list every context
  limit?: number;                // Default 100
  offset?: number;
}
```

**Returns, with no `contextUri`:**

```typescript
{
  contexts: Array<{
    uri: string;
    slug: string;
    title: string;
    definitionExcerpt: string;
    conceptCount: number;
    latest: boolean;             // other versions share the slug
  }>;                            // sorted by slug, latest version first
}
```

**Returns, with a `contextUri`:**

```typescript
{
  context: {
    uri: string;
    title: string;
    definition: string;
    parentContexts: string[];
  };
  concepts: Array<{
    uri: string;
    prefLabel: string;
    definitionExcerpt: string;
    adoptionCount: number;
    isTopConcept: boolean;
  }>;
  totalCount: number;
  hasMore: boolean;
}
```

---

## `lattice_publish_context`

**Description:**

> Create a new SchemaLattice context (ConceptScheme) to hold concepts
> you're about to publish. Use this ONLY when no suitable existing
> context was found via `lattice_discover` or `lattice_list_context`
> AND you are about to originate or fork into a concept that needs a
> home. Context naming matters: use domain-generic slugs (`scuba-ops`,
> `trail-ops`, `volunteer-ops`, `equipment-lending`) rather than
> app-specific ones (`my-scuba-club-app`) so future AIs building apps
> in the same domain can discover and reuse this vocabulary. Returns
> a canonical context URI you then pass as `contextUri` to
> `lattice_publish_concept` or `lattice_publish_fork`.

**Parameters:**

```typescript
{
  slug: string;                  // Kebab-case, 2-40 chars, starts with letter
  title: string;                 // Human-readable title
  definition: string;            // One-paragraph description
  parentContextUris?: string[];  // Optional: broader contexts this specializes
}
```

**Returns:**

```typescript
{
  uri: string;                   // Assigned canonical context URI
  slug: string;                  // Normalized slug (may differ if sanitized)
  title: string;
  published: boolean;
}
```

**Server behavior:**

1. Validate slug matches `^[a-z][a-z0-9-]{1,39}$`.
2. Reject reserved slugs (skos, pav, schemalattice, system, test).
3. Canonicalize context metadata and compute content hash per
   `specs/hashing-rules.md`.
4. Check whether an existing context already has this slug; if so,
   return a near-duplicate warning with the existing URI (do not
   create a duplicate).
5. Assign URI, write blob, log a `publish_context` event.
6. Return URI.

**Naming rules (critical):**

- Good slugs: `scuba-ops`, `trail-ops`, `volunteer-ops`,
  `equipment-lending`, `personal-goals`, `member-org`
- Bad slugs: `my-app`, `scuba-club`, `johns-dive-log`,
  `makehaven-specific`, anything tied to a single installation
  or user

If the AI cannot think of a domain-generic name, that's a signal
to use a broader existing parent context rather than creating a
new one. Prefer reuse over narrow origination.

---

## `lattice_publish_concept`

**Description:**

> Publish a new original concept to SchemaLattice. Use this only when
> `lattice_discover` has returned no suitable match (similarity < 0.55
> across all candidates) and you've rerun discover with the refined
> description. Will reject the publish if the server detects a very
> close existing concept you missed.

**Parameters:**

```typescript
{
  contextUri: string;
  prefLabel: string;             // Language: en assumed unless explicit
  definition: string;
  conceptKind?: "entity" | "event" | "classification" | "workflow"
              | "measurement" | "agent" | "place";
  altLabels?: string[];
  structure?: object;            // Optional field shape; fields may carry
                                 // classification, provenance, immutableFrom,
                                 // and the structure may carry a lifecycle
                                 // (specs/lifecycle-and-provenance.md)
  broader?: string[];            // URIs — prefer skeleton nodes
  related?: string[];            // URIs
  coRefersWith?: string[];       // URIs
  sourceAttribution?: {
    importedFrom?: string;
    authoredBy?: string | string[]; // one author may be a plain string
    sourceLicense?: string;
    sourceNotes?: string;
    inspiredBySources?: Array<
      string | { url: string; note?: string; commitHash?: string }
    >;
  };
}
```

**`conceptKind` is optional but strongly recommended.** When set,
discovery queries can filter by kind, and the AI consuming the
discovery response has a useful hint about which fields and
relations to expect. Valid values mirror those in
`specs/json-ld-context.md` and `specs/root-skeleton.md`.

**Returns:**

```typescript
{
  uri: string;                   // Assigned canonical URI
  context: string;
  warnings: Array<{
    kind: "possible-duplicate";
    candidateUri: string;
    candidateLabel: string;
    similarity: number;
    message: string;
  } | {
    kind: "weak-external-match" | "lifecycle-unreachable-state"
        | "lifecycle-terminal-exit";
    message: string;             // advisory only; the concept is published
  }>;
  published: boolean;            // False if blocked by warning severity
}
```

**JIT mining note:** when this tool is called after Checkpoint 1D
has performed open-source fallback mining, `sourceAttribution.inspiredBySources`
SHOULD list every source URL consulted. The server logs these in
the events table so downstream analytics can identify which
open-source projects are most influential in the catalog.

**Server behavior:**

1. Validate required fields.
2. Canonicalize and compute content hash.
3. Run duplicate-check: embed the new definition, find nearest
   neighbors. Any above 0.85 → warning. Any above 0.93 → block
   (unless a future `forcePublish` flag is set).
4. Assign URI, write blob, update metadata, log `originate` event.
5. Return URI and any warnings.

---

## `lattice_publish_fork`

**Description:**

> Publish a new concept derived from an existing SchemaLattice
> concept. Use this when `lattice_discover` found a close match
> (similarity 0.7–0.9) that needs modifications to fit your use
> case. You MUST provide a changeset describing what fields you're
> adding, removing, or renaming.

**Parameters:**

```typescript
{
  parentUri: string;
  contextUri: string;            // Where the fork lives (may differ from parent's)
  prefLabel: string;
  definition: string;
  altLabels?: string[];
  changeset: {
    ops: Array<{
      op: "add" | "remove" | "rename" | "retype" | "wrap" | "unwrap"
          | "nest" | "hoist" | "extend";
      // Op-specific fields per specs/changeset-format.md
      [key: string]: unknown;
    }>;
    note?: string;
  };
  coRefersWith?: string[];
  sourceAttribution?: {
    importedFrom?: string;
    authoredBy?: string | string[]; // one author may be a plain string
    sourceLicense?: string;
  };
}
```

**Returns:**

```typescript
{
  uri: string;                   // Assigned canonical URI
  forkedFrom: string;
  upgradable: boolean;           // Computed from changeset ops
  warnings: Array<{
    kind: string;
    message: string;
  }>;
  published: boolean;
}
```

**Server behavior:**

1. Validate that `parentUri` exists and is resolvable.
2. Validate every changeset op against the parent's structure
   (field names for `remove`/`rename`/`retype` must exist; names
   for `add`/`extend` must not exist).
3. Compute `upgradable` from the ops: true iff every op is a v0.1
   op with a Cambria mapping (no `extend`).
4. Canonicalize the child record (including the changeset, which is
   hashed).
5. Assign URI, write blob, create `forkedFrom` edge, log `fork` event.
6. Return URI, upgradable flag, any warnings.

---

## `lattice_compare`

**Description:**

> Compare two SchemaLattice concepts side by side: every field on both
> sides, which were renamed into which (read from the changeset when one
> forks the other), where type, sensitivity classification or capture
> provenance differ, and which lifecycle states and transitions only one
> side has.

**Parameters:** `{ a: string; b: string }`, two concept URIs. By
convention `a` is the parent or the partner's concept and `b` the fork or
your own.

**Returns:**

```typescript
{
  a: { uri: string; prefLabel: string; context: string };
  b: { uri: string; prefLabel: string; context: string };
  relation:
    | { kind: "b-forks-a" | "a-forks-b"; changeset: object }
    | { kind: "siblings"; parent: string }
    | { kind: "same" | "unrelated" };
  fields: Array<{
    change: "same" | "changed" | "renamed" | "only-a" | "only-b";
    a?: FieldSide; b?: FieldSide;   // name, type, classification,
                                    // provenance, immutableFrom, unit, required
    differences: string[];          // attribute names that differ
  }>;
  lifecycle: null | {
    a: { initial: string; states: string[] } | null;
    b: { initial: string; states: string[] } | null;
    statesOnlyA: string[]; statesOnlyB: string[];
    transitionsOnlyA: string[]; transitionsOnlyB: string[];
  };
  summary: string[];               // plain-English sentences
  table: string;                   // the field rows as a Markdown table
}
```

Unknown URIs return `not-found`. Read-only; logs nothing.

---

## `lattice_stats`

**Description:**

> Retrieve usage statistics for a SchemaLattice concept: how many
> projects have adopted it, how many times it has been forked, and
> recent activity. Use this to inform adopt/fork/originate decisions
> — a heavily adopted concept is usually a better choice than a
> near-neighbor with no adopters.

**Parameters:**

```typescript
{
  uri: string;
}
```

**Returns:**

```typescript
{
  uri: string;
  stats: {
    adoptionCount: number;
    forkCount: number;
    directChildren: number;      // Depth-1 forks
    totalDescendants: number;    // Transitive fork tree size
    firstSeen: string;           // ISO 8601
    lastActivity: string;
  };
  trending: {
    adoptionsLast30Days: number;
    forksLast30Days: number;
  };
}
```

**Server behavior:**

1. Query aggregated counts from the events table.
2. Cache results for 60 seconds to handle repeated lookups during a
   single AI session cheaply.
3. Never logs a new event (stats queries are read-only).

---

## Error handling

All tools return a standard error shape on failure:

```typescript
{
  error: {
    code: "not-found" | "invalid-parameter" | "duplicate-blocked"
          | "server-error" | "rate-limited";
    message: string;
    details?: object;
  };
}
```

AIs calling the tools should inspect `error.code` and respond
gracefully:

- `not-found` on resolve → likely a stale URI; re-run discover
- `duplicate-blocked` on publish → read the suggestion and either
  adopt the existing concept or fork it
- `rate-limited` → wait and retry once

## What's deliberately NOT in v0.1

- `lattice_reconcile` — app-to-app negotiation; v0.2
- `lattice_suggest_parents` — abstract-parent proposal from clusters;
  v0.2 unless easy to add late in v0.1
- `lattice_merge` — multi-parent merges; v0.2
- `lattice_adopt` — explicit adoption tool; in v0.1, adopt is
  implicit and recorded only in the client's manifest
- Any tool for withdrawing/deprecating concepts; v0.2

## `lattice_demand_report` (v0.1 M3)

> Unmet demand: discover queries whose best match fell below the fork
> band, clustered by meaning and ranked by how often they were asked.
> Each cluster names the closest existing concept, so genuinely
> missing vocabulary is distinguishable from queries that needed
> better phrasing. This is the queue of concepts worth publishing
> next — the read side of the just-in-time mining loop.

```typescript
{
  threshold?: number;            // Unmet if top similarity < this (default 0.65)
  limit?: number;                // Max clusters (default 20)
}
```

Returns `{ totalDiscoverEvents, unmetQueryCount, noiseExcluded,
clustersNowMet, unmetThreshold, clusters: [{ count, representative,
queries, nearestExisting, sessions, lastAsked }] }`. Read-only; never
logs an event.

- **Contentless queries are excluded** (`noiseExcluded` counts them):
  a query must contain at least one word of three or more letters.
  Short real asks such as "berth" or "GPS fix" still count.
- **Clusters are re-scored against today's catalog.** `nearestExisting`
  is the best current match for any phrasing in the cluster (reserved
  vocabularies excluded), not the score at the time it was asked. A
  cluster the catalog now meets (≥ threshold) is dropped and counted
  in `clustersNowMet`, so the report shows the loop closing.

Two related M3 behaviors of `lattice_discover`:

- **Reserved vocabularies are excluded from results.** Concepts in
  the `governance` context tag fields; they are not domain concepts
  and no longer compete in discovery. Pass the governance context
  URI as `contextHint` to search it deliberately.
- **The response carries a `sessionId`.** The caller's own echoed
  back, or a server-minted one when omitted. Publish tools require a
  prior discover under the same id (R2), so clients quote this value
  back rather than inventing one at publish time.

## Evidence tools (v0.2 phase 1)

See `specs/evidence-ledger.md` for the model: claims are quarantined and
only change discover once independent, weighted sources agree.

### `lattice_propose`

> After you resolve a discover result and decide, say whether it was
> right or wrong for your query.

```typescript
{
  kind?: "match";                 // phase 1 accepts only match
  sessionId: string;              // your lattice_discover session
  conceptUri: string;             // must be a result that session was shown
  verdict: "right" | "wrong";
  reason?: "different-referent" | "too-broad" | "too-narrow" | "wrong-domain";  // required when wrong
  note?: string;                  // ≤500 chars; public report shows 240
}
→ { id, status: "pending", claimKey,
    corroboration: { independentSources, needed, nonAnonymousNeeded, earliestPromotion } }
```

Not key-gated; rate-limited in its own `evidence` bucket (20/min per
client) plus 200/day per source. An app key makes the evidence count
for more once the app is established. Pass the same `sessionId` to
`lattice_resolve` first: verdicts on unresolved concepts weigh half.

### `lattice_evidence_report`

Public. Pending claims with their progress toward promotion, promoted
claims (affecting discover), retracted and frozen ones, the rules, and
the operator switches. Notes are truncated and marked untrusted.

### `lattice_evidence_admin`

Operator only. `freeze` / `unfreeze` / `retract` a claim (by claim key
or state key), `purge-source`, `purge-contributions` (every builder
contribution from one source), or `switch` `accept` / `apply` on or off.

### `lattice_contribute`

> Send back types you designed that the catalog does not have.

See `specs/builder-contributions.md`. Mints nothing; contributions are
grouped into concept candidates in `lattice_demand_report`.

```typescript
{
  types: Array<{                  // ≤20 per submission, ≤16 KB in all
    label: string;                // ≤60
    broader: string;              // a root concept URI (Event, Location, …)
    definition: string;           // one sentence, ≤300
    fields: Array<{ name; type; required?; values?; unit?; itemType? }>;  // ≤40
  }>;
  sourceQuery?: string;           // the search that showed the gap, ≤300
}
→ { submissionId, withdrawToken, accepted: [{ label, id }],
    alreadyInCatalog: [{ label, uri, prefLabel, similarity }], notice }
```

Not key-gated; `evidence` rate-limit bucket plus 50 types/day per
source. Common type spellings (`timestamp`, `uuid`, `int`, `text`) are
mapped to catalog types. A type within 0.85 of an existing concept is
returned in `alreadyInCatalog` and not stored. The page at
`/contribute` calls this tool after showing the person the payload.

### `lattice_withdraw_contribution`

`{ token }` → `{ removed }`. Removes a whole submission; tokens are
single-use and stored hashed.

### `candidates` on `lattice_demand_report`

Clusters of contributed types under the same root. Public callers see
a candidate once 2 independent sources contributed it, and only enum
values 2+ sources share; the operator sees everything.

```typescript
{ id, label, labels, broader: { uri, prefLabel }, sources, contributions,
  definitions, fields: [{ name, type, sources, required, values?, unit? }],
  sourceQueries, nearestExisting, firstAt, lastAt }
```

### Effect on `lattice_discover`

A result covered by promoted evidence for queries like yours carries:

```typescript
adjustedSimilarity: number;       // raw − 0.05 for a promoted "wrong"; raw + 0.02 for "right"
evidence: { caution?: { reason, sources }, confirmed?: { sources }, note }
```

Results are ordered by the adjusted score; `similarity` stays raw and
`verdict` is always computed on raw scores.

## `lattice_mesh_report`

```typescript
{ a: "app:<slug>" | "source:<slug>" | { manifest: object, name?: string },
  b: same }
→ { a, b: { kind, id, name, concepts },
    fit: number,                         // 0-100: how cleanly the shared part connects
    overlap: { connected, aConcepts, bConcepts, ofSmaller },   // how much there is to connect
    score: number,                       // = fit
    counts: { direct, translate, manual, gap, spatial },
    challenges: string[],                // plain English, most important first
    spatial: Array<{ points, areas, method: "point-in-polygon", how }>,
    pairs: Array<{ grade: "direct" | "translate" | "manual" | "gap",
                   match: "same" | "lineage" | "coreference" | "similar" | null,
                   a, b: { locals, uri, label } | null, similarity?, how,
                   fields?: Array<{ a?, b?, conceptField,
                                    status: "direct" | "convert" | "a-only" | "b-only",
                                    why?, personal? }>,
                   score }>,
    notes, legend }
```

Both sides resolve to the current versions of their concepts. Pairs are
matched strongest first: the same concept, then shared fork or version
lineage, then a declared co-reference, then embedding similarity ≥ 0.72.
Field rows come from `lattice_compare`, restricted to the fields each side
fills: from registered usage `fields` (see `lattice_register_app`), from a
source's mappings, or from a manifest's `fieldMaps`. A pasted manifest is
used for the computation and never stored or logged. `GET /mesh` is the
same report as a page.

**Manifests:**
- `concepts` may be the manifest's object form or the registry's array form (`[{ shortName, uri }]`).
- A concept with `status: "forked"` and a `forkedFrom` but no `uri` of its
  own (an unpublished fork) is compared through its parent. It is a
  `lineage` match at best, never `same`, and is noted. An honest fork
  therefore scores just below plain adoption, instead of disappearing.
- `fieldMaps` `source.concept` and `target.concept` may be local names.
  Field names that are not fields of the concept (wire names such as
  Open311's `service_code`) are reported in `notes` and not counted.

**Spatial:** when one side's records carry a point location and the other
side is an area layer, the report adds a point-in-polygon entry to
`spatial` and to the challenges. A point location comes from a concept's
latitude/longitude or point-geometry fields, or from a source's geometry.
Sides that share no concept but connect by location are not reported as
having nothing in common.

## Public source tools (evidence phase 2)

Full design: `public-sources.md`. A source is a public dataset or
published standard; a mapping says which of its fields carries which
concept field. Curators' (operator, contributor-tier apps) submissions
take effect at once; everyone else's are evidence claims, listed once
corroborated. None of these tools needs a key.

### `lattice_find_sources`

```typescript
{ description?: string; jurisdiction?: string; conceptUri?: string;   // at least one
  includeProposed?: boolean; limit?: number; ephemeral?: boolean; sessionId?: string }
→ { results: Array<{ slug, title, kind, publisher, jurisdiction, coverage?: "exact" | "broader" | "narrower",
      recordDescription, status: "listed" | "proposed", platform, accessUrl, similarity?,
      carries: Array<{ conceptUri, prefLabel, role, mappedFields }> }>;
    met: boolean; notice: string; next: string }
```

`jurisdiction` is `US`, `US-CT` or `US-CT/new-haven`; sources covering a
broader area are included. Searches are logged (wording omitted when
`ephemeral`); unmet ones appear in `lattice_sources_report`.

### `lattice_resolve_source`

`{ slug }` → the source's metadata, `exampleQuery`, `fields` (each with
`means: [{ conceptUri, concept, field, conversion?, curatedBy? | corroboratedBy? }]`),
`carries`, `unmappedFields`, and `related: [{ slug, title, jurisdiction,
joins: [{ kind: "key" | "attribute" | "spatial", via, pairs: [{ a, b, conceptField }], how }] }]`.

### `lattice_propose_source`

`{ accessUrl, publisher?, jurisdiction?, recordDescription?, title?, slug?, kind?,
landingPage?, format?, license?, updateFrequency?, conformsTo?, platform?: "manual", fields?, note? }`
→ `{ slug, status: "listed" | "proposed", fieldsVerified, fieldCount, evidence, next }`.
ArcGIS layer and Socrata dataset URLs have their field lists read from the
publisher; anything else needs `platform: "manual"` and `fields`.
Re-proposing a known `accessUrl` corroborates the existing source.

### `lattice_map_source`

`{ source, conceptUri, role?: "record" | "reference", fields: [{ from, to, conversion?, verdict? }], note? }`
→ `{ recorded, listedNow, pending, pairs: [{ from, to, verdict, status, independentSources }] }`.
Every `from` must be in the source's field list and every `to` in the
concept's structure; one bad pair refuses the whole call, listing each
problem.

### `lattice_check_source`

`{ slug }` → `{ checked, added, removed, retyped, mappingsBroken }`, after
re-reading the field list from the publisher.

### `lattice_sources_report`

`{}` → `{ counts, proposed, pendingMappings, disputes, unmetSearches, unmappedFields }`.

### Changes to existing tools

- `lattice_resolve` returns `publicSources`: listed sources mapping onto
  the concept, with role and mapped field pairs.
- `lattice_discover` results carry `publicSources: n` when n > 0.
- `lattice_evidence_admin` gains `withdraw-source` (target: slug), and
  `switch` accepts `<kind>.accept` / `<kind>.apply` (`source`,
  `field-mapping`).

## Registry tools (v0.1 M2.75)

The app registry is the aggregation point for manifests, ownership,
sensitivity profiles, and gate attestations. Server-side logic is
implemented in `packages/lattice-server/src/registry/registry.ts`;
these tool surfaces wrap it when the MCP transport lands. This section
also supplies the `lattice_list_usages` tool that ROADMAP §4 requires.
Everything here is organization-neutral: `unit` is whatever the
deployment's org structure calls it — a department, shop area, team,
or committee.

### `lattice_register_app`

> Register (or update) an app in the catalog's registry: its owner,
> status, and the manifest of lattice concepts it uses. Call after
> writing `schemalattice.json` (Checkpoint 2A) so other teams can
> find the app and its vocabulary.

```typescript
{
  slug: string;                  // ^[a-z0-9][a-z0-9-]{1,39}$
  name: string;
  description?: string;
  unit: string;                  // owning org unit
  owner: string;                 // responsible person/role
  contact?: string;
  status: "experiment" | "pilot" | "production" | "retired";
  concepts: Array<{ uri: string; status: "adopted"|"forked"|"originated"; shortName?: string }>;
}
```

Re-registering the same slug updates in place. Manifests referencing
unknown concept URIs are rejected (`ERR_UNKNOWN_CONCEPT`).

### `lattice_record_attestation`

> Record a build-time gate's result against a registered app, in the
> `governance/attestation` shape. The registry stores results; it
> never runs checks or enforces policy.

```typescript
{
  app: string;                   // registered slug
  gate: string;                  // e.g. "security-review"
  gateVersion?: string;
  result: "pass" | "fail" | "waived";
  performedBy: string;
  performedOn: string;           // ISO date
  findingsRef?: string;
  notes?: string;
}
```

### `lattice_list_usages`

> Which registered apps use a concept URI, with each app's unit and
> adoption status. The Local Register (R4 client side) reconciles
> against this.

### `lattice_app_report`

> One app in full: manifest, connectivity score (reuse / dedupe /
> anchoring), sensitivity profile, attestations, and overlaps with
> every other registered app.

### `lattice_portfolio_report`

> The program-owner view: every registered app with score, profile,
> and attestations; pairwise compatibility; and advisory audit
> findings (unlinked near-duplicates, fork bridges between units,
> unclassified-field coverage gaps, sensitive profiles with no
> recorded attestation). Findings are advisory — nothing is
> auto-fixed, and rank-to-policy mapping stays with the organization.

## API design advisor tools

Implemented in the shared HTTP/MCP tool table; detailed contract and evidence limits
are in [api-design-advisor.md](api-design-advisor.md).

- `lattice_advise_api` (read): `app`, `purpose`, `consumers`, optional resource/field
  bindings and candidate source slugs → deterministic proposal, field comparisons,
  native OpenAPI 3.1 draft, unresolved conversions, evidence hash and proposal ID.
- `lattice_accept_api_design` (write, owning app or operator): unchanged `request`,
  `proposalId`, one `{conceptUri, source}` choice per resource, and `rationale` → an
  attributable, idempotent design decision. `source:null` explicitly keeps the
  native API. Stale proposals are refused. Call only after explicit review.
- `lattice_api_design_history` (read): `app` → design decisions with actor,
  timestamp, proposal/evidence hashes, choices and rationale.

These tools do not deploy APIs, publish concepts, execute adapters or certify a
standard. Recorded choices mean design intent, distinct from verified adoption.

### `lattice_api_design_snapshot`

Public read. Uses the same input schema as `lattice_advise_api`. Returns the
registered app, selected concept records, relevant listed source fields and
mappings, shared-concept peers, and latest relevant accepted design choices.
No embeddings, external fetches, AI calls or catalog events are generated.
Pass the result and the same request to the offline advisor engine to reproduce
a proposal. Acceptance revalidates current evidence; a downloaded snapshot does
not authorize a write. The CLI downloads snapshots rather than requesting
server-side proposal generation.

App and portfolio report tools retain their response contracts but run through
a shared background worker and revision-aware cache. Overload rejects queued
work rather than growing an unbounded queue. Reports are consistent as of their
read snapshot, not a guarantee that no concurrent write has happened.
