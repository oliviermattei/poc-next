import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  RECORDED_EVENT_ID_PREFIX,
  simulatedCheckoutEvents,
  SIMULATED_EVENT_ID_PREFIX,
} from './checkout-events'
import {
  applyPlaceholders,
  createRecordedCheckoutEvents,
  GOLDEN_PATH_EVENT_KINDS,
  missingRecordingKinds,
  parseRecording,
  readCapturedEvents,
  readRecordings,
  sanitizeStripeEvent,
  type RecordingStore,
  type StripeRecording,
} from './recorded-events'

/**
 * **Le régime enregistré, et son refus de tout repli** (s25, ADR 048).
 *
 * Ce que ces cas protègent n'est pas la substitution de jetons : c'est
 * l'interdit central de la story. Un enregistrement absent doit faire échouer
 * bruyamment, en nommant l'événement — jamais retomber sur le simulateur, qui
 * laisserait la CI verte en ayant cessé de vérifier ce qu'elle prétend
 * vérifier.
 */

/** Une forme d'événement assainie, telle qu'un enregistrement en porte une. */
const aRecording = (kind: StripeRecording['kind'], event: Record<string, unknown>): StripeRecording => ({
  kind,
  capturedAt: '2026-09-03',
  capturedFrom: 'clés de test Stripe, identifiants assainis',
  event,
})

const CHECKOUT_SUBSCRIPTION = {
  id: '{{eventId}}',
  object: 'event',
  api_version: '2026-01-01',
  created: '{{createdAt}}',
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  type: 'checkout.session.completed',
  data: {
    object: {
      id: '{{sessionId}}',
      object: 'checkout.session',
      mode: 'subscription',
      customer: '{{customerId}}',
      subscription: '{{subscriptionId}}',
      client_reference_id: '{{reference}}',
      customer_details: { email: '{{email}}' },
    },
  },
}

const SUBSCRIPTION_CREATED = {
  id: '{{eventId}}',
  object: 'event',
  object_kind: 'subscription',
  created: '{{createdAt}}',
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  type: 'customer.subscription.created',
  data: {
    object: {
      id: '{{subscriptionId}}',
      object: 'subscription',
      customer: '{{customerId}}',
      status: 'trialing',
      cancel_at_period_end: false,
      trial_end: '{{trialEnd}}',
      items: {
        object: 'list',
        data: [
          {
            id: '{{itemId}}',
            object: 'subscription_item',
            quantity: '{{quantity}}',
            current_period_start: '{{periodStart}}',
            current_period_end: '{{periodEnd}}',
            price: { id: '{{priceId}}', object: 'price' },
          },
        ],
      },
    },
  },
}

const PURCHASE = {
  id: '{{eventId}}',
  object: 'event',
  created: '{{createdAt}}',
  livemode: false,
  pending_webhooks: 0,
  request: { id: null, idempotency_key: null },
  type: 'checkout.session.completed',
  data: {
    object: {
      id: '{{sessionId}}',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      customer: '{{customerId}}',
      payment_intent: '{{paymentId}}',
      client_reference_id: '{{reference}}',
      customer_details: { email: '{{email}}' },
    },
  },
}

const storeOf = (recordings: readonly StripeRecording[]): RecordingStore => ({
  directory: '/quelque/part/tests/fixtures/stripe-events',
  byKind: new Map(recordings.map((recording) => [recording.kind, recording])),
})

const A_SUBSCRIPTION_CHECKOUT = {
  sessionId: 'cs_test_golden',
  customerId: 'cus_test_golden',
  subscriptionId: 'sub_test_golden',
  itemId: 'si_test_golden',
  priceId: 'price_pro_monthly',
  reference: 'user:42',
  email: null,
  quantity: 1,
  createdAt: 1_788_100_000,
  trialEnd: 1_789_309_600,
  periodStart: 1_788_100_000,
  periodEnd: 1_791_902_000,
}

const A_PURCHASE_CHECKOUT = {
  sessionId: 'cs_test_life',
  customerId: 'cus_test_life',
  paymentId: 'pi_test_life',
  reference: 'user:42',
  email: 'invite@example.test',
  createdAt: 1_788_100_000,
}

