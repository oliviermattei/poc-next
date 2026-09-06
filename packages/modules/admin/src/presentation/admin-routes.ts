import {
  MODULE_ROUTE_PREFIX,
  type ModuleRoute,
  type ModuleRouteContext,
  type NavigationEntry,
} from '@repo/core'

import type { AdminService } from '../application/admin-service'
import { parseAccountTarget } from '../domain/platform-role'
import { parseSessionTarget } from '../domain/back-office'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007). Ce qui n'est pas dans cette liste n'existe pas : le
 * répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * ## Pourquoi `authenticated` et non `role`
 *
 * `RouteProtection.level: 'role'` existe et interroge `ModuleSession.roles`.
 * **Deux des trois raisons de ne pas s'en servir ont disparu avec s56** : cette
 * liste était vide partout — le niveau ne servait donc personne —, et le
 * répartiteur répondait 403, ce qui confirme que le back-office existe. Depuis
 * s56 les rôles de plateforme sont peuplés à chaque résolution de session, et
 * le répartiteur répond 404 à une protection `role` non satisfaite.
 *
 * La troisième raison, elle, tient toujours, et c'est pourquoi ces routes n'ont
 * **pas** été rebasculées ici (s56 s'en interdit explicitement, ce serait une
 * autre story) : la garde du back-office refuse **avant** de juger le rôle une
 * session **empruntée** (s37b1), et elle **journalise** le refus. Un niveau
 * déclaré au contrat ne sait exprimer ni l'un ni l'autre — un superadmin dont
 * on emprunte la session entrerait dans le back-office.
 *
 * Elle relit le rôle en base à chaque requête : le pouvoir suit la ligne, pas
 * le jeton de session (ADR 030). Une révocation mord donc à l'instant, sans
 * reconnexion — ce que la lecture de s56 tient désormais aussi, pour la même
 * raison et par le même moyen.
 *
 * **Ce que cette forme ne cache pas, et il faut le savoir** : un appelant
 * **anonyme** reçoit 401 du répartiteur, comme sur toute route authentifiée du
 * dépôt. L'existence d'un chemin sous `/admin/` se lit donc sans compte — une
 * route `role`, elle, répond 404 même à l'anonyme depuis s56. Ce qui est fermé,
 * et que la story demande, est la distinction entre « ce compte-ci administre »
 * et « ce compte-là n'administre pas » : les deux reçoivent la même réponse
 * qu'une URL inventée.
 *
 * ## L'ordre : autorisation, **puis** validation
 *
 * La garde passe avant Zod, comme aux six portes du module `organizations`
 * (revue de s17, F5). L'inverse laisserait un non-superadmin distinguer un
 * corps valide d'un corps invalide, c'est-à-dire apprendre quelque chose du
 * back-office sans y avoir droit.
 */

