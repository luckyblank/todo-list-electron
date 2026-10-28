<script setup lang="ts">
import { ref, watch } from 'vue'
import { Archive, Download, LoaderCircle, RotateCcw } from '@lucide/vue'
import type { BackupInfo } from '@shared/contracts'
import { errorMessage, readResult } from '../../shared/api/client'
import BaseDialog from '../../shared/ui/BaseDialog.vue'
import { useNotificationStore } from '../../shared/ui/notificationStore'
import { useTaskStore } from './taskStore'
import { formatDate } from './selectors'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; restored: []; busy: [value: boolean] }>()
const store = useTaskStore()
const notifications = useNotificationStore()
const backups = ref<BackupInfo[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const confirmation = ref<BackupInfo | null>(null)
const kindLabels = { daily: '自动备份', manual: '手动备份', protection: '保护备份' }
watch(busy, (value) => emit('busy', value))
async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try { backups.value = await readResult(window.todoApi.backups.list()) }
  catch (failure) { error.value = errorMessage(failure) }
  finally { loading.value = false }
}
watch(() => props.open, (value) => { if (value) { confirmation.value = null; void load() } })
async function createBackup(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await readResult(window.todoApi.backups.create())
    await load()
    notifications.push('备份已创建', '可从备份列表恢复到此时的任务。')
  } catch (failure) { error.value = errorMessage(failure) }
  finally { busy.value = false }
}
async function restore(): Promise<void> {
  if (!confirmation.value) return
  busy.value = true
  error.value = ''
  try {
    const snapshot = await readResult(window.todoApi.backups.restore(confirmation.value.id))
    store.applySnapshot(snapshot, true)
    notifications.push('任务数据已恢复', '已重新读取所选备份中的任务。')
    emit('restored')
    emit('close')
  } catch (failure) { error.value = errorMessage(failure) }
  finally { busy.value = false }
}
function sizeLabel(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
</script>

<template>
  <BaseDialog :open="open" title="数据备份与恢复" wide :busy="busy" @close="emit('close')">
    <p class="dialog-description">备份保存在本机。恢复前会保护当前数据，再替换为所选备份中的任务。</p>
    <div v-if="confirmation" class="restore-confirmation"><Archive :size="21" /><h3>恢复到 {{ formatDate(confirmation.createdAt, true) }}？</h3><p>当前任务将被替换。恢复成功后，搜索与未保存的编辑会清空。</p><div class="dialog-actions"><button type="button" class="button-secondary" :disabled="busy" @click="confirmation = null">取消</button><button type="button" class="button-primary" :disabled="busy" @click="restore"><LoaderCircle v-if="busy" :size="15" class="spin" />{{ busy ? '恢复中…' : '确认恢复' }}</button></div></div>
    <template v-else>
      <div class="backup-toolbar"><span>{{ backups.length }} 份可用备份</span><button type="button" class="button-primary" :disabled="busy || loading || !store.loaded" @click="createBackup"><Download :size="15" />{{ busy ? '备份中…' : '创建备份' }}</button></div>
      <div v-if="loading" class="backup-loading"><LoaderCircle :size="18" class="spin" />正在读取备份…</div>
      <div v-else-if="!backups.length" class="backup-empty"><Archive :size="27" /><p>暂时没有可用备份</p><span>创建一份备份，为任务多留一份保障。</span></div>
      <ul v-else class="backup-list"><li v-for="backup in backups" :key="backup.id"><div class="backup-symbol"><Archive :size="19" /></div><div class="backup-copy"><strong>{{ formatDate(backup.createdAt, true) }}</strong><span>{{ kindLabels[backup.kind] }}<span class="meta-dot">·</span>{{ sizeLabel(backup.size) }}</span></div><button type="button" class="button-secondary" :disabled="busy" @click="confirmation = backup"><RotateCcw :size="14" />恢复</button></li></ul>
    </template>
    <div v-if="error" class="dialog-error" role="alert">{{ error }}<button v-if="!confirmation" type="button" @click="load">重新读取</button></div>
    <div class="dialog-footnote">日常备份保留最近 7 份；升级与恢复前另保存保护备份。</div>
  </BaseDialog>
</template>
