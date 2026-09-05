import { defineModule } from '@repo/core'

import { NOTIFICATIONS_MODULE_ID } from './domain/notification'
import { requireNotificationsService } from './infrastructure/notifications-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import {
  createNotificationRoutes,
  notificationsNavigation,
} from './presentation/notification-routes'
import { notificationsSchema } from './schema'

/**
 * Le contrat du module `notifications`, rempli — les quinze clés.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme `auth`, `organizations`, `marketing` et `storage`, les cas d'usage ne
 * sont **pas** construits à l'import : ce fichier est chargé par
 * `config/features.ts`, donc par `pnpm ks list` et par `pnpm db:generate`, qui
 * n'ont pas de base. Les routes reçoivent un **accès différé** au service
 * (`requireNotificationsService`), posé par le point de composition de
 * l'application (`apps/web/lib/notifications.ts`).
 *
 * `requires: ['auth']` n'est pas décoratif, même sans clé étrangère : une
 * notification est **adressée** à un compte, et sans compte il n'y a personne à
 * qui l'adresser. C'est aussi ce qui place la purge de ce module **avant**
 * celle de `auth` dans l'ordre inverse du graphe (ADR 029) — le seul ordre où
 * elle peut encore résoudre ce qu'elle doit effacer.
 *
 * **`emails: []`, et c'est la décision de la story** (ADR 057). Le texte des
 * emails de notification vit dans `config/notifications.ts`, c'est-à-dire dans
 * le socle : le registre n'agrège que les modules **activés**, donc un texte
 * déclaré ici disparaîtrait avec le module — exactement dans l'état où le repli
 * du critère 7 doit fonctionner.
 */
export const notificationsModule = defineModule({
  id: NOTIFICATIONS_MODULE_ID,
  requires: ['auth'],
  schema: notificationsSchema,
  migrations: 'packages/modules/notifications/migrations',
  routes: createNotificationRoutes(requireNotificationsService),
  navigation: notificationsNavigation,
  /**
   * **Aucune URL publique, et c'est une décision, pas un oubli** (s53, ADR 054).
   *
   * Un centre de notifications est privé : ses cinq routes sont
   * `authenticated`, et son écran ne se sert qu'à son destinataire. L'indexer
   * publierait l'existence d'une surface que personne d'autre ne peut lire —
   * la divulgation gratuite que `docs/security.md` §7 refuse.
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  /**
   * **Aucune tâche planifiée.** Le badge se met à jour à la navigation et après
   * lecture ; ni sondage, ni rafraîchissement périodique — le temps réel est au
   * cimetière du PRD, et une tâche qui « pousserait » les notifications serait
   * la même chose sous un autre nom.
   */
  jobs: [],
  // Une notification et une préférence sont des données personnelles : la
  // première porte ce qui est arrivé à quelqu'un, la seconde ce qu'il a choisi.
  // Les deux sont **effacées**, jamais anonymisées — une notification anonyme
  // n'est adressée à personne, donc n'est plus une notification.
  dataCategories: ['notification', 'preference'],
  retention: { notification: 'erase', preference: 'erase' },
  purge: async (scope) => {
    const useCases = requireNotificationsService().useCases

    await (scope.kind === 'user'
      ? useCases.purgeUser(scope.userId)
      : useCases.purgeOrganization(scope.organizationId))
  },
  export: async (scope) => {
    const useCases = requireNotificationsService().useCases

    return scope.kind === 'user'
      ? await useCases.exportUser(scope.userId)
      : await useCases.exportOrganization(scope.organizationId)
  },
})
