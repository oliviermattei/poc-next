// Fichier généré par `pnpm db:generate` depuis `config/features.ts`.
// Ne pas éditer à la main : la CI régénère et compare.
//
// L'agrégat des schémas des modules **activés**, tel que le client Drizzle
// le consomme pour la requête relationnelle (`db.query.<table>`). La
// génération des migrations, elle, lit les barils un par un.

import type { ModuleSchema } from '@repo/db'
import * as auth from './auth'
import * as billing from './billing'
import * as demoEnabled from './demo-enabled'
import * as i18n from './i18n'
import * as marketing from './marketing'
import * as organizations from './organizations'
import * as storage from './storage'

export const enabledModuleSchemas = [
  { id: 'auth', schema: auth },
  { id: 'billing', schema: billing },
  { id: 'demo-enabled', schema: demoEnabled },
  { id: 'i18n', schema: i18n },
  { id: 'marketing', schema: marketing },
  { id: 'organizations', schema: organizations },
  { id: 'storage', schema: storage },
] as const satisfies readonly ModuleSchema[]
