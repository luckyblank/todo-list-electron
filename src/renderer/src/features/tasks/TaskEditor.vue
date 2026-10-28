<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RotateCcw, Trash2, X } from '@lucide/vue'
import type { Task, TaskInput, Priority } from '@shared/contracts'
import CustomSelect from '../../shared/ui/CustomSelect.vue'
import { formatDate } from './selectors'
import PriorityFlag from './PriorityFlag.vue'

defineProps<{ task: Task | null; draft: TaskInput; busy: boolean; dirty: boolean; error: string; errorField: string; visible: boolean }>()
const emit = defineEmits<{ change: [value: Partial<TaskInput>]; save: []; close: []; remove: []; reload: [] }>()
const panel = ref<HTMLElement | null>(null)
const overlay = ref(window.innerWidth < 1100)
function resize(): void { overlay.value = window.innerWidth < 1100 }
function trapFocus(event: KeyboardEvent): void {
  if (!overlay.value || event.key !== 'Tab' || document.querySelector('dialog[open]')) return
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex="0"]') || [])]
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => { window.addEventListener('resize', resize); document.addEventListener('keydown', trapFocus) })
onBeforeUnmount(() => { window.removeEventListener('resize', resize); document.removeEventListener('keydown', trapFocus) })
const options = [
  { value: 2, label: '高优先级', description: '重要的任务，优先处理' },
  { value: 1, label: '普通优先级', description: '按自己的安排完成' },
  { value: 0, label: '低优先级', description: '可以稍后处理的事项' }
]
function preventTitleNewline(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.isComposing && !event.ctrlKey && !event.metaKey) event.preventDefault()
}
</script>

<template>
  <aside ref="panel" class="detail-panel" :role="overlay ? 'dialog' : 'complementary'" :aria-modal="overlay || undefined" aria-labelledby="editor-heading">
    <header class="detail-header"><div><h2 id="editor-heading">{{ task ? '任务详情' : '新增任务' }}</h2><p>查看与编辑任务内容</p></div><button type="button" class="icon-button" aria-label="关闭任务详情" :disabled="busy" @click="emit('close')"><X :size="18" /></button></header>
    <form class="task-form" novalidate @submit.prevent="emit('save')" :aria-busy="busy">
      <div class="form-scroll">
        <p v-if="!visible" class="selection-note">当前任务不在筛选结果中，你仍可继续编辑。</p>
        <div class="field"><label for="task-title" class="field-label"><span>任务标题 <span class="required">*</span></span><span class="character-count">{{ Array.from(draft.title).length }} / 120</span></label>
          <textarea id="task-title" class="text-field title-field" rows="2" :value="draft.title" placeholder="准备做些什么？" :disabled="busy" :aria-invalid="errorField === 'title'" aria-describedby="editor-error" @input="emit('change', { title: ($event.target as HTMLTextAreaElement).value })" @keydown="preventTitleNewline"></textarea>
        </div>
        <div class="field"><label for="task-description" class="field-label"><span>任务描述</span><span class="optional">可选</span></label>
          <textarea id="task-description" class="text-field description-field" rows="6" :value="draft.description" placeholder="补充说明、行动步骤或需要记住的细节…" :disabled="busy" :aria-invalid="errorField === 'description'" aria-describedby="editor-error" @input="emit('change', { description: ($event.target as HTMLTextAreaElement).value })"></textarea>
          <span class="description-count" :class="{ danger: Array.from(draft.description).length > 2000 }">{{ Array.from(draft.description).length }} / 2,000</span>
        </div>
        <div class="field"><span class="field-label">优先级</span><CustomSelect :model-value="draft.priority" :options="options" label="任务优先级" :disabled="busy" @update:model-value="emit('change', { priority: $event as Priority })"><PriorityFlag :priority="draft.priority" icon-only :size="16" /><template #option-prefix="{ option }"><PriorityFlag :priority="option.value as Priority" icon-only :size="16" /></template></CustomSelect><p class="field-help">列表支持按优先级排序。</p></div>
        <div class="form-meta"><div><span>创建时间</span><time>{{ task ? formatDate(task.createdAt, true) : '创建后自动记录' }}</time></div><div><span>最近修改</span><time>{{ task ? formatDate(task.updatedAt, true) : '尚未保存' }}</time></div></div>
      </div>
      <div v-if="error" id="editor-error" class="form-error" role="alert"><p>{{ error }}</p><button v-if="task" type="button" @click="emit('reload')"><RotateCcw :size="13" />重新载入任务</button></div>
      <footer class="form-actions"><button id="save-task" type="submit" class="button-primary" :disabled="busy || !dirty || !draft.title.trim()">{{ busy ? '保存中…' : task ? '保存修改' : '创建任务' }}</button><button type="button" class="button-secondary" :disabled="busy" @click="emit('close')">取消</button><button v-if="task" type="button" class="icon-button danger" aria-label="删除当前任务" title="删除任务" :disabled="busy" @click="emit('remove')"><Trash2 :size="17" /></button></footer>
    </form>
  </aside>
</template>
