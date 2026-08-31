import { buildRegistry } from '@repo/core'

import { availableModules, enabledModules, requiredModules } from '../../../config/features'
import { appLocales } from '../../../config/i18n'

/**
 * Le registre de l'application, construit une fois au chargement.
 *
 * C'est le point de composition de l'**application** — l'autre est
 * `packages/db/src/scripts/`, pour la génération et l'application des
 * migrations. Le registre lui-même ne connaît pas `config/features.ts` : il
 * reçoit la configuration, ce qui permet aux tests d'en construire d'autres et
 * à la modularité d'être vérifiable ailleurs que dans l'état où le dépôt se
 * trouve.
 *
 * La validation a lieu ici, à l'import : un requis manquant, un cycle ou une
 * collision de route empêchent l'application de démarrer, en nommant les
 * modules en cause. Une configuration incohérente ne doit pas se découvrir au
 * premier appel d'une route.
 */
export const moduleRegistry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
  required: [...requiredModules],
  // Les locales du projet : c'est contre elles qu'un template d'email ou un
  // libellé de navigation incomplet est refusé, et non contre celles du module
  // qui les déclare (revue de s06).
  locales: [...appLocales],
})
