# Environmental stewardship case studies

**Date:** 2026-10-29. **Question:** what public data, vocabulary and
connections does a volunteer environmental nonprofit need? The model was
Trail Team / PlaceTender (`development/trail-team`), which coordinates
stewardship of trails, greenspaces and gardens. It tracks sites and
segments, plantings, a species guide of friends and enemies (natives and
invasives), issues, workdays with volunteer hours, and partner
organizations.

**Method.**
1. Survey the public sources such a group would use and check each one at
   the publisher.
2. Add the missing vocabulary and sources to the catalog
   (`../public-sources/domains/env-stewardship.json`).
3. Hand four invented apps to separate agents. Each knew only the public
   site. Each could send anonymous builder notes and join reports, which
   are quarantined until corroborated.

The scripts are in the four folders here.

## What was added

**New concepts:**
- in a new **biodiversity** context: Taxon, Species Occurrence and Regional
  Species Status, mined from Darwin Core, GBIF, iNaturalist, USDA PLANTS
  and the CT Invasive Plant List;
- Assessed Waterbody (EPA ATTAINS);
- Environmental Justice Area (CT DEEP's EJ sets);
- Watershed (USGS WBD).

**Water results and volunteer hours were already covered:** Observation
and Monitoring Site, and Volunteer Event's `volunteerHours`.

**New sources (11):**
- Darwin Core;
- iNaturalist observations and taxa;
- GBIF occurrence search;
- USDA PLANTS profile;
- the CT Invasive Plant List;
- EPA ATTAINS assessment lines;
- CT DEEP EJ block groups and distressed municipalities, 2025;
- USGS WBD HUC12;
- NWS point forecasts.

Each was checked at the publisher on 2026-10-29. Together they carry 94
field pairs, with readiness and query notes.

## The four apps

| App | What it does | Result |
|---|---|---|
| **Invasive Watch** | Removal priorities for the Mill River Trail corridor, from public observations and the state invasive list, against the group's own field guide | Works. 2,207 iNaturalist observations in a 300 m corridor; 41 CT-listed invasive species seen. The top five are tree-of-heaven, garlic mustard, Japanese knotweed, Oriental bittersweet and multiflora rose. All 7 field-guide species matched across three naming systems. |
| **Grant Context Pack** | The place facts a grant application asks for, sourced and dated | Works. Both points are in EJ block groups (52.2% and 42.5% below 200% of the poverty line). Watershed, census tract and assessed water found for each: the Mill River mouth is impaired for pathogens and low oxygen; the harbor has a TMDL. Criscuolo Park is 100% in the flood hazard area. 640 hours = $25,389 at the CT rate (found outside the catalog). |
| **River Day Planner** | Go / caution / no-go for a riverside workday: weather, tide, bacteria, impairment, flood zone | Works. Saturday: Fair Haven GO, Criscuolo Park CAUTION (zone AE; estuary impaired for pathogens and PCBs; work the 08:15–11:15 low tide). No recent bacteria data is published (latest 2024–2025). The workday fits Volunteer Event. |
| **Garden BioBlitz** | Volunteers and students record species; share onward to iNaturalist and GBIF safely | Works. Ten records in a real pocket park, every taxon resolved in GBIF and iNaturalist, 5 flagged invasive. A Darwin Core export applies consent, coarsens locations and keeps minors' names out. |

Earlier in the day, fresh agents re-ran two civic case studies. Both used
the new query notes and sent contributions (`../civic-case-studies/RESULTS.md`).

## What worked

- **Readiness notes again saved the most time.** The ATTAINS note said:
  Connecticut has several Mill Rivers, filter by unit ID, rows repeat,
  and estuary reaches are in a separate layer. Three agents called it the
  most useful single fact. Without it they would have reported "no
  waterbody" or the wrong river.
- **The knotweed naming note was decisive.** The CT list says *Polygonum
  cuspidatum*, iNaturalist *Reynoutria japonica*, and USDA silently turns
  a synonym into its accepted name. Exact-name matching would have missed
  6 of 41 species.
- **The place listing** (`/sources?jurisdiction=US-CT/new-haven`) put every
  needed layer on one page for all four agents.
- **Point-in-polygon recipes** worked as written: EJ areas, watersheds,
  parks, flood zones.

## Lessons for the system

### 1. A shared concept field is not a shared identifier system
This was the main finding. Three agents independently ran into key joins
that cannot match:
- NOAA, USGS, AirNow and Water Quality Portal station codes, all mapped to Monitoring Site `siteId`;
- iNaturalist taxon ids against GBIF taxon keys, 0 of 300 on the same observations;
- CT town numbers against census GEOIDs, a mapping mistake of ours;
- 2020 census GEOIDs (county 09009) against 2022-vintage ones (planning region 09170).

The catalog inferred "same concept field, so join on equality". But two
agencies numbering the same kind of thing use different systems.

**Fixed (PR #18 and this round):**
- Field pairs may declare a `scheme`, and different schemes never join.
- A key join between different publishers without schemes is offered as
  *unchecked*, with a "compare a sample" instruction.
- Join reports record the `transform` values needed. GBIF's occurrenceID
  for iNaturalist records is the observation URL, and an AirNow AQS id
  becomes `AQS-09-009-0027` in the Water Quality Portal.
- Schemes were applied to all live station, taxon, occurrence, GEOID and
  town-code mappings. Our wrong town-code mapping was disputed and
  re-mapped onto Municipality, where it now joins correctly.

### 2. Coverage is not failure
A layer that only covers designated places (EJ block groups, one
program's sites) rightly matches a minority of points. The 50% rule
labelled a correct EJ join "fails".

**Fixed:** join reports can say `partialCoverage`. Any match then means
the join works, and the rate is shown as coverage.

### 3. Some sources only make sense at a place
The useful facts were place-specific:
- the Mill River's unit IDs;
- which ATTAINS layer has the estuary;
- that recent GBIF plant records near the Mill River are all copies of
  iNaturalist research-grade records.

Builders submitted these as notes. A place-profile tool would answer
"for this point or polygon, which layers answer each standard question,
with what query and what date field". All three place-based apps asked
for one.

### 4. Citizen biodiversity data needs location privacy by default
- Species Occurrence marks coordinates `public`, but for a volunteer the
  coordinates are where a person stood. The iNaturalist source marks them
  `personal-location`.
- **Fixed:** the mesh report now uses the source's classification.
- **Still open:**
  - a concept-level default;
  - Forwarding Consent has no "granted by (self or guardian)" field for minors;
  - there are no concepts for content licensing or survey events (bioblitz);
  - a named pocket park plus a date still places a school group, however
    much the coordinates are rounded.
- The Darwin Core terms for sharing citizen data safely
  (`informationWithheld`, `dataGeneralizations`, `identifiedBy`,
  `identificationVerificationStatus`, `eventID`) were missing from our
  Darwin Core entry. They are added now.

### 5. Shared value is not a join
iNaturalist and GBIF "joined" on taxon rank. Two records both being
"species" identifies nothing.

**Fixed:** enum values no longer form attribute joins.

### 6. Known gaps for stewardship groups
These sources don't exist in the catalog yet:
- tree canopy;
- the value of volunteer time (Independent Sector's state rates);
- state and community-foundation grants;
- combined-sewer-overflow alerts;
- beach closures;
- observed rainfall;
- coastal flood alerts.

Volunteer Event has no field for the conditions call, and no
"postponed / weather hold" status. A parsed CT invasive list with synonyms
and statute dates would replace every group's own parser.

## Contributions from builders

The agents sent about 25 notes and 15 join reports, all quarantined
pending corroboration. They are visible in `lattice_sources_report`.
Several duplicate findings the operator has since curated, such as the
GEOID county split and the GBIF ID mismatches. That shows the loop
working: independent builders reached the same facts.

One apparent anomaly: an agent's report "replaced" another's. The two
agents shared a network, so the ledger counts them as one source. That is
the anti-gaming rule working as designed.

## Fixes from these lessons (2026-10-29, PR #20 and live data)

| Lesson | Fix |
|---|---|
| No place profile (asked for by all three place-based apps) | `lattice_place_profile` and `GET /place?lat=&lng=&jurisdiction=`. Every covering area or line layer, grouped by question, each with a ready-to-run point query, what its fields mean and its last change. Checked live: Fair Haven returns Ward 8, EJ 52.2%, zone X, HUC12 Mill River. |
| Estuary reaches missing | `epa-attains-assessment-areas` (MapServer/2), mapped onto Assessed Waterbody. The lower Mill River is CT-C1_023-SB. |
| Known gaps | Tree canopy by tract (CIRCA, joins census tracts on the 2020 GEOID scheme), CSO outfall locations (CT DEEP), NWS station observations (rainfall), and the value of volunteer time (Independent Sector; refuses scripts, so it is not checked by the catalog) |
| Volunteer Event lacked a conditions call and a postponed status | Volunteer Event v2 (`@b3cb435e010f`): `workday`, `postponed`, `conditionsVerdict`, `conditionsNote`, `postponedTo` |
| No survey-event concept for bioblitzes | Survey Event (`biodiversity/survey-event@dbaba8e783a9`), from the Darwin Core Event class, with protocol, effort, taxa targeted, minors and record license |
| Consent couldn't say a guardian gave it | Forwarding Consent v2 adds `grantedBy` (self, parent-or-guardian, organization) and `subjectIsMinor`; v1 resolves forward |
| Concept and source sensitivity disagreed | Issue Report v3 (`@55b4929ae546`) classifies `photo` and `reporter` as personal-identity. All four 311 sources were re-mapped onto it. |
| Mesh ignored wire names; no nearest join | The mesh reads field-map wire names through the target source's mappings, offers a nearest-point connection, and mentions the right-of-way fallback for parcels |
| `$schema` URL 404 | `/schema/manifest-v1.json` is served, including `fieldMaps` and `target.source` |
| Builder brief said little about reading public data | New section 7: find, read the page, treat joins as hypotheses, report back, send data back with consent |
| Builder findings stuck in quarantine | 10 notes verified and confirmed by the operator, including street trees `Species`/`SiteID` always empty (also shown by the server's profile), GBIF's URL-style occurrenceID, the EJ GEOID county split, SeeClickFix paging and box filters, NOAA tide predictions and the Mill River unit. The other 15 wait for independent corroboration. |

**A slip while doing this.** Re-running the seed file re-asserted its
original mappings as the operator. That dropped the schemes added live, and
re-asserted a mapping that had been disputed. Both were restored within
minutes, and the schemes now live in the seed file. The seed tool now keeps
live schemes and conversions the seed lacks, and refuses to re-assert a pair
whose dispute was upheld, saying so in both cases. The lesson is the same
as the overwrite incident earlier in the day: an automatic re-run must not
silently undo a later, deliberate change.
