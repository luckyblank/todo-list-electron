import { app, BrowserWindow, Tray } from 'electron'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is an isolated Electron integration process. It never attaches to an
// existing application, sends desktop input, or writes to the user's tasks.
const root = fileURLToPath(new URL('../', import.meta.url))
const dataDir = join(root, '.test-data', `electron-smoke-${randomUUID()}`)
const reportPath = join(root, '.test-data', 'electron-smoke-result.json')
const screenshotDir = join(root, 'docs', 'screenshots')
mkdirSync(dataDir, { recursive: true })
mkdirSync(screenshotDir, { recursive: true })
process.env.TODO_DATA_DIR = dataDir
delete process.env.ELECTRON_RENDERER_URL
app.setPath('userData', dataDir)

const started = Date.now()
const timeBudgetMs = 60_000
const deadline = started + timeBudgetMs
const report = {
  status: 'running', startedAt: new Date(started).toISOString(), dataDir, timeBudgetMs,
  databaseFile: join(dataDir, 'data', 'tasks.sqlite'), reportPath,
  versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
  checks: [], rendererMessages: [], trayCallbacks: [], interceptedNotifications: [], screenshots: [],
  windows: [], normalQuitRequested: false, willQuitObserved: false, quitObserved: false
}
let failed = false
let expectedQuit = false
let activeCheck
let trayMenu
let main
const showCounts = new Map()
let beforeQuitCount = 0

function saveReport() {
  report.updatedAt = new Date().toISOString()
  report.durationMs = Date.now() - started
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}
function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(timeout)
  const failure = error instanceof Error ? error : new Error(String(error))
  if (activeCheck?.status === 'running') {
    activeCheck.status = 'failed'
    activeCheck.error = failure.message
  }
  report.status = 'failed'
  report.error = { message: failure.message, stack: failure.stack }
  saveReport()
  console.error(`[electron-smoke] FAIL: ${failure.message}\nReport: ${reportPath}`)
  app.exit(1)
}
const timeout = setTimeout(() => fail(new Error(`Integration timeout after ${timeBudgetMs / 1000} seconds; current check: ${activeCheck?.name || 'startup'}`)), timeBudgetMs)
process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)

const originalMenu = Tray.prototype.setContextMenu
Tray.prototype.setContextMenu = function (menu) {
  trayMenu = menu
  return originalMenu.call(this, menu)
}
// Exercise the production notification callback without displaying a balloon on
// the user's desktop. Only this short-lived test process is intercepted.
Tray.prototype.displayBalloon = function (options) {
  report.interceptedNotifications.push({ title: options.title, content: options.content })
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  const item = { id: window.id, shows: 0, closed: false }
  report.windows.push(item)
  showCounts.set(window.id, 0)
  window.on('show', () => {
    item.shows++
    showCounts.set(window.id, item.shows)
    if (!window.isDestroyed()) window.hide()
  })
  window.on('closed', () => { item.closed = true })
  window.webContents.on('console-message', (...args) => {
    const detail = typeof args[1] === 'object' ? args[1] : { level: args[1], message: args[2] }
    if (['error', 'warning', 2, 3].includes(detail.level)) {
      report.rendererMessages.push({ windowId: window.id, level: detail.level, message: detail.message })
      if (!expectedQuit && ['error', 3].includes(detail.level)) fail(new Error(`Renderer error: ${detail.message}`))
    }
  })
  window.webContents.on('render-process-gone', (_goneEvent, detail) => {
    if (!expectedQuit) fail(new Error(`Renderer process exited: ${detail.reason}`))
  })
})
app.on('before-quit', () => { beforeQuitCount++ })
app.on('will-quit', () => {
  if (!expectedQuit || failed) return
  report.willQuitObserved = true
  report.beforeQuitCount = beforeQuitCount
  report.status = 'passed'
  if (activeCheck?.status === 'running') {
    activeCheck.status = 'passed'
    activeCheck.durationMs = Date.now() - activeCheck.started
  }
  saveReport()
})
app.on('quit', (_event, exitCode) => {
  if (!expectedQuit || failed) return
  clearTimeout(timeout)
  report.quitObserved = true
  report.exitCode = exitCode
  report.completedAt = new Date().toISOString()
  saveReport()
  console.log(`[electron-smoke] PASS: ${report.checks.length} checks; report: ${reportPath}`)
})

