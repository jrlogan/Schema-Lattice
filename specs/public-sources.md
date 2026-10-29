# Spec: Public Data Sources

**Status:** Implemented in `packages/lattice-server/src/sources/`,
tested by `test/sources.ts`. Seeded for Connecticut and New Haven
property data by `examples/public-sources/`. This is evidence ledger
phase 2 ("field mappings from public schemas"), widened from "public
systems" to any public dataset, and it builds the "standard records"
proposal from the trail data pilot.

## The problem

Concepts say what a record *means*. They don't say where real records
of that kind are published, or how a published table lines up with the
concept. Someone asking "what public property data is there for New
Haven, and how do the pieces fit together?" gets nothing back today.
So every builder working with public data redoes the same research:
find the portal, read the column list, guess what `Link` and `PID`
mean, and work out that sales and assessments join on town and
address.

The catalog can hold that work once:

- **Sources:** the public datasets and standards themselves: who
  publishes each one, where its API is, and its exact field list.
- **Mappings:** which concept a source's records are, and which of its
  fields carries which concept field.
- **Relationships**, worked out from the mappings: two sources that map
  fields onto the same concept field can be joined on those fields.

It is not a data portal. data.gov, CKAN, Socrata and ArcGIS Hub already
do discovery. A source entry points at the publisher. The catalog
never copies or proxies records.

## Records

A source is a mutable register entry, like a registered app, not a
content-addressed concept. Publishers rename fields, move endpoints and
change licenses, so the entry has to be editable. Concepts stay
permanent and are never changed by anything here.

```json
{
  "slug": "ct-real-estate-sales",
  "kind": "dataset",
  "title": "Real Estate Sales 2001-2023 GL",
  "publisher": "Connecticut Office of Policy and Management",
  "jurisdiction": "US-CT",
  "recordDescription": "One recorded property transfer of $2,000 or more, with its sale price and assessed value.",
  "landingPage": "https://data.ct.gov/Housing-and-Development/Real-Estate-Sales-2001-2023-GL/5mzw-sjtu",
  "accessUrl": "https://data.ct.gov/resource/5mzw-sjtu.json",
  "platform": "socrata",
  "schemaUrl": "https://data.ct.gov/api/views/5mzw-sjtu.json",
  "format": "json, csv",
  "license": "…as stated…",
  "updateFrequency": "annual",
  "conformsTo": [],
  "fields": [{ "name": "saleamount", "type": "number", "label": "Sale Amount", "description": "…" }],
  "fieldsVerified": true,
  "fieldsCheckedAt": "2026-10-13T…",
  "status": "listed"
}
```

- `kind`: `dataset` (records you can fetch) or `standard` (a published
  field specification such as BLDS or CT Trails 2021). A dataset's
  `conformsTo` names the standards it follows, by slug. Unknown slugs
  are refused, which catches the typo the trail pilot showed passing
  silently.
- `jurisdiction`: an ISO 3166-2 code, optionally followed by a locality
  slug: `US`, `US-CT`, `US-CT/new-haven`; or `global` for international
  standards and datasets, which covers everywhere. A search for `US-CT` matches
  all three of the last two.
- `fields` comes from the publisher whenever the platform allows it
  (see "Field lists"). Field names are exact, case included, because
  they are what a request uses.

## Field lists

The server reads the field list from the publisher. It does not take
the submitter's word for it. That makes the list unforgeable in the
way that matters, as `match` claims are: you can only map fields the
publisher actually has.

| Platform | `accessUrl` shape | Field list read from |
|---|---|---|
| `arcgis` | `…/FeatureServer/{n}` or `…/MapServer/{n}` | `{accessUrl}?f=json` → `fields[]` (`name`, `type`, `alias`) |
| `socrata` | `https://{host}/resource/{id}.json` or a `/d/{id}` page | `https://{host}/api/views/{id}.json` → `columns[]` (`fieldName`, `dataTypeName`, `name`, `description`) |
| `manual` | anything else, including standards | the submitter's `fields`, marked `fieldsVerified: false` |

