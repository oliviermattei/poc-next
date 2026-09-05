/**
 * Les règles pures du centre de notifications (s32).
 *
 * Aucun framework, aucun ORM, aucun SDK — et **pas même `@repo/emails`**, que la
 * frontière de couches range parmi les sources interdites au `domain`
 * (ADR 006). L'union des canaux est donc déclarée ici, et la couche
 * `application` la confronte à celle de la fonction d'émission : elle reçoit un
 * `RecordNotificationInput` de `@repo/emails` et le passe à `allowedChannels`,
 * si bien qu'une divergence entre les deux unions **ne compile pas**.
 */

export const NOTIFICATIONS_MODULE_ID = 'notifications'

/** Le chemin de l'écran, servi par l'application. */
export const NOTIFICATIONS_SCREEN_PATH = '/notifications'

/** Le nombre de notifications par page du centre. */
export const NOTIFICATION_PAGE_SIZE = 20

export type NotificationChannel = 'in_app' | 'email'

/** Une préférence enregistrée : ce compte, ce type, ce canal. */
export interface ChannelPreference {
  readonly channel: NotificationChannel
  readonly enabled: boolean
}

/**
 * **Les canaux réellement retenus pour une émission** — la règle du critère 4.
 *
 * Trois sources, dans cet ordre, et l'ordre est la règle :
 *
 * 1. les canaux que le **type** déclare. Ils bornent tout le reste : une
 *    préférence enregistrée pour un canal que le type ne déclare plus ne
 *    ressuscite pas un envoi. Le catalogue est édité par le propriétaire du
 *    projet ; les préférences, elles, survivent en base ;
 * 2. la **préférence** du compte, quand elle existe, canal par canal ;
 * 3. le **défaut** du type sinon.
 *
 * L'ordre du résultat suit celui des canaux déclarés : il est donc stable d'une
 * émission à l'autre, ce qu'un parcours des préférences ne garantirait pas.
 */
export function allowedChannels(input: {
  readonly channels: readonly NotificationChannel[]
  readonly defaults: Readonly<Partial<Record<NotificationChannel, boolean>>>
  readonly preferences: readonly ChannelPreference[]
}): readonly NotificationChannel[] {
  return input.channels.filter((channel) => {
    const preference = input.preferences.find((candidate) => candidate.channel === channel)

    return preference === undefined ? (input.defaults[channel] ?? false) : preference.enabled
  })
}

/** Le périmètre de lecture de l'appelant : son compte, et ses organisations. */
export interface NotificationScope {
  readonly userId: string
  /**
   * Les organisations dont les notifications lui sont **lisibles maintenant**.
   * Vide en mode mono-utilisateur.
   *
   * Une liste, et pas un identifiant : la règle de visibilité n'a pas d'avis sur
   * le nombre. C'est le **point de composition** qui décide ce qu'il y met, et
   * `apps/web/lib/notifications.ts` y met aujourd'hui la seule organisation
   * active — avec ses raisons écrites là-bas (revue s32, R2). Le module ne
   * promet donc pas « toutes celles dont il est membre » : il obéit à la liste
   * qu'on lui donne.
   */
  readonly organizationIds: readonly string[]
}

/** Ce qu'il faut d'une notification pour décider si elle est visible. */
export interface NotificationAddress {
  readonly recipientId: string
  readonly organizationId: string | null
}

/**
 * **Qui voit une notification** — la règle du critère 5.
 *
 * Une notification est **adressée** : appartenir à l'organisation concernée ne
 * donne pas accès à celle d'un collègue. Et une notification d'organisation
 * disparaît pour qui n'en est plus membre — sans quoi un ancien membre
 * continuerait de lire ce qui se passe chez elle.
 *
 * La route traduit `false` en **404, jamais 403** (`docs/security.md` §3) : un
 * 403 confirmerait que cette notification existe.
 */
export function isVisibleTo(
  notification: NotificationAddress,
  viewer: NotificationScope,
): boolean {
  if (notification.recipientId !== viewer.userId) {
    return false
  }

  return (
    notification.organizationId === null ||
    viewer.organizationIds.includes(notification.organizationId)
  )
}

export interface NotificationPage {
  readonly page: number
  readonly pageCount: number
  readonly offset: number
  readonly limit: number
}

/**
 * La page à lire, bornée par le total.
 *
 * Une page hors bornes ramène à la première plutôt qu'à une liste vide : un
 * paramètre d'URL bricolé ne doit pas ressembler à « vous n'avez rien ».
 * `pageCount` vaut au moins 1 — une liste vide a une page, qui affiche l'état
 * vide.
 */
export function pageOf(input: {
  readonly page: number
  readonly total: number
  readonly pageSize?: number
}): NotificationPage {
  const limit = input.pageSize ?? NOTIFICATION_PAGE_SIZE
  const pageCount = Math.max(1, Math.ceil(input.total / limit))
  const page = Number.isInteger(input.page) && input.page >= 1 && input.page <= pageCount
    ? input.page
    : 1

  return { page, pageCount, offset: (page - 1) * limit, limit }
}

/**
 * Ce qu'une charge utile devient une fois **lue** : les références de compte
 * remplacées par leur valeur affichable (revue s32, R1).
 *
 * `null` désigne un compte qui n'existe plus. C'est une valeur, pas une
 * absence : l'écran y met son propre libellé, et la ligne de celui qui reste
 * demeure lisible. Rendre l'identifiant à la place afficherait une donnée
 * technique ; retirer la clé casserait l'interpolation du texte du type.
 */
export type ResolvedPayload = Readonly<Record<string, string | number | null>>

/**
 * Résout les références de compte d'une charge utile stockée.
 *
 * Elle est ici, pure, parce que c'est une règle : ce qui est **stocké** porte
 * des références — la ligne survit aux gens qu'elle nomme — et ce qui est
 * **affiché** porte des noms. Le module ne sait pas d'où viennent les noms ; ils
 * lui sont donnés.
 *
 * Seules les clés que le type **déclare** sont touchées : sans cette borne, une
 * valeur affichable qui ressemblerait à un identifiant serait réécrite au hasard
 * d'une homonymie.
 */
export function resolveActorReferences(
  payload: Readonly<Record<string, string | number>>,
  actors: readonly string[],
  names: ReadonlyMap<string, string>,
): ResolvedPayload {
  const resolved: Record<string, string | number | null> = { ...payload }

  for (const actor of actors) {
    const reference = payload[actor]

    if (typeof reference !== 'string') {
      continue
    }

    resolved[actor] = names.get(reference) ?? null
  }

  return resolved
}
