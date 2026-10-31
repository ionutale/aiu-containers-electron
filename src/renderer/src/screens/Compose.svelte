<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import type {
    ComposeDoneEvent,
    ComposeError,
    ComposeLogEvent,
    ComposeOutputEvent,
    ComposeProject,
    ComposeService
  } from '../../../shared/compose'
  import type { ContainerSummary } from '../../../shared/types'

  const RECENT_KEY = 'aiu.compose.recent'

  let project = $state<ComposeProject | null>(null)
  let errors = $state<ComposeError[]>([])
  let actionError = $state<string | null>(null)
  let containers = $state<ContainerSummary[]>([])
  let recent = $state<string[]>([])
  let busy = $state<'up' | 'stop' | 'down' | null>(null)
  let runId = $state<string | null>(null)
  let forceBuild = $state(false)
  let removeVolumes = $state(false)
  let done = $state<{ ok: boolean; message?: string } | null>(null)
  let lines = $state<{ service?: string; stream: 'stdout' | 'stderr'; text: string }[]>([])
  let logsService = $state<string | null>(null)
  let logLines = $state<{ stream: 'stdout' | 'stderr'; line: string }[]>([])
  let upLog = $state<HTMLDivElement | null>(null)
  let serviceLog = $state<HTMLDivElement | null>(null)
  let upAutoScroll = $state(true)
  let logAutoScroll = $state(true)

  let runningCount = $derived(
    project ? project.services.filter((service) => serviceState(service) === 'running').length : 0
  )

  function serviceContainer(service: ComposeService): ContainerSummary | undefined {
    return containers.find(
      (container) =>
        container.labels['com.aiu.compose.service'] === service.name ||
        container.id === service.containerName
    )
  }

  function serviceState(service: ComposeService): string {
    return serviceContainer(service)?.state || 'not created'
  }

  function remember(path: string): void {
    recent = [path, ...recent.filter((item) => item !== path)].slice(0, 5)
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
    } catch {
      // localStorage is best-effort
    }
  }

  async function refresh(): Promise<void> {
    if (!project) return
    try {
      const result = await getApi().list(false)
      if ('error' in result) return
      containers = result.containers.filter(
        (container) => container.labels['com.aiu.compose.project'] === project?.name
      )
    } catch {
      // Status is a convenience; the CLI errors surface on actions.
    }
  }

  async function inspect(path: string): Promise<void> {
    project = null
    errors = []
    actionError = null
    done = null
    lines = []
    logsService = null
    containers = []
    try {
      const result = await getApi().composeInspect(path)
      if ('errors' in result) {
        errors = result.errors
        return
      }
      project = result.project
      remember(path)
      await refresh()
    } catch (error) {
      errors = [{ message: error instanceof Error ? error.message : String(error) }]
    }
  }

  async function openFile(): Promise<void> {
    try {
      const picked = await getApi().pickFile(project?.dir)
      if (picked) await inspect(picked)
    } catch (error) {
      errors = [{ message: error instanceof Error ? error.message : String(error) }]
    }
  }

  async function startUp(): Promise<void> {
    if (!project) return
    actionError = null
    done = null
    lines = []
    upAutoScroll = true
    if (logsService) await stopLogs()
    busy = 'up'
    try {
      const inspected = await getApi().composeInspect(project.file)
      if ('errors' in inspected) {
        errors = inspected.errors
        busy = null
        return
      }
      if (inspected.project.name !== project.name) {
        actionError = `The project name changed from ${project.name} to ${inspected.project.name}. Down the current stack before starting the new one.`
        busy = null
        return
      }
      project = inspected.project
      errors = []
      const started = await getApi().composeUp({
        file: project.file,
        projectName: project.name,
        forceBuild
      })
      if ('error' in started) {
        busy = null
        done = { ok: false, message: started.error.message }
        return
      }
      runId = started.runId
    } catch (error) {
      busy = null
      done = { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async function stop(): Promise<void> {
    if (!project) return
    actionError = null
    busy = 'stop'
    try {
      const result = await getApi().composeStop({
        file: project.file,
        projectName: project.name
      })
      if ('message' in result) actionError = result.message
      await refresh()
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error)
    } finally {
      busy = null
    }
  }

  async function down(): Promise<void> {
    if (!project) return
    actionError = null
    if (logsService) await stopLogs()
    busy = 'down'
    try {
      const result = await getApi().composeDown({
        file: project.file,
        projectName: project.name,
        removeVolumes
      })
      if ('message' in result) actionError = result.message
      await refresh()
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error)
    } finally {
      busy = null
    }
  }

  async function cancel(): Promise<void> {
    if (!runId) return
    try {
      await getApi().composeCancel(runId)
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error)
    }
  }

  async function follow(service: ComposeService): Promise<void> {
    if (!project) return
    if (logsService === service.name) {
      await stopLogs()
      return
    }
    await stopLogs()
    logLines = []
    logAutoScroll = true
    logsService = service.name
    const result = await getApi().composeLogs({
      file: project.file,
      projectName: project.name,
      service: service.name
    })
    if ('message' in result) {
      logsService = null
      actionError = result.message
    }
  }

  async function stopLogs(): Promise<void> {
    logsService = null
    try {
      await getApi().composeLogsStop()
    } catch {
      // stopping a finished stream is harmless
    }
  }

  function scrollUpLog(): void {
    if (upLog) upLog.scrollTop = upLog.scrollHeight
  }

  function scrollServiceLog(): void {
    if (serviceLog) serviceLog.scrollTop = serviceLog.scrollHeight
  }

  onMount(() => {
    try {
      const stored = localStorage.getItem(RECENT_KEY)
      if (stored) recent = JSON.parse(stored)
    } catch {
      recent = []
    }

    const api = getApi()
    const offOutput = api.onComposeOutput((event: ComposeOutputEvent) => {
      if (event.runId !== runId) return
      lines = [...lines, { service: event.service, stream: event.stream, text: event.line }]
      if (upAutoScroll) queueMicrotask(scrollUpLog)
    })
    const offDone = api.onComposeDone((event: ComposeDoneEvent) => {
      if (event.runId !== runId) return
      busy = null
      runId = null
      done = { ok: event.ok, message: event.message }
      void refresh()
    })
    const offLog = api.onComposeLog((event: ComposeLogEvent) => {
      if (event.service !== logsService) return
      logLines = [...logLines, { stream: event.stream, line: event.line }]
      if (logAutoScroll) queueMicrotask(scrollServiceLog)
    })

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 3000)

    return () => {
      offOutput()
      offDone()
      offLog()
      window.clearInterval(timer)
      void api.composeLogsStop()
    }
  })
