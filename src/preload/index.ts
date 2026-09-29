import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CHANNELS, type ContainersApi } from '../shared/api'
import type { BuildDoneEvent, BuildOutputEvent } from '../shared/types'

const api: ContainersApi = {
  list: (runningOnly) => ipcRenderer.invoke(CHANNELS.list, { runningOnly }),
  systemStatus: () => ipcRenderer.invoke(CHANNELS.systemStatus),
  systemStart: () => ipcRenderer.invoke(CHANNELS.systemStart),
  buildStart: (req) => ipcRenderer.invoke(CHANNELS.buildStart, req),
  buildCancel: (runId) => ipcRenderer.invoke(CHANNELS.buildCancel, { runId }),
  contextInspect: (dir) => ipcRenderer.invoke(CHANNELS.contextInspect, { dir }),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickDirectory, { defaultPath }),
  pickFile: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickFile, { defaultPath }),
  onBuildOutput: (cb) => {
    const listener = (_e: unknown, payload: BuildOutputEvent): void => cb(payload)
    ipcRenderer.on(CHANNELS.buildOutput, listener)
    return () => ipcRenderer.removeListener(CHANNELS.buildOutput, listener)
  },
  onBuildDone: (cb) => {
    const listener = (_e: unknown, payload: BuildDoneEvent): void => cb(payload)
    ipcRenderer.on(CHANNELS.buildDone, listener)
    return () => ipcRenderer.removeListener(CHANNELS.buildDone, listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI) // removed in Task 9 with the template demo
  contextBridge.exposeInMainWorld('containers', api)
} else {
  ;(window as unknown as { containers: ContainersApi }).containers = api
}
