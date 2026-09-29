# Aiu Containers Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A macOS Electron app that lists containers running in Apple's `container` runtime and builds images from a Dockerfile, with live streamed build output.

**Architecture:** All `container` CLI execution happens in Electron's main process behind a typed module (`container-cli/`: locate binary → run/stream → parse tolerant JSON → classified errors). The Svelte renderer is unprivileged and calls a typed API exposed through a sandboxed preload `contextBridge` (`window.containers`). Tests run against a stateful fake `container` CLI placed on `PATH`; parsers are validated against JSON captured from the real CLI v0.10.0.

**Tech Stack:** electron-vite 5 · Electron 39 (template-pinned) · Svelte 5 · TypeScript 5.9 · Vite 7 · pnpm · Vitest 5 + jsdom + @testing-library/svelte · electron-builder 26.

**Spec:** `docs/superpowers/specs/2026-09-29-aiu-containers-electron-design.md`

## Global Constraints

- pnpm only: `pnpm install`, `pnpm add`, `pnpm <script>`. Never npm. (The scaffold's internal `npm run …` script chains must be rewritten to `pnpm` in Task 1.)
- Target machine: macOS arm64, Node 26, pnpm 12, Apple `container` CLI v0.10.0 at `/usr/local/bin/container`.
- All `container` CLI execution in the main process. Renderer talks only through `window.containers`.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, argv arrays only (never a shell string).
- Default container list = running only (`container list --format json`); "Show stopped" uses `container list --all --format json`.
- No runtime dependencies beyond the template's `@electron-toolkit/utils`. Dev-only additions allowed: `vitest@^5`, `jsdom@^30`, `@testing-library/svelte@^5.4`, `@testing-library/jest-dom@^7`.
- Styling: scoped CSS, no UI kit.
- productName `Aiu Containers Electron`, appId `com.ionutale.aiu-containers-electron`, unsigned packaging.
- Every task ends with `pnpm test`, `pnpm typecheck` where applicable, and a commit.

## Review Focus

Inputs/conditions the spec implies but whose checks live in specific tasks (each line is pinned by a test in the task named):

1. `container` binary missing (not on `PATH`) — app must show an install hint and disable actions, never crash or render blank. (Tasks 4, 6, 10)
2. Container service not running (XPC error) — list/build must surface `SERVICE_NOT_RUNNING`; "Start service" must actually work and the list must reload after it. (Tasks 6, 10)
3. Cancel mid-build — no orphaned child process; result is `canceled`, never `BUILD_FAILED`. (Tasks 4, 7, 12)
4. Odd build inputs — non-existent context, empty or uppercase/space tag, missing Dockerfile, `KEY=VALUE` lines without `=`, build args with spaces. (Tasks 7, 11)
5. CLI version drift — empty stdout, malformed JSON, missing optional keys must not crash; bad JSON surfaces `PARSE_ERROR`. (Tasks 5, 6, 10)

---

## File Structure

```
aiu-containers-electron/
  src/main/
    index.ts                     app lifecycle, window, IPC wiring (modify in Task 8)
    ipc.ts                       channel registration, thin over injected deps (Task 8)
    context.ts                   findDockerfile(dir) (Task 8)
    container-cli/
      cli.ts                     locate binary, run/stream, cancel, version (Task 4)
      parsers.ts                 tolerant JSON parsers + ParseError (Task 5)
      commands.ts                listContainers / systemStatus / startSystem (Task 6)
      build.ts                   validate, argv, BuildManager (Task 7)
  src/preload/
    index.ts                     contextBridge window.containers (Task 8)
    index.d.ts                   Window typing (Task 8)
  src/shared/
    types.ts                     domain types + error codes (Task 2)
    api.ts                       ContainersApi, CHANNELS (Task 2/8)
    errors.ts                    classifyCliFailure (Task 2)
  src/renderer/src/
    App.svelte                   sidebar shell (Tasks 9, 11)
    screens/Containers.svelte    list screen (Tasks 9, 10)
    screens/Build.svelte         build screen (Tasks 11, 12)
    lib/api.ts                   window.containers accessor (Task 9)
    lib/format.ts                pure helpers: parseBuildArgs, defaultTagFor, formatElapsed (Tasks 9, 11)
    assets/main.css              app styles (Task 9)
  tests/
    fake-container/container     stateful fake CLI (Task 3)
    helpers/fakeCli.ts           temp-dir fake CLI setup (Task 3)
    fixtures/real-list.json      captured from real CLI (Task 5)
    fixtures/real-system-status.json (Task 5)
    unit/…                       errors, parsers, build, context, ipc, format (Tasks 2, 5, 7, 8, 9, 11)
    integration/…                cli, commands, build-manager, cancel (Tasks 4, 6, 7)
    setup.ts                     jest-dom setup (Task 9)
  examples/hello/Dockerfile      smoke-build fixture (Task 13)
  vitest.config.ts               (Task 1)
  electron-builder.yml           (Task 13)
  README.md                      (Task 13)
```

---

### Task 1: Scaffold the project, wire Vitest

**Files:**
- Create: whole app scaffold (copied from `@quick-start/create-electron` template `svelte-ts`)
- Create: `.gitignore`, `vitest.config.ts`, `tests/unit/sanity.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a repo that builds (`pnpm build`) and tests (`pnpm test`); script names used by every later task.

- [ ] **Step 1: Scaffold into a temp dir and copy into the repo**

The repo already contains `.git/` and `docs/`; the scaffolder wants an empty dir, so scaffold elsewhere and copy the contents in:

```bash
tmp=$(mktemp -d)
cd "$tmp"
yes '' | pnpm dlx @quick-start/create-electron@latest scaffold-app --template svelte-ts
cd /Users/ionutale/developer-playground/aiu-containers-electron
cp -R "$tmp/scaffold-app/." .
rm -rf "$tmp"
ls
```

Expected: `.editorconfig .npmrc .prettierignore .prettierrc.yaml .vscode build electron.vite.config.ts eslint.config.mjs package.json resources svelte.config.mjs src tsconfig.json tsconfig.node.json tsconfig.web.json`.

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`
Expected: completes; `postinstall` runs `electron-builder install-app-deps` without error.

- [ ] **Step 3: Add `.gitignore`**

```
node_modules/
out/
dist/
coverage/
*.log
.DS_Store
.eslintcache
```

- [ ] **Step 4: Rewrite `package.json` fields and scripts**

Change the top fields and scripts so they match this project and use pnpm:

```json
{
  "name": "aiu-containers-electron",
  "version": "0.1.0",
  "description": "List running Apple containers and build images from a Dockerfile",
  "author": "Ion Utale",
  "engines": { "node": ">=20" }
}
```

Scripts (keep the rest of the template scripts):

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "build": "pnpm typecheck && electron-vite build",
  "typecheck": "pnpm typecheck:node && pnpm svelte-check"
}
```

(Only the `npm run …` internals change to `pnpm …`; the rest stay as scaffolded.)

- [ ] **Step 5: Add Vitest + config + a sanity test**

```bash
pnpm add -D vitest@^5
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
```

`tests/unit/sanity.test.ts` — asserts the project wiring is real (runner works, package metadata points at the built main file):

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('project wiring', () => {
  it('package.json points main at the electron-vite build output', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pkg.name).toBe('aiu-containers-electron')
    expect(pkg.main).toBe('./out/main/index.js')
  })
})
```

- [ ] **Step 6: Verify build and tests**

Run: `pnpm test`
Expected: 1 passed.

Run: `pnpm build`
Expected: typecheck passes, `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` exist.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite svelte-ts app with vitest"
```

---

### Task 2: Shared types, IPC channel names, error classification

**Files:**
- Create: `src/shared/types.ts`, `src/shared/api.ts`, `src/shared/errors.ts`
- Test: `tests/unit/errors.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `ContainerSummary`, `SystemStatus`, `CliErrorCode`, `CliErrorInfo`, `ListResult`, `SystemStatusResult`, `ActionResult`, `BuildRequest`, `BuildStartResult`, `BuildOutputEvent`, `BuildDoneEvent`, `BuildLine`, `ContainersApi`, `CHANNELS`; `classifyCliFailure(input) => CliErrorInfo` (used by Tasks 4, 6, 7, 8).

- [ ] **Step 1: Write the failing test**

`tests/unit/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyCliFailure } from '../../src/shared/errors'

const SERVICE_DOWN = `Error: internalError: "failed to list containers" (cause: "interrupted: "XPC connection error: Connection invalid"") Ensure container system service has been started with 'container system start'.`

describe('classifyCliFailure', () => {
  it('maps spawn ENOENT to CLI_MISSING', () => {
    const err = Object.assign(new Error('spawn container ENOENT'), { code: 'ENOENT' })
    expect(classifyCliFailure({ spawnError: err }).code).toBe('CLI_MISSING')
  })

  it('maps the XPC/service stderr to SERVICE_NOT_RUNNING', () => {
    const info = classifyCliFailure({ exitCode: 1, stderr: SERVICE_DOWN })
    expect(info.code).toBe('SERVICE_NOT_RUNNING')
  })

  it('maps other non-zero exits to CLI_ERROR with stderr as message', () => {
    const info = classifyCliFailure({ exitCode: 125, stderr: 'boom' })
    expect(info.code).toBe('CLI_ERROR')
    expect(info.message).toBe('boom')
    expect(info.exitCode).toBe(125)
  })

  it('maps timeouts to CLI_ERROR mentioning timeout', () => {
    const info = classifyCliFailure({ timedOut: true, exitCode: null })
    expect(info.code).toBe('CLI_ERROR')
    expect(info.message).toMatch(/timed out/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/errors.test.ts`
Expected: FAIL — cannot resolve `../../src/shared/errors`.

- [ ] **Step 3: Write `src/shared/types.ts`**

