# Spec: Root Skeleton (v0.1 seed concepts)

**Status:** Locked for v0.1. New skeleton nodes require design
review; they should be rare. Existing nodes' URIs are immutable
once seeded.

## Goal

Provide the minimum set of abstract parent concepts that the
SchemaLattice server ships with on first boot. These concepts
give the vector embedding space geometric structure from day one
and provide natural attachment points for every domain concept
an AI might create. Without a skeleton, the first N published
concepts have nothing to cluster around and discovery ranking is
unreliable until enough content accumulates organically. The
skeleton solves the cold-start problem for vector geometry the
same way Checkpoint 1D JIT mining solves it for concept content.

The skeleton is a **hint, not a cage.** Permissionless publishing
still applies. Its job is to give good centroids and common
attachment points, not to enforce a worldview. An AI that
disagrees with the shape is free to create new top-level concepts
or reorganize — lineage is tracked either way.

## Design rules

1. **Small.** 16 nodes, no more. A contributor should be able to
   hold the whole skeleton in working memory.
2. **Abstract, not domain-specific.** No `Vehicle`, `Tool`, or
   `Meeting` — those are first-forkees. Skeleton nodes describe
   categories that thousands of concepts could reasonably fork
   from.
3. **Cross-referenced, not imported.** Each node lists `closeMatch`
   links to analogous concepts in established external vocabularies.
   These are human-readable references, not IRI imports; the
   skeleton does not depend on resolving them and will not fail
   if they become unavailable.
4. **Stable once seeded.** Skeleton nodes are content-hashed like
   any other concept; once seeded at v0.1 boot their URIs are
   immutable. Changes require publishing new concepts with
   `pav:previousVersion` lineage back to the skeleton originals.
5. **Every node carries a `conceptKind`** so discovery can filter
   by kind from day one (see `specs/json-ld-context.md`).

## External vocabulary prefixes

Prefixes used in `closeMatch` / `broadMatch` fields below. These are
references to external standards for orientation; the lattice does
not resolve or validate them.

| Prefix | Vocabulary |
|---|---|
| `schema:` | schema.org |
| `skos:` | W3C Simple Knowledge Organization System |
| `foaf:` | Friend of a Friend |
| `prov:` | W3C PROV-O |
| `dolce:` | DOLCE+DnS Ultralite |
| `bfo:` | Basic Formal Ontology |
| `wd:` | Wikidata |
| `cidoc:` | CIDOC Conceptual Reference Model |
| `qudt:` | QUDT units ontology |
| `openbadges:` | Open Badges |
| `w3c-vc:` | W3C Verifiable Credentials |
| `dcat:` | W3C Data Catalog Vocabulary |
| `dct:` | Dublin Core Terms |
| `lode:` | Linking Open Descriptions of Events |
| `wfdesc:` | Workflow Description |
| `bpmn:` | Business Process Model and Notation |
| `geonames:` | GeoNames |

## The 16 skeleton nodes

All skeleton nodes live in the reserved context `schemalattice`
(slug `schemalattice`, reserved per `specs/uri-scheme.md`).

---

### 1. Thing

- **URI slug:** `thing`
- **conceptKind:** *(none — this is the meta-root)*
- **broader:** *(none — root of the skeleton)*
- **prefLabel:** Thing
- **definition:** Anything the lattice can describe: a physical
  object, an event, an abstract idea, a record, a quantity, an
  agent, or a place. Root of the skeleton.
- **closeMatch:**
  - `schema:Thing` — schema.org's root of its class hierarchy
  - `wd:Q35120` — Wikidata "entity"
  - `dolce:Particular` — DOLCE's most general particular
- **notes:** This node exists so every other skeleton concept has
  a common ancestor. **Do not reference it from domain concepts
  directly** — fork from or reference one of its children instead.

---

### 2. Agent

- **URI slug:** `agent`
- **conceptKind:** `agent`
- **broader:** `thing`
- **prefLabel:** Agent
- **definition:** An entity capable of taking purposeful action —
  a person, an organization, a system, or an automated process.
- **closeMatch:**
  - `prov:Agent` — PROV-O's notion of an entity that performs
    activities and bears responsibility
  - `foaf:Agent` — FOAF's general agent class (includes Person,
    Organization, Group)
  - `dolce:APO` — DOLCE Agentive Physical Object
