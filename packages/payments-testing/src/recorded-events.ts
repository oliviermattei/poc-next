import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { RECORDED_EVENT_ID_PREFIX } from './checkout-events'
import type { CheckoutEvents, PurchaseCheckout, SubscriptionCheckout } from './checkout-events'

/**
 * **Le régime enregistré** (s25, ADR 048) : les événements que la route de
 * webhook reçoit viennent de **formes capturées chez le fournisseur**, jamais
 * du simulateur.
 *
 * ## Ce que ce fichier garantit, et ce qu'il ne garantit pas
 *
 * Il garantit **une seule chose**, et elle vaut d'être écrite : un événement
 * attendu dont l'enregistrement manque fait échouer l'exécution **en le
 * nommant**. Il n'existe aucun chemin, dans ce fichier ni ailleurs, qui
 * remplace un enregistrement absent par une forme fabriquée. C'est l'interdit
 * central de la story : un repli laisserait la CI verte en ayant cessé de
 * vérifier ce qu'elle prétend vérifier.
 *
 * Il ne garantit **pas** l'actualité de la forme. Un enregistrement fige la
 * forme du jour où il a été pris ; ce qu'il apporte n'est pas de savoir ce que
 * le fournisseur envoie aujourd'hui, c'est qu'un changement de **notre**
 * lecture devient visible sur un objet que nous n'avons pas écrit. Réenregistrer
 * reste un geste périodique, et sa date vit à côté des fichiers.
 *
 * ## La forme d'un fichier d'enregistrement
 *
 * ```json
 * {
 *   "kind": "subscription.created",
 *   "capturedAt": "2026-09-03",
 *   "capturedFrom": "clés de test Stripe, identifiants assainis",
 *   "event": { "id": "{{eventId}}", "created": "{{createdAt}}", … }
 * }
 * ```
 *
 * Les identifiants du compte de test sont remplacés, **avant d'être
 * versionnés**, par des jetons `{{…}}` que le rejeu remplit avec ceux de
 * l'exécution. Ce qui est versionné est la **forme** de l'événement — ce qui
 * dérive —, pas des identifiants, qui n'apprennent rien et exposent un compte
 * réel.
 *
 * Un jeton qu'aucune valeur ne remplit **fait échouer** : un `{{…}}` livré à la
 * route de webhook serait une chaîne parfaitement valide, donc un défaut
 * silencieux de plus.
 */

/**
 * Les natures d'événement dont le **parcours doré** a besoin.
 *
 * Trois, parce que le parcours a trois variantes : abonnement (deux
 * événements), achat unique (un seul), et checkout invité — qui rejoue les
 * mêmes formes avec une adresse collectée.
 */
export const GOLDEN_PATH_EVENT_KINDS = [
  'subscription.checkout-completed',
  'subscription.created',
  'purchase.checkout-completed',
] as const

export type RecordedEventKind = (typeof GOLDEN_PATH_EVENT_KINDS)[number]

const KNOWN_KINDS = new Set<string>(GOLDEN_PATH_EVENT_KINDS)

export interface StripeRecording {
  readonly kind: RecordedEventKind
  /** Le jour où la forme a été capturée. Sans elle, rien ne dit qu'elle est périmée. */
  readonly capturedAt: string
  /** D'où elle vient, en clair, pour qu'un simulateur ne puisse pas s'y glisser. */
  readonly capturedFrom: string
  readonly event: Record<string, unknown>
}

export interface RecordingStore {
  /** Le dossier lu — nommé dans les messages d'échec : « où aurait-il dû être ? ». */
  readonly directory: string
  readonly byKind: ReadonlyMap<RecordedEventKind, StripeRecording>
}

/** Un jeton non remplacé, tel qu'il resterait dans la charge utile. */
const LEFTOVER = /\{\{([A-Za-z]+)\}\}/

