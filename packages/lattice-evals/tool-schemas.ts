/**
 * Tool schemas exposed to the model during a mock scenario run.
 *
 * The lattice_* tools mirror the schemas in ../../specs/mcp-tools.md.
 * The web_* tools exist so the model can perform Checkpoint 1D JIT
 * mining against mocked web content provided by the scenario.
 *
 * When specs/mcp-tools.md changes, update the matching tool here and
 * re-run the scenarios to catch drift.
 */

// The Anthropic SDK accepts tools as plain objects matching this shape.
// Typed loosely to avoid coupling to a specific SDK version.
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================
// SchemaLattice MCP tools
// ============================================================

export const latticeDiscover: ToolSchema = {
  name: "lattice_discover",
  description:
    "Semantic search for existing SchemaLattice concepts. Call this " +
    "before creating any new data model concept. Returns a ranked " +
    "list of candidates with similarity scores. Each candidate " +
    "includes info needed to decide whether to adopt, fork, or keep " +
    "looking. If nothing scores above 0.5, the concept likely needs " +
    "to be originated (see Checkpoint 1D first).",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Natural-language description of what you're about to " +
          "build. Include the apparent domain (e.g. 'scuba dive " +
          "session tracker', not just 'session')."
      },
      contextHint: {
        type: "string",
        description: "Optional URI of a context to prefer when ranking."
      },
      limit: {
        type: "number",
        description: "Maximum results to return. Default 10, max 25."
      }
    },
    required: ["description"]
  }
};

export const latticeResolve: ToolSchema = {
  name: "lattice_resolve",
  description:
    "Fetch a single SchemaLattice concept's full record. Use this " +
    "after lattice_discover when you need to examine a candidate in " +
    "detail before deciding to adopt or fork. Returns the concept's " +
    "structure, full lineage, known forks, and related concepts.",
  input_schema: {
    type: "object",
    properties: {
      uri: {
        type: "string",
        description: "Canonical concept URI."
      },
      includeNeighbors: {
        type: "boolean",
        description: "Include 5 nearest related concepts. Default true."
      }
    },
    required: ["uri"]
  }
};

export const latticeListContext: ToolSchema = {
  name: "lattice_list_context",
  description:
    "List all concepts in a SchemaLattice context. Use this after " +
    "you've found a relevant context through discover and want to " +
    "see the full vocabulary available.",
  input_schema: {
    type: "object",
    properties: {
      contextUri: { type: "string" },
      limit: { type: "number" },
      offset: { type: "number" }
    },
    required: ["contextUri"]
  }
};

export const latticePublishConcept: ToolSchema = {
  name: "lattice_publish_concept",
  description:
    "Publish a new original concept to SchemaLattice. Use this ONLY " +
    "after lattice_discover has returned no suitable match AND you " +
    "have honestly attempted Checkpoint 1D JIT mining via web_search " +
    "and fetch_url. If JIT mining found relevant open-source projects, " +
    "include them in sourceAttribution.inspiredBySources with per-source " +
    "notes. NEVER fabricate source URLs — empty inspiredBySources is " +
    "better than invented ones.",
  input_schema: {
    type: "object",
    properties: {
      contextUri: { type: "string" },
      prefLabel: { type: "string" },
      definition: { type: "string" },
      altLabels: {
        type: "array",
        items: { type: "string" }
      },
      structure: {
        type: "object",
        description:
          "The field shape of the concept. Optional for abstract " +
          "concepts that describe an idea rather than a record shape. " +
          "Canonical form: {kind: 'entity', fields: [{name, type, " +
          "required?, ref?, unit?, description?, itemType?}]} for " +
          "record types, or {kind: 'enum', values: [{id, label, " +
          "definition?}]} for enumerations.",
        properties: {
          kind: {
            type: "string",
            description:
              "Kind of structure: 'entity' for record types with " +
              "fields, 'enum' for controlled vocabularies with " +
              "values. Default is 'entity' if fields is provided."
          },
          fields: {
            type: "array",
            description:
              "For entity kind: the list of fields in the record.",
            items: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Field name in camelCase."
                },
                type: {
                  type: "string",
                  description:
                    "Field type: string, integer, number, boolean, " +
                    "dateTime, date, duration, array, reference, " +
                    "enum, geoPoint, currency, text."
                },
                required: {
                  type: "boolean",
                  description: "Whether the field is required."
                },
                ref: {
                  type: "string",
                  description:
                    "For reference type: the target concept URI or " +
                    "short name."
                },
                unit: {
                  type: "string",
                  description:
                    "Optional unit annotation (e.g. meters, seconds)."
                },
                description: {
                  type: "string",
                  description: "Optional per-field description."
                },
                itemType: {
                  type: "string",
                  description:
                    "For array type: the type of each element."
                }
              },
              required: ["name", "type"]
            }
          },
          values: {
            type: "array",
            description:
              "For enum kind: the allowed values.",
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Stable identifier for the enum value."
                },
                label: {
                  type: "string",
                  description: "Human-readable label."
                },
                definition: {
                  type: "string",
                  description: "Optional definition of the value."
                }
              },
              required: ["id"]
            }
          }
        }
      },
      broader: {
        type: "array",
        items: { type: "string" },
        description: "URIs of broader concepts (SKOS broader)."
      },
      related: {
        type: "array",
        items: { type: "string" }
      },
      coRefersWith: {
        type: "array",
        items: { type: "string" },
        description:
          "URIs of concepts that share a real-world referent but " +
          "offer a different perspective (e.g. same GPS point, " +
          "different view)."
      },
      sourceAttribution: {
        type: "object",
        properties: {
          importedFrom: { type: "string" },
          authoredBy: {
            type: "array",
            items: { type: "string" }
          },
          sourceLicense: { type: "string" },
          sourceNotes: { type: "string" },
          inspiredBySources: {
            type: "array",
            description:
              "Sources consulted during JIT mining. Each entry " +
              "is an object with a url and optional note/commitHash. " +
              "NEVER fabricate these — empty is better than invented.",
            items: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "Source URL (repo, spec, or documentation page)."
                },
                note: {
                  type: "string",
                  description: "What was borrowed or learned from this source."
                },
                commitHash: {
                  type: "string",
                  description: "Optional git commit hash pinning the source."
                }
              },
              required: ["url"]
            }
          }
        }
      }
    },
    required: ["contextUri", "prefLabel", "definition"]
  }
};

