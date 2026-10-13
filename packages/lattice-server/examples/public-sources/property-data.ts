// Property-data pilot: can the lattice point a builder at Connecticut and New
// Haven's public property data, say what every column means, and say how the
// datasets join?
//
//   npm run demo:property-data                        # throwaway local instance
//   LATTICE_API_KEY=… npm run demo:property-data -- --target https://schemalattice.com
//
// Locally, the one live concept this builds on (BLDS's Land Parcel) is mirrored
// from schemalattice.com with its hash checked, and every source's field list is
// read from its real publisher. With --target, the same calls go to that
// instance's REST tools with the given key; concepts published there are
// permanent. Re-running is safe: existing contexts, concepts and sources are
// reused, and re-proposals only refresh field lists.
//
// See examples/public-sources/RESULTS.md for what this showed.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../../src/server/instance.ts";
import { callTool } from "../../src/tools/tools.ts";
import { isToolError } from "../../src/tools/errors.ts";
import { hashConcept, hashContext } from "../../src/hashing/hash.ts";
import type { ConceptRecord, ContextRecord } from "../../src/hashing/types.ts";
import { renderSourcePage } from "../../src/http/sources-page.ts";
import { CONCEPTS, CONTEXTS, LAND_PARCEL_FORK, MAPPINGS, PARENT_LAND_PARCEL, SOURCES } from "./property-seed.ts";

const LIVE = "https://schemalattice.com";
const argTarget = process.argv.indexOf("--target");
const TARGET = argTarget >= 0 ? process.argv[argTarget + 1] : null;
const outIndex = process.argv.indexOf("--out");
const OUT = outIndex >= 0 ? process.argv[outIndex + 1] : null;

type Call = (name: string, args: Record<string, unknown>) => Promise<any>;

function fail(step: string, result: unknown): never {
  console.error(`\n✗ ${step}\n${JSON.stringify(result, null, 2)}`);
  process.exit(1);
}

/** Copy one live record into a local store, refusing it if its hash doesn't match its URI. */
async function mirror(instance: LatticeInstance, conceptUri: string) {
  const c = (await (await fetch(`${LIVE}${new URL(conceptUri).pathname}`)).json()) as { uri: string; record: ConceptRecord };
  const ctxUri = c.record.inScheme as string;
  const s = (await (await fetch(`${LIVE}${new URL(ctxUri).pathname}`)).json()) as { uri: string; record: ContextRecord };
  const [, ctxSlug, ctxHash] = ctxUri.match(/\/s\/([a-z0-9-]+)@([0-9a-f]+)$/)!;
  const [, , conceptSlug, conceptHash] = conceptUri.match(/\/c\/([a-z0-9-]+)\/([a-z0-9-]+)@([0-9a-f]+)$/)!;
  const { uri: _u, ...contextRecord } = s.record as ContextRecord & { uri?: string };
  if (hashContext(contextRecord as ContextRecord) !== ctxHash) throw new Error(`hash mismatch for ${ctxUri}`);
  if (hashConcept(c.record) !== conceptHash) throw new Error(`hash mismatch for ${conceptUri}`);
  if (!instance.store.hasContext(ctxUri)) instance.store.insertContext({ uri: ctxUri, slug: ctxSlug, hash: ctxHash, record: s.record });
  if (!instance.store.hasConcept(conceptUri)) {
    instance.store.insertConcept({ uri: conceptUri, contextSlug: ctxSlug, conceptSlug, hash: conceptHash, record: c.record });
  }
  await instance.ensureIndexed();
}

