export function defaultTagFor(dir: string): string {
  const base = dir.replace(/\/+$/, '').split('/').pop() ?? ''
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
  return sanitized || 'image'
}

export function parseBuildArgs(text: string): {
  args: { key: string; value: string }[]
  errors: string[]
} {
  const args: { key: string; value: string }[] = []
  const errors: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const eq = line.indexOf('=')
    if (eq <= 0) {
      errors.push(`Not a KEY=VALUE line: ${line}`)
      continue
    }
    args.push({ key: line.slice(0, eq), value: line.slice(eq + 1) })
  }
  return { args, errors }
}

export function formatElapsed(ms: number): string {
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}m ${s}s`
}
