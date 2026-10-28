<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CalendarDays, CheckCircle2, Info, Plus } from '@lucide/vue'
import type { Density } from '@shared/contracts'
import TitleBar from './TitleBar.vue'
import AppSidebar from './AppSidebar.vue'
import TaskToolbar from '../features/tasks/TaskToolbar.vue'
import TaskList from '../features/tasks/TaskList.vue'
import TaskEditor from '../features/tasks/TaskEditor.vue'
import BackupDialog from '../features/tasks/BackupDialog.vue'
import BaseDialog from '../shared/ui/BaseDialog.vue'
import CustomSelect from '../shared/ui/CustomSelect.vue'
import EmptyState from '../shared/ui/EmptyState.vue'
import ToastRegion from '../shared/ui/ToastRegion.vue'
import { useTaskWorkspace } from '../features/tasks/useTaskWorkspace'

const workspace = useTaskWorkspace()
const { store, notifications, searchText, query, panelOpen, editingTask, draft, formError, errorField, discardOpen,
  backupsOpen, preferencesOpen, narrowWindow, visibleTasks, canReorder, dirty, selectedId, selectedVisible, sidebarCollapsed } = workspace
const backupBusy = ref(false)
const today = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
const viewTitle = computed(() => ({ all: '全部任务', active: '未完成', completed: '已完成' })[store.settings.filter])
const subtitle = computed(() => query.value.trim() ? `找到 ${visibleTasks.value.length} 项匹配任务`
  : store.settings.filter === 'all' ? `共 ${store.tasks.length} 项任务 · ${store.activeCount} 项未完成` : `共 ${visibleTasks.value.length} 项${viewTitle.value}任务`)
const emptyTitle = computed(() => query.value.trim() ? '没有找到匹配的任务' : !store.tasks.length ? '从第一件小事开始' : store.settings.filter === 'completed' ? '还没有已完成的任务' : '目前没有未完成的任务')
const emptyDescription = computed(() => query.value.trim() ? `没有与“${searchText.value}”匹配的任务，试试其他关键词。` : !store.tasks.length ? '把需要做的事情记下来，为重要的事留出注意力。' : '切换任务视图，或记录接下来要做的事。')
const densityOptions = [
  { value: 'comfortable', label: '舒展', description: '更多留白，从容阅读任务内容' },
  { value: 'standard', label: '标准', description: '平衡可读性与任务数量，推荐' },
  { value: 'compact', label: '紧凑', description: '收起描述摘要，显示更多任务' }
]
let removeCloseListener: (() => void) | undefined
let removeNewTaskListener: (() => void) | undefined

function keydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  if ((event.target as HTMLElement)?.closest('[role="combobox"], [role="menu"]')) return
  if (document.querySelector('dialog[open]')) return
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); if (store.loaded) workspace.guard(workspace.openNew) }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); const input = document.querySelector<HTMLInputElement>('#task-search'); input?.focus(); input?.select() }
    if (event.key === 'Enter' && panelOpen.value) { event.preventDefault(); void workspace.save() }
  }
  if (event.key === 'Escape' && panelOpen.value) { event.preventDefault(); workspace.guard(workspace.closePanel) }
}
onMounted(() => {
  void workspace.retry()
  window.addEventListener('keydown', keydown)
  if (window.todoApi) removeCloseListener = window.todoApi.window.onCloseRequested(() => {
    if (backupBusy.value) {
      void window.todoApi.window.cancelClose()
      notifications.push('正在处理备份', '操作完成后请重试关闭窗口。', 'info')
    } else workspace.requestWindowClose()
  })
  if (window.todoApi) removeNewTaskListener = window.todoApi.window.onNewTaskRequested(() => workspace.guard(workspace.openNew))
})
onBeforeUnmount(() => { window.removeEventListener('keydown', keydown); removeCloseListener?.(); removeNewTaskListener?.() })
</script>

