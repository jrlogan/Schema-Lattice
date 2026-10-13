// Seed data for the property-data pilot (examples/public-sources/RESULTS.md).
//
// Everything here is mined from published schemas, never invented: each
// concept's fields come from the field lists of the sources below, read from
// the publishers' own metadata APIs on 2026-10-13. Sources describe where the
// data is; mappings say which source field carries which concept field. The
// runner (property-data.ts) feeds this to a lattice instance through the tools.

/** The live parent the parcel concept forks: BLDS's Land Parcel. */
export const PARENT_LAND_PARCEL = "https://schemalattice.com/c/civic-permitting/land-parcel@f923e1544907";

export const CONTEXTS = [
  {
    slug: "real-property",
    title: "Real property",
    definition:
      "Land and what stands on it as public records describe it: parcels, their assessed valuations and " +
      "recorded sales, the buildings on them, and the zoning, flood hazard and tax-rate designations that " +
      "attach to land. Mined from assessor (CAMA) exports, land-records sales files, municipal GIS layers " +
      "and federal flood maps.",
  },
  {
    slug: "public-geography",
    title: "Public geography",
    definition:
      "Administrative and statistical areas that public datasets are published by and joined on: " +
      "municipalities and the census areas a national statistics office tabulates within them.",
  },
] as const;

type Field = {
  name: string;
  type: string;
  unit?: string;
  classification?: string;
  description?: string;
};

const pub = (name: string, type: string, extra: Omit<Field, "name" | "type"> = {}): Field => ({
  name, type, classification: "public", ...extra,
});

const attribution = (importedFrom: string, notes: string) => ({
  importedFrom,
  authoredBy: ["SchemaLattice property-data pilot"],
  sourceNotes: notes,
});

/** Land Parcel, forked from BLDS's: the assessor's view adds keys, use, zoning, area and owner of record. */
export const LAND_PARCEL_FORK = {
  conceptSlug: "land-parcel",
  prefLabel: "Land Parcel",
  altLabels: ["tax parcel", "assessor parcel", "lot"],
  definition:
    "A piece of land as an assessor's office records it: identified within its town and, where a statewide " +
    "key exists, across the state, with its address, land use, zoning, area, boundary and the owner of " +
    "record a tax bill goes to.",
  structure: {
    kind: "entity",
    fields: [
      pub("pin", "string", { description: "The parcel's identifier in its town's assessor system; unique only within the town" }),
      pub("address", "string"),
      pub("city", "string", { description: "The town or city the parcel is in" }),
      pub("state", "string"),
      pub("zip", "string"),
      pub("parcelKey", "string", { description: "An identifier unique across the publishing jurisdiction, e.g. a town code plus the local parcel ID" }),
      pub("accountNumber", "string", { description: "The assessor's account number for the tax bill" }),
      pub("mapBlockLot", "string", { description: "Map, block, lot (and unit) on the assessor's maps" }),
      pub("condoUnit", "string"),
      pub("landUseCode", "string"),
      pub("landUseDescription", "string"),
      pub("zoneCode", "string", { description: "The zoning district the parcel is in, by code" }),
      pub("landAcres", "number", { unit: "acres" }),
      { name: "ownerName", type: "string", classification: "personal-identity", description: "Owner of record; public record, but a person's name" },
      { name: "mailingAddress", type: "string", classification: "personal-contact", description: "Where the tax bill is mailed" },
      pub("geometry", "geometry", { description: "Parcel boundary polygon" }),
    ],
  },
  changeset: {
    ops: [
      { op: "add", field: "parcelKey", type: "string", required: false },
      { op: "add", field: "accountNumber", type: "string", required: false },
      { op: "add", field: "mapBlockLot", type: "string", required: false },
      { op: "add", field: "condoUnit", type: "string", required: false },
      { op: "add", field: "landUseCode", type: "string", required: false },
      { op: "add", field: "landUseDescription", type: "string", required: false },
      { op: "add", field: "zoneCode", type: "string", required: false },
      { op: "add", field: "landAcres", type: "number", required: false },
      { op: "add", field: "ownerName", type: "string", required: false },
      { op: "add", field: "mailingAddress", type: "string", required: false },
      { op: "add", field: "geometry", type: "geometry", required: false },
    ],
    note:
      "Assessor (CAMA) parcel records as Connecticut's statewide parcel layer and New Haven's parcel layer publish them. " +
      "pin stays the town-local ID; parcelKey carries a statewide key such as CT's CAMA link.",
  },
  sourceAttribution: attribution(
    "https://geodata.ct.gov/datasets/ctgisoffice::connecticut-cama-and-parcel-layer",
    "Fields from the CT CAMA and Parcel Layer (2026) and the City of New Haven parcel layer.",
  ),
};