- **notes:** Use when a concept describes who or what performs an
  action. See `Person` and `Organization` for concrete subtypes.

---

### 3. Person

- **URI slug:** `person`
- **conceptKind:** `agent`
- **broader:** `agent`
- **prefLabel:** Person
- **definition:** An individual human being, identified by
  characteristics such as name, contact information, roles,
  memberships, or credentials.
- **closeMatch:**
  - `schema:Person` — schema.org's person class
  - `foaf:Person` — FOAF person
  - `wd:Q5` — Wikidata "human"
  - `cidoc:E21_Person` — CIDOC-CRM person
- **notes:** `Member`, `Volunteer`, `Diver`, `Staff`, `Borrower`,
  `Student`, `Patient` typically fork from or reference `Person`.

---

### 4. Organization

- **URI slug:** `organization`
- **conceptKind:** `agent`
- **broader:** `agent`
- **prefLabel:** Organization
- **definition:** A formal or informal group of people acting
  collectively — a company, club, makerspace, nonprofit,
  government body, team, or community.
- **closeMatch:**
  - `schema:Organization` — schema.org organization
  - `foaf:Organization` — FOAF organization
  - `wd:Q43229` — Wikidata "organization"
  - `cidoc:E74_Group` — CIDOC-CRM group
- **notes:** `MakerSpace`, `BoatClub`, `DiveShop`, `Team`,
  `School`, `Nonprofit` fork from `Organization`.

---

### 5. PhysicalObject

- **URI slug:** `physical-object`
- **conceptKind:** `entity`
- **broader:** `thing`
- **prefLabel:** Physical Object
- **definition:** A tangible, material thing that occupies space
  and can be handled, located, or physically interacted with.
- **closeMatch:**
  - `schema:Product` — schema.org product (loose — product adds
    commerce framing)
  - `wd:Q223557` — Wikidata "physical object"
  - `bfo:material_entity` — BFO material entity
  - `dolce:PhysicalObject` — DOLCE physical object
- **notes:** Children include `Asset` (owned/managed) and
  `Location` (physical places). Objects that don't fit either —
  say, an uncategorized raw material — attach directly here.

---

### 6. Asset

- **URI slug:** `asset`
- **conceptKind:** `entity`
- **broader:** `physical-object`
- **prefLabel:** Asset
- **definition:** A physical object that is owned, tracked,
  borrowed, lent, inventoried, or otherwise managed as a
  countable resource.
- **closeMatch:**
  - `schema:OwnershipInfo` — related, covers ownership records
  - `wd:Q721118` — Wikidata "property (asset)"
  - `dct:PhysicalResource` — Dublin Core physical resource
- **notes:** `LibraryItem`, `Battery`, `Vessel`, `Kayak`, `Tool`,
  `Instrument`, `Vehicle`, `InventoryItem` all fork from `Asset`.
  Expected to be one of the most-forked skeleton nodes.

---

### 7. Location

- **URI slug:** `location`
- **conceptKind:** `place`
- **broader:** `physical-object`
- **prefLabel:** Location
- **definition:** A physical place, identified by coordinates,
  name, or relationship to other places, and capable of hosting
  events, holding assets, or being visited by agents.
- **closeMatch:**
  - `schema:Place` — schema.org place
  - `wd:Q17334923` — Wikidata "location"
  - `geonames:Feature` — GeoNames feature
  - `dolce:PhysicalRegion` — DOLCE physical region
  - `cidoc:E53_Place` — CIDOC-CRM place
- **notes:** `Marina`, `DiveSite`, `Trailhead`, `WorkshopRoom`,
  `Dock`, `MeetingRoom`, `CampSite` fork from `Location`.
  Concepts at the same geographic point but different perspective
  (e.g., `Marina` and `DiveSite` at one GPS coordinate) link via
  `:coRefersWith`, not via direct parent-child.

---

### 8. Event

- **URI slug:** `event`
- **conceptKind:** `event`
- **broader:** `thing`
- **prefLabel:** Event
- **definition:** Something that happens or occurs at a definite
  point in time, involving one or more agents, objects, or
  places.
- **closeMatch:**
  - `schema:Event` — schema.org event
  - `lode:Event` — LODE event
  - `dolce:Perdurant` — DOLCE perdurant (things that happen)
  - `wd:Q1656682` — Wikidata "event"
  - `cidoc:E5_Event` — CIDOC-CRM event