describe('l’absence d’enregistrement (ADR 048)', () => {
  it('fait échouer en nommant l’événement manquant, sans rien rendre', () => {
    const events = createRecordedCheckoutEvents(
      storeOf([aRecording('subscription.created', SUBSCRIPTION_CREATED)]),
    )

    // L'un des deux est là, l'autre non : c'est exactement le cas où un repli
    // « tant pis, simulons celui-là » passerait inaperçu.
    expect(() => events.subscription(A_SUBSCRIPTION_CHECKOUT)).toThrow(
      /subscription\.checkout-completed/,
    )
  })

  it('dit où l’enregistrement aurait dû se trouver', () => {
    const events = createRecordedCheckoutEvents(storeOf([]))

    expect(() => events.purchase(A_PURCHASE_CHECKOUT)).toThrow(/tests\/fixtures\/stripe-events/)
  })

  it('refuse **parce que** l’enregistrement manque, et non pour un autre motif', () => {
    const events = createRecordedCheckoutEvents(storeOf([]))

    // `toThrow()` nu serait décoratif, et c'est mesuré : un repli qui rend une
    // forme vide lève quand même — plus loin, sur un autre motif — et le cas
    // restait vert. Ce que la story protège est le **refus nommé**, avec
    // l'interdit du repli écrit dedans.
    expect(() => events.subscription(A_SUBSCRIPTION_CHECKOUT)).toThrow(
      /ne retombe jamais sur le simulateur/,
    )
  })

  it('énumère ce qui manque au régime, pour que la commande le dise avant de démarrer', () => {
    const missing = missingRecordingKinds(
      storeOf([aRecording('purchase.checkout-completed', PURCHASE)]),
      GOLDEN_PATH_EVENT_KINDS,
    )

    expect(missing).toEqual(['subscription.checkout-completed', 'subscription.created'])
  })
})

describe('la forme enregistrée, rejouée avec les identifiants de l’exécution', () => {
  const events = createRecordedCheckoutEvents(
    storeOf([
      aRecording('subscription.checkout-completed', CHECKOUT_SUBSCRIPTION),
      aRecording('subscription.created', SUBSCRIPTION_CREATED),
      aRecording('purchase.checkout-completed', PURCHASE),
    ]),
  )

  it('rend l’abonnement et ses deux événements, aux identifiants de l’exécution', () => {
    const { subscription, events: delivered } = events.subscription(A_SUBSCRIPTION_CHECKOUT)

    expect(subscription['id']).toBe('sub_test_golden')
    expect(subscription['customer']).toBe('cus_test_golden')
    // Un nombre reste un nombre : un horodatage rendu en chaîne serait refusé
    // par la vérification de signature du fournisseur, mais seulement plus tard.
    expect(subscription['trial_end']).toBe(1_789_309_600)

    const types = delivered.map((event) => event['type'])

    expect(types).toEqual(['customer.subscription.created', 'checkout.session.completed'])
    // Deux événements, deux identifiants distincts : le journal d'idempotence
    // les distingue par cela et rien d'autre.
    expect(new Set(delivered.map((event) => event['id'])).size).toBe(2)
  })

  /**
   * **La marque du rejeu** — le signal positif qu'exige le constat F1 de la
   * revue de s25.
   *
   * Sans elle, une exécution annoncée « enregistrée » qui aurait en fait tourné
   * sur le simulateur reste verte et rien ne le dit : c'est exactement le repli
   * silencieux qu'ADR 048 existe pour fermer. Le parcours doré lit ces
   * identifiants dans le journal d'idempotence et refuse ceux de l'autre
   * régime ; ce cas-ci est ce qui empêche les deux marques de se confondre.
   */
  it('marque ses événements du préfixe du rejeu, que le simulateur n’emploie jamais', () => {
    const { events: delivered } = events.subscription(A_SUBSCRIPTION_CHECKOUT)
    const replayed = [...delivered, events.purchase(A_PURCHASE_CHECKOUT)].map((event) =>
      String(event['id']),
    )

    const simulated = [
      ...simulatedCheckoutEvents.subscription(A_SUBSCRIPTION_CHECKOUT).events,
      simulatedCheckoutEvents.purchase(A_PURCHASE_CHECKOUT),
    ].map((event) => String(event['id']))

    expect(RECORDED_EVENT_ID_PREFIX).not.toBe(SIMULATED_EVENT_ID_PREFIX)
    expect(replayed.every((id) => id.startsWith(RECORDED_EVENT_ID_PREFIX))).toBe(true)
    expect(replayed.some((id) => id.startsWith(SIMULATED_EVENT_ID_PREFIX))).toBe(false)
    // L'autre moitié du contrat, à son propre producteur : le simulateur ne
    // porte jamais la marque du rejeu.
    expect(simulated.every((id) => id.startsWith(SIMULATED_EVENT_ID_PREFIX))).toBe(true)
    expect(simulated.some((id) => id.startsWith(RECORDED_EVENT_ID_PREFIX))).toBe(false)
  })

  it('garde la forme du fournisseur, y compris ce que nous ne lisons pas', () => {
    const { events: delivered } = events.subscription(A_SUBSCRIPTION_CHECKOUT)
    const created = delivered.find((event) => event['type'] === 'customer.subscription.created')

    // `api_version` n'est lu nulle part chez nous — et c'est précisément ce qui
    // fait la différence entre un enregistrement et un simulateur : ce que nous
    // n'avons pas jugé nécessaire reste là.
    expect(delivered.some((event) => 'api_version' in event)).toBe(true)
    expect(created?.['object_kind']).toBe('subscription')
  })

  it('rend l’événement d’un achat unique avec l’adresse collectée', () => {
    const purchase = events.purchase(A_PURCHASE_CHECKOUT)
    const object = (purchase['data'] as { object: Record<string, unknown> }).object

    expect(object['payment_intent']).toBe('pi_test_life')
    expect((object['customer_details'] as Record<string, unknown>)['email']).toBe(
      'invite@example.test',
    )
  })

  it('rend `null` — et non la chaîne « null » — quand aucune adresse n’a été collectée', () => {
    const { events: delivered } = events.subscription(A_SUBSCRIPTION_CHECKOUT)
    const checkout = delivered.find((event) => event['type'] === 'checkout.session.completed')
    const object = (checkout?.['data'] as { object: Record<string, unknown> }).object

    expect((object['customer_details'] as Record<string, unknown>)['email']).toBeNull()
  })
})

