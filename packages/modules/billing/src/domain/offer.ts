import { z } from 'zod'

/**
 * Le catalogue d'offres — **le critère 1 de la story**, et rien d'autre.
 *
 * « Les offres sont déclarées dans une configuration unique et typée
 * (`config/billing.ts`) : identifiant, mode, prix, devise, intervalle, période
 * d'essai, facturation au siège ; **une offre malformée fait échouer le
 * démarrage**. »
 *
 * Ce fichier est du `domain` : aucune base, aucun framework, aucun SDK
 * (ADR 006). `zod` y est admis — c'est une bibliothèque pure, et un type de
 * valeur validé appartient au domaine (`tooling/eslint/boundaries.ts`).
 *
 * **Le prix affiché n'autorise rien.** `amount` et `currency` sont ici pour
 * qu'un écran puisse dire combien coûte une offre sans appeler le fournisseur.
 * Ce qui est facturé, c'est `priceId` chez le fournisseur — jamais ce nombre.
 * Une divergence entre les deux se voit à l'écran ; elle ne se paie pas.
 */

export const BILLING_MODES = ['subscription', 'one_time'] as const
export type BillingMode = (typeof BILLING_MODES)[number]

export const BILLING_INTERVALS = ['month', 'year'] as const
export type BillingInterval = (typeof BILLING_INTERVALS)[number]

export interface BillingOffer {
  /** Identifiant stable, en `kebab-case`. C'est **la seule chose** que le navigateur envoie. */
  readonly id: string
  readonly mode: BillingMode
  /** Identifiant de prix chez le fournisseur. C'est lui qui fait foi. */
  readonly priceId: string
  /** Montant en **unités mineures** (2900 = 29,00 €). Affichage seulement. */
  readonly amount: number
  /** Code ISO-4217 en minuscules (`eur`, `usd`). */
  readonly currency: string
  /** Périodicité d'un abonnement. `null` pour un achat unique. */
  readonly interval: BillingInterval | null
  /** Période d'essai en jours, ou `null`. Jamais reçue du client. */
  readonly trialDays: number | null
  /**
   * Facturation au siège : la quantité suit le nombre de membres.
   *
   * **Sans effet sur une offre `one_time`** — un achat unique n'a pas de
   * quantité à suivre dans le temps, et `offerSyncsSeats` (`domain/seats.ts`)
   * rend `false` sur cette combinaison : le champ est alors accepté par le
   * catalogue et **ne produit rien**, silencieusement. Le poser sur un achat
   * unique n'est donc pas une erreur de configuration, c'est un vœu sans
   * conséquence.
   */
  readonly perSeat: boolean
}

export type BillingCatalogue = readonly BillingOffer[]

/** Refus du catalogue. Son message nomme l'offre **et** le champ fautif. */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingConfigError'
  }
}

/**
 * `kebab-case` strict : c'est l'identifiant qui voyage dans un corps de requête
 * et qui compose une clé de traduction. Une majuscule ou une espace le
 * rendraient ambigu à l'un des deux endroits.
 */
const OFFER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const offerSchema = z
  .object({
    id: z.string().regex(OFFER_ID, 'must be kebab-case (pro-monthly)'),
    mode: z.enum(BILLING_MODES),
    priceId: z.string().min(1),
    amount: z.int().min(0),
    currency: z.string().regex(/^[a-z]{3}$/, 'must be a lowercase ISO-4217 code (eur)'),
    interval: z.enum(BILLING_INTERVALS).nullable(),
    trialDays: z.int().positive().nullable(),
    perSeat: z.boolean(),
  })
  .superRefine((offer, ctx) => {
    // Un abonnement sans périodicité n'a pas de sens, et le fournisseur le
    // refuserait — mais au premier clic, en production. La règle croisée le dit
    // au démarrage.
    if (offer.mode === 'subscription' && offer.interval === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['interval'],
        message: 'is required for a subscription offer',
      })
    }

    if (offer.mode === 'one_time' && offer.interval !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['interval'],
        message: 'must be null for a one_time offer',
      })
    }

    // Une période d'essai sur un achat unique décrit une intention que rien
    // n'exécute : le fournisseur l'ignorerait en silence.
    if (offer.mode === 'one_time' && offer.trialDays !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['trialDays'],
        message: 'must be null for a one_time offer',
      })
    }
  })

