import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'

import type { PublicFormOutcome, PublicFormsUseCases } from '../application/public-forms'
import { clientIdentifierOf } from '../domain/rate-limit'

/**
 * Les deux routes des formulaires publics, **énumérées une par une**.
 *
 * C'est le registre qui possède les routes (ADR 007 et 017) : chaque point
 * d'entrée est déclaré, avec son chemin exact, sa méthode et son niveau de
 * protection. Module coupé, ces chemins ne sont dans aucune table et le
 * répartiteur répond 404 sans jamais atteindre ce fichier — c'est le critère 4
 * de la story, obtenu sans qu'une ligne ne nomme un module.
 *
 * `POST` seulement : ces deux soumissions changent un état serveur. Un `GET`
 * qui écrit est une faute d'HTTP autant qu'une porte ouverte à la requête
 * intersite.
 */

const PATHS = {
  contact: '/marketing/contact',
  newsletter: '/marketing/newsletter',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const marketingRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * Le corps d'une requête, qu'elle vienne d'un `fetch` ou d'un `<form>`.
 *
 * Les deux formulaires postent en JSON, mais un navigateur sans JavaScript
 * enverrait `application/x-www-form-urlencoded` : lire les deux coûte trois
 * lignes et évite qu'une soumission dégradée arrive comme un corps illisible.
 * Un corps illisible vaut `null`, que le domaine refusera.
 */
const submittedBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData().catch(() => null)

    return form === null ? null : Object.fromEntries(form.entries())
  }

  return await request.json().catch(() => null)
}

/** La langue que la requête déclare, ou `null`. Rien n'est deviné, rien n'est cru. */
const submittedLocale = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) {
    return null
  }

  const locale = (body as { locale?: unknown }).locale

  // Elle n'est **pas** validée ici : `emailLocaleFor` la confronte aux langues
  // réellement servies et retombe sur celle du site. Une locale hostile ne peut
  // donc que se faire ignorer.
  return typeof locale === 'string' ? locale : null
}

/**
 * Le statut HTTP d'une issue.
 *
 * `accepted` couvre l'inscription faite, le doublon et la soumission piégée :
 * **le même 200, le même corps**. C'est ce que `docs/security.md` §7 exige d'un
 * formulaire public — pas d'énumération, aucune information exploitable dans la
 * réponse.
 */
const respond = (outcome: PublicFormOutcome): Response => {
  if (outcome.status === 'invalid') {
    return Response.json({ status: 'invalid', field: outcome.field }, { status: 400 })
  }

  if (outcome.status === 'rate-limited') {
    return Response.json({ status: 'rate_limited' }, { status: 429 })
  }

  if (outcome.status === 'mail-failed') {
    // 502 : le fournisseur n'a pas pris le message. L'écran propose de
    // réessayer ; la réponse ne dit **rien** du fournisseur ni de l'erreur
    // qu'il a rendue (`docs/security.md` §5).
    return Response.json({ status: 'mail_failed' }, { status: 502 })
  }

  return Response.json({ status: 'accepted' }, { status: 200 })
}

/**
 * Les routes, construites autour d'un **accès différé** au service.
 *
 * Le contrat de module est une valeur, construite au chargement de
 * `config/features.ts` — donc par `pnpm ks list` et `pnpm db:generate`, qui
 * n'ont ni base ni mailer. Rien n'est donc résolu avant qu'une requête n'arrive.
 */
export function createPublicFormRoutes(
  service: () => { readonly useCases: PublicFormsUseCases },
): readonly ModuleRoute[] {
  const handle = async (
    request: Request,
    run: (
      useCases: PublicFormsUseCases,
      submission: { body: unknown; client: string; locale: string | null },
    ) => Promise<PublicFormOutcome>,
  ): Promise<Response> => {
    const body = await submittedBody(request)

    return respond(
      await run(service().useCases, {
        body,
        client: clientIdentifierOf(request.headers),
        locale: submittedLocale(body),
      }),
    )
  }

  return [
    {
      method: 'POST',
      path: PATHS.contact,
      protection: { level: 'public' },
      rateLimit: { policy: 'publicForm' },
      handler: async (request) =>
        await handle(request, async (useCases, submission) =>
          await useCases.submitContact(submission),
        ),
    },
    {
      method: 'POST',
      path: PATHS.newsletter,
      protection: { level: 'public' },
      rateLimit: { policy: 'publicForm' },
      handler: async (request) =>
        await handle(request, async (useCases, submission) =>
          await useCases.subscribeToNewsletter(submission),
        ),
    },
  ]
}
