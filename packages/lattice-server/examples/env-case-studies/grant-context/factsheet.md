# Mill River Trail: Grant Context Pack (queried 2026-10-29)

Points: **A** Fair Haven 41.3095,-72.9035 · **B** given "Criscuolo Park" point 41.2985,-72.9010.
Point B is about 300 m south of the park polygon (bbox 41.3009-41.3036, -72.9047 to -72.9023, City of New Haven Comprehensive Parks). Park-level facts use the polygon.

| Question | A: Fair Haven | B: Criscuolo Park | Source · currency |
|---|---|---|---|
| EJ block group | Yes. BG 09-170-1424-004, 52.2% below 200% FPL | Yes. BG 09-170-1427-004, 42.5% below 200% FPL | CT DEEP EJ Block Groups 2025 (FeatureServer/0). 2024 ACS 5-yr; layer edited 2026-02-04 |
| EJ distressed municipality | New Haven listed, GRACE_PERIOD=Yes | same | CT DEEP EJ Distressed Municipalities 2025 (FeatureServer/1), edited 2026-02-04 |
| Census tract | 1424 (GEOID 09009142400, pop. 5,916) | 1427 (09009142700, pop. 6,743) | Census TIGERweb 2020 tracts (MapServer/10). 2020 vintage |
| HUC12 | 011000040301 Mill River | 011000040105 Outlet Quinnipiac River | USGS WBD (MapServer/6), loaddate 2024-08-15 |
| Assessed waterbody | CT-C1_023-SB "Mill River (mouth)": Cat. 5, impaired; causes oxygen depletion, pathogens; no TMDL | CT-C1_013-SB New Haven Harbor (Cat. 5; nutrients, oil and grease, O2 depletion, pathogens, PCBs; has TMDL) and CT-C1_014-SB Quinnipiac R. mouth (Cat. 5, same causes, no TMDL) | EPA ATTAINS Areas layer (MapServer/2), 2024 cycle, EPA final action |
| Flood hazard | Point: Zone X (minimal). 200 m circle: 27% Zone AE (BFE 12 ft NAVD88) | Park polygon: 100% SFHA (99.2% AE BFE 12 ft, 0.7% VE BFE 16 ft) | FEMA NFHL (MapServer/28), FIRM 09009C, panel 09009C0442J effective 2013-07-08; grid-sampled (60x60) |
| Protected open space | Not in the state layer; no city park within 150 m | Criscuolo Park: municipal, Parks-managed, public (city layer). Not in the state "Protected Open Space" layer | CT Protected Open Space Parcels (edited 2026-10-06); NH Comprehensive Parks (edited 2026-07-31) |
| Land cover | Town of New Haven 2023: 72.5% developed, 44.6% impervious, 13.9% turf, 8.8% forest (8.95% in 1985) | same (town level only) | UConn CLEAR land cover by town 1985-2023 |
| Tree canopy | Not available from the catalog at point or block-group level | | gap |

EJ test (my reading; check DEEP guidance): a CT EJ community is a block group with at least 30% of people below 200% FPL, or a distressed municipality. Both block groups pass the first test. The 30% threshold is not on the catalog page.

## Volunteer value (2026 season, invented figures)
14 workdays, 212 registrations, 640 hours. Connecticut 2025 rate is $39.67/hr, giving **$25,388.80**. The national rate is $36.14, giving $23,129.60.
Source: Independent Sector / Do Good Institute, "Value of Volunteer Time", announced 2026-04-21 (state xlsx). **Not in the catalog.**

## Grant opportunities (Funding Opportunity concept, grantmaking context)
See grants.json. Both are from Grants.gov search2 and fetchOpportunity, read 2026-10-29.
