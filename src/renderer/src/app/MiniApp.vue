<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowUpRight, Check, CheckCircle2, LoaderCircle, Pin, PinOff, RotateCcw, X } from '@lucide/vue'
import type { MiniWindowState, Task } from '@shared/contracts'
import appIcon from '../assets/app-icon.svg'
import PriorityFlag from '../features/tasks/PriorityFlag.vue'
import { formatDate, selectTasks } from '../features/tasks/selectors'
import { useTaskStore } from '../features/tasks/taskStore'
import { errorMessage } from '../shared/api/client'

const store = useTaskStore()
const state = ref<MiniWindowState>({ isOpen: true, isPinned: true })
const windowBusy = ref(false)
const actionError = ref('')
const tasks = computed(() => selectTasks(store.tasks, 'active', '', store.settings.sort))
const sortLabel = computed(() => ({ newest: '最新创建', oldest: '最早创建', priority: '按优先级', manual: '手动顺序' })[store.settings.sort])
let unsubscribe: (() => void) | undefined

async function load(): Promise<void> {
  actionError.value = ''
  try { await store.refresh() } catch { /* The load error is shown in the content area. */ }
}
async function complete(task: Task): Promise<void> {
  if (store.busy) return
  actionError.value = ''
  try { await store.setCompleted(task, true) }
  catch (error) { actionError.value = errorMessage(error) }
}
async function setPinned(): Promise<void> {
  if (windowBusy.value) return
  windowBusy.value = true
  try { state.value = await window.todoApi.mini.setPinned(!state.value.isPinned) }
  catch (error) { actionError.value = errorMessage(error) }
  finally { windowBusy.value = false }
}
async function close(): Promise<void> {
  try { await window.todoApi.mini.close() }
  catch (error) { actionError.value = errorMessage(error) }
}
async function showMain(): Promise<void> {
  try { await window.todoApi.mini.showMain() }
  catch (error) { actionError.value = errorMessage(error) }
}
onMounted(() => {
  void load()
  if (!window.todoApi) return
  unsubscribe = window.todoApi.mini.onStateChanged((value) => { state.value = value })
  void window.todoApi.mini.getState().then((value) => { state.value = value }).catch(() => undefined)
})
onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="mini-shell">
    <header class="mini-titlebar"><div class="mini-brand"><img :src="appIcon" alt="" width="20" height="20"><h1>专注清单</h1></div><div class="mini-window-actions"><button type="button" :aria-label="state.isPinned ? '取消小窗置顶' : '将小窗置顶'" :title="state.isPinned ? '取消置顶' : '置顶显示'" :aria-pressed="state.isPinned" :class="{ pinned: state.isPinned }" :disabled="windowBusy" @click="setPinned"><Pin v-if="state.isPinned" :size="15" /><PinOff v-else :size="15" /></button><button type="button" class="mini-close" aria-label="关闭小窗" title="关闭小窗" :disabled="store.busy" @click="close"><X :size="17" /></button></div></header>
    <div class="mini-list-heading"><div><span>未完成任务</span><strong>{{ tasks.length }}</strong></div><span>{{ sortLabel }}</span></div>
    <div v-if="actionError" class="mini-error" role="alert"><span>{{ actionError }}</span><button type="button" aria-label="关闭错误提示" @click="actionError = ''"><X :size="13" /></button></div>
    <main class="mini-content">
      <div v-if="store.loading" class="mini-empty" role="status"><LoaderCircle :size="28" class="spin" /><p>正在读取任务…</p></div>
      <div v-else-if="store.loadError && !store.loaded" class="mini-empty" role="alert"><RotateCcw :size="26" /><h2>暂时无法读取任务</h2><p>{{ store.loadError }}</p><button type="button" class="button-secondary" @click="load">重新读取</button></div>
      <div v-else-if="!tasks.length" class="mini-empty" role="status"><CheckCircle2 :size="35" /><h2>眼前的事，都完成了</h2><p>可以休息一下，或在主窗口记录新任务。</p></div>
      <div v-else class="mini-task-list" role="list" aria-label="未完成任务列表"><article v-for="task in tasks" :key="task.id" class="mini-task-row" role="listitem" :data-task-id="task.id"><button type="button" class="task-check" role="checkbox" :aria-checked="false" :aria-label="`标记为已完成：${task.title}`" :disabled="store.busy" @click="complete(task)"><Check v-if="task.completed" :size="13" /></button><div class="mini-task-copy"><h2 :title="task.title">{{ task.title }}</h2><div class="mini-task-meta"><PriorityFlag :priority="task.priority" compact :size="11" /><span>{{ formatDate(task.createdAt) }} 创建</span></div></div></article></div>
    </main>
    <footer class="mini-footer"><span><CheckCircle2 :size="11" />{{ store.busy ? '正在保存…' : '与主窗口实时同步' }}</span><button type="button" @click="showMain">打开主窗口<ArrowUpRight :size="14" /></button></footer>
  </div>
