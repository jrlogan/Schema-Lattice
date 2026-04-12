# Spec: Changeset Format

**Status:** Locked for v0.1. Every op defined here must continue to
parse cleanly in v0.2 when full Cambria lenses arrive.

## Goal

Define the structural diff format that every fork record carries. The
format is strictly weaker than Cambria lens ops (no bidirectional
translation, no runtime execution), but every v0.1 op maps one-to-one
onto a Cambria lens op, so v0.2 can upgrade a v0.1 changeset to a real
lens without data loss or semantic drift.

## Where changesets live

Every concept with `status: "forked"` carries a `changeset` field
describing what changed relative to its parent. The changeset is
part of the hashed canonical form — it contributes to the child's
identity.

```json
{
  "type": "Concept",
  "inScheme": "https://schemalattice.io/s/scuba-ops@...",
  "prefLabel": {"en": "Dive Log"},
  "forkedFrom": "https://schemalattice.io/c/activity-log/session@998877665544",
  "changeset": {
    "ops": [
      {"op": "add", "field": "maxDepth", "type": "number", "unit": "meters"},
      {"op": "add", "field": "bottomTime", "type": "duration"},
      {"op": "rename", "from": "durationMinutes", "to": "bottomTimeMinutes"},
      {"op": "add", "field": "gasMix", "type": "reference", "ref": "scuba-ops/GasMix"}
    ],
    "upgradable": true,
    "note": "Scuba-specific extension of generic session"
  }
}
```

## Op types

Each op is a JSON object with an `op` field identifying the kind.
Supported v0.1 ops and their Cambria lens op mappings:

### `add`

Add a new field to the child schema.

```json
{"op": "add", "field": "maxDepth", "type": "number", "unit": "meters", "default": null, "required": false}
```

Required keys: `op`, `field`, `type`.
Optional keys: `unit`, `default`, `required`, `description`, `ref`
(for entity references).

**Cambria mapping:** `add` lens op with a default value for the
reverse direction.

### `remove`

Remove a field present in the parent.

```json
{"op": "remove", "field": "legacyCode"}
```

**Cambria mapping:** `remove` lens op, lossy on reverse (returns
a default value).

### `rename`

Rename a field while preserving its type and semantics.

```json
{"op": "rename", "from": "durationMinutes", "to": "bottomTimeMinutes"}
```

**Cambria mapping:** `rename` lens op, cleanly bidirectional.

### `retype`

Change a field's type with a converter function named for later
implementation.

```json
{"op": "retype", "field": "depth", "fromType": "integer", "toType": "number", "converter": "identity"}
```

Known converters for v0.1:
- `identity` — values already compatible
- `stringToNumber` — parse number from string
- `numberToString` — serialize number to string

**Cambria mapping:** `convert` lens op. The converter name must match
an op defined in the future Cambria implementation.

### `wrap`

Convert a scalar field to an array containing one element.

```json
{"op": "wrap", "field": "assignee"}
```

Used when the parent allowed one value and the child allows many.

**Cambria mapping:** `wrap` lens op. Reverse direction loses elements
after the first.

### `unwrap`

Convert a single-element array to a scalar.

```json
{"op": "unwrap", "field": "primaryAssignee"}
```

**Cambria mapping:** `head` lens op.

### `nest`

Move a top-level field into a nested object.

```json
{"op": "nest", "field": "street", "into": "address"}
```

**Cambria mapping:** `in` lens op.

### `hoist`

Move a nested field to the top level.

```json
{"op": "hoist", "field": "address.zipCode", "to": "zipCode"}
```

**Cambria mapping:** `hoist` lens op.

### `extend` (v0.1-only)

Add a whole new nested structure that has no parent equivalent. This
is the one op that does NOT map cleanly to a Cambria lens op in v0.2.
Forks using `extend` MUST set `upgradable: false` at the changeset
level.

```json
{"op": "extend", "field": "decompressionStops", "structure": {
    "kind": "array",
    "itemShape": [
      {"field": "depth", "type": "number"},
      {"field": "minutes", "type": "number"}
    ]
}}
```

