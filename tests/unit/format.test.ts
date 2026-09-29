import { describe, expect, it } from 'vitest'
import { defaultTagFor, formatElapsed } from '../../src/renderer/src/lib/format'

describe('defaultTagFor', () => {
  it('lowercases and sanitizes the folder name', () => {
    expect(defaultTagFor('/Users/me/My App')).toBe('my-app')
    expect(defaultTagFor('/Users/me/foo_bar.v2')).toBe('foo_bar.v2')
  })

  it('strips leading invalid characters and handles trailing slashes', () => {
    expect(defaultTagFor('/Users/me/Édge ')).toBe('dge')
    expect(defaultTagFor('/Users/me/app/')).toBe('app')
  })

  it('falls back for empty names', () => {
    expect(defaultTagFor('/')).toBe('image')
  })
})

describe('formatElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsed(0)).toBe('0.0s')
    expect(formatElapsed(1500)).toBe('1.5s')
    expect(formatElapsed(65_000)).toBe('1m 5s')
  })
})
