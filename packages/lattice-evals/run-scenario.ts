/**
 * SchemaLattice evaluation harness — scenario runner (mock mode, Gemini).
 *
 * Reads a scenario JSON file, loads the lattice-workflow skill as a
 * system instruction, runs the model through a tool-use loop with
 * mocked tool responses, and captures the full run to
 * runs/{id}/{timestamp}/.
 *
 * Usage:
 *   npx tsx run-scenario.ts scenarios/scuba-greenfield-01.json
 *
 * Environment:
 *   GEMINI_API_KEY      (required)
 *   LATTICE_EVAL_MODEL  (optional, default gemini-2.5-flash)
 *
 * Provider-neutral note: tool-schemas.ts stores the tool definitions
 * in a provider-agnostic shape. This runner converts them to Gemini's
 * FunctionDeclaration format at load time. Adding OpenAI or Anthropic
 * support later is a matter of adding a second converter and a small
 * provider switch.
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { allTools, type ToolSchema } from "./tool-schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Scenario types
// ============================================================

interface MockResponseEntry {
  match?: Record<string, unknown>;
  response: unknown;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  mode: "mock" | "live";
  userPrompt: string;
  expectedFlow?: {
    shouldCall?: string[];
    mayCall?: string[];
    mustNotCall?: string[];
  };
  mockResponses?: Record<string, MockResponseEntry[]>;
  rubric?: unknown;
  notes?: string;
}

interface ToolCallRecord {
  iteration: number;
  name: string;
  input: unknown;
  mockResponse: unknown;
  matched: boolean;
}

// Gemini API shapes we care about — kept loose to tolerate SDK variation.
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role?: "user" | "model";
  parts: GeminiPart[];
}

// ============================================================
// Entry point
// ============================================================

async function main(): Promise<void> {
  const scenarioPath = process.argv[2];
  if (!scenarioPath) {
    console.error("Usage: tsx run-scenario.ts <scenario-file.json>");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const absScenarioPath = path.resolve(scenarioPath);
  if (!fs.existsSync(absScenarioPath)) {
    console.error(`Scenario file not found: ${absScenarioPath}`);
    process.exit(1);
  }

  const scenario: Scenario = JSON.parse(
    fs.readFileSync(absScenarioPath, "utf8")
  );

  if (scenario.mode !== "mock") {
    console.error(
      `v0.1 only supports mock mode. Scenario mode: ${scenario.mode}`
    );
    process.exit(1);
  }

  console.log(`\n=== Running scenario: ${scenario.id} ===`);
  console.log(`Name: ${scenario.name}`);
  console.log(`Description: ${scenario.description}\n`);

  // Load the skill file and strip the YAML frontmatter block.
  const skillPath = path.join(
    __dirname,
    "..",
    "..",
    "skills",
    "lattice-workflow.md"
  );
  if (!fs.existsSync(skillPath)) {
    console.error(`Skill file not found at expected path: ${skillPath}`);
    process.exit(1);
  }
  const skillRaw = fs.readFileSync(skillPath, "utf8");
  const skillBody = skillRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");

  const systemInstruction = buildSystemPrompt(skillBody);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.LATTICE_EVAL_MODEL ?? "gemini-2.5-flash";

  // Convert our provider-neutral ToolSchema to Gemini's function declarations.
  const geminiTools = [
    {
      functionDeclarations: allTools.map(toGeminiFunctionDeclaration)
    }
  ];

  // Conversation history is a flat list of Content objects with alternating
  // roles. Gemini uses role "user" for both real user messages and function
  // responses, and role "model" for assistant turns.
  const contents: GeminiContent[] = [
    { role: "user", parts: [{ text: scenario.userPrompt }] }
  ];

  const transcript: unknown[] = [
    { role: "user", parts: [{ text: scenario.userPrompt }] }
  ];
  const toolCalls: ToolCallRecord[] = [];

  const startTime = Date.now();
  const maxIterations = 30;
  let iteration = 0;
  let finishReason: string | null = null;
  let lastAssistantText = "";

  while (iteration < maxIterations) {
    iteration++;

    // Per-model config:
    // - Gemini 2.5 Pro REQUIRES thinking mode and rejects thinkingBudget=0.
    //   Use dynamic thinking (budget=-1) which lets Pro decide.
    // - Gemini 2.5 Flash tolerates disabled thinking, and disabling is
    //   actively better for Flash because it prevents thought tokens
    //   from consuming the entire output budget and producing empty
    //   candidates.
    // - maxOutputTokens bumped to 16384 so complex function call
    //   payloads (multi-field publish_concept) don't get truncated
    //   into a MALFORMED_FUNCTION_CALL failure.
    const isProModel = model.includes("2.5-pro");
    const thinkingConfig = isProModel
      ? { thinkingBudget: -1 }
      : { thinkingBudget: 0 };

    const response = await ai.models.generateContent({
      model,
      contents: contents as unknown as Parameters<
        typeof ai.models.generateContent
      >[0]["contents"],
      config: {
        systemInstruction,
        tools: geminiTools,
        maxOutputTokens: 16384,
        thinkingConfig
      } as unknown as Parameters<typeof ai.models.generateContent>[0]["config"]
    });

    // Extract the first candidate's content. Shape: candidates[0].content.parts
    const candidate = (response as unknown as {
      candidates?: Array<{
        content?: GeminiContent;
        finishReason?: string;
      }>;
    }).candidates?.[0];

    if (!candidate || !candidate.content) {
      const finish = candidate?.finishReason ?? "(no candidate)";
      console.error(
        `\n[iteration ${iteration}] Empty candidate from Gemini ` +
          `(finishReason=${finish}). This usually means all output ` +
          `tokens went to thinking. Thinking is disabled in this ` +
          `runner — if you're seeing it anyway, bump maxOutputTokens ` +
          `or verify thinkingConfig is taking effect for this model.`
      );
      transcript.push({
        role: "model",
        error: "empty candidate",
        finishReason: finish
      });
      break;
    }

    finishReason = candidate.finishReason ?? null;

    // Ensure the model turn has role "model" for history correctness.
    const modelContent: GeminiContent = {
      role: "model",
      parts: candidate.content.parts ?? []
    };

    transcript.push(modelContent);
    contents.push(modelContent);

    // Collect any text blocks for the summary.
    for (const part of modelContent.parts) {
      if (typeof part.text === "string" && part.text.length > 0) {
        lastAssistantText = part.text;
      }
    }

    // Extract any function calls.
    const fnCalls = modelContent.parts.filter(
      (p): p is Required<Pick<GeminiPart, "functionCall">> & GeminiPart =>
        !!p.functionCall
    );

    if (fnCalls.length === 0) {
      // Nothing more to do — model produced only text.
      break;
    }

    // Build a single user turn containing one functionResponse per call.
    const responseParts: GeminiPart[] = [];

    for (const part of fnCalls) {
      const fc = part.functionCall!;
      const name = fc.name;
      const args = (fc.args ?? {}) as Record<string, unknown>;

      const { mockResponse, matched } = resolveMockResponse(
        scenario,
        name,
        args
      );

      toolCalls.push({
        iteration,
        name,
        input: args,
        mockResponse,
        matched
      });

      // Gemini requires functionResponse.response to be an object.
      const responseObject =
        typeof mockResponse === "object" && mockResponse !== null
          ? (mockResponse as Record<string, unknown>)
          : { result: mockResponse };

      responseParts.push({
        functionResponse: {
          name,
          response: responseObject
        }
      });
    }

    const userTurn: GeminiContent = {
      role: "user",
      parts: responseParts
    };
    contents.push(userTurn);
    transcript.push(userTurn);
  }

  const durationMs = Date.now() - startTime;
  const finishedNormally = iteration < maxIterations;

  // Write capture to runs/{id}/{timestamp}/
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(__dirname, "runs", scenario.id, timestamp);
  fs.mkdirSync(runDir, { recursive: true });

  fs.writeFileSync(
    path.join(runDir, "scenario.json"),
    JSON.stringify(scenario, null, 2)
  );
  fs.writeFileSync(
    path.join(runDir, "transcript.json"),
    JSON.stringify(transcript, null, 2)
  );
  fs.writeFileSync(
    path.join(runDir, "tool-calls.json"),
    JSON.stringify(toolCalls, null, 2)
  );
  fs.writeFileSync(
    path.join(runDir, "metadata.json"),
    JSON.stringify(
      {
        scenarioId: scenario.id,
        provider: "gemini",
        model,
        iterations: iteration,
        toolCallCount: toolCalls.length,
        finishedNormally,
        finishReason,
        durationMs
      },
      null,
      2
    )
  );

  const summary = buildSummary(scenario, toolCalls, {
    model,
    iterations: iteration,
    finishedNormally,
    finishReason,
    durationMs,
    finalText: lastAssistantText
  });
  fs.writeFileSync(path.join(runDir, "summary.txt"), summary);

  console.log(summary);
  console.log(`\nRun captured at: ${runDir}`);
}

// ============================================================
// Provider-specific: Gemini schema conversion
// ============================================================

/**
 * Convert our provider-neutral ToolSchema to a Gemini FunctionDeclaration.
 *
 * Gemini expects parameters in OpenAPI-subset shape with uppercase type
 * names (STRING / NUMBER / INTEGER / BOOLEAN / ARRAY / OBJECT). Our
 * internal schemas use the Anthropic/JSON-Schema lowercase convention,
 * so we walk the tree and rewrite type strings.
 */
