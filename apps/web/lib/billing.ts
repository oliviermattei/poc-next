import { createStripePayments } from '@repo/adapter-stripe'
import { getEnv } from '@repo/config'
import type { ModuleScope, ModuleSession } from '@repo/core'
import { getDatabase } from '@repo/db'
import {
  BILLING_SCREEN_PATH,
  billingModule,
  billingRoutePath,
  EMPTY_BILLING_VIEW,
  provideBilling,
  requireBillingService,
  type BillingService,
  type BillingView,
  type ConfigureBillingOptions,
} from '@repo/module-billing'
import { createLocalPayments, LOCAL_CHECKOUT_PATH, type LocalPayments } from '@repo/payments-testing'
import type { Payments } from '@repo/ports'

import { resolveAuthConfig } from './auth-config'
import { billingCatalogue } from './billing-catalogue'
import { billingPermissionOf } from './billing-permission'
import { resolveBillingConfig } from './billing-config'
import { moduleRegistry } from './module-registry'
import { dataOwnerOf, organizations } from './organizations'

/**
 * Le point de composition de la facturation — le sixième du même modèle, après
 * le mailer, l'authentification, l'i18n, le site public et les organisations.
 *
 * C'est **le seul fichier de l'application** qui connaisse
 * `@repo/adapter-stripe` et `@repo/payments-testing` — l'unique implémentation
 * du port et son mode local —, et le seul qui regarde si ce module est monté.
 * Trois voisins portent chacun **une** règle, pour être éprouvés sans monter
 * quoi que ce soit : `lib/billing-config.ts` (quel fournisseur),
 * `lib/billing-catalogue.ts` (le catalogue validé, appelé aussi au démarrage) et
 * `lib/billing-permission.ts` (qui a le droit de gérer). Ailleurs — l'écran, la navigation — on lit `billing`, dont
 * la **forme est la même dans les deux états**.
 *
 * | | module activé | module coupé |
 * |---|---|---|
 * | `/billing` | l'écran | **404** |
 * | entrée de navigation | présente (authentifiée) | absente |
 * | `billing.view(session)` | la vue | vue vide, **aucune requête** |
 * | routes d'API | trois | **404** |
 */

/**
 * **Ce que ce fichier va chercher tout seul dans l'ambiance**, et que le
 * harnais lui donne à la place — la connexion, le port et l'URL publique.
 *
 * La même forme que `createAppMailer({ env })` (« injecté dans les tests ; lu
 * au démarrage sinon »), et pour une raison mesurée : les deux constats majeurs
 * de la revue — la permission et l'adresse du compte — vivaient **ici**, au
 * point de composition, et les tests ne pouvaient les atteindre qu'en
 * reconstruisant cette composition à côté. Une mutation posée ailleurs qu'à
 * l'endroit du défaut ne prouve rien : `canManage` neutralisé en `() => true`
 * et `emailOfScope` ramené à `null` laissaient 1 320 cas sur 1 320 au vert
 * (constats M1 et M2 de la seconde revue).
 *
 * Ce que cette ouverture **ne** donne pas, et c'est le point : ni le périmètre,
 * ni la permission, ni le nombre de sièges, ni l'adresse, ni le catalogue.
 * Ceux-là restent ceux de l'application, quel que soit l'appelant.
 */
export interface BillingRuntime {
  readonly db?: ConfigureBillingOptions['db']
  readonly payments?: Payments
  readonly appUrl?: string
}

