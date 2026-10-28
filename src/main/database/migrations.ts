import type Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors'

export const SCHEMA_VERSION = 1

const migrations = [{
  version: 1,
  sql: `
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      priority INTEGER NOT NULL DEFAULT 1 CHECK (priority IN (0, 1, 2)),
      sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      deleted_at INTEGER,
      undo_token TEXT,
      undo_expires_at INTEGER,
      CHECK ((completed = 0 AND completed_at IS NULL) OR (completed = 1 AND completed_at IS NOT NULL)),
      CHECK ((deleted_at IS NULL AND undo_token IS NULL AND undo_expires_at IS NULL)
        OR (deleted_at IS NOT NULL AND undo_token IS NOT NULL AND undo_expires_at IS NOT NULL))
    );
    CREATE INDEX tasks_state_order ON tasks(deleted_at, completed, sort_order);
    CREATE TABLE create_requests (request_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO app_meta(key, value) VALUES ('collection_revision', 0);
  `
}]

/** Migrations are append-only. A populated database is protected before any future upgrade. */
export function migrateDatabase(db: Database.Database, filePath: string): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version > SCHEMA_VERSION) throw new AppError('UNSUPPORTED_SCHEMA', '此数据由更新版本的应用创建，请使用较新版本打开。')
  if (version === SCHEMA_VERSION) return
  if (version === 0 && (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length > 0)) {
    throw new AppError('UNSUPPORTED_SCHEMA', '无法识别现有数据库结构，原始数据已保留。')
  }
  if (version > 0) {
    const backups = join(dirname(filePath), 'migration-backups')
    mkdirSync(backups, { recursive: true })
    db.prepare('VACUUM INTO ?').run(join(backups, `schema-${version}-${Date.now()}-${randomUUID()}.sqlite`))
  }
  for (const migration of migrations.filter((entry) => entry.version > version)) {
    db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    }).immediate()
  }
}