- **notes:** Children include `Activity` (goal-directed) and
  `Transaction` (state-change). One-off happenings like club
  meetings or open houses can attach directly to `Event`.

---

### 9. Activity

- **URI slug:** `activity`
- **conceptKind:** `event`
- **broader:** `event`
- **prefLabel:** Activity
- **definition:** A purposeful, goal-directed event performed by
  one or more agents, typically with a defined duration and an
  outcome measured in experience, production, or state change.
- **closeMatch:**
  - `prov:Activity` — PROV-O activity
  - `schema:Action` — schema.org action
  - `wd:Q1914636` — Wikidata "activity"
  - `dolce:Accomplishment` — DOLCE accomplishment
- **notes:** `Dive`, `Hike`, `WorkShift`, `VolunteerShift`,
  `TrainingSession`, `ClassSession` fork from `Activity`.
  Distinct from `Transaction` in that the primary output is
  experience or accomplishment, not an exchange.

---

### 10. Transaction

- **URI slug:** `transaction`
- **conceptKind:** `event`
- **broader:** `event`
- **prefLabel:** Transaction
- **definition:** An event representing an exchange, transfer, or
  state change involving one or more parties — a loan, a payment,
  a registration, an inspection, a checkout, a return.
- **closeMatch:**
  - `schema:TradeAction` — partial; schema.org's commercial
    exchange class
  - `wd:Q1166618` — Wikidata "transaction"
  - `prov:Activity` — also matches, but prov:Activity is more
    general
- **notes:** `LibraryTransaction`, `Reservation`, `IssueReport`,
  `Checkout`, `Return`, `Payment`, `MembershipRenewal` fork from
  `Transaction`. Distinct from `Activity` in that the primary
  output is a state change, not an experience.

---

### 11. Concept

- **URI slug:** `concept`
- **conceptKind:** `classification`
- **broader:** `thing`
- **prefLabel:** Concept
- **definition:** An abstract idea, rule, classification, or
  definition — something that exists as knowledge rather than as
  a physical object or event.
- **closeMatch:**
  - `skos:Concept` — SKOS concept, the canonical model for
    abstract conceptual units
  - `wd:Q151885` — Wikidata "concept"
- **notes:** Children include `Classification`, `Credential`, and
  `Workflow`. Note the recursion: a `skos:Concept` IS a Concept
  in this skeleton. This is intentional — the lattice's own data
  model is expressible in its own vocabulary.

---

### 12. Classification

- **URI slug:** `classification`
- **conceptKind:** `classification`
- **broader:** `concept`
- **prefLabel:** Classification
- **definition:** A named category or enumerable set of values
  used to label, group, or discriminate between other things —
  a status, a type, a tier, a tag, an outcome.
- **closeMatch:**
  - `skos:Concept` — when used as a thesaurus entry
  - `schema:CategoryCode` — schema.org category code
  - `wd:Q5962346` — Wikidata "classification"
  - `dolce:AbstractRegion` — DOLCE abstract region
- **notes:** `ItemStatus`, `LibraryAction`, `InspectionOutcome`,
  `MembershipTier`, `DiveType`, `IncidentSeverity` fork from
  `Classification`. Typically modeled with
  `structure.kind: "enum"` and a list of `values`.

---

### 13. Credential

- **URI slug:** `credential`
- **conceptKind:** `classification`
- **broader:** `concept`
- **prefLabel:** Credential
- **definition:** A formal recognition that an agent possesses a
  defined capability, permission, qualification, or status — a
  certification, a badge, a role, a license, a membership.
- **closeMatch:**
  - `schema:EducationalOccupationalCredential` — schema.org
    credential class
  - `openbadges:Achievement` — Open Badges achievement
  - `w3c-vc:VerifiableCredential` — W3C Verifiable Credentials
  - `wd:Q11707770` — Wikidata "credential"
- **notes:** `DiveCertification` (Open Water, Advanced),
  `BoatingLicense`, `MakerBadge`, `StaffRole`,
  `MembershipLevel` fork from `Credential`. Credentials are
  classifications *held by agents*, distinct from generic tags.

---

### 14. Workflow

