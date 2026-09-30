import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/app'

test('lists running containers with a running service badge', async () => {
  const app = await launchApp()
  try {
    await expect(app.window.getByRole('heading', { name: 'Containers' })).toBeVisible()
    await expect(app.window.getByText('web-1')).toBeVisible()
    await expect(app.window.getByText('db-1')).toHaveCount(0)
    await expect(app.window.getByText('Service: running')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('Show stopped reveals the stopped container and hides it again', async () => {
  const app = await launchApp()
  try {
    await expect(app.window.getByText('web-1')).toBeVisible()
    await app.window.getByLabel('Show stopped').check()
    await expect(app.window.getByText('db-1')).toBeVisible()

    await app.window.getByLabel('Show stopped').uncheck()
    await expect(app.window.getByText('db-1')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('auto-refresh drops a container stopped outside the app', async () => {
  const app = await launchApp()
  try {
    await expect(app.window.getByText('web-1')).toBeVisible()

    execFileSync(join(app.fake!.binDir, 'container'), ['stop', 'web-1'], { env: app.env })

    await expect(app.window.getByText('web-1')).toHaveCount(0, { timeout: 15_000 })
    await expect(app.window.getByText('No running containers.')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('shows the empty state when nothing is running', async () => {
  const app = await launchApp({
    prepare: (fake) => {
      execFileSync(join(fake.binDir, 'container'), ['stop', 'web-1'], { env: fake.env })
    }
  })
  try {
    await expect(app.window.getByText('No running containers.')).toBeVisible()
    await app.window.getByLabel('Show stopped').check()
    await expect(app.window.getByText('db-1')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('shows the install hint when the container CLI is missing', async () => {
  const app = await launchApp({ containerBin: '/nonexistent/container' })
  try {
    await expect(app.window.getByText(/CLI was not found/)).toBeVisible()
    await expect(app.window.getByText('Service: unknown')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('service-down banner recovers through Start service', async () => {
  const app = await launchApp({ mode: 'service-down' })
  try {
    await expect(app.window.getByText('Service: not running')).toBeVisible()
    await expect(app.window.getByText(/service is not running/i)).toBeVisible()

    await app.window.getByRole('button', { name: 'Start service' }).click()

    await expect(app.window.getByText('Service: running')).toBeVisible()
    await expect(app.window.getByText('web-1')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('surfaces a parse error from malformed CLI output', async () => {
  const app = await launchApp({ mode: 'bad-json' })
  try {
    await expect(app.window.getByText(/did not return valid JSON/)).toBeVisible()
    await expect(app.window.locator('.banner pre')).toHaveText('{"oops')
  } finally {
    await app.close()
  }
})
