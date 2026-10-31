#!/usr/bin/env node
// Captures the README screenshots from the real app, using the fake container
// CLI for deterministic data. Requires `pnpm build` first.
import { _electron as electron } from '@playwright/test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'screenshots')
const demo = '/Users/Shared/aiu-demo/hello'

mkdirSync(outDir, { recursive: true })
mkdirSync(demo, { recursive: true })
writeFileSync(
  join(demo, 'Dockerfile'),
  'FROM alpine:3.20\nRUN echo "hello from aiu-containers-electron" > /hello.txt\nCMD ["cat", "/hello.txt"]\n'
)

function fakeEnv() {
  const work = mkdtempSync(join(tmpdir(), 'aiu-shots-'))
  const binDir = join(work, 'bin')
  mkdirSync(binDir, { recursive: true })
  const bin = join(binDir, 'container')
  copyFileSync(join(root, 'tests/fake-container/container'), bin)
  chmodSync(bin, 0o755)
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH ?? ''}`,
    FAKE_CONTAINER_STATE: join(work, 'state.json'),
    FAKE_QUIET: '1',
    AIU_E2E_DIR_DIALOG: demo
  }
}

async function withApp(theme, fn) {
  const app = await electron.launch({
    args: [join(root, 'out/main/index.js')],
    env: fakeEnv()
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // Page-level emulation is deterministic; the OS theme is irrelevant here.
    await page.emulateMedia({ colorScheme: theme })
    await fn(app, page)
  } finally {
    await app.close()
  }
}

async function openBuild(page) {
  await page.locator('nav').getByRole('button', { name: 'Build' }).click()
  await page.getByRole('heading', { name: 'Build' }).waitFor()
  await page.waitForTimeout(200)
}

await withApp('light', async (_app, page) => {
  await page.getByText('web-1').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, 'containers-light.png') })

  await openBuild(page)
  await page.screenshot({ path: join(outDir, 'build-light.png') })

  await page.getByRole('button', { name: 'Choose…' }).click()
  await page.waitForFunction(() => {
    const input = document.querySelector('#context')
    return input instanceof HTMLInputElement && input.value.includes('aiu-demo')
  })
  await page
    .locator('form')
    .getByRole('button', { name: /^build$/i })
    .click()
  await page.getByText(/Succeeded · exit 0/).waitFor()
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(outDir, 'build-log-light.png') })
})

await withApp('dark', async (_app, page) => {
  await page.getByText('web-1').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, 'containers-dark.png') })

  await openBuild(page)
  await page.screenshot({ path: join(outDir, 'build-dark.png') })
})

await withApp('light', async (app, page) => {
  await page.getByText('web-1').waitFor()
  const window = await app.browserWindow(page)
  await window.evaluate((win) => win.setSize(820, 720))
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(outDir, 'containers-narrow.png') })
})

console.log(`screenshots written to ${outDir}`)
