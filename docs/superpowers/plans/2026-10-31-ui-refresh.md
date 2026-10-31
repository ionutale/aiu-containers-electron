# UI Refresh, Icon and Public README — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a finished macOS-native look (light + dark), a custom icon, real screenshots, a comprehensive README, and publish it as a public GitHub repository, without changing behaviour or breaking the e2e contract.

**Architecture:** Styling stays in `src/renderer/src/assets/main.css` (design tokens + shared component styles) with Svelte scoped markup changes in `App.svelte`, `Containers.svelte` and `Build.svelte`. A documented `AIU_THEME` env var in the main process forces the native theme for screenshots. The icon is an SVG master rendered through Chromium (Playwright) into an `.iconset` and packed with `iconutil`. Screenshots are produced by a committed Playwright script against the built app with the fake CLI.

**Tech Stack:** Svelte 5, CSS custom properties, Electron 39, Playwright (already a devDependency), macOS `iconutil`/`sips`.

**Spec:** `docs/superpowers/specs/2026-10-31-ui-refresh-design.md`

## Global Constraints

- No new dependencies; no UI kit; styling in Svelte/CSS only.
- Preserve e2e-visible copy and roles: `Show stopped`, `Refresh`, `Start service`, `Choose…`, `Browse…`, `Build`, `Cancel`, `Clear`, `Service: running|not running|unknown`, `No running containers.`, `No containers.`, `Succeeded · exit 0`, `Failed · exit n`, `Canceled`.
- Both themes designed together; light is the default (`prefers-color-scheme`).
- No behavioural changes to CLI/IPC/build semantics.
- Screenshots use only fake data; verify no machine paths/tokens before publishing.
- Node 26 / pnpm 12; verify with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`.

## Review Focus

1. **e2e contract drift** — a restyle that changes roles/labels/copy breaks the 17 passing specs; each UI task ends by running the affected spec.
2. **Dark-mode contrast** — muted text, chips, borders and the log must stay legible on dark surfaces; checked in dark screenshots at the end of Task 5.
3. **Narrow-window layout** — the app can be resized; the form's two-column grid and the table must not clip; checked at 820px width in Task 5.
4. **Icon correctness** — `.icns` must contain the full size ladder and a transparent rounded square; verified in Task 4 with `iconutil`/`sips` and by viewing the PNG.
5. **Publishing hygiene** — screenshots and repository contents must not expose home paths, tokens or personal data; scan in Task 8 before pushing.

---

### Task 1: Theme tokens, shell and theme hook

**Files:** Modify `src/renderer/src/assets/main.css`, `src/renderer/src/App.svelte`, `src/main/index.ts`.

**Interfaces:** Produces CSS variables (`--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--border-strong`, `--accent`, `--success`, `--warning`, `--danger`, `--ring`, `--radius`) consumed by Tasks 2–3; `AIU_THEME=light|dark` sets `nativeTheme.themeSource`.

- [ ] Step 1: Rewrite `main.css` with tokens (light + `prefers-color-scheme: dark` overrides), base typography, button/input surfaces, shell layout and shared primitives (`.card`, `.pill`, `.chip`, `.btn`, `.btn-primary`, `.btn-ghost`, `.switch`, `.empty`).
- [ ] Step 2: Update `App.svelte`: sidebar with 24px app mark (`resources/icon.png`? no — inline SVG mark until the icon exists; use a simple stacked-slabs SVG), nav items with inline icons, active pill.
- [ ] Step 3: In `src/main/index.ts`, after `app.whenReady()`, set `nativeTheme.themeSource = (process.env.AIU_THEME === 'light' || process.env.AIU_THEME === 'dark') ? process.env.AIU_THEME : 'system'`; import `nativeTheme`.
- [ ] Step 4: Verify `pnpm build && pnpm exec playwright test e2e/shell.e2e.ts e2e/containers.e2e.ts` passes (copy must be unchanged).
- [ ] Step 5: Commit (`feat: add design tokens, shell layout and theme override`).

### Task 2: Containers screen restyle

**Files:** Modify `src/renderer/src/screens/Containers.svelte` (+ tokens in `main.css` if needed).

**Interfaces:** Consumes Task 1 primitives; keeps `getApi()` calls, `load()`, `toggleRunningOnly()`, `startService()` unchanged.

- [ ] Step 1: Header: title + muted subtitle, service pill with dot (`data-state` class from `serviceState`), `Show stopped` switch, `Refresh` secondary button.
- [ ] Step 2: Table card: sticky header, row hover, monospace ID/address/platform, state chip (dot + label).
- [ ] Step 3: Empty state block + toned banners (service down / CLI missing / generic with `<pre>` excerpt).
- [ ] Step 4: Run `pnpm exec playwright test e2e/containers.e2e.ts` (7 specs) and `pnpm test -- tests/unit/containers-screen.test.ts`.
- [ ] Step 5: Commit (`feat: restyle the containers screen`).

### Task 3: Build screen restyle

**Files:** Modify `src/renderer/src/screens/Build.svelte` (+ tokens).

**Interfaces:** Consumes Task 1 primitives; keeps `buildStart`, `buildCancel`, event filtering, `builtTag`, validation and copy unchanged.

- [ ] Step 1: Wrap the form in a card: 160px label column, helper text, readonly inputs with `Choose…`/`Browse…` buttons, tag row.
- [ ] Step 2: Rebuild the Advanced disclosure as a bordered section with a chevron and a summary line; no-cache as a switch.
- [ ] Step 3: Primary `Build` button aligned right with disabled helper text.
- [ ] Step 4: Log panel header: status dot + status copy + elapsed/tag, `Clear`/`Cancel` ghost buttons; keep `pre.stderr`.
- [ ] Step 5: Run `pnpm exec playwright test e2e/build.e2e.ts` (7 specs) and `pnpm test -- tests/unit/build-screen.test.ts`.
- [ ] Step 6: Commit (`feat: restyle the build screen`).

### Task 4: App icon

**Files:** Create `build/icon.svg`, `scripts/build-icon.mjs`; regenerate `build/icon.icns`, `build/icon.png`, `resources/icon.png`.

**Interfaces:** `node scripts/build-icon.mjs` is idempotent; renders the SVG at 1024/512/256/128/64/32/16 with Playwright, assembles `build/icon.iconset`, runs `iconutil -c icns`.

- [ ] Step 1: Author `build/icon.svg` (squircle, slate→blue-grey gradient, three stacked container slabs, front slab accented, soft inner highlight; no text/fonts).
- [ ] Step 2: Write `scripts/build-icon.mjs` (render sizes via Chromium `page.setViewportSize` + `omitBackground`, write iconset with `@2x` pairs).
- [ ] Step 3: Run it; verify `iconutil -c icns` output opens (`sips -g pixelWidth -g pixelHeight build/icon.png` = 512) and view the 1024 PNG.
- [ ] Step 4: `pnpm build:unpack` and confirm the packaged app uses the icon (`plutil`/Finder not required; check `dist/mac-arm64/Aiu Containers Electron.app/Contents/Resources/icon.icns` exists).
- [ ] Step 5: Commit (`feat: add the application icon`).

### Task 5: Screenshots

**Files:** Create `scripts/screenshots.mjs`, `docs/screenshots/*.png`; no app changes beyond Task 1's hook.

**Interfaces:** `node scripts/screenshots.mjs` builds nothing (expects `out/`); launches the fake-CLI app with `AIU_THEME=light|dark`, `AIU_E2E_DIR_DIALOG=examples/hello`, captures at `deviceScaleFactor: 2`.

- [ ] Step 1: Script: containers (light/dark), build form (light/dark), build success log (light).
- [ ] Step 2: Also capture a narrow (820px) containers shot to check layout.
- [ ] Step 3: Run; view each PNG; fix any contrast/layout issues found (repeat until clean).
- [ ] Step 4: Commit (`docs: add app screenshots`).

### Task 6: README + LICENSE

**Files:** Rewrite `README.md`; create `LICENSE` (MIT).

**Interfaces:** Relative image paths under `docs/screenshots/`.

- [ ] Step 1: Hero with icon, one-liner, CI/Electron/Svelte badges; screenshot gallery; features; requirements; install/run; build & package; architecture; testing (unit/integration/e2e/overrides); troubleshooting; license.
- [ ] Step 2: Verify every referenced file exists; check markdown renders (view in Review pane if available).
- [ ] Step 3: Commit (`docs: comprehensive README with screenshots`).

### Task 7: Full verification

- [ ] Step 1: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` — all green.
- [ ] Step 2: Fix any regressions; commit.
- [ ] Step 3: Record the evidence in the final report.

### Task 8: Publish

- [ ] Step 1: Scan for secrets/home paths: `grep -rIl "/Users/ionutale" --exclude-dir=node_modules --exclude-dir=.git .` (expect only acceptable fixtures/README if any), plus a token pattern scan.
- [ ] Step 2: `gh repo create ionutale/aiu-containers-electron --public --source=. --push --description "macOS app for Apple's container runtime: list containers and build images from a Dockerfile"`.
- [ ] Step 3: Add topics (`gh repo edit --add-topic macos --add-topic electron --add-topic svelte --add-topic apple-container`).
- [ ] Step 4: Confirm the CI run started (`gh run list --limit 1`), report status and URL.

## Self-Review Notes

- Coverage: tokens/shell (T1), containers (T2), build (T3), icon (T4), screenshots (T5), README/license (T6), verification (T7), publish (T8) — matches every spec goal.
- e2e contract preserved by design; each UI task runs its spec.
- Review Focus items are pinned: e2e (T2/T3), dark/narrow (T5), icon ladder (T4), publishing hygiene (T8).
- Deliberately not a transcript: exact palette/spacing/icon geometry left to the builder within the described language.
