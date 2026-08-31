// Fichier généré par `pnpm db:generate` depuis `config/features.ts`.
// Ne pas éditer à la main : la CI régénère et compare.
//
// L'agrégat des schémas des modules **activés**, tel que le client Drizzle
// le consomme pour la requête relationnelle (`db.query.<table>`). La
// génération des migrations, elle, lit les barils un par un.

import type { ModuleSchema } from '@repo/db'
import * as auth from './auth'
import * as demoEnabled from './demo-enabled'
import * as i18n from './i18n'
import * as marketing from './marketing'

export const enabledModuleSchemas = [
  { id: 'auth', schema: auth },
  { id: 'demo-enabled', schema: demoEnabled },
  { id: 'i18n', schema: i18n },
  { id: 'marketing', schema: marketing },
] as const satisfies readonly ModuleSchema[]
