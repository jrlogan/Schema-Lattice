// Mesh report: how well two apps (or an app and a public data source, or two
// pasted manifests) will exchange data, concept by concept and field by field.
//
// It is the "reconcile preview" the integration story always promised, built
// from what the catalog already records: which concepts each side uses (the
// registry, a source's mappings, or a manifest), which fields each side fills
// (field maps), how two concepts relate (the same concept, a fork lineage, a
// declared co-reference, or only similar meaning), and what the concepts'
// fields say about type, units and sensitivity.
//
// Pasted manifests are used for the computation only: nothing about them is
// stored or logged.

import type { LatticeInstance } from "../server/instance.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { compareConcepts } from "./compare.ts";
import { cosine } from "../discover/embedder.ts";

export type MeshSide =
  | { app: string }
  | { source: string }
  | { manifest: Record<string, unknown>; name?: string };

/** How two concepts are connected, strongest first. */
export type MatchKind = "same" | "lineage" | "coreference" | "similar";
export type Grade = "direct" | "translate" | "manual" | "gap";

const GRADE_OF: Record<MatchKind, Grade> = { same: "direct", lineage: "translate", coreference: "translate", similar: "manual" };
const BASE: Record<MatchKind, number> = { same: 1, lineage: 0.75, coreference: 0.6, similar: 0.3 };
/** Cosine at or above which two unlinked concepts are offered as a manual mapping. */
export const MESH_SIMILAR = 0.72;
const MANIFEST_MAX_CONCEPTS = 300;

interface Entry {
  locals: string[];
  uri: string;
  label: string;
  context: string;
  /** The concept's fields this side fills; null when the side doesn't say. */
  fields: Set<string> | null;
}

interface ResolvedSide {
  kind: "app" | "source" | "manifest";
  id: string;
  name: string;
  entries: Entry[];
  notes: string[];
}

export class MeshError extends Error {}

export interface MeshFieldRow {
  a?: string;
  b?: string;
  conceptField: string;
  status: "direct" | "convert" | "a-only" | "b-only";
  why?: string;
  personal?: string;
}

export interface MeshPair {
  grade: Grade;
  match: MatchKind | null;
  a: { locals: string[]; uri: string; label: string } | null;
  b: { locals: string[]; uri: string; label: string } | null;
  similarity?: number;
  how: string;
  fields?: MeshFieldRow[];
  score: number;
}

