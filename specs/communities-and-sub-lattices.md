# Communities and sub-lattices

**Status:** decided 2026-10-29 (JR accepted the recommendations in § 6). Tier 1 is built: see
§ 9. Tiers 2 and 3 are designed here and wait for a first organisation that needs them.

## 1. The use cases

Two kinds of group keep showing up. Neither fits "one public catalog plus individual apps":

- **A community around a topic.** For example, developers, city staff and civic groups building
  apps over New Haven's open data. The four civic case studies
  (`packages/lattice-server/examples/civic-case-studies/RESULTS.md`) found that they share
  places, sources, readiness notes and join results as much as vocabulary. They want to see the
  group's work in one place, steer its vocabulary, and hear what the group's builders searched
  for and didn't find. They do not want a separate system.
- **An organisation with its own sub-lattice.** A platform (Boating Systems), a makerspace, or a
  city IT department. Each has conventions of its own (naming, required classifications, who
  may add a context), some vocabulary that should never be public, and a portfolio of apps it
  wants audited together. Today such an organisation can register apps and get a portfolio
  report, but it cannot set conventions, keep anything private, or run its own catalog with a
  clear relationship to the public one.

## 2. What exists today

| Piece | Status | Where |
|---|---|---|
| Contexts (`skos:ConceptScheme`) with `parentContexts` | built | `specs/mcp-tools.md` § lattice_publish_context |
| Discover filtered to contexts (`contexts: [...]`) | built | `src/discover/discover.ts` |
| Reserved contexts, excluded from discover unless asked for (governance) | built | `src/server/instance.ts` |
| App registry with `unit` and `owner`; portfolio, app and mesh reports | built | `src/registry/registry.ts` |
| Key tiers: `low`, `contributor`, `operator` (contributor may create contexts) | built | `src/server/principals.ts` |
| Demand report of unmet searches | built, catalog-wide only | `lattice_demand_report` |
| Vocabulary packs per context | built | `/pack/{context}` |
| Public sources by jurisdiction, place profiles | built | `/sources`, `/place` |
| Evidence ledger: claims need independent sources | built (phase 1) | `specs/evidence-ledger.md` |
| Domain shards: physical partitions, `shard` argument on publish, launch shards `marine`, `iot`, `civic` | **specified, not built** | REQUIREMENTS § R3, ROADMAP § 3 |
| Multi-instance federation | **deferred to v0.2+** | DECISIONS § Infrastructure |
| One URI authority for every instance; local designs keep their URI when pushed | **by design** | `specs/uri-scheme.md` § Local-server behavior |

### A correction about identity

An earlier review called the hard-coded authority (`BASE_AUTHORITY`, `src/hashing/hash.ts`) a
collision risk for self-hosted instances. It is not. URIs are content hashes, so two instances
cannot mint the same URI for different content. The shared authority is what lets a concept
designed on a private instance keep its URI when it is published publicly. The real gaps are
narrower:

1. **Where to resolve.** A URI minted on a private instance and never pushed does not resolve at
   schemalattice.com. A manifest's `lattice` field names the instance a project uses, but
   nothing tells a third party that a URI is held privately.
2. **What stays private.** Nothing marks a context as never-to-be-published, so a later
   "publish up" could leak it.

## 3. Three tiers

The tiers are in order of cost. Each one is useful without the next.

### Tier 1: a community on the public instance

A **community** is a named, stewarded view over the public catalog: a set of contexts, the apps
that opted in, the sources in its jurisdictions, and the people who look after it. It holds no
data of its own. Everything stays in the public catalog, so nothing forks.

```jsonc
// a community record (new)
{
  "slug": "new-haven-civic",
  "title": "New Haven civic data",
  "charter": "Apps and data about New Haven's places, services and government. …",
  "contexts": ["civic-issue-reporting", "civic-legislation", "property", "place-reference"],
  "jurisdictions": ["US-CT/new-haven", "US-CT"],
  "stewards": ["app:ward-watch", "person-key:…"],
  "conventions": "optional: a link to the community's naming and data-handling notes"
}
```

What it gives the group, all built from things that exist:

- `/community/{slug}`: member apps, the community's contexts and recent concepts, its sources
  and their health, the mesh matrix between member apps, and joins tested so far.
- **Its own demand report:** unmet searches that named one of its contexts or came from member
  apps. This is the community's backlog.
- **Its own pack** (`/pack/community/{slug}`) and a discover filter (`community: "…"`, shorthand
  for its context list).
- **Stewards** can create contexts inside the community without operator help (a scoped
  contributor tier). They can also curate readiness notes for its sources, and see the
  community's evidence-ledger claims early, as reviewers rather than deciders.

New code: a `communities` table, `communities: []` on app registration, the page, and the
filters. **No new storage model.** This answers the civic case directly.

### Tier 2: an organisation's sub-lattice on the public instance

This tier is a community whose contexts are **owned**: only the organisation's keys publish into
them, and the organisation sets conventions that publishing enforces for those contexts:

- naming rules (a slug prefix, required `altLabel`s);
- required field classifications, or a required `conceptKind`;
- a required external match beyond the catalog-wide rule;
- who may create contexts under its root.

This is what R3 calls a shard, minus the physical partition. R3 gives each shard its own SQLite
file, vector segment and blob directory. That only matters for replication and federation,
which are deferred. **Proposal: re-scope R3 as logical shards** (an owned root context plus
conventions) and leave physical partitioning until federation needs it. The `shard` argument
on publish becomes "the owning root context", which `inScheme` already implies.