const PATHS = {
  grantSuperadmin: '/admin/superadmins/grant',
  revokeSuperadmin: '/admin/superadmins/revoke',
  banAccount: '/admin/accounts/ban',
  unbanAccount: '/admin/accounts/unban',
  startImpersonation: '/admin/impersonation/start',
  stopImpersonation: '/admin/impersonation/stop',
  revokeAccountSession: '/admin/accounts/session/revoke',
  sendPasswordReset: '/admin/accounts/password-reset',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const adminRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * **Ce que reçoit qui n'administre pas** — et c'est la réponse du répartiteur
 * pour une route qui n'existe pas, au corps près.
 *
 * 404, jamais 403 (`docs/security.md` §3) : un 403 confirmerait que le
 * back-office existe et que ce compte n'y a pas droit. Le même refus sert aux
 * deux cas de la story — un compte qui n'est pas superadmin, et une plateforme
 * où aucun superadmin n'est configuré.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * **La soumission vient-elle d'un formulaire natif ?** — la question posée une
 * fois, et les deux décisions qui en dépendent sont dérivées d'elle.
 *
 * Elle décide de la **forme de la réponse**, jamais de l'autorisation : un
 * navigateur qui poste un formulaire doit repartir sur un écran (303), un
 * appelant programmatique attend un corps. Sans cette distinction, le clic sur
 * « Révoquer » laissait la personne devant un document JSON — et rendre du JSON
 * à tout le monde aurait cassé les appelants de `s37b1`.
 *
 * **Elle reconnaît ce que la requête annonce être, jamais ce qu'elle n'annonce
 * pas** (revue de s37b2, constat F10). Elle s'écrivait « tout ce qui n'est pas
 * `application/json` », si bien qu'un appelant JSON omettant l'en-tête — ce que
 * la spécification permet — recevait 400 sur un corps que `s37b1` acceptait, et
 * une redirection à la place de son document. Un navigateur, lui, **annonce
 * toujours** le type d'un formulaire : `application/x-www-form-urlencoded`, ou
 * `multipart/form-data` s'il en portait un fichier. Le sens par défaut est donc
 * « JSON », qui est celui d'avant cette story.
 *
 * Le refus, lui, ne change pas de forme : un non-superadmin reçoit **404**, pas
 * une redirection — sinon la redirection elle-même confirmerait l'existence de
 * l'écran.
 */
const isFormSubmission = (request: Request): boolean => {
  const declared = request.headers.get('content-type') ?? ''

  return declared.includes('form-urlencoded') || declared.includes('multipart/form-data')
}

/**
 * **Le corps d'une soumission, quelle que soit sa forme** (s37b2).
 *
 * Les routes de `s37a` n'étaient appelées que par du code, donc en JSON. Les
 * deux gestes du back-office, eux, sont postés par un `<form method="post">` de
 * l'écran de détail — donc en `application/x-www-form-urlencoded`. Lire
 * uniquement le JSON rendait 400 sur chaque clic, sans que rien ne le dise.
 *
 * Le décodage et la forme de la réponse sortent du **même** prédicat : deux
 * lectures de `content-type` finiraient par diverger, et c'est déjà arrivé ici —
 * l'une nommait le JSON, l'autre nommait son absence.
 *
 * Le `domain` valide ensuite : c'est lui la frontière, pas ce décodage. C'est la
 * forme que `organizations` emploie depuis s15, pour la même raison.
 */
const submittedBody = async (request: Request): Promise<unknown> =>
  isFormSubmission(request)
    ? await request
        .formData()
        .then((form) => Object.fromEntries(form.entries()))
        .catch(() => null)
    : await request.json().catch(() => null)

/**
 * Un retour à l'écran, **vers une constante de ce module**.
 *
 * L'origine vient de la requête entrante, le chemin est écrit ici : aucune
 * redirection n'est pilotée par une valeur reçue (`docs/security.md` §4). 303 et
 * non 302 : la méthode devient un `GET`, donc un rechargement ne renvoie pas le
 * formulaire.
 */
const seeOther = (request: Request, path: string, setCookie?: string): Response =>
  new Response(null, {
    status: 303,
    headers:
      setCookie === undefined
        ? { location: new URL(path, request.url).toString() }
        : {
            location: new URL(path, request.url).toString(),
            'set-cookie': setCookie,
          },
  })

const badRequest = (reason: string): Response =>
  Response.json({ error: 'invalid_request', reason }, { status: 400 })

const conflict = (reason: string): Response =>
  Response.json({ error: 'refused', reason }, { status: 409 })

/**
 * Une réponse qui **pose la session**, et rien d'autre.
 *
 * Le jeton n'est pas dans le corps : il est dans le cookie, `HttpOnly`, formé
 * par le socle. Un jeton rendu à un écran annule `HttpOnly` — c'est la règle
 * que les routes du second facteur appliquent déjà (`auth-routes.ts`).
 */
const withSession = (setCookie: string, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': setCookie },
  })