export function meshReport(instance: LatticeInstance, aSide: MeshSide, bSide: MeshSide) {
  const a = resolveSide(instance, aSide);
  const b = resolveSide(instance, bSide);
  const records = new Map<string, ConceptRecord>();
  const rec = (uri: string) => {
    if (!records.has(uri)) records.set(uri, instance.store.getConcept(uri)!);
    return records.get(uri)!;
  };

  // Ancestors through forks and earlier versions, excluding the abstract roots
  // (everything shares those; sharing them says nothing about compatibility).
  const roots = instance.ancestryCtx.skeletonUris;
  const lineageOf = (uri: string) => {
    const out = new Set<string>([uri]);
    let cursor: string | undefined = uri;
    for (let i = 0; cursor && i < 50; i++) {
      const r = instance.store.getConcept(cursor);
      const next = r?.forkedFrom as string | undefined;
      if (!next || roots.has(next)) break;
      out.add(next);
      cursor = next;
    }
    return out;
  };
  const relate = (x: Entry, y: Entry): { match: MatchKind; similarity?: number } | null => {
    if (x.uri === y.uri) return { match: "same" };
    const lx = lineageOf(x.uri), ly = lineageOf(y.uri);
    if ([...lx].some((u) => ly.has(u))) return { match: "lineage" };
    const cx = (rec(x.uri).coRefersWith as string[] | undefined) ?? [];
    const cy = (rec(y.uri).coRefersWith as string[] | undefined) ?? [];
    if (cx.includes(y.uri) || cy.includes(x.uri)) return { match: "coreference" };
    const vx = instance.vectors.vectorOf(x.uri), vy = instance.vectors.vectorOf(y.uri);
    if (vx && vy) {
      const s = cosine(vx, vy);
      if (s >= MESH_SIMILAR) return { match: "similar", similarity: Number(s.toFixed(3)) };
    }
    return null;
  };
  const rank = (m: { match: MatchKind; similarity?: number }) => BASE[m.match] + (m.similarity ?? 0) / 100;

  const pairs: MeshPair[] = [];
  const usedB = new Set<string>();
  // Strongest pairings first, so an exact match is never displaced by a near one.
  const candidates: Array<{ x: Entry; y: Entry; m: { match: MatchKind; similarity?: number } }> = [];
  for (const x of a.entries) for (const y of b.entries) {
    const m = relate(x, y);
    if (m) candidates.push({ x, y, m });
  }
  candidates.sort((p, q) => rank(q.m) - rank(p.m));
  const pairedA = new Set<string>();
  for (const { x, y, m } of candidates) {
    if (pairedA.has(x.uri) || (usedB.has(y.uri) && m.match !== "same")) continue;
    pairedA.add(x.uri);
    usedB.add(y.uri);
    pairs.push(pairOf(x, y, m));
  }
  for (const x of a.entries) if (!pairedA.has(x.uri)) {
    pairs.push({ grade: "gap", match: null, a: brief(x), b: null, how: `Only ${a.name} has this; ${b.name} has nothing that means it.`, score: 0 });
  }
  for (const y of b.entries) if (!usedB.has(y.uri)) {
    pairs.push({ grade: "gap", match: null, a: null, b: brief(y), how: `Only ${b.name} has this; ${a.name} has nothing that means it.`, score: 0 });
  }

  function brief(e: Entry) {
    return { locals: e.locals, uri: e.uri, label: e.label };
  }

  function pairOf(x: Entry, y: Entry, m: { match: MatchKind; similarity?: number }): MeshPair {
    const grade = GRADE_OF[m.match];
    const xr = rec(x.uri), yr = rec(y.uri);
    let how: string;
    if (m.match === "same") how = `Both use ${x.label}: the same concept, so records line up by construction.`;
    else if (m.match === "lineage") how = `${x.label} and ${y.label} share a lineage (fork or version): the changeset says how to translate.`;
    else if (m.match === "coreference") how = `${x.label} and ${y.label} are declared to describe the same thing from different perspectives: map them deliberately.`;
    else how = `${x.label} and ${y.label} only look alike (${Math.round((m.similarity ?? 0) * 100)}% similar): someone has to decide whether they mean the same thing.`;
    let fields: MeshFieldRow[] | undefined;
    let factor = 1;
    if (m.match !== "similar") {
      const cmp = compareConcepts(x.uri, xr, y.uri, yr);
      fields = [];
      for (const row of cmp.fields) {
        const an = row.a?.name, bn = row.b?.name;
        const aUses = an !== undefined && (x.fields ? x.fields.has(an) : true);
        const bUses = bn !== undefined && (y.fields ? y.fields.has(bn) : true);
        if (!aUses && !bUses) continue;
        const personal = [row.a?.classification, row.b?.classification].find((c) => c && (c.startsWith("personal") || c === "access-secret"));
        const base = { ...(an ? { a: an } : {}), ...(bn ? { b: bn } : {}), conceptField: bn ?? an ?? "", ...(personal ? { personal } : {}) };
        if (aUses && bUses) {
          const why = row.change === "renamed" ? `renamed ${an} → ${bn}` : row.differences.length ? `differs in ${row.differences.join(", ")}` : undefined;
          fields.push({ ...base, status: why ? "convert" : "direct", ...(why ? { why } : {}) });
        } else if (aUses) {
          fields.push({ ...base, status: "a-only", why: bn === undefined ? `${y.label} has no such field` : `${b.name} doesn't fill it` });
        } else {
          fields.push({ ...base, status: "b-only", why: an === undefined ? `${x.label} has no such field` : `${a.name} doesn't fill it` });
        }
      }
      const known = x.fields !== null || y.fields !== null;
      if (known && fields.length) {
        const direct = fields.filter((f) => f.status === "direct").length;
        const convert = fields.filter((f) => f.status === "convert").length;
        factor = 0.5 + 0.5 * ((direct + 0.6 * convert) / fields.length);
      }
    }
    return {
      grade, match: m.match, a: brief(x), b: brief(y), ...(m.similarity ? { similarity: m.similarity } : {}),
      how, ...(fields ? { fields } : {}), score: Number((BASE[m.match] * factor).toFixed(3)),
    };
  }

  const order: Record<Grade, number> = { direct: 0, translate: 1, manual: 2, gap: 3 };
  pairs.sort((p, q) => order[p.grade] - order[q.grade] || q.score - p.score);
  const count = (g: Grade) => pairs.filter((p) => p.grade === g).length;
  const score = pairs.length ? Math.round((100 * pairs.reduce((s, p) => s + p.score, 0)) / pairs.length) : 0;

  // Plain-English challenges, most important first.
  const challenges: string[] = [];
  const crossing = new Map<string, Set<string>>();
  for (const p of pairs) for (const f of p.fields ?? []) {
    if (f.personal && (f.status === "direct" || f.status === "convert")) {
      const label = p.a?.label ?? p.b?.label ?? "";
      crossing.set(label, (crossing.get(label) ?? new Set()).add(f.conceptField));
    }
  }
  if (crossing.size) {
    challenges.push("Personal data would cross between them: " +
      [...crossing].map(([c, fs]) => `${c} (${[...fs].slice(0, 5).join(", ")})`).join("; ") + ". Agree on consent and retention before connecting.");
  }
  const translate = pairs.filter((p) => p.grade === "translate");
  if (translate.length) challenges.push(`${translate.length} connection(s) need translation code: ` + translate.slice(0, 6).map((p) => `${p.a!.label} ↔ ${p.b!.label}`).join(", ") + ".");
  const manual = pairs.filter((p) => p.grade === "manual");
  if (manual.length) challenges.push(`${manual.length} connection(s) are only similar and need a human decision: ` + manual.slice(0, 6).map((p) => `${p.a!.label} ~ ${p.b!.label}`).join(", ") + ".");
  const lost = pairs.flatMap((p) => (p.fields ?? []).filter((f) => f.status === "a-only").map((f) => `${p.a!.label}.${f.conceptField}`));
  if (lost.length) challenges.push(`${b.name} won't receive ${lost.length} field(s) ${a.name} fills, e.g. ${lost.slice(0, 5).join(", ")}.`);
  const missing = pairs.flatMap((p) => (p.fields ?? []).filter((f) => f.status === "b-only").map((f) => `${p.b!.label}.${f.conceptField}`));
  if (missing.length) challenges.push(`${b.name} expects ${missing.length} field(s) ${a.name} never fills, e.g. ${missing.slice(0, 5).join(", ")}.`);
  const converts = pairs.flatMap((p) => (p.fields ?? []).filter((f) => f.status === "convert").map((f) => `${f.conceptField} (${f.why})`));
  if (converts.length) challenges.push(`${converts.length} shared field(s) need converting, e.g. ${converts.slice(0, 4).join("; ")}.`);
  const gapsA = pairs.filter((p) => p.grade === "gap" && p.a).length, gapsB = pairs.filter((p) => p.grade === "gap" && p.b).length;
  if (gapsA || gapsB) challenges.push(`${gapsA} of ${a.name}'s concept(s) and ${gapsB} of ${b.name}'s have no counterpart: they stay on one side.`);
  if (a.entries.some((e) => e.fields === null) || b.entries.some((e) => e.fields === null)) {
    challenges.push("Field-level detail is partial: a side that doesn't say which fields it fills is assumed to fill all of them. Registering with field lists (from schemalattice.json field maps) sharpens this report.");
  }

  return {
    a: { kind: a.kind, id: a.id, name: a.name, concepts: a.entries.length },
    b: { kind: b.kind, id: b.id, name: b.name, concepts: b.entries.length },
    score,
    counts: { direct: count("direct"), translate: count("translate"), manual: count("manual"), gap: count("gap") },
    challenges,
    pairs,
    notes: [...a.notes, ...b.notes],
    legend: {
      direct: "Same concept on both sides: records line up by construction.",
      translate: "Related by lineage (fork or version) or a declared co-reference: translation code, guided by the changeset.",
      manual: `Only similar in meaning (≥ ${MESH_SIMILAR}): a person decides whether they are the same thing.`,
      gap: "No counterpart: the data stays on one side.",
      score: "Average over every concept on either side: direct 1, lineage 0.75, co-reference 0.6, similar 0.3, gap 0, each scaled by the share of filled fields that line up when the sides say which fields they fill.",
    },
  };
}

