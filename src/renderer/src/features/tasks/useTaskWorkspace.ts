import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { Density, SortMode, Task, TaskFilter, TaskInput, UndoItem } from '@shared/contracts'
import { validateTaskInput } from '@shared/validation'
import { errorMessage } from '../../shared/api/client'
import { useNotificationStore } from '../../shared/ui/notificationStore'
import { selectTasks } from './selectors'
import { useTaskStore } from './taskStore'

type Action = () => void | Promise<void>
const blank = (): TaskInput => ({ title: '', description: '', priority: 1 })

export function useTaskWorkspace() {
  const store = useTaskStore()
  const notifications = useNotificationStore()
  const searchText = ref('')
  const query = ref('')
  const panelOpen = ref(false)
  const editingTask = ref<Task | null>(null)
  const draft = reactive<TaskInput>(blank())
  const originalDraft = ref('')
  const requestId = ref('')
  const formError = ref('')
  const errorField = ref('')
  const discardOpen = ref(false)
  const backupsOpen = ref(false)
  const preferencesOpen = ref(false)
  const savingDraft = ref(false)
  const narrowWindow = ref(window.innerWidth < 900)
  let pendingAction: Action | null = null
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let returnFocus: HTMLElement | null = null
  let nativeClosePending = false

  const visibleTasks = computed(() => selectTasks(store.tasks, store.settings.filter, query.value, store.settings.sort))
  const canReorder = computed(() => store.settings.filter === 'all' && store.settings.sort === 'manual' && !query.value.trim() && !store.busy && !dirty.value)
  const dirty = computed(() => panelOpen.value && JSON.stringify(draft) !== originalDraft.value)
  const selectedId = computed(() => editingTask.value?.id || null)
  const selectedVisible = computed(() => !selectedId.value || visibleTasks.value.some((task) => task.id === selectedId.value))
  const sidebarCollapsed = computed(() => store.settings.sidebarCollapsed || narrowWindow.value)

  function handleResize(): void { narrowWindow.value = window.innerWidth < 900 }
  window.addEventListener('resize', handleResize)
  onBeforeUnmount(() => { clearTimeout(searchTimer); window.removeEventListener('resize', handleResize) })

  function search(value: string, composing = false): void {
    const bounded = composing ? value : Array.from(value).slice(0, 200).join('')
    searchText.value = bounded
    clearTimeout(searchTimer)
    if (!composing) searchTimer = setTimeout(() => { query.value = bounded }, 150)
  }
  function clearSearch(): void {
    clearTimeout(searchTimer)
    searchText.value = ''
    query.value = ''
  }
  async function preference(patch: Parameters<typeof store.updatePreferences>[0]): Promise<void> {
    try { await store.updatePreferences(patch) }
    catch (error) { notifications.push('设置未能保存', errorMessage(error), 'error') }
  }
  const setFilter = (filter: TaskFilter): Promise<void> => preference({ filter })
  const setSort = (sort: SortMode): Promise<void> => preference({ sort })
  const setDensity = (density: Density): Promise<void> => preference({ density })
  function toggleSidebar(): void {
    if (narrowWindow.value) return
    void preference({ sidebarCollapsed: !store.settings.sidebarCollapsed })
  }

  function fill(task: Task | null): void {
    editingTask.value = task ? { ...task } : null
    Object.assign(draft, task ? { title: task.title, description: task.description, priority: task.priority } : blank())
    originalDraft.value = JSON.stringify(draft)
    requestId.value = crypto.randomUUID()
    formError.value = ''
    errorField.value = ''
    panelOpen.value = true
  }
  async function focusTitle(): Promise<void> {
    await nextTick()
    document.querySelector<HTMLTextAreaElement>('#task-title')?.focus()
  }
  function openNew(): void {
    returnFocus = document.activeElement as HTMLElement
    fill(null)
    void focusTitle()
  }
  function openTask(task: Task): void {
    returnFocus = document.activeElement as HTMLElement
    fill(task)
    void focusTitle()
  }
  function closePanel(): void {
    panelOpen.value = false
    editingTask.value = null
    formError.value = ''
    void nextTick(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
      else document.querySelector<HTMLButtonElement>('#add-task')?.focus()
    })
  }
  function guard(action: Action): void {
    if (store.busy) { notifications.push('正在保存', '操作完成后请重试。', 'info'); return }
    if (!dirty.value) { void action(); return }
    pendingAction = action
    discardOpen.value = true
  }
  function cancelNativeClose(): void {
    if (!nativeClosePending) return
    nativeClosePending = false
    void window.todoApi.window.cancelClose().catch(() => undefined)
  }
  function cancelPending(): void { pendingAction = null; discardOpen.value = false; cancelNativeClose() }
  function requestWindowClose(): void {
    nativeClosePending = true
    if (store.busy) { cancelNativeClose(); notifications.push('正在保存', '操作完成后请重试关闭窗口。', 'info'); return }
    guard(async () => {
      try { await window.todoApi.window.confirmClose(); nativeClosePending = false }
      catch (error) { cancelNativeClose(); notifications.push('窗口未能关闭', errorMessage(error), 'error') }
    })
  }
  function discardAndContinue(): void {
    const action = pendingAction
    pendingAction = null
    discardOpen.value = false
    if (editingTask.value) fill(store.tasks.find((task) => task.id === editingTask.value?.id) || null)
    else Object.assign(draft, blank())
    originalDraft.value = JSON.stringify(draft)
    void action?.()
  }

  function viewTask(id: string): void {
    guard(async () => {
      clearSearch()
      await setFilter('all')
      const task = store.tasks.find((item) => item.id === id)
      if (task) openTask(task)
    })
  }
  async function save(): Promise<boolean> {
    if (!dirty.value) return true
    if (store.busy) return false
    formError.value = ''
    errorField.value = ''
    let input: TaskInput
    try { input = validateTaskInput({ ...draft }) }
    catch (error) {
      formError.value = errorMessage(error)
      errorField.value = error && typeof error === 'object' && 'field' in error ? String(error.field) : ''
      await focusTitle()
      return false
    }
    savingDraft.value = true
    try {
      const creating = !editingTask.value
      let saved: Task | undefined
      if (editingTask.value) {
        const id = editingTask.value.id
        await store.update(editingTask.value, input)
        saved = store.tasks.find((task) => task.id === id)
        if (saved) fill(saved)
      } else {
        saved = await store.create(input, requestId.value)
        Object.assign(draft, input)
        originalDraft.value = JSON.stringify(draft)
        closePanel()
      }
      const isVisible = !saved || visibleTasks.value.some((task) => task.id === saved.id)
      notifications.push(creating ? '任务已创建' : '修改已保存', isVisible ? '' : '当前筛选下不可见。', 'success',
        !isVisible && saved ? { label: '查看任务', run: () => viewTask(saved!.id) } : undefined)
      return true
    } catch (error) {
      formError.value = errorMessage(error)
      return false
    } finally { savingDraft.value = false }
  }
  async function saveAndContinue(): Promise<void> {
    const action = pendingAction
    pendingAction = null
    discardOpen.value = false
    if (await save()) await action?.()
    else cancelNativeClose()
  }
  function toggleTask(task: Task): void {
    const action = async (): Promise<void> => {
      try {
        const current = store.tasks.find((item) => item.id === task.id)
        if (!current) return
        await store.setCompleted(current, !current.completed)
        if (editingTask.value?.id === current.id) {
          const changed = store.tasks.find((item) => item.id === current.id)
          if (changed) fill(changed)
        }
        notifications.push(current.completed ? '已恢复为未完成' : '任务已完成', current.title)
      } catch (error) { notifications.push('状态未能更新', errorMessage(error), 'error') }
    }
    if (editingTask.value?.id === task.id) guard(action)
    else if (!store.busy) void action()
  }
  function removeTask(task: Task): void {
    const action = async (): Promise<void> => {
      try {
        const current = store.tasks.find((item) => item.id === task.id)
        if (!current) return
        await store.remove(current)
        if (editingTask.value?.id === current.id) closePanel()
      } catch (error) { notifications.push('任务未能删除', errorMessage(error), 'error') }
    }
    if (editingTask.value?.id === task.id) guard(action)
    else if (!store.busy) void action()
  }
  async function restore(undo: UndoItem): Promise<void> {
    try {
      await store.restore(undo)
      const visible = visibleTasks.value.some((task) => task.id === undo.id)
      notifications.push('任务已恢复', visible ? undo.title : '当前筛选下不可见。', 'success',
        visible ? undefined : { label: '查看任务', run: () => viewTask(undo.id) })
    } catch (error) { notifications.push('撤销未能完成', errorMessage(error), 'error') }
  }
  async function reorder(ids: string[]): Promise<void> {
    if (!canReorder.value) return
    try {
      await store.reorder(ids)
      if (!dirty.value && editingTask.value) {
        const task = store.tasks.find((item) => item.id === editingTask.value?.id)
        if (task) fill(task)
      }
    } catch (error) { notifications.push('顺序未能保存', errorMessage(error), 'error') }
  }
  function move(task: Task, direction: number): void {
    if (!canReorder.value) return
    const ids = visibleTasks.value.map((item) => item.id)
    const from = ids.indexOf(task.id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to]!, ids[from]!]
    void reorder(ids)
  }
  function reloadEditor(): void {
    guard(() => {
      const latest = store.tasks.find((task) => task.id === editingTask.value?.id)
      if (latest) openTask(latest)
      else closePanel()
    })
  }
  function openBackups(): void { guard(() => { closePanel(); backupsOpen.value = true }) }
  async function retry(): Promise<void> {
    try { await store.refresh() }
    catch (error) { notifications.push('任务读取失败', errorMessage(error), 'error') }
  }
  watch(() => store.dataEpoch, (next, previous) => {
    if (previous && next !== previous) { closePanel(); cancelPending(); clearSearch() }
  })
  watch(() => [store.tasks.find((task) => task.id === editingTask.value?.id)?.revision, store.busy, savingDraft.value] as const, () => {
    if (!panelOpen.value || !editingTask.value || store.busy || savingDraft.value) return
    const current = store.tasks.find((task) => task.id === editingTask.value?.id)
    if (current?.revision === editingTask.value.revision) return
    if (!dirty.value) {
      if (current) fill(current)
      else closePanel()
    } else {
      formError.value = current ? '这项任务已在另一个窗口更新，你的输入已保留。请重新载入任务后继续编辑。' : '这项任务已在其他窗口删除，你的输入仍然保留。'
      errorField.value = ''
    }
  }, { flush: 'post' })

  return { store, notifications, searchText, query, panelOpen, editingTask, draft, formError, errorField, discardOpen,
    backupsOpen, preferencesOpen, narrowWindow, visibleTasks, canReorder, dirty, selectedId, selectedVisible, sidebarCollapsed,
    search, clearSearch, setFilter, setSort, setDensity, toggleSidebar, openNew, openTask, closePanel, guard, cancelPending,
    discardAndContinue, saveAndContinue, save, toggleTask, removeTask, restore, reorder, move, viewTask, reloadEditor, openBackups, retry, requestWindowClose }
}
