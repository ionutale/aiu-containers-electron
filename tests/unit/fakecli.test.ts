import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeCli } from '../helpers/fakeCli'

function run(fake: ReturnType<typeof makeFakeCli>, args: string[]): string {
  return execFileSync(join(fake.binDir, 'container'), args, { env: fake.env }).toString()
}

describe('fake container CLI', () => {
  it('lists only running containers by default and all with --all', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    expect(JSON.parse(run(fake, ['list', '--format', 'json']))).toHaveLength(1)
    expect(JSON.parse(run(fake, ['list', '--all', '--format', 'json']))).toHaveLength(2)
  })

  it('emits the real service-not-running stderr in service-down mode', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')), { mode: 'service-down' })
    try {
      run(fake, ['list', '--format', 'json'])
      expect.unreachable('should have exited non-zero')
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr)).toContain('container system service has been started')
    }
  })

  it('reports version and system status', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    expect(run(fake, ['--version'])).toContain('0.10.0')
    const status = JSON.parse(run(fake, ['system', 'status', '--format', 'json']))
    expect(status.status).toBe('running')
    expect(status.resources.containersRunning).toBe(1)
  })
})
