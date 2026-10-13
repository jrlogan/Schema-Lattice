// Seed one domain from a JSON seed file: contexts, concepts, sources, mappings.
//
//   LATTICE_API_KEY=… npx tsx examples/public-sources/seed-domain.ts <seed.json> --target <url> [--check]
//
// Concepts are permanent, so every one is searched for first: a concept that
// discover already answers at the adopt band (≥ 0.85) with a different concept
// is not published, and the run says which existing concept to use instead.
// --check stops after that search, writing nothing. Re-running is safe:
// contexts and concepts are reused by slug, sources refreshed, mappings
// re-asserted.
//
// Seed format (examples/public-sources/domains/*.json):
//   contexts: [{ slug, title, definition }]
//   concepts: [{ context, conceptSlug, prefLabel, altLabels?, definition, conceptKind,
//                broaderRoot (a root slug) | broader (URIs), closeMatch?, broadMatch?,
//                coRefersWith?, coRefersRationale?, structure, sourceAttribution,
//                forkOf? (parent URI) + changeset? }]
//   sources:  [SourceSeed]
//   mappings: [{ source, concept: "<context>/<conceptSlug>" | URI, role, fields: [{ from, to, conversion? }] }]

import { readFileSync } from "node:fs";

const file = process.argv[2];
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const TARGET = arg("target");
const CHECK = process.argv.includes("--check");
const KEY = process.env.LATTICE_API_KEY;
if (!file || !TARGET || (!KEY && !CHECK)) {
  throw new Error("usage: LATTICE_API_KEY=… seed-domain.ts <seed.json> --target <url> [--check]");
}

interface ConceptSeed {
  context: string;
  conceptSlug: string;
  prefLabel: string;
  altLabels?: string[];
  definition: string;
  conceptKind?: string;
  broaderRoot?: string;
  broader?: string[];
  closeMatch?: string[];
  broadMatch?: string[];
  coRefersWith?: string[];
  coRefersRationale?: string;
  structure: { kind: string; fields: Array<Record<string, unknown>> };
  sourceAttribution?: Record<string, unknown>;
  forkOf?: string;
  changeset?: { ops: unknown[]; note?: string };
}
interface Seed {
  contexts?: Array<{ slug: string; title: string; definition: string }>;
  concepts?: ConceptSeed[];
  sources?: Array<Record<string, unknown> & { slug: string }>;
  mappings?: Array<{ source: string; concept: string; role: string; fields: unknown[] }>;
}
const seed = JSON.parse(readFileSync(file, "utf8")) as Seed;

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${TARGET}/api/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify(args),
  });
  return res.json();
}

