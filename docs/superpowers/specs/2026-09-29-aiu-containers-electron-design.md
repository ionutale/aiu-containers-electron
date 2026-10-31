# Aiu Containers Electron — Design

Date: 2026-09-29
Status: Approved; implemented (v0.1.0).

## Purpose

A small macOS desktop tool that lists the containers running in Apple's `container`
runtime and builds OCI images from a Dockerfile, with live build output.

It is a companion to the full-featured Qt project `aiu-containers`, not a
replacement. It starts deliberately minimal — two screens — but is structured so
that logs, image management, and run/create can be added later without rework.

## Goals

- List running containers from Apple's `container` runtime (default), with a toggle
  to include stopped containers.
- Build an image from a Dockerfile/Containerfile with live streamed output and
  cancellation.
- Handle the two most common environment failures gracefully: the `container`
  binary missing, and the container service not running.
- Reuse the proven architecture from `aiu-containers`: shell out to the `container`
  CLI, parse `--format json` output, keep parsing tolerant across CLI versions.
- Test without a real runtime: stateful fake CLI harness + unit/integration tests.
- Package as an unsigned local `.app`/dmg.

## Non-goals (explicit)

- `run` / `create` containers.
- Logs, stats, exec.
- Images/networks/volumes/registry/service management screens.
- Multi-window, tray, auto-update, distribution to other machines.

## Context

- Apple `container` CLI v0.10.0 is installed at `/usr/local/bin/container`.
- The service must be running; when it is not, commands fail with (observed):
  `Error: internalError: "failed to list containers" (cause: "interrupted: "XPC connection error: Connection invalid"") Ensure container system service has been started with 'container system start'.`
- `container list` supports `--all`, `--format json`; `container build` supports
  `-t/--tag`, `-f/--file`, `--build-arg`, `--target`, `--no-cache`,
  `--platform`, `--progress`, context dir.
- Prior art: `aiu-containers` (Qt/C++) with ADR-0001 "talk to the runtime by
  shelling out to the `container` CLI" and tolerant JSON parsers. This project
  reuses that decision and the domain vocabulary from its `CONTEXT.md`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime access | Shell out to `container` CLI, `--format json` | ADR-0001; supported client; stable machine-readable output |
| Stack | electron-vite 5, Electron 39 (scaffold-pinned), Svelte 5 + TypeScript 5, pnpm | User choice; no Apple toolchain needed |
| Process split | All CLI execution in main process; typed contextBridge API | Renderer stays unprivileged; CLI layer testable headless |
| List scope | Running by default, "Show stopped" toggle | User choice |
| Build form | Simple + collapsed Advanced section | User choice |
| Packaging | electron-builder, unsigned dmg/local .app | User choice; no signing on this machine |
| Styling | Scoped CSS, no UI kit | Few dependencies for a two-screen tool |
| Fake CLI | Node ESM script (no Python) | Tests run with only Node present |

## Architecture

```
src/
  main/
    index.ts                 window lifecycle, app wiring
    ipc.ts                   ipcMain handlers -> container-cli
    container-cli/
      cli.ts                 binary discovery, run/stream, typed errors, cancel
      parsers.ts             tolerant parsers (list, system status)
      build.ts               BuildRequest -> argv, build session lifecycle
  preload/
    index.ts                 contextBridge: window.containers
  shared/
    types.ts                 domain types + error codes (both processes)
  renderer/
    index.html
    src/
      App.svelte             sidebar: Containers | Build
      screens/Containers.svelte
      screens/Build.svelte
      lib/                   stores, small components (Banner, LogView)
      styles/                global CSS
tests/
  fake-container/container    stateful Node fake CLI
  unit/…                      parsers, argv, error classification
  integration/…               client against fake CLI on PATH
```

Security defaults: `contextIsolation: true`, `nodeIntegration: false`, sandboxed
preload, no remote content, no `shell.openExternal` on untrusted input.

### IPC contract

`invoke`/`handle` (renderer → main):

