// lattice_compare — a readable side-by-side of two concepts.
//
// The changeset on a fork is precise but written for machines: a list of
// ops against field names. Two parties deciding whether their records mean
// the same thing need the other view — every field on both sides, what was
// renamed into what, where sensitivity or capture provenance differs, and
// which lifecycle states only one side has. This builds that view from the
// two records alone (plus the changeset when one forks the other). It is
// read-only and never touches identity: the same pair always compares the
// same way.

import type { ConceptRecord } from "../hashing/types.ts";

export interface FieldSide {
  name: string;
  type?: string;
  classification?: string;
  provenance?: string;
  immutableFrom?: string;
  unit?: string;
  required?: boolean;
}

export type FieldChange = "same" | "changed" | "renamed" | "only-a" | "only-b";

export interface FieldRow {
  change: FieldChange;
  a?: FieldSide;
  b?: FieldSide;
  /** Attributes that differ between the two sides, for "changed"/"renamed". */
  differences: string[];
}

export interface LifecycleDiff {
  a: { initial: string; states: string[] } | null;
  b: { initial: string; states: string[] } | null;
  statesOnlyA: string[];
  statesOnlyB: string[];
  transitionsOnlyA: string[];
  transitionsOnlyB: string[];
}

export type Relation =
  | { kind: "b-forks-a" | "a-forks-b"; changeset: unknown }
  | { kind: "siblings"; parent: string }
  | { kind: "same" }
  | { kind: "unrelated" };

export interface Comparison {
  a: { uri: string; prefLabel: string; context: string };
  b: { uri: string; prefLabel: string; context: string };
  relation: Relation;
  fields: FieldRow[];
  lifecycle: LifecycleDiff | null;
  /** Plain-English sentences, most important first. */
  summary: string[];
  /** The field rows as a Markdown table, for pasting into a discussion. */
  table: string;
}

const COMPARED: Array<keyof FieldSide> = [
  "type",
  "classification",
  "provenance",
  "immutableFrom",
  "unit",
  "required",
];

function label(r: ConceptRecord): string {
  const m = r.prefLabel ?? {};
  return m.en ?? Object.values(m)[0] ?? "";
}

function contextSlug(uri: string): string {
  return uri.match(/\/c\/([^/]+)\//)?.[1] ?? "";
}

function fieldsOf(r: ConceptRecord): FieldSide[] {
  const s = r.structure as { fields?: unknown } | undefined;
  if (!s || !Array.isArray(s.fields)) return [];
  const out: FieldSide[] = [];
  for (const f of s.fields as Array<Record<string, unknown>>) {
    if (!f || typeof f.name !== "string") continue;
    const side: FieldSide = { name: f.name };
    for (const key of COMPARED) {
      if (f[key] !== undefined) (side as unknown as Record<string, unknown>)[key] = f[key];
    }
    out.push(side);
  }
  return out;
}

interface RawLifecycle {
  initial?: string;
  states?: Array<{ name?: string }>;
  transitions?: Array<{ from?: string; to?: string; on?: string }>;
}

function lifecycleOf(r: ConceptRecord): RawLifecycle | null {
  const lc = (r.structure as { lifecycle?: unknown } | undefined)?.lifecycle;
  return lc && typeof lc === "object" ? (lc as RawLifecycle) : null;
}

/**
 * Map parent field names to child field names using a fork's changeset, so
 * a renamed field shows as one row instead of a removal plus an addition.
 */
function renameMap(changeset: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const ops = (changeset as { ops?: unknown } | undefined)?.ops;
  if (!Array.isArray(ops)) return map;
  // Track each original parent name through successive ops.
  const current = new Map<string, string>(); // current name -> original parent name
  const originOf = (name: string) => current.get(name) ?? name;
  for (const op of ops as Array<Record<string, unknown>>) {
    let from: string | undefined;
    let to: string | undefined;
    if (op.op === "rename") {
      from = op.from as string;
      to = op.to as string;
    } else if (op.op === "hoist") {
      from = op.field as string;
      to = op.to as string;
    } else if (op.op === "nest") {
      from = op.field as string;
      to = `${op.into as string}.${op.field as string}`;
    }
    if (typeof from !== "string" || typeof to !== "string") continue;
    const origin = originOf(from);
    current.delete(from);
    current.set(to, origin);
  }
  for (const [now, origin] of current) if (now !== origin) map.set(origin, now);
  return map;
}

function differences(a: FieldSide, b: FieldSide): string[] {
  const out: string[] = [];
  for (const key of COMPARED) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(key);
  }
  return out;
}

