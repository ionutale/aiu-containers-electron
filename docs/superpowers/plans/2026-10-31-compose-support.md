# Compose Support (Native Subset) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Compose screen that parses a documented `compose.yaml` subset, builds and runs its services on the stock Apple `container` CLI, and manages up/stop/down/logs with an explicit service-name DNS warning.

**Architecture:** Main-process modules under `src/main/compose/` parse/validate the file, build argv, and orchestrate lifecycle; a typed IPC bridge exposes them to a Svelte screen. Builds share the existing `BuildManager`. Resources are labelled with the project so status comes from the existing container list.

**Tech Stack:** TypeScript, Electron 39, Svelte 5, `yaml`, Vitest, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-31-compose-support-design.md`

## Global Constraints

- Stock `container` CLI only; no Compose plugin, no new runtime service.
- Supported subset exactly as the spec's table; unsupported keys are errors, warning-list keys are ignored with a warning.
- Never build shell strings: every CLI call is an argv array.
- No service-name DNS emulation. Show the limitation; use `alias=` only when `container run --help` advertises it.
- Preserve existing screens, IPC behaviour and e2e copy.
- One build at a time across Build and Compose.
- Tests must pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.

## Review Focus

1. **Partial failure**: a build or run failing mid-stack must report which service failed and leave a recoverable state; Down must still clean up.
2. **Name collisions**: an existing container with the project-prefixed name but another project's labels must not be deleted.
3. **Interpolation and `.env` precedence**: shell values must beat `.env`; missing required variables must fail before any side effect.
4. **Argument fidelity**: ports, mounts, env, entrypoint and command must become the exact argv the CLI expects, including IPv4 host bindings and `:ro`.
5. **No-DNS honesty**: the notice must appear before Up, and the UI must show real container names.

---

### Task 1: Parser and validation

**Files:**
- Modify: `package.json` (add `yaml`)
- Create: `src/shared/compose.ts`, `src/main/compose/parse.ts`
- Test: `tests/unit/compose-parse.test.ts`

**Interfaces:**
- Produces: `parseComposeFile(file, opts?): ComposeParseResult`; types `ComposeProject`, `ComposeService`, `ComposeError`, `ComposeWarning`.

- [ ] **Step 1: Add the YAML dependency**

```bash
pnpm add yaml
```

- [ ] **Step 2: Write failing parser tests**

Cover: two services with `depends_on` order; `.env` + shell precedence; `${VAR:-default}` and `$$`; env_file then environment override; ports/mounts parsing; warnings for `restart`/`healthcheck`; errors for `profiles`, `networks`, a missing dependency, a cycle, and malformed YAML with a line number.

- [ ] **Step 3: Implement the types and parser**

Types in `src/shared/compose.ts`; parsing/interpolation/validation in `src/main/compose/parse.ts`. Use `parseDocument` for line numbers; load `<dir>/.env`; walk services; sanitize the project name; resolve bind paths against the compose directory; prefix named volumes; collect warnings; topologically sort services.

- [ ] **Step 4: Run the focused tests**

`pnpm vitest run tests/unit/compose-parse.test.ts` → pass.

- [ ] **Step 5: Commit** (`feat(compose): parse and validate a compose subset`).

### Task 2: Argv planning

**Files:**
- Create: `src/main/compose/plan.ts`
- Test: `tests/unit/compose-plan.test.ts`

**Interfaces:**
- Consumes: `ComposeProject`, `ComposeService`.
- Produces: `runArgv(project, service, opts)`, `buildRequest(project, service)`, `networkName(project)`, `volumeName(project, name)`, `projectLabels(project, service)`.

- [ ] **Step 1: Write failing tests**

Assert exact argv for a service with env, `8080:80`, `127.0.0.1:5432:5432/tcp`, bind and named mounts (`:ro`), labels, `--network` with and without `,alias=`, `-w`, `-u`, `--platform`, entrypoint + command, and the build request (`context`, `dockerfile`, args, target, platform).

- [ ] **Step 2: Implement `plan.ts`**

Centralize all flags in one place. Add `detectNetworkAliasSupport(runCli)` that runs `run --help` and matches `alias=`.

- [ ] **Step 3: Run the focused tests** → pass.

- [ ] **Step 4: Commit** (`feat(compose): plan network, build and run argv`).

### Task 3: Runner, fake CLI and integration

**Files:**
- Create: `src/main/compose/runner.ts`
- Modify: `tests/fake-container/container`, `src/main/container-cli/parsers.ts`, `src/shared/types.ts` (labels)
- Test: `tests/integration/compose-runner.test.ts`, `tests/unit/parsers.test.ts`

**Interfaces:**
- Produces: `ComposeRunner.startUp(project, opts, events)`, `.stop(project)`, `.down(project, opts)`, `.logs(project, service, events)`, `.stopLogs()`, `.cancel(runId)`.
- Events: `onLine(runId, {service, stream, line})`, `onDone(runId, {ok, action, error?})`, `onLog({service, stream, line})`.

- [ ] **Step 1: Extend the fake CLI**

Add state-backed `network create|list|delete`, `volume create|list|delete`, `image inspect`, image registration on build, full `run` flag parsing (name, network + alias, labels, ports, mounts, env, entrypoint, platform, workdir, user), multi-id `stop`/`delete`, and `logs` (initial lines; `-f` blocks). Keep existing behaviour.

- [ ] **Step 2: Write failing integration tests**

Against a temp compose project: up creates `demo_default`, named volumes, containers named `demo-web`/`demo-db` in order with labels, and states become running; a second project's container name is not deleted; stop marks stopped; down removes containers/network and keeps volumes unless asked; logs emit; a failed build reports the service.

- [ ] **Step 3: Implement `ComposeRunner`**

Serialize actions, check `image inspect` before building, ignore `build` when the tag exists unless `forceBuild`, reuse `BuildManager` and await its done event, stream each CLI step, and resolve project containers by label with a name fallback.

- [ ] **Step 4: Add labels to `ContainerSummary`** and update parser tests.

- [ ] **Step 5: Run focused integration tests** → pass.

- [ ] **Step 6: Commit** (`feat(compose): run, stop and tear down projects`).

### Task 4: IPC and preload

**Files:**
- Modify: `src/shared/compose.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `tests/unit/ipc.test.ts`

