import type Database from 'better-sqlite3';

/** Database triggers cover writes from other connections as well as this process.
 * Search/resolve event logging deliberately does not invalidate report caches. */
export function installReportRevision(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS report_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
    INSERT OR IGNORE INTO report_revision VALUES (1, 0);`);
  for (const table of ['apps', 'app_usages', 'app_attestations', 'concepts', 'relations', 'embedding_keys']) {
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS report_revision_${table}_${action}
        AFTER ${action} ON ${table} BEGIN UPDATE report_revision SET version=version+1 WHERE id=1; END;`);
    }
  }
}
export function reportRevision(db: Database.Database): number {
  return (db.prepare('SELECT version FROM report_revision WHERE id=1').get() as {version: number}).version;
}