```ts
export interface ContainerSummary {
  id: string
  image: string
  state: string
  ip: string
  platform: string
  created: string
  networks: string[]
}

export interface SystemStatus {
  status: string
  clientVersion: string
  serverVersion: string
  hostArch: string
  hostOs: string
  containersTotal: number | null
  containersRunning: number | null
}

export type CliErrorCode =
  | 'CLI_MISSING'
  | 'SERVICE_NOT_RUNNING'
  | 'CLI_ERROR'
  | 'PARSE_ERROR'
  | 'BUILD_FAILED'
  | 'CANCELED'
  | 'UNKNOWN'

export interface CliErrorInfo {
  code: CliErrorCode
  message: string
  exitCode?: number | null
  stderr?: string
}

export type ListResult = { ok: true; containers: ContainerSummary[] } | { ok: false; error: CliErrorInfo }
export type SystemStatusResult = { ok: true; status: SystemStatus } | { ok: false; error: CliErrorInfo }
export type ActionResult = { ok: true } | { ok: false; error: CliErrorInfo }

export interface BuildRequest {
  contextDir: string
  dockerfilePath?: string
  tag: string
  buildArgs: { key: string; value: string }[]
  target?: string
  noCache: boolean
  platform?: string
}

export type BuildStream = 'stdout' | 'stderr'
export interface BuildLine {
  stream: BuildStream
  line: string
}
export interface BuildOutputEvent extends BuildLine {
  runId: string
}
export interface BuildDoneEvent {
  runId: string
  code: number | null
  signal: string | null
  canceled: boolean
  error?: CliErrorInfo
}

export type BuildStartResult = { ok: true; runId: string } | { ok: false; error: CliErrorInfo }
```

- [ ] **Step 4: Write `src/shared/api.ts`**

```ts
import type {
  ActionResult,
  BuildDoneEvent,
  BuildOutputEvent,
  BuildRequest,
  BuildStartResult,
  ListResult,
  SystemStatusResult
} from './types'

export const CHANNELS = {
  list: 'containers:list',
  systemStatus: 'system:status',
  systemStart: 'system:start',
  buildStart: 'build:start',
  buildCancel: 'build:cancel',
  contextInspect: 'context:inspect',
  pickDirectory: 'dialog:pickDirectory',
  pickFile: 'dialog:pickFile',
  buildOutput: 'build:output',
  buildDone: 'build:done'
} as const

export interface ContainersApi {
  list(runningOnly: boolean): Promise<ListResult>
  systemStatus(): Promise<SystemStatusResult>
  systemStart(): Promise<ActionResult>
  buildStart(req: BuildRequest): Promise<BuildStartResult>
  buildCancel(runId: string): Promise<{ ok: boolean }>
  contextInspect(dir: string): Promise<{ dockerfile: string | null }>
  pickDirectory(defaultPath?: string): Promise<string | null>
  pickFile(defaultPath?: string): Promise<string | null>
  onBuildOutput(cb: (e: BuildOutputEvent) => void): () => void
  onBuildDone(cb: (e: BuildDoneEvent) => void): () => void
}
```

- [ ] **Step 5: Write `src/shared/errors.ts`** (minimal implementation)

```ts
import type { CliErrorInfo } from './types'

const SERVICE_DOWN_PATTERNS = [
  'container system service has been started',
  'XPC connection error',
  'Connection invalid'
]

export function classifyCliFailure(input: {
  spawnError?: NodeJS.ErrnoException | null
  exitCode?: number | null
  stderr?: string
  timedOut?: boolean
}): CliErrorInfo {
  const stderr = (input.stderr ?? '').trim()
  if (input.spawnError?.code === 'ENOENT') {
    return {
      code: 'CLI_MISSING',
      message: "The `container` CLI was not found. Install Apple's container runtime, then restart the app.",
      stderr
    }
  }
  if (SERVICE_DOWN_PATTERNS.some((p) => stderr.includes(p))) {
    return {
      code: 'SERVICE_NOT_RUNNING',
      message: 'The container service is not running.',
      exitCode: input.exitCode ?? null,
      stderr
    }
  }
  if (input.timedOut) {
    return { code: 'CLI_ERROR', message: 'The container command timed out.', stderr }
  }
  if (input.exitCode !== null && input.exitCode !== undefined && input.exitCode !== 0) {
    return {
      code: 'CLI_ERROR',
      message: stderr || `container exited with code ${input.exitCode}`,
      exitCode: input.exitCode,
      stderr
    }
  }
  return { code: 'UNKNOWN', message: stderr || 'Unknown error', stderr }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- tests/unit/errors.test.ts`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add src/shared tests/unit/errors.test.ts
git commit -m "feat: shared domain types and CLI error classification"
```

---

### Task 3: Fake `container` CLI harness

**Files:**
- Create: `tests/fake-container/container`, `tests/helpers/fakeCli.ts`
- Test: `tests/unit/fakecli.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeFakeCli(root: string, opts?: { mode?: FakeMode }): { binDir: string; statePath: string; env: NodeJS.ProcessEnv }` where `FakeMode = 'default' | 'service-down' | 'bad-json' | 'slow-build' | 'blocking-build' | 'failing-build'`. Every later test that needs a CLI uses this. The fake's `list` output shape doubles as the reference for parsers in Task 5.

- [ ] **Step 1: Write the fake CLI**

`tests/fake-container/container` (then `chmod +x`):

```js
#!/usr/bin/env node
// Stateful fake of Apple's `container` CLI (v0.10.0 shapes) for tests.
// Modes via FAKE_CONTAINER_MODE: default | service-down | bad-json |
// slow-build | blocking-build | failing-build
import { readFileSync, writeFileSync } from 'node:fs'

const MODE = process.env.FAKE_CONTAINER_MODE ?? 'default'
const STATE_PATH = process.env.FAKE_CONTAINER_STATE
const args = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SERVICE_DOWN_STDERR =
  'Error: internalError: "failed to list containers" (cause: "interrupted: "XPC connection error: Connection invalid"") ' +
  "Ensure container system service has been started with 'container system start'.\n"

const seededContainers = [
  {
    id: 'web-1',
    configuration: {
      image: { reference: 'docker.io/library/nginx:latest', descriptor: { digest: 'sha256:nginx123' } },
      platform: { os: 'linux', architecture: 'arm64' },
      resources: { cpus: 2, memoryInBytes: 1073741824 },
      creationDate: '2026-08-31T12:00:00Z',
      networks: [{ network: 'default', options: {} }],
      labels: {}
    },
    status: {
      state: 'running',
      networks: [
        { network: 'default', hostname: 'web-1', ipv4Address: '192.168.64.2/24', ipv4Gateway: '192.168.64.1' }
      ]
    }
  },
  {
    id: 'db-1',
    configuration: {
      image: { reference: 'docker.io/library/postgres:16', descriptor: { digest: 'sha256:pg123' } },
      platform: { os: 'linux', architecture: 'arm64' },
      resources: { cpus: 4, memoryInBytes: 2147483648 },
      creationDate: '2026-08-31T11:00:00Z',
      networks: [{ network: 'default', options: {} }],
      labels: {}
    },
    status: { state: 'stopped', networks: [] }
  }
]

function state() {
  if (!STATE_PATH) return { extra: [] }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'))
  } catch {
    return { extra: [] }
  }
}

function save(s) {
  if (STATE_PATH) writeFileSync(STATE_PATH, JSON.stringify(s))
}

function containers() {
  return seededContainers.filter((c) => !state().deleted?.includes(c.id)).concat(state().extra ?? [])
}

function serviceDown() {
  process.stderr.write(SERVICE_DOWN_STDERR)
  process.exit(1)
}

async function main() {
  const sub = args[0] ?? ''
  const rest = args.slice(1)

  if (sub === '--version') {
    console.log('container CLI version 0.10.0 (build: release, commit: fake)')
    return
  }
  if (sub === 'list') {
    if (MODE === 'service-down') serviceDown()
    if (MODE === 'bad-json') {
      process.stdout.write('{"oops')
      return
    }
    const all = rest.includes('--all')
    process.stdout.write(JSON.stringify(all ? containers() : containers().filter((c) => c.status.state === 'running')))
    return
  }
  if (sub === 'system' && rest[0] === 'status') {
    if (MODE === 'service-down') serviceDown()
    console.log(
      JSON.stringify({
        status: 'running',
        client: { version: '0.10.0', build: 'release' },
        server: { version: '0.10.0' },
        host: { architecture: 'arm64', operatingSystem: 'macos', cpus: 10 },
        resources: {
          containersTotal: containers().length,
          containersRunning: containers().filter((c) => c.status.state === 'running').length
        }
      })
    )
    return
  }
  if (sub === 'system' && rest[0] === 'start') {
    console.log('Container services started')
    return
  }
  if (sub === 'build') {
    console.log('fake build args: ' + JSON.stringify(rest))
    if (MODE === 'blocking-build') {
      console.log('#1 [internal] load build definition')
      await sleep(600_000)
      return
    }
    const steps = [
      '#1 [internal] load build definition from Dockerfile',
      '#2 [1/2] FROM alpine:3.20',
      '#3 [2/2] RUN echo hello',
      '#4 exporting layers',
      'DONE 0.2s'
    ]
    for (const s of steps) {
      console.log(s)
      await sleep(MODE === 'slow-build' ? 120 : 5)
    }
    if (MODE === 'failing-build') {
      console.error('ERROR: process "/bin/sh -c exit 1" did not complete successfully')
      process.exit(1)
    }
    console.log('fake: done')
    return
  }
  console.error('fake container: unhandled command: ' + args.join(' '))
  process.exit(1)
}

main()
```

- [ ] **Step 2: Write the helper**

`tests/helpers/fakeCli.ts`:

```ts
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type FakeMode = 'default' | 'service-down' | 'bad-json' | 'slow-build' | 'blocking-build' | 'failing-build'

const FAKE_SOURCE = fileURLToPath(new URL('../fake-container/container', import.meta.url))

export interface FakeCli {
  binDir: string
  statePath: string
  env: NodeJS.ProcessEnv
}

export function makeFakeCli(root: string, opts: { mode?: FakeMode } = {}): FakeCli {
  const binDir = join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  const target = join(binDir, 'container')
  copyFileSync(FAKE_SOURCE, target)
  chmodSync(target, 0o755)
  const statePath = join(root, 'state.json')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    FAKE_CONTAINER_STATE: statePath
  }
  if (opts.mode) env.FAKE_CONTAINER_MODE = opts.mode
  return { binDir, statePath, env }
}
```

- [ ] **Step 3: Write the failing test**

`tests/unit/fakecli.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeCli } from '../helpers/fakeCli'

function run(fake: ReturnType<typeof makeFakeCli>, args: string[]): string {
  return execFileSync(join(fake.binDir, 'container'), args, { env: fake.env }).toString()
}

