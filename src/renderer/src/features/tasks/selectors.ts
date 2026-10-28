import type { SortMode, Task, TaskFilter } from '@shared/contracts'

export function normalizeQuery(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

export function selectTasks(tasks: Task[], filter: TaskFilter, query: string, sort: SortMode): Task[] {
  const term = normalizeQuery(query)
  return tasks.filter((task) => (filter === 'all' || task.completed === (filter === 'completed'))
    && (!term || normalizeQuery(`${task.title}\n${task.description}`).includes(term)))
    .sort((a, b) => {
      const dateOrder = b.createdAt - a.createdAt
      const order = sort === 'oldest' ? -dateOrder : sort === 'priority'
        ? b.priority - a.priority || dateOrder : sort === 'manual' ? a.sortOrder - b.sortOrder : dateOrder
      return order || a.id.localeCompare(b.id)
    })
}

export function formatDate(value: number, full = false): string {
  return new Intl.DateTimeFormat('zh-CN', full
    ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { month: '2-digit', day: '2-digit' }).format(new Date(value))
}
