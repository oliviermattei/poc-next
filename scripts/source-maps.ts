import { readdir, readFile, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadRootEnv } from '@repo/config/server'

import {
  planRelease,
  readReleaseCredentials,
  releaseFilesUrl,
  resolveNextRoot,
  type SourceMapPlanEntry,
} from './source-maps-rules'

/**
 * **`pnpm sourcemaps:release` et `pnpm sourcemaps:prune`** (s39, critère 1).
 *
 * Deux gestes, une seule règle, et la séparation n'est pas cosmétique :
 *
 * - **release** envoie les cartes au fournisseur **puis** élague celles qui
 *   seraient servies. Elle **refuse** sans identifiants, en les nommant : c'est
 *   une commande de déploiement, et sauter l'envoi en silence livrerait des
 *   traces minifiées sans que rien ne le dise ;
 * - **prune** n'élague, et n'a besoin d'aucun secret. C'est ce que le
 *   `Dockerfile` appelle, parce qu'un jeton passé à un build d'image resterait
 *   dans une couche. L'image ne peut donc jamais embarquer une carte servie
 *   publiquement, que quelqu'un ait pensé à l'envoi ou non.
 *
 * L'ordre est imposé : envoyer d'abord, élaguer ensuite. L'inverse enverrait un
 * ensemble amputé — c'est-à-dire exactement la moitié qui rend une trace
 * navigateur lisible.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * Le dossier des cartes — celui du dépôt, ou celui que la recette désigne.
 *
 * L'image rejoue son propre `pnpm build` : envoyer les cartes de l'hôte
 * publierait des empreintes de chunks qui ne sont pas celles qui sont servies.
 * `docs/deployment.md` décrit l'extraction ; la règle vit dans
 * `source-maps-rules.ts`, où elle se prouve.
 */
const NEXT_ROOT = resolveNextRoot(process.env, join(REPO_ROOT, 'apps/web/.next'))
const SENTRY_HOST = process.env.SENTRY_UPLOAD_HOST ?? 'https://sentry.io'
const UPLOAD_TIMEOUT_MS = 30_000

/**
 * Toutes les cartes présentes sous `.next`, chemins relatifs à ce dossier.
 *
 * Le parcours ne trie pas : c'est `planRelease` qui **retient** les seuls
 * dossiers dont une carte concerne le produit (`isReleasableMap`). Mesuré en
 * revue : 326 fichiers `.map` sous `.next`, dont 25 chunks navigateur — le reste
 * étant l'outillage du bundler et la recopie de la sortie autonome.
 */
const collectMaps = async (directory: string): Promise<string[]> => {
  const found: string[] = []

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const child = join(current, entry.name)

      if (entry.isDirectory()) {
        await walk(child)
      } else if (entry.name.endsWith('.map')) {
        found.push(relative(directory, child).replaceAll('\\', '/'))
      }
    }
  }

  await walk(directory)

  return found.sort()
}

const upload = async (entry: SourceMapPlanEntry, url: string, token: string): Promise<void> => {
  const body = new FormData()
  body.append('name', entry.artifact)
  body.append(
    'file',
    new Blob([await readFile(join(NEXT_ROOT, entry.path))]),
    entry.path.split('/').at(-1) ?? 'map',
  )

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, UPLOAD_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body,
      signal: controller.signal,
    })

    // 409 : l'artefact est déjà là sous ce nom de version. C'est le rejeu, et il
    // ne doit produire aucun effet supplémentaire (`docs/reliability.md` §1).
    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Envoi refusé pour ${entry.artifact} : ${String(response.status)} ${response.statusText}`,
      )
    }
  } finally {
    clearTimeout(timer)
  }
}

const main = async (): Promise<void> => {
  loadRootEnv()

  const pruneOnly = process.argv.includes('--prune-only')
  const plan = planRelease(NEXT_ROOT, await collectMaps(NEXT_ROOT))

  if (!pruneOnly) {
    const credentials = readReleaseCredentials(process.env)
    const url = releaseFilesUrl(credentials, SENTRY_HOST)

    for (const entry of plan.uploads) {
      await upload(entry, url, credentials.token)
    }

    console.info(
      `[sourcemaps] ${String(plan.uploads.length)} carte(s) envoyée(s) sous ` +
        `la version ${credentials.release}.`,
    )
  }

  for (const entry of plan.prunes) {
    await rm(join(NEXT_ROOT, entry.path), { force: true })
  }

  console.info(
    `[sourcemaps] ${String(plan.prunes.length)} carte(s) élaguée(s) du dossier servi ` +
      'publiquement ; les cartes serveur restent en place, elles ne sont jamais servies.',
  )
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