export function createAdminRoutes(service: () => AdminService): readonly ModuleRoute[] {
  /**
   * La garde, écrite **une fois** : le répartiteur a déjà exigé une session, il
   * reste à savoir si elle administre.
   *
   * Le refus est journalisé — la réponse ne distingue rien, le journal si
   * (`docs/security.md` §7).
   */
  const asSuperadmin = async (
    request: Request,
    context: ModuleRouteContext,
    run: (actorId: string) => Promise<Response>,
  ): Promise<Response> => {
    if (context.session === null) {
      // Le répartiteur refuse déjà l'appel anonyme ; sans session ici, c'est le
      // montage qui est cassé, et servir la requête serait pire que de refuser.
      return notFound()
    }

    // **La règle est écrite une fois**, dans les cas d'usage (s37b2) : les
    // écrans du back-office posent exactement la même question, et deux copies
    // auraient divergé — la seconde étant celle qui laisse entrer. Elle refuse
    // une session **empruntée** avant de juger le rôle (s37b1), relit le rôle en
    // base, journalise le refus, et son échec de lecture est fermé.
    const authorized = await service().useCases.authorizeBackOffice({
      request,
      userId: context.session.userId,
    })

    if (!authorized) {
      return notFound()
    }

    return await run(context.session.userId)
  }

  /** Le corps, lu **après** la garde, et validé par Zod dans le `domain`. */
  const withTarget = async (
    request: Request,
    run: (target: { userId: string; reason: string | null }) => Promise<Response>,
  ): Promise<Response> => {
    const target = parseAccountTarget(await submittedBody(request))

    return target === null ? badRequest('compte visé manquant') : await run(target)
  }

  return [
    {
      method: 'POST',
      path: PATHS.grantSuperadmin,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.grantSuperadmin({
              actorId,
              userId: target.userId,
            })

            return outcome.ok
              ? Response.json({ granted: outcome.granted })
              : badRequest('compte inconnu')
          }),
        ),
    },
    {
      method: 'POST',
      path: PATHS.revokeSuperadmin,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.revokeSuperadmin({
              actorId,
              userId: target.userId,
            })

            // **409, et pas 404** : l'appelant est superadmin, il voit la liste,
            // il connaît la cible. Le refus lui dit ce qui l'empêche — c'est le
            // dernier superadmin — au lieu de lui mentir sur l'existence.
            return outcome.ok ? Response.json({ revoked: true }) : conflict(outcome.error)
          }),
        ),
    },
    {
      method: 'POST',
      path: PATHS.banAccount,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.banAccount({
              actorId,
              userId: target.userId,
              reason: target.reason,
            })

            if (outcome.ok) {
              // Le nombre de sessions révoquées est rendu : c'est ce qui rend
              // « bannir révoque les sessions » observable du back-office.
              return Response.json({ revokedSessions: outcome.revokedSessions })
            }

            // **409 pour le dernier superadmin**, comme à la révocation :
            // l'appelant administre, il connaît la cible, et le refus lui dit
            // ce qui l'empêche plutôt que de lui mentir sur l'existence.
            //
            // `accounts_unavailable` y est **avec** lui (s37b1) : c'est un refus
            // du même garde-fou, prononcé parce que l'état des comptes n'a pas
            // pu être lu. Le rendre en 400 dirait « votre demande est mal
            // formée » d'une panne de lecture, et inviterait à la réessayer
            // autrement.
            if (outcome.error === 'last_superadmin' || outcome.error === 'accounts_unavailable') {
              return conflict(outcome.error)
            }

            // Un compte que le socle ne connaît pas : 404, comme toute
            // ressource dont l'existence n'a pas à être confirmée.
            return outcome.error === 'not_found' ? notFound() : badRequest(outcome.error)
          }),
        ),
    },
    {
      /**
       * **L'emprunt de session** (s37b1) : une élévation de privilège, donc une
       * rotation de session (`docs/security.md` §2). Le corps ne porte que la
       * cible ; le jeton, lui, ne sort que dans un cookie `HttpOnly`.
       */
      method: 'POST',
      path: PATHS.startImpersonation,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.startImpersonation({
              request,
              actorId,
              userId: target.userId,
            })

            if (outcome.ok) {
              return withSession(outcome.setCookie, { impersonating: target.userId })
            }

            // **409 pour un superadmin visé**, comme les autres refus de ce
            // module : l'appelant administre, il connaît la cible.
            return outcome.error === 'unknown_account' ? notFound() : conflict(outcome.error)
          }),
        ),
    },
    {
      /**
       * **La sortie**, et la seule route de ce module qui ne passe pas par la
       * garde de superadmin.
       *
       * Elle ne le peut pas : elle est appelée **depuis la session empruntée**,
       * qui désigne le compte emprunté et que la garde refuse par principe. Son
       * autorisation est le cookie lui-même — porter une session marquée d'un
       * emprunteur est ce qui donne le droit d'y mettre fin, et rien d'autre
       * n'est décidé ici.
       *
       * Module coupé, une impersonation en cours ne peut plus être rendue à la
       * main : elle expire, et le balayage compte son expiration comme une fin.
       */
      method: 'POST',
      path: PATHS.stopImpersonation,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        if (context.session === null) {
          return notFound()
        }

        const outcome = await service().useCases.stopImpersonation({ request })

        if (!outcome.ok) {
          return notFound()
        }

        // **Le bandeau de la coquille poste ici** (s37b2), depuis un formulaire
        // natif : un 200 JSON laisserait la personne devant un document au lieu
        // de la rendre à son propre compte. La session neuve part dans le
        // cookie de la redirection, comme dans celui de la réponse JSON.
        return isFormSubmission(request)
          ? seeOther(request, '/', outcome.setCookie)
          : withSession(outcome.setCookie, { stopped: true })
      },
    },
    {
      method: 'POST',
      path: PATHS.unbanAccount,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.unbanAccount({
              actorId,
              userId: target.userId,
            })

            return outcome.ok
              ? Response.json({ unbanned: true })
              : outcome.error === 'not_found'
                ? notFound()
                : badRequest(outcome.error)
          }),
        ),
    },
    {
      /**
       * **Révoquer une session d'un tiers** (s37b2, critère 3).
       *
       * La révocation est **appliquée côté serveur** (`docs/security.md` §2) :
       * la ligne de session est effacée, et le cookie qui la portait ne désigne
       * plus personne à la requête suivante. Ce n'est pas un bouton qu'on
       * masque.
       *
       * **404 quand rien n'a été révoqué**, et pas 409 : l'identifiant de
       * session est une valeur reçue, et distinguer « pas à ce compte » de
       * « n'existe pas » en ferait un oracle d'appartenance.
       */
      method: 'POST',
      path: PATHS.revokeAccountSession,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) => {
          const target = parseSessionTarget(await submittedBody(request))

          if (target === null) {
            return badRequest('session visée manquante')
          }

          const outcome = await service().useCases.revokeAccountSession({
            actorId,
            userId: target.userId,
            sessionId: target.sessionId,
          })

          if (!outcome.ok) {
            return conflict('accounts_unavailable')
          }

          if (!outcome.revoked) {
            return notFound()
          }

          return isFormSubmission(request)
            ? seeOther(request, `${ADMIN_USERS_SCREEN_PATH}/${target.userId}`)
            : Response.json({ revoked: true })
        }),
    },
    {
      /**
       * **Déclencher une réinitialisation de mot de passe** (s37b2, critère 3).
       *
       * Le corps ne porte qu'un **identifiant** : l'adresse est relue du socle
       * par le point de composition, jamais reçue d'ici. Un back-office qui
       * accepterait une adresse serait un chemin de réinitialisation vers
       * n'importe quelle boîte.
       */
      method: 'POST',
      path: PATHS.sendPasswordReset,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.sendPasswordReset({
              actorId,
              userId: target.userId,
            })

            if (!outcome.ok) {
              return conflict('accounts_unavailable')
            }

            if (!outcome.sent) {
              return notFound()
            }

            return isFormSubmission(request)
              ? seeOther(request, `${ADMIN_USERS_SCREEN_PATH}/${target.userId}`)
              : Response.json({ sent: true })
          }),
        ),
    },
  ]
}

