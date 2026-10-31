import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, openCompose } from './helpers/app'

function composeProject(compose: string, dockerfile?: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-compose-'))
  const file = join(dir, 'compose.yaml')
  writeFileSync(file, compose)
  if (dockerfile) writeFileSync(join(dir, 'Dockerfile'), dockerfile)
  return { dir, file }
}

interface FakeContainer {
  configuration: { id: string }
}

interface FakeState {
  networks: string[]
  volumes: string[]
  images: string[]
  extra: FakeContainer[]
}

function fakeState(path: string): FakeState {
  return JSON.parse(readFileSync(path, 'utf8')) as FakeState
}

const STACK = `
name: demo
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    depends_on:
      - db
  db:
    image: postgres:16
    volumes:
      - data:/var/lib/postgresql/data
    restart: unless-stopped
`

test('opens a compose file, runs the stack, follows logs and tears it down', async () => {
  const project = composeProject(STACK)
  const app = await launchApp({ fileDialog: project.file })
  try {
    await openCompose(app.window)
    await app.window.getByRole('button', { name: 'Open…' }).click()

    await expect(app.window.getByText('demo_default')).toBeVisible()
    await expect(app.window.getByText(/cannot resolve service names/i)).toBeVisible()
    await expect(app.window.getByText(/restart is not supported/)).toBeVisible()

    await app.window.getByRole('button', { name: 'Up' }).click()
    await expect(app.window.getByText(/Up succeeded/)).toBeVisible({ timeout: 30_000 })
    await expect(app.window.getByText('2/2 running')).toBeVisible()

    const webRow = app.window.locator('tr', { hasText: 'web' })
    await webRow.getByRole('button', { name: 'Logs' }).click()
    await expect(app.window.getByText('[demo-web] listening')).toBeVisible()
    await app.window.getByRole('button', { name: 'Stop logs' }).click()

    await app.window.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(app.window.getByText('0/2 running')).toBeVisible({ timeout: 15_000 })

    await app.window.getByRole('button', { name: 'Down', exact: true }).click()
    await expect(app.window.getByText('not created').first()).toBeVisible({ timeout: 15_000 })

    const saved = fakeState(app.statePath)
    expect(saved.networks).toEqual([])
    expect(saved.volumes).toEqual(['demo_data'])
    expect(saved.extra).toEqual([])
  } finally {
    await app.close()
  }
})

test('builds a compose service before starting it', async () => {
  const project = composeProject(
    `
name: demo
services:
  app:
    build: .
    environment:
      A: "1"
`,
    'FROM alpine:3.20\nRUN echo hello\n'
  )
  const app = await launchApp({ fileDialog: project.file })
  try {
    await openCompose(app.window)
    await app.window.getByRole('button', { name: 'Open…' }).click()
    await app.window.getByRole('button', { name: 'Up' }).click()

    await expect(app.window.getByText('#2 [1/2] FROM alpine:3.20')).toBeVisible({
      timeout: 30_000
    })
    await expect(app.window.getByText(/Up succeeded/)).toBeVisible({ timeout: 30_000 })

    const saved = fakeState(app.statePath)
    expect(saved.images).toContain('demo-app')
    expect(saved.extra.map((container) => container.configuration.id)).toEqual(['demo-app'])
  } finally {
    await app.close()
  }
})

test('shows an unsupported-key error and does not offer Up', async () => {
  const project = composeProject(`
name: demo
services:
  web:
    image: nginx:latest
    profiles: [dev]
`)
  const app = await launchApp({ fileDialog: project.file })
  try {
    await openCompose(app.window)
    await app.window.getByRole('button', { name: 'Open…' }).click()

    await expect(app.window.getByText(/Unsupported service key: profiles/)).toBeVisible()
    await expect(app.window.getByRole('button', { name: 'Up' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
