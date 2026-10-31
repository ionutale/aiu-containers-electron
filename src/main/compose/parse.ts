import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { LineCounter, parseDocument } from 'yaml'
import type {
  ComposeBuildSpec,
  ComposeError,
  ComposeMount,
  ComposeParseOptions,
  ComposeParseResult,
  ComposePort,
  ComposeProject,
  ComposeService,
  ComposeWarning
} from '../../shared/compose'

const TOP_LEVEL_KEYS = new Set(['name', 'services', 'version', 'volumes'])
const SUPPORTED_KEYS = new Set([
  'image',
  'build',
  'environment',
  'env_file',
  'ports',
  'volumes',
  'depends_on',
  'command',
  'entrypoint',
  'working_dir',
  'user',
  'platform',
  'container_name'
])
const WARN_KEYS = new Set([
  'labels',
  'logging',
  'expose',
  'healthcheck',
  'restart',
  'deploy',
  'cap_add',
  'cap_drop',
  'devices',
  'sysctls',
  'ulimits',
  'shm_size',
  'mem_limit',
  'mem_reservation',
  'cpus',
  'dns',
  'dns_search',
  'dns_opt',
  'extra_hosts',
  'links',
  'tmpfs',
  'tty',
  'stdin_open',
  'init',
  'privileged',
  'read_only',
  'security_opt',
  'stop_grace_period'
])
const BUILD_KEYS = new Set(['context', 'dockerfile', 'args', 'target', 'platform'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function sanitizeProjectName(input: string): string {
  const name = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/-+$/, '')
    .slice(0, 63)
  return name || 'compose'
}

function readDotenv(path: string): Record<string, string> {
  const env: Record<string, string> = {}
  if (!existsSync(path)) return env
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return env
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue
    const key = withoutExport.slice(0, eq).trim()
    let value = withoutExport.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function interpolateString(
  input: string,
  env: Record<string, string | undefined>,
  errors: ComposeError[],
  path: string
): string {
  return input.replace(
    /\$(\$|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (_match, token: string, braced: string | undefined, plain: string | undefined) => {
      if (token === '$') return '$'
      if (plain) return env[plain] ?? ''
      if (braced === undefined) return ''
      const body = braced.trim()
      const requiredColon = body.indexOf(':?')
      const required = body.indexOf('?')
      if (requiredColon >= 0) {
        const key = body.slice(0, requiredColon)
        const value = env[key]
        if (value === undefined || value === '') {
          errors.push({ message: body.slice(requiredColon + 2) || `${key} is required`, key: path })
          return ''
        }
        return value
      }
      if (required >= 0) {
        const key = body.slice(0, required)
        const value = env[key]
        if (value === undefined) {
          errors.push({ message: body.slice(required + 1) || `${key} is required`, key: path })
          return ''
        }
        return value
      }
      const defaultColon = body.indexOf(':-')
      if (defaultColon >= 0) {
        const key = body.slice(0, defaultColon)
        const fallback = body.slice(defaultColon + 2)
        const value = env[key]
        if (value !== undefined && value !== '') return value
        return interpolateString(fallback, env, errors, path)
      }
      const defaultDash = body.indexOf('-')
      if (defaultDash >= 0) {
        const key = body.slice(0, defaultDash)
        const fallback = body.slice(defaultDash + 1)
        const value = env[key]
        if (value !== undefined) return value
        return interpolateString(fallback, env, errors, path)
      }
      return env[body] ?? ''
    }
  )
}

function interpolateValue(
  value: unknown,
  env: Record<string, string | undefined>,
  errors: ComposeError[],
  path: string
): unknown {
  if (typeof value === 'string') return interpolateString(value, env, errors, path)
  if (Array.isArray(value))
    return value.map((item, i) => interpolateValue(item, env, errors, `${path}[${i}]`))
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const name = interpolateString(key, env, errors, `${path}.${key}`)
      out[name] = interpolateValue(item, env, errors, `${path}.${name}`)
    }
    return out
  }
  return value
}

function splitCommand(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let started = false
  for (const char of value) {
    if (escaped) {
      current += char
      escaped = false
      started = true
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        parts.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (started) parts.push(current)
  return parts
}

function commandValue(value: unknown): string[] | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return splitCommand(value)
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const item of value) {
      const text = scalar(item)
      if (text === null) return null
      parts.push(text)
    }
    return parts
  }
  return null
}

