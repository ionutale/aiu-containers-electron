<script lang="ts">
  import Containers from './screens/Containers.svelte'
  import Build from './screens/Build.svelte'

  let view = $state<'containers' | 'build'>('containers')
</script>

<div class="app">
  <nav>
    <span class="brand">Aiu Containers</span>
    <button class="nav-item" class:active={view === 'containers'} onclick={() => (view = 'containers')}>
      Containers
    </button>
    <button class="nav-item" class:active={view === 'build'} onclick={() => (view = 'build')}>Build</button>
  </nav>
  <main>
    {#if view === 'containers'}
      <Containers />
    {:else}
      <Build />
    {/if}
  </main>
</div>
