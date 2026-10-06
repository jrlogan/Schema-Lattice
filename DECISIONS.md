# SchemaLattice Decisions Log

Locked choices from the design phase. Before changing anything here,
read the spec file it affects and consider whether the change cascades
to other locked decisions.

## Identity and naming

- **Project name: SchemaLattice.** Earlier working names considered:
  Mycelium (organic metaphor), Atlas (maps callback), Taproot, Graft,
  Concord. SchemaLattice chosen for precision — "lattice" captures the
  crystalline DAG structure, "schema" is technically honest.
- **Domain: schemalattice.com.**
- **URIs are canonical regardless of server location.** A concept's
  URI is always `https://schemalattice.com/c/{context}/{slug}@{hash}`,
  even when the record is served from `localhost:7000` during local
  testing. Clients pick which server resolves a URI via config; the
  URI itself is a stable identifier, not a live URL.

## Data model

- **Reuse SKOS for Concept, ConceptScheme, labels, and relations.**
  Do not reinvent. See `specs/json-ld-context.md` for the canonical
  property mapping.
- **Reuse PAV for provenance and versioning** (`derivedFrom`,
  `createdBy`, `previousVersion`, `importedFrom`).
- **Custom namespace additions are minimal.** Only three SchemaLattice
  properties add genuinely new semantics:
  - `:coRefersWith` — same real-world referent, different perspective
  - `:entryLevel` — precomputed depth in broader/narrower tree
  - `:collapsesTo` — explicit rollup targets for detail-shedding
- **Avoid `skos:exactMatch`.** It is transitive and a footgun. Default
  to `closeMatch` unless equivalence is explicitly confirmed by both
  sides.

## Lineage and translation

- **Lineage substrate: Merkle DAG (git-style), not blockchain.**
  Content-addressed, append-only. Blockchain adds trustless global
  ordering which this problem doesn't need.
- **URIs contain content hashes.** Updating a concept creates a new
  URI with `pav:previousVersion` pointing to the old one. URIs are
  never mutated in place.
- **Mutable latest-version pointers** work like git branch heads: a
  small metadata table maps `{context}/{slug}` to current URI.
- **Cambria is NOT a v0.1 dependency.** Cambria is self-declared
  "not production ready," last commit March 2021, effectively
  abandoned. v0.1 ships with a simpler field-diff changeset format.
- **Changeset ops map 1:1 to Cambria lens ops.** v0.2 can upgrade
  losslessly. See `specs/changeset-format.md`.
- **Every fork record carries an `upgradable` boolean flag** marking
  whether its changeset translates cleanly to Cambria lens ops.

## Serialization

- **Plain JSON with a frozen `@context`.** Defer full JSON-LD
  processor until someone needs RDF round-trip. The `@context` is
  published at a stable URL and referenced by every record.
- **Content hashing uses canonical JSON** with sorted keys, specific
  whitespace rules, and language-tag normalization. See
  `specs/hashing-rules.md`.

## Philosophy

- **Protocol over connectors.** SchemaLattice does NOT ship framework-
  specific extractors for Drupal, Django, Rails, Prisma, etc. Instead
  it defines a language-agnostic protocol (`specs/ai-checkpoints.md`)
  that tells any AI *when* to consult the lattice and an annotation
  standard (`specs/annotation-standard.md`) that tells it *how* to
  reference lattice concepts in the code it generates. The AI already
  understands the code; the lattice is just a reference store.
- **Just-in-time mining.** The lattice cold-start problem is solved
  by the protocol itself, not by upfront seed data. When an AI
  needs a concept and the lattice has no match (Checkpoints 1A
  and 1C both empty), Checkpoint 1D directs the AI to search
  open-source projects, read their data models, and synthesize a
  draft concept with honest attribution via `inspiredBySources`.
  The local coding AI does the heavy mining work; the lattice only
  stores the result. This inverts the seed-data approach and means
  concepts enter the catalog because someone needed them —
  maximizing signal-to-noise. Fabricated source URLs are a
  protocol violation.
