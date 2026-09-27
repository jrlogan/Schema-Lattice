---
name: lattice-workflow
description: Use when working in a project that is or should be integrated with SchemaLattice (schemalattice.com). Triggers on the presence of schemalattice.json in the project tree, mentions of "lattice"/"schemalattice"/"publish to lattice", or when the user asks to design schemas, make an app interoperable, discover existing schemas, or compare two apps' data models.
---

# SchemaLattice workflow skill

You are working in a project that may interact with SchemaLattice, a
shared catalog of data model concepts at `schemalattice.com`. This
skill tells you when to consult the lattice and how to annotate your
output so future tools can trace your work. Follow it whenever you
are designing, modifying, or reading data model code and the lattice
MCP server is available.

## On activation

1. Check for `schemalattice.json` at the project root (or
   `.schemalattice/manifest.json`). If found, read it into working
   context — it is your source of truth for which local short names
   map to which lattice concept URIs.
2. If not present and the user is creating a durable local schema that
   benefits from concept lineage, create
   the manifest with minimum fields:
   ```json
   {
     "$schema": "https://schemalattice.com/schema/manifest-v1.json",
     "lattice": "https://schemalattice.com",
     "project": { "name": "<project-name>" },
     "concepts": {}
   }
   ```
3. Resolve the lattice host, in this order:
   1. **MCP tools.** If `lattice_*` tools are in your tool list, use
      them; the host is whatever the MCP server is configured for.
   2. **Manifest.** The `lattice` field of `schemalattice.json`
      names the instance this project publishes to.
   3. **Environment.** A `LATTICE_URL` environment variable, or a
      host the user gives you directly.
   4. **REST fallback.** Any lattice instance serves the same tools
      over plain HTTP — no MCP configuration needed:
      - `GET {host}/api/tools` — the full tool list with schemas
      - `POST {host}/api/tools/{name}` — call a tool (JSON body =
        tool arguments; writes need `Authorization: Bearer <key>`)
      - `GET {host}/discover?description=...&sessionId=...` — read
        convenience route
      - `GET {host}/health` — is it up, and how big is the catalog

   If none of these yields a reachable host, pause and ask the user
   where their lattice instance is before proceeding. Do NOT invent
   URIs or pretend the lattice exists if you can't reach it.

   Note on hosts vs URIs: canonical concept URIs are ALWAYS
   `https://schemalattice.com/c/...` regardless of which host serves
   them — the URI is a stable identifier, not a live URL. To fetch a
   record, take the URI's path and request it from the host you
   resolved above. Never treat a failure to dereference
   `schemalattice.com` itself as the catalog being down.

4. **Keep one sessionId for the whole working session.** Every
   `lattice_discover` response returns a `sessionId` (yours echoed
   back, or a server-minted one if you omitted it). Publishing is
   gated on evidence of a prior discover under the SAME id — so
   capture it from your first discover call and pass it to every
   later discover and publish call. Discovering without a sessionId
   and publishing with a fresh one will be rejected
   (`ERR_NO_PRIOR_DISCOVER`).

## Getting write access

Reads never need a key: discover, resolve, list, and every report are open.
Writes need one, and you can issue yourself one — no human approval, no waiting.

1. Call `lattice_register_app` with your app's slug, name, unit, owner, and
   status (`concepts` may be an empty array on the first call). It returns
   `apiKey` **exactly once**. Store it; the server keeps only a hash and can
   reissue but never recover it.
2. Send it as `Authorization: Bearer <key>` on every write call.
3. Re-registering the same slug later updates your manifest in place, and
   requires that key. A slug someone else registered is refused
   (`ERR_APP_NOT_YOURS`) — pick your own rather than adopting theirs.

A self-issued key is **low tier**, which is graded by blast radius, not by
seniority:

| | low (self-serve) | contributor (promoted) |
|---|---|---|
| `lattice_publish_fork` | unlimited | unlimited |
| `lattice_publish_concept` | small daily budget | unlimited |
| `lattice_publish_context` | denied | allowed |

