import type { ApiError } from './contracts'

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly field?: string, public readonly retryable = false) {
    super(message)
    this.name = 'AppError'
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof AppError) return { code: error.code, message: error.message, field: error.field, retryable: error.retryable }
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code.includes('BUSY') || code.includes('LOCKED')) return { code: 'STORAGE_BUSY', message: '数据暂时正被占用，请稍后重试。', retryable: true }
  return { code: 'STORAGE_WRITE_FAILED', message: '操作未能完成，请重试。原有任务和输入会保留。', retryable: true }
}
