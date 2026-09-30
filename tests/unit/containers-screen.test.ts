// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
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

  it('toggles between running-only and all containers', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(true))
    const toggle = screen.getByLabelText('Show stopped')
    expect(toggle).not.toBeChecked()
    await fireEvent.click(toggle)
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(false))
    expect(toggle).toBeChecked()
  })

  it('shows a service-down banner and starts the service, then reloads', async () => {
    const api = stubApi({
      list: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_NOT_RUNNING', message: 'The container service is not running.' } })
        .mockResolvedValue({ ok: true, containers: [] }),
      systemStatus: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_NOT_RUNNING', message: 'The container service is not running.' } })
        .mockResolvedValue({
          ok: true,
          status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 0, containersRunning: 0 }
        }),
      systemStart: vi.fn().mockResolvedValue({ ok: true })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await waitFor(() => expect(screen.getByText('Service: not running')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/service is not running/i)).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /start service/i }))
    await waitFor(() => expect(api.systemStart).toHaveBeenCalled())
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Service: running')).toBeInTheDocument())
  })

  it('shows an install hint when the CLI is missing', async () => {
    const api = stubApi({
      list: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'CLI_MISSING', message: "The `container` CLI was not found." }
      })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await waitFor(() => expect(screen.getByText(/CLI was not found/i)).toBeInTheDocument())
  })

  it('auto-refreshes every 3 seconds while visible', async () => {
    vi.useFakeTimers()
    try {
      const api = stubApi()
      ;(window as unknown as { containers: ContainersApi }).containers = api
      render(Containers)
      await vi.advanceTimersByTimeAsync(0)
      expect(api.list).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3000)
      expect(api.list).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
