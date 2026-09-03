import { dispatchModuleRequest } from '@repo/core'

import { resolveModuleSession } from '../../../../lib/auth'
import { entitlements } from '../../../../lib/entitlements'
import { moduleRegistry } from '../../../../lib/module-registry'
import { prepareModuleServices } from '../../../../lib/module-services'
import { rateLimitGuard } from '../../../../lib/rate-limit'

/**
 * **Le** point de montage des routes de modules.
 *
 * Un seul fichier de route pour tous les modules, et c'est ce qui donne son sens
 * au critère « un module non activé n'expose aucune route ». L'alternative — un
 * fichier de route par module, qui appellerait `notFound()` quand le module est
 * coupé — laisserait une route exposée : elle figurerait au manifeste de
 * l'application, elle serait servie, et elle répondrait 404 après avoir été
 * atteinte. Ici, la route d'un module non activé n'est dans aucune table : il
 * n'y a rien à atteindre.
 *
 * La **résolution de session** vient du point de composition
 * (`lib/auth.ts`), jamais du registre : `@repo/core` ne connaît aucun module,
 * et le crochet `resolveSession` existe précisément pour que la dépendance
 * aille dans ce sens. Avant s07 il n'était pas fourni, et toute route non
 * publique répondait 401 — c'était le sens fermé, pas un oubli.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handle = (request: Request): Promise<Response> => {
  // Les modules qui persistent reçoivent leur connexion **avant** d'être
  // servis : le répartiteur monte des routes, il ne construit rien. Ce fichier
  // ne nomme aucun module — `lib/module-services.ts` est le pendant de
  // `lib/module-registry.ts`, et c'est lui qui sait qui a besoin de quoi.
  prepareModuleServices()

  return dispatchModuleRequest(moduleRegistry, request, {
    resolveSession: resolveModuleSession,
    // **Le droit d'utiliser une fonctionnalité réservée** (s21, ADR 043), du
    // même côté de la dépendance que la session : `@repo/core` ne sait pas
    // qu'un produit se vend, il reçoit la réponse. Le répartiteur est
    // fail-closed — retirer cette ligne refuse toute route réservée en 403,
    // jamais l'inverse.
    resolveFeatures: entitlements.featuresOf,
    // **La limitation de débit** (s28, ADR 050), du même côté de la dépendance
    // que la session : `@repo/core` ne sait ni compter, ni où sont les seuils.
    // Le répartiteur est fail-closed — retirer cette ligne fait répondre 429 à
    // toute route publique, jamais l'inverse.
    rateLimit: rateLimitGuard(),
  })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
