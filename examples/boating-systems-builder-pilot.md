# Boating Systems personal app builder pilot

## User job

"Build me a small interface for my sailing spreadsheet. Let me check each
proposed day and then save approved days into my private Log. Later I may
customize Chart or Vessel views over the same Boating Systems account."

The builder uses Boating Systems as the backend. SchemaLattice helps it name
and compare concepts at the boundary between the person's sources, the
custom app, and Boating Systems. It does not authorize writes or specify
the backend's accepted payload.

## Baseline probe, 2026-09-26

Run `node packages/lattice-evals/boating-backend-probe.mjs` from the repo root.
The probe makes public, read-only requests. Discovery uses `ephemeral=true`
so query wording is not stored in the catalog's demand log. It exits 1 when
the catalog's advertised authority differs from `schemalattice.com`.

Observed on this date:

- Log's public capabilities and JSON Schema were available. The written
  history contract was `boating-log-history` v1 through `importLogHistory`;
  repository access was not required.
- None of five user-facing boating descriptions produced a marine-domain
  candidate at similarity 0.65 or higher. Top results were abstract roots or
  civic concepts. This is an unmet vocabulary need, not evidence that Log's
  working API lacks a field or operation.
- The live `schemalattice.com` service advertised
  `https://schemalattice.io` as its authority and returned `.io` concept URIs.
  The local URI spec and current server source use `.com`. Do not pin a
  permanent manifest until the authority and existing record migration story
  are reconciled.

## Builder workflow to evaluate

1. Read the backend's capability document, wire schema, authentication
   scope, preview/commit flow, and examples before designing a payload.
2. Read one sample source spreadsheet with synthetic data. Model its columns
   separately from the app's review model and the Log handoff.
3. Ask SchemaLattice about the durable domain concepts involved: written
   boating day, vessel, recorded trip, evidence/provenance. Resolve any
   promising match and reject a high-scoring match when its meaning differs.
4. Show a field map with conversions, uncertainty, omitted fields, and the
   backend schema version. Validate against Log's JSON Schema.
5. Preview through Log, let the person choose records, commit only those
   records, and display Log's actual receipts. The generated interface uses
   the existing named, revocable grant; it never gets a service account.
6. Record only useful, verified lattice references in the builder app's
   manifest. A missing catalog concept cannot prevent an otherwise valid
   Log import. Publish a reusable concept only as a separate, reviewed task.

For the first uploader, a spreadsheet row might map `Sail date` to the
handoff's required `date`, a stable row identifier to `key`, and `Boat` to
`boatName`. The builder must also supply `title`, `evidence`, and at least
one `sources` entry. A note such as "date estimated from album" belongs in
`uncertainties`; it cannot become a measured GPS track. These field names
come from Log's published `history-schema.json`, not from a lattice search.

## What would count as success

- A new builder reaches the existing Log preview with a schema-valid payload
  and no invented API operation or field.
- The person sees provenance and uncertainty before saving. A calendar plan
  is not presented as a completed trip; inferred photos are not measured GPS.
- The AI explains why it adopted, forked, or declined each lattice candidate.
  A second builder can read the manifest and field map without reverse
  engineering the first builder's code.
- The resulting custom app remains a client of Boating Systems. It does not
  copy the account graph, authorization system, or trip rules into a new
  backend.

## Next tests

Run a separate-person build of the Log uploader with synthetic input, then
test pairing, preview, save, duplicate retry, revocation, and receipts against
the published API. Repeat with a changed spreadsheet to see whether lattice
lineage actually improves the adaptation. Only then test Chart and Vessel:
first identify their supported public read/write contracts, since the Log
import grant does not grant access to their data or the safety database.