describe('un enregistrement mal formé', () => {
  it('refuse un jeton qu’aucune valeur ne remplit, plutôt que de l’envoyer au webhook', () => {
    expect(() =>
      applyPlaceholders({ id: '{{inconnu}}' }, { eventId: 'evt_1' }, 'sonde.json'),
    ).toThrow(/inconnu/)
  })

  it('refuse un fichier dont la nature n’est pas une nature attendue', () => {
    expect(() =>
      parseRecording(
        { kind: 'invoice.paid', capturedAt: '2026-09-03', capturedFrom: 'x', event: {} },
        'invoice.json',
      ),
    ).toThrow(/invoice\.paid/)
  })

  it('refuse un enregistrement sans sa date de capture (ADR 048 : une forme fige un jour)', () => {
    expect(() =>
      parseRecording(
        { kind: 'subscription.created', capturedFrom: 'x', event: {} },
        'sans-date.json',
      ),
    ).toThrow(/capturedAt/)
  })
})

describe('la lecture du dossier d’enregistrements', () => {
  let directory = ''

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'stripe-events-'))
    await writeFile(
      join(directory, 'purchase.checkout-completed.json'),
      JSON.stringify(aRecording('purchase.checkout-completed', PURCHASE)),
      'utf8',
    )
    // Le README voisine les enregistrements : il ne doit pas être lu comme l'un
    // d'eux.
    await writeFile(join(directory, 'README.md'), '# formes enregistrées', 'utf8')
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('lit les enregistrements présents et ignore ce qui n’en est pas un', () => {
    const store = readRecordings(directory)

    expect([...store.byKind.keys()]).toEqual(['purchase.checkout-completed'])
  })

  it('rend un dossier vide plutôt que de lever : c’est l’appelant qui nomme ce qui manque', () => {
    const store = readRecordings(join(directory, 'inexistant'))

    expect(store.byKind.size).toBe(0)
    expect(missingRecordingKinds(store, GOLDEN_PATH_EVENT_KINDS)).toEqual([
      ...GOLDEN_PATH_EVENT_KINDS,
    ])
  })
})

/**
 * **La lecture des événements bruts à capturer** (constat F5 de la revue de
 * s25).
 *
 * La procédure documentée écrit `stripe listen --print-json > fichier.ndjson`,
 * c'est-à-dire **un fichier de lignes JSON** — pas un dossier. La lecture doit
 * donc accepter les deux formes, et surtout **refuser en nommant** un chemin
 * qui n'existe pas : `readdirSync` sur un chemin absent levait un `ENOENT` non
 * rattrapé, là où tout le reste de cette recette refuse en s'expliquant.
 */
