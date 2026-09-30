import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface CliRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  spawnError: NodeJS.ErrnoException | null
  timedOut: boolean
}

export interface CliStreamResult extends CliRunResult {
  canceled: boolean
}

export interface StreamHandle {
  pid: number | undefined
  cancel(): void
  done: Promise<CliStreamResult>
}

const FALLBACK_PATHS = ['/usr/local/bin/container', '/opt/homebrew/bin/container']

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findContainerBinary(env: NodeJS.ProcessEnv = process.env, includeFallbacks = env === process.env): string | null {
  // Explicit override wins over PATH and fallbacks, but only when it is
  // actually executable; anything else yields null here, which the caller
  // turns into the CLI-missing state (ENOENT).
  if (env.CONTAINER_BIN) {
    return isExecutable(env.CONTAINER_BIN) ? env.CONTAINER_BIN : null
  }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'container')
    if (isExecutable(candidate)) return candidate
  }
  if (includeFallbacks) {
    for (const candidate of FALLBACK_PATHS) {
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function missingResult(): CliRunResult {
  return {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    spawnError: Object.assign(new Error('container not found'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
    timedOut: false
  }
}

export function runCli(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<CliRunResult> {
  const env = opts.env ?? process.env
  const bin = findContainerBinary(env)
  if (!bin) return Promise.resolve(missingResult())
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError: NodeJS.ErrnoException | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, spawnError, timedOut })
    }
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, opts.timeoutMs)
        : undefined
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => finish(null, null, err as NodeJS.ErrnoException))
    child.on('close', (code, signal) => finish(code, signal, null))
  })
}

export function streamCli(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv },
  onLine: (stream: 'stdout' | 'stderr', line: string) => void
): StreamHandle {
  const env = opts.env ?? process.env
  const bin = findContainerBinary(env)
  if (!bin) {
    return {
      pid: undefined,
      cancel: () => {},
      done: Promise.resolve({ ...missingResult(), canceled: false })
    }
  }
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let canceled = false
  let killTimer: NodeJS.Timeout | undefined
  const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
  const emitLines = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    buffers[stream] += chunk.toString()
    const parts = buffers[stream].split('\n')
    buffers[stream] = parts.pop() ?? ''
    for (const line of parts) onLine(stream, line)
  }
  child.stdout.on('data', (d: Buffer) => emitLines('stdout', d))
  child.stderr.on('data', (d: Buffer) => emitLines('stderr', d))
  const done = new Promise<CliStreamResult>((resolve) => {
    child.on('error', (err) =>
      resolve({ ...missingResult(), spawnError: err as NodeJS.ErrnoException, canceled })
    )
    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer)
      for (const stream of ['stdout', 'stderr'] as const) {
        if (buffers[stream]) {
          onLine(stream, buffers[stream])
          buffers[stream] = ''
        }
      }
      resolve({ code, signal, stdout: '', stderr: '', spawnError: null, timedOut: false, canceled })
    })
  })
  return {
    pid: child.pid,
    cancel: () => {
      canceled = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
    },
    done
  }
}

export function isVersionAtLeast(version: string, min: string): boolean {
  const pa = version.split('.').map((n) => parseInt(n, 10))
  const pb = min.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? 0
    const b = pb[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

export async function getCliVersion(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ path: string; version: string | null } | null> {
  const path = findContainerBinary(env)
  if (!path) return null
  const r = await runCli(['--version'], { env, timeoutMs: 5000 })
  const m = r.stdout.match(/version\s+(\d+\.\d+(?:\.\d+)?)/i)
  return { path, version: m ? m[1] : null }
}
