// The v0.1 tool surface, transport-agnostic.
//
// Every tool defined in specs/mcp-tools.md lives here as a name, an AI-facing
// description, a JSON Schema for its parameters, and a handler over a
// LatticeInstance. The MCP server and the HTTP server both mount this same
// table so the two transports cannot drift apart.

import type { LatticeInstance } from "../server/instance.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { InvalidParameter, NotFound, toToolError, type ToolError } from "./errors.ts";
import type { AppStatus, UsageStatus, AttestationResult } from "../registry/registry.ts";

export interface ToolDef {
  name: string;
  description: string;
  /** True for tools that mutate the catalog — the HTTP layer gates these. */
  write: boolean;
  inputSchema: Record<string, unknown>;
  handler: (
    instance: LatticeInstance,
    args: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
}

// ---------------------------------------------------------------
// argument helpers

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new InvalidParameter(`"${key}" is required and must be a non-empty string`, {
      parameter: key,
    });
  }
  return v.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new InvalidParameter(`"${key}" must be a string`, { parameter: key });
  }
  const trimmed = v.trim();
  return trimmed.length ? trimmed : undefined;
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new InvalidParameter(`"${key}" must be an array of strings`, { parameter: key });
  }
  return v as string[];
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new InvalidParameter(`"${key}" must be a number`, { parameter: key });
  }
  return n;
}

function oneOf<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = requireString(args, key);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new InvalidParameter(
      `"${key}" must be one of: ${allowed.join(", ")}`,
      { parameter: key, allowed: [...allowed] },
    );
  }
  return v as T;
}

/** `https://schemalattice.io/s/{slug}@{hash}` → `{slug}`. */
function contextSlugFromUri(uri: string): string {
  const m = uri.match(/\/s\/([a-z][a-z0-9-]*)@[0-9a-f]+$/);
  if (!m) {
    throw new InvalidParameter(
      `"${uri}" is not a context URI — expected https://schemalattice.io/s/{slug}@{hash}`,
      { parameter: "contextUri" },
    );
  }
  return m[1];
}

/** Derive a stable kebab-case concept slug from a preferred label. */
export function slugify(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(slug)) {
    throw new InvalidParameter(
      `cannot derive a slug from prefLabel ${JSON.stringify(label)} — supply "conceptSlug" explicitly`,
      { prefLabel: label, derived: slug },
    );
  }
  return slug;
}

