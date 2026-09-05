import type { ModuleRegistry, ModuleSession } from '@repo/core'
import { getDatabase } from '@repo/db'
import {
  createNotificationEmitter,
  createNotificationTypeRegistry,
  type NotificationCentre,
  type NotificationEmitter,
} from '@repo/emails'
import {
  notificationRoutePath,
  notificationsModule,
  NOTIFICATIONS_KEYS,
  provideNotifications,
  requireNotificationsService,
  EMPTY_NOTIFICATIONS_VIEW,
  NOTIFICATIONS_SCREEN_PATH,
  type NotificationScope,
  type NotificationsView,
  type NotificationTypeSummary,
} from '@repo/module-notifications'

import { appAuth } from './auth'
import { appLocales } from '../../../config/i18n'
import { appNotificationTypes } from '../../../config/notifications'
import { createAppMailer } from './mailer'
import { moduleRegistry } from './module-registry'
import { organizations } from './organizations'

/**
 * Le point de composition des notifications (s32, ADR 057) — le septième du
 * même modèle, après `lib/mailer.ts`, `lib/auth.ts`, `lib/locale-routing.ts`,
 * `lib/marketing.ts`, `lib/organizations.ts` et `lib/storage.ts`.
 *
 * Il tient **trois choses que le module ne peut pas tenir** :
 *
 * 1. le **registre de types**, construit depuis `config/notifications.ts` et
 *    les locales de l'application. Il est du socle : un type déclaré existe que
 *    le module soit activé ou non, sans quoi le repli du critère 7 n'aurait
 *    plus rien à replier ;
 * 2. le **catalogue de rendu** de l'émission — les templates des modules
 *    activés **plus** ceux des types déclarés. Le mailer que les modules
 *    reçoivent, lui, ne porte que les premiers : un module qui enverrait
 *    `notification.<type>` directement obtient `invalid_request`, à
 *    l'exécution, en production comprise (critère 6). Ce qui le tient :
 *    `tests/notifications.test.ts`, « refuse à l'exécution un template de
 *    notification envoyé par le mailer des modules » ;
 * 3. le **centre**, ou son absence. `null` quand le registre ne contient pas le
 *    module : c'est ce qui fait du repli une **absence**, et non une condition
 *    disséminée dans le code appelant.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/notifications` | l'écran | **404** |
 * | entrée de navigation | présente (authentifiée) | absente |
 * | `emitNotification` | in-app + email selon les préférences | **envoi email direct pour les types qui le veulent par défaut**, rien pour les autres |
 * | requêtes en base | celles de l'écran | **aucune** |
 */
export const notificationTypes = createNotificationTypeRegistry({
  types: [...appNotificationTypes],
  locales: [...appLocales],
})

/**
 * Ce que le module a besoin de savoir d'un type : ses canaux et ses défauts.
 *
 * **C'est ici que les deux unions de canaux se rencontrent** : celle de
 * `@repo/emails` (le socle) et celle du `domain` du module, qui ne peut pas
 * importer `@repo/emails` — la frontière de couches le lui interdit (ADR 006).
 * Une divergence entre les deux ne compile pas.
 */
export const notificationTypeSummaries: readonly NotificationTypeSummary[] =
  notificationTypes.types.map((type) => ({
    id: type.id,
    channels: type.channels,
    defaults: type.defaults,
    actors: type.actors,
  }))

/** Le module est-il monté ? **Une donnée**, lue par l'écran pour décider s'il existe. */
const mounted = moduleRegistry.moduleIds.includes(notificationsModule.id)

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * C'est ici que la **connexion** est donnée au module — il ne dépend pas de
 * `@repo/db` et ne va pas la chercher (ADR 020) —, ainsi que le catalogue de
 * types et le périmètre de lecture, que lui non plus ne peut pas connaître.
 */