describe('fake container CLI', () => {
  it('lists only running containers by default and all with --all', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    expect(JSON.parse(run(fake, ['list', '--format', 'json']))).toHaveLength(1)
    expect(JSON.parse(run(fake, ['list', '--all', '--format', 'json']))).toHaveLength(2)
  })

  it('emits the real service-not-running stderr in service-down mode', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')), { mode: 'service-down' })
    try {
      run(fake, ['list', '--format', 'json'])
      expect.unreachable('should have exited non-zero')
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr)).toContain('container system service has been started')
    }
  })

  it('reports version and system status', () => {
    const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'fakecli-')))
    expect(run(fake, ['--version'])).toContain('0.10.0')
    const status = JSON.parse(run(fake, ['system', 'status', '--format', 'json']))
    expect(status.status).toBe('running')
    expect(status.resources.containersRunning).toBe(1)
  })
})
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `pnpm test -- tests/unit/fakecli.test.ts`
Expected first: FAIL (missing helper/fake). After Step 1–2 are in place: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/fake-container tests/helpers tests/unit/fakecli.test.ts
git commit -m "test: stateful fake container CLI harness"
```

---

### Task 4: CLI client — locate, run, stream, cancel, version

**Files:**
- Create: `src/main/container-cli/cli.ts`
- Test: `tests/integration/cli.test.ts`

**Interfaces:**
- Consumes: `makeFakeCli` (Task 3).
- Produces: `findContainerBinary(env?): string | null`; `runCli(args, { env?, timeoutMs? }): Promise<CliRunResult>`; `streamCli(args, { env? }, onLine): StreamHandle`; `getCliVersion(env?): Promise<{ path: string; version: string | null } | null>`; `isVersionAtLeast(v, min): boolean`. `CliRunResult = { code, signal, stdout, stderr, spawnError, timedOut }`; `CliStreamResult` adds `canceled: boolean`; `StreamHandle = { pid: number | undefined; cancel(): void; done: Promise<CliStreamResult> }`. Consumed by Tasks 6, 7.

- [ ] **Step 1: Write the failing integration test**

`tests/integration/cli.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findContainerBinary, getCliVersion, isVersionAtLeast, runCli, streamCli } from '../../src/main/container-cli/cli'
import { makeFakeCli } from '../helpers/fakeCli'

const tmp = () => mkdtempSync(join(tmpdir(), 'cli-'))

describe('findContainerBinary', () => {
  it('finds the fake container through PATH', () => {
    const fake = makeFakeCli(tmp())
    expect(findContainerBinary(fake.env)).toBe(join(fake.binDir, 'container'))
  })

  it('returns null for a custom env with no CLI (fallbacks apply only to the real environment)', () => {
    expect(findContainerBinary({ PATH: '/nonexistent' })).toBeNull()
  })
})

describe('runCli', () => {
  it('captures stdout and exit code', async () => {
    const fake = makeFakeCli(tmp())
    const r = await runCli(['list', '--format', 'json'], { env: fake.env })
    expect(r.spawnError).toBeNull()
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toHaveLength(1)
  })

  it('reports ENOENT spawn error when the CLI is missing', async () => {
    const r = await runCli(['list'], { env: { PATH: '/nonexistent' } })
    expect(r.spawnError?.code).toBe('ENOENT')
  })

  it('reports timedOut when the CLI hangs past the timeout', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'blocking-build' })
    const r = await runCli(['build', '.'], { env: fake.env, timeoutMs: 200 })
    expect(r.timedOut).toBe(true)
  })
})

describe('streamCli', () => {
  it('delivers lines in order, then a done result', async () => {
    const fake = makeFakeCli(tmp())
    const lines: string[] = []
    const handle = streamCli(['build', '-t', 'x:latest', '.'], { env: fake.env }, (_stream, line) => lines.push(line))
    const result = await handle.done
    expect(result.code).toBe(0)
    expect(lines).toContain('fake: done')
    expect(lines[0]).toContain('fake build args')
  })

  it('cancel sends SIGTERM, resolves canceled, and leaves no process behind', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'blocking-build' })
    const started: string[] = []
    const handle = streamCli(['build', '.'], { env: fake.env }, (_s, line) => started.push(line))
    while (started.length === 0) await new Promise((r) => setTimeout(r, 10))
    const pid = handle.pid!
    handle.cancel()
    const result = await handle.done
    expect(result.canceled).toBe(true)
    expect(['SIGTERM', 'SIGKILL']).toContain(result.signal)
    expect(() => process.kill(pid, 0)).toThrow()
  })
})

describe('getCliVersion / isVersionAtLeast', () => {
  it('parses the version from --version output', async () => {
    const fake = makeFakeCli(tmp())
    const v = await getCliVersion(fake.env)
    expect(v?.version).toBe('0.10.0')
  })

  it('compares versions', () => {
    expect(isVersionAtLeast('0.10.0', '0.10.0')).toBe(true)
    expect(isVersionAtLeast('0.9.0', '0.10.0')).toBe(false)
    expect(isVersionAtLeast('1.0.0', '0.10.0')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/integration/cli.test.ts`
Expected: FAIL — cannot resolve `src/main/container-cli/cli`.

- [ ] **Step 3: Implement `src/main/container-cli/cli.ts`**

```ts
import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface CliRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  spawnError: NodeJS.ErrnoException | null
  timedOut: boolean
}

export interface CliStreamResult extends CliRunResult {
  canceled: boolean
}

export interface StreamHandle {
  pid: number | undefined
  cancel(): void
  done: Promise<CliStreamResult>
}

const FALLBACK_PATHS = ['/usr/local/bin/container', '/opt/homebrew/bin/container']

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findContainerBinary(env: NodeJS.ProcessEnv = process.env, includeFallbacks = env === process.env): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'container')
    if (isExecutable(candidate)) return candidate
  }
  if (includeFallbacks) {
    for (const candidate of FALLBACK_PATHS) {
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function missingResult(): CliRunResult {
  return {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    spawnError: Object.assign(new Error('container not found'), { code: 'ENOENT' }) as NodeJS.ErrnoException,
    timedOut: false
  }
}

export function runCli(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}
): Promise<CliRunResult> {
  const env = opts.env ?? process.env
  const bin = findContainerBinary(env)
  if (!bin) return Promise.resolve(missingResult())
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError: NodeJS.ErrnoException | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, spawnError, timedOut })
    }
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, opts.timeoutMs)
        : undefined
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => finish(null, null, err as NodeJS.ErrnoException))
    child.on('close', (code, signal) => finish(code, signal, null))
  })
}

export function streamCli(
  args: string[],
  opts: { env?: NodeJS.ProcessEnv },
  onLine: (stream: 'stdout' | 'stderr', line: string) => void
): StreamHandle {
  const env = opts.env ?? process.env
  const bin = findContainerBinary(env)
  if (!bin) {
    return {
      pid: undefined,
      cancel: () => {},
      done: Promise.resolve({ ...missingResult(), canceled: false })
    }
  }
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let canceled = false
  let killTimer: NodeJS.Timeout | undefined
  const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' }
  const emitLines = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    buffers[stream] += chunk.toString()
    const parts = buffers[stream].split('\n')
    buffers[stream] = parts.pop() ?? ''
    for (const line of parts) onLine(stream, line)
  }
  child.stdout.on('data', (d: Buffer) => emitLines('stdout', d))
  child.stderr.on('data', (d: Buffer) => emitLines('stderr', d))
  const done = new Promise<CliStreamResult>((resolve) => {
    child.on('error', (err) =>
      resolve({ ...missingResult(), spawnError: err as NodeJS.ErrnoException, canceled })
    )
    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer)
      for (const stream of ['stdout', 'stderr'] as const) {
        if (buffers[stream]) {
          onLine(stream, buffers[stream])
          buffers[stream] = ''
        }
      }
      resolve({ code, signal, stdout: '', stderr: '', spawnError: null, timedOut: false, canceled })
    })
  })
  return {
    pid: child.pid,
    cancel: () => {
      canceled = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
    },
    done
  }
}

