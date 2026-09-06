import { z } from 'zod'

import type { BillingInterval } from './offer'
import { BILLING_DISPLAY_STATES, displayStateOf, type BillingDisplayState } from './subscription'

/**
 * **Ce que la plateforme encaisse, et ce que ce nombre vaut** (s38).
 *
 * `domain` pur : ni base, ni framework, ni SDK. Toutes les décisions de calcul
 * de l'écran de revenus vivent ici, parce qu'aucune d'elles n'est vérifiable à
 * l'œil sur un écran — un revenu faux reste un nombre plausible.
 */

/** Douze, écrit une fois. Un facteur recopié est un facteur qu'on oublie de changer. */
const MONTHS_PER_YEAR = 12

/**
 * **La partition des périodicités**, exactement comme celle des états
 * d'affichage plus bas — et pour la même raison.
 *
 * `satisfies Record<BillingInterval, number>` est la moitié qui se voit à la
 * compilation : un **troisième** intervalle ajouté à `BILLING_INTERVALS` ne
 * compile plus tant que personne n'a dit combien de mois il dure. Sans elle,
 * `interval === 'year' ? … : total` traitait en silence tout ce qui n'est pas
 * annuel comme mensuel : un trimestriel aurait été compté **trois fois trop
 * cher**, sans qu'aucune commande ne le voie (constat 2 de la revue de s38).
 *
 * La moitié qui tient à l'exécution est la boucle de `domain/revenue.test.ts` :
 * un intervalle non classé rend `undefined` mois, donc `NaN`, et
 * `toBeGreaterThan(0)` rougit. Deux commandes, `pnpm typecheck` et `pnpm test`.
 */
const MONTHS_PER_INTERVAL = {
  month: 1,
  year: MONTHS_PER_YEAR,
} satisfies Record<BillingInterval, number>

/**
 * **Le montant mensuel d'un abonnement**, normalisé et multiplié par sa
 * quantité.
 *
 * Deux erreurs classiques, et cette fonction existe pour les deux :
 *
 * 1. **le facteur douze** — une offre annuelle à 29 000 ne vaut pas 29 000 par
 *    mois. Additionner des périodicités différentes sans normaliser rend un
 *    nombre qui n'est comparable à rien ;
 * 2. **la quantité** — la facturation au siège (s23) fait qu'un abonnement vaut
 *    `amount × quantity`. L'ignorer sous-estime en silence, d'autant plus que
 *    l'organisation est grosse.
 *
 * `interval` est **typé**, jamais `null` : un achat unique n'a pas de
 * périodicité, et lui en prêter une est exactement la falsification que la
 * story nomme. Le compilateur refuse donc de le passer ici.
 *
 * L'arrondi est celui de l'unité mineure : un douzième d'année ne tombe pas
 * juste, et rendre une fraction de centime laisserait chaque appelant choisir
 * son arrondi.
 */
export function monthlyAmountOf(input: {
  readonly amount: number
  readonly interval: BillingInterval
  readonly quantity: number
}): number {
  return Math.round((input.amount * input.quantity) / MONTHS_PER_INTERVAL[input.interval])
}

/**
 * Ce qu'un état d'abonnement apporte au revenu récurrent — et **aucune de ces
 * réponses n'est « on verra »**.
 *
 * - `counted` : de l'argent prélevé, qui court ;
 * - `pending` : un droit ouvert dont rien n'a encore été prélevé ;
 * - `unpaid` : de l'argent attendu qui n'arrive pas ;
 * - `inactive` : plus rien.
 */
export const REVENUE_CONTRIBUTIONS = ['counted', 'pending', 'unpaid', 'inactive'] as const

export type RevenueContribution = (typeof REVENUE_CONTRIBUTIONS)[number]

/**
 * **La partition des états d'affichage**, et la seule copie qui existe.
 *
 * `satisfies Record<BillingDisplayState, …>` est la moitié qui se voit à la
 * compilation : un septième état d'affichage ne compile plus tant qu'il n'est
 * pas classé. `revenueContributionOf` est l'autre moitié — celle qui tient à
 * l'exécution, où les états arrivent en `string` depuis une base et un port.
 *
 * Les deux décisions du plan sont ici, écrites plutôt que devinées :
 *
 * - **`ending` compte** : un abonnement qui se termine paie jusqu'à la fin de
 *   la période déjà réglée ;
 * - **`trialing` et `past_due` ne comptent pas** : rien n'a été prélevé pour le
 *   premier, et compter le second serait compter de l'argent qui n'arrive pas
 *   — la falsification que la story nomme.
 */
