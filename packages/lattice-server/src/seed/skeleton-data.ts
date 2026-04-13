// The 16 skeleton concepts, transcribed from specs/root-skeleton.md.
//
// Order matters for seeding: parents must appear before children so
// the seeder can resolve broader-slug references to URIs.

export interface SkeletonNode {
  slug: string;
  prefLabel: string;
  definition: string;
  conceptKind?: string;
  broaderSlug?: string;
  closeMatch: string[];
}

export const SKELETON_CONTEXT_SLUG = "schemalattice";
export const SKELETON_CONTEXT_LABEL = "SchemaLattice Root Skeleton";
export const SKELETON_CONTEXT_DEFINITION =
  "Reserved context for the 16 abstract root concepts that every SchemaLattice concept ultimately inherits from. See specs/root-skeleton.md.";

export const SKELETON_NODES: SkeletonNode[] = [
  {
    slug: "thing",
    prefLabel: "Thing",
    definition:
      "Anything the lattice can describe: a physical object, an event, an abstract idea, a record, a quantity, an agent, or a place. Root of the skeleton.",
    closeMatch: ["schema:Thing", "wd:Q35120", "dolce:Particular"],
  },
  {
    slug: "agent",
    prefLabel: "Agent",
    definition:
      "An entity capable of taking purposeful action — a person, an organization, a system, or an automated process.",
    conceptKind: "agent",
    broaderSlug: "thing",
    closeMatch: ["prov:Agent", "foaf:Agent", "dolce:APO"],
  },
  {
    slug: "person",
    prefLabel: "Person",
    definition:
      "An individual human being, identified by characteristics such as name, contact information, roles, memberships, or credentials.",
    conceptKind: "agent",
    broaderSlug: "agent",
    closeMatch: ["schema:Person", "foaf:Person", "wd:Q5", "cidoc:E21_Person"],
  },
  {
    slug: "organization",
    prefLabel: "Organization",
    definition:
      "A formal or informal group of people acting collectively — a company, club, makerspace, nonprofit, government body, team, or community.",
    conceptKind: "agent",
    broaderSlug: "agent",
    closeMatch: [
      "schema:Organization",
      "foaf:Organization",
      "wd:Q43229",
      "cidoc:E74_Group",
    ],
  },
  {
    slug: "physical-object",
    prefLabel: "Physical Object",
    definition:
      "A tangible, material thing that occupies space and can be handled, located, or physically interacted with.",
    conceptKind: "entity",
    broaderSlug: "thing",
    closeMatch: [
      "schema:Product",
      "wd:Q223557",
      "bfo:material_entity",
      "dolce:PhysicalObject",
    ],
  },
  {
    slug: "asset",
    prefLabel: "Asset",
    definition:
      "A physical object that is owned, tracked, borrowed, lent, inventoried, or otherwise managed as a countable resource.",
    conceptKind: "entity",
    broaderSlug: "physical-object",
    closeMatch: ["schema:OwnershipInfo", "wd:Q721118", "dct:PhysicalResource"],
  },
  {
    slug: "location",
    prefLabel: "Location",
    definition:
      "A physical place, identified by coordinates, name, or relationship to other places, and capable of hosting events, holding assets, or being visited by agents.",
    conceptKind: "place",
    broaderSlug: "physical-object",
    closeMatch: [
      "schema:Place",
      "wd:Q17334923",
      "geonames:Feature",
      "dolce:PhysicalRegion",
      "cidoc:E53_Place",
    ],
  },
  {
    slug: "event",
    prefLabel: "Event",
    definition:
      "Something that happens or occurs at a definite point in time, involving one or more agents, objects, or places.",
    conceptKind: "event",
    broaderSlug: "thing",
    closeMatch: [
      "schema:Event",
      "lode:Event",
      "dolce:Perdurant",
      "wd:Q1656682",
      "cidoc:E5_Event",
    ],
  },
  {
    slug: "activity",
    prefLabel: "Activity",
    definition:
      "A purposeful, goal-directed event performed by one or more agents, typically with a defined duration and an outcome measured in experience, production, or state change.",
    conceptKind: "event",
    broaderSlug: "event",
    closeMatch: [
      "prov:Activity",
      "schema:Action",
      "wd:Q1914636",
      "dolce:Accomplishment",
    ],
  },
  {
    slug: "transaction",
    prefLabel: "Transaction",
    definition:
      "An event representing an exchange, transfer, or state change involving one or more parties — a loan, a payment, a registration, an inspection, a checkout, a return.",
    conceptKind: "event",
    broaderSlug: "event",
    closeMatch: ["schema:TradeAction", "wd:Q1166618", "prov:Activity"],
  },
  {
    slug: "concept",
    prefLabel: "Concept",
    definition:
      "An abstract idea, rule, classification, or definition — something that exists as knowledge rather than as a physical object or event.",
    conceptKind: "classification",
    broaderSlug: "thing",
    closeMatch: ["skos:Concept", "wd:Q151885"],
  },
  {
    slug: "classification",
    prefLabel: "Classification",
    definition:
      "A named category or enumerable set of values used to label, group, or discriminate between other things — a status, a type, a tier, a tag, an outcome.",
    conceptKind: "classification",
    broaderSlug: "concept",
    closeMatch: [
      "skos:Concept",
      "schema:CategoryCode",
      "wd:Q5962346",
      "dolce:AbstractRegion",
    ],
  },
  {
    slug: "credential",
    prefLabel: "Credential",
    definition:
      "A formal recognition that an agent possesses a defined capability, permission, qualification, or status — a certification, a badge, a role, a license, a membership.",
    conceptKind: "classification",
    broaderSlug: "concept",
    closeMatch: [
      "schema:EducationalOccupationalCredential",
      "openbadges:Achievement",
      "w3c-vc:VerifiableCredential",
      "wd:Q11707770",
    ],
  },
  {
    slug: "workflow",
    prefLabel: "Workflow",
    definition:
      "A process definition specifying the states, transitions, actors, and triggers involved in accomplishing a goal over time. A workflow is the pattern; individual Activity or Transaction instances execute it.",
    conceptKind: "workflow",
    broaderSlug: "concept",
    closeMatch: ["schema:HowTo", "bpmn:Process", "wfdesc:Workflow", "prov:Plan"],
  },
  {
    slug: "quantity",
    prefLabel: "Quantity",
    definition:
      "A measurable property with a numeric value and a unit — depth, duration, weight, currency amount, pressure, temperature, distance, count.",
    conceptKind: "measurement",
    broaderSlug: "thing",
    closeMatch: [
      "schema:QuantitativeValue",
      "qudt:Quantity",
      "wd:Q107715",
      "dolce:Quality",
    ],
  },
  {
    slug: "record",
    prefLabel: "Record",
    definition:
      "A data model entry that captures information about other things — a log, a report, an observation, a snapshot, a reading taken at a point in time.",
    conceptKind: "entity",
    broaderSlug: "thing",
    closeMatch: [
      "prov:Entity",
      "schema:DataFeedItem",
      "dcat:Dataset",
      "wd:Q271866",
    ],
  },
];
