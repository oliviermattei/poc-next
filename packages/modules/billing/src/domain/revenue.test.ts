import { describe, expect, it } from 'vitest'

import { BILLING_INTERVALS } from './offer'
import {
  DEFAULT_REVENUE_PERIOD,
  REVENUE_CONTRIBUTIONS,
  REVENUE_PERIODS,
  REVENUE_STATES,
  countsTowardRecurringRevenue,
  monthlyAmountOf,
  parseRevenuePeriod,
  revenueContributionOf,
  revenuePeriodStart,
  revenueSnapshotOf,
} from './revenue'
import { BILLING_DISPLAY_STATES, displayStateOf } from './subscription'

/**
 * Les règles pures du revenu de plateforme (s38).
 *
 * **La normalisation est ici, et nulle part ailleurs.** Une offre annuelle ne
 * vaut pas son montant *par mois*, et `quantity` multiplie (facturation au
 * siège, s23) : c'est exactement là que se logent les erreurs de facteur douze,
 * et c'est le genre de défaut qu'aucun écran ne trahit — le nombre reste
 * plausible.
 *
 * **Ce que ce fichier ne prouve pas**, et où c'est prouvé : la *composition* —
 * résoudre l'offre par le prix stocké, en tirer le montant, la devise et
 * l'intervalle, puis appeler ces règles. Elle vit dans `application/
 * billing-use-cases.ts` et se mesure contre une vraie base dans
 * `tests/billing.test.ts` (« le revenu de la plateforme »). La ligne qui vivait
 * ici affirmait que les trois formes d'offre du catalogue **livré** y étaient
 * éprouvées : c'était faux dans les deux sens — cette suite-là bâtit son propre
 * catalogue, et aucun cas n'assertait alors `recurring` contre un abonnement
 * stocké (constat 1 de la revue).
 */

describe('la normalisation d’un montant en montant mensuel', () => {
  /**
   * **Les intervalles sont dérivés, jamais recopiés**, et l'exhaustivité est
   * tenue par **deux** commandes plutôt que par une phrase :
   *
   * - `pnpm typecheck` — `MONTHS_PER_INTERVAL` est `satisfies
   *   Record<BillingInterval, number>` : un troisième intervalle ne compile plus
   *   tant que personne n'a dit combien de mois il dure ;
   * - `pnpm test` — cette boucle : un intervalle non classé rend `NaN`, et la
   *   comparaison ci-dessous rougit en le nommant.
   *
   * La garantie écrite ici avant la revue de s38 n'était tenue par ni l'une ni
   * l'autre : ajouter `'quarter'` laissait la suite **entière** verte, et tout
   * ce qui n'était pas annuel passait pour du mensuel.
   */
  it('couvre chaque intervalle que le catalogue sait déclarer', () => {
    // L'anti-vacuité : une liste vide rendrait la boucle ci-dessous verte sans
    // rien vérifier.
    expect(BILLING_INTERVALS.length).toBeGreaterThan(0)

    for (const interval of BILLING_INTERVALS) {
      expect(
        monthlyAmountOf({ amount: 1200, interval, quantity: 1 }),
        interval,
      ).toBeGreaterThan(0)
    }
  })

  it('rend le montant tel quel pour une offre mensuelle', () => {
    expect(monthlyAmountOf({ amount: 2900, interval: 'month', quantity: 1 })).toBe(2900)
  })

  /** **Le facteur douze** : 29 000 unités mineures par an ne sont pas 29 000 par mois. */
  it('ramène une offre annuelle à un douzième', () => {
    expect(monthlyAmountOf({ amount: 29_000, interval: 'year', quantity: 1 })).toBe(
      Math.round(29_000 / 12),
    )
  })

  /**
   * **La quantité multiplie** (s23) : l'ignorer sous-estime en silence, et
   * d'autant plus que l'organisation est grosse.
   */
  it('multiplie par la quantité facturée', () => {
    expect(monthlyAmountOf({ amount: 2900, interval: 'month', quantity: 7 })).toBe(2900 * 7)
    expect(monthlyAmountOf({ amount: 29_000, interval: 'year', quantity: 3 })).toBe(
      Math.round((29_000 * 3) / 12),
    )
  })
})

