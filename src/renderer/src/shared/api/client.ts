import type { ApiError, ApiResult } from '@shared/contracts'

export class RequestError extends Error {
  readonly code: string
  readonly field?: string
  readonly retryable: boolean
  constructor(error: ApiError) {
    super(error.message)
    this.name = 'RequestError'
    this.code = error.code
    this.field = error.field
    this.retryable = error.retryable
  }
}

export async function readResult<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new RequestError(result.error)
  return result.data
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未能完成，请稍后重试。'
}
