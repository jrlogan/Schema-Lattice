// Lifecycles, field invariants and capture provenance
// (specs/lifecycle-and-provenance.md).
//
// All three are optional and live inside `structure`, so they are hashed:
// adding a state or re-grading a field's provenance is a semantic change
// and produces a new concept version, exactly like reclassifying a field.
// What they name must exist — an unknown provenance class, a transition to
// an undeclared state, or an invariant pinned to a state the lifecycle
// never reaches is refused, because two systems reading the same concept
// would otherwise disagree about what it says. Shape oddities that are
// legal but suspicious (unreachable states, exits from a terminal state)
// come back as advisories, never as refusals.

import type { ConceptRecord } from "../hashing/types.ts";
import type { GovernanceSeedResult } from "../seed/governance.ts";
import { PublishError } from "./errors.ts";

export interface StructureAdvisory {
  kind: string;
  message: string;
}

export interface LifecycleState {
  name: string;
  terminal?: boolean;
  description?: string;
}

export interface LifecycleTransition {
  from: string;
  to: string;
  /** The named event that moves the record, e.g. a webhook name. */
  on?: string;
}

export interface Lifecycle {
  /** The structure field that holds the current state, when there is one. */
  field?: string;
  initial: string;
  states: LifecycleState[];
  transitions?: LifecycleTransition[];
}

interface Field {
  name?: string;
  provenance?: unknown;
  immutableFrom?: unknown;
  [k: string]: unknown;
}

function structureOf(record: ConceptRecord): { fields?: unknown; lifecycle?: unknown } | null {
  const s = record.structure;
  return s && typeof s === "object" ? (s as { fields?: unknown; lifecycle?: unknown }) : null;
}

function fieldsOf(record: ConceptRecord): Field[] {
  const s = structureOf(record);
  return s && Array.isArray(s.fields) ? (s.fields as Field[]) : [];
}

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new PublishError("ERR_LIFECYCLE_INVALID", message, {
    ...details,
    guidance:
      "A lifecycle is { field?, initial, states: [{ name, terminal? }], transitions?: [{ from, to, on? }] }. Every name it uses must be a declared state.",
  });
}

/** The record's lifecycle, validated; null when it declares none. */
export function lifecycleOf(record: ConceptRecord): Lifecycle | null {
  const raw = structureOf(record)?.lifecycle;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) invalid("structure.lifecycle must be an object");
  const lc = raw as Record<string, unknown>;

  if (!Array.isArray(lc.states) || lc.states.length === 0) {
    invalid("structure.lifecycle.states must be a non-empty array");
  }
  const names = new Set<string>();
  for (const [i, st] of (lc.states as unknown[]).entries()) {
    const name = (st as { name?: unknown } | null)?.name;
    if (typeof name !== "string" || name.length === 0) {
      invalid(`lifecycle state ${i} needs a non-empty "name"`, { index: i });
    }
    if (names.has(name)) invalid(`lifecycle state "${name}" is declared twice`, { state: name });
    names.add(name);
  }

  if (typeof lc.initial !== "string" || !names.has(lc.initial)) {
    invalid(`lifecycle.initial ${JSON.stringify(lc.initial)} is not a declared state`, {
      initial: lc.initial ?? null,
      states: [...names],
    });
  }

  const transitions = lc.transitions ?? [];
  if (!Array.isArray(transitions)) invalid("structure.lifecycle.transitions must be an array");
  for (const [i, t] of (transitions as unknown[]).entries()) {
    const tr = (t ?? {}) as Record<string, unknown>;
    for (const end of ["from", "to"] as const) {
      if (typeof tr[end] !== "string" || !names.has(tr[end] as string)) {
        invalid(
          `lifecycle transition ${i} goes ${end} ${JSON.stringify(tr[end] ?? null)}, which is not a declared state`,
          { index: i, [end]: tr[end] ?? null, states: [...names] },
        );
      }
    }
    if (tr.on !== undefined && typeof tr.on !== "string") {
      invalid(`lifecycle transition ${i} "on" must be a string event name`, { index: i });
    }
  }

  if (lc.field !== undefined) {
    const declared = new Set(fieldsOf(record).map((f) => f.name));
    if (typeof lc.field !== "string" || !declared.has(lc.field)) {
      invalid(`lifecycle.field ${JSON.stringify(lc.field)} is not a declared structure field`, {
        field: lc.field ?? null,
      });
    }
  }

  return lc as unknown as Lifecycle;
}

