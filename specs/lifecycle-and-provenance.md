# Spec: Lifecycles, Field Invariants & Capture Provenance

**Status:** v0.1 addition, from the Trail Team × PlacePrize pilot
(`examples/trail-team-bounty-pilot.md`). Additive: every key here is
optional, and concepts that don't use them hash exactly as before.

## Why this is in the lattice

The pilot tried to carry a real two-system contract through the catalog,
a trail group's issues and a prize service's bounties. Field names were
the easy part. The parts the two sides actually argued about were:

- **The lifecycle.** A bounty opens, is claimed, goes under review, then
  is paid or expires. Each move is a webhook. The civic `Issue Report`
  this pilot forked from models all of that as `state: string`, so the
  states and the events between them were invisible.
- **Invariants.** "The done-spec cannot change once the pool opens", so
  donors pay against the standard they saw.
- **Where evidence came from.** A photo taken live in a sealed camera app
  and a phone photo uploaded a week later are both `binary`. Whether a
  prize pays out turns on that difference.

Without shared vocabulary for these, every app writes them as free-form
keys, and two systems reading the same concept disagree about what it
says. The baseline run of the pilot showed exactly that: invented
`lifecycle` and `provenance` keys, typos included, were accepted and
hashed with no meaning attached.

As with data classification (`specs/data-classification.md`), the
lattice makes these **visible and checkable**, not enforced. Whether an
app actually refuses to edit a frozen field, or what provenance a prize
requires, is the adopting party's policy.

## Lifecycle

A `structure` MAY carry a `lifecycle`:

```json
{
  "kind": "workflow",
  "fields": [
    { "name": "doneSpec", "type": "string", "immutableFrom": "open" },
    { "name": "status", "type": "string" }
  ],
  "lifecycle": {
    "field": "status",
    "initial": "draft",
    "states": [
      { "name": "draft" },
      { "name": "open" },
      { "name": "under-review" },
      { "name": "paid", "terminal": true },
      { "name": "expired", "terminal": true }
    ],
    "transitions": [
      { "from": "draft", "to": "open", "on": "challenge.opened" },
      { "from": "open", "to": "under-review", "on": "submission.received" },
      { "from": "under-review", "to": "open", "on": "verdict.failed" },
      { "from": "under-review", "to": "paid", "on": "payout.sent" },
      { "from": "open", "to": "expired", "on": "challenge.expired" }
    ]
  }
}
```

| Key | Required | Meaning |
|---|---|---|
| `states[].name` | yes, unique | A state a record can be in |
| `states[].terminal` | no | No further transitions are expected |
| `initial` | yes | The state a new record starts in; must be declared |
| `transitions[]` | no | `{ from, to, on? }`; both ends must be declared states |
| `transitions[].on` | no | The named event that moves the record, e.g. a webhook name |
| `field` | no | The structure field that holds the current state; must be declared |

**Refused** (`ERR_LIFECYCLE_INVALID`): a missing or empty `states`, a
duplicate state, an `initial` or transition end that isn't a declared
state, a non-string `on`, or a `field` the structure doesn't declare.

**Advisories** (returned in `warnings`, never refused):

- `lifecycle-unreachable-state`: no transition path from `initial`
  reaches the state.
- `lifecycle-terminal-exit`: a state marked `terminal` still has
  outgoing transitions.

## Field invariant: `immutableFrom`

A field MAY carry `immutableFrom: "<state>"`: once a record reaches that
state, the field's value is not expected to change. The state must be a
declared lifecycle state. A field with `immutableFrom` in a structure
with no lifecycle, or naming an unknown state, is refused
(`ERR_IMMUTABLE_FROM_UNKNOWN_STATE`).

This is the one invariant v0.1 expresses. Others the pilot wanted (a
field required in a given state, a value that may only increase) are
deferred until a second use case asks for them.

## Capture provenance

A field MAY carry `provenance` naming how its value came into being.
The classes are seeded in the reserved `governance` context alongside
the data classes, ordered by `assuranceRank` (metadata, not hashed):

| Slug | Rank | Covers |
|---|---|---|
| `self-reported` | 0 | Stated by a person with no capture evidence |
| `uploaded` | 1 | A file supplied after the fact; origin rests on its own metadata |
| `device-captured` | 2 | Recorded by the receiving app at the moment, with the device's clock and position, unsealed |
| `attested-capture` | 3 | Captured live and signed by an app or camera whose integrity the platform vouches for (a sealed camera app, in-camera content credentials) |

Rules mirror classification:

- **Absence is fine.** Most fields are not evidence.
- **Unknown values are refused** (`ERR_UNKNOWN_PROVENANCE`). A data
  class is not a provenance class and vice versa: `provenance: "public"`
  and `classification: "uploaded"` are both refused.
- **Provenance is identity-bearing.** It lives inside `structure`, so
  re-grading a field produces a new concept version.
- A field MAY also carry `vouchedBy`: free text naming the *role* that
  stands behind a capture ("organizer"). Roles are domain vocabulary,
  so the lattice records this but does not validate it.

Classification and provenance answer different questions: how careful
to be with a value, and how far to trust where it came from. A photo
of a trail can be `public` and `attested-capture` at once.

## Weak external matches

R2 requires at least one `closeMatch`/`broadMatch` into an approved
vocabulary. Some approved terms fit almost anything (`schema:Thing`,
`schema:CreativeWork`, `schema:Intangible`, `skos:Concept`,
`prov:Entity`, `dct:Resource`, `wd:Q35120`). A concept whose *only*
external anchors are these still publishes, with a
`weak-external-match` advisory asking for a specific term. The pilot's
parent concept, a FixMyStreet-derived issue report in a context that
names Open311, was anchored only to `schema:CreativeWork`.

## Forks

Changeset ops (`specs/changeset-format.md`) describe field structure
only. A fork that changes a field's classification, provenance or
`immutableFrom`, or adds, drops or changes a lifecycle, has those
changes hashed into its identity but invisible in its ops. Such forks
publish with a `semantic-change-outside-changeset` warning naming them.
`lattice_compare` shows them side by side. Expressing them as
Cambria-compatible ops is deferred to v0.2 lenses.

## `lattice_compare`

A read-only tool: given two concept URIs, it returns every field on
both sides paired (by changeset renames when one forks the other,
otherwise by name), the attributes that differ, lifecycle states and
transitions only one side has, plain-English summary sentences, and a
Markdown table. See `specs/mcp-tools.md`. It exists because the most
useful thing the pilot produced by hand was exactly this table, written
for two people deciding whether their records mean the same thing.
