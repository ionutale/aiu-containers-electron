// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Containers from '../../src/renderer/src/screens/Containers.svelte'
import type { ContainersApi } from '../../src/shared/api'

function stubApi(over: Partial<ContainersApi> = {}): ContainersApi {
  return {
    list: vi.fn().mockResolvedValue({
      ok: true,
      containers: [
        {
          id: 'web-1',
          image: 'nginx:latest',
          state: 'running',
          ip: '192.168.64.2',
          platform: 'linux/arm64',
          created: '2026-08-31T12:00:00Z',
          networks: ['default']
        }
      ]
    }),
    systemStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 1, containersRunning: 1 }
    }),
    systemStart: vi.fn(),
    buildStart: vi.fn(),
    buildCancel: vi.fn(),
    contextInspect: vi.fn(),
    pickDirectory: vi.fn(),
    pickFile: vi.fn(),
    onBuildOutput: vi.fn().mockReturnValue(() => {}),
    onBuildDone: vi.fn().mockReturnValue(() => {}),
    ...over
  } as ContainersApi
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Containers screen', () => {
  it('renders running containers from the bridge', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    expect(screen.getByText('nginx:latest')).toBeInTheDocument()
    expect(api.list).toHaveBeenCalledWith(true)
  })
})
