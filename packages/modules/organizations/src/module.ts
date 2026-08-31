import { defineModule } from '@repo/core'

import { ORGANIZATIONS_MODULE_ID } from './domain/organization'
import { requireOrganizationsService } from './infrastructure/organizations-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import {
  createOrganizationRoutes,
  organizationsNavigation,
} from './presentation/organization-routes'
import { organizationsSchema } from './schema'

/**
 * Le contrat du module `organizations`, rempli — les quatorze clés.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Comme le module `auth`, les cas d'usage ne sont **pas** construits à
 * l'import : ce fichier est chargé par `config/features.ts`, donc par
 * `pnpm ks list` et par `pnpm db:generate`, qui n'ont pas de base. Les routes
 * reçoivent un **accès différé** au service (`requireOrganizationsService`),
 * posé par le point de composition de l'application
 * (`apps/web/lib/organizations.ts`).
 *
 * `requires: ['auth']` n'est pas décoratif : c'est cette déclaration qui rend
 * permises les clés étrangères de `organization_member` et de
 * `organization_active_selection` vers `auth_user` (ADR 018). Sans elle,
 * `pnpm db:generate` refuse, en nommant les deux modules et la table.
 */
export const organizationsModule = defineModule({
  id: ORGANIZATIONS_MODULE_ID,
  requires: ['auth'],
  schema: organizationsSchema,
  migrations: 'packages/modules/organizations/migrations',
  routes: createOrganizationRoutes(requireOrganizationsService),
  navigation: organizationsNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [],
  webhooks: [],
  jobs: [],
  // Une organisation et une appartenance sont des données personnelles : la
  // seconde nomme un compte, la première est le contexte de son travail. Les
  // deux sont **effacées**, jamais anonymisées — une organisation anonyme
  // resterait un contexte que ses anciens membres pourraient encore atteindre.
  dataCategories: ['organization', 'membership'],
  retention: { organization: 'erase', membership: 'erase' },
  purge: (scope) => requireOrganizationsService().useCases.purge(scope),
  export: (scope) => requireOrganizationsService().useCases.export(scope),
})
