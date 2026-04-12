# Spec: Test Harness

**Status:** Locked for v0.1. Additions to scenarios and evaluation
dimensions are welcome; the runner contract is stable.

## Goal

Build an evaluation harness that runs many iterations of
AI-designing-schemas-against-SchemaLattice, captures the full run,
and scores how well the system performed. The harness is how we
iterate on the skill, the MCP tools, and the protocol without
tuning blind.

## Why harness-first

Most AI systems are built by shipping a first version and then
adjusting prompts until it "feels better." That approach is
invisible, unrepeatable, and drifts. A test harness reverses this:

- **Every change is measurable.** Tweak the skill, re-run the
  harness, see the score delta.
- **Regressions are caught.** A change that improves one scenario
  but breaks another is visible immediately.
- **New ideas are testable.** Proposing a new checkpoint or tool
  can be validated by adding scenarios that would benefit.
- **Debugging is cheap.** When something goes wrong in a real use,
  you can add the failing case to the harness and pin it.

## Architecture

```
Scenarios (JSON files)
    ↓
Scenario Runner
    ↓
Captured Run (transcript + artifacts + state)
    ↓
Evaluator (mechanical + LLM judge)
    ↓
Scorecard
    ↓
Aggregate Report
```

Four components, each small:

- **`packages/lattice-evals/scenarios/`** — JSON files defining
  test cases
- **`packages/lattice-evals/runner/`** — invokes Claude Code with
  the skill loaded, submits the scenario prompt, captures output
- **`packages/lattice-evals/evaluator/`** — scores a captured run
  against its scenario's rubric
- **`packages/lattice-evals/reporter/`** — aggregates scores across
  runs into a readable report

## Scenario format

Each scenario is a JSON file under `scenarios/`. Schema:

```json
{
  "id": "scuba-greenfield-01",
  "name": "Greenfield scuba dive logger",
  "description": "Empty project, user asks AI to design a scuba dive tracking schema. Lattice starts empty; AI should discover (nothing) → JIT mine → originate.",
  "mode": "mock" | "live",
  "initialState": {
    "projectFixture": "fixtures/empty-ts-project/",
    "latticeState": "seed-empty.json",
    "existingManifest": null
  },
  "userPrompt": "I'm building a scuba club app. Help me design the data model for tracking individual dives — depth, duration, gas mix, site, buddies.",
  "expectedFlow": {
    "shouldCall": ["lattice_discover", "lattice_publish_concept"],
    "mayCall": ["lattice_resolve", "lattice_publish_fork", "lattice_stats"],
    "mustNotCall": [],
    "shouldProduceFiles": ["schemalattice.json"],
    "shouldEmitMarkers": true
  },
  "mockResponses": {
    "lattice_discover": [
      { "match": {"description": "*dive*"}, "response": { "results": [] } }
    ]
  },
  "rubric": {
    "dimensions": [
      {
        "name": "protocol-compliance",
        "weight": 0.3,
        "checks": [
          "called lattice_discover before creating any concept",
          "ran checkpoint 1C refined re-discover before originating",
          "attempted JIT mining (checkpoint 1D) after 1C returned empty",
          "published all originated concepts",
          "updated schemalattice.json with returned URIs"
        ]
      },
      {
        "name": "schema-quality",
        "weight": 0.4,
        "llmJudge": true,
        "criteria": "The produced DiveLog schema should include: depth or maxDepth, some duration representation, location/site reference, gas mix, participant/buddy reference. Extra relevant fields are a plus; missing these core fields is a deduction."
      },
      {
        "name": "jit-mining-quality",
        "weight": 0.2,
        "llmJudge": true,
        "criteria": "If JIT mining was invoked, the cited sources should be real, public, and related to scuba or dive logging. Fabricated URLs are a critical failure."
      },
      {
        "name": "code-annotation",
        "weight": 0.1,
        "checks": [
          "schemalattice.json is valid JSON matching the v1 schema",
          "every URI in the manifest has the correct format",
          "inline markers (if present) reference existing manifest entries"
        ]
      }
    ]
  },
  "notes": "This is the baseline greenfield case. Expected total score: >80 for a working skill."
}
```

### Required fields

- `id` — unique identifier, lowercase-kebab
- `name` — human-readable short title
- `description` — what the scenario tests and expected behavior
- `mode` — `"mock"` or `"live"` (see Modes below)
- `initialState` — starting conditions
- `userPrompt` — the natural-language request to submit to the agent
- `rubric` — how this run is scored

### Optional fields

- `mockResponses` — only required in mock mode; canned responses for
  each lattice tool
- `expectedFlow` — declarative checkpoint expectations
- `notes` — freeform for humans

## Mock mode vs live mode

**Mock mode** runs without a real SchemaLattice server. The runner
intercepts every MCP tool call and returns canned responses from the
scenario's `mockResponses` block. Use mock mode when:

- Testing the skill's protocol compliance in isolation
- Iterating on the skill before the server exists
- Running fast, reproducible unit-style tests
- Validating that a scenario's expected flow triggers the right tools

