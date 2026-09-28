# Spec: Evidence Ledger

**Status:** Phase 1 (match feedback) implemented in
`packages/lattice-server/src/evidence/ledger.ts`, tested by
`test/evidence.ts`. Phases 2–3 are draft. It is
the "governance / endorsement / social signal" item README defers to
v0.2, narrowed to one question: how can the catalog learn from people
and AIs who use it, without logins and without letting spam in?

## The problem

Today the catalog learns in two ways. Unmet discover queries show up
in the demand report, and keyed publishers mint concepts and forks.
Neither captures most of what users actually find out:

- "For this query, the top result was wrong. It means something else."
- "CiviCRM `contact.email` maps to Network Member `email`."
- "Nexus Organization and HSDS Service Provider are the same referent."
- "Everyone who forks Trip adds a `crew` field."

These are small, structured and cheap to state. They are also exactly
what an attacker would forge, and a lattice full of forged links is
worse than one with none. This spec lets anyone submit such claims,
holds them in quarantine, and turns them into catalog behaviour only
once enough independent, hard-to-fake evidence agrees.

## Principles

1. **Evidence, not records.** Anonymous input never mints a concept.
   Concepts are content-addressed and permanent (`hashing-rules.md`),
   so anything minted by mistake is minted forever. Claims live in a
   mutable ledger outside the hashed catalog and can always be deleted.
2. **Links change; concepts don't.** Promoted evidence becomes a
   weighted link in a separate link layer, the way SKOS mapping sets
   sit beside concept schemes. Resolve and discover read that layer.
   Concept records never change.
3. **Unforgeable beats numerous.** A claim that can be checked
   against something the server can see outweighs any number of
   claims that can't. Quarantine by time alone stops drive-by spam,
   not a patient attacker.
4. **Proposals only for new structure.** Evidence can suggest a fork
   or a concept. Minting it stays with a keyed publisher, under the
   existing gates.
5. **Private by default.** Submitting evidence is always an explicit
   act. Nothing a builder keeps private (field maps of custom
   fields, record contents, query wording from ephemeral sessions) is
   collected as a side effect.
6. **Everything is visible.** Pending, promoted and retracted
   evidence all appear in a public report, like unmet demand does now.

## Evidence kinds

Each kind has one JSON shape, one way to check it, and one effect
when promoted. Kinds ship in phases (see "Phases").

### `match` — a discover result was right or wrong (phase 1)

```json
{
  "kind": "match",
  "sessionId": "sess-…",
  "conceptUri": "https://schemalattice.com/c/civic-issue-reporting/issue-report@…",
  "verdict": "wrong",
  "reason": "different-referent",
  "note": "Issue Report is a civic complaint, not a boat trip"
}
```

- `verdict`: `right` (resolved, then adopted or forked from it) or
  `wrong` (resolved, then rejected).
- `reason` when wrong: `different-referent`, `too-broad`,
  `too-narrow`, `wrong-domain`.
- **Check:** the server must have returned `conceptUri` in a discover
  response for that `sessionId`. That makes the claim unforgeable in
  the way that matters: you can only judge a result you were shown.
  Claims failing the check are rejected at once, not quarantined.
- **Promoted effect:** see "Discover" under "What promotion changes".

### `field-mapping` — a source field corresponds to a concept field (phase 2)

```json
{
  "kind": "field-mapping",
  "source": { "system": "civicrm", "version": "5.x", "field": "contact.email" },
  "target": { "conceptUri": "https://schemalattice.com/c/entrepreneur-support/network-member@…", "field": "email" },
  "conversion": "identity",
  "artifact": "https://github.com/example/nexus-civicrm/blob/main/schemalattice.json"
}
```

- Accepted only for **public source schemas**: a system listed in the
  public-systems register (CiviCRM core, Drupal core, Salesforce
  standard objects, HSDS, schema.org), or a source backed by a public
  `artifact`. Custom fields of a private system are refused with an
  explanation. This is the privacy line from the builder brief.
