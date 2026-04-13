# lattice-server (v0.1 M1)

Minimal SchemaLattice server — just enough to seed the 16 skeleton
concepts and enforce the R1 ancestry gate on publish.

## What's here

- `src/hashing/` — canonicalization + SHA-256 hash per `specs/hashing-rules.md`
- `src/storage/` — better-sqlite3 + local blob store
- `src/seed/` — 16 skeleton concepts transcribed from `specs/root-skeleton.md`
- `src/publish/` — R1 ancestry gate, `publishConcept()` entry point
- `src/server/` — tiny in-process API surface (not HTTP yet)

## What's not here yet

Embeddings (M2), discover (M2), friction gate R2 (M2), shards R3 (M3),
HTTP/MCP transport, CLI. All stubbed with TODOs pointing at the
relevant milestone.

## Run

```
npm install
npm run seed   # seeds skeleton into ./var/dev.db + ./var/blobs/
npm run smoke  # boots, seeds, runs R1 ancestry gate cases
```