**Live mode** runs against an actual SchemaLattice instance started
fresh per scenario (or reset to a seed state). Use live mode when:

- End-to-end integration testing
- Validating embedding/discovery behavior on real server
- Catching bugs that only appear with real storage and real MCP
  transport
- JIT mining — mock mode can't validate that the AI actually found
  real repos because there's no real external world

The harness defaults to mock mode for speed. A CI run would typically
execute all scenarios in mock mode every commit, and all live-mode
scenarios nightly or on-demand.

## Scenario runner contract

The runner's job for each scenario:

1. **Set up isolated environment.**
   - Create a temp directory
   - Copy the `projectFixture` into it (if specified)
   - Initialize or reset the scratch SchemaLattice state per
     `initialState.latticeState`
   - Write the `existingManifest` if provided

2. **Invoke Claude Code** as a subprocess with:
   - The lattice-workflow skill loaded
   - MCP config pointing at either the mock interceptor (mock mode)
     or the scratch lattice instance (live mode)
   - Working directory set to the temp project
   - Session ID unique per run

3. **Submit the user prompt** as the first message in the session.

4. **Capture everything:**
   - Full transcript (user + assistant messages, interleaved)
   - Every tool call with parameters and responses
   - Every file created, modified, or deleted in the project
     directory
   - Final state of the scratch lattice (what concepts exist,
     what relations were created)
   - Wall-clock duration
   - Any errors

5. **Write the capture to `runs/{scenario-id}/{timestamp}/`.**
   Directory contents:
   ```
   runs/scuba-greenfield-01/2026-04-12T15-22-33/
     scenario.json        (copy of the scenario)
     transcript.jsonl     (per-message log)
     tool-calls.jsonl     (per-tool-call log)
     files-changed.json   (diff of project directory)
     lattice-state.json   (final state of scratch lattice)
     manifest.json        (final schemalattice.json from project)
     metadata.json        (timing, tool counts, errors)
   ```

6. **Exit cleanly**, leaving the temp directory in place for the
   evaluator.

The runner is stateless with respect to other runs. Parallel execution
is supported via per-run directories.

## Evaluator contract

For each captured run, the evaluator produces a scorecard:

```json
{
  "scenarioId": "scuba-greenfield-01",
  "runTimestamp": "2026-04-12T15:22:33Z",
  "dimensions": [
    {
      "name": "protocol-compliance",
      "weight": 0.3,
      "score": 0.95,
      "details": [
        {"check": "called lattice_discover before creating any concept", "passed": true},
        {"check": "ran checkpoint 1C refined re-discover before originating", "passed": true},
        {"check": "attempted JIT mining (checkpoint 1D) after 1C returned empty", "passed": true},
        {"check": "published all originated concepts", "passed": true},
        {"check": "updated schemalattice.json with returned URIs", "passed": false,
         "reason": "Manifest missing 'DiveSite' entry despite concept being published"}
      ]
    },
    {
      "name": "schema-quality",
      "weight": 0.4,
      "score": 0.85,
      "llmJudgeNotes": "DiveLog includes depth (as maxDepth), duration (as bottomTimeMinutes), site reference, gas mix. Missing: buddy reference. Otherwise strong.",
      "details": { "judgeModel": "claude-opus-4-6", "judgeTemperature": 0.0 }
    },
    ...
  ],
  "totalScore": 0.87,
  "passed": true,
  "passThreshold": 0.70
}
```

### Evaluator dimensions

**Mechanical dimensions** — programmatic checks against the captured
run. Fast, deterministic, no AI cost.

- Protocol compliance: did the AI call the expected tools in the
  expected order?
- Manifest validity: is `schemalattice.json` parseable and
  schema-conformant?
- URI validity: do all URIs in the manifest match the canonical form?
- Marker consistency: do inline markers (if any) reference entries
  in the manifest?
- File changes: did the AI create the expected files?

**LLM judge dimensions** — evaluated by a separate Claude call with
a structured rubric. Slower, costs tokens, but can assess subjective
quality.

- Schema quality: does the produced schema have the right fields for
  the domain?
- Decision quality: were adopt/fork/originate choices reasonable given
  the candidates returned?
- JIT mining quality: are cited sources real and relevant?
- Code quality: is the generated code correct and idiomatic?

The LLM judge receives: the scenario, the captured transcript, the
produced artifacts, and a rubric. It returns a score 0.0–1.0 per
dimension plus reasoning.

**Human review** — a periodic sample (say, 10%) of runs is
hand-reviewed to calibrate the LLM judge. If the judge scores a run
95% but a human rates it 40%, the judge's rubric or prompt needs
adjusting.

## Seed scenarios for v0.1

Ship the harness with at least these six scenarios:

1. **`scuba-greenfield-01`** — Empty project, empty lattice, user
   asks for a scuba dive log. Expected flow: discover returns
   nothing → 1C refined → 1D JIT mine from open-source dive loggers
   → originate.

