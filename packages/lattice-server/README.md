# lattice-server (v0.1 M3 transport)

SchemaLattice server core: skeleton seed, the R1 ancestry gate, the R2
metadata-friction gate, local embeddings, semantic discover, and
publish-time duplicate detection.

## What's here

- `src/hashing/` — canonicalization + SHA-256 hash per `specs/hashing-rules.md`
- `src/storage/` — better-sqlite3 + local blob store
- `src/seed/` — 16 skeleton concepts (`specs/root-skeleton.md`) plus
  the reserved `governance` context: 9 data-sensitivity classes and
  the shared attestation record shape (`specs/data-classification.md`)
- `src/publish/` — R1 ancestry gate, R2 friction gate (`friction.ts`),
  field-classification validation + sensitivity profiles
  (`classification.ts`), duplicate detection, `publishConcept()`
  entry point
- `src/discover/` — `bge-small-en-v1.5` local embeddings
  (`@xenova/transformers`), sqlite-vec index, `discover()` per
  `specs/mcp-tools.md`
- `src/registry/` — the app registry: register apps (owner, unit,
  status, manifest), record gate attestations, list usages per
  concept, connectivity scores, sensitivity profiles, pairwise
  overlaps, advisory audits, and the portfolio report
- `src/server/` — in-process API surface (not HTTP yet); construction
  is async (`await LatticeInstance.create(...)`) because the embedding
  model loads and the vector index backfills at boot
- `examples/new-haven-demo.ts` — three city departments sharing one
  lattice: greenfield publish, discover-then-fork, legacy retrofit,
  and a near-duplicate publish drawing a warning

The embedding model (~34MB quantized ONNX) downloads from the
HuggingFace hub on first run and is cached locally after that.

## Transport

The catalog engine is transport-agnostic. `src/tools/tools.ts` holds the
thirteen v0.1 tools — name, AI-facing description, JSON Schema, handler —
and both transports mount that same table, so they cannot drift apart.

```
npm run mcp     # MCP over stdio; what a local AI client connects to
npm run serve   # HTTP on 127.0.0.1:7000
```

`.mcp.json` at the repo root wires the stdio server into Claude Code.

The HTTP surface:

| Route | |
|---|---|
| `GET /` | service description and endpoint list |
| `GET /health` | catalog totals |
| `GET /c/{context}/{slug}@{hash}` | resolve a concept by its canonical path |
| `GET /s/{context}@{hash}` | resolve a context |
| `GET /s/{context}@{hash}/concepts` | list a context's concepts |
| `GET /discover?description=…&context=…&ephemeral=true` | discover without a POST body; `context` (repeatable or comma-separated slugs/URIs) restricts the search |
| `GET /api/tools` | the tool table with schemas |
| `POST /api/tools/{name}` | call any tool |
| `POST /mcp` | MCP over streamable HTTP (stateless) |

Canonical URIs stay `https://schemalattice.com/...` no matter which host
serves them, so the resolution routes match on path alone — a URI minted
on `localhost:7000` resolves unchanged against the public instance.

Reads are public over REST and MCP. Writes require `Authorization: Bearer <key>`
when `LATTICE_API_KEY` is set; with it unset (local dev) writes are open and the
startup banner says so. MCP checks write permissions on each tool call.

Two kinds of key. `LATTICE_API_KEY` is the **operator** key — one per
instance, from the environment. Everything else is an **app** key, minted by
`lattice_register_app` and stored as a SHA-256 hash, returned once at
registration. Self-registration needs no approval; that call is the single
write an unauthenticated caller may make, and it can only create a slug,
never overwrite one.

App keys carry a tier, graded by blast radius rather than seniority:

| | low (self-serve) | contributor | operator |
|---|---|---|---|
| fork | ∞ | ∞ | ∞ |
| originate | 3/day | ∞ | ∞ |
| create context | — | ✓ | ✓ |
| promote, reissue keys | — | — | ✓ |

`lattice_set_app_tier` promotes; `lattice_reissue_app_key` rotates a lost or
leaked key and invalidates the old one. Every write is recorded in `events`
against `app:<slug>` or `operator`, so the audit log answers "who".

Tiers govern how much a caller may do, never how good it has to be: the
friction gates in `publish/friction.ts` apply identically to every writer,
operator included.

