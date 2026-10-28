import { randomUUID } from 'node:crypto'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskRepository } from '../../src/main/database/TaskRepository'
import { StorageManager } from '../../src/main/recovery/StorageManager'

describe('StorageManager startup and recovery', () => {
  let directory: string
  const managers = new Set<StorageManager>()

  async function open(seedInitialTasks = false): Promise<StorageManager> {
    const manager = new StorageManager(directory, { seedInitialTasks })
    managers.add(manager)
    await manager.initialize()
    return manager
  }

  function close(manager: StorageManager): void {
    manager.close()
    managers.delete(manager)
  }

  function create(manager: StorageManager, title = '需要持久保留的任务') {
    return manager.getRepository().create({
      title,
      description: '恢复后应完整保留的说明',
      priority: 1,
      createRequestId: randomUUID(),
      dataEpoch: manager.snapshot().dataEpoch
    })
  }

  function containsOriginal(path: string, expected: Buffer): boolean {
    if (!existsSync(path)) return false
    return readdirSync(path, { withFileTypes: true }).some((entry) => {
      const child = join(path, entry.name)
      if (entry.isDirectory()) return containsOriginal(child, expected)
      return entry.isFile() && readFileSync(child).equals(expected)
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'todo-storage-tests-'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    for (const manager of managers) manager.close()
    managers.clear()
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('todo-storage-tests-')) {
      throw new Error('Refusing to remove a directory outside this test fixture')
    }
    rmSync(target, { recursive: true, force: true })
  })

  it('initializes the first data directory and preserves actual tasks across restart', async () => {
    const manager = await open()
    expect(manager.snapshot().tasks).toEqual([])
    expect(existsSync(join(directory, '.initialized.json'))).toBe(true)
    expect(existsSync(join(directory, 'data', 'tasks.sqlite'))).toBe(true)
    const committed = create(manager)
    close(manager)
    const restarted = await open()
    expect(restarted.snapshot().tasks).toEqual(committed.tasks)
    expect(restarted.snapshot().dataEpoch).not.toBe(committed.dataEpoch)
  })

  it('does not rebuild an empty database if a previously initialized database disappears', async () => {
    const manager = await open()
    create(manager)
    close(manager)
    const databasePath = join(directory, 'data', 'tasks.sqlite')
    rmSync(databasePath)
    const restarted = await open()
    expect(() => restarted.getRepository()).toThrow(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }))
    expect(existsSync(databasePath)).toBe(false)
    expect(restarted.listBackups().length).toBeGreaterThan(0)
  })

  it('seeds exactly one completed and one active starter only on first installed startup', async () => {
    const manager = await open(true)
    const initial = manager.snapshot()
    expect(initial.tasks).toHaveLength(2)
    expect(initial.tasks.filter((task) => task.completed)).toHaveLength(1)
    expect(initial.tasks.filter((task) => !task.completed)).toHaveLength(1)
    expect(initial.tasks.find((task) => task.completed)?.completedAt).toEqual(expect.any(Number))
    expect(initial.tasks.find((task) => !task.completed)?.completedAt).toBeNull()
    const first = initial.tasks[0]!
    const edited = manager.getRepository().update({ ...first, title: '已经编辑的引导任务', expectedRevision: first.revision, dataEpoch: initial.dataEpoch })
    close(manager)
    const restarted = await open(true)
    expect(restarted.snapshot().tasks).toEqual(edited.tasks)
    for (const task of restarted.snapshot().tasks) {
      restarted.getRepository().remove({ id: task.id, expectedRevision: task.revision, dataEpoch: restarted.snapshot().dataEpoch })
    }
    close(restarted)
    const cleared = await open(true)
    expect(cleared.snapshot().tasks).toHaveLength(0)
  })

  it('never inserts starter tasks into an existing empty user database', async () => {
    const development = await open()
    expect(development.snapshot().tasks).toHaveLength(0)
    close(development)
    const installed = await open(true)
    expect(installed.snapshot().tasks).toHaveLength(0)
  })

  it('does not reseed missing installed data or add starter tasks when restoring an empty backup', async () => {
    const manager = await open(true)
    for (const task of manager.snapshot().tasks) {
      manager.getRepository().remove({ id: task.id, expectedRevision: task.revision, dataEpoch: manager.snapshot().dataEpoch })
    }
    const emptyBackup = await manager.createBackup('manual')
    create(manager, '用户自己创建的任务')
    expect((await manager.restoreBackup(emptyBackup.id)).tasks).toHaveLength(0)
    close(manager)
    const databasePath = join(directory, 'data', 'tasks.sqlite')
    rmSync(databasePath)
    const restarted = await open(true)
    expect(() => restarted.getRepository()).toThrow(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }))
    expect(existsSync(databasePath)).toBe(false)
  })

  it('keeps damaged bytes intact, lists available backups, and isolates the original during recovery', async () => {
    const manager = await open()
    const committed = create(manager)
    const backup = await manager.createBackup('manual')
    close(manager)
    const damaged = Buffer.from('damaged original database that must not be overwritten')
    const databasePath = join(directory, 'data', 'tasks.sqlite')
    writeFileSync(databasePath, damaged)

    const unavailable = await open()
    expect(() => unavailable.getRepository()).toThrow(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }))
    expect(readFileSync(databasePath)).toEqual(damaged)
    expect(unavailable.listBackups().some((item) => item.id === backup.id)).toBe(true)
    const restored = await unavailable.restoreBackup(backup.id)
    expect(restored.tasks).toEqual(committed.tasks)
    expect(containsOriginal(join(directory, 'recovery'), damaged)).toBe(true)
    expect(existsSync(join(directory, '.recovery-pending.json'))).toBe(false)
  })

  it('leaves healthy tasks and the epoch unchanged when a selected backup fails verification', async () => {
    const manager = await open()
    create(manager, '备份之前')
    const backup = await manager.createBackup('manual')
    const current = create(manager, '备份之后')
    writeFileSync(join(directory, 'backups', backup.id), 'not a valid SQLite backup')
    await expect(manager.restoreBackup(backup.id)).rejects.toThrow()
    expect(manager.snapshot()).toEqual(current)
  })

  it('recognizes an interrupted recovery marker instead of silently initializing an empty database', async () => {
    writeFileSync(join(directory, '.recovery-pending.json'), JSON.stringify({ phase: 'isolated' }))
    const manager = await open()
    expect(() => manager.getRepository()).toThrow(expect.objectContaining({ code: 'STORAGE_UNAVAILABLE' }))
    expect(existsSync(join(directory, 'data', 'tasks.sqlite'))).toBe(false)
    expect(existsSync(join(directory, '.recovery-pending.json'))).toBe(true)
  })

  it('rejects path traversal and absolute paths supplied as backup IDs', async () => {
    const manager = await open()
    const committed = create(manager)
    for (const id of ['../outside.sqlite', '..\\outside.sqlite', 'C:\\private\\outside.sqlite', '/outside.sqlite']) {
      await expect(manager.restoreBackup(id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    expect(manager.snapshot()).toEqual(committed)
  })

  it('rejects a backups directory junction without writing into its external target', async (context) => {
    const applicationRoot = join(directory, 'application')
    const externalTarget = join(directory, 'external-backup-target')
    mkdirSync(applicationRoot)
    mkdirSync(externalTarget)
    const sentinel = join(externalTarget, 'sentinel.txt')
    writeFileSync(sentinel, 'external data must remain unchanged')
    try {
      symlinkSync(externalTarget, join(applicationRoot, 'backups'), 'junction')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && ['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code)) {
        context.skip(`Directory junctions are unavailable in this environment: ${code}`)
        return
      }
      throw error
    }

    const manager = new StorageManager(applicationRoot)
    managers.add(manager)
    await manager.initialize()
    expect(() => manager.getRepository()).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
    expect(existsSync(join(applicationRoot, 'data', 'tasks.sqlite'))).toBe(false)
    expect(readdirSync(externalTarget)).toEqual(['sentinel.txt'])
    expect(readFileSync(sentinel, 'utf8')).toBe('external data must remain unchanged')
  })

  it('keeps task storage writable when an automatic backup fails, then clears the warning after retry', async () => {
    vi.spyOn(TaskRepository.prototype, 'createBackup').mockRejectedValueOnce(new Error('injected backup failure'))
    const manager = await open()
    expect(manager.snapshot().backupWarning).toEqual(expect.any(String))
    const created = create(manager)
    expect(manager.snapshot().tasks).toEqual(created.tasks)
    const retried = await manager.createBackup('manual')
    expect(retried.kind).toBe('manual')
    expect(manager.snapshot().backupWarning).toBeUndefined()
  })

  it('restores a manual snapshot with a fresh epoch and rejects mutations from the old dataset', async () => {
    const manager = await open()
    const saved = create(manager, '手动快照中的任务')
    const task = saved.tasks[0]!
    const backup = await manager.createBackup()
    expect(backup.kind).toBe('manual')
    expect(manager.listBackups().some((item) => item.id === backup.id)).toBe(true)
    const current = create(manager, '随后新增的任务')
    const restored = await manager.restoreBackup(backup.id)
    expect(restored.tasks).toEqual(saved.tasks)
    expect(restored.dataEpoch).not.toBe(current.dataEpoch)
    expect(restored.collectionRevision).toBeGreaterThan(current.collectionRevision)
    expect(() => manager.getRepository().update({
      id: task.id,
      title: '恢复前迟到的编辑',
      description: task.description,
      priority: task.priority,
      expectedRevision: task.revision,
      dataEpoch: current.dataEpoch
    })).toThrow(expect.objectContaining({ code: 'DATASET_CHANGED' }))
    expect(manager.snapshot()).toEqual(restored)
  })
})
