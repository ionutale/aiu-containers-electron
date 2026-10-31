import type { ComposeProject, ComposeService } from '../../shared/compose'
import type { BuildRequest } from '../../shared/types'
import { runCli } from '../container-cli/cli'

export interface RunPlanOptions {
  /** The runtime understands `--network name,alias=service`. */
  supportsNetworkAliases?: boolean
}

export function projectLabels(
  project: ComposeProject,
  service: ComposeService
): { key: string; value: string }[] {
  return [
    { key: 'com.aiu.compose.project', value: project.name },
    { key: 'com.aiu.compose.service', value: service.name },
    { key: 'com.aiu.compose.file', value: project.file }
  ]
}

export function imageTag(project: ComposeProject, service: ComposeService): string {
  return service.image ?? `${project.name}-${service.name}`
}

export function buildRequest(project: ComposeProject, service: ComposeService): BuildRequest | null {
  if (!service.build) return null
  return {
    contextDir: service.build.context,
    dockerfilePath: service.build.dockerfile,
    tag: imageTag(project, service),
    buildArgs: service.build.args,
    target: service.build.target,
    noCache: false,
    platform: service.build.platform
  }
}

export function runArgv(
  project: ComposeProject,
  service: ComposeService,
  opts: RunPlanOptions = {}
): string[] {
  const args = ['run', '-d', '--name', service.containerName]
  const network = opts.supportsNetworkAliases
    ? `${project.network},alias=${service.name}`
    : project.network
  args.push('--network', network)

  for (const label of projectLabels(project, service)) {
    args.push('--label', `${label.key}=${label.value}`)
  }
  for (const item of service.environment) {
    args.push('-e', `${item.key}=${item.value}`)
  }
  for (const port of service.ports) {
    args.push('-p', port.raw)
  }
  for (const mount of service.volumes) {
    args.push('-v', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`)
  }
  if (service.workingDir) args.push('-w', service.workingDir)
  if (service.user) args.push('-u', service.user)
  if (service.platform) args.push('--platform', service.platform)

  const entrypoint = service.entrypoint ?? []
  if (entrypoint.length > 0) args.push('--entrypoint', entrypoint[0])

  args.push(imageTag(project, service))
  args.push(...entrypoint.slice(1), ...(service.command ?? []))
  return args
}

export function hasAliasSupport(helpText: string): boolean {
  return /--network[^\n]*alias=|alias=/.test(helpText)
}

/** Probe once per call site; the CLI's help is the only capability signal. */
export async function detectNetworkAliasSupport(
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const result = await runCli(['run', '--help'], { env, timeoutMs: 5000 })
  return result.code === 0 && hasAliasSupport(result.stdout)
}
