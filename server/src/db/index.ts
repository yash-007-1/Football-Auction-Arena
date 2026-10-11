import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../logger';

// Loaded via require so bundlers/test runners that don't know the prefix-only `node:sqlite` builtin leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
export type Db = DatabaseSyncType;
const here = path.dirname(fileURLToPath(import.meta.url));

export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const dir = path.join(here, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set((db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
      db.exec('COMMIT');
      log.info({ migration: f }, 'migration applied');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Run `fn` inside an IMMEDIATE transaction; rolls back if it throws. Re-entrant calls join the outer transaction. */
const depth = new WeakMap<Db, number>();
export function tx<T>(db: Db, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth.set(db, 0);
  }
}

export const q = {
  get<T>(db: Db, sql: string, ...params: (string | number | null)[]): T | undefined { return db.prepare(sql).get(...params) as T | undefined; },
  all<T>(db: Db, sql: string, ...params: (string | number | null)[]): T[] { return db.prepare(sql).all(...params) as T[]; },
  run(db: Db, sql: string, ...params: (string | number | null)[]) { return db.prepare(sql).run(...params); },
};