export function isVersionAtLeast(version: string, min: string): boolean {
  const pa = version.split('.').map((n) => parseInt(n, 10))
  const pb = min.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? 0
    const b = pb[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

export async function getCliVersion(
  env: NodeJS.ProcessEnv = process.env
): Promise<{ path: string; version: string | null } | null> {
  const path = findContainerBinary(env)
  if (!path) return null
  const r = await runCli(['--version'], { env, timeoutMs: 5000 })
  const m = r.stdout.match(/version\s+(\d+\.\d+(?:\.\d+)?)/i)
  return { path, version: m ? m[1] : null }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/integration/cli.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/container-cli/cli.ts tests/integration/cli.test.ts
git commit -m "feat: container CLI client (locate, run, stream, cancel)"
```

---

### Task 5: Tolerant parsers + live fixture capture

**Files:**
- Create: `src/main/container-cli/parsers.ts`, `tests/fixtures/real-list.json`, `tests/fixtures/real-system-status.json`
- Test: `tests/unit/parsers.test.ts`

**Interfaces:**
- Consumes: `ContainerSummary`, `SystemStatus` (Task 2).
- Produces: `ParseError`; `parseContainerList(json: string): ContainerSummary[]`; `parseSystemStatus(json: string): SystemStatus`. Consumed by Task 6.

- [ ] **Step 1: Capture real CLI output as fixtures**

```bash
container system start   # if already running this is a no-op
container list --all --format json > tests/fixtures/real-list.json
container system status --format json > tests/fixtures/real-system-status.json
head -c 400 tests/fixtures/real-list.json
```

If the real shape differs from the field paths below, adapt `summarizeContainer` accordingly and say so in the commit message — tolerance (missing keys → empty values) is non-negotiable either way. If the service cannot start, keep the fixture capture as a pending manual step and proceed with the fake-CLI shape; note it in the commit.

- [ ] **Step 2: Write the failing test**

`tests/unit/parsers.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ParseError, parseContainerList, parseSystemStatus } from '../../src/main/container-cli/parsers'

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

describe('parseContainerList', () => {
  it('parses the captured real CLI output', () => {
    const list = parseContainerList(fixture('real-list.json'))
    expect(Array.isArray(list)).toBe(true)
    for (const c of list) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.platform).toMatch(/^linux\//)
    }
  })

  it('summarizes the fake CLI shape precisely', () => {
    const sample = {
      id: 'web-1',
      configuration: {
        image: { reference: 'docker.io/library/nginx:latest' },
        platform: { os: 'linux', architecture: 'arm64' },
        creationDate: '2026-08-31T12:00:00Z',
        networks: [{ network: 'default' }]
      },
      status: { state: 'running', networks: [{ ipv4Address: '192.168.64.2/24' }] }
    }
    expect(parseContainerList(JSON.stringify([sample]))).toEqual([
      {
        id: 'web-1',
        image: 'docker.io/library/nginx:latest',
        state: 'running',
        ip: '192.168.64.2',
        platform: 'linux/arm64',
        created: '2026-08-31T12:00:00Z',
        networks: ['default']
      }
    ])
  })

  it('tolerates missing optional keys and empty output', () => {
    expect(parseContainerList('')).toEqual([])
    expect(parseContainerList('   ')).toEqual([])
    expect(parseContainerList(JSON.stringify([{}]))).toEqual([
      { id: '', image: '', state: '', ip: '', platform: '', created: '', networks: [] }
    ])
  })

  it('throws ParseError on malformed JSON and unexpected shape', () => {
    expect(() => parseContainerList('{"oops')).toThrow(ParseError)
    expect(() => parseContainerList('{"not":"an array"}')).toThrow(ParseError)
  })
})

describe('parseSystemStatus', () => {
  it('parses the captured real CLI output', () => {
    const status = parseSystemStatus(fixture('real-system-status.json'))
    expect(status.status.length).toBeGreaterThan(0)
  })

  it('tolerates missing optional keys', () => {
    expect(parseSystemStatus('{"status":"running"}')).toEqual({
      status: 'running',
      clientVersion: '',
      serverVersion: '',
      hostArch: '',
      hostOs: '',
      containersTotal: null,
      containersRunning: null
    })
  })

  it('throws ParseError on invalid input', () => {
    expect(() => parseSystemStatus('nope')).toThrow(ParseError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- tests/unit/parsers.test.ts`
Expected: FAIL — cannot resolve `parsers`.

- [ ] **Step 4: Implement `src/main/container-cli/parsers.ts`**

```ts
import type { ContainerSummary, SystemStatus } from '../../shared/types'

export class ParseError extends Error {}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function summarizeContainer(entry: unknown): ContainerSummary {
  const e = record(entry)
  const cfg = record(e['configuration'])
  const status = record(e['status'])
  const image = record(cfg['image'])
  const platform = record(cfg['platform'])
  const statusNets = Array.isArray(status['networks']) ? status['networks'] : []
  const firstNet = record(statusNets[0])
  const cfgNets = Array.isArray(cfg['networks']) ? cfg['networks'] : []
  return {
    id: str(e['id']) || str(cfg['id']),
    image: str(image['reference']),
    state: str(status['state']),
    ip: str(firstNet['ipv4Address']).split('/')[0],
    platform: [str(platform['os']), str(platform['architecture'])].filter(Boolean).join('/'),
    created: str(cfg['creationDate']),
    networks: cfgNets.map((n) => str(record(n)['network'])).filter(Boolean)
  }
}

export function parseContainerList(json: string): ContainerSummary[] {
  if (!json.trim()) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ParseError('container list did not return valid JSON')
  }
  if (!Array.isArray(raw)) throw new ParseError('container list returned an unexpected shape')
  return raw.map(summarizeContainer)
}

export function parseSystemStatus(json: string): SystemStatus {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ParseError('container system status did not return valid JSON')
  }
  const e = record(raw)
  if (Object.keys(e).length === 0) throw new ParseError('container system status returned an empty object')
  const client = record(e['client'])
  const server = record(e['server'])
  const host = record(e['host'])
  const resources = record(e['resources'])
  return {
    status: str(e['status']),
    clientVersion: str(client['version']),
    serverVersion: str(server['version']),
    hostArch: str(host['architecture']),
    hostOs: str(host['operatingSystem']),
    containersTotal: num(resources['containersTotal']),
    containersRunning: num(resources['containersRunning'])
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/parsers.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add src/main/container-cli/parsers.ts tests/fixtures tests/unit/parsers.test.ts
git commit -m "feat: tolerant parsers validated against real CLI fixtures"
```

---

### Task 6: Command layer — list, system status, system start

**Files:**
- Create: `src/main/container-cli/commands.ts`
- Test: `tests/integration/commands.test.ts`

**Interfaces:**
- Consumes: `runCli` (Task 4), `parseContainerList`/`parseSystemStatus` (Task 5), `classifyCliFailure` (Task 2).
- Produces: `listContainers(runningOnly: boolean, opts?: { env?: NodeJS.ProcessEnv }): Promise<ListResult>`; `systemStatus(opts?): Promise<SystemStatusResult>`; `startSystem(opts?): Promise<ActionResult>`. Consumed by Task 8. This is the layer that turns CLI failures into classified `CliErrorInfo`.

- [ ] **Step 1: Write the failing test**

`tests/integration/commands.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listContainers, startSystem, systemStatus } from '../../src/main/container-cli/commands'
import { makeFakeCli } from '../helpers/fakeCli'

const tmp = () => mkdtempSync(join(tmpdir(), 'cmds-'))

describe('listContainers', () => {
  it('returns running containers by default', async () => {
    const fake = makeFakeCli(tmp())
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.containers.map((c) => c.id)).toEqual(['web-1'])
  })

  it('returns all containers when runningOnly is false', async () => {
    const fake = makeFakeCli(tmp())
    const result = await listContainers(false, { env: fake.env })
    if (result.ok) expect(result.containers.map((c) => c.id).sort()).toEqual(['db-1', 'web-1'])
  })

  it('maps the XPC error to SERVICE_NOT_RUNNING', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'service-down' })
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: false, error: { code: 'SERVICE_NOT_RUNNING' } })
  })

  it('maps a missing binary to CLI_MISSING', async () => {
    const result = await listContainers(true, { env: { PATH: '/nonexistent' } })
    expect(result).toMatchObject({ ok: false, error: { code: 'CLI_MISSING' } })
  })

  it('maps malformed JSON to PARSE_ERROR with an excerpt', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'bad-json' })
    const result = await listContainers(true, { env: fake.env })
    expect(result).toMatchObject({ ok: false, error: { code: 'PARSE_ERROR' } })
  })
})

