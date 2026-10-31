export interface ContainerSummary {
  id: string
  image: string
  state: string
  ip: string
  platform: string
  created: string
  networks: string[]
  labels: Record<string, string>
}

export interface SystemStatus {
  status: string
  clientVersion: string
  serverVersion: string
  hostArch: string
  hostOs: string
  containersTotal: number | null
  containersRunning: number | null
}

export type CliErrorCode =
  | 'CLI_MISSING'
  | 'SERVICE_NOT_RUNNING'
  | 'CLI_ERROR'
  | 'PARSE_ERROR'
  | 'BUILD_FAILED'
  | 'CANCELED'
  | 'UNKNOWN'

export interface CliErrorInfo {
  code: CliErrorCode
  message: string
  exitCode?: number | null
  stderr?: string
}

export type ListResult =
  { ok: true; containers: ContainerSummary[] } | { ok: false; error: CliErrorInfo }
export type SystemStatusResult =
  { ok: true; status: SystemStatus } | { ok: false; error: CliErrorInfo }
export type ActionResult = { ok: true } | { ok: false; error: CliErrorInfo }

export interface BuildRequest {
  contextDir: string
  dockerfilePath?: string
  tag: string
  buildArgs: { key: string; value: string }[]
  target?: string
  noCache: boolean
  platform?: string
}

export type BuildStream = 'stdout' | 'stderr'
export interface BuildLine {
  stream: BuildStream
  line: string
}
export interface BuildOutputEvent extends BuildLine {
  runId: string
}
export interface BuildDoneEvent {
  runId: string
  code: number | null
  signal: string | null
  canceled: boolean
  error?: CliErrorInfo
}

export type BuildStartResult = { ok: true; runId: string } | { ok: false; error: CliErrorInfo }
