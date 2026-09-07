import {
  MODULE_ROUTE_PREFIX,
  type ModuleRoute,
  type ModuleRouteContext,
  type NavigationEntry,
} from '@repo/core'

import { parseFeedbackTarget } from '../domain/feedback'
import type { FeedbackService } from '../application/feedback-service'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007). Ce qui n'est pas dans cette liste n'existe pas : le
 * répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage — c'est le critère 6, et
 * `pnpm test:minimal-profile` le mesure sans nommer ce module.
 */

/** L'écran du formulaire. Écrit une fois : deux copies divergeraient. */
export const FEEDBACK_SCREEN_PATH = '/feedback'

const PATHS = { submit: '/feedback/submit', handle: '/feedback/handle' } as const

/**
 * **Le chemin de l'écran du back-office qui lit les retours** (critère 4).
 *
 * Il est écrit **ici**, dans le module qui possède les retours, et pas dans
 * `admin` : c'est la forme de `ADMIN_SUBSCRIPTIONS_SCREEN_PATH` (s37c), et la
 * raison est ADR 067 — l'entrée de navigation du back-office doit **disparaître
 * avec le module qui la porte**. Déclarée chez `admin`, elle survivrait à la
 * coupure de celui-ci et pointerait vers un écran en 404.
 */
export const ADMIN_FEEDBACK_SCREEN_PATH = '/admin/feedback'

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const feedbackRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * **Les clés du catalogue du module**, écrites une fois. Un littéral recopié
 * dans un écran divergerait de la traduction.
 */
export const FEEDBACK_KEYS = {
  title: 'feedback.title',
  description: 'feedback.description',
  categoryLabel: 'feedback.category.label',
  categoryOption: (category: string) => `feedback.category.${category}`,
  messageLabel: 'feedback.message.label',
  messageHint: 'feedback.message.hint',
  success: 'feedback.success',
  invalidCategory: 'feedback.invalid.category',
  invalidMessage: 'feedback.invalid.message',
  unavailable: 'feedback.unavailable',
} as const

/**
 * Le retour à l'écran après soumission, **vers une constante de ce module**.
 *
 * L'origine vient de la requête entrante, le chemin est écrit ici : aucune
 * redirection n'est pilotée par une valeur reçue (`docs/security.md` §4). 303 et
 * non 302 : la méthode devient un `GET`, donc un rechargement ne renvoie pas le
 * formulaire — c'est ce qui rend la soumission rejouable sans effet
 * supplémentaire du point de vue du navigateur.
 */
const seeOther = (request: Request, path: string): Response =>
  new Response(null, {
    status: 303,
    headers: { location: new URL(path, request.url).toString() },
  })

const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * **La soumission vient-elle d'un formulaire natif ?** — la même question, et
 * la même réponse, que dans le back-office (`admin-routes.ts`).
 *
 * Elle décide de la **forme de la réponse**, jamais de l'autorisation : un
 * navigateur qui poste un formulaire doit repartir sur un écran (303), un
 * appelant programmatique attend un corps. Elle reconnaît ce que la requête
 * **annonce être**, jamais ce qu'elle n'annonce pas : un appelant JSON qui omet
 * l'en-tête — ce que la spécification permet — reste un appelant JSON.
 */
const isFormSubmission = (request: Request): boolean => {
  const declared = request.headers.get('content-type') ?? ''

  return declared.includes('form-urlencoded') || declared.includes('multipart/form-data')
}

const submittedBody = async (request: Request): Promise<unknown> =>
  isFormSubmission(request)
    ? await request
        .formData()
        .then((form) => Object.fromEntries(form.entries()))
        .catch(() => null)
    : await request.json().catch(() => null)

