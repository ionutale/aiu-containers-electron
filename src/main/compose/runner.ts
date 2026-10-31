import { randomUUID } from 'node:crypto'
import type {
  ComposeActionResult,
  ComposeDoneEvent,
  ComposeLogEvent,
  ComposeOutputEvent,
  ComposeProject,
  ComposeService,
  ComposeStartResult
} from '../../shared/compose'
import type { ContainerSummary } from '../../shared/types'
import { BuildManager } from '../container-cli/build'
import { runCli, streamCli, type CliRunResult, type StreamHandle } from '../container-cli/cli'
import { listContainers } from '../container-cli/commands'
import { buildRequest, detectNetworkAliasSupport, runArgv } from './plan'

export interface ComposeRunnerEvents {
  onOutput(event: ComposeOutputEvent): void
  onDone(event: ComposeDoneEvent): void
  onLog(event: ComposeLogEvent): void
}

class Canceled extends Error {
  constructor() {
    super('Canceled.')
  }
}

interface ActiveRun {
  runId: string
  action: 'up'
  canceled: boolean
  cancelCurrent?: () => void
}

export class ComposeRunner {
  private active: ActiveRun | null = null
  private log: { handle: StreamHandle; service: string } | null = null
  private aliasSupport: Promise<boolean> | null = null

  constructor(
    private readonly buildManager: BuildManager,
    private readonly opts: { env?: NodeJS.ProcessEnv } = {}
  ) {}

  private get env(): NodeJS.ProcessEnv {
    return this.opts.env ?? process.env
  }

  startUp(
    project: ComposeProject,
    options: { forceBuild?: boolean },
    events: ComposeRunnerEvents
  ): ComposeStartResult {
    if (this.active) {
      return { ok: false, error: { message: 'A compose operation is already running.' } }
    }
    const runId = randomUUID()
    const active: ActiveRun = { runId, action: 'up', canceled: false }
    this.active = active
    void this.up(project, options, events, active).finally(() => {
      if (this.active?.runId === runId) this.active = null
    })
    return { ok: true, runId }
  }

  cancel(runId: string): boolean {
    if (!this.active || this.active.runId !== runId) return false
    this.active.canceled = true
    this.active.cancelCurrent?.()
    return true
  }

  async stop(project: ComposeProject): Promise<ComposeActionResult> {
    if (this.active) return { ok: false, message: 'A compose operation is already running.' }
    const containers = await this.projectContainers(project)
    if ('message' in containers) return { ok: false, message: containers.message }
    const ids = containers.containers
      .filter((container) => container.state === 'running')
      .map((container) => container.id)
    if (ids.length === 0) return { ok: true }
    const result = await runCli(['stop', ...ids], { env: this.env, timeoutMs: 60_000 })
    if (result.spawnError || result.timedOut || result.code !== 0) {
      return { ok: false, message: failureMessage(result, 'stop') }
    }
    return { ok: true }
  }

  async down(
    project: ComposeProject,
    options: { removeVolumes?: boolean } = {}
  ): Promise<ComposeActionResult> {
    if (this.active) return { ok: false, message: 'A compose operation is already running.' }
    const containers = await this.projectContainers(project)
    if ('message' in containers) return { ok: false, message: containers.message }
    const ids = containers.containers.map((container) => container.id)
    const running = containers.containers
      .filter((container) => container.state === 'running')
      .map((container) => container.id)
    if (ids.length > 0) {
      if (running.length > 0) {
        await runCli(['stop', ...running], { env: this.env, timeoutMs: 60_000 })
      }
      const deleted = await runCli(['delete', '--force', ...ids], {
        env: this.env,
        timeoutMs: 60_000
      })
      if (deleted.spawnError || deleted.timedOut || deleted.code !== 0) {
        return { ok: false, message: failureMessage(deleted, 'delete containers') }
      }
    }
    const failures: string[] = []
    const networks = await this.listNames(['network', 'list', '--format', 'json'])
    if (networks.includes(project.network)) {
      const network = await runCli(['network', 'delete', project.network], {
        env: this.env,
        timeoutMs: 30_000
      })
      if (network.spawnError || network.timedOut || network.code !== 0) {
        failures.push(failureMessage(network, `network ${project.network}`))
      }
    }
    if (options.removeVolumes && project.namedVolumes.length > 0) {
      const volumes = await this.listNames(['volume', 'list', '--format', 'json'])
      for (const volume of project.namedVolumes) {
        if (!volumes.includes(volume)) continue
        const result = await runCli(['volume', 'delete', volume], {
          env: this.env,
          timeoutMs: 30_000
        })
        if (result.spawnError || result.timedOut || result.code !== 0) {
          failures.push(failureMessage(result, `volume ${volume}`))
        }
      }
    }
    return failures.length > 0
      ? { ok: false, message: `Containers removed, but cleanup failed: ${failures.join('; ')}` }
      : { ok: true }
  }

