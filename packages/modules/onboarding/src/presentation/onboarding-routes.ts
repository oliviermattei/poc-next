import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'
import { z } from 'zod'

import type { OnboardingUseCases } from '../application/onboarding-use-cases'
import { ONBOARDING_SCREEN_PATH } from '../domain/onboarding'

/**
 * Les deux routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007). Ce qui n'est pas dans cette liste n'existe pas : le
 * répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * **Les deux sont `authenticated`** : un parcours d'intégration appartient à un
 * compte, et le répartiteur refuse avant d'appeler le gestionnaire — le refus
 * n'atteint ni la règle, ni la base. C'est aussi pourquoi `publicUrls` est
 * vide : rien de ce que ce module sert n'a vocation à être indexé (ADR 054).
 *
 * **La progression lue est toujours celle de la session**, jamais celle d'un
 * identifiant reçu : aucune de ces deux routes n'accepte un `userId`. C'est ce
 * qui rend « aucune donnée d'un autre compte n'est lisible » vrai sans garde à
 * écrire — il n'y a pas de porte par où demander un autre compte
 * (`docs/security.md` §3).
 *
 * **Aucune des deux n'est limitée en débit, et il n'y a pas de « défaut » à
 * dépasser** : `routeIsRateLimited` (`@repo/core`) limite d'office les routes
 * **publiques**, et une route `authenticated` ne l'est que si elle déclare une
 * politique — l'invitation et le téléversement le font, parce qu'une session
 * n'est pas une limite. Ces deux-ci n'en déclarent pas : elles n'engagent
 * aucune ressource chez un tiers, et ce qu'elles écrivent est borné par les
 * étapes que l'application dérive pour ce compte-là.
 *
 * Les deux répondent **303 vers l'écran**, dont l'adresse est une **constante
 * de ce fichier** : aucune redirection n'est pilotée par un paramètre
 * (`docs/security.md` §4). L'écran, lui, renvoie au tableau de bord quand il
 * n'y a plus rien à proposer — les deux conditions sont complémentaires, donc
 * il n'y a pas d'aller-retour possible entre les deux.
 */

const PATHS = {
  continue: '/onboarding/continue',
  skip: '/onboarding/skip',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const onboardingRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * L'étape nommée par la soumission.
 *
 * **Zod à chaque frontière** (`docs/security.md` §4) : une chaîne sans borne
 * serait comparée avant d'être jugée. Un identifiant inconnu n'est pas refusé
 * ici — c'est la règle du `domain` qui le nomme `unknown_step`, avec les
 * étapes réellement proposées sous les yeux.
 */
const SUBMISSION = z.object({ step: z.string().trim().min(1).max(64) })

/** Une entrée que Zod refuse : ni détail, ni chemin, ni nom de champ. */
const invalidRequest = (): Response => Response.json({ error: 'invalid_request' }, { status: 400 })

const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * Le corps d'une soumission, quelle que soit sa forme.
 *
 * Un formulaire natif poste en `application/x-www-form-urlencoded`, un appel
 * programmatique en JSON. Les deux arrivent au même endroit, et Zod valide
 * ensuite — c'est lui la frontière, pas ce décodage.
 */
const submittedBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.json().catch(() => null)
  }

  return await request
    .formData()
    .then((form) => Object.fromEntries(form.entries()))
    .catch(() => null)
}

/** Le retour à l'écran après une écriture. 303 : un rechargement ne repostera pas. */
const backToScreen = (request: Request): Response =>
  new Response(null, {
    status: 303,
    headers: { location: new URL(ONBOARDING_SCREEN_PATH, request.url).toString() },
  })

export interface OnboardingRouteService {
  readonly useCases: OnboardingUseCases
}

export function createOnboardingRoutes(
  service: () => OnboardingRouteService,
): readonly ModuleRoute[] {
  const clearing = (path: string, intent: 'continue' | 'skip'): ModuleRoute => ({
    method: 'POST',
    path,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const parsed = SUBMISSION.safeParse(await submittedBody(request))

      if (!parsed.success) {
        return invalidRequest()
      }

      const outcome = await service().useCases.clear({
        userId: context.session.userId,
        stepId: parsed.data.step,
        intent,
      })

      if (!outcome.ok) {
        // **Le motif est rendu, le refus est un code.** Une étape obligatoire
        // qu'on tente de passer, ou une étape dont l'exigence n'est pas
        // remplie : les deux sont des règles dites à leur propriétaire, il n'y
        // a rien à lui cacher de son propre parcours.
        return Response.json({ error: outcome.refusal }, { status: 400 })
      }

      return backToScreen(request)
    },
  })

  return [clearing(PATHS.continue, 'continue'), clearing(PATHS.skip, 'skip')]
}