Configuration is environment-only: `LATTICE_DATA_DIR` (default `var/`,
resolved against this package), `LATTICE_HOST`, `LATTICE_PORT`,
`LATTICE_API_KEY`. See `deploy/` for the systemd unit and Caddyfile.

## What's not here yet

Shards R3 (M3 storage half), Local Register R4 (M4), the `lattice-cli`
scan command. Federation stays deferred to v0.2 per DECISIONS.

## Calibration notes

- The R2 label-vs-definition semantic check runs at cosine similarity
  > 0.8 (distance < 0.2), not the 0.3 distance in ROADMAP §2: measured
  on the 16 skeleton definitions, good definitions land at 0.28–0.42
  distance and degenerate restatements at 0.07–0.18, so 0.3 rejects
  real definitions. See `src/publish/friction.ts`.
- Discover decision-tree bands are calibrated to bge-small-en-v1.5
  (unrelated text floors at ~0.45–0.51 cosine, not 0). See
  `specs/ai-checkpoints.md` § "Threshold calibration".
- Duplicate detection warns at ≥ 0.85 and never blocks, per
  REQUIREMENTS "Cross-cutting" gate 6. (`specs/mcp-tools.md` mentions
  a 0.93 hard block — that conflict is unresolved; REQUIREMENTS is
  treated as authoritative.)

## Run

```
npm install
npm run seed            # seeds skeleton + governance, embeds into ./var/
npm run smoke           # all seven suites (67 checks)
npm run serve           # HTTP server on 127.0.0.1:7000
npm run mcp             # MCP server over stdio
npm run demo:new-haven  # multi-department civic walkthrough
```

Individual suites: `smoke:ancestry`, `smoke:friction`, `smoke:discover`,
`smoke:classification`, `smoke:registry`, `smoke:tools`, `smoke:http`.

## API design advisor

The registered-app advisor compares exact source-field/concept alignments and
produces a reviewable OpenAPI 3.1 draft. It separates standards from implementations,
shows unmapped fields and conversion risks, and keeps authority/adoption signals
separate. No LLM, embedding or publisher-network calls occur during advice.

Run `npm run demo:api-advisor` for an isolated example or `npm run advise:api --
--target http://localhost:7000 --request request.json --out ./api-proposal` for a
registered app. HTTP and MCP share `lattice_advise_api`,
`lattice_accept_api_design` and `lattice_api_design_history`. Only explicit owner or
operator acceptance records a decision, with stale-proposal checks; it does not
assert deployed conformance. See [the workflow](examples/api-advisor/README.md) and
[the specification](../../specs/api-design-advisor.md).

### Report performance and client computation

HTTP and MCP app/portfolio reports run in one read-only worker. The worker loads
stored vectors, not the embedding model. Identical concurrent requests share a
job; at most 16 distinct jobs can wait/run. Each job has a 60-second deadline;
the worker's V8 old-generation heap is limited to 128 MiB. Reports are cached
in memory (32 entries, at most 10 MB of serialized reports) until database
triggers detect relevant registry/concept/vector-key changes. Events do not
invalidate the cache. Reports reflect a consistent SQLite read snapshot; a
write during computation is picked up by the next request. Cold reports still
have pairwise complexity; this is not an unlimited-capacity implementation.

Advisor selection uses indexed concept mappings and latest decisions, excludes
source join-graph generation, and rejects requests above 30 concepts or 100
candidate sources before resolving them. `lattice_api_design_snapshot` exports
that evidence. The CLI's `--target` mode downloads the snapshot and generates
OpenAPI locally, saving `snapshot.json` alongside the proposal for offline
replay. Accepting a design still rechecks current server evidence.

Outbound source fetches are limited to two concurrent URLs and 32 waiting URLs.
Repeated in-flight URLs and source checks coalesce; there is no stale upstream
response cache. Hourly evidence maintenance runs in batches of 25 claim keys,
yielding between batches. Source refreshes rescore only that source's mappings.
An individual claim's scoring and other synchronous evidence operations can
still consume server CPU. Queues are in-process, not durable scheduled jobs.

`npm run smoke:scaling` checks cache invalidation, shared concurrent work,
worker/HTTP behavior, source-fetch bounds, batched rescoring and snapshot replay.
`npm run bench:reports -- --target https://schemalattice.com` runs a small,
read-only probe (one initial report, eight concurrent repeated reports, and
health requests). Its timings include network latency; it is not a capacity
or sustained-load test.
