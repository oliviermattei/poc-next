import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'
import { z } from 'zod'

import type { BillingUseCases } from '../application/billing-use-cases'
import { BILLING_KEYS } from '../domain/message-keys'

/**
 * Les trois routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007 et 017). Module coupé, ces chemins ne sont dans aucune
 * table et le répartiteur répond 404 sans jamais atteindre ce fichier.
 *
 * `POST` partout : les trois changent un état serveur — deux ouvrent une
 * session chez le fournisseur, la troisième écrit l'état d'un abonnement. Un
 * `GET` qui écrit est une faute d'HTTP autant qu'une porte ouverte à la requête
 * intersite.
 */

const PATHS = {
  checkout: '/billing/checkout',
  portal: '/billing/portal',
  webhook: '/billing/webhook',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const billingRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/** L'écran servi par l'application. Le module en connaît le chemin, pas le rendu. */
export const BILLING_SCREEN_PATH = '/billing'

/**
 * Ce que le navigateur a le droit d'envoyer pour ouvrir un checkout : **un
 * identifiant d'offre, et rien d'autre**.
 *
 * Zod à la frontière (`docs/security.md` §4), et le schéma est **strict** : un
 * corps qui porterait un montant, une devise, un prix de fournisseur ou un
 * périmètre est refusé plutôt qu'ignoré en silence. Ignorer suffirait à la
 * sécurité ; refuser dit à l'appelant que ces champs n'existent pas, et fait
 * rougir un test si quelqu'un les ajoute un jour au client.
 */
const checkoutBodySchema = z.strictObject({
  offerId: z.string().min(1),
  locale: z.string().min(2).max(10).optional(),
})

const refuse = (key: string, status: number): Response =>
  // La clé de catalogue, jamais une phrase : c'est l'écran qui traduit, et le
  // corps ne dit rien du fournisseur ni de l'état interne.
  Response.json({ error: key }, { status })

const CHECKOUT_REFUSALS = {
  forbidden: { key: BILLING_KEYS.refusal.forbidden, status: 403 },
  unknown_offer: { key: BILLING_KEYS.refusal.unknownOffer, status: 400 },
  // 409, comme `already_subscribed` : c'est l'état du périmètre — et non la
  // requête — qui interdit l'opération. Le corps ne rend qu'une clé de
  // catalogue, et ne dit rien de l'achat en cours.
  already_purchased: { key: BILLING_KEYS.refusal.alreadyPurchased, status: 409 },
  // 409, comme le portail sans client : l'état du périmètre — et non la
  // requête — interdit l'opération. Le corps ne rend qu'une clé de catalogue,
  // et ne dit rien de l'abonnement en cours.
  already_subscribed: { key: BILLING_KEYS.refusal.alreadySubscribed, status: 409 },
  provider_unavailable: { key: BILLING_KEYS.refusal.providerUnavailable, status: 502 },
} as const

const PORTAL_REFUSALS = {
  forbidden: { key: BILLING_KEYS.refusal.forbidden, status: 403 },
  no_customer: { key: BILLING_KEYS.refusal.noCustomer, status: 409 },
  provider_unavailable: { key: BILLING_KEYS.refusal.providerUnavailable, status: 502 },
} as const

/**
 * Ce que les routes attendent : un **accès différé** aux cas d'usage.
 *
 * Le type vient de la couche `application`, jamais de `infrastructure` :
 * `presentation` et `infrastructure` ne se connaissent pas (ADR 006), et
 * `pnpm lint` le refuse. C'est `module.ts` — le point de composition, hors des
 * couches — qui branche l'un sur l'autre.
 */
export type BillingUseCasesAccess = () => { readonly useCases: BillingUseCases }

export function createBillingRoutes(service: BillingUseCasesAccess): readonly ModuleRoute[] {
  return [
    {
      method: 'POST',
      path: PATHS.checkout,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        if (context.session === null) {
          // Le répartiteur a déjà refusé l'appel anonyme ; sans session ici,
          // c'est le montage qui est cassé, et servir serait pire qu'échouer.
          return refuse(BILLING_KEYS.refusal.forbidden, 403)
        }

        const parsed = checkoutBodySchema.safeParse(await request.json().catch(() => null))

        if (!parsed.success) {
          return refuse(BILLING_KEYS.refusal.unknownOffer, 400)
        }

        const outcome = await service().useCases.openCheckout({
          session: context.session,
          offerId: parsed.data.offerId,
          locale: parsed.data.locale ?? null,
        })

        if (!outcome.ok) {
          const refusal = CHECKOUT_REFUSALS[outcome.reason]

          return refuse(refusal.key, refusal.status)
        }

        // **L'URL est rendue, pas suivie.** Une redirection 303 vers le
        // fournisseur serait soumise à `form-action 'self'` dans les navigateurs
        // fondés sur Chromium et WebKit — il faudrait déclarer deux origines de
        // plus dans `config/security.ts`. Le navigateur navigue lui-même
        // (`window.location.assign`), ce qu'aucune directive livrée ne borne.
        // Voir `docs/research/s19-subscribe-stripe.md` §7.
        return Response.json({ url: outcome.url }, { status: 200 })
      },
    },
    {
      method: 'POST',
      path: PATHS.portal,
      protection: { level: 'authenticated' },
      handler: async (_request, context) => {
        if (context.session === null) {
          return refuse(BILLING_KEYS.refusal.forbidden, 403)
        }

        const outcome = await service().useCases.openPortal({ session: context.session })

        if (!outcome.ok) {
          const refusal = PORTAL_REFUSALS[outcome.reason]

          return refuse(refusal.key, refusal.status)
        }

        return Response.json({ url: outcome.url }, { status: 200 })
      },
    },
    {
      /**
       * Le webhook entrant — **public**, et c'est la seule route de ce module
       * qui le soit.
       *
       * Sa garde n'est pas une session : c'est la **signature**, vérifiée avant
       * tout effet de bord (`docs/security.md` §4). Une signature invalide rend
       * 400 sans que la base ait été touchée.
       *
       * Le corps est lu **brut** (`request.text()`) : le reparser puis le
       * resérialiser change un octet et invalide la signature. Le répartiteur
       * passe la requête sans la lire, donc ces octets sont exactement ceux que
       * le fournisseur a signés.
       *
       * **Dette nommée** : ce point d'entrée public n'est pas limité en débit.
       * La limitation de débit appartient à s28 (`docs/architecture.md`), et un
       * appelant sans le secret n'écrit rien — il consomme du calcul. C'est la
       * même dette que celle déjà écrite pour `marketing`.
       */
      method: 'POST',
      path: PATHS.webhook,
      protection: { level: 'public' },
      handler: async (request) => {
        const signature = request.headers.get('stripe-signature') ?? ''
        const payload = await request.text()

        const outcome = await service().useCases.handleWebhook({ payload, signature })

        if (!outcome.ok) {
          // 400, et rien de plus : ni la raison exacte, ni ce que le
          // fournisseur a dit (`docs/security.md` §7).
          return Response.json({ error: 'invalid_webhook' }, { status: 400 })
        }

        // 200 même sur un rejeu : le fournisseur doit cesser de renvoyer un
        // événement qu'on a déjà traité. `applied` dit s'il a produit un effet,
        // et c'est ce que le harnais observe.
        return Response.json({ received: true, applied: outcome.applied }, { status: 200 })
      },
    },
  ]
}

/**
 * L'entrée de navigation du module.
 *
 * `authenticated` : la facturation n'est pas publique, et une entrée visible
 * pour un anonyme promettrait un écran qui le redirige. Le `href` est l'écran
 * servi par l'application, pas une route d'API — c'est une page réelle.
 */
export const billingNavigation: readonly NavigationEntry[] = [
  {
    id: 'billing',
    href: BILLING_SCREEN_PATH,
    labelKey: 'navigation.billing',
    order: 40,
    protection: { level: 'authenticated' },
  },
]
