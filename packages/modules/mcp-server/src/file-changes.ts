import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Ce que le critère 4 de la story exige des deux outils qui écrivent : « la
 * liste **exacte** des fichiers modifiés ». `ks toggle` (s05) ne le rend pas —
 * son critère à lui s'arrête à annoncer les migrations générées — donc ce
 * fichier vit ici, à côté du serveur MCP, plutôt que dans le moteur partagé de
 * `@repo/cli` : il répond à une exigence propre à cette story, sur les chemins
 * que la commande **connaît déjà** (`config/features.ts`, `generated/schema`,
 * les dossiers de migrations des modules concernés), jamais un chemin fourni
 * par l'appelant.
 */
type FileHashes = ReadonlyMap<string, string>

const hashOf = (buffer: Buffer): string => createHash('sha1').update(buffer).digest('hex')

const listFilesRecursively = async (root: string): Promise<readonly string[]> => {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(root, entry.name)

      return entry.isDirectory() ? listFilesRecursively(full) : [full]
    }),
  )

  return nested.flat()
}

/** Photographie un fichier ou un dossier (récursivement) en chemin → hachage. */
const snapshot = async (path: string): Promise<FileHashes> => {
  const info = await stat(path).catch(() => null)

  if (info === null) {
    return new Map()
  }

  const files = info.isDirectory() ? await listFilesRecursively(path) : [path]
  const entries = await Promise.all(
    files.map(async (file) => [file, hashOf(await readFile(file))] as const),
  )

  return new Map(entries)
}

const snapshotAll = async (paths: readonly string[]): Promise<FileHashes> => {
  const snapshots = await Promise.all(paths.map(snapshot))
  const merged = new Map<string, string>()

  for (const partial of snapshots) {
    for (const [file, hash] of partial) {
      merged.set(file, hash)
    }
  }

  return merged
}

export interface TrackedRun<T> {
  /** Ce que l'action a rendu — le résultat du moteur, transmis tel quel. */
  readonly result: T
  readonly modifiedFiles: readonly string[]
}

/**
 * Exécute `action`, et rend son résultat **avec** la liste exacte des fichiers
 * que `paths` a vu apparaître, disparaître ou changer — chemins relatifs à
 * `repoRoot`, triés.
 *
 * Le résultat de l'action ressort d'ici plutôt que par une variable capturée :
 * l'appelant a besoin des deux, et une variable écrite dans une fermeture
 * oblige à mentir au compilateur sur son initialisation.
 *
 * `paths` peut mélanger fichiers et dossiers : `config/features.ts` est un
 * fichier, `generated/schema` et les dossiers de migrations sont des dossiers.
 * Un chemin absent avant et après ne produit aucune entrée.
 */
export async function trackFileChanges<T>(
  repoRoot: string,
  paths: readonly string[],
  action: () => Promise<T>,
): Promise<TrackedRun<T>> {
  const before = await snapshotAll(paths)

  const result = await action()

  const after = await snapshotAll(paths)
  const changed = new Set<string>()

  for (const [file, hash] of after) {
    if (before.get(file) !== hash) {
      changed.add(file)
    }
  }

  for (const file of before.keys()) {
    if (!after.has(file)) {
      changed.add(file)
    }
  }

  return { result, modifiedFiles: [...changed].map((file) => relative(repoRoot, file)).sort() }
}
