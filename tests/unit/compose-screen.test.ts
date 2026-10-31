// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Compose from '../../src/renderer/src/screens/Compose.svelte'
import type { ContainersApi } from '../../src/shared/api'
import type { ComposeProject } from '../../src/shared/compose'

const project: ComposeProject = {
  name: 'demo',
  file: '/projects/demo/compose.yaml',
  dir: '/projects/demo',
  network: 'demo_default',
  namedVolumes: ['demo_data'],
  services: [
    {
      name: 'db',
      image: 'postgres:16',
      containerName: 'demo-db',
      environment: [],
      ports: [],
      volumes: [],
      dependsOn: []
    },
    {
      name: 'web',
      image: 'nginx:latest',
      containerName: 'demo-web',
      environment: [],
      ports: [{ raw: '8080:80', hostPort: 8080, containerPort: 80, protocol: 'tcp' }],
      volumes: [],
      dependsOn: ['db']
    }
  ],
  warnings: [{ message: 'restart is ignored.', service: 'web', key: 'restart' }]
}

function stubApi(over: Partial<ContainersApi> = {}): ContainersApi {
  const api = {
    list: vi.fn().mockResolvedValue({ ok: true, containers: [] }),
    systemStatus: vi.fn(),
    systemStart: vi.fn(),
    buildStart: vi.fn(),
    buildCancel: vi.fn(),
    contextInspect: vi.fn(),
    pickDirectory: vi.fn(),
    pickFile: vi.fn().mockResolvedValue('/projects/demo/compose.yaml'),
    composeInspect: vi.fn().mockResolvedValue({ ok: true, project }),
    composeUp: vi.fn().mockResolvedValue({ ok: true, runId: 'r1' }),
    composeCancel: vi.fn().mockResolvedValue({ ok: true }),
    composeStop: vi.fn().mockResolvedValue({ ok: true }),
    composeDown: vi.fn().mockResolvedValue({ ok: true }),
    composeLogs: vi.fn().mockResolvedValue({ ok: true }),
    composeLogsStop: vi.fn().mockResolvedValue({ ok: true }),
    onBuildOutput: vi.fn().mockReturnValue(() => {}),
    onBuildDone: vi.fn().mockReturnValue(() => {}),
    onComposeOutput: vi.fn().mockReturnValue(() => {}),
    onComposeDone: vi.fn().mockReturnValue(() => {}),
    onComposeLog: vi.fn().mockReturnValue(() => {}),
    ...over
  } as ContainersApi
  ;(window as unknown as { containers: ContainersApi }).containers = api
  return api
}

async function openProject(): Promise<void> {
  render(Compose)
  await fireEvent.click(screen.getByRole('button', { name: 'Open…' }))
  await waitFor(() => expect(screen.getByText('demo')).toBeInTheDocument())
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('Compose screen', () => {
  it('opens a compose file and shows the project, services and DNS notice', async () => {
    const api = stubApi()
    await openProject()

    expect(api.composeInspect).toHaveBeenCalledWith('/projects/demo/compose.yaml')
    expect(screen.getByText('/projects/demo/compose.yaml')).toBeInTheDocument()
    expect(screen.getAllByText('web').length).toBeGreaterThan(0)
    expect(screen.getAllByText('db').length).toBeGreaterThan(0)
    expect(screen.getByText(/cannot resolve service names/i)).toBeInTheDocument()
    expect(screen.getByText(/restart is ignored/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Up' })).toBeEnabled()
  })

  it('lists parse errors and keeps Up unavailable', async () => {
    stubApi({
      composeInspect: vi.fn().mockResolvedValue({
        ok: false,
        errors: [{ message: 'Unsupported service key: profiles', service: 'web', key: 'profiles' }]
      })
    })
    render(Compose)
    await fireEvent.click(screen.getByRole('button', { name: 'Open…' }))
    await waitFor(() =>
      expect(screen.getByText(/Unsupported service key: profiles/)).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: 'Up' })).not.toBeInTheDocument()
  })

  it('streams Up output and reports success', async () => {
    let output: ((event: unknown) => void) | null = null
    let done: ((event: unknown) => void) | null = null
    const api = stubApi({
      onComposeOutput: vi.fn((cb: (event: unknown) => void) => {
        output = cb
        return () => {}
      }),
      onComposeDone: vi.fn((cb: (event: unknown) => void) => {
        done = cb
        return () => {}
      })
    })
    await openProject()

    await fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(api.composeUp).toHaveBeenCalled())
    output?.({ runId: 'r1', service: 'web', stream: 'stdout', line: 'Creating container' })
    await waitFor(() => expect(screen.getByText(/Creating container/)).toBeInTheDocument())
    done?.({ runId: 'r1', action: 'up', ok: true })
    await waitFor(() => expect(screen.getByText(/Up succeeded/)).toBeInTheDocument())
  })

  it('reports a failed Up with the backend message', async () => {
    let done: ((event: unknown) => void) | null = null
    const api = stubApi({
      onComposeDone: vi.fn((cb: (event: unknown) => void) => {
        done = cb
        return () => {}
      })
    })
    await openProject()
    await fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await waitFor(() => expect(api.composeUp).toHaveBeenCalled())
    done?.({ runId: 'r1', action: 'up', ok: false, message: 'web: build failed' })
    await waitFor(() => expect(screen.getByText('web: build failed')).toBeInTheDocument())
  })

  it('calls Stop and Down, passing the volume choice', async () => {
    const api = stubApi()
    await openProject()

    await fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() =>
      expect(api.composeStop).toHaveBeenCalledWith({
        file: '/projects/demo/compose.yaml',
        projectName: 'demo'
      })
    )

    await fireEvent.click(screen.getByLabelText(/remove volumes/i))
    await fireEvent.click(screen.getByRole('button', { name: 'Down' }))
    await waitFor(() =>
      expect(api.composeDown).toHaveBeenCalledWith({
        file: '/projects/demo/compose.yaml',
        projectName: 'demo',
        removeVolumes: true
      })
    )
  })

  it('follows a service log and stops it', async () => {
    let log: ((event: unknown) => void) | null = null
    const api = stubApi({
      list: vi.fn().mockResolvedValue({
        ok: true,
        containers: ['db', 'web'].map((name) => ({
          id: `demo-${name}`,
          image: name === 'web' ? 'nginx:latest' : 'postgres:16',
          state: 'running',
          ip: '',
          platform: 'linux/arm64',
          created: '',
          networks: ['demo_default'],
          labels: { 'com.aiu.compose.project': 'demo', 'com.aiu.compose.service': name }
        }))
      }),
      onComposeLog: vi.fn((cb: (event: unknown) => void) => {
        log = cb
        return () => {}
      })
    })
    await openProject()

    await fireEvent.click(screen.getAllByRole('button', { name: 'Logs' })[1])
    await waitFor(() =>
      expect(api.composeLogs).toHaveBeenCalledWith({
        file: '/projects/demo/compose.yaml',
        projectName: 'demo',
        service: 'web'
      })
    )
    log?.({ service: 'web', stream: 'stdout', line: 'listening on 80' })
    await waitFor(() => expect(screen.getByText('listening on 80')).toBeInTheDocument())

    await fireEvent.click(screen.getByRole('button', { name: /stop logs/i }))
    expect(api.composeLogsStop).toHaveBeenCalled()
  })
})
