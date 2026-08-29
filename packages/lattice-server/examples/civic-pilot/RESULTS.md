# Civic pilot: five real apps against the live lattice (2026-08-29)

Question: does the catalog get stronger as it's used? Method: clone five
respected open-source civic projects, and for each — in sequence — play the
role of its developer's AI running the checkpoint protocol against the live
instance over HTTPS: discover every core entity (1A), refine wording when
results look off (1C), resolve candidates before deciding (1B), then
adopt / fork-with-changeset / originate (2A), and register the app (R4).
Every concept published carries `importedFrom` + `inspiredBySources`
attribution to the repo it was mined from, per the JIT-mining rules.

Apps, in order: **FixMyStreet** (street issues), **Alaveteli** (FOI),
**Consul Democracy** (participation), **CKAN** (open data),
**HSDS/Open Referral** (human services standard).

## The compounding effect

Verdict of each app's Checkpoint-1A survey at the moment it arrived:

| app (catalog size at arrival) | adopt | fork | distant | no-match |
|---|---|---|---|---|
| FixMyStreet (26, empty of domain) | 0 | 0 | 1 | 5 |
| Alaveteli (32) | 0 | 2 | 2 | 2 |
| Consul (37) | 0 | 2 | 2 | 2 |
| CKAN (43) | 0 | 2* | 3 | 0 |
| HSDS (48) | 0 | 0 | 4 | 1 |

\* found via 1C refinement — the first phrasings missed.

Re-running every app's original day-one queries against the finished
catalog (53 concepts):

| app | day-one | today |
|---|---|---|
| FixMyStreet | 5 no-match / 1 distant | **1 adopt / 5 fork / 0 no-match** |
| Alaveteli | 2 no-match / 2 distant / 2 fork | **1 adopt / 5 fork / 0 no-match** |
| Consul | 2 no-match / 2 distant / 2 fork | **6 fork / 0 no-match** |

A sixth developer building a *permit tracker* (a domain none of the five
covers) already gets `Applicant → Resident Account @ 0.675 (fork)` and
useful neighbors for every other entity.

## What the graph now shows

- **7 fork bridges across apps** — e.g. Civic Body (FixMyStreet) →
  Public Authority (Alaveteli) → Data Publisher (CKAN): three apps'
  views of "a government body", connected by validated changesets that
  v0.2 reconciliation can walk.
- **The account lineage**: Resident Account → Requester Account →
  Portal Account, plus Verified Resident — four platforms' user models
  in one tree instead of four islands.
- **First real `coRefersWith`**: HSDS's Service Provider ↔ Alaveteli's
  Public Authority — the same real-world organization seen as helper
  vs. as answerable authority. The relation the spec was built around,
  used for its intended purpose.
- **Compatibility scores from structure alone**: alaveteli↔fixmystreet
  0.42 via fork links, with zero manually declared mappings.
- Registry audits flag every app's `access-secret` fields (passwords,
  API tokens) as unattested — correct and useful noise.

## Honest limitations observed

1. **Top-1 is not always the right concept.** Re-run, "a formal freedom
   of information request…" ranks Public Authority (0.784) above its own
   Information Request. Checkpoint 1B (resolve before deciding) is not
   optional, and the skill says so.
2. **Similarity can't see category errors.** Consul's Geozone hit Civic
   Body at 0.660 — fork band, wrong kind entirely (a district is a
   place, not an organization). 1B caught it; the developer originated
   under `location` instead.
3. **The demand report is historical.** It still lists "a published
   dataset…" as unmet because those events predate the Dataset concept.
   Improvement queued: re-score cluster representatives against the
   current index and mark now-met clusters as absorbed.
4. Wording matters a lot at this catalog size: two 1C refinements
   changed verdicts from no-match to fork. Expected at 53 concepts;
   should soften as density grows.

## Reproducing

`driver.py` holds the HTTP client (needs `LATTICE_API_KEY` in the
environment for publishing; discovery needs no key). The per-app publish
calls are recorded in this session's history; concepts live under
contexts `civic-issue-reporting`, `public-records-requests`,
`civic-participation`, `open-data-catalog`, `human-services`.
