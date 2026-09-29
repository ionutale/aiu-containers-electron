import type {
  ActionResult,
  BuildDoneEvent,
  BuildOutputEvent,
  BuildRequest,
  BuildStartResult,
  ListResult,
  SystemStatusResult
} from './types'

export const CHANNELS = {
  list: 'containers:list',
  systemStatus: 'system:status',
  systemStart: 'system:start',
  buildStart: 'build:start',
  buildCancel: 'build:cancel',
  contextInspect: 'context:inspect',
  pickDirectory: 'dialog:pickDirectory',
  pickFile: 'dialog:pickFile',
  buildOutput: 'build:output',
  buildDone: 'build:done'
} as const

export interface ContainersApi {
  list(runningOnly: boolean): Promise<ListResult>
  systemStatus(): Promise<SystemStatusResult>
  systemStart(): Promise<ActionResult>
  buildStart(req: BuildRequest): Promise<BuildStartResult>
  buildCancel(runId: string): Promise<{ ok: boolean }>
  contextInspect(dir: string): Promise<{ dockerfile: string | null }>
  pickDirectory(defaultPath?: string): Promise<string | null>
  pickFile(defaultPath?: string): Promise<string | null>
  onBuildOutput(cb: (e: BuildOutputEvent) => void): () => void
  onBuildDone(cb: (e: BuildDoneEvent) => void): () => void
}
