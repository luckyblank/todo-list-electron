import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface Notice {
  id: number
  title: string
  message: string
  tone: 'success' | 'error' | 'info'
  action?: { label: string; run: () => void }
}

export const useNotificationStore = defineStore('notifications', () => {
  const items = ref<Notice[]>([])
  let nextId = 0
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  function dismiss(id: number): void {
    clearTimeout(timers.get(id))
    timers.delete(id)
    items.value = items.value.filter((item) => item.id !== id)
  }
  function push(title: string, message = '', tone: Notice['tone'] = 'success', action?: Notice['action']): void {
    while (items.value.length >= 3) dismiss(items.value[0]!.id)
    const id = ++nextId
    items.value.push({ id, title, message, tone, action })
    if (tone !== 'error') timers.set(id, setTimeout(() => dismiss(id), action ? 7000 : 3500))
  }
  return { items, push, dismiss }
})