/**
 * **La partition des états, dérivée de leur vocabulaire** — jamais recopiée.
 *
 * `BILLING_DISPLAY_STATES` est une liste d'exécution depuis s37b2 : ce que
 * chaque état apporte au revenu s'en dérive, et un septième état force une
 * décision au lieu d'hériter du silence. Le refus est le point : sans lui, un
 * état inconnu serait classé « ne compte pas » par défaut, et le revenu
 * baisserait sans que rien ne le dise.
 */
describe('ce que chaque état d’abonnement apporte au revenu récurrent', () => {
  it('classe chacun des états que l’écran sait afficher', () => {
    // L'anti-vacuité : une liste vide rendrait cette boucle verte sans rien
    // vérifier — le défaut relevé deux fois sur ce dépôt.
    expect(BILLING_DISPLAY_STATES.length).toBeGreaterThan(0)

    for (const state of BILLING_DISPLAY_STATES) {
      expect(REVENUE_CONTRIBUTIONS, state).toContain(revenueContributionOf(state))
    }
  })

  /**
   * **Le choix du plan, écrit plutôt que deviné** : `active` et `ending` paient
   * (celui qui se termine paie jusqu'au bout de sa période), `trialing` n'a
   * rien prélevé, et `past_due` est de l'argent qui n'arrive pas — le compter
   * est précisément la falsification contre laquelle la story met en garde.
   */
  it('ne compte que l’abonnement payé, en cours ou en résiliation', () => {
    expect(BILLING_DISPLAY_STATES.filter((state) => countsTowardRecurringRevenue(state))).toEqual(
      ['active', 'ending'],
    )
  })

  /**
   * **Un état que la partition ne classe pas est refusé**, jamais lu comme
   * « ne compte pas ». C'est ce qui fait qu'un septième état est une décision.
   */
  it('refuse un état qu’elle ne classe pas, en le nommant', () => {
    expect(() => revenueContributionOf('septieme_etat')).toThrowError(/septieme_etat/)
    expect(() => countsTowardRecurringRevenue('septieme_etat')).toThrowError(/septieme_etat/)
  })
})

/**
 * **L'agrégat de l'écran** : ce que les deux moitiés valent, et ce qu'elles ne
 * font jamais — se mélanger.
 */
