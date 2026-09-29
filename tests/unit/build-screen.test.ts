// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Build from '../../src/renderer/src/screens/Build.svelte'
import type { ContainersApi } from '../../src/shared/api'

function stubApi(over: Partial<ContainersApi> = {}): ContainersApi {
  return {
    list: vi.fn(),
    systemStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 1, containersRunning: 1 }
    }),
    systemStart: vi.fn(),
    buildStart: vi.fn().mockResolvedValue({ ok: true, runId: 'r1' }),
    buildCancel: vi.fn().mockResolvedValue({ ok: true }),
    contextInspect: vi.fn().mockResolvedValue({ dockerfile: 'Dockerfile' }),
    pickDirectory: vi.fn().mockResolvedValue('/Users/me/projects/My App'),
    pickFile: vi.fn().mockResolvedValue(null),
    onBuildOutput: vi.fn().mockReturnValue(() => {}),
    onBuildDone: vi.fn().mockReturnValue(() => {}),
    ...over
  } as ContainersApi
}

afterEach(cleanup)

describe('Build screen', () => {
  it('picks a context, detects the Dockerfile, and defaults the tag from the folder', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('/Users/me/projects/My App')).toBeInTheDocument())
    expect(api.contextInspect).toHaveBeenCalledWith('/Users/me/projects/My App')
    expect(screen.getByDisplayValue('my-app')).toBeInTheDocument()
  })

  it('hints when the context has no Dockerfile or Containerfile', async () => {
    const api = stubApi({ contextInspect: vi.fn().mockResolvedValue({ dockerfile: null }) } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByText(/no dockerfile or containerfile/i)).toBeInTheDocument())
  })

  it('starts a build with the form values', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    await waitFor(() =>
      expect(api.buildStart).toHaveBeenCalledWith(
        expect.objectContaining({ contextDir: '/Users/me/projects/My App', tag: 'my-app', noCache: false })
      )
    )
  })

  it('shows the backend validation error when buildStart fails', async () => {
    const api = stubApi({
      buildStart: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'CLI_ERROR', message: 'Build context is not a directory: /nope' }
      })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    await waitFor(() => expect(screen.getByText(/not a directory/i)).toBeInTheDocument())
  })
})
