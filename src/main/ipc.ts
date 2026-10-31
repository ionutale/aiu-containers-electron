import type { IpcMain } from 'electron'
import { CHANNELS } from '../shared/api'
import type {
  ComposeActionResult,
  ComposeParseResult,
  ComposeStartResult
} from '../shared/compose'
import type {
  ActionResult,
  BuildRequest,
  BuildStartResult,
  ListResult,
  SystemStatusResult
} from '../shared/types'

export interface IpcDeps {
  listContainers(runningOnly: boolean): Promise<ListResult>
  systemStatus(): Promise<SystemStatusResult>
  systemStart(): Promise<ActionResult>
  buildStart(req: BuildRequest): Promise<BuildStartResult>
  buildCancel(runId: string): Promise<{ ok: boolean }>
  findDockerfile(dir: string): { dockerfile: string | null }
  pickDirectory(defaultPath?: string): Promise<string | null>
  pickFile(defaultPath?: string): Promise<string | null>
  composeInspect(file: string): Promise<ComposeParseResult>
  composeUp(req: {
    file: string
    projectName?: string
    forceBuild?: boolean
  }): Promise<ComposeStartResult>
  composeCancel(runId: string): Promise<{ ok: boolean }>
  composeStop(req: { file: string; projectName?: string }): Promise<ComposeActionResult>
  composeDown(req: {
    file: string
    projectName?: string
    removeVolumes?: boolean
  }): Promise<ComposeActionResult>
  composeLogs(req: {
    file: string
    projectName?: string
    service: string
  }): Promise<ComposeActionResult>
  composeLogsStop(): Promise<{ ok: true }>
}

export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: IpcDeps): void {
  ipcMain.handle(CHANNELS.list, (_e, payload: { runningOnly?: boolean } | undefined) =>
    deps.listContainers(payload?.runningOnly ?? true)
  )
  ipcMain.handle(CHANNELS.systemStatus, () => deps.systemStatus())
  ipcMain.handle(CHANNELS.systemStart, () => deps.systemStart())
  ipcMain.handle(CHANNELS.buildStart, (_e, req: BuildRequest) => deps.buildStart(req))
  ipcMain.handle(CHANNELS.buildCancel, (_e, payload: { runId: string }) =>
    deps.buildCancel(payload.runId)
  )
  ipcMain.handle(CHANNELS.contextInspect, (_e, payload: { dir: string }) =>
    deps.findDockerfile(payload.dir)
  )
  ipcMain.handle(CHANNELS.pickDirectory, (_e, payload?: { defaultPath?: string }) =>
    deps.pickDirectory(payload?.defaultPath)
  )
  ipcMain.handle(CHANNELS.pickFile, (_e, payload?: { defaultPath?: string }) =>
    deps.pickFile(payload?.defaultPath)
  )
  ipcMain.handle(CHANNELS.composeInspect, (_e, payload: { file: string }) =>
    deps.composeInspect(payload.file)
  )
  ipcMain.handle(
    CHANNELS.composeUp,
    (_e, payload: { file: string; projectName?: string; forceBuild?: boolean }) =>
      deps.composeUp(payload)
  )
  ipcMain.handle(CHANNELS.composeCancel, (_e, payload: { runId: string }) =>
    deps.composeCancel(payload.runId)
  )
  ipcMain.handle(
    CHANNELS.composeStop,
    (_e, payload: { file: string; projectName?: string }) => deps.composeStop(payload)
  )
  ipcMain.handle(
    CHANNELS.composeDown,
    (_e, payload: { file: string; projectName?: string; removeVolumes?: boolean }) =>
      deps.composeDown(payload)
  )
  ipcMain.handle(
    CHANNELS.composeLogs,
    (_e, payload: { file: string; projectName?: string; service: string }) =>
      deps.composeLogs(payload)
  )
  ipcMain.handle(CHANNELS.composeLogsStop, () => deps.composeLogsStop())
}
