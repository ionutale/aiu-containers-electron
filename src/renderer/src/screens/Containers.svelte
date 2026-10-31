<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import type { CliErrorInfo, ContainerSummary } from '../../../shared/types'

  let containers = $state<ContainerSummary[]>([])
  let loading = $state(false)
  let error = $state<CliErrorInfo | null>(null)
  let runningOnly = $state(true)
  let startingService = $state(false)
  let serviceState = $state<'unknown' | 'running' | 'not-running'>('unknown')
  const serviceLabel = $derived(
    serviceState === 'running'
      ? 'Service: running'
      : serviceState === 'not-running'
        ? 'Service: not running'
        : 'Service: unknown'
  )
  let inFlight = false

  async function refreshServiceState(): Promise<void> {
    try {
      const result = await getApi().systemStatus()
      if (result.ok === true)
        serviceState = result.status.status === 'running' ? 'running' : 'not-running'
      else serviceState = result.error.code === 'SERVICE_NOT_RUNNING' ? 'not-running' : 'unknown'
    } catch {
      serviceState = 'unknown'
    }
  }

  async function load(): Promise<void> {
    if (inFlight) return
    inFlight = true
    loading = true
    try {
      const result = await getApi().list(runningOnly)
      if (result.ok === false) {
        error = result.error
        containers = []
      } else {
        containers = result.containers
        error = null
      }
    } catch (e) {
      error = { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
      containers = []
    } finally {
      loading = false
      inFlight = false
    }
  }

  async function toggleRunningOnly(): Promise<void> {
    runningOnly = !runningOnly
    await load()
  }

  async function startService(): Promise<void> {
    startingService = true
    try {
      await getApi().systemStart()
      await Promise.all([load(), refreshServiceState()])
    } catch (e) {
      error = { code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) }
    } finally {
      startingService = false
    }
  }

  onMount(() => {
    void load()
    void refreshServiceState()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 3000)
    return () => window.clearInterval(timer)
  })
</script>

<section class="screen">
  <header>
    <div class="title">
      <h1>Containers</h1>
      <p>{runningOnly ? 'Running on this Mac.' : 'All containers, including stopped ones.'}</p>
    </div>
    <div class="actions">
      <span class="pill" data-state={serviceState}>{serviceLabel}</span>
      <label class="switch">
        <input type="checkbox" checked={!runningOnly} onchange={toggleRunningOnly} />
        <span>Show stopped</span>
      </label>
      <button class="btn" onclick={load} disabled={loading}>Refresh</button>
    </div>
  </header>

  {#if error?.code === 'SERVICE_NOT_RUNNING'}
    <div class="banner" data-kind="warning">
      <p>The container service is not running. Start it to list containers.</p>
      <button class="btn" onclick={startService} disabled={startingService}>
        {startingService ? 'Starting…' : 'Start service'}
      </button>
    </div>
  {:else if error?.code === 'CLI_MISSING'}
    <div class="banner" data-kind="warning">
      <p>
        The `container` CLI was not found. Install Apple's container runtime, then restart this app.
      </p>
    </div>
  {:else if error}
    <div class="banner" data-kind="error">
      <p>{error.message}</p>
      {#if error.stderr}<pre>{error.stderr}</pre>{/if}
    </div>
  {/if}

  <div class="card">
    {#if containers.length > 0}
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Image</th><th>State</th><th>Address</th><th>Platform</th></tr>
          </thead>
          <tbody>
            {#each containers as c (c.id)}
              <tr>
                <td class="id">{c.id}</td>
                <td class="muted">{c.image}</td>
                <td>
                  <span class="chip" data-state={c.state}><span class="dot"></span>{c.state}</span>
                </td>
                <td class="dim">{c.ip || '—'}</td>
                <td class="dim">{c.platform || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if loading}
      <div class="empty"><span>Loading containers…</span></div>
    {:else if !error}
      <div class="empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
          <path
            d="M4.3 7.6 12 11.7l7.7-4.1M12 11.7V21"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
        </svg>
        <strong>{runningOnly ? 'No running containers.' : 'No containers.'}</strong>
        <span>
          {runningOnly
            ? 'Start one with `container run` and it will appear here.'
            : 'Run a container, or toggle “Show stopped” off.'}
        </span>
      </div>
    {/if}
  </div>
</section>
