# API design advisor

Generate a reviewable API contract for a registered app, compare exact field
alignments with standards and existing implementations, and record an explicitly
reviewed design choice. Recommendations do not call an LLM or embedding model.

From `packages/lattice-server`:

```sh
npm run demo:api-advisor
npm run smoke:advisor
```

The demo creates a disposable catalog and a fictional waste-service application.
It compares the repository's captured Open311 v2 specification with a **fictional**
legacy export. Its peer/adoption observations are test data, not real-world uptake.
It writes `output/review.txt`, `output/openapi.json`, `output/proposal.json`,
`output/request.json` and `output/snapshot.json`. Swagger Parser independently
validates the generated OpenAPI. No design is automatically accepted.

The example preserves collection-day and richer workflow fields in the native API.
Open311 only documents open/closed request status, and the stored spec field list
has unspecified wire types. The advisor flags that work instead of generating an
unverified converter. Its implementation notes also call out XML, discovery,
form-encoded request creation and timezone requirements.

## A real registered app

The HTTP server and MCP server expose the same three tools:

| Tool | Action |
| --- | --- |
| `lattice_advise_api` | Read-only comparison and OpenAPI proposal |
| `lattice_accept_api_design` | Owner/operator records reviewed choices against an unchanged proposal |
| `lattice_api_design_history` | Read prior choices and their attribution |

Start/restart the updated server normally (`npm run serve` or `npm run mcp`).
No production instance is restarted by the demo. Save a request using the app's
real registered concept URI:

```json
{
  "app": "your-registered-app",
  "purpose": "Expose service requests to resident applications",
  "consumers": ["Resident application", "Municipal integration"],
  "resources": [{
    "conceptUri": "COPY_THE_EXACT_REGISTERED_CONCEPT_URI",
    "path": "/v1/requests",
    "idField": "requestId",
    "fieldNames": {"createdAt": "created_at"}
  }]
}
```

The property names above must exist on that concept. Omit `resources` to inspect
concept-derived defaults first. Optional `candidateSlugs` limits comparisons to
selected listed sources. Unknown or withdrawn candidates are refused.

```sh
npm run advise:api -- --target http://localhost:7000 \
  --request request.json --out ./api-proposal
```

This calls `POST /api/tools/lattice_advise_api`. Reads require no key. The CLI writes
review artifacts; it never accepts choices, deploys endpoints, or publishes concepts.

To reproduce the demo proposal without a running server or model:

```sh
npm run advise:api -- --snapshot examples/api-advisor/output/snapshot.json \
  --request examples/api-advisor/output/request.json --out /tmp/api-advisor-replay
```

The snapshot is a bounded evidence export for offline review, not a new authoritative
catalog. Its request and evidence hash determine the proposal ID.

## Accept a reviewed design

After review, call `lattice_accept_api_design` with the app's key (or operator):

```json
{
  "request": {"...": "the exact original design request"},
  "proposalId": "COPY_THE_RETURNED_PROPOSAL_ID",
  "choices": [{"conceptUri": "COPY_THE_REGISTERED_CONCEPT_URI", "source": "open311-georeport-v2"}],
  "rationale": "Preserve the native model; design a separate Open311 compatibility representation."
}
```

Use `source:null` to explicitly retain only the native design. Every proposed
resource needs one choice. This records a target and rationale, not implemented
compatibility or conformance. The unchanged request/evidence is rechecked before
recording; a new source schema, mapping, or peer evidence can require a fresh review.

Authority, global adoption, endpoint behavior, migration paths and reversible
conversions remain unassessed where the catalog lacks evidence. The current native
proposal covers reads; it is not a generated server implementation or full standard
endpoint suite. See `specs/api-design-advisor.md` for the complete first-version boundary.

The HTTP/MCP tool `lattice_api_design_snapshot` accepts the same request as
`lattice_advise_api` and returns the evidence needed by the local engine.
`--target` now downloads this snapshot and computes the proposal on the client,
saving `snapshot.json` too. You can change purpose, consumer descriptions or
field names and replay offline. Changing the app, selected concepts or source
candidates requires a new snapshot. Acceptance always regenerates the proposal
against current server evidence and rejects stale or altered results.
