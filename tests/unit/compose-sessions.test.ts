import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ComposeSessions } from '../../src/main/compose/sessions'

function projectFile(compose: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'compose-session-'))
  const file = join(dir, 'compose.yaml')
  writeFileSync(file, compose)
  return file
}

const VALID = 'name: demo\nservices:\n  web:\n    image: nginx:latest\n'
const INVALID = 'name: demo\nservices:\n  web:\n    image: nginx:latest\n    profiles: [dev]\n'

describe('ComposeSessions', () => {
  it('remembers a parsed project and resolves it after the file turns invalid', () => {
    const file = projectFile(VALID)
    const sessions = new ComposeSessions()
    const inspected = sessions.inspect(file)
    expect('project' in inspected).toBe(true)

    writeFileSync(file, INVALID)
    expect(sessions.resolve(file, 'demo')).toMatchObject({ name: 'demo', file })
  })

  it('still resolves when the file is deleted', () => {
    const file = projectFile(VALID)
    const sessions = new ComposeSessions()
    sessions.inspect(file)
    writeFileSync(file, INVALID)

    expect(sessions.resolve(file, 'demo')?.services.map((service) => service.name)).toEqual(['web'])
  })

  it('returns null for an unknown invalid file', () => {
    const file = projectFile(INVALID)
    expect(new ComposeSessions().resolve(file, 'demo')).toBeNull()
  })

  it('keeps the started project for teardown until the file is inspected again', () => {
    const file = projectFile(VALID)
    const sessions = new ComposeSessions()
    sessions.inspect(file)

    writeFileSync(
      file,
      'name: demo\nservices:\n  web:\n    image: nginx:latest\n  api:\n    image: alpine:3.20\n'
    )
    expect(sessions.resolve(file, 'demo')?.services.map((service) => service.name)).toEqual(['web'])

    sessions.inspect(file)
    expect(sessions.resolve(file, 'demo')?.services.map((service) => service.name)).toEqual([
      'web',
      'api'
    ])
  })
})
