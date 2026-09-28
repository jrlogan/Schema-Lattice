#!/usr/bin/env node
/**
 * schemalattice — publish a platform's data vocabulary to SchemaLattice, generated from its code.
 *
 *   node schemalattice.mjs generate   [--config schemalattice.config.json]
 *   node schemalattice.mjs check      fail (exit 1) if the committed files are stale — for CI, offline
 *   node schemalattice.mjs publish    push anything not yet in the catalog (SCHEMALATTICE_KEY)
 *   node schemalattice.mjs status     which of the manifest's URIs the catalog already holds
 *
 * Config reference: README.md next to this file (packages/lattice-client in the SchemaLattice repo).
 *
 * Single file, zero dependencies, Node 20+. Vendor it into the repo that uses it; the current
 * copy is served at https://schemalattice.com/cli/schemalattice.mjs.
 *
 * The central idea: a SchemaLattice URI is a hash of the record's content, so `generate` can
 * compute every URI locally, exactly as the server will (specs/hashing-rules.md). The URIs land
 * in the PR that changes the schema, reviewers see them, and `publish` — run after merge, by CI
 * or by hand — only pushes records whose URIs are already committed. Nothing has to be written
 * back to the repository after publishing.
 *
 * What comes from where:
 *   fields   — the platform's own schema, via a source adapter (see loadSource)
 *   meaning  — the config: definition, skeleton parent, external vocabulary match, co-reference
 *   lineage  — the previous generated file: a concept whose content changed is published as a
 *              FORK of its previous URI with a field-level changeset
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const CLIENT_VERSION = '0.1.0';
const AUTHORITY = 'https://schemalattice.com';

/** Root skeleton (specs/root-skeleton.md). Seeded deterministically, so these never change. */
export const SKELETON = {
  thing: `${AUTHORITY}/c/schemalattice/thing@2c4bcbe8005b`,
  agent: `${AUTHORITY}/c/schemalattice/agent@0a323bca8e62`,
  person: `${AUTHORITY}/c/schemalattice/person@9db8ed3faa85`,
  organization: `${AUTHORITY}/c/schemalattice/organization@21722850c4fd`,
  'physical-object': `${AUTHORITY}/c/schemalattice/physical-object@895938265e33`,
  asset: `${AUTHORITY}/c/schemalattice/asset@27538dcc6b27`,
  location: `${AUTHORITY}/c/schemalattice/location@0a060f0f4ed3`,
  event: `${AUTHORITY}/c/schemalattice/event@04b611d4b94c`,
  activity: `${AUTHORITY}/c/schemalattice/activity@b533026098bb`,
  transaction: `${AUTHORITY}/c/schemalattice/transaction@b0651c76b293`,
  concept: `${AUTHORITY}/c/schemalattice/concept@55f6f1e2a123`,
  classification: `${AUTHORITY}/c/schemalattice/classification@be6d933fd7e8`,
  credential: `${AUTHORITY}/c/schemalattice/credential@75bea42caa99`,
  workflow: `${AUTHORITY}/c/schemalattice/workflow@f77ee6f81afc`,
  quantity: `${AUTHORITY}/c/schemalattice/quantity@628312c59d4c`,
  record: `${AUTHORITY}/c/schemalattice/record@734784bc3df1`,
};

// ─── Hashing: a byte-for-byte mirror of lattice-server src/hashing/canonicalize.ts ──────────

const CONCEPT_HASHED = new Set(['type', 'inScheme', 'prefLabel', 'altLabel', 'hiddenLabel', 'definition',
  'scopeNote', 'broader', 'narrower', 'related', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch',
  'derivedFrom', 'forkedFrom', 'previousVersion', 'importedFrom', 'coRefersWith', 'entryLevel',
  'collapsesTo', 'structure', 'changeset']);
const CONTEXT_HASHED = new Set(['type', 'prefLabel', 'definition', 'derivedFrom', 'parentContexts',
  'entryLevelAllowedRange']);