export interface ConceptSeed {
  context: (typeof CONTEXTS)[number]["slug"];
  conceptSlug: string;
  prefLabel: string;
  altLabels?: string[];
  definition: string;
  conceptKind: string;
  broaderRoot: string;
  closeMatch?: string[];
  broadMatch?: string[];
  structure: { kind: string; fields: Field[] };
  sourceAttribution: ReturnType<typeof attribution>;
}

const CAMA_LAYER = "https://geodata.ct.gov/datasets/ctgisoffice::connecticut-cama-and-parcel-layer";
const CAMA_TABLE = "https://data.ct.gov/d/ibe8-9i3q";

export const CONCEPTS: ConceptSeed[] = [
  {
    context: "real-property",
    conceptSlug: "property-assessment",
    prefLabel: "Property Assessment",
    altLabels: ["assessed value", "grand list entry", "valuation"],
    definition:
      "An assessor's valuation of one parcel for one tax year: the appraised market value of its land, " +
      "buildings and other improvements, the assessed value taxes are levied on, and the year the valuation " +
      "was last set by revaluation.",
    conceptKind: "measurement",
    broaderRoot: "record",
    closeMatch: ["wd:Q1435947"],
    structure: {
      kind: "entity",
      fields: [
        pub("valuationYear", "integer", { description: "Year of the revaluation the values come from" }),
        pub("assessedLand", "number", { unit: "USD" }),
        pub("assessedBuilding", "number", { unit: "USD" }),
        pub("assessedOutbuilding", "number", { unit: "USD" }),
        pub("assessedExtraFeatures", "number", { unit: "USD" }),
        pub("assessedTotal", "number", { unit: "USD", description: "The value the mill rate is applied to" }),
        pub("priorAssessedTotal", "number", { unit: "USD" }),
        pub("appraisedLand", "number", { unit: "USD" }),
        pub("appraisedBuilding", "number", { unit: "USD" }),
        pub("appraisedOutbuilding", "number", { unit: "USD" }),
        pub("appraisedExtraFeatures", "number", { unit: "USD" }),
        pub("appraisedTotal", "number", { unit: "USD", description: "Estimated market value" }),
      ],
    },
    sourceAttribution: attribution(CAMA_TABLE, "Fields from the CT CAMA 2026 table and parcel layer."),
  },
  {
    context: "real-property",
    conceptSlug: "building",
    prefLabel: "Building",
    altLabels: ["structure", "dwelling"],
    definition:
      "A permanent structure standing on a land parcel as an assessor describes it: when it was built, its " +
      "floor area, rooms and baths, its style, heating and condition, and how many dwelling units it holds.",
    conceptKind: "entity",
    broaderRoot: "physical-object",
    closeMatch: ["wd:Q41176"],
    structure: {
      kind: "entity",
      fields: [
        pub("yearBuilt", "integer"),
        pub("effectiveYearBuilt", "integer", { description: "Year the building's condition corresponds to, after renovations" }),
        pub("livingArea", "number", { unit: "sq ft" }),
        pub("effectiveArea", "number", { unit: "sq ft" }),
        pub("grossArea", "number", { unit: "sq ft" }),
        pub("stories", "string"),
        pub("totalRooms", "number"),
        pub("bedrooms", "number"),
        pub("fullBaths", "number"),
        pub("halfBaths", "number"),
        pub("style", "string"),
        pub("condition", "string"),
        pub("heatType", "string"),
        pub("heatFuel", "string"),
        pub("units", "number", { description: "Dwelling units in the building" }),
      ],
    },
    sourceAttribution: attribution(CAMA_TABLE, "Building characteristic fields from the CT CAMA 2026 table."),
  },
  {
    context: "real-property",
    conceptSlug: "property-sale",
    prefLabel: "Property Sale",
    altLabels: ["real estate sale", "deed transfer", "conveyance"],
    definition:
      "A recorded transfer of real property from one owner to another: when the deed was recorded, the price " +
      "paid, the assessed value at the time, and whether the assessor counts it as an arm's-length sale " +
      "usable for valuation.",
    conceptKind: "event",
    broaderRoot: "transaction",
    closeMatch: ["wd:Q7301151"],
    structure: {
      kind: "entity",
      fields: [
        pub("serialNumber", "string"),
        pub("listYear", "integer", { description: "Grand list year the sale is counted in" }),
        pub("recordedDate", "date"),
        pub("saleDate", "date"),
        pub("salePrice", "number", { unit: "USD" }),
        pub("assessedValueAtSale", "number", { unit: "USD" }),
        pub("salesRatio", "number", { description: "Assessed value divided by sale price" }),
        pub("propertyType", "string"),
        pub("residentialType", "string"),
        pub("nonUseCode", "string", { description: "Why a sale is excluded from valuation studies; empty for arm's-length sales" }),
        pub("qualified", "string", { description: "The assessor's arm's-length flag" }),
        pub("deedBookPage", "string"),
        pub("instrument", "string", { description: "Kind of deed" }),
        { name: "grantor", type: "string", classification: "personal-identity" },
        { name: "grantee", type: "string", classification: "personal-identity" },
      ],
    },
    sourceAttribution: attribution("https://data.ct.gov/d/5mzw-sjtu", "Fields from CT Real Estate Sales 2001-2024 and the CT CAMA 2026 sale columns."),
  },
  {
    context: "real-property",
    conceptSlug: "zoning-district",
    prefLabel: "Zoning District",
    altLabels: ["zone", "zoning overlay"],
    definition:
      "An area to which a municipality's zoning ordinance applies one set of land-use and building rules, " +
      "named by its zone code, including overlay districts that add rules on top of the base district.",
    conceptKind: "place",
    broaderRoot: "location",
    broadMatch: ["wd:Q702232"],
    structure: {
      kind: "entity",
      fields: [
        pub("zoneCode", "string"),
        pub("name", "string"),
        pub("districtFamily", "string", { description: "e.g. residence, business, industrial" }),
        pub("category", "string"),
        pub("isOverlay", "boolean"),
        pub("geometry", "geometry"),
      ],
    },
    sourceAttribution: attribution("https://gis.newhavenct.gov/arcgis/home/item.html?id=5a0e75ed78d64eb5a8c75313830c5b9e", "Fields from New Haven's zoning and inclusionary zoning overlay layers."),
  },
  {
    context: "real-property",
    conceptSlug: "flood-hazard-area",
    prefLabel: "Flood Hazard Area",
    altLabels: ["flood zone", "special flood hazard area", "FIRM zone"],
    definition:
      "An area on an effective flood insurance rate map carrying one flood zone designation, saying whether it " +
      "lies inside the regulatory one-percent annual chance floodplain, where flood insurance is mandatory for " +
      "federally backed mortgages, and, where determined, its base flood elevation.",
    conceptKind: "place",
    broaderRoot: "location",
    closeMatch: ["wd:Q2364755"],
    broadMatch: ["wd:Q193110"],
    structure: {
      kind: "entity",
      fields: [
        pub("floodZone", "string", { description: "A, AE, AH, AO, VE, X, D, ..." }),
        pub("zoneSubtype", "string"),
        pub("specialFloodHazardArea", "boolean"),
        pub("baseFloodElevation", "number"),
        pub("verticalDatum", "string"),
        pub("depth", "number"),
        pub("velocity", "number"),
        pub("lengthUnit", "string"),
        pub("firmId", "string", { description: "The flood map study the area comes from" }),
        pub("areaId", "string"),
        pub("sourceCitation", "string"),
        pub("geometry", "geometry"),
      ],
    },
    sourceAttribution: attribution("https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28", "Fields from FEMA's National Flood Hazard Layer, S_FLD_HAZ_AR."),
  },
  {
    context: "real-property",
    conceptSlug: "property-tax-rate",
    prefLabel: "Property Tax Rate",
    altLabels: ["mill rate", "tax rate"],
    definition:
      "The rate a municipality or special taxing district levies on assessed property value for one fiscal " +
      "year, in mills (dollars per thousand dollars of assessment), sometimes with separate rates for real and " +
      "personal property and for motor vehicles.",
    conceptKind: "measurement",
    broaderRoot: "quantity",
    broadMatch: ["wd:Q607695"],
    structure: {
      kind: "entity",
      fields: [
        pub("grandListYear", "integer"),
        pub("fiscalYear", "integer"),
        pub("millRate", "number", { unit: "mills" }),
        pub("realPersonalRate", "number", { unit: "mills" }),
        pub("motorVehicleRate", "number", { unit: "mills" }),
        pub("otherRate", "string"),
        pub("taxDistrictCode", "string", { description: "A special taxing district within the municipality, when the rate is that district's" }),
        pub("taxDistrictName", "string"),
      ],
    },
    sourceAttribution: attribution("https://data.ct.gov/d/emyx-j53e", "Fields from CT Mill Rates FY2014-2027."),
  },
  {
    context: "public-geography",
    conceptSlug: "municipality",
    prefLabel: "Municipality",
    altLabels: ["town", "city", "local government area"],
    definition:
      "A city or town as a unit of local government with its own territory, known by its name and by the codes " +
      "that state and federal statistical agencies assign it; the area most public property data is published by.",
    conceptKind: "place",
    broaderRoot: "location",
    closeMatch: ["wd:Q15284"],
    structure: {
      kind: "entity",
      fields: [
        pub("name", "string"),
        pub("localCode", "string", { description: "The state's own number for it, e.g. a Connecticut town code (New Haven is 93)" }),
        pub("fipsCode", "string", { description: "Federal county-subdivision code" }),
        pub("state", "string"),
        pub("county", "string"),
        pub("geometry", "geometry"),
      ],
    },
    sourceAttribution: attribution("https://data.ct.gov/d/emyx-j53e", "Town fields across CT CAMA, sales, mill-rate and permit datasets."),
  },
  {
    context: "public-geography",
    conceptSlug: "census-tract",
    prefLabel: "Census Tract",
    definition:
      "A small, relatively permanent statistical subdivision of a county that a national census tabulates " +
      "population and housing for, identified by a code that is unique within its state and county.",
    conceptKind: "place",
    broaderRoot: "location",
    closeMatch: ["wd:Q107738887"],
    structure: {
      kind: "entity",
      fields: [
        pub("geoid", "string", { description: "State + county + tract code, e.g. 09009142601" }),
        pub("tractNumber", "string", { description: "The tract's number within its county, e.g. 1426.01" }),
        pub("stateFips", "string"),
        pub("countyFips", "string"),
        pub("name", "string"),
        pub("landAreaSqM", "number", { unit: "m2" }),
        pub("waterAreaSqM", "number", { unit: "m2" }),
        pub("housingUnits", "integer"),
        pub("population", "integer"),
        pub("geometry", "geometry"),
      ],
    },
    sourceAttribution: attribution("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10", "Fields from Census TIGERweb 2020 tracts."),
  },
];

