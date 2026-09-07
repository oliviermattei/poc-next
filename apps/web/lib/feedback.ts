import { getDatabase } from '@repo/db'
import {
  feedbackModule,
  feedbackRoutePath,
  provideFeedback,
  requireFeedbackService,
  ADMIN_FEEDBACK_SCREEN_PATH,
  FEEDBACK_CATEGORIES,
  FEEDBACK_SCREEN_PATH,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
} from '@repo/module-feedback'

import { appAuth } from './auth'
import { localeRouting } from './locale-routing'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition des retours (s43) — le même modèle que
 * `lib/notifications.ts`, `lib/marketing.ts` et `lib/storage.ts`.
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/module-feedback`, et le seul qui regarde si ce module est monté.
 * Ailleurs — la coquille applicative, le back-office — on lit une **donnée**,
 * jamais un identifiant de module :
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/feedback` | le formulaire | **404** |
 * | entrée de navigation | présente (authentifiée), dérivée du registre | absente |
 * | `POST /api/modules/feedback/submit` | écrit, puis annonce | **404** au répartiteur |
 * | écran `/admin/feedback` | la liste | **404** |
 * | requêtes en base | celles de l'écran | **aucune** |
 */

/** Le module est-il monté ? **Une donnée**, lue par les écrans. */
const mounted = moduleRegistry.moduleIds.includes(feedbackModule.id)

/**
 * **L'annonce d'un nouveau retour** (critère 3) — et ce que la story n'a pas
 * eu à construire.
 *
 * Le repli « centre de notifications s'il est activé, email sinon » est **déjà
 * livré** par `lib/notifications.ts` : il est décidé **par la valeur**
 * (`centre === null`), jamais par une condition sur un nom de module, et
 * `config/notifications.ts` déclare `feedback.received` avec `email: true` par
 * défaut, ce qui est exactement ce qui fait partir l'email quand le centre
 * n'existe pas. Ce fichier **appelle**, il ne réimplémente rien.
 *
 * Les destinataires sont **relus**, pas dérivés de l'événement : ce sont les
 * superadmins de la plateforme, que seul le module `admin` connaît. C'est aussi
 * pourquoi `feedback` le déclare dans ses `requires` — sans back-office,
 * personne ne lit les retours et personne n'est à prévenir.
 *
 * **Les imports sont différés**, pour la raison des autres points de
 * composition : `lib/notifications.ts` et `lib/admin.ts` importent
 * `lib/auth.ts`, et un import statique en sens inverse fermerait le cycle.
 *
 * **Aucune donnée personnelle dans la charge** (revue s32, R1) : la ligne du
 * centre survit à l'effacement de son auteur, alors que le contrat de ce
 * module promet `retention: 'erase'`. Elle ne porte donc que la catégorie ; le
 * message se lit dans le back-office, à sa source.
 */
const announceFeedback = async (input: {
  readonly feedbackId: string
  readonly category: FeedbackCategory
}): Promise<void> => {
  const { admin } = await import('./admin')
  const { emitNotification } = await import('./notifications')
  const recipients = await admin.superadminIds()

  for (const userId of recipients) {
    const account = await appAuth().useCases.viewAccount(userId)

    if (account === null) {
      continue
    }

    await emitNotification({
      type: 'feedback.received',
      recipient: {
        userId,
        email: account.email,
        // Un destinataire dont rien n'est connu reçoit la langue **du site** :
        // il n'a pas de requête, donc pas de préférence. La règle est celle du
        // module `auth`, appliquée ici sans le détour.
        locale: localeRouting.defaultLocale,
      },
      organizationId: null,
      data: { category: input.category },
      // **`stored`, jamais `data`** : ce qui est écrit se relit après que les
      // comptes nommés ont disparu. Ici les deux coïncident parce que la charge
      // ne porte **aucune** donnée personnelle — c'est le but.
      stored: { category: input.category },
    })
  }
}

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * Le répartiteur prépare les services à chaque requête, y compris celles
 * qu'aucune route ne satisfait : construire aussitôt ouvrirait une connexion
 * pour répondre 404 sur un chemin inconnu (mesuré en s15).
 */