async function waitUntil(probe, message) {
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch (error) { lastError = error }
    await new Promise((resolve) => setTimeout(resolve, 35))
  }
  throw new Error(`${message}${lastError ? ` (${lastError.message})` : ''}`)
}
async function check(name, action) {
  activeCheck = { name, status: 'running', started: Date.now() }
  report.checks.push(activeCheck)
  activeCheck.details = await action()
  activeCheck.status = 'passed'
  activeCheck.durationMs = Date.now() - activeCheck.started
  console.log(`[electron-smoke] PASS: ${name}`)
  saveReport()
}
function execute(window, code) {
  assert(window && !window.isDestroyed(), 'The test window must still exist')
  return window.webContents.executeJavaScript(`(async () => { ${code} })()`, false)
}
function dom(window, callback, ...args) {
  return execute(window, `return (${callback.toString()})(...${JSON.stringify(args)})`)
}
function api(window, method, ...args) {
  return execute(window, `
    const result = await window.todoApi.${method}(...${JSON.stringify(args)});
    if (result && typeof result === 'object' && 'ok' in result) {
      if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
      return result.data;
    }
    return result;
  `)
}
const snapshot = (window = main) => api(window, 'tasks.list')
async function ready(window, mini = false) {
  await waitUntil(() => dom(window, (small) => Boolean(window.todoApi && document.querySelector(small ? '.mini-shell' : '.app-shell')), mini), 'Vue and the preload bridge did not initialize')
  await execute(window, 'await document.fonts.ready; return true')
}
function miniWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed() && new URL(window.webContents.getURL() || 'about:blank').hash === '#mini')
}
function clickTray(label, checked) {
  assert(trayMenu, 'The production tray menu must exist')
  const item = trayMenu.items.find((entry) => entry.label === label)
  assert(item && item.enabled, `Tray action must be enabled: ${label}`)
  // Electron's MenuItem.click wrapper toggles checkbox items before invoking
  // the template callback. Do not pre-toggle it a second time in the harness.
  if (typeof checked === 'boolean') assert.equal(item.checked, !checked, `Tray checkbox must start opposite the requested state: ${label}`)
  report.trayCallbacks.push(label)
  item.click(item, main, { triggeredByAccelerator: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })
  if (typeof checked === 'boolean') assert.equal(item.checked, checked, `Tray checkbox callback must receive the requested state: ${label}`)
}
async function capture(window, name) {
  activeCheck.stage = `capture ${name}`
  saveReport()
  const showsBefore = showCounts.get(window.id)
  // The capturer may paint a logically visible page while its native window
  // stays hidden. Keeping the page hidden would suppress background frames.
  await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: false })
  await execute(window, `
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  `)
  const image = await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: false })
  assert(!image.isEmpty(), `Screenshot ${name} must not be empty`)
  assert.equal(window.isVisible(), false, 'Capture must not show a native test window')
  assert.equal(showCounts.get(window.id), showsBefore, 'Capture must not trigger a native show event')
  const path = join(screenshotDir, name)
  writeFileSync(path, image.toPNG())
  report.screenshots.push({ path, ...image.getSize() })
}