export function createFeedbackRoutes(service: () => FeedbackService): readonly ModuleRoute[] {
  return [
    {
      method: 'POST',
      path: PATHS.submit,
      /**
       * **`authenticated`, donc la limitation ne vient pas toute seule.**
       *
       * `routeIsRateLimited` (`@repo/core`) dérive la couverture du registre :
       * **toute** route publique est limitée, qu'elle le déclare ou non, et une
       * route non publique **seulement si elle le demande**. Sans la ligne
       * ci-dessous, cette route ne serait comptée par personne — une session
       * n'est pas une limite, et un compte suffirait à écrire en boucle du
       * texte libre dans la base et à faire partir un email par passage.
       *
       * La politique vit dans `config/security.ts`, avec toutes les autres ;
       * un nom inconnu **refuse le démarrage** en nommant la route
       * (`assertPoliciesCoverRoutes`).
       *
       * **Aucun `subjectField`** : le seau par compte visé se construit à partir
       * d'un champ du corps, et le périmètre d'un retour vient de la
       * **session**. L'y mettre laisserait l'appelant choisir son propre seau,
       * c'est-à-dire aucune limite — la raison exacte qui laisse `dataExport`
       * par appelant seulement.
       */
      protection: { level: 'authenticated' },
      rateLimit: { policy: 'feedback' },
      handler: async (request: Request, context: ModuleRouteContext) => {
        if (context.session === null) {
          // Le répartiteur refuse déjà l'appel anonyme ; sans session ici, c'est
          // le montage qui est cassé, et servir la requête serait pire.
          return notFound()
        }

        const outcome = await service().useCases.submit({
          authorId: context.session.userId,
          body: await submittedBody(request),
        })

        if (!outcome.ok) {
          if (outcome.error === 'invalid_request') {
            return isFormSubmission(request)
              ? seeOther(
                  request,
                  `${FEEDBACK_SCREEN_PATH}?refused=${encodeURIComponent(outcome.field)}`,
                )
              : Response.json({ error: 'invalid_request', field: outcome.field }, { status: 400 })
          }

          return isFormSubmission(request)
            ? seeOther(request, `${FEEDBACK_SCREEN_PATH}?refused=unavailable`)
            : Response.json({ error: 'unavailable' }, { status: 503 })
        }

        return isFormSubmission(request)
          ? seeOther(request, `${FEEDBACK_SCREEN_PATH}?sent=1`)
          : Response.json({ submitted: true })
      },
    },
    {
      /**
       * **Marquer un retour comme traité** (critère 5).
       *
       * `authenticated` comme la soumission — le répartiteur exige une session
       * —, puis la garde du back-office décide. Elle refuse en **404**, jamais
       * en 403 : un 403 confirmerait qu'un écran d'administration des retours
       * existe et que ce compte n'y a pas droit (`docs/security.md` §3).
       *
       * **L'ordre est autorisation, puis validation**, comme aux neuf portes du
       * back-office : l'inverse laisserait un non-superadmin distinguer un corps
       * valide d'un corps invalide, c'est-à-dire apprendre quelque chose de
       * l'écran sans y avoir droit.
       *
       * **Aucune limitation déclarée**, et c'est une décision : elle est
       * réservée aux superadmins, qui sont désignés par la plateforme et
       * comptés — le seau utile n'existe pas ici, alors que la soumission, elle,
       * est ouverte à tout compte.
       */
      method: 'POST',
      path: PATHS.handle,
      protection: { level: 'authenticated' },
      handler: async (request: Request, context: ModuleRouteContext) => {
        if (context.session === null) {
          return notFound()
        }

        /**
         * **La garde du back-office, écrite une seule fois dans le dépôt** et
         * reçue ici par injection (`authorizeBackOffice` des cas d'usage de
         * `admin`) : elle refuse une session **empruntée** avant de juger le
         * rôle, relit le rôle en base, et journalise le refus. Ce module ne la
         * recopie pas — deux copies divergeraient, et la seconde serait celle
         * qui laisse entrer.
         *
         * Elle est **injectée plutôt que la route posée chez `admin`** parce
         * que le critère 6 l'exige : module coupé, **aucune route de retour
         * n'existe**. Une route d'écriture posée chez `admin` survivrait à la
         * coupure de ce module-ci.
         */
        if (
          !(await service().authorizeBackOffice({
            request,
            userId: context.session.userId,
          }))
        ) {
          return notFound()
        }

        const target = parseFeedbackTarget(await submittedBody(request))

        if (target === null) {
          return Response.json({ error: 'invalid_request', reason: 'retour visé manquant' }, {
            status: 400,
          })
        }

        const outcome = await service().useCases.markHandled(target.id)

        if (!outcome.ok) {
          return Response.json({ error: 'unavailable' }, { status: 503 })
        }

        return isFormSubmission(request)
          ? seeOther(request, ADMIN_FEEDBACK_SCREEN_PATH)
          : Response.json({ handled: outcome.handled })
      },
    },
  ]
}

/**
 * **Le déclencheur du widget** (critère 1), et pourquoi c'est une entrée de
 * navigation.
 *
 * Le plan refuse un panneau flottant, et les trois raisons sont mesurées : la
 * politique de sécurité du contenu ne porte `'unsafe-inline'` sur `style-src`
 * **qu'en développement**, donc un élément positionné par attribut `style` est
 * refusé en production et silencieux en développement ; `Dialog` et `Popover`
 * sont déclarés par le design system et **absents** de `packages/ui` ; et la
 * bannière de consentement, posée en surface fixe sans réserver sa place, a
 * intercepté les clics de dix parcours. Le critère dit « accessible depuis le
 * tableau de bord », pas « superposé au tableau de bord ».
 *
 * Déclarée ici, elle est **dérivée du registre** par la coquille applicative :
 * module coupé, elle disparaît sans qu'aucun fichier de `apps/web` ne nomme ce
 * module (ADR 066).
 *
 * `authenticated` pour la même raison que la route : afficher l'entrée d'un
 * écran auquel on n'a pas accès divulgue son existence et promet ce qu'on
 * refusera ensuite.
 */
export const feedbackNavigation: readonly NavigationEntry[] = [
  {
    id: 'feedback',
    href: FEEDBACK_SCREEN_PATH,
    labelKey: 'navigation.feedback',
    order: 40,
    protection: { level: 'authenticated' },
  },
  /**
   * **L'entrée du back-office** (critère 4), déclarée ici et non chez `admin`
   * (ADR 067) : elle doit disparaître avec le module qui la porte, sans quoi
   * elle pointerait vers un écran en 404.
   *
   * `surface: 'admin'` la tient hors de la barre latérale du produit : elle
   * n'est rendue que par les écrans du back-office, déjà derrière la garde de
   * superadmin. Sa `protection` reste déclarée, comme partout — elle n'a pas de
   * défaut sûr.
   */
  {
    id: 'feedback',
    href: ADMIN_FEEDBACK_SCREEN_PATH,
    labelKey: 'navigation.adminFeedback',
    order: 40,
    protection: { level: 'authenticated' },
    surface: 'admin',
  },
]
