# Civic case studies: what the system needs for civic data integration

**Date:** 2026-10-28/29. **Question:** can SchemaLattice help people mesh city,
state and civic-platform data and build civic apps, including apps whose
data comes from residents? What does the system have to do for that to work?

**Method.** We invented four New Haven apps. Each was handed to a separate
agent that knew only the public site (schemalattice.com, no key, no writes,
no access to this repo), with instructions to:
- build a working prototype on real data;
- keep a log of friction points and what each cost in time;
- list the contributions it would have made back.

Each took about an hour. The scripts are in the four folders here. Raw
outputs are left out because they contain names from public records
(tax-relief orders, testimony).

Before the studies we had shipped three things, so the agents tested them:
- point locations and point-in-polygon joins;
- trust fields and weekly checks;
- Issue Report v2, which adds acknowledged and closed times.

## The four apps

| App | What it does | Data it meshes | Result |
|---|---|---|---|
| **Ward Watch** | Takes an address and returns the ward, the alder and their contact, 311 issues in the ward, and median days to close by category | Address points → wards (point in polygon) → SeeClickFix issues (bounding box + polygon) | Works. City Hall is in Ward 7 (225 issues in 90 days, median 4.8 days to close). 181 Mitchell Dr is in Ward 10 (260 issues, 3.3 days). |
| **Home Check** | Takes an address and returns the parcel, assessment, zoning, historic and inclusionary overlays, BMR/LCI status and state sales, each with its source and date | City parcels, CT CAMA 2026, zoning, historic districts, inclusionary zoning, BMR, LCI, CT real-estate sales | Works for five addresses. Parcel ID = CAMA pid (town 93) = BMR vision_pid, and mblu = LCI mbp, matched exactly. |
| **Agenda Alert** | Builds a digest of upcoming meetings and legislation that concern a ward or neighborhood | Legistar matters, events and agenda items → place names parsed from titles → address points → ward and neighborhood polygons | Works. 89 of 467 matters (19%) have a location in their title. All 9 strong Ward 7 hits and all 5 Fair Haven hits were plausible. |
| **Street Audit** | Lets volunteers record sidewalk, tree and streetlight conditions, line them up with city data, and forward them to 311 | A volunteer data model built from catalog concepts → wards, neighborhoods, parcels, nearest street tree → an Open311 create request body (not sent) | Joins work. The export was built. The path back to the city is not modelled in the catalog. |

## What worked

- **Readiness notes were the most-cited time saver.** Examples the agents used:
  - "City Hall is in Ward 7" was used as a test.
  - "Alder names in the ward layer lag the roster" stopped one agent trusting them blindly.
  - "newhavenct.gov returns 403" stopped them scraping.
  - "1,000 rows per request" and "ask for outSR=4326" saved setup time.

  These notes came from checking each source by hand the day before. They
  saved 20–60 minutes per app.
- **Join keys between sources were right where they were keys.** Parcel ID ↔
  CAMA pid ↔ BMR vision_pid, mblu ↔ LCI mbp, and roster ward ↔ ward layer
  all matched exactly.
- **Point-in-polygon instructions** were followed as written and worked first time.
- **Search with `q=`** found the right source in one query nearly every time.

## What failed, and the general lesson behind each

Each lesson is something the system has to do. It is not a fact about New Haven.

### 1. Discovery must be complete and local-first
`/sources?jurisdiction=US-CT/new-haven` returned the top 25 results, global
standards first, with no count. Every city layer the agents needed was cut
off, and three of the four agents hit this.
- **Lesson:** listing what exists for a place is a completeness promise. It can't be a ranked page.
- **Fixed:** the listing is now complete, the place's own sources first, with a count.

### 2. Describe how a source behaves, not just its fields
The costliest surprises were not about field names:
- SeeClickFix returns only open and acknowledged issues by default: 8,375 of 156,352.
- Closed SeeClickFix issues become "archived" and can lose `closed_at`.
- The Legistar website uses different IDs from its API, so the right link is `Gateway.aspx?M=L&ID=<MatterId>`.
- There is a minimum page size, and one site blocks scripts.

A field list says nothing about any of this.
- **Lesson:** a source entry needs structured *access notes*: default filters, record lifecycle, paging limits, supported filters, link templates and blocked clients. Free-text readiness notes carried some of this, but only where we had written them.
- **Next:** add access notes to the source record.

### 3. Check values, not just names
Mapped fields that look right can still be wrong:
- **Always empty:** address points `neighborhood` was blank on all 42,761 rows, and `parcel_join_id` was null on all of them.
- **Wrong coordinate system:** LCI `lat`/`long` hold State Plane feet. Our own point detection, shipped the day before, would have pointed builders at them.
- **Stale:** the city parcel layer's assessment lagged the assessor (parcel 553: $151,900 vs $164,920).
- **One name, two meanings:** "valuation year" means the 2021 revaluation in CAMA and the 2025 grand list on Vision cards.

Every one of these passed our checks, which only read field lists.
- **Lesson:** the catalog has to profile values. That can be done without copying records:
  - ArcGIS `outStatistics`/`groupBy` and Socrata `$select=count()` return aggregates only;
  - fill rate, distinct count and min/max would have caught empty fields and out-of-range coordinates;
  - staleness needs a second source to compare against.
- **Fixed for now:** ArcGIS point layers are joined by their own geometry, and lat/lng pairs carry a "check these are degrees" note. The four data problems are written into the source notes.
- **Next:** field profiles in the weekly check.

