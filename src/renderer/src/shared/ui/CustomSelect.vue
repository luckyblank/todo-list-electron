<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

export interface SelectOption { value: string | number; label: string; description?: string; disabled?: boolean }
const props = withDefaults(defineProps<{
  modelValue: string | number
  options: SelectOption[]
  label: string
  disabled?: boolean
  compact?: boolean
}>(), { disabled: false, compact: false })
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
const uid = useId()
const trigger = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const portalTarget = ref<HTMLElement | string>('body')
const highlighted = ref(0)
const position = ref({ top: '0px', left: '0px', width: '180px', maxHeight: '280px' })
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
const listId = `listbox-${uid}`

function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function place(): void {
  if (!trigger.value) return
  const box = trigger.value.getBoundingClientRect()
  const height = Math.min(props.options.length * 53 + 12, 286)
  const below = window.innerHeight - box.bottom - 12
  const above = box.top - 12
  const useAbove = below < height && above > below
  const available = Math.max(100, useAbove ? above : below)
  const width = Math.max(box.width, props.compact ? 210 : box.width)
  position.value = {
    top: `${useAbove ? Math.max(8, box.top - Math.min(height, available) - 6) : box.bottom + 6}px`,
    left: `${Math.max(8, Math.min(box.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`, maxHeight: `${Math.min(286, available)}px`
  }
}
async function show(): Promise<void> {
  if (props.disabled) return
  portalTarget.value = trigger.value?.closest('dialog') || 'body'
  highlighted.value = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue))
  place()
  open.value = true
  await nextTick()
  ensureVisible()
}
function choose(index: number): void {
  const option = props.options[index]
  if (!option || option.disabled) return
  emit('update:modelValue', option.value)
  close(true)
}
function ensureVisible(): void {
  const option = list.value?.querySelector<HTMLElement>(`[data-option-index="${highlighted.value}"]`)
  if (!option || !list.value) return
  if (option.offsetTop < list.value.scrollTop) list.value.scrollTop = option.offsetTop
  if (option.offsetTop + option.offsetHeight > list.value.scrollTop + list.value.clientHeight) {
    list.value.scrollTop = option.offsetTop + option.offsetHeight - list.value.clientHeight
  }
}
function move(direction: number): void {
  for (let offset = 1; offset <= props.options.length; offset++) {
    const index = (highlighted.value + direction * offset + props.options.length) % props.options.length
    if (!props.options[index]?.disabled) { highlighted.value = index; ensureVisible(); break }
  }
}
function onKeydown(event: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) event.preventDefault()
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
  if (event.key === 'Tab') { close(); return }
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) void show()
    return
  }
  if (event.key === 'ArrowDown') move(1)
  if (event.key === 'ArrowUp') move(-1)
  if (event.key === 'Home') { highlighted.value = 0; ensureVisible() }
  if (event.key === 'End') { highlighted.value = props.options.length - 1; ensureVisible() }
  if (event.key === 'Enter' || event.key === ' ') choose(highlighted.value)
}
function outside(event: PointerEvent): void {
  if (!trigger.value?.contains(event.target as Node) && !list.value?.contains(event.target as Node)) close()
}
function scrollOutside(event: Event): void {
  if (!list.value?.contains(event.target as Node)) close()
}
watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', place)
    document.addEventListener('scroll', scrollOutside, true)
  } else cleanup()
})
function cleanup(): void {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('resize', place)
  document.removeEventListener('scroll', scrollOutside, true)
}
onBeforeUnmount(cleanup)
</script>

<template>
  <button ref="trigger" type="button" class="custom-select" :class="{ compact, expanded: open }"
    role="combobox" aria-haspopup="listbox" :aria-label="label" :aria-expanded="open"
    :aria-controls="listId" :aria-activedescendant="open ? `${listId}-${highlighted}` : undefined"
    :disabled="disabled" @click="open ? close() : show()" @keydown="onKeydown">
    <span class="select-prefix"><slot :selected="selected" /></span><span class="select-value">{{ selected?.label || '请选择' }}</span><ChevronDown :size="14" class="select-chevron" />
  </button>
  <Teleport :to="portalTarget">
    <div v-if="open" :id="listId" ref="list" class="select-listbox" :style="position" role="listbox" :aria-label="label">
      <div v-for="(option, index) in options" :id="`${listId}-${index}`" :key="option.value" role="option"
        :data-option-index="index" :aria-selected="option.value === modelValue" :aria-disabled="option.disabled || undefined"
        class="select-option" :class="{ highlighted: highlighted === index, chosen: option.value === modelValue, disabled: option.disabled }"
        @pointermove="highlighted = index" @pointerdown.prevent @click="choose(index)">
        <span v-if="$slots['option-prefix']" class="select-option-prefix"><slot name="option-prefix" :option="option" /></span>
        <span class="select-option-copy"><span>{{ option.label }}</span><small v-if="option.description">{{ option.description }}</small></span>
        <Check v-if="option.value === modelValue" :size="16" />
      </div>
    </div>
  </Teleport>
</template>