// --- sources ---------------------------------------------------------------------

export interface SourceSeed {
  slug: string;
  accessUrl: string;
  title: string;
  publisher: string;
  jurisdiction: string;
  recordDescription: string;
  landingPage?: string;
  license?: string;
  updateFrequency?: string;
  platform?: "manual";
  fields?: Array<{ name: string; type: string; label?: string; description?: string }>;
  note?: string;
}

export const SOURCES: SourceSeed[] = [
  {
    slug: "ct-parcels-cama",
    accessUrl: "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0",
    title: "Connecticut CAMA and Parcel Layer",
    publisher: "Connecticut GIS Office (Office of Policy and Management)",
    jurisdiction: "US-CT",
    recordDescription:
      "One parcel (or condo unit) polygon in Connecticut joined to its assessor record: location, owner, assessed and appraised values, zone, land use, main building and last sale.",
    landingPage: CAMA_LAYER,
    license: "CC0",
    updateFrequency: "annual collection; this service holds the current year (2026)",
  },
  {
    slug: "ct-cama-2026",
    accessUrl: "https://data.ct.gov/resource/ibe8-9i3q.json",
    title: "Connecticut CAMA 2026 (tabular)",
    publisher: "Connecticut Office of Policy and Management",
    jurisdiction: "US-CT",
    recordDescription:
      "One assessor account (parcel or condo unit) in Connecticut for the 2026 collection, with the full CAMA attribute set and no geometry.",
    landingPage: CAMA_TABLE,
    license: "not stated",
    updateFrequency: "one dataset per collection year (2025: rny9-6ak2, 2024: pqrn-qghw)",
  },
  {
    slug: "ct-real-estate-sales",
    accessUrl: "https://data.ct.gov/resource/5mzw-sjtu.json",
    title: "Connecticut Real Estate Sales 2001-2024",
    publisher: "Connecticut Office of Policy and Management",
    jurisdiction: "US-CT",
    recordDescription:
      "One real estate sale of $2,000 or more recorded by a Connecticut town assessor, with list year, recording date, address, assessed value, sale amount and property type.",
    license: "Public Domain",
    updateFrequency: "annual",
  },
  {
    slug: "ct-mill-rates",
    accessUrl: "https://data.ct.gov/resource/emyx-j53e.json",
    title: "Connecticut Mill Rates FY2014-2027",
    publisher: "Connecticut Office of Policy and Management",
    jurisdiction: "US-CT",
    recordDescription:
      "One mill rate for a Connecticut municipality or special taxing district for one fiscal year, with separate real and personal property and motor vehicle rates.",
    license: "Public Domain",
    updateFrequency: "annual",
  },
  {
    slug: "ct-housing-permits-by-town",
    accessUrl: "https://data.ct.gov/resource/stm9-38x4.json",
    title: "Connecticut Annual Housing Permits by Town",
    publisher: "Connecticut Department of Economic and Community Development",
    jurisdiction: "US-CT",
    recordDescription:
      "One Connecticut town with the number of housing units authorized by building permits in each year from 1990, one column per year.",
    license: "Public Domain",
    updateFrequency: "annual",
  },
  {
    slug: "fema-nfhl-flood-hazard-zones",
    accessUrl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    title: "FEMA National Flood Hazard Layer: Flood Hazard Zones",
    publisher: "Federal Emergency Management Agency",
    jurisdiction: "US",
    recordDescription:
      "One flood hazard area polygon from an effective Flood Insurance Rate Map, with its flood zone, subtype, special flood hazard area flag and base flood elevation.",
    landingPage: "https://msc.fema.gov/portal/home",
    license: "not stated (US federal government work)",
    updateFrequency: "continuous, as maps and revisions become effective",
  },
  {
    slug: "census-tracts-2020",
    accessUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/10",
    title: "Census TIGERweb 2020 Census Tracts",
    publisher: "U.S. Census Bureau",
    jurisdiction: "US",
    recordDescription:
      "One 2020 census tract polygon with its GEOID, name, land and water area, housing unit count and population.",
    landingPage: "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_main.html",
    license: "not stated (US federal government work)",
    updateFrequency: "decennial (2020 vintage)",
  },
  {
    slug: "new-haven-parcels",
    accessUrl: "https://gis.newhavenct.gov/server/rest/services/Hosted/New_Haven_Parcels_Authoritative_5_view/FeatureServer/0",
    title: "New Haven Parcels (Authoritative, Public View)",
    publisher: "City of New Haven",
    jurisdiction: "US-CT/new-haven",
    recordDescription:
      "One New Haven parcel (or condo unit) polygon with its assessor attributes: parcel ID, map-block-lot, address, ward, use code, zone, census tract, last sale and assessed values.",
    landingPage: "https://gis.newhavenct.gov/arcgis/home/item.html?id=9eb63edaa1994f22aa56fb4684f8c100",
    license: "City of New Haven terms: approved for public use; not a survey; for planning purposes only",
  },
  {
    slug: "new-haven-zoning",
    accessUrl: "https://gis.newhavenct.gov/server/rest/services/Hosted/Zoning_(View)/FeatureServer/0",
    title: "New Haven Zoning Districts",
    publisher: "City of New Haven",
    jurisdiction: "US-CT/new-haven",
    recordDescription: "One zoning district polygon in New Haven with its zone code, district family and category.",
    landingPage: "https://gis.newhavenct.gov/arcgis/home/item.html?id=5a0e75ed78d64eb5a8c75313830c5b9e",
    license: "City of New Haven terms: approved for public use; not a survey; for planning purposes only",
  },
  {
    slug: "new-haven-inclusionary-zoning",
    accessUrl: "https://gis.newhavenct.gov/server/rest/services/Hosted/Inclusionary_Zoning_Overlay_District_view/FeatureServer/0",
    title: "New Haven Inclusionary Zoning Overlay",
    publisher: "City of New Haven",
    jurisdiction: "US-CT/new-haven",
    recordDescription: "One inclusionary zoning market area polygon (Core Market or Strong Market) under New Haven's 2022 ordinance.",
    landingPage: "https://gis.newhavenct.gov/arcgis/home/item.html?id=908b2e6d40514fb88d6ad954a5e2a481",
    license: "City of New Haven terms: approved for public use; not a survey; for planning purposes only",
  },
  {
    slug: "new-haven-lci-managed-lots",
    accessUrl: "https://gis.newhavenct.gov/server/rest/services/Hosted/LCI_Managed_Lots_(View)/FeatureServer/0",
    title: "New Haven LCI Managed Lots",
    publisher: "City of New Haven, Livable City Initiative",
    jurisdiction: "US-CT/new-haven",
    recordDescription:
      "One city-owned lot managed by New Haven's Livable City Initiative, with its map-block-parcel, status, address and size.",
    landingPage: "https://gis.newhavenct.gov/arcgis/home/item.html?id=5e365a9e77394525b951c390abf37a67",
    license: "City of New Haven terms: approved for public use; not a survey; for planning purposes only",
  },
  {
    slug: "new-haven-assessor-cards",
    accessUrl: "https://gis.vgsi.com/newhavenct/Parcel.aspx",
    platform: "manual",
    title: "New Haven Assessor Property Record Cards (Vision)",
    publisher: "City of New Haven Assessor (hosted by Vision Government Solutions)",
    jurisdiction: "US-CT/new-haven",
    recordDescription:
      "One web page per assessor parcel, showing owner, valuation, building details, photos and sales history; a link target, not an API.",
    landingPage: "https://gis.vgsi.com/newhavenct/",
    fields: [
      { name: "pid", type: "integer", label: "Parcel ID", description: "URL parameter: Parcel.aspx?pid={pid}" },
    ],
    note: "No API; link to a parcel's card with ?pid=. Field list is the URL parameter only.",
  },
];

