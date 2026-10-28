import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type {
  BackupInfo, BackupKind, CreateTaskInput, Preferences, RemoveTaskInput, ReorderTaskInput,
  RestoreTaskInput, SetCompletedInput, Task, TaskInput, TaskSnapshot, UndoItem, UpdateTaskInput
} from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { assertRecord, validatePreferences, validateTaskInput } from '../../shared/validation'
import { migrateDatabase, SCHEMA_VERSION } from './migrations'
import { INITIAL_TASKS } from './initialTasks'

interface TaskRow {
  id: string
  title: string
  description: string
  priority: 0 | 1 | 2
  completed: 0 | 1
  sort_order: number
  revision: number
  created_at: number
  updated_at: number
  completed_at: number | null
  deleted_at: number | null
  undo_token: string | null
  undo_expires_at: number | null
}

const DEFAULT_PREFERENCES: Preferences = { filter: 'all', sort: 'newest', density: 'standard', sidebarCollapsed: false }
const taskColumns = 'id, title, description, completed, priority, sort_order, revision, created_at, updated_at, completed_at'
const insertTaskSql = `INSERT INTO tasks (${taskColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

function textIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || Array.from(value).some((character) => character.charCodeAt(0) < 32)) {
    throw new AppError('VALIDATION_ERROR', '操作标识不符合要求。', field)
  }
}

function positiveInteger(value: unknown, field: string, minimum = 1): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new AppError('VALIDATION_ERROR', '操作版本或数据格式不正确。', field)
}

function asTask(row: TaskRow): Task {
  return {
    id: row.id, title: row.title, description: row.description, priority: row.priority,
    completed: row.completed === 1, sortOrder: row.sort_order, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
  }
}

function storageError(error: unknown, operation: 'read' | 'write'): AppError {
  if (error instanceof AppError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code.includes('BUSY') || code.includes('LOCKED')) return new AppError('STORAGE_BUSY', '数据暂时正被占用，请稍后重试。', undefined, true)
  return operation === 'read'
    ? new AppError('STORAGE_UNAVAILABLE', '暂时无法读取任务数据。原始文件已保留，请重试或恢复备份。', undefined, true)
    : new AppError('STORAGE_WRITE_FAILED', '保存未完成，原有任务没有改变，请重试。', undefined, true)
}

/** A synchronous, single-writer SQLite boundary. All public mutations commit before returning. */
export class TaskRepository {
  private readonly db: Database.Database
  private readonly now: () => number
  private readonly undoMs: number
  private dataEpoch = randomUUID()

  constructor(private readonly filePath: string, options: { now?: () => number; undoMs?: number; seedInitialTasks?: boolean } = {}) {
    this.now = options.now ?? Date.now
    this.undoMs = options.undoMs ?? 8000
    let opened: Database.Database | undefined
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      opened = new Database(filePath, { timeout: 100 })
      if (opened.pragma('quick_check', { simple: true }) !== 'ok') throw new AppError('STORAGE_UNAVAILABLE', '数据库完整性检查未通过，原始文件已保留。')
      const schemaVersion = Number(opened.pragma('user_version', { simple: true }))
      if (schemaVersion > SCHEMA_VERSION) throw new AppError('UNSUPPORTED_SCHEMA', '此数据由更新版本的应用创建，请使用较新版本打开。')
      opened.pragma('foreign_keys = ON')
      opened.pragma('journal_mode = DELETE')
      opened.pragma('synchronous = FULL')
      opened.pragma('trusted_schema = OFF')
      if (options.seedInitialTasks && schemaVersion === 0) {
        const database = opened
        // Schema and starter tasks commit together, so interrupted startup cannot
        // leave a migrated database that still needs its initial content.
        database.transaction(() => {
          migrateDatabase(database, filePath)
          const insert = database.prepare(insertTaskSql)
          const timestamp = this.now()
          INITIAL_TASKS.forEach((task, index) => {
            const input = validateTaskInput(task)
            insert.run(randomUUID(), input.title, input.description, task.completed ? 1 : 0, input.priority, index, 1,
              timestamp, timestamp, task.completed ? timestamp : null)
          })
          database.prepare("UPDATE app_meta SET value = value + 1 WHERE key = 'collection_revision'").run()
        }).immediate()
      } else migrateDatabase(opened, filePath)
      // Reading all required columns rejects an incomplete or unrelated schema before accepting writes.
      opened.prepare(`SELECT ${taskColumns}, deleted_at, undo_token, undo_expires_at FROM tasks LIMIT 1`).get()
      opened.prepare('SELECT request_id, task_id, created_at FROM create_requests LIMIT 1').get()
      opened.prepare('SELECT key, value_json FROM settings LIMIT 1').get()
      const metadata = opened.prepare("SELECT value FROM app_meta WHERE key = 'collection_revision'").get() as { value: number } | undefined
      if (!metadata || !Number.isSafeInteger(metadata.value) || metadata.value < 0) throw new AppError('STORAGE_UNAVAILABLE', '数据库版本信息无效，原始文件已保留。')
      this.db = opened
    } catch (error) {
      if (opened?.open) opened.close()
      throw storageError(error, 'read')
    }
  }

  snapshot(): TaskSnapshot {
    try {
      return this.db.inTransaction ? this.readSnapshot() : this.db.transaction(() => this.readSnapshot())()
    } catch (error) { throw storageError(error, 'read') }
  }

  private readSnapshot(): TaskSnapshot {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, id').all() as TaskRow[]
    const undoRows = this.db.prepare('SELECT id, title, undo_token, undo_expires_at FROM tasks WHERE deleted_at IS NOT NULL AND undo_expires_at > ? ORDER BY deleted_at DESC, id').all(this.now()) as Pick<TaskRow, 'id' | 'title' | 'undo_token' | 'undo_expires_at'>[]
    return {
      tasks: rows.map(asTask), collectionRevision: this.collectionRevision(), dataEpoch: this.dataEpoch,
      undos: undoRows.map((row): UndoItem => ({ id: row.id, title: row.title, token: row.undo_token!, expiresAt: row.undo_expires_at! })),
      settings: this.readPreferences(this.db)
    }
  }

  private collectionRevision(): number {
    return (this.db.prepare("SELECT value FROM app_meta WHERE key = 'collection_revision'").get() as { value: number }).value
  }

  private advanceRevision(): void {
    this.db.prepare("UPDATE app_meta SET value = value + 1 WHERE key = 'collection_revision'").run()
  }

  private assertEpoch(value: unknown): void {
    if (value !== this.dataEpoch) throw new AppError('DATASET_CHANGED', '数据已重新载入，请刷新任务后重试。', undefined, true)
  }

  private mutate(epoch: unknown, change: () => void): TaskSnapshot {
    this.assertEpoch(epoch)
    try {
      return this.db.transaction(() => { change(); return this.readSnapshot() }).immediate()
    } catch (error) { throw storageError(error, 'write') }
  }

  private currentTask(id: unknown, revision: unknown): TaskRow {
    textIdentifier(id, 'id')
    positiveInteger(revision, 'expectedRevision')
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL').get(id) as TaskRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '这项任务已不存在，请刷新列表。', undefined, true)
    if (row.revision !== revision) throw new AppError('REVISION_CONFLICT', '任务已发生变化。当前输入已保留，请重新读取后处理。', undefined, true)
    return row
  }

  create(input: CreateTaskInput): TaskSnapshot {
    assertRecord(input)
    const task = validateTaskInput(input)
    textIdentifier(input.createRequestId, 'createRequestId')
    return this.mutate(input.dataEpoch, () => {
      const consumed = this.db.prepare('SELECT task_id FROM create_requests WHERE request_id = ?').get(input.createRequestId) as { task_id: string } | undefined
      if (consumed) {
        const active = this.db.prepare('SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL').get(consumed.task_id)
        if (!active) throw new AppError('REQUEST_ALREADY_CONSUMED', '这次新增请求已经使用，原任务已删除。请重新新增。')
        return
      }
      const now = this.now()
      const id = randomUUID()
      const max = this.db.prepare('SELECT MAX(sort_order) AS maximum FROM tasks WHERE deleted_at IS NULL').get() as { maximum: number | null }
      this.db.prepare(insertTaskSql).run(id, task.title, task.description, 0, task.priority, (max.maximum ?? -1) + 1, 1, now, now, null)
      this.db.prepare('INSERT INTO create_requests(request_id, task_id, created_at) VALUES (?, ?, ?)').run(input.createRequestId, id, now)
      this.advanceRevision()
    })
  }

  update(input: UpdateTaskInput): TaskSnapshot {
    assertRecord(input)
    const task = validateTaskInput(input)
    return this.mutate(input.dataEpoch, () => {
      const current = this.currentTask(input.id, input.expectedRevision)
      if (current.title === task.title && current.description === task.description && current.priority === task.priority) return
      this.db.prepare('UPDATE tasks SET title = ?, description = ?, priority = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(task.title, task.description, task.priority, this.now(), input.id)
      this.advanceRevision()
    })
  }

  setCompleted(input: SetCompletedInput): TaskSnapshot {
    assertRecord(input)
    if (typeof input.completed !== 'boolean') throw new AppError('VALIDATION_ERROR', '任务完成状态格式不正确。', 'completed')
    return this.mutate(input.dataEpoch, () => {
      const current = this.currentTask(input.id, input.expectedRevision)
      if (Boolean(current.completed) === input.completed) return
      const now = this.now()
      this.db.prepare('UPDATE tasks SET completed = ?, completed_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(input.completed ? 1 : 0, input.completed ? now : null, now, input.id)
      this.advanceRevision()
    })
  }

  remove(input: RemoveTaskInput): TaskSnapshot {
    assertRecord(input)
    return this.mutate(input.dataEpoch, () => {
      this.currentTask(input.id, input.expectedRevision)
      const now = this.now()
      this.db.prepare('UPDATE tasks SET deleted_at = ?, undo_token = ?, undo_expires_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(now, randomUUID(), now + this.undoMs, now, input.id)
      this.advanceRevision()
    })
  }

  restore(input: RestoreTaskInput): TaskSnapshot {
    assertRecord(input)
    textIdentifier(input.id, 'id')
    textIdentifier(input.token, 'token')
    return this.mutate(input.dataEpoch, () => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').get(input.id) as TaskRow | undefined
      if (!row || row.undo_expires_at! <= this.now()) throw new AppError('UNDO_EXPIRED', '撤销时间已过，无法恢复这次删除。')
      if (row.undo_token !== input.token) throw new AppError('VALIDATION_ERROR', '撤销操作标识无效。')
      this.db.prepare('UPDATE tasks SET deleted_at = NULL, undo_token = NULL, undo_expires_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ?').run(this.now(), input.id)
      this.advanceRevision()
    })
  }

  reorder(input: ReorderTaskInput): TaskSnapshot {
    assertRecord(input)
    if (!Array.isArray(input.ids) || input.ids.length > 10_000) throw new AppError('VALIDATION_ERROR', '重排任务数量不符合要求。')
    input.ids.forEach((id) => textIdentifier(id, 'ids'))
    positiveInteger(input.expectedCollectionRevision, 'expectedCollectionRevision', 0)
    return this.mutate(input.dataEpoch, () => {
      if (this.collectionRevision() !== input.expectedCollectionRevision) throw new AppError('REVISION_CONFLICT', '任务集合已经变化，请重新调整顺序。', undefined, true)
      const current = this.db.prepare('SELECT id, sort_order FROM tasks WHERE deleted_at IS NULL').all() as { id: string; sort_order: number }[]
      const ids = new Set(input.ids)
      if (ids.size !== input.ids.length || current.length !== input.ids.length || current.some((task) => !ids.has(task.id))) throw new AppError('VALIDATION_ERROR', '重排必须包含全部任务，且不能重复或遗漏。')
      const orderById = new Map(current.map((task) => [task.id, task.sort_order]))
      const update = this.db.prepare('UPDATE tasks SET sort_order = ?, revision = revision + 1 WHERE id = ?')
      let changed = false
      input.ids.forEach((id, index) => { if (orderById.get(id) !== index) { update.run(index, id); changed = true } })
      if (changed) this.advanceRevision()
    })
  }

  updatePreferences(input: Partial<Preferences>): Preferences {
    const values = validatePreferences(input)
    try {
      return this.db.transaction(() => {
        const save = this.db.prepare('INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at')
        for (const [key, value] of Object.entries(values)) save.run(key, JSON.stringify(value), this.now())
        return this.readPreferences(this.db)
      }).immediate()
    } catch (error) { throw storageError(error, 'write') }
  }

  private readPreferences(db: Database.Database): Preferences {
    const settings = { ...DEFAULT_PREFERENCES }
    const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[]
    for (const row of rows) {
      try { Object.assign(settings, validatePreferences({ [row.key]: JSON.parse(row.value_json) as unknown })) }
      catch { /* A damaged display preference does not invalidate task data. */ }
    }
    return settings
  }

  purgeExpired(): void {
    try { this.db.transaction(() => this.db.prepare('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND undo_expires_at <= ?').run(this.now())).immediate() }
    catch (error) { throw storageError(error, 'write') }
  }

  async createBackup(directory: string, kind: BackupKind): Promise<BackupInfo> {
    if (!['daily', 'manual', 'protection'].includes(kind)) throw new AppError('VALIDATION_ERROR', '备份类别不正确。')
    mkdirSync(directory, { recursive: true })
    const createdAt = this.now()
    const id = `${kind}-${createdAt}-${randomUUID()}.sqlite`
    const target = join(directory, id)
    const temporary = `${target}.partial`
    try {
      await this.db.backup(temporary)
      this.inspectBackup(temporary)
      renameSync(temporary, target)
      const maximum = kind === 'daily' ? 7 : kind === 'protection' ? 3 : Infinity
      const older = this.listBackups(directory).filter((item) => item.kind === kind).slice(maximum)
      for (const item of older) unlinkSync(join(directory, item.id))
      return { id, createdAt, size: statSync(target).size, kind }
    } catch (error) {
      if (existsSync(temporary)) { try { unlinkSync(temporary) } catch { /* Preserve the original failure. */ } }
      throw storageError(error, 'write')
    }
  }

  listBackups(directory: string): BackupInfo[] {
    if (!existsSync(directory)) return []
    try {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry): BackupInfo[] => {
        if (!entry.isFile()) return []
        const match = /^(daily|manual|protection)-(\d+)-[0-9a-f-]+\.sqlite$/u.exec(entry.name)
        if (!match) return []
        return [{ id: entry.name, createdAt: Number(match[2]), size: statSync(join(directory, entry.name)).size, kind: match[1] as BackupKind }]
      }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    } catch (error) { throw storageError(error, 'read') }
  }

  private inspectBackup(path: string): { tasks: TaskRow[]; requests: { request_id: string; task_id: string; created_at: number }[]; preferences: Preferences } {
    let source: Database.Database | undefined
    try {
      source = new Database(path, { readonly: true, fileMustExist: true, timeout: 100 })
      source.pragma('trusted_schema = OFF')
      if (source.pragma('quick_check', { simple: true }) !== 'ok') throw new AppError('STORAGE_UNAVAILABLE', '备份完整性检查未通过，未更改当前数据。')
      if (source.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) throw new AppError('UNSUPPORTED_SCHEMA', '备份的数据格式与当前应用不兼容。')
      const tasks = source.prepare('SELECT * FROM tasks WHERE deleted_at IS NULL').all() as TaskRow[]
      for (const task of tasks) {
        textIdentifier(task.id, 'id')
        const normalized: TaskInput = validateTaskInput(task)
        if (normalized.title !== task.title || normalized.description !== task.description) throw new AppError('VALIDATION_ERROR', '备份中的任务文本格式无效。')
        positiveInteger(task.sort_order, 'sortOrder', 0)
        positiveInteger(task.revision, 'revision')
        positiveInteger(task.created_at, 'createdAt', 0)
        positiveInteger(task.updated_at, 'updatedAt', 0)
        if (task.completed !== 0 && task.completed !== 1) throw new AppError('VALIDATION_ERROR', '备份中的完成状态无效。')
        if (task.completed === 0 ? task.completed_at !== null : !Number.isSafeInteger(task.completed_at)) throw new AppError('VALIDATION_ERROR', '备份中的完成时间无效。')
      }
      const requests = source.prepare('SELECT request_id, task_id, created_at FROM create_requests').all() as { request_id: string; task_id: string; created_at: number }[]
      for (const request of requests) {
        textIdentifier(request.request_id, 'requestId')
        textIdentifier(request.task_id, 'id')
        positiveInteger(request.created_at, 'createdAt', 0)
      }
      return { tasks, requests, preferences: this.readPreferences(source) }
    } catch (error) { throw storageError(error, 'read') }
    finally { if (source?.open) source.close() }
  }

  /** The caller owns restore confirmation, protection backup, and the exclusive mutation queue. */
  restoreBackup(path: string): void {
    if (resolve(path) === resolve(this.filePath)) throw new AppError('VALIDATION_ERROR', '不能将正在使用的数据文件作为备份恢复。')
    const incoming = this.inspectBackup(path)
    try {
      this.db.transaction(() => {
        const nextRevision = this.collectionRevision() + 1
        this.db.exec('DELETE FROM tasks; DELETE FROM create_requests; DELETE FROM settings;')
        const insert = this.db.prepare(insertTaskSql)
        for (const task of incoming.tasks) insert.run(task.id, task.title, task.description, task.completed, task.priority, task.sort_order, task.revision, task.created_at, task.updated_at, task.completed_at)
        const request = this.db.prepare('INSERT INTO create_requests(request_id, task_id, created_at) VALUES (?, ?, ?)')
        for (const row of incoming.requests) request.run(row.request_id, row.task_id, row.created_at)
        const setting = this.db.prepare('INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?)')
        for (const [key, value] of Object.entries(incoming.preferences)) setting.run(key, JSON.stringify(value), this.now())
        this.db.prepare("UPDATE app_meta SET value = ? WHERE key = 'collection_revision'").run(nextRevision)
      }).immediate()
      this.dataEpoch = randomUUID()
    } catch (error) { throw storageError(error, 'write') }
  }

  close(): void {
    if (this.db.open) this.db.close()
  }
}
