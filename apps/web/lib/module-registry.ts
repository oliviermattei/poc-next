import { buildRegistry } from '@repo/core'

import { availableModules, enabledModules } from '../../../config/features'

/**
 * Le registre de l'application, construit une fois au chargement.
 *
 * C'est le **seul** endroit du dépôt qui lit `config/features.ts`. Le registre
 * lui-même ne connaît pas ce fichier : il reçoit la configuration, ce qui
 * permet aux tests d'en construire d'autres et à la modularité d'être
 * vérifiable ailleurs que dans l'état où le dépôt se trouve.
 *
 * La validation a lieu ici, à l'import : un requis manquant, un cycle ou une
 * collision de route empêchent l'application de démarrer, en nommant les
 * modules en cause. Une configuration incohérente ne doit pas se découvrir au
 * premier appel d'une route.
 */
export const moduleRegistry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
})
