<script setup lang="ts">
import { ArrowDownWideNarrow, Search, X } from '@lucide/vue'
import type { SortMode } from '@shared/contracts'
import CustomSelect from '../../shared/ui/CustomSelect.vue'

defineProps<{ search: string; sort: SortMode }>()
const emit = defineEmits<{ search: [value: string, composing: boolean]; clear: []; sort: [value: SortMode] }>()
const sortOptions = [
  { value: 'newest', label: '最新创建', description: '新记录的任务排在前面' },
  { value: 'oldest', label: '最早创建', description: '先查看较早记录的任务' },
  { value: 'priority', label: '优先级从高到低', description: '同优先级按最新创建排列' },
  { value: 'manual', label: '手动排序', description: '拖动任务或通过菜单调整顺序' }
]
function onSearch(event: Event): void {
  emit('search', (event.target as HTMLInputElement).value, (event as InputEvent).isComposing)
}
</script>

<template>
  <div class="task-toolbar">
    <label class="search-field"><span class="sr-only">搜索任务标题或描述</span><Search :size="17" />
      <input id="task-search" type="search" :value="search" placeholder="搜索任务标题或描述" autocomplete="off" maxlength="400"
        @input="onSearch" @compositionend="emit('search', ($event.target as HTMLInputElement).value, false)">
      <button v-if="search" type="button" class="search-clear" aria-label="清除搜索" @click="emit('clear')"><X :size="15" /></button>
      <kbd v-else class="search-key">Ctrl F</kbd>
    </label>
    <CustomSelect :model-value="sort" :options="sortOptions" label="任务排序" compact @update:model-value="emit('sort', $event as SortMode)"><ArrowDownWideNarrow :size="16" /></CustomSelect>
  </div>
</template>