- **Harness-first iteration.** An evaluation harness
  (`specs/test-harness.md`) ships alongside the server. Scenarios
  define test cases, a runner invokes Claude Code with the skill
  loaded and captures the full run, an evaluator scores mechanical
  and LLM-judged dimensions, and an aggregate report tracks
  progress across iterations. Mock mode allows skill testing
  before the server exists; live mode catches integration bugs.
  Every change to skill, protocol, or tools is validated against
  the harness rather than "feeling better."
- **Permissionless publish.** No approval workflow, no gatekeeper, no
  governance layer in v0.1. Concepts are content-addressed and
  immutable; bad actors can add noise but cannot corrupt existing
  concepts. Social signal (adoption count, fork count) is the quality
  filter.
- **No equivalence claims.** Default to `closeMatch`, not
  `exactMatch`. Semantic web projects die when they force global
  agreement on meaning. Allow disagreement; make it visible.

## Infrastructure

- **v0.1 is single-instance.** Federation is the thing that kills
  these projects; explicitly deferred to v0.2 or later.
- **Local testing first.** Users run a local instance against their
  own apps before ever touching schemalattice.com. The same codebase
  runs both modes.
- **Hosting (eventual): Hetzner CX11** at €3.29/month for the shared
  public instance. Caddy for automatic HTTPS.
- **Public read, no auth.** Anyone can discover and resolve concepts.
- **Write requires API key.** v0.1 is single-publisher (the instance
  operator). Multi-publisher is v0.2+.
- **Local embeddings, no paid APIs.** `bge-small-en-v1.5` via
  `@xenova/transformers`. Swappable later if quality demands it.

## Learning loop

- **Catalog logs usage events.** Events table with random session
  UUIDs (no identity), tracking discover/resolve/adopt/fork/originate/
  warning_ignored. Aggregate metrics (adoption count, fork density,
  query-without-match rate) feed back into ranking.
- **Ranking blends vector similarity and adoption.** Discovery
  results rank by semantic distance first, adoption count as a
  secondary tie-breaker. Popular concepts surface ahead of less-used
  near-neighbors at the same similarity level.
- **`lattice_stats` tool exposes counts back to the AI.** So the AI
  building a new app can use popularity as signal in its adopt/fork/
  originate decision.

## Attribution

- **Three attribution fields required on any extracted concept:**
  - `pav:importedFrom` — source URL (repo + commit + path)
  - `pav:authoredBy` — original author(s)
  - `:sourceLicense` — SPDX identifier
- **Schemas imported from GPL sources** have their descriptions
  paraphrased rather than verbatim copied, to keep out of copyright
  grey area.

## In-code footprint

- **Sidecar manifest: `schemalattice.json`** at project root. Plain
  JSON. Maps local short names to canonical URIs with status
  (adopted/forked/originated) and optional notes.
- **Inline markers: `[lattice:SHORT_NAME]`** — one syntax for any
  language's comment system. Grep-friendly. Optional for small
  projects; recommended for anything over ~10 concepts.
- **No imports, no decorators, no framework hooks.** The footprint
  in host projects is exactly: one JSON file plus optional comments.

## Scope boundaries for v0.1

**In scope:**
- Core catalog server (HTTP + MCP)
- Seven spec documents in `specs/`
- Claude skill file
- Local-test flow that the operator can run against their own apps
- Deployment target at schemalattice.com

**Out of scope, deferred to v0.2:**
- Cambria lens layer for bidirectional translation
- `/reconcile` endpoint for app-to-app negotiation
- Multi-instance federation
- Governance / endorsement / social signal beyond raw counts
- Framework-specific extractors
- Web UI for browsing the catalog

## Root skeleton and conceptKind (v0.1 additions)

### Root skeleton seeded at server boot

v0.1 ships a minimal 16-node skeleton of abstract parent concepts:
`Thing`, `Agent`, `Person`, `Organization`, `PhysicalObject`,
`Asset`, `Location`, `Event`, `Activity`, `Transaction`, `Concept`,
`Classification`, `Credential`, `Workflow`, `Quantity`, `Record`.
Defined in `specs/root-skeleton.md`. Seeded into the reserved
`schemalattice` context on first server boot, idempotently.

