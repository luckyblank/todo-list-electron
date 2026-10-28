import { BrowserWindow, screen } from 'electron'
import type { Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { MiniWindowState } from '../../shared/contracts'

interface MiniOptions {
  rendererUrl: string
  preload: string
  icon: string
  statePath: string
  mainBounds: () => Rectangle | undefined
  trust: (window: BrowserWindow, url: string) => void
  changed: (state: MiniWindowState) => void
}
interface SavedMini { bounds?: Rectangle; isPinned: boolean }

export class MiniWindowController {
  private window: BrowserWindow | null = null
  private saved: SavedMini = { isPinned: true }
  private saveTimer?: ReturnType<typeof setTimeout>

  constructor(private readonly options: MiniOptions) {
    try {
      const saved = JSON.parse(readFileSync(options.statePath, 'utf8')) as SavedMini
      this.saved.isPinned = saved.isPinned !== false
      if (saved.bounds && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(saved.bounds![key as keyof Rectangle]))) this.saved.bounds = saved.bounds
    } catch { /* Start in the lower-right corner on first use. */ }
  }
  state(): MiniWindowState { return { isOpen: this.window !== null && !this.window.isDestroyed(), isPinned: this.saved.isPinned } }

  async open(): Promise<MiniWindowState> {
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); return this.state() }
    const mainBounds = this.options.mainBounds()
    const area = (mainBounds ? screen.getDisplayMatching(mainBounds) : screen.getPrimaryDisplay()).workArea
    const previous = this.saved.bounds
    const width = Math.min(Math.max(previous?.width ?? 360, 300), 520, area.width - 24)
    const height = Math.min(Math.max(previous?.height ?? 480, 280), 800, area.height - 24)
    const x = Math.max(area.x + 12, Math.min(previous?.x ?? area.x + area.width - width - 24, area.x + area.width - width - 12))
    const y = Math.max(area.y + 12, Math.min(previous?.y ?? area.y + area.height - height - 24, area.y + area.height - height - 12))
    const window = new BrowserWindow({
      x, y, width, height, minWidth: 300, minHeight: 280, maxWidth: 520, maxHeight: 800,
      frame: false, titleBarStyle: 'hidden', titleBarOverlay: false, title: 'To-Do List · 专注小窗',
      icon: this.options.icon, backgroundColor: '#F5F6F2', show: false, skipTaskbar: false,
      alwaysOnTop: this.saved.isPinned,
      webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false }
    })
    this.window = window
    const url = new URL(this.options.rendererUrl)
    url.hash = 'mini'
    this.options.trust(window, url.href)
    window.setMenu(null)
    window.on('page-title-updated', (event) => event.preventDefault())
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.on('will-redirect', (event) => event.preventDefault())
    window.on('ready-to-show', () => window.show())
    const schedule = (): void => { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.save(), 200) }
    window.on('move', schedule)
    window.on('resize', schedule)
    window.on('close', () => this.save())
    window.on('closed', () => { clearTimeout(this.saveTimer); this.window = null; this.options.changed(this.state()) })
    await window.loadURL(url.href)
    this.options.changed(this.state())
    return this.state()
  }
  setPinned(pinned: boolean): MiniWindowState {
    this.saved.isPinned = pinned
    this.window?.setAlwaysOnTop(pinned)
    this.save()
    this.options.changed(this.state())
    return this.state()
  }
  close(): void { this.window?.close() }
  destroy(): void { this.save(); if (this.window && !this.window.isDestroyed()) this.window.destroy() }
  private save(): void {
    if (this.window && !this.window.isDestroyed()) this.saved.bounds = this.window.getNormalBounds()
    try { writeFileSync(this.options.statePath, JSON.stringify(this.saved), 'utf8') } catch { /* A failed position preference never changes tasks. */ }
  }
}
