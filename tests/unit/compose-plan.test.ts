import { describe, expect, it } from 'vitest'
import type { ComposeProject, ComposeService } from '../../src/shared/compose'
import {
  buildRequest,
  hasAliasSupport,
  imageTag,
  projectLabels,
  runArgv
} from '../../src/main/compose/plan'

const service: ComposeService = {
  name: 'web',
  image: 'nginx:alpine',
  containerName: 'demo-web',
  environment: [
    { key: 'A', value: '1' },
    { key: 'B', value: 'two words' }
  ],
  ports: [{ raw: '8080:80', hostPort: 8080, containerPort: 80, protocol: 'tcp' }],
  volumes: [
    { raw: '/host:/data:ro', type: 'bind', source: '/host', target: '/data', readOnly: true },
    {
      raw: 'demo_data:/var/lib/data',
      type: 'volume',
      source: 'demo_data',
      target: '/var/lib/data',
      readOnly: false
    }
  ],
  dependsOn: [],
  workingDir: '/app',
  user: '1000:1000',
  platform: 'linux/arm64',
  command: ['sh', '-c', 'echo hi']
}

const project: ComposeProject = {
  name: 'demo',
  file: '/projects/demo/compose.yaml',
  dir: '/projects/demo',
  network: 'demo_default',
  namedVolumes: ['demo_data'],
  services: [service],
  warnings: []
}

describe('runArgv', () => {
  it('maps containers, env, ports, mounts and process options', () => {
    expect(runArgv(project, service)).toEqual([
      'run',
      '-d',
      '--name',
      'demo-web',
      '--network',
      'demo_default',
      '--label',
      'com.aiu.compose.project=demo',
      '--label',
      'com.aiu.compose.service=web',
      '--label',
      'com.aiu.compose.file=/projects/demo/compose.yaml',
      '-e',
      'A=1',
      '-e',
      'B=two words',
      '-p',
      '8080:80',
      '-v',
      '/host:/data:ro',
      '-v',
      'demo_data:/var/lib/data',
      '-w',
      '/app',
      '-u',
      '1000:1000',
      '--platform',
      'linux/arm64',
      'nginx:alpine',
      'sh',
      '-c',
      'echo hi'
    ])
  })

  it('adds a network alias only when the runtime supports it', () => {
    const withAlias = runArgv(project, service, { supportsNetworkAliases: true })
    expect(withAlias.slice(4, 6)).toEqual(['--network', 'demo_default,alias=web'])
  })

  it('splits entrypoint: the executable is the flag, the rest is argv', () => {
    const withEntrypoint = runArgv(project, {
      ...service,
      entrypoint: ['/bin/sh', '-c'],
      command: ['echo hi']
    })
    expect(withEntrypoint.slice(-5)).toEqual([
      '--entrypoint',
      '/bin/sh',
      'nginx:alpine',
      '-c',
      'echo hi'
    ])
    expect(withEntrypoint.at(-1)).toBe('echo hi')
  })
})

describe('buildRequest', () => {
  it('uses the image tag when present and maps build fields', () => {
    const req = buildRequest(project, {
      ...service,
      build: {
        context: '/projects/demo/app',
        dockerfile: 'Dockerfile.dev',
        args: [{ key: 'V', value: '1' }],
        target: 'dev',
        platform: 'linux/arm64'
      }
    })
    expect(req).toEqual({
      contextDir: '/projects/demo/app',
      dockerfilePath: 'Dockerfile.dev',
      tag: 'nginx:alpine',
      buildArgs: [{ key: 'V', value: '1' }],
      target: 'dev',
      noCache: false,
      platform: 'linux/arm64'
    })
  })

  it('generates project-service tags and returns null without a build', () => {
    expect(imageTag(project, { ...service, image: undefined })).toBe('demo-web')
    expect(buildRequest(project, service)).toBeNull()
  })
})

describe('labels and capability', () => {
  it('labels every resource with project, service and file', () => {
    expect(projectLabels(project, service)).toEqual([
      { key: 'com.aiu.compose.project', value: 'demo' },
      { key: 'com.aiu.compose.service', value: 'web' },
      { key: 'com.aiu.compose.file', value: '/projects/demo/compose.yaml' }
    ])
  })

  it('detects network alias support from run help', () => {
    expect(hasAliasSupport('--network <network> format: <name>[,alias=<alias>]')).toBe(true)
    expect(hasAliasSupport('--network <network> format: <name>[,mac=..]')).toBe(false)
  })
})
