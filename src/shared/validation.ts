import type { Preferences, TaskInput } from './contracts'
import { AppError } from './errors'

export function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AppError('VALIDATION_ERROR', '操作参数格式不正确。')
}
function invalidControls(value: string, allowWhitespace = false): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0
    return point < 32 && !(allowWhitespace && (point === 9 || point === 10))
  })
}
export function validateTaskInput(value: unknown): TaskInput {
  assertRecord(value)
  if (typeof value.title !== 'string') throw new AppError('VALIDATION_ERROR', '请输入任务标题。', 'title')
  const title = value.title.trim()
  if (!title || Array.from(title).length > 120 || invalidControls(title)) throw new AppError('VALIDATION_ERROR', '标题需为 1 至 120 个字符，且不能包含换行或控制字符。', 'title')
  if (typeof value.description !== 'string') throw new AppError('VALIDATION_ERROR', '任务描述格式不正确。', 'description')
  const description = value.description.replace(/\r\n?/g, '\n')
  if (Array.from(description).length > 2000 || invalidControls(description, true)) throw new AppError('VALIDATION_ERROR', '描述最多 2,000 个字符，且不能包含无效控制字符。', 'description')
  if (value.priority !== 0 && value.priority !== 1 && value.priority !== 2) throw new AppError('VALIDATION_ERROR', '请选择有效的优先级。', 'priority')
  return { title, description, priority: value.priority }
}
export function validatePreferences(value: unknown): Partial<Preferences> {
  assertRecord(value)
  const allowed = { filter: ['all', 'active', 'completed'], sort: ['newest', 'oldest', 'priority', 'manual'], density: ['comfortable', 'standard', 'compact'] }
  const result: Record<string, string | boolean> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'sidebarCollapsed' && typeof entry === 'boolean') { result[key] = entry; continue }
    if (!Object.hasOwn(allowed, key) || typeof entry !== 'string' || !allowed[key as keyof typeof allowed].includes(entry)) throw new AppError('VALIDATION_ERROR', '偏好设置不符合要求。')
    result[key] = entry
  }
  return result as Partial<Preferences>
}
