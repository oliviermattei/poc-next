import { type Env, getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import {
  adminModule,
  adminRoutePath,
  parseBackOfficeQuery,
  provideAdmin,
  requireAdminService,
  type AdminAccountsView,
  type AdminAccountsPort,
  type AdminAccountView,
  type AdminOrganizationsPort,
  type AdminOrganizationsView,
  type AdminOrganizationView,
  type BackOfficeView,
} from '@repo/module-admin'
import type { AuthService, AuthUseCases } from '@repo/module-auth'

import { appAuth, incomingRequest } from './auth'
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
/**
 * **Un port ne lève pas** (`AGENTS.md` racine) : il rend un résultat discriminé,
 * si bien que le compilateur oblige l'appelant à traiter l'échec.
 *
 * Les lectures branchées ci-dessous parlent à la base : une panne y **lève**, et
 * la laisser remonter rendrait 500 là où le module a écrit un refus fermé —
 * la branche `{ ok: false }` de `signInBlockedAmong` et de `borrowerOf` ne
 * serait alors atteignable par rien (constat MJ4 de la revue de s37b1). Le sens
 * fermé survivrait par accident, pas par décision.
 *
 * Rien n'est journalisé ici : le point de composition ne connaît pas le journal
 * de sécurité du module, et l'échec est déjà visible — le module refuse en le
 * nommant (`accounts_unavailable`).
 */
const readOr = async <TValue>(
  read: () => Promise<TValue>,
): Promise<{ readonly ok: true; readonly value: TValue } | { readonly ok: false }> => {
  try {
    return { ok: true, value: await read() }
  } catch {
    return { ok: false }
  }
}

/**
 * **Ce que ce point de composition a besoin de savoir de `auth`**, et rien de
 * plus — la forme réduite de `lib/guest-account.ts`, pour la même raison :
 * `appAuth()` monte l'application entière, et la règle éprouvée ici est
 * ailleurs (« une lecture en échec rend un refus »).
 */
export type AdminAuth = Pick<
  AuthService,
  'startImpersonation' | 'stopImpersonation' | 'borrowerOf' | 'requestPasswordResetFor'
> & {
  readonly useCases: Pick<
    AuthUseCases,
    | 'identifyAccount'
    | 'banAccount'
    | 'unbanAccount'
    | 'signInBlockedAmong'
    | 'endBorrowsBy'
    | 'sweepExpiredImpersonations'
    | 'searchAccounts'
    | 'describeAccount'
    | 'listSessions'
    | 'revokeSession'
  >
}

export const adminAccountsPort = (auth: () => AdminAuth): AdminAccountsPort => ({
  findIdByEmail: async (email) => {
    const account = await auth().useCases.identifyAccount(email)

    return { ok: true, userId: account?.userId ?? null }
  },
  ban: async ({ userId, reason }) => await auth().useCases.banAccount({ userId, reason }),
  unban: async ({ userId }) => await auth().useCases.unbanAccount({ userId }),
  /**
   * **Le décompte des superadmins capables de se connecter** (s37b1) — délégué
   * au socle, comme les trois autres.
   *
   * C'est ce branchement qui remplace la jointure interdite : le module donne
   * des identifiants qu'il tient de sa propre table, `auth` répond lesquels ne
   * peuvent pas ouvrir de session. Aucune adresse ne circule, aucune table du
   * socle n'est lue depuis le module.
   */
  signInBlockedAmong: async (userIds) => {
    const read = await readOr(async () => await auth().useCases.signInBlockedAmong(userIds))

    return read.ok ? { ok: true, blocked: read.value } : { ok: false }
  },
  /**
   * **L'emprunt de session** (s37b1) — délégué au socle jusqu'au cookie.
   *
   * Le module d'administration décide *qui* peut emprunter *qui* ; `auth` sait
   * ouvrir une session, la faire tourner et signer son cookie. Aucune des deux
   * moitiés ne sait faire l'autre, et c'est ce fichier qui les tient ensemble.
   */
  startImpersonation: async ({ request, actorId, userId }) => {
    const opened = await readOr(
      async () => await auth().startImpersonation({ request, actorId, userId }),
    )

    // Une panne n'ouvre pas d'emprunt, et ne rend pas 500 : le compte visé est
    // rendu introuvable, le sens fermé de ce module.
    return opened.ok ? opened.value : { ok: false, error: 'unknown_account' }
  },
  stopImpersonation: async ({ request }) => {
    const closed = await readOr(async () => await auth().stopImpersonation({ request }))

    return closed.ok ? closed.value : { ok: false, error: 'not_impersonating' }
  },
  borrowerOf: async (request) => {
    const read = await readOr(async () => await auth().borrowerOf(request))

    return read.ok ? { ok: true, impersonatedBy: read.value } : { ok: false }
  },
  endBorrowsBy: async (userId) => {
    const ended = await readOr(async () => await auth().useCases.endBorrowsBy(userId))

    return ended.ok
      ? {
          ok: true,
          ended: ended.value.map((borrow) => ({
            userId: borrow.userId,
            impersonatedBy: borrow.impersonatedBy,
          })),
        }
      : { ok: false }
  },
  /**
   * **La page de comptes du back-office** (s37b2) — déléguée au socle, comme
   * les autres. Le module donne une recherche et une fenêtre, `auth` rend des
   * comptes : aucune table du socle n'est lue depuis le module.
   */
  listAccounts: async (input) => {
    const read = await readOr(async () => await auth().useCases.searchAccounts(input))

    return read.ok ? { ok: true, ...read.value } : { ok: false }
  },
  /**
   * **Le compte et ses sessions, en une seule réponse.**
   *
   * Deux lectures du socle jointes ici plutôt que deux méthodes de port : le
   * détail d'un compte n'a de sens qu'avec ses sessions, et un port qui rendrait
   * les deux séparément laisserait un appelant en oublier une.
   */
  describeAccount: async (userId) => {
    const read = await readOr(async () => {
      const account = await auth().useCases.describeAccount(userId)

      if (account === null) {
        return null
      }

      const sessions = await auth().useCases.listSessions({
        userId,
        // **Aucune session courante** : celle de l'appelant est celle du
        // superadmin, pas du compte affiché. La marquer « c'est cet
        // appareil-ci » sur la ligne d'autrui serait faux.
        currentSessionId: null,
      })

      return {
        account,
        sessions: sessions.map((session) => ({
          sessionId: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        })),
      }
    })

    return read.ok ? { ok: true, detail: read.value } : { ok: false }
  },
  revokeSession: async ({ userId, sessionId }) => {
    const revoked = await readOr(
      async () => await auth().useCases.revokeSession({ userId, sessionId }),
    )

    return revoked.ok ? { ok: true, revoked: revoked.value } : { ok: false }
  },
  /**
   * **La réinitialisation, déclenchée par la route publique du socle.**
   *
   * L'adresse est **relue de l'identifiant** ici, jamais reçue du back-office :
   * un back-office qui accepterait une adresse serait un chemin de
   * réinitialisation vers n'importe quelle boîte. C'est la même forme que
   * `lib/guest-account.ts`, et pour la même raison — le module ne sait pas
   * fabriquer le jeton, `auth` ne sait pas qui a le droit de demander.
   */
  sendPasswordReset: async ({ userId }) => {
    const sent = await readOr(async () => await auth().requestPasswordResetFor(userId))

    return sent.ok ? { ok: true, sent: sent.value } : { ok: false }
  },
  sweepExpiredImpersonations: async (at) => {
    const swept = await readOr(async () => await auth().useCases.sweepExpiredImpersonations(at))

    return swept.ok
      ? {
          ok: true,
          ended: swept.value.map((ended) => ({
            userId: ended.userId,
            impersonatedBy: ended.impersonatedBy,
          })),
        }
      : { ok: false }
  },
})

/** Le port réellement livré, branché sur le module `auth` de l'application. */
const accounts: AdminAccountsPort = adminAccountsPort(appAuth)

/**
 * **Ce que le back-office sait des organisations** (s37b2).
 *
 * Les imports sont **différés**, pour la raison exacte de `lib/auth.ts` :
 * `lib/organizations.ts` et `lib/billing.ts` importent le point de composition
 * de l'authentification, et un import statique en sens inverse fermerait le
 * cycle.
 *
 * **Aucune condition sur un module ici.** Module `organizations` coupé, ses
 * lectures rendent des listes vides sans ouvrir de connexion ; module `billing`
 * coupé, l'offre et l'état d'abonnement sont `null`. Ce qui disparaît alors est
 * l'**entrée de navigation**, dérivée du registre (ADR 066) — pas une branche
 * écrite ici.
 */
export const adminOrganizationsPort = (
  read: () => Promise<{
    readonly listOrganizations: (input: {
      readonly search: string | null
      readonly limit: number
      readonly offset: number
    }) => Promise<{
      readonly organizations: readonly {
        readonly organizationId: string
        readonly name: string
        readonly slug: string
        readonly memberCount: number
      }[]
      readonly total: number
    }>
    readonly describeOrganization: (organizationId: string) => Promise<{
      readonly organization: {
        readonly organizationId: string
        readonly name: string
        readonly slug: string
        readonly memberCount: number
      }
      readonly members: readonly {
        readonly userId: string
        readonly email: string
        readonly role: string
      }[]
    } | null>
    readonly membershipsOf: (userId: string) => Promise<
      readonly { readonly organizationId: string; readonly name: string; readonly role: string }[]
    >
  }>,
  billingOf: (
    organizationId: string,
  ) => Promise<{ readonly offerId: string | null; readonly state: string | null }>,
): AdminOrganizationsPort => ({
  listOrganizations: async (input) => {
    const listed = await readOr(async () => await (await read()).listOrganizations(input))

    if (!listed.ok) {
      return { ok: false }
    }

    const organizations = await Promise.all(
      listed.value.organizations.map(async (organization) => {
        const billed = await billingOf(organization.organizationId)

        return {
          ...organization,
          offerId: billed.offerId,
          subscriptionState: billed.state,
        }
      }),
    )

    return { ok: true, organizations, total: listed.value.total }
  },

  describeOrganization: async (organizationId) => {
    const described = await readOr(
      async () => await (await read()).describeOrganization(organizationId),
    )

    if (!described.ok) {
      return { ok: false }
    }

    if (described.value === null) {
      return { ok: true, detail: null }
    }

    const billed = await billingOf(organizationId)

    return {
      ok: true,
      detail: {
        organization: {
          ...described.value.organization,
          offerId: billed.offerId,
          subscriptionState: billed.state,
        },
        members: described.value.members,
      },
    }
  },

  membershipsOf: async (userId) => {
    const read_ = await readOr(async () => await (await read()).membershipsOf(userId))

    return read_.ok ? { ok: true, memberships: read_.value } : { ok: false }
  },
})

const organizations: AdminOrganizationsPort = adminOrganizationsPort(
  async () => (await import('./organizations')).organizations.backOffice,
  async (organizationId) =>
    await (
      await import('./billing')
    ).billing.subscriptionOf({ kind: 'organization', organizationId }),
)

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
    organizations,
    designatedEmail: designatedEmailOf(getEnv()),
  }))
}