/**
 * Remplace les jetons d'un enregistrement par les identifiants de l'exécution.
 *
 * Deux passes, et l'ordre compte :
 *
 * 1. le jeton **seul dans sa chaîne** — `"{{createdAt}}"` — devient la valeur
 *    brute. C'est ce qui rend un horodatage à un nombre et une adresse absente
 *    à `null`, plutôt qu'à la chaîne `"null"` ;
 * 2. le jeton **enchâssé** — `"pi_{{sessionId}}"` — devient du texte échappé.
 *
 * Un jeton survivant aux deux passes **lève**, en le nommant.
 */
export const applyPlaceholders = (
  event: Record<string, unknown>,
  values: Readonly<Record<string, string | number | null>>,
  origin: string,
): Record<string, unknown> => {
  let json = JSON.stringify(event)

  for (const [key, value] of Object.entries(values)) {
    json = json.replaceAll(`"{{${key}}}"`, JSON.stringify(value))
  }

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      json = json.replaceAll(`{{${key}}}`, JSON.stringify(value).slice(1, -1))
    }
  }

  const leftover = LEFTOVER.exec(json)

  if (leftover !== null) {
    throw new Error(
      `L’enregistrement « ${origin} » porte le jeton « ${leftover[0]} », qu’aucune valeur de ` +
        'l’exécution ne remplit. Un jeton livré tel quel à la route de webhook serait une chaîne ' +
        'parfaitement valide : le rejeu refuse plutôt que de laisser passer.',
    )
  }

  return JSON.parse(json) as Record<string, unknown>
}

/** Lit un fichier d'enregistrement, ou refuse en nommant ce qui ne va pas. */
export const parseRecording = (source: unknown, origin: string): StripeRecording => {
  if (typeof source !== 'object' || source === null) {
    throw new Error(`L’enregistrement « ${origin} » n’est pas un objet JSON.`)
  }

  const candidate = source as Record<string, unknown>
  const kind = candidate['kind']

  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    throw new Error(
      `L’enregistrement « ${origin} » déclare la nature « ${String(kind)} », qui n’est pas une ` +
        `nature attendue du parcours doré (${GOLDEN_PATH_EVENT_KINDS.join(', ')}).`,
    )
  }

  // La date de capture n'est pas décorative : un enregistrement fige la forme
  // du jour où il a été pris, et sans sa date personne ne sait quand la
  // reprendre (ADR 048, conséquences).
  if (typeof candidate['capturedAt'] !== 'string' || candidate['capturedAt'] === '') {
    throw new Error(
      `L’enregistrement « ${origin} » n’a pas de « capturedAt » : une forme enregistrée fige le ` +
        'jour où elle a été prise, et sans sa date rien ne dit quand la reprendre.',
    )
  }

  if (typeof candidate['capturedFrom'] !== 'string' || candidate['capturedFrom'] === '') {
    throw new Error(`L’enregistrement « ${origin} » n’a pas de « capturedFrom ».`)
  }

  if (typeof candidate['event'] !== 'object' || candidate['event'] === null) {
    throw new Error(`L’enregistrement « ${origin} » ne porte aucun « event ».`)
  }

  return {
    kind: kind as RecordedEventKind,
    capturedAt: candidate['capturedAt'],
    capturedFrom: candidate['capturedFrom'],
    event: candidate['event'] as Record<string, unknown>,
  }
}

/**
 * Lit le dossier d'enregistrements.
 *
 * **Synchrone**, et c'est un choix : la construction du port de paiement ne
 * l'est pas, et un chargement différé rendrait un enregistrement manquant
 * visible seulement au moment du paiement — loin de l'endroit où le défaut vit.
 * Le dossier est local et minuscule ; il n'y a rien à attendre.
 *
 * Un dossier absent ou vide **ne lève pas** : c'est l'appelant qui sait de
 * quelles natures il a besoin, donc lui seul peut nommer ce qui manque. Un
 * fichier présent mais mal formé, en revanche, lève tout de suite — il ment sur
 * ce qu'il est.
 */