export interface BillingFeature {
  /** Le module est-il monté ? **Une donnée**, lue par l'écran. */
  readonly available: boolean
  /** Donne au module ce qu'il ne peut pas se procurer, **sans rien construire**. */
  readonly prepare: (runtime?: BillingRuntime) => void
  readonly view: (session: ModuleSession, locale: string) => Promise<BillingView>
  /**
   * **La commande de réconciliation** (`docs/reliability.md` §5).
   *
   * Elle relit le fournisseur — la source de vérité — et réécrit le cache. Elle
   * est ici, et pas seulement dans le module, parce qu'un script de maintenance
   * ne construit pas de service : il passe par le point de composition, comme
   * l'application.
   *
   * Module coupé, elle ne touche rien et ne rend rien : il n'y a pas de client
   * à relire.
   */
  readonly reconcile: () => Promise<{ readonly customers: number; readonly changed: number }>
  /**
   * Le simulateur, ou `null`.
   *
   * Non `null` **uniquement** en mode local : c'est ce qui monte
   * `GET /api/billing-local-checkout`, et son absence est ce qui fait répondre
   * 404 à cette route partout ailleurs.
   *
   * Une **fonction**, jamais un accesseur : un accesseur s'évalue au premier
   * `{...billing}` venu — un double de test, une copie défensive —, et il
   * ouvrirait alors la base et lirait l'environnement sans que personne ne l'ait
   * demandé. Mesuré : le double de `tests/rendered-text.test.ts` échouait
   * exactement là.
   */
  readonly localCheckout: () => LocalPayments | null
}

/** L'état « module coupé », qui est une **donnée** et non une condition. */
const ABSENT_BILLING: BillingFeature = {
  available: false,
  prepare: () => {},
  view: () => Promise.resolve(EMPTY_BILLING_VIEW),
  reconcile: () => Promise.resolve({ customers: 0, changed: 0 }),
  localCheckout: () => null,
}

const mounted = moduleRegistry.moduleIds.includes(billingModule.id)

/**
 * Le **budget d'attente** d'un appel au fournisseur.
 *
 * Deux essais de 4 s, recul compris : le même arbitrage que le mailer, pour la
 * même raison — tenir sous les dix secondes d'une fonction serverless. Aux
 * défauts du SDK (80 s, une reprise non maîtrisée), un fournisseur muet ferait
 * attendre une minute et demie.
 */
const TIMEOUT_MS = 4_000
const MAX_ATTEMPTS = 2

let payments: Payments | null = null
let localPayments: LocalPayments | null = null

const paymentsOf = (): Payments => {
  if (payments !== null) {
    return payments
  }

  const config = resolveBillingConfig(getEnv())
  const appUrl = resolveAuthConfig(getEnv()).appUrl

  if (config.kind === 'local') {
    // **Le mode local est un outil, pas un second fournisseur** (ADR 008).
    // Il est choisi sur la configuration — jamais sur `NODE_ENV` —, et
    // `resolveBillingConfig` refuse le drapeau sous `NODE_ENV=production`.
    localPayments = createLocalPayments({ appUrl, webhookSecret: config.webhookSecret })
    payments = localPayments

    return payments
  }

  payments = createStripePayments({
    apiKey: config.apiKey,
    webhookSecret: config.webhookSecret,
    fetch: globalThis.fetch,
    timeoutMs: TIMEOUT_MS,
    maxAttempts: MAX_ATTEMPTS,
    backoff: { baseMs: 300, maxMs: 2_000, random: Math.random },
    sleep: async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    },
  })

  return payments
}

/**
 * Comment construire le service du module — **et non sa construction**.
 *
 * C'est ici que la **connexion** est donnée au module (ADR 020), ainsi que trois
 * choses qu'il ne peut pas connaître : le périmètre propriétaire, la permission
 * et le nombre de sièges.
 */
const provide = (runtime: BillingRuntime = {}): void => {
  provideBilling(() => ({
    db: runtime.db ?? getDatabase().db,
    payments: runtime.payments ?? paymentsOf(),
    // Le catalogue **déjà validé** — la même fonction que celle que
    // `next.config.ts` appelle au démarrage : le module ne lit jamais
    // `config/billing.ts`.
    catalogue: billingCatalogue(),
    appUrl: runtime.appUrl ?? resolveAuthConfig(getEnv()).appUrl,
    // **La fonction unique** qui dit à qui appartient une donnée
    // (`docs/architecture.md`, `docs/security.md` §3). Le module ne sait pas si
    // les organisations existent, et c'est ce qui lui évite une variante.
    ownerOf: (session) => dataOwnerOf(session),
    canManage,
    seatsOf,
    emailOfScope,
  }))
}

