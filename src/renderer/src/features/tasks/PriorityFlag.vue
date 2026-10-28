<script setup lang="ts">
import { computed } from 'vue'
import { Flag } from '@lucide/vue'
import type { Priority } from '@shared/contracts'

const props = withDefaults(defineProps<{ priority: Priority; iconOnly?: boolean; compact?: boolean; badge?: boolean; size?: number }>(), {
  iconOnly: false, compact: false, badge: false, size: 13
})
const level = computed(() => props.priority === 2 ? 'high' : props.priority === 0 ? 'low' : 'normal')
const label = computed(() => props.priority === 2 ? '高优先级' : props.priority === 0 ? '低优先级' : '普通优先级')
const shortLabel = computed(() => props.priority === 2 ? '高' : props.priority === 0 ? '低' : '普通')
</script>

<template>
  <span class="priority-flag" :class="[level, { badge, compact }]" :title="label" :aria-label="iconOnly ? label : undefined">
    <Flag :size="size" aria-hidden="true" /><span v-if="!iconOnly">{{ compact ? shortLabel : label }}</span>
  </span>
</template>

<style scoped>
.priority-flag { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; font-size: 10px; line-height: 20px; white-space: nowrap; }
.priority-flag svg { fill: color-mix(in srgb, currentColor 12%, transparent); stroke-width: 1.8; }
.priority-flag.high { color: var(--danger); }
.priority-flag.normal { color: var(--primary); }
.priority-flag.low { color: var(--completed); }
.priority-flag.badge { padding: 0 6px; border-radius: 4px; margin-top: 4px; }
.priority-flag.badge.high { background: var(--danger-bg); }
.priority-flag.badge.normal { background: var(--selected); }
.priority-flag.badge.low { background: var(--canvas); }
.priority-flag.compact { font-size: 9px; gap: 4px; }
</style>
