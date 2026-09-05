// Fichier généré par `pnpm db:generate` depuis `config/features.ts`.
// Ne pas éditer à la main : la CI régénère et compare.
//
// L'agrégat des schémas des modules **activés**, tel que le client Drizzle
// le consomme pour la requête relationnelle (`db.query.<table>`). La
// génération des migrations, elle, lit les barils un par un.

import type { ModuleSchema } from '@repo/db'
import * as admin from './admin'
import * as auth from './auth'
import * as billing from './billing'
import * as blog from './blog'
import * as consent from './consent'
import * as demoEnabled from './demo-enabled'
import * as docs from './docs'
import * as i18n from './i18n'
import * as jobs from './jobs'
import * as marketing from './marketing'
import * as mcpServer from './mcp-server'
import * as notifications from './notifications'
import * as organizations from './organizations'
import * as rateLimit from './rate-limit'
import * as storage from './storage'

export const enabledModuleSchemas = [
  { id: 'admin', schema: admin },
  { id: 'auth', schema: auth },
  { id: 'billing', schema: billing },
  { id: 'blog', schema: blog },
  { id: 'consent', schema: consent },
  { id: 'demo-enabled', schema: demoEnabled },
  { id: 'docs', schema: docs },
  { id: 'i18n', schema: i18n },
  { id: 'jobs', schema: jobs },
  { id: 'marketing', schema: marketing },
  { id: 'mcp-server', schema: mcpServer },
  { id: 'notifications', schema: notifications },
  { id: 'organizations', schema: organizations },
  { id: 'rate-limit', schema: rateLimit },
  { id: 'storage', schema: storage },
] as const satisfies readonly ModuleSchema[]
