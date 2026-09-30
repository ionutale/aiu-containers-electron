import { spawnSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/app'

// Opt-in smoke test against the machine's real container runtime. It is
// skipped unless AIU_E2E_REAL_CLI=1 (the container service must be running).
// Run with: pnpm test:e2e:real
const realCli = process.env.AIU_E2E_REAL_CLI === '1'

function realServiceStatus(): string | null {
  const result = spawnSync('container', ['system', 'status', '--format', 'json'], {
    encoding: 'utf8'
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as { status?: string }
    return parsed.status ?? null
  } catch {
    return null
  }
}

test.describe('real container CLI (opt-in)', () => {
  test.skip(!realCli, 'set AIU_E2E_REAL_CLI=1 and start the container service to run this')

  test('renders the real runtime state without an error banner', async () => {
    const app = await launchApp({ useRealCli: true })
    try {
      // When the real service reports running, the app's badge must say so.
      if (realServiceStatus() === 'running') {
        await expect(app.window.getByText('Service: running')).toBeVisible()
      }

      await expect
        .poll(
          async () => {
            const rows = await app.window.locator('tbody tr').count()
            const empty = await app.window.getByText(/No (running )?containers\./).count()
            return rows > 0 || empty > 0
          },
          { timeout: 20_000 }
        )
        .toBe(true)

      await expect(app.window.getByText(/CLI was not found/)).toHaveCount(0)
      await expect(app.window.getByText(/did not return valid JSON/)).toHaveCount(0)
      await expect(app.window.getByText(/service is not running/i)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})
