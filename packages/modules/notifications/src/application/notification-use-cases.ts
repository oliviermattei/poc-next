import {
  allowedChannels,
  pageOf,
  type ChannelPreference,
  type NotificationChannel,
  type NotificationScope,
  resolveActorReferences,
  type ResolvedPayload,
} from '../domain/notification'
import type {
  NotificationRecord,
  NotificationRepository,
  PreferenceRepository,
} from './ports'

/**
 * Les cas d'usage du centre de notifications.
 *
 * Ils ne connaissent ni la base, ni le mailer, ni la fonction d'émission : le
 * module est le **magasin** des notifications et des préférences, et rien
 * d'autre. C'est ce qui lui permet d'être coupé sans que l'émission disparaisse
 * avec lui (ADR 057) — le point de composition adapte ces cas d'usage à la
 * forme que `@repo/emails` attend, et rend `null` quand le module n'est pas là.
 */

/**
 * Ce qu'un type de notification apporte aux cas d'usage : ses canaux et ses
 * défauts, **reçus** du point de composition.
 *
 * Le module ne lit pas `config/notifications.ts` : le catalogue est du socle, et
 * un module qui le lirait en ferait sa propriété — c'est-à-dire le ferait
 * disparaître avec lui.
 */
export interface NotificationTypeSummary {
  readonly id: string
  readonly channels: readonly NotificationChannel[]
  readonly defaults: Readonly<Partial<Record<NotificationChannel, boolean>>>
  /**
   * Les clés de la charge utile **stockée** qui portent une référence de compte
   * (revue s32, R1). Résolues à la lecture, jamais à l'écriture : la ligne
   * survit aux gens qu'elle nomme.
   */
  readonly actors: readonly string[]
}

/** Une notification telle que l'écran l'affiche. */
export interface NotificationView {
  readonly id: string
  readonly type: string
  readonly organizationId: string | null
  /**
   * La charge utile **résolue** : les références de compte y sont devenues des
   * noms, et `null` désigne un compte qui n'existe plus (revue s32, R1).
   */
  readonly payload: ResolvedPayload
  readonly createdAt: Date
  readonly read: boolean
}

/** Le réglage d'un canal, pour un type, tel que l'écran de préférences l'affiche. */
export interface ChannelSetting {
  readonly channel: NotificationChannel
  readonly enabled: boolean
}

export interface TypePreferenceView {
  readonly type: string
  readonly channels: readonly ChannelSetting[]
}

export interface NotificationsView {
  readonly notifications: readonly NotificationView[]
  readonly unreadCount: number
  readonly page: number
  readonly pageCount: number
  readonly preferences: readonly TypePreferenceView[]
}

/** Ce que l'application affiche quand le module n'est pas activé : rien, et sans requête. */
export const EMPTY_NOTIFICATIONS_VIEW: NotificationsView = {
  notifications: [],
  unreadCount: 0,
  page: 1,
  pageCount: 1,
  preferences: [],
}

