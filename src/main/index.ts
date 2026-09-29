import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { BuildManager } from './container-cli/build'
import { getCliVersion, isVersionAtLeast } from './container-cli/cli'
import { listContainers, startSystem, systemStatus } from './container-cli/commands'
import { findDockerfile } from './context'
import { registerIpc } from './ipc'
import { CHANNELS } from '../shared/api'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ionutale.aiu-containers-electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const mainWindow = createWindow()
  const buildManager = new BuildManager()

  const cli = await getCliVersion()
  if (cli?.version && !isVersionAtLeast(cli.version, '0.10.0')) {
    console.warn(`container CLI ${cli.version} is older than 0.10.0; behavior may differ.`)
  }

  registerIpc(ipcMain, {
    listContainers: (runningOnly) => listContainers(runningOnly),
    systemStatus: () => systemStatus(),
    systemStart: () => startSystem(),
    buildStart: (req) =>
      Promise.resolve(
        buildManager.start(req, {
          onLine: (runId, line) => mainWindow.webContents.send(CHANNELS.buildOutput, { runId, ...line }),
          onDone: (runId, done) => mainWindow.webContents.send(CHANNELS.buildDone, { runId, ...done })
        })
      ),
    buildCancel: (runId) => Promise.resolve({ ok: buildManager.cancel(runId) }),
    findDockerfile: (dir) => findDockerfile(dir),
    pickDirectory: async (defaultPath) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    pickFile: async (defaultPath) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
