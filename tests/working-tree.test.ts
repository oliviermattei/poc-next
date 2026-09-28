import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { cloneWorkingTree } from '../scripts/working-tree'

/**
 * **La copie de l'arbre de travail que les trois recettes éprouvent** (s68).
 *
 * `pnpm test:socle`, `pnpm test:minimal-profile` et `pnpm test:golden-path`
 * clonent `HEAD`, puis recouvrent le clone de ce que le poste n'a pas encore
 * commité. La première version comparait l'arbre à l'**index**
 * (`ls-files --modified`) : un renommage indexé par `git mv`, ou une
 * modification indexée sans reste dans l'arbre, n'y paraissait pas, et la
 * recette testait alors un arbre qui n'était pas celui du poste.
 *
 * Le cas éprouvé ici réunit donc **chaque forme** qu'un arbre en cours
 * d'écriture prend — renommage indexé, suppression indexée, modification
 * indexée, modification non indexée, fichier non suivi, fichier ignoré — dans un
 * dépôt **temporaire** : le dépôt courant n'est jamais touché (les recettes
 * refusent un arbre qu'elles auraient modifié).
 */

const git = (cwd: string, args: readonly string[]): void => {
  execFileSync(
    'git',
    ['-c', 'user.name=Recette', '-c', 'user.email=recette@example.test', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  )
}

const write = (root: string, file: string, content: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), content, 'utf8')
}

/** Chaque fichier sous `root`, `.git` exclu, avec son contenu. */
const snapshot = (root: string): Record<string, string> => {
  const files: Record<string, string> = {}

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) {
        if (entry.name !== '.git') walk(path)
        continue
      }

      files[relative(root, path)] = readFileSync(path, 'utf8')
    }
  }

  walk(root)

  return files
}

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

describe('la copie reproduit l’arbre de travail, pas l’index', () => {
  it('recopie renommage, suppression et modifications indexés, non indexés et non suivis', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'arbre-de-travail-'))
    workspaces.push(workspace)

    const source = join(workspace, 'source')
    const destination = join(workspace, 'copie')

    mkdirSync(source)
    git(source, ['init', '--quiet'])
    write(source, '.gitignore', 'ignore.log\n')
    write(source, 'ancien-nom.ts', 'export const renomme = 1\n')
    write(source, 'supprime.ts', 'export const supprime = 1\n')
    write(source, 'indexe.ts', 'export const indexe = 1\n')
    write(source, 'dossier/non-indexe.ts', 'export const nonIndexe = 1\n')
    write(source, 'intact.ts', 'export const intact = 1\n')
    git(source, ['add', '.'])
    git(source, ['commit', '--quiet', '-m', 'initial'])

    // **Chaque forme d'un arbre en cours d'écriture.** Les trois premières sont
    // indexées sans reste dans l'arbre : `ls-files --modified`, qui compare à
    // l'index, ne les voit pas.
    git(source, ['mv', 'ancien-nom.ts', 'dossier/nouveau-nom.ts'])
    git(source, ['rm', '--quiet', 'supprime.ts'])
    write(source, 'indexe.ts', 'export const indexe = 2\n')
    git(source, ['add', 'indexe.ts'])
    write(source, 'dossier/non-indexe.ts', 'export const nonIndexe = 2\n')
    write(source, 'non-suivi.ts', 'export const nonSuivi = 1\n')
    write(source, 'ignore.log', 'jamais recopié\n')

    cloneWorkingTree({ source, destination })

    const expected = snapshot(source)

    // Un fichier ignoré n'est jamais recopié — c'est `node_modules`, `.env` ou
    // `.next` sur le vrai dépôt.
    delete expected['ignore.log']

    expect(snapshot(destination)).toEqual(expected)
  })
})

/**
 * **Une seule copie de l'arbre, et c'est celle-ci.** La première version en
 * avait trois, une par recette, et le défaut de l'une était celui des trois.
 * Une recette qui clonerait ou lirait l'arbre de travail de son côté
 * échapperait au cas ci-dessus.
 */
describe('les recettes n’ont pas leur propre copie de l’arbre', () => {
  it('aucun script, hors du module commun, ne clone le dépôt ni ne lit son arbre par `ls-files`', () => {
    const scripts = fileURLToPath(new URL('../scripts', import.meta.url))
    const offenders = readdirSync(scripts)
      .filter((file) => file.endsWith('.ts') && file !== 'working-tree.ts')
      .filter((file) => {
        const source = readFileSync(join(scripts, file), 'utf8')

        return /'ls-files',\s*'--modified'/.test(source) || /'clone',\s*'--local'/.test(source)
      })

    expect(offenders).toEqual([])
  })
})
