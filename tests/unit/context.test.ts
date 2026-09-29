import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDockerfile } from '../../src/main/context'

describe('findDockerfile', () => {
  it('prefers Dockerfile over Containerfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    writeFileSync(join(dir, 'Containerfile'), 'FROM alpine')
    writeFileSync(join(dir, 'Dockerfile'), 'FROM alpine')
    expect(findDockerfile(dir)).toEqual({ dockerfile: 'Dockerfile' })
  })

  it('falls back to Containerfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    writeFileSync(join(dir, 'Containerfile'), 'FROM alpine')
    expect(findDockerfile(dir)).toEqual({ dockerfile: 'Containerfile' })
  })

  it('returns null when neither exists or the dir does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    expect(findDockerfile(dir)).toEqual({ dockerfile: null })
    expect(findDockerfile('/definitely/not/here')).toEqual({ dockerfile: null })
  })
})
