import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BuildManager } from '../../src/main/container-cli/build'
import { runCli } from '../../src/main/container-cli/cli'
import { parseComposeFile } from '../../src/main/compose/parse'
import { ComposeRunner, type ComposeRunnerEvents } from '../../src/main/compose/runner'
import type {
  ComposeDoneEvent,
  ComposeLogEvent,
  ComposeOutputEvent,
  ComposeProject
} from '../../src/shared/compose'
import { makeFakeCli, type FakeCli, type FakeMode } from '../helpers/fakeCli'

interface FakeContainer {
  configuration: {
    id: string
    labels: Record<string, string>
    publishedPorts: { hostPort: number; containerPort: number; proto: string }[]
  }
  status: string
}

interface FakeState {
  networks: string[]
  volumes: string[]
  images: string[]
  extra: FakeContainer[]
  overrides: Record<string, { status: string }>
  deleted: string[]
}

interface ComposeContext {
  fake: FakeCli
  dir: string
  file: string
  project: ComposeProject
  runner: ComposeRunner
  outputs: ComposeOutputEvent[]
  logs: ComposeLogEvent[]
  done: Promise<ComposeDoneEvent>
  events: ComposeRunnerEvents
}

function projectWith(compose: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'compose-run-'))
  writeFileSync(join(dir, 'compose.yaml'), compose)
  writeFileSync(join(dir, 'Dockerfile'), 'FROM alpine:3.20\n')
  return { dir, file: join(dir, 'compose.yaml') }
}

function setup(compose: string, mode?: FakeMode): ComposeContext {
  const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'compose-cli-')), { mode })
  const { dir, file } = projectWith(compose)
  const parsed = parseComposeFile(file, { env: {} })
  if ('errors' in parsed) throw new Error(parsed.errors.map((e) => e.message).join('\n'))
  const runner = new ComposeRunner(new BuildManager({ env: fake.env }), { env: fake.env })
  const outputs: ComposeOutputEvent[] = []
  const logs: ComposeLogEvent[] = []
  let doneResolve: (event: ComposeDoneEvent) => void = () => {}
  const done = new Promise<ComposeDoneEvent>((resolve) => {
    doneResolve = resolve
  })
  const events = {
    onOutput: (event: ComposeOutputEvent) => outputs.push(event),
    onDone: (event: ComposeDoneEvent) => doneResolve(event),
    onLog: (event: ComposeLogEvent) => logs.push(event)
  }
  return { fake, dir, file, project: parsed.project, runner, outputs, logs, done, events }
}

function state(path: string): FakeState {
  return JSON.parse(readFileSync(path, 'utf8')) as FakeState
}

async function runUp(ctx: ComposeContext): Promise<ComposeDoneEvent> {
  return new Promise((resolve) => {
    const started = ctx.runner.startUp(
      ctx.project,
      {},
      {
        onOutput: ctx.events.onOutput,
        onLog: ctx.events.onLog,
        onDone: resolve
      }
    )
    if (started.ok === false) throw new Error(started.error.message)
  })
}

const TWO_SERVICES = `
name: demo
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    depends_on:
      - db
  db:
    image: postgres:16
    volumes:
      - data:/var/lib/postgresql/data
`