/** Le nom sous lequel une offre fautive est désignée dans le message d'erreur. */
const nameOf = (value: unknown, index: number): string => {
  const id = (value as { id?: unknown } | null)?.id

  return typeof id === 'string' && id !== '' ? id : `#${index}`
}

/**
 * Valide le catalogue, ou lève en nommant l'offre et le champ.
 *
 * Elle **lève** au lieu de rendre un résultat discriminé, contrairement aux
 * ports : ce n'est pas une panne de tiers à dégrader, c'est une configuration
 * fausse. `apps/web/next.config.ts` l'appelle au démarrage, et le processus
 * s'arrête avant de servir une requête (`docs/security.md` §5).
 */
export function parseBillingCatalogue(value: unknown): BillingCatalogue {
  if (!Array.isArray(value)) {
    throw new BillingConfigError(
      'config/billing.ts : `offers` doit être une liste d’offres (mode, priceId, amount, currency, interval, trialDays, perSeat).',
    )
  }

  const offers: BillingOffer[] = []
  const byId = new Map<string, number>()
  const byPrice = new Map<string, string>()

  for (const [index, entry] of value.entries()) {
    const parsed = offerSchema.safeParse(entry)

    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(offre)'}: ${issue.message}`)
        .join('\n')

      throw new BillingConfigError(
        `config/billing.ts : offre « ${nameOf(entry, index)} » invalide :\n${details}`,
      )
    }

    const offer = parsed.data

    if (byId.has(offer.id)) {
      throw new BillingConfigError(
        `config/billing.ts : l’identifiant d’offre « ${offer.id} » est déclaré deux fois. ` +
          'Un identifiant désigne une offre et une seule — c’est lui que le navigateur envoie.',
      )
    }

    const owner = byPrice.get(offer.priceId)

    if (owner !== undefined) {
      throw new BillingConfigError(
        `config/billing.ts : le prix « ${offer.priceId} » est partagé par les offres « ${owner} » et « ${offer.id} ». ` +
          'Un abonnement reçu du fournisseur ne porte que son prix : deux offres dessus rendent la lecture inverse ambiguë.',
      )
    }

    byId.set(offer.id, index)
    byPrice.set(offer.priceId, offer.id)
    offers.push(offer)
  }

  return offers
}

/** L'offre qui porte ce prix, ou `null`. La lecture inverse, rendue non ambiguë par le refus ci-dessus. */
export const offerForPrice = (catalogue: BillingCatalogue, priceId: string): BillingOffer | null =>
  catalogue.find((candidate) => candidate.priceId === priceId) ?? null

/** L'offre qui porte cet identifiant, ou `null`. */
export const offerById = (catalogue: BillingCatalogue, id: string): BillingOffer | null =>
  catalogue.find((candidate) => candidate.id === id) ?? null

/**
 * Le prix, tel qu'il s'affiche.
 *
 * Une **dérivation**, donc du domaine : le montant est en unités mineures, et
 * l'écran ne doit pas avoir à savoir combien il y en a par unité. `Intl` est une
 * primitive du langage, pas un framework — la règle de pureté (ADR 006) refuse
 * un framework, un ORM ou un SDK, pas la bibliothèque standard.
 *
 * Elle ne prend que ce dont elle a besoin, pas une offre entière : c'est aussi
 * ce qui la rend appelable sur un abonnement dont l'offre n'est plus au
 * catalogue.
 */
export function formatOfferPrice(
  price: Pick<BillingOffer, 'amount' | 'currency'>,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency.toUpperCase(),
  }).format(price.amount / 100)
}