Every skeleton node cross-references analogous concepts in
established external vocabularies (schema.org, SKOS, FOAF, PROV-O,
DOLCE, BFO, Wikidata, CIDOC-CRM, QUDT, Open Badges, W3C Verifiable
Credentials, DCAT, LODE, BPMN) via `closeMatch` links. These are
references, not imports — the lattice does not resolve or validate
them; they exist to orient contributors and future tooling.

The skeleton is a hint, not a cage. Domain concepts can fork from
any skeleton node or create new top-level concepts as needed.
Its job is to give the vector embedding space meaningful geometry
from day one, not to enforce a worldview.

**Why this size (16):** too few and the vector space has no
centroids; too many (importing all of schema.org or Wikidata's
class graph) and contributors spend their attention learning the
existing catalog instead of extending it.

### conceptKind as an optional discriminator

Every Concept record may carry a `conceptKind` field with one of:
`entity`, `event`, `classification`, `workflow`, `measurement`,
`agent`, `place`. Maps loosely to the classical continuant /
occurrent split from upper ontologies without importing BFO or
DOLCE formally.

Optional in v0.1 (backward compatible); the skeleton uses it
consistently so discovery can filter by kind from day one.
Recommended for all new concepts in v0.2. Added to
`specs/json-ld-context.md`, `specs/mcp-tools.md`
(`lattice_publish_concept` parameter), and the skill's decision
guidance.

## Governance vocabulary: data classification & attestation (v0.1 M2.5)

- **A reserved `governance` context is seeded at boot** alongside the
  skeleton: nine data-sensitivity classes (`public` → `access-secret`,
  each with a `sensitivityRank` ordinal) and one `attestation` record
  shape. See `specs/data-classification.md`.
- **Why seeding doesn't violate JIT mining:** the empty-start
  philosophy applies to *domain* vocabulary. Sensitivity classes and
  the attestation shape are protocol infrastructure, like the
  skeleton — every deployment needs the same ones, and letting each
  org mint its own would defeat the point of shared classification.
- **Deliberately organization-neutral.** The classes were written and
  tested against makerspace and dive-club examples as well as civic
  ones. Nothing in the vocabulary assumes any particular deployment
  domain.
- **Advisory, not friction.** Fields MAY carry `classification`;
  absence is a reported coverage gap, never an error. Unknown class
  values are rejected (`ERR_UNKNOWN_CLASSIFICATION`) so profiles stay
  trustworthy. Classification lives inside `structure`, so it is
  identity-bearing: reclassifying mints a new version with lineage.
- **The lattice records sensitivity; it never enforces handling.**
  Sensitivity profiles (per-manifest aggregation with `maxRank`) are
  computable by the server; mapping ranks to review tiers, storage
  rules, or approvals is the adopting organization's policy, outside
  this project. Enforcement gates (security review, privacy check)
  are sibling build-time tools that emit `governance/attestation`
  records — the lattice defines the result shape, not the checks.
- **`dpv:` / `dpv-pd:` (W3C Data Privacy Vocabulary)** added to the
  approved external-vocabulary prefixes to anchor the personal-data
  classes.

## App registry (v0.1 M2.75)

- **The registry is server-side and lives in lattice-server.**
  REQUIREMENTS §R4 framed the register as client-side
  (`~/.schemalattice/register.db` + CLI scan). That CLI half remains
  M4; the server-side registry is the aggregation point it reconciles
  against, and it ships first because profiles, overlaps, and audits
  are computed where the catalog, vectors, and governance vocabulary
  already are.
- **Organization-neutral vocabulary:** apps belong to a `unit`
  (department, shop area, team, committee). App slugs may start with
  digits ("311-portal"), unlike concept slugs.
- **Registration validates, never gates:** manifests must resolve
  (unknown concept URIs rejected) and statuses must be from the fixed
  enums, but nothing about an app's score or profile blocks
  registration — visibility is the product, and blocking registration
  would push weak apps into the shadows.