function describe(side: FieldSide | undefined): string {
  if (!side) return "—";
  const parts = [side.type ?? "?"];
  if (side.unit) parts.push(side.unit);
  if (side.classification) parts.push(side.classification);
  if (side.provenance) parts.push(`provenance: ${side.provenance}`);
  if (side.immutableFrom) parts.push(`frozen from ${side.immutableFrom}`);
  return parts.join(" · ");
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function compareConcepts(
  aUri: string,
  a: ConceptRecord,
  bUri: string,
  b: ConceptRecord,
): Comparison {
  const aLabel = label(a);
  const bLabel = label(b);

  let relation: Relation = { kind: "unrelated" };
  if (aUri === bUri) relation = { kind: "same" };
  else if (b.forkedFrom === aUri) relation = { kind: "b-forks-a", changeset: b.changeset ?? null };
  else if (a.forkedFrom === bUri) relation = { kind: "a-forks-b", changeset: a.changeset ?? null };
  else if (a.forkedFrom && a.forkedFrom === b.forkedFrom) {
    relation = { kind: "siblings", parent: a.forkedFrom };
  }

  // Pair fields: by changeset renames when one forks the other, else by name.
  let aToB = new Map<string, string>();
  if (relation.kind === "b-forks-a") aToB = renameMap(relation.changeset);
  if (relation.kind === "a-forks-b") {
    for (const [parentName, childName] of renameMap(relation.changeset)) {
      aToB.set(childName, parentName);
    }
  }

  const aFields = fieldsOf(a);
  const bFields = fieldsOf(b);
  const bByName = new Map(bFields.map((f) => [f.name, f]));
  const usedB = new Set<string>();
  const rows: FieldRow[] = [];

  for (const af of aFields) {
    const target = aToB.get(af.name) ?? af.name;
    const bf = bByName.get(target);
    if (!bf) {
      rows.push({ change: "only-a", a: af, differences: [] });
      continue;
    }
    usedB.add(bf.name);
    const diff = differences(af, bf);
    const renamed = bf.name !== af.name;
    rows.push({
      change: renamed ? "renamed" : diff.length ? "changed" : "same",
      a: af,
      b: bf,
      differences: diff,
    });
  }
  for (const bf of bFields) {
    if (!usedB.has(bf.name)) rows.push({ change: "only-b", b: bf, differences: [] });
  }

  // Lifecycles.
  const la = lifecycleOf(a);
  const lb = lifecycleOf(b);
  let lifecycle: LifecycleDiff | null = null;
  if (la || lb) {
    const names = (lc: RawLifecycle | null) =>
      (lc?.states ?? []).map((s) => s.name).filter((n): n is string => typeof n === "string");
    const edges = (lc: RawLifecycle | null) =>
      (lc?.transitions ?? []).map((t) => `${t.from} → ${t.to}${t.on ? ` (${t.on})` : ""}`);
    const sa = names(la);
    const sb = names(lb);
    const ea = edges(la);
    const eb = edges(lb);
    lifecycle = {
      a: la ? { initial: la.initial ?? "", states: sa } : null,
      b: lb ? { initial: lb.initial ?? "", states: sb } : null,
      statesOnlyA: sa.filter((n) => !sb.includes(n)),
      statesOnlyB: sb.filter((n) => !sa.includes(n)),
      transitionsOnlyA: ea.filter((e) => !eb.includes(e)),
      transitionsOnlyB: eb.filter((e) => !ea.includes(e)),
    };
  }

  // Summary sentences.
  const summary: string[] = [];
  if (relation.kind === "b-forks-a" || relation.kind === "a-forks-b") {
    const child = relation.kind === "b-forks-a" ? bLabel : aLabel;
    const parent = relation.kind === "b-forks-a" ? aLabel : bLabel;
    const cs = relation.changeset as { ops?: unknown[]; upgradable?: boolean; note?: string } | null;
    const n = cs?.ops?.length ?? 0;
    summary.push(
      `${child} is a fork of ${parent}: ${n} changeset op${n === 1 ? "" : "s"}` +
        (cs?.upgradable === false ? ", not upgradable (it extends the structure)." : ".") +
        (cs?.note ? ` Note: ${cs.note}` : ""),
    );
  } else if (relation.kind === "siblings") {
    summary.push(`${aLabel} and ${bLabel} are both forks of ${relation.parent}.`);
  } else if (relation.kind === "unrelated") {
    summary.push(`${aLabel} and ${bLabel} have no fork relation; fields are paired by name only.`);
  }

  const count = (c: FieldChange) => rows.filter((r) => r.change === c).length;
  summary.push(
    `Fields: ${count("same")} the same, ${count("renamed")} renamed, ${count("changed")} changed, ` +
      `${count("only-a")} only in ${aLabel}, ${count("only-b")} only in ${bLabel}.`,
  );

  const sensitivity = rows.filter((r) => r.differences.includes("classification"));
  if (sensitivity.length) {
    summary.push(
      `Sensitivity differs on ${sensitivity.map((r) => r.b?.name ?? r.a?.name).join(", ")}.`,
    );
  }
  const graded = (side: "a" | "b") =>
    rows.filter((r) => r[side]?.provenance).map((r) => `${r[side]!.name} (${r[side]!.provenance})`);
  const ga = graded("a");
  const gb = graded("b");
  if (ga.length || gb.length) {
    summary.push(
      `Capture provenance: ${aLabel} grades ${ga.length ? ga.join(", ") : "no fields"}; ` +
        `${bLabel} grades ${gb.length ? gb.join(", ") : "no fields"}.`,
    );
  }
  if (lifecycle) {
    if (!lifecycle.a || !lifecycle.b) {
      const has = lifecycle.a ? aLabel : bLabel;
      const lc = (lifecycle.a ?? lifecycle.b)!;
      summary.push(
        `Only ${has} declares a lifecycle (${lc.states.length} states, starting at "${lc.initial}").`,
      );
    } else if (
      lifecycle.statesOnlyA.length ||
      lifecycle.statesOnlyB.length ||
      lifecycle.transitionsOnlyA.length ||
      lifecycle.transitionsOnlyB.length
    ) {
      summary.push(
        `Lifecycles differ: states only in ${aLabel}: ${lifecycle.statesOnlyA.join(", ") || "none"}; ` +
          `only in ${bLabel}: ${lifecycle.statesOnlyB.join(", ") || "none"}.`,
      );
    } else {
      summary.push("Both declare the same lifecycle.");
    }
  }

  const changeWords: Record<FieldChange, string> = {
    same: "same",
    changed: "changed",
    renamed: "renamed",
    "only-a": `only ${aLabel}`,
    "only-b": `only ${bLabel}`,
  };
  const table = [
    `| Field | ${cell(aLabel)} | ${cell(bLabel)} | Change |`,
    "| --- | --- | --- | --- |",
    ...rows.map((r) => {
      const name =
        r.change === "renamed" ? `${r.a!.name} → ${r.b!.name}` : (r.b?.name ?? r.a?.name ?? "");
      const what =
        r.differences.length && r.change !== "same"
          ? `${changeWords[r.change]} (${r.differences.join(", ")})`
          : changeWords[r.change];
      return `| ${cell(name)} | ${cell(describe(r.a))} | ${cell(describe(r.b))} | ${cell(what)} |`;
    }),
  ].join("\n");

  return {
    a: { uri: aUri, prefLabel: aLabel, context: contextSlug(aUri) },
    b: { uri: bUri, prefLabel: bLabel, context: contextSlug(bUri) },
    relation,
    fields: rows,
    lifecycle,
    summary,
    table,
  };
}