const provide = (): void => {
  provideNotifications(() => ({
    db: getDatabase().db,
    types: notificationTypeSummaries,
    /**
     * **Le périmètre de lecture d'un compte** : lui, et **l'organisation qu'il
     * a sous les yeux** — pas toutes celles dont il est membre.
     *
     * Le module ne connaît pas `organizations` — il ne le requiert pas, et le
     * produit doit rester utilisable en mode mono-utilisateur. L'appartenance
     * lui est donc **donnée** ici. Module `organizations` coupé, la liste est
     * vide et seules les notifications de compte existent, **sans toucher la
     * base**.
     *
     * **La restriction à l'organisation active est une décision** (revue s32,
     * ronde 2, R2 — le commentaire promettait ici « les organisations dont il
     * est membre », ce que le code n'a jamais fait). Deux raisons :
     *
     * 1. **la cohérence du produit** — tout le reste de l'application montre
     *    l'organisation active. Une ligne « Ada a rejoint Acme » lue pendant
     *    qu'on travaille chez Globex nomme un périmètre où l'écran ne peut rien
     *    faire ;
     * 2. **le coût** — la pastille est relue à **chaque** rendu du shell, pour
     *    chaque compte connecté. `activeOrganizationId` est une requête ;
     *    énumérer les appartenances passe par `organizations.view`, qui en fait
     *    trois à quatre. C'est le chemin le plus chaud de l'application.
     *
     * **Ce qu'elle coûte, et il faut le lire** : un membre de A prévenu pendant
     * qu'il travaille dans B ne voit ni la ligne ni la pastille tant qu'il n'a
     * pas rebasculé. **Rien n'est perdu** — la ligne est écrite, elle réapparaît
     * au retour —, mais elle est retardée. Le jour où ce délai gêne, la
     * correction est d'élargir **ici**, en payant la lecture des appartenances,
     * pas de toucher au module : `isVisibleTo` accepte déjà une liste.
     *
     * **Ce qui est tenu, et ce qui ne l'est pas.** La composition de la liste
     * est mesurée depuis la ronde 3 — `tests/notifications.test.ts`, « donne au
     * module l'organisation active, et une liste vide quand il n'y en a pas » :
     * la rendre vide sans condition rendait chaque notification du seul
     * producteur livré invisible à tout le monde, et laissait 2258 cas au vert
     * (R3-2). Ce qui reste une **décision écrite, que rien ne mesure**, c'est le
     * choix entre l'organisation active et toutes les appartenances : les deux
     * compositions passeraient ce cas-là.
     */
    scopeOf: async (userId) =>
      notificationScopeOf(userId, await organizations.activeOrganizationId(userId)),
    /**
     * **Les noms affichables, résolus à la lecture** (revue s32, R1).
     *
     * Le module stocke des références de compte parce qu'une ligne survit aux
     * gens qu'elle nomme : elle est adressée à quelqu'un d'autre, et
     * `purge({kind:'user'})` n'efface que ce qui est adressé au compte. Une
     * adresse écrite dans la charge utile serait donc encore lisible après
     * l'effacement — c'est le défaut que ce résolveur remplace.
     *
     * C'est **ici** que le nom est cherché, et pas dans le module : celui-ci ne
     * connaît pas la forme d'un compte, exactement comme il ne connaît pas les
     * organisations. Un identifiant absent de la réponse est un compte effacé,
     * et l'écran y met son propre libellé.
     *
     * La liste reçue est **dédoublonnée et bornée par la page** (vingt lignes),
     * et elle est vide dès qu'aucun type de la page ne déclare d'acteur.
     */
    displayNamesOf,
  }))
}

/**
 * **Le périmètre de lecture, dérivé de l'organisation active** — la fonction que
 * `scopeOf` applique.
 *
 * Nommée et exportée pour être mesurable : dans la fermeture, la mutation
 * « rendre `organizationIds: []` » — qui rend invisible à tout le monde chaque
 * notification du seul producteur livré — laissait 2258 cas au vert (revue s32,
 * ronde 3, R3-2).
 */
export const notificationScopeOf = (
  userId: string,
  activeOrganizationId: string | null,
): NotificationScope => ({
  userId,
  organizationIds: activeOrganizationId === null ? [] : [activeOrganizationId],
})

/**
 * **Les noms affichables des comptes qu'une page nomme** — la fonction que le
 * module reçoit.
 *
 * Nommée et exportée pour la même raison : dans la fermeture, remplacer
 * `account.name` par `account.email` posait l'adresse de l'arrivant sur l'écran
 * de tous les autres membres — la moitié visible du défaut que R1 ferme — et
 * laissait la suite entièrement verte (revue s32, ronde 3, R3-1).
 *
 * **Une seule lecture pour N identifiants** (R3-3) : `viewAccounts` passe par
 * `findByIds`, un unique `inArray`. La version précédente dépliait un
 * `Promise.all` de `viewAccount`, c'est-à-dire exactement les vingt requêtes que
 * le commentaire du module disait éviter.
 *
 * Un identifiant absent de la réponse est un compte qui n'existe plus : la
 * lecture le rend `null`, et l'écran y met « Compte supprimé ».
 */
