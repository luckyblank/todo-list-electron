import { randomUUID } from 'node:crypto'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync,
  renameSync, statSync, unlinkSync, writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BackupInfo, BackupKind, TaskSnapshot } from '../../shared/contracts'
import { AppError } from '../../shared/errors'
import { TaskRepository } from '../database/TaskRepository'

const DAY = 24 * 60 * 60 * 1000
const backupPattern = /^(daily|manual|protection)-(\d+)-[0-9a-f-]+\.sqlite$/u

function errorForStorage(error: unknown): AppError {
  return error instanceof AppError ? error : new AppError('STORAGE_UNAVAILABLE', '暂时无法打开任务存储。原始数据已保留，请重试或恢复备份。', undefined, true)
}

/** Owns fixed application data paths. The IPC layer serializes mutations with recovery. */
export class StorageManager {
  private repository: TaskRepository | undefined
  private failure: AppError | undefined
  private warning: string | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private restoring = false
  private closed = false
  private backupJobs = 0
  private backupQueue: Promise<void> = Promise.resolve()
  private readonly root: string
  private readonly databasePath: string
  private readonly backupDirectory: string
  private readonly recoveryDirectory: string
  private readonly initializedMarker: string
  private readonly recoveryMarker: string

  constructor(rootDir: string, private readonly options: { seedInitialTasks?: boolean } = {}) {
    this.root = resolve(rootDir)
    this.databasePath = join(this.root, 'data', 'tasks.sqlite')
    this.backupDirectory = join(this.root, 'backups')
    this.recoveryDirectory = join(this.root, 'recovery')
    this.initializedMarker = join(this.root, '.initialized.json')
    this.recoveryMarker = join(this.root, '.recovery-pending.json')
  }

  async initialize(): Promise<void> {
    if (this.repository || this.closed) return
    try {
      this.ensureLayout()
      if (existsSync(this.recoveryMarker)) throw new AppError('STORAGE_UNAVAILABLE', '上次数据恢复尚未完成。请选择有效备份继续恢复，原始文件已保留。', undefined, true)
      if (existsSync(this.initializedMarker) && !existsSync(this.databasePath)) {
        throw new AppError('STORAGE_UNAVAILABLE', '已有任务数据库缺失。为避免创建空数据，请从备份恢复。', undefined, true)
      }
      this.assertInsideRoot(this.databasePath)
      this.repository = new TaskRepository(this.databasePath, { seedInitialTasks: this.options.seedInitialTasks && !existsSync(this.initializedMarker) })
      this.writeMarker(this.initializedMarker, { initializedAt: Date.now() })
      this.failure = undefined
    } catch (error) {
      this.repository?.close()
      this.repository = undefined
      this.failure = errorForStorage(error)
      return
    }
    try { this.repository.purgeExpired() }
    catch { /* Expired tombstones are invisible already; retry cleanup on the next startup. */ }
    await this.maybeCreateDailyBackup()
    this.startBackupTimer()
  }

  private startBackupTimer(): void {
    if (!this.timer && !this.closed) {
      this.timer = setInterval(() => { void this.maybeCreateDailyBackup() }, 60_000)
      this.timer.unref()
    }
  }

  private ensureLayout(): void {
    mkdirSync(this.root, { recursive: true })
    for (const directory of [dirname(this.databasePath), this.backupDirectory, this.recoveryDirectory]) {
      mkdirSync(directory, { recursive: true })
      this.assertInsideRoot(directory)
    }
    for (const marker of [this.initializedMarker, this.recoveryMarker]) this.assertInsideRoot(marker)
  }

