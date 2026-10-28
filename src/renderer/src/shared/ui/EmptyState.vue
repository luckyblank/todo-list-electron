<script setup lang="ts">
import { CircleCheck, Database, LoaderCircle, Search } from '@lucide/vue'
defineProps<{ title: string; description: string; action?: string; kind?: 'empty' | 'search' | 'loading' | 'error' }>()
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state" role="status">
    <div class="empty-icon"><LoaderCircle v-if="kind === 'loading'" :size="27" class="spin" /><Database v-else-if="kind === 'error'" :size="27" /><Search v-else-if="kind === 'search'" :size="27" /><CircleCheck v-else :size="27" /></div>
    <h2>{{ title }}</h2><p>{{ description }}</p><button v-if="action" type="button" class="button-secondary" @click="emit('action')">{{ action }}</button>
  </div>
</template>
