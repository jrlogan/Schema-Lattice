# City-app coverage map (for a New Haven deployment)

State of the catalog after the civic pilot plus three standards rounds
(2026-08-29): **66 concepts, 10 contexts**, every one mined from a real
open-source app or published standard with attribution — never invented.

| City-app domain | Context | Mined from | Depth |
|---|---|---|---|
| 311 / issue reporting | `civic-issue-reporting` | FixMyStreet | ●●● |
| Public-records / FOI | `public-records-requests` | Alaveteli | ●●● |
| Participation & budgeting | `civic-participation` | Consul Democracy | ●●● |
| Open data portal | `open-data-catalog` | CKAN (DCAT-aligned) | ●●● |
| Human services directory | `human-services` | HSDS / Open Referral | ●●● |
| Permits & inspections | `civic-permitting` | BLDS (permitdata.org) | ●● |
| Council & legislation | `civic-legislation` | Open Civic Data (Popolo) | ●● |
| Procurement & contracts | `public-procurement` | OCDS | ●● |

Verified effect: the permit-tracker probe that scored distant/no-match
before the standards rounds now gets `Building Permit @ 0.701` and
`Site Inspection @ 0.686` (fork band). A ten-domain New Haven probe
finds the semantically correct top concept in every domain.

## Cross-domain spine

The shared concepts a city app almost always needs are connected, not
duplicated:

- **Government body lineage**: Civic Body → Public Authority →
  Data Publisher / Legislative Body (validated changesets).
- **Account lineage**: Resident Account → Requester / Portal /
  Verified Resident.
- **Places**: City District, Land Parcel, Service Site — all under the
  skeleton `location`.
- **coRefersWith pairs**: Service Provider ↔ Public Authority;
  Government Supplier ↔ Service Provider (the same real-world org seen
  from different systems).

## Rules for continuing to populate

1. **Mine, don't brainstorm.** Every concept must trace to a real
   schema, spec, or a demand-report cluster. Fabricated sourcing is a
   protocol violation (DECISIONS.md, JIT mining).
2. **Stop when discover starts answering.** The signal for "enough
   prepopulation" in a domain is surveys landing in the fork band. The
   five app domains are there; permits/legislation/procurement are
   close. Beyond that, let real projects drive.
3. **Keep New Haven specifics out of the central catalog.** Ward maps,
   department names, local status vocabularies belong to the deployment
   — eventually an M3 shard — not to `civic-*` contexts, which stay
   usable by any city. New Haven's actual apps go in the **registry**
   (`lattice_register_app`, unit = the city department), which is also
   what makes the portfolio/overlap reports useful to the city.
4. **Candidate next rounds, only when a real project needs them**:
   GTFS (transit), LIHTC/housing, assessor/CAMA data, election results
   (OCD has models), public-safety incident standards (NIBRS).
