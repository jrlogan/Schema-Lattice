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
  slug: `US`, `US-CT`, `US-CT/new-haven`. A search for `US-CT` matches
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

  Two fields that make up one key together (`town` + `address`) are
  reported as one composite join.

## Tools

| Tool | Gate | Purpose |
|---|---|---|
| `lattice_find_sources` | read | Search sources by description, jurisdiction and/or concept. A source ranks by the better of its own description and the definitions of the concepts it maps onto (`matchedVia`). Logs the search (unless `ephemeral`); searches under 0.65 feed the sources report. |
| `lattice_resolve_source` | read | One source in full: metadata, fields with their concept meanings, concepts it carries, related sources and join keys. |
| `lattice_propose_source` | evidence bucket | Add a source by its `accessUrl`. Curated or proposed per the table above. |
| `lattice_map_source` | evidence bucket | Map a source's fields onto a concept, or dispute a mapped pair. |
| `lattice_check_source` | read | Re-read a verified source's field list from the publisher and report drift. |
| `lattice_sources_report` | read | Proposed sources and mappings with corroboration progress, unmet source searches, and fields that no mapping covers yet. |

`lattice_evidence_admin` gains `withdraw-source`. Existing `freeze`,
`retract` and `purge-source` work on source and mapping claims as they
do on match claims.

## Builder packs

`GET /sources` lists sources by jurisdiction as markdown, and `GET
/sources/{slug}` is a paste-ready page for one dataset: what a record
is, the endpoint and an example query, every field with the concept
field it carries, and the join keys to related sources. This is the
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