const TEXT_FIELDS = new Set(['prefLabel', 'altLabel', 'hiddenLabel', 'definition', 'scopeNote']);
const URI_ARRAYS = new Set(['broader', 'narrower', 'related', 'closeMatch', 'broadMatch', 'narrowMatch',
  'relatedMatch', 'coRefersWith', 'collapsesTo', 'parentContexts']);

const normText = (s) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

function filterRecord(record, allowed) {
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (!allowed.has(k) || k.startsWith('_') || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    if (TEXT_FIELDS.has(k) && typeof v === 'object' && !Array.isArray(v)) {
      const norm = {};
      for (const [lang, text] of Object.entries(v)) {
        if (typeof text !== 'string') continue;
        const t = normText(text);
        if (t) norm[lang.toLowerCase()] = t;
      }
      if (Object.keys(norm).length) out[k] = norm;
      continue;
    }
    out[k] = URI_ARRAYS.has(k) && Array.isArray(v) ? v.slice().sort() : v;
  }
  return out;
}

function encodeString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += s[i];
  }
  return out + '"';
}

export function canonicalJSON(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`hashed fields may not hold non-integer numbers (${value})`);
    return value.toString();
  }
  if (typeof value === 'string') return encodeString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => encodeString(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

const shortHash = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
export const hashConcept = (record) => shortHash(canonicalJSON(filterRecord(record, CONCEPT_HASHED)));
export const hashContext = (record) => shortHash(canonicalJSON(filterRecord(record, CONTEXT_HASHED)));

/** lattice-server src/tools/tools.ts slugify. */
export function slugify(label) {
  return label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}

// ─── Records, exactly as the server's tool handlers build them ─────────────────────────────

export function contextRecord(ctx) {
  const record = { type: 'ConceptScheme', prefLabel: { en: ctx.title }, definition: { en: ctx.definition } };
  if (ctx.parentContextUris?.length) record.parentContexts = ctx.parentContextUris;
  return record;
}

/** lattice_publish_concept → buildConceptRecord (hashed fields only matter). */
export function originRecord(args) {
  const r = { type: 'Concept', inScheme: args.contextUri, prefLabel: { en: args.prefLabel }, definition: { en: args.definition } };
  if (args.altLabels?.length) r.altLabel = { en: args.altLabels.join('; ') };
  for (const k of ['broader', 'related', 'closeMatch', 'broadMatch', 'narrowMatch', 'relatedMatch']) {
    if (args[k]?.length) r[k] = args[k];
  }
  if (args.coRefersWith) r.coRefersWith = args.coRefersWith;
  if (args.structure != null) r.structure = args.structure;
  if (args.sourceAttribution?.importedFrom) r.importedFrom = args.sourceAttribution.importedFrom;
  return r;
}

const UPGRADABLE = new Set(['add', 'remove', 'rename', 'retype', 'wrap', 'unwrap', 'nest', 'hoist']);

/** lattice_publish_fork → publishFork. No broader or external match: lineage runs through the parent. */
export function forkRecord(args) {
  const r = {
    type: 'Concept', inScheme: args.contextUri, prefLabel: { en: args.prefLabel }, definition: { en: args.definition },
    forkedFrom: args.parentUri,
    changeset: { ...args.changeset, upgradable: args.changeset.ops.every((op) => UPGRADABLE.has(op.op)) },
  };
  if (args.altLabels?.length) r.altLabel = { en: args.altLabels.join('; ') };
  if (args.structure) r.structure = args.structure;
  if (args.coRefersWith?.length) r.coRefersWith = args.coRefersWith;
  if (args.sourceAttribution?.importedFrom) r.importedFrom = args.sourceAttribution.importedFrom;
  return r;
}

// ─── Sources: the platform's schema, as lists of lattice-shaped fields per entity ──────────

/**
 * Every adapter returns { [entity]: Field[] } where Field is the lattice structure field shape:
 * { name, type, required?, unit?, values?, ref?, itemType?, fields?, format?, description? }.
 *
 *   { "format": "dictionary", "path": "x.json" }        already in that shape: { entities: { e: { fields } } }
 *   { "format": "command", "run": "npx vite-node …" }    a program that prints such a dictionary (Zod, Prisma…)
 *   { "format": "flat-fields", "path": "fields.json", "enums": "enums.json" }
 *                                                        [{ entity, name, type, required, description, enum_ref }]
 *   { "format": "json-schema", "path": "openapi.json", "pointer": "/components/schemas" }
 */
function loadSource(source, baseDir) {
  const read = (p) => JSON.parse(readFileSync(resolve(baseDir, p), 'utf8'));
  switch (source.format) {
    case 'dictionary': return entitiesOf(read(source.path));
    case 'command': return entitiesOf(JSON.parse(execSync(source.run, { cwd: baseDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 })));
    case 'flat-fields': return flatFields(read(source.path), source.enums ? read(source.enums) : {});
    case 'json-schema': return jsonSchemaEntities(read(source.path), source.pointer ?? '');
    default: throw new Error(`unknown source format ${JSON.stringify(source.format)}`);
  }
}

function entitiesOf(dict) {
  const out = {};
  for (const [name, e] of Object.entries(dict.entities ?? {})) out[name] = e.fields;
  return out;
}

const FLAT_TYPES = {
  'string (uuid)': { type: 'string', format: 'uuid' }, 'string (email)': { type: 'string', format: 'email' },
  'string (url)': { type: 'string', format: 'uri' }, 'date (ISO)': { type: 'date' }, 'array<string>': { type: 'array', itemType: 'string' },
};

function flatFields(list, enums) {
  const out = {};
  for (const f of list) {
    const enumValues = f.enum_ref ? (enums[f.enum_ref] ?? []).map((v) => (typeof v === 'string' ? v : v.id)) : null;
    let shape = { ...(FLAT_TYPES[f.type] ?? { type: f.type }) };
    if (enumValues && shape.type === 'array') shape = { type: 'array', itemType: 'enum', values: enumValues };
    else if (enumValues) shape = { type: 'enum', values: enumValues };
    const field = { name: f.name, ...shape };
    if (f.required) field.required = true;
    if (f.description) field.description = f.description;
    (out[f.entity] ??= []).push(field);
  }
  return out;
}

function jsonSchemaEntities(doc, pointer) {
  const schemas = pointer.split('/').filter(Boolean).reduce((o, k) => o?.[k], doc);
  if (!schemas) throw new Error(`nothing at ${pointer}`);
  const field = (name, s, required) => {
    const f = { name, ...jsonType(s) };
    if (required) f.required = true;
    if (s.description) f.description = s.description;
    return f;
  };
  const jsonType = (s) => {
    if (s.$ref) return { type: 'reference', ref: s.$ref.split('/').pop() };
    if (s.enum) return { type: 'enum', values: s.enum };
    if (s.type === 'array') {
      const item = jsonType(s.items ?? {});
      return item.type === 'object' ? { type: 'array', itemType: 'object', fields: item.fields } : { type: 'array', itemType: item.type, ...(item.values ? { values: item.values } : {}) };
    }
    if (s.type === 'object' && s.properties) {
      return { type: 'object', fields: Object.entries(s.properties).map(([k, v]) => field(k, v, s.required?.includes(k))) };
    }
    if (s.type === 'string' && s.format) return { type: s.format === 'date-time' ? 'datetime' : s.format === 'date' ? 'date' : 'string', ...(['date', 'date-time'].includes(s.format) ? {} : { format: s.format }) };
    return { type: Array.isArray(s.type) ? s.type.find((t) => t !== 'null') ?? 'any' : s.type ?? 'any' };
  };
  const out = {};
  for (const [name, s] of Object.entries(schemas)) {
    if (s.type === 'object' || s.properties) out[name] = Object.entries(s.properties ?? {}).map(([k, v]) => field(k, v, s.required?.includes(k)));
  }
  return out;
}

// ─── Generation ────────────────────────────────────────────────────────────────────────────

/** Config conventions, applied to top-level fields only (a source may apply its own deeper). */
function applyConventions(fields, config, entry) {
  const omit = new Set(config.omitFields ?? []);
  const refs = config.references ?? {};
  const units = config.unitSuffixes ?? [];
  return fields.filter((f) => !omit.has(f.name)).map((f) => {
    const out = { ...f };
    if (refs[f.name] && (out.type === 'string' || out.type === 'reference')) {
      out.type = 'reference'; out.ref = refs[f.name]; delete out.format;
    }
    if ((out.type === 'number' || out.type === 'integer') && !out.unit) {
      const hit = units.find(([suffix]) => f.name.length > suffix.length && f.name.endsWith(suffix) && /[a-z]/.test(f.name.at(-suffix.length - 1)));
      if (hit) out.unit = hit[1];
    }
    if (entry.classifications?.[f.name]) out.classification = entry.classifications[f.name];
    return out;
  });
}

/** Top-level field diff as changeset ops (specs/changeset-format.md). */
function changesetOps(before, after) {
  const prev = new Map(before.map((f) => [f.name, f]));
  const next = new Map(after.map((f) => [f.name, f]));
  const ops = [];
  for (const name of prev.keys()) if (!next.has(name)) ops.push({ op: 'remove', field: name });
  for (const [name, f] of next) {
    const p = prev.get(name);
    if (!p) ops.push({ op: 'add', field: name, type: f.type, ...(f.unit ? { unit: f.unit } : {}), ...(f.ref ? { ref: f.ref } : {}), required: !!f.required });
    else if (canonicalJSON(p) !== canonicalJSON(f)) ops.push({ op: 'retype', field: name, fromType: p.type, toType: f.type, converter: 'identity' });
  }
  return ops;
}

const stripRefUri = (fields) => fields.map(({ refUri, ...f }) => f);
const skeletonUri = (b) => SKELETON[b] ?? (b.startsWith('https://') ? b : null);

export function generate(config, baseDir, previous) {
  const errors = [];
  const entities = loadSource(config.source, baseDir);

  const contexts = {};
  for (const [slug, ctx] of Object.entries(config.contexts ?? {})) {
    contexts[slug] = ctx.uri
      ? { uri: ctx.uri, existing: true }
      : { uri: `${AUTHORITY}/s/${slug}@${hashContext(contextRecord(ctx))}`, title: ctx.title, definition: ctx.definition, ...(ctx.parentContextUris ? { parentContextUris: ctx.parentContextUris } : {}) };
  }

  const prevBy = new Map((previous?.concepts ?? []).map((c) => [c.shortName, c]));
  const uriBy = new Map(); // "context/slug" → URI, for concepts earlier in the list
  const concepts = [];

  for (const entry of config.concepts) {
    const fields = entities[entry.entity];
    if (!fields) { errors.push(`${entry.shortName}: source has no entity ${JSON.stringify(entry.entity)}`); continue; }
    const ctx = contexts[entry.context];
    if (!ctx) { errors.push(`${entry.shortName}: unknown context ${entry.context}`); continue; }
    for (const name of Object.keys(entry.classifications ?? {})) {
      if (!fields.some((f) => f.name === name)) errors.push(`${entry.shortName}: classification names unknown field ${name}`);
    }
    const slug = entry.slug ?? slugify(entry.prefLabel);
    const plain = applyConventions(fields, config, entry);
    // A reference to a concept EARLIER in the list carries its URI. Later ones cannot: their
    // URIs would depend on this one's, which is circular. Reorder the config to link them.
    const linked = plain.map((f) => (f.ref && uriBy.has(f.ref) ? { ...f, refUri: uriBy.get(f.ref) } : f));
    const structure = { kind: entry.structureKind ?? (entry.conceptKind === 'event' ? 'event' : 'entity'), fields: linked };
    const attribution = {
      ...(config.attribution ?? {}),
      sourceNotes: entry.sourceNotes ?? `Generated from ${entry.localLocation ?? entry.entity} by the schemalattice client`,
    };
    const common = {
      contextUri: ctx.uri, prefLabel: entry.prefLabel, definition: entry.definition,
      ...(entry.altLabels?.length ? { altLabels: entry.altLabels } : {}), structure, sourceAttribution: attribution,
    };

    const prev = prevBy.get(entry.shortName);
    let tool, args, record;
    if (!prev) {
      const broader = (Array.isArray(entry.broader) ? entry.broader : [entry.broader]).filter(Boolean).map((b) => {
        const uri = skeletonUri(b);
        if (!uri) errors.push(`${entry.shortName}: broader ${JSON.stringify(b)} is neither a skeleton slug nor a URI`);
        return uri;
      });
      tool = 'lattice_publish_concept';
      args = {
        ...common, conceptSlug: slug, ...(entry.conceptKind ? { conceptKind: entry.conceptKind } : {}), broader,
        ...(entry.related?.length ? { related: entry.related } : {}),
        ...(entry.closeMatch?.length ? { closeMatch: entry.closeMatch } : {}),
        ...(entry.broadMatch?.length ? { broadMatch: entry.broadMatch } : {}),
        coRefersWith: entry.coRefersWith ?? [],
        ...(entry.coRefersWith?.length ? {} : { coRefersRationale: entry.coRefersRationale ?? 'No catalog concept names the same referent from another perspective yet.' }),
      };
      record = originRecord(args);
    } else {
      const sameAsBefore = canonicalJSON(identity(prev.args)) === canonicalJSON(identity({ ...common, conceptSlug: slug }));
      if (sameAsBefore) {
        concepts.push(prev);
        uriBy.set(`${entry.context}/${slug}`, prev.uri);
        continue;
      }
      // Changed: a new version, forked from the one the manifest records.
      tool = 'lattice_publish_fork';
      args = {
        ...common, conceptSlug: slug, parentUri: prev.uri,
        changeset: { ops: changesetOps(stripRefUri(prev.args.structure?.fields ?? []), plain), note: entry.changeNote ?? `Schema change in ${entry.localLocation ?? entry.entity}` },
        ...(entry.coRefersWith?.length ? { coRefersWith: entry.coRefersWith } : {}),
      };
      record = forkRecord(args);
    }
    const uri = `${AUTHORITY}/c/${entry.context}/${slug}@${hashConcept(record)}`;
    uriBy.set(`${entry.context}/${slug}`, uri);
    concepts.push({
      shortName: entry.shortName, localLocation: entry.localLocation ?? null, uri,
      status: tool === 'lattice_publish_fork' ? 'forked' : 'originated',
      ...(args.parentUri ? { forkedFrom: args.parentUri } : prev?.forkedFrom ? { forkedFrom: prev.forkedFrom } : {}),
      tool, args,
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { contexts, concepts };
}

/**
 * What makes two versions "the same": context, labels, definition and fields. Links to other
 * concepts (refUri) are left out on purpose — when a referenced concept gets a new version,
 * the concepts pointing at it keep theirs rather than cascading a fork through the catalog.
 */
function identity(args) {
  return {
    contextUri: args.contextUri, prefLabel: args.prefLabel, definition: args.definition, conceptSlug: args.conceptSlug,
    altLabels: args.altLabels ?? [], kind: args.structure?.kind, fields: stripRefUri(args.structure?.fields ?? []),
  };
}

// ─── Files ─────────────────────────────────────────────────────────────────────────────────

function render(config, result, existingManifest) {
  const generated = {
    $comment: 'Generated by the schemalattice client from this repository. Do not edit; run `schemalattice generate`.',
    client: CLIENT_VERSION, lattice: config.lattice ?? AUTHORITY, contexts: result.contexts, concepts: result.concepts,
  };
  const manifest = {
    ...(existingManifest ?? {}),
    $schema: `${AUTHORITY}/schema/manifest-v1.json`,
    lattice: config.lattice ?? AUTHORITY,
    project: existingManifest?.project ?? { name: config.app?.name ?? 'project' },
    contexts: Object.fromEntries(Object.entries(result.contexts).map(([slug, c]) => [slug, c.uri])),
    concepts: Object.fromEntries(result.concepts.map((c) => [c.shortName, {
      uri: c.uri, status: c.status, ...(c.forkedFrom ? { forkedFrom: c.forkedFrom } : {}),
      ...(c.localLocation ? { localLocation: c.localLocation } : {}),
    }])),
    generatedBy: 'schemalattice client',
  };
  return [JSON.stringify(generated, null, 2) + '\n', JSON.stringify(manifest, null, 2) + '\n'];
}

function paths(configPath) {
  const baseDir = dirname(configPath);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  return {
    config, baseDir,
    generatedPath: resolve(baseDir, config.generated ?? '.schemalattice/concepts.generated.json'),
    manifestPath: resolve(baseDir, config.manifest ?? 'schemalattice.json'),
  };
}

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);

// ─── Catalog calls ─────────────────────────────────────────────────────────────────────────

function host(config) {
  return (process.env.SCHEMALATTICE_URL ?? process.env.LATTICE_URL ?? config.lattice ?? AUTHORITY).replace(/\/$/, '');
}

async function call(base, tool, args, key) {
  const res = await fetch(`${base}/api/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`${tool}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}

async function exists(base, uri) {
  const res = await fetch(base + new URL(uri).pathname, { method: 'HEAD' });
  return res.status === 200;
}

async function publish(config, generated, manifest) {
  const base = host(config);
  const key = process.env.SCHEMALATTICE_KEY ?? process.env.LATTICE_KEY;
  if (!key) throw new Error('SCHEMALATTICE_KEY is required to publish (this app\'s key from lattice_register_app)');
  const log = [];

  for (const [slug, ctx] of Object.entries(generated.contexts)) {
    if (ctx.existing || (await exists(base, ctx.uri))) continue;
    const res = await call(base, 'lattice_publish_context', { slug, title: ctx.title, definition: ctx.definition, ...(ctx.parentContextUris ? { parentContextUris: ctx.parentContextUris } : {}) }, key);
    if (res.uri !== ctx.uri) throw new Error(`context ${slug}: the catalog already has ${res.uri} under this slug. Set "uri": "${res.uri}" for it in the config, or choose another slug.`);
    log.push(`published context ${slug}`);
  }
  for (const c of generated.concepts) {
    if (await exists(base, c.uri)) continue;
    const { sessionId } = await call(base, 'lattice_discover', { description: c.args.definition, limit: 5, ephemeral: true });
    const res = await call(base, c.tool, { ...c.args, sessionId }, key);
    if (res.uri !== c.uri) throw new Error(`${c.shortName}: expected ${c.uri} but the catalog minted ${res.uri} — client and server disagree on hashing (client ${CLIENT_VERSION})`);
    for (const w of res.warnings ?? []) if (w.candidateUri !== c.forkedFrom) log.push(`  note ${c.shortName}: ${w.message ?? JSON.stringify(w)}`);
    log.push(`published ${c.status === 'forked' ? 'fork' : 'concept'} ${c.shortName} → ${c.uri}`);
  }
  if (config.app?.slug) {
    await call(base, 'lattice_register_app', {
      ...config.app, status: config.app.status ?? 'pilot',
      concepts: generated.concepts.map((c) => ({ uri: c.uri, status: c.status, shortName: c.shortName })),
    }, key);
    log.push(`registered ${config.app.slug} with ${generated.concepts.length} concepts`);
  }
  return log;
}

// ─── Annotations: put concept URIs into the contracts builders already read ─────────────────

/**
 * config.annotate: [{ "file": "api/capabilities.json", "path": "history.concept", "concept": "Trip" }]
 * Writes the concept's current URI at that JSON path. A builder's AI reads the platform's own
 * contract; it should find the concept there without ever having heard of the lattice.
 * JSON files only, and only ones already formatted as 2-space JSON, so nothing else moves.
 */
function annotations(config, baseDir, result) {
  const uris = new Map(result.concepts.map((c) => [c.shortName, c.uri]));
  const files = new Map();
  for (const a of config.annotate ?? []) {
    const uri = uris.get(a.concept);
    if (!uri) throw new Error(`annotate: no concept ${a.concept}`);
    const file = resolve(baseDir, a.file);
    if (!files.has(file)) {
      const text = readFileSync(file, 'utf8');
      const doc = JSON.parse(text);
      if (JSON.stringify(doc, null, 2) + '\n' !== text) throw new Error(`annotate: ${a.file} is not 2-space JSON; refusing to reformat it`);
      files.set(file, { text, doc });
    }
    const keys = a.path.split('.');
    let node = files.get(file).doc;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    node[keys.at(-1)] = uri;
  }
  return [...files].map(([file, { text, doc }]) => ({ file, before: text, after: JSON.stringify(doc, null, 2) + '\n' }));
}

// ─── CLI ───────────────────────────────────────────────────────────────────────────────────

async function main(argv) {
  const command = argv[0] ?? 'generate';
  const i = argv.indexOf('--config');
  const configPath = resolve(i >= 0 ? argv[i + 1] : 'schemalattice.config.json');
  if (command === '--version') return console.log(CLIENT_VERSION);
  const { config, baseDir, generatedPath, manifestPath } = paths(configPath);
  const previous = readJson(generatedPath);
  const existingManifest = readJson(manifestPath);

  if (command === 'generate' || command === 'check') {
    const result = generate(config, baseDir, previous);
    const [generated, manifest] = render(config, result, existingManifest);
    const annotated = annotations(config, baseDir, result);
    if (command === 'check') {
      const stale = [];
      if (!existsSync(generatedPath) || readFileSync(generatedPath, 'utf8') !== generated) stale.push(generatedPath);
      if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifest) stale.push(manifestPath);
      for (const a of annotated) if (a.before !== a.after) stale.push(a.file);
      if (stale.length) {
        console.error(`schemalattice: stale — ${stale.join(', ')}.\nRun \`schemalattice generate\` and commit the result; the URIs it writes are the ones publish will mint.`);
        process.exit(1);
      }
      return console.log('schemalattice: current');
    }
    mkdirSync(dirname(generatedPath), { recursive: true });
    writeFileSync(generatedPath, generated);
    writeFileSync(manifestPath, manifest);
    for (const a of annotated) if (a.before !== a.after) writeFileSync(a.file, a.after);
    const parsed = JSON.parse(generated);
    const changed = parsed.concepts.filter((c) => !previous?.concepts?.some((p) => p.uri === c.uri));
    return console.log(changed.length ? changed.map((c) => `${c.status} ${c.shortName} → ${c.uri}`).join('\n') : 'schemalattice: nothing changed');
  }
  if (command === 'publish') {
    if (!previous) throw new Error('nothing generated yet; run `schemalattice generate` first');
    const [generated] = render(config, generate(config, baseDir, previous), existingManifest);
    if (readFileSync(generatedPath, 'utf8') !== generated) throw new Error('generated file is stale; run `schemalattice generate` and commit before publishing');
    const log = await publish(config, previous, existingManifest);
    return console.log(log.join('\n') || 'schemalattice: catalog is current');
  }
  if (command === 'status') {
    const base = host(config);
    for (const c of previous?.concepts ?? []) console.log(`${(await exists(base, c.uri)) ? 'live   ' : 'pending'} ${c.shortName} ${c.uri}`);
    return;
  }
  throw new Error(`unknown command ${command}; use generate | check | publish | status`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('schemalattice.mjs')) {
  main(process.argv.slice(2)).catch((err) => { console.error(`schemalattice: ${err.message}`); process.exit(1); });
}
