<script lang="ts">
  import Containers from './screens/Containers.svelte'
  import Compose from './screens/Compose.svelte'
  import Build from './screens/Build.svelte'

  let view = $state<'containers' | 'compose' | 'build'>('containers')
</script>

<div class="app">
  <nav>
    <span class="brand">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <defs>
          <linearGradient id="mark-bg" x1="0" y1="0" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stop-color="#3c3f46" />
            <stop offset="1" stop-color="#23252a" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="20" height="20" rx="5.4" fill="url(#mark-bg)" />
        <rect x="5" y="6.2" width="12" height="2.9" rx="1" fill="#8e949f" opacity="0.55" />
        <rect x="5" y="10.1" width="12" height="2.9" rx="1" fill="#c7ccd4" opacity="0.8" />
        <rect x="5" y="14" width="12" height="2.9" rx="1" fill="#0a84ff" />
      </svg>
      <span>Aiu Containers</span>
    </span>

    <button
      class="nav-item"
      class:active={view === 'containers'}
      aria-current={view === 'containers' ? 'page' : undefined}
      aria-label="Containers"
      onclick={() => (view = 'containers')}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect
          x="1.75"
          y="1.75"
          width="5"
          height="5"
          rx="1.2"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <rect
          x="9.25"
          y="1.75"
          width="5"
          height="5"
          rx="1.2"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <rect
          x="1.75"
          y="9.25"
          width="5"
          height="5"
          rx="1.2"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <rect
          x="9.25"
          y="9.25"
          width="5"
          height="5"
          rx="1.2"
          stroke="currentColor"
          stroke-width="1.3"
        />
      </svg>
      <span>Containers</span>
    </button>

    <button
      class="nav-item"
      class:active={view === 'compose'}
      aria-current={view === 'compose' ? 'page' : undefined}
      aria-label="Compose"
      onclick={() => (view = 'compose')}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.8 14 5 8 8.2 2 5 8 1.8Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path
          d="m2 8 6 3.2L14 8M2 11l6 3.2L14 11"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
      <span>Compose</span>
    </button>

    <button
      class="nav-item"
      class:active={view === 'build'}
      aria-current={view === 'build' ? 'page' : undefined}
      aria-label="Build"
      onclick={() => (view = 'build')}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.8 14 5v6L8 14.2 2 11V5l6-3.2Z"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
        <path
          d="M2.2 5 8 8.1 13.8 5M8 8.1v6"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
      <span>Build</span>
    </button>
  </nav>

  <main>
    <div class="shell">
      {#if view === 'containers'}
        <Containers />
      {:else if view === 'compose'}
        <Compose />
      {:else}
        <Build />
      {/if}
    </div>
  </main>
</div>
