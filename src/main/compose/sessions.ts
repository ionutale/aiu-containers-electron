import type { ComposeParseOptions, ComposeParseResult, ComposeProject } from '../../shared/compose'
import { parseComposeFile } from './parse'

/**
 * Keeps the last successfully parsed project so Stop/Down/Logs still work
 * after the file is deleted or edited into an invalid state.
 */
export class ComposeSessions {
  private byFile = new Map<string, ComposeProject>()
  private byName = new Map<string, ComposeProject>()

  remember(project: ComposeProject): void {
    this.byFile.set(project.file, project)
    this.byName.set(project.name, project)
  }

  inspect(file: string, opts: ComposeParseOptions = {}): ComposeParseResult {
    const parsed = parseComposeFile(file, opts)
    if ('project' in parsed) this.remember(parsed.project)
    return parsed
  }

  /**
   * The project that was actually started is the one Stop/Down/Logs must
   * target. Prefer the cached descriptor; only parse when nothing is known
   * (e.g. after an app restart).
   */
  resolve(file: string, projectName?: string): ComposeProject | null {
    const cached = (projectName ? this.byName.get(projectName) : undefined) ?? this.byFile.get(file)
    if (cached) return cached
    const parsed = parseComposeFile(file, { projectName })
    if ('project' in parsed) {
      this.remember(parsed.project)
      return parsed.project
    }
    return null
  }
}