Fetches are HTTPS only. The resolved address must be public: loopback,
private, link-local and carrier-NAT ranges are refused at connect time,
so a DNS answer can't redirect the fetch inward. Fetches don't follow
redirects, time out after 10 seconds and stop reading at 4 MB.
`lattice_check_source` re-reads a verified source's field list and
reports what changed.

## What a builder can rely on

A public source is not automatically reusable, current or complete.
Each entry keeps the questions a builder has to answer before relying on
it separate, and never fills one in from another. A working sample
query says nothing about the license.

**Access status**, worked out from the server's own checks, never
entered by hand:

| Status | Meaning |
|---|---|
| `located` | The field list was supplied by hand (`manual`). The server cannot read this source itself. |
| `tested` | The server's last read of the publisher's field list worked, within the last 21 days. |
| `stale` | It worked once, but not within 21 days. |
| `failing` | The last read failed. `failingSince` is the first failure in the current run of failures, with the publisher's error. |

Every read is recorded in `source_checks` (the last 30 per source),
failures included: the first read when the source is proposed, each
`lattice_check_source` call, and the scheduled sweep. `resolve` shows
the five latest as `recentChecks`, with the fields added, removed or
retyped when the list changed.

**The weekly sweep.** The server re-reads every verified, not-withdrawn
source once its last check is 7 days old, or 1 day old if that check
failed, so a single outage doesn't show as failing for a week. Runs come
every six hours, take at most 25 sources, oldest first, and wait two
seconds between requests, so the catalog is spread over the week and no
publisher sees a burst. Mappings broken by a removed field drop out as
they do for a manual check. `LATTICE_SOURCE_CHECKS=off` turns the sweep
off. A passing check means the field list could be read, nothing more:
it does not show that every row is there, that the data is current, or
that reuse is permitted.

**Two dates, never confused.** `fieldsCheckedAt` and the check history
say when the server looked. `publisherUpdatedAt` says when the publisher
says the data last changed: ArcGIS `editingInfo.dataLastEditDate`
(falling back to `lastEditDate`), Socrata `rowsUpdatedAt`. It is
refreshed on every successful read, and left unconfirmed when the
publisher says nothing.

**Facts that stay unconfirmed until someone states them:** `license`,
`cost` (what bulk or API access costs), `contact` (the published contact
for corrections), `updateFrequency` and `publisherUpdatedAt`. `resolve`
lists the empty ones as `unknowns`, and pages show them as *not
confirmed*. An empty value never reads as "free" or "open".

**Build readiness** is a judgment, set by a curator or the original
proposer like the rest of the metadata: `not-assessed` (the default),
`needs-preparation` or `ready`, with a `readinessNote` (what preparation
is needed, or what was tested) and a `reviewBy` date. It is separate
from access: a source can answer every request and still need its codes
decoded. Strangers' proposals never change it.

**Needs attention.** `lattice_sources_report` gains `needsAttention`:
listed sources that are failing or stale, whose field list changed at
the last check, or whose review is overdue. `GET /sources/health` is the
same as a markdown page, with a table of every listed source's access
status, last good read, readiness and unconfirmed facts. `health` is a
reserved slug.

