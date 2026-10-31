import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { BuildManager } from './container-cli/build'
import { getCliVersion, isVersionAtLeast } from './container-cli/cli'
import { listContainers, startSystem, systemStatus } from './container-cli/commands'
import { ComposeRunner, type ComposeRunnerEvents } from './compose/runner'
import { ComposeSessions } from './compose/sessions'
import { findDockerfile } from './context'
import { registerIpc } from './ipc'
import { CHANNELS } from '../shared/api'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
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
  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function currentWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.ionutale.aiu-containers-electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()
  const buildManager = new BuildManager()
  const composeRunner = new ComposeRunner(buildManager)
  const composeSessions = new ComposeSessions()
  const composeEvents: ComposeRunnerEvents = {
    onOutput: (event) => currentWindow()?.webContents.send(CHANNELS.composeOutput, event),
    onDone: (event) => currentWindow()?.webContents.send(CHANNELS.composeDone, event),
    onLog: (event) => currentWindow()?.webContents.send(CHANNELS.composeLog, event)
  }

  registerIpc(ipcMain, {
    listContainers: (runningOnly) => listContainers(runningOnly),
    systemStatus: () => systemStatus(),
    systemStart: () => startSystem(),
    buildStart: (req) =>
      Promise.resolve(
        buildManager.start(req, {
          onLine: (runId, line) => {
            currentWindow()?.webContents.send(CHANNELS.buildOutput, { runId, ...line })
          },
          onDone: (runId, done) => {
            currentWindow()?.webContents.send(CHANNELS.buildDone, { runId, ...done })
          }
        })
      ),
    buildCancel: (runId) => Promise.resolve({ ok: buildManager.cancel(runId) }),
    findDockerfile: (dir) => findDockerfile(dir),
    pickDirectory: async (defaultPath) => {
      // Automation override: lets end-to-end tests drive the picker flow
      // without a native dialog (see README "Automation overrides").
      if (!app.isPackaged && process.env.AIU_E2E_DIR_DIALOG) {
        return process.env.AIU_E2E_DIR_DIALOG
      }
      const win = currentWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    pickFile: async (defaultPath) => {
      if (!app.isPackaged && process.env.AIU_E2E_FILE_DIALOG) {
        return process.env.AIU_E2E_FILE_DIALOG
      }
      const win = currentWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    composeInspect: async (file) => composeSessions.inspect(file),
    composeUp: async (req) => {
      const parsed = composeSessions.inspect(req.file, { projectName: req.projectName })
      if ('errors' in parsed) {
        return {
          ok: false,
          error: { message: parsed.errors.map((error) => error.message).join('\n') }
        }
      }
      return composeRunner.startUp(parsed.project, { forceBuild: req.forceBuild }, composeEvents)
    },
    composeCancel: async (runId) => ({ ok: composeRunner.cancel(runId) }),
    composeStop: async (req) => {
      const project = composeSessions.resolve(req.file, req.projectName)
      if (!project) return { ok: false, message: 'No known project for this compose file.' }
      return composeRunner.stop(project)
    },
    composeDown: async (req) => {
      const project = composeSessions.resolve(req.file, req.projectName)
      if (!project) return { ok: false, message: 'No known project for this compose file.' }
      return composeRunner.down(project, { removeVolumes: req.removeVolumes })
    },
    composeLogs: async (req) => {
      const project = composeSessions.resolve(req.file, req.projectName)
      if (!project) return { ok: false, message: 'No known project for this compose file.' }
      return composeRunner.logs(project, req.service, composeEvents)
    },
    composeLogsStop: async () => {
      composeRunner.stopLogs()
      return { ok: true }
    }
  })

  void getCliVersion().then((cli) => {
    if (cli?.version && !isVersionAtLeast(cli.version, '0.10.0')) {
      console.warn(`container CLI ${cli.version} is older than 0.10.0; behavior may differ.`)
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
