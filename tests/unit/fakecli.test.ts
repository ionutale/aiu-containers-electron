import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeCli } from '../helpers/fakeCli'

function run(fake: ReturnType<typeof makeFakeCli>, args: string[]): string {
  const result = spawnSync(join(fake.binDir, 'container'), args, { env: fake.env })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`fake container exited with status ${result.status}`) as Error & {
      stderr?: Buffer
    }
    error.stderr = result.stderr
    throw error
  }
  return result.stdout.toString()
}

describe('fake container CLI', () => {
  it('lists only running containers by default and all with --all', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    const running = JSON.parse(run(fake, ['list', '--format', 'json']))
    const all = JSON.parse(run(fake, ['list', '--all', '--format', 'json']))

    expect(running).toHaveLength(1)
    expect(running[0].configuration.id).toBe('web-1')
    expect(typeof running[0].status).toBe('string')
    expect(running[0].status).toBe('running')
    expect(running[0]).not.toHaveProperty('id')
    expect(running[0].networks[0]).toMatchObject({
      network: 'default',
      hostname: 'web-1',
      ipv4Address: '192.168.64.2/24',
      ipv4Gateway: '192.168.64.1'
    })
    expect(all).toHaveLength(2)
    expect(all.map((container: { status: string }) => container.status)).toEqual([
      'running',
      'stopped'
    ])
    expect(
      all.every(
        (container: { configuration: { id: string }; status: string }) =>
          Boolean(container.configuration.id) && typeof container.status === 'string'
      )
    ).toBe(true)
    expect(all[1].networks).toEqual([])
    expect(all[1].configuration.networks).toEqual([
      { network: 'default', options: { hostname: 'db-1' } }
    ])
  })

  it('emits the real service-not-running stderr in service-down mode', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')), { mode: 'service-down' })
    try {
      run(fake, ['list', '--format', 'json'])
      expect.unreachable('should have exited non-zero')
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr)).toContain(
        'container system service has been started'
      )
    }
  })

  it('reports version and system status', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    expect(run(fake, ['--version'])).toContain('0.10.0')
    const status = JSON.parse(run(fake, ['system', 'status', '--format', 'json']))
    expect(status.status).toBe('running')
    expect(status.apiServerVersion).toContain('0.10.0')
    expect(status).not.toHaveProperty('client')
    expect(status).not.toHaveProperty('resources')
  })

  it('mutates containers using configuration ids and string status', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))

    run(fake, ['create', '--name', 'created-1', 'docker.io/library/alpine:3.20'])
    expect(JSON.parse(run(fake, ['list', '--all', '--format', 'json'])).at(-1)).toMatchObject({
      status: 'stopped',
      configuration: { id: 'created-1' },
      networks: []
    })

    run(fake, ['start', 'created-1'])
    expect(
      JSON.parse(run(fake, ['list', '--format', 'json'])).map(
        (item: { configuration: { id: string } }) => item.configuration.id
      )
    ).toContain('created-1')
    run(fake, ['stop', 'created-1'])
    run(fake, ['prune'])
    expect(
      JSON.parse(run(fake, ['list', '--all', '--format', 'json'])).map(
        (item: { configuration: { id: string } }) => item.configuration.id
      )
    ).toEqual(['web-1'])

    run(fake, ['run', '-d', '--name', 'running-1', 'docker.io/library/alpine:3.20', 'sleep', '60'])
    run(fake, ['rm', 'running-1'])
    expect(
      JSON.parse(run(fake, ['list', '--all', '--format', 'json'])).map(
        (item: { configuration: { id: string } }) => item.configuration.id
      )
    ).toEqual(['web-1'])

    run(fake, ['create', 'docker.io/library/busybox:latest'])
    expect(JSON.parse(run(fake, ['list', '--all', '--format', 'json'])).at(-1)).toMatchObject({
      status: 'stopped',
      configuration: { id: 'busybox' }
    })
    run(fake, ['delete', '--force', 'busybox'])
    expect(
      JSON.parse(run(fake, ['list', '--all', '--format', 'json'])).map(
        (item: { configuration: { id: string } }) => item.configuration.id
      )
    ).toEqual(['web-1'])
  })
})
