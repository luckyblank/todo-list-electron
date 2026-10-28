<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { AlertCircle, CheckCircle2, Info, Undo2, X } from '@lucide/vue'
import type { UndoItem } from '@shared/contracts'
import { useNotificationStore } from './notificationStore'

const props = defineProps<{ undos: UndoItem[]; busy: boolean }>()
const emit = defineEmits<{ restore: [value: UndoItem] }>()
const notifications = useNotificationStore()
const now = ref(Date.now())
const expanded = ref(false)
const clock = setInterval(() => { now.value = Date.now() }, 250)
onBeforeUnmount(() => clearInterval(clock))
const validUndos = computed(() => props.undos.filter((undo) => undo.expiresAt > now.value).sort((a, b) => b.expiresAt - a.expiresAt))
const visibleUndos = computed(() => expanded.value ? validUndos.value : validUndos.value.slice(0, 3))
</script>

<template>
  <div class="toast-region" aria-live="polite" aria-relevant="additions text">
    <div v-for="undo in visibleUndos" :key="undo.token" class="toast undo-toast"><Undo2 :size="19" class="toast-icon" /><div class="toast-copy"><strong>任务已删除</strong><span>{{ undo.title }}</span></div><button type="button" class="toast-action" :disabled="busy" @click="emit('restore', undo)">撤销 <span class="undo-countdown">{{ Math.max(0, Math.ceil((undo.expiresAt - now) / 1000)) }}s</span></button></div>
    <button v-if="validUndos.length > 3" type="button" class="toast-expand" @click="expanded = !expanded">{{ expanded ? '收起撤销记录' : `还有 ${validUndos.length - 3} 条可撤销删除` }}</button>
    <div v-for="notice in notifications.items" :key="notice.id" class="toast" :class="notice.tone" :role="notice.tone === 'error' ? 'alert' : 'status'">
      <AlertCircle v-if="notice.tone === 'error'" :size="19" class="toast-icon" /><Info v-else-if="notice.tone === 'info'" :size="19" class="toast-icon" /><CheckCircle2 v-else :size="19" class="toast-icon" />
      <div class="toast-copy"><strong>{{ notice.title }}</strong><span v-if="notice.message">{{ notice.message }}</span></div>
      <button v-if="notice.action" type="button" class="toast-action" @click="notice.action.run(); notifications.dismiss(notice.id)">{{ notice.action.label }}</button>
      <button type="button" class="toast-close" aria-label="关闭提示" @click="notifications.dismiss(notice.id)"><X :size="14" /></button>
    </div>
  </div>
</template>
