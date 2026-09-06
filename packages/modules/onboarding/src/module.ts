import { defineModule } from '@repo/core'

import { ONBOARDING_MODULE_ID } from './domain/onboarding'
import { requireOnboardingService } from './infrastructure/onboarding-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createOnboardingRoutes } from './presentation/onboarding-routes'
import { onboardingSchema } from './schema'

/**
 * Le contrat du module `onboarding`, rempli — les quinze clés.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme `auth`, `organizations`, `marketing`, `storage` et `notifications`, les
 * cas d'usage ne sont **pas** construits à l'import : ce fichier est chargé par
 * `config/features.ts`, donc par `pnpm ks list` et par `pnpm db:generate`, qui
 * n'ont pas de base. Les routes reçoivent un **accès différé** au service
 * (`requireOnboardingService`), posé par le point de composition de
 * l'application (`apps/web/lib/onboarding.ts`).
 *
 * `requires: ['auth']` n'est pas décoratif, même sans clé étrangère : un
 * parcours d'intégration appartient à un **compte**, et sans compte il n'y a
 * personne à guider. C'est aussi ce qui place la purge de ce module **avant**
 * celle de `auth` dans l'ordre inverse du graphe (ADR 029) — le seul ordre où
 * elle peut encore résoudre ce qu'elle doit effacer.
 *
 * **Aucun `requires` vers `organizations`, `billing` ou `storage`**, et c'est
 * tout le sujet de la story : les étapes sont dérivées des modules montés par
 * le point de composition, en **valeur**. Les déclarer requis rendrait le
 * parcours indisponible dès qu'on coupe l'un d'eux, c'est-à-dire l'inverse du
 * critère 3.
 */
export const onboardingModule = defineModule({
  id: ONBOARDING_MODULE_ID,
  requires: ['auth'],
  schema: onboardingSchema,
  migrations: 'packages/modules/onboarding/migrations',
  routes: createOnboardingRoutes(requireOnboardingService),
  /**
   * **Aucune entrée de navigation, et c'est une décision.** Le parcours est
   * proposé par la racine tant qu'il reste à faire, et il cesse de l'être une
   * fois terminé (critère 5). Une entrée permanente contredirait la porte à
   * sens unique : elle rouvrirait à la main ce que le parcours vient de fermer.
   */
  navigation: [],
  /**
   * **Aucune URL publique.** Les deux routes sont `authenticated` et l'écran ne
   * se sert qu'au compte qu'il guide : l'indexer publierait l'existence d'une
   * surface que personne d'autre ne peut lire (ADR 054, `docs/security.md` §7).
   *
   * Déclaré vide, jamais omis — le compilateur refuse l'omission
   * (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  /**
   * **Aucune tâche planifiée.** Rien n'expire ici : un parcours interrompu
   * attend le retour de son compte, et une relance par email serait une
   * fonctionnalité que les critères ne nomment pas.
   */
  jobs: [],
  /**
   * La progression est une **donnée personnelle** : elle dit ce que quelqu'un a
   * fait, et quand. Elle est **effacée**, jamais anonymisée — une progression
   * anonyme n'appartient à personne, donc n'est plus une progression.
   */
  dataCategories: ['onboarding-progress'],
  retention: { 'onboarding-progress': 'erase' },
  /**
   * **La purge efface la progression**, et le périmètre organisation n'en a
   * aucune : un parcours appartient à un compte. La branche organisation ne
   * fait donc rien — elle est écrite, pas omise, pour que le contrat reste
   * lisible et que `pnpm test` puisse la mesurer (`s34`, `s35`).
   */
  purge: async (scope) => {
    if (scope.kind === 'user') {
      await requireOnboardingService().useCases.purgeUser(scope.userId)
    }
  },
  export: async (scope) =>
    scope.kind === 'user'
      ? await requireOnboardingService().useCases.exportUser(scope.userId)
      : {},
})