export const latticePublishFork: ToolSchema = {
  name: "lattice_publish_fork",
  description:
    "Publish a new concept derived from an existing SchemaLattice " +
    "concept. Use this when lattice_discover found a close match " +
    "(similarity 0.7–0.9) that needs modifications to fit your use " +
    "case. You MUST provide a changeset describing exactly what " +
    "fields you're adding, removing, or renaming relative to the " +
    "parent.",
  input_schema: {
    type: "object",
    properties: {
      parentUri: { type: "string" },
      contextUri: { type: "string" },
      prefLabel: { type: "string" },
      definition: { type: "string" },
      altLabels: {
        type: "array",
        items: { type: "string" }
      },
      changeset: {
        type: "object",
        properties: {
          ops: {
            type: "array",
            description:
              "Fork ops: add, remove, rename, retype, wrap, unwrap, " +
              "nest, hoist, extend. See specs/changeset-format.md.",
            items: {
              type: "object",
              properties: {
                op: {
                  type: "string",
                  description:
                    "Op kind: add | remove | rename | retype | wrap | unwrap | nest | hoist | extend"
                },
                field: {
                  type: "string",
                  description: "Field name the op applies to (for most ops)."
                },
                from: {
                  type: "string",
                  description: "For rename: old field name."
                },
                to: {
                  type: "string",
                  description: "For rename: new field name."
                },
                fromType: {
                  type: "string",
                  description: "For retype: original type."
                },
                toType: {
                  type: "string",
                  description: "For retype: new type."
                },
                type: {
                  type: "string",
                  description: "For add: type of the new field (string, number, integer, boolean, date, reference, etc)."
                },
                ref: {
                  type: "string",
                  description: "For add of reference type: concept URI or short name being referenced."
                },
                unit: {
                  type: "string",
                  description: "Optional unit annotation (e.g. meters, seconds)."
                },
                into: {
                  type: "string",
                  description: "For nest: target container field name."
                },
                converter: {
                  type: "string",
                  description: "For retype: converter name (e.g. identity, stringToNumber)."
                },
                note: {
                  type: "string",
                  description: "Optional per-op explanation."
                }
              },
              required: ["op"]
            }
          },
          note: { type: "string" }
        },
        required: ["ops"]
      },
      coRefersWith: {
        type: "array",
        items: { type: "string" }
      },
      sourceAttribution: {
        type: "object"
      }
    },
    required: ["parentUri", "contextUri", "prefLabel", "definition", "changeset"]
  }
};

