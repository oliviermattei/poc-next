import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * **La copie de l'arbre de travail, une seule fois pour les trois recettes**
 * (s68).
 *
 * `pnpm test:socle`, `pnpm test:minimal-profile` et `pnpm test:golden-path`
 * travaillent dans un clone local : `git clone` ne connaît que `HEAD`, et sur
 * une branche en cours d'écriture il mesurerait le code d'avant. Ce que le poste
 * n'a pas encore commité est donc recopié par-dessus.
 *
 * ## Contre `HEAD`, jamais contre l'index
 *
 * Le clone part de `HEAD` : la différence à recopier est donc celle de l'arbre
 * **à `HEAD`**. La première version — trois copies d'une même fonction, une par
 * recette — lisait `git ls-files --modified`, qui compare l'arbre à l'**index** :
 * un renommage indexé par `git mv`, une suppression indexée ou une modification
 * indexée sans reste dans l'arbre n'y paraissaient pas, et la recette testait un
 * arbre qui n'était pas celui du poste (observé en parallèle sur s62a et s67).
 *
 * `git diff --name-status --no-renames HEAD` rend chaque fichier suivi qui
 * diffère de `HEAD`, indexé ou non ; `--no-renames` réduit un renommage à une
 * suppression plus un ajout, les deux gestes que la copie sait faire.
 * `git ls-files --others --exclude-standard` ajoute les non suivis, hors
 * ignorés — `node_modules`, `.env`, `.next` ne sont jamais recopiés.
 *
 * Les deux lectures sont en `-z` : un chemin porteur d'un espace ou d'un
 * caractère non ASCII serait sinon rendu entre guillemets, et recopié sous un
 * nom qui n'existe pas.
 *
 * `tests/working-tree.test.ts` construit un dépôt temporaire portant chacune de
 * ces formes et compare la copie à l'arbre.
 */

const gitEntries = (cwd: string, args: readonly string[]): string[] =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter((entry) => entry.length > 0)

export interface WorkingTreeChanges {
  /** Les fichiers à recopier : ajoutés, modifiés, non suivis — et le nouveau nom d'un renommage. */
  readonly copied: readonly string[]
  /** Les fichiers à supprimer du clone — dont l'ancien nom d'un renommage. */
  readonly removed: readonly string[]
}

/** Ce qui sépare l'arbre de travail de `source` de son `HEAD`. */
export function workingTreeChanges(source: string): WorkingTreeChanges {
  const status = gitEntries(source, ['diff', '--name-status', '--no-renames', '-z', 'HEAD'])
  const copied: string[] = []
  const removed: string[] = []

  // En `-z`, chaque entrée est une paire : la lettre d'état, puis le chemin.
  for (let index = 0; index + 1 < status.length; index += 2) {
    const letter = status[index] ?? ''
    const file = status[index + 1] ?? ''

    ;(letter === 'D' ? removed : copied).push(file)
  }

  copied.push(...gitEntries(source, ['ls-files', '--others', '--exclude-standard', '-z']))

  return { copied, removed }
}

/**
 * Clone `source` dans `destination`, **puis y recopie son arbre de travail** :
 * le clone porte alors exactement les fichiers du poste, ignorés exclus.
 */
export function cloneWorkingTree(input: {
  readonly source: string
  readonly destination: string
}): WorkingTreeChanges {
  execFileSync(
    'git',
    ['clone', '--quiet', '--local', '--no-hardlinks', input.source, input.destination],
    { cwd: input.source, stdio: 'inherit' },
  )

  const changes = workingTreeChanges(input.source)

  for (const file of changes.removed) {
    rmSync(join(input.destination, file), { force: true })
  }

  for (const file of changes.copied) {
    mkdirSync(dirname(join(input.destination, file)), { recursive: true })
    cpSync(join(input.source, file), join(input.destination, file))
  }

  return changes
}

/** La ligne que chaque recette journalise après le clone. */
export const cloneReport = (changes: WorkingTreeChanges): string =>
  changes.copied.length === 0 && changes.removed.length === 0
    ? 'Clone local de HEAD, arbre propre : aucun fichier recopié par-dessus.'
    : `Clone local de HEAD, plus l’arbre de travail : ${changes.copied.length} fichier(s) ` +
      `recopié(s), ${changes.removed.length} supprimé(s).`
