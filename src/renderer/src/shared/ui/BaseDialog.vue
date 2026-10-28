<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue'
import { X } from '@lucide/vue'

const props = defineProps<{ open: boolean; title: string; wide?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const headingId = `dialog-${useId()}`
async function sync(): Promise<void> {
  await nextTick()
  if (!dialog.value) return
  if (props.open && !dialog.value.open) dialog.value.showModal()
  else if (!props.open && dialog.value.open) dialog.value.close()
}
watch(() => props.open, sync)
onMounted(sync)
</script>

<template>
  <dialog ref="dialog" class="app-dialog" :class="{ wide }" :aria-labelledby="headingId" @cancel.prevent="!busy && emit('close')">
    <div class="dialog-heading"><h2 :id="headingId">{{ title }}</h2><button class="icon-button" aria-label="关闭对话框" :disabled="busy" @click="emit('close')"><X :size="18" /></button></div>
    <slot />
  </dialog>
</template>
