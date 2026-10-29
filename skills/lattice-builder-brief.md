---
name: lattice-builder-brief
description: Use when building an app, tool or uploader on top of an existing backend (a platform with published APIs, capabilities and wire schemas) and SchemaLattice (schemalattice.com) is available. Short builder-mode rules; the full protocol is lattice-workflow.md.
---

# SchemaLattice builder brief

You are building on someone else's backend. The backend's contract decides
what you can read and write. SchemaLattice helps you name concepts, reuse the
backend's published vocabulary, and leave a map the next builder can follow.
It never grants permission, and it never overrides the contract.

## 0. Advice, never a gate

- Nothing here is a prerequisite for building, shipping or releasing.
  Changing a field on a type that already exists needs no discovery.
- If the lattice cannot be reached or a call fails, say so once and
  carry on under the backend's contract. Do not keep asking for access,
  defer the feature, or remove work because of it.
- Feedback calls are optional. Once the person has chosen to use the
  lattice, they need no extra approval, as long as no private data goes
  in them.

## 1. Contract first

Before you design a payload, read the backend's published contract: its
capability document, its versioned wire schema, its auth or grant scope, and
its preview/dry-run and commit flow, plus any example payloads. Use only the
operations and fields it publishes. If it publishes none for the data you
need, stop and tell the person; do not invent an endpoint.

## 2. Ask the lattice about meaning

- Discovery, resolution and feedback need no key. Without the MCP tools,
  `POST https://schemalattice.com/api/tools/<tool>` with the same JSON.
- Call `lattice_discover` with the domain and what the record captures,
  e.g. "a written account of one day boating, with evidence and uncertainty".
  Pass `ephemeral: true`: the person's wording is theirs, not demand data.
- If the backend publishes concepts, or its capability document links to
  them, pass their contexts in `contexts` so civic or unrelated domains
  cannot crowd the results.
- Read the `verdict` on each result: `adopt`, `fork`, `distant` or
  `no-match`. `lattice_resolve` anything you might use, and decline a
  high-scoring match whose meaning differs.

- After deciding on a candidate, you may send one `lattice_propose` call:
  `{ sessionId, conceptUri, verdict: "right" | "wrong", reason }`. It is
  checked against what discover showed you, quarantined, and only
  changes results once independent users agree. It is optional; skip
  it if it would slow the work. Never put private data in its `note`.

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
- If you cannot publish, send back the types you designed with
  `lattice_contribute`: label, root kind (`broader`), a one-sentence
  definition and fields. Never send records, customer data or field
  descriptions. Nothing is published until independent builders agree.
- If the app reads public data (an open-data portal, a GIS layer), look it
  up first with `lattice_find_sources`, and use the field names and join
  keys `lattice_resolve_source` gives. A dataset that isn't listed:
  `lattice_propose_source`, then `lattice_map_source` for the fields you
  understand. Field names only, never records.
- Use `lattice_feedback` for anything else the maintainers should know,
  such as a wrong match, a confusing result or a missing domain.

## 7. Reading public data

If the app uses open data (a city's GIS layers, a state portal, iNaturalist,
311), the catalog has usually met it before. Use what it learned.

1. **Find the sources.**
   - `GET /sources?jurisdiction=US-CT/new-haven` lists every source covering
     a place, its own first.
   - `GET /sources?q=…` searches.
   - For one point, `GET /place?lat=…&lng=…&jurisdiction=…`
     (`lattice_place_profile`) lists every layer that answers "what is
     here": ward, tract, watershed, flood zone, EJ area, zoning, parcel.
     Each comes with a ready-to-run query.
2. **Read the source page before you query.** Look at:
   - **What you can rely on:** whether the server can read it, the
     publisher's last change, and what is unconfirmed.
   - **Query notes:** what a plain request leaves out, how to get every
     record, paging, link formats, clients that get refused.
   - **What builders found:** fields that are always empty, coordinates
     that are not degrees, sources that disagree.
   - **The field table:** what each field means, and its fill rate.
   - **Personal and sensitive fields:** what not to republish.
3. **Treat joins as hypotheses.**
   - A *key* join between different publishers that says *unchecked*
     only works if both use the same identifier system. Agencies often
     don't (station codes, taxon ids, census vintages). Compare a sample
     first.
   - Point-in-polygon joins say how to place points in areas.
4. **Report what you learn.** This is how the next builder avoids your
   hour of debugging. Counts and field facts only, never records or
   anything identifying a person:
   - `lattice_report_join` with real tried/matched counts, plus any
     `transform` the values needed and `partialCoverage` for layers that
     only cover some places;
   - `lattice_note_source` for a field fact (`always-empty`,
     `not-degrees`, `values-lag`, `personal-data`…), an access behaviour
     or a disagreement between sources.

   Reports are quarantined until independent builders agree.
5. **Sending data back** (a 311 request, a biodiversity record): look for
   a source whose direction is *submit*, and read the publisher's rules
   (service definitions, required attributes). Pass on only what the
   person agreed to share. `governance/forwarding-consent` describes how
   to record that agreement, including a parent's or guardian's for a
   minor.

Full protocol (checkpoints, publishing, retrofit, attribution):
`lattice-workflow.md`, served at `/skill`.
