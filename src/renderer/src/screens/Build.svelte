<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import { defaultTagFor, formatElapsed, parseBuildArgs } from '../lib/format'
  import type {
    BuildDoneEvent,
    BuildOutputEvent,
    BuildRequest,
    CliErrorInfo
  } from '../../../shared/types'

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
  let building = $state(false)
  let lines = $state<{ kind: 'stdout' | 'stderr' | 'error'; text: string }[]>([])
  let starting = $state(false)
  let result = $state<{
    status: 'succeeded' | 'failed' | 'canceled'
    code: number | null
    message?: string
  } | null>(null)
  let builtTag = $state('')
  let startedAt = $state(0)
  let elapsed = $state('')
  let logEl = $state<HTMLDivElement | null>(null)
  let autoScroll = $state(true)
  let elapsedTimer: number | undefined

  function failureMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  onMount(() => {
    const api = getApi()
    const offOutput = api.onBuildOutput((e: BuildOutputEvent) => {
      // Only the run this screen started may write to its log.
      if (e.runId !== runId) return
      lines = [...lines, { kind: e.stream, text: e.line }]
      if (autoScroll && logEl) queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }))
    })
    const offDone = api.onBuildDone((e: BuildDoneEvent) => {
      if (e.runId !== runId) return
      building = false
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
    try {
      const dir = await getApi().pickDirectory(contextDir || undefined)
      if (!dir) return
      contextDir = dir
      tag = tag || defaultTagFor(dir)
      const { dockerfile } = await getApi().contextInspect(dir)
      dockerfilePath = dockerfile ?? ''
      dockerfileMissing = dockerfile === null
    } catch (e) {
      error = { code: 'UNKNOWN', message: failureMessage(e) }
    }
  }

  async function chooseDockerfile(): Promise<void> {
    try {
      const file = await getApi().pickFile(contextDir || undefined)
      if (file) {
        dockerfilePath = file
        dockerfileMissing = false
      }
    } catch (e) {
      error = { code: 'UNKNOWN', message: failureMessage(e) }
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
      builtTag = req.tag
      autoScroll = true
      building = true
      startedAt = Date.now()
      elapsed = '0.0s'
      elapsedTimer = window.setInterval(() => {
        elapsed = formatElapsed(Date.now() - startedAt)
      }, 500)
    } catch (e) {
      error = { code: 'UNKNOWN', message: failureMessage(e) }
    } finally {
      starting = false
    }
  }

  async function cancel(): Promise<void> {
    if (!runId) return
    try {
      await getApi().buildCancel(runId)
    } catch (e) {
      error = { code: 'UNKNOWN', message: failureMessage(e) }
    }
  }
</script>

<section class="screen">
  <header>
    <div class="title">
      <h1>Build</h1>
      <p>Build an image from a Dockerfile in a local context.</p>
    </div>
  </header>

  <form
    class="card form-card"
    onsubmit={(e) => {
      e.preventDefault()
      void start()
    }}
  >
    <div class="field">
      <label for="context">Context</label>
      <div class="control">
        <input id="context" readonly value={contextDir} placeholder="Choose a folder…" />
        <button type="button" class="btn" onclick={chooseContext}>Choose…</button>
      </div>
    </div>

    <div class="field">
      <label for="dockerfile">Dockerfile</label>
      <div class="control">
        <input id="dockerfile" bind:value={dockerfilePath} placeholder="Dockerfile" />
        <button type="button" class="btn" onclick={chooseDockerfile}>Browse…</button>
      </div>
      {#if dockerfileMissing && dockerfilePath === ''}
        <p class="hint">
          No Dockerfile or Containerfile found in this folder — choose one, or the build will fail.
        </p>
      {/if}
    </div>

    <div class="field">
      <label for="tag">Tag</label>
      <input id="tag" bind:value={tag} placeholder="my-app" />
      <p class="hint">
        Defaults to the context folder name. Lowercase letters, digits, and . - _ / : are allowed.
      </p>
    </div>

    <div class="advanced">
      <button
        type="button"
        class="disclosure"
        aria-expanded={showAdvanced}
        onclick={() => (showAdvanced = !showAdvanced)}
      >
        <svg class="chev" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="m4.5 2.5 4 3.5-4 3.5"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>Advanced</span>
        <span class="adv-summary">build args · target · platform · cache</span>
      </button>
      {#if showAdvanced}
        <div class="advanced-body">
          <div class="field">
            <label for="args">Build args</label>
            <textarea id="args" bind:value={buildArgsText} placeholder="one KEY=VALUE per line"
            ></textarea>
          </div>
          <div class="field">
            <label for="target">Target stage</label>
            <input id="target" bind:value={target} placeholder="optional" />
          </div>
          <div class="field">
            <label for="platform">Platform</label>
            <select id="platform" bind:value={platform}>
              <option value="">Builder default</option>
              <option value="linux/arm64">linux/arm64</option>
              <option value="linux/amd64">linux/amd64</option>
            </select>
          </div>
          <div class="field">
            <label for="no-cache">Cache</label>
            <label class="switch">
              <input id="no-cache" type="checkbox" bind:checked={noCache} />
              <span>No cache</span>
            </label>
          </div>
        </div>
      {/if}
    </div>

    {#if error}
      <p class="error">{error.message}</p>
    {/if}

    <div class="form-footer">
      <p class="hint">
        {#if !contextDir}Choose a context folder to enable building.{:else if !tag.trim()}Add a tag
          to enable building.{:else}Builds run in the background; output streams below.{/if}
      </p>
      <button
        type="submit"
        class="btn btn-primary"
        disabled={starting || building || !contextDir || !tag.trim()}
      >
        {starting ? 'Starting…' : 'Build'}
      </button>
    </div>
  </form>

  {#if runId || lines.length > 0 || result}
    <div class="build-log">
      <div class="log-head">
        <span class="log-status" data-state={building ? 'building' : result?.status}>
          <span class="dot"></span>
          {#if building}
            <strong>Building</strong><span>{elapsed}</span>
          {:else if result?.status === 'succeeded'}
            <strong>Succeeded · exit {result.code}</strong><span>{elapsed} · {builtTag}</span>
          {:else if result?.status === 'failed'}
            <strong>Failed · exit {result.code}</strong><span>{elapsed}</span>
          {:else if result?.status === 'canceled'}
            <strong>Canceled</strong><span>{elapsed}</span>
          {/if}
        </span>
        <span class="log-actions">
          <button type="button" class="btn btn-ghost" onclick={() => (lines = [])}>Clear</button>
          {#if building}
            <button type="button" class="btn btn-ghost" onclick={cancel}>Cancel</button>
          {/if}
        </span>
      </div>
      {#if result?.status === 'failed' && result.message}
        <p class="error" style="margin: 8px 13px 0">{result.message}</p>
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
