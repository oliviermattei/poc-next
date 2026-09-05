import { defineModule } from '@repo/core'

import { requireAdminService } from './infrastructure/admin-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { adminNavigation, createAdminRoutes } from './presentation/admin-routes'
import { adminSchema } from './schema'

/**
 * Le contrat du module `admin`, rempli — les quinze clés.
 *
 * Le point de composition du module — le seul fichier qui connaisse les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme `auth` et `organizations`, les cas d'usage ne sont **pas** construits à
 * l'import : ce fichier est chargé par `config/features.ts`, donc par
 * `pnpm ks list` et `pnpm db:generate`, qui n'ont pas de base. Les routes
 * reçoivent un **accès différé** au service (`requireAdminService`), posé par
 * le point de composition de l'application (`apps/web/lib/admin.ts`).
 *
 * `requires: ['auth']` n'est pas décoratif : c'est cette déclaration qui rend
 * permise la clé étrangère de `admin_platform_role` vers `auth_user` (ADR 018).
 * Sans elle, `pnpm db:generate` refuse, en nommant les deux modules et la
 * table.
 *
 * **Module coupé** : plus aucune route, plus aucun rôle de superadmin, plus
 * personne ne peut bannir — mais un compte déjà banni **reste banni**, parce
 * que cet état vit dans le socle (ADR 058). C'est la règle du dépôt : un module
 * activé puis désactivé garde ses tables et ses données ; le débannir serait un
 * nettoyage, et le nettoyage est au cimetière du PRD.
 */
export const adminModule = defineModule({
  id: 'admin',
  requires: ['auth'],
  schema: adminSchema,
  migrations: 'packages/modules/admin/migrations',
  routes: createAdminRoutes(requireAdminService),
  navigation: adminNavigation,
  /**
   * **Aucune URL publique, et c'est une décision** (s53, ADR 054).
   *
   * Un back-office n'est pas indexable : publier son chemin dans le
   * `sitemap.xml` serait la divulgation gratuite de surface que
   * `docs/security.md` §7 refuse. Déclaré vide, jamais omis — le compilateur
   * refuse l'omission (`tests/fixtures/typing/missing-public-urls.ts`).
   */
  publicUrls: () => [],
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  /**
   * **Une catégorie, et elle est la seule `anonymize` du dépôt** (s34, constat
   * F1 de la revue).
   *
   * Le **rôle** d'un compte disparaît par cascade avec lui (`src/schema.ts`),
   * et n'a donc pas de catégorie : il n'y a rien à décider de son sort. Ce qui
   * en avait une sans qu'on l'ait vu, c'est `granted_by` — l'identifiant du
   * compte **qui a promu**, porté par la ligne de **quelqu'un d'autre**, et
   * sans clé étrangère (délibérément : effacer le promoteur ne doit ni emporter
   * la promotion, ni la bloquer). Aucune cascade ne l'atteint, et il survivait
   * à l'effacement de son porteur.
   *
   * `anonymize` et non `erase` parce que les deux mots ne décrivent pas la même
   * ligne : effacer la ligne retirerait son rôle à un tiers, et pourrait rendre
   * la plateforme inadministrable. Ce qui part est le **lien**, pas la donnée.
   * C'est la définition exacte du contrat (`RetentionAction`), et
   * `tests/account-deletion.test.ts` l'exécute sur ce module.
   *
   * L'export reste vide : la personne ne peut rien lire ici qu'elle ne lise
   * déjà dans son propre compte, et l'attribution d'un rôle appartient à la
   * ligne d'un tiers.
   */
  dataCategories: ['grant-authorship'],
  retention: { 'grant-authorship': 'anonymize' },
  purge: async (scope) => {
    if (scope.kind !== 'user') {
      return
    }

    await requireAdminService().useCases.forgetGranter(scope.userId)
  },
  export: async () => ({}),
})