- **Check:** the target field must exist in the concept's structure.
  If `artifact` is given, the server fetches it (HTTPS, size-capped,
  once, cached) and confirms it contains a matching `fieldMaps`
  entry (`annotation-standard.md` § Field maps).
- **Promoted effect:** a `maps-to` link, served on resolve. The
  second partner on the same CRM starts from it.

### `co-reference` — two concepts name the same referent (phase 3)

```json
{ "kind": "co-reference", "a": "https://…/ecosystem-organization@…", "b": "https://…/service-provider@…", "note": "…" }
```

- **Check:** both URIs resolve; they are not in the same fork lineage
  (that relation already exists); structural overlap and definition
  similarity pass a floor (as for `lattice_publish_concept`
  duplicate warnings).
- **Promoted effect:** a `co-refers` link, shown on both concepts.
  The permanent `coRefersWith` on a record still requires a new
  version by its publisher. The link layer is how the catalog knows
  before the publisher acts.

### `missing-field` — a concept lacks a field its users need (phase 3)

```json
{ "kind": "missing-field", "conceptUri": "https://…/trip@…", "field": { "name": "crew", "type": "array", "itemType": "reference" }, "note": "…" }
```

- **Check:** the field is not already present, and the shape is a
  valid structure field.
- **Aggregation:** by concept plus a normalized field name (case,
  separators, plural/singular) plus type family.
- **Promoted effect:** a **fork candidate** in the evidence report,
  addressed to the concept's publishing app (visible in its
  `lattice_app_report`). Forks already published by other apps that
  add the same field count as evidence automatically, and those
  count as strong.

## Submitting: `lattice_propose`

```typescript
{
  claim: MatchClaim | FieldMappingClaim | CoReferenceClaim | MissingFieldClaim;
  sessionId?: string;       // required for match; recommended otherwise
}
→ {
  id: string;               // evidence id
  status: "pending" | "rejected";
  reason?: string;          // why rejected, when it was
  corroboration: { independentSources: number; needed: number; earliestPromotion: string };
}
```

- **Not key-gated.** It can create nothing in the catalog, only a
  ledger row. An app key, if sent, is recorded as the source (see
  "Source weight").
- **Rate limit:** its own bucket `evidence`, 20 per minute per IP,
  plus a daily cap per network prefix. Evidence past the cap is
  refused, not queued.
- **Idempotent:** the same source submitting the same claim again
  refreshes its timestamp but never counts twice.
- **Limits:** `note` up to 500 characters, stored for maintainers.
  The public report shows it truncated, with the same untrusted-data
  notice the demand report carries.

## Sources and independence

The whole design rests on counting **independent** sources, so this
is the part to get right.

A **source** is identified by the strongest identity available:

| Identity | How | Weight |
|---|---|---|
| Verified artifact | the claim's `artifact` fetched and confirmed; source = artifact's host + owner (e.g. `github.com/example`) | 3 |
| Established app | app key whose app is ≥30 days old and has ≥1 published concept or registered usage | 2 |
| New app | any other app key | 1 |
| Anonymous | salted hash of the network prefix (/24 for IPv4, /48 for IPv6) | 1 |

- The salt is a server secret, so the ledger never stores a plain IP
  or prefix. It is not rotated: independence has to be judged across
  weeks.
- **Weights never stack within one source.** Ten sessions from one
  prefix are one anonymous source, and fifty anonymous prefixes all
  submitting within an hour are held for review (see "Abuse").
- A source can hold at most one live claim per claim key. A later
  opposite claim (right, then wrong) replaces the earlier one.

## Scoring and promotion

Claims are grouped by a **claim key**: the kind plus its normalized
identifying fields (e.g. `match|conceptUri|wrong|queryCluster`).

```
support    = Σ weight over distinct sources asserting the claim
opposition = Σ weight over distinct sources asserting its negation
score      = support − 1.5 × opposition          (disagreement costs more than agreement earns)
```

A claim key is **promoted** when all of these hold:

