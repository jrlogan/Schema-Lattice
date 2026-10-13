# New Haven public data survey

Surveyed 2026-10-13. Every endpoint and field list was checked live with
curl. Records were not copied, only metadata. The data is in
[`new-haven-survey.json`](new-haven-survey.json): 72 sources and 47
platforms. None of it is in the catalog yet. The 12 property sources
already listed (see [RESULTS.md](RESULTS.md)) are not repeated here.

## What exists

| Domain | Sources | Highlights |
|---|---|---|
| Land, environment, housing | 23 | address points, building footprints, parks, historic districts, brownfields and DEEP remediation cases, wetlands, storm surge, affordable housing (city BMR, CT DOH, HUD LIHTC and public housing), evictions by tract |
| Mobility and infrastructure | 22 | CTtransit GTFS and realtime (no key), Amtrak / Metro-North / Hartford Line GTFS, CTDOT roads, AADT, bridges, UConn crash repository (82k New Haven crashes), meters, bike routes, Veo GBFS, 32k street trees, NOAA tides, AirNow, USGS Quinnipiac water quality, impaired waters, spills |
| City operations and services | 27 | SeeClickFix 311 (API v2 and Open311), Legistar (Board of Alders), wards, police districts, neighborhoods, polling places, service sites, trash days, library events, state ledger, business registry, licenses, liquor permits, CDC PLACES, overdose deaths, school accountability, elections, ACS (key), FBI CDE (key) |

By platform: 35 ArcGIS layers and 17 Socrata datasets. The server reads
those field lists itself. There are also 4 GTFS feeds and 16 other APIs,
which need hand-supplied field lists or standards.

16 sources fit concepts already in the catalog. Some examples:

- SeeClickFix maps to Issue Report, Report Category and Report Update.
- Legistar maps to Legislative Matter, Public Meeting, Legislative Body
  and Elected Official.
- Wards, police districts and neighborhoods map to City District.
- Service centers map to Service Site.
- Planned development units map to Zoning District.
- Protected open space maps to Land Parcel.

## Where the city's data lives

- **City ArcGIS Enterprise** (`gis.newhavenct.gov`): 126 public hosted
  services. The Police, Purchasing, Utilities, Parks and Basemapping
  folders need a token.
- **City ArcGIS Online** (`services6.arcgis.com/AWSPcxcHO7OnZlnu`): about
  250 public services. Hub search returns nothing, but the REST directory
  lists them.
- **SeeClickFix:** public REST and Open311. The v2 API starts answering
  403 after a few quick calls; Open311 doesn't.
- **Legistar:** `webapi.legistar.com/v1/newhaven-ct`, public. It maps
  cleanly to Open Civic Data, but individual votes are not published.
- **OpenGov (permits, procurement):** the portals are live, with no
  public data.
- **Vision (assessor cards):** web pages only.
- **`newhavenct.gov`:** blocks every non-browser client (403), so budget
  documents and calendars can't be read by tools.
- **State and federal:** data.ct.gov, CT Geodata / OPM GIS, CT DEEP, CT
  ECO, CTDOT, UConn crash repository, HUD eGIS, NOAA, USGS, EPA,
  Water Quality Portal. Keys are required only for the Census API, FBI
  CDE, AFDC, the AirNow API and Metro-North realtime.

## The crosswalk builders need

The same place has many identifiers across these sources. Mapping each
one onto a concept field once is exactly what the catalog is for.

| Thing | Forms in the wild |
|---|---|
| New Haven (town) | `93` (CT tax code), `093` (padded; school districts start with it), `092` (CTDOT's own numbering, first three digits of local route IDs), `52070` (county subdivision FIPS, also HUD and bridges), `0900952070` and `0917052070` (full FIPS, old county and 2022 planning region), `0000000093` (state vendor ID), and the name |
| Census tract | `0900914xxxx` (2020 county: TIGER 2020, CAMA `FIPS`, evictions) versus `0917014xxxx` (planning region: CDC PLACES, ACS, current TIGER, DEEP environmental justice layer). The city parcel layer has just `1426.01`. LIHTC drops the leading zero |
| Parcel | Vision PID (city `parcel_id`, BMR `vision_pid`, parks, brownfields), MBLU `026 0903 00500` (city, BMR, LCI), statewide `52070-<pid>` (CAMA link) |
| Union Station | `NHV` (Amtrak), `149` (Metro-North), `1` (Hartford Line). Match by coordinates |
| Police | agency ID `CT0009300` (traffic stops and FBI) |
| Monitoring sites | EPA `090090027`, USGS `01196573`, NOAA `8465705` |

## What the city does not publish openly

Data people will ask for that isn't open:

- Building permits.
- Code enforcement, blight and rental inspections. The open rental
  license fields stop in 2022.
- Police incidents and dispatch, and individual alder votes.
- The city budget, checkbook and payroll.
- Bids, restaurant inspections and 211 listings.
- Sewer overflows, and parking garage occupancy.

These are worth raising with the city. The catalog's unmet searches
will show which of them builders actually look for.

## Proposed next rounds

1. **Fits today (no new concepts):** list the 16 sources that map onto
   existing concepts. Sources and mappings are editable register entries,
   so this round can go ahead without a permanence decision.
2. **Standards as sources:** GTFS, GTFS-realtime, GBFS, Open311, MMUCC,
   NBI, WQX/ATTAINS, OGC SensorThings. Each gets a `kind: "standard"`
   record, so datasets can declare `conformsTo` and concepts can be mined
   from the standards rather than from one city's export.
3. **New concepts, mined from those standards and these schemas.** These
   are permanent, so each one needs review:
   - **Transit:** Transit Stop, Route, Trip, Stop Time and Vehicle
     Position, all from GTFS.
   - **Traffic safety:** Crash, from MMUCC.
   - **Environmental observation:** Monitoring Site and Observation,
     from SensorThings and WQX.
   - **Housing and land:** Affordable Housing Property, Contaminated
     Site, Address Point, Historic District.
   - **Civic:** Polling Place, School, Election Contest Result, and Area
     Statistic. Area Statistic is one generic "indicator for a
     geography and period" concept that would cover CDC PLACES,
     evictions, caseloads and overdose counts, instead of separate
     concepts for each.