describe('la lecture des événements bruts à capturer', () => {
  let workspace = ''

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'stripe-capture-'))
    await writeFile(
      join(workspace, 'evenements.ndjson'),
      [JSON.stringify({ id: 'evt_1' }), '', JSON.stringify({ id: 'evt_2' }), ''].join('\n'),
      'utf8',
    )
    await mkdir(join(workspace, 'dossier'), { recursive: true })
    await writeFile(
      join(workspace, 'dossier', 'un.json'),
      JSON.stringify({ id: 'evt_3' }, null, 2),
      'utf8',
    )
    await writeFile(join(workspace, 'dossier', 'notes.txt'), 'pas un événement', 'utf8')
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('lit un fichier NDJSON, ce que `stripe listen --print-json` écrit', () => {
    expect(readCapturedEvents(join(workspace, 'evenements.ndjson')).map((event) => event['id'])).toEqual([
      'evt_1',
      'evt_2',
    ])
  })

  it('lit aussi un dossier d’événements bruts, et ignore ce qui n’en est pas un', () => {
    expect(readCapturedEvents(join(workspace, 'dossier')).map((event) => event['id'])).toEqual([
      'evt_3',
    ])
  })

  it('refuse un chemin qui n’existe pas, en le nommant', () => {
    expect(() => readCapturedEvents(join(workspace, 'absent.ndjson'))).toThrow(
      /GOLDEN_PATH_CAPTURE_FROM/,
    )
  })
})

/**
 * **L'assainissement, qui est l'inverse du rejeu** (ADR 048).
 *
 * Il vit à côté du rejeu, et non dans le script de capture, parce que les deux
 * partagent le vocabulaire des jetons : séparés, la première divergence serait
 * un enregistrement qu'aucun rejeu ne saurait remplir.
 */
describe('l’assainissement d’un événement réel avant de le versionner', () => {
  const AN_EVENT = {
    id: 'evt_1PxYzReel',
    object: 'event',
    api_version: '2026-01-01',
    created: 1_770_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: 'req_reel', idempotency_key: 'cle-reelle' },
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_1PxReel',
        object: 'subscription',
        customer: 'cus_QxReel',
        status: 'trialing',
        cancel_at_period_end: false,
        trial_end: 1_771_209_600,
        items: {
          object: 'list',
          data: [
            {
              id: 'si_QxReel',
              object: 'subscription_item',
              quantity: 1,
              current_period_start: 1_770_000_000,
              current_period_end: 1_772_592_000,
              price: { id: 'price_1PxReel', object: 'price' },
            },
          ],
        },
      },
    },
  }

  it('reconnaît la nature de l’événement plutôt que de la demander', () => {
    expect(sanitizeStripeEvent(AN_EVENT, '2026-09-03').kind).toBe('subscription.created')
  })

  it('n’emporte aucun identifiant du compte de test', () => {
    const written = JSON.stringify(sanitizeStripeEvent(AN_EVENT, '2026-09-03'))

    for (const identifier of ['sub_1PxReel', 'cus_QxReel', 'si_QxReel', 'price_1PxReel', 'evt_1PxYzReel']) {
      expect(written, identifier).not.toContain(identifier)
    }
  })

  it('garde la forme, y compris les champs que nous ne lisons pas', () => {
    const recording = sanitizeStripeEvent(AN_EVENT, '2026-09-03')

    expect(recording.event['api_version']).toBe('2026-01-01')
    expect(recording.event['pending_webhooks']).toBe(1)
  })

  it('produit un enregistrement que le rejeu sait remplir — aller-retour complet', () => {
    const recording = sanitizeStripeEvent(AN_EVENT, '2026-09-03')

    // La preuve que l'assainissement et le rejeu parlent la même langue : un
    // jeton que le rejeu ne saurait pas remplir ferait échouer ici.
    const events = createRecordedCheckoutEvents(
      storeOf([recording, aRecording('subscription.checkout-completed', CHECKOUT_SUBSCRIPTION)]),
    )
    const { subscription } = events.subscription(A_SUBSCRIPTION_CHECKOUT)

    expect(subscription['id']).toBe('sub_test_golden')
    expect(subscription['customer']).toBe('cus_test_golden')
    expect(subscription['status']).toBe('trialing')
  })

  it('refuse un événement dont la nature n’entre pas dans le parcours doré', () => {
    expect(() => sanitizeStripeEvent({ ...AN_EVENT, type: 'invoice.paid' }, '2026-09-03')).toThrow(
      /invoice\.paid/,
    )
  })
})