let failed = 0;
const fail = (what: string, detail: unknown) => {
  failed++;
  console.log(`  ✗ ${what}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};

// Root concept URIs, by slug.
const contexts = (await call("lattice_list_context", {})).contexts as Array<{ slug: string; uri: string; latest: boolean }>;
const rootCtx = contexts.find((c) => c.slug === "schemalattice" && c.latest)!;
const roots = new Map<string, string>(
  ((await call("lattice_list_context", { contextUri: rootCtx.uri, limit: 200 })).concepts as Array<{ uri: string }>).map((c) => [
    c.uri.match(/\/c\/schemalattice\/([a-z0-9-]+)@/)![1],
    c.uri,
  ]),
);

// 1. Search first. Discover-before-publish is enforced, and it is the duplicate check.
const sessionId = `seed-domain-${Date.now()}`;
const concepts = seed.concepts ?? [];
const skip = new Set<string>();
console.log(`── ${file}\n\n1. What the catalog has for each concept`);
for (const c of concepts) {
  const r = await call("lattice_discover", { description: `${c.prefLabel}: ${c.definition}`, sessionId, limit: 3 });
  if (r.error) {
    fail(`discover ${c.prefLabel}`, r.error.message);
    continue;
  }
  const top = r.results[0];
  const same = top && top.uri.includes(`/c/${c.context}/${c.conceptSlug}@`);
  const parent = top && c.forkOf === top.uri;
  if (top && top.similarity >= 0.85 && !same && !parent) {
    skip.add(`${c.context}/${c.conceptSlug}`);
    console.log(`  ⚠ ${c.prefLabel.padEnd(28)} SKIPPED: the catalog already has ${top.prefLabel} (${top.similarity.toFixed(3)}) ${top.uri}`);
  } else {
    console.log(`  ${c.prefLabel.padEnd(30)} ${r.verdict.padEnd(9)} ${top ? `${top.prefLabel} (${top.similarity.toFixed(3)})` : "—"}`);
  }
}
if (CHECK) {
  console.log(`\n--check: nothing written. ${skip.size} concept(s) would be skipped as duplicates.`);
  process.exit(failed ? 1 : 0);
}

// 2. Contexts, reused when they exist.
const contextUri = new Map<string, string>(contexts.filter((c) => c.latest).map((c) => [c.slug, c.uri]));
for (const ctx of seed.contexts ?? []) {
  if (contextUri.has(ctx.slug)) continue;
  const r = await call("lattice_publish_context", ctx);
  if (r.error) fail(`context ${ctx.slug}`, r.error);
  else contextUri.set(ctx.slug, r.uri);
}

// 3. Concepts, reused by slug within their context.
const conceptUri = new Map<string, string>();
const listing = new Map<string, Array<{ uri: string }>>();
async function existing(ctx: string, slug: string): Promise<string | undefined> {
  if (!contextUri.has(ctx)) return undefined;
  if (!listing.has(ctx)) listing.set(ctx, (await call("lattice_list_context", { contextUri: contextUri.get(ctx), limit: 500 })).concepts ?? []);
  return listing.get(ctx)!.find((c) => c.uri.includes(`/c/${ctx}/${slug}@`))?.uri;
}
console.log("\n2. Concepts");
for (const c of concepts) {
  const key = `${c.context}/${c.conceptSlug}`;
  if (skip.has(key)) continue;
  const found = await existing(c.context, c.conceptSlug);
  if (found) {
    conceptUri.set(key, found);
    console.log(`  = ${c.prefLabel.padEnd(28)} ${found}`);
    continue;
  }
  const common = {
    contextUri: contextUri.get(c.context),
    conceptSlug: c.conceptSlug,
    prefLabel: c.prefLabel,
    altLabels: c.altLabels,
    definition: c.definition,
    structure: c.structure,
    sourceAttribution: c.sourceAttribution,
    sessionId,
  };
  const r = c.forkOf
    ? await call("lattice_publish_fork", { ...common, parentUri: c.forkOf, changeset: c.changeset, coRefersWith: c.coRefersWith ?? [] })
    : await call("lattice_publish_concept", {
        ...common,
        conceptKind: c.conceptKind,
        broader: c.broader ?? [roots.get(c.broaderRoot ?? "") ?? `unknown root ${c.broaderRoot}`],
        ...(c.closeMatch ? { closeMatch: c.closeMatch } : {}),
        ...(c.broadMatch ? { broadMatch: c.broadMatch } : {}),
        coRefersWith: c.coRefersWith ?? [],
        coRefersRationale: c.coRefersRationale ?? "No catalog concept describes this referent from another perspective yet.",
      });
  if (r.error) {
    fail(`publish ${c.prefLabel}`, r.error);
    continue;
  }
  conceptUri.set(key, r.uri);
  const warnings = (r.warnings ?? []).map((w: { message?: string; kind?: string }) => w.message ?? w.kind);
  console.log(`  + ${c.prefLabel.padEnd(28)} ${r.uri}${warnings.length ? `\n      warnings: ${warnings.join(" | ")}` : ""}`);
}

// 4. Sources.
console.log("\n3. Sources");
for (const s of seed.sources ?? []) {
  const r = await call("lattice_propose_source", s);
  if (r.error) fail(s.slug, `${r.error.message} ${JSON.stringify(r.error.details?.unknown ?? "")}`);
  else console.log(`  ${r.status.padEnd(8)} ${r.slug.padEnd(40)} ${String(r.fieldCount).padStart(3)} fields${r.fieldsVerified ? "" : " (hand-supplied)"}`);
}

// 5. Mappings.
let pairs = 0;
for (const m of seed.mappings ?? []) {
  const uri = m.concept.startsWith("https://") ? m.concept : conceptUri.get(m.concept);
  if (!uri) {
    fail(`${m.source} → ${m.concept}`, "concept was not published (skipped or failed)");
    continue;
  }
  const r = await call("lattice_map_source", { source: m.source, conceptUri: uri, role: m.role, fields: m.fields });
  if (r.error) fail(`${m.source} → ${m.concept}`, r.error.details?.problems ?? r.error.message);
  else pairs += r.recorded;
}
console.log(`\n${conceptUri.size} concepts, ${(seed.sources ?? []).length} sources, ${pairs} field pairs, ${failed} failures, ${skip.size} skipped as duplicates`);
process.exit(failed ? 1 : 0);
