# Spec: Data Classification & Attestation

**Status:** v0.1 addition (M2.5). Generic by design: nothing here is
specific to any deployment domain. The same classes serve a
makerspace's member records, a dive club's waivers, a city's resident
data, or a small business's customer list.

## Why this is in the lattice

The lattice's job is shared vocabulary. "How sensitive is this field"
is vocabulary — a classification taxonomy — and standardizing it is
exactly what a shared catalog is for. What is deliberately NOT here:
enforcement. Whether an app stores, retains, or transmits sensitive
data correctly is a separate concern for build-time gates outside
this project. The lattice makes sensitivity *visible and computable*;
policy belongs to the adopting organization.

## The reserved `governance` context

Seeded at boot alongside the skeleton, idempotently. Like the
skeleton, this is protocol infrastructure, not domain vocabulary —
the "lattice starts empty" / JIT-mining philosophy applies to domain
concepts only. Contents:

### Data-sensitivity classes (conceptKind: classification)

| Slug | Rank | Covers |
|---|---|---|
| `public` | 0 | Freely shareable — schedules, open data, catalog text |
| `internal` | 1 | Members/staff only; disclosure is inconvenient, not harmful |
| `confidential` | 2 | Restricted org information; disclosure causes real harm |
| `personal-contact` | 3 | Name + email, phone, address, handles |
| `personal-identity` | 4 | Government IDs, birth date, photos, biometrics |
| `personal-financial` | 4 | Payment details, billing, dues, salary |
| `personal-health` | 5 | Medical notes, injuries, allergies, waivers |
| `personal-minor` | 5 | Anything about a person under the age of majority |
| `access-secret` | 6 | Passwords, keys, tokens, door codes |

`sensitivityRank` is a rough ordinal for computing profiles (below).
It is metadata (not hashed) and it is NOT policy: mapping ranks to
review tiers, storage rules, or approval requirements is the
organization's job, outside the lattice.

All classes sit `broader` → skeleton `Classification`. Personal-data
classes carry `closeMatch` references into the W3C Data Privacy
Vocabulary (`dpv:` / `dpv-pd:` prefixes, added to the approved
external-vocabulary list).

### The attestation record (conceptKind: entity)

`governance/attestation` — one generic shape for "a named check ran
against a subject system and produced a result": subject, gate,
gateVersion, result, performedBy, performedOn, findingsRef, notes.

Build-time gates outside this project (security review, privacy
check, accessibility audit, license scan…) SHOULD emit attestations
in this shape — or fork it with a changeset — so results are portable
and aggregatable across gates without the lattice knowing anything
about what each gate checks.

### Capture-provenance classes

The governance context also holds four capture-provenance classes
(`self-reported`, `uploaded`, `device-captured`, `attested-capture`) for
a field's `provenance` key: how a value was captured rather than how
sensitive it is. See `specs/lifecycle-and-provenance.md`.

## Field-level classification

Any `structure` field MAY carry a `classification` whose value is a
data-class slug or the class concept's full URI:

```json
{
  "kind": "entity",
  "fields": [
    { "name": "memberId", "type": "string", "classification": "internal" },
    { "name": "email", "type": "string", "classification": "personal-contact" },
    { "name": "waiverNotes", "type": "string", "classification": "personal-health" },
    { "name": "certLevel", "type": "string" }
  ]
}
```

Rules:

- **Absence is fine.** Classification is advisory; unclassified
  fields are reported as coverage gaps, never rejected.
- **Unknown values are rejected** at publish
  (`ERR_UNKNOWN_CLASSIFICATION`) so downstream profiles can be
  trusted.
- **Classification is identity-bearing.** It lives inside
  `structure`, which is hashed — reclassifying a field is a semantic
  change and produces a new concept version with lineage.

## Sensitivity profiles

Given a set of concept URIs (typically one project's
`schemalattice.json` manifest), the server computes:

```
{
  totalFields, classifiedFields,
  byClass: { "personal-contact": 3, "internal": 5, ... },
  maxRank, maxClass,
  unclassifiedConcepts: [ ...uris ]
}
```

This turns every manifest into a field-level data map for free. What
organizations do with it is up to them — examples across domains:

- A **makerspace** flags any app touching `personal-minor` (youth
  programs) for director sign-off.
- A **dive club** notices its trip-log app references
  `personal-health` (medical clearance) and moves it off the shared
  spreadsheet.
- A **city** requires a privacy attestation before deploying any app
  whose profile includes rank ≥ 3.
- A **research group** publishes only concepts whose profiles are
  rank 0 alongside its open datasets.

The rank-threshold policies in those examples live in each
organization's process, not in this spec.

## Interaction with existing gates

Classification validation runs on the publish path after R2 friction
and before hashing. It is not a friction gate: it never requires
classification, only rejects unknown class names. The seeded
governance concepts are indexed for discovery like any concept, so
`lattice_discover("medical information about a person")` surfaces
`personal-health` for an AI deciding how to classify a field.