describe('ComposeRunner', () => {
  it('creates the network, volumes and containers in dependency order', async () => {
    const ctx = setup(TWO_SERVICES)
    const started = ctx.runner.startUp(ctx.project, {}, ctx.events)
    expect(started.ok).toBe(true)
    const done = await ctx.done

    expect(done).toMatchObject({ ok: true, action: 'up' })
    const saved = state(ctx.fake.statePath)
    expect(saved.networks).toEqual(['demo_default'])
    expect(saved.volumes).toEqual(['demo_data'])
    expect(saved.extra.map((c) => c.configuration.id)).toEqual(['demo-db', 'demo-web'])

    const web = saved.extra.find((c) => c.configuration.id === 'demo-web')
    expect(web.configuration.labels).toMatchObject({
      'com.aiu.compose.project': 'demo',
      'com.aiu.compose.service': 'web'
    })
    expect(web.configuration.publishedPorts[0]).toMatchObject({
      hostPort: 8080,
      containerPort: 80,
      proto: 'tcp'
    })
    expect(
      ctx.outputs.some((line) => line.service === 'web' && line.line.includes('demo-web'))
    ).toBe(true)
  })

  it('builds a service whose tag is missing, then runs it', async () => {
    const ctx = setup(`
name: demo
services:
  app:
    build: .
    environment:
      A: "1"
`)
    const started = ctx.runner.startUp(ctx.project, {}, ctx.events)
    expect(started.ok).toBe(true)
    expect(await ctx.done).toMatchObject({ ok: true })

    const saved = state(ctx.fake.statePath)
    expect(saved.images).toContain('demo-app')
    expect(saved.extra.map((c) => c.configuration.id)).toEqual(['demo-app'])
    expect(ctx.outputs.some((line) => line.line.includes('fake build args'))).toBe(true)
  })

  it('stops and tears down containers, network and optionally volumes', async () => {
    const ctx = setup(TWO_SERVICES)
    await runUp(ctx)

    expect(await ctx.runner.stop(ctx.project)).toEqual({ ok: true })
    let saved = state(ctx.fake.statePath)
    expect(saved.overrides['demo-web'].status).toBe('stopped')

    expect(await ctx.runner.down(ctx.project, { removeVolumes: false })).toEqual({ ok: true })
    saved = state(ctx.fake.statePath)
    expect(saved.networks).toEqual([])
    expect(saved.volumes).toEqual(['demo_data'])
    expect(saved.extra).toEqual([])

    await runUp(ctx)
    await ctx.runner.down(ctx.project, { removeVolumes: true })
    saved = state(ctx.fake.statePath)
    expect(saved.volumes).toEqual([])
  })

  it('refuses to delete a container that belongs to another project', async () => {
    const ctx = setup(TWO_SERVICES)
    const foreign = await runCli(
      [
        'run',
        '-d',
        '--name',
        'demo-web',
        '--label',
        'com.aiu.compose.project=other',
        'alpine:3.20'
      ],
      { env: ctx.fake.env }
    )
    expect(foreign.code).toBe(0)

    ctx.runner.startUp(ctx.project, {}, ctx.events)
    const done = await ctx.done
    expect(done.ok).toBe(false)
    expect(done.message).toMatch(/belongs to project other/i)

    const saved = state(ctx.fake.statePath)
    expect(saved.extra.map((c) => c.configuration.id)).toContain('demo-web')
  })

  it('does not adopt an unlabelled container with a colliding name', async () => {
    const ctx = setup(TWO_SERVICES)
    const foreign = await runCli(['run', '-d', '--name', 'demo-web', 'alpine:3.20'], {
      env: ctx.fake.env
    })
    expect(foreign.code).toBe(0)

    ctx.runner.startUp(ctx.project, {}, ctx.events)
    const done = await ctx.done
    expect(done.ok).toBe(false)
    expect(done.message).toMatch(/outside this project/i)
    expect(
      state(ctx.fake.statePath).extra.map((container) => container.configuration.id)
    ).toContain('demo-web')
  })

  it('streams logs for a service and stops following', async () => {
    const ctx = setup(TWO_SERVICES)
    ctx.runner.startUp(ctx.project, {}, ctx.events)
    await ctx.done

    const result = await ctx.runner.logs(ctx.project, 'web', ctx.events)
    expect(result).toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(ctx.logs.some((line) => line.line.includes('[demo-web] listening'))).toBe(true)
    ctx.runner.stopLogs()
  })

  it('reports teardown failures instead of claiming success', async () => {
    const ctx = setup(TWO_SERVICES, 'teardown-fail')
    await runUp(ctx)

    const result = await ctx.runner.down(ctx.project, { removeVolumes: true })
    expect(result.ok).toBe(false)
    if ('message' in result) {
      expect(result.message).toMatch(/network demo_default/)
      expect(result.message).toMatch(/volume demo_data/)
    }
    const saved = state(ctx.fake.statePath)
    expect(saved.networks).toContain('demo_default')
    expect(saved.volumes).toContain('demo_data')
  })

  it('reports a failed build and the service that failed', async () => {
    const ctx = setup(
      `
name: demo
services:
  app:
    build: .
`,
      'failing-build'
    )
    ctx.runner.startUp(ctx.project, {}, ctx.events)
    const done = await ctx.done
    expect(done.ok).toBe(false)
    expect(done.message).toMatch(/app/)
    expect(ctx.outputs.some((line) => line.line.includes('did not complete successfully'))).toBe(
      true
    )
  })

  it('cancels a blocking build without creating a container', async () => {
    const ctx = setup(
      `
name: demo
services:
  app:
    build: .
`,
      'blocking-build'
    )
    const started = ctx.runner.startUp(ctx.project, {}, ctx.events)
    if (started.ok === false) throw new Error(started.error.message)

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(ctx.runner.cancel(started.runId)).toBe(true)
    const done = await ctx.done

    expect(done.ok).toBe(false)
    expect(done.message).toMatch(/Canceled/)
    expect(state(ctx.fake.statePath).extra).toEqual([])
  })

  it('rejects a second concurrent operation', async () => {
    const ctx = setup(TWO_SERVICES)
    ctx.runner.startUp(ctx.project, {}, ctx.events)
    expect(ctx.runner.startUp(ctx.project, {}, ctx.events)).toMatchObject({ ok: false })
    await ctx.done
  })
})