export const readRecordings = (directory: string): RecordingStore => {
  const byKind = new Map<RecordedEventKind, StripeRecording>()
  let entries: readonly string[]

  try {
    entries = readdirSync(directory)
  } catch {
    // Dossier absent : l'appelant nomme ce qui manque, pas la lecture.
    return { directory, byKind }
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    const recording = parseRecording(
      JSON.parse(readFileSync(join(directory, entry), 'utf8')),
      entry,
    )

    byKind.set(recording.kind, recording)
  }

  return { directory, byKind }
}

/**
 * **Les événements bruts à capturer**, tels que la procédure les produit
 * réellement (constat F5 de la revue de s25).
 *
 * `stripe listen --print-json > evenements.ndjson` écrit **un fichier** de
 * lignes JSON ; `stripe events resend` et une capture faite à la main écrivent
 * plutôt **un dossier** de fichiers. Les deux formes sont acceptées, parce que
 * les deux existent — la lecture n'attendait qu'un dossier, et la seule
 * procédure documentée produisait l'autre.
 *
 * **Un chemin absent refuse en le nommant.** `readdirSync` levait un `ENOENT`
 * brut, là où tout le reste de cette recette s'explique. Un chemin de capture
 * mal tapé est le cas le plus probable de toute la procédure.
 */
