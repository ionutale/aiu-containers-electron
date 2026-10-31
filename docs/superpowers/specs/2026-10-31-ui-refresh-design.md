# UI Refresh, App Icon, Screenshots and Public README — Design

Date: 2026-10-31
Status: Approved; implemented.

## Intent

The app works and is well tested, but it looks unfinished: default browser controls, a mostly
empty table, a cramped Build form, no app icon (still the Electron template icon), and a README
with no screenshots. The goal is to make it feel like a finished macOS utility and to present it
publicly on GitHub with a credible README.

## Goals

- A visual system (type scale, spacing, surfaces, borders, state colours) applied consistently to
  both screens, in **light and dark** themes.
- Restructure the two screens so hierarchy is obvious: a proper sidebar, header with actions,
  a table card with state chips, a grouped Build form, and a log panel with status.
- A custom application icon in the same visual language: a stacked-container glyph on a
  rounded-square macOS icon, shipped as `.icns`, 512px PNG and window icon.
- Screenshots captured from the **real app** with deterministic fake data, light and dark, stored in
  the repo and embedded in the README.
- A comprehensive README: hero, screenshots, features, requirements, usage, architecture, testing,
  packaging, troubleshooting, license.
- A **public** GitHub repository (`ionutale/aiu-containers-electron`) with `main` pushed.

## Non-goals

