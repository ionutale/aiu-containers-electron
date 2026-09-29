import type { ContainerSummary, SystemStatus } from '../../shared/types'

export class ParseError extends Error {}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function summarizeContainer(entry: unknown): ContainerSummary {
  const e = record(entry)
  const cfg = record(e['configuration'])
  const status = record(e['status'])
  const image = record(cfg['image'])
  const platform = record(cfg['platform'])
  const statusNets = Array.isArray(status['networks'])
    ? status['networks']
    : Array.isArray(e['networks'])
      ? e['networks']
      : []
  const firstNet = record(statusNets[0])
  const cfgNets = Array.isArray(cfg['networks']) ? cfg['networks'] : []
  return {
    id: str(e['id']) || str(cfg['id']),
    image: str(image['reference']),
    state: str(status['state']) || str(e['status']),
    ip: str(firstNet['ipv4Address']).split('/')[0],
    platform: [str(platform['os']), str(platform['architecture'])].filter(Boolean).join('/'),
    created: str(cfg['creationDate']),
    networks: cfgNets.map((n) => str(record(n)['network'])).filter(Boolean)
  }
}

export function parseContainerList(json: string): ContainerSummary[] {
  if (!json.trim()) return []
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ParseError('container list did not return valid JSON')
  }
  if (!Array.isArray(raw)) throw new ParseError('container list returned an unexpected shape')
  return raw.map(summarizeContainer)
}

export function parseSystemStatus(json: string): SystemStatus {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ParseError('container system status did not return valid JSON')
  }
  const e = record(raw)
  if (Object.keys(e).length === 0)
    throw new ParseError('container system status returned an empty object')
  const client = record(e['client'])
  const server = record(e['server'])
  const host = record(e['host'])
  const resources = record(e['resources'])
  return {
    status: str(e['status']),
    clientVersion: str(client['version']),
    serverVersion: str(server['version']) || str(e['apiServerVersion']),
    hostArch: str(host['architecture']),
    hostOs: str(host['operatingSystem']),
    containersTotal: num(resources['containersTotal']),
    containersRunning: num(resources['containersRunning'])
  }
}
