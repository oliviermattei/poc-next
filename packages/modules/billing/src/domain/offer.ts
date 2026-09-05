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
  /**
   * **Le plafond de membres de l'offre** (s47), ou rien : absent comme `null`,
   * l'offre est illimitée. Le champ est **facultatif** parce que le critère 1
   * l'exige — « une offre sans limite reste illimitée » —, et un catalogue
   * écrit avant s47 doit continuer de se lire sans être réécrit.
   *
   * **La règle ne dépend pas de `perSeat`**, et c'est une décision de s47
   * (décision 2) : la symétrie avec `offerSyncsSeats` serait fausse. Cette
   * règle-là (`perSeat && mode === 'subscription'`) exclut le forfait **et**
   * l'achat unique, parce que ni l'un ni l'autre n'a de quantité à corriger ;
   * un **plafond**, lui, a du sens sur un forfait — c'est même son emploi le
   * plus courant, vendre « jusqu'à cinq membres » à prix fixe. La
   * dérivation vit dans `domain/seats.ts` (`offerSeatLimit`), qui ne reçoit
   * que ce champ et ne *peut* donc voir ni `perSeat` ni `mode`.
   *
   * **Le catalogue, lui, le refuse non nul sur un achat unique** (constat M1
   * de la revue de s47) — le `superRefine` plus bas, sur le précédent de
   * `trialDays`. Ce n'est pas la règle qui exclut ce mode, c'est le **câblage**
   * qui n'existe pas : `syncSeats` résout l'offre courante depuis l'abonnement
   * vivant du périmètre, un encaissement unique n'en a aucun, et la fonction
   * sort en `not_applicable` avant d'avoir lu ce champ. Un plafond y serait un
   * vœu sans conséquence — exactement ce que `perSeat` est encore, juste
   * au-dessus, faute que quiconque l'ait refusé.
   *
   * **Le plafond ne retire jamais personne.** Abaissé sous l'effectif d'une
   * organisation — ici, ou par un changement d'offre —, il laisse tous les
   * membres en place et refuse le prochain ajout (critère 4, et le cimetière du
   * PRD, qui refuse toute suppression de données hors d'un `eject` explicite).
   */
  readonly seatLimit?: number | null
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
    // Facultatif, et **strictement positif** : un plafond de zéro décrirait une
    // organisation sans membre, ce qui n'existe pas (`createOrganization` écrit
    // le créateur dans la même transaction). Une offre sans plafond l'omet.
    seatLimit: z.int().positive().nullish(),
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

    // **Le même objet que la règle ci-dessus** (constat M1 de la revue de
    // s47) : un plafond sur un achat unique décrit une intention que rien
    // n'exécute. `syncSeats` résout l'offre courante depuis l'**abonnement
    // vivant** du périmètre ; un encaissement unique n'en a aucun, et la
    // fonction rend `not_applicable` avant d'avoir lu `seatLimit`. La règle
    // pure, elle, reste aveugle au mode — `offerSeatLimit` ne reçoit que
    // `seatLimit`, décision 2 de la story —, et c'est ici que le câblage
    // manquant se dit, au démarrage, en nommant le champ.
    //
    // `null` reste accepté : c'est la valeur qui dit « illimitée », au même
    // titre que le champ absent.
    if (offer.mode === 'one_time' && offer.seatLimit !== null && offer.seatLimit !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['seatLimit'],
        message:
          'must be null for a one_time offer (a one-time purchase has no live subscription to read an offer from, so the cap would never be applied)',
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
