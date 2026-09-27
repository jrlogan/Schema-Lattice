# Spec: Annotation Standard

**Status:** Locked for v0.1. Additive changes to the manifest format
are backward compatible.

## Goal

Define how code authored against SchemaLattice declares its concept
references. Any future tool — including another AI — reading the code
should be able to trace every data model back to its canonical
definition in the lattice with no framework-specific knowledge.

Two layers: a **sidecar manifest** (authoritative, structured) and an
**inline marker tag** (convenient, grep-friendly). Every
SchemaLattice-aware project has the sidecar; inline markers are
optional but recommended for larger projects.

## 1. The sidecar manifest

### File location

`schemalattice.json` at the project root, or
`.schemalattice/manifest.json` for projects that prefer hidden config.
Tools MUST check both locations in that order before walking up the
directory tree to find one in an ancestor directory.

### Format

Plain JSON. No dependency on JSON-LD processors.

```json
{
  "$schema": "https://schemalattice.com/schema/manifest-v1.json",
  "lattice": "https://schemalattice.com",
  "project": {
    "name": "scuba-club-app",
    "description": "Dive tracking and club trip planning"
  },
  "concepts": {
    "DiveLog": {
      "uri": "https://schemalattice.com/c/scuba-ops/dive-log@a1b2c3d4e5f6",
      "status": "forked",
      "forkedFrom": "https://schemalattice.com/c/activity-log/session@998877665544",
      "localLocation": "src/models/dive_log.py",
      "notes": "Added depth/gas/deco fields for scuba specifics"
    },
    "DiveSite": {
      "uri": "https://schemalattice.com/c/scuba-ops/dive-site@7766554433aa",
      "status": "forked",
      "forkedFrom": "https://schemalattice.com/c/marina-ops/marina@112233445566",
      "coRefersWith": ["https://schemalattice.com/c/marina-ops/marina@112233445566"],
      "localLocation": "src/models/dive_site.py"
    },
    "Goal": {
      "uri": "https://schemalattice.com/c/personal-goals/goal@ffee00112233",
      "status": "adopted",
      "localLocation": "src/models/goal.py"
    },
    "BuddyPair": {
      "uri": "https://schemalattice.com/c/scuba-ops/buddy-pair@bb11cc22dd33",
      "status": "originated",
      "localLocation": "src/models/buddy_pair.py"
    }
  },
  "generatedBy": "claude via lattice-workflow skill",
  "generatedAt": "2026-04-12T14:32:00Z"
}
```

### Field semantics

- **`lattice`** — the canonical base URL of the SchemaLattice instance
  this project registered against. All URIs in the file resolve against
  this base.
- **`concepts`** — a map from local short name (used in code) to the
  concept's metadata. The local short name is arbitrary and project-
  specific; it's what appears in inline markers.
- **`concepts[name].uri`** — the fully-qualified, content-addressed
  URI. Authoritative reference.
- **`concepts[name].status`** — one of `"adopted"`, `"forked"`,
  `"originated"`. Required. Declares the relationship to the lattice.
- **`concepts[name].forkedFrom`** — required iff `status == "forked"`.
  The parent URI.
- **`concepts[name].coRefersWith`** — optional array of URIs for
  concepts that share a real-world referent but different perspective
  (e.g. same GPS point, different view).
- **`concepts[name].localLocation`** — primary file path relative to
  project root. Optional but strongly recommended.
- **`concepts[name].notes`** — free-text rationale for human readers
  and future AIs. Optional.
- **`concepts[name].inspiredBySources`** — optional array of source
  URLs that informed the concept's design without being directly
  copied. Used by concepts synthesized via JIT mining (Checkpoint
  1D) when the AI studied multiple open-source projects to produce
  a cross-cutting definition. Distinct from `importedFrom` (which
  implies direct extraction from a single authoritative source).
  Each entry is either a bare URL string or an object with `url`
  and `note` fields.

### Immutability rules

A concept's `uri` is content-hashed and immutable. If a concept's
definition changes, the AI MUST either:

