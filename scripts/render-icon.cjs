/* eslint-disable @typescript-eslint/no-require-imports -- Electron loads this entry as CommonJS. */
// Renders an SVG to a transparent PNG using Electron's Chromium (no browser
// download needed). Invoked by scripts/build-icon.mjs.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')

const [, , svgPath, outPath, sizeArg] = process.argv
const size = Number(sizeArg || 1024)

app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const svg = readFileSync(svgPath, 'utf8')
    const win = new BrowserWindow({
      width: size,
      height: size,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false }
    })
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    await win.loadURL(dataUrl)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const image = await win.webContents.capturePage()
    writeFileSync(outPath, image.toPNG())
    app.quit()
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
