<script lang="ts">
  import { getApi } from '../lib/api'
  import { defaultTagFor, parseBuildArgs } from '../lib/format'
  import type { BuildRequest, CliErrorInfo } from '../../../shared/types'

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
  let starting = $state(false)

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
    if (file) dockerfilePath = file
  }

  async function start(): Promise<void> {
    error = null
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
      const result = await getApi().buildStart(req)
      if (result.ok === false) error = result.error
      // streaming/footer wiring arrives in Task 12
    } finally {
      starting = false
    }
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
    {#if dockerfileMissing}
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

    <button type="submit" disabled={starting || !contextDir || !tag.trim()}>
      {starting ? 'Starting…' : 'Build'}
    </button>
  </form>
</section>
