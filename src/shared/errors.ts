import type { CliErrorInfo } from './types'

const SERVICE_DOWN_PATTERNS = [
  'container system service has been started',
  'XPC connection error',
  'Connection invalid'
]

export function classifyCliFailure(input: {
  spawnError?: NodeJS.ErrnoException | null
  exitCode?: number | null
  stderr?: string
  timedOut?: boolean
}): CliErrorInfo {
  const stderr = (input.stderr ?? '').trim()
  if (input.spawnError?.code === 'ENOENT') {
    return {
      code: 'CLI_MISSING',
      message:
        "The `container` CLI was not found. Install Apple's container runtime, then restart the app.",
      stderr
    }
  }
  if (SERVICE_DOWN_PATTERNS.some((p) => stderr.includes(p))) {
    return {
      code: 'SERVICE_NOT_RUNNING',
      message: 'The container service is not running.',
      exitCode: input.exitCode ?? null,
      stderr
    }
  }
  if (input.timedOut) {
    return { code: 'CLI_ERROR', message: 'The container command timed out.', stderr }
  }
  if (input.exitCode !== null && input.exitCode !== undefined && input.exitCode !== 0) {
    return {
      code: 'CLI_ERROR',
      message: stderr || `container exited with code ${input.exitCode}`,
      exitCode: input.exitCode,
      stderr
    }
  }
  return { code: 'UNKNOWN', message: stderr || 'Unknown error', stderr }
}