(a) publish a new concept with `pav:previousVersion` pointing to the
old URI, and update the manifest; or

(b) fork if the change is semantic.

Never edit a `uri` field in place.

### Field maps (optional)

A concept URI says what a record *means*. It does not say how one app's
columns become another system's payload. That mapping is what the next
builder needs most, and it is usually rebuilt by hand. `fieldMaps` records
it in the builder's own manifest. It is an optional, additive section of
manifest v1: tools that do not know it ignore it, and a manifest without
it is still valid.

A field map describes one crossing from a **source** (a person's
spreadsheet, a GPX export, another app's API) to a **target** (usually a
backend's accepted payload, sometimes the app's own local model). Each
entry in `fields` is one target field and where its value comes from.

```json
"fieldMaps": {
  "sailing-sheet-to-log": {
    "source": {
      "kind": "spreadsheet",
      "description": "Personal sailing spreadsheet, one row per day out",
      "concept": null
    },
    "target": {
      "kind": "backend-payload",
      "schema": "https://log.boating.systems/agent/history-schema.json",
      "format": "boating-log-history",
      "version": 1,
      "path": "records[]",
      "concept": null
    },
    "fields": [
      { "target": "key",      "from": "row id",   "conversion": "stable per row; never reuse a key for changed content" },
      { "target": "date",     "from": "Sail date", "conversion": "M/D/YYYY → YYYY-MM-DD" },
      { "target": "boatName", "from": "Boat" },
      { "target": "title",    "from": ["Sail date", "Where"], "conversion": "\"{Where}, {Sail date}\"" },
      { "target": "evidence", "constant": "written", "notes": "the sheet is a written record, not a track" },
      { "target": "sources",  "constant": ["sailing spreadsheet"] },
      { "target": "uncertainties", "from": "Notes",
        "conversion": "copy only notes that qualify the record, e.g. \"date estimated from album\"",
        "uncertainty": "an estimated date stays estimated; never promote it to measured" }
    ],
    "omitted": [
      { "from": "Crew",  "reason": "names of other people; tag_people is a separate grant" },
      { "from": "Fuel $", "reason": "no target field" }
    ],
    "validatedAgainst": "https://log.boating.systems/agent/history-schema.json",
    "notes": "Preview through importLogHistory before commit; the person picks rows."
  }
}
```

Field semantics:

- **`fieldMaps`**: a map from a local map name to one map.
- **`source` / `target`**:
  - **`kind`**: free text; common values are `spreadsheet`, `file-export`, `app-api`, `backend-payload` and `local-model`.
  - **`description`**: a human description of the source or target.
  - **`schema`**, **`format`** and **`version`**: identify a published wire schema when there is one. Record the version: a map written against v1 must not be silently applied to v2.
  - **`path`**: where the mapped object sits inside the payload.
  - **`concept`**: a lattice concept URI (or local short name from `concepts`) when one is known, else `null`. A map with no concepts at all is valid and still useful.
- **`fields[]`**: one entry per target field.
  - **`target`**: required; the field name in the target.
  - Exactly one of **`from`** or **`constant`**:
    - `from` is a source field name, or an array of names when several combine.
    - `constant` is a fixed value supplied by the builder.
  - **`conversion`**: optional; how the value changes (format, unit, rounding, join).
  - **`unit`**: optional; `{ "from": "nm", "to": "meters" }` when units change.
  - **`uncertainty`**: optional; what the value cannot claim, e.g. inferred rather than measured, estimated rather than recorded.
  - **`concept`**: optional; the concept URI this field instantiates.
  - **`notes`**: optional.
- **`omitted[]`**: source fields deliberately not carried, each with a `reason`. An omission written down is a decision; an omission left out looks like a bug.
- **`validatedAgainst`**: the schema the builder actually validated a sample payload against, if any.

Rules:

1. **The backend decides validity, not the lattice.** A field map records
   the builder's understanding of a contract; the backend's published
   schema and its preview or dry-run operation are the test. A high
   similarity score never makes a field acceptable to a backend.