function firstLang(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

/** Publish-time duplicate warnings, in the shape the spec documents. */
function duplicateWarnings(
  warnings: Array<{ uri: string; prefLabel: string; similarity: number }>,
) {
  return warnings.map((w) => ({
    kind: "possible-duplicate" as const,
    candidateUri: w.uri,
    candidateLabel: w.prefLabel,
    similarity: w.similarity,
    message:
      `"${w.prefLabel}" is ${Math.round(w.similarity * 100)}% similar. ` +
      "If it means the same thing, adopt or fork it instead of keeping both.",
  }));
}

// ---------------------------------------------------------------
// concept record assembly

const CONCEPT_KINDS = [
  "entity",
  "event",
  "classification",
  "workflow",
  "measurement",
  "agent",
  "place",
] as const;

function buildConceptRecord(
  args: Record<string, unknown>,
  inScheme: string,
): ConceptRecord {
  const record: ConceptRecord = {
    type: "Concept",
    inScheme,
    prefLabel: { en: requireString(args, "prefLabel") },
    definition: { en: requireString(args, "definition") },
  };

  const kind = optionalString(args, "conceptKind");
  if (kind) {
    if (!(CONCEPT_KINDS as readonly string[]).includes(kind)) {
      throw new InvalidParameter(
        `"conceptKind" must be one of: ${CONCEPT_KINDS.join(", ")}`,
        { parameter: "conceptKind" },
      );
    }
    record.conceptKind = kind;
  }

  const altLabels = optionalStringArray(args, "altLabels");
  if (altLabels?.length) record.altLabel = { en: altLabels.join("; ") };

  for (const key of [
    "broader",
    "related",
    "closeMatch",
    "broadMatch",
    "narrowMatch",
    "relatedMatch",
  ] as const) {
    const v = optionalStringArray(args, key);
    if (v?.length) record[key] = v;
  }

  // coRefersWith is kept even when empty: an explicit empty array plus a
  // rationale is how the R2 gate lets a caller say "nothing co-refers".
  const coRefers = optionalStringArray(args, "coRefersWith");
  if (coRefers) record.coRefersWith = coRefers;
  const rationale = optionalString(args, "coRefersRationale");
  if (rationale) record.coRefersRationale = rationale;

  if (args.structure !== undefined && args.structure !== null) {
    record.structure = args.structure;
  }

  const attribution = args.sourceAttribution as Record<string, unknown> | undefined;
  if (attribution && typeof attribution === "object") {
    if (typeof attribution.importedFrom === "string") {
      record.importedFrom = attribution.importedFrom;
    }
    if (Array.isArray(attribution.authoredBy)) {
      record.createdBy = attribution.authoredBy as string[];
    }
    if (typeof attribution.sourceLicense === "string") {
      record.sourceLicense = attribution.sourceLicense;
    }
    if (typeof attribution.sourceNotes === "string") {
      record.sourceNotes = attribution.sourceNotes;
    }
    if (Array.isArray(attribution.inspiredBySources)) {
      record.inspiredBySources = attribution.inspiredBySources;
    }
  }

  return record;
}

// ---------------------------------------------------------------
// shared JSON Schema fragments

const stringArray = { type: "array", items: { type: "string" } };

// ---------------------------------------------------------------
// the tool table

export const TOOLS: ToolDef[] = [
  {
    name: "lattice_discover",
    write: false,
    description:
      "Semantic search for existing SchemaLattice concepts. Call this before " +
      "creating any new data model concept in your app. Returns a ranked list " +
      "of candidates with similarity scores. Each candidate includes enough " +
      "info to decide whether to adopt, fork, or keep looking. If nothing " +
      "scores above 0.55, the concept probably needs to be originated. Pass a " +
      "stable sessionId — publishing requires evidence that you searched first.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Natural language description of the concept you need",
        },
        contextHint: { type: "string", description: "Optional context URI to prefer" },
        limit: { type: "number", description: "Default 10, max 25" },
        sessionId: {
          type: "string",
          description:
            "Stable id for this build session; pass the same value to publish tools",
        },
      },
      required: ["description"],
    },
    handler: (instance, args) =>
      instance.discover({
        description: requireString(args, "description"),
        contextHint: optionalString(args, "contextHint"),
        limit: optionalNumber(args, "limit"),
        sessionId: optionalString(args, "sessionId"),
      }),
  },

  {
    name: "lattice_resolve",
    write: false,
    description:
      "Fetch the full record for a SchemaLattice concept URI: labels, " +
      "definition, structure, relations, lineage, and field classifications. " +
      "Call this on a candidate returned by lattice_discover before deciding " +
      "to adopt it.",
    inputSchema: {
      type: "object",
      properties: { uri: { type: "string" } },
      required: ["uri"],
    },
    handler: (instance, args) => {
      const uri = requireString(args, "uri");
      const record = instance.resolve(uri);
      if (!record) {
        throw new NotFound(
          `no concept at ${uri} — the URI may be stale, re-run lattice_discover`,
          { uri },
        );
      }
      const stats = instance.stats(uri);
      return {
        uri,
        record,
        stats: stats?.stats ?? null,
        usages: instance.registry.listUsages(uri),
      };
    },
  },

  {
    name: "lattice_list_context",
    write: false,
    description:
      "List all concepts in a SchemaLattice context. Use this after you've " +
      "found a relevant context through discover and want to see the full " +
      "vocabulary available, not just semantically-nearest matches.",
    inputSchema: {
      type: "object",
      properties: {
        contextUri: { type: "string" },
        limit: { type: "number", description: "Default 100" },
        offset: { type: "number" },
      },
      required: ["contextUri"],
    },
    handler: (instance, args) => {
      const uri = requireString(args, "contextUri");
      const result = instance.listContext(
        uri,
        optionalNumber(args, "limit") ?? 100,
        optionalNumber(args, "offset") ?? 0,
      );
      if (!result) throw new NotFound(`no context at ${uri}`, { uri });
      return result;
    },
  },

  {
    name: "lattice_publish_context",
    write: true,
    description:
      "Create a new SchemaLattice context (ConceptScheme) to hold concepts " +
      "you're about to publish. Use this ONLY when no suitable existing " +
      "context was found via lattice_discover or lattice_list_context AND you " +
      "are about to originate or fork into a concept that needs a home. " +
      "Context naming matters: use domain-generic slugs (scuba-ops, trail-ops, " +
      "volunteer-ops, equipment-lending) rather than app-specific ones " +
      "(my-scuba-club-app) so future AIs building apps in the same domain can " +
      "discover and reuse this vocabulary. If you cannot think of a " +
      "domain-generic name, that is a signal to reuse a broader existing " +
      "context instead. Returns a canonical context URI you then pass as " +
      "contextUri to lattice_publish_concept or lattice_publish_fork.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Kebab-case, 2-40 chars, starts with a letter" },
        title: { type: "string" },
        definition: { type: "string", description: "One paragraph, at least 40 characters" },
        parentContextUris: stringArray,
      },
      required: ["slug", "title", "definition"],
    },
    handler: (instance, args) =>
      instance.publishContext({
        slug: requireString(args, "slug"),
        title: requireString(args, "title"),
        definition: requireString(args, "definition"),
        parentContextUris: optionalStringArray(args, "parentContextUris"),
      }),
  },

  {
    name: "lattice_publish_concept",
    write: true,
    description:
      "Publish a new original concept to SchemaLattice. Use this only when " +
      "lattice_discover has returned no suitable match (similarity below 0.55 " +
      "across all candidates) and you've rerun discover with the refined " +
      "description. Three things are enforced before a hash is assigned: the " +
      "concept must reach the root skeleton through broader; the definition " +
      "must be 40-600 characters of real prose that says what the thing IS " +
      "without restating its label; and it must declare both an approved " +
      "external vocabulary match (closeMatch or broadMatch) and coRefersWith " +
      "(or an empty coRefersWith plus a coRefersRationale). Returns warnings " +
      "for near-duplicates you may have missed.",
    inputSchema: {
      type: "object",
      properties: {
        contextUri: { type: "string" },
        prefLabel: { type: "string" },
        definition: { type: "string" },
        conceptSlug: {
          type: "string",
          description: "Optional; derived from prefLabel when omitted",
        },
        conceptKind: { type: "string", enum: [...CONCEPT_KINDS] },
        altLabels: stringArray,
        structure: {
          type: "object",
          description:
            "Field shape: { kind, fields: [{ name, type, classification }] }. " +
            "Field classifications name a slug from the governance context.",
        },
        broader: {
          ...stringArray,
          description:
            "URIs this concept specializes — at least one must reach the root skeleton",
        },
        related: stringArray,
        closeMatch: {
          ...stringArray,
          description:
            "REQUIRED unless broadMatch is given: at least one CURIE in an approved " +
            "external vocabulary (schema:, skos:, foaf:, prov:, wd:, dct:, dpv:, …)",
        },
        broadMatch: stringArray,
        coRefersWith: {
          ...stringArray,
          description:
            "REQUIRED: concepts naming the same real-world referent from another " +
            "perspective. Pass [] with coRefersRationale if genuinely none exist.",
        },
        coRefersRationale: {
          type: "string",
          description: "Why coRefersWith is empty; required when it is",
        },
        sourceAttribution: { type: "object" },
        sessionId: {
          type: "string",
          description: "The sessionId you passed to lattice_discover",
        },
      },
      required: ["contextUri", "prefLabel", "definition"],
    },
    handler: async (instance, args) => {
      const contextUri = requireString(args, "contextUri");
      const contextSlug = contextSlugFromUri(contextUri);
      const conceptSlug =
        optionalString(args, "conceptSlug") ?? slugify(requireString(args, "prefLabel"));
      const record = buildConceptRecord(args, contextUri);
      const result = await instance.publishConcept({
        contextSlug,
        conceptSlug,
        record,
        sessionId: optionalString(args, "sessionId"),
      });
      return {
        uri: result.uri,
        context: contextUri,
        rootAncestor: result.rootAncestor,
        warnings: duplicateWarnings(result.duplicateWarnings),
        published: true,
      };
    },
  },

  {
    name: "lattice_publish_fork",
    write: true,
    description:
      "Publish a new concept derived from an existing SchemaLattice concept. " +
      "Use this when lattice_discover found a close match (similarity 0.65-0.85) " +
      "that needs modifications to fit your use case. You MUST provide a " +
      "changeset describing what fields you're adding, removing, or renaming. " +
      "Ops are validated against the parent's declared structure, and the " +
      "server computes the upgradable flag itself — any extend op makes the " +
      "fork non-upgradable.",
    inputSchema: {
      type: "object",
      properties: {
        parentUri: { type: "string" },
        contextUri: {
          type: "string",
          description: "Where the fork lives; may differ from the parent's context",
        },
        prefLabel: { type: "string" },
        definition: { type: "string" },
        conceptSlug: { type: "string", description: "Optional; derived from prefLabel" },
        altLabels: stringArray,
        structure: { type: "object" },
        changeset: {
          type: "object",
          properties: {
            ops: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  op: {
                    type: "string",
                    enum: [
                      "add",
                      "remove",
                      "rename",
                      "retype",
                      "wrap",
                      "unwrap",
                      "nest",
                      "hoist",
                      "extend",
                    ],
                  },
                },
                required: ["op"],
              },
            },
            note: { type: "string" },
          },
          required: ["ops"],
        },
        coRefersWith: stringArray,
        sourceAttribution: { type: "object" },
        sessionId: { type: "string" },
      },
      required: ["parentUri", "contextUri", "prefLabel", "definition", "changeset"],
    },
    handler: async (instance, args) => {
      const contextUri = requireString(args, "contextUri");
      const changeset = args.changeset as { ops?: unknown } | undefined;
      if (!changeset || typeof changeset !== "object" || !Array.isArray(changeset.ops)) {
        throw new InvalidParameter('"changeset" must be an object with an "ops" array', {
          parameter: "changeset",
        });
      }
      const result = await instance.publishFork({
        parentUri: requireString(args, "parentUri"),
        contextSlug: contextSlugFromUri(contextUri),
        conceptSlug:
          optionalString(args, "conceptSlug") ?? slugify(requireString(args, "prefLabel")),
        prefLabel: requireString(args, "prefLabel"),
        definition: requireString(args, "definition"),
        altLabels: optionalStringArray(args, "altLabels"),
        changeset: changeset as never,
        structure: args.structure,
        coRefersWith: optionalStringArray(args, "coRefersWith"),
        sourceAttribution: args.sourceAttribution as never,
        sessionId: optionalString(args, "sessionId"),
      });
      return {
        uri: result.uri,
        forkedFrom: result.forkedFrom,
        upgradable: result.upgradable,
        warnings: [...result.warnings, ...duplicateWarnings(result.duplicateWarnings)],
        published: true,
      };
    },
  },

  {
    name: "lattice_stats",
    write: false,
    description:
      "Retrieve usage statistics for a SchemaLattice concept: how many apps " +
      "have adopted it, how many times it has been forked, and recent " +
      "activity. Use this to inform adopt/fork/originate decisions — a heavily " +
      "adopted concept is usually a better choice than a near-neighbor with no " +
      "adopters. Omit uri for catalog-wide totals.",
    inputSchema: {
      type: "object",
      properties: { uri: { type: "string" } },
    },
    handler: (instance, args) => {
      const uri = optionalString(args, "uri");
      if (!uri) return { catalog: instance.totals() };
      const stats = instance.stats(uri);
      if (!stats) throw new NotFound(`no concept at ${uri}`, { uri });
      return stats;
    },
  },

  // ------------------------------------------------------------- registry

  {
    name: "lattice_register_app",
    write: true,
    description:
      "Register (or update) an app in the catalog's registry: its owner, " +
      "status, and the manifest of lattice concepts it uses. Call after " +
      "writing schemalattice.json so other teams can find the app and its " +
      "vocabulary. Re-registering the same slug updates in place. Manifests " +
      "referencing unknown concept URIs are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        unit: { type: "string", description: "Owning org unit — department, shop area, team" },
        owner: { type: "string" },
        contact: { type: "string" },
        status: {
          type: "string",
          enum: ["experiment", "pilot", "production", "retired"],
        },
        concepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              uri: { type: "string" },
              status: { type: "string", enum: ["adopted", "forked", "originated"] },
              shortName: { type: "string" },
            },
            required: ["uri", "status"],
          },
        },
      },
      required: ["slug", "name", "unit", "owner", "status", "concepts"],
    },
    handler: (instance, args) => {
      const concepts = args.concepts;
      if (!Array.isArray(concepts)) {
        throw new InvalidParameter('"concepts" must be an array', { parameter: "concepts" });
      }
      return instance.registry.registerApp({
        slug: requireString(args, "slug"),
        name: requireString(args, "name"),
        description: optionalString(args, "description"),
        unit: requireString(args, "unit"),
        owner: requireString(args, "owner"),
        contact: optionalString(args, "contact"),
        status: oneOf(args, "status", [
          "experiment",
          "pilot",
          "production",
          "retired",
        ] as const) as AppStatus,
        concepts: concepts as Array<{
          uri: string;
          status: UsageStatus;
          shortName?: string;
        }>,
      });
    },
  },

  {
    name: "lattice_record_attestation",
    write: true,
    description:
      "Record a build-time gate's result against a registered app, in the " +
      "governance/attestation shape. The registry stores results; it never " +
      "runs checks or enforces policy.",
    inputSchema: {
      type: "object",
      properties: {
        app: { type: "string" },
        gate: { type: "string", description: 'e.g. "security-review"' },
        gateVersion: { type: "string" },
        result: { type: "string", enum: ["pass", "fail", "waived"] },
        performedBy: { type: "string" },
        performedOn: { type: "string", description: "ISO date" },
        findingsRef: { type: "string" },
        notes: { type: "string" },
      },
      required: ["app", "gate", "result", "performedBy", "performedOn"],
    },
    handler: (instance, args) =>
      instance.registry.recordAttestation(requireString(args, "app"), {
        gate: requireString(args, "gate"),
        gateVersion: optionalString(args, "gateVersion"),
        result: oneOf(args, "result", ["pass", "fail", "waived"] as const) as AttestationResult,
        performedBy: requireString(args, "performedBy"),
        performedOn: requireString(args, "performedOn"),
        findingsRef: optionalString(args, "findingsRef"),
        notes: optionalString(args, "notes"),
      }),
  },

  {
    name: "lattice_list_usages",
    write: false,
    description:
      "Which registered apps use a concept URI, with each app's unit and " +
      "adoption status. Use it before changing or retiring a concept, and to " +
      "find the team that already solved the same modelling problem.",
    inputSchema: {
      type: "object",
      properties: { conceptUri: { type: "string" } },
      required: ["conceptUri"],
    },
    handler: (instance, args) => {
      const uri = requireString(args, "conceptUri");
      return { conceptUri: uri, usages: instance.registry.listUsages(uri) };
    },
  },

  {
    name: "lattice_app_report",
    write: false,
    description:
      "One app in full: manifest, connectivity score (reuse / dedupe / " +
      "anchoring), sensitivity profile, attestations, and overlaps with every " +
      "other registered app.",
    inputSchema: {
      type: "object",
      properties: { app: { type: "string" } },
      required: ["app"],
    },
    handler: (instance, args) => {
      const app = requireString(args, "app");
      return {
        app,
        score: instance.registry.scoreApp(app),
        usages: instance.registry.usagesOf(app),
        profile: instance.registry.profileOf(app),
        attestations: instance.registry.attestationsOf(app),
        overlaps: instance.registry.overlaps().filter((o) => o.a === app || o.b === app),
      };
    },
  },

  {
    name: "lattice_portfolio_report",
    write: false,
    description:
      "The program-owner view: every registered app with score, profile, and " +
      "attestations; pairwise compatibility; and advisory audit findings " +
      "(unlinked near-duplicates, fork bridges between units, unclassified-field " +
      "coverage gaps, sensitive profiles with no recorded attestation). " +
      "Findings are advisory — nothing is auto-fixed, and rank-to-policy " +
      "mapping stays with the organization.",
    inputSchema: { type: "object", properties: {} },
    handler: (instance) => instance.registry.portfolioReport(),
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Run a tool by name, converting any thrown error into the standard
 * envelope. Returns either the tool's result or a `{ error }` object.
 */
export async function callTool(
  instance: LatticeInstance,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | ToolError> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return {
      error: {
        code: "not-found" as const,
        message: `unknown tool: ${name}`,
        details: { available: TOOLS.map((t) => t.name) },
      },
    };
  }
  try {
    return await tool.handler(instance, args ?? {});
  } catch (err) {
    return toToolError(err);
  }
}

export { firstLang };