| Channel | Input | Result |
|---|---|---|
| `containers:list` | `{ runningOnly: boolean }` | `{ ok: true, containers }` or `{ ok: false, error }` |
| `system:status` | — | `{ status, clientVersion?, serverVersion?, … }` or `{ ok:false, error }` |
| `system:start` | — | `{ ok }` or `{ ok:false, error }` |
| `build:start` | `BuildRequest` | `{ runId }` |
| `build:cancel` | `{ runId }` | `{ ok }` |
| `dialog:pickDirectory` | `{ defaultPath? }` | `string \| null` |
| `dialog:pickFile` | `{ defaultPath? }` | `string \| null` |
| `context:inspect` | `{ dir }` | `{ dockerfile: string \| null }` |

Events (main → renderer):

| Event | Payload |
|---|---|
| `build:output` | `{ runId, stream: 'stdout'\|'stderr', line }` |
| `build:done` | `{ runId, code, signal, canceled, error? }` |

Build output is line-buffered in main (partial trailing line flushed at close).
`container build` is run with `--progress auto`; without a TTY the CLI produces
plain line output. Both streams are forwarded and visually distinguished.

### CLI client (`cli.ts`)

- Locate `container`: `which container`-equivalent via PATH scan, plus
  `/usr/local/bin/container` and `/opt/homebrew/bin/container` as fallbacks;
  cache result; expose `cliMissing` state.
- `run(args): Promise<CliResult>` — child process, captured stdout/stderr, exit
  code, no shell interpolation (argv array only).
- `stream(args, handlers)` — line-buffered stdout/stderr events, cancellation
  (`SIGTERM`, then `SIGKILL` after ~5 s grace).
- Version probe: `container --version`; soft warning if older than 0.10.0.
- Typed error classification (see Error taxonomy).

### Parsers (`parsers.ts`)

Tolerant, mirroring `aiu-containers`' `JsonParser`: all fields optional; missing
keys never throw; empty/whitespace output yields empty results. Parse functions:

- `parseContainerList(json) -> ContainerSummary[]` — flatten the real CLI shapes:
  `id`, `configuration.image.reference`, `configuration.platform.os/architecture`,
  `configuration.resources.cpus/memoryInBytes`, `configuration.creationDate`,
  `status.state`, `status.networks[].ipv4Address` (take first, strip `/24`),
  network names from `configuration.networks[].network`.
- `parseSystemStatus(json) -> SystemStatus` — `status`, client/server versions,
  host fields, resource counts.

First implementation task: run the real CLI once and capture fixtures
(`container list --all --format json`, `container system status --format json`)
to validate these parsers; save captures as test fixtures.

### Build (`build.ts`)

`BuildRequest`:
`{ contextDir, dockerfilePath?, tag, buildArgs: {key,value}[], target?, noCache, platform? }`

Argv: `container build -t <tag> [-f <dockerfile>] [--build-arg K=V …]
[--target <stage>] [--no-cache] [--platform <p>] <contextDir>`.

Validation (main-side, defense in depth): context dir exists and is a directory;
tag non-empty and matches `[a-z0-9][a-z0-9._:\-/]{0,127}`; `-f` path, when
relative, resolved against the context dir.

Build sessions tracked by `runId`; state machine
`running -> (done | failed | canceled)`; one active build at a time (the UI
disables Build while one runs).

### Screens

**Containers** — header: title, service badge (`running` / `not running`), Start
service button (only when not running), "Show stopped" toggle, Refresh button.
Table columns: Name/ID, Image, State, Address, Platform, Created. Auto-refresh
every 3 s while the window is focused and this screen is active. States:

- Service down → banner with Start service; table hidden.
- CLI missing → banner with install hint.
- No containers → empty state.

**Build** — form: context directory (native picker), Dockerfile path (auto-set to
`Dockerfile` or `Containerfile` when found in the chosen directory; overridable
via picker), tag (defaults to sanitized folder name), Advanced disclosure: build
args (one `KEY=VALUE` per line), target stage, no-cache, platform (default empty =
builder default; options `linux/arm64`, `linux/amd64`). Build button disabled
while a build runs. Log panel: monospace, auto-scroll (pausable by scrolling up),
stderr visually distinct, Clear button. Footer: state (building/succeeded/failed/
canceled), exit code, elapsed time, resulting tag. Cancel button while building.