- **Attestations are stored per the `governance/attestation` shape**
  with result restricted to pass/fail/waived so portfolios stay
  computable. The registry records gate results; it never runs
  checks.
- **Connectivity score (reuse / dedupe / anchoring)** formalizes the
  demo metric as a v0.1 preview of v0.2 standardness. Duplicate
  blame is directional: the later publisher who failed to acknowledge
  an existing near-duplicate carries the debt, not the original.
- **Audit findings are advisory** (unlinked near-duplicates, fork
  bridges, unclassified fields, unattested sensitive profiles).
  Nothing is auto-fixed; rank-to-policy mapping stays with the
  organization.

## Lifecycles, invariants, capture provenance, compare (Trail Team pilot)

From the Trail Team × PlacePrize pilot (`examples/trail-team-bounty-pilot.md`),
the first attempt to carry a real two-system integration contract through
the catalog. Spec: `specs/lifecycle-and-provenance.md`.

- **The contract that matters is behavior, not fields.** The
  negotiation argued about states and the events between them, a field
  that freezes once money is pledged, and how a photo was captured. Field
  names were easy. So `structure` MAY now carry a `lifecycle`, and fields
  MAY carry `immutableFrom` and `provenance`. All are optional, hashed
  (inside `structure`), and additive: existing concepts are unchanged.
- **Validate names, advise on shape.** Anything that names something
  unknown (a provenance class, a state) is refused, because two readers
  would otherwise disagree. Legal-but-odd shapes (unreachable states,
  exits from terminal states) are advisories. Same stance as
  classification.
- **Provenance is a second governance axis, not a data class.** Four
  seeded classes ordered by `assuranceRank` (metadata, not hashed, not a
  policy). They sit in the existing `governance` context; its definition
  text was deliberately left unchanged, because the context hash (and
  so every governance concept URI) depends on it.
- **One invariant only.** `immutableFrom` covers the case the pilot
  needed. Required-in-state, monotonic values and the like wait for a
  second use case.
- **`vouchedBy` is recorded, not validated.** Roles ("organizer") are
  domain vocabulary; the lattice has no business enumerating them.
- **Catch-all external matches get an advisory, not a refusal.** R2 is
  unchanged; `schema:Thing`-style anchors now draw a
  `weak-external-match` warning.
- **Forks name what their changeset can't say.** Classification,
  provenance, invariant and lifecycle changes are hashed into a fork but
  are not changeset ops. Rather than invent non-Cambria ops, the fork
  returns a `semantic-change-outside-changeset` warning. Lens-level ops
  for these are a v0.2 question.
- **`lattice_compare` is read-only and derived.** It never affects
  identity. It exists because the most useful artifact in the pilot was a
  hand-written side-by-side table; the tool produces that table.

### Deferred from the pilot

- **Negotiation drafts.** Meaning moved repeatedly while the two parties
  negotiated (who gets paid flipped twice). Content-addressed publish
  mints a permanent URI per revision. A draft or proposal state that only
  mints on agreement would fit negotiation better. Needs design: it
  touches permanence and the permissionless-publish stance.
- **Structural discovery.** "Maintenance Schedule" (a recurring duty) and
  "Contract Award" were good structural analogues for scheduled watering
  and bounties, but scored about 0.57 and came back `distant`. Ranking by
  field and lifecycle shape, not only definition text, is worth testing.
- **Standards as external anchors.** The parent concept came from
  FixMyStreet and its context names Open311, but nothing could say so
  formally. Open311 and C2PA have no CURIE prefixes on the approved list.
  Decide whether non-RDF standards get prefixes or a separate
  `conformsTo`-style link. The trail data pilot
  (`examples/trail-data-pilot.md`) hit the same gap with CT Trails 2021,
  FTDS and OSM tagging, and proposes registered standard records with a
  concept-level `conformsTo` and validated per-field `sameAs`.

## Popularity and standardness scoring (v0.2 direction)

The catalog should **encourage but not require** convergence on
widely-used conventions. Popularity-weighted ranking provides
gentle gravitational pressure toward existing concepts without
blocking origination when the situation genuinely demands it.

## Next-session handoff

