// The client computes URIs offline, so its hashing must match the server's byte for byte.
// Runs the client's canonicalization and the server's real one over the same records.
import { hashConcept as serverConcept, hashContext as serverContext } from "../../lattice-server/src/hashing/hash.ts";
import { slugify as serverSlugify } from "../../lattice-server/src/tools/tools.ts";
// @ts-ignore — plain ESM without types
import { hashConcept, hashContext, slugify, originRecord, forkRecord } from "../schemalattice.mjs";

let failed = 0;
function same(name: string, a: unknown, b: unknown) {
  const ok = a === b;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — client ${a} vs server ${b}`}`);
}

const ctx = "https://schemalattice.com/s/voyage-log@9272a13c0e01";
const records: Record<string, any> = {
  minimal: originRecord({ contextUri: ctx, prefLabel: "Trip", definition: "One outing on the water." }),
  whitespace_and_unicode: originRecord({
    contextUri: ctx, prefLabel: "  Café   Ledger ", definition: "Ünïcode — dashes,\n\ttabs and  spaces.",
    altLabels: ["Boat", "Watercraft"],
  }),
  arrays_sorted: originRecord({
    contextUri: ctx, prefLabel: "X", definition: "d",
    broader: ["https://schemalattice.com/c/schemalattice/record@734784bc3df1", "https://schemalattice.com/c/schemalattice/asset@27538dcc6b27"],
    broadMatch: ["schema:Vehicle", "schema:Product"], coRefersWith: [],
  }),
  structure_nested: originRecord({
    contextUri: ctx, prefLabel: "Vessel", definition: "A boat.",
    structure: { kind: "entity", fields: [
      { name: "dims", type: "object", fields: [{ name: "loaM", type: "number", unit: "meters" }] },
      { name: "category", type: "enum", values: ["sailboat", "kayak"], required: true },
      { name: "vesselId", type: "reference", ref: "vessel-ops/vessel", refUri: "https://schemalattice.com/c/vessel-ops/vessel@a3880a5e8670" },
    ] },
  }),
  fork: forkRecord({
    contextUri: ctx, prefLabel: "Engine Hour Reading", definition: "A reading.",
    parentUri: "https://schemalattice.com/c/equipment-maintenance/engine-hour-reading@4c9751d73851",
    changeset: { ops: [{ op: "add", field: "t", type: "number", required: false }], note: "n" },
    structure: { kind: "entity", fields: [{ name: "t", type: "number" }] },
  }),
  fork_extend_not_upgradable: forkRecord({
    contextUri: ctx, prefLabel: "E", definition: "d", parentUri: "https://schemalattice.com/c/a/b@000000000000",
    changeset: { ops: [{ op: "extend", field: "x", structure: {} }] },
  }),
};
for (const [name, r] of Object.entries(records)) same(`concept ${name}`, hashConcept(r), serverConcept(r));
if (records.fork_extend_not_upgradable.changeset.upgradable !== false) { failed++; console.log("FAIL  extend makes a fork non-upgradable"); }

const contexts: Record<string, any> = {
  plain: { type: "ConceptScheme", prefLabel: { en: "Voyage Log" }, definition: { en: "Records of time on the water." } },
  with_parents: { type: "ConceptScheme", prefLabel: { en: "P" }, definition: { en: "d" }, parentContexts: ["https://b", "https://a"] },
};
for (const [name, r] of Object.entries(contexts)) same(`context ${name}`, hashContext(r), serverContext(r));

for (const label of ["Engine Hour Reading", "Café  Ledger!", "  --Weird__Label--  ", "A".repeat(60)]) {
  same(`slugify ${JSON.stringify(label)}`, slugify(label), serverSlugify(label));
}

console.log(`\n${failed === 0 ? "all parity checks passed" : `${failed} FAILED`}`);
process.exit(failed ? 1 : 0);