describe('l’agrégat du revenu de plateforme', () => {
  const subscription = (
    row: Partial<Parameters<typeof revenueSnapshotOf>[0]['subscriptions'][number]> = {},
  ) => ({
    state: 'active' as const,
    amount: 2900,
    currency: 'eur',
    interval: 'month' as const,
    quantity: 1,
    ...row,
  })

  /** L'agrégat, sur la période par défaut : ce que ces cas-ci ne mesurent pas. */
  const snapshotOf = (
    input: Partial<Parameters<typeof revenueSnapshotOf>[0]>,
  ): ReturnType<typeof revenueSnapshotOf> =>
    revenueSnapshotOf({
      subscriptions: [],
      purchases: [],
      period: DEFAULT_REVENUE_PERIOD,
      ...input,
    })

  /** Le nombre d'abonnements dans un état, tel que l'écran le lira. */
  const countOf = (snapshot: ReturnType<typeof revenueSnapshotOf>, state: string): number =>
    snapshot.states.find((row) => row.state === state)?.subscriptions ?? -1

  /**
   * **Aucun total inter-devises.** `config/billing.ts` déclare une devise par
   * offre : additionner des euros et des dollars rend un nombre faux dans les
   * deux devises, et rien à l'écran ne le trahit.
   */
  it('groupe les montants par devise, et n’en somme jamais deux', () => {
    const snapshot = snapshotOf({
      subscriptions: [
        subscription({ currency: 'eur', amount: 2900 }),
        subscription({ currency: 'usd', amount: 3500 }),
        subscription({ currency: 'usd', amount: 1000 }),
      ],
      purchases: [],
    })

    expect(snapshot.recurring).toEqual([
      { currency: 'eur', amount: 2900, subscriptions: 1 },
      { currency: 'usd', amount: 4500, subscriptions: 2 },
    ])
  })

  /**
   * **La falsification que la story nomme** : compter un achat unique comme un
   * abonnement toujours actif. Rien dans le schéma ne l'empêche —
   * `billing_purchase` n'a ni statut d'abonnement ni fin de période —, c'est
   * donc une décision de calcul, et elle se prouve ici ou nulle part.
   */
  it('ne fait jamais entrer un achat unique dans le revenu récurrent', () => {
    const snapshot = snapshotOf({
      subscriptions: [],
      purchases: [{ amount: 49_000, currency: 'eur' }],
    })

    expect(snapshot.recurring).toEqual([])
    expect(snapshot.oneTime).toEqual([{ currency: 'eur', amount: 49_000, purchases: 1 }])
  })

  it('groupe le ponctuel par devise, exactement comme le récurrent', () => {
    const snapshot = snapshotOf({
      subscriptions: [],
      purchases: [
        { amount: 49_000, currency: 'eur' },
        { amount: 1_000, currency: 'usd' },
        { amount: 1_000, currency: 'eur' },
      ],
    })

    expect(snapshot.oneTime).toEqual([
      { currency: 'eur', amount: 50_000, purchases: 2 },
      { currency: 'usd', amount: 1_000, purchases: 1 },
    ])
  })

  /**
   * **Ce qu'on ne sait pas valoriser est compté à part, jamais à zéro** : un
   * abonnement dont le prix a quitté le catalogue ferait sinon baisser le
   * total sans que rien ne le dise.
   */
  it('compte à part ce qu’il ne sait pas valoriser, des deux côtés', () => {
    const snapshot = snapshotOf({
      subscriptions: [
        subscription(),
        subscription({ amount: null, currency: null, interval: null }),
        // Un état qui ne compte pas n'est pas « non valorisable » : il est
        // simplement hors du revenu.
        subscription({ state: 'trialing', amount: null, currency: null, interval: null }),
      ],
      purchases: [
        { amount: 49_000, currency: 'eur' },
        { amount: null, currency: null },
      ],
    })

    expect(snapshot.recurringUnvalued).toBe(1)
    expect(snapshot.oneTimeUnvalued).toBe(1)
    expect(snapshot.recurring).toEqual([{ currency: 'eur', amount: 2900, subscriptions: 1 }])
  })

  /** L'écran vide : des zéros et des listes vides, jamais une exception. */
  it('rend des listes vides quand la plateforme n’a rien vendu', () => {
    const snapshot = snapshotOf({ subscriptions: [], purchases: [] })

    expect(snapshot.recurring).toEqual([])
    expect(snapshot.oneTime).toEqual([])
    expect(snapshot.recurringUnvalued).toBe(0)
    expect(snapshot.oneTimeUnvalued).toBe(0)
    expect(snapshot.states.every((state) => state.subscriptions === 0)).toBe(true)
  })

  /**
   * **Chaque état rend sa ligne, même à zéro** (constat 3 de la revue).
   *
   * Une plateforme qui a trois abonnés et aucun essai en cours n'affichait
   * **aucun** chiffre d'essai : le lecteur ne pouvait pas distinguer « 0 » de
   * « non suivi », sur un écran dont toute la thèse est de dire ce que valent
   * ses nombres. Le critère 1 de la story demande les essais nommément.
   */
  it('rend une ligne par état, y compris ceux que personne n’a', () => {
    // L'anti-vacuité : sans état à rendre, tout ce qui suit serait vrai d'un
    // agrégat qui ne rendrait rien.
    expect(REVENUE_STATES.length).toBeGreaterThan(0)

    const snapshot = snapshotOf({ subscriptions: [subscription()] })

    expect(snapshot.states.map((state) => state.state)).toEqual([...REVENUE_STATES])
    expect(countOf(snapshot, 'active')).toBe(1)
    // L'état que personne n'a **a sa ligne**, et elle vaut zéro.
    expect(countOf(snapshot, 'trialing')).toBe(0)
  })

  /**
   * **L'absence d'abonnement n'est pas un état d'abonnement.** Une ligne
   * « aucun abonnement : 0 » dans une table d'abonnements ne veut rien dire, et
   * l'exclusion est dérivée de la règle elle-même plutôt qu'écrite.
   */
  it('ne rend pas l’état qui décrit l’absence d’abonnement', () => {
    expect(REVENUE_STATES).not.toContain(displayStateOf(null, new Date()))
    expect(snapshotOf({}).states.map((state) => state.state)).not.toContain(
      displayStateOf(null, new Date()),
    )
  })

  /**
   * **La période retenue revient à l'écran**, et c'est elle qui a filtré les
   * achats — pas celle que l'adresse portait. Sans ce retour, une valeur
   * inconnue afficherait une période courante différente de celle qui a servi.
   */
  it('rend chaque période proposée, et marque celle qui a servi à lire', () => {
    expect(REVENUE_PERIODS.length).toBeGreaterThan(1)

    const snapshot = snapshotOf({ period: '30d' })

    expect(snapshot.periods.map((period) => period.id)).toEqual([...REVENUE_PERIODS])
    expect(snapshot.periods.filter((period) => period.current).map((period) => period.id)).toEqual([
      '30d',
    ])
  })
})