This section adapts the approach of the
[New Haven Civic Data Directory](https://github.com/ctl0v0/new-haven-civic-data-directory):
access status kept apart from readiness, checked dates kept apart from
publisher dates, unknowns written as unknowns, and scheduled checks
whose failures stay visible.

## What builders found

The civic case studies (examples/civic-case-studies) showed that builders
learn the most useful facts about a source and had no way to record them:

- a field that is always empty;
- a latitude in State Plane feet;
- a default filter that hides 95% of records;
- a join that never matches.

Two ledger kinds carry these, with the same quarantine, corroboration and
curator rules as field mappings.

**Notes** (`lattice_note_source`, claim kind `source-note`):

| Topic | Claim key | Corroborates when |
|---|---|---|
| `field` | `source-note\|{slug}\|field\|{field}\|{assertion}` | another builder reports the same assertion on the same field, in any words |
| `disagreement` | `source-note\|{slug}\|disagreement\|{other}\|{field or all}` | another builder reports the same pair of sources disagreeing |
| `access`, `caveat` | `source-note\|{slug}\|{topic}\|{hash of the text}` | another builder `agree`s with the key |

- **Field assertions** come from a fixed list, so findings line up:
  `always-empty`, `mostly-empty`, `not-degrees`, `values-lag`,
  `personal-data`, `codes-unpublished`, `meaning-differs`, `other`.
- **Disputing:** `verdict: "wrong"` disputes a note.
- **Where they show:** listed notes appear in `resolve` as `notes` and on
  the page under "What builders found". Pending notes are in the sources
  report.
- **The structural route:** a field note the server's own profile confirms
  (`always-empty`, `mostly-empty`, `not-degrees`; see Field profiles) may
  list on anonymous corroboration, as a checked mapping can.

**Join reports** (`lattice_report_join`, claim kind `join-report`) say a
builder ran a join and how it went: `tried` and `matched` counts, never
records.
- **Methods:** `fields` (fieldsA[i] = fieldsB[i]), `point-in-polygon` or `nearest`.
- **Direction:** a match rate of 0.5 or more is a "works" claim; below that, a "fails" claim.
- **Key:** `join-report|{a}|{b}|{fields or method}`, with the sources in sorted order.
- **Offered joins:** each join the catalog offers gets `tested`:
  `{ status: works | fails | unconfirmed, reports, matchRate (median), tried }`,
  or `null` when nobody has run it. The page says "not yet tested by a builder".
- **New joins:** joins the catalog did not offer are listed as
  `builderJoins` ("Joins builders found"). This is how a join the catalog
  cannot infer (Legistar agenda items → matters by file number) reaches the
  next builder.
- **The structural route** applies when both sources' field lists were
  read from the publishers.

## Field profiles

The weekly check also profiles each ArcGIS and Socrata source, using
aggregates only. No record is fetched or kept.

- **What is read:**
  - the total row count;
  - per field, the filled rows (blank strings count as empty);
  - min/max of numbers.
- **Which fields:** up to 25 fields, mapped and location fields first.
  Blank-string counts for up to 10 text fields.
- **Cost:** at most a dozen small requests per source per week.
- **On request:** a check asked for by `lattice_check_source` re-profiles
  at most daily.
- **Where it shows:** the page's field table gains a Filled column.
  `resolve` adds `fieldWarnings`:
  - `always-empty`;
  - `mostly-empty`, under half filled;
  - `not-degrees`, a latitude/longitude field with values outside the range for degrees.
- **Health:** warnings on mapped fields join the health page's "needs
  attention" list.

A profile cannot see stale values (`values-lag`) or a changed meaning.
Those come from builders' notes.

## Query notes

A source's `queryNotes` say how it behaves when queried. Each is up to 300
characters, and the curator or the original proposer sets them, as with
other metadata:

| Key | Question |
|---|---|
| `defaults` | What a plain request returns, and what it leaves out |
| `allRecords` | How to get every record |
| `paging` | Page size limits and how to page |
| `filters` | Filters the API supports |
| `recordLink` | URL template for one record's public page |
| `lifecycle` | How records change: statuses, archiving, fields that empty out |
| `clients` | Clients the publisher refuses or throttles, and what works instead |

`propose_source` merges `queryNotes` into what is already there, and a
`null` clears a key. Builders who aren't the proposer add the same facts
as `access` notes.

## Place profiles

`lattice_place_profile` (and `GET /place?lat=&lng=&jurisdiction=`) answers
the questions a builder asks about one point:
- which ward, neighborhood or census tract;
- which watershed, and which assessed waterbody;
- whether it is in a flood zone or an environmental justice area;
- which zone, parcel or park.

It lists every listed polygon or line layer that covers the jurisdiction,
grouped by the concept its rows are. Each entry carries:
- a ready-to-run ArcGIS point query returning all attributes (an answer
  field such as canopy share is often unmapped). For areas: the feature
  containing the point, plus a `nearbyQuery` within the radius (250 m by
  default). For lines and point layers: features within the radius;
- what those fields mean;
- the publisher's last-change date;
- the access status, readiness note and builder notes.

The server fetches nothing; the builder runs the queries. An empty result
means nothing at that exact point, not nothing nearby. The re-run case
studies found that a riverbank point misses the river's assessment unit,
and that a coordinate 300 m off a park misses the park, so the profile
says so and offers the nearby query. A join report that needed a
`transform` gets its own key (`…|t:<hash>`), so exact and transformed
match rates are never averaged. Asked for by all three place-based environmental
case studies.

## Submit endpoints

A source's `direction` is `read` (the default) or `submit`: an endpoint that
takes records to the publisher, such as an Open311 `POST /requests`. This is
how a resident's report gets from an app to the city.
- **Recording one:** a submit endpoint is recorded like any source. Its
  fields are the request's fields, and they can be mapped onto concepts.
  So an app can line its records up with what the city accepts.
- **What the page says:** it warns that records sent there reach the
  publisher, and that they should carry only what the person agreed to
  share. It shows no example request.
- **How submitted records relate:** the publisher's per-type rules (Open311
  service definitions and their required attributes) are a read source of
  their own. They relate to the submit endpoint through the service code.

