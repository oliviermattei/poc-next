import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterAll, describe, expect, it } from 'vitest'

import { assertRepositoryClean, DirtyRepositoryError } from './git-guard'

const execFileAsync = promisify(execFile)

/**
 * Un vrai dépôt git jetable : la garde interroge `git status`, pas une
 * doublure — c'est le fait du dépôt qui décide, pas une opinion de ce fichier.
 */
const temporaries: string[] = []

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true })
  }
})

const temporaryRepo = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'ks-git-guard-'))

  temporaries.push(root)
  await execFileAsync('git', ['init', '--quiet'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root })
  await writeFile(join(root, 'tracked.txt'), 'contenu initial\n', 'utf8')
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root })

  return root
}

describe('assertRepositoryClean', () => {
  it('laisse passer un dépôt sans modification', async () => {
    const root = await temporaryRepo()

    await expect(assertRepositoryClean(root)).resolves.toBeUndefined()
  })

  it('refuse en nommant le fichier modifié, un fichier suivi', async () => {
    const root = await temporaryRepo()

    await writeFile(join(root, 'tracked.txt'), 'modifié après coup\n', 'utf8')

    await expect(assertRepositoryClean(root)).rejects.toThrowError(DirtyRepositoryError)
    await expect(assertRepositoryClean(root)).rejects.toThrowError(/tracked\.txt/)
  })

  it('refuse aussi sur un fichier non suivi : l’agent pourrait perdre un travail en cours', async () => {
    const root = await temporaryRepo()

    await writeFile(join(root, 'nouveau.txt'), 'jamais commité\n', 'utf8')

    await expect(assertRepositoryClean(root)).rejects.toThrowError(/nouveau\.txt/)
  })
})