**Cambria mapping:** none in v0.1. v0.2 will decide how to handle
this — likely via a new lens machinery for structural addition.

## The `upgradable` flag

Every changeset carries a top-level `upgradable: boolean` flag:

```json
"changeset": {
  "ops": [...],
  "upgradable": true
}
```

**Rule:** `upgradable` is `true` if and only if every op in the
changeset has a clean Cambria mapping listed above. The presence of
any `extend` op forces `upgradable: false`.

**Why this matters:** the v0.2 `/reconcile` endpoint will filter to
upgradable changesets when computing bidirectional translations. Non-
upgradable forks remain valid lineage edges but cannot participate in
automatic reconciliation.

## Validation rules

1. A `changeset` field is required iff the concept's `status` is
   `"forked"`.
2. A `changeset` MUST reference fields that exist (for `remove`,
   `rename`, `retype`, `wrap`, `unwrap`, `nest`, `hoist`) or that
   do not yet exist (for `add`, `extend`). The server validates
   this against the parent concept's structure at publish time.
3. `upgradable` MUST be computed correctly — the server verifies and
   rejects mismatched claims.
4. Op order is preserved. Applying ops in sequence produces the
   child schema from the parent.

## Example: forking `activity-log/Session` to `scuba-ops/DiveLog`

Parent:
```json
{
  "type": "Concept",
  "prefLabel": {"en": "Session"},
  "structure": {
    "fields": [
      {"name": "startedAt", "type": "dateTime"},
      {"name": "endedAt", "type": "dateTime"},
      {"name": "location", "type": "reference", "ref": "location/Place"},
      {"name": "participants", "type": "reference[]", "ref": "member-org/Member"},
      {"name": "durationMinutes", "type": "integer"}
    ]
  }
}
```

Child:
```json
{
  "type": "Concept",
  "prefLabel": {"en": "Dive Log"},
  "forkedFrom": "https://schemalattice.io/c/activity-log/session@...",
  "structure": {
    "fields": [
      {"name": "startedAt", "type": "dateTime"},
      {"name": "endedAt", "type": "dateTime"},
      {"name": "location", "type": "reference", "ref": "scuba-ops/DiveSite"},
      {"name": "participants", "type": "reference[]", "ref": "member-org/Member"},
      {"name": "bottomTimeMinutes", "type": "integer"},
      {"name": "maxDepth", "type": "number", "unit": "meters"},
      {"name": "gasMix", "type": "reference", "ref": "scuba-ops/GasMix"},
      {"name": "surfaceIntervalMinutes", "type": "integer"}
    ]
  },
  "changeset": {
    "ops": [
      {"op": "rename", "from": "durationMinutes", "to": "bottomTimeMinutes"},
      {"op": "retype", "field": "location", "fromType": "reference",
       "toType": "reference", "converter": "identity",
       "note": "Reference type changed from location/Place to scuba-ops/DiveSite"},
      {"op": "add", "field": "maxDepth", "type": "number", "unit": "meters"},
      {"op": "add", "field": "gasMix", "type": "reference", "ref": "scuba-ops/GasMix"},
      {"op": "add", "field": "surfaceIntervalMinutes", "type": "integer"}
    ],
    "upgradable": true,
    "note": "Scuba-specific extension of generic session"
  }
}
```

Note that the `location` field's referenced target type changed
(`location/Place` → `scuba-ops/DiveSite`). This is handled by a
`retype` with an identity converter plus a note; the referenced
concepts themselves are linked separately via the `coRefersWith`
relation (since a DiveSite often co-refers with a Marina or other
Place at the same GPS coordinate).

## What's deliberately NOT in v0.1

- **Runtime execution.** v0.1 changesets are descriptive only. No
  translation of actual data between parent and child formats. That
  arrives with Cambria lenses in v0.2.
- **Merge ops.** Combining two parents into one child is a v0.2
  problem.
- **Conditional ops.** "Add this field only when X" — not supported
  at v0.1.
- **Inverse computation.** A v0.1 changeset cannot automatically
  translate child records back to parent format. Apps that need
  this must wait for v0.2 lenses.
