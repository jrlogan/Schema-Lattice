// Builder packs: the catalog as one paste-ready markdown page.
//
// Hosted app generators (Lovable, Google AI Studio, Bolt, v0) cannot speak
// MCP and mostly cannot call a tool mid-build. What they can do is read a
// prompt, an attached file, or a URL. A pack is that page: the concepts for
// one domain with their fields, enum values and URIs, plus the few rules the
// generator needs to build on them and leave a trace the next tool can read.

import type { LatticeInstance } from "../server/instance.ts";
import type { ConceptRecord } from "../hashing/types.ts";
import { BASE_AUTHORITY } from "../hashing/hash.ts";

const MAX_CONCEPTS = 40;

export interface PackConcept {
  uri: string;
  record: ConceptRecord;
  /** Why it is in the pack: a context listing, or a search match. */
  similarity?: number;
}

interface Field {
  name?: string;
  type?: string;
  required?: boolean;
  values?: string[];
  itemType?: string;
  ref?: string;
  refUri?: string;
  unit?: string;
  classification?: string;
  description?: string;
  fields?: Field[];
}

function en(map: Record<string, string> | undefined): string {
  if (!map) return "";
  return map.en ?? Object.values(map)[0] ?? "";
}

/** `.../c/{context}/{name}@{hash}` → `{context}/{name}` */
function lineKey(uri: string): string {
  return uri.replace(/^.*\/c\//, "").replace(/@[0-9a-f]+$/, "");
}

/**
 * A concept whose own fork carries the same name in the same context has been
 * superseded by a newer version of itself. Showing both would hand a
 * generator two Trips and no way to choose.
 */
function isSuperseded(instance: LatticeInstance, uri: string): boolean {
  const key = lineKey(uri);
  return instance.store.forkChildren(uri).some((child) => lineKey(child) === key);
}

/** The latest version of a context, by slug or full URI. */
export function resolveContextSlug(instance: LatticeInstance, slugOrUri: string): string | null {
  const slug = slugOrUri.replace(/^.*\/s\//, "").replace(/@[0-9a-f]+$/, "");
  return instance.listContexts().some((c) => c.slug === slug) ? slug : null;
}

export function conceptsForContexts(instance: LatticeInstance, slugs: string[]): PackConcept[] {
  const out: PackConcept[] = [];
  for (const slug of slugs) {
    for (const row of instance.store.listConceptsInContext(slug, MAX_CONCEPTS, 0)) {
      if (isSuperseded(instance, row.uri)) continue;
      const record = instance.store.getConcept(row.uri);
      if (record) out.push({ uri: row.uri, record });
    }
  }
  return out.slice(0, MAX_CONCEPTS);
}

export function conceptsForMatches(
  instance: LatticeInstance,
  results: Array<{ uri: string; similarity: number }>,
): PackConcept[] {
  const out: PackConcept[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (isSuperseded(instance, r.uri) || seen.has(lineKey(r.uri))) continue;
    const record = instance.store.getConcept(r.uri);
    if (!record) continue;
    seen.add(lineKey(r.uri));
    out.push({ uri: r.uri, record, similarity: r.similarity });
  }
  return out;
}

function flatten(fields: Field[], prefix = ""): Array<Field & { path: string }> {
  const rows: Array<Field & { path: string }> = [];
  for (const f of fields) {
    if (!f.name) continue;
    const path = prefix + f.name;
    rows.push({ ...f, path });
    if (Array.isArray(f.fields)) rows.push(...flatten(f.fields, path + "."));
  }
  return rows;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function fieldTable(fields: Field[]): string {
  const rows = flatten(fields).map((f) => {
    const type = f.type === "array" && f.itemType ? `array of ${f.itemType}` : f.type ?? "";
    const notes: string[] = [];
    if (f.values?.length) notes.push(`one of: ${f.values.map((v) => `\`${v}\``).join(", ")}`);
    if (f.unit) notes.push(`unit: ${f.unit}`);
    if (f.refUri ?? f.ref) notes.push(`refers to ${f.refUri ?? f.ref}`);
    if (f.classification && f.classification !== "public") notes.push(`**${f.classification}** — keep private`);
    if (f.description) notes.push(f.description);
    return `| \`${f.path}\` | ${cell(type)} | ${f.required ? "yes" : ""} | ${cell(notes.join("; "))} |`;
  });
  if (rows.length === 0) return "";
  return ["| Field | Type | Required | Notes |", "|---|---|---|---|", ...rows].join("\n");
}

/** PascalCase local name a generator can use for the type or table. */
function localName(label: string): string {
  return label.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
    .replace(/^./, (c) => c.toUpperCase());
}

function conceptSection(c: PackConcept): string {
  const r = c.record;
  const structure = (r.structure ?? {}) as { kind?: string; fields?: Field[] };
  const lines = [`### ${en(r.prefLabel)}`, "", `URI: ${c.uri}`];
  const alt = en(r.altLabel as Record<string, string> | undefined);
  if (alt) lines.push(`Also called: ${alt}`);
  if (structure.kind) lines.push(`Kind: ${structure.kind}`);
  if (c.similarity !== undefined) lines.push(`Match to your description: ${c.similarity.toFixed(2)}`);
  lines.push("", en(r.definition as Record<string, string> | undefined));
  const scope = en(r.scopeNote as Record<string, string> | undefined);
  if (scope) lines.push("", `Scope: ${scope}`);
  const table = fieldTable(structure.fields ?? []);
  if (table) lines.push("", table);
  return lines.join("\n");
}

export interface PackOptions {
  host: string;
  /** What the pack covers, for the heading. */
  title: string;
  /** The URL this pack was served from, so the generator can re-fetch it. */
  selfUrl: string;
  query?: string;
}

export function renderPack(concepts: PackConcept[], opts: PackOptions): string {
  const base = `https://${opts.host}`;
  const manifest = {
    lattice: BASE_AUTHORITY,
    concepts: Object.fromEntries(
      concepts.slice(0, 3).map((c) => [localName(en(c.record.prefLabel)), { uri: c.uri, status: "adopted" }]),
    ),
  };
  const intro = opts.query
    ? `Concepts in the SchemaLattice catalog that match "${opts.query}". Matches below 0.85 are related, not identical: read each definition and use only the ones that mean what you are building.`
    : `Every current concept in the SchemaLattice catalog for this domain.`;

  const body = concepts.length > 0
    ? concepts.map(conceptSection).join("\n\n")
    : `No concept in the catalog fits yet. Build what you need, and keep a schemalattice.json listing your own types with \`"status": "originated"\` so the vocabulary can be published later.`;

  return `# Shared data vocabulary: ${opts.title}

> For app builders (Lovable, Google AI Studio, Bolt, v0, Replit, or any AI that writes code). Paste this page into the builder's prompt or knowledge, or give it the URL: ${opts.selfUrl}

${intro} Apps that build on the same concepts can exchange data without a translation layer, and each concept URI is permanent.

## Rules for the builder

1. **Use these concepts for your data model.** Name the type or table after the concept, and keep the field names, types and enum values exactly as listed. Store units as listed (e.g. meters, minutes); convert only for display.
2. **Extend, don't redefine.** You may add fields the app needs. Do not rename a listed field or reuse its name for a different meaning.
3. **Leave a trace.** Put a \`schemalattice.json\` file at the project root mapping each type to its concept URI, and a comment \`// [lattice:TypeName]\` above each type or table definition. Example:

\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

   Use \`"status": "forked"\` with \`"forkedFrom": "<uri>"\` for a type you changed, and \`"originated"\` for a type of your own.
4. **Respect sensitivity.** Fields marked confidential or restricted hold private data: keep them out of public pages, logs, analytics and shared links.
5. **Don't call the catalog from the running app.** It is a build-time reference, not a backend. Concept URIs never change, so they are safe to store.

## Concepts

${body}

## Need more?

- Other domains: ${base}/pack — lists every pack
- Search by description: ${base}/pack?q=a+short+description+of+the+records
- One concept as JSON: open its URI
- For coding assistants that support MCP (Claude Code, Cursor): connect ${base}/mcp and follow ${base}/skill
`;
}

export function renderPackIndex(instance: LatticeInstance, host: string): string {
  const base = `https://${host}`;
  const rows = instance
    .listContexts()
    .filter((c) => c.latest && c.slug !== "governance")
    .map((c) => `- [${c.title}](${base}/pack/${c.slug}) — ${c.conceptCount} concepts. ${c.definitionExcerpt}`);
  return `# SchemaLattice builder packs

> Paste-ready data vocabularies for AI app builders that cannot connect to an MCP server (Lovable, Google AI Studio, Bolt, v0, Replit). Give the builder one pack URL, or paste the page into its prompt.

- One domain: ${base}/pack/{context}
- Several: ${base}/pack/{context},{context}
- By description: ${base}/pack?q=a+short+description (searches are not recorded)

## Domains

${rows.join("\n")}
`;
}
