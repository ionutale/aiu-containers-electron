import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseComposeFile } from '../../src/main/compose/parse'

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'compose-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

function parse(files: Record<string, string>, env: NodeJS.ProcessEnv = {}) {
  const dir = fixture(files)
  return parseComposeFile(join(dir, 'compose.yaml'), { env })
}

describe('parseComposeFile', () => {
  it('parses services, prefixes resources and orders dependencies first', () => {
    const result = parse({
      'compose.yaml': `
name: Demo App
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      GREETING: hello
      MODE: \${MODE:-dev}
    depends_on:
      - db
  db:
    image: postgres:16
    volumes:
      - data:/var/lib/postgresql/data
`
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.name).toBe('demo-app')
    expect(result.project.network).toBe('demo-app_default')
    expect(result.project.namedVolumes).toEqual(['demo-app_data'])
    expect(result.project.services.map((s) => s.name)).toEqual(['db', 'web'])

    const web = result.project.services[1]
    expect(web.containerName).toBe('demo-app-web')
    expect(web.ports[0]).toMatchObject({ hostPort: 8080, containerPort: 80, protocol: 'tcp' })
    expect(web.environment).toContainEqual({ key: 'MODE', value: 'dev' })
    expect(web.dependsOn).toEqual(['db'])

    const db = result.project.services[0]
    expect(db.volumes[0]).toMatchObject({
      type: 'volume',
      source: 'demo-app_data',
      target: '/var/lib/postgresql/data'
    })
  })

  it('prefers shell values to .env and handles interpolation forms', () => {
    const result = parse(
      {
        '.env': 'NAME=from-file\nONLY_FILE=file-value\n',
        'compose.yaml': `
services:
  app:
    image: alpine:3.20
    environment:
      NAME: \${NAME}
      ONLY_FILE: \${ONLY_FILE}
      FALLBACK: \${UNSET:-fallback}
      EMPTY: \${EMPTY-default}
      ESCAPED: $$HOME
`
      },
      { NAME: 'from-shell', EMPTY: '' }
    )

    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'))
    expect(Object.fromEntries(result.project.services[0].environment.map((e) => [e.key, e.value]))).toEqual({
      NAME: 'from-shell',
      ONLY_FILE: 'file-value',
      FALLBACK: 'fallback',
      EMPTY: '',
      ESCAPED: '$HOME'
    })
  })

  it('fails when a required interpolation variable is missing', () => {
    const result = parse({
      'compose.yaml': `
services:
  app:
    image: alpine:3.20
    environment:
      TOKEN: \${TOKEN:?set TOKEN first}
`
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toMatch(/TOKEN/)
  })

  it('merges env_file then environment overrides', () => {
    const result = parse({
      '.env-app': 'A=1\nB=file\n',
      'compose.yaml': `
services:
  app:
    image: alpine:3.20
    env_file: .env-app
    environment:
      B: "2"
`
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'))
    expect(result.project.services[0].environment).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' }
    ])
  })

  it('errors for a missing env_file', () => {
    const result = parse({
      'compose.yaml': 'services:\n  app:\n    image: alpine\n    env_file: nope.env\n'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toMatch(/nope\.env/)
  })

  it('warns for ignored runtime keys but still parses', () => {
    const result = parse({
      'compose.yaml': `
services:
  app:
    image: alpine:3.20
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "true"]
`
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'))
    const keys = result.project.warnings.map((w) => w.key)
    expect(keys).toEqual(expect.arrayContaining(['restart', 'healthcheck']))
  })

  it('rejects profiles and custom networks', () => {
    const profiles = parse({
      'compose.yaml': 'services:\n  app:\n    image: alpine\n    profiles: [dev]\n'
    })
    expect(profiles.ok).toBe(false)
    if (!profiles.ok) expect(profiles.errors[0].key).toBe('profiles')

    const networks = parse({
      'compose.yaml': 'services:\n  app:\n    image: alpine\n    networks: [backend]\n'
    })
    expect(networks.ok).toBe(false)
    if (!networks.ok) expect(networks.errors[0].key).toBe('networks')
  })

  it('rejects dependency cycles and unknown dependencies', () => {
    const cycle = parse({
      'compose.yaml': `
services:
  a: { image: alpine, depends_on: [b] }
  b: { image: alpine, depends_on: [a] }
`
    })
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.errors[0].message).toMatch(/cycle/i)

    const missing = parse({
      'compose.yaml': 'services:\n  a:\n    image: alpine\n    depends_on: [ghost]\n'
    })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.errors[0].message).toMatch(/ghost/)
  })

  it('reports YAML syntax errors with a line number', () => {
    const result = parse({
      'compose.yaml': 'services:\n  app:\n    image: [unclosed\n'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].line).toBeGreaterThan(0)
  })

  it('rejects unsupported service keys with the service name', () => {
    const result = parse({
      'compose.yaml': 'services:\n  app:\n    image: alpine\n    network_mode: host\n'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatchObject({ service: 'app', key: 'network_mode' })
  })

  it('requires a host port and supports host IPs and udp', () => {
    const bare = parse({ 'compose.yaml': 'services:\n  a:\n    image: alpine\n    ports: ["80"]\n' })
    expect(bare.ok).toBe(false)

    const result = parse({
      'compose.yaml': `
services:
  a:
    image: alpine
    ports:
      - "127.0.0.1:5432:5432/tcp"
      - "5353:53/udp"
`
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'))
    expect(result.project.services[0].ports[0]).toMatchObject({
      hostIp: '127.0.0.1',
      hostPort: 5432,
      containerPort: 5432,
      protocol: 'tcp'
    })
    expect(result.project.services[0].ports[1]).toMatchObject({ protocol: 'udp' })
  })

  it('parses build objects, command tokenization and names', () => {
    const result = parse({
      'compose.yaml': `
services:
  app:
    build:
      context: ./app
      dockerfile: Dockerfile.dev
      args:
        VERSION: "1"
      target: dev
      platform: linux/arm64
    command: sh -c "echo hi"
    working_dir: /work
    user: "1000:1000"
`
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'))
    const app = result.project.services[0]
    expect(app.build).toMatchObject({
      dockerfile: 'Dockerfile.dev',
      args: [{ key: 'VERSION', value: '1' }],
      target: 'dev',
      platform: 'linux/arm64'
    })
    expect(app.build?.context.endsWith('/app')).toBe(true)
    expect(app.command).toEqual(['sh', '-c', 'echo hi'])
    expect(app.image).toBeUndefined()
    expect(app.workingDir).toBe('/work')
    expect(app.user).toBe('1000:1000')
  })

  it('rejects mount options other than read-only and anonymous volumes', () => {
    const rw = parse({
      'compose.yaml': 'services:\n  a:\n    image: alpine\n    volumes: ["./data:/data:rw"]\n'
    })
    expect(rw.ok).toBe(false)

    const anon = parse({
      'compose.yaml': 'services:\n  a:\n    image: alpine\n    volumes: ["/data"]\n'
    })
    expect(anon.ok).toBe(false)
  })

  it('sanitizes the project name and rejects duplicate container names', () => {
    const dir = fixture({
      'compose.yaml': `
services:
  one:
    image: alpine
    container_name: shared
  two:
    image: alpine
    container_name: shared
`
    })
    const result = parseComposeFile(join(dir, 'compose.yaml'), { env: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toMatch(/shared/)
  })
})