export const latticePublishContext: ToolSchema = {
  name: "lattice_publish_context",
  description:
    "Create a new SchemaLattice context (ConceptScheme) to hold " +
    "concepts you're about to publish. Use this ONLY when no " +
    "suitable existing context was found via lattice_discover or " +
    "lattice_list_context AND you are about to originate (or fork " +
    "into) a concept that needs a home. Context naming matters: use " +
    "domain-generic slugs (scuba-ops, trail-ops, volunteer-ops, " +
    "equipment-lending) rather than app-specific ones " +
    "(my-scuba-club-app) so future AIs building apps in the same " +
    "domain can discover and reuse this vocabulary. Returns a " +
    "canonical context URI you then pass as contextUri to " +
    "lattice_publish_concept or lattice_publish_fork.",
  input_schema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description:
          "Kebab-case domain slug, e.g. 'scuba-ops'. MUST be " +
          "domain-generic, not app-specific. 2-40 chars, must " +
          "start with a letter."
      },
      title: {
        type: "string",
        description: "Human-readable title for the context."
      },
      definition: {
        type: "string",
        description:
          "One-paragraph description of what concepts belong in " +
          "this context and what domain it covers."
      },
      parentContextUris: {
        type: "array",
        description:
          "Optional URIs of broader contexts this one specializes. " +
          "For example, 'scuba-ops' might list 'activity-log' and " +
          "'member-org' as parents.",
        items: { type: "string" }
      }
    },
    required: ["slug", "title", "definition"]
  }
};

export const latticeStats: ToolSchema = {
  name: "lattice_stats",
  description:
    "Retrieve usage statistics for a SchemaLattice concept: adoption " +
    "count, fork count, recent activity. Use this to inform " +
    "adopt/fork/originate decisions — a heavily adopted concept is " +
    "usually a better choice than a near-neighbor with no adopters.",
  input_schema: {
    type: "object",
    properties: {
      uri: { type: "string" }
    },
    required: ["uri"]
  }
};

// ============================================================
// JIT mining tools (Checkpoint 1D)
//
// These exist in the harness so the model can perform open-source
// fallback mining. In a real Claude Code session the model would
// have its own web/search/file tools; here we mock them with
// scenario-provided responses.
// ============================================================

export const webSearch: ToolSchema = {
  name: "web_search",
  description:
    "Search the web for information. Use this as part of Checkpoint " +
    "1D (JIT mining) when the SchemaLattice has no match for the " +
    "concept you're designing, to find open-source projects whose " +
    "data models can inform the synthesis. Results include titles, " +
    "URLs, and short snippets.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" }
    },
    required: ["query"]
  }
};

export const fetchUrl: ToolSchema = {
  name: "fetch_url",
  description:
    "Fetch and return the content of a URL as text. Use this to " +
    "read the data model files of open-source projects found via " +
    "web_search during Checkpoint 1D JIT mining.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string" }
    },
    required: ["url"]
  }
};

// ============================================================
// Project exploration tools
//
// Available when retrofitting an existing codebase. The AI uses
// these to read project files and understand existing data models
// before cataloging them against SchemaLattice. Checkpoint 3A
// (reading an unfamiliar file) calls these.
// ============================================================

export const readFile: ToolSchema = {
  name: "read_file",
  description:
    "Read the contents of a file in the current project directory. " +
    "Use this when retrofitting an existing codebase to understand " +
    "data models, READMEs, config files, schemas, or migrations " +
    "before cataloging them against SchemaLattice. Prefer reading " +
    "authoritative sources (READMEs, schema definitions, migration " +
    "files) over generated code.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or project-relative path to the file."
      }
    },
    required: ["path"]
  }
};

export const listDirectory: ToolSchema = {
  name: "list_directory",
  description:
    "List the contents of a directory in the current project. Use " +
    "this when exploring an unfamiliar codebase to find the files " +
    "that define data models (look for config/, schema/, migrations/, " +
    "models/, entities/ directories, plus README.md and info/module " +
    "metadata files).",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or project-relative directory path."
      }
    },
    required: ["path"]
  }
};

// ============================================================
// Exported bundles for convenient use
// ============================================================

export const latticeTools: ToolSchema[] = [
  latticeDiscover,
  latticeResolve,
  latticeListContext,
  latticePublishContext,
  latticePublishConcept,
  latticePublishFork,
  latticeStats
];

export const webTools: ToolSchema[] = [webSearch, fetchUrl];

export const projectTools: ToolSchema[] = [readFile, listDirectory];

export const allTools: ToolSchema[] = [
  ...latticeTools,
  ...webTools,
  ...projectTools
];