describe('systemStatus / startSystem', () => {
  it('returns parsed status', async () => {
    const fake = makeFakeCli(tmp())
    const result = await systemStatus({ env: fake.env })
    if (result.ok) {
      expect(result.status.status).toBe('running')
      expect(result.status.serverVersion).toContain('0.10.0')
    } else {
      expect.unreachable('status should parse')
    }
  })

  it('reports SERVICE_NOT_RUNNING from status too', async () => {
    const fake = makeFakeCli(tmp(), { mode: 'service-down' })
    expect(await systemStatus({ env: fake.env })).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_NOT_RUNNING' }
    })
  })

  it('starts the service', async () => {
    const fake = makeFakeCli(tmp())
    expect(await startSystem({ env: fake.env })).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/integration/commands.test.ts`
Expected: FAIL — cannot resolve `commands`.

- [ ] **Step 3: Implement `src/main/container-cli/commands.ts`**

```ts
import { classifyCliFailure } from '../../shared/errors'
import type { ActionResult, ListResult, SystemStatusResult } from '../../shared/types'
import { runCli, type CliRunResult } from './cli'
import { ParseError, parseContainerList, parseSystemStatus } from './parsers'

interface Opts {
  env?: NodeJS.ProcessEnv
}

function asFailureInput(r: CliRunResult): {
  spawnError: NodeJS.ErrnoException | null
  exitCode: number | null
  stderr: string
  timedOut: boolean
} {
  return { spawnError: r.spawnError, exitCode: r.code, stderr: r.stderr, timedOut: r.timedOut }
}

function parseErrorResult(err: unknown, excerpt: string): { code: 'PARSE_ERROR'; message: string; stderr: string } {
  return {
    code: 'PARSE_ERROR',
    message: err instanceof ParseError ? err.message : String(err),
    stderr: excerpt.slice(0, 400)
  }
}

export async function listContainers(runningOnly: boolean, opts: Opts = {}): Promise<ListResult> {
  const args = runningOnly ? ['list', '--format', 'json'] : ['list', '--all', '--format', 'json']
  const r = await runCli(args, { env: opts.env, timeoutMs: 10_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  try {
    return { ok: true, containers: parseContainerList(r.stdout) }
  } catch (err) {
    return { ok: false, error: parseErrorResult(err, r.stdout) }
  }
}

export async function systemStatus(opts: Opts = {}): Promise<SystemStatusResult> {
  const r = await runCli(['system', 'status', '--format', 'json'], { env: opts.env, timeoutMs: 10_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  try {
    return { ok: true, status: parseSystemStatus(r.stdout) }
  } catch (err) {
    return { ok: false, error: parseErrorResult(err, r.stdout) }
  }
}

export async function startSystem(opts: Opts = {}): Promise<ActionResult> {
  const r = await runCli(['system', 'start'], { env: opts.env, timeoutMs: 120_000 })
  if (r.spawnError || r.timedOut || r.code !== 0) return { ok: false, error: classifyCliFailure(asFailureInput(r)) }
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/integration/commands.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/container-cli/commands.ts tests/integration/commands.test.ts
git commit -m "feat: container command layer with classified errors"
```

---

### Task 7: Build module — validation, argv, BuildManager

**Files:**
- Create: `src/main/container-cli/build.ts`
- Test: `tests/unit/build.test.ts`, `tests/integration/build-manager.test.ts`

**Interfaces:**
- Consumes: `streamCli` (Task 4), `classifyCliFailure` (Task 2), `BuildRequest`/`BuildLine`/`BuildDoneEvent`/`BuildStartResult` (Task 2).
- Produces: `TAG_PATTERN`; `validateBuildRequest(req): string[]`; `buildArgv(req): string[]`; `class BuildManager` with `start(req, events): BuildStartResult` and `cancel(runId): boolean`, where `events = { onLine(runId, line): void; onDone(runId, done): void }` and `done: BuildDoneEvent` (without `runId`; the manager injects it). Consumed by Task 8.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/build.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArgv, validateBuildRequest } from '../../src/main/container-cli/build'
import type { BuildRequest } from '../../src/shared/types'

const base = (over: Partial<BuildRequest> = {}): BuildRequest => ({
  contextDir: mkdtempSync(join(tmpdir(), 'ctx-')),
  tag: 'app:latest',
  buildArgs: [],
  noCache: false,
  ...over
})

describe('validateBuildRequest', () => {
  it('accepts a minimal valid request', () => {
    expect(validateBuildRequest(base())).toEqual([])
  })

  it('rejects missing/non-directory contexts', () => {
    expect(validateBuildRequest(base({ contextDir: '/definitely/not/here' }))).not.toEqual([])
    expect(validateBuildRequest(base({ contextDir: '' }))).not.toEqual([])
  })

  it('rejects empty and non-lowercase tags', () => {
    expect(validateBuildRequest(base({ tag: '' }))).not.toEqual([])
    expect(validateBuildRequest(base({ tag: 'My App' }))).not.toEqual([])
    expect(validateBuildRequest(base({ tag: 'App:latest' }))).not.toEqual([])
  })

  it('accepts registry-style tags', () => {
    expect(validateBuildRequest(base({ tag: 'ghcr.io/me/app:1.2.3' }))).toEqual([])
  })
})

describe('buildArgv', () => {
  it('builds a minimal argv ending with the context dir', () => {
    const req = base({ contextDir: '/ctx' })
    expect(buildArgv(req)).toEqual(['build', '-t', 'app:latest', '/ctx'])
  })

  it('includes every advanced option in a stable order', () => {
    const req = base({
      contextDir: '/ctx',
      dockerfilePath: '/ctx/Dockerfile.dev',
      buildArgs: [
        { key: 'A', value: '1' },
        { key: 'B', value: 'with space' }
      ],
      target: 'builder',
      noCache: true,
      platform: 'linux/amd64'
    })
    expect(buildArgv(req)).toEqual([
      'build',
      '-t',
      'app:latest',
      '-f',
      '/ctx/Dockerfile.dev',
      '--build-arg',
      'A=1',
      '--build-arg',
      'B=with space',
      '--target',
      'builder',
      '--no-cache',
      '--platform',
      'linux/amd64',
      '/ctx'
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/unit/build.test.ts`
Expected: FAIL — cannot resolve `build`.

- [ ] **Step 3: Implement `src/main/container-cli/build.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { classifyCliFailure } from '../../shared/errors'
import type { BuildDoneEvent, BuildLine, BuildRequest, BuildStartResult } from '../../shared/types'
import { streamCli, type StreamHandle } from './cli'

export const TAG_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/

export function validateBuildRequest(req: BuildRequest): string[] {
  const problems: string[] = []
  if (!req.contextDir) {
    problems.push('Choose a build context directory.')
  } else if (!existsSync(req.contextDir) || !statSync(req.contextDir).isDirectory()) {
    problems.push(`Build context is not a directory: ${req.contextDir}`)
  }
  if (!req.tag) {
    problems.push('Image tag is required.')
  } else if (!TAG_PATTERN.test(req.tag)) {
    problems.push('Tag must be lowercase: letters, numbers, periods, dashes, underscores, slashes, colons.')
  }
  return problems
}

export function buildArgv(req: BuildRequest): string[] {
  const args = ['build', '-t', req.tag]
  if (req.dockerfilePath) args.push('-f', req.dockerfilePath)
  for (const a of req.buildArgs) args.push('--build-arg', `${a.key}=${a.value}`)
  if (req.target) args.push('--target', req.target)
  if (req.noCache) args.push('--no-cache')
  if (req.platform) args.push('--platform', req.platform)
  args.push(req.contextDir)
  return args
}

export interface BuildEvents {
  onLine(runId: string, line: BuildLine): void
  onDone(runId: string, done: Omit<BuildDoneEvent, 'runId'>): void
}

export class BuildManager {
  private active: { runId: string; handle: StreamHandle } | null = null

  constructor(private readonly opts: { env?: NodeJS.ProcessEnv } = {}) {}

  get activeRunId(): string | null {
    return this.active?.runId ?? null
  }

  start(req: BuildRequest, events: BuildEvents): BuildStartResult {
    if (this.active) {
      return { ok: false, error: { code: 'CLI_ERROR', message: 'A build is already running.' } }
    }
    const problems = validateBuildRequest(req)
    if (problems.length > 0) {
      return { ok: false, error: { code: 'CLI_ERROR', message: problems.join(' ') } }
    }
    const runId = randomUUID()
    let lastStderr = ''
    const handle = streamCli(buildArgv(req), { env: this.opts.env }, (stream, line) => {
      if (stream === 'stderr' && line.trim()) lastStderr = line.trim()
      events.onLine(runId, { stream, line })
    })
    this.active = { runId, handle }
    void handle.done.then((r) => {
      this.active = null
      const done: Omit<BuildDoneEvent, 'runId'> = {
        code: r.code,
        signal: r.signal,
        canceled: r.canceled
      }
      if (!r.canceled) {
        if (r.spawnError) {
          done.error = classifyCliFailure({
            spawnError: r.spawnError,
            exitCode: r.code,
            stderr: lastStderr,
            timedOut: r.timedOut
          })
        } else if (r.code !== 0) {
          done.error = {
            code: 'BUILD_FAILED',
            message: lastStderr || `Build failed (exit ${r.code ?? 'unknown'})`,
            exitCode: r.code
          }
        }
      }
      events.onDone(runId, done)
    })
    return { ok: true, runId }
  }

  cancel(runId: string): boolean {
    if (!this.active || this.active.runId !== runId) return false
    this.active.handle.cancel()
    return true
  }
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm test -- tests/unit/build.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Write the BuildManager integration test**

`tests/integration/build-manager.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BuildManager } from '../../src/main/container-cli/build'
import type { BuildDoneEvent, BuildLine } from '../../src/shared/types'
import { makeFakeCli, type FakeMode } from '../helpers/fakeCli'

function setup(mode: FakeMode) {
  const fake = makeFakeCli(mkdtempSync(join(tmpdir(), 'bm-')), { mode })
  const mgr = new BuildManager({ env: fake.env })
  const lines: BuildLine[] = []
  let done: Omit<BuildDoneEvent, 'runId'> | null = null
  const events = {
    onLine: (_runId: string, line: BuildLine): void => void lines.push(line),
    onDone: (_runId: string, d: Omit<BuildDoneEvent, 'runId'>): void => void (done = d)
  }
  return { mgr, lines, events, getDone: () => done }
}

const req = (contextDir: string) => ({ contextDir, tag: 'app:latest', buildArgs: [], noCache: false })

describe('BuildManager', () => {
  it('streams build output and finishes cleanly', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, lines, events, getDone } = setup('default')
    const started = mgr.start(req(ctx), events)
    expect(started.ok).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    expect(lines.map((l) => l.line).join('\n')).toContain('fake: done')
    expect(getDone()).toMatchObject({ code: 0, canceled: false })
    expect(getDone()?.error).toBeUndefined()
  })

  it('reports BUILD_FAILED with the last stderr line', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events, getDone } = setup('failing-build')
    mgr.start(req(ctx), events)
    await new Promise((r) => setTimeout(r, 1500))
    expect(getDone()).toMatchObject({ canceled: false, error: { code: 'BUILD_FAILED' } })
    expect(getDone()?.error?.message).toContain('did not complete successfully')
  })

  it('cancel resolves canceled and never BUILD_FAILED', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events, getDone } = setup('blocking-build')
    const started = mgr.start(req(ctx), events)
    if (!started.ok) expect.unreachable('start should succeed')
    expect(mgr.cancel((started as { runId: string }).runId)).toBe(true)
    await new Promise((r) => setTimeout(r, 1500))
    expect(getDone()).toMatchObject({ canceled: true })
    expect(getDone()?.error).toBeUndefined()
  })

  it('rejects a second concurrent build and invalid requests without spawning', async () => {
    const ctx = mkdtempSync(join(tmpdir(), 'ctx-'))
    const { mgr, events } = setup('blocking-build')
    const started = mgr.start(req(ctx), events)
    expect(started.ok).toBe(true)
    expect(mgr.start(req(ctx), events)).toMatchObject({ ok: false })
    const mgr2 = new BuildManager()
    expect(mgr2.start(req('/definitely/not/here'), events)).toMatchObject({ ok: false })
    if (started.ok) mgr.cancel(started.runId) // leave no orphaned blocking child
    await new Promise((r) => setTimeout(r, 300))
  })
})
```

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/container-cli/build.ts tests/unit/build.test.ts tests/integration/build-manager.test.ts
git commit -m "feat: build validation, argv builder, and BuildManager"
```

---

### Task 8: IPC, preload bridge, main wiring

**Files:**
- Create: `src/main/ipc.ts`, `src/main/context.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `package.json`
- Test: `tests/unit/ipc.test.ts`, `tests/unit/context.test.ts`

**Interfaces:**
- Consumes: `CHANNELS`, `ContainersApi` (Task 2); `listContainers`/`systemStatus`/`startSystem` (Task 6); `BuildManager` (Task 7).
- Produces: `registerIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: IpcDeps): void`; `findDockerfile(dir: string): { dockerfile: string | null }`; a running app whose renderer sees `window.containers` (typed `ContainersApi`). Consumed by Tasks 9–12.

- [ ] **Step 1: Write the failing unit test for context inspection**

`tests/unit/context.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findDockerfile } from '../../src/main/context'

describe('findDockerfile', () => {
  it('prefers Dockerfile over Containerfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    writeFileSync(join(dir, 'Containerfile'), 'FROM alpine')
    writeFileSync(join(dir, 'Dockerfile'), 'FROM alpine')
    expect(findDockerfile(dir)).toEqual({ dockerfile: 'Dockerfile' })
  })

  it('falls back to Containerfile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    writeFileSync(join(dir, 'Containerfile'), 'FROM alpine')
    expect(findDockerfile(dir)).toEqual({ dockerfile: 'Containerfile' })
  })

  it('returns null when neither exists or the dir does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ctx-'))
    expect(findDockerfile(dir)).toEqual({ dockerfile: null })
    expect(findDockerfile('/definitely/not/here')).toEqual({ dockerfile: null })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- tests/unit/context.test.ts`
Expected: FAIL — cannot resolve `src/main/context`.

- [ ] **Step 3: Implement `src/main/context.ts`**

```ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function findDockerfile(dir: string): { dockerfile: string | null } {
  if (!dir) return { dockerfile: null }
  for (const name of ['Dockerfile', 'Containerfile']) {
    if (existsSync(join(dir, name))) return { dockerfile: name }
  }
  return { dockerfile: null }
}
```

- [ ] **Step 4: Write the failing unit test for IPC registration**

`tests/unit/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { registerIpc, type IpcDeps } from '../../src/main/ipc'
import { CHANNELS } from '../../src/shared/api'

type Handler = (event: unknown, payload?: unknown) => unknown

function fakeIpcMain(): { handlers: Map<string, Handler>; handle: (channel: string, fn: Handler) => void } {
  const handlers = new Map<string, Handler>()
  return { handlers, handle: (channel, fn) => void handlers.set(channel, fn) }
}

function deps(over: Partial<IpcDeps> = {}): IpcDeps {
  return {
    listContainers: vi.fn().mockResolvedValue({ ok: true, containers: [] }),
    systemStatus: vi.fn().mockResolvedValue({ ok: true, status: {} }),
    systemStart: vi.fn().mockResolvedValue({ ok: true }),
    buildStart: vi.fn().mockResolvedValue({ ok: true, runId: 'r1' }),
    buildCancel: vi.fn().mockResolvedValue({ ok: true }),
    findDockerfile: vi.fn().mockReturnValue({ dockerfile: 'Dockerfile' }),
    pickDirectory: vi.fn().mockResolvedValue('/picked'),
    pickFile: vi.fn().mockResolvedValue(null),
    ...over
  }
}

