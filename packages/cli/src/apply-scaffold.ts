import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import type { ScaffoldFile } from './scaffold-files'

/**
 * L'écriture de `ks scaffold` (s41), transactionnelle comme celle du toggle
 * (`apply.ts`) : le dépôt n'est jamais laissé avec un module à moitié écrit.
 */
export class ScaffoldDirectoryExistsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldDirectoryExistsError'
  }
}

export class ScaffoldWriteError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options)
    this.name = 'ScaffoldWriteError'
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)

    return true
  } catch {
    return false
  }
}

export interface ApplyScaffoldOptions {
  readonly repoRoot: string
  /** Chemin du paquet, relatif à la racine du dépôt (`ScaffoldPlan.packagePath`). */
  readonly packagePath: string
  readonly files: readonly ScaffoldFile[]
}

/**
 * Écrit le squelette, ou rien.
 *
 * Refuse **avant** d'écrire si le dossier du paquet existe déjà — écraser un
 * module existant n'est jamais le bon geste, `ks scaffold` sert à en créer un
 * nouveau. Toute erreur d'écriture retire l'intégralité du dossier créé :
 * aucun fichier à moitié écrit ne doit rester après un échec.
 *
 * Rend la liste des fichiers créés, chemins relatifs à la racine du dépôt —
 * c'est ce que la commande annonce, et ce que le serveur MCP renvoie tel quel
 * (critère 4 : toute opération qui modifie le dépôt dit exactement quels
 * fichiers).
 */
export async function applyScaffold(options: ApplyScaffoldOptions): Promise<readonly string[]> {
  const { repoRoot, packagePath, files } = options
  const packageRoot = join(repoRoot, packagePath)

  if (await exists(packageRoot)) {
    throw new ScaffoldDirectoryExistsError(
      `${packagePath} existe déjà : « ks scaffold » ne l’écrase pas. Rien n’a été créé.`,
    )
  }

  const written: string[] = []

  try {
    for (const file of files) {
      const target = join(packageRoot, file.path)

      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, file.content, 'utf8')
      written.push(relative(repoRoot, target))
    }
  } catch (error) {
    await rm(packageRoot, { recursive: true, force: true })

    throw new ScaffoldWriteError(
      `L’écriture du squelette a échoué : ${
        error instanceof Error ? error.message : String(error)
      }\n${packagePath} a été entièrement retiré ; aucun module n’a été créé.`,
      { cause: error },
    )
  }

  return written.sort()
}
