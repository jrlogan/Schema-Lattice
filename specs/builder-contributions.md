# Spec: Builder Contributions

**Status:** Draft. Extends the evidence ledger (`evidence-ledger.md`) with
one new claim kind and brings its `missing-field` kind forward from
phase 3. Nothing here is built yet. Decisions marked **Open** need the
maintainer before implementation.

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
2. Two claim kinds in `lattice_propose`, which the page calls:
   - `missing-concept` (new): one per `originated` entry.
   - `missing-field` (from phase 3): one per field a `forked` entry adds
     to its `forkedFrom` concept.
3. **Concept candidates** in the demand report: clusters of
   `missing-concept` claims with the fields builders agree on.

Contributions never mint anything. Principle 1 of the evidence ledger
holds: concepts are permanent, so only a keyed publisher creates them.

## What is extracted, and what is not

The page parses the manifest **in the browser** and sends only this, per
type:

```json
{
  "kind": "missing-concept",
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
| field `values` (enum values) | see Open 1 |
| `sourceQuery`, the pack search that led here, when the page knows it | 300 characters |

**Never sent:** `project`, `localLocation`, `notes`, `fieldMaps`, field
descriptions, example values, anything outside `concepts`. The page says
so before sending. Field descriptions are dropped because they are where
builders write things like "the client's home address".

Limits per submission: 20 types and 16 KB. Rate limit: the existing
`evidence` bucket.

## Checks

- `missing-concept`: `broader` is a root concept; `label` and
  `definition` contain words (`isContentful` in `demand.ts`); every field
  passes the shape checks `checkChangeset` applies to an `add` op
  (`src/publish/changeset.ts`); the label does
  not already adopt-match a concept (≥ 0.85 against the definition). If it
  does, the claim is rejected with that concept's URI, so the person
  learns it exists.
- `missing-field`: as in `evidence-ledger.md`; the field is not already
  on the concept.

## Sources

Sources are as in the evidence ledger: anonymous submitters count by the
salted hash of their network prefix, an app key by its app, and weights
never stack within one source. A submission is one source however many
types it carries.

## Concept candidates

`missing-concept` claims cluster like demand queries: label, definition
and root are embedded together, and claims within 0.75 of a cluster's
anchor join it. Claims under different roots never cluster together. A
candidate in the report looks like this:

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
- `relatedDemand` counts the demand-report queries in the matching
  demand cluster, which ties what builders searched for to what they
  then built.
- Candidates that today's catalog now answers drop out, as demand
  clusters do (`clustersNowMet`).

**From candidate to concept.** A keyed publisher, usually the operator or
a platform in that domain, drafts the concept from the candidate with
`lattice_publish_concept`. It uses fields that at least half the sources
share, and the definition rewritten by the publisher. The publish records
`inspiredBySources: ["contribution:<candidate id>"]`, so the candidate
closes and contributors can see the result. See Open 3.

`missing-field` claims promote as the evidence ledger already says: they
become fork candidates on the concept's publishing app report.

## Privacy

- Submitting is an explicit act on its own page, never a side effect of
  a search (evidence ledger principle 5).
- The person sees the exact JSON before it is sent.
- The public report shows **aggregates**: field names with counts,
  labels, and definitions truncated with the untrusted-data notice. See
  Open 2.
- A submitter can withdraw: the page returns a withdrawal token, and
  `lattice_evidence_admin` can purge any source.

## Abuse

| Threat | Mitigation |
|---|---|
| Junk types to pad the report | candidates need 2+ sources to appear publicly (Open 2); contentless text is rejected |
| One person, many submissions | sources per network prefix or app, as in the evidence ledger |
| Steering a future concept | nothing is minted automatically; a publisher reads every candidate |
| Private data in labels or definitions | length caps, descriptions never sent, report shows aggregates; operator purge |
| Prompt injection in shown text | report carries the same untrusted-data notice as demand clusters |

## Changes to existing pieces

- **Packs:** add the contribute link to "Need more?", and pass the
  pack's search as `sourceQuery` (a `?from=` parameter on the link).
- **Demand report:** gains `candidates` beside `clusters`.
- **`lattice_evidence_report`:** lists pending contributions for the
  operator.
- **Builder brief and workflow skill:** MCP builders who cannot publish
  use the same claim kinds through `lattice_propose`.

## Open decisions

1. **Enum values.** They are often the best part of a type (`booked`,
   `done`, `no_show`), and occasionally private (customer tiers, staff
   names). Options: keep them, capped at 20 values of 40 characters each;
   keep only values that 2+ sources share; or drop them. Recommendation:
   keep them, and show in public only values that 2+ sources share.
2. **Public threshold.** Recommendation: a candidate appears in the
   public report once it has 2 independent sources. A single source's
   text is visible only to the operator. This stops the report from
   republishing one person's wording.
3. **Who turns candidates into concepts.** Recommendation: the operator,
   and any contributor-tier app whose own published concepts sit in the
   same context. Self-registered apps start at a tier that cannot
   originate, so this adds no new path for spam.
4. **Withdrawal tokens.** These need a small table and a page. The
   alternative is "email the operator", which is simpler and slower.
   Recommendation: tokens, because there are no accounts to fall back on.

## Phasing

1. Contribute page, `missing-concept` claims, and operator-only
   visibility of single-source candidates. This step alone starts
   collecting.
2. Candidates in the public demand report, field consensus, and the
   `relatedDemand` link.
3. `missing-field` from forks, and fork candidates on app reports
   (evidence ledger phase 3).
