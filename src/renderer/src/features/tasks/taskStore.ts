import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ApiResult, Preferences, Task, TaskInput, TaskSnapshot, UndoItem } from '@shared/contracts'
import { readResult, errorMessage, RequestError } from '../../shared/api/client'

export const useTaskStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const undos = ref<UndoItem[]>([])
  const settings = ref<Preferences>({ filter: 'all', sort: 'newest', density: 'standard', sidebarCollapsed: false })
  const dataEpoch = ref('')
  const collectionRevision = ref(0)
  const loading = ref(true)
  const loaded = ref(false)
  const busy = ref(false)
  const loadError = ref('')
  const backupWarning = ref('')
  const lastSavedAt = ref<number | null>(null)
  const activeCount = computed(() => tasks.value.filter((task) => !task.completed).length)
  let preferenceQueue: Promise<void> = Promise.resolve()
  let broadcastSequence = 0

  function applySnapshot(snapshot: TaskSnapshot, allowNewEpoch = false): void {
    if (dataEpoch.value && snapshot.dataEpoch !== dataEpoch.value && !allowNewEpoch) return
    if (snapshot.dataEpoch === dataEpoch.value && snapshot.collectionRevision < collectionRevision.value) return
    const readPreferences = !loaded.value || allowNewEpoch
    tasks.value = snapshot.tasks
    undos.value = snapshot.undos
    collectionRevision.value = snapshot.collectionRevision
    dataEpoch.value = snapshot.dataEpoch
    if (readPreferences) settings.value = snapshot.settings
    backupWarning.value = snapshot.backupWarning || ''
    loaded.value = true
    loadError.value = ''
  }

  async function refresh(): Promise<void> {
    loading.value = !loaded.value
    try {
      if (!window.todoApi) throw new Error('桌面服务未连接，请从 Electron 应用打开。')
      const before = broadcastSequence
      const snapshot = await readResult(window.todoApi.tasks.list())
      if (before !== broadcastSequence && snapshot.dataEpoch !== dataEpoch.value) return
      applySnapshot(snapshot, before === broadcastSequence)
    } catch (error) {
      loadError.value = errorMessage(error)
      throw error
    } finally { loading.value = false }
  }

  async function mutate(request: () => Promise<ApiResult<TaskSnapshot>>): Promise<TaskSnapshot> {
    if (busy.value) throw new Error('正在保存其他操作，请稍候。')
    busy.value = true
    const epoch = dataEpoch.value
    try {
      const snapshot = await readResult(request())
      if (epoch !== dataEpoch.value || snapshot.dataEpoch !== epoch) throw new Error('数据已发生变化，请重新读取任务。')
      applySnapshot(snapshot)
      lastSavedAt.value = Date.now()
      return snapshot
    } catch (error) {
      if (error instanceof RequestError && ['REVISION_CONFLICT', 'DATASET_CHANGED', 'NOT_FOUND'].includes(error.code)) {
        await refresh().catch(() => undefined)
      }
      throw error
    } finally { busy.value = false }
  }

  async function create(input: TaskInput, createRequestId: string): Promise<Task | undefined> {
    const before = new Set(tasks.value.map((task) => task.id))
    const snapshot = await mutate(() => window.todoApi.tasks.create({ ...input, createRequestId, dataEpoch: dataEpoch.value }))
    return snapshot.tasks.find((task) => !before.has(task.id))
  }
  async function update(task: Task, input: TaskInput): Promise<void> {
    await mutate(() => window.todoApi.tasks.update({ ...input, id: task.id, expectedRevision: task.revision, dataEpoch: dataEpoch.value }))
  }
  async function setCompleted(task: Task, completed: boolean): Promise<void> {
    await mutate(() => window.todoApi.tasks.setCompleted({ id: task.id, expectedRevision: task.revision, completed, dataEpoch: dataEpoch.value }))
  }
  async function remove(task: Task): Promise<void> {
    await mutate(() => window.todoApi.tasks.remove({ id: task.id, expectedRevision: task.revision, dataEpoch: dataEpoch.value }))
  }
  async function restore(undo: UndoItem): Promise<void> {
    await mutate(() => window.todoApi.tasks.restore({ id: undo.id, token: undo.token, dataEpoch: dataEpoch.value }))
  }
  async function reorder(ids: string[]): Promise<void> {
    await mutate(() => window.todoApi.tasks.reorder({ ids, expectedCollectionRevision: collectionRevision.value, dataEpoch: dataEpoch.value }))
  }
  function updatePreferences(patch: Partial<Preferences>): Promise<void> {
    const operation = preferenceQueue.then(async () => {
      const before = broadcastSequence
      const preferences = await readResult(window.todoApi.settings.update(patch))
      if (before === broadcastSequence) settings.value = preferences
    })
    preferenceQueue = operation.catch(() => undefined)
    return operation
  }

  const stopChanged = window.todoApi?.tasks.onChanged((snapshot) => {
    broadcastSequence++
    applySnapshot(snapshot, true)
  })
  onScopeDispose(() => stopChanged?.())

  return { tasks, undos, settings, dataEpoch, collectionRevision, loading, loaded, busy, loadError,
    backupWarning, lastSavedAt, activeCount, applySnapshot, refresh, create, update, setCompleted, remove, restore, reorder, updatePreferences }
})