export const displayNamesOf = async (
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> =>
  new Map(
    (await appAuth().useCases.viewAccounts(userIds)).map(
      (account) => [account.userId, account.name] as const,
    ),
  )

/**
 * **Le centre, dérivé d'un registre** — et `null` quand ce registre ne contient
 * pas le module.
 *
 * Il prend le registre en paramètre plutôt que de lire celui de l'application :
 * c'est ce qui permet d'éprouver le repli du critère 7 en **coupant réellement**
 * le module dans une configuration de test, plutôt qu'en remplaçant le registre
 * par une doublure qui prouverait la doublure.
 */
export function notificationCentreOf(registry: ModuleRegistry): NotificationCentre | null {
  if (!registry.moduleIds.includes(notificationsModule.id)) {
    return null
  }

  return {
    record: async (input) =>
      await requireNotificationsService().useCases.record({
        type: input.type,
        userId: input.userId,
        organizationId: input.organizationId,
        channels: input.channels,
        defaults: input.defaults,
        payload: input.data,
      }),
  }
}

let emitter: NotificationEmitter | null = null

/**
 * **La fonction d'émission unique de l'application** (critères 6 et 7).
 *
 * Son mailer porte un catalogue **élargi** aux templates des types déclarés :
 * c'est le seul endroit du dépôt d'où un `notification.<type>` peut partir.
 *
 * La construction est **différée**, comme celle des services de module : faite
 * à l'import, elle lirait l'environnement pendant `pnpm build`, qui n'a ni clé
 * de fournisseur ni raison d'en avoir une.
 */
export const emitNotification: NotificationEmitter = async (input) => {
  if (emitter === null) {
    if (mounted) {
      provide()
    }

    emitter = createNotificationEmitter({
      types: notificationTypes,
      mailer: createAppMailer({
        emails: [...moduleRegistry.emails, ...notificationTypes.emails],
      }),
      centre: notificationCentreOf(moduleRegistry),
    })
  }

  return await emitter(input)
}

export interface NotificationsFeature {
  /**
   * Le module est-il monté ? **Une donnée**, lue par l'écran pour décider s'il
   * existe — pas un `if (module activé)` de plus disséminé dans l'application.
   */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, **sans rien construire**. */
  readonly prepare: () => void
  /** Ce que l'écran affiche. Vide et immuable module coupé, **sans requête**. */
  readonly view: (
    session: ModuleSession,
    page: number,
  ) => Promise<NotificationsView>
  /** Le compteur du badge. **Zéro module coupé**, sans toucher la base. */
  readonly unreadCount: (session: ModuleSession) => Promise<number>
}

const ABSENT_NOTIFICATIONS: NotificationsFeature = {
  available: false,
  prepare: () => {},
  view: () => Promise.resolve(EMPTY_NOTIFICATIONS_VIEW),
  unreadCount: () => Promise.resolve(0),
}

const notificationsService = () => {
  provide()

  return requireNotificationsService()
}

export const notifications: NotificationsFeature = mounted
  ? {
      available: true,
      prepare: provide,
      view: async (session, page) => {
        const current = notificationsService()

        return await current.useCases.view({
          scope: await current.scopeOf(session.userId),
          page,
        })
      },
      unreadCount: async (session) => {
        const current = notificationsService()

        return await current.useCases.unreadCount(await current.scopeOf(session.userId))
      },
    }
  : ABSENT_NOTIFICATIONS

/** Ce que les écrans ont le droit de connaître du module : ses chemins. */
export { NOTIFICATIONS_SCREEN_PATH, notificationRoutePath }

/**
 * La clé du nom accessible du badge, **réexportée d'ici**.
 *
 * Le shell ne connaît aucun module — c'est ce fichier-ci qui en connaît un, et
 * `apps/web/AGENTS.md` le nomme à ce titre. La clé appartient au catalogue du
 * module : elle disparaît avec lui, exactement comme le badge.
 */
export const NOTIFICATIONS_BADGE_LABEL_KEY = NOTIFICATIONS_KEYS.badgeLabel