// --- mappings -----------------------------------------------------------------------

export interface MappingSeed {
  source: string;
  /** "land-parcel" is the fork; others are CONCEPTS slugs. */
  concept: string;
  role: "record" | "reference";
  fields: Array<{ from: string; to: string; conversion?: string }>;
}

const TOWN_LOCAL = "unique only within its town; pair with the town";

export const MAPPINGS: MappingSeed[] = [
  // Statewide parcel layer
  {
    source: "ct-parcels-cama", concept: "land-parcel", role: "record",
    fields: [
      { from: "Parcel_ID", to: "pin", conversion: TOWN_LOCAL },
      { from: "CAMA_Link", to: "parcelKey", conversion: "town code + '-' + local parcel ID, e.g. 52070-6081; unique statewide" },
      { from: "Location", to: "address", conversion: "collapse repeated spaces before matching" },
      { from: "Town_Name", to: "city" },
      { from: "ZIP_CODE", to: "zip" },
      { from: "Zone", to: "zoneCode" },
      { from: "State_Use", to: "landUseCode" },
      { from: "State_Use_Description", to: "landUseDescription" },
      { from: "Land_Acres", to: "landAcres" },
      { from: "Owner", to: "ownerName" },
      { from: "Mailing_Address", to: "mailingAddress" },
    ],
  },
  {
    source: "ct-parcels-cama", concept: "property-assessment", role: "record",
    fields: [
      { from: "Assessed_Total", to: "assessedTotal" },
      { from: "Assessed_Land", to: "assessedLand" },
      { from: "Assessed_Building", to: "assessedBuilding" },
      { from: "Pre_Yr_Assessed_Total", to: "priorAssessedTotal" },
      { from: "Appraised_Land", to: "appraisedLand" },
      { from: "Appraised_Building", to: "appraisedBuilding" },
      { from: "Appraised_Outbuilding", to: "appraisedOutbuilding" },
      { from: "Valuation_Year", to: "valuationYear" },
    ],
  },
  {
    source: "ct-parcels-cama", concept: "building", role: "reference",
    fields: [
      { from: "Living_Area", to: "livingArea" },
      { from: "Effective_Area", to: "effectiveArea" },
      { from: "Total_Rooms", to: "totalRooms" },
      { from: "Number_of_Bedroom", to: "bedrooms" },
      { from: "Number_of_Baths", to: "fullBaths" },
      { from: "Number_of_Half_Baths", to: "halfBaths" },
      { from: "AYB", to: "yearBuilt", conversion: "actual year built" },
      { from: "EYB", to: "effectiveYearBuilt" },
      { from: "Condition", to: "condition" },
    ],
  },
  {
    source: "ct-parcels-cama", concept: "property-sale", role: "reference",
    fields: [
      { from: "Sale_Price", to: "salePrice", conversion: "most recent sale only" },
      { from: "Sale_Date", to: "saleDate", conversion: "most recent sale only; text, parse to a date" },
    ],
  },
  { source: "ct-parcels-cama", concept: "zoning-district", role: "reference", fields: [{ from: "Zone", to: "zoneCode", conversion: "the town's own zone codes" }] },
  { source: "ct-parcels-cama", concept: "municipality", role: "reference", fields: [{ from: "Town_Name", to: "name" }] },
  {
    source: "ct-parcels-cama", concept: "census-tract", role: "reference",
    fields: [{ from: "FIPS", to: "geoid", conversion: "2020 tract GEOID with the pre-2022 county code (09009…); current Census layers use planning-region codes (09170…)" }],
  },

  // Statewide CAMA table
  {
    source: "ct-cama-2026", concept: "land-parcel", role: "record",
    fields: [
      { from: "pid", to: "pin", conversion: TOWN_LOCAL },
      { from: "link", to: "parcelKey", conversion: "same value as the parcel layer's CAMA_Link" },
      { from: "account_number", to: "accountNumber" },
      { from: "location", to: "address", conversion: "collapse repeated spaces before matching" },
      { from: "property_city", to: "city" },
      { from: "property_state", to: "state" },
      { from: "property_zip", to: "zip" },
      { from: "unit", to: "condoUnit" },
      { from: "zone", to: "zoneCode" },
      { from: "state_use", to: "landUseCode" },
      { from: "state_use_description", to: "landUseDescription" },
      { from: "land_acres", to: "landAcres" },
      { from: "owner", to: "ownerName" },
      { from: "mailing_address", to: "mailingAddress" },
    ],
  },
  {
    source: "ct-cama-2026", concept: "property-assessment", role: "record",
    fields: [
      { from: "assessed_total", to: "assessedTotal" },
      { from: "assessed_land", to: "assessedLand" },
      { from: "assessed_building", to: "assessedBuilding" },
      { from: "assessed_outbuilding", to: "assessedOutbuilding" },
      { from: "assessed_extra_feature", to: "assessedExtraFeatures" },
      { from: "pre_yr_assessed_total", to: "priorAssessedTotal" },
      { from: "appraised_total", to: "appraisedTotal" },
      { from: "appraised_land", to: "appraisedLand" },
      { from: "appraised_building", to: "appraisedBuilding" },
      { from: "appraised_outbuilding", to: "appraisedOutbuilding" },
      { from: "appraised_extra_feature", to: "appraisedExtraFeatures" },
      { from: "valuation_year", to: "valuationYear" },
    ],
  },
  {
    source: "ct-cama-2026", concept: "building", role: "reference",
    fields: [
      { from: "ayb", to: "yearBuilt", conversion: "actual year built; text" },
      { from: "eyb", to: "effectiveYearBuilt", conversion: "text" },
      { from: "living_area", to: "livingArea" },
      { from: "effective_area", to: "effectiveArea" },
      { from: "gross_area_of_primary_building", to: "grossArea" },
      { from: "stories", to: "stories" },
      { from: "total_rooms", to: "totalRooms", conversion: "text" },
      { from: "number_of_bedroom", to: "bedrooms" },
      { from: "number_of_baths", to: "fullBaths" },
      { from: "number_of_half_baths", to: "halfBaths" },
      { from: "style_desc", to: "style" },
      { from: "condition_description", to: "condition" },
      { from: "heat_type_description", to: "heatType" },
      { from: "heat_fuel_description", to: "heatFuel" },
      { from: "number_of_units", to: "units", conversion: "text" },
    ],
  },
  {
    source: "ct-cama-2026", concept: "property-sale", role: "reference",
    fields: [
      { from: "sale_price", to: "salePrice", conversion: "most recent sale only; text" },
      { from: "sale_date", to: "saleDate", conversion: "most recent sale only; text" },
      { from: "book_page", to: "deedBookPage" },
      { from: "qualified", to: "qualified" },
      { from: "instrument", to: "instrument" },
      { from: "sale_grantor_name", to: "grantor" },
      { from: "sale_grantee_name", to: "grantee" },
    ],
  },
  { source: "ct-cama-2026", concept: "zoning-district", role: "reference", fields: [{ from: "zone", to: "zoneCode", conversion: "the town's own zone codes" }] },
  {
    source: "ct-cama-2026", concept: "municipality", role: "reference",
    fields: [
      { from: "town_id", to: "localCode", conversion: "Connecticut town number, 1-169; New Haven is 93" },
      { from: "property_county", to: "county" },
    ],
  },

  // Statewide sales
  {
    source: "ct-real-estate-sales", concept: "property-sale", role: "record",
    fields: [
      { from: "serialnumber", to: "serialNumber" },
      { from: "listyear", to: "listYear" },
      { from: "daterecorded", to: "recordedDate" },
      { from: "saleamount", to: "salePrice" },
      { from: "assessedvalue", to: "assessedValueAtSale" },
      { from: "salesratio", to: "salesRatio", conversion: "text" },
      { from: "propertytype", to: "propertyType" },
      { from: "residentialtype", to: "residentialType" },
      { from: "nonusecode", to: "nonUseCode", conversion: "code and reason as text; empty for arm's-length sales" },
    ],
  },
  {
    source: "ct-real-estate-sales", concept: "land-parcel", role: "reference",
    fields: [
      { from: "address", to: "address", conversion: "no parcel ID in this file: match town + address, collapsing repeated spaces" },
      { from: "town", to: "city" },
    ],
  },
  { source: "ct-real-estate-sales", concept: "municipality", role: "reference", fields: [{ from: "town", to: "name" }] },

  // Mill rates and permits
  {
    source: "ct-mill-rates", concept: "property-tax-rate", role: "record",
    fields: [
      { from: "grand_list_year", to: "grandListYear" },
      { from: "fiscal_year", to: "fiscalYear", conversion: "fiscal year ending June 30" },
      { from: "mill_rate", to: "millRate" },
      { from: "mill_rate_real_personal", to: "realPersonalRate" },
      { from: "mill_rate_motor_vehicle", to: "motorVehicleRate" },
      { from: "flat_rate_fee_other_rate", to: "otherRate" },
      { from: "service_district_code", to: "taxDistrictCode", conversion: "empty for the town's own rate" },
      { from: "municipality", to: "taxDistrictName" },
    ],
  },
  {
    source: "ct-mill-rates", concept: "municipality", role: "reference",
    fields: [
      { from: "town_code", to: "localCode", conversion: "Connecticut town number; same as CAMA town_id" },
      { from: "municipality", to: "name", conversion: "district rows name the district, not the town" },
    ],
  },
  {
    source: "ct-housing-permits-by-town", concept: "municipality", role: "reference",
    fields: [{ from: "towns", to: "name" }, { from: "county", to: "county" }],
  },

  // Federal layers
  {
    source: "fema-nfhl-flood-hazard-zones", concept: "flood-hazard-area", role: "record",
    fields: [
      { from: "FLD_ZONE", to: "floodZone" },
      { from: "ZONE_SUBTY", to: "zoneSubtype" },
      { from: "SFHA_TF", to: "specialFloodHazardArea", conversion: "'T' / 'F' to true / false" },
      { from: "STATIC_BFE", to: "baseFloodElevation", conversion: "-9999 means not determined; unit in LEN_UNIT, datum in V_DATUM" },
      { from: "V_DATUM", to: "verticalDatum" },
      { from: "DEPTH", to: "depth", conversion: "-9999 means not determined" },
      { from: "VELOCITY", to: "velocity", conversion: "-9999 means not determined" },
      { from: "LEN_UNIT", to: "lengthUnit" },
      { from: "DFIRM_ID", to: "firmId" },
      { from: "FLD_AR_ID", to: "areaId" },
      { from: "SOURCE_CIT", to: "sourceCitation" },
    ],
  },
  {
    source: "census-tracts-2020", concept: "census-tract", role: "record",
    fields: [
      { from: "GEOID", to: "geoid" },
      { from: "BASENAME", to: "tractNumber" },
      { from: "STATE", to: "stateFips" },
      { from: "COUNTY", to: "countyFips" },
      { from: "NAME", to: "name" },
      { from: "AREALAND", to: "landAreaSqM" },
      { from: "AREAWATER", to: "waterAreaSqM" },
      { from: "HU100", to: "housingUnits" },
      { from: "POP100", to: "population" },
    ],
  },

  // New Haven
  {
    source: "new-haven-parcels", concept: "land-parcel", role: "record",
    fields: [
      { from: "parcel_id", to: "pin", conversion: "same value as the state's Parcel_ID / pid and the assessor card's pid" },
      { from: "account_number", to: "accountNumber" },
      { from: "mblu", to: "mapBlockLot" },
      { from: "unit", to: "condoUnit" },
      { from: "property_address", to: "address" },
      { from: "property_city", to: "city" },
      { from: "property_state", to: "state" },
      { from: "property_zip", to: "zip" },
      { from: "use_code", to: "landUseCode" },
      { from: "zone", to: "zoneCode" },
      { from: "total_land_area_acres", to: "landAcres" },
      { from: "owner_name_1", to: "ownerName" },
      { from: "mail_address", to: "mailingAddress" },
    ],
  },
  {
    source: "new-haven-parcels", concept: "property-assessment", role: "record",
    fields: [
      { from: "total_assessed_land_value", to: "assessedLand" },
      { from: "total_assessed_bldg_value", to: "assessedBuilding" },
      { from: "total_assessed_extra_features", to: "assessedExtraFeatures" },
    ],
  },
  { source: "new-haven-parcels", concept: "building", role: "reference", fields: [{ from: "year_building_built", to: "yearBuilt" }] },
  {
    source: "new-haven-parcels", concept: "property-sale", role: "reference",
    fields: [{ from: "sale_date", to: "saleDate", conversion: "most recent sale only; text" }, { from: "price", to: "salePrice", conversion: "most recent sale only" }],
  },
  { source: "new-haven-parcels", concept: "zoning-district", role: "reference", fields: [{ from: "zone", to: "zoneCode" }] },
  { source: "new-haven-parcels", concept: "municipality", role: "reference", fields: [{ from: "town_id", to: "localCode", conversion: "text here, number in the state CAMA table" }] },
  {
    source: "new-haven-parcels", concept: "census-tract", role: "reference",
    fields: [{ from: "census_tract", to: "tractNumber", conversion: "tract number such as 1426.01, within New Haven County (FIPS 009)" }],
  },
  {
    source: "new-haven-zoning", concept: "zoning-district", role: "record",
    fields: [
      { from: "zone_code", to: "zoneCode" },
      { from: "districts", to: "districtFamily" },
      { from: "district_category", to: "category" },
    ],
  },
  {
    source: "new-haven-inclusionary-zoning", concept: "zoning-district", role: "record",
    fields: [{ from: "market_type", to: "name", conversion: "Core Market or Strong Market; every row is an overlay district (isOverlay = true)" }],
  },
  {
    source: "new-haven-lci-managed-lots", concept: "land-parcel", role: "record",
    fields: [
      { from: "mbp", to: "mapBlockLot", conversion: "map-block-parcel; compare with the city parcel layer's mblu after normalising separators" },
      { from: "full_address", to: "address" },
      { from: "sq_ft", to: "landAcres", conversion: "square feet; divide by 43,560" },
    ],
  },
  { source: "new-haven-assessor-cards", concept: "land-parcel", role: "record", fields: [{ from: "pid", to: "pin", conversion: "open https://gis.vgsi.com/newhavenct/Parcel.aspx?pid={pin}" }] },
];
