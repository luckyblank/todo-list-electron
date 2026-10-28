import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult, BackupInfo, MiniWindowState, Preferences, TaskSnapshot, TodoApi, WindowState } from '../shared/contracts'
import { channels } from '../shared/channels'

const invoke = <T>(channel: string, input?: unknown): Promise<T> => ipcRenderer.invoke(channel, input) as Promise<T>
const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const api: TodoApi = {
  tasks: {
    list: () => invoke<ApiResult<TaskSnapshot>>(channels.list),
    create: (input) => invoke<ApiResult<TaskSnapshot>>(channels.create, input),
    update: (input) => invoke<ApiResult<TaskSnapshot>>(channels.update, input),
    setCompleted: (input) => invoke<ApiResult<TaskSnapshot>>(channels.complete, input),
    remove: (input) => invoke<ApiResult<TaskSnapshot>>(channels.remove, input),
    restore: (input) => invoke<ApiResult<TaskSnapshot>>(channels.restore, input),
    reorder: (input) => invoke<ApiResult<TaskSnapshot>>(channels.reorder, input),
    onChanged: (callback) => subscribe<TaskSnapshot>(channels.tasksChanged, callback)
  },
  settings: { update: (input) => invoke<ApiResult<Preferences>>(channels.preferences, input) },
  backups: {
    list: () => invoke<ApiResult<BackupInfo[]>>(channels.backupsList),
    create: () => invoke<ApiResult<BackupInfo>>(channels.backupsCreate),
    restore: (id) => invoke<ApiResult<TaskSnapshot>>(channels.backupsRestore, id)
  },
  mini: {
    open: () => invoke<MiniWindowState>(channels.miniOpen),
    close: () => invoke<void>(channels.miniClose),
    showMain: () => invoke<void>(channels.miniShowMain),
    getState: () => invoke<MiniWindowState>(channels.miniState),
    setPinned: (pinned) => invoke<MiniWindowState>(channels.miniPin, pinned),
    onStateChanged: (callback) => subscribe<MiniWindowState>(channels.miniChanged, callback)
  },
  window: {
    getState: () => invoke<WindowState>(channels.windowState),
    minimize: () => invoke<void>(channels.minimize),
    toggleMaximize: () => invoke<WindowState>(channels.maximize),
    requestClose: () => invoke<void>(channels.requestClose),
    confirmClose: () => invoke<void>(channels.confirmClose),
    cancelClose: () => invoke<void>(channels.cancelClose),
    onStateChanged: (callback) => subscribe<WindowState>(channels.stateChanged, callback),
    onCloseRequested: (callback) => subscribe<void>(channels.closeRequested, callback),
    onNewTaskRequested: (callback) => subscribe<void>(channels.newTaskRequested, callback)
  }
}
contextBridge.exposeInMainWorld('todoApi', api)