</template>

<style scoped>
.mini-shell { height: 100%; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.mini-titlebar { height: 46px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding-left: 15px; border-bottom: 1px solid var(--line); background: var(--canvas); -webkit-app-region: drag; app-region: drag; user-select: none; }
.mini-brand { display: flex; align-items: center; gap: 9px; }
.mini-brand img { border-radius: 5px; }
.mini-brand h1 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: .01em; }
.mini-window-actions { display: flex; align-items: center; height: 100%; padding-right: 5px; gap: 2px; }
.mini-window-actions button { width: 32px; height: 30px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--secondary); }
.mini-window-actions button:hover { background: var(--hover); }
.mini-window-actions button.pinned { color: var(--primary); background: var(--selected); }
.mini-window-actions button.mini-close:hover { color: var(--danger); background: var(--danger-bg); }
.mini-list-heading { height: 51px; display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; gap: 12px; padding: 0 17px; border-bottom: 1px solid var(--line); font-size: 10px; color: var(--secondary); }
.mini-list-heading > div { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--ink); }
.mini-list-heading strong { min-width: 20px; padding: 0 5px; font-size: 10px; line-height: 20px; text-align: center; font-weight: 500; color: var(--primary); background: var(--selected); border-radius: 5px; font-variant-numeric: tabular-nums; }
.mini-content { flex: 1; min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.mini-task-list { padding: 0 14px; }
.mini-task-row { display: flex; align-items: flex-start; gap: 11px; padding: 15px 4px; border-bottom: 1px solid var(--line); }
.mini-task-row:last-child { border-bottom: 0; }
.mini-task-row .task-check { width: 19px; height: 19px; margin-top: 3px; border-radius: 5px; }
.mini-task-copy { flex: 1; min-width: 0; }
.mini-task-copy h2 { margin: 0; font-size: 13px; line-height: 1.75; font-weight: 400; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mini-task-meta { display: flex; align-items: center; gap: 12px; margin-top: 7px; color: var(--secondary); font-size: 9px; }
.mini-empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px 25px; text-align: center; color: var(--primary); }
.mini-empty h2 { font-size: 14px; font-weight: 500; color: var(--ink); margin: 17px 0 0; }
.mini-empty p { font-size: 11px; line-height: 1.9; color: var(--secondary); margin: 10px 0 0; }
.mini-empty .button-secondary { height: 33px; margin-top: 17px; font-size: 11px; }
.mini-error { display: flex; align-items: flex-start; gap: 7px; margin: 10px 14px 0; padding: 8px 10px; color: var(--danger); background: var(--danger-bg); border-radius: 6px; font-size: 10px; line-height: 1.8; }
.mini-error span { flex: 1; }
.mini-error button { display: grid; place-items: center; padding: 2px; border: 0; background: transparent; color: inherit; }
.mini-footer { display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; gap: 8px; padding: 13px 15px; border-top: 1px solid var(--line); }
.mini-footer > span { display: flex; align-items: center; gap: 5px; font-size: 9px; color: var(--secondary); }
.mini-footer > button { display: flex; align-items: center; gap: 5px; padding: 6px 8px; background: var(--selected); border: 0; color: var(--primary); font-size: 10px; border-radius: 5px; white-space: nowrap; }
.mini-footer > button:hover { background: var(--hover); }
</style>
