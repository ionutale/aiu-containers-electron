import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Electron e2e helpers. Deliberately depends on nothing that uses
// `import.meta` — Playwright transpiles these specs to CJS, while the
// Vitest helpers under tests/ are ESM.
const MAIN = join(__dirname, '..', '..', 'out', 'main', 'index.js')
const FAKE_SOURCE = join(__dirname, '..', '..', 'tests', 'fake-container', 'container')

export type FakeMode =
  | 'default'
  | 'service-down'
  | 'bad-json'
  | 'slow-build'
  | 'blocking-build'
  | 'failing-build'

export interface FakeCli {
  binDir: string
  statePath: string
  env: NodeJS.ProcessEnv
}

export function makeFakeCli(root: string, mode?: FakeMode): FakeCli {
  const binDir = join(root, 'bin')
  mkdirSync(binDir, { recursive: true })
  const target = join(binDir, 'container')
  copyFileSync(FAKE_SOURCE, target)
  chmodSync(target, 0o755)
  const statePath = join(root, 'state.json')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    FAKE_CONTAINER_STATE: statePath,
    ...(mode ? { FAKE_CONTAINER_MODE: mode } : {})
  }
  return { binDir, statePath, env }
}

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  /** Renderer console errors and page errors, for asserting a clean boot. */
  errors: string[]
  env: Record<string, string>
  statePath: string
  fake: FakeCli | null
  close: () => Promise<void>
}

/** Playwright's launch env must not contain `undefined` values. */
function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export async function launchApp(
  options: {
    mode?: FakeMode
    /** Mutate the fake CLI's state (e.g. stop a seeded container) before launch. */
    prepare?: (fake: FakeCli) => void
    /** Launch against the machine's real container CLI instead of the fake. */
    useRealCli?: boolean
    /** Force CLI discovery to this path (reachable CLI-missing state). */
    containerBin?: string
    /** Directory returned by the context picker instead of a native dialog. */
    dirDialog?: string
    /** File returned by the Dockerfile picker instead of a native dialog. */
    fileDialog?: string
  } = {}
): Promise<LaunchedApp> {
  const root = mkdtempSync(join(tmpdir(), 'aiu-e2e-'))
  const fake = options.useRealCli ? null : makeFakeCli(root, options.mode)
  if (fake && options.prepare) options.prepare(fake)

  const env: NodeJS.ProcessEnv = {
    ...(fake ? fake.env : process.env),
    ...(options.containerBin ? { CONTAINER_BIN: options.containerBin } : {}),
    ...(options.dirDialog ? { AIU_E2E_DIR_DIALOG: options.dirDialog } : {}),
    ...(options.fileDialog ? { AIU_E2E_FILE_DIALOG: options.fileDialog } : {})
  }

  const app = await electron.launch({ args: [MAIN], env: stringEnv(env) })
  const window = await app.firstWindow()
  const errors: string[] = []
  window.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  await window.waitForLoadState('domcontentloaded')

  return {
    app,
    window,
    errors,
    env: stringEnv(env),
    statePath: fake?.statePath ?? '',
    fake,
    close: async () => {
      await app.close()
    }
  }
}

export async function openBuild(window: Page): Promise<void> {
  await window.locator('nav').getByRole('button', { name: 'Build' }).click()
  await window.getByRole('heading', { name: 'Build' }).waitFor()
}

/** The form's submit button (the sidebar also has a "Build" button). */
export function buildButton(window: Page) {
  return window.locator('form').getByRole('button', { name: /^build$/i })
}

/** A temp build context directory, optionally containing a Dockerfile. */
export function tempContext(dockerfile?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-ctx-'))
  if (dockerfile) writeFileSync(join(dir, 'Dockerfile'), dockerfile)
  return dir
}