Visibility stays public at this tier. An organisation that needs private vocabulary goes to
tier 3.

### Tier 3: a private organisation instance

The organisation runs the same server itself, the way DECISIONS already allows ("users run
their own instance"). What makes it a sub-lattice rather than a disconnected copy:

- **Upstream search.** The private instance is configured with `upstream:
  https://schemalattice.com`. Its discover merges its own results with the public catalog's,
  each tagged with where it came from. Builders inside the organisation see one ranked list.
  Upstream calls are ephemeral, so private search wording never reaches the public demand
  report.
- **Private contexts.** Contexts flagged `private` never leave the instance. Records in other
  contexts can be **published up**: replayed to the public instance under an organisation key.
  Their URIs are unchanged, because they are content hashes.
- **Resolution hints.** Manifests already name their `lattice`. Add an optional per-concept
  `heldBy` when a URI is private, so a third party knows why it doesn't resolve publicly
  instead of assuming it is broken.
- **The registry stays local.** The organisation's apps, units, attestations and portfolio
  reports never leave its instance.

This is hub-and-spoke: each private instance looks up to the public one. Peer-to-peer
federation stays deferred, as DECISIONS says. The cost is real but bounded:
- an upstream client in discover;
- a `private` flag checked by publish-up;
- a publish-up command (the client's `publish` already replays records by URI);
- a self-hosting guide.

## 4. How the tiers relate

```
public instance (schemalattice.com)
├── catalog: contexts and concepts, one URI space
├── tier 1  community "new-haven-civic"   = view + stewards over public contexts
├── tier 2  org "boating-systems"         = community + owned contexts + enforced conventions
└── apps, sources, evidence (as today)

private instance (acme.example)  ── upstream search ──▶  public instance
├── private contexts (never leave)
├── other contexts ── publish up (same URIs) ──▶  public catalog
└── acme's own registry, portfolio, attestations
```

A group can move up the tiers without breaking anything. Contexts and URIs stay as they are,
because both are content-addressed and every tier shares one URI space.

## 5. What it would cost the lightweight goal

Communities add one optional discover argument and no new MCP tools; the community page is
plain HTTP. A private instance's MCP lists the same profiles (`specs/mcp-tools.md` § Tool
profiles). The client's lookups work against it through `SCHEMALATTICE_URL`. Nothing in this
spec adds to an agent's default context.

## 6. Decisions (2026-10-29)

1. **Build communities (tier 1) now.** Only the operator creates a community at first.
2. **Stewards' powers.** A steward (an app the operator names) may edit its community's title,
   charter, contexts, jurisdictions and conventions. It may also create a context inside the
   community without contributor tier. Stewards review evidence about the community's concepts
   (the report lists it), but never decide what the evidence ledger promotes. Only the operator
   changes who the stewards are.
3. **R3 is re-scoped.** Physical shards become logical ones: an owned root context plus
   conventions (tier 2). The launch-shard list (`marine`, `iot`, `civic`) is dropped; `civic`
   is a community.
4. **Private vocabulary (tier 3) waits for a first organisation that asks.** The self-hosting
   guide is written now (`packages/lattice-server/deploy/README.md` § Running your own
   instance).
5. **Publishing up never carries a private reference.** Publish-up will refuse a record whose
   `broader`, `forkedFrom` or field references point into a private context.

## 7. Documents updated

- REQUIREMENTS § R3 and ROADMAP § 3: shard model, launch shards.
- DECISIONS § Infrastructure: "single-instance" gains "hub-and-spoke private instances".
- `specs/uri-scheme.md`: `heldBy` and the private-context rule, when tier 3 is built.
- `packages/lattice-server/deploy/README.md`: a self-hosting section (tier 3).
- `skills/schemalattice/SKILL.md`: one line on `--community` once it exists.

## 8. Proposed order

1. Decide § 6.
2. Tier 1 communities: table, registration field, `/community/{slug}`, community demand report
   and pack, discover filter. Seed `new-haven-civic` from the civic case studies.
3. The self-hosting guide, stating what a private instance is and is not today.
4. Tier 2 conventions on owned contexts, as the R3 replacement, when a first organisation needs
   them. Boating Systems is the likely first.
5. Tier 3 upstream search, private flag and publish-up, when a first organisation asks.

## 9. What tier 1 built

- `src/registry/communities.ts`: the `communities` and `community_members` tables, plus the
  permission rules (operator creates, steward edits, only the operator names stewards).
- Tools:
  - `lattice_publish_community` (write, in the `publish` profile);
  - `lattice_community_report` (read, in the `reports` profile; lists communities when given no
    slug);
  - `community` on `lattice_discover`, `lattice_demand_report` and `lattice_publish_context`;
  - `communities` on `lattice_register_app`.
- A community's unmet searches are those asked with its name or filtered to one of its
  contexts. Attributing searches by their nearest concept was tried and dropped on the first
  live run: an unmet search is far from every concept, so its nearest one is noise. Discover events now record their context filter and
  community.
- Pages: `/community` and `/community/{slug}` (markdown), and `GET /discover?community=`. The
  pack is `/pack/{its contexts}`. The client and skill accept `discover --community <slug>`.
- Test: `test/communities.ts` (`npm run smoke:communities`).
