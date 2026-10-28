<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Copy, Minus, PictureInPicture2, Square, X } from '@lucide/vue'
import type { MiniWindowState, WindowState } from '@shared/contracts'
import appIcon from '../assets/app-icon.svg'

const emit = defineEmits<{ error: [message: string] }>()
const state = ref<WindowState>({ isMaximized: false, platform: '' })
const miniState = ref<MiniWindowState>({ isOpen: false, isPinned: true })
let unsubscribe: (() => void) | undefined
let unsubscribeMini: (() => void) | undefined
async function windowAction(action: () => Promise<unknown>): Promise<void> {
  try { await action() }
  catch { emit('error', '窗口操作未能完成，请重试。') }
}
const minimize = (): Promise<void> => windowAction(() => window.todoApi.window.minimize())
const maximize = (): Promise<void> => windowAction(() => window.todoApi.window.toggleMaximize())
const close = (): Promise<void> => windowAction(() => window.todoApi.window.requestClose())
const openMini = (): Promise<void> => windowAction(async () => { miniState.value = await window.todoApi.mini.open() })
onMounted(async () => {
  if (!window.todoApi) return
  try { state.value = await window.todoApi.window.getState() } catch { /* Loading state reports a disconnected bridge. */ }
  unsubscribe = window.todoApi.window.onStateChanged((value) => { state.value = value })
  unsubscribeMini = window.todoApi.mini.onStateChanged((value) => { miniState.value = value })
  try { miniState.value = await window.todoApi.mini.getState() } catch { /* The entry remains available for retry. */ }
})
onBeforeUnmount(() => { unsubscribe?.(); unsubscribeMini?.() })
</script>

<template>
  <header class="titlebar" :class="{ maximized: state.isMaximized }">
    <div class="titlebar-brand"><img :src="appIcon" alt="" width="21" height="21"><span>To-Do List</span></div>
    <span class="titlebar-caption">个人任务工作台</span>
    <div class="window-actions">
      <button type="button" class="mini-mode-button" :class="{ active: miniState.isOpen }" aria-label="打开小窗模式" title="打开专注清单小窗" @click="openMini"><PictureInPicture2 :size="16" /><span>小窗模式</span></button>
      <button type="button" aria-label="最小化窗口" title="最小化" @click="minimize"><Minus :size="15" /></button>
      <button type="button" :aria-label="state.isMaximized ? '还原窗口' : '最大化窗口'" :title="state.isMaximized ? '还原' : '最大化'" @click="maximize"><Copy v-if="state.isMaximized" :size="13" /><Square v-else :size="13" /></button>
      <button type="button" class="window-close" aria-label="关闭窗口" title="关闭工作台，应用继续在托盘运行" @click="close"><X :size="17" /></button>
    </div>
  </header>
</template>
