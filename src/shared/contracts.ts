export type TaskFilter = 'all' | 'active' | 'completed'
export type SortMode = 'newest' | 'oldest' | 'priority' | 'manual'
export type Density = 'comfortable' | 'standard' | 'compact'
export type Priority = 0 | 1 | 2

export interface TaskInput { title: string; description: string; priority: Priority }
export interface Task extends TaskInput {
  id: string
  completed: boolean
  sortOrder: number
  revision: number
  createdAt: number
  updatedAt: number
  completedAt: number | null
}
export interface Preferences { filter: TaskFilter; sort: SortMode; density: Density; sidebarCollapsed: boolean }
export interface UndoItem { id: string; title: string; token: string; expiresAt: number }
export interface TaskSnapshot {
  tasks: Task[]
  collectionRevision: number
  dataEpoch: string
  undos: UndoItem[]
  settings: Preferences
  backupWarning?: string
}
export interface MutationContext { dataEpoch: string }
export interface CreateTaskInput extends TaskInput, MutationContext { createRequestId: string }
export interface UpdateTaskInput extends TaskInput, MutationContext { id: string; expectedRevision: number }
export interface SetCompletedInput extends MutationContext { id: string; expectedRevision: number; completed: boolean }
export interface RemoveTaskInput extends MutationContext { id: string; expectedRevision: number }
export interface RestoreTaskInput extends MutationContext { id: string; token: string }
export interface ReorderTaskInput extends MutationContext { ids: string[]; expectedCollectionRevision: number }
export type BackupKind = 'daily' | 'manual' | 'protection'
export interface BackupInfo { id: string; createdAt: number; size: number; kind: BackupKind }
export interface ApiError { code: string; message: string; field?: string; retryable: boolean }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }
export interface WindowState { isMaximized: boolean; platform: string }
export interface MiniWindowState { isOpen: boolean; isPinned: boolean }

export interface TodoApi {
  tasks: {
    list(): Promise<ApiResult<TaskSnapshot>>
    create(input: CreateTaskInput): Promise<ApiResult<TaskSnapshot>>
    update(input: UpdateTaskInput): Promise<ApiResult<TaskSnapshot>>
    setCompleted(input: SetCompletedInput): Promise<ApiResult<TaskSnapshot>>
    remove(input: RemoveTaskInput): Promise<ApiResult<TaskSnapshot>>
    restore(input: RestoreTaskInput): Promise<ApiResult<TaskSnapshot>>
    reorder(input: ReorderTaskInput): Promise<ApiResult<TaskSnapshot>>
    onChanged(callback: (snapshot: TaskSnapshot) => void): () => void
  }
  settings: { update(input: Partial<Preferences>): Promise<ApiResult<Preferences>> }
  backups: {
    list(): Promise<ApiResult<BackupInfo[]>>
    create(): Promise<ApiResult<BackupInfo>>
    restore(id: string): Promise<ApiResult<TaskSnapshot>>
  }
  mini: {
    open(): Promise<MiniWindowState>
    close(): Promise<void>
    showMain(): Promise<void>
    getState(): Promise<MiniWindowState>
    setPinned(pinned: boolean): Promise<MiniWindowState>
    onStateChanged(callback: (state: MiniWindowState) => void): () => void
  }
  window: {
    getState(): Promise<WindowState>
    minimize(): Promise<void>
    toggleMaximize(): Promise<WindowState>
    requestClose(): Promise<void>
    confirmClose(): Promise<void>
    cancelClose(): Promise<void>
    onStateChanged(callback: (state: WindowState) => void): () => void
    onCloseRequested(callback: () => void): () => void
    onNewTaskRequested(callback: () => void): () => void
  }
}