const CONTRIBUTION_OF = {
  none: 'inactive',
  trialing: 'pending',
  active: 'counted',
  ending: 'counted',
  past_due: 'unpaid',
  expired: 'inactive',
} satisfies Record<BillingDisplayState, RevenueContribution>

/** Le refus d'un état inconnu. Il **nomme** l'état : sinon on cherche lequel. */
export class UnknownRevenueStateError extends Error {
  constructor(state: string) {
    super(
      `Revenu : l’état d’abonnement « ${state} » n’est classé ni comme comptant ni comme ne comptant pas. ` +
        'Classez-le dans `CONTRIBUTION_OF` (packages/modules/billing/src/domain/revenue.ts).',
    )
    this.name = 'UnknownRevenueStateError'
  }
}

/**
 * Ce que cet état apporte — **et un refus quand il n'est pas classé**.
 *
 * Le refus est la raison d'être de cette fonction. Un `?? 'inactive'` ferait
 * disparaître du revenu, en silence, tout abonnement d'un état ajouté depuis :
 * le nombre resterait plausible, et personne ne saurait qu'il a baissé pour une
 * raison qui n'est pas commerciale.
 */
export function revenueContributionOf(state: string): RevenueContribution {
  const contribution = (CONTRIBUTION_OF as Record<string, RevenueContribution | undefined>)[state]

  if (contribution === undefined) {
    throw new UnknownRevenueStateError(state)
  }

  return contribution
}

/** Cet état contribue-t-il au revenu récurrent ? La même règle, en booléen. */
export function countsTowardRecurringRevenue(state: string): boolean {
  return revenueContributionOf(state) === 'counted'
}

/**
 * Un abonnement, réduit à ce que le revenu en demande.
 *
 * `amount`, `currency` et `interval` viennent du **catalogue déclaré**
 * (`config/billing.ts`), résolus par le prix : le dépôt n'en stocke aucun. Ils
 * sont `null` quand le prix n'y figure plus — une offre retirée laisse ses
 * abonnements vivants derrière elle.
 */
export interface RevenueSubscriptionRow {
  readonly state: BillingDisplayState
  readonly amount: number | null
  readonly currency: string | null
  readonly interval: BillingInterval | null
  readonly quantity: number
}

/**
 * Un achat unique **encaissé**, réduit à ce qu'il a réellement rapporté.
 *
 * Ici le montant est **stocké** (`billing_purchase.amount`, « ce qui a été
 * réellement prélevé ») : c'est ce qui distingue cette moitié de l'écran de
 * l'autre, et la raison pour laquelle les deux ne s'additionnent jamais en un
 * chiffre unique.
 */
export interface RevenuePurchaseRow {
  readonly amount: number | null
  readonly currency: string | null
}

/** Le nombre d'abonnements dans un état, et si cet état compte. */
export interface RevenueStateCount {
  readonly state: BillingDisplayState
  readonly subscriptions: number
  readonly counted: boolean
}

/**
 * **Les états qu'un abonnement stocké peut porter** — tous, y compris ceux que
 * personne n'a encore.
 *
 * L'écran rend cette liste **entière**, avec ses zéros (constat 3 de la revue de
 * s38) : ne rendre que les états observés faisait qu'une plateforme sans essai
 * en cours n'affichait **aucun** chiffre d'essai, et le lecteur ne pouvait pas
 * distinguer « 0 » de « non suivi » — sur un écran dont toute la thèse est de
 * dire ce que valent ses nombres. Le critère 1 de la story demande d'ailleurs
 * les essais nommément.
 *
 * L'état exclu n'est pas écrit : il est **dérivé de la règle elle-même**.
 * `displayStateOf(null, …)` *est* la définition de « aucun abonnement », et une
 * ligne « aucun abonnement : 0 » dans une table d'abonnements ne veut rien dire.
 * Renommer cet état le suit sans que personne y pense.
 */
const NO_SUBSCRIPTION_STATE: BillingDisplayState = displayStateOf(null, new Date(0))

export const REVENUE_STATES: readonly BillingDisplayState[] = BILLING_DISPLAY_STATES.filter(
  (state) => state !== NO_SUBSCRIPTION_STATE,
)

/**
 * **Les périodes que l'écran sait proposer** (critère 4 de la story), et la
 * moitié du revenu à laquelle elles s'appliquent.
 *
 * Elles ne portent que sur le **ponctuel**, et c'est structurel plutôt que
 * paresseux : `billing_purchase` porte une date d'encaissement, donc un achat
 * appartient à une période. Le récurrent, lui, est un **instantané de l'état
 * courant** — le dépôt ne stocke aucun instantané daté du parc d'abonnements,
 * et rien ne permet de dire ce que le récurrent valait il y a six mois. Lui
 * appliquer une période rendrait un nombre inventé ; l'écran dit donc, à côté du
 * chiffre, que la période ne le concerne pas.
 *
 * `all` en défaut : une période par défaut plus étroite cacherait des ventes
 * sans que personne l'ait demandé.
 */
