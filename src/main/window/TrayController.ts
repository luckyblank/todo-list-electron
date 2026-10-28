import { Menu, nativeImage, Tray } from 'electron'
import type { MiniWindowState } from '../../shared/contracts'

export interface TrayControllerOptions {
  icon: string
  openWorkspace: () => void
  openMini: () => void
  closeMini: () => void
  getMiniState: () => MiniWindowState
  setMiniPinned: (pinned: boolean) => void
  newTask: () => void
  backup: () => Promise<void>
  quit: () => void
  report: (operation: string, error: unknown) => void
}

/** Kept by the main process for the entire application lifetime; create after app.whenReady(). */
export class TrayController {
  private readonly tray: Tray
  private readonly balloonIcon: Electron.NativeImage
  private backupBusy = false
  private disposed = false

  constructor(private readonly options: TrayControllerOptions) {
    const source = nativeImage.createFromPath(options.icon)
    if (source.isEmpty()) {
      const error = new Error('应用托盘图标未能加载。')
      this.report('tray-icon', error)
      throw error
    }
    const icon = nativeImage.createEmpty()
    for (const scaleFactor of [1, 1.25, 1.5, 2]) {
      const size = Math.round(16 * scaleFactor)
      icon.addRepresentation({ scaleFactor, dataURL: source.resize({ width: size, height: size, quality: 'best' }).toDataURL() })
    }
    this.balloonIcon = source.resize({ width: 32, height: 32, quality: 'best' })
    this.tray = new Tray(icon)
    this.tray.setToolTip('To-Do List')
    const openWorkspace = (): void => { void this.invoke('tray-open-workspace', options.openWorkspace) }
    this.tray.on('click', openWorkspace)
    this.tray.on('double-click', openWorkspace)
    this.refresh()
  }

  refresh(): void {
    if (this.disposed || this.tray.isDestroyed()) return
    try {
      const mini = this.options.getMiniState()
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开工作台', click: () => { void this.invoke('tray-open-workspace', this.options.openWorkspace) } },
        { label: '打开小窗', click: () => { void this.invoke('tray-open-mini', this.options.openMini) } },
        { label: '新建任务', click: () => { void this.invoke('tray-new-task', this.options.newTask) } },
        { type: 'separator' },
        { label: '小窗置顶', type: 'checkbox', checked: mini.isPinned, enabled: mini.isOpen,
          click: (item) => { void this.invoke('tray-pin-mini', () => this.options.setMiniPinned(item.checked)) } },
        { label: '关闭小窗', enabled: mini.isOpen, click: () => { void this.invoke('tray-close-mini', this.options.closeMini) } },
        { type: 'separator' },
        { label: this.backupBusy ? '备份中…' : '立即备份', enabled: !this.backupBusy, click: () => { void this.backup() } },
        { type: 'separator' },
        { label: '退出应用', click: () => { void this.invoke('tray-quit', this.options.quit) } }
      ]))
    } catch (error) { this.report('tray-refresh', error) }
  }

  private async invoke(operation: string, action: () => void): Promise<void> {
    if (this.disposed) return
    try { await action() }
    catch (error) { this.report(operation, error) }
    finally { this.refresh() }
  }

  private async backup(): Promise<void> {
    if (this.disposed || this.backupBusy) return
    this.backupBusy = true
    this.refresh()
    try {
      await this.options.backup()
      this.notify('备份已完成', '任务备份已保存到本机。')
    } catch (error) {
      this.report('tray-backup', error)
      this.notify('备份未完成', '请打开工作台查看提示并重试备份。')
    } finally {
      this.backupBusy = false
      this.refresh()
    }
  }

  private notify(title: string, content: string): void {
    if (this.disposed || this.tray.isDestroyed() || process.platform !== 'win32') return
    try {
      this.tray.displayBalloon({
        icon: this.balloonIcon, iconType: 'custom', title, content,
        noSound: true, respectQuietTime: true
      })
    } catch (error) { this.report('tray-notification', error) }
  }

  private report(operation: string, error: unknown): void {
    try { this.options.report(operation, error) }
    catch { /* Diagnostic failures must not break a system tray callback. */ }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}
