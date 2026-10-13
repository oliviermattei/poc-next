import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * The clean-repository guard (where it applies and why: `packages/cli/AGENTS.md`).
 *
 * It is scoped to the paths the operation writes: a change elsewhere in the
 * tree is the developer's work in progress, which the operation never touches,
 * so it no longer blocks an agent mid-ticket. A change inside those paths is a
 * conflict: the write would mix with uncommitted work and `git checkout` could
 * no longer undo one without the other.
 *
 * `ks toggle` does not set it: a human typing the command sees what they do.
 * It is set where the CLI writes **on behalf of an agent**: the two MCP tools
 * that modify the repository, and `ks scaffold`.
 *
 * `git status --porcelain` is queried, never reimplemented.
 */
export class DirtyRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirtyRepositoryError'
  }
}

const execFileAsync = promisify(execFile)

/**
 * Refuses if any of `paths` (files or directories, absolute or relative to
 * `cwd`) has uncommitted changes, tracked or not. Read-only: called by the
 * caller **before** any write.
 */
export async function assertRepositoryClean(
  cwd: string,
  paths: readonly string[],
): Promise<void> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', ...paths], {
    cwd,
  })
  const files = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (files.length > 0) {
    throw new DirtyRepositoryError(
      `Les fichiers que l’opération écrit ont des modifications non commitées, elle est refusée ` +
        `pour que vous puissiez toujours annuler : ${files.map((line) => `« ${line} »`).join(', ')}. ` +
        'Commitez ou remisez-les, puis relancez.',
    )
  }
}