  private assertInsideRoot(path: string): void {
    const canonicalRoot = realpathSync(this.root)
    const canonical = existsSync(path) ? realpathSync(path) : join(realpathSync(dirname(path)), basename(path))
    const remaining = relative(canonicalRoot, canonical)
    if (isAbsolute(remaining) || remaining === '..' || remaining.startsWith(`..\\`) || remaining.startsWith('../')) {
      throw new AppError('VALIDATION_ERROR', '数据路径不在应用目录内。')
    }
    // lstat also detects dangling links, which existsSync intentionally follows and misses.
    try {
      if (lstatSync(path).isSymbolicLink()) throw new AppError('VALIDATION_ERROR', '不接受符号链接形式的数据文件或目录。')
    } catch (error) {
      if (error instanceof AppError) throw error
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }

  private writeMarker(path: string, data: Record<string, unknown>): void {
    const temporary = `${path}.${randomUUID()}.tmp`
    this.assertInsideRoot(path)
    try {
      writeFileSync(temporary, JSON.stringify(data), { encoding: 'utf8', flag: 'wx' })
      renameSync(temporary, path)
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  getRepository(): TaskRepository {
    if (this.restoring) throw new AppError('STORAGE_BUSY', '正在恢复数据，请稍候。', undefined, true)
    if (this.closed || !this.repository) throw this.failure ?? new AppError('STORAGE_UNAVAILABLE', '任务存储尚不可用，请重试或恢复备份。', undefined, true)
    return this.repository
  }

  snapshot(): TaskSnapshot {
    const snapshot = this.getRepository().snapshot()
    return this.warning ? { ...snapshot, backupWarning: this.warning } : snapshot
  }

  listBackups(): BackupInfo[] {
    try {
      if (!existsSync(this.backupDirectory)) return []
      this.assertInsideRoot(this.backupDirectory)
      return readdirSync(this.backupDirectory, { withFileTypes: true }).flatMap((entry): BackupInfo[] => {
        if (!entry.isFile()) return []
        const parts = backupPattern.exec(entry.name)
        if (!parts) return []
        const path = join(this.backupDirectory, entry.name)
        this.assertInsideRoot(path)
        return [{ id: entry.name, createdAt: Number(parts[2]), size: statSync(path).size, kind: parts[1] as BackupKind }]
      }).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    } catch (error) { throw errorForStorage(error) }
  }

  private enqueueBackup(repository: TaskRepository, kind: BackupKind): Promise<BackupInfo> {
    this.backupJobs += 1
    const job = this.backupQueue.then(async () => {
      this.assertInsideRoot(this.backupDirectory)
      const result = await repository.createBackup(this.backupDirectory, kind)
      this.warning = undefined
      return result
    }).catch((error: unknown) => {
      this.warning = '自动备份未能完成，任务仍会正常保存。请检查可用空间并重试备份。'
      throw error
    }).finally(() => { this.backupJobs -= 1 })
    this.backupQueue = job.then(() => undefined, () => undefined)
    return job
  }

  async createBackup(kind: BackupKind = 'manual'): Promise<BackupInfo> {
    const repository = this.getRepository()
    return this.enqueueBackup(repository, kind)
  }

  private async maybeCreateDailyBackup(): Promise<void> {
    if (!this.repository || this.restoring || this.closed || this.backupJobs > 0) return
    try {
      const previous = this.listBackups().find((backup) => backup.kind === 'daily')
      if (!previous || Date.now() - previous.createdAt >= DAY) await this.enqueueBackup(this.repository, 'daily')
    } catch {
      this.warning = '自动备份未能完成，任务仍会正常保存。请检查可用空间并重试备份。'
    }
  }

  private backupPath(id: string): string {
    if (typeof id !== 'string' || basename(id) !== id || !backupPattern.test(id)) throw new AppError('VALIDATION_ERROR', '请选择列表中的有效备份。')
    const path = join(this.backupDirectory, id)
    this.assertInsideRoot(this.backupDirectory)
    this.assertInsideRoot(path)
    if (!this.listBackups().some((backup) => backup.id === id)) throw new AppError('VALIDATION_ERROR', '所选备份不存在，请刷新列表。')
    return path
  }

  async restoreBackup(id: string): Promise<TaskSnapshot> {
    if (this.closed) throw new AppError('STORAGE_UNAVAILABLE', '存储已关闭。')
    if (this.restoring) throw new AppError('STORAGE_BUSY', '已有数据恢复操作正在进行。', undefined, true)
    this.ensureLayout()
    const originalBackup = this.backupPath(id)
    const staging = join(this.recoveryDirectory, `staging-${randomUUID()}.sqlite`)
    this.restoring = true
    let candidate: TaskRepository | undefined
    let switchingFiles = false
    try {
      await this.backupQueue
      copyFileSync(originalBackup, staging)
      candidate = new TaskRepository(staging)
      // Validate task fields as well as SQLite integrity, and exclude transient undo records.
      candidate.restoreBackup(originalBackup)
      candidate.close()
      candidate = undefined

      if (this.repository && !existsSync(this.recoveryMarker)) {
        await this.enqueueBackup(this.repository, 'protection')
        this.repository.restoreBackup(staging)
      } else {
        const isolated = join(this.recoveryDirectory, `original-${Date.now()}-${randomUUID()}`)
        mkdirSync(isolated)
        this.assertInsideRoot(isolated)
        this.repository?.close()
        this.repository = undefined
        this.writeMarker(this.recoveryMarker, { phase: 'prepared', staging: basename(staging), isolated: basename(isolated), startedAt: Date.now() })
        switchingFiles = true
        for (const file of [this.databasePath, `${this.databasePath}-journal`, `${this.databasePath}-wal`, `${this.databasePath}-shm`]) {
          if (!existsSync(file)) continue
          this.assertInsideRoot(file)
          if (!lstatSync(file).isFile()) throw new AppError('STORAGE_UNAVAILABLE', '原数据路径不是普通文件，已停止恢复。')
          renameSync(file, join(isolated, basename(file)))
        }
        this.writeMarker(this.recoveryMarker, { phase: 'isolated', staging: basename(staging), isolated: basename(isolated), startedAt: Date.now() })
        renameSync(staging, this.databasePath)
        this.writeMarker(this.recoveryMarker, { phase: 'installed', isolated: basename(isolated), startedAt: Date.now() })
        this.repository = new TaskRepository(this.databasePath)
        this.writeMarker(this.initializedMarker, { initializedAt: Date.now() })
        unlinkSync(this.recoveryMarker)
      }
      this.failure = undefined
      this.warning = undefined
    } catch (error) {
      if (switchingFiles) {
        this.repository?.close()
        this.repository = undefined
        this.failure = new AppError('STORAGE_UNAVAILABLE', '恢复尚未完成。原始数据已隔离保留，请重新选择有效备份恢复。', undefined, true)
      }
      throw errorForStorage(error)
    } finally {
      candidate?.close()
      if (!switchingFiles && existsSync(staging)) { try { unlinkSync(staging) } catch { /* A validated temporary copy is safe to retain. */ } }
      this.restoring = false
    }
    this.startBackupTimer()
    return this.snapshot()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.backupJobs > 0) void this.backupQueue.then(() => this.repository?.close())
    else this.repository?.close()
  }

  async shutdown(): Promise<void> {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    await this.backupQueue
    this.repository?.close()
  }
}