function parsePort(raw: unknown, errors: ComposeError[], service: string): ComposePort | null {
  if (typeof raw !== 'string') {
    errors.push({ message: 'Each port must be a string.', service, key: 'ports' })
    return null
  }
  const [spec, protocolRaw] = raw.split('/')
  const protocol = protocolRaw ?? 'tcp'
  if (protocol !== 'tcp' && protocol !== 'udp') {
    errors.push({ message: `Unsupported port protocol: ${protocol}`, service, key: 'ports' })
    return null
  }
  const parts = spec.split(':')
  if (parts.length === 1) {
    errors.push({
      message: `Port "${raw}" needs a host port (Apple's runtime has no random host ports).`,
      service,
      key: 'ports'
    })
    return null
  }
  if (parts.length < 2 || parts.length > 3) {
    errors.push({ message: `Invalid port mapping: ${raw}`, service, key: 'ports' })
    return null
  }
  const [hostIp, hostPortRaw, containerPortRaw] =
    parts.length === 3 ? parts : [undefined, parts[0], parts[1]]
  const hostPort = Number(hostPortRaw)
  const containerPort = Number(containerPortRaw)
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    errors.push({ message: `Invalid host port in "${raw}".`, service, key: 'ports' })
    return null
  }
  if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) {
    errors.push({ message: `Invalid container port in "${raw}".`, service, key: 'ports' })
    return null
  }
  return { raw, hostIp, hostPort, containerPort, protocol }
}

function isBindSource(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/') || source.startsWith('~')
}

function parseMount(
  raw: unknown,
  dir: string,
  project: string,
  errors: ComposeError[],
  service: string,
  namedVolumes: Set<string>
): ComposeMount | null {
  if (typeof raw !== 'string' || !raw.includes(':')) {
    errors.push({
      message: `Volume "${String(raw)}" must use source:target syntax.`,
      service,
      key: 'volumes'
    })
    return null
  }
  const parts = raw.split(':')
  if (parts.length < 2 || parts.length > 3) {
    errors.push({ message: `Invalid volume mapping: ${raw}`, service, key: 'volumes' })
    return null
  }
  const [sourceRaw, target, options] = parts
  if (!target.startsWith('/')) {
    errors.push({ message: `Volume target must be absolute: ${raw}`, service, key: 'volumes' })
    return null
  }
  if (options !== undefined && options !== 'ro') {
    errors.push({
      message: `Only the :ro volume option is supported: ${raw}`,
      service,
      key: 'volumes'
    })
    return null
  }
  if (!sourceRaw) {
    errors.push({ message: `Anonymous volumes are not supported: ${raw}`, service, key: 'volumes' })
    return null
  }
  if (isBindSource(sourceRaw)) {
    const expanded = sourceRaw.startsWith('~') ? join(homedir(), sourceRaw.slice(1)) : sourceRaw
    return {
      raw,
      type: 'bind',
      source: isAbsolute(expanded) ? expanded : resolve(dir, expanded),
      target,
      readOnly: options === 'ro'
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(sourceRaw)) {
    errors.push({ message: `Invalid volume name: ${sourceRaw}`, service, key: 'volumes' })
    return null
  }
  const volume = `${project}_${sourceRaw}`
  namedVolumes.add(volume)
  return {
    raw,
    type: 'volume',
    source: volume,
    target,
    readOnly: options === 'ro'
  }
}

function parseBuild(
  value: unknown,
  dir: string,
  project: string,
  service: string,
  env: Record<string, string | undefined>,
  errors: ComposeError[],
  warnings: ComposeWarning[]
): ComposeBuildSpec | null {
  let context = '.'
  let dockerfile: string | undefined
  const args: { key: string; value: string }[] = []
  let target: string | undefined
  let platform: string | undefined

  if (typeof value === 'string') {
    context = value
  } else if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (!BUILD_KEYS.has(key)) {
        errors.push({ message: `Unsupported build key: ${key}`, service, key: `build.${key}` })
      }
    }
    if (value.context !== undefined) {
      const text = scalar(value.context)
      if (text === null) {
        errors.push({ message: 'build.context must be a string.', service, key: 'build.context' })
      } else context = text
    }
    if (value.dockerfile !== undefined) {
      const text = scalar(value.dockerfile)
      if (text === null) {
        errors.push({ message: 'build.dockerfile must be a string.', service, key: 'build' })
      } else dockerfile = text
    }
    if (value.target !== undefined) {
      const text = scalar(value.target)
      if (text === null) {
        errors.push({ message: 'build.target must be a string.', service, key: 'build' })
      } else target = text
    }
    if (value.platform !== undefined) {
      const text = scalar(value.platform)
      if (text === null) {
        errors.push({ message: 'build.platform must be a string.', service, key: 'build' })
      } else platform = text
    }
    if (value.args !== undefined) {
      if (isRecord(value.args)) {
        for (const [key, item] of Object.entries(value.args)) {
          const text = scalar(item)
          if (text === null && item !== null && item !== undefined) {
            errors.push({
              message: `Build argument ${key} must be a scalar.`,
              service,
              key: 'build.args'
            })
          } else if (text !== null) {
            args.push({ key, value: text })
          }
        }
      } else if (Array.isArray(value.args)) {
        for (const item of value.args) {
          if (typeof item !== 'string') {
            errors.push({ message: 'Build arguments must be strings.', service, key: 'build.args' })
            continue
          }
          const eq = item.indexOf('=')
          if (eq > 0) args.push({ key: item.slice(0, eq), value: item.slice(eq + 1) })
          else args.push({ key: item, value: env[item] ?? '' })
        }
      } else {
        errors.push({ message: 'build.args must be a map or list.', service, key: 'build.args' })
      }
    }
  } else {
    errors.push({ message: 'build must be a string or an object.', service, key: 'build' })
    return null
  }

  const resolvedContext = isAbsolute(context) ? context : resolve(dir, context)
  if (!existsSync(resolvedContext)) {
    warnings.push({
      message: `Build context does not exist yet: ${resolvedContext}`,
      service,
      key: 'build.context'
    })
  }
  const tag = `${project}-${service}`
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(tag)) {
    errors.push({ message: `Invalid generated image tag: ${tag}`, service, key: 'build' })
  }
  return { context: resolvedContext, dockerfile, args, target, platform }
}

