import {
  MODULE_ROUTE_PREFIX,
  type ModuleRoute,
  type NavigationEntry,
  type RouteRateLimit,
} from '@repo/core'

import type {
  OrganizationOutcome,
  OrganizationsUseCases,
} from '../application/organization-use-cases'
import { INVITATION_SCREEN_PATH } from '../domain/invitation'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007 et 017). Ce qui n'est pas dans cette liste n'existe pas :
 * le répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * **Les neuf sont `authenticated`** : le répartiteur refuse donc avant
 * d'appeler le gestionnaire, et le refus n'atteint ni la règle, ni la base.
 * L'acceptation d'une invitation en fait partie — le jeton autorise l'accès à
 * **une organisation**, il ne remplace pas une session, et un invité sans compte
 * doit d'abord en créer un (critère 2).
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
 * (`docs/security.md` §4) — **à une exception écrite près** : le succès de
 * `switch` revient à l'écran courant, par un champ `next` que filtre
 * `safeReturnPath`, injecté par le point de composition (ADR 076).
 *
 * La protection contre la soumission d'origine tierce est celle du cookie de
 * session, `SameSite=Strict` (module `auth`) : une requête intersite n'emporte
 * pas la session, donc le répartiteur répond 401 avant d'arriver ici.
 */

const PATHS = {
  create: '/organizations/create',
  switch: '/organizations/switch',
  update: '/organizations/update',
  // s16 — l'invitation, son cycle de vie, et le retrait d'un membre.
  invite: '/organizations/invite',
  resendInvitation: '/organizations/invitations/resend',
  revokeInvitation: '/organizations/invitations/revoke',
  acceptInvitation: '/organizations/invitations/accept',
  removeMember: '/organizations/members/remove',
  // s17 — le rôle d'un membre, transfert de propriété compris.
  setMemberRole: '/organizations/members/role',
  // s34 — la suppression de l'organisation. `POST` et non `DELETE` : la route
  // est appelée par un `<form>` autant que par un `fetch`, et un formulaire
  // HTML ne sait émettre que `GET` ou `POST`.
  delete: '/organizations/delete',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const organizationRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * L'écran du module. Constante : c'est ce qui rend la redirection sûre.
 *
 * Dans la zone Réglages depuis s62a (ADR 075) ; l'ancien `/organizations`
 * répond 308 vers lui, par la table de `apps/web/lib/legacy-paths.ts`.
 */
export const ORGANIZATIONS_SCREEN_PATH = '/app/settings/organization'

/**
 * **La rubrique Membres** (s62b) : les membres de l'organisation courante et
 * ses invitations. Séparée de l'écran de l'organisation, avec sa propre entrée.
 */
export const MEMBERS_SCREEN_PATH = '/app/settings/members'

/** Les deux rubriques vers lesquelles une route du module peut revenir. */
type OrganizationScreenPath = typeof ORGANIZATIONS_SCREEN_PATH | typeof MEMBERS_SCREEN_PATH

/**
 * **L'écran d'administration des organisations** (s37b2).
 *
 * Le chemin vit ici, avec le module qui le déclare : c'est ce qui permet à
 * `apps/web` de ne le connaître que par le registre.
 */
export const ADMIN_ORGANIZATIONS_SCREEN_PATH = '/console/organizations'

/**
 * Ce que rend une organisation dont l'appelant n'est pas membre.
 *
 * **404, jamais 403** (`docs/security.md` §3) : un 403 confirmerait que cette
 * organisation existe. La réponse est donc exactement celle d'un identifiant
 * inventé.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * Ce que rend un **membre** dont le rôle ne suffit pas (s17, critère 6).
 *
 * **403, et pas 404** : l'appelant est membre, il voit l'organisation à
 * l'écran, il en connaît l'identifiant — le 404 ne lui cacherait rien et lui
 * mentirait. Le 404 reste pour l'organisation dont on n'est pas membre, où
 * l'existence, elle, doit rester inconnue.
 *
 * **Et pas un 303 vers l'écran** : le déclencheur d'une action interdite est
 * absent de l'interface, donc seul un appel direct arrive ici. Lui rendre une
 * page d'erreur traduite décrirait à l'appelant ce qu'il a raté ; le code suffit.
 */
const forbidden = (): Response => Response.json({ error: 'forbidden' }, { status: 403 })

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
 * La réponse d'une soumission : un retour à la **rubrique de l'action**, avec
 * le motif du refus quand il y en a un.
 *
 * La rubrique est une constante choisie par la route (s62b) : Membres pour
 * l'invitation, son cycle de vie, le rôle et le retrait d'un membre ;
 * Organisation pour le reste. Y revenir ailleurs afficherait le motif d'un refus
 * sous une rubrique qui ne montre pas le formulaire refusé.
 *
 * Le motif est un **code**, jamais une phrase : la traduction appartient au
 * catalogue du module, et une chaîne dans une URL serait un texte affiché qui
 * n'en vient pas.
 */
const backToScreen = (
  request: Request,
  outcome: OrganizationOutcome,
  screen: OrganizationScreenPath,
  /**
   * Le retour d'un **succès**, déjà filtré — la rubrique par défaut. Seule
   * `switch` en fournit un autre (ADR 076) ; un refus revient toujours sur la
   * rubrique, qui montre le formulaire refusé.
   */
  returnPath: string = screen,
): Response => {
  if (outcome.status === 'not_found') {
    return notFound()
  }

  if (outcome.status === 'forbidden') {
    return forbidden()
  }

  const destination = new URL(outcome.status === 'refused' ? screen : returnPath, request.url)

  if (outcome.status === 'refused') {
    destination.searchParams.set('error', outcome.refusal)
  }

  // 303 et non 302 : la méthode devient un GET, donc un rechargement de l'écran
  // ne renvoie pas le formulaire.
  return new Response(null, { status: 303, headers: { location: destination.toString() } })
}

/**
 * Le retour de l'écran d'acceptation, avec le motif du refus.
 *
 * La destination est une **constante du module** (`INVITATION_SCREEN_PATH`), pas
 * un paramètre : `docs/security.md` §4 interdit une redirection pilotée par une
 * valeur reçue. Le jeton est **repassé** parce que l'écran doit pouvoir montrer
 * de quelle invitation il parle et proposer de réessayer ; il est déjà dans les
 * mains de l'appelant, et il n'ouvre rien de plus qu'avant.
 */
const backToInvitation = (
  request: Request,
  token: string,
  outcome: OrganizationOutcome,
): Response => {
  if (outcome.status === 'not_found') {
    return notFound()
  }

  if (outcome.status === 'forbidden') {
    return forbidden()
  }

  const destination = new URL(
    outcome.status === 'ok' ? ORGANIZATIONS_SCREEN_PATH : INVITATION_SCREEN_PATH,
    request.url,
  )

  if (outcome.status === 'refused') {
    destination.searchParams.set('token', token)
    destination.searchParams.set('error', outcome.refusal)
  }

  return new Response(null, { status: 303, headers: { location: destination.toString() } })
}

/**
 * Le champ `next` d'un corps soumis, ou `null`. **Une valeur reçue** : elle ne
 * sert qu'à travers `safeReturnPath` (ADR 076).
 */
const nextOf = (body: unknown): string | null =>
  typeof body === 'object' && body !== null && 'next' in body
    ? typeof (body as { next: unknown }).next === 'string'
      ? (body as { next: string }).next
      : null
    : null

export function createOrganizationRoutes(
  service: () => {
    readonly useCases: OrganizationsUseCases
    /**
     * Le filtre des chemins reçus, **injecté** (ADR 076) : `safeRedirectPath`
     * du module `auth`, que ce fichier n'a pas le droit d'importer
     * (`docs/security.md` §7).
     */
    readonly safeReturnPath: (candidate: string | null | undefined, fallback: string) => string
  },
): readonly ModuleRoute[] {
  const submit = (
    path: string,
    /**
     * La rubrique où revient l'action — une constante, jamais un paramètre. Un
     * refus y revient toujours ; seul le succès de `switch` peut aller ailleurs,
     * par `returnTo` (ADR 076).
     */
    screen: OrganizationScreenPath,
    run: (
      useCases: OrganizationsUseCases,
      input: { readonly userId: string; readonly body: unknown },
    ) => Promise<OrganizationOutcome>,
    /**
     * **Une session n'est pas une limite** (s28, critère 2).
     *
     * Le répartiteur limite d'office toute route **publique** ; une route
     * authentifiée ne l'est que si elle le demande. L'invitation le demande :
     * chaque passage envoie un email vers une adresse que l'appelant choisit,
     * et un compte légitime suffit à en arroser mille. Le seau par compte visé
     * borne ce qu'une même adresse peut recevoir, toutes organisations
     * confondues.
     */
    rateLimit?: RouteRateLimit,
    /**
     * **Le retour d'un succès, lu dans le corps** (s62c, ADR 076) — `switch`
     * seule. Absent : la rubrique. Ce qu'il rend doit déjà être filtré.
     */
    returnTo?: (body: unknown) => string,
  ): ModuleRoute => ({
    method: 'POST',
    path,
    protection: { level: 'authenticated' },
    ...(rateLimit === undefined ? {} : { rateLimit }),
    handler: async (request, context) => {
      // Le répartiteur garantit la session sur une route `authenticated` ; ce
      // refus est la ceinture, et il ne coûte rien.
      if (context.session === null) {
        return notFound()
      }

      const body = await submittedBody(request)
      const outcome = await run(service().useCases, {
        // Le compte vient de la **session**, jamais du corps : aucun chemin ne
        // laisse agir au nom d'un autre (`docs/security.md` §3).
        userId: context.session.userId,
        body,
      })

      return backToScreen(request, outcome, screen, returnTo?.(body) ?? screen)
    },
  })

  /**
   * L'acceptation, seule route dont le retour n'est pas l'écran des
   * organisations : un refus ramène l'invité **là où il était**, avec le motif.
   * Le renvoyer sur un écran d'organisations qu'il ne peut pas voir n'aurait
   * aucun sens.
   */
  const acceptRoute: ModuleRoute = {
    method: 'POST',
    path: PATHS.acceptInvitation,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const body = await submittedBody(request)
      const outcome = await service().useCases.acceptInvitation({
        userId: context.session.userId,
        body,
      })
      const token =
        typeof body === 'object' && body !== null && 'token' in body
          ? String((body as { token: unknown }).token)
          : ''

      return backToInvitation(request, token, outcome)
    },
  }

  return [
    submit(
      PATHS.create,
      ORGANIZATIONS_SCREEN_PATH,
      async (useCases, input) => await useCases.createOrganization(input),
    ),
    submit(
      PATHS.switch,
      ORGANIZATIONS_SCREEN_PATH,
      async (useCases, input) => await useCases.switchOrganization(input),
      undefined,
      // **L'écran courant** (critère 2 de s62c) : le sélecteur de la barre du
      // haut poste le chemin où il est affiché. Filtré ici, avant d'être posé
      // dans l'en-tête `Location` — un chemin refusé ou absent revient à la
      // rubrique Organisation, comme avant (ADR 076).
      (body) => service().safeReturnPath(nextOf(body), ORGANIZATIONS_SCREEN_PATH),
    ),
    submit(
      PATHS.update,
      ORGANIZATIONS_SCREEN_PATH,
      async (useCases, input) => await useCases.renameOrganization(input),
    ),
    submit(
      PATHS.invite,
      MEMBERS_SCREEN_PATH,
      async (useCases, input) => await useCases.inviteMember(input),
      { policy: 'invitation', subjectField: 'email' },
    ),
    submit(
      PATHS.resendInvitation,
      MEMBERS_SCREEN_PATH,
      async (useCases, input) => await useCases.resendInvitation(input),
      { policy: 'invitation' },
    ),
    submit(
      PATHS.revokeInvitation,
      MEMBERS_SCREEN_PATH,
      async (useCases, input) => await useCases.revokeInvitation(input),
    ),
    acceptRoute,
    submit(
      PATHS.removeMember,
      MEMBERS_SCREEN_PATH,
      async (useCases, input) => await useCases.removeMember(input),
    ),
    submit(
      PATHS.delete,
      ORGANIZATIONS_SCREEN_PATH,
      async (useCases, input) => await useCases.deleteOrganization(input),
    ),
    submit(
      PATHS.setMemberRole,
      MEMBERS_SCREEN_PATH,
      async (useCases, input) => await useCases.setMemberRole(input),
    ),
  ]
}

