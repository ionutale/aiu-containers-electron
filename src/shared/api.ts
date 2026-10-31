import type {
  ComposeActionResult,
  ComposeDoneEvent,
  ComposeLogEvent,
  ComposeOutputEvent,
  ComposeParseResult,
  ComposeStartResult
} from './compose'
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
  buildDone: 'build:done',
  composeInspect: 'compose:inspect',
  composeUp: 'compose:up',
  composeCancel: 'compose:cancel',
  composeStop: 'compose:stop',
  composeDown: 'compose:down',
  composeLogs: 'compose:logs',
  composeLogsStop: 'compose:logsStop',
  composeOutput: 'compose:output',
  composeDone: 'compose:done',
  composeLog: 'compose:log'
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
  onBuildOutput(cb: (e: BuildOutputEvent) => void): () => void
  onBuildDone(cb: (e: BuildDoneEvent) => void): () => void
  onComposeOutput(cb: (e: ComposeOutputEvent) => void): () => void
  onComposeDone(cb: (e: ComposeDoneEvent) => void): () => void
  onComposeLog(cb: (e: ComposeLogEvent) => void): () => void
}
