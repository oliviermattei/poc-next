import { type Env, getEnv } from '@repo/config'
import { getDatabase } from '@repo/db'
import {
  adminModule,
  adminRoutePath,
  parseBackOfficeFeedbackQuery,
  parseBackOfficeQuery,
  parseBackOfficeSubscriptionsQuery,
  provideAdmin,
  requireAdminService,
  type AdminAccountsView,
  type AdminAccountsPort,
  type AdminAccountView,
  type AdminFeedbackView,
  type AdminOrganizationsPort,
  type AdminOrganizationsView,
  type AdminRevenue,
  type AdminRevenuePort,
  type AdminRevenueView,
  type AdminOrganizationView,
  type AdminFeedbackPort,
  type AdminSubscriptionsPort,
  type AdminSubscriptionsView,
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

/**
 * **Ce que le back-office sait du revenu** (s38).
 *
 * Le module `admin` ne déclare pas `billing` dans ses `requires` : il ne peut ni
 * l'importer, ni lire ses tables, ni connaître ses offres. Ce fichier tient les
 * deux bouts, comme il le fait pour les organisations — et il ne décide rien du
 * calcul : le revenu est agrégé dans le module qui **possède** les montants.
 *
 * **Aucune condition sur un module ici.** Facturation coupée, la lecture rend un
 * revenu vide sans ouvrir de connexion ; ce qui disparaît alors est l'**entrée
 * de navigation**, déclarée par le module qui la porte (ADR 067), et l'écran
 * répond 404.
 *
 * L'import est **différé**, pour la raison exacte du port des organisations :
 * `lib/billing.ts` importe le point de composition de l'authentification, et un
 * import statique en sens inverse fermerait le cycle.
 */
export const adminRevenuePort = (
  read: (period: string | null) => Promise<AdminRevenue>,
): AdminRevenuePort => ({
  read: async (period) => {
    const snapshot = await readOr(async () => await read(period))

    // **Un port ne lève pas** : une base injoignable devient un refus, que le
    // module rend en `unavailable` et l'écran en alerte — jamais un revenu à
    // zéro, qui se lirait comme une réponse. `tests/admin.test.ts` neutralise
    // ce `readOr` et exige un rouge : sans lui, la branche `{ ok: false }` du
    // module n'était atteignable par rien (constat MJ4 de la revue de s37b1,
    // reconduit en s38).
    return snapshot.ok ? { ok: true, revenue: snapshot.value } : { ok: false }
  },
})

const revenue: AdminRevenuePort = adminRevenuePort(
  async (period) => await (await import('./billing')).billing.revenue(period),
)

/**
 * **Ce que le back-office sait des inscriptions publiques** (s37c).
 *
 * Le module `admin` ne déclare pas `marketing` dans ses `requires` : il ne peut
 * ni l'importer, ni lire `public_subscription`. Ce fichier tient les deux
 * bouts, comme il le fait pour les organisations et le revenu — et il ne décide
 * rien de la lecture : la requête vit dans le module qui **possède** la table.
 *
 * **Aucune condition sur un module ici.** Site public coupé, le lecteur rend du
 * vide sans ouvrir de connexion ; ce qui disparaît alors est l'**entrée de
 * navigation**, déclarée par le module qui la porte (ADR 067), et l'écran
 * répond 404.
 *
 * L'import est **différé**, pour la raison des deux autres ports : les points
 * de composition importent celui de l'authentification, et un import statique
 * en sens inverse fermerait le cycle.
 */
export const adminSubscriptionsPort = (
  read: () => Promise<{
    readonly list: (input: {
      readonly source: string | null
      readonly search: string | null
      readonly limit: number | null
      readonly offset: number
    }) => Promise<{
      readonly subscriptions: readonly {
        readonly id: string
        readonly email: string
        readonly source: string
        readonly locale: string
        readonly createdAt: Date
      }[]
      readonly total: number
    }>
    readonly sources: () => Promise<readonly string[]>
  }>,
): AdminSubscriptionsPort => ({
  listSubscriptions: async (input) => {
    // **Un port ne lève pas** : une base injoignable devient un refus, que le
    // module rend en `unavailable` et l'écran en alerte — jamais une liste
    // vide, qui se lirait comme « aucun inscrit ».
    const listed = await readOr(async () => await (await read()).list(input))

    return listed.ok ? { ok: true, ...listed.value } : { ok: false }
  },
  listSources: async () => {
    const sources = await readOr(async () => await (await read()).sources())

    return sources.ok ? { ok: true, sources: sources.value } : { ok: false }
  },
})

const subscriptions: AdminSubscriptionsPort = adminSubscriptionsPort(
  async () => (await import('./marketing')).marketingSubscriptions,
)

/**
 * **Ce que le back-office sait des retours** (s43).
 *
 * Le module `admin` ne déclare pas `feedback` dans ses `requires` — c'est
 * l'inverse : `feedback` requiert le back-office, parce que celui-ci est son
 * seul lecteur. Il ne peut donc ni l'importer, ni lire sa table, et ce fichier
 * tient les deux bouts comme il le fait pour les organisations, le revenu et
 * les inscriptions.
 *
 * **Aucune condition sur un module ici.** Retours coupés, le lecteur rend un
 * refus sans ouvrir de connexion ; ce qui disparaît alors est l'**entrée de
 * navigation**, déclarée par le module qui la porte (ADR 067), et l'écran
 * répond 404.
 *
 * **Le nom de l'auteur est résolu ici**, en une seule lecture pour la page
 * entière : le module qui possède les retours ne connaît pas la forme d'un
 * compte, et une adresse ou un nom stocké dans la ligne survivrait à
 * l'effacement de son porteur (revue s32, R1). Un identifiant absent de la
 * réponse est un compte effacé, et l'écran y met son propre libellé.
 *
 * L'import est **différé**, pour la raison des autres ports : les points de
 * composition importent celui de l'authentification, et un import statique en
 * sens inverse fermerait le cycle.
 */
export const adminFeedbackPort = (
  read: () => Promise<{
    readonly categories: readonly string[]
    readonly statuses: readonly string[]
    readonly list: (input: {
      readonly category: string | null
      readonly status: string | null
      readonly search: string | null
      readonly limit: number
      readonly offset: number
    }) => Promise<
      | {
          readonly ok: true
          readonly feedback: readonly {
            readonly id: string
            readonly authorId: string
            readonly category: string
            readonly message: string
            readonly originPath: string | null
            readonly status: string
            readonly createdAt: Date
          }[]
          readonly total: number
        }
      | { readonly ok: false }
    >
  }>,
  namesOf: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>,
): AdminFeedbackPort => ({
  listFeedback: async (input) => {
    // **Un port ne lève pas** : une base injoignable devient un refus, que le
    // module rend en `unavailable` et l'écran en alerte — jamais une liste
    // vide, qui se lirait comme « aucun retour ».
    const source = await readOr(read)

    if (!source.ok) {
      return { ok: false }
    }

    const listed = await readOr(async () => await source.value.list(input))

    if (!listed.ok || !listed.value.ok) {
      return { ok: false }
    }

    const page = listed.value
    // **Une lecture pour N identifiants**, dédoublonnés et bornés par la page :
    // vingt lectures ligne à ligne seraient vingt allers-retours.
    const names = await readOr(
      async () => await namesOf([...new Set(page.feedback.map((entry) => entry.authorId))]),
    )

    return {
      ok: true,
      total: page.total,
      categories: source.value.categories,
      statuses: source.value.statuses,
      feedback: page.feedback.map((entry) => ({
        ...entry,
        // Une lecture de noms en échec ne fait pas échouer la liste : le retour
        // reste lisible, et l'écran met son libellé de compte inconnu. Perdre
        // la page entière pour un libellé serait pire.
        authorName: names.ok ? (names.value.get(entry.authorId) ?? null) : null,
      })),
    }
  },
})

/**
 * **L'import est différé**, comme celui des trois autres ports, et ici il
 * l'est aussi pour une raison de règle : `tests/admin.test.ts` refuse que ce
 * fichier connaisse un second module au-delà du back-office. Il ne connaît que
 * `lib/feedback.ts`, qui est un point de composition, pas un module.
 */
const feedback: AdminFeedbackPort = adminFeedbackPort(
  async () => {
    const { feedback: feature } = await import('./feedback')

    return { categories: feature.categories, statuses: feature.statuses, list: feature.list }
  },
  async (userIds) => await (await import('./notifications')).displayNamesOf(userIds),
)

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
    revenue,
    subscriptions,
    feedback,
    designatedEmail: designatedEmailOf(getEnv()),
  }))
}

