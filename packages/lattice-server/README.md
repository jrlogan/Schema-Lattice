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
twelve v0.1 tools — name, AI-facing description, JSON Schema, handler —
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
| `GET /discover?description=…` | discover without a POST body |
| `GET /api/tools` | the tool table with schemas |
| `POST /api/tools/{name}` | call any tool |
| `POST /mcp` | MCP over streamable HTTP (stateless) |

Canonical URIs stay `https://schemalattice.io/...` no matter which host
serves them, so the resolution routes match on path alone — a URI minted
on `localhost:7000` resolves unchanged against the public instance.

Reads are public. The five write tools require `Authorization: Bearer
$LATTICE_API_KEY` when that variable is set; with it unset (local dev)
writes are open and the startup banner says so. `/mcp` is gated as a
whole whenever a key is set, because it exposes the write tools.

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
