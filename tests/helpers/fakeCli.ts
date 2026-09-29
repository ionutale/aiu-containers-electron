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