**Interfaces:**
- Adds `composeInspect`, `composeUp`, `composeDown`, `composeStop`, `composeLogs`, `composeLogsStop`, `composeCancel`, `onComposeOutput`, `onComposeDone`, `onComposeLog`.

- [ ] **Step 1: Write failing IPC tests** for every handler and event channel.
- [ ] **Step 2: Wire the runner in `index.ts`** with the shared `BuildManager`, forwarding events to the window.
- [ ] **Step 3: Update preload and the `ContainersApi` type.**
- [ ] **Step 4: Run IPC tests + typecheck** → pass.
- [ ] **Step 5: Commit** (`feat(compose): expose compose over IPC`).

### Task 5: Compose screen

**Files:**
- Create: `src/renderer/src/screens/Compose.svelte`
- Modify: `src/renderer/src/App.svelte`, `src/renderer/src/assets/main.css`
- Test: `tests/unit/compose-screen.test.ts`

**Interfaces:**
- Consumes: the compose API and `list(false)` filtered by `labels['com.aiu.compose.project']`.

- [ ] **Step 1: Write failing component tests**

Open a file → project rendered; parse errors listed; DNS notice visible before Up; Up disables while running and appends streamed lines; Stop/Down call the API; log lines render; the volume toggle is passed to Down.

- [ ] **Step 2: Implement the screen and nav item**

Empty state with Open + recent files (`localStorage`), project header, actions, Rebuild switch, notice, errors/warnings, service table with state chips and container names, log panel with follow/stop.

- [ ] **Step 3: Add CSS** reusing tokens/primitives; keep narrow-window layout working.

- [ ] **Step 4: Run component tests + svelte-check** → pass.

- [ ] **Step 5: Commit** (`feat(compose): add the compose screen`).

### Task 6: E2E, docs and release

**Files:**
- Create: `e2e/compose.e2e.ts`
- Modify: `README.md`, `package.json` (version `0.2.0`, description), `build/icon.svg`? no.
- Test: `e2e/compose.e2e.ts`

- [ ] **Step 1: E2E** — open a temp compose file, Up, see both services running, follow a log, Stop, Down, and assert the fake state file (network/containers gone, volume kept). Second spec: unsupported key shows the error and Up stays disabled.
- [ ] **Step 2: README** — Compose screen, supported keys table, DNS limitation and link, lifecycle, example file.
- [ ] **Step 3: Full verification** — `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
- [ ] **Step 4: Commit and push** (`feat: add compose support`, `docs: document compose`), verify CI.

## Self-Review Notes

- Every spec goal maps to a task: parser (1), argv (2), lifecycle (3), bridge (4), UI (5), proof/docs (6).
- Review Focus items are covered: partial failure (T3), collision (T3), interpolation (T1), argv (T2), DNS notice (T5/T6).
- The runner's event shapes are defined once in Task 3 and reused by Tasks 4–5.