/**
 * **Qui a le droit de gérer la facturation** (ADR 034).
 *
 * La règle vit dans `lib/billing-permission.ts`, et pas ici : c'est ce qui
 * permet de la brancher, dans `tests/billing.test.ts`, sur la **vraie** vue du
 * module `organizations` avec un rôle réel en base — sans quoi rien ne tient le
 * fil entre la matrice de s17 et le refus de la route (constat F3 de la revue).
 * Ce fichier ne fait que lui donner la source des rôles.
 */
const canManage = billingPermissionOf(organizations)

/**
 * Le nombre de sièges d'un périmètre, résolu **côté serveur**.
 *
 * Une quantité reçue du navigateur est un prix reçu du navigateur. Périmètre
 * compte, ou organisations coupées : un siège.
 */
const seatsOf = async (scope: ModuleScope, userId: string): Promise<number> => {
  if (scope.kind !== 'organization' || !organizations.available) {
    return 1
  }

  // Les membres de l'organisation **courante de ce compte** : le périmètre est
  // celui que `dataOwnerOf` vient de résoudre, donc les deux désignent la même
  // organisation. Demander « les membres de l'organisation X » ouvrirait une
  // lecture par identifiant, que la porte de lecture de s15 ferme.
  const view = await organizations.view(userId)

  return Math.max(1, view.members.length)
}

/**
 * **L'adresse à laquelle le fournisseur écrira** — celle du compte qui ouvre le
 * checkout, dans les deux périmètres.
 *
 * Le module `billing` ne connaît pas `auth` et n'a pas le droit de lire ses
 * tables : c'est ici que l'identifiant devient une adresse, comme
 * `emailOfScope` le fait déjà pour `marketing`. Elle rendait `null` en dur sous
 * ce commentaire (constat F4 de la revue) — les clients Stripe créés par ce
 * boilerplate n'avaient donc aucune adresse, et personne ne pouvait les
 * recontacter.
 *
 * **Le compte appelant, y compris en périmètre organisation** : une
 * organisation n'a pas d'adresse à elle, et la personne qui ouvre le checkout
 * est celle qui recevra les reçus. C'est aussi pourquoi la résolution reçoit
 * l'appelant — le périmètre seul ne suffirait pas.
 *
 * **L'import est différé**, et ce n'est pas une préférence de style :
 * `lib/auth.ts` importe `next/headers`, et ce fichier-ci est chargé **hors de
 * Next** par `e2e/billing.spec.ts` et par `scripts/billing-reconcile.ts`. Un
 * import statique ferait échouer le chargement de tous les parcours avant
 * qu'aucun ne s'exécute — c'est la mesure qui a déjà décidé du câblage de
 * `marketing` dans `lib/module-services.ts`.
 */
const emailOfScope = async (_scope: ModuleScope, userId: string): Promise<string | null> => {
  const { appAuth } = await import('./auth')

  return (await appAuth().useCases.viewAccount(userId))?.email ?? null
}

const billingService = (): BillingService => {
  provide()

  return requireBillingService()
}

export const billing: BillingFeature = mounted
  ? {
      available: true,
      prepare: (runtime) => {
        provide(runtime)
      },
      view: async (session, locale) => await billingService().useCases.view({ session, locale }),
      reconcile: async () => await billingService().useCases.reconcile(),
      localCheckout: () => {
        // Lu à l'appel, pas à l'import : c'est la construction du port qui
        // décide, et elle est différée comme tout le reste.
        provide()
        paymentsOf()

        return localPayments
      },
    }
  : ABSENT_BILLING

/** Ce que les écrans et la route de simulation ont le droit de connaître du module. */
export { BILLING_SCREEN_PATH, LOCAL_CHECKOUT_PATH, billingRoutePath }