export interface AdminFeature {
  /** Le module est-il monté ? **Une donnée**, pas un `if` de plus dans l'application. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, sans rien construire. */
  readonly prepare: () => void
  /**
   * **Les lectures du back-office** (s37b2, s38), telles que ses écrans les
   * demandent — une par écran, aucun compte écrit ici : il vieillirait à côté
   * du type, et il l'a déjà fait (« quatre » pour cinq méthodes).
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
  /**
   * **Les rôles de plateforme d'un compte** (s56), pour la session que le socle
   * sert.
   *
   * C'est la quatrième fonction que `lib/auth.ts` branche sur ce qu'il ne peut
   * pas se procurer, à côté de `purgeScope`, `soleOwnerships` et
   * `releaseOrganizations`. Module coupé : la liste est **vide par la valeur**,
   * sans ouvrir de connexion — donc aucune route réservée à un rôle ne s'ouvre,
   * et rien nulle part ne teste un nom de module.
   */
  readonly platformRolesOf: (userId: string) => Promise<readonly string[]>
  /**
   * Le revenu de la plateforme (s38) : ni recherche, ni page — des indicateurs,
   * et une **période** (critère 4) qui ne borne que la moitié constatée.
   */
  readonly revenue: (input: {
    readonly viewerId: string
    readonly parameters: unknown
  }) => Promise<BackOfficeView<AdminRevenueView>>
  /**
   * **Les inscriptions publiques** (s37c) : une liste, avec sa source et sa
   * recherche. Les paramètres d'adresse entrent **bruts**, comme ceux des
   * autres listes — c'est le module qui les lit, avec Zod.
   */
  readonly subscriptions: (input: {
    readonly viewerId: string
    readonly parameters: unknown
  }) => Promise<BackOfficeView<AdminSubscriptionsView>>
  /**
   * **Les retours envoyés depuis l'application** (s43) : une liste, avec ses
   * deux filtres et sa recherche. Les paramètres d'adresse entrent **bruts**,
   * comme ceux des autres listes — c'est le module qui les lit, avec Zod.
   */
  readonly feedback: (input: {
    readonly viewerId: string
    readonly parameters: unknown
  }) => Promise<BackOfficeView<AdminFeedbackView>>
  /**
   * **La garde du back-office, telle qu'un autre module la reçoit** (s43).
   *
   * C'est la **même** fonction que celle des routes et des écrans — écrite une
   * seule fois dans `admin` : elle refuse une session empruntée avant de juger
   * le rôle, relit le rôle en base, et journalise le refus. Elle est exposée ici
   * pour que la route « marquer comme traité » puisse vivre dans le module qui
   * possède les retours, comme le critère 6 l'exige, **sans en écrire une
   * seconde copie**.
   *
   * **Fermée module coupé** : sans back-office, personne n'administre.
   */
  readonly authorizeBackOffice: (input: {
    readonly request: Request
    readonly userId: string
  }) => Promise<boolean>
  /**
   * **À qui s'adresse une notification de plateforme** (s43) — des identifiants,
   * et rien d'autre.
   *
   * Ce n'est pas une lecture du back-office et elle ne porte aucune garde : elle
   * n'est atteignable par aucune route, son seul appelant est un autre point de
   * composition (`lib/feedback.ts`), et l'adresse comme la langue sont relues du
   * socle par lui. `authorizeBackOffice` reste la garde **unique** des écrans et
   * des routes ; en faire décider celle-ci serait un second chemin
   * d'autorisation.
   *
   * **Vide module coupé**, sans toucher la base : sans back-office il n'y a
   * aucun superadmin, donc personne à prévenir — et le module qui appelle
   * déclare `admin` dans ses requis pour cette raison.
   */
  readonly superadminIds: () => Promise<readonly string[]>
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
      platformRolesOf: async (userId) =>
        await backOfficeService().useCases.platformRolesOf(userId),
      revenue: async ({ viewerId, parameters }) =>
        await backOfficeService().useCases.viewRevenue({
          request: await incomingRequest(),
          viewerId,
          parameters,
        }),
      subscriptions: async ({ viewerId, parameters }) =>
        await backOfficeService().useCases.viewSubscriptions({
          request: await incomingRequest(),
          viewerId,
          query: parseBackOfficeSubscriptionsQuery(parameters),
        }),
      feedback: async ({ viewerId, parameters }) =>
        await backOfficeService().useCases.viewFeedback({
          request: await incomingRequest(),
          viewerId,
          query: parseBackOfficeFeedbackQuery(parameters),
        }),
      authorizeBackOffice: async (input) =>
        await backOfficeService().useCases.authorizeBackOffice(input),
      superadminIds: async () => await backOfficeService().useCases.listSuperadmins(),
    }
  : {
      available: false,
      prepare: () => {},
      accounts: () => Promise.resolve(ABSENT),
      account: () => Promise.resolve(ABSENT),
      organizations: () => Promise.resolve(ABSENT),
      organization: () => Promise.resolve(ABSENT),
      // Aucun rôle, donc aucune route réservée à un rôle : le sens fermé, et il
      // vient de la **valeur**, pas d'une condition écrite plus haut.
      platformRolesOf: () => Promise.resolve([]),
      revenue: () => Promise.resolve(ABSENT),
      subscriptions: () => Promise.resolve(ABSENT),
      feedback: () => Promise.resolve(ABSENT),
      // **Fermée par défaut** : sans back-office, personne n'administre. Un
      // `true` ici ouvrirait la route d'écriture d'un autre module à tout compte
      // connecté, dans la configuration où plus rien ne peut le refuser.
      authorizeBackOffice: () => Promise.resolve(false),
      // Aucun superadmin sans back-office : le sens fermé, et il vient de la
      // **valeur**, pas d'une condition écrite plus haut.
      superadminIds: () => Promise.resolve([]),
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
