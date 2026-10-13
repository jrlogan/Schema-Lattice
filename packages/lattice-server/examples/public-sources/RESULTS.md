# Property-data pilot: Connecticut and New Haven

Run with `npm run demo:property-data` (a throwaway local instance; the
one live concept it builds on is mirrored from schemalattice.com with
its hash checked, and every field list is read from the real publisher).
Design: `specs/public-sources.md`. Run 2026-10-13.

## The question

Can the catalog act as documentation for public data? A builder working
with New Haven property data should be able to ask what exists, get
the endpoint and what every column means, and learn how the datasets
join, without redoing the research.

## Before

Discover against the catalog, for each concept the pilot needed:

| Concept | Verdict | Top result |
|---|---|---|
| Land Parcel (assessor's view) | fork | Land Parcel, BLDS (0.685) |
| Property Assessment | distant | Land Parcel (0.625) |
| Building | fork | Land Parcel (0.669) |
| Property Sale | distant | Asset (0.638) |
| Zoning District | distant | Land Parcel (0.580) |
| Flood Hazard Area | no-match | Land Parcel (0.507) |
| Property Tax Rate | distant | Land Parcel (0.575) |
| Municipality | fork* | Land Parcel (0.667) |
| Census Tract | distant | Land Parcel (0.601) |

\*Topical, not structural: a municipality is not a fork of a parcel (the
trail pilot's finding 5 again).

There were no sources at all.

## What was added

- **9 concepts**, every field taken from a published schema. Land Parcel
  is a fork of BLDS's Land Parcel that adds the assessor's keys, land use,
  zoning, area, boundary and owner of record (owner fields classified
  `personal-identity` / `personal-contact`). Property Assessment,
  Building, Property Sale, Zoning District, Flood Hazard Area and
  Property Tax Rate are in a new `real-property` context. Municipality
  and Census Tract are in a new `public-geography` context.
- **12 sources**, 11 with field lists read from the publisher:

  | Source | Jurisdiction | Fields |
  |---|---|---|
  | CT CAMA and Parcel Layer (ArcGIS) | US-CT | 62 |
  | CT CAMA 2026, tabular (Socrata) | US-CT | 137 |
  | CT Real Estate Sales 2001-2024 | US-CT | 14 |
  | CT Mill Rates FY2014-2027 | US-CT | 9 |
  | CT Annual Housing Permits by Town | US-CT | 38 |
  | FEMA NFHL Flood Hazard Zones | US | 24 |
  | Census TIGERweb 2020 Tracts | US | 21 |
  | New Haven Parcels (Authoritative) | US-CT/new-haven | 76 |
  | New Haven Zoning Districts | US-CT/new-haven | 9 |
  | New Haven Inclusionary Zoning Overlay | US-CT/new-haven | 4 |
  | New Haven LCI Managed Lots | US-CT/new-haven | 19 |
  | New Haven Assessor Cards (Vision) | US-CT/new-haven | 1, hand-supplied: a web app, no API |

- **158 field pairs** across 32 source-to-concept mappings. Fields
  whose meaning wasn't certain were left unmapped (e.g. New Haven's
  `total_assessed_parcel_value_x` versus `_y`).

## A builder asks

`lattice_find_sources` with `jurisdiction: "US-CT/new-haven"`. Statewide
and national sources are included because they cover the city:

| Search | Met | Top two |
|---|---|---|
| home sale prices | yes | CT sales 0.664, CT CAMA 0.586 |
| assessed value of houses | yes | CT CAMA 0.709, CT parcel layer 0.709 |
| is this property in a flood zone | yes | FEMA NFHL 0.690, inclusionary overlay 0.563 |
| zoning of a parcel | yes | NH parcels 0.702, inclusionary overlay 0.699 |
| property tax mill rate | yes | CT mill rates 0.809 |
| parcel boundaries and owners | yes | CT CAMA 0.719, CT parcel layer 0.719 |
| population by census tract | yes | TIGER tracts 0.799 |
| building permits issued | yes | CT housing permits by town 0.657 (town totals only) |
| blight and code enforcement cases | **no** | nothing above 0.49, logged as unmet demand |

Ranking first used each source's own text, and three of these searches
missed. FEMA's layer didn't come up for the flood question, because
publisher titles are terse and field names cryptic (`FLD_ZONE`,
`SFHA_TF`). Ranking now uses the better of the source's description and
the definitions of the concepts it maps onto, which fixed all three.

## How the sources join

For the New Haven parcel layer, worked out from the mappings alone:

| Related source | Join | Fields |
|---|---|---|
| CT CAMA 2026 (tabular) | key, via Land Parcel | `parcel_id`=`pid`, `account_number`=`account_number`; confirm with address + city |
| CT parcel layer | key, via Land Parcel | `parcel_id`=`Parcel_ID`; confirm with address + town |
| Assessor cards | key, via Land Parcel | `parcel_id`=`pid` (the card URL's parameter) |
| NH zoning | key, via Zoning District | `zone`=`zone_code`; also overlay |
| CT mill rates | key, via Municipality | `town_id`=`town_code` |
| CT CAMA 2026 | key, via Municipality | `town_id`=`town_id` |
| Census tracts 2020 | key, via Census Tract | `census_tract`=`BASENAME`; also overlay |
| LCI managed lots | key, via Land Parcel | `mblu`=`mbp`; confirm with address; also overlay |
| CT real estate sales | attribute, via Land Parcel | address + town, normalised (the sales file has no parcel ID); also overlay (geocoded points) |
| FEMA flood zones, inclusionary overlay | spatial | overlay only: no shared field |

The research for this pilot also checked these joins by hand, against
real New Haven parcels, before any mapping existed. Parcel 6081 has
the same ID in the city layer, the state table and the assessor card.
Sales match CAMA only on town + address. Flood zones relate only by
overlay. Every join derived from the mappings agrees with those checks.

Two design corrections came out of this table:

1. **Sharing a field is not a join.** The first version paired every
   concept field two sources both mapped, so it offered `price` =
   `saleamount` and matching owner names as joins. Now only identifying
   fields join. Those are fields named like identifiers, plus fields a
   source uses to point at a concept (role `reference`). That is how
   address + town become the sales file's way of naming a parcel.
   Numbers, dates and flags never join.
2. **Codes identify only when something points at them.** `zoneCode` on
   Zoning District is a key, because parcel layers reference it.
   `landUseCode` on Land Parcel is not a key, since nothing points at a
   parcel by its land use.

## Gaps this surfaced

- **No open New Haven permit, blight or code-enforcement data.** The
  city's OpenGov permit portal has no public API, and the new LCI portal
  didn't resolve. These searches are logged as unmet demand, which is
  the honest answer, and that log is what to bring to the city.
- **The sales file has no parcel ID**, so the address join will miss
  sometimes. CAMA keeps only the last two sales, which makes the sales
  file the real history.
- **Census tract codes changed.** CAMA's `FIPS` uses 2020 tract IDs with
  the old county code (`09009…`). Current Census layers use planning-region
  codes (`09170…`). The mapping's conversion note says so. The 2020
  layer was chosen because it matches CAMA.
- **Licenses.** The CT parcel layer is CC0, and sales, mill rates and
  permits are public domain. The 2026 CAMA table states none. The city
  layers carry use terms ("not a survey") but no named open license.
- **Owner names and mailing addresses** are in three of the sources.
  They are public record, but personal. The concept fields carry
  personal classifications, so a builder's sensitivity profile shows
  them.

## Next

- **Anonymous corroboration.** Hosted builders have no keys. Under the
  evidence ledger's rules (one non-anonymous source required), their
  proposals never list on their own. A publisher-verified field list may
  justify the structural route builder contributions took. This is
  the spec's open question, and it needs a decision.
- **Value-level maps.** Flood zone codes, land-use codes and the sales
  file's non-use codes are code tables. `conversion` text holds them
  for now.
- **A builder test.** Have an agent write a New Haven "what do I know
  about this address" page twice: once from the portals alone, and once
  from `/sources/new-haven-parcels`. Then compare.
