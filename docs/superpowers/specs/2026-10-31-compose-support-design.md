# Docker Compose Support (Native Subset) — Design

Date: 2026-10-31
Status: Approved (scope agreed); implemented.

## Intent

`aiu-containers-electron` lists containers and builds images. Users with a local
`compose.yaml` still drop to the terminal because Apple's `container` CLI has no Compose
support. Add a **Compose** screen that can parse a compose file, build its services, start and
stop the stack, and stream logs — using the stock `container` CLI, not a plugin.

## Goals

- Open `compose.yaml` / `compose.yml` / `docker-compose.yaml` / `docker-compose.yml`.
- Parse and validate a documented subset, with precise errors (file, service, key, line for YAML).
- Create a project network and named volumes, build services, run containers in `depends_on`
  order, and label every resource with the project.
- Up, Stop, Down (keep volumes by default), per-service Logs, and a Rebuild option.
- Show service state by reading the existing container list, not a parallel store.
- Warn prominently that Apple's runtime does not resolve service names, show each service's real
  container name, and use network aliases automatically when the runtime advertises them.

## Non-goals

- Full Compose parity: profiles, custom networks, secrets/configs, healthcheck-gated
  `depends_on`, restart policies, deploy resources, long-syntax volumes/ports, multiple or
  override compose files, `extends`.
- A general "run arbitrary container" screen.
- `/etc/hosts` injection or any other DNS emulation; the runtime gap is documented, not hacked.
- Compose watch, pull policies, or image publishing.

## The runtime constraint

Apple `container` 0.10–1.6 assigns IPs on custom networks but returns NXDOMAIN for bare container
names and network aliases (apple/container#1809). Name aliases exist only as unmerged draft PRs.
A typical `web` + `db` file will start but `web` cannot resolve `db` by name.

The feature therefore supports the subset honestly: single-service stacks, services addressed by
published host ports, or stacks whose configuration uses explicit container names. The UI and
README state this. `detectNetworkAliasSupport()` probes `container run --help` for `alias=`; if a
future runtime ships it, the runner adds `alias=<service>` to the network attachment.

## Supported subset

Top level: `name`, `services`, `version` (ignored). Anything else is an error, except `x-*`
extension keys (ignored).

Service keys:

| Key | Mapping |
| --- | --- |
| `image` | image reference |
| `build` (string or object) | `context`, `dockerfile`, `args`, `target`, `platform`; built only when the tag is missing, or on Rebuild |
| `environment` | map or `KEY=VALUE` list; `KEY` with no value inherits the host when set |
| `env_file` | one or more files, parsed as dotenv; `environment` wins |
| `ports` | `[host-ip:]host-port:container-port[/udp]`; a bare container port is an error (Docker's random host port is not supported) |
| `volumes` | bind (`./`, `../`, absolute), named (`name:/path`), `:ro` option only |
| `depends_on` | list or map keys; start order only |
| `command`, `entrypoint` | list, or a string tokenized with quotes |
| `working_dir`, `user`, `platform`, `container_name` | passed through |

Errors: `profiles`, `networks`, `network_mode`, `secrets`, `configs`, `extends`, `volumes_from`,
`pid`, `ipc`. Warnings and ignored: `labels`, `logging`, `expose`, `healthcheck`, `restart`,
`deploy`, `cap_add`/`cap_drop`, `devices`, `sysctls`, `ulimits`, `shm_size`, resource limits, DNS
fields, `tmpfs`, `tty`, `stdin_open`, `init`, `privileged`, `read_only`, `security_opt`,
`stop_grace_period`, and unknown service keys.

Interpolation: `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `${VAR:?message}`,
`${VAR?message}`, `$$`. Values from the shell override the project `.env`.

## Design

### Naming

- Project: `name` or the folder basename, lowercased and sanitized to `[a-z0-9_-]`.
- Container: `container_name` or `<project>-<service>`.
- Network: `<project>_default`.
- Named volume: `<project>_<volume>`.
- Labels: `com.aiu.compose.project`, `.service`, `.file`.

### Lifecycle

**Up**: validate → ensure network → ensure named volumes → for each service in dependency order:
ensure image (build if `build` present and the tag is missing, or Rebuild) → remove an existing
container with the same name when it belongs to this project (error if it belongs to another) →
`container run -d` with labels, env, ports, mounts, network. Emits build and run output.

**Stop**: `container stop` every container carrying the project label.

**Down**: stop, delete project containers, delete the network; delete named volumes only when
asked.

**Logs**: one `container logs -n 200 -f` at a time; switching services stops the previous stream.

Actions are serialized: one Up/Down/Stop at a time, and builds share the existing `BuildManager` so
the Build screen and Compose cannot build concurrently.

### UI

Third sidebar item **Compose**. Empty state with **Open compose file…** and recent files. Project
header with name, file, running count, Up/Stop/Down and a Rebuild switch. An amber notice states
the DNS limitation and links to the tracking issue. Parse errors and warnings are listed with the
service. Services table: name, image, state chip, ports, depends on, and a Logs action. A log
panel streams build output and followed logs.

### Modules

- `src/shared/compose.ts`: types, channels, `ComposeProject`, errors, events.
- `src/main/compose/parse.ts`: YAML, `.env`, interpolation, subset validation, dependency order.
- `src/main/compose/plan.ts`: network/volume/run/build argv, port and mount parsing, alias support.
- `src/main/compose/runner.ts`: up/stop/down/logs orchestration and event emission.
- `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`: typed bridge.
- `src/renderer/src/screens/Compose.svelte`, `App.svelte`, `main.css`.

New runtime dependency: `yaml` (line/column errors). CLI calls remain argv arrays; no shell.

## Verification

- Unit: interpolation, YAML/schema errors, env precedence, ports/mounts, dependency order, argv.
- Integration (fake CLI): up creates network/volumes/containers with labels and order; stop; down;
  logs; rebuild; name collision from another project.
- Component: open/parse flow, errors, DNS notice, actions, log rendering.
- E2E: a real compose file in a temp dir against the fake CLI, from Open through Up, Logs, Stop and
  Down; an unsupported-key file shows the error; `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- README documents the subset and the DNS limitation.

## Risks

- Compose semantics are broad; the subset is enforced, never silently approximated, except the
  explicit warning list.
- `container run` flags vary by CLI version; argv is centralized and tested against the documented
  0.10 help.
- Secrets may appear in `-e` args and logs; values are not echoed by the app, but logs are shown
  verbatim.
- The no-DNS limitation is the dominant UX risk; it is surfaced before Up and in the README.