## Sensitive fields

Public data can identify people:
- SeeClickFix publishes reporter names;
- agenda titles carry testimony with home addresses;
- tax-relief orders name residents.

A source field's sensitivity is, highest rank first:
1. **stated** for the source (`fieldClassifications`, governance class slugs, set by the curator or proposer);
2. else **carried** by the concept field it maps onto, when that is not `public`;
3. else **reported** by builders' `personal-data` field notes.

`resolve` gives `classification` and `classifiedBy` on each field. The page
lists them under "Personal and sensitive fields" and points to
`governance/forwarding-consent` (specs/data-classification.md) for
recording a person's agreement before passing their data on.
`personal-location` was added for where a particular person was.

## Who can add what

| Caller | Source or mapping they submit |
|---|---|
| Operator, or an app at `contributor` tier | **curated**: listed and in use at once, attributed to them |
| Any other app key, or anonymous | **proposed**: a quarantined evidence claim, listed once corroborated |

Proposals are evidence-ledger claims with the ledger's sources, weights
and 7-day quarantine. After the quarantine, a claim is listed by either
route:

- **The ledger's usual route:** score ≥ 5 from ≥ 3 independent sources,
  at least one of them non-anonymous.
- **The structural route**, only for claims the server checked against a
  field list it read from the publisher itself: ≥ 3 independent sources
  from ≥ 2 different wider networks (/16 for IPv4, /32 for IPv6), with
  score ≥ 3. No key is needed, because hosted app builders have none.
  The wider-network rule stops one office or campus from clearing the
  bar alone. The burst freeze applies as it does everywhere.

A `manual` source, and any mapping onto one, takes neither route: it
needs a curator, because nothing about its field list could be checked.
This was decided on 2026-10-13, following builder contributions.
The reasoning: the worst case is one mislabelled field pair, which is
visible, disputable and never a permanent record.

Corroboration is per claim:

- `source|{slug}`: "this is a real public dataset, described correctly".
  Re-proposing the same `accessUrl` counts toward the existing slug.
- `field-mapping|{slug}|{sourceField}|{conceptUri}|{conceptField}`: one
  field pair. Independent builders who map the same CAMA table each
  corroborate every pair they agree on, and disagree only where they
  actually differ.

A mapping can be disputed with `verdict: "wrong"` on that pair. Opposition
counts 1.5×, as for match evidence, and it can retract curated pairs
too: curation sets a starting point, not a final answer.

## Mappings

```json
{
  "source": "ct-parcels-cama-2024",
  "conceptUri": "https://schemalattice.com/c/real-property/property-assessment@…",
  "role": "record",
  "fields": [
    { "from": "Assessed_Total", "to": "assessedTotal" },
    { "from": "Link", "to": "parcelId", "conversion": "town-unique; prefix the town to make it statewide" }
  ]
}
```

- `role`: `record` (each row *is* one of these) or `reference` (each
  row points at one of these: a sale row names a parcel by its address).
  A row can be more than one thing: a parcel layer whose rows carry the
  current assessment maps both Land Parcel and Property Assessment as
  `record`.
