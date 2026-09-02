import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'
import { z } from 'zod'

import type { ConsentUseCases } from '../application/consent-use-cases'
import { CONSENT_INTENTS, type ConsentSubmission } from '../domain/consent-category'
import { isSameSiteSubmission, safeReturnPath } from '../domain/request-guard'

/**
 * La route du consentement — **une seule**, et elle est `POST`.
 *
 * Enregistrer un choix change un état ; un `GET` qui écrit est une faute d'HTTP
 * autant qu'une porte ouverte à la requête intersite. Elle est `public` : un
 * visiteur anonyme a exactement le même droit qu'un compte, et c'est la moitié
 * de la conformité.
 *
 * Elle répond **303** plutôt que 302 : la soumission est un `POST`, et 303 est
 * le seul code qui garantisse que le navigateur suive en `GET`. C'est ce qui
 * fait que recharger la page d'arrivée ne repose pas le choix.
 */

const PATHS = { decide: '/consent/decide' } as const

/** Le chemin public de la route, préfixe de montage compris. */
export const consentRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * Le corps de la soumission — Zod à la frontière (`docs/security.md` §4).
 *
 * `decision` est l'intention, `category` la liste des cases cochées. Un
 * navigateur envoie une entrée `category` par case, d'où `getAll`. Ce qui n'est
 * pas une intention connue est refusé : il vaut mieux un 400 muet qu'une
 * décision devinée.
 */
const submissionSchema = z.object({
  decision: z.enum(CONSENT_INTENTS),
  categories: z.array(z.string()),
})

/** Aucun détail : ni la raison exacte, ni ce que le produit déclare (§7 du socle). */
const refuse = (status: number): Response =>
  Response.json({ error: 'invalid_request' }, { status })

/**
 * Le corps d'une requête, qu'elle vienne d'un `<form>` ou d'un `fetch`.
 *
 * Le formulaire de la bannière est **natif** : son corps arrive en
 * `application/x-www-form-urlencoded`, et c'est le chemin qui doit marcher sans
 * JavaScript. Le JSON est accepté pour la même raison que dans `marketing` :
 * il ne coûte rien et évite qu'un appelant programmatique arrive en corps
 * illisible.
 */
const submittedFields = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData().catch(() => null)

    if (form === null) {
      return null
    }

    return {
      decision: form.get('decision'),
      categories: form.getAll('category').filter((value) => typeof value === 'string'),
    }
  }

  const body: unknown = await request.json().catch(() => null)

  if (typeof body !== 'object' || body === null) {
    return null
  }

  const { decision, categories } = body as { decision?: unknown; categories?: unknown }

  return { decision, categories: Array.isArray(categories) ? categories : [] }
}

export function createConsentRoutes(
  service: () => { readonly useCases: ConsentUseCases },
): readonly ModuleRoute[] {
  return [
    {
      method: 'POST',
      path: PATHS.decide,
      protection: { level: 'public' },
      handler: async (request) => {
        // **La garde d'origine passe avant tout le reste** : une soumission
        // inter-site poserait un consentement au nom du visiteur, et un
        // consentement forgé est pire qu'un refus perdu. Rien n'est lu, rien
        // n'est écrit, aucun cookie ne part.
        if (
          !isSameSiteSubmission({
            origin: request.headers.get('origin'),
            referer: request.headers.get('referer'),
            requestUrl: request.url,
          })
        ) {
          return refuse(403)
        }

        const parsed = submissionSchema.safeParse(await submittedFields(request))

        if (!parsed.success) {
          return refuse(400)
        }

        const submission: ConsentSubmission = {
          intent: parsed.data.decision,
          categories: parsed.data.categories,
        }

        const { setCookie } = service().useCases.record(submission)

        return new Response(null, {
          status: 303,
          headers: {
            // Le retour est la page d'où le visiteur vient, **réduite à un
            // chemin** : une redirection pilotée par un en-tête que l'appelant
            // contrôle ne doit jamais pouvoir sortir du site.
            location: safeReturnPath(request.headers.get('referer'), '/'),
            'set-cookie': setCookie,
          },
        })
      },
    },
  ]
}
