import { type Env, getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import {
  adminModule,
  provideAdmin,
  type AdminAccountsPort,
} from '@repo/module-admin'

import { appAuth } from './auth'
import { moduleRegistry } from './module-registry'

/**
 * Le point de composition de l'administration de plateforme (s37a).
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/module-admin`, et le seul qui regarde si ce module est monté — le
 * même modèle que `lib/organizations.ts` et `lib/billing.ts`.
 *
 * Il tient ensemble les trois choses que le module ne peut pas se procurer :
 *
 * - la **connexion** à la base — le module ne dépend pas de `@repo/db`, ce qui
 *   empêche le cycle `@repo/db` → agrégat généré → module (ADR 020) ;
 * - le **port des comptes**, servi par le module `auth`. C'est ici que la
 *   décision d'architecture de la story se voit : l'état « banni » vit dans le
 *   socle (ADR 058), et le module d'administration ne fait que le **demander** ;
 * - l'**adresse du premier superadmin**, lue dans l'environnement. Le module
 *   n'en lit aucun (`docs/security.md` §5).
 *
 * | | module `admin` monté | module coupé |
 * |---|---|---|
 * | routes `/api/modules/admin/*` | servies au seul superadmin, **404** aux autres | **404** pour tout le monde |
 * | rôle de superadmin | la table du module | il n'en existe aucun |
 * | compte déjà banni | reste banni | **reste banni** — l'état est dans le socle |
 */

/** Le module est-il monté ? Lu dans le **registre**, jamais dans `config/features.ts`. */
const mounted = moduleRegistry.moduleIds.includes(adminModule.id)

/**
 * Ce que le module d'administration sait des comptes — **délégué au socle**.
 *
 * Aucune des trois opérations n'est réimplémentée ici : le bannissement, sa
 * levée et la résolution d'une adresse appartiennent au module `auth`, qui
 * possède les comptes. Ce fichier ne fait que brancher l'un sur l'autre.
 */
const accounts: AdminAccountsPort = {
  findIdByEmail: async (email) => {
    const account = await appAuth().useCases.identifyAccount(email)

    return { ok: true, userId: account?.userId ?? null }
  },
  ban: async ({ userId, reason }) => await appAuth().useCases.banAccount({ userId, reason }),
  unban: async ({ userId }) => await appAuth().useCases.unbanAccount({ userId }),
}

/**
 * L'adresse du premier superadmin, **normalisée par le schéma d'environnement**.
 *
 * `undefined` — variable absente ou vide — devient `null` : le module reçoit
 * une réponse, jamais une variable.
 */
const designatedEmailOf = (env: Env): string | null => env.SUPERADMIN_EMAIL ?? null

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * Le répartiteur prépare les services à chaque requête, y compris celles
 * qu'aucune route ne satisfait : construire aussitôt ouvrirait une connexion
 * pour répondre 404 sur un chemin inconnu (mesuré en s15).
 */
const provide = (): void => {
  provideAdmin(() => ({
    db: getDatabase().db,
    accounts,
    designatedEmail: designatedEmailOf(getEnv()),
  }))
}

export interface AdminFeature {
  /** Le module est-il monté ? **Une donnée**, pas un `if` de plus dans l'application. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, sans rien construire. */
  readonly prepare: () => void
}

export const admin: AdminFeature = mounted
  ? { available: true, prepare: provide }
  : { available: false, prepare: () => {} }

/**
 * **L'avertissement de démarrage** (critère 3 de la story), et ce qu'il n'est
 * pas.
 *
 * Ce n'est **pas un refus**, contrairement au mailer, à l'authentification, au
 * stockage et au paiement, qui arrêtent le démarrage en nommant leur variable.
 * La raison est écrite dans le critère : une plateforme sans superadmin doit
 * pouvoir démarrer, sans quoi on ne pourrait jamais en désigner un — la
 * variable nomme une adresse dont le compte n'existe pas encore sur une base
 * vierge.
 *
 * Il **nomme la variable**, comme tous les autres messages de démarrage : un
 * avertissement qui dit « aucun administrateur » sans dire quoi renseigner
 * envoie lire le code.
 *
 * Rend `null` quand il n'y a rien à dire — module coupé (il n'y a alors pas de
 * back-office du tout), ou adresse renseignée. Une fonction plutôt qu'un
 * `console.warn` en ligne : ce qui est écrit dans `lib/startup.ts` n'est
 * neutralisable par aucun test.
 */
export function missingSuperadminWarning(input: {
  readonly available: boolean
  readonly designatedEmail: string | null
}): string | null {
  if (!input.available || input.designatedEmail !== null) {
    return null
  }

  return (
    'SUPERADMIN_EMAIL n’est pas renseignée : aucun superadmin ne peut être désigné, ' +
    'et le back-office répond 404 à tout le monde. Renseignez l’adresse du compte qui ' +
    'doit l’administrer.'
  )
}

/** L'avertissement pour **cet** environnement, ou `null`. Appelé par `lib/startup.ts`. */
export const superadminWarningFor = (env: Env): string | null =>
  missingSuperadminWarning({
    available: admin.available,
    designatedEmail: designatedEmailOf(env),
  })
