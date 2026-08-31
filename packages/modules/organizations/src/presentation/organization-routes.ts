import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'

import type {
  OrganizationOutcome,
  OrganizationsUseCases,
} from '../application/organization-use-cases'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007 et 017). Ce qui n'est pas dans cette liste n'existe pas :
 * le répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * **Les trois sont `authenticated`** : le répartiteur refuse donc avant
 * d'appeler le gestionnaire, et le refus n'atteint ni la règle, ni la base.
 *
 * ## Pourquoi des formulaires natifs, et pas du `fetch`
 *
 * Ces routes répondent **303 vers l'écran**, pas du JSON. C'est ce qui permet
 * aux formulaires de l'écran d'être des `<form method="post">` ordinaires, sans
 * composant client : il n'y a alors aucune fenêtre pré-hydratation à couvrir,
 * puisque la soumission native **est** le chemin nominal (`docs/design-system.md`,
 * § « Avant l'hydratation »).
 *
 * La destination est une **constante de ce fichier**, et son origine vient de
 * la requête entrante : aucune redirection n'est pilotée par un paramètre
 * (`docs/security.md` §4).
 *
 * La protection contre la soumission d'origine tierce est celle du cookie de
 * session, `SameSite=Strict` (module `auth`) : une requête intersite n'emporte
 * pas la session, donc le répartiteur répond 401 avant d'arriver ici.
 */

const PATHS = {
  create: '/organizations/create',
  switch: '/organizations/switch',
  update: '/organizations/update',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const organizationRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/** L'écran du module. Constante : c'est ce qui rend la redirection sûre. */
export const ORGANIZATIONS_SCREEN_PATH = '/organizations'

/**
 * Ce que rend une organisation dont l'appelant n'est pas membre.
 *
 * **404, jamais 403** (`docs/security.md` §3) : un 403 confirmerait que cette
 * organisation existe. La réponse est donc exactement celle d'un identifiant
 * inventé.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * Le corps d'une soumission, quelle que soit sa forme.
 *
 * Un formulaire natif poste en `application/x-www-form-urlencoded`, un appel
 * programmatique en JSON. Les deux arrivent au même endroit, et le `domain`
 * valide ensuite — c'est lui la frontière, pas ce décodage.
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

/**
 * La réponse d'une soumission : un retour à l'écran, avec le motif du refus
 * quand il y en a un.
 *
 * Le motif est un **code**, jamais une phrase : la traduction appartient au
 * catalogue du module, et une chaîne dans une URL serait un texte affiché qui
 * n'en vient pas.
 */
const backToScreen = (request: Request, outcome: OrganizationOutcome): Response => {
  if (outcome.status === 'not_found') {
    return notFound()
  }

  const destination = new URL(ORGANIZATIONS_SCREEN_PATH, request.url)

  if (outcome.status === 'refused') {
    destination.searchParams.set('error', outcome.refusal)
  }

  // 303 et non 302 : la méthode devient un GET, donc un rechargement de l'écran
  // ne renvoie pas le formulaire.
  return new Response(null, { status: 303, headers: { location: destination.toString() } })
}

export function createOrganizationRoutes(
  service: () => { readonly useCases: OrganizationsUseCases },
): readonly ModuleRoute[] {
  const submit = (
    path: string,
    run: (
      useCases: OrganizationsUseCases,
      input: { readonly userId: string; readonly body: unknown },
    ) => Promise<OrganizationOutcome>,
  ): ModuleRoute => ({
    method: 'POST',
    path,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      // Le répartiteur garantit la session sur une route `authenticated` ; ce
      // refus est la ceinture, et il ne coûte rien.
      if (context.session === null) {
        return notFound()
      }

      const outcome = await run(service().useCases, {
        // Le compte vient de la **session**, jamais du corps : aucun chemin ne
        // laisse agir au nom d'un autre (`docs/security.md` §3).
        userId: context.session.userId,
        body: await submittedBody(request),
      })

      return backToScreen(request, outcome)
    },
  })

  return [
    submit(PATHS.create, async (useCases, input) => await useCases.createOrganization(input)),
    submit(PATHS.switch, async (useCases, input) => await useCases.switchOrganization(input)),
    submit(PATHS.update, async (useCases, input) => await useCases.renameOrganization(input)),
  ]
}

/**
 * L'entrée de navigation du module — **une seule, et authentifiée**.
 *
 * C'est elle qui disparaît avec le module, sans qu'aucun composant ne porte de
 * condition. `protection` est lue par `visibleNavigation` : un visiteur anonyme
 * ne la voit pas, parce qu'elle n'est pas rendue.
 */
export const organizationsNavigation: readonly NavigationEntry[] = [
  {
    id: 'organizations',
    href: ORGANIZATIONS_SCREEN_PATH,
    labelKey: 'navigation.organizations',
    order: 20,
    protection: { level: 'authenticated' },
  },
]