- **URI slug:** `workflow`
- **conceptKind:** `workflow`
- **broader:** `concept`
- **prefLabel:** Workflow
- **definition:** A process definition specifying the states,
  transitions, actors, and triggers involved in accomplishing a
  goal over time. A workflow is the pattern; individual
  `Activity` or `Transaction` instances execute it.
- **closeMatch:**
  - `schema:HowTo` — partial; schema.org's how-to instructions
  - `bpmn:Process` — BPMN process definition
  - `wfdesc:Workflow` — Workflow Description
  - `prov:Plan` — PROV-O plan
- **notes:** `LendingWorkflow`, `DiveExecutionPlan`,
  `OnboardingFlow`, `InspectionLifecycle`, `ApprovalFlow` fork
  from `Workflow`. Modeled with `structure.kind: "workflow"`
  which has `states` and `transitions` fields rather than
  `fields`.

---

### 15. Quantity

- **URI slug:** `quantity`
- **conceptKind:** `measurement`
- **broader:** `thing`
- **prefLabel:** Quantity
- **definition:** A measurable property with a numeric value and
  a unit — depth, duration, weight, currency amount, pressure,
  temperature, distance, count.
- **closeMatch:**
  - `schema:QuantitativeValue` — schema.org quantitative value
  - `qudt:Quantity` — QUDT quantity
  - `wd:Q107715` — Wikidata "physical quantity"
  - `dolce:Quality` — DOLCE quality (broader — includes
    non-numeric qualities)
- **notes:** `Depth`, `Duration`, `Temperature`, `Pressure`,
  `Mass`, `Distance`, `Cost` fork from `Quantity`. Used as field
  types when the same measurement pattern repeats across many
  concepts. Typical structure: `{ value: number, unit: string }`.

---

### 16. Record

- **URI slug:** `record`
- **conceptKind:** `entity`
- **broader:** `thing`
- **prefLabel:** Record
- **definition:** A data model entry that captures information
  about other things — a log, a report, an observation, a
  snapshot, a reading taken at a point in time.
- **closeMatch:**
  - `prov:Entity` — PROV-O entity
  - `schema:DataFeedItem` — schema.org data feed item
  - `dcat:Dataset` — DCAT dataset (for data-catalog cases)
  - `wd:Q271866` — Wikidata "data item"
- **notes:** `DiveLog`, `InspectionReport`, `AttendanceRecord`,
  `Observation`, `Snapshot`, `SensorReading` fork from `Record`.
  A record is **distinct from the underlying thing it records
  about**: a `DiveLog` is a Record about a `Dive` (Activity); the
  `Dive` is the event, the `DiveLog` is the captured information.
  This distinction is subtle but important.

## Seed procedure

When the server boots for the first time, it publishes these 16
concepts in dependency order (parents before children) into the
reserved `schemalattice` context. The context itself is seeded
first. All content hashes are deterministic from the canonical
definitions above and will be identical on every instance that
seeds from this spec.

Seeding is idempotent: if the skeleton concepts already exist,
the seed step is a no-op.

Implementation location: `packages/lattice-server/seed/skeleton.ts`
(to be built).

## What's NOT in the skeleton

- **Domain-specific concepts** (Vehicle, Tool, DiveLog, Marina)
  — these fork from skeleton nodes at usage time.
- **Relationship types as first-class things** (Friendship,
  Membership, Partnership) — model as `Credential` for role-like
  relationships, or as domain `entity` concepts for structured
  relationships with their own fields.
- **Rules or policies** — handled via domain concepts for v0.1.
- **Media types, file types, MIME types** — out of scope; use
  field-level `type` annotations instead.
- **Upper-ontology philosophical primitives** (Universal,
  Particular, Abstract vs Concrete) — deliberately avoided. We
  reference DOLCE/BFO via `closeMatch` but do not adopt their
  philosophical framework.

## Future nodes to consider (v0.2+)

- **Message** — a communication event (email, chat, notification,
  alert). Would fork from `Event` or `Record`.
- **Agreement** — a contract, license, or commitment between
  agents. Would fork from `Transaction` or `Concept`.
- **Relationship** — explicit role-link between two entities
  (membership, ownership, custody). Current model handles via
  references and Credentials; may warrant its own node if
  relationship-centric schemas become common.
- **Collection** — a named grouping (set, list, album, library).
  Could fork from `Concept` or stand alone.

None of these are in v0.1 scope. Record them here so future
skeleton expansion has a starting list.
