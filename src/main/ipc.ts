import type { IpcMain } from 'electron'
import { CHANNELS } from '../shared/api'
import type { ActionResult, BuildRequest, BuildStartResult, ListResult, SystemStatusResult } from '../shared/types'

export interface IpcDeps {
  listContainers(runningOnly: boolean): Promise<ListResult>
  systemStatus(): Promise<SystemStatusResult>
  systemStart(): Promise<ActionResult>
  buildStart(req: BuildRequest): Promise<BuildStartResult>
  buildCancel(runId: string): Promise<{ ok: boolean }>
  findDockerfile(dir: string): { dockerfile: string | null }
  pickDirectory(defaultPath?: string): Promise<string | null>
  pickFile(defaultPath?: string): Promise<string | null>
}

export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: IpcDeps): void {
  ipcMain.handle(CHANNELS.list, (_e, payload: { runningOnly?: boolean } | undefined) =>
    deps.listContainers(payload?.runningOnly ?? true)
  )
  ipcMain.handle(CHANNELS.systemStatus, () => deps.systemStatus())
  ipcMain.handle(CHANNELS.systemStart, () => deps.systemStart())
  ipcMain.handle(CHANNELS.buildStart, (_e, req: BuildRequest) => deps.buildStart(req))
  ipcMain.handle(CHANNELS.buildCancel, (_e, payload: { runId: string }) => deps.buildCancel(payload.runId))
  ipcMain.handle(CHANNELS.contextInspect, (_e, payload: { dir: string }) => deps.findDockerfile(payload.dir))
  ipcMain.handle(CHANNELS.pickDirectory, (_e, payload?: { defaultPath?: string }) =>
    deps.pickDirectory(payload?.defaultPath)
  )
  ipcMain.handle(CHANNELS.pickFile, (_e, payload?: { defaultPath?: string }) => deps.pickFile(payload?.defaultPath))
}
