// Minimal types for v0.1 M1. Extend as later milestones need them.

export type LangMap = Record<string, string>;

export interface ConceptRecord {
  type: "Concept";
  uri?: string;
  inScheme: string;
  prefLabel: LangMap;
  altLabel?: LangMap;
  hiddenLabel?: LangMap;
  definition?: LangMap;
  scopeNote?: LangMap;
  broader?: string[];
  narrower?: string[];
  related?: string[];
  closeMatch?: string[];
  broadMatch?: string[];
  narrowMatch?: string[];
  relatedMatch?: string[];
  derivedFrom?: string;
  forkedFrom?: string;
  previousVersion?: string;
  importedFrom?: string;
  coRefersWith?: string[];
  entryLevel?: number;
  collapsesTo?: string[];
  structure?: unknown;
  // excluded from hash but carried on the record
  conceptKind?: string;
  rootAncestor?: string;
  createdOn?: string;
  createdBy?: string[];
  designNote?: string;
  [k: string]: unknown;
}

export interface ContextRecord {
  type: "ConceptScheme";
  uri?: string;
  prefLabel: LangMap;
  definition?: LangMap;
  derivedFrom?: string;
  parentContexts?: string[];
  entryLevelAllowedRange?: { min?: number; max?: number };
  createdOn?: string;
  [k: string]: unknown;
}
