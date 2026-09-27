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

> List all concepts in a SchemaLattice context. Use this after you've
> found a relevant context through discover and want to see the full
> vocabulary available, not just semantically-nearest matches.

**Parameters:**

```typescript
{
  contextUri: string;
  limit?: number;                // Default 100
  offset?: number;
}
```

**Returns:**

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
  structure?: object;            // Optional field shape
  broader?: string[];            // URIs — prefer skeleton nodes
  related?: string[];            // URIs
  coRefersWith?: string[];       // URIs
  sourceAttribution?: {
    importedFrom?: string;
    authoredBy?: string[];
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
    authoredBy?: string[];
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