async function main() {
  let instance: LatticeInstance | null = null;
  let tmp: string | null = null;
  let call: Call;
  if (TARGET) {
    const key = process.env.LATTICE_API_KEY;
    if (!key) throw new Error("--target needs LATTICE_API_KEY (the operator key, or a contributor-tier app key)");
    call = async (name, args) => {
      const res = await fetch(`${TARGET}/api/tools/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(args),
      });
      return res.json();
    };
    console.log(`Seeding ${TARGET}`);
  } else {
    tmp = mkdtempSync(join(tmpdir(), "schemalattice-property-"));
    instance = await LatticeInstance.create({ dataDir: tmp });
    await mirror(instance, PARENT_LAND_PARCEL);
    const local = instance;
    call = (name, args) => callTool(local, name, args);
    console.log(`Local instance in ${tmp}; parent ${PARENT_LAND_PARCEL} mirrored from ${LIVE}`);
  }

  // 1. Search first: discover-before-publish is enforced, and it is the honest record of the gap.
  const sessionId = `property-data-${Date.now()}`;
  console.log("\n── 1. What the catalog had for each concept");
  for (const c of [LAND_PARCEL_FORK, ...CONCEPTS]) {
    const r = await call("lattice_discover", { description: c.definition, sessionId, limit: 3 });
    if (isToolError(r)) fail(`discover ${c.prefLabel}`, r);
    const top = r.results[0];
    console.log(`  ${c.prefLabel.padEnd(20)} ${r.verdict.padEnd(9)} ${top ? `${top.prefLabel} (${top.similarity.toFixed(3)})` : "—"}`);
  }

  // 2. Contexts, reused when they already exist.
  const known = (await call("lattice_list_context", {})).contexts as Array<{ slug: string; uri: string; latest: boolean }>;
  const contextUri: Record<string, string> = {};
  for (const ctx of CONTEXTS) {
    const existing = known.find((k) => k.slug === ctx.slug && k.latest);
    if (existing) {
      contextUri[ctx.slug] = existing.uri;
      continue;
    }
    const r = await call("lattice_publish_context", ctx);
    if (isToolError(r)) fail(`context ${ctx.slug}`, r);
    contextUri[ctx.slug] = r.uri;
  }

  // 3. Concepts, reused by slug within their context.
  const conceptUri: Record<string, string> = {};
  const existingIn = async (ctx: string, slug: string) => {
    const listing = await call("lattice_list_context", { contextUri: contextUri[ctx], limit: 500 });
    const hit = (listing.concepts ?? []).find((c: { uri: string }) => c.uri.includes(`/c/${ctx}/${slug}@`));
    return hit?.uri as string | undefined;
  };
  console.log("\n── 2. Concepts");
  conceptUri["land-parcel"] = (await existingIn("real-property", "land-parcel")) ?? (await (async () => {
    const r = await call("lattice_publish_fork", {
      parentUri: PARENT_LAND_PARCEL,
      contextUri: contextUri["real-property"],
      conceptSlug: LAND_PARCEL_FORK.conceptSlug,
      prefLabel: LAND_PARCEL_FORK.prefLabel,
      definition: LAND_PARCEL_FORK.definition,
      altLabels: LAND_PARCEL_FORK.altLabels,
      structure: LAND_PARCEL_FORK.structure,
      changeset: LAND_PARCEL_FORK.changeset,
      coRefersWith: [],
      sourceAttribution: LAND_PARCEL_FORK.sourceAttribution,
      sessionId,
    });
    if (isToolError(r)) fail("fork Land Parcel", r);
    if (r.warnings?.length) console.log(`  warnings: ${JSON.stringify(r.warnings)}`);
    return r.uri as string;
  })());
  console.log(`  Land Parcel          ${conceptUri["land-parcel"]}`);
  for (const c of CONCEPTS) {
    const existing = await existingIn(c.context, c.conceptSlug);
    if (existing) {
      conceptUri[c.conceptSlug] = existing;
    } else {
      const r = await call("lattice_publish_concept", {
        contextUri: contextUri[c.context],
        conceptSlug: c.conceptSlug,
        prefLabel: c.prefLabel,
        altLabels: c.altLabels,
        definition: c.definition,
        conceptKind: c.conceptKind,
        broader: [rootUri(c.broaderRoot)],
        ...(c.closeMatch ? { closeMatch: c.closeMatch } : {}),
        ...(c.broadMatch ? { broadMatch: c.broadMatch } : {}),
        coRefersWith: [],
        coRefersRationale: "No catalog concept describes this referent from another perspective yet.",
        structure: c.structure,
        sourceAttribution: c.sourceAttribution,
        sessionId,
      });
      if (isToolError(r)) fail(`publish ${c.prefLabel}`, r);
      if (r.warnings?.length) console.log(`  warnings for ${c.prefLabel}: ${r.warnings.map((w: { message: string }) => w.message).join(" | ")}`);
      conceptUri[c.conceptSlug] = r.uri;
    }
    console.log(`  ${c.prefLabel.padEnd(20)} ${conceptUri[c.conceptSlug]}`);
  }

  // 4. Sources: field lists read from each publisher.
  console.log("\n── 3. Sources (field lists read from the publishers)");
  for (const s of SOURCES) {
    const r = await call("lattice_propose_source", { ...s });
    if (isToolError(r)) {
      console.log(`  ✗ ${s.slug}: ${r.error.message}`);
      continue;
    }
    console.log(`  ${r.status.padEnd(8)} ${s.slug.padEnd(32)} ${String(r.fieldCount).padStart(3)} fields${r.fieldsVerified ? "" : " (hand-supplied)"}`);
  }

  // 5. Mappings.
  console.log("\n── 4. Field mappings");
  let pairs = 0;
  for (const m of MAPPINGS) {
    const r = await call("lattice_map_source", { source: m.source, conceptUri: conceptUri[m.concept], role: m.role, fields: m.fields });
    if (isToolError(r)) {
      console.log(`  ✗ ${m.source} → ${m.concept}: ${r.error.message}\n    ${JSON.stringify(r.error.details?.problems ?? r.error.details)}`);
      continue;
    }
    pairs += r.recorded;
  }
  console.log(`  ${pairs} field pairs recorded across ${MAPPINGS.length} source→concept mappings`);

  // 6. What a builder now gets.
  console.log("\n── 5. A builder in New Haven asks for data (jurisdiction US-CT/new-haven)");
  for (const q of [
    "home sale prices", "assessed value of houses", "is this property in a flood zone", "zoning of a parcel",
    "property tax mill rate", "parcel boundaries and owners", "population by census tract",
    "building permits issued", "blight and code enforcement cases",
  ]) {
    const found = await call("lattice_find_sources", { description: q, jurisdiction: "US-CT/new-haven", ephemeral: true, limit: 2 });
    const [a, b] = found.results;
    console.log(`  ${q.padEnd(36)} ${found.met ? "met  " : "unmet"} ${a ? `${a.slug} ${a.similarity.toFixed(3)}` : "—"}${b ? `, ${b.slug} ${b.similarity.toFixed(3)}` : ""}`);
  }

  console.log("\n── 6. How the New Haven parcel layer relates to everything else");
  const nh = await call("lattice_resolve_source", { slug: "new-haven-parcels" });
  console.log(`  ${nh.fields.length - nh.unmappedFields} of ${nh.fields.length} fields have a meaning recorded`);
  for (const rel of nh.related) {
    for (const j of rel.joins) {
      const how = j.pairs.length ? j.pairs.map((p: { a: string; b: string }) => `${p.a}=${p.b}`).join(", ") : "overlay";
      console.log(`  ${rel.slug.padEnd(30)} ${j.kind.padEnd(9)} ${j.via ? `via ${j.via.prefLabel}: ` : ""}${how}`);
    }
  }

  console.log("\n── 7. A concept now points at its data");
  const parcel = await call("lattice_resolve", { uri: conceptUri["land-parcel"] });
  for (const s of parcel.publicSources) console.log(`  ${s.role.padEnd(9)} ${s.slug.padEnd(30)} ${s.mappedFields.length} fields`);

  const report = await call("lattice_sources_report", {});
  console.log("\n── 8. Still unmapped");
  for (const u of report.unmappedFields) console.log(`  ${u.slug.padEnd(32)} ${u.unmapped} fields`);

  if (OUT && instance) {
    mkdirSync(OUT, { recursive: true });
    for (const slug of ["new-haven-parcels", "ct-real-estate-sales", "fema-nfhl-flood-hazard-zones"]) {
      writeFileSync(join(OUT, `${slug}.md`), renderSourcePage(instance.sources.resolve(slug)!, "schemalattice.com"));
    }
    console.log(`\nSource pages written to ${OUT}`);
  }

  instance?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });

  function rootUri(slug: string): string {
    if (instance) return instance.skeletonUri(slug)!;
    // Remote: the skeleton is seeded identically everywhere, so its URIs are the live ones.
    return SKELETON[slug] ?? (() => { throw new Error(`unknown root ${slug}`); })();
  }
}

/** Root URIs on schemalattice.com (the seeded skeleton). */
const SKELETON: Record<string, string> = {};

async function loadSkeleton() {
  if (!TARGET) return;
  const pack = (await (await fetch(`${TARGET}/api/tools/lattice_list_context`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  })).json()) as { contexts: Array<{ slug: string; uri: string; latest: boolean }> };
  const root = pack.contexts.find((c) => c.slug === "schemalattice" && c.latest)!;
  const listing = (await (await fetch(`${TARGET}${new URL(root.uri).pathname}/concepts?limit=200`)).json()) as { concepts: Array<{ uri: string }> };
  for (const c of listing.concepts) {
    const m = c.uri.match(/\/c\/schemalattice\/([a-z0-9-]+)@/);
    if (m) SKELETON[m[1]] = c.uri;
  }
}

loadSkeleton()
  .then(main)
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