  async logs(
    project: ComposeProject,
    serviceName: string,
    events: ComposeRunnerEvents
  ): Promise<ComposeActionResult> {
    this.stopLogs()
    const containers = await this.projectContainers(project)
    if ('message' in containers) return { ok: false, message: containers.message }
    const service = project.services.find((item) => item.name === serviceName)
    if (!service) return { ok: false, message: `Unknown service: ${serviceName}` }
    const container =
      containers.containers.find(
        (item) => item.labels['com.aiu.compose.service'] === serviceName
      ) ?? containers.containers.find((item) => item.id === service.containerName)
    if (!container) {
      return { ok: false, message: `Service ${serviceName} has no container. Run Up first.` }
    }
    const handle = streamCli(
      ['logs', '-n', '200', '-f', container.id],
      { env: this.env },
      (stream, line) => events.onLog({ service: serviceName, stream, line })
    )
    this.log = { handle, service: serviceName }
    void handle.done.then(() => {
      if (this.log?.handle === handle) this.log = null
    })
    return { ok: true }
  }

  stopLogs(): void {
    this.log?.handle.cancel()
    this.log = null
  }

  private async up(
    project: ComposeProject,
    options: { forceBuild?: boolean },
    events: ComposeRunnerEvents,
    active: ActiveRun
  ): Promise<void> {
    const emit = (service: string | undefined, stream: 'stdout' | 'stderr', line: string): void =>
      events.onOutput({ runId: active.runId, service, stream, line })

    try {
      const alias = await this.aliasEnabled()
      emit(undefined, 'stdout', `Project ${project.name} (${project.file})`)
      await this.ensureNetwork(project, emit)
      await this.ensureVolumes(project, emit)

      for (const service of project.services) {
        if (active.canceled) throw new Canceled()
        await this.ensureImage(project, service, Boolean(options.forceBuild), active, events)
        if (active.canceled) throw new Canceled()
        await this.prepareContainer(project, service, emit)
        if (active.canceled) throw new Canceled()
        await this.runContainer(project, service, alias, active, events)
      }

      events.onDone({ runId: active.runId, action: 'up', ok: true })
    } catch (error) {
      const canceled = active.canceled || error instanceof Canceled
      events.onDone({
        runId: active.runId,
        action: 'up',
        ok: false,
        message: canceled
          ? 'Canceled. Containers already started may still be running; use Down to clean up.'
          : `${
              error instanceof Error ? error.message : String(error)
            } Some resources may remain; use Down to clean up.`
      })
    }
  }

  private async aliasEnabled(): Promise<boolean> {
    if (!this.aliasSupport) {
      this.aliasSupport = detectNetworkAliasSupport(this.env).catch(() => false)
    }
    return this.aliasSupport
  }

  private async ensureNetwork(
    project: ComposeProject,
    emit: (service: string | undefined, stream: 'stdout' | 'stderr', line: string) => void
  ): Promise<void> {
    const names = await this.listNames(['network', 'list', '--format', 'json'])
    if (names.includes(project.network)) return
    emit(undefined, 'stdout', `Creating network ${project.network}`)
    const result = await runCli(
      ['network', 'create', '--label', `com.aiu.compose.project=${project.name}`, project.network],
      { env: this.env, timeoutMs: 30_000 }
    )
    if (result.spawnError || result.timedOut || result.code !== 0) {
      throw new Error(failureMessage(result, 'create network'))
    }
  }

  private async ensureVolumes(
    project: ComposeProject,
    emit: (service: string | undefined, stream: 'stdout' | 'stderr', line: string) => void
  ): Promise<void> {
    if (project.namedVolumes.length === 0) return
    const names = await this.listNames(['volume', 'list', '--format', 'json'])
    for (const volume of project.namedVolumes) {
      if (names.includes(volume)) continue
      emit(undefined, 'stdout', `Creating volume ${volume}`)
      const result = await runCli(
        ['volume', 'create', '--label', `com.aiu.compose.project=${project.name}`, volume],
        { env: this.env, timeoutMs: 30_000 }
      )
      if (result.spawnError || result.timedOut || result.code !== 0) {
        throw new Error(failureMessage(result, 'create volume'))
      }
    }
  }

