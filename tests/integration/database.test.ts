import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskRepository } from '../../src/main/database/TaskRepository'

describe('TaskRepository with a real SQLite database', () => {
  let directory: string
  let file: string
  let now: number
  const repositories = new Set<TaskRepository>()

  function open(path = file): TaskRepository {
    const repository = new TaskRepository(path, { now: () => now, undoMs: 8000 })
    repositories.add(repository)
    return repository
  }

  function close(repository: TaskRepository): void {
    repository.close()
    repositories.delete(repository)
  }

  function create(repository: TaskRepository, title = '测试任务', requestId = crypto.randomUUID()) {
    return repository.create({
      title,
      description: '任务说明',
      priority: 1,
      createRequestId: requestId,
      dataEpoch: repository.snapshot().dataEpoch
    })
  }

  function errorCode(action: () => unknown): string | undefined {
    try {
      action()
      return undefined
    } catch (error) {
      return (error as { code?: string }).code
    }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'todo-db-tests-'))
    file = join(directory, 'tasks.sqlite')
    now = Date.UTC(2026, 9, 27, 2, 0, 0)
  })

  afterEach(() => {
    for (const repository of repositories) repository.close()
    repositories.clear()
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('todo-db-tests-')) {
      throw new Error('Refusing to remove a directory outside this test fixture')
    }
    rmSync(target, { recursive: true, force: true })
  })

  it('starts empty with explicit defaults instead of creating demonstration tasks', () => {
    const snapshot = open().snapshot()
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.undos).toEqual([])
    expect(snapshot.settings).toEqual({ filter: 'all', sort: 'newest', density: 'standard', sidebarCollapsed: false })
    expect(snapshot.dataEpoch).toEqual(expect.any(String))
    expect(snapshot.collectionRevision).toBeGreaterThanOrEqual(0)
  })

  it('normalizes input while storing Chinese and HTML-looking content as plain text', () => {
    const repository = open()
    const snapshot = repository.create({
      title: '  整理需求 <script>alert(1)</script>  ',
      description: '第一行\r\n第二行',
      priority: 2,
      createRequestId: crypto.randomUUID(),
      dataEpoch: repository.snapshot().dataEpoch
    })
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]).toMatchObject({
      title: '整理需求 <script>alert(1)</script>',
      description: '第一行\n第二行',
      priority: 2,
      completed: false,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1
    })
  })

  it('persists content and completion through closing and reopening the database', () => {
    const repository = open()
    const initial = create(repository).tasks[0]!
    now += 1000
    const edited = repository.update({
      id: initial.id,
      title: '修改后的标题',
      description: '多行\n描述',
      priority: 0,
      expectedRevision: initial.revision,
      dataEpoch: repository.snapshot().dataEpoch
    }).tasks[0]!
    now += 1000
    const completed = repository.setCompleted({
      id: edited.id,
      completed: true,
      expectedRevision: edited.revision,
      dataEpoch: repository.snapshot().dataEpoch
    }).tasks[0]!
    expect(completed.createdAt).toBe(initial.createdAt)
    expect(completed.completedAt).toBe(now)
    expect(completed.revision).toBeGreaterThan(edited.revision)
    close(repository)

    const reopened = open()
    expect(reopened.snapshot().tasks).toEqual([completed])
    const reset = reopened.setCompleted({
      id: completed.id,
      completed: false,
      expectedRevision: completed.revision,
      dataEpoch: reopened.snapshot().dataEpoch
    }).tasks[0]!
    expect(reset.completed).toBe(false)
    expect(reset.completedAt).toBeNull()
    expect(reset.sortOrder).toBe(initial.sortOrder)
  })

  it('consumes a creation request only once even when the response is retried', () => {
    const repository = open()
    const requestId = crypto.randomUUID()
    const first = create(repository, '第一条任务', requestId)
    const repeated = create(repository, '第一条任务', requestId)
    expect(repeated.tasks).toEqual(first.tasks)
    expect(repeated.collectionRevision).toBe(first.collectionRevision)
  })

  it('rejects stale edits without changing the current record', () => {
    const repository = open()
    const task = create(repository).tasks[0]!
    const input = {
      id: task.id,
      title: '第一次修改',
      description: task.description,
      priority: task.priority,
      expectedRevision: task.revision,
      dataEpoch: repository.snapshot().dataEpoch
    }
    const committed = repository.update(input)
    expect(errorCode(() => repository.update({ ...input, title: '旧草稿' }))).toBe('REVISION_CONFLICT')
    expect(repository.snapshot()).toEqual(committed)
  })

  it('removes a task immediately and restores its identity and original content during the undo window', () => {
    const repository = open()
    const original = create(repository).tasks[0]!
    now += 1000
    const removed = repository.remove({
      id: original.id,
      expectedRevision: original.revision,
      dataEpoch: repository.snapshot().dataEpoch
    })
    expect(removed.tasks).toEqual([])
    expect(removed.undos).toHaveLength(1)
    const undo = removed.undos[0]!
    expect(undo).toMatchObject({ id: original.id, title: original.title, expiresAt: now + 8000 })
    now += 2000
    const restored = repository.restore({ id: undo.id, token: undo.token, dataEpoch: removed.dataEpoch })
    expect(restored.tasks[0]).toMatchObject({
      id: original.id,
      title: original.title,
      description: original.description,
      priority: original.priority,
      completed: original.completed,
      createdAt: original.createdAt,
      sortOrder: original.sortOrder,
      updatedAt: now
    })
    expect(restored.tasks[0]!.revision).toBeGreaterThan(original.revision)
    expect(restored.undos).toEqual([])
  })

  it('uses the persisted undo deadline and rejects recovery after it expires', () => {
    const repository = open()
    const task = create(repository).tasks[0]!
    const removed = repository.remove({
      id: task.id,
      expectedRevision: task.revision,
      dataEpoch: repository.snapshot().dataEpoch
    })
    const undo = removed.undos[0]!
    now += 8001
    expect(errorCode(() => repository.restore({ id: undo.id, token: undo.token, dataEpoch: removed.dataEpoch }))).toBe('UNDO_EXPIRED')
    expect(repository.snapshot().tasks).toEqual([])
    expect(repository.snapshot().undos).toEqual([])
  })

  it('does not resurrect deleted tasks when a consumed request is retried after cleanup and restart', () => {
    const repository = open()
    const requestId = crypto.randomUUID()
    const task = create(repository, '不能复活的任务', requestId).tasks[0]!
    repository.remove({ id: task.id, expectedRevision: task.revision, dataEpoch: repository.snapshot().dataEpoch })
    now += 8001
    repository.purgeExpired()
    close(repository)
    const reopened = open()
    expect(errorCode(() => create(reopened, '不能复活的任务', requestId))).toBe('REQUEST_ALREADY_CONSUMED')
    expect(reopened.snapshot().tasks).toEqual([])
  })

  it('reorders the entire active collection atomically and refuses duplicate or missing IDs', () => {
    const repository = open()
    create(repository, 'A')
    create(repository, 'B')
    const before = create(repository, 'C')
    const reversedIds = [...before.tasks].sort((a, b) => b.sortOrder - a.sortOrder).map((task) => task.id)
    const committed = repository.reorder({
      ids: reversedIds,
      expectedCollectionRevision: before.collectionRevision,
      dataEpoch: before.dataEpoch
    })
    expect([...committed.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id)).toEqual(reversedIds)
    expect(errorCode(() => repository.reorder({
      ids: [reversedIds[0]!, reversedIds[0]!, reversedIds[2]!],
      expectedCollectionRevision: committed.collectionRevision,
      dataEpoch: committed.dataEpoch
    }))).toBe('VALIDATION_ERROR')
    expect(repository.snapshot()).toEqual(committed)
  })

  it('rejects a reorder based on an obsolete collection version', () => {
    const repository = open()
    const first = create(repository, 'A')
    const current = create(repository, 'B')
    expect(errorCode(() => repository.reorder({
      ids: current.tasks.map((task) => task.id),
      expectedCollectionRevision: first.collectionRevision,
      dataEpoch: current.dataEpoch
    }))).toBe('REVISION_CONFLICT')
    expect(repository.snapshot()).toEqual(current)
  })

  it('rolls back both a task and its request record when a database write fails', () => {
    const repository = open()
    create(repository, '原有任务')
    close(repository)
    const raw = new Database(file)
    raw.exec("CREATE TRIGGER fail_request BEFORE INSERT ON create_requests BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    raw.close()
    const reopened = open()
    const before = reopened.snapshot()
    expect(() => create(reopened, '应当回滚的任务')).toThrow()
    expect(reopened.snapshot()).toEqual(before)
    close(reopened)
    const checked = new Database(file)
    try {
      expect(checked.prepare('SELECT COUNT(*) AS total FROM tasks').get()).toEqual({ total: 1 })
      expect(checked.prepare('SELECT COUNT(*) AS total FROM create_requests').get()).toEqual({ total: 1 })
    } finally {
      checked.close()
    }
  })

  it('persists whitelisted preferences and rejects invalid settings without changing tasks', () => {
    const repository = open()
    const tasks = create(repository).tasks
    expect(repository.updatePreferences({ filter: 'active', density: 'compact' })).toEqual({
      filter: 'active', sort: 'newest', density: 'compact', sidebarCollapsed: false
    })
    expect(errorCode(() => repository.updatePreferences({ sort: 'unrecognized' as never }))).toBe('VALIDATION_ERROR')
    expect(repository.snapshot().tasks).toEqual(tasks)
    close(repository)
    expect(open().snapshot().settings).toEqual({ filter: 'active', sort: 'newest', density: 'compact', sidebarCollapsed: false })
  })

  it('creates consistent backups and restores a fresh epoch without accepting old mutation requests', async () => {
    const repository = open()
    const initial = create(repository, '备份中的任务')
    const task = initial.tasks[0]!
    const backups = join(directory, 'backups')
    const backup = await repository.createBackup(backups, 'manual')
    expect(backup).toMatchObject({ kind: 'manual', size: expect.any(Number), createdAt: now })
    expect(backup.size).toBeGreaterThan(0)
    expect(repository.listBackups(backups).some((item) => item.id === backup.id)).toBe(true)
    const beforeRestore = create(repository, '备份后新增的任务')
    repository.restoreBackup(join(backups, backup.id))
    const restored = repository.snapshot()
    expect(restored.tasks).toEqual(initial.tasks)
    expect(restored.dataEpoch).not.toBe(beforeRestore.dataEpoch)
    expect(restored.collectionRevision).toBeGreaterThan(beforeRestore.collectionRevision)
    expect(errorCode(() => repository.update({
      ...task,
      title: '恢复前迟到的修改',
      expectedRevision: task.revision,
      dataEpoch: beforeRestore.dataEpoch
    }))).toBe('DATASET_CHANGED')
    expect(repository.snapshot()).toEqual(restored)
  })

  it('leaves healthy data unchanged when the selected backup is invalid', () => {
    const repository = open()
    const before = create(repository)
    const invalidBackup = join(directory, 'invalid-backup.sqlite')
    writeFileSync(invalidBackup, 'not a sqlite database')
    expect(() => repository.restoreBackup(invalidBackup)).toThrow()
    expect(repository.snapshot()).toEqual(before)
  })

  it('refuses a database from a newer schema without resetting its version or content', () => {
    const repository = open()
    create(repository, '较新版本的数据')
    close(repository)
    const raw = new Database(file)
    raw.pragma('user_version = 999')
    raw.close()
    expect(errorCode(() => open())).toBe('UNSUPPORTED_SCHEMA')
    const checked = new Database(file)
    try {
      expect(checked.pragma('user_version', { simple: true })).toBe(999)
      expect(checked.prepare('SELECT title FROM tasks').get()).toEqual({ title: '较新版本的数据' })
    } finally {
      checked.close()
    }
  })

  it('does not replace an unreadable database with an empty one', () => {
    const original = Buffer.from('existing but invalid sqlite content')
    writeFileSync(file, original)
    expect(() => open()).toThrow()
    expect(readFileSync(file)).toEqual(original)
  })
})