2. **`makerspace-retrofit-01`** — Fixture containing a snapshot of
   the `lending_library` Drupal module, user asks "add SchemaLattice
   to this project." Expected flow: scan code → multiple discover
   calls → mix of adopt (for generic concepts like Member), fork
   (for domain-specific ones), originate (for novel ones like
   Battery).

3. **`cousin-app-01`** — Fixture with an existing
   `schemalattice.json` containing scuba-ops concepts. User asks
   to build a freediving log app. Expected flow: discover finds
   scuba DiveLog → fork to FreediveLog with changeset (no gas mix,
   add apnea-specific fields), adopt Goal, etc.

4. **`duplicate-detection-01`** — Fixture where the lattice already
   has `DiveLog`. User asks to create "underwater activity log."
   Expected: discover surfaces DiveLog above 0.85, AI should fork
   (not originate a duplicate). This scenario deliberately tests
   whether the skill's decision tree handles close matches
   correctly.

5. **`no-domain-match-01`** — User asks for a schema in a very
   specific niche with no existing lattice coverage and likely
   sparse open-source coverage (e.g., "mycology spore print
   tracking"). Tests graceful degradation of JIT mining — does the
   AI cite what it finds, or fabricate?

6. **`cross-context-integration-01`** — Two fixture projects with
   existing manifests. User asks "how would these two apps share
   data?" Tests Checkpoint 3B (reconcile preview). Mock mode only
   in v0.1; live mode needs the v0.2 `lattice_reconcile` tool.

Each seed scenario lives as a JSON file under
`packages/lattice-evals/scenarios/`. The repo ships with them; new
contributors add their own by dropping new JSON files in.

## Running the harness

CLI invocation:

```bash
# Run all scenarios in mock mode
lattice-evals run --mode mock

# Run a specific scenario in live mode against localhost
lattice-evals run scuba-greenfield-01 --mode live --lattice http://localhost:7000

# Run every scenario in live mode and produce a report
lattice-evals run --mode live --report reports/2026-04-12.md
```

Output: a directory of captured runs plus a single aggregate report.
The report summarizes pass/fail counts, score distributions per
dimension, and lists the worst failures for attention.

## Iteration loop

The practical workflow once the harness is running:

1. Run the full suite in mock mode (fast, cheap).
2. Look at the failures. Each failure is a specific, reproducible
   case where the skill or protocol fell short.
3. Identify the root cause: is the skill unclear? Is a checkpoint
   missing? Is a tool description inadequate?
4. Make the minimal change.
5. Re-run the suite. Confirm the target scenarios improved and
   nothing else broke.
6. Periodically run the full suite in live mode to catch issues that
   mock mode can't see.

When shipping a new version of the skill or specs, run the full
suite and record the aggregate score as part of the release notes.
This is the receipt that says "v0.2 is not a regression."

## Known harness gaps (v0.1)

### Multi-turn user interaction

Scenarios where the AI is meant to pause and ask the user for
approval or clarification cannot be tested end-to-end in mock mode
v0.1. The runner sends one user turn at the start and then captures
the tool-use loop until it ends. If the model stops without calling
a tool (for example, to wait for user input), the runner interprets
this as "done" and writes the capture.

**Workaround for v0.1:** scenarios that involve approval gates
should pre-authorize the action in the initial user prompt. Use
language like "I've already authorized you to proceed without a
pre-publish approval pause — just do it and summarize at the end."
This tells the model it doesn't need to pause, which matches what
the harness can actually observe.

**v0.2 enhancement:** a `userResponses` field on scenarios would
let the runner supply canned responses when the model asks
questions. Something like:

```json
"userResponses": [
  {
    "whenAssistantSays": "approve",
    "reply": "Yes, proceed with the plan."
  }
]
```

The runner would detect when the model stops without a tool call
AND emits text containing the trigger, then synthesize a next user
turn with the canned reply and continue the loop. This is a real
feature we want but it adds complexity — deferred to v0.2.

## What the harness is NOT

- **Not a production load test.** The harness tests correctness of
  behavior, not performance of the server under load. A separate
  load test belongs in `packages/lattice-server/bench/`.
- **Not a security test.** Input validation and auth tests are
  separate concerns.
- **Not a proof of safety.** The harness scores typical behavior on
  representative scenarios. It does not guarantee absence of bad
  behavior on adversarial inputs.

## Open questions deferred to implementation

- **Subprocess interface for Claude Code.** The exact mechanism for
  invoking Claude Code non-interactively from the runner is
  implementation-dependent. Options: CLI with `--non-interactive`
  flag, HTTP API if available, SDK call. Pick what works and document
  in the runner's README.
- **LLM judge model choice.** Claude Opus 4.6 is the default; smaller
  models may be cheaper for mechanical-ish dimensions. Benchmark this
  when implementing.
- **Scenario generation at scale.** The v0.1 seed set is hand-written
  (~6 scenarios). v0.2 may include an LLM-assisted generator that
  produces variations. Not in v0.1 scope.
