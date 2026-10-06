// Builder contributions, phase 1 (specs/builder-contributions.md).
//
// Builders who cannot publish (hosted app generators, mostly) send back the
// types they designed: a label, the root kind it belongs to, a one-sentence
// definition and its fields. Nothing here touches the content-addressed
// catalog. Contributions live in their own mutable table, can be withdrawn,
// and are clustered into concept candidates: N independent builders made
// roughly this, and these are the fields they agree on.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Store } from "../storage/db.ts";
import type { Embedder } from "../discover/embedder.ts";
import type { VectorIndex } from "../discover/vectors.ts";
import { isContentful } from "../query/demand.ts";

export const CONTRIBUTION_CONFIG = {
  maxTypes: 20,
  maxBytes: 16_000,
  labelMax: 60,
  definitionMax: 300,
  queryMax: 300,
  maxFields: 40,
  fieldNameMax: 60,
  maxValues: 20,
  valueMax: 40,
  /** A contributed type this close to an existing concept is that concept. */
  alreadyInCatalog: 0.85,
  /** Two contributions this close describe the same candidate. */
  clusterSim: 0.75,
  /** Candidates and enum values need this many sources to be shown publicly. */
  publicSources: 2,
  dailyCapPerSource: 50,
} as const;

const DAY = 86_400_000;

const FIELD_TYPES = [
  "string", "number", "integer", "boolean", "date", "datetime", "time", "enum",
  "reference", "array", "object", "geometry", "binary", "url", "email",
] as const;

/** What builders actually write, mapped to the catalog's field types. */
const TYPE_ALIASES: Record<string, string> = {
  text: "string", varchar: "string", uuid: "string", id: "string", char: "string",
  timestamp: "datetime", timestamptz: "datetime", "date-time": "datetime",
  int: "integer", bigint: "integer", smallint: "integer",
  float: "number", double: "number", decimal: "number", numeric: "number", real: "number",
  bool: "boolean", json: "object", jsonb: "object", map: "object", list: "array",
  ref: "reference", fk: "reference", foreignkey: "reference", "foreign-key": "reference",
  uri: "url", link: "url", geojson: "geometry", point: "geometry", file: "binary", blob: "binary",
};

export class ContributionRejected extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface ContributedField {
  name: string;
  type: string;
  required?: boolean;
  values?: string[];
  unit?: string;
  itemType?: string;
}

export interface ContributedType {
  label: string;
  broader: string;
  definition: string;
  fields: ContributedField[];
}

export interface ContributeResult {
  submissionId: string;
  /** Shown once. Withdraws everything in this submission. */
  withdrawToken: string;
  accepted: Array<{ label: string; id: string }>;
  /** Types the catalog already has: use the concept instead. */
  alreadyInCatalog: Array<{ label: string; uri: string; prefLabel: string; similarity: number }>;
  notice: string;
}

interface Row {
  id: string;
  submission_id: string;
  source: string;
  label: string;
  broader: string;
  definition: string;
  fields: string;
  source_query: string | null;
  vec: Buffer;
  created_at: string;
}

export interface CandidateField {
  name: string;
  type: string;
  sources: number;
  required: number;
  /** Enum values, each with how many sources used it. Only shared values are public. */
  values?: Record<string, number>;
  unit?: string;
}

export interface ConceptCandidate {
  id: string;
  label: string;
  /** Every label used, most common first. */
  labels: string[];
  broader: { uri: string; prefLabel: string };
  sources: number;
  contributions: number;
  definitions: string[];
  fields: CandidateField[];
  sourceQueries: string[];
  nearestExisting: { uri: string; prefLabel: string; similarity: number } | null;
  firstAt: string;
  lastAt: string;
}

export class Contributions {
  private db: Database.Database;

