import { describe, expect, it } from 'vitest'
import type { Task } from '../../src/shared/contracts'
import { normalizeQuery, selectTasks } from '../../src/renderer/src/features/tasks/selectors'

const tasks: Task[] = [
  { id: 'a', title: '整理方案', description: '审查 Vue 组件', priority: 1, completed: false, sortOrder: 2, revision: 1, createdAt: 10, updatedAt: 10, completedAt: null },
  { id: 'b', title: '发布准备', description: '更新说明', priority: 2, completed: true, sortOrder: 0, revision: 1, createdAt: 20, updatedAt: 20, completedAt: 20 },
  { id: 'c', title: '开发 ＶＵＥ 界面', description: '', priority: 2, completed: false, sortOrder: 1, revision: 1, createdAt: 20, updatedAt: 20, completedAt: null }
]
describe('task views', () => {
  it('combines status and normalized title or description search without changing source tasks', () => {
    expect(normalizeQuery(' ＶＵＥ ')).toBe('vue')
    expect(selectTasks(tasks, 'active', 'vue', 'newest').map((task) => task.id)).toEqual(['c', 'a'])
    expect(selectTasks(tasks, 'completed', 'vue', 'newest')).toEqual([])
    expect(tasks.map((task) => task.id)).toEqual(['a', 'b', 'c'])
  })
  it('uses stable ties and keeps persisted manual order independent from automatic sorts', () => {
    expect(selectTasks(tasks, 'all', '', 'priority').map((task) => task.id)).toEqual(['b', 'c', 'a'])
    expect(selectTasks(tasks, 'all', '', 'oldest').map((task) => task.id)).toEqual(['a', 'b', 'c'])
    expect(selectTasks(tasks, 'all', '', 'manual').map((task) => task.id)).toEqual(['b', 'c', 'a'])
  })
})