export interface AdminFeature {
  /** Le module est-il monté ? **Une donnée**, pas un `if` de plus dans l'application. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, sans rien construire. */
  readonly prepare: () => void
  /**
   * **Les quatre lectures du back-office** (s37b2), telles que ses écrans les
   * demandent.
   *
   * Chacune porte sa **garde dans le module** : elle rend `not_found` à un
   * compte qui n'administre pas, et l'écran traduit ce refus en 404 — jamais en
   * 403, qui confirmerait que le back-office existe (`docs/security.md` §3).
   * Module coupé, elles rendent le même `not_found` sans ouvrir de connexion.
   *
   * Les paramètres d'URL entrent **bruts** : c'est le module qui les lit, avec
   * Zod, et un écran qui les aurait interprétés avant serait une seconde
   * frontière.
   */
  readonly accounts: (input: {
    readonly viewerId: string
    readonly parameters: unknown
  }) => Promise<BackOfficeView<AdminAccountsView>>
  readonly account: (input: {
    readonly viewerId: string
    readonly userId: string
  }) => Promise<BackOfficeView<AdminAccountView>>
  readonly organizations: (input: {
    readonly viewerId: string
    readonly parameters: unknown
  }) => Promise<BackOfficeView<AdminOrganizationsView>>
  readonly organization: (input: {
    readonly viewerId: string
    readonly organizationId: string
  }) => Promise<BackOfficeView<AdminOrganizationView>>
}