### 4. Joins need evidence, not just inference
These joins never worked:
- **Offered but never matched:**
  - parcels ↔ sales by point (the points fall in streets or are missing);
  - wards ↔ neighborhoods by name ("Ward 7" vs "FAIR-HAVEN");
  - meetings ↔ legislation by body name.
- **Missing:** the join the Agenda Alert agent actually needed, agenda items ↔ matters through `EventItemMatterFile`, wasn't listed.

Joins worked out from shared concept fields are guesses until someone runs them.
- **Lesson:** builders should report "tried join X: matched N of M", as counts only, never records, through the evidence ledger. The catalog should label each join tested or untested and show its match rate.
- **Fixed:** name-only joins between two lists of the same kind of record are no longer offered. The agenda-items source was added, and it joins matters on the file number.
- **Next:** a join-attestation claim kind.

### 5. Builders learn the most valuable facts and have nowhere to put them
Every agent ended with a list of corrections and notes it couldn't submit. The tools only take sources and field mappings: no notes, no "this field is always empty", no "use this link pattern". Four of the five findings above came from builders, not from our curation.
- **Lesson:** the learning loop has to accept notes, corrections and value findings, with the same quarantine and corroboration as mappings. Otherwise only the operator's checking reaches the next builder.
- **Next:** this is the most important missing piece. It is how the catalog stays right as it grows past what one person can verify.

### 6. Civic engagement needs a write path, not just a read path
The catalog describes data flowing from the city to an app. Street Audit needed the other direction:
- an Open311 *create* request;
- per-service definitions with required attributes (Street Lamp requires a pole number);
- `service_code`, which neither Open311 entry mapped.

It also needed volunteer data to be comparable across groups and cities: severity, condition types, audit sessions. None of that vocabulary exists.

The mesh report made things worse in one case. It ignored the agent's unpublished fork of Issue Report, so declaring the fork honestly scored *worse* than claiming plain adoption. It also ignored `fieldMaps` and spatial joins.
- **Lesson:** citizen-generated data is a first-class flow: resident → app → city, and app ↔ app. It needs write-side standards as sources, shared vocabulary for observations, and a mesh report that understands forks and spatial joins.
- **Next:** Open311 create and service definitions as sources; mesh report fixes.

### 7. Public data contains personal data, and citizen data more so
- SeeClickFix publishes reporter names.
- Some Legistar agenda titles contain whole minutes, including public speakers' home addresses.
- Tax-relief orders name individuals.
- Volunteer photos, exact points and timestamps trace where a person walked.

The catalog already has sensitivity classes for concept fields, but not for source fields, and nothing covers consent to forward.
- **Lesson:**
  - classify source fields, not only concepts;
  - add a consent-to-forward class for citizen data;
  - have the mesh report flag personal data crossing to another party.
- **Fixed for now:** written into the SeeClickFix, matters and agenda-items notes.

### 8. Text is a location source
Legislation only says where it applies in its title text. Agenda Alert worked by pulling out addresses, street corners and neighborhood names, then geocoding them.
- **Lesson:** a concept for "the place a record concerns" is needed: address, parcel, street segment or district, with how it was found and a confidence level. Without it, every civic-alert app redoes this and no two agree.

### 9. Concept versions must not break joins
Issue Report v2 left SeeClickFix showing both versions. A source on v2 also stopped joining one still on v1.
- **Lesson:** a version is a change of record, not a different concept, for anyone joining data.
- **Fixed:** joins span versions, and a source's superseded pairs drop out once it is re-mapped.

### 10. Disagreement between sources is information
- The roster says Ward 24 is vacant; the ward layer names an alder.
- The state sales file says $562,000 for 39 Wooster Pl; CAMA says $565,000.

These were among the most useful things the agents learned.
- **Lesson:** record cross-source disagreements as first-class notes, with which source to prefer for what.

## Fixed during this round

| Fix | Where |
|---|---|
| Point locations from lat/lng and GeoJSON; point-in-polygon joins | PR #9 |
| Issue Report v2 with lifecycle times; SeeClickFix and Open311 re-mapped | live concept `issue-report@34263088753f` |
| Joins span versions; superseded pairs hidden once re-mapped | this round |
| Complete, local-first listings by place | this round |
| Name-only attribute joins need a pointer on one side | this round |
| ArcGIS points use the layer's geometry; lat/lng carry a degrees check | this round |
| Source notes corrected for SeeClickFix, address points, LCI, parcels, Legistar (spot-checked first) | live data |
| New source: Legistar agenda items, joining matters on file number | live data |
| Bad address-points neighborhood join disputed and retracted | live data |

## What to build next, by impact

1. **Builder-contributed notes and corrections** through the evidence ledger (lesson 5).
2. **Join attestations** with match rates; label each join tested or untested (lesson 4).
3. **Field profiles** from aggregate statistics in the weekly check: fill rate, distinct count, value range (lesson 3).
4. **Structured access notes**: default filters, lifecycle, paging, link templates, blocked clients (lesson 2).
5. **The write path**: Open311 create and service definitions as sources; the mesh report reading forks, `fieldMaps` and spatial joins (lesson 6).
6. **Field-level sensitivity on sources** and a consent-to-forward class (lesson 7).
7. **A place-reference concept** for records located only by text (lesson 8).

The common thread: the catalog's value for civic work comes from what
people learn by using the data, more than from describing schemas. The
system now records what the operator checks. Next it needs to record what
every builder finds, with the same evidence rules, and to carry data from
residents back to the city as well as from the city to residents.
