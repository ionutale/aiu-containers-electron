import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BuildManager } from '../../src/main/container-cli/build'
import type { BuildDoneEvent, BuildLine, BuildRequest } from '../../src/shared/types'
import { makeFakeCli, type FakeMode } from '../helpers/fakeCli'

function setup(mode: FakeMode): {
  mgr: BuildManager
  lines: BuildLine[]
  events: {
    onLine(runId: string, line: BuildLine): void
    onDone(runId: string, done: Omit<BuildDoneEvent, 'runId'>): void
  }
  getDone: () => Omit<BuildDoneEvent, 'runId'> | null
} {
  const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'bm-')), { mode })
  const mgr = new BuildManager({ env: fake.env })
  const lines: BuildLine[] = []
  let done: Omit<BuildDoneEvent, 'runId'> | null = null
  const events = {
    onLine: (_runId: string, line: BuildLine): void => void lines.push(line),
    onDone: (_runId: string, d: Omit<BuildDoneEvent, 'runId'>): void => void (done = d)
  }
  return { mgr, lines, events, getDone: () => done }
}

const req = (contextDir: string): BuildRequest => ({
  contextDir,
  tag: 'app:latest',
  buildArgs: [],
  noCache: false
})

describe('BuildManager', () => {
  it('streams build output and finishes cleanly', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, lines, events, getDone } = setup('default')
    const started = mgr.start(req(ctx), events)
    expect(started.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    expect(lines.map((l) => l.line).join('\n')).toContain('fake: done')
    expect(getDone()).toMatchObject({ code: 0, canceled: false })
    expect(getDone()?.error).toBeUndefined()
  })

  it('builds with an auto-detected relative Dockerfile resolved against the context', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    writeFileSync(join(ctx, 'Dockerfile'), 'FROM alpine:3.20\n')
    const { mgr, lines, events, getDone } = setup('default')
    // Regression: the renderer passes the bare name from findDockerfile; the
    // real CLI resolves a relative -f against cwd, so buildArgv must absolutize it.
    const started = mgr.start({ ...req(ctx), dockerfilePath: 'Dockerfile' }, events)
    expect(started.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    expect(getDone()).toMatchObject({ code: 0, canceled: false })
    expect(getDone()?.error).toBeUndefined()
    expect(lines.map((l) => l.line).join('\n')).toContain('fake: done')
  })

  it('reports BUILD_FAILED with the last stderr line', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events, getDone } = setup('failing-build')
    mgr.start(req(ctx), events)
    await new Promise((r) => setTimeout(r, 1500))
    expect(getDone()).toMatchObject({ canceled: false, error: { code: 'BUILD_FAILED' } })
    expect(getDone()?.error?.message).toContain('did not complete successfully')
  })

  it('cancel resolves canceled and never BUILD_FAILED', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events, getDone } = setup('blocking-build')
    const started = mgr.start(req(ctx), events)
    if (!started.ok) expect.unreachable('start should succeed')
    expect(mgr.cancel((started as { runId: string }).runId)).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    expect(getDone()).toMatchObject({ canceled: true })
    expect(getDone()?.error).toBeUndefined()
  })

  it('rejects a second concurrent build and invalid requests without spawning', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events } = setup('blocking-build')
    const started = mgr.start(req(ctx), events)
    expect(started.ok).toBe(true)
    expect(mgr.start(req(ctx), events)).toMatchObject({ ok: false })
    const mgr2 = new BuildManager()
    expect(mgr2.start(req('/definitely/not/here'), events)).toMatchObject({ ok: false })
    if (started.ok) mgr.cancel(started.runId) // leave no orphaned blocking child
    await new Promise((r) => setTimeout(r, 300))
  })
})
