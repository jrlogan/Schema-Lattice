---
name: schemalattice
description: Before modelling a durable data type (a record, entity, table or schema that persists or crosses app boundaries), check whether it already exists — in this project and in the SchemaLattice catalog (schemalattice.com) — and reuse it instead of inventing it again. A lightweight alternative to the SchemaLattice MCP server.
---

# SchemaLattice, without MCP

A shared catalog of data concepts. Use it to find prior work before you model a durable type,
and to name things the way other apps already do. It is advice, never a gate: if a command
fails or the lattice is unreachable, say so once and carry on with the project's own schemas.

Every command below runs `schemalattice.mjs`, the zero-dependency client next to this file
(Node 20+). Output is compact by design; add `--json` for the raw response.

## When to use it

- About to add a new schema, collection, table or type that persists or crosses an app
  boundary: yes.
- Changing fields on a type that already exists, view models, form state, helpers, throwaway
  code: no.

## The loop

1. **This project first.** If the project has `schemalattice.config.json` with an `inventory`,
   run `node <client> similar "<what the record holds and what it is for>"`, then once more
   with different wording. It ranks the project's own schemas, published or not, and marks
   0.70+ with ▶. Read those: extend one, or say in your PR why the new type is different.
   (Projects that vendor the client often wrap it: `npm run lattice:similar -- "…"`.)
2. **Then the catalog.**
   `node ~/.claude/skills/schemalattice/schemalattice.mjs discover "<the record, in a sentence>"`
   prints a verdict, a session id, and ranked concepts:
   - **adopt** (≥0.85): resolve it and use its meaning and field names.
   - **fork** (0.65–0.85): close. Resolve it; if it means the same thing, model yours as a
     variant of it and keep its names where they fit.
   - **distant** (0.55–0.65): decide by meaning, not score.
   - **no-match**: rephrase once, then model it yourself.
   Narrow with `--context <slug>` (`contexts` lists them), or `--community <slug>` when you
   build within a community, such as a city's civic apps (https://schemalattice.com/community
   lists them).
3. **Read before deciding.** `… resolve <uri> --session <id>` shows the definition, lineage
   and fields.
4. **Say whether it was right.** `… propose <session> <uri> right` or
   `… propose <session> <uri> wrong different-referent|too-broad|too-narrow|wrong-domain`.
   One call, anonymous and quarantined. It is how the next builder gets better results.

Searches are ephemeral by default (not recorded). Pass `--record` when the query is public
schema vocabulary and you want unmet needs to show up in the catalog's demand report.

## Never

- Invent a concept URI. Every URI comes from a command's output or the project's
  `schemalattice.json`.
- Send records, personal data or credentials. Describe the *kind* of record, not its contents.
- Treat a score as permission. The project's own schema, and a backend's published contract,
  decide what is valid.

## Going further (read only when the task needs it)

- Publishing your own vocabulary, retrofitting a codebase, comparing two projects:
  `https://schemalattice.com/skill` (the full workflow; long).
- Building on someone else's backend: `https://schemalattice.com/skill/builder`.
- Publishing a platform's schema from its code: the client's README, `https://schemalattice.com/cli/README.md`.
- Public datasets (endpoints, join keys): `https://schemalattice.com/sources`.
- MCP instead: `https://schemalattice.com/mcp` lists 5 tools by default (about 1,100 tokens);
  `?profile=publish|sources|reports|api|contribute|all` adds more.