  constructor(
    private store: Store,
    private embedder: Embedder,
    private vectors: VectorIndex,
    /** Root concept URIs: the only valid `broader` values. */
    private roots: Set<string>,
    /** Reserved contexts (governance), never "already in catalog". */
    private reserved: Set<string> = new Set(),
  ) {
    this.db = store.db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contributions (
        id            TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        source        TEXT NOT NULL,
        label         TEXT NOT NULL,
        broader       TEXT NOT NULL,
        definition    TEXT NOT NULL,
        fields        TEXT NOT NULL,
        source_query  TEXT,
        vec           BLOB NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contributions_source ON contributions(source, created_at);
      CREATE INDEX IF NOT EXISTS idx_contributions_submission ON contributions(submission_id);
      CREATE TABLE IF NOT EXISTS contribution_tokens (
        token_hash    TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL
      );
    `);
  }

  // --- submission ----------------------------------------------------------

  async submit(
    input: { types: unknown; sourceQuery?: string },
    source: string,
    now: Date = new Date(),
  ): Promise<ContributeResult> {
    if (JSON.stringify(input).length > CONTRIBUTION_CONFIG.maxBytes) {
      throw new ContributionRejected(`a submission must be under ${CONTRIBUTION_CONFIG.maxBytes / 1000} KB`);
    }
    if (!Array.isArray(input.types) || input.types.length === 0) {
      throw new ContributionRejected('"types" must be a non-empty array');
    }
    if (input.types.length > CONTRIBUTION_CONFIG.maxTypes) {
      throw new ContributionRejected(`at most ${CONTRIBUTION_CONFIG.maxTypes} types per submission`);
    }
    const sourceQuery = input.sourceQuery?.trim().slice(0, CONTRIBUTION_CONFIG.queryMax) || null;
    const types = input.types.map((t, i) => this.clean(t, i));

    const recent = (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM contributions WHERE source = ? AND created_at >= ?")
        .get(source, new Date(now.getTime() - DAY).toISOString()) as { n: number }
    ).n;
    if (recent + types.length > CONTRIBUTION_CONFIG.dailyCapPerSource) {
      throw new ContributionRejected("daily contribution limit reached for this source; try again tomorrow");
    }

    const vecs = await this.embedder.embed(types.map(embedText));
    const submissionId = `sub-${randomUUID()}`;
    const accepted: ContributeResult["accepted"] = [];
    const alreadyInCatalog: ContributeResult["alreadyInCatalog"] = [];
    const insert = this.db.prepare(
      `INSERT INTO contributions (id, submission_id, source, label, broader, definition, fields, source_query, vec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      types.forEach((t, i) => {
        const existing = this.nearestConcept(vecs[i]);
        if (existing && existing.similarity >= CONTRIBUTION_CONFIG.alreadyInCatalog) {
          alreadyInCatalog.push({ label: t.label, ...existing });
          return;
        }
        const id = `con-${randomUUID()}`;
        insert.run(
          id, submissionId, source, t.label, t.broader, t.definition, JSON.stringify(t.fields),
          sourceQuery, Buffer.from(Float32Array.from(vecs[i]).buffer), now.toISOString(),
        );
        accepted.push({ label: t.label, id });
      });
    });
    tx();

    const withdrawToken = `wd_${randomBytes(18).toString("base64url")}`;
    if (accepted.length > 0) {
      this.db
        .prepare("INSERT INTO contribution_tokens (token_hash, submission_id) VALUES (?, ?)")
        .run(hashToken(withdrawToken), submissionId);
      this.store.logEvent("contribution", { submissionId, types: accepted.length }, source);
    }
    return {
      submissionId,
      withdrawToken: accepted.length > 0 ? withdrawToken : "",
      accepted,
      alreadyInCatalog,
      notice:
        "Nothing was published. Your types are held as suggestions; when independent builders " +
        "describe the same type, it appears as a concept candidate in lattice_demand_report. " +
        "Keep the withdraw token to remove this submission.",
    };
  }

  withdraw(token: string): { removed: number } {
    const row = this.db
      .prepare("SELECT submission_id FROM contribution_tokens WHERE token_hash = ?")
      .get(hashToken(token.trim())) as { submission_id: string } | undefined;
    if (!row) throw new ContributionRejected("unknown or already used withdraw token");
    const removed = this.db.prepare("DELETE FROM contributions WHERE submission_id = ?").run(row.submission_id).changes;
    this.db.prepare("DELETE FROM contribution_tokens WHERE submission_id = ?").run(row.submission_id);
    this.store.logEvent("contribution-withdrawn", { submissionId: row.submission_id, removed }, null);
    return { removed };
  }

