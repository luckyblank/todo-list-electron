import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../shared/errors'

export function isTrustedLocation(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual)
    const b = new URL(expected)
    return a.protocol === b.protocol && a.origin === b.origin && a.hostname === b.hostname && a.port === b.port && a.pathname === b.pathname && a.search === b.search
  } catch { return false }
}
export function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow, expectedUrl: string): void {
  if (event.sender !== window.webContents || !event.senderFrame || event.senderFrame !== window.webContents.mainFrame || !isTrustedLocation(event.senderFrame.url, expectedUrl)) {
    throw new AppError('FORBIDDEN', '不允许的通信来源。')
  }
}
export function assertPayloadSize(value: unknown): void {
  if (value === undefined) return
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 2_000_000) throw new AppError('VALIDATION_ERROR', '操作数据过大。')
}