/** Le chemin de l'écran des comptes. Écrit une fois : deux copies divergeraient. */
export const ADMIN_USERS_SCREEN_PATH = '/admin/users'

/**
 * **L'entrée de navigation du back-office** (s37b2), et sa surface.
 *
 * `surface: 'admin'` : elle n'apparaît **pas** dans la barre latérale du
 * produit. Un lien « Administration » visible de tous divulguerait l'existence
 * du back-office à chaque compte connecté. C'est la **surface** qui l'en tient
 * à l'écart, et elle seule : depuis s56, `ModuleSession.roles` porte bien le
 * rôle de plateforme, et une protection `role` sur cette entrée serait donc
 * satisfaite — mais elle ne dirait rien de la session empruntée que la garde du
 * back-office refuse.
 *
 * Elle est rendue par les écrans du back-office eux-mêmes, qui sont déjà
 * derrière la garde. C'est la forme que s31 a établie pour le pied de page : le
 * module qui veut un lien ici le **déclare**, et il disparaît avec lui.
 */
export const adminNavigation: readonly NavigationEntry[] = [
  {
    id: 'users',
    href: ADMIN_USERS_SCREEN_PATH,
    labelKey: 'navigation.users',
    order: 10,
    protection: { level: 'authenticated' },
    surface: 'admin',
  },
]
