# Trail Team × PlacePrize bounty pilot

## The job

Trail Team (volunteer trail stewardship, Firebase backend) and PlacePrize
(a photo-verified prize service) are negotiating an integration. Trail
Team organizers open a bounty on a trail issue and take the before photos.
Anyone can claim the bounty in PlacePrize's app, where a sealed camera
takes the after photo. PlacePrize's referee judges it against a written
done-spec and pays the claimer. Verdicts and payouts come back to Trail
Team by webhook.

The question for SchemaLattice: would the catalog have helped two
parties write this contract, and what would make it help more?

## Live catalog, 2026-09-30

Read-only `GET /discover?ephemeral=true` against schemalattice.com:

| Description | Top result | Similarity | Verdict |
|---|---|---|---|
| A reported problem at a public place that needs fixing | `civic-issue-reporting/issue-report` | 0.654 | fork |
| A cash bounty paid to whoever completes a task, verified by photo | `public-procurement/contract-award` | 0.584 | distant |
| A photo with provenance evidence of when and where it was captured | `civic-issue-reporting/issue-report` | 0.596 | distant |
| A volunteer trail maintenance workday | `equipment-maintenance/maintenance-event` | 0.570 | distant |

The one real match, Issue Report, is a good fork parent. It was mined
from FixMyStreet, and its context's definition names Open311. But its
only external anchor is `schema:CreativeWork`, and its lifecycle is
`state: string`.

## Experiment

`npm run demo:trail-team` in `packages/lattice-server` imports the live
Issue Report (and its context) into a throwaway local instance, then:
forks it into a Trail Issue, originates a Bounty, compares the two
issues, and tries some deliberate typos. Nothing is published to
schemalattice.com.

### Baseline (before this branch)

- Discovery found Issue Report for the steward's description: verdict
  `fork`, similarity 0.674. The adopt/fork/originate loop worked.
- Bounty had no match (top result `Credential`, 0.471), so it had to be
  originated. The only approved external match that fit at all was
  `schema:MonetaryGrant`, which is a stretch.
- The fork published with **no warnings**, though its structure carried
  invented `lifecycle` and `provenance` keys with no shared meaning.
- A concept with `provenance: "seald-capture"`, a lifecycle whose
  `initial` was not a declared state, a transition to `"dun"`, and
  `closeMatch: ["schema:Thing"]` **also published with no warnings**.
- There was no way to show the two parties what the fork changed, other
  than reading the changeset ops.

### After

- `lifecycle`, `immutableFrom` and `provenance` are defined
  (`specs/lifecycle-and-provenance.md`). Every typo above is refused with
  guidance. The script's own first draft used `sealed-capture`, which is
  not a class, and was refused until corrected to `attested-capture`.
- The fork warns that it also changes `beforePhotos` (provenance) and adds
  a lifecycle, neither of which changeset ops can express.
- `schema:Thing` as the only anchor now returns a `weak-external-match`
  advisory.
- `lattice_compare` produces the table the negotiation needed:

| Field | Issue Report | Trail Issue | Change |
| --- | --- | --- | --- |
| latitude | number · public | number · public | same |
| longitude | number · public | number · public | same |
| postcode | string · public | — | only Issue Report |
| category | reference · public | reference · public | same |
| title | string · public | string · public | same |
| detail | string · public | string · public | same |
| photo → beforePhotos | binary · public | binary[] · public · provenance: device-captured | renamed (type, provenance) |
| state → status | string · public | string · public | renamed |
| reporter | reference · internal | reference · internal | same |
| anonymous | boolean · public | boolean · public | same |
| bodies | reference[] · public | — | only Issue Report |
| created | dateTime · public | dateTime · public | same |
| afterPhotos | — | binary[] · public · provenance: attested-capture | only Trail Issue |
| siteId | — | reference · public | only Trail Issue |
| segmentIds | — | reference[] · public | only Trail Issue |
| resolutionNote | — | string · public | only Trail Issue |
| workLog | — | array · internal | only Trail Issue |

With summary lines: a fork with 10 ops, not upgradable; 8 fields the
same, 2 renamed, 2 dropped, 5 added; only Trail Issue grades capture
provenance; only Trail Issue declares a lifecycle (4 states).

## Findings

1. **The hard part was meaning, and it moved.** During the real
   negotiation, who gets paid flipped twice, "spotting a dry tree" became
   "watering it", and the "evidence package" became a "bounty package".
   A content-addressed catalog would have minted a permanent URI for each
   revision. *Deferred:* negotiation drafts (see DECISIONS).
2. **The most useful artifact was a diff for people.** A hand-written
   "PlacePrize today vs this proposal" table did more work in the
   negotiation than any schema. *Built:* `lattice_compare`.
3. **The contract is behavior.** It came down to the lifecycle and its
   webhook events, a done-spec frozen once the pool opens, and which role
   vouches for a photo. *Built:* `lifecycle`, `immutableFrom`, `vouchedBy`.
4. **Provenance is the crux of evidence-based integrations, and it was
   missing.** *Built:* four capture-provenance classes, separate from
   data sensitivity.
5. **Catch-all anchors defeat the external-match rule.** *Built:* a
   `weak-external-match` advisory. *Deferred:* a way to anchor to
   non-RDF standards (Open311, C2PA).
6. **Structural analogues were found but labelled weak.** Maintenance
   Schedule (a recurring duty, due by time or by use) really is a model
   for scheduled watering, and Contract Award is structurally a bounty.
   *Deferred:* structural discovery.
7. **Two-party value is small; platform value is the case.** With one
   partner that has no API yet, a plain OpenAPI spec would have been
   written either way. The lattice pays off when a platform publishes its
   concepts for many unknown builders. In this pilot that is Trail Team,
   which intends to be API-first. The negotiating parties also avoided
   naming future third parties, so the many-party benefit is real but
   rarely said aloud.

## Next experiment

Have a builder agent write PlacePrize's adapter twice, once from an
OpenAPI spec alone and once with the spec annotated by these concepts
(`lattice_compare` output included). Compare correctness and the
questions each run had to ask.
