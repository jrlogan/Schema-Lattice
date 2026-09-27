# SchemaLattice Architecture

## The layer cake

```
┌─────────────────────────────────────────────────────┐
│  Claude skill (skills/lattice-workflow.md)          │
│  Playbook: when and how to use the MCP tools        │
├─────────────────────────────────────────────────────┤
│  MCP server                                         │
│  Typed tools: discover, resolve, publish, etc.      │
├─────────────────────────────────────────────────────┤
│  HTTP API                                           │
│  JSON in, JSON out; /discover /concepts /publish    │
├─────────────────────────────────────────────────────┤
│  Core catalog logic                                 │
│  Content-hashing, lineage graph, embedding,         │
│  duplicate detection, SKOS/PAV validation           │
├─────────────────────────────────────────────────────┤
│  Storage                                            │
│  SQLite + file store (JSON blobs) + sqlite-vec      │
└─────────────────────────────────────────────────────┘

                        ↕  (separate consumer)

┌─────────────────────────────────────────────────────┐
│  TypeScript client library (for user-built apps)    │
│  resolve(uri), listContext(uri), etc.               │
└─────────────────────────────────────────────────────┘
```

## Key architectural properties

**Stateless above storage.** Everything above the storage layer is
re-derivable. Blow away the vector index and rebuild it from the blob
store. Blow away SQLite metadata and rebuild it from the blobs. Only
the blob store is precious.

**MCP is the primary AI surface.** The HTTP API exists for
non-MCP clients (runtime app library, CLI tools, future web UI), but
the MCP server is the interface that day-one clients — AI app builders
like Claude Code — will actually use.

**Two distinct consumers.** The MCP server serves the *building-time*
AI that's authoring an app. The TypeScript client library serves the
*running* app at runtime, fetching concept definitions and eventually
lenses when needed. These are different consumers with different needs;
keeping them separate prevents feature creep in either direction.

**Content-addressed identity.** Every concept URI contains a hash of
its canonical form. Updating a concept produces a new URI with
`pav:previousVersion` linking the old one. Mutable "latest version"
pointers work like git branches: small metadata table, cheap to update.

**Local embeddings only.** The catalog uses `bge-small-en-v1.5` via
`@xenova/transformers` for vector discovery. No remote API dependency,
no ongoing cost, no privacy concerns. Swappable to a paid model later
if quality demands it, but v0.1 is fully local.

**Single-instance by choice.** v0.1 runs as one server. Federation is
the thing that kills semantic-web projects in the first six months; we
explicitly defer it. Users run their own instance locally to start;
schemalattice.com is a shared public instance at the same codebase.

## Storage model

Three distinct record types stored as JSON blobs, each with its own
hash rules (see `specs/hashing-rules.md`):

- **Concept** — the primary unit. A `skos:Concept` enriched with PAV
  provenance and SchemaLattice extensions. Hash covers semantic content
  (labels, definition, relations, structure). Hash does NOT cover
  mutable metadata (adoption count, created date, embeddings).
- **Context** (ConceptScheme) — a named scope. Hash covers metadata
  (title, description, parents) but NOT membership, so adding a concept
  to a context doesn't change the context's URI.
- **Lens** (v0.2) — a Cambria lens connecting two concept schemas.
  Not in v0.1; forks in v0.1 use the simpler changeset format from
  `specs/changeset-format.md`.

SQLite holds:
- `concepts` table: URI, context, latest-pointer, adoption count,
  created-at, hash, blob pointer
- `contexts` table: URI, title, parent URIs
- `relations` table: from-URI, to-URI, relation-type (derivedFrom,
  broader, narrower, closeMatch, coRefersWith, etc.)
- `embeddings` virtual table (sqlite-vec): concept URI → embedding
- `events` table: session UUID, tool called, timestamp, payload
  summary (for learning loop)

## Request flow: `lattice_discover`

1. AI calls MCP tool with a natural-language description and optional
   context hint.
2. MCP layer forwards to HTTP `/discover`.
3. Server computes embedding for query text (local model, ~50ms).
4. sqlite-vec nearest-neighbor query returns top-20 candidates.
5. Re-rank by adoption count and recency.
6. Return top-10 with summaries (URI, prefLabel, definition excerpt,
   context, lineage depth, adoption count).
7. Log `discover` event with session UUID.

## Request flow: `lattice_publish_fork`

1. AI calls MCP tool with parent URI, new prefLabel, definition, and
   changeset.
2. MCP layer forwards to HTTP `/publish/fork`.
3. Server loads parent record, validates parent exists and user has
   publish rights.
4. Canonicalizes the new concept's form and computes content hash
   (see `specs/hashing-rules.md`).
5. Runs duplicate-check: embeds the new description, searches nearest
   neighbors, flags any with similarity > 0.85 as warnings.
6. Writes concept blob, updates SQLite metadata, creates
   `pav:derivedFrom` edge, stores changeset.
7. Returns assigned URI and any duplicate warnings.
8. Logs `fork` event.

## Directory layout (for implementation)

```
packages/
  lattice-server/     HTTP API + storage + core logic
    src/
      storage/        SQLite + blob store + sqlite-vec
      hashing/        Canonical form + content hashing
      skos/           SKOS validation
      pav/            PAV provenance handling
      discover/       Embeddings + nearest-neighbor
      http/           Route handlers
  lattice-mcp/        MCP server wrapping HTTP
    src/tools/        One file per tool
  lattice-evals/      Test harness — BUILD FIRST
    scenarios/        JSON files defining test cases
    runner/           Invokes Claude Code, captures runs
    evaluator/        Scores captured runs
    reporter/         Aggregates into readable reports
    runs/             Captured run artifacts (gitignored)
  lattice-client/     TS runtime library for user apps
  lattice-cli/        serve, import, export commands
skills/
  lattice-workflow.md Claude skill — the AI checkpoint playbook
specs/                Nine lockdown spec documents
examples/             Sample integrations (added as we build)
```

Note: **v0.1 does NOT pre-seed the lattice with starter concepts.**
The lattice starts empty. The Checkpoint 1D JIT mining protocol fills
the catalog on demand as the first wave of real uses hit domain gaps.
See `DECISIONS.md` → Just-in-time mining.

## External dependencies

All open source, zero cost at v0.1 scale:

- Node.js + TypeScript
- `better-sqlite3` or similar — SQLite binding
- `sqlite-vec` — vector search extension
- `@xenova/transformers` — local embeddings runtime
- `@modelcontextprotocol/sdk` — MCP reference SDK
- `hono` or `fastify` — HTTP framework
- `zod` — runtime schema validation

Deployment target: Hetzner CX11 (€3.29/month) + Caddy for HTTPS.
