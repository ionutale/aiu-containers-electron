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
      status: {
        status: 'running',
        clientVersion: '',
        serverVersion: '',
        hostArch: '',
        hostOs: '',
        containersTotal: 1,
        containersRunning: 1
      }
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

function eventApi(): {
  api: ContainersApi
  emit: (e: unknown) => void
  done: (e: unknown) => void
} {
  let outputCb: ((e: unknown) => void) | null = null
  let doneCb: ((e: unknown) => void) | null = null
  const api = stubApi({
    onBuildOutput: vi.fn((cb: (e: unknown) => void) => {
      outputCb = cb
      return () => {}
    }),
    onBuildDone: vi.fn((cb: (e: unknown) => void) => {
      doneCb = cb
      return () => {}
    })
  } as Partial<ContainersApi>)
  return { api, emit: (e) => outputCb?.(e), done: (e) => doneCb?.(e) }
}

afterEach(cleanup)

describe('Build screen', () => {
  it('picks a context, detects the Dockerfile, and defaults the tag from the folder', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() =>
      expect(screen.getByDisplayValue('/Users/me/projects/My App')).toBeInTheDocument()
    )
    expect(api.contextInspect).toHaveBeenCalledWith('/Users/me/projects/My App')
    expect(screen.getByDisplayValue('my-app')).toBeInTheDocument()
  })

  it('hints when the context has no Dockerfile or Containerfile', async () => {
    const api = stubApi({
      contextInspect: vi.fn().mockResolvedValue({ dockerfile: null })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() =>
      expect(screen.getByText(/no dockerfile or containerfile/i)).toBeInTheDocument()
    )
  })

  it('clears the missing-Dockerfile hint once a file is provided', async () => {
    const api = stubApi({
      contextInspect: vi.fn().mockResolvedValue({ dockerfile: null }),
      pickFile: vi.fn().mockResolvedValue('/ctx/Dockerfile.dev')
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() =>
      expect(screen.getByText(/no dockerfile or containerfile/i)).toBeInTheDocument()
    )

    await fireEvent.click(screen.getByRole('button', { name: /browse/i }))
    await waitFor(() => expect(screen.getByDisplayValue('/ctx/Dockerfile.dev')).toBeInTheDocument())
    expect(screen.queryByText(/no dockerfile or containerfile/i)).not.toBeInTheDocument()
  })

  it('clears the missing-Dockerfile hint when a path is typed in', async () => {
    const api = stubApi({
      contextInspect: vi.fn().mockResolvedValue({ dockerfile: null })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() =>
      expect(screen.getByText(/no dockerfile or containerfile/i)).toBeInTheDocument()
    )

    await fireEvent.input(screen.getByLabelText('Dockerfile'), {
      target: { value: 'Dockerfile.dev' }
    })
    await waitFor(() =>
      expect(screen.queryByText(/no dockerfile or containerfile/i)).not.toBeInTheDocument()
    )
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
        expect.objectContaining({
          contextDir: '/Users/me/projects/My App',
          tag: 'my-app',
          noCache: false
        })
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

  it('streams build output, cancels, and reports the result', async () => {
    const { api, emit, done } = eventApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    await waitFor(() => expect(api.buildStart).toHaveBeenCalled())

    emit({ runId: 'r1', stream: 'stdout', line: '#1 FROM alpine' })
    await waitFor(() => expect(screen.getByText('#1 FROM alpine')).toBeInTheDocument())

    await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(api.buildCancel).toHaveBeenCalledWith('r1')

    done({ runId: 'r1', code: null, signal: 'SIGTERM', canceled: true })
    await waitFor(() => expect(screen.getByText(/canceled/i)).toBeInTheDocument())
  })

  it('reports failure with the error message', async () => {
    const { api, done } = eventApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    done({
      runId: 'r1',
      code: 1,
      signal: null,
      canceled: false,
      error: { code: 'BUILD_FAILED', message: 'step failed' }
    })
    await waitFor(() => expect(screen.getByText(/step failed/i)).toBeInTheDocument())
  })
})