async function run() {
  assert(existsSync(join(root, 'out', 'main', 'index.js')), 'Run npm run build before the integration test')
  await import(new URL('../out/main/index.js', import.meta.url).href)
  main = await waitUntil(() => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'To-Do List'), 'The main BrowserWindow was not created')
  await ready(main)
  await waitUntil(() => trayMenu, 'The production tray menu was not initialized')
  const initial = await snapshot()
  assert.equal(initial.tasks.length, 0, 'The UUID test database must start empty')
  let taskA, taskB, taskC, uiTask, mini

  await check('真实 preload 与 SQLite 新增、编辑和完成', async () => {
    async function create(title, priority, description) {
      const before = await snapshot()
      const after = await api(main, 'tasks.create', { title, priority, description, createRequestId: randomUUID(), dataEpoch: before.dataEpoch })
      const task = after.tasks.find((entry) => entry.title === title)
      assert(task, 'Created task must be returned by the SQLite snapshot')
      assert.equal(after.collectionRevision, before.collectionRevision + 1)
      return task
    }
    taskA = await create('验收示例：梳理本周重点', 2, '确认本周需要优先完成的事项。\n这条任务用于验证高优先级旗帜。')
    taskB = await create('验收示例：整理项目文档', 1, '整理需求、交互与技术说明，为后续维护留下清晰记录。')
    taskC = await create('验收示例：阅读设计资料', 0, '留出一段时间，记录可以改进日常工具的设计细节。')
    const original = await create('验收示例：检查数据持久化', 1, '验证真实数据库提交。')
    let current = await snapshot()
    current = await api(main, 'tasks.update', { id: original.id, expectedRevision: original.revision, dataEpoch: current.dataEpoch, title: original.title, description: '已通过真实 preload 编辑描述。', priority: 1 })
    const edited = current.tasks.find((task) => task.id === original.id)
    assert.equal(edited.description, '已通过真实 preload 编辑描述。')
    assert.equal(edited.createdAt, original.createdAt)
    assert.equal(edited.revision, original.revision + 1)
    current = await api(main, 'tasks.setCompleted', { id: edited.id, expectedRevision: edited.revision, dataEpoch: current.dataEpoch, completed: true })
    const completed = current.tasks.find((task) => task.id === edited.id)
    assert.equal(completed.completed, true)
    assert.equal(typeof completed.completedAt, 'number')
    assert(existsSync(report.databaseFile), 'A real SQLite file must exist')
    return { taskCount: current.tasks.length, completed: completed.id, sqliteBytes: statSync(report.databaseFile).size }
  })

  await check('真实 Vue DragEvent 拖拽经 IPC 保存手动顺序', async () => {
    await api(main, 'settings.update', { filter: 'all', sort: 'manual', density: 'standard', sidebarCollapsed: false })
    await waitUntil(() => dom(main, () => document.querySelectorAll('.drag-handle').length === 4), 'Manual drag handles did not render')
    const before = await snapshot()
    const expected = [...before.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id)
    expected.splice(expected.indexOf(taskC.id), 1)
    expected.splice(expected.indexOf(taskA.id), 0, taskC.id)
    await dom(main, (sourceId, targetId) => {
      const source = document.querySelector(`[data-task-id="${sourceId}"]`)
      const target = document.querySelector(`[data-task-id="${targetId}"]`)
      const handle = source.querySelector('.drag-handle')
      const box = target.getBoundingClientRect()
      const dataTransfer = new DataTransfer()
      const options = { bubbles: true, cancelable: true, dataTransfer, clientX: box.left + 20, clientY: box.top + 2 }
      handle.dispatchEvent(new DragEvent('dragstart', options))
      target.dispatchEvent(new DragEvent('dragover', options))
      target.dispatchEvent(new DragEvent('drop', options))
      handle.dispatchEvent(new DragEvent('dragend', options))
      return true
    }, taskC.id, taskA.id)
    const after = await waitUntil(async () => {
      const value = await snapshot()
      const ids = [...value.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((task) => task.id)
      return JSON.stringify(ids) === JSON.stringify(expected) ? value : false
    }, 'Synthetic component drag did not persist the expected SQLite order')
    assert(after.collectionRevision > before.collectionRevision)
    return { order: expected, collectionRevision: after.collectionRevision }
  })

  await check('自定义 combobox 可打开与键盘选择且无原生 select', async () => {
    assert.equal(await dom(main, () => document.querySelectorAll('select').length), 0)
    await dom(main, () => { document.querySelector('[role="combobox"][aria-label="任务排序"]').click(); return true })
    await waitUntil(() => dom(main, () => Boolean(document.querySelector('[role="listbox"]'))), 'The custom listbox did not open')
    await dom(main, () => {
      const trigger = document.querySelector('[role="combobox"][aria-label="任务排序"]')
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      return true
    })
    await waitUntil(async () => (await snapshot()).settings.sort === 'newest', 'Keyboard selection did not update the sort preference')
    await api(main, 'settings.update', { sort: 'manual' })
    return { nativeSelectCount: 0, keyboardSelected: 'newest' }
  })

  await check('真实表单提交、单层聚焦边框和三色旗帜', async () => {
    await dom(main, () => { document.querySelector('#add-task').click(); return true })
    await waitUntil(() => dom(main, () => Boolean(document.querySelector('#task-title'))), 'The task editor did not open')
    const focus = await dom(main, () => {
      const input = document.querySelector('#task-title')
      input.focus()
      const css = getComputedStyle(input)
      return { outline: css.outlineStyle, borderColor: css.borderColor, borderWidth: css.borderWidth, devicePixelRatio: window.devicePixelRatio }
    })
    assert.equal(focus.outline, 'none')
    // Hidden test windows do not activate OS focus; the color transition may
    // remain at its neutral first frame. The single-border invariant is exact.
    const borderWidth = Number.parseFloat(focus.borderWidth)
    assert(borderWidth > 0 && borderWidth <= 1, 'The input must have one thin border, including fractional Windows display scaling')
    await dom(main, () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      for (const [id, value] of [['task-title', '验收示例：安排下一步工作'], ['task-description', '在主窗口录入任务，小窗会同步显示。\n这是自动验收创建的独立测试数据。']]) {
        const input = document.getElementById(id)
        setter.call(input, value)
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
      }
      return true
    })
    await waitUntil(() => dom(main, () => !document.querySelector('#save-task').disabled), 'The valid task form did not become submittable')
    await dom(main, () => { document.querySelector('.task-form').requestSubmit(); return true })
    uiTask = await waitUntil(async () => (await snapshot()).tasks.find((task) => task.title === '验收示例：安排下一步工作'), 'Vue form did not create a persisted task')
    await waitUntil(() => dom(main, () => !document.querySelector('.detail-panel')), 'The submitted new-task panel did not close')
    const colors = await dom(main, () => Object.fromEntries(['high', 'normal', 'low'].map((level) => [level, getComputedStyle(document.querySelector(`.task-list .priority-flag.${level}`)).color])))
    assert.deepEqual(colors, { high: 'rgb(161, 61, 53)', normal: 'rgb(36, 92, 70)', low: 'rgb(102, 112, 104)' })
    return { uiTaskId: uiTask.id, focus, priorityColors: colors }
  })

  await check('小窗独立创建、真实原生置顶状态与无父窗口', async () => {
    clickTray('打开小窗')
    mini = await waitUntil(miniWindow, 'The tray callback did not create the mini BrowserWindow')
    await ready(mini, true)
    await api(main, 'mini.open')
    assert.notEqual(mini.id, main.id)
    assert.equal(mini.getParentWindow(), null)
    assert.equal(mini.getTitle(), 'To-Do List · 专注小窗')
    await api(mini, 'mini.setPinned', false)
    assert.equal(mini.isAlwaysOnTop(), false)
    await api(mini, 'mini.setPinned', true)
    assert.equal(mini.isAlwaysOnTop(), true)
    return { mainWindowId: main.id, miniWindowId: mini.id, title: mini.getTitle(), bounds: mini.getBounds() }
  })

  await check('小窗 Vue 完成任务后主窗 DOM 与数据库实时同步', async () => {
    await waitUntil(() => dom(mini, (id) => Boolean(document.querySelector(`[data-task-id="${id}"] .task-check`)), uiTask.id), 'The main-window task did not appear in the mini window')
    await dom(mini, (id) => { document.querySelector(`[data-task-id="${id}"] .task-check`).click(); return true }, uiTask.id)
    await waitUntil(async () => (await snapshot(mini)).tasks.find((task) => task.id === uiTask.id)?.completed === true, 'Mini completion did not reach SQLite')
    await waitUntil(() => dom(main, (id) => document.querySelector(`[data-task-id="${id}"]`)?.classList.contains('completed'), uiTask.id), 'Main DOM did not receive the mini completion broadcast')
    const subtitle = await dom(main, () => document.querySelector('.view-subtitle').textContent)
    assert.match(subtitle, /3 项未完成/u)
    assert.equal(await dom(mini, (id) => document.querySelector(`[data-task-id="${id}"]`) === null, uiTask.id), true)
    return { completedTaskId: uiTask.id, mainSubtitle: subtitle }
  })

  await check('关闭主工作台只隐藏并保留草稿且小窗继续运行', async () => {
    await dom(main, (id) => { document.querySelector(`[data-task-id="${id}"] .task-copy`).click(); return true }, taskB.id)
    await waitUntil(() => dom(main, () => Boolean(document.querySelector('#task-title'))), 'The existing task editor did not open')
    await dom(main, () => {
      const input = document.querySelector('#task-title')
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
      setter.call(input, '验收示例：保留未保存草稿')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: input.value }))
      return true
    })
    await api(main, 'window.requestClose')
    assert.equal(main.isDestroyed(), false)
    assert.equal(main.isVisible(), false)
    assert.equal(mini.isDestroyed(), false)
    const current = await snapshot(mini)
    assert.equal(current.tasks.find((task) => task.id === taskB.id).title, taskB.title)
    assert.equal(await dom(main, () => document.querySelector('#task-title').value), '验收示例：保留未保存草稿')
    return { hiddenMainStillAlive: true, miniStillAlive: true, unsavedDraftPreserved: true }
  })

  await check('小窗 API 与托盘关闭均不影响主窗口和任务服务', async () => {
    await api(main, 'mini.close')
    await waitUntil(() => mini.isDestroyed(), 'mini.close did not destroy its independent window')
    assert.equal(main.isDestroyed(), false)
    assert.equal((await snapshot()).tasks.length, 5)
    clickTray('打开小窗')
    mini = await waitUntil(miniWindow, 'The tray did not reopen the mini window')
    await ready(mini, true)
    const reopenedId = mini.id
    clickTray('关闭小窗')
    await waitUntil(() => mini.isDestroyed(), 'The tray close-mini callback did not destroy the mini window')
    assert.equal(main.isDestroyed(), false)
    return { reopenedMiniId: reopenedId, mainStillAlive: true }
  })

  await check('mini.showMain 与托盘打开工作台触发真实 show 事件', async () => {
    let before = showCounts.get(main.id)
    await api(main, 'mini.showMain')
    assert(showCounts.get(main.id) > before)
    assert.equal(await dom(main, () => document.querySelector('#task-title').value), '验收示例：保留未保存草稿')
    before = showCounts.get(main.id)
    clickTray('打开工作台')
    await waitUntil(() => showCounts.get(main.id) > before, 'The tray open-workspace callback did not call show')
    await dom(main, () => { document.querySelector('.detail-header button').click(); return true })
    await waitUntil(() => dom(main, () => Boolean(document.querySelector('dialog[open]'))), 'Closing a dirty editor did not request a draft decision')
    await dom(main, () => { [...document.querySelectorAll('dialog[open] button')].find((button) => button.textContent.trim() === '放弃修改').click(); return true })
    await waitUntil(() => dom(main, () => !document.querySelector('.detail-panel')), 'Discarding the draft did not close its editor')
    return { mainShowEvents: showCounts.get(main.id), testWindowsRemainHidden: !main.isVisible() }
  })

  await check('主窗隐藏后仍可重开小窗并继续访问真实任务', async () => {
    await api(main, 'window.requestClose')
    const state = await api(main, 'mini.open')
    assert.equal(state.isOpen, true)
    mini = await waitUntil(miniWindow, 'mini.open did not work after hiding the main window')
    await ready(mini, true)
    assert.equal(mini.getParentWindow(), null)
    assert.equal((await snapshot(mini)).tasks.length, 5)
    return { reopenedMiniId: mini.id, mainHidden: !main.isVisible(), taskCount: 5 }
  })

  await check('真实托盘新建、置顶与备份菜单回调', async () => {
    clickTray('新建任务')
    await waitUntil(() => dom(main, () => document.querySelector('#editor-heading')?.textContent === '新增任务'), 'The tray new-task callback did not reach Vue')
    assert.equal(await dom(main, () => document.querySelector('#task-title').value), '')
    await dom(main, () => { document.querySelector('.detail-header button').click(); return true })
    clickTray('小窗置顶', false)
    await waitUntil(() => !mini.isAlwaysOnTop(), 'The tray pin callback did not unset native always-on-top')
    clickTray('小窗置顶', true)
    await waitUntil(() => mini.isAlwaysOnTop(), 'The tray pin callback did not set native always-on-top')
    const backupsBefore = (await api(main, 'backups.list')).filter((backup) => backup.kind === 'manual').length
    clickTray('立即备份')
    const backups = await waitUntil(async () => {
      const value = await api(main, 'backups.list')
      return value.filter((backup) => backup.kind === 'manual').length > backupsBefore ? value : false
    }, 'The tray backup callback did not create a real backup')
    await waitUntil(() => report.interceptedNotifications.some((notice) => notice.title === '备份已完成'), 'The backup completion notification callback did not run')
    return { backupCount: backups.length, interceptedDesktopNotification: true }
  })

  await check('捕获真实 Vue 工作台与专注小窗截图', async () => {
    activeCheck.stage = 'open committed task detail'
    await api(main, 'settings.update', { filter: 'all', sort: 'manual', sidebarCollapsed: false })
    await dom(main, (id) => { document.querySelector(`[data-task-id="${id}"] .task-copy`).click(); return true }, taskB.id)
    await waitUntil(() => dom(main, () => document.querySelector('#task-title')?.value === '验收示例：整理项目文档'), 'The task detail did not show the committed normal-priority example')
    activeCheck.stage = 'inspect custom priority options'
    await dom(main, () => { document.querySelector('[role="combobox"][aria-label="任务优先级"]').click(); return true })
    await waitUntil(() => dom(main, () => document.querySelectorAll('[role="listbox"] .priority-flag').length === 3), 'The custom priority options did not contain three reusable flags')
    const optionColors = await dom(main, () => [...document.querySelectorAll('[role="listbox"] .priority-flag')].map((flag) => getComputedStyle(flag).color))
    assert.deepEqual(optionColors, ['rgb(161, 61, 53)', 'rgb(36, 92, 70)', 'rgb(102, 112, 104)'])
    await dom(main, () => { document.querySelector('[role="combobox"][aria-label="任务优先级"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true })
    await waitUntil(() => dom(main, () => !document.querySelector('[role="listbox"]')), 'The priority listbox did not close')
    await dom(main, () => { document.querySelectorAll('.toast-close').forEach((button) => button.click()); return true })
    await waitUntil(() => dom(main, () => document.querySelector('#save-task')?.disabled && document.querySelectorAll('.drag-handle').length === 5 && !document.querySelector('.toast')), 'Screenshot preparation must have a clean committed editor, drag handles, and no toast')
    const editorEvidence = await dom(main, () => ({ title: document.querySelector('#task-title').value, saveDisabled: document.querySelector('#save-task').disabled, dragHandles: document.querySelectorAll('.drag-handle').length, toastCount: document.querySelectorAll('.toast').length }))
    await waitUntil(() => dom(mini, () => document.querySelectorAll('.mini-task-row').length >= 2), 'The mini screenshot must have at least two unfinished examples')
    await capture(main, 'workspace.png')
    await capture(mini, 'mini-window.png')
    return { optionColors, editorEvidence, screenshots: report.screenshots }
  })

  activeCheck = { name: '托盘退出与 app.quit 正常 will-quit 退出流程', status: 'running', started: Date.now() }
  report.checks.push(activeCheck)
  expectedQuit = true
  report.normalQuitRequested = true
  saveReport()
  clickTray('退出应用')
  // A second normal quit request is safe while the tray's close handshake is in
  // progress, and verifies the public app.quit path without forcing termination.
  app.quit()
}

void run().catch(fail)