</script>

<section class="screen">
  <header>
    <div class="title">
      <h1>Compose</h1>
      <p>Run a compose file on Apple's container runtime.</p>
    </div>
    <div class="actions">
      <button class="btn" onclick={openFile} disabled={busy !== null}>Open…</button>
      {#if project}
        <label class="switch">
          <input type="checkbox" bind:checked={forceBuild} />
          <span>Rebuild</span>
        </label>
        <button class="btn" onclick={stop} disabled={busy !== null}>Stop</button>
        <button class="btn" onclick={down} disabled={busy !== null}>Down</button>
        <button
          class="btn btn-primary"
          onclick={startUp}
          disabled={busy !== null || errors.length > 0}
        >
          {busy === 'up' ? 'Starting…' : 'Up'}
        </button>
      {/if}
    </div>
  </header>

  {#if errors.length > 0}
    <div class="banner" data-kind="error">
      <div>
        <strong>This file cannot be used yet.</strong>
        <ul class="warn-list">
          {#each errors as error, index (index)}
            <li>
              {#if error.service}<strong>{error.service}</strong>:
              {/if}{error.message}{#if error.line}<span class="muted">
                  (line {error.line})</span
                >{/if}
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if !project}
    <div class="card">
      <div class="empty">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3 21 7.5 12 12 3 7.5 12 3Z"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <path
            d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
        </svg>
        <strong>No compose project open.</strong>
        <span>
          Open a <span class="mono">compose.yaml</span> or
          <span class="mono">docker-compose.yml</span> file to build and run its services.
        </span>
        <button class="btn" onclick={openFile}>Open compose file…</button>
        {#if recent.length > 0}
          <div class="recent">
            <span class="muted">Recent</span>
            {#each recent as item (item)}
              <button
                class="recent-item mono"
                onclick={() => inspect(item)}
                disabled={busy !== null}>{item}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="card project-card">
      <div class="project-meta">
        <span class="pill" data-state={runningCount > 0 ? 'running' : 'not-running'}>
          <span class="dot"></span>
          {runningCount}/{project.services.length} running
        </span>
        <span class="mono muted">{project.file}</span>
      </div>
      <div class="project-meta">
        <span><strong>Project</strong> {project.name}</span>
        <span><strong>Network</strong> <span class="mono">{project.network}</span></span>
        {#if project.namedVolumes.length > 0}
          <span>
            <strong>Volumes</strong>
            <span class="mono">{project.namedVolumes.join(', ')}</span>
          </span>
        {/if}
      </div>
      <label class="switch">
        <input type="checkbox" bind:checked={removeVolumes} />
        <span>Remove volumes on Down</span>
      </label>
    </div>

    <div class="banner" data-kind="warning">
      <div>
        <strong>Apple's container runtime cannot resolve service names.</strong>
        <p>
          Services that connect to <span class="mono">db</span> or
          <span class="mono">web</span> by name will fail. Use published host ports or the container
          names below.
          <a href="https://github.com/apple/container/issues/1809" target="_blank" rel="noreferrer"
            >Tracking issue</a
          >.
        </p>
      </div>
    </div>

    {#if project.warnings.length > 0}
      <div class="card warnings">
        <div class="card-head"><strong>Ignored settings</strong></div>
        <ul class="warn-list">
          {#each project.warnings as warning, index (index)}
            <li>{warning.service ? `${warning.service}: ` : ''}{warning.message}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if actionError}
      <div class="banner" data-kind="error"><p>{actionError}</p></div>
    {/if}

    <div class="card services">
      <div class="card-head">
        <strong>Services</strong>
        <span class="muted">Builds run only when an image is missing, or when Rebuild is on.</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Image</th>
              <th>State</th>
              <th>Ports</th>
              <th>Container</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each project.services as service (service.name)}
              <tr>
                <td>
                  <strong>{service.name}</strong>
                  {#if service.dependsOn.length > 0}
                    <div class="muted small">needs {service.dependsOn.join(', ')}</div>
                  {/if}
                </td>
                <td class="muted">{service.image ?? 'built image'}</td>
                <td>
                  <span class="chip" data-state={serviceState(service)}>
                    <span class="dot"></span>{serviceState(service)}
                  </span>
                </td>
                <td class="dim">
                  {service.ports.length > 0
                    ? service.ports.map((port) => port.raw).join(', ')
                    : '—'}
                </td>
                <td class="dim">{service.containerName}</td>
                <td>
                  <button
                    class="btn btn-ghost"
                    onclick={() => follow(service)}
                    disabled={serviceState(service) === 'not created'}
                  >
                    {logsService === service.name ? 'Hide logs' : 'Logs'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    {#if lines.length > 0 || busy === 'up' || done}
      <div class="build-log">
        <div class="log-head">
          <span
            class="log-status"
            data-state={busy === 'up' ? 'building' : done?.ok ? 'succeeded' : 'failed'}
          >
            <span class="dot"></span>
            {#if busy === 'up'}
              <strong>Starting stack</strong>
            {:else if done?.ok}
              <strong>Up succeeded</strong>
            {:else if done}
              <strong>Up failed</strong>
            {/if}
          </span>
          <span class="log-actions">
            <button type="button" class="btn btn-ghost" onclick={() => (lines = [])}>Clear</button>
            {#if busy === 'up' && runId}
              <button type="button" class="btn btn-ghost" onclick={cancel}>Cancel</button>
            {/if}
          </span>
        </div>
        {#if done && !done.ok && done.message}
          <p class="error" style="margin: 8px 13px 0">{done.message}</p>
        {/if}
        <div
          class="log-body"
          bind:this={upLog}
          onscroll={() => {
            if (upLog) upAutoScroll = upLog.scrollTop + upLog.clientHeight >= upLog.scrollHeight - 4
          }}
        >
          {#each lines as line, index (index)}
            <pre class:stderr={line.stream === 'stderr'}>{line.service
                ? `${line.service}  `
                : ''}{line.text}</pre>
          {/each}
        </div>
      </div>
    {/if}

    {#if logsService}
      <div class="build-log">
        <div class="log-head">
          <span class="log-status" data-state="building">
            <span class="dot"></span>
            <strong>Logs</strong><span>{logsService}</span>
          </span>
          <span class="log-actions">
            <button type="button" class="btn btn-ghost" onclick={() => (logLines = [])}
              >Clear</button
            >
            <button type="button" class="btn btn-ghost" onclick={stopLogs}>Stop logs</button>
          </span>
        </div>
        <div
          class="log-body"
          bind:this={serviceLog}
          onscroll={() => {
            if (serviceLog)
              logAutoScroll =
                serviceLog.scrollTop + serviceLog.clientHeight >= serviceLog.scrollHeight - 4
          }}
        >
          {#each logLines as line, index (index)}
            <pre class:stderr={line.stream === 'stderr'}>{line.line}</pre>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</section>
