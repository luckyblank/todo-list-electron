import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ApiResult, CreateTaskInput, RemoveTaskInput, ReorderTaskInput, RestoreTaskInput, SetCompletedInput, UpdateTaskInput, WindowState } from '../shared/contracts'
import { channels } from '../shared/channels'
import { AppError, toApiError } from '../shared/errors'
import { assertPayloadSize, assertTrustedSender, isTrustedLocation } from './ipc/security'
import { loadWindowBounds, saveWindowBounds } from './window/bounds'
import { StorageManager } from './recovery/StorageManager'
import { MiniWindowController } from './window/MiniWindow'
import { TrayController } from './window/TrayController'

app.setName('To-Do List')
app.setAppUserModelId('com.todo-list.desktop')
const development = !app.isPackaged
const dataRoot = process.env.TODO_DATA_DIR || (development ? join(app.getAppPath(), '.dev-data') : app.getPath('userData'))
mkdirSync(dataRoot, { recursive: true })
app.setPath('userData', dataRoot)

let mainWindow: BrowserWindow | null = null
let miniWindow: MiniWindowController | undefined
let tray: TrayController | undefined
const trustedWindows = new Map<number, { window: BrowserWindow; url: string }>()
let storage: StorageManager
let operationQueue: Promise<unknown> = Promise.resolve()
let allowClose = false
let closing = false
let closePending = false
let rendererResponsive = true
let rendererAvailable = false
let maintenance = false
let fallbackOpen = false
let quitRequested = false
let geometryTimer: ReturnType<typeof setTimeout> | undefined
let backupTimer: ReturnType<typeof setInterval> | undefined
const geometryPath = join(dataRoot, 'window-state.json')
const applicationRoot = fileURLToPath(new URL('../../', import.meta.url))