function serviceEnvironment(
  value: unknown,
  env: Record<string, string | undefined>,
  errors: ComposeError[],
  service: string
): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  if (value === undefined) return out
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item === null || item === undefined) {
        const inherited = env[key]
        if (inherited !== undefined) out.push({ key, value: inherited })
        continue
      }
      const text = scalar(item)
      if (text === null) {
        errors.push({
          message: `Environment value for ${key} must be a scalar.`,
          service,
          key: 'environment'
        })
        continue
      }
      out.push({ key, value: text })
    }
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') {
        errors.push({
          message: 'Each environment entry must be a string.',
          service,
          key: 'environment'
        })
        continue
      }
      const eq = item.indexOf('=')
      if (eq <= 0) {
        const inherited = env[item]
        if (inherited !== undefined) out.push({ key: item, value: inherited })
      } else {
        out.push({ key: item.slice(0, eq), value: item.slice(eq + 1) })
      }
    }
    return out
  }
  errors.push({ message: 'environment must be a map or a list.', service, key: 'environment' })
  return out
}

function readEnvFiles(
  value: unknown,
  dir: string,
  service: string,
  errors: ComposeError[]
): Record<string, string> {
  const merged: Record<string, string> = {}
  const files = value === undefined ? [] : Array.isArray(value) ? value : [value]
  for (const file of files) {
    if (typeof file !== 'string') {
      errors.push({
        message: 'env_file must be a string or a list of strings.',
        service,
        key: 'env_file'
      })
      continue
    }
    const path = isAbsolute(file) ? file : resolve(dir, file)
    if (!existsSync(path)) {
      errors.push({ message: `env_file not found: ${file}`, service, key: 'env_file' })
      continue
    }
    Object.assign(merged, readDotenv(path))
  }
  return merged
}

