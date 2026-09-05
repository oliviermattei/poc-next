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
   * **Aucune donnée personnelle.**
   *
   * La table du module ne porte qu'un identifiant de compte et un rôle ; le
   * compte lui-même appartient à `auth`, qui déclare `account` et le purge. La
   * ligne de rôle disparaît **par cascade** avec le compte (`src/schema.ts`),
   * si bien qu'il n'y a rien à effacer ici — et rien à exporter que la personne
   * ne puisse déjà lire dans son propre compte.
   */
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})
