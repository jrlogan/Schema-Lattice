import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConceptRecord, ContextRecord } from "../hashing/types.ts";

export interface StoreOptions {
  dbPath: string;
  blobDir: string;
}

export class Store {
  readonly db: Database.Database;
  readonly blobDir: string;

  constructor(opts: StoreOptions) {
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    mkdirSync(opts.blobDir, { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.blobDir = opts.blobDir;
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        uri TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        hash TEXT NOT NULL,
        blob_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS concepts (
        uri TEXT PRIMARY KEY,
        context_slug TEXT NOT NULL,
        concept_slug TEXT NOT NULL,
        hash TEXT NOT NULL,
        concept_kind TEXT,
        root_ancestor TEXT,
        blob_path TEXT NOT NULL,
        adoption_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_concepts_context
        ON concepts(context_slug);

      CREATE TABLE IF NOT EXISTS relations (
        from_uri TEXT NOT NULL,
        to_uri TEXT NOT NULL,
        relation TEXT NOT NULL,
        PRIMARY KEY (from_uri, to_uri, relation)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_uri);
      CREATE INDEX IF NOT EXISTS idx_relations_to   ON relations(to_uri);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  }

  private writeBlob(uri: string, record: unknown): string {
    const safe = uri.replace(/[^a-zA-Z0-9._@-]/g, "_");
    const path = join(this.blobDir, safe + ".json");
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", "utf8");
    return path;
  }

  getConcept(uri: string): ConceptRecord | null {
    const row = this.db
      .prepare("SELECT blob_path FROM concepts WHERE uri = ?")
      .get(uri) as { blob_path: string } | undefined;
    if (!row) return null;
    if (!existsSync(row.blob_path)) return null;
    return JSON.parse(readFileSync(row.blob_path, "utf8")) as ConceptRecord;
  }

  hasConcept(uri: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM concepts WHERE uri = ?")
      .get(uri) as { ok: number } | undefined;
    return !!row;
  }

  hasContext(uri: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM contexts WHERE uri = ?")
      .get(uri) as { ok: number } | undefined;
    return !!row;
  }

  insertContext(args: {
    uri: string;
    slug: string;
    hash: string;
    record: ContextRecord;
  }): void {
    const blobPath = this.writeBlob(args.uri, args.record);
    this.db
      .prepare(
        `INSERT INTO contexts (uri, slug, hash, blob_path, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(args.uri, args.slug, args.hash, blobPath, new Date().toISOString());
  }

  insertConcept(args: {
    uri: string;
    contextSlug: string;
    conceptSlug: string;
    hash: string;
    record: ConceptRecord;
  }): void {
    const blobPath = this.writeBlob(args.uri, args.record);
    const insert = this.db.prepare(
      `INSERT INTO concepts
         (uri, context_slug, concept_slug, hash, concept_kind, root_ancestor,
          blob_path, adoption_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    );
    const relInsert = this.db.prepare(
      `INSERT OR IGNORE INTO relations (from_uri, to_uri, relation) VALUES (?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      insert.run(
        args.uri,
        args.contextSlug,
        args.conceptSlug,
        args.hash,
        (args.record.conceptKind as string | undefined) ?? null,
        (args.record.rootAncestor as string | undefined) ?? null,
        blobPath,
        new Date().toISOString(),
      );
      for (const to of args.record.broader ?? []) {
        relInsert.run(args.uri, to, "broader");
      }
      if (args.record.derivedFrom) {
        relInsert.run(args.uri, args.record.derivedFrom, "derivedFrom");
      }
      if (args.record.forkedFrom) {
        relInsert.run(args.uri, args.record.forkedFrom, "forkedFrom");
      }
    });
    tx();
  }

  logEvent(kind: string, payload: unknown): void {
    this.db
      .prepare(`INSERT INTO events (ts, kind, payload) VALUES (?, ?, ?)`)
      .run(new Date().toISOString(), kind, JSON.stringify(payload));
  }

  close(): void {
    this.db.close();
  }
}
