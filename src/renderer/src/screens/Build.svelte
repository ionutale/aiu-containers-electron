<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import { defaultTagFor, formatElapsed, parseBuildArgs } from '../lib/format'
  import type { BuildDoneEvent, BuildOutputEvent, BuildRequest, CliErrorInfo } from '../../../shared/types'

  let contextDir = $state('')
  let dockerfilePath = $state('')
  let dockerfileMissing = $state(false)
  let tag = $state('')
  let buildArgsText = $state('')
  let target = $state('')
  let noCache = $state(false)
  let platform = $state('')
  let showAdvanced = $state(false)
  let error = $state<CliErrorInfo | null>(null)

  let runId = $state<string | null>(null)
  let lines = $state<{ kind: 'stdout' | 'stderr' | 'error'; text: string }[]>([])
  let starting = $state(false)
  let result = $state<{ status: 'succeeded' | 'failed' | 'canceled'; code: number | null; message?: string } | null>(null)
  let startedAt = $state(0)
  let elapsed = $state('')
  let logEl = $state<HTMLDivElement | null>(null)
  let autoScroll = $state(true)
  let elapsedTimer: number | undefined

  onMount(() => {
    const api = getApi()
    const offOutput = api.onBuildOutput((e: BuildOutputEvent) => {
      if (runId && e.runId !== runId) return
      lines = [...lines, { kind: e.stream, text: e.line }]
      if (autoScroll && logEl) queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }))
    })
    const offDone = api.onBuildDone((e: BuildDoneEvent) => {
      if (runId && e.runId !== runId) return
      runId = null
      if (elapsedTimer) window.clearInterval(elapsedTimer)
      elapsed = formatElapsed(Date.now() - startedAt)
      if (e.canceled) result = { status: 'canceled', code: e.code }
      else if (e.error) result = { status: 'failed', code: e.code, message: e.error.message }
      else result = { status: 'succeeded', code: e.code }
    })
    return () => {
      offOutput()
      offDone()
      if (elapsedTimer) window.clearInterval(elapsedTimer)
    }
  })

  async function chooseContext(): Promise<void> {
    const dir = await getApi().pickDirectory(contextDir || undefined)
    if (!dir) return
    contextDir = dir
    tag = tag || defaultTagFor(dir)
    const { dockerfile } = await getApi().contextInspect(dir)
    dockerfilePath = dockerfile ?? ''
    dockerfileMissing = dockerfile === null
  }

  async function chooseDockerfile(): Promise<void> {
    const file = await getApi().pickFile(contextDir || undefined)
    if (file) {
      dockerfilePath = file
      dockerfileMissing = false
    }
  }

  async function start(): Promise<void> {
    error = null
    result = null
    lines = []
    const { args, errors } = parseBuildArgs(buildArgsText)
    if (errors.length > 0) {
      error = { code: 'CLI_ERROR', message: errors.join(' ') }
      return
    }
    const req: BuildRequest = {
      contextDir,
      dockerfilePath: dockerfilePath || undefined,
      tag: tag.trim(),
      buildArgs: args,
      target: target.trim() || undefined,
      noCache,
      platform: platform || undefined
    }
    starting = true
    try {
      const started = await getApi().buildStart(req)
      if (started.ok === false) {
        error = started.error
        return
      }
      runId = started.runId
      startedAt = Date.now()
      elapsed = '0.0s'
      elapsedTimer = window.setInterval(() => {
        elapsed = formatElapsed(Date.now() - startedAt)
      }, 500)
    } finally {
      starting = false
    }
  }

  async function cancel(): Promise<void> {
    if (runId) await getApi().buildCancel(runId)
  }
</script>

<section class="screen">
  <header><h1>Build</h1></header>
  <form onsubmit={(e) => { e.preventDefault(); void start() }}>
    <div class="row">
      <label for="context">Context directory</label>
      <input id="context" readonly value={contextDir} placeholder="Choose a folder…" />
      <button type="button" onclick={chooseContext}>Choose…</button>
    </div>
    <div class="row">
      <label for="dockerfile">Dockerfile</label>
      <input id="dockerfile" bind:value={dockerfilePath} placeholder="Dockerfile" />
      <button type="button" onclick={chooseDockerfile}>Browse…</button>
    </div>
    {#if dockerfileMissing && dockerfilePath === ''}
      <p class="muted">No Dockerfile or Containerfile found in this folder — choose one, or the build will fail.</p>
    {/if}
    <div class="row">
      <label for="tag">Tag</label>
      <input id="tag" bind:value={tag} placeholder="my-app" />
    </div>

    <button type="button" class="disclosure" onclick={() => (showAdvanced = !showAdvanced)}>
      {showAdvanced ? '▾' : '▸'} Advanced
    </button>
    {#if showAdvanced}
      <div class="row">
        <label for="args">Build args</label>
        <textarea id="args" bind:value={buildArgsText} placeholder="one KEY=VALUE per line"></textarea>
      </div>
      <div class="row">
        <label for="target">Target stage</label>
        <input id="target" bind:value={target} />
      </div>
      <div class="row">
        <label for="platform">Platform</label>
        <select id="platform" bind:value={platform}>
          <option value="">Builder default</option>
          <option value="linux/arm64">linux/arm64</option>
          <option value="linux/amd64">linux/amd64</option>
        </select>
      </div>
      <label class="check"><input type="checkbox" bind:checked={noCache} /> No cache</label>
    {/if}

    {#if error}
      <p class="error">{error.message}</p>
    {/if}

    <button type="submit" disabled={starting || runId !== null || !contextDir || !tag.trim()}>
      {starting ? 'Starting…' : 'Build'}
    </button>
  </form>

  {#if runId || lines.length > 0 || result}
    <div class="build-log">
      <div class="log-head">
        <span>
          {#if runId}Building… {elapsed}
          {:else if result?.status === 'succeeded'}Succeeded · exit {result.code} · {elapsed} · {tag}
          {:else if result?.status === 'failed'}Failed · exit {result.code} · {elapsed}
          {:else if result?.status === 'canceled'}Canceled · {elapsed}
          {/if}
        </span>
        <span class="log-actions">
          <button type="button" onclick={() => (lines = [])}>Clear</button>
          {#if runId}<button type="button" onclick={cancel}>Cancel</button>{/if}
        </span>
      </div>
      {#if result?.status === 'failed' && result.message}
        <p class="error">{result.message}</p>
      {/if}
      <div
        class="log-body"
        bind:this={logEl}
        onscroll={() => {
          if (logEl) autoScroll = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 4
        }}
      >
        {#each lines as l, i (i)}
          <pre class:stderr={l.kind === 'stderr'}>{l.text}</pre>
        {/each}
      </div>
    </div>
  {/if}
</section>