function parseService(
  name: string,
  value: unknown,
  project: string,
  dir: string,
  env: Record<string, string | undefined>,
  namedVolumes: Set<string>,
  errors: ComposeError[],
  warnings: ComposeWarning[]
): ComposeService | null {
  if (!isRecord(value)) {
    errors.push({ message: `Service ${name} must be an object.`, service: name })
    return null
  }
  for (const key of Object.keys(value)) {
    if (key.startsWith('x-')) continue
    if (SUPPORTED_KEYS.has(key)) continue
    if (WARN_KEYS.has(key)) {
      warnings.push({
        message: `${key} is not supported by Apple's runtime; it will be ignored.`,
        service: name,
        key
      })
      continue
    }
    errors.push({ message: `Unsupported service key: ${key}`, service: name, key })
  }

  let image: string | undefined
  if (value.image !== undefined) {
    const text = scalar(value.image)
    if (text === null || !text) {
      errors.push({ message: 'image must be a non-empty string.', service: name, key: 'image' })
    } else image = text
  }

  const build =
    value.build === undefined
      ? undefined
      : parseBuild(value.build, dir, project, name, env, errors, warnings)
  if (!image && !build) {
    errors.push({ message: `Service ${name} needs an image or a build section.`, service: name })
    return null
  }

  let containerName = `${project}-${name}`
  if (value.container_name !== undefined) {
    const text = scalar(value.container_name)
    if (text === null || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(text)) {
      errors.push({
        message: 'container_name must be a valid container name.',
        service: name,
        key: 'container_name'
      })
    } else containerName = text
  }

  const fileEnv = readEnvFiles(value.env_file, dir, name, errors)
  const envMap = new Map<string, string>(Object.entries(fileEnv))
  for (const item of serviceEnvironment(value.environment, env, errors, name)) {
    envMap.set(item.key, item.value)
  }

  const ports: ComposePort[] = []
  if (value.ports !== undefined) {
    if (!Array.isArray(value.ports)) {
      errors.push({ message: 'ports must be a list.', service: name, key: 'ports' })
    } else {
      for (const item of value.ports) {
        const port = parsePort(item, errors, name)
        if (port) ports.push(port)
      }
    }
  }

  const volumes: ComposeMount[] = []
  if (value.volumes !== undefined) {
    if (!Array.isArray(value.volumes)) {
      errors.push({ message: 'volumes must be a list.', service: name, key: 'volumes' })
    } else {
      for (const item of value.volumes) {
        const mount = parseMount(item, dir, project, errors, name, namedVolumes)
        if (mount) volumes.push(mount)
      }
    }
  }

  const dependsOn: string[] = []
  if (value.depends_on !== undefined) {
    if (Array.isArray(value.depends_on)) {
      for (const item of value.depends_on) {
        if (typeof item !== 'string') {
          errors.push({
            message: 'depends_on entries must be service names.',
            service: name,
            key: 'depends_on'
          })
        } else dependsOn.push(item)
      }
    } else if (isRecord(value.depends_on)) {
      for (const [dependency, options] of Object.entries(value.depends_on)) {
        dependsOn.push(dependency)
        if (
          isRecord(options) &&
          options.condition !== undefined &&
          options.condition !== 'service_started'
        ) {
          warnings.push({
            message: `depends_on condition "${String(options.condition)}" is ignored; services start in order only.`,
            service: name,
            key: 'depends_on'
          })
        }
      }
    } else {
      errors.push({
        message: 'depends_on must be a list or a map.',
        service: name,
        key: 'depends_on'
      })
    }
  }

  const command = commandValue(value.command)
  if (command === null) {
    errors.push({ message: 'command must be a string or a list.', service: name, key: 'command' })
  }
  const entrypoint = commandValue(value.entrypoint)
  if (entrypoint === null) {
    errors.push({
      message: 'entrypoint must be a string or a list.',
      service: name,
      key: 'entrypoint'
    })
  }

  const stringOption = (key: string): string | undefined => {
    if (value[key] === undefined) return undefined
    const text = scalar(value[key])
    if (text === null) {
      errors.push({ message: `${key} must be a string.`, service: name, key })
      return undefined
    }
    return text
  }

  return {
    name,
    image,
    build: build ?? undefined,
    containerName,
    environment: [...envMap].map(([key, value]) => ({ key, value })),
    ports,
    volumes,
    dependsOn,
    command: command ?? undefined,
    entrypoint: entrypoint ?? undefined,
    workingDir: stringOption('working_dir'),
    user: stringOption('user'),
    platform: stringOption('platform')
  }
}

