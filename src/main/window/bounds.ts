import { readFileSync, writeFileSync } from 'node:fs'
import type { Rectangle } from 'electron'

export interface SavedWindowBounds extends Rectangle { maximized: boolean }

export function initialBounds(workArea: Rectangle): Rectangle {
  const scale = Math.min(1, (workArea.width - 48) / 1200, (workArea.height - 48) / 800)
  const width = Math.max(640, Math.round(1200 * scale))
  const height = Math.max(480, Math.round(800 * scale))
  return { x: Math.round(workArea.x + (workArea.width - width) / 2), y: Math.round(workArea.y + (workArea.height - height) / 2), width, height }
}

export function loadWindowBounds(path: string, workAreas: Rectangle[]): SavedWindowBounds {
  const fallback = { ...initialBounds(workAreas[0]), maximized: false }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as SavedWindowBounds
    if (!['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key as keyof Rectangle]))) return fallback
    const area = workAreas.find((screen) => value.x + value.width > screen.x + 80 && value.x < screen.x + screen.width - 80 && value.y + value.height > screen.y + 80 && value.y < screen.y + screen.height - 80)
    if (!area) return fallback
    const width = Math.min(Math.max(640, value.width), area.width)
    const height = Math.min(Math.max(480, value.height), area.height)
    return {
      width, height, x: Math.max(area.x, Math.min(value.x, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(value.y, area.y + area.height - height)), maximized: value.maximized === true
    }
  } catch { return fallback }
}

export function saveWindowBounds(path: string, value: SavedWindowBounds): void {
  try { writeFileSync(path, JSON.stringify(value), 'utf8') } catch { /* Window geometry is a preference; task storage is unaffected. */ }
}
