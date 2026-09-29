import { describe, expect, it } from 'vitest'
import { classifyCliFailure } from '../../src/shared/errors'

const SERVICE_DOWN = `Error: internalError: "failed to list containers" (cause: "interrupted: "XPC connection error: Connection invalid"") Ensure container system service has been started with 'container system start'.`

describe('classifyCliFailure', () => {
  it('maps spawn ENOENT to CLI_MISSING', () => {
    const err = Object.assign(new Error('spawn container ENOENT'), { code: 'ENOENT' })
    expect(classifyCliFailure({ spawnError: err }).code).toBe('CLI_MISSING')
  })

  it('maps the XPC/service stderr to SERVICE_NOT_RUNNING', () => {
    const info = classifyCliFailure({ exitCode: 1, stderr: SERVICE_DOWN })
    expect(info.code).toBe('SERVICE_NOT_RUNNING')
  })

  it('maps other non-zero exits to CLI_ERROR with stderr as message', () => {
    const info = classifyCliFailure({ exitCode: 125, stderr: 'boom' })
    expect(info.code).toBe('CLI_ERROR')
    expect(info.message).toBe('boom')
    expect(info.exitCode).toBe(125)
  })

  it('maps timeouts to CLI_ERROR mentioning timeout', () => {
    const info = classifyCliFailure({ timedOut: true, exitCode: null })
    expect(info.code).toBe('CLI_ERROR')
    expect(info.message).toMatch(/timed out/i)
  })
})
