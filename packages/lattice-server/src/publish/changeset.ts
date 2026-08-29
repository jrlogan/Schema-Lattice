// Changeset validation per specs/changeset-format.md.
//
// A fork's changeset is the structural diff from parent to child. We
// validate each op against the field names the parent actually declares,
// then recompute `upgradable` rather than trusting the caller's claim.

import { PublishError } from "./errors.ts";

/** Ops with a clean Cambria lens mapping. `extend` is deliberately absent. */
export const UPGRADABLE_OPS = new Set([
  "add",
  "remove",
  "rename",
  "retype",
  "wrap",
  "unwrap",
  "nest",
  "hoist",
]);

export const KNOWN_OPS = new Set([...UPGRADABLE_OPS, "extend"]);

export const KNOWN_CONVERTERS = new Set([
  "identity",
  "stringToNumber",
  "numberToString",
]);

export interface ChangesetOp {
  op: string;
  [key: string]: unknown;
}

export interface Changeset {
  ops: ChangesetOp[];
  upgradable?: boolean;
  note?: string;
}

export interface ChangesetWarning {
  kind: string;
  message: string;
}

export interface ChangesetCheck {
  upgradable: boolean;
  /** Field names the ops produce when applied to the parent in order. */
  projectedFields: string[];
  warnings: ChangesetWarning[];
}

/** Field names declared by a record's `structure.fields[]`, if any. */
export function structureFieldNames(structure: unknown): string[] | null {
  if (!structure || typeof structure !== "object") return null;
  const fields = (structure as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return null;
  const names: string[] = [];
  for (const f of fields) {
    if (f && typeof f === "object" && typeof (f as { name?: unknown }).name === "string") {
      names.push((f as { name: string }).name);
    }
  }
  return names;
}

function str(op: ChangesetOp, key: string, index: number): string {
  const v = op[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new PublishError(
      "ERR_CHANGESET_OP_INVALID",
      `changeset op ${index} (${op.op}) requires a non-empty "${key}"`,
      { index, op: op.op, key },
    );
  }
  return v;
}

function requireField(
  present: Set<string>,
  name: string,
  op: ChangesetOp,
  index: number,
): void {
  if (!present.has(name)) {
    throw new PublishError(
      "ERR_CHANGESET_FIELD_MISSING",
      `changeset op ${index} (${op.op}) targets "${name}", which the parent does not declare`,
      { index, op: op.op, field: name, available: [...present].sort() },
    );
  }
}

function requireAbsent(
  present: Set<string>,
  name: string,
  op: ChangesetOp,
  index: number,
): void {
  if (present.has(name)) {
    throw new PublishError(
      "ERR_CHANGESET_FIELD_EXISTS",
      `changeset op ${index} (${op.op}) adds "${name}", which the parent already declares`,
      { index, op: op.op, field: name },
    );
  }
}

/**
 * Validate `changeset` against the parent's declared field names and
 * compute the authoritative `upgradable` flag.
 *
 * `parentFields` is null when the parent declares no structure — field
 * existence cannot be checked, so those checks are skipped and a warning
 * is emitted instead.
 */
export function checkChangeset(
  changeset: Changeset,
  parentFields: string[] | null,
  childFields: string[] | null,
): ChangesetCheck {
  if (!changeset || !Array.isArray(changeset.ops) || changeset.ops.length === 0) {
    throw new PublishError(
      "ERR_CHANGESET_EMPTY",
      "a fork must declare at least one changeset op — if nothing changed, adopt the parent instead of forking",
    );
  }

  const warnings: ChangesetWarning[] = [];
  const unchecked = parentFields === null;
  if (unchecked) {
    warnings.push({
      kind: "structure-unavailable",
      message:
        "the parent concept declares no structure.fields, so changeset ops could not be checked against real field names",
    });
  }
  const present = new Set(parentFields ?? []);

  let upgradable = true;

  changeset.ops.forEach((op, i) => {
    if (!op || typeof op.op !== "string") {
      throw new PublishError(
        "ERR_CHANGESET_OP_INVALID",
        `changeset op ${i} has no "op" field`,
        { index: i },
      );
    }
    if (!KNOWN_OPS.has(op.op)) {
      throw new PublishError(
        "ERR_CHANGESET_OP_UNKNOWN",
        `unknown changeset op "${op.op}" at index ${i}`,
        { index: i, op: op.op, known: [...KNOWN_OPS].sort() },
      );
    }
    if (!UPGRADABLE_OPS.has(op.op)) upgradable = false;

    switch (op.op) {
      case "add":
      case "extend": {
        const field = str(op, "field", i);
        if (op.op === "add" && typeof op.type !== "string") {
          throw new PublishError(
            "ERR_CHANGESET_OP_INVALID",
            `changeset op ${i} (add) requires a "type"`,
            { index: i },
          );
        }
        if (!unchecked) requireAbsent(present, field, op, i);
        present.add(field);
        break;
      }
      case "remove": {
        const field = str(op, "field", i);
        if (!unchecked) requireField(present, field, op, i);
        present.delete(field);
        break;
      }
      case "rename": {
        const from = str(op, "from", i);
        const to = str(op, "to", i);
        if (!unchecked) {
          requireField(present, from, op, i);
          requireAbsent(present, to, op, i);
        }
        present.delete(from);
        present.add(to);
        break;
      }
      case "retype": {
        const field = str(op, "field", i);
        if (!unchecked) requireField(present, field, op, i);
        const converter = op.converter;
        if (typeof converter !== "string" || !KNOWN_CONVERTERS.has(converter)) {
          throw new PublishError(
            "ERR_CHANGESET_CONVERTER_UNKNOWN",
            `changeset op ${i} (retype) needs a known converter — one of ${[...KNOWN_CONVERTERS].join(", ")}`,
            { index: i, converter: converter ?? null },
          );
        }
        break;
      }
      case "wrap":
      case "unwrap": {
        const field = str(op, "field", i);
        if (!unchecked) requireField(present, field, op, i);
        break;
      }
      case "nest": {
        const field = str(op, "field", i);
        const into = str(op, "into", i);
        if (!unchecked) requireField(present, field, op, i);
        present.delete(field);
        present.add(`${into}.${field}`);
        break;
      }
      case "hoist": {
        const field = str(op, "field", i);
        const to = str(op, "to", i);
        if (!unchecked) requireField(present, field, op, i);
        present.delete(field);
        present.add(to);
        break;
      }
    }
  });

  // The caller may state `upgradable`; the server is the authority.
  if (typeof changeset.upgradable === "boolean" && changeset.upgradable !== upgradable) {
    throw new PublishError(
      "ERR_CHANGESET_UPGRADABLE_MISMATCH",
      `changeset claims upgradable=${changeset.upgradable} but the ops compute to ${upgradable}`,
      { claimed: changeset.upgradable, computed: upgradable },
    );
  }

  const projectedFields = [...present].sort();

  // Advisory: ops applied in order should reproduce the child's structure.
  if (!unchecked && childFields) {
    const declared = [...new Set(childFields)].sort();
    const missing = projectedFields.filter((f) => !declared.includes(f));
    const extra = declared.filter((f) => !projectedFields.includes(f));
    if (missing.length || extra.length) {
      warnings.push({
        kind: "changeset-structure-drift",
        message:
          "applying the changeset to the parent does not reproduce the child's declared structure" +
          (missing.length ? ` — ops produce unmatched ${missing.join(", ")}` : "") +
          (extra.length ? ` — child declares unexplained ${extra.join(", ")}` : ""),
      });
    }
  }

  return { upgradable, projectedFields, warnings };
}
