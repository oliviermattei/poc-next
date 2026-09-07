import { defineModule } from '@repo/core'

import { requireFeedbackService } from './infrastructure/feedback-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createFeedbackRoutes, feedbackNavigation } from './presentation/feedback-routes'
import { feedbackSchema } from './schema'

/**
 * Le contrat du module `feedback` (s43), rempli — toutes les clés du contrat.
 *
 * Le point de composition du module — le seul fichier qui connaisse les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme `auth`, `marketing` et `notifications`, les cas d'usage ne sont **pas**
 * construits à l'import : ce fichier est chargé par `config/features.ts`, donc
 * par `pnpm ks list` et `pnpm db:generate`, qui n'ont pas de base. Les routes
 * reçoivent un **accès différé** au service (`requireFeedbackService`), posé par
 * le point de composition de l'application (`apps/web/lib/feedback.ts`).
 *
 * ## Les deux requis, et pourquoi ils ne sont pas décoratifs
 *
 * - `auth` : un retour porte l'identifiant de son auteur (critère 2), et la
 *   route est authentifiée. Sans comptes, il n'y a rien à envoyer ;
 * - `admin` : le back-office **est** le seul lecteur d'un retour (critère 4).
 *   Coupé, les retours s'écriraient sans que personne puisse les lire — une
 *   fonctionnalité qui ne rend rien. `docs/stories.md` le dit en toutes lettres
 *   pour cette story, et la validation de configuration de s03 refuse la
 *   combinaison incohérente au lieu de la laisser échouer à l'exécution.
 *
 * **Aucune clé étrangère malgré `requires`** : la raison est écrite dans
 * `src/schema.ts`, et c'est celle de `notifications` — une cascade effacerait
 * les lignes sans passer par `purge`, où l'effacement est observable.
 *
 * ## Module coupé
 *
 * Plus aucune route (404), plus d'entrée de navigation, donc plus de
 * déclencheur, et aucune table sur une base neuve. Les lignes déjà écrites
 * restent : un module activé puis désactivé garde ses données, les effacer
 * serait un `eject`, qui est au cimetière du PRD.
 */
export const feedbackModule = defineModule({
  id: 'feedback',
  requires: ['auth', 'admin'],
  schema: feedbackSchema,
  migrations: 'packages/modules/feedback/migrations',
  routes: createFeedbackRoutes(requireFeedbackService),
  navigation: feedbackNavigation,
  /**
   * **Aucune URL publique, et c'est une décision** (ADR 054).
   *
   * Le formulaire est authentifié : publier son chemin dans le `sitemap.xml`
   * serait la divulgation gratuite de surface que `docs/security.md` §7 refuse.
   * Déclaré vide, jamais omis — le compilateur refuse l'omission.
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  /**
   * **Aucun template propre**, et c'est le critère 3 qui l'impose : l'email
   * d'un nouveau retour est celui du **type de notification**, déclaré dans
   * `config/notifications.ts`, qui est du socle (ADR 057). Un texte déclaré ici
   * disparaîtrait avec le module — c'est-à-dire exactement dans la
   * configuration où le repli doit fonctionner.
   */
  emails: [],
  webhooks: [],
  jobs: [],
  /**
   * **Une catégorie** : le retour lui-même.
   *
   * Il porte un identifiant de compte, une organisation, et surtout un **texte
   * libre** écrit par une personne — la donnée personnelle la moins prévisible
   * du produit. `erase` et non `anonymize` : contrairement à l'attribution d'un
   * rôle (`admin`), la ligne n'appartient à personne d'autre que son auteur, et
   * il n'y a donc rien à conserver pour un tiers.
   */
  dataCategories: ['feedback'],
  retention: { feedback: 'erase' },
  purge: async (scope) => {
    if (scope.kind === 'user') {
      await requireFeedbackService().useCases.eraseAuthor(scope.userId)

      return
    }

    await requireFeedbackService().useCases.eraseOrganization(scope.organizationId)
  },
  export: async (scope) => {
    if (scope.kind !== 'user') {
      // L'export appartient à une personne : une organisation exporte ce que
      // ses membres exportent, chacun pour lui.
      return {}
    }

    return {
      feedback: (await requireFeedbackService().useCases.ofAuthor(scope.userId)).map(
        (entry) => ({
          category: entry.category,
          message: entry.message,
          originPath: entry.originPath,
          status: entry.status,
          createdAt: entry.createdAt.toISOString(),
        }),
      ),
    }
  },
})