1. at least 7 days since its first claim (the quarantine);
2. `score ≥ 5`;
3. at least 3 distinct sources, of which at least one is not anonymous
   (an app or a verified artifact);
4. its structural check still passes (the concept still exists; the
   field is still absent, for `missing-field`).

So three anonymous networks alone never promote anything. Two
established apps plus one anonymous network do (2 + 2 + 1 = 5).

A promoted key is **retracted** if the score later falls below 2, or
if an operator retracts it. Claims older than 180 days count at half
weight, so a stale consensus can be overturned by current use.

Thresholds are server configuration, reported in the evidence
report, and start conservative. The first months of real data should
tune them.

## What promotion changes

### Discover

- A concept with promoted `wrong` evidence **for queries like this
  one** gets a `caution` on its result: `{ "reason": "different-referent",
  "sources": 4 }`. "Like this one" means the new query's embedding is
  within 0.85 cosine of the centroid of the queries the claims came
  from.
- Only non-ephemeral sessions contribute to query centroids.
  Ephemeral sessions promised never to store wording, and an
  embedding of that wording is not stored either. Their `match`
  claims count only toward per-concept totals, which are shown but
  never used for ranking.
- **Ranking moves are bounded.** A promoted `wrong` lowers that
  result's effective similarity by at most 0.05, and promoted `right`
  evidence raises it by at most 0.02. `verdict` bands are computed on
  the raw score, so evidence can never turn a no-match into an adopt.
  Every adjusted result shows its raw and adjusted scores.

### Resolve

A new `links` section, clearly separate from the record:

```json
"links": {
  "note": "Evidence-derived and mutable; not part of the concept's content-addressed record.",
  "coRefers":  [{ "uri": "…", "sources": 5, "promotedAt": "…" }],
  "mapsFrom":  [{ "system": "civicrm", "field": "contact.email", "toField": "email", "sources": 4 }],
  "forkCandidates": [{ "field": "crew", "type": "array", "sources": 6 }]
}
```

### Reports

- `lattice_evidence_report`: pending (with corroboration progress),
  promoted and retracted claims by kind; public, like the demand
  report.
- `lattice_app_report` gains the fork candidates and wrong-match
  cautions for the app's own concepts. That makes the publisher the
  natural reviewer.

## Abuse model

| Threat | Mitigation |
|---|---|
| One actor, many sessions | independence is per network prefix and per app, not per session |
| Distributed spam (many prefixes) | anonymous-only claims never promote (rule 3); bursts of new anonymous sources on one key within an hour freeze that key for operator review |
| Sybil apps (self-registered keys) | new apps weigh 1, the same as anonymous; "established" needs 30 days plus real published or registered usage |
| Judging results never shown | `match` claims must reference a result the server returned to that session |
| Fake artifacts | fetched and checked; the source is the artifact's owner, so one owner with many repos is one source |
| Ranking manipulation | bounded adjustments; verdict bands on raw scores; raw and adjusted both shown |
| Contradiction wars | opposition weighs 1.5×; promotion and retraction are logged; operator can freeze a key |
| Private data leaking in | field mappings only from public schemas; notes are truncated and marked untrusted in public reports; ephemeral wording never stored |
| Operator overload | only frozen keys need a human; everything else follows the rules above |

The worst case this design accepts is that a determined, patient
attacker with several established apps, or several real public
repositories, gets a wrong link promoted. The damage stays bounded
and fixable: a mutable, labelled link with its evidence visible, and
at most a 0.05 ranking move. It is never a permanent record.

## Operator controls

- Per-kind kill switch (stop accepting, stop applying, or both).
- Freeze, unfreeze or retract any claim key, with a logged reason.
- Thresholds and weights live in configuration, not code.
- Purge a source: remove all of one source's claims and re-score.

## Data model

As built for phase 1 (`src/evidence/ledger.ts`):

