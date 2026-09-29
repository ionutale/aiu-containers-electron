import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('project wiring', () => {
  it('package.json points main at the electron-vite build output', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('aiu-containers-electron')
    expect(pkg.main).toBe('./out/main/index.js')
  })
})