/**
 * **La période, et la moitié du revenu à laquelle elle s'applique** (critère 4).
 *
 * Elle borne le **ponctuel**, qui porte une date d'encaissement. Elle ne borne
 * pas le récurrent : le dépôt ne stocke aucun instantané daté du parc
 * d'abonnements, donc personne ne peut dire ce que le MRR valait il y a six
 * mois. Ce que l'écran en dit est éprouvé dans `tests/admin.test.ts`.
 */
describe('la période retenue par l’écran de revenus', () => {
  it('donne un début à chaque période que l’écran propose', () => {
    // L'anti-vacuité : une liste vide rendrait la boucle verte sans rien lire.
    expect(REVENUE_PERIODS.length).toBeGreaterThan(0)

    const now = new Date('2026-09-06T12:00:00.000Z')
    const starts = REVENUE_PERIODS.map((period) => revenuePeriodStart(period, now))

    for (const [index, start] of starts.entries()) {
      const period = REVENUE_PERIODS[index]

      // Un début **borné** est dans le passé ; « depuis le début » n'en a pas.
      expect(start === null || start.getTime() < now.getTime(), period).toBe(true)
    }

    // Et au moins une période **borne** réellement : sans elle, le critère 4
    // serait tenu par trois libellés qui lisent tous la même chose.
    expect(starts.some((start) => start !== null)).toBe(true)
  })

  /**
   * **Les douze mois sont comptés en mois**, pas en 365 jours : un décompte en
   * jours dérive d'un jour à chaque année bissextile, et un bord de période faux
   * d'un jour ne se voit sur aucun écran.
   */
  it('recule d’un an calendaire pour les douze derniers mois', () => {
    expect(revenuePeriodStart('12m', new Date('2026-09-06T12:00:00.000Z'))).toEqual(
      new Date('2025-09-06T12:00:00.000Z'),
    )
    expect(revenuePeriodStart('30d', new Date('2026-09-06T12:00:00.000Z'))).toEqual(
      new Date('2026-08-07T12:00:00.000Z'),
    )
    expect(revenuePeriodStart('all', new Date('2026-09-06T12:00:00.000Z'))).toBeNull()
  })

  /**
   * **Une adresse forgée ne lève pas**, comme `parseBackOfficeQuery` : elle
   * retombe sur le défaut. Un 500 distinguerait cet écran d'une URL inventée.
   */
  it('retombe sur la période par défaut plutôt que de lever', () => {
    for (const forged of ['', 'quarter', '../etc', 42, null, undefined, ['30d']]) {
      expect(parseRevenuePeriod(forged), String(forged)).toBe(DEFAULT_REVENUE_PERIOD)
    }

    // Et elle lit ce que le vocabulaire déclare, sinon le repli serait total.
    for (const period of REVENUE_PERIODS) {
      expect(parseRevenuePeriod(period), period).toBe(period)
    }
  })
})
