import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  // Electron app instances are heavy and each spec owns a temp fake CLI
  // state file, so run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']]
})