- **Checks:** the source exists and is not withdrawn; every `from` is in
  its field list exactly; every `to` is in the concept's structure (dot
  paths for nested fields); the concept resolves.
- `conversion` is free text, up to 200 characters: units, formats,
  code tables.

## Relationships

These are worked out from mappings when asked for, never stored, so
they follow corroboration and retraction automatically.

- **Sources for a concept:** `lattice_resolve` on a concept gains
  `publicSources`: listed sources that map onto it, with role,
  jurisdiction and how many of its fields are covered.
- **Related sources:** for a source, every other listed source that maps
  onto a concept it maps onto.
- **Join keys:** for two related sources, the pairs of their fields that
  map onto the same *identifying* concept field. A field identifies its
  concept when its name says so (`id`, `pin`, `geoid`, `…Id`, `…Key`,
  `…Number`, typed `reference`) or when a listed source maps it with
  role `reference`, i.e. uses it to point at the concept. Fields two sources
  merely share (a land-use code, an owner name) are not joins. Each join
  is labelled:
  - `key` for identifier fields, and for referenced `…Code` fields;
  - `spatial` when both sides are geometry (or both sources are spatial
    layers): an overlay, not an equality join;
  - `attribute` for other text fields: matching on it needs normalising
    (addresses, town names) and is weaker evidence of the same record.

  Numbers, dates and flags never join: two sales at the same price are
  not the same sale.

  An `attribute` join also needs one side's rows to point at the other's
  (role `reference`). Two sources whose rows are both records of a concept,
  sharing only a name, are two lists, not a join: wards and neighborhoods
  are both City Districts and never share a name.
- **Identifier schemes.** Mapping two sources' fields onto the same
  identifying concept field does not make their values comparable. The
  environmental case studies found three such false joins:
  - NOAA, USGS, AirNow and Water Quality Portal station codes, all mapped to Monitoring Site `siteId`;
  - iNaturalist taxon ids against GBIF taxon keys, both mapped to Taxon `taxonId`;
  - CT town numbers against census GEOIDs.

  A field pair may declare `scheme`: the numbering system its values come
  from, such as `gbif-backbone`, `inaturalist-taxon`, `census-geoid-2020`
  or `ct-town-code`. Then:
  - two pairs with different schemes never form a key join;
  - two pairs with the same scheme form a checked key join;
  - when the publishers differ and either pair has no scheme, the key join
    is offered as `unchecked`, ranked below attribute joins, with an
    instruction to compare a sample and report it.

  Join reports can say what `transform` the values needed before they
  matched (strip a URL prefix, reformat an ID). A raw comparison of the
  same fields would fail.
- **Shapes:** only a polygon (or area) layer receives points by point in
  polygon. A generic "geometry" field is not assumed to be one.
- **Versions:** joins treat every version of a concept as one, so a source
  mapped onto the new version still joins one that hasn't moved. Once a
  source is mapped onto a newer version, its pairs onto the older one stop
  showing. They stay in the ledger, for anyone still using the old URI.

  Two fields that make up one key together (`town` + `address`) are
  reported as one composite join.
- **Standards** are conformed to, not joined against. A standard's page
  lists the listed datasets whose `conformsTo` names it (`conformedBy`),
  and standards never appear in a dataset's join list. A standard's own
  fields can still be mapped onto concepts. That is what lets every
  dataset following it line up with the catalog.