/** Le refus, écrit une fois : module coupé, aucune lecture n'ouvre de connexion. */
const ABSENT: BackOfficeView<never> = { ok: false, error: 'not_found' }

const backOfficeService = () => {
  provide()

  return requireAdminService()
}

export const admin: AdminFeature = mounted
  ? {
      available: true,
      prepare: provide,
      accounts: async ({ viewerId, parameters }) =>
        await backOfficeService().useCases.viewAccounts({
          request: await incomingRequest(),
          viewerId,
          query: parseBackOfficeQuery(parameters),
        }),
      account: async ({ viewerId, userId }) =>
        await backOfficeService().useCases.viewAccount({
          request: await incomingRequest(),
          viewerId,
          userId,
        }),
      organizations: async ({ viewerId, parameters }) =>
        await backOfficeService().useCases.viewOrganizations({
          request: await incomingRequest(),
          viewerId,
          query: parseBackOfficeQuery(parameters),
        }),
      organization: async ({ viewerId, organizationId }) =>
        await backOfficeService().useCases.viewOrganization({
          request: await incomingRequest(),
          viewerId,
          organizationId,
        }),
    }
  : {
      available: false,
      prepare: () => {},
      accounts: () => Promise.resolve(ABSENT),
      account: () => Promise.resolve(ABSENT),
      organizations: () => Promise.resolve(ABSENT),
      organization: () => Promise.resolve(ABSENT),
    }

