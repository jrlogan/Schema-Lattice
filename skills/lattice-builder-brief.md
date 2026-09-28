---
name: lattice-builder-brief
description: Use when building an app, tool or uploader on top of an existing backend (a platform with published APIs, capabilities and wire schemas) and SchemaLattice (schemalattice.com) is available. Short builder-mode rules; the full protocol is lattice-workflow.md.
---

# SchemaLattice builder brief

You are building on someone else's backend. The backend's contract decides
what you can read and write. SchemaLattice helps you name concepts, reuse the
backend's published vocabulary, and leave a map the next builder can follow.
It never grants permission, and it never overrides the contract.

## 1. Contract first

Before you design a payload, read the backend's published contract: its
capability document, its versioned wire schema, its auth or grant scope, and
its preview/dry-run and commit flow, plus any example payloads. Use only the
operations and fields it publishes. If it publishes none for the data you
need, stop and tell the person; do not invent an endpoint.

## 2. Ask the lattice about meaning

- Call `lattice_discover` with the domain and what the record captures,
  e.g. "a written account of one day boating, with evidence and uncertainty".
  Pass `ephemeral: true`: the person's wording is theirs, not demand data.
- If the backend publishes concepts, or its capability document links to
  them, pass their contexts in `contexts` so civic or unrelated domains
  cannot crowd the results.
- Read the `verdict` on each result: `adopt`, `fork`, `distant` or
  `no-match`. `lattice_resolve` anything you might use, and decline a
  high-scoring match whose meaning differs.

- After deciding on a candidate, send one `lattice_propose` call:
  `{ sessionId, conceptUri, verdict: "right" | "wrong", reason }`. It is
  checked against what discover showed you, quarantined, and only
  changes results once independent users agree. Never put private data
  in its `note`.

## 3. Adopt the backend's concepts; fork for your extensions

- A concept the backend publishes is the anchor. Adopt it as-is for data
  you send to that backend.
- For what your app adds, such as a local review state or an extra column,
  fork the nearest concept with a changeset, and only when the extension is
  durable and reusable. A one-person convenience field needs no publish.
- A missing concept never blocks an operation the backend supports.
  Record the gap and carry on under the contract.

## 4. Write the field map

Keep three things distinct: the person's source data, your app's local
model, and the backend's accepted payload. Record each crossing in
`schemalattice.json` under `fieldMaps` (see `specs/annotation-standard.md`,
"Field maps"):

- conversions and units;
- uncertainty and provenance: an estimated date stays estimated, and an
  inferred route is never a measured track;
- deliberately omitted fields, with reasons;
- the backend schema id and version you validated against.

Validate a sample payload against the backend's schema, then preview before
any commit. Show the person the preview and what was left out.

## 5. What not to do

- Do not send private records, field maps or column names to the catalog.
- Do not register an app or publish a concept just because you built an
  interface. Publishing is a separate, reviewed task.
- Do not treat a similarity score as evidence that a backend accepts a
  field or grants an operation.
- Do not copy the backend's accounts, authorization or business rules into
  a new backend. Your app stays a client.

## 6. Report gaps

When discover finds nothing that fits, that is signal:

- Non-ephemeral discover queries feed the public demand report
  (`lattice_demand_report`). Run one with a generic, non-private
  description of the gap.
- Use `lattice_feedback` for anything else the maintainers should know,
  such as a wrong match, a confusing result or a missing domain.

Full protocol (checkpoints, publishing, retrofit, attribution):
`lattice-workflow.md`, served at `/skill`.