  /** Operator: remove everything one source contributed. */
  purgeSource(source: string): { removed: number } {
    return { removed: this.db.prepare("DELETE FROM contributions WHERE source = ?").run(source).changes };
  }

  private nearestConcept(vec: Float32Array): { uri: string; prefLabel: string; similarity: number } | null {
    for (const n of this.vectors.knn(vec, 10)) {
      const record = this.store.getConcept(n.uri);
      if (!record || this.roots.has(n.uri) || this.reserved.has(record.inScheme as string)) continue;
      return {
        uri: n.uri,
        prefLabel: record.prefLabel.en ?? Object.values(record.prefLabel)[0] ?? "",
        similarity: Number(n.similarity.toFixed(4)),
      };
    }
    return null;
  }

  private clean(raw: unknown, index: number): ContributedType {
    const at = `types[${index}]`;
    if (!raw || typeof raw !== "object") throw new ContributionRejected(`${at} must be an object`);
    const t = raw as Record<string, unknown>;
    const label = text(t.label, `${at}.label`, CONTRIBUTION_CONFIG.labelMax);
    const definition = text(t.definition, `${at}.definition`, CONTRIBUTION_CONFIG.definitionMax);
    if (!isContentful(label) || !isContentful(definition) || definition.split(/\s+/).length < 4) {
      throw new ContributionRejected(`${at}: give a real label and a one-sentence definition`, { label });
    }
    const broader = text(t.broader, `${at}.broader`, 300);
    if (!this.roots.has(broader)) {
      throw new ContributionRejected(`${at}.broader must be a root concept URI (see /pack/schemalattice)`, { broader });
    }
    if (!Array.isArray(t.fields)) throw new ContributionRejected(`${at}.fields must be an array`);
    if (t.fields.length > CONTRIBUTION_CONFIG.maxFields) {
      throw new ContributionRejected(`${at}: at most ${CONTRIBUTION_CONFIG.maxFields} fields`);
    }
    const seen = new Set<string>();
    const fields = t.fields.map((f, j) => {
      const field = cleanField(f, `${at}.fields[${j}]`);
      if (seen.has(field.name)) throw new ContributionRejected(`${at}: duplicate field "${field.name}"`);
      seen.add(field.name);
      return field;
    });
    return { label, broader, definition, fields };
  }

  // --- candidates ----------------------------------------------------------

  /**
   * Cluster contributions into candidates. Public callers see only
   * candidates with enough independent sources, and only enum values that
   * several sources share; the operator sees everything.
   */
  candidates(opts: { operator?: boolean; limit?: number } = {}): ConceptCandidate[] {
    const rows = this.db.prepare("SELECT * FROM contributions ORDER BY created_at").all() as Row[];
    const minSources = opts.operator ? 1 : CONTRIBUTION_CONFIG.publicSources;

    // Greedy clustering, as the demand report does; never across roots.
    const clusters: Array<{ anchor: Float32Array; broader: string; rows: Row[] }> = [];
    for (const r of rows) {
      const v = toVec(r.vec);
      const home = clusters.find((c) => c.broader === r.broader && cosine(c.anchor, v) >= CONTRIBUTION_CONFIG.clusterSim);
      if (home) home.rows.push(r);
      else clusters.push({ anchor: v, broader: r.broader, rows: [r] });
    }

    const out: ConceptCandidate[] = [];
    for (const c of clusters) {
      // One source counts once, using its latest contribution in the cluster.
      const bySource = new Map<string, Row>();
      for (const r of c.rows) bySource.set(r.source, r);
      const latest = [...bySource.values()];
      if (latest.length < minSources) continue;

      const labels = rank(latest.map((r) => r.label));
      const rootRecord = this.store.getConcept(c.broader);
      out.push({
        id: `cand-${createHash("sha256").update(c.rows[0].id).digest("hex").slice(0, 12)}`,
        label: labels[0],
        labels,
        broader: { uri: c.broader, prefLabel: rootRecord?.prefLabel.en ?? "" },
        sources: latest.length,
        contributions: c.rows.length,
        definitions: [...new Set(latest.map((r) => r.definition))],
        fields: mergeFields(latest.map((r) => JSON.parse(r.fields) as ContributedField[]), opts.operator === true),
        sourceQueries: [...new Set(c.rows.map((r) => r.source_query).filter((q): q is string => !!q))],
        nearestExisting: this.nearestConcept(c.anchor),
        firstAt: c.rows[0].created_at,
        lastAt: c.rows[c.rows.length - 1].created_at,
      });
    }
    out.sort((a, b) => b.sources - a.sources || (a.lastAt < b.lastAt ? 1 : -1));
    return out.slice(0, Math.min(Math.max(opts.limit ?? 20, 1), 100));
  }