Forking is never budgeted, deliberately: it carries lineage, so it is the move
you should be making when you are unsure. If you hit `ERR_ORIGINATE_BUDGET`,
that is the signal to look harder for a parent to fork — not to wait out the
window. `ERR_TIER_TOO_LOW` on a context means publish into an existing one; a
context is a namespace the whole catalog inherits, so ask the operator rather
than working around it.

Nothing here relaxes the quality gates. Every writer, operator included, passes
the same friction checks — prior discover, root ancestry, definition quality,
external match. Tiers govern *how much* you can do, never *how good it has to
be*, and every write is recorded against the app that made it.

## The core loop (Checkpoints 1A → 2B)

### When the app uses an existing backend

First read the backend's published API discovery, versioned wire schema,
authentication and capability documentation. Those contracts determine what
the app can read or write. Use the lattice to choose and explain concepts in
the app's own model and at its integration boundaries; a similarity score is
never evidence that a backend accepts a field or grants an operation.

Keep three things distinct in the result: the user's source data, the app's
local representation, and the backend's accepted payload. Show the mapping
between them, including units, provenance, uncertainty, and omitted fields.
Validate a proposed payload against the backend's schema and use its preview
or dry-run operation before any commit, when available. If a concept is
missing from the lattice, that does not block a supported backend operation.
Search and record the gap, then continue under the backend contract. Do not
publish a new concept, register an app, or send private records to the
catalog merely because the user is building an interface.

When modeling any persistent or cross-boundary data structure:

1. **Checkpoint 1A.** Call `lattice_discover` with a natural-language
   description of what you're about to build. Include the apparent
   domain (e.g., "scuba diving session tracker" not just "session").
   Query text is recorded and unmet queries appear, aggregated, in
   the public demand report; if the user is exploring something they
   aren't ready to share even in that form, pass `ephemeral: true` —
   the search still works and still counts as publish evidence, but
   the wording is never stored.
2. **Checkpoint 1B.** For the top 1–3 candidates, call
   `lattice_resolve` to read full details. You need field-level info
   to decide adopt vs fork.
3. Apply the decision tree (full detail in
   `specs/ai-checkpoints.md`):
   - **Exact match (≥0.85)** → adopt the existing URI
   - **Close match (0.65–0.85)** → fork with an explicit changeset
   - **Distant match (0.55–0.65)** → resolve and decide case-by-case
   - **No match (<0.55)** → **Checkpoint 1C**: re-run discover with
     a refined description. If still nothing, proceed to
     **Checkpoint 1D**: search open-source projects (GitHub, package
     registries, the open web) for existing work in the same domain.
     Read 2–5 promising repositories' data models directly. Synthesize
     a draft concept from what you find. Only originate after you've
     honestly attempted this mining step.
