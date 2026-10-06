# Trail data pilot

## The job

Trail Team (volunteer trail stewardship) now shows Connecticut's state
trail data on its maps, and wants to link back generously to CT Trail
Finder, the state's public trail directory. CT Trail Finder runs on a
platform (Aptuitiv's BranchCMS Trails app, sites designed by Community
Geographics) used by about ten trail finders in eight states. Its data
follows the **CT GIS Trails Data Standard (2021)**, which descends from
the federal trail data standard (FTDS).

The question for SchemaLattice: can the catalog describe trails well
enough that a stewardship app, a state inventory and a trail finder can
line their data up, and does it have a way to say which outside standard
a concept follows? That second question is the "standards as external
anchors" item deferred after the [bounty pilot](trail-team-bounty-pilot.md).

## Live catalog, 2026-10-02

Read-only `GET /discover?ephemeral=true` against schemalattice.com:

| Description | Top result | Similarity | Verdict |
|---|---|---|---|
| A named recreational trail made of several physical segments | `voyage-log/trip` | 0.547 | no-match |
| One physical stretch of trail between two junctions | `schemalattice/physical-object` | 0.531 | no-match |
| A trailhead or access point with parking | `human-services/service-site` | 0.545 | no-match |
| A volunteer group adopting a stretch of trail | `civic-issue-reporting/issue-report` | 0.493 | no-match |

Nothing for trails. Every concept had to be originated.

## Experiment

`npm run demo:trail-data` in `packages/lattice-server` runs the live
discovery above, then, in a throwaway local instance:

1. Originates the state's shape as **CT Trail Line** (29 fields, copied
   from the published standard) in a `ct-trails-2021` context.
2. Originates Trail Team's concepts in `trail-stewardship`: **Trail
   System** (a named trail or network), **Trail Segment** (declared
   `coRefersWith` CT Trail Line: the same ground, seen by finders versus
   maintainers), **Trail Point** (trailheads and points of interest in one
   class, as CT does), and the two stewardship concepts no standard has:
   **Segment Adoption** (workflow with a lifecycle) and **Condition
   Report** (event).
3. Compares CT Trail Line with Trail Segment.
4. Tries to say which standards Trail Segment follows, at concept level
   and at field level, including a deliberate typo.

Anchors used: `wd:Q628179` (trail, the physical path), `wd:Q2143825`
(hiking trail, the itinerary), `wd:Q7832815` (trailhead), `wd:Q4684557`
(Adopt a Highway), `wd:Q66314461` (trail maintenance). Wikidata is the
only approved vocabulary with trail terms; schema.org has none.

### Results

All six concepts published with **no warnings**. Then:

- **The crosswalk came back empty.** `lattice_compare` paired zero
  fields: "0 the same, 0 renamed, 0 changed, 29 only in CT Trail Line,
  13 only in Trail Segment." `Blaze`/`blaze`, `Surface`/`surface` and
  `Town`/`town` differ only by case. The declared `coRefersWith` link
  between the two concepts is not used. Compare says only "no fork
  relation; fields are paired by name only."
- **Non-RDF standards in `closeMatch` pass silently.** `closeMatch:
  ["wd:Q628179", "ctTrails2021:TrailLine", "ftds:TrailSegment",
  "osm:highway=path"]` published with no warning: the approved-prefix
  rule is satisfied by the one `wd:` entry, and the unknown prefixes are
  ignored.
- **Field-level crosswalk keys pass silently, typos included.** A
  `crosswalk: { ctTrials2021: "Blaze", osm: "osmc:symbol" }` key on a
  field is hashed into the concept and never checked.
- **Discovery says "fork" across a whole domain.** Once the first trail
  concept existed, every later one was told to fork its predecessor:
  Trail Point → fork Trail Segment (0.717), Condition Report → fork
  Trail Segment (0.652), Segment Adoption → fork Trail Segment (0.688).
  An observation event and a workflow are not forks of a place. Shared
  vocabulary ("trail", "segment") outweighed structure.

## Findings

1. **For data owners, the crosswalk is the product.** The useful output
   of this pilot would have been the CT Trail Line ↔ Trail Segment table
   with pairs filled in: `Blaze → blaze`, `Surface → surface` (with value
   mapping), `Distance_Miles → lengthMeters` (unit change), `Trail_Status
   → buildStatus` (lifecycle states), `Manager → maintainer` (string →
   reference). Compare can only produce that for forks. Co-referring
   concepts from independent sources are the common case for public data,
   and they are exactly where it fails.
2. **Standards need to be things in the catalog, not prefixes.** CT
   Trails 2021, FTDS, OpenTrails and OSM tagging each have a name,
   version, publisher, license and a field list. A CURIE prefix can't
   carry any of that, and it can't be validated. The `ctTrials2021` typo
   would be caught if standards were registered records.
3. **Field-level mappings are the unit that matters.** Concept-level
   anchors say "this is a trail"; every trail model says that. What two
   systems need is "our `surface` is their `Surface`, and our
   `stone-dust` is their `Stone Dust`".
4. **The stewardship half is genuinely new.** No standard reviewed (CT
   2021, FTDS/FTGS, USFS TrailNFS, NPS, USGS National Digital Trails,
   OpenTrails, OSM) models adoption, condition history or work logs. CT's
   2021 revision *removed* Trail Condition and Trail Class. FTDS keeps a
   single Trail Condition value and one Primary Trail Maintainer. Segment
   Adoption and Condition Report are the concepts other stewardship apps
   would most likely reuse.
5. **Topic similarity is not a fork signal.** Same as the bounty pilot's
   deferred "structural discovery" item, from the other direction: there,
   structural analogues ranked too low; here, topical neighbours rank too
   high. Comparing `conceptKind` and lifecycle shape before saying "fork"
   would fix both cases.

## Proposals (not built)

These touch identity and the publish contract, so they are written up
for a decision rather than implemented:

- **Standard records.** A `standard` record type (slug, title, version,
  publisher, URL, license, field list) and a concept-level
  `conformsTo: [standardUri]` (after `dct:conformsTo`). Seed with CT
  Trails 2021, FTDS, OpenTrails 2014, OSM path tagging, Open311 and C2PA.
  This resolves the deferred "standards as external anchors" item.
- **Validated field crosswalks.** A per-field `sameAs: { <standard
  slug>: "<field>" }`, refused when the slug isn't a registered standard
  or the field isn't in its list. Value-level maps (enumerations) can
  wait.
- **Compare uses co-reference and crosswalks.** When two concepts
  `coRefersWith` each other or share a standard, pair fields through
  `sameAs`, then case-insensitively, and report unit changes.
- **Kind-aware verdicts.** Don't return `fork` across `conceptKind`s
  (entity → event, entity → workflow); downgrade to `related`.

## Next experiment

Build the standard records and `sameAs` crosswalks, then rerun this
pilot: the compare table should pair at least 10 of Trail Segment's 13
fields with CT Trail Line's. Then have a builder agent write a CT Trail
Finder importer twice, once from the CT standard's spreadsheet alone and
once from the crosswalked concepts, and compare the two.
