<script setup lang="ts">
import { Circle, CircleCheck, Database, Grid2X2, PanelLeftClose, PanelLeftOpen, Settings2, ShieldCheck } from '@lucide/vue'
import type { TaskFilter } from '@shared/contracts'
import appIcon from '../assets/app-icon.svg'

defineProps<{ filter: TaskFilter; total: number; active: number; collapsed: boolean; autoCollapsed: boolean; busy: boolean }>()
const emit = defineEmits<{ filter: [value: TaskFilter]; toggle: []; backups: []; preferences: [] }>()
const navigation = [
  { value: 'all' as const, label: '全部任务', icon: Grid2X2 },
  { value: 'active' as const, label: '未完成', icon: Circle },
  { value: 'completed' as const, label: '已完成', icon: CircleCheck }
]
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }" aria-label="任务导航">
    <div class="workspace-heading"><img :src="appIcon" alt="" width="32" height="32"><div class="sidebar-copy"><strong>我的工作台</strong><small>个人任务空间</small></div></div>
    <p class="nav-section sidebar-copy">任务</p>
    <nav class="navigation">
      <button v-for="item in navigation" :key="item.value" class="nav-item" :class="{ selected: filter === item.value }" :aria-current="filter === item.value ? 'page' : undefined"
        :aria-label="item.label" :title="collapsed ? item.label : undefined" @click="emit('filter', item.value)">
        <component :is="item.icon" :size="19" /><span class="sidebar-copy nav-text">{{ item.label }}</span>
        <span class="sidebar-copy nav-count">{{ item.value === 'all' ? total : item.value === 'active' ? active : total - active }}</span>
      </button>
    </nav>
    <div class="sidebar-spacer"></div>
    <button id="sidebar-toggle" class="sidebar-toggle" :aria-label="collapsed ? '展开侧栏' : '收起侧栏'" :aria-expanded="!collapsed" :disabled="autoCollapsed"
      :title="autoCollapsed ? '放大窗口后可以展开侧栏' : collapsed ? '展开侧栏' : '收起侧栏'" @click="emit('toggle')">
      <PanelLeftOpen v-if="collapsed" :size="18" /><PanelLeftClose v-else :size="18" /><span class="sidebar-copy">收起侧栏</span>
    </button>
    <div class="sidebar-footer">
      <button class="sidebar-tool" aria-label="数据备份与恢复" :title="collapsed ? '数据备份与恢复' : undefined" @click="emit('backups')"><Database :size="17" /><span class="sidebar-copy">数据备份</span></button>
      <button class="sidebar-tool" aria-label="显示设置" :title="collapsed ? '显示设置' : undefined" @click="emit('preferences')"><Settings2 :size="17" /><span class="sidebar-copy">显示设置</span></button>
      <div class="storage-caption" :title="busy ? '正在保存任务' : '任务保存在本机'"><ShieldCheck :size="13" /><span class="sidebar-copy">{{ busy ? '正在保存…' : '数据保存在本机' }}</span></div>
    </div>
  </aside>
</template>
