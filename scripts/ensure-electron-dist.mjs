#!/usr/bin/env node
// Verifies that the installed Electron binary actually extracted, and repairs
// it from the download cache when Electron's own postinstall stalls.
//
// Background: Electron's install step uses `extract-zip`, which on some
// Node/macOS combinations exits successfully having extracted a single file
// (typically only LICENSES.chromium.html). The result is a broken install that
// fails later with "Electron failed to install correctly". This script detects
// that state and repairs it with macOS `ditto`, which handles the app bundle's
// symlinks and permissions correctly.
//
// Wired into `postinstall`, so it runs after every install and is a no-op when
// Electron is healthy.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PLATFORM_PATH = {
  darwin: 'Electron.app/Contents/MacOS/Electron',
  win32: 'electron.exe',
  linux: 'electron'
}

/** The Electron package directory for a project root.
 * @returns {string} */
export function electronPackageDir(root) {
  return join(root, 'node_modules', 'electron')
}

/** True when the extracted binary and its `path.txt` marker are both correct.
 * @returns {boolean} */
export function isInstalled(packageDir, platformPath) {
  const executable = join(packageDir, 'dist', platformPath)
  const marker = join(packageDir, 'path.txt')
  if (!existsSync(executable) || !existsSync(marker)) return false
  return readFileSync(marker, 'utf8').trim() === platformPath
}

/** Locate the cached Electron zip for a version/platform/arch, if present.
 * @returns {string | null} */
export function findCachedZip(cacheRoot, version, plat, arch) {
  if (!existsSync(cacheRoot)) return null
  const name = `electron-v${version}-${plat}-${arch}.zip`
  for (const entry of readdirSync(cacheRoot)) {
    const candidate = join(cacheRoot, entry, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** The Electron download cache root, honouring the documented env overrides.
 * @returns {string} */
export function electronCacheRoot(env = process.env) {
  return (
    env.electron_config_cache ||
    env.ELECTRON_CACHE ||
    join(env.HOME || homedir(), 'Library', 'Caches', 'electron')
  )
}

/** @returns {string} */
export function electronVersion(packageDir) {
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  return pkg.version
}

/** Extract a cached Electron zip with `ditto` and write the `path.txt` marker.
 * @returns {void} */
export function repair(packageDir, zipPath, platformPath) {
  const distDir = join(packageDir, 'dist')
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  execFileSync('ditto', ['-xk', zipPath, distDir], { stdio: 'inherit' })
  writeFileSync(join(packageDir, 'path.txt'), platformPath)
}

/**
 * Ensure Electron is usable. Returns:
 *  - 'ok'        already installed
 *  - 'repaired'  was broken, repaired from the cache
 *  - 'skipped'   unsupported platform (repair is macOS-specific)
 *  - 'failed'    broken and could not be repaired
 * @returns {'ok' | 'repaired' | 'skipped' | 'failed'} */
export function ensureElectronDist({
  root = process.cwd(),
  env = process.env,
  plat = platform(),
  arch = process.arch,
  log = console.log,
  warn = console.warn
} = {}) {
  const platformPath = PLATFORM_PATH[plat]
  if (!platformPath) {
    log(`ensure-electron-dist: unsupported platform ${plat}; skipping.`)
    return 'skipped'
  }

  const packageDir = electronPackageDir(root)
  if (!existsSync(packageDir)) {
    log('ensure-electron-dist: electron is not installed yet; skipping.')
    return 'skipped'
  }

  if (isInstalled(packageDir, platformPath)) return 'ok'

  if (plat !== 'darwin') {
    warn('ensure-electron-dist: Electron looks broken; run `pnpm rebuild electron` to repair.')
    return 'failed'
  }

  const version = electronVersion(packageDir)
  const zipPath = findCachedZip(electronCacheRoot(env), version, plat, arch)
  if (!zipPath) {
    warn(
      `ensure-electron-dist: Electron ${version} is not extracted and no cached zip was found.\n` +
        '  Run `pnpm rebuild electron`, or extract the zip into node_modules/electron/dist manually\n' +
        '  and write "Electron.app/Contents/MacOS/Electron" into node_modules/electron/path.txt.'
    )
    return 'failed'
  }

  log(`ensure-electron-dist: Electron ${version} was not extracted; repairing from ${zipPath}`)
  try {
    repair(packageDir, zipPath, platformPath)
  } catch (error) {
    warn(`ensure-electron-dist: repair failed: ${error?.message ?? error}`)
    return 'failed'
  }

  if (isInstalled(packageDir, platformPath)) {
    log('ensure-electron-dist: repaired.')
    return 'repaired'
  }
  warn('ensure-electron-dist: repair did not produce a usable Electron binary.')
  return 'failed'
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const result = ensureElectronDist()
  // postinstall must not fail the install; surface the state and let the
  // caller decide (README documents the manual fallback).
  process.exit(result === 'failed' ? 1 : 0)
}
