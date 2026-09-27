// Re-mint a catalog under the current BASE_AUTHORITY.
//
//   tsx src/bin/remint.ts --from <old data dir> --to <new, empty data dir>
//
// The authority is inside every hash (specs/hashing-rules.md), so a store minted
// under another authority cannot be renamed in place: each record must be
// rewritten and re-hashed, and every record that points at it must be rewritten
// in turn. This walks the old store in dependency order, rewrites every URI it
// has already mapped, re-hashes, and inserts into a fresh store — seeded records
// fall out as identical to the new seed. App registrations, attestations, usages
// and events are carried across with their URIs rewritten. The old store is
// opened read-only and never modified.
//
// Writes <to>/remint-map.json: { old URI → new URI } for everyone who recorded one.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { BASE_AUTHORITY, conceptUri, contextUri, hashConcept, hashContext } from "../hashing/hash.ts";
import type { ConceptRecord, ContextRecord } from "../hashing/types.ts";
import { LatticeInstance } from "../server/instance.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`usage: remint.ts --from <old data dir> --to <new data dir>`);
  return resolve(value);
}

const from = arg("from");
const to = arg("to");
if (existsSync(join(to, "dev.db"))) throw new Error(`${to} already holds a catalog; use an empty directory`);

const old = new Database(join(from, "dev.db"), { readonly: true });
const oldBlobDir = join(from, "blobs");

// Any lattice URI, under any authority, as it appears inside a string.
const URI_RE = /https:\/\/schemalattice\.(?:io|com)\/[cs]\/[a-z0-9-]+(?:\/[a-z0-9-]+)?@[0-9a-f]{12}/g;

const map = new Map<string, string>();

class Unmapped extends Error {}

function rewriteString(s: string): string {
  return s.replace(URI_RE, (uri) => {
    const mapped = map.get(uri);
    if (!mapped) throw new Unmapped(uri);
    return mapped;
  });
}

function rewrite<T>(value: T): T {
  if (typeof value === "string") return rewriteString(value) as T;
  if (Array.isArray(value)) return value.map(rewrite) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)])) as T;
  }
  return value;
}

function readBlob<T>(blobPath: string): T {
  // Blob paths are absolute on the machine that wrote them; the file name is
  // what survives a copy.
  return JSON.parse(readFileSync(join(oldBlobDir, basename(blobPath)), "utf8")) as T;
}

const instance = await LatticeInstance.create({ dataDir: to });
const store = instance.store;
const db = store.db;

type ContextRow = { uri: string; slug: string; blob_path: string; created_at: string };
type ConceptRow = ContextRow & {
  context_slug: string;
  concept_slug: string;
  adoption_count: number;
};

const contexts = old
  .prepare(`SELECT uri, slug, blob_path, created_at FROM contexts ORDER BY created_at, rowid`)
  .all() as ContextRow[];
const concepts = old
  .prepare(
    `SELECT uri, context_slug, concept_slug, blob_path, adoption_count, created_at
       FROM concepts ORDER BY created_at, rowid`,
  )
  .all() as ConceptRow[];

let inserted = 0;
let matchedSeed = 0;

function migrateContext(row: ContextRow): void {
  const { uri: _drop, ...rest } = readBlob<ContextRecord>(row.blob_path);
  const record = rewrite(rest) as ContextRecord;
  const hash = hashContext(record);
  const uri = contextUri(row.slug, hash);
  if (!store.hasContext(uri)) {
    store.insertContext({ uri, slug: row.slug, hash, record: { ...record, uri } });
    db.prepare(`UPDATE contexts SET created_at = ? WHERE uri = ?`).run(row.created_at, uri);
    inserted++;
  } else {
    matchedSeed++;
  }
  map.set(row.uri, uri);
}