function diagnostic(operation: string, error: unknown): void {
  try {
    const path = join(dataRoot, 'application.log')
    try { if (statSync(path).size > 2_000_000) renameSync(path, join(dataRoot, 'application.previous.log')) } catch { /* No log to rotate. */ }
    const code = error instanceof AppError ? error.code : typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'INTERNAL_ERROR'
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), operation, code })}\n`, 'utf8')
  } catch { /* Logging must not turn a recoverable operation into another failure. */ }
}

function enqueue<T>(action: () => T | Promise<T>): Promise<T> {
  const result = operationQueue.then(action, action)
  operationQueue = result.catch(() => undefined)
  return result
}

function windowState(window: BrowserWindow): WindowState {
  return { isMaximized: window.isMaximized(), platform: process.platform }
}

function persistGeometry(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  saveWindowBounds(geometryPath, { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() })
}

async function closeWithoutRenderer(window: BrowserWindow): Promise<void> {
  if (!quitRequested) {
    persistGeometry()
    window.hide()
    closePending = false
    return
  }
  if (fallbackOpen || closing) return
  fallbackOpen = true
  try {
  const answer = await dialog.showMessageBox(window, {
    type: 'warning', title: '关闭 To-Do List', message: '界面暂时没有响应。',
    detail: '已经提交的任务会保留。关闭将放弃尚未提交的表单内容。', buttons: ['继续等待', '关闭应用'], defaultId: 0, cancelId: 0
  })
  if (answer.response === 1) await finishClose(window)
  else { closePending = false; quitRequested = false }
  } finally { fallbackOpen = false }
}

async function finishClose(window: BrowserWindow): Promise<void> {
  if (!quitRequested) {
    await operationQueue
    if (quitRequested) { await finishQuit(); return }
    persistGeometry()
    window.hide()
    closePending = false
    return
  }
  await finishQuit()
}

async function finishQuit(): Promise<void> {
  if (closing) return
  closing = true
  clearInterval(backupTimer)
  await operationQueue
  await storage.shutdown()
  persistGeometry()
  allowClose = true
  tray?.dispose()
  miniWindow?.destroy()
  setImmediate(() => app.quit())
}

function showWorkspace(): void {
  if (!mainWindow || mainWindow.isDestroyed() || closing) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  if (!rendererAvailable && !mainWindow.webContents.isLoadingMainFrame()) void mainWindow.webContents.reload()
}

function requestQuit(): void {
  if (closing) return
  quitRequested = true
  if (mainWindow && !mainWindow.isDestroyed()) { showWorkspace(); mainWindow.close() }
  else void finishQuit()
}

function registerIpc(window: BrowserWindow): void {
  const guard = (event: IpcMainInvokeEvent, input?: unknown): void => {
    const target = trustedWindows.get(event.sender.id)
    if (!target) throw new AppError('FORBIDDEN', '不允许的通信来源。')
    assertTrustedSender(event, target.window, target.url)
    assertPayloadSize(input)
  }
  const taskWrites = new Set<string>([channels.create, channels.update, channels.complete, channels.remove, channels.restore, channels.reorder, channels.backupsRestore])
  const business = <T>(channel: string, action: (input: unknown) => T | Promise<T>): void => {
    ipcMain.handle(channel, async (event, input: unknown): Promise<ApiResult<T>> => {
      let locked = false
      try {
        guard(event, input)
        if (maintenance) throw new AppError('STORAGE_BUSY', '正在恢复数据，请稍候再操作。', undefined, true)
        if (closing || allowClose) throw new AppError('STORAGE_BUSY', '应用正在关闭。', undefined, false)
        if (channel === channels.backupsRestore) { maintenance = true; locked = true }
        return { ok: true, data: await enqueue(async () => {
          const result = await action(input)
          if (taskWrites.has(channel) || channel === channels.preferences) {
            const snapshot = storage.snapshot()
            broadcast(channels.tasksChanged, snapshot)
            if (taskWrites.has(channel)) return snapshot as T
          }
          return result
        }) }
      } catch (error) {
        diagnostic(channel, error)
        return { ok: false, error: toApiError(error) }
      } finally { if (locked) maintenance = false }
    })
  }
  business(channels.list, async () => { await storage.initialize(); return storage.snapshot() })
  business(channels.create, (input) => storage.getRepository().create(input as CreateTaskInput))
  business(channels.update, (input) => storage.getRepository().update(input as UpdateTaskInput))
  business(channels.complete, (input) => storage.getRepository().setCompleted(input as SetCompletedInput))
  business(channels.remove, (input) => storage.getRepository().remove(input as RemoveTaskInput))
  business(channels.restore, (input) => storage.getRepository().restore(input as RestoreTaskInput))
  business(channels.reorder, (input) => storage.getRepository().reorder(input as ReorderTaskInput))
  business(channels.preferences, (input) => storage.getRepository().updatePreferences(input as Parameters<ReturnType<StorageManager['getRepository']>['updatePreferences']>[0]))
  business(channels.backupsList, () => storage.listBackups())
  business(channels.backupsCreate, () => storage.createBackup('manual'))
  business(channels.backupsRestore, async (input) => {
    if (typeof input !== 'string' || input.length > 200) throw new AppError('VALIDATION_ERROR', '请选择有效的备份。')
    return storage.restoreBackup(input)
  })
  const control = <T>(channel: string, action: (input: unknown) => T | Promise<T>, allowMini = false): void => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      guard(event, input)
      if (closing && channel !== channels.confirmClose && channel !== channels.cancelClose) throw new AppError('STORAGE_BUSY', '应用正在关闭。')
      if (!allowMini && event.sender !== window.webContents) throw new AppError('FORBIDDEN', '此窗口不支持该操作。')
      return action(input)
    })
  }
  control(channels.windowState, () => windowState(window))
  control(channels.minimize, () => window.minimize())
  control(channels.maximize, () => { if (window.isMaximized()) window.unmaximize(); else window.maximize(); return windowState(window) })
  control(channels.requestClose, () => window.close())
  control(channels.confirmClose, () => finishClose(window))
  control(channels.cancelClose, () => { closePending = false; quitRequested = false })
  control(channels.miniOpen, () => miniWindow!.open(), true)
  control(channels.miniClose, () => { setImmediate(() => miniWindow?.close()) }, true)
  control(channels.miniShowMain, showWorkspace, true)
  control(channels.miniState, () => miniWindow!.state(), true)
  control(channels.miniPin, (input) => {
    if (typeof input !== 'boolean') throw new AppError('VALIDATION_ERROR', '置顶状态不正确。')
    return miniWindow!.setPinned(input)
  }, true)
}

function broadcast(channel: string, value: unknown): void {
  for (const { window } of trustedWindows.values()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, value)
  }
}
function trustWindow(window: BrowserWindow, url: string): void {
  const id = window.webContents.id
  trustedWindows.set(id, { window, url })
  window.on('closed', () => trustedWindows.delete(id))
}

async function createWindow(): Promise<void> {
  const primary = screen.getPrimaryDisplay()
  const areas = [primary.workArea, ...screen.getAllDisplays().filter((entry) => entry.id !== primary.id).map((entry) => entry.workArea)]
  const bounds = loadWindowBounds(geometryPath, areas)
  const window = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    minWidth: Math.min(900, primary.workArea.width - 48), minHeight: Math.min(600, primary.workArea.height - 48),
    frame: false, titleBarStyle: 'hidden', titleBarOverlay: false,
    title: 'To-Do List', icon: join(applicationRoot, 'resources/app-icon.png'),
    backgroundColor: '#F5F6F2', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: join(applicationRoot, 'out/preload/index.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false
    }
  })
  mainWindow = window
  window.setMenu(null)
  const rendererUrl = development && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(join(applicationRoot, 'out/renderer/index.html')).href
  trustWindow(window, rendererUrl)
  miniWindow = new MiniWindowController({
    rendererUrl, preload: join(applicationRoot, 'out/preload/index.cjs'), icon: join(applicationRoot, 'resources/app-icon.png'),
    statePath: join(dataRoot, 'mini-window-state.json'), mainBounds: () => mainWindow?.getBounds(), trust: trustWindow,
    changed: (state) => { broadcast(channels.miniChanged, state); tray?.refresh() }
  })
  registerIpc(window)
  const connect = development ? `'self' ${new URL(rendererUrl).origin.replace(/^http/, 'ws')}` : "'none'"
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src ${connect}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }))
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!isTrustedLocation(url, rendererUrl)) event.preventDefault() })
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.on('did-finish-load', () => { rendererAvailable = true })
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererAvailable = false
    diagnostic('renderer-gone', { code: details.reason })
    if (closePending) void closeWithoutRenderer(window)
  })
  window.on('unresponsive', () => { rendererResponsive = false; if (closePending) void closeWithoutRenderer(window) })
  window.on('responsive', () => { rendererResponsive = true })
  window.on('ready-to-show', () => { if (bounds.maximized) window.maximize(); window.show() })
  const publishWindowState = (): void => { window.webContents.send(channels.stateChanged, windowState(window)) }
  window.on('maximize', publishWindowState)
  window.on('unmaximize', publishWindowState)
  const scheduleGeometrySave = (): void => {
    clearTimeout(geometryTimer)
    geometryTimer = setTimeout(persistGeometry, 250)
  }
  window.on('resize', scheduleGeometrySave)
  window.on('move', scheduleGeometrySave)
  window.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    if (!quitRequested) {
      persistGeometry()
      window.hide()
      return
    }
    if (closePending) {
      if (!rendererAvailable || !rendererResponsive) void closeWithoutRenderer(window)
      return
    }
    closePending = true
    if (!rendererAvailable || !rendererResponsive || window.webContents.isDestroyed()) void closeWithoutRenderer(window)
    else window.webContents.send(channels.closeRequested)
  })
  window.on('closed', () => { clearTimeout(geometryTimer); mainWindow = null })
  await window.loadURL(rendererUrl)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', showWorkspace)
  app.whenReady().then(async () => {
    storage = new StorageManager(dataRoot, { seedInitialTasks: app.isPackaged })
    await storage.initialize()
    await createWindow()
    tray = new TrayController({
      icon: join(applicationRoot, 'resources/app-icon.png'), openWorkspace: showWorkspace,
      openMini: () => { void miniWindow?.open().catch((error: unknown) => diagnostic('mini-open', error)) },
      closeMini: () => miniWindow?.close(), getMiniState: () => miniWindow?.state() ?? { isOpen: false, isPinned: true },
      setMiniPinned: (pinned) => { miniWindow?.setPinned(pinned) },
      newTask: () => {
        showWorkspace()
        if (!closePending && !closing) mainWindow?.webContents.send(channels.newTaskRequested)
      },
      backup: () => enqueue(async () => {
        if (closing || maintenance) throw new AppError('STORAGE_BUSY', '当前正在处理其他操作，请稍后重试。')
        await storage.createBackup('manual')
        broadcast(channels.tasksChanged, storage.snapshot())
      }),
      quit: requestQuit, report: diagnostic
    })
    showWorkspace()
    backupTimer = setInterval(() => {
      void enqueue(async () => {
        try {
          storage.getRepository().purgeExpired()
        } catch (error) { diagnostic('idle-maintenance', error) }
      })
    }, 60_000)
    backupTimer.unref()
  }).catch((error: unknown) => {
    diagnostic('startup', error)
    dialog.showErrorBox('To-Do List 启动失败', '应用未能启动。任务数据不会被清空，请查看数据目录中的诊断日志后重试。')
    app.exit(1)
  })
  app.on('before-quit', (event) => {
    if (!allowClose) { event.preventDefault(); requestQuit() }
  })
  app.on('window-all-closed', () => { /* Closing either independent window keeps the tray and task storage available. */ })
  app.on('will-quit', () => { clearInterval(backupTimer); tray?.dispose(); storage?.close() })
}
