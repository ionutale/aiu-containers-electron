import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function findDockerfile(dir: string): { dockerfile: string | null } {
  if (!dir) return { dockerfile: null }
  for (const name of ['Dockerfile', 'Containerfile']) {
    if (existsSync(join(dir, name))) return { dockerfile: name }
  }
  return { dockerfile: null }
}
