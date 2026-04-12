# SchemaLattice Evaluation Harness

Scenario-based evaluation for the SchemaLattice AI protocol. Lets you
iterate on the `lattice-workflow` skill and spec changes against real
scored runs instead of guessing whether things got better.

**Status:** v0.1 — mock mode only. Live mode ships with the server.

## What it does

For each scenario JSON file, the runner:

1. Loads the SchemaLattice skill from `../../skills/lattice-workflow.md`
2. Presents it as a system instruction to Gemini via `@google/genai`
3. Submits the scenario's user prompt as the first user message
4. Intercepts every tool call the model makes, matches it against
   the scenario's `mockResponses`, and returns a canned response
5. Loops until the model stops calling tools (or hits a safety cap)
6. Captures the full transcript, every tool call with inputs and
   mocked outputs, and metadata to a timestamped run directory

Mock mode does not write files or contact real services. It exists
to test the skill's protocol compliance before the server is built.

## Setup

Requires Node.js 20 or newer and a Google Gemini API key.

```bash
cd packages/lattice-evals
npm install
export GEMINI_API_KEY=...
```

**Why Gemini and not Claude?** The SchemaLattice protocol is meant
to be model-agnostic. Running evaluations on Gemini is actually
*stronger* validation than running on Claude, because any behavior
that depends on model-family-specific training quirks shows up as
a failure. The tool schemas in `tool-schemas.ts` are provider-neutral
and converted to Gemini's `FunctionDeclaration` format at runtime,
so adding another provider (OpenAI, Anthropic, etc.) later is a
small adapter change, not a rewrite.

## Running a scenario

```bash
npx tsx run-scenario.ts scenarios/scuba-greenfield-01.json
```

Or via the npm script:

```bash
npm run run:scuba
```

Output lands in `runs/scuba-greenfield-01/{timestamp}/`:

- `scenario.json` — copy of the scenario being run
- `transcript.json` — full message history
- `tool-calls.json` — ordered list of tool calls with inputs
  and mocked responses
- `metadata.json` — iteration count, tool call count, duration,
  whether the run finished normally
- `summary.txt` — human-readable run summary

## Reading a run

Start with `summary.txt` — it prints the tool-call sequence as a
short narrative. Compare to the scenario's `expectedFlow` block:

- Did the model call `lattice_discover` first?
- Did it re-run with refined terms (Checkpoint 1C)?
- Did it attempt JIT mining (`web_search` + `fetch_url`) after
  discover returned empty?
- Did it publish at the end?

`tool-calls.json` gives you the full parameter payloads; use it
when you need to see exactly what the model sent.

## Iteration loop

1. Run a scenario, read the summary.
2. Find where the model's behavior deviates from the protocol.
3. Edit `../../skills/lattice-workflow.md` to clarify the
   instruction the model missed.
4. Re-run the scenario. See if it improved.
5. When satisfied, run every scenario in the suite to confirm
   nothing else regressed.

This is how you tune the skill content against real runs instead
of guessing.

## Scenario format

See `../../specs/test-harness.md` for the full schema. Essentials:

- **`userPrompt`** — the natural-language request submitted to the AI
- **`mockResponses`** — canned responses per tool, keyed by tool name.
  Each entry has an optional `match` pattern and a `response` payload.
- **`expectedFlow`** — which tools should, may, or must not be called
- **`rubric`** — scoring dimensions (weights + criteria)

### Mock response matching

For each tool call, the runner walks the entries under that tool
name and returns the first whose `match` pattern is satisfied:

- `"match": {}` — matches any input (use as fallback at end of list)
- `"match": {"query": "*dive*"}` — matches if `query` contains
  "dive" (case-insensitive substring; `*` at both ends means "contains")
- `"match": {"uri": "https://..."}` — exact equality

If no entry matches, the runner returns a `{"error": ...}` response
and the model sees it as a tool failure.

## What's deliberately not in v0.1

- **LLM judge evaluator.** v0.1 captures runs; scoring is manual or
  done by a separate script later.
- **Aggregate reporter.** Each run stands alone.
- **Live mode.** Requires a working SchemaLattice server; that's a
  separate package.
- **Parallel runs.** One scenario at a time.
- **File-system capture.** Mock mode does not simulate file writes.
  The transcript tells you what the AI said it would write.

These arrive as the harness proves its value.

## Model selection

Default model is `gemini-2.5-flash` — free-tier accessible, fast, and
sufficient for protocol-following tests. Override via environment
variable:

```bash
LATTICE_EVAL_MODEL=gemini-2.5-pro npx tsx run-scenario.ts scenarios/scuba-greenfield-01.json
```

Recommended models to try:

- `gemini-2.5-flash` — default, works on free tier, fast iteration
- `gemini-2.5-pro` — stronger reasoning, requires paid tier
- `gemini-2.0-flash` — cheapest fallback if 2.5-flash hits quota

A typical scenario runs for 10–20 tool-call iterations. If the skill
works on Flash it will work on Pro — start with Flash and only escalate
to Pro when investigating a specific failure you suspect is
model-capability-related.