### Error taxonomy

| Code | Trigger | UI |
|---|---|---|
| `CLI_MISSING` | spawn ENOENT / not found on PATH | Banner + install hint; disable actions |
| `SERVICE_NOT_RUNNING` | stderr matches `Ensure container system service has been started` or `XPC connection error` | Banner + Start service |
| `CLI_ERROR` | non-zero exit, other | Show trimmed stderr |
| `PARSE_ERROR` | JSON parse/shape failure | Show raw excerpt + "container version may have changed" |
| `BUILD_FAILED` | build exit ≠ 0 | Footer failed + last stderr lines in log |
| `CANCELED` | SIGTERM/SIGKILL after cancel request | Footer canceled |

## Testing strategy

1. **Unit (Vitest)** — parsers against captured real fixtures + synthetic edge
   cases (missing keys, empty arrays, bad JSON); build argv builder; error
   classification.
2. **Integration (Vitest)** — real client modules against the fake CLI placed on
   `PATH` (and a temp state file):
   - `list` running-only vs all;
   - service-down error mapping;
   - build streams lines in order then `build:done` code 0;
   - build failure code propagation;
   - cancel mid-build (fake CLI blocks) → canceled state, process gone.
3. **Manual smoke** — documented steps: start service, list real containers,
   build a tiny real image (e.g. `FROM alpine`). Run once during implementation
   against CLI v0.10.0; capture fixtures for (1).
4. Out of day-one scope: Playwright UI tests.

### Fake CLI (`tests/fake-container/container`)

Executable Node ESM script, `#!/usr/bin/env node`. State persisted to
`FAKE_CONTAINER_STATE` (JSON file) so mutations survive across invocations;
behavior switches via `FAKE_CONTAINER_MODE`:

| Mode | Behavior |
|---|---|
| default | list/status/build as the real CLI shapes |
| `service-down` | list/status exit 1 with the real service-not-running stderr |
| `bad-json` | list prints malformed JSON (parse-error path) |
| `slow-build` | build prints step lines with delays |
| `blocking-build` | build sleeps until SIGTERM (cancel tests) |

Commands implemented: `list [--all] --format json`, `system status --format json`,
`system start`, `build …`, `--version`. Build output mimics BuildKit steps
(`#1 …`, `#2 …`, `DONE 0.1s`, `fake: done`).

## Packaging

- electron-builder: `appId: com.ionutale.aiu-containers-electron`,
  `productName: Aiu Containers Electron`, mac target `dmg` (arm64),
  `identity: null` (unsigned), category `public.app-category.developer-tools`.
- Scripts: `pnpm dev` (electron-vite dev), `pnpm build` (compile),
  `pnpm build:mac` (unsigned dmg into `dist/`), `pnpm test` (vitest).
- Unsigned app needs right-click → Open on first launch (Gatekeeper); documented
  in README.

## Risks

| Risk | Mitigation |
|---|---|
| Real CLI JSON differs from assumptions | Capture live fixtures first; tolerant parsers; graceful `PARSE_ERROR` |
| `build -t` image destination behavior unverified | Verify in live smoke task; success message reflects reality |
| First build pulls a builder image (slow) | Live streaming output; note in README |
| Electron sandbox/preload setup friction | Standard electron-vite template structure |
| Gatekeeper friction on unsigned app | README note; acceptable for local tool |

## Milestones

1. **M1 — Foundations**: scaffold, shared types, CLI client, parsers, fake CLI,
   unit + integration tests, live fixture capture.
2. **M2 — Containers screen**: list running (+toggle), service states, auto-refresh.
3. **M3 — Build screen**: form, advanced options, streaming log, cancel, result footer.
4. **M4 — Ship local**: electron-builder unsigned dmg, README, manual smoke pass.

## Open questions

- Project name `aiu-containers-electron` — changeable at spec review.
- Whether to show recent build results (currently out of scope).