describe('registerIpc', () => {
  it('registers every channel once', () => {
    const main = fakeIpcMain()
    registerIpc(main, deps())
    expect([...main.handlers.keys()].sort()).toEqual(
      [
        CHANNELS.buildCancel,
        CHANNELS.buildStart,
        CHANNELS.contextInspect,
        CHANNELS.list,
        CHANNELS.pickDirectory,
        CHANNELS.pickFile,
        CHANNELS.systemStart,
        CHANNELS.systemStatus
      ].sort()
    )
  })

  it('defaults runningOnly to true', async () => {
    const d = deps()
    const main = fakeIpcMain()
    registerIpc(main, d)
    await main.handlers.get(CHANNELS.list)!(null, undefined)
    expect(d.listContainers).toHaveBeenCalledWith(true)
  })

  it('passes through payloads', async () => {
    const d = deps()
    const main = fakeIpcMain()
    registerIpc(main, d)
    await main.handlers.get(CHANNELS.list)!(null, { runningOnly: false })
    expect(d.listContainers).toHaveBeenCalledWith(false)
    await main.handlers.get(CHANNELS.buildCancel)!(null, { runId: 'abc' })
    expect(d.buildCancel).toHaveBeenCalledWith('abc')
    await main.handlers.get(CHANNELS.contextInspect)!(null, { dir: '/ctx' })
    expect(d.findDockerfile).toHaveBeenCalledWith('/ctx')
  })
})
```

- [ ] **Step 5: Implement `src/main/ipc.ts`**

```ts
import type { IpcMain } from 'electron'
import { CHANNELS } from '../shared/api'
import type { ActionResult, BuildRequest, BuildStartResult, ListResult, SystemStatusResult } from '../shared/types'

export interface IpcDeps {
  listContainers(runningOnly: boolean): Promise<ListResult>
  systemStatus(): Promise<SystemStatusResult>
  systemStart(): Promise<ActionResult>
  buildStart(req: BuildRequest): Promise<BuildStartResult>
  buildCancel(runId: string): Promise<{ ok: boolean }>
  findDockerfile(dir: string): { dockerfile: string | null }
  pickDirectory(defaultPath?: string): Promise<string | null>
  pickFile(defaultPath?: string): Promise<string | null>
}

export function registerIpc(ipcMain: Pick<IpcMain, 'handle'>, deps: IpcDeps): void {
  ipcMain.handle(CHANNELS.list, (_e, payload: { runningOnly?: boolean } | undefined) =>
    deps.listContainers(payload?.runningOnly ?? true)
  )
  ipcMain.handle(CHANNELS.systemStatus, () => deps.systemStatus())
  ipcMain.handle(CHANNELS.systemStart, () => deps.systemStart())
  ipcMain.handle(CHANNELS.buildStart, (_e, req: BuildRequest) => deps.buildStart(req))
  ipcMain.handle(CHANNELS.buildCancel, (_e, payload: { runId: string }) => deps.buildCancel(payload.runId))
  ipcMain.handle(CHANNELS.contextInspect, (_e, payload: { dir: string }) => deps.findDockerfile(payload.dir))
  ipcMain.handle(CHANNELS.pickDirectory, (_e, payload?: { defaultPath?: string }) =>
    deps.pickDirectory(payload?.defaultPath)
  )
  ipcMain.handle(CHANNELS.pickFile, (_e, payload?: { defaultPath?: string }) => deps.pickFile(payload?.defaultPath))
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test -- tests/unit/context.test.ts tests/unit/ipc.test.ts`
Expected: 6 passed.

- [ ] **Step 7: Rewrite the preload**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CHANNELS, type ContainersApi } from '../shared/api'
import type { BuildDoneEvent, BuildOutputEvent } from '../shared/types'

const api: ContainersApi = {
  list: (runningOnly) => ipcRenderer.invoke(CHANNELS.list, { runningOnly }),
  systemStatus: () => ipcRenderer.invoke(CHANNELS.systemStatus),
  systemStart: () => ipcRenderer.invoke(CHANNELS.systemStart),
  buildStart: (req) => ipcRenderer.invoke(CHANNELS.buildStart, req),
  buildCancel: (runId) => ipcRenderer.invoke(CHANNELS.buildCancel, { runId }),
  contextInspect: (dir) => ipcRenderer.invoke(CHANNELS.contextInspect, { dir }),
  pickDirectory: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickDirectory, { defaultPath }),
  pickFile: (defaultPath) => ipcRenderer.invoke(CHANNELS.pickFile, { defaultPath }),
  onBuildOutput: (cb) => {
    const listener = (_e: unknown, payload: BuildOutputEvent): void => cb(payload)
    ipcRenderer.on(CHANNELS.buildOutput, listener)
    return () => ipcRenderer.removeListener(CHANNELS.buildOutput, listener)
  },
  onBuildDone: (cb) => {
    const listener = (_e: unknown, payload: BuildDoneEvent): void => cb(payload)
    ipcRenderer.on(CHANNELS.buildDone, listener)
    return () => ipcRenderer.removeListener(CHANNELS.buildDone, listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI) // removed in Task 9 with the template demo
  contextBridge.exposeInMainWorld('containers', api)
} else {
  ;(window as unknown as { containers: ContainersApi }).containers = api
}
```

`src/preload/index.d.ts`:

```ts
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { ContainersApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    containers: ContainersApi
  }
}

export {}
```

- [ ] **Step 8: Wire the main process**

`src/main/index.ts` — replace the template's IPC test and wire everything (keep the template's window/dev-URL logic):

```ts
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { BuildManager } from './container-cli/build'
import { getCliVersion, isVersionAtLeast } from './container-cli/cli'
import { listContainers, startSystem, systemStatus } from './container-cli/commands'
import { findDockerfile } from './context'
import { registerIpc } from './ipc'
import { CHANNELS } from '../shared/api'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ionutale.aiu-containers-electron')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const mainWindow = createWindow()
  const buildManager = new BuildManager()

  const cli = await getCliVersion()
  if (cli?.version && !isVersionAtLeast(cli.version, '0.10.0')) {
    console.warn(`container CLI ${cli.version} is older than 0.10.0; behavior may differ.`)
  }

  registerIpc(ipcMain, {
    listContainers: (runningOnly) => listContainers(runningOnly),
    systemStatus: () => systemStatus(),
    systemStart: () => startSystem(),
    buildStart: (req) =>
      Promise.resolve(
        buildManager.start(req, {
          onLine: (runId, line) => mainWindow.webContents.send(CHANNELS.buildOutput, { runId, ...line }),
          onDone: (runId, done) => mainWindow.webContents.send(CHANNELS.buildDone, { runId, ...done })
        })
      ),
    buildCancel: (runId) => Promise.resolve({ ok: buildManager.cancel(runId) }),
    findDockerfile: (dir) => findDockerfile(dir),
    pickDirectory: async (defaultPath) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    pickFile: async (defaultPath) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        defaultPath
      })
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 9: Verify the app compiles and boots**

Run: `pnpm build`
Expected: typecheck + build succeed.

Run (manual, closes by itself is fine): `pnpm dev` — window opens with the template content; DevTools console shows no preload errors about `window.containers` (the renderer doesn't use it yet).

- [ ] **Step 10: Commit**

```bash
git add src/main src/preload package.json pnpm-lock.yaml tests/unit/ipc.test.ts tests/unit/context.test.ts
git commit -m "feat: typed IPC bridge, preload API, main-process wiring"
```

---

### Task 9: Renderer harness, app shell, working minimal container list

**Files:**
- Create: `tests/setup.ts`, `tests/unit/format.test.ts`, `src/renderer/src/lib/api.ts`, `src/renderer/src/lib/format.ts`, `src/renderer/src/screens/Containers.svelte`
- Modify: `vitest.config.ts`, `src/renderer/src/App.svelte`, `src/renderer/src/assets/main.css`, `package.json` (devDeps)
- Delete: `src/renderer/src/components/Versions.svelte`, `src/renderer/src/assets/{electron.svg,wavy-lines.svg,base.css}`

**Interfaces:**
- Consumes: `ContainersApi` (Task 2), `window.containers` (Task 8).
- Produces: `getApi(): ContainersApi` (throws a friendly error if the bridge is missing); `formatElapsed(ms): string`; `defaultTagFor(dir): string`; `parseBuildArgs(text): { args: { key; value }[]; errors: string[] }` (last two used in Task 11); `Containers.svelte` happy-path list; renderer test harness (jsdom + testing-library) used by Tasks 10–12.

- [ ] **Step 1: Add renderer test tooling**

```bash
pnpm add -D jsdom@^30 @testing-library/svelte@^5.4 @testing-library/jest-dom@^7
```

Update `vitest.config.ts`:

```ts
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts']
  }
})
```

`tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

Component tests start with `// @vitest-environment jsdom` at the top of the file.

- [ ] **Step 2: Write failing tests for the pure helpers**

`tests/unit/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { defaultTagFor, formatElapsed } from '../../src/renderer/src/lib/format'

describe('defaultTagFor', () => {
  it('lowercases and sanitizes the folder name', () => {
    expect(defaultTagFor('/Users/me/My App')).toBe('my-app')
    expect(defaultTagFor('/Users/me/foo_bar.v2')).toBe('foo_bar.v2')
  })

  it('strips leading invalid characters and handles trailing slashes', () => {
    expect(defaultTagFor('/Users/me/Édge ')).toBe('dge')
    expect(defaultTagFor('/Users/me/app/')).toBe('app')
  })

  it('falls back for empty names', () => {
    expect(defaultTagFor('/')).toBe('image')
  })
})

describe('formatElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsed(0)).toBe('0.0s')
    expect(formatElapsed(1500)).toBe('1.5s')
    expect(formatElapsed(65_000)).toBe('1m 5s')
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm test -- tests/unit/format.test.ts`
Expected: FAIL — cannot resolve `lib/format`.

- [ ] **Step 4: Implement `src/renderer/src/lib/format.ts` and `src/renderer/src/lib/api.ts`**

`format.ts`:

