import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArgv, validateBuildRequest } from '../../src/main/container-cli/build'
import type { BuildRequest } from '../../src/shared/types'

const base = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  contextDir: mkdtempSync(join(tmpdir(), 'ctx-')),
  tag: 'app:latest',
  buildArgs: [],
  noCache: false,
  ...over
})

describe('validateBuildRequest', () => {
  it('accepts a minimal valid request', () => {
    expect(validateBuildRequest(base())).toEqual([])
  })

  it('rejects missing/non-directory contexts', () => {
    expect(validateBuildRequest(base({ contextDir: '/definitely/not/here' }))).not.toEqual([])
    expect(validateBuildRequest(base({ contextDir: '' }))).not.toEqual([])
  })

  it('rejects empty and non-lowercase tags', () => {
    expect(validateBuildRequest(base({ tag: '' }))).not.toEqual([])
    expect(validateBuildRequest(base({ tag: 'My App' }))).not.toEqual([])
    expect(validateBuildRequest(base({ tag: 'App:latest' }))).not.toEqual([])
  })

  it('accepts registry-style tags', () => {
    expect(validateBuildRequest(base({ tag: 'ghcr.io/me/app:1.2.3' }))).toEqual([])
  })
})

describe('buildArgv', () => {
  it('builds a minimal argv ending with the context dir', () => {
    const req = base({ contextDir: '/ctx' })
    expect(buildArgv(req)).toEqual(['build', '-t', 'app:latest', '/ctx'])
  })

  it('resolves a relative dockerfile path against the context dir', () => {
    const req = base({ contextDir: '/ctx', dockerfilePath: 'Dockerfile' })
    expect(buildArgv(req)).toEqual(['build', '-t', 'app:latest', '-f', '/ctx/Dockerfile', '/ctx'])
  })

  it('leaves an absolute dockerfile path untouched', () => {
    const req = base({ contextDir: '/ctx', dockerfilePath: '/ctx/Dockerfile.dev' })
    expect(buildArgv(req)).toEqual([
      'build',
      '-t',
      'app:latest',
      '-f',
      '/ctx/Dockerfile.dev',
      '/ctx'
    ])
  })

  it('includes every advanced option in a stable order', () => {
    const req = base({
      contextDir: '/ctx',
      dockerfilePath: '/ctx/Dockerfile.dev',
      buildArgs: [
        { key: 'A', value: '1' },
        { key: 'B', value: 'with space' }
      ],
      target: 'builder',
      noCache: true,
      platform: 'linux/amd64'
    })
    expect(buildArgv(req)).toEqual([
      'build',
      '-t',
      'app:latest',
      '-f',
      '/ctx/Dockerfile.dev',
      '--build-arg',
      'A=1',
      '--build-arg',
      'B=with space',
      '--target',
      'builder',
      '--no-cache',
      '--platform',
      'linux/amd64',
      '/ctx'
    ])
  })
})
