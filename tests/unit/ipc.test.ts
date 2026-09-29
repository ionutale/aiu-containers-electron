import { describe, expect, it, vi } from 'vitest'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: unknown, payload?: unknown) => unknown

function fakeIpcMain(): { handlers: Map<string, Handler>; handle: (channel: string, fn: Handler) => void } {
  const handlers = new Map<string, Handler>()
  return { handlers, handle: (channel, fn) => void handlers.set(channel, fn) }
}

function deps(over: Partial<IpcDeps> = {}): IpcDeps {
  return {
    listContainers: vi.fn().mockResolvedValue({ ok: true, containers: [] }),
    systemStatus: vi.fn().mockResolvedValue({ ok: true, status: {} }),
    systemStart: vi.fn().mockResolvedValue({ ok: true }),
    buildStart: vi.fn().mockResolvedValue({ ok: true, runId: 'r1' }),
    buildCancel: vi.fn().mockResolvedValue({ ok: true }),
    findDockerfile: vi.fn().mockReturnValue({ dockerfile: 'Dockerfile' }),
    pickDirectory: vi.fn().mockResolvedValue('/picked'),
    pickFile: vi.fn().mockResolvedValue(null),
    ...over
  }
}

describe('registerIpc', () => {
  it('registers every channel once', () => {
    const main = fakeIpcMain()
    registerIpc(main, deps())
    expect([...main.handlers.keys()].sort()).toEqual(
      [
        CHANNELS.buildCancel,
        CHANNELS.buildStart,
        CHANNELS.contextInspect,
        CHANNELS.list,
        CHANNELS.pickDirectory,
        CHANNELS.pickFile,
        CHANNELS.systemStart,
        CHANNELS.systemStatus
      ].sort()
    )
  })

  it('defaults runningOnly to true', async () => {
    const d = deps()
    const main = fakeIpcMain()
    registerIpc(main, d)
    await main.handlers.get(CHANNELS.list)!(null, undefined)
    expect(d.listContainers).toHaveBeenCalledWith(true)
  })

  it('passes through payloads', async () => {
    const d = deps()
    const main = fakeIpcMain()
    registerIpc(main, d)
    await main.handlers.get(CHANNELS.list)!(null, { runningOnly: false })
    expect(d.listContainers).toHaveBeenCalledWith(false)
    await main.handlers.get(CHANNELS.buildCancel)!(null, { runId: 'abc' })
    expect(d.buildCancel).toHaveBeenCalledWith('abc')
    await main.handlers.get(CHANNELS.contextInspect)!(null, { dir: '/ctx' })
    expect(d.findDockerfile).toHaveBeenCalledWith('/ctx')
  })
})