```ts
import type { BuildRequest } from '../../../shared/types'

export function defaultTagFor(dir: string): string {
  const base = dir.replace(/\/+$/, '').split('/').pop() ?? ''
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
  return sanitized || 'image'
}

export function parseBuildArgs(text: string): { args: { key: string; value: string }[]; errors: string[] } {
  const args: { key: string; value: string }[] = []
  const errors: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) {
      errors.push(`Not a KEY=VALUE line: ${line}`)
      continue
    }
    args.push({ key: line.slice(0, eq), value: line.slice(eq + 1) })
  }
  return { args, errors }
}

export function formatElapsed(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m ${s}s`
}

export function buildRequestPreview(req: BuildRequest): string {
  return ['container build', '-t', req.tag, '...', req.contextDir].join(' ')
}
```

`api.ts`:

```ts
import type { ContainersApi } from '../../../shared/api'

export function getApi(): ContainersApi {
  const api = (window as unknown as { containers?: ContainersApi }).containers
  if (!api) throw new Error('The containers bridge is unavailable. Restart the app.')
  return api
}
```

- [ ] **Step 5: Add component test for the minimal list, then implement**

`tests/unit/containers-screen.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Containers from '../../src/renderer/src/screens/Containers.svelte'
import type { ContainersApi } from '../../src/shared/api'

function stubApi(over: Partial<ContainersApi> = {}): ContainersApi {
  return {
    list: vi.fn().mockResolvedValue({
      ok: true,
      containers: [
        {
          id: 'web-1',
          image: 'nginx:latest',
          state: 'running',
          ip: '192.168.64.2',
          platform: 'linux/arm64',
          created: '2026-08-31T12:00:00Z',
          networks: ['default']
        }
      ]
    }),
    systemStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 1, containersRunning: 1 }
    }),
    systemStart: vi.fn(),
    buildStart: vi.fn(),
    buildCancel: vi.fn(),
    contextInspect: vi.fn(),
    pickDirectory: vi.fn(),
    pickFile: vi.fn(),
    onBuildOutput: vi.fn().mockReturnValue(() => {}),
    onBuildDone: vi.fn().mockReturnValue(() => {}),
    ...over
  } as ContainersApi
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Containers screen', () => {
  it('renders running containers from the bridge', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await waitFor(() => expect(screen.getByText('web-1')).toBeInTheDocument())
    expect(screen.getByText('nginx:latest')).toBeInTheDocument()
    expect(api.list).toHaveBeenCalledWith(true)
  })
})
```

`src/renderer/src/screens/Containers.svelte` (minimal but real — toggle/banners arrive in Task 10):

```svelte
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
      if (result.ok) {
        containers = result.containers
        errorMessage = ''
      } else {
        errorMessage = result.error.message
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
```

`App.svelte` (shell; the Build nav item arrives in Task 11):

```svelte
<script lang="ts">
  import Containers from './screens/Containers.svelte'
</script>

<div class="app">
  <nav>
    <span class="brand">Aiu Containers</span>
    <button class="nav-item active">Containers</button>
  </nav>
  <main>
    <Containers />
  </main>
</div>
```

Replace `src/renderer/src/assets/main.css` with a small first version (the template's styles and its `Versions.svelte` demo are removed):

```css
:root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color-scheme: light dark;
}
body { margin: 0; }
.app { display: flex; height: 100vh; }
nav { width: 170px; padding: 12px 8px; border-right: 1px solid color-mix(in srgb, currentColor 15%, transparent); display: flex; flex-direction: column; gap: 4px; }
.brand { font-weight: 600; padding: 4px 8px 12px; }
.nav-item { text-align: left; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: inherit; }
.nav-item.active { background: color-mix(in srgb, currentColor 10%, transparent); }
main { flex: 1; overflow: auto; padding: 16px; }
.screen header { display: flex; align-items: center; justify-content: space-between; }
table { width: 100%; border-collapse: collapse; margin-top: 12px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.muted { opacity: 0.6; }
.error { color: #c62828; }
```

Delete `src/renderer/src/components/Versions.svelte`, the two template SVGs, and `base.css` (the replacement `main.css` is self-contained). The template demo was the only user of `window.electron`, so drop it and its dependency:

```bash
pnpm remove @electron-toolkit/preload
```

Then simplify `src/preload/index.ts` (remove the `electronAPI` import and the `exposeInMainWorld('electron', …)` line) and `src/preload/index.d.ts` (drop the `ElectronAPI` import and field).

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm test`
Expected: all suites pass, including the new jsdom component test.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: renderer harness, app shell, minimal container list"
```

---

### Task 10: Containers screen — toggle, auto-refresh, failure states, Start service

**Files:**
- Modify: `src/renderer/src/screens/Containers.svelte`
- Test: `tests/unit/containers-screen.test.ts` (extend)

**Interfaces:**
- Consumes: `getApi()` (Task 9), `listContainers` error codes (Tasks 2, 6).
- Produces: the complete Containers screen behavior: `Show stopped` toggle (`list(false)`), 3s auto-refresh while the window is visible, service-down banner with a working **Start service** (calls `systemStart`, then reloads), CLI-missing banner, parse-error banner, empty state.

- [ ] **Step 1: Extend the component test (failing)**

Add to `tests/unit/containers-screen.test.ts`:

```ts
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { vi, expect, it } from 'vitest'

it('toggles between running-only and all containers', async () => {
  const api = stubApi()
  ;(window as unknown as { containers: ContainersApi }).containers = api
  render(Containers)
  await waitFor(() => expect(api.list).toHaveBeenCalledWith(true))
  await fireEvent.click(screen.getByLabelText('Show stopped'))
  await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(false))
})

it('shows a service-down banner and starts the service, then reloads', async () => {
  const api = stubApi({
    list: vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_NOT_RUNNING', message: 'The container service is not running.' } })
      .mockResolvedValue({ ok: true, containers: [] }),
    systemStatus: vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'SERVICE_NOT_RUNNING', message: 'The container service is not running.' } })
      .mockResolvedValue({
        ok: true,
        status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 0, containersRunning: 0 }
      }),
    systemStart: vi.fn().mockResolvedValue({ ok: true })
  } as Partial<ContainersApi>)
  ;(window as unknown as { containers: ContainersApi }).containers = api
  render(Containers)
  await waitFor(() => expect(screen.getByText('Service: not running')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText(/service is not running/i)).toBeInTheDocument())
  await fireEvent.click(screen.getByRole('button', { name: /start service/i }))
  await waitFor(() => expect(api.systemStart).toHaveBeenCalled())
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByText('Service: running')).toBeInTheDocument())
})

it('shows an install hint when the CLI is missing', async () => {
  const api = stubApi({
    list: vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'CLI_MISSING', message: "The `container` CLI was not found." }
    })
  } as Partial<ContainersApi>)
  ;(window as unknown as { containers: ContainersApi }).containers = api
  render(Containers)
  await waitFor(() => expect(screen.getByText(/CLI was not found/i)).toBeInTheDocument())
})