export const REVENUE_PERIODS = ['30d', '12m', 'all'] as const

export type RevenuePeriod = (typeof REVENUE_PERIODS)[number]

export const DEFAULT_REVENUE_PERIOD: RevenuePeriod = 'all'

/**
 * Ce que chaque période **dure**, classée une fois — la discipline de
 * `MONTHS_PER_INTERVAL` et de `CONTRIBUTION_OF` : une quatrième période ne
 * compile plus tant que personne n'a dit où elle commence.
 */
const PERIOD_SPAN = {
  '30d': { days: 30 },
  '12m': { months: 12 },
  all: null,
} satisfies Record<RevenuePeriod, { readonly days: number } | { readonly months: number } | null>

/**
 * Le début d'une période, ou `null` quand elle n'en a pas (« depuis le début »).
 *
 * Les douze mois sont comptés en **mois**, pas en 365 jours : un décompte en
 * jours dérive d'un jour à chaque année bissextile, et un bord de période faux
 * d'un jour est exactement le genre d'écart qu'aucun écran ne trahit.
 */
export function revenuePeriodStart(period: RevenuePeriod, now: Date): Date | null {
  const span = PERIOD_SPAN[period]

  if (span === null) {
    return null
  }

  const start = new Date(now.getTime())

  if ('days' in span) {
    start.setUTCDate(start.getUTCDate() - span.days)
  } else {
    start.setUTCMonth(start.getUTCMonth() - span.months)
  }

  return start
}

const periodSchema = z.enum(REVENUE_PERIODS)

/**
 * Lit la période demandée par une adresse — **Zod à la frontière**
 * (`docs/security.md` §4), et **jamais une exception**.
 *
 * Une valeur inconnue retombe sur le défaut, comme `parseBackOfficeQuery` le
 * fait d'une page illisible : une adresse forgée ne doit pas distinguer cet
 * écran d'une URL inventée en le faisant tomber en 500. Ce qui a réellement été
 * retenu revient à l'écran dans `RevenueSnapshot.periods`, si bien que la
 * période affichée comme courante est celle qui a servi à lire.
 */
export function parseRevenuePeriod(input: unknown): RevenuePeriod {
  const parsed = periodSchema.safeParse(input)

  return parsed.success ? parsed.data : DEFAULT_REVENUE_PERIOD
}

/** Une période proposée à l'écran, et si c'est celle qui a servi à lire. */
export interface RevenuePeriodChoice {
  readonly id: RevenuePeriod
  readonly current: boolean
}

/**
 * **Un montant, dans sa devise** — jamais un total qui les mélange.
 *
 * `config/billing.ts` déclare une devise **par offre** : rien n'oblige un
 * catalogue à n'en avoir qu'une, et additionner des euros et des dollars rend
 * un nombre faux dans les deux, qu'aucun écran ne trahit. Le groupement est
 * donc la forme de sortie, et non une mise en forme laissée à l'appelant — un
 * appelant qui recevrait un total ne pourrait plus le dégrouper.
 */
export interface RecurringByCurrency {
  readonly currency: string
  readonly amount: number
  readonly subscriptions: number
}

/** La même chose pour le ponctuel : le compteur y nomme des achats. */
export interface OneTimeByCurrency {
  readonly currency: string
  readonly amount: number
  readonly purchases: number
}

/** Ce que l'écran de revenus affiche, et rien d'autre. */
export interface RevenueSnapshot {
  /** Le récurrent mensuel — **estimé** depuis le catalogue déclaré, par devise. */
  readonly recurring: readonly RecurringByCurrency[]
  /**
   * Les abonnements qui comptent mais qu'on ne sait pas valoriser : leur prix
   * n'est plus au catalogue. **Comptés à part plutôt qu'à zéro** — sinon le
   * total baisse sans que rien ne le dise.
   */
  readonly recurringUnvalued: number
  /** Le ponctuel — **constaté**, tel que le fournisseur l'a confirmé, par devise. */
  readonly oneTime: readonly OneTimeByCurrency[]
  /** Les achats encaissés dont aucun montant n'a été enregistré. */
  readonly oneTimeUnvalued: number
  /**
   * **Tous** les états qu'un abonnement peut porter, dans l'ordre du
   * vocabulaire d'affichage, ceux à zéro compris (`REVENUE_STATES`).
   */
  readonly states: readonly RevenueStateCount[]
  /**
   * Les périodes proposées, et **celle qui a servi à lire le ponctuel**.
   *
   * Elle sort d'ici plutôt que d'être renvoyée telle que l'adresse la portait :
   * une valeur inconnue retombe sur le défaut, et l'écran doit montrer comme
   * courante la période qui a réellement filtré les achats.
   */
  readonly periods: readonly RevenuePeriodChoice[]
}