function orderServices(services: ComposeService[], errors: ComposeError[]): ComposeService[] {
  const byName = new Map(services.map((service) => [service.name, service]))
  const state = new Map<string, 'visiting' | 'done'>()
  const ordered: ComposeService[] = []
  const stack: string[] = []

  const visit = (name: string): void => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(name)), name].join(' → ')
      errors.push({ message: `Dependency cycle: ${cycle}`, service: name, key: 'depends_on' })
      return
    }
    const service = byName.get(name)
    if (!service) return
    state.set(name, 'visiting')
    stack.push(name)
    for (const dependency of service.dependsOn) {
      if (!byName.has(dependency)) {
        errors.push({
          message: `Service ${name} depends on unknown service ${dependency}.`,
          service: name,
          key: 'depends_on'
        })
        continue
      }
      visit(dependency)
    }
    stack.pop()
    state.set(name, 'done')
    ordered.push(service)
  }

  for (const service of services) visit(service.name)
  return ordered
}

export function parseComposeFile(file: string, opts: ComposeParseOptions = {}): ComposeParseResult {
  const errors: ComposeError[] = []
  const warnings: ComposeWarning[] = []
  if (!file) return { ok: false, errors: [{ message: 'Choose a compose file.' }] }

  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          message: `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
          file
        }
      ]
    }
  }

  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((error) => ({
        message: error.message.split('\n')[0],
        file,
        line: error.linePos?.[0]?.line
      }))
    }
  }

  const dir = dirname(file)
  const dotenv = readDotenv(join(dir, '.env'))
  const env: Record<string, string | undefined> = { ...dotenv, ...(opts.env ?? process.env) }
  const interpolated = interpolateValue(doc.toJS(), env, errors, '$')
  if (errors.length > 0) return { ok: false, errors }
  if (!isRecord(interpolated)) {
    return { ok: false, errors: [{ message: 'The compose file must contain a mapping.', file }] }
  }

  for (const key of Object.keys(interpolated)) {
    if (TOP_LEVEL_KEYS.has(key) || key.startsWith('x-')) continue
    errors.push({ message: `Unsupported top-level key: ${key}`, key })
  }

  if (interpolated.volumes !== undefined && !isRecord(interpolated.volumes)) {
    errors.push({ message: 'Top-level volumes must be a map.', key: 'volumes' })
  } else if (isRecord(interpolated.volumes)) {
    for (const [volume, options] of Object.entries(interpolated.volumes)) {
      if (isRecord(options) && Object.keys(options).length > 0) {
        warnings.push({
          message: `Volume ${volume}: driver, external and driver_opts settings are not supported; a local volume is used.`,
          key: 'volumes'
        })
      }
    }
  }

  const rawServices = interpolated.services
  if (!isRecord(rawServices) || Object.keys(rawServices).length === 0) {
    return { ok: false, errors: [{ message: 'services must contain at least one service.', file }] }
  }

  const projectName = sanitizeProjectName(
    opts.projectName ??
      (typeof interpolated.name === 'string' && interpolated.name.trim()
        ? interpolated.name
        : basename(dir))
  )

  const namedVolumes = new Set<string>()
  const services: ComposeService[] = []
  const containerNames = new Set<string>()
  for (const [name, value] of Object.entries(rawServices)) {
    const service = parseService(name, value, projectName, dir, env, namedVolumes, errors, warnings)
    if (!service) continue
    if (containerNames.has(service.containerName)) {
      errors.push({
        message: `Two services use the container name ${service.containerName}.`,
        service: name,
        key: 'container_name'
      })
      continue
    }
    containerNames.add(service.containerName)
    services.push(service)
  }

  const ordered = orderServices(services, errors)
  if (errors.length > 0) return { ok: false, errors }

  const project: ComposeProject = {
    name: projectName,
    file,
    dir,
    network: `${projectName}_default`,
    namedVolumes: [...namedVolumes],
    services: ordered,
    warnings
  }
  return { ok: true, project }
}
