import { classifyCliFailure } from '../../shared/errors'
import type { ActionResult, ListResult, SystemStatusResult } from '../../shared/types'
import { runCli, type CliRunResult } from './cli'
import { ParseError, parseContainerList, parseSystemStatus } from './parsers'

interface Opts {
  env?: NodeJS.ProcessEnv
}

function asFailureInput(r: CliRunResult): {
  spawnError: NodeJS.ErrnoException | null
  exitCode: number | null
  stderr: string
  timedOut: boolean
} {
  return { spawnError: r.spawnError, exitCode: r.code, stderr: r.stderr, timedOut: r.timedOut }
}

function parseErrorResult(err: unknown, excerpt: string): { code: 'PARSE_ERROR'; message: string; stderr: string } {
  return {
    code: 'PARSE_ERROR',
    message: err instanceof ParseError ? err.message : String(err),
    stderr: excerpt.slice(0, 400)
  }
}

export async function listContainers(runningOnly: boolean, opts: Opts = {}): Promise<ListResult> {
  const args = runningOnly ? ['list', '--format', 'json'] : ['list', '--all', '--format', 'json']
  const r = await runCli(args, { env: opts.env, timeoutMs: 10_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  try {
    return { ok: true, containers: parseContainerList(r.stdout) }
  } catch (err) {
    return { ok: false, error: parseErrorResult(err, r.stdout) }
  }
}

export async function systemStatus(opts: Opts = {}): Promise<SystemStatusResult> {
  const r = await runCli(['system', 'status', '--format', 'json'], { env: opts.env, timeoutMs: 10_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  try {
    return { ok: true, status: parseSystemStatus(r.stdout) }
  } catch (err) {
    return { ok: false, error: parseErrorResult(err, r.stdout) }
  }
}

export async function startSystem(opts: Opts = {}): Promise<ActionResult> {
  const r = await runCli(['system', 'start'], { env: opts.env, timeoutMs: 120_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  return { ok: true }
}