These notes are not locked design decisions. They are a pragmatic
handoff for the next coding session.

### What seems strongest in the concept

- **Real problem selection.** AI-generated apps will fragment data
  models badly; shared transport protocols do not solve shared
  semantics.
- **Best core loop:** discover -> adopt/fork/originate -> annotate ->
  preserve lineage. This is the part with the clearest practical
  value.
- **Good near-term surface:** MCP tools for build-time agents are a
  believable wedge. This is more concrete than trying to start with
  broad federation or a web UI.

### Main risks to keep in view

- **Registry risk.** If the lattice does not improve the first app
  builder's outcome immediately, it becomes an elaborate registry that
  agents skip.
- **Network-effect risk.** The grand vision needs reuse across many
  apps, but v0.1 must deliver value before network effects exist.
- **Semantic drift risk.** Discovery quality, duplicate concepts, and
  near-match ambiguity will matter early.
- **Translation risk.** Fork lineage is feasible; reliable schema
  translation is much harder and should stay out of the critical path.
- **Governance risk.** Permissionless publish is fine for v0.1, but
  concept sprawl and low-quality duplicates will appear quickly if the
  project gets traction.

### Recommended framing for v0.1

Do not try to prove "global semantic infrastructure for AI-built
software" yet. The more defensible claim is:

**SchemaLattice is a build-time semantic memory for AI app generation
that helps agents reuse, fork, and trace schema concepts with explicit
lineage.**

That claim is narrow enough to validate and still ambitious enough to
matter.

### Best wedge to prove first

Target one or two domains where:

- concepts recur across many small apps,
- interoperability pain is obvious,
- and the agent can show immediate benefit from reuse.

Good examples from the current repo direction:

- activity / logging records,
- equipment lending / inventory workflows,
- domain-specific operational records like scuba logs.

### What to prioritize building next

1. **Trustworthy eval harness.** The harness is the main lever for
   learning. It must not over-report success or hide broken fixtures.
2. **Minimal server path.** One local instance with `discover`,
   `resolve`, `publish_concept`, `publish_fork`, and
   `publish_context`.
3. **One end-to-end proof.** Pick a narrow domain and show that using
   the lattice produces a better schema or easier retrofit than not
   using it.
4. **Annotation loop.** A generated project should end with a usable
   `schemalattice.json` and clear traceability back to catalog
   concepts.

### What to explicitly defer

- federation,
- full reconciliation between apps,
- ambitious translation claims,
- broad governance design,
- large starter ontology imports.

### Practical success criteria

Call v0.1 useful only if all of the following are true:

- an agent actually consults the lattice during schema design,
- it reuses or forks concepts instead of inventing everything,
- the resulting project keeps machine-readable references to those
  concepts,
- and a later session can understand or extend the schema faster
  because that lineage exists.

If those are not true, keep narrowing scope rather than adding more
theory.

**Four concrete benefits:**

1. **Gentle convergence pressure.** Discovery ranking blends
   similarity with adoption count so popular concepts surface
   first. The AI can still originate when genuinely needed but
   has to make that choice in the face of a better-adopted
   alternative.
2. **Standardness score per concept.** A 0–1 metric combining
   adoption count, fork count, closeness to the skeleton, and
   embedding centrality. Lets the AI see "this concept is 0.78
   standard" and factor it into adopt/fork/originate decisions.
3. **Schema health report per project.** An aggregate
   standardness across a project's `schemalattice.json` manifest.
   *"Your scuba app is 0.82 standard overall; oddballs:
   `GasMixWithDecoProfile` (0.31). Consider whether this should
   fork from `scuba-ops/GasMix` (adopted 23 times)."* This turns
   the lattice from a passive store into an active teacher.
4. **Reconciliation confidence for integration.** When two apps
   compare manifests, each concept pair gets a mapping confidence
   score. Integration tools can then handle certain mappings
   automatically and uncertain mappings with appropriate caution.

**Proposed mechanism for v0.2:**

- Every publish/discover/resolve logs an event (already planned
  in the events table).
- `adoptionCount` and `forkCount` are maintained as derived
  counters updated from events.