2. **Field maps stay in the builder's project.** They can name private
   columns, people's spreadsheets and personal conventions. No lattice
   tool sends them to the catalog, and no AI should publish one as a
   concept or put one in a registry manifest unless the person asks for
   that specific map to be shared.
3. **Provenance travels with the value.** When a source value is
   estimated, inferred or planned, say so in `uncertainty`, and map it
   to the target's own provenance field when the target has one (above:
   `uncertainties`, `evidence`). Never let a conversion turn a weaker
   claim into a stronger one.
4. **Update, don't fork.** A field map is local, mutable project
   documentation. Edit it in place when the source changes, and bump
   `target.version` when the target schema does. Concepts are what is
   immutable.

## 2. Inline marker tags

### Purpose

Let humans and future AIs find lattice references while reading code
without cross-referencing the sidecar for every identifier.

### Syntax

One canonical form, usable inside any language's comment syntax:

```
[lattice:SHORT_NAME]
[lattice:SHORT_NAME.field_name]
```

The short name MUST match a key in `schemalattice.json`'s `concepts`
map. Field tags reference individual fields of that concept's
structure.

### Placement

Adjacent to the declaration of the thing being tagged. Examples in
several languages:

**Python:**
```python
# [lattice:DiveLog]
class DiveLog(models.Model):
    max_depth = models.FloatField()  # [lattice:DiveLog.maxDepth]
    bottom_time = models.DurationField()  # [lattice:DiveLog.bottomTime]
```

**TypeScript:**
```typescript
// [lattice:DiveSite]
interface DiveSite {
    coordinates: [number, number];  // [lattice:DiveSite.coordinates]
    typicalDepthRange: [number, number];  // [lattice:DiveSite.typicalDepthRange]
}
```

**Drupal YAML (field config):**
```yaml
# [lattice:LibraryItem.status]
field_name: field_library_item_status
```

**PHP:**
```php
/** [lattice:LibraryItem] */
class LibraryItem extends Node { ... }
```

**SQL DDL:**
```sql
-- [lattice:LibraryTransaction]
CREATE TABLE library_transaction (
    borrow_date DATE,  -- [lattice:LibraryTransaction.borrowDate]
    ...
);
```

### Why brackets

The `[lattice:...]` form was chosen because:

- It greps cleanly: `rg '\[lattice:' src/` finds every reference.
- It's unambiguous in any comment context regardless of language.
- It doesn't collide with common comment conventions (TODO, FIXME,
  JSDoc `@tags`, Python docstring fields).
- It's short enough that field-level tagging stays legible.

### Discovery walk

A tool encountering a codebase that may be SchemaLattice-aware SHOULD:

1. Search for `schemalattice.json` at the project root (and
   `.schemalattice/manifest.json`, then walk up to parent directories).
2. If found, load the manifest.
3. Optionally run `rg '\[lattice:'` to find all inline references.
4. For any inline tag whose short name is not in the manifest, emit a
   warning — the reference is dangling.

## 3. When inline markers are unnecessary

For small projects (< ~10 concepts) the manifest alone is sufficient
and inline markers add clutter. A single rule of thumb: use inline
markers when a reader encountering the file cold would have to open
the manifest to understand what a given class or field represents.
For a file with one class whose name matches its short name, skip the
class-level marker; field-level markers may still be useful.

## 4. Machine-generated manifests

The manifest SHOULD carry `generatedBy` and `generatedAt` fields for
provenance. When a future AI updates the manifest, it appends to a
`history` field (optional, max 10 entries) rather than overwriting
provenance. This gives a readable audit trail of which AIs touched
the project's lattice bindings.

```json
"history": [
  {
    "generatedBy": "claude via lattice-workflow skill",
    "generatedAt": "2026-04-12T14:32:00Z",
    "action": "initial creation"
  },
  {
    "generatedBy": "claude via lattice-workflow skill",
    "generatedAt": "2026-04-15T09:11:00Z",
    "action": "added BuddyPair concept"
  }
]
```
