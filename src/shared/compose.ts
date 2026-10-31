export interface ComposeError {
  message: string
  file?: string
  line?: number
  service?: string
  key?: string
}

export interface ComposeWarning {
  message: string
  service?: string
  key?: string
}

export interface ComposeBuildSpec {
  context: string
  dockerfile?: string
  args: { key: string; value: string }[]
  target?: string
  platform?: string
}

export interface ComposePort {
  raw: string
  hostIp?: string
  hostPort: number
  containerPort: number
  protocol: 'tcp' | 'udp'
}

export interface ComposeMount {
  raw: string
  type: 'bind' | 'volume'
  /** Absolute host path for binds, prefixed volume name for named volumes. */
  source: string
  target: string
  readOnly: boolean
}

export interface ComposeService {
  name: string
  image?: string
  build?: ComposeBuildSpec
  containerName: string
  environment: { key: string; value: string }[]
  ports: ComposePort[]
  volumes: ComposeMount[]
  dependsOn: string[]
  command?: string[]
  entrypoint?: string[]
  workingDir?: string
  user?: string
  platform?: string
}

export interface ComposeProject {
  name: string
  file: string
  dir: string
  network: string
  namedVolumes: string[]
  /** Dependency order (dependencies before dependents). */
  services: ComposeService[]
  warnings: ComposeWarning[]
}

export type ComposeParseResult =
  | { ok: true; project: ComposeProject }
  | { ok: false; errors: ComposeError[] }

export interface ComposeParseOptions {
  projectName?: string
  env?: NodeJS.ProcessEnv
}

export type ComposeStartResult =
  | { ok: true; runId: string }
  | { ok: false; error: { message: string } }

export type ComposeActionResult = { ok: true } | { ok: false; message: string }

export interface ComposeOutputEvent {
  runId: string
  service?: string
  stream: 'stdout' | 'stderr'
  line: string
}

export interface ComposeDoneEvent {
  runId: string
  action: 'up' | 'down' | 'stop'
  ok: boolean
  message?: string
}

export interface ComposeLogEvent {
  service: string
  stream: 'stdout' | 'stderr'
  line: string
}