function migrateConcept(row: ConceptRow): void {
  const { uri: _drop, ...rest } = readBlob<ConceptRecord>(row.blob_path);
  const record = rewrite(rest) as ConceptRecord;
  const hash = hashConcept(record);
  const uri = conceptUri(row.context_slug, row.concept_slug, hash);
  if (!store.hasConcept(uri)) {
    store.insertConcept({
      uri,
      contextSlug: row.context_slug,
      conceptSlug: row.concept_slug,
      hash,
      record: { ...record, uri },
    });
    inserted++;
  } else {
    matchedSeed++;
  }
  db.prepare(`UPDATE concepts SET created_at = ?, adoption_count = ? WHERE uri = ?`).run(
    row.created_at,
    row.adoption_count,
    uri,
  );
  map.set(row.uri, uri);
}

// Creation order is dependency order in practice, since a publish requires its
// parents to exist; the retry loop covers equal timestamps.
function drain<R extends { uri: string }>(rows: R[], migrate: (row: R) => void): void {
  let pending = rows;
  while (pending.length > 0) {
    const deferred: R[] = [];
    for (const row of pending) {
      try {
        migrate(row);
      } catch (err) {
        if (!(err instanceof Unmapped)) throw err;
        deferred.push(row);
      }
    }
    if (deferred.length === pending.length) {
      throw new Error(
        `cannot order ${deferred.length} records; first: ${deferred[0].uri} ` +
          `(references something that is not in the old store)`,
      );
    }
    pending = deferred;
  }
}

drain(contexts, migrateContext);
drain(concepts, migrateConcept);

// Everything that is not the catalog itself: copy row for row, rewriting URIs.
// The new store's own seed events are replaced by the old store's history.
const CATALOG_TABLES = new Set(["contexts", "concepts", "relations", "embedding_keys", "sqlite_sequence"]);
const tables = (
  old.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
)
  .map((t) => t.name)
  .filter((name) => !CATALOG_TABLES.has(name) && !name.startsWith("vec_concepts"));

const copied: Record<string, number> = {};
const unmappedInHistory = new Set<string>();

// History may mention URIs that never became records (a rejected publish, a
// typo'd resolve). Leave those as they were rather than refuse the migration.
function rewriteLoose(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(URI_RE, (uri) => {
    const mapped = map.get(uri);
    if (!mapped) unmappedInHistory.add(uri);
    return mapped ?? uri;
  });
}

db.transaction(() => {
  for (const table of tables) {
    const newCols = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );
    if (newCols.size === 0) throw new Error(`new store has no table ${table}`);
    const cols = (old.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => c.name)
      .filter((c) => newCols.has(c));
    db.prepare(`DELETE FROM ${table}`).run();
    const insert = db.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    );
    const rows = old.prepare(`SELECT ${cols.join(", ")} FROM ${table}`).raw().all() as unknown[][];
    for (const row of rows) insert.run(...row.map(rewriteLoose));
    copied[table] = rows.length;
  }
})();

const indexed = await instance.ensureIndexed();

const leftover = store.listConceptUris().filter((u) => !u.startsWith(`${BASE_AUTHORITY}/`));
if (leftover.length > 0) throw new Error(`foreign URIs survived: ${leftover.join(", ")}`);
if (store.listConceptUris().length < concepts.length) {
  throw new Error(`lost concepts: old ${concepts.length}, new ${store.listConceptUris().length}`);
}

writeFileSync(
  join(to, "remint-map.json"),
  JSON.stringify(Object.fromEntries([...map].sort()), null, 2) + "\n",
);

console.log(
  JSON.stringify(
    {
      authority: BASE_AUTHORITY,
      contexts: contexts.length,
      concepts: concepts.length,
      inserted,
      matchedSeed,
      blobsInOldDir: readdirSync(oldBlobDir).length,
      copied,
      indexed,
      historyUrisLeftUnmapped: [...unmappedInHistory],
      totals: store.totals(),
    },
    null,
    2,
  ),
);
store.close();
old.close();
