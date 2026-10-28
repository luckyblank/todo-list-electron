<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Check, GripVertical, MoreHorizontal, Pencil, Trash2 } from '@lucide/vue'
import type { Task } from '@shared/contracts'
import { formatDate } from './selectors'
import PriorityFlag from './PriorityFlag.vue'

const props = defineProps<{ tasks: Task[]; selectedId: string | null; busy: boolean; canReorder: boolean }>()
const emit = defineEmits<{ open: [task: Task]; toggle: [task: Task]; remove: [task: Task]; move: [task: Task, direction: number]; reorder: [ids: string[]] }>()
const menuTask = ref<Task | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuPosition = ref({ top: '0px', left: '0px' })
const draggedId = ref<string | null>(null)
const dropTarget = ref<{ id: string; after: boolean } | null>(null)
let menuTrigger: HTMLButtonElement | null = null

async function openMenu(task: Task, event: MouseEvent): Promise<void> {
  closeMenu(false)
  menuTrigger = event.currentTarget as HTMLButtonElement
  const box = menuTrigger.getBoundingClientRect()
  menuTask.value = task
  const expectedHeight = props.canReorder ? 181 : 94
  menuPosition.value = { left: `${Math.min(box.right - 164, window.innerWidth - 176)}px`, top: `${Math.max(8, Math.min(box.bottom + 5, window.innerHeight - expectedHeight - 10))}px` }
  await nextTick()
  menu.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
function closeMenu(restoreFocus = true): void {
  menuTask.value = null
  if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus()
}
function outside(event: PointerEvent): void {
  if (!menu.value?.contains(event.target as Node) && !menuTrigger?.contains(event.target as Node)) closeMenu(false)
}
function closeOnScroll(): void { closeMenu(false) }
function cleanup(): void {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', closeOnScroll)
}
watch(menuTask, (task) => {
  if (task) { document.addEventListener('pointerdown', outside); window.addEventListener('resize', closeOnScroll) }
  else cleanup()
})
onBeforeUnmount(cleanup)
function menuAction(action: 'open' | 'remove' | 'up' | 'down'): void {
  const task = menuTask.value
  closeMenu()
  if (!task) return
  if (action === 'open') emit('open', task)
  if (action === 'remove') emit('remove', task)
  if (action === 'up') emit('move', task, -1)
  if (action === 'down') emit('move', task, 1)
}
function menuKey(event: KeyboardEvent): void {
  const options = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
  const index = options.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeMenu(); return }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    options[next]?.focus()
  }
}
function dragStart(task: Task, event: DragEvent): void {
  if (!props.canReorder || !event.dataTransfer) { event.preventDefault(); return }
  closeMenu(false)
  draggedId.value = task.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', task.id)
  const row = (event.currentTarget as HTMLElement).closest('.task-row')
  if (row) event.dataTransfer.setDragImage(row, 24, 24)
}
function dragOver(task: Task, event: DragEvent): void {
  if (!props.canReorder || !draggedId.value || draggedId.value === task.id) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropTarget.value = { id: task.id, after: event.clientY > box.y + box.height / 2 }
}
function dragEnd(): void { draggedId.value = null; dropTarget.value = null }
function drop(task: Task, event: DragEvent): void {
  event.preventDefault()
  if (!props.canReorder || !draggedId.value || draggedId.value === task.id || !dropTarget.value) { dragEnd(); return }
  const previous = props.tasks.map((item) => item.id)
  const ids = previous.filter((id) => id !== draggedId.value)
  const target = ids.indexOf(task.id)
  ids.splice(target + (dropTarget.value.after ? 1 : 0), 0, draggedId.value)
  dragEnd()
  if (ids.some((id, index) => id !== previous[index])) emit('reorder', ids)
}
</script>

<template>
  <div class="task-list" role="list" aria-label="任务列表" @scroll="closeMenu(false)">
    <article v-for="task in tasks" :key="task.id" class="task-row" role="listitem" :data-task-id="task.id"
      :class="{ selected: selectedId === task.id, completed: task.completed, dragging: draggedId === task.id,
        'drop-before': dropTarget?.id === task.id && !dropTarget.after, 'drop-after': dropTarget?.id === task.id && dropTarget.after }"
      @dragover="dragOver(task, $event)" @drop="drop(task, $event)">
      <button v-if="canReorder" type="button" class="drag-handle" draggable="true" tabindex="-1" :aria-label="`拖动调整 ${task.title} 的顺序`" title="拖动调整顺序" @dragstart="dragStart(task, $event)" @dragend="dragEnd"><GripVertical :size="16" /></button>
      <button type="button" class="task-check" role="checkbox" :aria-checked="task.completed" :aria-label="`${task.completed ? '标记为未完成' : '标记为已完成'}：${task.title}`" :disabled="busy" @click="emit('toggle', task)"><Check v-if="task.completed" :size="14" /></button>
      <button type="button" class="task-copy" :aria-label="`查看任务：${task.title}`" @click="emit('open', task)">
        <span class="task-title">{{ task.title }}</span><span v-if="task.description" class="task-description">{{ task.description.replace(/\n/g, ' ') }}</span>
        <span class="task-meta"><span>{{ task.completed ? '已完成' : '未完成' }}</span><span class="meta-dot">·</span><span>{{ formatDate(task.createdAt) }} 创建</span></span>
      </button>
      <PriorityFlag :priority="task.priority" badge />
      <button type="button" class="task-menu-button icon-button" :aria-label="`更多操作：${task.title}`" aria-haspopup="menu" :disabled="busy" @click="openMenu(task, $event)"><MoreHorizontal :size="19" /></button>
    </article>
  </div>
  <Teleport to="body">
    <div v-if="menuTask" ref="menu" class="action-menu" :style="menuPosition" role="menu" aria-label="任务操作" @keydown="menuKey">
      <button type="button" role="menuitem" @click="menuAction('open')"><Pencil :size="15" />编辑任务</button>
      <template v-if="canReorder"><button type="button" role="menuitem" :disabled="tasks[0]?.id === menuTask.id" @click="menuAction('up')"><ArrowUp :size="15" />上移</button><button type="button" role="menuitem" :disabled="tasks[tasks.length - 1]?.id === menuTask.id" @click="menuAction('down')"><ArrowDown :size="15" />下移</button><hr></template>
      <button type="button" role="menuitem" class="danger" @click="menuAction('remove')"><Trash2 :size="15" />删除任务</button>
    </div>
  </Teleport>
</template>
