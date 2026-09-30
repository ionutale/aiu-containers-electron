import { expect, test } from '@playwright/test'
import { launchApp, openBuild } from './helpers/app'

test('exposes the containers bridge but no Node globals to the renderer', async () => {
  const app = await launchApp()
  try {
    const probe = await app.window.evaluate(() => {
      const scope = globalThis as Record<string, unknown>
      return {
        containers: typeof scope.containers,
        require: typeof scope.require,
        process: typeof scope.process,
        module: typeof scope.module
      }
    })

    expect(probe.containers).toBe('object')
    expect(probe.require).toBe('undefined')
    expect(probe.process).toBe('undefined')
    expect(probe.module).toBe('undefined')
  } finally {
    await app.close()
  }
})

test('switches between the Containers and Build screens', async () => {
  const app = await launchApp()
  try {
    await expect(app.window.getByRole('heading', { name: 'Containers' })).toBeVisible()

    await openBuild(app.window)
    await expect(app.window.getByRole('heading', { name: 'Build' })).toBeVisible()

    await app.window.locator('nav').getByRole('button', { name: 'Containers' }).click()
    await expect(app.window.getByRole('heading', { name: 'Containers' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('boots with no console or page errors', async () => {
  const app = await launchApp()
  try {
    await expect(app.window.getByText('web-1')).toBeVisible()
    await openBuild(app.window)
    expect(app.errors).toEqual([])
  } finally {
    await app.close()
  }
})
