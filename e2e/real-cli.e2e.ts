import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/app'

// Opt-in smoke test against the machine's real container runtime. It is
// skipped unless AIU_E2E_REAL_CLI=1 (the container service must be running).
// Run with: pnpm test:e2e:real
const realCli = process.env.AIU_E2E_REAL_CLI === '1'

test.describe('real container CLI (opt-in)', () => {
  test.skip(!realCli, 'set AIU_E2E_REAL_CLI=1 and start the container service to run this')

  test('renders the real runtime state without an error banner', async () => {
    const app = await launchApp({ useRealCli: true })
    try {
      await expect(app.window.getByText(/Service: (running|not running|unknown)/)).toBeVisible()

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
    } finally {
      await app.close()
    }
  })
})