- **Point locations.** A source's geometry comes from the platform
  (ArcGIS `geometryType`), a geometry-typed field, a latitude/longitude
  pair (`lat`/`lng`, `latitude`/`longitude`, `stop_lat`/`stop_lon`, at
  the same nesting level) or a GeoJSON point (`point.coordinates`).
  Most civic APIs (SeeClickFix, Open311, GBFS, CSV exports) carry
  location as two numbers. Without this they would relate to no map
  layer at all. `resolve` names the fields as `locationFields`, with a
  reminder to check they hold degrees. For ArcGIS layers the layer's own
  geometry is used instead: their lat/long columns can be in another
  coordinate system (New Haven's LCI lots store State Plane feet in `lat`).
- **Point in polygon:** a point layer against a polygon layer in the same
  area is a `spatial` join with `method: "point-in-polygon"`. It is listed
  as a related source, not an overlay, because "which ward is this report
  in" is the join most civic apps need. Two point layers don't relate:
  points relate only by distance, and every point layer in a city would
  otherwise list every other.
- **Overlays:** map layers that share no identifying field but cover the
  same area are listed once, as `overlays`, rather than as related
  sources. Every layer overlays every other, and listing each one
  separately buries the field joins.

## Tools

| Tool | Gate | Purpose |
|---|---|---|
| `lattice_find_sources` | read | Search sources by description, jurisdiction and/or concept. A source ranks by the better of its own description and the definitions of the concepts it maps onto (`matchedVia`). Logs the search (unless `ephemeral`); searches under 0.65 feed the sources report. |
| `lattice_resolve_source` | read | One source in full: metadata, fields with their concept meanings, concepts it carries, related sources and join keys, access status, recent checks, readiness and unconfirmed facts. |
| `lattice_propose_source` | evidence bucket | Add a source by its `accessUrl`. Curated or proposed per the table above. |
| `lattice_map_source` | evidence bucket | Map a source's fields onto a concept, or dispute a mapped pair. |
| `lattice_check_source` | read | Re-read a verified source's field list from the publisher and report drift. The result is recorded. |
| `lattice_note_source` | evidence bucket | Record a field fact, access behaviour, disagreement or caveat about a source, or agree with or dispute one. |
| `lattice_report_join` | evidence bucket | Report a join you ran between two sources: tried and matched counts. |
| `lattice_sources_report` | read | Proposed sources and mappings with corroboration progress, unmet source searches, fields that no mapping covers yet, and sources that need attention. |

`lattice_evidence_admin` gains `withdraw-source`. Existing `freeze`,
`retract` and `purge-source` work on source and mapping claims as they
do on match claims.

## Builder packs

`GET /sources` lists sources by jurisdiction as markdown, and `GET
/sources?jurisdiction=US-CT/new-haven` lists every source that covers a
place, its own first, then broader ones. Only a search (`q=`) is cut to
its best matches, and `GET
/sources/{slug}` is a paste-ready page for one dataset: what a record
is, what can be relied on, the endpoint and an example query, every
field with the concept field it carries, and the join keys to related
sources. `GET /sources/health` shows which sources still answer. This is the
"documentation for integrating a public database" a builder would
otherwise write by hand.

## How it grows

1. A builder searches `lattice_find_sources` for "New Haven building
   permits". A miss is logged; the sources report shows what people
   look for and can't find, by jurisdiction.
2. The builder finds the dataset on the city's portal and calls
   `lattice_propose_source` with its URL. The server reads the field
   list from the publisher.
3. Once it knows what the columns mean, the builder calls
   `lattice_map_source`. Each pair is a claim.
4. The next builder working with the same data corroborates or disputes
   the pairs as a side effect of their own work. Once enough independent
   builders agree, the pairs are listed, and relationships to every other
   source mapped onto the same concepts appear without anyone writing them.

## Privacy and abuse

| Threat | Mitigation |
|---|---|
| Private data | sources must be reachable without credentials; field lists only, never records; notes are capped and shown as untrusted |
| Server used to probe internal hosts | HTTPS only, public addresses enforced at connect time, no redirects, size and time caps, the evidence rate bucket |
| Malicious or junk URLs | proposals are not shown in search results until corroborated or curated; `withdraw-source` |
| Prompt injection in publisher text | field labels and descriptions are capped; every source response carries the untrusted-data notice |
| Forged mappings | fields checked on both sides; ledger corroboration rules; disputes weigh 1.5× |

## Open questions

- **Value-level maps.** Code tables (`Property Type: "Residential"` ↔
  `propertyClass: "residential"`) are the next layer. `conversion` text
  holds them for now.
- **Spatial joins** are reported, not computed: the catalog never fetches
  geometry.