export type RecordOutcome =
  | { readonly ok: true; readonly channels: readonly NotificationChannel[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

export type MarkReadOutcome = 'ok' | 'not_found'

export type SetPreferenceOutcome = 'ok' | 'unknown_type' | 'unknown_channel'

const toView = (
  record: NotificationRecord,
  actors: readonly string[],
  names: ReadonlyMap<string, string>,
): NotificationView => ({
  id: record.id,
  type: record.type,
  organizationId: record.organizationId,
  payload: resolveActorReferences(record.payload, actors, names),
  createdAt: record.createdAt,
  read: record.readAt !== null,
})

const preferencesOf = (
  types: readonly NotificationTypeSummary[],
  recorded: readonly (ChannelPreference & { readonly type: string })[],
): readonly TypePreferenceView[] =>
  types.map((type) => {
    const forType = recorded.filter((preference) => preference.type === type.id)
    const enabled = allowedChannels({
      channels: type.channels,
      defaults: type.defaults,
      preferences: forType,
    })

    return {
      type: type.id,
      channels: type.channels.map((channel) => ({
        channel,
        enabled: enabled.includes(channel),
      })),
    }
  })

export interface NotificationUseCases {
  /**
   * Écrit ce qui doit l'être et rend **les canaux retenus**.
   *
   * C'est la moitié du critère 4 qui vit dans le module : la préférence est
   * lue ici, la ligne in-app n'est écrite que si ce canal est retenu, et
   * l'email est laissé à l'appelant — qui est la fonction d'émission unique.
   */
  record(input: {
    readonly type: string
    readonly userId: string
    readonly organizationId: string | null
    readonly channels: readonly NotificationChannel[]
    readonly defaults: Readonly<Partial<Record<NotificationChannel, boolean>>>
    readonly payload: Readonly<Record<string, string | number>>
  }): Promise<RecordOutcome>

  view(input: { readonly scope: NotificationScope; readonly page: number }): Promise<NotificationsView>

  /** Le compteur du badge : **l'ensemble**, jamais la page affichée. */
  unreadCount(scope: NotificationScope): Promise<number>

  markRead(scope: NotificationScope, id: string): Promise<MarkReadOutcome>

  markAllRead(scope: NotificationScope): Promise<number>

  setPreference(input: {
    readonly userId: string
    readonly type: string
    readonly channel: string
    readonly enabled: boolean
  }): Promise<SetPreferenceOutcome>

  purgeUser(userId: string): Promise<void>

  purgeOrganization(organizationId: string): Promise<void>

  exportUser(userId: string): Promise<Readonly<Record<string, unknown>>>

  exportOrganization(organizationId: string): Promise<Readonly<Record<string, unknown>>>
}

export function createNotificationUseCases(dependencies: {
  readonly notifications: NotificationRepository
  readonly preferences: PreferenceRepository
  readonly types: readonly NotificationTypeSummary[]
  /**
   * Les noms affichables de comptes, **donnés** au module (revue s32, R1).
   *
   * Le module stocke des références et ne sait pas les résoudre : il ne connaît
   * pas la forme d'un compte, exactement comme il ne connaît pas les
   * organisations. Un identifiant absent de la réponse est un compte qui
   * n'existe plus — la lecture le rend `null`, elle ne perd pas la ligne.
   */
  readonly displayNamesOf: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
  readonly newId: () => string
  readonly now: () => Date
}): NotificationUseCases {
  const { notifications, preferences, types, displayNamesOf, newId, now } = dependencies

  const typeOf = (id: string): NotificationTypeSummary | null =>
    types.find((candidate) => candidate.id === id) ?? null

  return {
    record: async (input) => {
      try {
        const recorded = await preferences.listForType(input.userId, input.type)
        const retained = allowedChannels({
          channels: input.channels,
          defaults: input.defaults,
          preferences: recorded,
        })

        if (retained.includes('in_app')) {
          await notifications.create({
            id: newId(),
            recipientId: input.userId,
            organizationId: input.organizationId,
            type: input.type,
            payload: input.payload,
            at: now(),
          })
        }

        return { ok: true, channels: retained }
      } catch (error) {
        // Le magasin est **la** dépendance de ce module : sans lui, il ne peut
        // ni écrire, ni lire une préférence. Rendre l'échec plutôt que le lever
        // laisse l'émission décider — elle ne fait pas tomber la requête de
        // l'appelant (`docs/reliability.md` §2).
        return {
          ok: false,
          error: {
            code: 'store_unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
        }
      }
    },

    view: async ({ scope, page }) => {
      const total = await notifications.countVisible(scope)
      const bounds = pageOf({ page, total })
      const [records, unreadCount, recorded] = await Promise.all([
        notifications.listVisible(scope, { offset: bounds.offset, limit: bounds.limit }),
        notifications.countUnread(scope),
        preferences.listForUser(scope.userId),
      ])

      // **Les références de compte sont résolues à la lecture, en une fois**
      // (revue s32, R1). Une résolution par ligne ferait un appel de port par
      // ligne ; celle-ci en fait **un**, et zéro quand aucun type de la page ne
      // déclare d'acteur — ce qui est le cas de toute page sans producteur.
      //
      // Un appel de port n'était pas une requête tant que le point de
      // composition le dépliait en un `viewAccount` par identifiant (revue
      // ronde 3, R3-3) : il passe désormais par une lecture groupée, et
      // `tests/notifications.test.ts` compte les requêtes `auth_user` émises.
      const references = [
        ...new Set(
          records.flatMap((record) =>
            (typeOf(record.type)?.actors ?? []).flatMap((actor) => {
              const value = record.payload[actor]

              return typeof value === 'string' ? [value] : []
            }),
          ),
        ),
      ]

      const names = references.length === 0 ? new Map<string, string>() : await displayNamesOf(references)

      return {
        notifications: records.map((record) => toView(record, typeOf(record.type)?.actors ?? [], names)),
        unreadCount,
        page: bounds.page,
        pageCount: bounds.pageCount,
        preferences: preferencesOf(types, recorded),
      }
    },

    unreadCount: async (scope) => await notifications.countUnread(scope),

    markRead: async (scope, id) =>
      (await notifications.markRead(scope, id, now())) ? 'ok' : 'not_found',

    markAllRead: async (scope) => await notifications.markAllRead(scope, now()),

    setPreference: async (input) => {
      const type = typeOf(input.type)

      if (type === null) {
        return 'unknown_type'
      }

      // Le canal vient d'un corps de requête : il n'est un canal que si **ce
      // type** le déclare. Un canal inconnu, ou connu mais non déclaré ici,
      // n'écrit rien — sinon la préférence enregistrée décrirait un envoi qui
      // n'existe pas.
      if (!type.channels.includes(input.channel as NotificationChannel)) {
        return 'unknown_channel'
      }

      await preferences.set({
        id: newId(),
        userId: input.userId,
        type: type.id,
        channel: input.channel as NotificationChannel,
        enabled: input.enabled,
        at: now(),
      })

      return 'ok'
    },

    purgeUser: async (userId) => {
      await notifications.deleteForUser(userId)
      await preferences.deleteForUser(userId)
    },

    purgeOrganization: async (organizationId) => {
      await notifications.deleteForOrganization(organizationId)
    },

    exportUser: async (userId) => ({
      notifications: await notifications.listForUser(userId),
      preferences: await preferences.listForUser(userId),
    }),

    exportOrganization: async (organizationId) => ({
      notifications: await notifications.listForOrganization(organizationId),
    }),
  }
}