export const readCapturedEvents = (source: string): readonly Record<string, unknown>[] => {
  let directory: boolean

  try {
    directory = statSync(source).isDirectory()
  } catch {
    throw new Error(
      `GOLDEN_PATH_CAPTURE_FROM désigne « ${source} », qui n’existe pas. Attendu : le fichier ` +
        'écrit par `stripe listen --print-json > evenements.ndjson` (une ligne JSON par ' +
        'événement), ou un dossier contenant un fichier `.json` par événement brut.',
    )
  }

  if (directory) {
    return readdirSync(source)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => JSON.parse(readFileSync(join(source, entry), 'utf8')) as Record<string, unknown>)
  }

  const content = readFileSync(source, 'utf8')

  // Un fichier peut porter **un** événement mis en forme sur plusieurs lignes,
  // ou une ligne par événement. Tenter le document entier d'abord distingue les
  // deux sans deviner sur le nom du fichier.
  try {
    const whole = JSON.parse(content) as unknown

    return Array.isArray(whole)
      ? (whole as Record<string, unknown>[])
      : [whole as Record<string, unknown>]
  } catch {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

/** Les natures exigées qu'aucun enregistrement ne couvre, dans l'ordre déclaré. */
export const missingRecordingKinds = (
  store: RecordingStore,
  required: readonly RecordedEventKind[],
): readonly RecordedEventKind[] => required.filter((kind) => !store.byKind.has(kind))

/**
 * **Le refus**, écrit une fois : nommer l'événement, dire où il aurait dû être,
 * et interdire explicitement le repli.
 */
const requireRecording = (store: RecordingStore, kind: RecordedEventKind): StripeRecording => {
  const recording = store.byKind.get(kind)

  if (recording === undefined) {
    throw new Error(
      `Aucun enregistrement pour l’événement « ${kind} » dans ${store.directory}. ` +
        'Le régime enregistré ne retombe jamais sur le simulateur (ADR 048) : capturez la forme ' +
        'contre les clés de test du fournisseur (`GOLDEN_PATH_PAYMENTS=live pnpm test:golden-path`), ' +
        'puis versionnez-la assainie à côté de sa date.',
    )
  }

  return recording
}

/**
 * La source d'événements du régime enregistré.
 *
 * Elle n'a **aucune** branche de secours : chaque appel commence par exiger son
 * enregistrement, et lève si celui-ci n'est pas là.
 */
export const createRecordedCheckoutEvents = (store: RecordingStore): CheckoutEvents => ({
  subscription: (checkout: SubscriptionCheckout) => {
    const completed = requireRecording(store, 'subscription.checkout-completed')
    const created = requireRecording(store, 'subscription.created')

    const shared = {
      // **Le rejeu n'a pas d'appel amont** : l'événement enregistré portait
      // l'identifiant de la requête qui l'avait causé chez le fournisseur, et
      // cet identifiant a été assaini. Il revient à `null`, comme sur un
      // événement que le fournisseur émet de lui-même. L'aller-retour
      // « assainir puis rejouer » est éprouvé, et c'est lui qui a trouvé ce
      // jeton oublié.
      requestId: null,
      idempotencyKey: null,
      sessionId: checkout.sessionId,
      customerId: checkout.customerId,
      subscriptionId: checkout.subscriptionId,
      itemId: checkout.itemId,
      priceId: checkout.priceId,
      reference: checkout.reference,
      email: checkout.email,
      quantity: checkout.quantity,
      trialEnd: checkout.trialEnd,
      periodStart: checkout.periodStart,
      periodEnd: checkout.periodEnd,
    }

    // Deux identifiants distincts : le journal d'idempotence ne distingue les
    // événements que par là, et deux livraisons de même identifiant se
    // fondraient en une.
    const createdEvent = applyPlaceholders(
      created.event,
      {
        ...shared,
        eventId: `${RECORDED_EVENT_ID_PREFIX}sub_${checkout.sessionId}`,
        createdAt: checkout.createdAt + 1,
      },
      `${created.kind} (${store.directory})`,
    )
    const completedEvent = applyPlaceholders(
      completed.event,
      {
        ...shared,
        eventId: `${RECORDED_EVENT_ID_PREFIX}checkout_${checkout.sessionId}`,
        createdAt: checkout.createdAt,
      },
      `${completed.kind} (${store.directory})`,
    )

    const subscription = (createdEvent['data'] as { object?: unknown } | undefined)?.object

    if (typeof subscription !== 'object' || subscription === null) {
      throw new Error(
        `L’enregistrement « subscription.created » de ${store.directory} ne porte pas d’objet ` +
          '`data.object` : il ne peut pas tenir lieu d’abonnement.',
      )
    }

    // Le même désordre que ce que le fournisseur peut faire : le changement
    // d'abonnement part avant la session qui l'a causé (ADR 034).
    return { subscription: subscription as Record<string, unknown>, events: [createdEvent, completedEvent] }
  },

  purchase: (checkout: PurchaseCheckout) => {
    const recording = requireRecording(store, 'purchase.checkout-completed')

    return applyPlaceholders(
      recording.event,
      {
        requestId: null,
        idempotencyKey: null,
        sessionId: checkout.sessionId,
        customerId: checkout.customerId,
        paymentId: checkout.paymentId,
        reference: checkout.reference,
        email: checkout.email,
        eventId: `${RECORDED_EVENT_ID_PREFIX}purchase_${checkout.sessionId}`,
        createdAt: checkout.createdAt,
      },
      `${recording.kind} (${store.directory})`,
    )
  },
})

/**
 * **L'assainissement d'un événement réel, avant de le versionner** (ADR 048).
 *
 * L'inverse exact de `applyPlaceholders`, et il vit ici pour cette raison : les
 * deux partagent le vocabulaire des jetons. Séparés, la première divergence
 * serait un enregistrement qu'aucun rejeu ne saurait remplir — et elle ne se
 * verrait qu'au moment de rejouer.
 *
 * Ce qui est remplacé : **les identifiants et les horodatages**, c'est-à-dire
 * ce qui appartient à une exécution. Ce qui reste : **la forme** — les clés,
 * l'imbrication, les champs que nous ne lisons pas. C'est la forme qui dérive,
 * et c'est elle que le rejeu doit continuer de traverser.
 *
 * Ce qui n'est **pas** remplacé et ne doit jamais l'être : rien d'autre. Une
 * clé, une adresse ou un jeton de requête qui survivrait ici partirait dans le
 * dépôt — d'où le remplacement de `request.idempotency_key` et de l'adresse,
 * qui n'apprennent rien et exposent un compte réel.
 */
export const sanitizeStripeEvent = (
  raw: Record<string, unknown>,
  capturedAt: string,
): StripeRecording => {
  const data = raw['data']
  const object =
    typeof data === 'object' && data !== null
      ? ((data as Record<string, unknown>)['object'] as Record<string, unknown> | undefined)
      : undefined

  if (object === undefined) {
    throw new Error('Cet événement ne porte pas de `data.object` : il n’est pas assainissable.')
  }

  const type = raw['type']
  const mode = object['mode']

  const kind: RecordedEventKind | undefined =
    type === 'customer.subscription.created'
      ? 'subscription.created'
      : type === 'checkout.session.completed' && mode === 'subscription'
        ? 'subscription.checkout-completed'
        : type === 'checkout.session.completed' && mode === 'payment'
          ? 'purchase.checkout-completed'
          : undefined

  if (kind === undefined) {
    throw new Error(
      `L’événement « ${String(type)} » (mode « ${String(mode)} ») n’entre dans aucune nature du ` +
        `parcours doré (${GOLDEN_PATH_EVENT_KINDS.join(', ')}) : il n’y a rien à en enregistrer.`,
    )
  }

  /**
   * **Les nombres sont remplacés par leur chemin, les chaînes par leur
   * valeur** — et la distinction n'est pas un détail de mise en œuvre.
   *
   * Un identifiant de client apparaît à plusieurs endroits d'un même
   * événement : le remplacer par valeur est la seule façon de n'en oublier
   * aucun. Un nombre, lui, ne s'identifie pas : `1` est une quantité ici, un
   * compteur de webhooks trois lignes plus haut, et un morceau de `2026-01-01`
   * ailleurs. Remplacer un nombre par valeur mange la moitié du document —
   * mesuré, quatre cas au rouge avec un JSON devenu illisible.
   */
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
  const clonedObject = (cloned['data'] as { object: Record<string, unknown> }).object
  const clonedItem = (
    (clonedObject['items'] as { data?: Record<string, unknown>[] } | undefined)?.data ?? []
  )[0]

  const numberToken = (holder: Record<string, unknown> | undefined, key: string, token: string): void => {
    if (holder !== undefined && typeof holder[key] === 'number') {
      holder[key] = `{{${token}}}`
    }
  }

  numberToken(cloned, 'created', 'createdAt')
  numberToken(clonedObject, 'trial_end', 'trialEnd')
  numberToken(clonedItem, 'quantity', 'quantity')
  numberToken(clonedItem, 'current_period_start', 'periodStart')
  numberToken(clonedItem, 'current_period_end', 'periodEnd')

  const item = (
    (object['items'] as { data?: Record<string, unknown>[] } | undefined)?.data ?? []
  )[0]
  const details = object['customer_details'] as Record<string, unknown> | undefined

  /** Les identifiants **textuels**, remplacés partout où ils apparaissent. */
  const replacements: readonly [unknown, string][] = [
    [raw['id'], 'eventId'],
    [object['id'], kind === 'subscription.created' ? 'subscriptionId' : 'sessionId'],
    [object['customer'], 'customerId'],
    [object['subscription'], 'subscriptionId'],
    [object['payment_intent'], 'paymentId'],
    [object['client_reference_id'], 'reference'],
    [details?.['email'], 'email'],
    [item?.['id'], 'itemId'],
    [(item?.['price'] as Record<string, unknown> | undefined)?.['id'], 'priceId'],
    // Aucun rejeu ne s'en sert, et ils viennent d'un appel réel : ils ne
    // partent pas dans le dépôt.
    [(raw['request'] as Record<string, unknown> | undefined)?.['id'], 'requestId'],
    [
      (raw['request'] as Record<string, unknown> | undefined)?.['idempotency_key'],
      'idempotencyKey',
    ],
  ]

  let json = JSON.stringify(cloned)

  for (const [value, token] of replacements) {
    if (typeof value !== 'string' || value === '') continue

    json = json.replaceAll(JSON.stringify(value), `"{{${token}}}"`)
  }

  return {
    kind,
    capturedAt,
    capturedFrom: 'clés de test Stripe — identifiants et horodatages assainis (ADR 048)',
    event: JSON.parse(json) as Record<string, unknown>,
  }
}