4. **Checkpoint 2A.** Execute the decision via the correct tool.

   **Before calling any publish tool, ensure you have a valid
   context URI.** Concepts cannot be published into thin air; they
   must live in a context (ConceptScheme). You get a context URI
   by one of three paths:
   - It was returned by `lattice_discover` or `lattice_resolve`
     against an existing concept whose `inScheme` you can reuse.
   - You found it via `lattice_list_context` when browsing the
     catalog for related domains.
   - **No suitable context exists yet** — in that case, call
     `lattice_publish_context` FIRST with a domain-generic slug
     (scuba-ops, trail-ops, volunteer-ops, equipment-lending — NOT
     app-specific like my-scuba-club-app), a short title, and a
     definition. **Prefer broader slugs over narrower ones** when
     multiple domain-generic options are defensible. For example,
     `equipment-lending` is better than `makerspace-lending`
     because the same vocabulary can then serve boat clubs,
     dive shops, community tool libraries, and community gardens
     in addition to makerspaces. The goal is cross-domain reuse;
     pick the slug that maximizes that reuse without being so
     broad as to be meaningless. Use the returned URI as the `contextUri` in your
     subsequent publish call. **Never invent a context URI** —
     if you find yourself writing a URL with `/contexts/` or
     `/s/some-slug` without a `@hash` suffix, stop and call
     `lattice_publish_context` instead.

     **Parent context URIs:** the `parentContextUris` parameter is
     OPTIONAL. Only include it if you have verified the parent
     contexts exist — either because you just saw them in a
     `lattice_discover` or `lattice_list_context` response, or
     because you found them in an existing `schemalattice.json`
     manifest. **If you have not verified them, omit the field
     entirely.** A missing parent list is always correct; a
     fabricated one is a protocol violation. Do not construct
     plausible-looking URIs like
     `https://schemalattice.com/s/activity-log@1.0.0` just
     because a parent "ought to" exist.

   Then:
   - **Adopt** — no publish tool call; record the existing URI in
     `schemalattice.json` under a local short name with
     `status: "adopted"`
   - **Fork** — call `lattice_publish_fork` with `parentUri` and a
     changeset describing fields added, removed, renamed, retyped,
     wrapped, unwrapped, nested, hoisted, or extended. Record the
     returned URI with `status: "forked"`.
   - **Originate** — call `lattice_publish_concept` with the full
     structure. If Checkpoint 1D produced cited sources, include
     them in `sourceAttribution.inspiredBySources` with notes on
     what was borrowed from each. Record with `status: "originated"`.
     If the server returns a duplicate warning, reconsider and
     prefer fork unless the match is genuinely wrong.

   **Canonical `structure` shape** for an entity concept:
   ```json
   {
     "kind": "entity",
     "fields": [
       { "name": "maxDepth", "type": "number", "unit": "meters", "required": true },
       { "name": "diveSite", "type": "reference", "ref": "scuba-ops/DiveSite" },
       { "name": "buddies", "type": "array", "itemType": "string" },
       { "name": "buddyContact", "type": "string", "classification": "personal-contact" }
     ]
   }
   ```
   For enumerations:
   ```json
   {
     "kind": "enum",
     "values": [
       { "id": "available", "label": "Available" },
       { "id": "borrowed", "label": "Borrowed" }
     ]
   }
   ```
   Do not use ad-hoc shapes; other tools will fail to parse them.
5. **Checkpoint 2B.** In the code implementing the concept, add an
   inline marker tag `[lattice:SHORT_NAME]` adjacent to the class,
   struct, or schema declaration. For very small projects (<10
   concepts) this step is optional — the manifest alone is enough.

## Retrofitting an existing codebase

When the user asks to add SchemaLattice to a project that already
has data models:

1. Scan the project's data models. Identify candidate concepts.
   Include: entity classes, database schemas, form definitions,
   API request/response types, configuration record types. Exclude
   pure view models and UI-only structures.
2. For EACH candidate, run Checkpoints 1A and 1B. Do not batch
   publish decisions — evaluate one concept at a time.
3. Unless the user has pre-authorized in the initial request,
   present the full plan before publishing: "I found N concepts.
   Plan: adopt X, fork Y, originate Z. Approve?" List the rationale
   for each decision.
4. After approval (or pre-authorization), publish in dependency
   order (parents before children). Update the manifest after each
   successful publish so partial failure leaves a useful state.
5. Add inline markers only to classes the user explicitly wants
   annotated. Err on the side of fewer markers; the manifest is
   enough for traceability.
6. Commit the manifest and any inline markers together as a single
   logical change the user can review.

### Attribution for retrofit: local source is primary

When extracting concepts from a user's own project, the attribution
rules are different from Checkpoint 1D JIT mining. The project IS
the authoritative source, not an adjacent reference.

Required on every publish call during retrofit:
- **`sourceAttribution.authoredBy`** — the project's author(s) or
  organization, extracted from the module's info.yml, package.json,
  composer.json, LICENSE, README byline, or git history. If you
  cannot determine authorship, use the repository owner's name or
  the module's `package:` field as a fallback. Do not leave empty.
- **`sourceAttribution.sourceNotes`** — a short phrase identifying
  the source of this concept, e.g., "Extracted from MakeHaven
  lending_library Drupal module" or "Derived from Django models.py
  in example-org/inventory-app". Do not leave empty.
- **`sourceAttribution.sourceLicense`** — the SPDX license
  identifier from the project's LICENSE file if present. Use
  `"custom"` or `"proprietary"` if the project is custom-developed
  without an OSI license.