- No new product features: no run/create, logs, stats, exec, images/networks/volumes/registry
  screens (still the spec's explicit non-goals).
- No custom window chrome (keep the standard macOS title bar), no tray, no auto-update.
- No new runtime dependencies and no UI kit; styling stays in Svelte/CSS.
- No behavioural changes to the CLI client, IPC contract or build semantics.
- No signed/notarised build; the public repo is source, and the README says how to build locally.

## Anti-goals

- A layout that reads as "generic AI dashboard" (gradient hero cards, emoji, oversized rounded
  everything). The app must look like a tool a developer runs daily.
- Dark mode as an afterthought: both themes are designed together.
- Breaking the existing e2e suite by changing roles, labels or visible copy that tests rely on.
- Publishing machine-specific paths, tokens or personal data in the public repository.

## Constraints

- Svelte 5 + scoped CSS; `src/renderer/src/assets/main.css` holds tokens and shared styles.
- electron-vite/Electron 39 (Chromium 142) — modern CSS (`color-mix`, `:has`, `light-dark`) is
  available, but `prefers-color-scheme` overrides are used for predictable screenshots.
- Existing accessible names and copy are part of the e2e contract: `Show stopped`, `Refresh`,
  `Start service`, `Choose…`, `Browse…`, `Build`, `Cancel`, `Clear`, `Service: running|not running|unknown`,
  `No running containers.`, `No containers.`, and the footer strings (`Succeeded · exit 0`,
  `Failed · exit n`, `Canceled`). Preserve them; adjust tests only where a structural change is
  unavoidable and state it in the plan.
- Node 26 / pnpm 12; no new dependencies for styling. The icon pipeline uses only macOS built-ins
  (`iconutil`, `sips`) and Chromium via the already-installed Playwright (no new package).

## Approaches considered

1. **macOS-native refinement (chosen).** System type scale and colours, subtle surfaces, 1px
   borders, 8px radii, state chips, light+dark together. Trades maximum visual drama for
   appropriateness: it reads as a Mac app and screenshots hold up in both themes.
2. **Dark developer-tool aesthetic.** Charcoal + mint + monospace. Strong GitHub screenshots, but
   light mode becomes a second design or is dropped, and it fights macOS conventions.
3. **Light editorial.** White space and typography, colour only for state. Elegant, weaker in dark
   mode and less at home next to native controls.

## Design

### Tokens (main.css)

CSS variables on `:root`, overridden under `@media (prefers-color-scheme: dark)`:
`--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--border-strong`,
`--accent` (system blue), `--success`, `--warning`, `--danger`, `--ring`,
plus `--radius` (8px) and a type scale (13/15/17/22px, SF stack).
Focus-visible ring uses `--ring`; all interactive elements get hover/active/disabled states.

### Shell (App.svelte)

- Sidebar 200px: app mark (24px icon) + wordmark, then nav items with inline SVG icons
  (grid for Containers, cube/box for Build), active item as a filled pill with accent text.
- Main area: max-width ~1080px, 28px padding, title row (h1 + muted subtitle + actions on the right).
- Standard macOS title bar retained.

### Containers screen

- Header: title, subtitle ("Running containers on this Mac"), service status pill with a coloured
  dot, `Show stopped` switch, `Refresh` secondary button.
- Table card: surface background, 1px border, 8px radius, sticky header, 44px rows, hover row tint;
  ID in monospace; image muted; state as a chip (dot + label: running green, stopped slate,
  stopping amber); address/platform in muted monospace.
- Empty state: centered glyph + copy; distinguish running-only vs all.
- Banners: toned surfaces (danger/warning/info) with icon, message, action button, and a `<pre>`
  for stderr excerpts.

### Build screen

- Two-column layout inside a card: 160px label column, controls; helper text under each control.
- Context and Dockerfile rows: readonly input + `Choose…`/`Browse…` buttons.
- Tag row, then an `Advanced` disclosure card (build args textarea, target, platform, no-cache
  switch) with a clear affordance.
- Primary `Build` button aligned right; disabled state explainable via helper text.
- Log panel: header with status dot + status text + elapsed/tag, `Clear`/`Cancel` ghost buttons;
  monospace 12px body, stderr tinted, auto-scroll preserved.

### Icon

- 1024×1024 master SVG: rounded-square (macOS squircle-ish 22% radius) with a restrained
  slate→blue-grey gradient, subtle inner highlight, and a glyph of three stacked container
  slabs, the front one accented in system blue with a small build/terminal tick.
- Render pipeline (repeatable, committed as `scripts/build-icon.mjs`): render the SVG in Chromium
  via Playwright at each required size → PNG; assemble an `.iconset`; `iconutil -c icns`.
- Outputs: `build/icon.icns` (packaging), `build/icon.png` (512), `resources/icon.png` (window icon).
- No new dependencies. The SVG source (`build/icon.svg`) is the editable master.

### Screenshots

- `scripts/screenshots.mjs`: launches the built app with the fake CLI (seeded running/stopped
  containers, a completed build log), waits for stable content, captures at 2× device pixel ratio:
  `containers-light.png`, `containers-dark.png`, `build-light.png`, `build-dark.png`,
  `build-log-light.png` (successful run).
- Theme forcing: Playwright's `page.emulateMedia({ colorScheme })` sets the renderer's colour scheme
  per capture (nativeTheme alone does not move Chromium's media query reliably here).
- Images live in `docs/screenshots/` and are referenced by the README via relative paths.

### README

Sections: hero (icon, name, one-liner, badges for CI/Electron/Svelte), screenshot gallery (light +
dark, containers and build log), what it does, requirements, install/run, build & package,
architecture (diagram-ish module list), testing (unit/integration/e2e + overrides), troubleshooting,
license.

### Publishing

- Scan the tree for secrets and machine-specific paths before pushing (fixtures were redacted;
  screenshots will show fake data, but verify).
- Create `ionutale/aiu-containers-electron` as a **public** repo via `gh`, set description and
  topics (`macos`, `electron`, `apple-container`, `svelte`), push `main`.
- CI (already committed) runs on push; verify the run starts and report its status.
- Add an MIT `LICENSE` (proposed; the repository is public, and without a license it is
  "all rights reserved" by default).

## Decisions left to the builder

- Exact palette values, spacing rhythm and icon geometry within the described language.
- Whether the table needs a created/platform column layout adjustment (keep the current columns for
  now).
- Exact screenshot crop/framing and which build state to show in each.

## Risks

- e2e assertions depend on copy/roles: mitigated by preserving them; any unavoidable change is
  called out and covered by updating the specs.
- Dark-mode screenshots require the theme hook; scoped to the main process and documented.
- Icon rendering via Chromium must be deterministic: fixed viewport, transparent background,
  no font dependency in the glyph.