function resolveSide(instance: LatticeInstance, side: MeshSide): ResolvedSide {
  const latest = (uri: string) => instance.store.latestVersionOf(uri);
  const describe = (uri: string) => {
    const r = instance.store.getConcept(uri);
    const ctx = r ? instance.store.getContext(r.inScheme as string) : null;
    return { label: r ? (r.prefLabel.en ?? Object.values(r.prefLabel)[0] ?? uri) : uri, context: ctx ? (ctx.prefLabel as Record<string, string>).en ?? "" : "" };
  };
  const merge = (items: Array<{ local: string; uri: string; fields: string[] | null }>): Entry[] => {
    const by = new Map<string, Entry>();
    for (const it of items) {
      const uri = latest(it.uri);
      const e = by.get(uri) ?? { locals: [], uri, ...describe(uri), fields: null as Set<string> | null };
      if (it.local && !e.locals.includes(it.local)) e.locals.push(it.local);
      if (it.fields) e.fields = new Set([...(e.fields ?? []), ...it.fields]);
      by.set(uri, e);
    }
    return [...by.values()];
  };

  if ("app" in side) {
    const app = instance.registry.listApps().find((x) => x.slug === side.app);
    if (!app) throw new MeshError(`no registered app "${side.app}"`);
    const usages = instance.registry.usagesOf(side.app);
    return {
      kind: "app", id: side.app, name: app.name, notes: [],
      entries: merge(usages.map((u) => ({ local: u.shortName ?? "", uri: u.uri, fields: u.fields ?? null }))),
    };
  }
  if ("source" in side) {
    const src = instance.sources.resolve(side.source);
    if (!src) throw new MeshError(`no public source "${side.source}"`);
    const items: Array<{ local: string; uri: string; fields: string[] | null }> = [];
    for (const c of src.carries) {
      const fields = src.fields.flatMap((f) => ("means" in f && f.means ? f.means.filter((m) => m.conceptUri === c.conceptUri).map((m) => m.field) : []));
      items.push({ local: c.role, uri: c.conceptUri, fields });
    }
    return { kind: "source", id: side.source, name: src.title, entries: merge(items), notes: [] };
  }
  const m = side.manifest;
  if (!m || typeof m !== "object" || !m.concepts || typeof m.concepts !== "object") {
    throw new MeshError("a pasted manifest needs a concepts object (schemalattice.json)");
  }
  const concepts = Object.entries(m.concepts as Record<string, unknown>);
  if (concepts.length > MANIFEST_MAX_CONCEPTS) throw new MeshError(`a manifest may list at most ${MANIFEST_MAX_CONCEPTS} concepts`);
  const fieldsByUri = new Map<string, Set<string>>();
  for (const fm of Object.values((m.fieldMaps ?? {}) as Record<string, { target?: { concept?: string }; fields?: Array<{ target?: string }> }>)) {
    const t = fm?.target?.concept;
    if (typeof t !== "string") continue;
    const s = fieldsByUri.get(t) ?? new Set();
    for (const f of fm.fields ?? []) if (typeof f?.target === "string") s.add(f.target);
    fieldsByUri.set(t, s);
  }
  const notes: string[] = [];
  const items: Array<{ local: string; uri: string; fields: string[] | null }> = [];
  for (const [local, v] of concepts) {
    let uri = typeof v === "string" ? v : (v as { uri?: string })?.uri;
    if (typeof uri !== "string") continue;
    if (!uri.startsWith("https://")) uri = `https://schemalattice.com/${uri.replace(/^\//, "")}`;
    if (!instance.store.hasConcept(uri)) {
      notes.push(`${local}: ${uri} is not in this catalog; left out`);
      continue;
    }
    items.push({ local, uri, fields: fieldsByUri.has(uri) ? [...fieldsByUri.get(uri)!] : null });
  }
  const name = side.name ?? ((m.project as { name?: string })?.name || "pasted manifest");
  return { kind: "manifest", id: name, name: String(name).slice(0, 80), entries: merge(items), notes };
}