/**
 * **L'emprunt en cours, tel que la coquille applicative l'affiche** (s37b2,
 * critère 5).
 *
 * Il est lu **ici et pas dans une page** : le bandeau vit dans la coquille, ce
 * qui est ce qui le fait survivre à une navigation complète. Une page qui le
 * rendrait le perdrait au premier lien suivi.
 *
 * **L'emprunt est reçu, jamais résolu**, et c'est le correctif du constat F3 de
 * la revue : cette fonction re-résolvait la session depuis le cookie
 * (`getSession`) *plus* la ligne de session, une ligne après que la coquille
 * l'avait déjà résolue par `currentViewer()` — deux allers-retours de base à
 * **chaque page authentifiée, dans toutes les configurations**, module `admin`
 * coupé compris. Elle ne touche plus rien : `currentViewer()` rend l'emprunteur
 * avec la session, en une seule lecture. `tests/marketing.test.ts` compte ce
 * que le rendu d'un compte connecté coûte en propre — zéro.
 *
 * **`stopAction` peut être `null` module coupé**, et le bandeau reste rendu :
 * une impersonation en cours ne peut plus être rendue à la main (elle expire
 * d'elle-même), mais la taire serait pire — la personne devant l'écran ne
 * saurait pas qu'elle regarde le compte d'un autre.
 */
export interface ImpersonationBannerState {
  readonly stopAction: string | null
}

export function currentImpersonation(
  impersonatedBy: string | null,
): ImpersonationBannerState | null {
  if (impersonatedBy === null) {
    return null
  }

  return { stopAction: mounted ? adminRoutePath('stopImpersonation') : null }
}

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