function toGeminiFunctionDeclaration(schema: ToolSchema): {
  name: string;
  description: string;
  parameters: unknown;
} {
  return {
    name: schema.name,
    description: schema.description,
    parameters: convertSchemaNode(schema.input_schema)
  };
}

function convertSchemaNode(node: unknown): unknown {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(convertSchemaNode);

  const typeMap: Record<string, string> = {
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    array: "ARRAY",
    object: "OBJECT"
  };

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "type" && typeof value === "string") {
      out.type = typeMap[value.toLowerCase()] ?? value.toUpperCase();
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      const props: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(
        value as Record<string, unknown>
      )) {
        props[propKey] = convertSchemaNode(propVal);
      }
      out.properties = props;
    } else if (key === "items") {
      out.items = convertSchemaNode(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ============================================================
// Helpers (shared with any provider)
// ============================================================

function buildSystemPrompt(skillBody: string): string {
  return [
    "You are an AI assistant helping a developer design data schemas",
    "for their project. You have access to SchemaLattice (schemalattice.com),",
    "a shared catalog of data model concepts, via function-calling tools.",
    "",
    "This is a MOCK test environment. The tool responses are canned.",
    "Work through the full SchemaLattice checkpoint protocol as if you",
    "were in a real session — the test is to verify the skill produces",
    "the right behavior end-to-end.",
    "",
    "For Checkpoint 1D JIT mining, the web_search and fetch_url tools",
    "return canned results that represent a realistic slice of what a",
    "real web search would return. Use them as you would real tools.",
    "",
    "Always call the lattice tools per specs/ai-checkpoints.md. Never",
    "invent lattice URIs, never fabricate inspiredBySources URLs, and",
    "always pass through Checkpoint 1C (refined re-discover) before",
    "originating.",
    "",
    "---",
    "",
    "Skill content follows:",
    "",
    skillBody
  ].join("\n");
}

function resolveMockResponse(
  scenario: Scenario,
  toolName: string,
  input: unknown
): { mockResponse: unknown; matched: boolean } {
  const entries = scenario.mockResponses?.[toolName];
  if (!entries || entries.length === 0) {
    return {
      mockResponse: {
        error: {
          code: "not-mocked",
          message: `No mock response defined for tool '${toolName}' in this scenario.`
        }
      },
      matched: false
    };
  }

  for (const entry of entries) {
    if (!entry.match || matchesPattern(input, entry.match)) {
      return { mockResponse: entry.response, matched: true };
    }
  }

  return {
    mockResponse: {
      error: {
        code: "no-match",
        message: `No mock response matched input for tool '${toolName}'.`,
        input
      }
    },
    matched: false
  };
}

function matchesPattern(
  input: unknown,
  pattern: Record<string, unknown>
): boolean {
  if (typeof input !== "object" || input === null) return false;
  const obj = input as Record<string, unknown>;

  for (const key of Object.keys(pattern)) {
    const patternValue = pattern[key];
    const inputValue = obj[key];

    if (typeof patternValue === "string") {
      if (
        patternValue.startsWith("*") &&
        patternValue.endsWith("*") &&
        patternValue.length >= 2
      ) {
        const substring = patternValue.slice(1, -1).toLowerCase();
        if (
          typeof inputValue !== "string" ||
          !inputValue.toLowerCase().includes(substring)
        ) {
          return false;
        }
      } else {
        if (inputValue !== patternValue) return false;
      }
    } else {
      if (inputValue !== patternValue) return false;
    }
  }

  return true;
}

function buildSummary(
  scenario: Scenario,
  toolCalls: ToolCallRecord[],
  meta: {
    model: string;
    iterations: number;
    finishedNormally: boolean;
    finishReason: string | null;
    durationMs: number;
    finalText: string;
  }
): string {
  const lines: string[] = [];
  lines.push(`=== SchemaLattice Eval Run ===`);
  lines.push(`Scenario: ${scenario.id}`);
  lines.push(`Name:     ${scenario.name}`);
  lines.push(`Mode:     ${scenario.mode}`);
  lines.push(`Provider: gemini`);
  lines.push(`Model:    ${meta.model}`);
  lines.push(``);
  lines.push(`User prompt:`);
  lines.push(`  "${scenario.userPrompt}"`);
  lines.push(``);
  lines.push(`Tool-call sequence (${toolCalls.length} calls):`);
  if (toolCalls.length === 0) {
    lines.push(`  (none — model produced only text)`);
  } else {
    for (const call of toolCalls) {
      const inputPreview = summarizeToolInput(call.name, call.input);
      const matchMark = call.matched ? "✓" : "✗";
      lines.push(
        `  ${String(call.iteration).padStart(2, " ")}. ${matchMark} ${call.name}(${inputPreview})`
      );
    }
  }
  lines.push(``);

  // Protocol compliance quick-check against expectedFlow.
  const flow = scenario.expectedFlow;
  if (flow) {
    const calledNames = new Set(toolCalls.map((c) => c.name));
    lines.push(`Expected flow check:`);
    if (flow.shouldCall) {
      for (const name of flow.shouldCall) {
        lines.push(
          `  ${calledNames.has(name) ? "✓" : "✗"} shouldCall: ${name}`
        );
      }
    }
    if (flow.mustNotCall) {
      for (const name of flow.mustNotCall) {
        lines.push(
          `  ${!calledNames.has(name) ? "✓" : "✗"} mustNotCall: ${name}`
        );
      }
    }
    lines.push(``);
  }

  lines.push(`Iterations:       ${meta.iterations}`);
  lines.push(`Finish reason:    ${meta.finishReason ?? "(unknown)"}`);
  lines.push(`Finished cleanly: ${meta.finishedNormally}`);
  lines.push(`Duration:         ${(meta.durationMs / 1000).toFixed(1)}s`);
  lines.push(``);
  if (meta.finalText) {
    lines.push(`Final assistant text (truncated):`);
    const truncated = meta.finalText.slice(0, 400).replace(/\n/g, "\n  ");
    lines.push(`  ${truncated}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const obj = input as Record<string, unknown>;

  const preview = (val: unknown): string => {
    const s = typeof val === "string" ? val : JSON.stringify(val);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  };

  switch (toolName) {
    case "lattice_discover":
      return `description="${preview(obj.description)}"`;
    case "lattice_resolve":
      return `uri=${preview(obj.uri)}`;
    case "lattice_list_context":
      return `contextUri=${preview(obj.contextUri)}`;
    case "lattice_publish_concept":
      return `prefLabel="${preview(obj.prefLabel)}", context=${preview(obj.contextUri)}`;
    case "lattice_publish_fork":
      return `prefLabel="${preview(obj.prefLabel)}", parent=${preview(obj.parentUri)}`;
    case "lattice_stats":
      return `uri=${preview(obj.uri)}`;
    case "web_search":
      return `query="${preview(obj.query)}"`;
    case "fetch_url":
      return `url=${preview(obj.url)}`;
    default:
      return preview(obj);
  }
}

main().catch((err: unknown) => {
  console.error("Runner failed:");
  console.error(err);
  process.exit(1);
});
