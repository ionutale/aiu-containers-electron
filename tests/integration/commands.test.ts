import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listContainers, startSystem, systemStatus } from '../../src/main/container-cli/commands'
import { makeFakeCli } from '../helpers/fakeCli'

const tmp = () => mkdtempSync(join(tmpdir(), 'cmds-'))

describe('listContainers', () => {
  it('returns running containers by default', async () => {
    const fake = makeFakeCli(tmp())
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.containers.map((c) => c.id)).toEqual(['web-1'])
  })

  it('returns all containers when runningOnly is false', async () => {
    const fake = makeFakeCli(tmp())
    const result = await listContainers(false, { env: fake.env })
    if (result.ok) expect(result.containers.map((c) => c.id).sort()).toEqual(['db-1', 'web-1'])
  })

  it('maps the XPC error to SERVICE_NOT_RUNNING', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'service-down' })
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_NOT_RUNNING' } })
  })

  it('maps a missing binary to CLI_MISSING', async () => {
    const result = await listContainers(true, { env: { PATH: '/nonexistent' } })
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_MISSING' } })
  })

  it('maps a bad CONTAINER_BIN override to CLI_MISSING', async () => {
    const result = await listContainers(true, {
      env: { ...process.env, CONTAINER_BIN: '/nonexistent/container' }
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_MISSING' } })
  })

  it('maps malformed JSON to PARSE_ERROR with an excerpt', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'bad-json' })
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: false, error: { code: 'PARSE_ERROR' } })
  })
})

describe('systemStatus / startSystem', () => {
  it('returns parsed status', async () => {
    const fake = makeFakeCli(tmp())
    const result = await systemStatus({ env: fake.env })
    if (result.ok) {
      expect(result.status.status).toBe('running')
      expect(result.status.serverVersion).toContain('0.10.0')
    } else {
      expect.unreachable('status should parse')
    }
  })

  it('reports SERVICE_NOT_RUNNING from status too', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'service-down' })
    expect(await systemStatus({ env: fake.env })).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_NOT_RUNNING' }
    })
  })

  it('starts the service', async () => {
    const fake = makeFakeCli(tmp())
    expect(await startSystem({ env: fake.env })).toEqual({ ok: true })
  })
})