/**
 * Les entrées de navigation du module — **authentifiées**, deux rubriques des
 * réglages (Organisation et Membres, s62b) et une entrée de la console.
 *
 * Ce sont elles qui disparaissent avec le module, sans qu'aucun composant ne porte de
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
    // La sous-navigation des réglages (s62a) : la barre latérale reste celle
    // du produit construit.
    surface: 'settings',
  },
  {
    id: 'members',
    href: MEMBERS_SCREEN_PATH,
    labelKey: 'navigation.members',
    order: 25,
    protection: { level: 'authenticated' },
    surface: 'settings',
  },
  {
    /**
     * **L'entrée du back-office** (s37b2), déclarée **ici** et pas là-bas.
     *
     * C'est ce qui la fait disparaître avec ce module sans qu'aucun fichier du
     * back-office ne nomme `organizations` : le registre n'agrège que les
     * modules activés, et la navigation de la surface `console` en est dérivée.
     * Écrite en dur dans un écran d'administration, elle aurait nommé ce module
     * dans `apps/web` — puis le suivant au même endroit, ce que s31 a corrigé
     * pour le pied de page (ADR 066).
     */
    id: 'admin-organizations',
    href: ADMIN_ORGANIZATIONS_SCREEN_PATH,
    labelKey: 'navigation.adminOrganizations',
    order: 20,
    protection: { level: 'authenticated' },
    surface: 'console',
  },
]
