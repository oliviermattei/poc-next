import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { writeEnabledModules } from './features-file'

/**
 * L'écriture du toggle, et sa seule promesse : **le dépôt n'est jamais laissé
 * entre deux états** (`docs/reliability.md` §2).
 *
 * La commande touche trois choses — `config/features.ts`, les barils générés,
 * et éventuellement la base. En faire deux sur trois puis échouer livre un dépôt
 * que la CI rejette, sans que l'utilisateur sache quoi restaurer. D'où l'ordre :
 * photographier les artefacts, écrire la configuration, régénérer, et **tout
 * remettre** au premier échec.
 *
 * La base n'entre pas dans cette transaction, et c'est délibéré : les migrations
 * sont *proposées*, jamais appliquées d'office (`src/commands.ts`). Rien n'est
 * donc à défaire de ce côté quand la régénération échoue.
 */
export class RegenerationFailedError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options)
    this.name = 'RegenerationFailedError'
  }
}

interface DirectorySnapshot {
  readonly path: string
  readonly existed: boolean
  readonly files: ReadonlyMap<string, Buffer>
}

const listFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name)

      return entry.isDirectory() ? listFiles(full) : [full]
    }),
  )

  return nested.flat()
}

/**
 * Le contenu exact d'un dossier d'artefacts, en mémoire.
 *
 * Un dossier absent est photographié comme absent : le restaurer voudra dire le
 * supprimer, et non le laisser tel que la régénération l'a créé.
 */
const snapshotDirectory = async (path: string): Promise<DirectorySnapshot> => {
  try {
    const files = await listFiles(path)
    const contents = await Promise.all(
      files.map(async (file) => [relative(path, file), await readFile(file)] as const),
    )

    return { path, existed: true, files: new Map(contents) }
  } catch {
    return { path, existed: false, files: new Map() }
  }
}

const restoreDirectory = async (snapshot: DirectorySnapshot): Promise<void> => {
  await rm(snapshot.path, { recursive: true, force: true })

  if (!snapshot.existed) {
    return
  }

  await mkdir(snapshot.path, { recursive: true })

  for (const [name, content] of snapshot.files) {
    const target = join(snapshot.path, name)

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}

export interface ApplyToggleOptions {
  readonly featuresPath: string
  /** La liste `enabledModules` telle qu'elle doit être écrite. */
  readonly nextEnabled: readonly string[]
  /** Dossiers d'artefacts générés, restaurés à l'identique en cas d'échec. */
  readonly generatedPaths: readonly string[]
  /**
   * Régénération des barils — `pnpm db:generate` en production.
   *
   * Elle n'est pas facultative : la garde de divergence de s04 compare le baril
   * versionné à `config/features.ts`. Un toggle qui ne régénère pas livre un
   * dépôt rouge à chaque usage de la commande la plus courante du produit.
   */
  readonly regenerate: () => Promise<void>
}

export async function applyToggle(options: ApplyToggleOptions): Promise<void> {
  const original = await readFile(options.featuresPath, 'utf8')
  const next = writeEnabledModules(original, options.nextEnabled)
  const snapshots = await Promise.all(options.generatedPaths.map(snapshotDirectory))

  await writeFile(options.featuresPath, next, 'utf8')

  try {
    await options.regenerate()
  } catch (error) {
    await writeFile(options.featuresPath, original, 'utf8')

    for (const snapshot of snapshots) {
      await restoreDirectory(snapshot)
    }

    throw new RegenerationFailedError(
      `La régénération a échoué : ${error instanceof Error ? error.message : String(error)}\n` +
        'config/features.ts et les barils générés ont été remis dans leur état d’origine ; aucun module n’a été basculé.',
      { cause: error },
    )
  }
}
