import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildButton, launchApp, openBuild, tempContext } from './helpers/app'

test('context picker detects the Dockerfile and defaults the tag from the folder', async () => {
  const context = tempContext('FROM alpine:3.20\nRUN echo hello\n')
  const app = await launchApp({ dirDialog: context })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()

    await expect(app.window.locator('#context')).toHaveValue(context)
    await expect(app.window.locator('#dockerfile')).toHaveValue('Dockerfile')
    await expect(app.window.locator('#tag')).toHaveValue(basename(context).toLowerCase())
    await expect(buildButton(app.window)).toBeEnabled()
  } finally {
    await app.close()
  }
})

test('hints when the context has no Dockerfile, then clears once one is chosen', async () => {
  const context = tempContext()
  const dockerfile = tempContext('FROM alpine:3.20\n') + '/Dockerfile'
  const app = await launchApp({ dirDialog: context, fileDialog: dockerfile })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await expect(app.window.getByText(/No Dockerfile or Containerfile/)).toBeVisible()

    await app.window.getByRole('button', { name: 'Browse…' }).click()
    await expect(app.window.locator('#dockerfile')).toHaveValue(dockerfile)
    await expect(app.window.getByText(/No Dockerfile or Containerfile/)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('disables Build until a context and tag are present', async () => {
  const app = await launchApp({ dirDialog: tempContext('FROM alpine:3.20\n') })
  try {
    await openBuild(app.window)
    await expect(buildButton(app.window)).toBeDisabled()

    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await expect(buildButton(app.window)).toBeEnabled()

    await app.window.locator('#tag').fill('')
    await expect(buildButton(app.window)).toBeDisabled()
  } finally {
    await app.close()
  }
})

test('surfaces build-arg errors without starting a build', async () => {
  const app = await launchApp({ dirDialog: tempContext('FROM alpine:3.20\n') })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await app.window.getByRole('button', { name: /Advanced/ }).click()
    await app.window.locator('#args').fill('NOT_A_PAIR')

    await buildButton(app.window).click()

    await expect(app.window.getByText(/Not a KEY=VALUE line/)).toBeVisible()
    await expect(app.window.getByText(/fake build args/)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('builds, streams the log, and reports success in the footer', async () => {
  const app = await launchApp({ dirDialog: tempContext('FROM alpine:3.20\n') })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await buildButton(app.window).click()

    await expect(app.window.getByText('#2 [1/2] FROM alpine:3.20')).toBeVisible()
    await expect(app.window.getByText('fake: done')).toBeVisible()
    await expect(app.window.getByText(/Succeeded · exit 0/)).toBeVisible()
  } finally {
    await app.close()
  }
})

test('reports a failed build with the backend message', async () => {
  const app = await launchApp({
    mode: 'failing-build',
    dirDialog: tempContext('FROM alpine:3.20\n')
  })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await buildButton(app.window).click()

    await expect(app.window.getByText(/Failed · exit 1/)).toBeVisible()
    await expect(app.window.locator('p.error')).toContainText('did not complete successfully')
  } finally {
    await app.close()
  }
})

test('cancels a running build and leaves no orphaned process', async () => {
  const app = await launchApp({
    mode: 'blocking-build',
    dirDialog: tempContext('FROM alpine:3.20\n')
  })
  try {
    await openBuild(app.window)
    await app.window.getByRole('button', { name: 'Choose…' }).click()
    await buildButton(app.window).click()

    await expect(app.window.getByText('#1 [internal] load build definition')).toBeVisible()

    const pidFile = `${app.statePath}.pid`
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))

    await app.window.getByRole('button', { name: 'Cancel' }).click()
    await expect(app.window.getByText(/Canceled/)).toBeVisible()

    // The fake records its pid at build start; after cancel the process must be gone.
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return false
          } catch {
            return true
          }
        },
        { timeout: 10_000 }
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})