/** Un seau de devise : le montant, et combien de lignes l'ont rempli. */
interface CurrencyBucket {
  amount: number
  count: number
}

/**
 * Les seaux, **rangés par devise** et rendus dans un ordre stable.
 *
 * L'ordre est alphabétique et non celui de la base : deux lectures rendent la
 * même liste, et l'écran ne danse pas d'un rendu à l'autre.
 */
const bucketsOf = (): Map<string, CurrencyBucket> => new Map()

const fill = (buckets: Map<string, CurrencyBucket>, currency: string, amount: number): void => {
  const bucket = buckets.get(currency) ?? { amount: 0, count: 0 }

  bucket.amount += amount
  bucket.count += 1
  buckets.set(currency, bucket)
}

const sortedBuckets = (
  buckets: Map<string, CurrencyBucket>,
): readonly (readonly [string, CurrencyBucket])[] =>
  [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right))

/**
 * **L'agrégat de l'écran** — et le seul endroit où les deux moitiés se
 * rencontrent sans se mélanger.
 *
 * La falsification que la story nomme est ici, et nulle part ailleurs : un
 * achat unique n'est **jamais** un abonnement toujours actif. Rien dans le
 * schéma ne l'interdit — `billing_purchase` n'a ni statut d'abonnement ni fin
 * de période —, c'est donc une décision de calcul, tenue par les deux
 * accumulateurs séparés ci-dessous.
 */
export function revenueSnapshotOf(input: {
  readonly subscriptions: readonly RevenueSubscriptionRow[]
  /** Les achats **déjà bornés** à la période : le filtre est dans la requête. */
  readonly purchases: readonly RevenuePurchaseRow[]
  /** La période retenue pour ces achats. Elle ne borne pas les abonnements. */
  readonly period: RevenuePeriod
}): RevenueSnapshot {
  const counts = new Map<BillingDisplayState, number>()
  const recurring = bucketsOf()
  let recurringUnvalued = 0

  for (const subscription of input.subscriptions) {
    counts.set(subscription.state, (counts.get(subscription.state) ?? 0) + 1)

    if (!countsTowardRecurringRevenue(subscription.state)) {
      continue
    }

    // **Un abonnement sans prix connu n'est pas un abonnement à zéro** : son
    // offre a quitté le catalogue, et l'interval `null` d'un achat unique n'a
    // pas de valeur mensuelle. Compté à part, jamais dilué dans le total.
    if (
      subscription.amount === null ||
      subscription.currency === null ||
      subscription.interval === null
    ) {
      recurringUnvalued += 1

      continue
    }

    fill(
      recurring,
      subscription.currency,
      monthlyAmountOf({
        amount: subscription.amount,
        interval: subscription.interval,
        quantity: subscription.quantity,
      }),
    )
  }

  const oneTime = bucketsOf()
  let oneTimeUnvalued = 0

  for (const purchase of input.purchases) {
    if (purchase.amount === null || purchase.currency === null) {
      oneTimeUnvalued += 1

      continue
    }

    // **Le second seau, et il ne touche jamais le premier.** C'est ici que se
    // joue la falsification que la story nomme : un achat unique n'a ni statut
    // d'abonnement ni fin de période, rien dans le schéma n'empêche de le
    // sommer avec le récurrent, et le nombre resterait plausible.
    fill(oneTime, purchase.currency, purchase.amount)
  }

  return {
    recurring: sortedBuckets(recurring).map(([currency, bucket]) => ({
      currency,
      amount: bucket.amount,
      subscriptions: bucket.count,
    })),
    recurringUnvalued,
    oneTime: sortedBuckets(oneTime).map(([currency, bucket]) => ({
      currency,
      amount: bucket.amount,
      purchases: bucket.count,
    })),
    oneTimeUnvalued,
    // L'ordre est celui du **vocabulaire**, pas celui de la base : deux
    // lectures rendent la même liste, et un état ajouté trouve sa place sans
    // que personne ne la choisisse. La liste est **entière** : un état sans
    // abonnement rend sa ligne à zéro plutôt que de disparaître, sans quoi le
    // lecteur ne peut pas distinguer « aucun essai » de « essais non suivis ».
    states: REVENUE_STATES.map((state) => ({
      state,
      subscriptions: counts.get(state) ?? 0,
      counted: countsTowardRecurringRevenue(state),
    })),
    periods: REVENUE_PERIODS.map((id) => ({ id, current: id === input.period })),
  }
}
