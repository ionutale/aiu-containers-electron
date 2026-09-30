import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findContainerBinary, getCliVersion, isVersionAtLeast, runCli, streamCli } from '../../src/main/container-cli/cli'
import { makeFakeCli } from '../helpers/fakeCli'

const tmp = () => mkdtempSync(join(tmpdir(), 'cli-'))

describe('findContainerBinary', () => {
  it('finds the fake container through PATH', () => {
    const fake = makeFakeCli(tmp())
    expect(findContainerBinary(fake.env)).toBe(join(fake.binDir, 'container'))
  })

  it('returns null for a custom env with no CLI (fallbacks apply only to the real environment)', () => {
    expect(findContainerBinary({ PATH: '/nonexistent' })).toBeNull()
  })

  it('prefers an executable CONTAINER_BIN over PATH and fallbacks', () => {
    const fake = makeFakeCli(tmp())
    const bin = join(fake.binDir, 'container')
    expect(findContainerBinary({ ...fake.env, CONTAINER_BIN: bin })).toBe(bin)
  })

  it('ignores a non-executable CONTAINER_BIN so it surfaces as CLI_MISSING', () => {
    expect(findContainerBinary({ PATH: '/nonexistent', CONTAINER_BIN: '/nonexistent/container' })).toBeNull()
  })
})

describe('runCli', () => {
  it('captures stdout and exit code', async () => {
    const fake = makeFakeCli(tmp())
    const r = await runCli(['list', '--format', 'json'], { env: fake.env })
    expect(r.spawnError).toBeNull()
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toHaveLength(1)
  })

  it('reports ENOENT spawn error when the CLI is missing', async () => {
    const r = await runCli(['list'], { env: { PATH: '/nonexistent' } })
    expect(r.spawnError?.code).toBe('ENOENT')
  })

  it('reports timedOut when the CLI hangs past the timeout', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'blocking-build' })
    const r = await runCli(['build', '.'], { env: fake.env, timeoutMs: 200 })
    expect(r.timedOut).toBe(true)
  })
})

describe('streamCli', () => {
  it('delivers lines in order, then a done result', async () => {
    const fake = makeFakeCli(tmp())
    const lines: string[] = []
    const handle = streamCli(['build', '-t', 'x:latest', '.'], { env: fake.env }, (_stream, line) => lines.push(line))
    const result = await handle.done
    expect(result.code).toBe(0)
    expect(lines).toContain('fake: done')
    expect(lines[0]).toContain('fake build args')
  })

  it('cancel sends SIGTERM, resolves canceled, and leaves no process behind', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'blocking-build' })
    const started: string[] = []
    const handle = streamCli(['build', '.'], { env: fake.env }, (_s, line) => started.push(line))
    while (started.length === 0) await new Promise((r) => setTimeout(r, 10))
    const pid = handle.pid!
    handle.cancel()
    const result = await handle.done
    expect(result.canceled).toBe(true)
    expect(['SIGTERM', 'SIGKILL']).toContain(result.signal)
    expect(() => process.kill(pid, 0)).toThrow()
  })
})

describe('getCliVersion / isVersionAtLeast', () => {
  it('parses the version from --version output', async () => {
    const fake = makeFakeCli(tmp())
    const v = await getCliVersion(fake.env)
    expect(v?.version).toBe('0.10.0')
  })

  it('compares versions', () => {
    expect(isVersionAtLeast('0.10.0', '0.10.0')).toBe(true)
    expect(isVersionAtLeast('0.9.0', '0.10.0')).toBe(false)
    expect(isVersionAtLeast('1.0.0', '0.10.0')).toBe(true)
  })
})