- `standardness` is computed on query as a weighted function of:
  - `adoptionCount` — projects that reference this URI
  - `forkCount` — concepts that extend it
  - `skeletonDistance` — fork/broader hops to reach a skeleton
    node; shallower = more standard
  - `embeddingCentrality` — distance to the centroid of its
    context's concepts
- Discovery results include `standardness` as a secondary sort
  key after similarity. The skill's decision tree uses it to
  nudge toward high-standardness matches without hard-blocking
  origination.
- A new MCP tool `lattice_schema_health(manifestUrl)` computes
  aggregate standardness for a project's whole manifest and
  identifies oddballs.

**Why deferred to v0.2:** v0.1 needs to prove the basic protocol
works before adding meta-scoring. Running the harness scenarios
in live mode with real server-side discovery will show whether
pure similarity ranking is enough. If originations are correctly
nudged toward existing concepts via similarity alone, popularity
weighting is a refinement. If originations happen too easily,
popularity weighting becomes essential. The v0.1 data collection
(events table) already captures what v0.2 needs to compute
standardness, so deferring is cheap.

## Open questions deferred to v0.2+

### Mixed-hierarchy selection cuts

The current `:entryLevel` / `:collapsesTo` design assumes an app
operates at a single consistent level of a hierarchy — either all
top-level categories or all leaves. Real selection UIs often want
something subtler: a single flat list that pulls from DIFFERENT
levels of the tree per branch.

Example: a "why did you quit" dropdown with canonical categories
`[dissatisfaction, moved, cost]`. One app wants to break
`dissatisfaction` into its subcategories (unfair, boring, toxic)
but keep `moved` and `cost` collapsed. A different app wants to
keep `dissatisfaction` collapsed but break `cost` into
subcategories (unaffordable, unjustified, better-deal-elsewhere).
Both want a single flat selection list backed by the same
underlying taxonomy.

What this needs that v0.1 does not have:

- A **selection cut** concept: a named subset of a hierarchy where
  each branch is cut at a potentially different depth, but every
  leaf in the source tree is still represented exactly once by
  either itself or one of its ancestors in the cut.
- A mapping function: given a leaf in the source tree, return which
  entry in the cut covers it, so records tagged at any depth can
  be rolled up for any cut.
- Serialization in `schemalattice.json` so apps can declare which
  cut they're using and the runtime can validate tags against it.

**Why deferred.** This is a real need but v0.1 needs to test the
basic adopt/fork/originate loop first. Introducing selection cuts
adds a new entity type and a new MCP tool surface. Better to
validate the core first, then add this once we have real dropdowns
failing.

**How to capture user need.** When v0.1 runs hit this pattern in
practice — e.g., a retrofit scenario where an app has a taxonomy
dropdown and the AI can't express the cut — the skill should log
the gap and the user can point at it when planning v0.2.

### Selection cuts are NOT perspective rotation

Worth distinguishing from `:coRefersWith`. Perspective rotation
(coRefersWith) is about different *concepts* for the same
*referent*. Selection cuts are about different *depths* into the
same *taxonomy*. They live in separate axes of the design and
should not be conflated when v0.2 work starts.

## Next step

Documentation phase is closing. Implementation is the next focused
session. Revised order:

1. Build `packages/lattice-evals/` first (harness + 6 seed scenarios
   in mock mode). This lets the skill be iterated against real test
   cases before any server exists.
2. Build `packages/lattice-server/` + `packages/lattice-mcp/`
   against the specs. Lattice starts empty — no pre-seeded concepts
   per the JIT mining philosophy.
3. Re-run the harness in live mode to catch integration issues.
4. Test manually by loading `skills/lattice-workflow.md` into Claude
   Code in one of the operator's existing projects and asking it to
   design a new schema. Watch the full checkpoint flow (including
   1D JIT mining since the lattice is empty) execute end-to-end.

This order means the harness catches regressions from step 1,
surfaces skill ambiguities before implementation locks in a
particular behavior, and gives the operator a repeatable scoring
signal from the earliest possible moment.
