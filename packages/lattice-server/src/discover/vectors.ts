// sqlite-vec vector index over concept embeddings (DECISIONS.md:
// "sqlite-vec — vector search extension").
//
// Embeddings are derived data: everything here is rebuildable from the
// concept blobs (ARCHITECTURE.md "Stateless above storage"), which is
// why the index lives in ordinary tables keyed by URI and can be
// backfilled at boot via LatticeInstance.ensureIndexed().
//
// vec0 virtual tables are keyed by integer rowid, so a small
// `embedding_keys` table maps URIs to rowids. Vectors are
// L2-normalized by the embedder; vec0's default distance is L2, and
// for unit vectors cosine = 1 - d²/2.

import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface Neighbor {
  uri: string;
  similarity: number;
}

export class VectorIndex {
  constructor(
    private db: Database.Database,
    private dim: number,
    private model: string,
  ) {
    sqliteVec.load(db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uri TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_concepts
        USING vec0(embedding float[${dim}]);
    `);
  }

  has(uri: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM embedding_keys WHERE uri = ?")
      .get(uri) as { ok: number } | undefined;
    return !!row;
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM embedding_keys")
      .get() as { n: number };
    return row.n;
  }

  add(uri: string, vector: Float32Array): void {
    if (vector.length !== this.dim) {
      throw new Error(
        `vector dim mismatch: got ${vector.length}, index is ${this.dim}`,
      );
    }
    const tx = this.db.transaction(() => {
      const info = this.db
        .prepare("INSERT INTO embedding_keys (uri, model) VALUES (?, ?)")
        .run(uri, this.model);
      // vec0 rejects rowids bound as JS numbers (REAL affinity); bind int64.
      this.db
        .prepare("INSERT INTO vec_concepts (rowid, embedding) VALUES (?, ?)")
        .run(BigInt(info.lastInsertRowid), Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
    });
    tx();
  }

  vectorOf(uri: string): Float32Array | null {
    const row = this.db
      .prepare(
        `SELECT v.embedding AS embedding
           FROM embedding_keys k JOIN vec_concepts v ON v.rowid = k.id
          WHERE k.uri = ?`,
      )
      .get(uri) as { embedding: Buffer } | undefined;
    if (!row) return null;
    return new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
  }

  /** k nearest neighbors by cosine similarity, best first. */
  knn(vector: Float32Array, k: number): Neighbor[] {
    if (this.count() === 0) return [];
    const rows = this.db
      .prepare(
        `SELECT k.uri AS uri, v.distance AS distance
           FROM (SELECT rowid, distance FROM vec_concepts
                  WHERE embedding MATCH ? ORDER BY distance LIMIT ?) v
           JOIN embedding_keys k ON k.id = v.rowid
          ORDER BY v.distance ASC`,
      )
      .all(
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
        k,
      ) as Array<{ uri: string; distance: number }>;
    return rows.map((r) => ({
      uri: r.uri,
      similarity: 1 - (r.distance * r.distance) / 2,
    }));
  }
}
