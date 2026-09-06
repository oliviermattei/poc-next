import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'
import { z } from 'zod'

import type { BillingUseCases } from '../application/billing-use-cases'
import { checkoutClientOf } from '../domain/checkout-throttle'
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
  /**
   * **Le tunnel d'un visiteur sans compte** (s24, critère 1) — la première
   * route de paiement **publique** du dépôt.
   *
   * Un chemin distinct, et non un assouplissement de `/billing/checkout` : ce
   * dernier garde sa garde de session, et l'anonyme a sa propre entrée. Module
   * coupé, ce chemin n'est dans aucune table et le répartiteur répond **404**,
   * jamais 403 — c'est le huitième critère de la story.
   */
  guestCheckout: '/billing/guest-checkout',
  portal: '/billing/portal',
  webhook: '/billing/webhook',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const billingRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/** L'écran servi par l'application. Le module en connaît le chemin, pas le rendu. */
export const BILLING_SCREEN_PATH = '/billing'

/**
 * L'écran **public** de tarifs (s22), servi par l'application lui aussi.
 *
 * Il ne s'ajoute pas à `PATHS` : ce n'est pas une route montée par le module,
 * c'est une page de Next. Le module n'en connaît que le chemin, exactement
 * comme `BILLING_SCREEN_PATH` — et c'est ce chemin que l'entrée de navigation
 * ci-dessous désigne, jamais une route d'API.
 */
export const PRICING_SCREEN_PATH = '/pricing'

/**
 * **L'écran de revenus du back-office** (s38), servi par l'application.
 *
 * Le chemin vit ici, avec le module qui porte les montants, exactement comme
 * `ADMIN_ORGANIZATIONS_SCREEN_PATH` vit dans `organizations` : c'est ce qui
 * fait disparaître l'écran **avec la facturation** sans qu'aucun fichier du
 * back-office ne nomme ce module.
 */
export const ADMIN_REVENUE_SCREEN_PATH = '/admin/revenue'

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

/**
 * Les refus du checkout **invité**, et leurs statuts.
 *
 * `429` pour la limitation de débit : le seul refus de ce dépôt sur un chemin
 * de paiement, et il dit ce qu'il est — l'appelant peut réessayer plus tard.
 */
const GUEST_CHECKOUT_REFUSALS = {
  unknown_offer: { key: BILLING_KEYS.refusal.unknownOffer, status: 400 },
  rate_limited: { key: BILLING_KEYS.refusal.rateLimited, status: 429 },
  provider_unavailable: { key: BILLING_KEYS.refusal.providerUnavailable, status: 502 },
} as const

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
      /**
       * **Le checkout d'un visiteur sans compte** (s24).
       *
       * `public`, et c'est une surface d'abus : elle ouvre une session chez le
       * fournisseur pour un appelant dont on ne sait rien. Sa garde est la
       * **limitation de débit**, comptée en base et donc partagée entre
       * instances (`docs/security.md` §7) — un compteur en mémoire de processus
       * se contournerait en scalant horizontalement.
       *
       * Le corps est le **même** que celui du chemin authentifié : un
       * identifiant d'offre, une langue, et rien d'autre. Aucun périmètre,
       * aucune adresse, aucun montant — l'adresse est collectée par le
       * fournisseur sur sa page, et elle revient par le webhook.
       */
      method: 'POST',
      path: PATHS.guestCheckout,
      protection: { level: 'public' },
      rateLimit: { policy: 'guestCheckout' },
      handler: async (request) => {
        const parsed = checkoutBodySchema.safeParse(await request.json().catch(() => null))

        if (!parsed.success) {
          return refuse(BILLING_KEYS.refusal.unknownOffer, 400)
        }

        const outcome = await service().useCases.openGuestCheckout({
          offerId: parsed.data.offerId,
          locale: parsed.data.locale ?? null,
          // Ce que le serveur croit savoir de l'appelant — un en-tête, donc
          // falsifiable. Il ne sert qu'au seau de limitation, jamais à une
          // autorisation : il n'y a personne à autoriser sur cette route.
          client: checkoutClientOf(request.headers),
        })

        if (!outcome.ok) {
          const refusal = GUEST_CHECKOUT_REFUSALS[outcome.reason]

          return refuse(refusal.key, refusal.status)
        }

        // **L'URL est rendue, pas suivie** : la même raison qu'au chemin
        // authentifié — une redirection 303 vers le fournisseur serait soumise
        // à `form-action 'self'`.
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
      /**
       * **Large, et il faut dire pourquoi** (s28) : le fournisseur rejoue en
       * rafale après une panne, et un seuil serré transformerait sa reprise en
       * pertes d'événements. La signature reste vérifiée avant tout effet ; la
       * limitation n'est ici que le plafond de coût d'un flot non signé.
       */
      rateLimit: { policy: 'webhook' },
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
 * Les entrées de navigation du module, et leurs deux publics.
 *
 * `authenticated` pour la facturation : elle n'est pas publique, et une entrée
 * visible pour un anonyme promettrait un écran qui le redirige.
 *
 * `public` pour les tarifs (s22) : comparer les offres ne demande aucun compte,
 * et une offre qu'on ne voit pas ne se vend pas. Les deux `href` sont des écrans
 * servis par l'application, pas des routes d'API — ce sont des pages réelles.
 *
 * Les deux disparaissent **avec le module**, sans qu'aucun composant ne porte de
 * condition : c'est le sixième critère de la story, et il est tenu par le
 * registre, pas par l'écran.
 */
export const billingNavigation: readonly NavigationEntry[] = [
  {
    id: 'pricing',
    href: PRICING_SCREEN_PATH,
    labelKey: 'navigation.pricing',
    order: 10,
    protection: { level: 'public' },
  },
  {
    id: 'billing',
    href: BILLING_SCREEN_PATH,
    labelKey: 'navigation.billing',
    order: 40,
    protection: { level: 'authenticated' },
  },
  {
    /**
     * **L'entrée du back-office** (s38), déclarée **ici** et pas là-bas.
     *
     * C'est ce qui la fait disparaître avec ce module sans qu'aucun fichier du
     * back-office ne nomme `billing` : le registre n'agrège que les modules
     * activés, et la navigation de la surface `admin` en est dérivée (ADR 067).
     * La même forme que l'entrée « organisations » de s37b2.
     *
     * `authenticated` comme les autres entrées de cette surface : le rôle de
     * plateforme ne vit pas dans `ModuleSession.roles`, et la surface `admin`
     * n'est lue que par un écran que sa garde a déjà autorisé.
     */
    id: 'admin-revenue',
    href: ADMIN_REVENUE_SCREEN_PATH,
    labelKey: 'navigation.adminRevenue',
    order: 30,
    protection: { level: 'authenticated' },
    surface: 'admin',
  },
]
