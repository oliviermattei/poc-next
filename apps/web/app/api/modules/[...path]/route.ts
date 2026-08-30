import { dispatchModuleRequest } from '@repo/core'

import { moduleRegistry } from '../../../../lib/module-registry'

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
 * Aucune session n'est résolue tant que l'authentification n'existe pas (s07) :
 * le répartiteur refuse donc toute route non publique. C'est le sens fermé —
 * une route protégée n'est pas servie faute de savoir qui appelle, plutôt que
 * servie faute de vérification.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const handle = (request: Request): Promise<Response> =>
  dispatchModuleRequest(moduleRegistry, request)

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
