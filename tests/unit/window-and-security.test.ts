import { describe, expect, it } from 'vitest'
import { initialBounds } from '../../src/main/window/bounds'
import { assertPayloadSize, isTrustedLocation } from '../../src/main/ipc/security'
import { validatePreferences, validateTaskInput } from '../../src/shared/validation'

describe('window and trust boundary', () => {
  it('uses a 3:2 initial window and fits a smaller work area', () => {
    expect(initialBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toMatchObject({ width: 1200, height: 800 })
    const small = initialBounds({ x: 0, y: 0, width: 1280, height: 720 })
    expect(small.height).toBeLessThan(720)
    expect(small.width / small.height).toBeCloseTo(1.5, 2)
  })
  it('rejects other origins, paths and malformed locations', () => {
    expect(isTrustedLocation('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/')).toBe(true)
    expect(isTrustedLocation('http://evil.test/', 'http://127.0.0.1:5173/')).toBe(false)
    expect(isTrustedLocation('file:///tmp/other.html', 'file:///tmp/index.html')).toBe(false)
    expect(isTrustedLocation('bad', 'file:///tmp/index.html')).toBe(false)
    expect(() => assertPayloadSize('x'.repeat(2_000_001))).toThrow()
  })
  it('normalizes text and validates persisted UI preferences', () => {
    expect(validateTaskInput({ title: '  测试  ', description: '一\r\n二', priority: 1 })).toEqual({ title: '测试', description: '一\n二', priority: 1 })
    expect(() => validateTaskInput({ title: ' ', description: '', priority: 1 })).toThrow()
    expect(() => validateTaskInput({ title: 'x'.repeat(121), description: '', priority: 1 })).toThrow()
    expect(validatePreferences({ sidebarCollapsed: true, sort: 'manual' })).toEqual({ sidebarCollapsed: true, sort: 'manual' })
    expect(() => validatePreferences({ path: 'arbitrary' })).toThrow()
  })
})
