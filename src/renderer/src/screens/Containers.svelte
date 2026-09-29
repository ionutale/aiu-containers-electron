<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import type { ContainerSummary } from '../../../shared/types'

  let containers = $state<ContainerSummary[]>([])
  let loading = $state(false)
  let errorMessage = $state('')

  async function load(): Promise<void> {
    loading = true
    try {
      const result = await getApi().list(true)
      if (result.ok === false) {
        errorMessage = result.error.message
      } else {
        containers = result.containers
        errorMessage = ''
      }
    } finally {
      loading = false
    }
  }

  onMount(load)
</script>

<section class="screen">
  <header>
    <h1>Containers</h1>
    <button onclick={load} disabled={loading}>Refresh</button>
  </header>
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}
  {#if !loading && containers.length === 0 && !errorMessage}
    <p class="muted">No running containers.</p>
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
