import { type Env, getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import { authRoutePath, configureAuth, safeRedirectPath, type AuthService } from '@repo/module-auth'
import type { ModuleSession } from '@repo/core'
import { headers } from 'next/headers'
import { after } from 'next/server'

import { resolveAuthConfig } from './auth-config'
import { createAppMailer } from './mailer'

/**
 * Le point de composition de l'authentification.
 *
 * C'est **le seul fichier de l'application** qui connaisse le module `auth`, et
 * c'est la même exception que `lib/mailer.ts` pour le fournisseur d'emails : le
 * reste de l'application ne voit que le registre. Il ne pouvait pas en aller
 * autrement — le crochet `resolveSession` que `dispatchModuleRequest` attend
 * (s03) doit bien venir de quelque part, et `@repo/core` ne peut pas dépendre
 * d'un module sans inverser la dépendance qui fait toute la modularité.
 *
 * Ce fichier assemble ce que le module ne peut pas se procurer lui-même :
 *
 * - la **connexion** à la base — le module ne dépend pas de `@repo/db`, et
 *   c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR
 *   020) ;
 * - le **mailer**, construit par `lib/mailer.ts` : le module d'authentification
 *   ne connaît que le port `Mailer`, jamais Resend ni la capture locale ;
 * - le **secret** et l'**URL publique**, validés par `lib/auth-config.ts`.
 *
 * La construction est différée à la première requête : `config/features.ts` est
 * aussi chargé par `pnpm ks` et par `pnpm db:generate`, qui n'ont ni base ni
 * mailer.
 */
/**
 * Ce que les écrans ont le droit de connaître du module : le chemin de ses
 * routes et la règle de destination de retour. Réexportés d'ici, pour que
 * l'exception « un seul fichier importe un module » reste vraie.
 */
export { authRoutePath, safeRedirectPath }

export interface AppAuthOptions {
  readonly env?: Env
}

let service: AuthService | null = null

export function appAuth(options: AppAuthOptions = {}): AuthService {
  if (service === null) {
    const { secret, appUrl } = resolveAuthConfig(options.env ?? getEnv())

    service = configureAuth({
      db: getDatabase().db,
      mailer: createAppMailer(),
      secret,
      appUrl,
      // L'envoi de l'email de réinitialisation sort du temps de réponse, sans
      // quoi seul un compte **existant** le paie et son existence se lit au
      // chronomètre (`docs/security.md` §7). `after` est ce qui garantit que le
      // travail est malgré tout exécuté là où le processus est gelé dès la
      // réponse rendue — un `void promise` y perdrait l'email.
      runInBackground: (task) => {
        after(async () => {
          await task
        })
      },
    })
  }

  return service
}

/**
 * Le crochet que le répartiteur de modules attend.
 *
 * Sans lui, toute route non publique répond 401 — c'est le sens fermé livré par
 * s03, et cette story est celle qui le branche.
 */
export const resolveModuleSession = (request: Request): Promise<ModuleSession | null> =>
  appAuth().resolveSession(request)

/**
 * La session de la requête en cours, pour un composant serveur.
 *
 * Les écrans n'ont pas de `Request` sous la main : Next leur donne les
 * en-têtes. La session est résolue par le **même** service que les routes —
 * une seconde lecture du cookie, ailleurs, serait une seconde vérité.
 */
export async function currentSession(): Promise<ModuleSession | null> {
  const requestHeaders = await headers()
  const auth = appAuth()

  return await auth.resolveSession(
    new Request(new URL('/', resolveAuthConfig(getEnv()).appUrl), { headers: requestHeaders }),
  )
}
