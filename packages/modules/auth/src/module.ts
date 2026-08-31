import { defineModule } from '@repo/core'

import { magicLinkEmail } from './emails/magic-link'
import { passwordResetEmail } from './emails/password-reset'
import { verificationEmail } from './emails/verification'
import { requireAuthService } from './infrastructure/auth-runtime'
import enMessages from './messages/en.json' with { type: 'json' }
import frMessages from './messages/fr.json' with { type: 'json' }
import { authNavigation, createAuthRoutes } from './presentation/auth-routes'
import { authSchema } from './schema'

/**
 * Le contrat du module `auth`, rempli.
 *
 * Le point de composition du module — le seul fichier qui connaît les quatre
 * couches — vit ici, hors des couches, comme dans tout module de ce dépôt.
 *
 * Une différence avec les modules de démonstration, et elle est structurelle :
 * les cas d'usage ne sont **pas** construits à l'import. Ce fichier est chargé
 * par `config/features.ts`, donc par `pnpm ks list` et par `pnpm db:generate`,
 * qui n'ont ni base ni mailer. Les routes reçoivent donc un **accès différé**
 * au service (`requireAuthService`), posé par le point de composition de
 * l'application (`apps/web/lib/auth.ts`). Une route appelée avant cette
 * configuration échoue en le disant, elle ne sert rien à moitié.
 */
export const authModule = defineModule({
  id: 'auth',
  requires: [],
  schema: authSchema,
  migrations: 'packages/modules/auth/migrations',
  routes: createAuthRoutes(requireAuthService),
  navigation: authNavigation,
  messages: { fr: frMessages, en: enMessages },
  emails: [verificationEmail, magicLinkEmail, passwordResetEmail],
  webhooks: [],
  jobs: [],
  dataCategories: ['account', 'session'],
  // Un compte est **effacé**, jamais anonymisé : un compte anonyme resterait
  // un moyen de connexion.
  retention: { account: 'erase', session: 'erase' },
  purge: (scope) => requireAuthService().useCases.purgeAccount(scope),
  export: (scope) => requireAuthService().useCases.exportAccount(scope),
})