  private async ensureImage(
    project: ComposeProject,
    service: ComposeService,
    forceBuild: boolean,
    active: ActiveRun,
    events: ComposeRunnerEvents
  ): Promise<void> {
    const req = buildRequest(project, service)
    if (!req) return
    if (!forceBuild && (await this.imageExists(req.tag))) return

    events.onOutput({
      runId: active.runId,
      service: service.name,
      stream: 'stdout',
      line: `Building ${req.tag}`
    })
    await new Promise<void>((resolve, reject) => {
      const started = this.buildManager.start(req, {
        onLine: (_runId, line) =>
          events.onOutput({
            runId: active.runId,
            service: service.name,
            stream: line.stream,
            line: line.line
          }),
        onDone: (_runId, done) => {
          active.cancelCurrent = undefined
          if (done.canceled) reject(new Canceled())
          else if (done.error) reject(new Error(`${service.name}: ${done.error.message}`))
          else resolve()
        }
      })
      if (started.ok === false) {
        reject(new Error(started.error.message))
        return
      }
      active.cancelCurrent = () => this.buildManager.cancel(started.runId)
    })
  }

  private async prepareContainer(
    project: ComposeProject,
    service: ComposeService,
    emit: (service: string | undefined, stream: 'stdout' | 'stderr', line: string) => void
  ): Promise<void> {
    const containers = await listContainers(false, { env: this.env })
    if ('error' in containers) throw new Error(containers.error.message)
    const existing = containers.containers.find((item) => item.id === service.containerName)
    if (!existing) return

    const owner = existing.labels['com.aiu.compose.project']
    if (owner && owner !== project.name) {
      throw new Error(
        `Container ${service.containerName} already exists and belongs to project ${owner}.`
      )
    }
    if (!owner) {
      throw new Error(
        `Container ${service.containerName} already exists outside this project; remove it first.`
      )
    }
    emit(service.name, 'stdout', `Replacing existing container ${service.containerName}`)
    await runCli(['stop', service.containerName], { env: this.env, timeoutMs: 30_000 })
    const deleted = await runCli(['delete', '--force', service.containerName], {
      env: this.env,
      timeoutMs: 30_000
    })
    if (deleted.spawnError || deleted.timedOut || deleted.code !== 0) {
      throw new Error(failureMessage(deleted, 'replace container'))
    }
  }

  private async runContainer(
    project: ComposeProject,
    service: ComposeService,
    alias: boolean,
    active: ActiveRun,
    events: ComposeRunnerEvents
  ): Promise<void> {
    let lastStderr = ''
    const handle = streamCli(
      runArgv(project, service, { supportsNetworkAliases: alias }),
      { env: this.env },
      (stream, line) => {
        if (stream === 'stderr' && line.trim()) lastStderr = line.trim()
        events.onOutput({ runId: active.runId, service: service.name, stream, line })
      }
    )
    active.cancelCurrent = () => handle.cancel()
    const result = await handle.done
    active.cancelCurrent = undefined
    if (active.canceled || result.canceled) throw new Canceled()
    if (result.spawnError) throw new Error(`${service.name}: ${result.spawnError.message}`)
    if (result.code !== 0) {
      throw new Error(
        `${service.name}: ${lastStderr || `container run exited with code ${result.code}`}`
      )
    }
  }

  private async projectContainers(
    project: ComposeProject
  ): Promise<{ ok: true; containers: ContainerSummary[] } | { ok: false; message: string }> {
    const result = await listContainers(false, { env: this.env })
    if ('error' in result) return { ok: false, message: result.error.message }
    return {
      ok: true,
      containers: result.containers.filter(
        (container) => container.labels['com.aiu.compose.project'] === project.name
      )
    }
  }

  private async listNames(args: string[]): Promise<string[]> {
    const result = await runCli(args, { env: this.env, timeoutMs: 10_000 })
    if (result.spawnError || result.timedOut || result.code !== 0) {
      throw new Error(failureMessage(result, args[0]))
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return ''
        const record = entry as Record<string, unknown>
        const configuration =
          typeof record.configuration === 'object' && record.configuration !== null
            ? (record.configuration as Record<string, unknown>)
            : {}
        return String(configuration.name ?? record.id ?? '')
      })
      .filter(Boolean)
  }

  private async imageExists(tag: string): Promise<boolean> {
    const result = await runCli(['image', 'inspect', tag], { env: this.env, timeoutMs: 10_000 })
    return !result.spawnError && !result.timedOut && result.code === 0
  }
}

function failureMessage(result: CliRunResult, action: string): string {
  if (result.spawnError) return `${action} failed: ${result.spawnError.message}`
  if (result.timedOut) return `${action} timed out.`
  const stderr = result.stderr.trim()
  return stderr || `${action} exited with code ${result.code ?? 'unknown'}.`
}
