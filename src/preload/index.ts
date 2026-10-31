import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type ContainersApi } from '../shared/api'
import type {
  ComposeDoneEvent,
  ComposeLogEvent,
  ComposeOutputEvent
} from '../shared/compose'
import type { BuildDoneEvent, BuildOutputEvent } from '../shared/types'

function subscribe<T>(channel: string, cb: (event: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ContainersApi = {
  list: (runningOnly) => ipcRenderer.invoke(CHANNELS.list, { runningOnly }),
  systemStatus: () => ipcRenderer.invoke(CHANNELS.systemStatus),
  systemStart: () => ipcRenderer.invoke(CHANNELS.systemStart),
  buildStart: (req) => ipcRenderer.invoke(CHANNELS.buildStart, req),
  buildCancel: (runId) => ipcRenderer.invoke(CHANNELS.buildCancel, { runId }),
  contextInspect: (dir) => ipcRenderer.invoke(CHANNELS.contextInspect, { dir }),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickDirectory, { defaultPath }),
  pickFile: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickFile, { defaultPath }),
  composeInspect: (file) => ipcRenderer.invoke(CHANNELS.composeInspect, { file }),
  composeUp: (req) => ipcRenderer.invoke(CHANNELS.composeUp, req),
  composeCancel: (runId) => ipcRenderer.invoke(CHANNELS.composeCancel, { runId }),
  composeStop: (req) => ipcRenderer.invoke(CHANNELS.composeStop, req),
  composeDown: (req) => ipcRenderer.invoke(CHANNELS.composeDown, req),
  composeLogs: (req) => ipcRenderer.invoke(CHANNELS.composeLogs, req),
  composeLogsStop: () => ipcRenderer.invoke(CHANNELS.composeLogsStop),
  onBuildOutput: (cb) => subscribe<BuildOutputEvent>(CHANNELS.buildOutput, cb),
  onBuildDone: (cb) => subscribe<BuildDoneEvent>(CHANNELS.buildDone, cb),
  onComposeOutput: (cb) => subscribe<ComposeOutputEvent>(CHANNELS.composeOutput, cb),
  onComposeDone: (cb) => subscribe<ComposeDoneEvent>(CHANNELS.composeDone, cb),
  onComposeLog: (cb) => subscribe<ComposeLogEvent>(CHANNELS.composeLog, cb)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('containers', api)
} else {
  ;(window as unknown as { containers: ContainersApi }).containers = api
}