const provide = (): void => {
  provideFeedback(() => ({
    db: getDatabase().db,
    announce: announceFeedback,
    /**
     * **L'organisation que l'auteur a sous les yeux** (critère 2).
     *
     * Le module ne connaît pas `organizations` — il ne le requiert pas, et le
     * produit doit rester utilisable en mode mono-utilisateur. Module coupé, la
     * réponse est `null` **sans toucher la base**, et aucune condition ne nomme
     * un module ici : `organizations.activeOrganizationId` est déjà cette
     * donnée. C'est la forme que `lib/notifications.ts` emploie pour son
     * périmètre de lecture.
     */
    activeOrganizationOf: async (userId) =>
      await (await import('./organizations')).organizations.activeOrganizationId(userId),
    /**
     * **La garde du back-office, empruntée et jamais recopiée** (critère 5).
     *
     * C'est la fonction unique de `admin` — celle que ses neuf routes et ses
     * cinq écrans traversent déjà. Le module qui possède les retours ne saurait
     * pas l'écrire : il ne connaît ni le rôle de plateforme, ni l'emprunt de
     * session que cette garde refuse **avant** de juger le rôle.
     *
     * Elle est **fermée module coupé** — `admin.authorizeBackOffice` rend
     * `false` sans toucher la base —, ce qui est le sens sûr : un `true` par
     * défaut ouvrirait cette route à tout compte connecté dans la configuration
     * où plus rien ne peut le refuser. Le cas ne devrait pas se produire,
     * `feedback` déclarant `admin` dans ses requis ; la garde ne s'appuie pas
     * sur cette déclaration pour être fermée.
     *
     * L'import est **différé** : `lib/admin.ts` lit ce fichier-ci pour son port
     * de lecture, et un import statique en sens inverse fermerait le cycle.
     */
    authorizeBackOffice: async (input) =>
      await (await import('./admin')).admin.authorizeBackOffice(input),
  }))
}

const feedbackService = () => {
  provide()

  return requireFeedbackService()
}

/** Une ligne de retour, telle que le back-office la lit. */
export interface FeedbackEntry {
  readonly id: string
  readonly authorId: string
  readonly category: string
  readonly message: string
  readonly originPath: string | null
  readonly status: string
  readonly createdAt: Date
  readonly handledAt: Date | null
}

export interface FeedbackFeature {
  /**
   * Le module est-il monté ? **Une donnée**, lue par les écrans pour décider
   * s'ils existent — pas un `if (module activé)` de plus dans l'application.
   */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, **sans rien construire**. */
  readonly prepare: () => void
  /**
   * Une page de retours pour le back-office, **filtrée au plus bas**. Vide et
   * immuable module coupé, **sans requête**.
   */
  readonly list: (input: {
    readonly category: string | null
    readonly status: string | null
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }) => Promise<
    | { readonly ok: true; readonly feedback: readonly FeedbackEntry[]; readonly total: number }
    | { readonly ok: false }
  >
  /**
   * **Les vocabulaires du filtre**, tels que le module les déclare.
   *
   * Ils sont donnés au back-office plutôt que dérivés des lignes : une
   * catégorie que personne n'a encore employée doit apparaître dans le filtre,
   * sans quoi l'écran cache un choix possible. C'est la différence avec les
   * sources d'inscription de s37c, qui sont ouvertes et se lisent en base.
   *
   * Vides module coupé : le back-office n'a alors aucun écran à rendre.
   */
  readonly categories: readonly string[]
  readonly statuses: readonly string[]
}

const ABSENT_FEEDBACK: FeedbackFeature = {
  available: false,
  prepare: () => {},
  list: () => Promise.resolve({ ok: false }),
  categories: [],
  statuses: [],
}

export const feedback: FeedbackFeature = mounted
  ? {
      available: true,
      prepare: provide,
      list: async (input) => await feedbackService().useCases.list(input),
      categories: [...FEEDBACK_CATEGORIES],
      statuses: [...FEEDBACK_STATUSES],
    }
  : ABSENT_FEEDBACK

/** Ce que les écrans ont le droit de connaître du module : ses chemins. */
export { ADMIN_FEEDBACK_SCREEN_PATH, FEEDBACK_SCREEN_PATH, feedbackRoutePath }