```sql
CREATE TABLE evidence (             -- the source of truth for this layer
  id TEXT PRIMARY KEY,
  claim_key TEXT NOT NULL,          -- match|<conceptUri>|<cluster>; cluster "*" = ephemeral, totals only
  kind TEXT NOT NULL, subject TEXT NOT NULL,
  cluster TEXT NOT NULL,            -- id of the claim that anchors the query cluster
  polarity INTEGER NOT NULL,        -- +1 wrong, -1 right
  source TEXT NOT NULL,             -- 'app:slug' | 'operator' | 'net:<salted hash of /24 or /48>'
  resolved INTEGER NOT NULL,        -- the session resolved the concept before judging it
  claim TEXT NOT NULL,              -- the JSON claim
  query_vec BLOB,                   -- non-ephemeral sessions only
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (claim_key, source)
);
CREATE TABLE claim_state (          -- derived; one row per claim key AND direction
  state_key TEXT PRIMARY KEY,       -- <claim_key>#wrong | #right
  claim_key TEXT, direction TEXT,
  status TEXT,                      -- pending | promoted | retracted | frozen | operator-retracted | totals-only | rejected
  score REAL, sources INTEGER, first_at TEXT, changed_at TEXT, reason TEXT
);
CREATE TABLE evidence_links (       -- derived; what discover reads
  subject TEXT, state_key TEXT, direction TEXT,
  centroid BLOB,                    -- mean query vector of the promoting claims
  reason TEXT, sources INTEGER, promoted_at TEXT,
  PRIMARY KEY (subject, state_key)
);
CREATE TABLE evidence_meta (key TEXT PRIMARY KEY, value TEXT);   -- salt, operator switches
```

Weights are **not stored**: `rescore()` computes each row's weight from
the source's current standing (an app becomes "established" over
time), whether it resolved first (×0.5 if not) and its age (×0.5 after
180 days). A claim is "right" and "wrong" at once in the sense that
each direction is scored separately, with the other as its opposition.

`rescore()` runs after every submission, on every report, and hourly
in the server process (the quarantine is time-based). It is
idempotent; operator decisions (`frozen`, `operator-retracted`) are
the only state it never overwrites.

The ledger is not part of the catalog's content-addressed source of
truth and is backed up with the database (daily disk snapshots).

## Changes to existing behaviour

- **Discover logs every returned URI** (today it logs only the top
  one), together with the session. This is required for `match`
  checks, and useful regardless.
- **Resolve logs the sessionId** when one is sent, so `right` and
  `wrong` claims can show a resolve happened before the verdict.
  Match claims without a prior resolve are accepted but weigh half:
  judging from the summary alone is weaker evidence.
- **Builder brief and workflow skill:** after deciding on a
  candidate, send a `match` claim. It is one call, and it is how the
  next builder gets better results.

## Phases

1. **Match feedback.** Discover and resolve logging; `lattice_propose`
   with `match` only; scoring; discover cautions; evidence report.
   Fixes this catalog's first real problem (civic concepts ranking
   for boating queries) with the cheapest, least forgeable claim.
2. **Field mappings from public schemas.** The public-systems
   register; artifact verification; `mapsFrom` on resolve. First
   target: CiviCRM → Entrepreneurship Nexus.
3. **Co-reference and missing fields.** The link layer's `coRefers`;
   fork candidates in app reports; published forks counted as
   evidence.

Each phase ships with smoke tests that play an attacker: many
sessions from one prefix, many anonymous prefixes, new apps,
and claims about results never shown. Each attack must fail to
promote.

## Open questions

- **Query clusters for `match`:** is a 0.85 centroid radius right for
  this embedding model? Calibrate on real claims, as the discover
  bands were.
- **Weight of registered usage:** a platform that registers a usage of
  a concept is adopting it. Should that count as `right` evidence
  automatically? It is strong and hard to fake, but it would let
  large registries dominate.
- **Federation:** when instances federate (v0.2+), whose evidence
  counts where? This spec assumes one instance.
- **Payment for trust:** skipped deliberately. Nothing here should
  require money or identity documents to take part.