<template>
  <div class="app-shell" :data-density="store.settings.density" :class="{ 'sidebar-collapsed': sidebarCollapsed, 'detail-open': panelOpen }">
    <TitleBar @error="notifications.push('窗口操作失败', $event, 'error')" />
    <div class="workspace-layout">
      <AppSidebar :filter="store.settings.filter" :total="store.tasks.length" :active="store.activeCount" :collapsed="sidebarCollapsed" :auto-collapsed="narrowWindow" :busy="store.busy"
        @filter="workspace.setFilter" @toggle="workspace.toggleSidebar" @backups="workspace.openBackups" @preferences="preferencesOpen = true" />
      <main class="main-panel">
        <header class="main-header"><div class="date-label"><CalendarDays :size="14" />{{ today }}</div><div class="heading-row"><h1>{{ viewTitle }}</h1><button id="add-task" type="button" class="button-primary" :disabled="!store.loaded || store.busy" @click="workspace.guard(workspace.openNew)"><Plus :size="17" />新增任务</button></div><p class="view-subtitle">{{ store.loading ? '正在读取本机任务…' : subtitle }}</p></header>
        <TaskToolbar :search="searchText" :sort="store.settings.sort" @search="workspace.search" @clear="workspace.clearSearch" @sort="workspace.setSort" />
        <p v-if="store.backupWarning" class="backup-warning" role="status">{{ store.backupWarning }}<button type="button" @click="workspace.openBackups">查看备份</button></p>
        <div class="list-topline"><span>任务清单</span><span v-if="visibleTasks.length"><Info :size="12" />点击任务查看详情</span></div>
        <p v-if="store.settings.sort === 'manual'" class="reorder-hint">{{ canReorder ? '拖动左侧手柄调整顺序，也可通过任务菜单上移或下移。' : dirty ? '保存或取消当前编辑后，可调整任务顺序。' : '切换到全部任务并清除搜索后，可手动调整顺序。' }}</p>
        <EmptyState v-if="store.loading" kind="loading" title="正在加载任务" description="正在读取本机保存的任务，请稍候。" />
        <div v-else-if="store.loadError && !store.loaded" class="load-error"><EmptyState kind="error" title="暂时无法读取任务" :description="store.loadError" action="重新读取" @action="workspace.retry" /><button type="button" class="link-button" @click="workspace.openBackups">从备份恢复</button></div>
        <EmptyState v-else-if="!visibleTasks.length" :kind="query.trim() ? 'search' : 'empty'" :title="emptyTitle" :description="emptyDescription" :action="query.trim() ? '清除搜索' : !store.tasks.length ? '新增任务' : '查看全部任务'" @action="query.trim() ? workspace.clearSearch() : !store.tasks.length ? workspace.guard(workspace.openNew) : workspace.setFilter('all')" />
        <TaskList v-else :tasks="visibleTasks" :selected-id="selectedId" :busy="store.busy" :can-reorder="canReorder" @open="workspace.guard(() => workspace.openTask($event))" @toggle="workspace.toggleTask" @remove="workspace.removeTask" @move="workspace.move" @reorder="workspace.reorder" />
        <button type="button" class="quick-add" :disabled="!store.loaded || store.busy" @click="workspace.guard(workspace.openNew)"><Plus :size="17" />添加一个新任务<kbd>Ctrl N</kbd></button>
        <footer class="main-footer"><span><CheckCircle2 :size="12" />{{ store.busy ? '正在保存…' : store.loaded ? '任务已即时保存到本机' : '本地任务存储' }}</span><span>Ctrl Enter 保存</span></footer>
      </main>
      <div v-if="panelOpen" class="detail-scrim" @click="workspace.guard(workspace.closePanel)"></div>
      <TaskEditor v-if="panelOpen" :task="editingTask" :draft="draft" :busy="store.busy" :dirty="dirty" :error="formError" :error-field="errorField" :visible="selectedVisible"
        @change="Object.assign(draft, $event)" @save="workspace.save" @close="workspace.guard(workspace.closePanel)" @remove="editingTask && workspace.removeTask(editingTask)" @reload="workspace.reloadEditor" />
    </div>
    <ToastRegion :undos="store.undos" :busy="store.busy" @restore="workspace.restore" />
    <BaseDialog :open="discardOpen" title="保存这次修改？" :busy="store.busy" @close="workspace.cancelPending"><p class="dialog-description">你有尚未保存的内容。保存后继续，或放弃这次修改。</p><div class="dialog-actions"><button type="button" class="button-text danger" @click="workspace.discardAndContinue">放弃修改</button><button type="button" class="button-secondary" autofocus @click="workspace.cancelPending">取消</button><button type="button" class="button-primary" @click="workspace.saveAndContinue">保存并继续</button></div></BaseDialog>
    <BaseDialog :open="preferencesOpen" title="显示设置" @close="preferencesOpen = false"><p class="dialog-description">调整列表密度，找到适合自己的阅读节奏。</p><div class="field"><span class="field-label">列表密度</span><CustomSelect :model-value="store.settings.density" :options="densityOptions" label="列表密度" @update:model-value="workspace.setDensity($event as Density)" /></div><p class="dialog-footnote">显示设置会自动保存，下次打开时继续使用。</p></BaseDialog>
    <BackupDialog :open="backupsOpen" @close="backupsOpen = false" @busy="backupBusy = $event" />
  </div>
</template>
