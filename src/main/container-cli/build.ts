import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { classifyCliFailure } from '../../shared/errors'
import type { BuildDoneEvent, BuildLine, BuildRequest, BuildStartResult } from '../../shared/types'
import { streamCli, type StreamHandle } from './cli'

export const TAG_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/

export function validateBuildRequest(req: BuildRequest): string[] {
  const problems: string[] = []
  if (!req.contextDir) {
    problems.push('Choose a build context directory.')
  } else if (!existsSync(req.contextDir) || !statSync(req.contextDir).isDirectory()) {
    problems.push(`Build context is not a directory: ${req.contextDir}`)
  }
  if (!req.tag) {
    problems.push('Image tag is required.')
  } else if (!TAG_PATTERN.test(req.tag)) {
    problems.push('Tag must be lowercase: letters, numbers, periods, dashes, underscores, slashes, colons.')
  }
  return problems
}

export function buildArgv(req: BuildRequest): string[] {
  const args = ['build', '-t', req.tag]
  if (req.dockerfilePath) {
    // The real CLI resolves a relative -f against its cwd, not the context, so
    // anchor it to the context dir ourselves.
    const dockerfile = isAbsolute(req.dockerfilePath)
      ? req.dockerfilePath
      : join(req.contextDir, req.dockerfilePath)
    args.push('-f', dockerfile)
  }
  for (const a of req.buildArgs) args.push('--build-arg', `${a.key}=${a.value}`)
  if (req.target) args.push('--target', req.target)
  if (req.noCache) args.push('--no-cache')
  if (req.platform) args.push('--platform', req.platform)
  args.push(req.contextDir)
  return args
}

export interface BuildEvents {
  onLine(runId: string, line: BuildLine): void
  onDone(runId: string, done: Omit<BuildDoneEvent, 'runId'>): void
}

export class BuildManager {
  private active: { runId: string; handle: StreamHandle } | null = null

  constructor(private readonly opts: { env?: NodeJS.ProcessEnv } = {}) {}

  get activeRunId(): string | null {
    return this.active?.runId ?? null
  }

  start(req: BuildRequest, events: BuildEvents): BuildStartResult {
    if (this.active) {
      return { ok: false, error: { code: 'CLI_ERROR', message: 'A build is already running.' } }
    }
    const problems = validateBuildRequest(req)
    if (problems.length > 0) {
      return { ok: false, error: { code: 'CLI_ERROR', message: problems.join(' ') } }
    }
    const runId = randomUUID()
    let lastStderr = ''
    const handle = streamCli(buildArgv(req), { env: this.opts.env }, (stream, line) => {
      if (stream === 'stderr' && line.trim()) lastStderr = line.trim()
      events.onLine(runId, { stream, line })
    })
    this.active = { runId, handle }
    void handle.done.then((r) => {
      this.active = null
      const done: Omit<BuildDoneEvent, 'runId'> = {
        code: r.code,
        signal: r.signal,
        canceled: r.canceled
      }
      if (!r.canceled) {
        if (r.spawnError) {
          done.error = classifyCliFailure({
            spawnError: r.spawnError,
            exitCode: r.code,
            stderr: lastStderr,
            timedOut: r.timedOut
          })
        } else if (r.code !== 0) {
          done.error = {
            code: 'BUILD_FAILED',
            message: lastStderr || `Build failed (exit ${r.code ?? 'unknown'})`,
            exitCode: r.code
          }
        }
      }
      events.onDone(runId, done)
    })
    return { ok: true, runId }
  }

  cancel(runId: string): boolean {
    if (!this.active || this.active.runId !== runId) return false
    this.active.handle.cancel()
    return true
  }
}
