import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ParseError,
  parseContainerList,
  parseSystemStatus
} from '../../src/main/container-cli/parsers'

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

describe('parseContainerList', () => {
  it('parses the captured real CLI output', () => {
    const list = parseContainerList(fixture('real-list.json'))
    expect(Array.isArray(list)).toBe(true)
    for (const c of list) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.platform).toMatch(/^linux\//)
    }
    expect(list[0].state).toBe('stopped')
    expect(list[0].networks).toEqual(['default'])
  })

  it('summarizes the fake CLI shape precisely', () => {
    const sample = {
      id: 'web-1',
      configuration: {
        image: { reference: 'docker.io/library/nginx:latest' },
        platform: { os: 'linux', architecture: 'arm64' },
        creationDate: '2026-08-31T12:00:00Z',
        networks: [{ network: 'default' }]
      },
      status: { state: 'running', networks: [{ ipv4Address: '192.168.64.2/24' }] }
    }
    expect(parseContainerList(JSON.stringify([sample]))).toEqual([
      {
        id: 'web-1',
        image: 'docker.io/library/nginx:latest',
        state: 'running',
        ip: '192.168.64.2',
        platform: 'linux/arm64',
        created: '2026-08-31T12:00:00Z',
        networks: ['default'],
        labels: {}
      }
    ])
  })

  it('tolerates missing optional keys and empty output', () => {
    expect(parseContainerList('')).toEqual([])
    expect(parseContainerList('   ')).toEqual([])
    expect(parseContainerList(JSON.stringify([{}]))).toEqual([
      {
        id: '',
        image: '',
        state: '',
        ip: '',
        platform: '',
        created: '',
        networks: [],
        labels: {}
      }
    ])
  })

  it('throws ParseError on malformed JSON and unexpected shape', () => {
    expect(() => parseContainerList('{"oops')).toThrow(ParseError)
    expect(() => parseContainerList('{"not":"an array"}')).toThrow(ParseError)
  })
})

describe('parseSystemStatus', () => {
  it('parses the captured real CLI output', () => {
    const status = parseSystemStatus(fixture('real-system-status.json'))
    expect(status.status.length).toBeGreaterThan(0)
  })

  it('tolerates missing optional keys', () => {
    expect(parseSystemStatus('{"status":"running"}')).toEqual({
      status: 'running',
      clientVersion: '',
      serverVersion: '',
      hostArch: '',
      hostOs: '',
      containersTotal: null,
      containersRunning: null
    })
  })

  it('throws ParseError on invalid input', () => {
    expect(() => parseSystemStatus('nope')).toThrow(ParseError)
  })
})
