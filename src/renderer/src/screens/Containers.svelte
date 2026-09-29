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
    const result = await getApi().systemStatus()
    if (result.ok === true) serviceState = result.status.status === 'running' ? 'running' : 'not-running'
    else serviceState = result.error.code === 'SERVICE_NOT_RUNNING' ? 'not-running' : 'unknown'
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
    <h1>Containers</h1>
    <span class="badge" class:bad={serviceState === 'not-running'}>{serviceLabel}</span>
    <div class="controls">
      <label><input type="checkbox" checked={runningOnly} onchange={toggleRunningOnly} /> Show stopped</label>
      <button onclick={load} disabled={loading}>Refresh</button>
    </div>
  </header>

  {#if error?.code === 'SERVICE_NOT_RUNNING'}
    <div class="banner">
      <p>The container service is not running.</p>
      <button onclick={startService} disabled={startingService}>
        {startingService ? 'Starting…' : 'Start service'}
      </button>
    </div>
  {:else if error?.code === 'CLI_MISSING'}
    <div class="banner">
      <p>The `container` CLI was not found. Install Apple's container runtime, then restart this app.</p>
    </div>
  {:else if error}
    <div class="banner">
      <p>{error.message}</p>
      {#if error.stderr}<pre>{error.stderr}</pre>{/if}
    </div>
  {/if}

  {#if !error && !loading && containers.length === 0}
    <p class="muted">{runningOnly ? 'No running containers.' : 'No containers.'}</p>
  {/if}

  <table>
    <thead>
      <tr><th>ID</th><th>Image</th><th>State</th><th>Address</th><th>Platform</th></tr>
    </thead>
    <tbody>
      {#each containers as c (c.id)}
        <tr>
          <td>{c.id}</td>
          <td>{c.image}</td>
          <td>{c.state}</td>
          <td>{c.ip}</td>
          <td>{c.platform}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>
