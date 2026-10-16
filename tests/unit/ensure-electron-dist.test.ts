import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PLATFORM_PATH,
  electronCacheRoot,
  findCachedZip,
  isInstalled
} from '../../scripts/ensure-electron-dist.mjs'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ensure-electron-'))
}

describe('isInstalled', () => {
  it('is false when the dist directory is missing or partial', () => {
    const pkg = tempDir()
    expect(isInstalled(pkg, PLATFORM_PATH.darwin)).toBe(false)

    // The stall's signature: dist exists but holds only the license file.
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'dist', 'LICENSES.chromium.html'), 'x')
    expect(isInstalled(pkg, PLATFORM_PATH.darwin)).toBe(false)
  })

  it('is false when path.txt does not match the platform path', () => {
    const pkg = tempDir()
    mkdirSync(join(pkg, 'dist', 'Electron.app/Contents/MacOS'), { recursive: true })
    writeFileSync(join(pkg, 'dist', PLATFORM_PATH.darwin), 'binary')
    writeFileSync(join(pkg, 'path.txt'), 'something-else')
    expect(isInstalled(pkg, PLATFORM_PATH.darwin)).toBe(false)
  })

  it('is true when the binary and marker agree', () => {
    const pkg = tempDir()
    mkdirSync(join(pkg, 'dist', 'Electron.app/Contents/MacOS'), { recursive: true })
    writeFileSync(join(pkg, 'dist', PLATFORM_PATH.darwin), 'binary')
    writeFileSync(join(pkg, 'path.txt'), `${PLATFORM_PATH.darwin}\n`)
    expect(isInstalled(pkg, PLATFORM_PATH.darwin)).toBe(true)
  })
})

describe('findCachedZip', () => {
  it('finds the zip for the requested version/platform/arch', () => {
    const cache = tempDir()
    const wanted = join(cache, 'abc123', 'electron-v39.8.10-darwin-arm64.zip')
    mkdirSync(join(cache, 'abc123'), { recursive: true })
    writeFileSync(wanted, 'zip')
    mkdirSync(join(cache, 'def456'), { recursive: true })
    writeFileSync(join(cache, 'def456', 'electron-v37.2.6-darwin-arm64.zip'), 'zip')

    expect(findCachedZip(cache, '39.8.10', 'darwin', 'arm64')).toBe(wanted)
  })

  it('returns null when nothing matches', () => {
    const cache = tempDir()
    expect(findCachedZip(cache, '99.0.0', 'darwin', 'arm64')).toBeNull()
    expect(findCachedZip(join(cache, 'missing'), '39.8.10', 'darwin', 'arm64')).toBeNull()
  })
})

describe('electronCacheRoot', () => {
  it('honours the documented env overrides', () => {
    expect(electronCacheRoot({ electron_config_cache: '/custom' })).toBe('/custom')
    expect(electronCacheRoot({ ELECTRON_CACHE: '/other' })).toBe('/other')
    expect(electronCacheRoot({ HOME: '/home/me' })).toBe('/home/me/Library/Caches/electron')
  })
})
