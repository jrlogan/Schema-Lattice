# Spec: Builder Contributions

**Status:** Phase 1 implemented in
`packages/lattice-server/src/evidence/contributions.ts` (page:
`src/http/contribute.ts`), tested by `test/contributions.ts`. Phase 2
(automated publishing) and phase 3 (`missing-field`) are draft. The
maintainer settled the four open decisions on 2026-10-06; see
"Decisions".

## The problem

Most of what builders make is not in the catalog. Hosted app generators
(Lovable, Google AI Studio, Bolt, v0) read the catalog through builder
packs (`/pack`), and the packs now tell them to record each type they
invent in `schemalattice.json`: its root kind (`broader`), a one-sentence
`definition` and its `fields` (`annotation-standard.md`). That file stays
in the builder's project. Those builders cannot publish, so the catalog
learns only the wording of their searches, from the demand report. It
never sees the types they designed.

Those types are the most useful signal the catalog could get. Twelve
independently built grooming apps that all gave Appointment a `startsAt`,
a `status` and a `petId` say more about what Appointment should be than
any one publisher's guess.

## What this adds

1. A **contribute page** at `/contribute`. The person pastes their
   `schemalattice.json`. The page shows exactly what would be sent, then
   sends it on confirmation. The packs end with a link to it: "When your
   app works, paste schemalattice.json at …/contribute."
2. A tool, `lattice_contribute`, which the page calls and MCP builders
   can call directly, plus `lattice_withdraw_contribution`. As built,
   contributions have their own table rather than being rows in the
   match-shaped `evidence` table: they carry a structure, not a
   polarity. Phase 3 adds `missing-field` (one per field a `forked`
   entry adds to its `forkedFrom` concept) to the same tool.
3. **Concept candidates** in the demand report: clusters of contributed
   types with the fields builders agree on.

In phase 1, contributions mint nothing. Phase 2 lets a candidate that
clears every gate publish itself (see "Automated publishing"). That
deliberately narrows principle 1 of the evidence ledger, and the gates
are set to match its promotion bar.

## What is extracted, and what is not

The page parses the manifest **in the browser** and sends only this, per
type:

```json
{
  "label": "Appointment",
  "broader": "https://schemalattice.com/c/schemalattice/event@…",
  "definition": "One booked grooming session for one pet at a set time.",
  "fields": [
    { "name": "startsAt", "type": "datetime", "required": true },
    { "name": "status", "type": "enum", "values": ["booked", "done", "no_show"] }
  ],
  "sourceQuery": "dog grooming appointment booking"
}
```

| Kept | Limit |
|---|---|
| `label` (the local name) | 60 characters |
| `broader` | must be one of the root concepts |
| `definition` | 300 characters |
| field `name`, `type`, `required`, `unit`, `itemType` | 40 fields per type, 60-character names |
| field `values` (enum values) | 20 values of 40 characters; public only when 2+ sources share a value |
| `sourceQuery`, the pack search that led here, when the page knows it | 300 characters |

**Never sent:** `project`, `localLocation`, `notes`, `fieldMaps`, field
descriptions, example values, anything outside `concepts`. The page says
so before sending. Field descriptions are dropped because they are where
builders write things like "the client's home address".

Limits per submission: 20 types and 16 KB. Rate limit: the existing
`evidence` bucket.

## Checks

- `broader` is one of the root concepts; `label` and `definition`
  contain words (`isContentful` in `demand.ts`), and the definition has
  at least four words.
- Each field has an identifier name, no duplicates, and a known type.
  Common spellings map to catalog types (`timestamp` → `datetime`,
  `uuid`/`text` → `string`, `int` → `integer`, `json` → `object`, …).
- A type within 0.85 of an existing concept (root and governance
  concepts excluded) is not stored. It comes back in `alreadyInCatalog`
  with that concept's URI, so the person learns it exists.
- 50 types per source per day, on top of the `evidence` rate bucket.
- Phase 3, `missing-field`: as in `evidence-ledger.md`; the field is not
  already on the concept.

## Sources

Sources are as in the evidence ledger: anonymous submitters count by the
salted hash of their network prefix, an app key by its app, and weights
never stack within one source. A submission is one source however many
types it carries.

## Concept candidates

Contributions cluster like demand queries: label, definition and field
names are embedded together, and contributions within 0.75 of a
cluster's anchor join it. Contributions under different roots never
cluster together. One source counts once per cluster, using its latest
contribution. A candidate in the report looks like this:

```json
{
  "label": "Appointment",
  "broader": "…/event@…",
  "sources": 4,
  "definitions": ["…", "…"],
  "fields": [
    { "name": "startsAt", "type": "datetime", "sources": 4 },
    { "name": "status", "type": "enum", "sources": 3, "values": { "booked": 3, "done": 3 } },
    { "name": "petId", "type": "reference", "sources": 2 }
  ],
  "nearestExisting": { "uri": "…", "similarity": 0.52 },
  "relatedDemand": 9
}
```

- Field names are normalized for counting (case, separators,
  plural/singular), as `missing-field` already specifies. The most
  common spelling is shown.
- Phase 2: `relatedDemand` counts the demand-report queries in the
  matching demand cluster, which ties what builders searched for to what
  they then built. Phase 1 returns the raw `sourceQueries` instead.
