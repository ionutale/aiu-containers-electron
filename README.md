# Aiu Containers Electron

A small macOS desktop app for the Apple [`container`](https://github.com/apple/container) CLI.
It lists containers (running by default, with a **Show stopped** toggle and auto-refresh) and
builds images from a Dockerfile with a live streamed log.

All `container` CLI execution happens in the Electron main process; the renderer only talks to it
through a typed IPC bridge (`window.containers`).

## Screens

**Containers**

- Lists containers with their image, status, and command.
- Shows **running containers only** by default (`container list --format json`).
- **Show stopped** switches to `container list --all --format json`.
- **Refresh** reloads on demand; the list also auto-refreshes every 3 seconds while the window is
  visible.
- A **service badge** shows whether the container service is running. When it is not, a banner
  offers **Start service**.
- If the `container` binary cannot be found, the screen says so and disables actions instead of
  failing.

**Build**

- **Context directory** (folder picker) and **Dockerfile** (defaults to `Dockerfile`, or
  `Containerfile` if that is what the folder has), plus a **Tag** (defaults to the context folder
  name).
- **Advanced** (collapsed by default): build args (one `KEY=VALUE` per line), target stage,
  platform, and **No cache**.
- **Build** streams the build output live and shows a footer with the result
  (`Succeeded`, `Failed`, or `Canceled`) and elapsed time.
- **Cancel** stops a running build without leaving an orphaned process behind.

## Requirements

- macOS on Apple silicon (arm64).
- Apple `container` CLI **0.10+**, installed and working:

  ```bash
  container --version        # container CLI version 0.10.0
  container system start     # start the container service
  container system status    # should report: status: running
  ```

  The app looks for `container` on `PATH`, then falls back to `/usr/local/bin/container` and
  `/opt/homebrew/bin/container`.

- Node.js 20+ and [pnpm](https://pnpm.io/).

## Install

```bash
pnpm install
```

## Commands

```bash
pnpm dev        # run in development (electron-vite dev)
pnpm test       # run the Vitest suite
pnpm typecheck  # type-check main/preload and the Svelte renderer
pnpm build      # type-check and compile into out/
pnpm build:mac  # compile and package an unsigned dmg into dist/
```

`pnpm build:mac` produces `dist/aiu-containers-electron-<version>.dmg` and an unpacked
`dist/mac-arm64/Aiu Containers Electron.app`.

## First launch (Gatekeeper)

The dmg is **unsigned**. On first launch macOS will refuse to open the app with a message like
_"Aiu Containers Electron" cannot be opened because the developer cannot be verified_.

Open it once via **right-click (or Control-click) → Open → Open**. macOS remembers the choice, and
later launches work normally. If the app is still blocked, go to
**System Settings → Privacy & Security** and choose **Open Anyway**.

## Notes

- The **first build** pulls the builder image and can take a while; progress is visible in the
  streamed log. Later builds are much faster (use **No cache** to force a full rebuild).
- Destroying containers and stopping the service are done with the CLI (`container delete`,
  `container system stop`); the app only lists and builds.

## Troubleshooting

**The app won't start and says "Electron uninstall" / "Electron failed to install correctly"**

The Electron binary didn't extract during install. Run `pnpm rebuild electron`. If
`node_modules/electron/dist/Electron.app` still doesn't appear, extract the cached zip manually:

```bash
cd node_modules/.pnpm/electron@*/node_modules/electron
rm -rf dist && mkdir dist
ditto -xk ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip dist
printf 'Electron.app/Contents/MacOS/Electron' > path.txt
```

This is a known environment issue with Electron's install step (its `extract-zip` postinstall can
stall on some Node/macOS combinations and exit successfully after extracting a single file). It is
not something the app does.

**The Containers screen says the service is not running**

Start it with `container system start` (or use the **Start service** button in the banner).

**The Containers screen says the `container` CLI was not found**

Install the Apple `container` CLI and make sure `container` is on `PATH` (or at
`/usr/local/bin/container` / `/opt/homebrew/bin/container`).