`inspiredBySources` is separate and optional: use it if you also
consulted adjacent open-source projects via Checkpoint 1D JIT mining
to inform naming or structure. `inspiredBySources` and
`authoredBy`/`sourceNotes` can both be populated on the same publish
call — they describe different relationships to the concept.

**Why this matters:** a published concept without authorship cannot
be credited back to its origin, which breaks the lattice's value
proposition of discoverable real-world vocabularies. Empty
`authoredBy` on a retrofit concept is a protocol violation.

## Reading an unfamiliar project (Checkpoint 3A)

When you open a file in a project you haven't seen:

1. Check whether `schemalattice.json` exists at the root or any
   ancestor directory. If yes, load it.
2. Optionally search for `[lattice:` markers in the files you're
   reading: they reveal which parts of the code are lattice-bound
   and which are local.
3. When the user asks questions about data models, answer in terms
   of the lattice concepts those models reference. "This DiveLog
   is a fork of `activity-log/Session` that adds underwater-specific
   fields" is more useful than "This DiveLog has these fields."
4. If a file has dangling `[lattice:SHORT_NAME]` markers — tags
   whose short names aren't in the manifest — flag this to the user.
   It indicates the manifest is out of sync with the code.

## Comparing two projects (Checkpoint 3B, reconcile preview)

If the user brings in a second project and wants them to interop:

1. Load both projects' `schemalattice.json` files.
2. Find concepts that **share URIs** → directly compatible.
3. Find concepts where one is `forkedFrom` the other → traversable
   via lineage, compatible with changeset awareness.
4. Find concepts that share a **common ancestor** (walk `forkedFrom`
   chains) → compatible at the ancestor's level.
5. Find concepts linked by `coRefersWith` → same real-world referent,
   different perspective. Report as "related but not interchangeable."
6. Find concepts with no relationship → report as non-translatable.
   This is not a failure — it is an honest outcome.

Note: the full `lattice_reconcile` tool ships in v0.2. For v0.1,
perform this comparison by walking the manifests manually using
`lattice_resolve` calls.

## Classify what you're building with `conceptKind`

Every concept you publish (originate or fork) SHOULD carry a
`conceptKind` field identifying what kind of thing it is. Values:

- `entity` — a persistent thing with identity and state
  (LibraryItem, Vessel, Tool, Member's profile record)
- `event` — something that happens at a point in time (Dive,
  LibraryTransaction, Inspection, Shift)
- `classification` — a label, enum, status taxonomy, or tag
  (ItemStatus, DiveType, MembershipTier)
- `workflow` — a process definition with states/transitions
  (LendingLifecycle, DivePlanExecution)
- `measurement` — a numeric quantity with units (Depth,
  Duration, Pressure, Cost)
- `agent` — a person, organization, or system that can act
  (Member, DiveMaster, Staff, SensorNode)
- `place` — a physical location (Marina, DiveSite, Trailhead)

If the concept plausibly fits multiple kinds, pick the one most
prominent in its usage. A `Battery` is `entity` even though it
has a state; a `Dive` is `event` even though it produces data.

The v0.1 root skeleton (16 abstract parent concepts seeded at
server boot; see `specs/root-skeleton.md`) uses these values
consistently. Every domain concept should be traceable to one
skeleton node via `broader` / `forkedFrom` eventually.

## Classify sensitive fields

Any structure field that stores information about a person, secrets
that grant access, or restricted organizational information SHOULD
carry a `classification` naming one of the reserved data-sensitivity
classes (seeded in the `governance` context):

`public` · `internal` · `confidential` · `personal-contact` ·
`personal-identity` · `personal-financial` · `personal-health` ·
`personal-minor` · `access-secret`

Rules of thumb:

- An email, phone number, or address tied to a person →
  `personal-contact`. Medical notes, allergies, waivers →
  `personal-health`. Anything about someone under the age of
  majority → `personal-minor` (it stacks on top of the others; use
  the minor class when in doubt).
- Passwords, tokens, door codes → `access-secret`. Note this is not
  the skeleton's `Credential` (an earned qualification) — secrets
  grant access; credentials attest ability.
- Unsure which class fits? Call `lattice_discover` with a description
  of the field's contents — the classes are indexed and the right one
  will surface.
- Leaving a field unclassified is allowed (it shows up as a coverage
  gap in sensitivity profiles, not an error), but an unknown
  classification value is rejected at publish.
- Classification is part of the concept's hashed identity:
  reclassifying a field is a semantic change that produces a new
  version. Do not adjust classifications casually.

The lattice records sensitivity; it does not enforce handling. If the
organization runs separate build-time gates (security review, privacy
check), record their results using the shared
`governance/attestation` record shape rather than inventing a new
result format. See `specs/data-classification.md`.

## When the catalog comes up empty

An empty or sparse catalog is expected early — concepts enter it
because someone needed them, not through upfront seeding. If your
discover calls keep landing below 0.55:

- Your queries were still recorded. Call `lattice_demand_report`
  (or `POST {host}/api/tools/lattice_demand_report`) to see unmet
  demand clustered across all sessions — including other projects
  that searched for the same thing and found nothing. Two projects
  independently asking for the same missing concept is a strong
  signal it's worth publishing properly.
- Tell the user what the report shows before originating en masse.
  Sixteen "no match" results against a near-empty catalog is a
  publish queue to review with a human, not a license to originate
  sixteen concepts unprompted.

## After a comparison run

When you finish checking an app against the catalog (Checkpoint 3A/3B
style), consider two closing moves:

- Show the user the demand report so they see whether other projects
  were missing the same vocabulary.
- Optionally call `lattice_feedback` with one short note: what the
  catalog helped with, what was confusing, what was missing. No key
  needed; it goes to the maintainers only and is not redistributed.
  Ask the user first if the note would describe their project.

## When to skip the lattice entirely

Do not call the lattice for:

- Pure view models, form state, or UI-specific types that never
  persist and never cross app boundaries
- Private helper types used only inside a module
- Standard library types (Date, UUID, Money)
- Scratch code the user explicitly flagged as throwaway

## When you are uncertain

If the decision between adopt / fork / originate is not clear from
the similarity scores alone:

- **Prefer fork over originate** when the parent concept has healthy
  adoption (call `lattice_stats` to check adoption count). Forking
  preserves lineage and makes your work discoverable to future apps
  in the same domain.
- **Originate** is a stronger claim ("nothing like this exists") and
  should be a considered choice, not a default.
- **Ask the user** when the decision is close. Present the top 2–3
  candidates with their adoption counts and let them choose.

## Never

- Never invent a lattice URI of any kind — concept, context, or
  lens. Every URI must come from either a server response or an
  existing manifest. If you need a context that doesn't exist,
  call `lattice_publish_context` to create one; do not write a
  plausible-looking URL in a publish call and hope.
- Never edit a URI in place in `schemalattice.json`. If a concept
  needs to change, publish a new version and update the reference.
- Never skip Checkpoint 1C (the final-description re-check) before
  originating. This is the most common source of false
  originations.
- Never skip Checkpoint 1D (open-source fallback mining) when
  originating a concept that could plausibly have open-source
  analogs. The only acceptable reason to skip 1D is that the
  concept is too specific to have analogs.
- **Never fabricate source URLs for inspiredBySources.** If JIT
  mining finds no relevant sources, document that honestly in
  `sourceNotes` and leave `inspiredBySources` empty. Inventing
  URLs is a protocol violation worse than omitting them entirely.
- Never emit inline markers whose short names are not in the
  manifest. A dangling reference is worse than no reference.
- Never copy definition text verbatim from GPL or other copyleft
  source READMEs. Paraphrase in your own words and set
  `sourceLicense` accordingly.

## Reference files in this repo

- `specs/ai-checkpoints.md` — full protocol with all six checkpoints
- `specs/annotation-standard.md` — sidecar and marker syntax
- `specs/mcp-tools.md` — exact tool schemas and parameter shapes
- `specs/changeset-format.md` — fork op vocabulary
- `specs/uri-scheme.md` — URI form for reference when parsing