/** Legal-but-suspicious lifecycle shapes, reported, never refused. */
export function lifecycleAdvisories(lc: Lifecycle): StructureAdvisory[] {
  const out: StructureAdvisory[] = [];
  const transitions = lc.transitions ?? [];
  const reachable = new Set([lc.initial]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of transitions) {
      if (reachable.has(t.from) && !reachable.has(t.to)) {
        reachable.add(t.to);
        grew = true;
      }
    }
  }
  const unreachable = lc.states.map((s) => s.name).filter((n) => !reachable.has(n));
  if (unreachable.length) {
    out.push({
      kind: "lifecycle-unreachable-state",
      message: `no transition path from "${lc.initial}" reaches ${unreachable.map((n) => `"${n}"`).join(", ")}`,
    });
  }
  const terminal = new Set(lc.states.filter((s) => s.terminal).map((s) => s.name));
  const exits = transitions.filter((t) => terminal.has(t.from));
  if (exits.length) {
    out.push({
      kind: "lifecycle-terminal-exit",
      message: `terminal state(s) ${[...new Set(exits.map((t) => `"${t.from}"`))].join(", ")} still have outgoing transitions`,
    });
  }
  return out;
}

/** Resolve a provenance value (slug or URI) to a provenance class slug, or null. */
export function resolveProvenance(gov: GovernanceSeedResult, value: string): string | null {
  if (gov.assurance.has(value)) return value;
  for (const [slug, uri] of gov.conceptUris) {
    if (uri === value && gov.assurance.has(slug)) return slug;
  }
  return null;
}

/**
 * Validate a record's lifecycle, field invariants and field provenance.
 * Throws on anything that names something unknown; returns advisories.
 */
export function assertValidStructureSemantics(
  gov: GovernanceSeedResult,
  record: ConceptRecord,
): StructureAdvisory[] {
  const lc = lifecycleOf(record);
  const states = new Set(lc?.states.map((s) => s.name) ?? []);

  for (const f of fieldsOf(record)) {
    if (f.provenance !== undefined) {
      if (typeof f.provenance !== "string" || !resolveProvenance(gov, f.provenance)) {
        throw new PublishError(
          "ERR_UNKNOWN_PROVENANCE",
          `field ${JSON.stringify(f.name ?? "?")} has unknown provenance ${JSON.stringify(f.provenance)}`,
          {
            guidance: `Use one of the governance provenance classes (${[...gov.assurance.keys()].join(", ")}) or the class concept's full URI. Provenance says how a value was captured; sensitivity goes in "classification".`,
          },
        );
      }
    }
    if (f.immutableFrom !== undefined) {
      if (!lc) {
        throw new PublishError(
          "ERR_IMMUTABLE_FROM_UNKNOWN_STATE",
          `field ${JSON.stringify(f.name ?? "?")} is immutable from a state, but the structure declares no lifecycle`,
          { guidance: 'Declare structure.lifecycle, or drop "immutableFrom".' },
        );
      }
      if (typeof f.immutableFrom !== "string" || !states.has(f.immutableFrom)) {
        throw new PublishError(
          "ERR_IMMUTABLE_FROM_UNKNOWN_STATE",
          `field ${JSON.stringify(f.name ?? "?")} is immutable from ${JSON.stringify(f.immutableFrom)}, which is not a declared lifecycle state`,
          { states: [...states] },
        );
      }
    }
  }

  return lc ? lifecycleAdvisories(lc) : [];
}
