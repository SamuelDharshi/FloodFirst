import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";

// node:sqlite is loaded through getBuiltinModule so bundlers/test runners do not try to resolve it.
const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type Db = DatabaseSyncType;
export type Row = Record<string, unknown>;

const MIGRATIONS: string[] = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     block_number INTEGER NOT NULL,
     block_hash TEXT NOT NULL,
     tx_hash TEXT NOT NULL,
     log_index INTEGER NOT NULL,
     contract TEXT NOT NULL,
     name TEXT NOT NULL,
     args TEXT NOT NULL,
     UNIQUE (tx_hash, log_index)
   );
   CREATE INDEX events_name ON events(name, block_number);
   CREATE TABLE group_members (
     group_id TEXT NOT NULL,
     idx INTEGER NOT NULL,
     commitment TEXT NOT NULL,
     block_number INTEGER NOT NULL,
     PRIMARY KEY (group_id, idx)
   );
   CREATE TABLE oracle_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     source TEXT NOT NULL,
     ok INTEGER NOT NULL,
     value TEXT,
     detail TEXT NOT NULL
   );
   CREATE TABLE operator_gauge (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     value TEXT NOT NULL,
     unit TEXT NOT NULL,
     observed_at INTEGER NOT NULL,
     source_url TEXT NOT NULL,
     note TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE triggers_submitted (
     event_id TEXT PRIMARY KEY,
     tx_hash TEXT,
     status TEXT NOT NULL,
     forecast_value TEXT NOT NULL,
     gauge_value TEXT NOT NULL,
     used_fallback INTEGER NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE relayed_tx (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     key TEXT NOT NULL,
     tx_hash TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL,
     UNIQUE (kind, key)
   );
   CREATE TABLE sms_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     to_number TEXT NOT NULL,
     provider_id TEXT,
     provider_status TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new sqlite.DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const cur = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  const applied = cur.v ?? 0;
  for (let i = applied; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i] as string);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(i + 1);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function all(db: Db, sql: string, ...params: SQLInputValue[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

export function get(db: Db, sql: string, ...params: SQLInputValue[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}

export function run(db: Db, sql: string, ...params: SQLInputValue[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function getMeta(db: Db, key: string): string | undefined {
  return get(db, "SELECT value FROM meta WHERE key = ?", key)?.value as string | undefined;
}

export function setMeta(db: Db, key: string, value: string): void {
  run(db, "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}
