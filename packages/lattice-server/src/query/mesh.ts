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
  /** Set when the side's concept is an unpublished fork: compared through its parent, as a lineage match at best. */
  forkOf?: string;
  /** Concept fields this side holds as sensitive, beyond the concept's own classification (a source's stated classes). */
  sensitive?: Map<string, string>;
}

/** What a side's records can be placed by on a map: points, or areas they cover. */
type Placement = { shape: "point" | "area"; how: string };

export interface MeshSpatial {
  points: string;
  /** The other side: the areas points fall in, or the points matched to the nearest. */
  areas: string;
  method: "point-in-polygon" | "nearest";
  how: string;
}

interface ResolvedSide {
  kind: "app" | "source" | "manifest";
  id: string;
  name: string;
  entries: Entry[];
  notes: string[];
  placement: Placement | null;
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
  // A manifest's field maps may name the other side's wire fields (Open311's
  // lat, service_code): those are read through that source's own mappings.
  const otherSource = (side: MeshSide) => ("source" in side ? side.source : undefined);
  const a = resolveSide(instance, aSide, otherSource(bSide));
  const b = resolveSide(instance, bSide, otherSource(aSide));
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
    // An unpublished fork carries its parent's meaning with changes: never "same".
    if (x.uri === y.uri) return x.forkOf || y.forkOf ? { match: "lineage" } : { match: "same" };
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
  const pairedA = new Set<Entry>();
  for (const { x, y, m } of candidates) {
    if (pairedA.has(x) || (usedB.has(y.uri) && m.match !== "same")) continue;
    pairedA.add(x);
    usedB.add(y.uri);
    pairs.push(pairOf(x, y, m));
  }
  for (const x of a.entries) if (!pairedA.has(x)) {
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
    else if (x.forkOf || y.forkOf) {
      const fork = x.forkOf ? x : y;
      how = `${fork.locals.join(", ")} is an unpublished fork of ${fork.label}: its records line up with ${fork.label} except for what the fork changed. Publish the fork so the changeset can say exactly how.`;
    } else if (m.match === "lineage") how = `${x.label} and ${y.label} share a lineage (fork or version): the changeset says how to translate.`;
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
        const personal = [
          row.a?.classification, row.b?.classification,
          an ? x.sensitive?.get(an) : undefined, bn ? y.sensitive?.get(bn) : undefined,
        ].find((c) => c && (c.startsWith("personal") || c === "access-secret"));
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
  // Two different questions, kept apart: how cleanly the shared part connects
  // (fit), and how much there is to connect (overlap). Mixing them made two big
  // apps that share six concepts perfectly look like a bad match.
  const connected = pairs.filter((p) => p.grade !== "gap");
  // Records with a location can be placed in the other side's areas even when
  // no concept is shared: which ward is this report in.
  const spatial: MeshSpatial[] = [];
  for (const [pt, ar] of [[a, b], [b, a]] as const) {
    if (pt.placement?.shape === "point" && ar.placement?.shape === "area") {
      spatial.push({
        points: pt.name, areas: ar.name, method: "point-in-polygon",
        how: `Place each ${pt.name} record (${pt.placement.how}) in the ${ar.name} polygon that contains it (${ar.placement.how}), in one coordinate system. ` +
          "Points on sidewalks and streets often fall outside every parcel: fall back to the nearest polygon within a few metres.",
      });
    }
  }
  // Two point sides relate by distance: the nearest street tree, the nearest station.
  if (a.placement?.shape === "point" && b.placement?.shape === "point" && (a.kind !== "source" || b.kind !== "source")) {
    const [mine, theirs] = a.kind === "source" ? [b, a] : [a, b];
    spatial.push({
      points: mine.name, areas: theirs.name, method: "nearest",
      how: `Match each ${mine.name} record (${mine.placement!.how}) to the nearest ${theirs.name} point (${theirs.placement!.how}) within a distance you choose, ` +
        "measured in metres in a projected coordinate system, and keep the distance with the match. Report the rate with lattice_report_join (method nearest).",
    });
  }
  const fit = connected.length ? Math.round((100 * connected.reduce((s, p) => s + p.score, 0)) / connected.length) : 0;
  const smaller = Math.min(a.entries.length, b.entries.length);
  const overlap = {
    connected: connected.length,
    aConcepts: a.entries.length,
    bConcepts: b.entries.length,
    ofSmaller: smaller ? Number((connected.length / smaller).toFixed(3)) : 0,
  };

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
  if (lost.length) challenges.push(`${lost.length} shared-concept field(s) are filled only by ${a.name}, so ${b.name} has nothing for them, e.g. ${lost.slice(0, 5).join(", ")}.`);
  const missing = pairs.flatMap((p) => (p.fields ?? []).filter((f) => f.status === "b-only").map((f) => `${p.b!.label}.${f.conceptField}`));
  if (missing.length) challenges.push(`${missing.length} shared-concept field(s) are filled only by ${b.name}, so ${a.name} has nothing for them, e.g. ${missing.slice(0, 5).join(", ")}.`);
  const converts = pairs.flatMap((p) => (p.fields ?? []).filter((f) => f.status === "convert").map((f) => `${f.conceptField} (${f.why})`));
  if (converts.length) challenges.push(`${converts.length} shared field(s) need converting, e.g. ${converts.slice(0, 4).join("; ")}.`);
  const gapsA = pairs.filter((p) => p.grade === "gap" && p.a).length, gapsB = pairs.filter((p) => p.grade === "gap" && p.b).length;
  if (gapsA || gapsB) challenges.push(`${gapsA} of ${a.name}'s concept(s) and ${gapsB} of ${b.name}'s have no counterpart. That is normal for apps that do different things; it only matters if the integration needs them.`);
  if (spatial.length) {
    challenges.unshift(...spatial.map((x) => x.method === "nearest"
      ? `${x.points} records can be matched to the nearest ${x.areas} record by distance: ${x.how}`
      : `${x.points} records can be placed in ${x.areas} by point in polygon: ${x.how}`));
  }
  if (!connected.length && !spatial.length) challenges.unshift(`${a.name} and ${b.name} share no concepts: there is nothing in common to connect yet.`);
  else if (!connected.length) challenges.push(`${a.name} and ${b.name} share no concepts; they connect only by location.`);
  if (a.entries.some((e) => e.fields === null) || b.entries.some((e) => e.fields === null)) {
    challenges.push("Field-level detail is partial: a side that doesn't say which fields it fills is assumed to fill all of them. Registering with field lists (from schemalattice.json field maps) sharpens this report.");
  }

  return {
    a: { kind: a.kind, id: a.id, name: a.name, concepts: a.entries.length },
    b: { kind: b.kind, id: b.id, name: b.name, concepts: b.entries.length },
    fit,
    overlap,
    /** Same as fit; kept so callers have one headline number. */
    score: fit,
    counts: { direct: count("direct"), translate: count("translate"), manual: count("manual"), gap: count("gap"), spatial: spatial.length },
    challenges,
    pairs,
    spatial,
    notes: [...a.notes, ...b.notes],
    legend: {
      direct: "Same concept on both sides: records line up by construction.",
      translate: "Related by lineage (fork or version) or a declared co-reference: translation code, guided by the changeset.",
      manual: `Only similar in meaning (≥ ${MESH_SIMILAR}): a person decides whether they are the same thing.`,
      gap: "No counterpart: the data stays on one side.",
      spatial: "One side's records carry a location and the other's are areas: they connect by point in polygon whatever concepts they use.",
      fit: "How cleanly the shared part connects, 0-100: the average over connected concepts of direct 1, lineage 0.75, co-reference 0.6, similar 0.3, each scaled by the share of filled fields that line up when the sides say which fields they fill. Gaps don't lower it.",
      overlap: "How much there is to connect: connected concepts, and that as a share of the smaller side.",
    },
  };
}

function resolveSide(instance: LatticeInstance, side: MeshSide, otherSource?: string): ResolvedSide {
  const latest = (uri: string) => instance.store.latestVersionOf(uri);
  const describe = (uri: string) => {
    const r = instance.store.getConcept(uri);
    const ctx = r ? instance.store.getContext(r.inScheme as string) : null;
    return { label: r ? (r.prefLabel.en ?? Object.values(r.prefLabel)[0] ?? uri) : uri, context: ctx ? (ctx.prefLabel as Record<string, string>).en ?? "" : "" };
  };
  const merge = (items: Array<{ local: string; uri: string; fields: string[] | null; forkOf?: boolean; sensitive?: Map<string, string> }>): Entry[] => {
    const by = new Map<string, Entry>();
    for (const it of items) {
      const uri = latest(it.uri);
      const key = it.forkOf ? `fork:${it.local}` : uri;
      const e = by.get(key) ?? { locals: [], uri, ...describe(uri), fields: null as Set<string> | null, ...(it.forkOf ? { forkOf: uri } : {}) };
      if (it.local && !e.locals.includes(it.local)) e.locals.push(it.local);
      if (it.fields) e.fields = new Set([...(e.fields ?? []), ...it.fields]);
      if (it.sensitive?.size) e.sensitive = new Map([...(e.sensitive ?? []), ...it.sensitive]);
      by.set(key, e);
    }
    return [...by.values()];
  };

  if ("app" in side) {
    const app = instance.registry.listApps().find((x) => x.slug === side.app);
    if (!app) throw new MeshError(`no registered app "${side.app}"`);
    const usages = instance.registry.usagesOf(side.app);
    const entries = merge(usages.map((u) => ({ local: u.shortName ?? "", uri: u.uri, fields: u.fields ?? null })));
    return { kind: "app", id: side.app, name: app.name, notes: [], entries, placement: placementOf(instance, entries) };
  }
  if ("source" in side) {
    const src = instance.sources.resolve(side.source);
    if (!src) throw new MeshError(`no public source "${side.source}"`);
    const items: Array<{ local: string; uri: string; fields: string[] | null; sensitive?: Map<string, string> }> = [];
    for (const c of src.carries) {
      const fields = src.fields.flatMap((f) => ("means" in f && f.means ? f.means.filter((m) => m.conceptUri === c.conceptUri).map((m) => m.field) : []));
      // A source can hold a concept field more sensitively than the concept
      // says: iNaturalist coordinates are where a person stood.
      const sensitive = new Map<string, string>();
      for (const f of src.fields) {
        const cls = "classification" in f ? (f.classification as string | undefined) : undefined;
        if (!cls || !("means" in f) || !f.means) continue;
        for (const m of f.means) if (m.conceptUri === c.conceptUri) sensitive.set(m.field, cls);
      }
      items.push({ local: c.role, uri: c.conceptUri, fields, sensitive });
    }
    const shape = src.geometry ? (/point/i.test(src.geometry) || src.geometry === "location" ? "point" : /line/i.test(src.geometry) ? null : "area") : null;
    const placement: Placement | null = shape
      ? { shape, how: src.platform === "arcgis" ? "its layer geometry, requested with outSR=4326" : src.locationFields ?? `its ${src.geometry} field` }
      : null;
    return { kind: "source", id: side.source, name: src.title, entries: merge(items), notes: [], placement };
  }
  const m = side.manifest;
  if (!m || typeof m !== "object" || !m.concepts || typeof m.concepts !== "object") {
    throw new MeshError("a pasted manifest needs a concepts object (schemalattice.json)");
  }
  // The registry's array shape ([{ shortName, uri }]) and the manifest's object shape both work.
  const concepts: Array<[string, unknown]> = Array.isArray(m.concepts)
    ? (m.concepts as Array<Record<string, unknown>>).map((c, i) => [String(c?.shortName ?? c?.name ?? c?.local ?? `concept ${i + 1}`), c])
    : Object.entries(m.concepts as Record<string, unknown>);
  if (concepts.length > MANIFEST_MAX_CONCEPTS) throw new MeshError(`a manifest may list at most ${MANIFEST_MAX_CONCEPTS} concepts`);
  const absolute = (u: string) => (u.startsWith("https://") ? u : `https://schemalattice.com/${u.replace(/^\//, "")}`);
  const notes: string[] = [];

  // Each local name's URI: its own when published, its parent's when it is an unpublished fork.
  const local = new Map<string, { uri: string; fork: boolean }>();
  for (const [name, v] of concepts) {
    const o = (typeof v === "string" ? { uri: v } : (v ?? {})) as { uri?: string; forkedFrom?: string; status?: string };
    if (typeof o.uri === "string") local.set(name, { uri: absolute(o.uri), fork: false });
    else if (typeof o.forkedFrom === "string") local.set(name, { uri: absolute(o.forkedFrom), fork: true });
    else if (o.status === "originated") notes.push(`${name}: originated and not yet published, so nothing to compare it with`);
  }
  const conceptRef = (ref: unknown) => (typeof ref === "string" ? local.get(ref)?.uri ?? absolute(ref) : null);

  // Field maps say which concept fields the side fills. Names that are not
  // fields of the concept (wire names such as Open311's service_code) can't be
  // compared, and are reported rather than counted.
  const fieldsByUri = new Map<string, Set<string>>();
  for (const [mapName, fm] of Object.entries((m.fieldMaps ?? {}) as Record<string, {
    source?: { concept?: string }; target?: { concept?: string }; fields?: Array<{ target?: string; from?: string | string[]; concept?: string }>;
  }>)) {
    for (const end of ["target", "source"] as const) {
      const uri = conceptRef(fm?.[end]?.concept);
      const record = uri ? instance.store.getConcept(latest(uri)) : null;
      if (!uri || !record) continue;
      const known = new Set(((record.structure as { fields?: Array<{ name: string }> } | undefined)?.fields ?? []).map((f) => f.name));
      const names = (fm.fields ?? []).flatMap((f) => (end === "target" ? [f.target] : [f.from].flat())).filter((n): n is string => typeof n === "string");
      const hit = names.filter((n) => known.has(n));
      // Wire names of the source on the other side (or the one the map names) are
      // read through that source's mappings onto this concept.
      const wireSlug = (end === "target" ? (fm.target as { source?: string } | undefined)?.source : undefined) ?? otherSource;
      const wire = wireSlug ? instance.sources.resolve(wireSlug) : null;
      let translated = 0;
      if (wire && end === "target") {
        for (const n of names.filter((x) => !known.has(x))) {
          const f = wire.fields.find((x) => x.name === n);
          const means = f && "means" in f && f.means ? f.means.filter((m) => latest(m.conceptUri) === latest(uri)) : [];
          for (const m of means) { hit.push(m.field); translated++; }
        }
        if (translated) notes.push(`fieldMaps.${mapName}: ${translated} wire field(s) read through ${wire.slug}'s mappings`);
      }
      if (hit.length) {
        const s = fieldsByUri.get(latest(uri)) ?? new Set();
        hit.forEach((n) => s.add(n));
        fieldsByUri.set(latest(uri), s);
      }
      const unread = names.filter((n) => !known.has(n)).length - translated;
      if (end === "target" && unread > 0) {
        notes.push(`fieldMaps.${mapName}: ${unread} of ${names.length} target field(s) are wire names, not fields of the concept; not compared` +
          (wire ? "" : " (set target.source to the catalog source the payload goes to, and they are read through its mappings)"));
      }
    }
  }
  const items: Array<{ local: string; uri: string; fields: string[] | null; forkOf?: boolean }> = [];
  for (const [name, ref] of local) {
    if (!instance.store.hasConcept(ref.uri)) {
      notes.push(`${name}: ${ref.uri} is not in this catalog; left out`);
      continue;
    }
    if (ref.fork) notes.push(`${name}: an unpublished fork, compared through ${ref.uri}`);
    const filled = fieldsByUri.get(latest(ref.uri));
    items.push({ local: name, uri: ref.uri, fields: filled ? [...filled] : null, ...(ref.fork ? { forkOf: true } : {}) });
  }
  const name = side.name ?? ((m.project as { name?: string })?.name || "pasted manifest");
  const entries = merge(items);
  return { kind: "manifest", id: name, name: String(name).slice(0, 80), entries, notes, placement: placementOf(instance, entries) };
}

/**
 * Whether an app's or manifest's records carry a point location: one of its
 * concepts has latitude and longitude fields (or a geometry field) that the
 * side fills.
 */
function placementOf(instance: LatticeInstance, entries: Entry[]): Placement | null {
  for (const e of entries) {
    const fields = ((instance.store.getConcept(e.uri)?.structure as { fields?: Array<{ name: string; type?: string }> } | undefined)?.fields ?? []);
    const fills = (n: string) => e.fields === null || e.fields.has(n);
    const lat = fields.find((f) => /^(lat|latitude)$/i.test(f.name) && fills(f.name));
    const lng = fields.find((f) => /^(lng|lon|long|longitude)$/i.test(f.name) && fills(f.name));
    if (lat && lng) return { shape: "point", how: `${e.label}.${lat.name} and .${lng.name}` };
    const geo = fields.find((f) => /^(point|location|geometry)$/i.test(f.type ?? "") && fills(f.name));
    if (geo) return { shape: /point|location/i.test(geo.type ?? "") ? "point" : "area", how: `${e.label}.${geo.name}` };
  }
  return null;
}
