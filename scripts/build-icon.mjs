#!/usr/bin/env node
// Builds build/icon.icns, build/icon.png and resources/icon.png from
// build/icon.svg. Uses Electron's Chromium to rasterise the SVG and macOS
// iconutil/sips to pack the icon ladder. Idempotent, no extra dependencies.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const electronBin = join(root, 'node_modules', '.bin', 'electron')
const master = join(root, 'build', 'icon.png')
const iconset = join(root, 'build', 'icon.iconset')

execFileSync(
  electronBin,
  [join(root, 'scripts', 'render-icon.cjs'), join(root, 'build', 'icon.svg'), master, '1024'],
  { stdio: 'inherit' }
)

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

const ladder = [
  [16, 1],
  [16, 2],
  [32, 1],
  [32, 2],
  [128, 1],
  [128, 2],
  [256, 1],
  [256, 2],
  [512, 1],
  [512, 2]
]

for (const [base, scale] of ladder) {
  const px = String(base * scale)
  const name = `icon_${base}x${base}${scale === 2 ? '@2x' : ''}.png`
  execFileSync('sips', ['-z', px, px, master, '--out', join(iconset, name)], { stdio: 'ignore' })
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build', 'icon.icns')], {
  stdio: 'inherit'
})

execFileSync('sips', ['-z', '512', '512', master, '--out', join(root, 'resources', 'icon.png')], {
  stdio: 'ignore'
})

console.log('built build/icon.icns, build/icon.png and resources/icon.png')