it('auto-refreshes every 3 seconds while visible', async () => {
  vi.useFakeTimers()
  try {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Containers)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(api.list).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm test -- tests/unit/containers-screen.test.ts`
Expected: FAIL — no toggle/banners/auto-refresh yet.

- [ ] **Step 3: Implement the full screen**

`src/renderer/src/screens/Containers.svelte`:

```svelte
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
      <label><input type="checkbox" bind:checked={runningOnly} onchange={toggleRunningOnly} /> Show stopped</label>
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
```

Add to `main.css`:

```css
.banner { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px; padding: 10px 12px; margin: 12px 0; }
.banner pre { overflow: auto; font-size: 12px; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent); }
.badge.bad { color: #ef6c00; }
.controls { display: flex; align-items: center; gap: 12px; }
.controls label { display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/unit/containers-screen.test.ts`
Expected: 5 passed. (If the auto-refresh fake-timer test fights Svelte's scheduler, assert with `await vi.advanceTimersByTimeAsync(3100)` and allow ≥2 calls.)

- [ ] **Step 5: Full check + commit**

Run: `pnpm test && pnpm typecheck`
Expected: clean.

```bash
git add src/renderer/src/screens/Containers.svelte src/renderer/src/assets/main.css tests/unit/containers-screen.test.ts
git commit -m "feat: containers screen states, toggle, and auto-refresh"
```

---

### Task 11: Build screen — form, pickers, defaults, validation

**Files:**
- Create: `src/renderer/src/screens/Build.svelte`
- Modify: `src/renderer/src/App.svelte`, `src/renderer/src/assets/main.css`, `tests/unit/format.test.ts`
- Test: `tests/unit/build-screen.test.ts`

**Interfaces:**
- Consumes: `getApi()` (Task 9), `defaultTagFor`/`parseBuildArgs` (Task 9), `BuildRequest`/`BuildStartResult` (Task 2).
- Produces: complete Build form with `Advanced` disclosure, context picker → `contextInspect` → Dockerfile default, tag default from folder, validation errors; **Build** calls `buildStart` and surfaces `{ok:false}` errors. Streaming arrives in Task 12. Also updates App shell with the Build nav item.

- [ ] **Step 1: Add picker tests for `parseBuildArgs` (failing)**

Extend `tests/unit/format.test.ts`:

```ts
import { parseBuildArgs } from '../../src/renderer/src/lib/format'

describe('parseBuildArgs', () => {
  it('parses KEY=VALUE lines, ignoring blanks and keeping spaces in values', () => {
    expect(parseBuildArgs('A=1\n\n B=with space \nC=x=y')).toEqual({
      args: [
        { key: 'A', value: '1' },
        { key: 'B', value: 'with space' },
        { key: 'C', value: 'x=y' }
      ],
      errors: []
    })
  })

  it('reports lines without =', () => {
    expect(parseBuildArgs('NOPE')).toEqual({ args: [], errors: ['Not a KEY=VALUE line: NOPE'] })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- tests/unit/format.test.ts`
Expected: FAIL — `parseBuildArgs` is exported in Task 9's `format.ts`; if it already exists this fails only on behavior mismatches. Fix until green.

- [ ] **Step 3: Write the failing component test**

`tests/unit/build-screen.test.ts`:

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Build from '../../src/renderer/src/screens/Build.svelte'
import type { ContainersApi } from '../../src/shared/api'

function stubApi(over: Partial<ContainersApi> = {}): ContainersApi {
  return {
    list: vi.fn(),
    systemStatus: vi.fn().mockResolvedValue({
      ok: true,
      status: { status: 'running', clientVersion: '', serverVersion: '', hostArch: '', hostOs: '', containersTotal: 1, containersRunning: 1 }
    }),
    systemStart: vi.fn(),
    buildStart: vi.fn().mockResolvedValue({ ok: true, runId: 'r1' }),
    buildCancel: vi.fn().mockResolvedValue({ ok: true }),
    contextInspect: vi.fn().mockResolvedValue({ dockerfile: 'Dockerfile' }),
    pickDirectory: vi.fn().mockResolvedValue('/Users/me/projects/My App'),
    pickFile: vi.fn().mockResolvedValue(null),
    onBuildOutput: vi.fn().mockReturnValue(() => {}),
    onBuildDone: vi.fn().mockReturnValue(() => {}),
    ...over
  } as ContainersApi
}

afterEach(cleanup)

describe('Build screen', () => {
  it('picks a context, detects the Dockerfile, and defaults the tag from the folder', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('/Users/me/projects/My App')).toBeInTheDocument())
    expect(api.contextInspect).toHaveBeenCalledWith('/Users/me/projects/My App')
    expect(screen.getByDisplayValue('my-app')).toBeInTheDocument()
  })

  it('hints when the context has no Dockerfile or Containerfile', async () => {
    const api = stubApi({ contextInspect: vi.fn().mockResolvedValue({ dockerfile: null }) } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByText(/no dockerfile or containerfile/i)).toBeInTheDocument())
  })

  it('starts a build with the form values', async () => {
    const api = stubApi()
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    await waitFor(() =>
      expect(api.buildStart).toHaveBeenCalledWith(
        expect.objectContaining({ contextDir: '/Users/me/projects/My App', tag: 'my-app', noCache: false })
      )
    )
  })

  it('shows the backend validation error when buildStart fails', async () => {
    const api = stubApi({
      buildStart: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'CLI_ERROR', message: 'Build context is not a directory: /nope' }
      })
    } as Partial<ContainersApi>)
    ;(window as unknown as { containers: ContainersApi }).containers = api
    render(Build)
    await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
    await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
    await waitFor(() => expect(screen.getByText(/not a directory/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 4: Implement `src/renderer/src/screens/Build.svelte`**

```svelte
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
      <button type="button" onclick={chooseDockerfile}>Choose…</button>
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
```

Update `App.svelte`:

```svelte
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
```

Add to `main.css`:

```css
form .row { display: grid; grid-template-columns: 140px 1fr auto; gap: 8px; align-items: center; margin: 8px 0; }
form input, form textarea, form select { padding: 5px 8px; }
form textarea { min-height: 70px; }
.disclosure { background: transparent; border: 0; color: inherit; padding: 6px 0; }
.check { display: flex; gap: 6px; align-items: center; margin: 8px 0; }
button[type='submit'] { margin-top: 12px; padding: 7px 16px; }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer tests/unit/format.test.ts tests/unit/build-screen.test.ts
git commit -m "feat: build form with context picker, defaults, and validation"
```

---

### Task 12: Build streaming, cancel, and result footer

**Files:**
- Modify: `src/renderer/src/screens/Build.svelte`, `src/renderer/src/assets/main.css`
- Test: `tests/unit/build-screen.test.ts` (extend)

**Interfaces:**
- Consumes: `onBuildOutput`/`onBuildDone`/`buildCancel` (Task 2), `formatElapsed` (Task 9).
- Produces: live log panel (auto-scroll, stderr styled), Cancel button, footer status (`building` / `succeeded` / `failed` / `canceled`, exit code, elapsed, tag). Build button disabled while running.

- [ ] **Step 1: Extend the test (failing)**

Add to `tests/unit/build-screen.test.ts`:

```ts
function eventApi(): { api: ContainersApi; emit: (e: unknown) => void; done: (e: unknown) => void } {
  let outputCb: ((e: unknown) => void) | null = null
  let doneCb: ((e: unknown) => void) | null = null
  const api = stubApi({
    onBuildOutput: vi.fn((cb: (e: unknown) => void) => {
      outputCb = cb
      return () => {}
    }),
    onBuildDone: vi.fn((cb: (e: unknown) => void) => {
      doneCb = cb
      return () => {}
    })
  } as Partial<ContainersApi>)
  return { api, emit: (e) => outputCb?.(e), done: (e) => doneCb?.(e) }
}

it('streams build output, cancels, and reports the result', async () => {
  const { api, emit, done } = eventApi()
  ;(window as unknown as { containers: ContainersApi }).containers = api
  render(Build)
  await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
  await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
  await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
  await waitFor(() => expect(api.buildStart).toHaveBeenCalled())

  emit({ runId: 'r1', stream: 'stdout', line: '#1 FROM alpine' })
  await waitFor(() => expect(screen.getByText('#1 FROM alpine')).toBeInTheDocument())

  await fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
  expect(api.buildCancel).toHaveBeenCalledWith('r1')

  done({ runId: 'r1', code: null, signal: 'SIGTERM', canceled: true })
  await waitFor(() => expect(screen.getByText(/canceled/i)).toBeInTheDocument())
})

it('reports failure with the error message', async () => {
  const { api, done } = eventApi()
  ;(window as unknown as { containers: ContainersApi }).containers = api
  render(Build)
  await fireEvent.click(screen.getByRole('button', { name: /choose/i }))
  await waitFor(() => expect(screen.getByDisplayValue('my-app')).toBeInTheDocument())
  await fireEvent.click(screen.getByRole('button', { name: /^build$/i }))
  done({ runId: 'r1', code: 1, signal: null, canceled: false, error: { code: 'BUILD_FAILED', message: 'step failed' } })
  await waitFor(() => expect(screen.getByText(/step failed/i)).toBeInTheDocument())
})
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm test -- tests/unit/build-screen.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement streaming + footer in `Build.svelte`**

Replace the script's build-related state and `start()` (keep the form markup from Task 11, append the log panel and footer):

```svelte
<script lang="ts">
  import { onMount } from 'svelte'
  import { getApi } from '../lib/api'
  import { defaultTagFor, formatElapsed, parseBuildArgs } from '../lib/format'
  import type { BuildDoneEvent, BuildOutputEvent, BuildRequest, CliErrorInfo } from '../../../shared/types'

  // ...existing form state from Task 11...

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
```

Append below the form (inside `<section>`):

```svelte
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
        {#each lines as l}
          <pre class:stderr={l.kind === 'stderr'}>{l.text}</pre>
        {/each}
      </div>
    </div>
  {/if}
```

Add to `main.css`:

```css
.build-log { margin-top: 16px; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; }
.log-head { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); font-size: 13px; }
.log-actions button { margin-left: 6px; }
.log-body { max-height: 260px; overflow: auto; padding: 8px 10px; }
.log-body pre { margin: 0; font-size: 12px; white-space: pre-wrap; }
.log-body pre.stderr { color: #c62828; }
```

Also disable the Build button while `runId` is set: `disabled={starting || runId !== null || !contextDir || !tag.trim()}`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/unit/build-screen.test.ts
git commit -m "feat: live build log, cancel, and result footer"
```

---

### Task 13: Packaging, README, live smoke pass

**Files:**
- Modify: `electron-builder.yml`, `README.md`, `.gitignore` (verify)
- Create: `examples/hello/Dockerfile`
- Test: manual smoke (documented below)

**Interfaces:**
- Consumes: everything built so far.
- Produces: `pnpm build:mac` → `dist/*.dmg` (unsigned); a README with usage; recorded evidence that the app works against the real runtime.

- [ ] **Step 1: Configure electron-builder**

Edit `electron-builder.yml`: set `appId: com.ionutale.aiu-containers-electron`, `productName: Aiu Containers Electron`, keep `directories.buildResources: build`, and for mac:

```yaml
mac:
  identity: null
  target:
    - dmg
```

Remove the template's camera/microphone `extendInfo` entries and the `win`/`linux`/`nsis`/`appImage`/`publish` sections (not shipped here).

- [ ] **Step 2: Build the unsigned dmg**

Run: `pnpm build:mac`
Expected: `dist/` contains a `.dmg` and/or `.app` named after the product. Record the file names.

- [ ] **Step 3: Write the smoke fixture and README**

`examples/hello/Dockerfile`:

```dockerfile
FROM alpine:3.20
RUN echo "hello from aiu-containers-electron" > /hello.txt
CMD ["cat", "/hello.txt"]
```

`README.md` — replace the template's: project summary; requirements (macOS arm64, Apple `container` CLI 0.10+ with the service started, Node 20+/pnpm); commands (`pnpm dev`, `pnpm test`, `pnpm build`, `pnpm build:mac`); Gatekeeper note (unsigned build: right-click → Open on first launch); note that the first build downloads the builder image and can take a while; screens description (Containers: running by default, Show stopped toggle, auto-refresh; Build: context/Dockerfile/tag + Advanced, live log, cancel).

- [ ] **Step 4: Run the live smoke pass**

Two parts — the executor automates what it can and records results in the commit message; the GUI checks are human steps (mark them pending if no human is present).

**Automated part:**

```bash
container system start
container run -d --name aiu-smoke docker.io/library/alpine:3.20 sleep 300
container list --format json            # aiu-smoke is present and running
container system status --format json   # status: running
pnpm build:mac                          # produces dist/*.dmg
```

**Human part** (`pnpm dev`, then check):

1. Containers screen shows `aiu-smoke` as `running`; Refresh and auto-refresh work; "Show stopped" toggling still shows it; the Service badge reads `running`.
2. Build screen: choose `examples/hello`, tag `aiu-electron-smoke:latest`, Build → log streams BuildKit steps, footer reports success. (`container image ls` then shows the tag.)
3. Cancel: rebuild with `No cache` enabled and cancel mid-run → footer says Canceled; `pgrep -fl "container build"` is empty.
4. Service banner: `container system stop` → banner appears with Start service; clicking it brings the list back (this stops all containers — expected).

**Cleanup (either part):**

```bash
container delete --force aiu-smoke
container image delete --force aiu-electron-smoke:latest
```

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml README.md examples .gitignore
git commit -m "chore: packaging, README, and live smoke verification"
```

---

## Plan Self-Review Notes

- Spec coverage: purposes/goals (Tasks 1–13), decisions (Global Constraints), architecture + IPC contract (Tasks 2, 8), CLI client/parsers/build (Tasks 4–7), both screens and states (Tasks 9–12), error taxonomy (Tasks 2, 6, 7, 10, 12), testing strategy incl. fake CLI modes (Tasks 3–8, 12), packaging (Task 13), risks (fixture capture Task 5, smoke Task 13).
- The Review Focus items are each pinned by tests in the tasks named there.
- Naming consistency: `listContainers`, `startSystem`, `systemStatus`, `BuildManager.start/cancel`, `CHANNELS.*`, `ContainersApi` are used with identical signatures across tasks.
- Deliberately deferred (out of scope per spec): Playwright UI tests, image listing, logs/stats screens.