- Phase 2: candidates that today's catalog now answers drop out, as
  demand clusters do (`clustersNowMet`).

## Automated publishing (phase 2, draft)

The maintainer's decision: candidates should become concepts
automatically wherever that can be made safe. A published concept is
permanent, so the gates match the evidence ledger's promotion bar, and
everything runs in shadow mode first.

A candidate publishes itself when **all** of these hold:

1. **Independent agreement:** at least 3 sources, counted as in the
   evidence ledger. At least two must come from different /16 (IPv4) or
   /32 (IPv6) networks, so one office or campus cannot clear the bar
   alone. Unlike match evidence, an all-anonymous candidate can qualify,
   because hosted builders have no keys. The structural gates below take
   the place of the non-anonymous source requirement.
2. **Quarantine:** 7 days since the first contribution, and no burst
   (10 or more new sources within one hour freezes the candidate for the
   operator, as with match evidence).
3. **Field consensus:** the concept gets only the fields that at least
   half of the sources (and at least 2) contributed, in the most common
   spelling and type. Enum values need 2 sources. At least 2 fields must
   qualify, or the candidate waits.
4. **Definition:** the medoid, meaning the contributed definition
   closest on average to all the others. It is never a blend, and never
   text from only one source. It must pass the normal publish gates (the
   R2 label-vs-definition check and the duplicate check), like any
   publish.
5. **Context:** the context of `nearestExisting` when that is ≥ 0.60,
   otherwise the context whose definition best matches the candidate's
   definitions and source queries, if ≥ 0.55. If neither qualifies, the
   candidate is held as `needs-context` for the operator. Contexts are
   never created automatically.
6. **Still missing:** nothing in the catalog is ≥ 0.85 from it at
   publish time.

The publish runs as a system actor `contributions`, sets
`inspiredBySources: ["contribution:<candidate id>"]`, and records
`createdBy: ["schemalattice contributions"]`. The candidate then shows
`published: <uri>`, so contributors can see the result. Later
contributions that match it come back as `alreadyInCatalog`.

**Shadow mode first.** Operator switch `contributions.autopublish`:
`off`, `shadow` (the default: the report lists `wouldPublish` with the
exact record that would be minted), or `on`. Turn it `on` once shadow
output has been read on real candidates. The 0.75 cluster radius and the
0.60/0.55 context floors are uncalibrated, as the discover bands were
before calibration.

**Undoing one.** Concepts cannot be deleted. Phase 2 adds an operator
`delist` action: discover stops returning the concept and `/pack` stops
listing it, while its URI keeps resolving with a `delisted` note. That
is the worst-case cost of a bad automated publish: one delisted record.

**Keyed publishers can still act first.** The operator or a
contributor-tier app with published concepts in the target context can
publish from a candidate at any time, with their own definition. This
closes the candidate the same way.

`missing-field` claims promote as the evidence ledger already says: they
become fork candidates on the concept's publishing app report.

## Privacy

- Submitting is an explicit act on its own page, never a side effect of
  a search (evidence ledger principle 5).
- The person sees the exact JSON before it is sent.
- The public report shows a candidate only once 2 sources contributed
  it. It then shows field names with counts, shared enum values, the
  labels, and each contributed definition (300 characters at most), with
  the untrusted-data notice.
- A submitter can withdraw: the page returns a single-use withdrawal
  token (stored hashed), and `lattice_evidence_admin` `purge-contributions`
  removes everything from one source. Once a candidate has published, a
  withdrawal removes the contribution but not the concept.

## Abuse

| Threat | Mitigation |
|---|---|
| Junk types to pad the report | candidates need 2+ sources to appear publicly; contentless text is rejected |
| One person, many submissions | sources per network prefix or app, as in the evidence ledger; 50 types/day per source |
| Steering a concept into the catalog | 3+ sources across 2+ wider networks, 7-day quarantine, burst freeze, medoid definition, field consensus, shadow mode, operator delist |
| Private data in labels or definitions | length caps, descriptions never sent, report shows aggregates; operator purge |
| Prompt injection in shown text | report carries the same untrusted-data notice as demand clusters |

## Changes to existing pieces

- **Packs (done):** link to `/contribute` in "Need more?", passing the
  pack's search as `?from=`.
- **Demand report (done):** gains `candidates` beside `clusters`, with an
  operator view that includes single-source candidates.
- **Builder brief (done):** MCP builders who cannot publish call
  `lattice_contribute`. The workflow skill still needs the same note.

## Decisions (2026-10-06)

1. **Enum values:** kept, capped at 20 values of 40 characters each.
   Public views show only values that 2+ sources share.
2. **Public threshold:** a candidate appears publicly once 2 independent
   sources have contributed it. Single-source candidates are visible only
   to the operator.
3. **Who turns candidates into concepts:** automated where it can be made
   safe (see "Automated publishing"), with keyed publishers still able
   to act first.
4. **Withdrawal:** single-use tokens, since there are no accounts.

## Phasing

1. **Built.** Contribute page, `lattice_contribute` and withdrawal,
   candidates with field consensus in the demand report (public at 2
   sources, operator sees all).
2. Automated publishing in shadow mode, then on; `delist`;
   `relatedDemand`; dropping candidates the catalog now answers.
3. `missing-field` from forks, and fork candidates on app reports
   (evidence ledger phase 3).