  counts(): { contributions: number; sources: number } {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT source) AS s FROM contributions")
      .get() as { n: number; s: number };
    return { contributions: row.n, sources: row.s };
  }
}

// --- helpers ---------------------------------------------------------------

function text(value: unknown, at: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "") throw new ContributionRejected(`${at} is required`);
  const v = value.trim();
  if (v.length > max) throw new ContributionRejected(`${at} must be ${max} characters or fewer`);
  return v;
}

function cleanField(raw: unknown, at: string): ContributedField {
  if (!raw || typeof raw !== "object") throw new ContributionRejected(`${at} must be an object`);
  const f = raw as Record<string, unknown>;
  const name = text(f.name, `${at}.name`, CONTRIBUTION_CONFIG.fieldNameMax);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) {
    throw new ContributionRejected(`${at}.name must be an identifier`, { name });
  }
  const type = normalizeType(text(f.type, `${at}.type`, 40));
  const out: ContributedField = { name, type };
  if (f.required === true) out.required = true;
  if (typeof f.unit === "string" && f.unit.trim()) out.unit = f.unit.trim().slice(0, 30);
  if (typeof f.itemType === "string" && f.itemType.trim()) out.itemType = normalizeType(f.itemType.trim());
  if (Array.isArray(f.values)) {
    const values = f.values
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim().slice(0, CONTRIBUTION_CONFIG.valueMax))
      .slice(0, CONTRIBUTION_CONFIG.maxValues);
    if (values.length > 0) out.values = values;
  }
  return out;
}

export function normalizeType(type: string): string {
  const t = type.toLowerCase().replace(/\s+/g, "");
  if ((FIELD_TYPES as readonly string[]).includes(t)) return t;
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  if (t.endsWith("[]")) return "array";
  throw new ContributionRejected(`unknown field type "${type}"; use one of ${FIELD_TYPES.join(", ")}`);
}

/** `startsAt`, `starts_at`, `StartsAt` and `start_at` are one field for counting. */
export function normalizeFieldName(name: string): string {
  const flat = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return flat
    .split("_")
    .map((w) => (w.length > 3 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("_");
}

function mergeFields(perSource: ContributedField[][], operator: boolean): CandidateField[] {
  const groups = new Map<string, { spellings: string[]; types: string[]; required: number; units: string[]; values: Map<string, number>; sources: number }>();
  for (const fields of perSource) {
    const seenHere = new Set<string>();
    for (const f of fields) {
      const key = normalizeFieldName(f.name);
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const g = groups.get(key) ?? { spellings: [] as string[], types: [] as string[], required: 0, units: [] as string[], values: new Map<string, number>(), sources: 0 };
      g.sources++;
      g.spellings.push(f.name);
      g.types.push(f.type);
      if (f.required) g.required++;
      if (f.unit) g.units.push(f.unit);
      for (const v of new Set((f.values ?? []).map((x) => x.toLowerCase()))) g.values.set(v, (g.values.get(v) ?? 0) + 1);
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .map((g) => {
      const shown = [...g.values].filter(([, n]) => operator || n >= CONTRIBUTION_CONFIG.publicSources);
      return {
        name: rank(g.spellings)[0],
        type: rank(g.types)[0],
        sources: g.sources,
        required: g.required,
        ...(shown.length ? { values: Object.fromEntries(shown.sort((a, b) => b[1] - a[1])) } : {}),
        ...(g.units.length ? { unit: rank(g.units)[0] } : {}),
      };
    })
    .sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name));
}

function embedText(t: ContributedType): string {
  return `${t.label}: ${t.definition} Fields: ${t.fields.map((f) => f.name).join(", ")}`;
}

/** Most common first. */
function rank(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toVec(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
