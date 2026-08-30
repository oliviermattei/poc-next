import { existsSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'

import { config as loadDotenvFile } from 'dotenv'

import type { EnvSource } from './env'

/**
 * Marqueur de la racine du dépôt. Le fichier existe dans le dépôt et nulle part
 * ailleurs : le trouver, c'est être à la racine.
 */
const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

/**
 * Chemin du `.env` unique du dépôt, résolu à l'exécution en remontant depuis un
 * dossier de départ (par défaut celui du processus) jusqu'au marqueur de racine.
 *
 * Trois propriétés, et c'est tout ce que cette forme prétend :
 * - elle trouve la même racine depuis n'importe quel répertoire courant —
 *   `next dev` s'exécute depuis `apps/web`, les scripts de base depuis
 *   `packages/db`, les tests depuis la racine ;
 * - elle ne fige aucun chemin dans un artefact : rien n'est calculé à la
 *   compilation, donc rien ne dépend de l'emplacement du fichier compilé ni du
 *   nombre de `..` qui séparait la source de la racine ;
 * - hors du dépôt (image de production, artefact copié), elle renvoie
 *   `undefined` : il n'y a alors pas de `.env`, et tout vient de
 *   l'environnement.
 *
 * L'alternative statique `new URL('../../..', import.meta.url)` n'a pas été
 * rejetée pour une régression mesurée : elle marche, et perd simplement ces
 * trois propriétés.
 */
export function findRootEnvPath(from: string = process.cwd()): string | undefined {
  // Résolu d'abord : un chemin relatif n'a pas de racine (`parse('a/b').root`
  // vaut `''`) et `dirname('.')` vaut `'.'`. La remontée ci-dessous ne
  // s'arrêterait jamais.
  let current = resolve(from)
  const { root } = parse(current)

  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) {
      return join(current, '.env')
    }

    if (current === root) {
      return undefined
    }

    current = dirname(current)
  }
}

export interface LoadRootEnvOptions {
  /** Fichier à charger. Défaut : le `.env` de la racine du dépôt. */
  readonly path?: string
  /** Dossier de départ de la recherche de la racine. Défaut : `process.cwd()`. */
  readonly from?: string
  /** Cible à alimenter. Défaut : `process.env`. */
  readonly target?: EnvSource
}

/**
 * Charge le `.env` racine dans l'environnement du processus.
 *
 * Le dépôt n'a qu'un seul fichier d'environnement, à la racine — celui que
 * `.env.example` demande de copier. Tout ce qui en a besoin le charge d'ici :
 * l'application Next comme les scripts de base de données.
 *
 * Deux règles, dans cet ordre :
 * - une variable déjà présente dans l'environnement l'emporte sur le fichier
 *   (un `DATABASE_URL` exporté, en CI ou en production, ne doit jamais être
 *   écrasé par un fichier local) ;
 * - un fichier absent n'est pas une erreur : en déploiement, tout vient de
 *   l'environnement et il n'y a pas de `.env`.
 */
export function loadRootEnv(options: LoadRootEnvOptions = {}): void {
  const path = options.path ?? findRootEnvPath(options.from)

  if (path === undefined) {
    return
  }

  loadDotenvFile({
    path,
    processEnv: (options.target ?? process.env) as Record<string, string>,
    override: false,
    quiet: true,
  })
}
