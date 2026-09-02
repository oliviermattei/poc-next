import { defineModule, type ModuleScope } from '@repo/core'

import { STORAGE_MODULE_ID, type FileOwner } from './domain/avatar'
import { requireStorageService } from './infrastructure/storage-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { createStorageRoutes, storageNavigation } from './presentation/storage-routes'
import { storageSchema } from './schema'

/**
 * Le contrat du module `storage`, rempli — les quatorze clés.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme `auth`, `organizations` et `marketing`, les cas d'usage ne sont **pas**
 * construits à l'import : ce fichier est chargé par `config/features.ts`, donc
 * par `pnpm ks list` et par `pnpm db:generate`, qui n'ont ni base ni stockage.
 * Les routes reçoivent un **accès différé** au service
 * (`requireStorageService`), posé par le point de composition de l'application
 * (`apps/web/lib/storage.ts`).
 *
 * `requires: ['auth']` n'est pas décoratif, même sans clé étrangère : un fichier
 * appartient à un compte ou à une organisation, et sans compte il n'y a
 * personne pour en posséder un. C'est aussi ce qui place la purge de ce module
 * **avant** celle de `auth` dans l'ordre inverse du graphe (ADR 029) — le seul
 * ordre où elle peut encore résoudre ce qu'elle doit effacer.
 */

/**
 * Le périmètre du contrat, traduit dans celui du `domain`.
 *
 * `ModuleScope` et `FileOwner` ont la même forme, et c'est délibéré : le
 * `domain` n'a pas besoin de connaître le contrat de module pour dire ce qu'est
 * un propriétaire (ADR 006). La conversion tient en une ligne, et elle est ici,
 * à la frontière.
 */
const ownerOf = (scope: ModuleScope): FileOwner =>
  scope.kind === 'user'
    ? { kind: 'user', id: scope.userId }
    : { kind: 'organization', id: scope.organizationId }

export const storageModule = defineModule({
  id: STORAGE_MODULE_ID,
  requires: ['auth'],
  schema: storageSchema,
  migrations: 'packages/modules/storage/migrations',
  routes: createStorageRoutes(requireStorageService),
  navigation: storageNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  // Un avatar est une **donnée personnelle** : c'est une image d'une personne,
  // et sa clé d'objet porte l'identifiant de son propriétaire. Une seule
  // catégorie, parce qu'il n'y a qu'une table.
  //
  // **Effacé, jamais anonymisé.** Anonymiser un fichier n'a pas de sens : les
  // octets *sont* la donnée, et une image détachée de son compte reste la photo
  // de quelqu'un. `retention` est indexée par `dataCategories` — une catégorie
  // déclarée sans politique ne compile pas (ADR 007).
  dataCategories: ['file'],
  retention: { file: 'erase' },
  // **La purge supprime l'objet, pas seulement la ligne.** C'est le critère 6,
  // et c'est le défaut exact que s16 a laissé passer sur une adresse.
  purge: async (scope) => await requireStorageService().useCases.purge(ownerOf(scope)),
  export: async (scope) => await requireStorageService().useCases.export(ownerOf(scope)),
})
