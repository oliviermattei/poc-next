import type {
  ChannelPreference,
  NotificationChannel,
  NotificationScope,
} from '../domain/notification'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur la connexion que le point de composition injecte — ce module
 * n'importe jamais `@repo/db` (ADR 020).
 */

/** Une notification, telle que les cas d'usage la lisent. */
export interface NotificationRecord {
  readonly id: string
  readonly recipientId: string
  readonly organizationId: string | null
  readonly type: string
  readonly payload: Readonly<Record<string, string | number>>
  readonly createdAt: Date
  readonly readAt: Date | null
}

export interface NotificationRepository {
  /** Écrit une notification. L'identifiant est fabriqué par le module. */
  create(input: {
    readonly id: string
    readonly recipientId: string
    readonly organizationId: string | null
    readonly type: string
    readonly payload: Readonly<Record<string, string | number>>
    readonly at: Date
  }): Promise<void>

  /**
   * Les notifications **du périmètre**, les plus récentes en premier.
   *
   * Le périmètre est le premier paramètre, et ce n'est pas un détail de style :
   * il n'existe pas de lecture qui puisse l'omettre — c'est la même discipline
   * que la porte de lecture unique du module `organizations` (revue de s15).
   */
  listVisible(
    scope: NotificationScope,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<readonly NotificationRecord[]>

  /** Combien de notifications le périmètre porte, toutes pages confondues. */
  countVisible(scope: NotificationScope): Promise<number>

  /** Combien de **non-lues** — ce que le badge affiche. Jamais dérivé d'une page. */
  countUnread(scope: NotificationScope): Promise<number>

  /**
   * Marque une notification comme lue **dans le périmètre**, et dit si elle
   * existait pour lui.
   *
   * `false` couvre les deux cas d'un seul mot — inconnue, ou appartenant à
   * quelqu'un d'autre —, et c'est ce qui fait répondre **404, jamais 403**
   * (`docs/security.md` §3) : la route ne peut pas les distinguer, donc elle ne
   * peut pas les trahir.
   */
  markRead(scope: NotificationScope, id: string, at: Date): Promise<boolean>

  /** Marque toutes les non-lues du périmètre, et rend combien l'ont été. */
  markAllRead(scope: NotificationScope, at: Date): Promise<number>

  /** Efface les notifications adressées à ce compte. */
  deleteForUser(userId: string): Promise<void>

  /** Efface les notifications d'une organisation. */
  deleteForOrganization(organizationId: string): Promise<void>

  /** Les lignes d'un compte, pour l'export. */
  listForUser(userId: string): Promise<readonly NotificationRecord[]>

  /** Les lignes d'une organisation, pour l'export. */
  listForOrganization(organizationId: string): Promise<readonly NotificationRecord[]>
}

/** Une préférence enregistrée, telle que les cas d'usage la lisent. */
export interface PreferenceRecord extends ChannelPreference {
  readonly type: string
}

export interface PreferenceRepository {
  /** Les préférences enregistrées d'un compte, tous types confondus. */
  listForUser(userId: string): Promise<readonly PreferenceRecord[]>

  /** Les préférences d'un compte pour **un** type. */
  listForType(userId: string, type: string): Promise<readonly PreferenceRecord[]>

  /**
   * Pose une préférence, ou remplace celle qui existe.
   *
   * L'unicité est portée par la base : rejouée, l'écriture n'ajoute pas une
   * seconde ligne (`docs/reliability.md` §1).
   */
  set(input: {
    readonly id: string
    readonly userId: string
    readonly type: string
    readonly channel: NotificationChannel
    readonly enabled: boolean
    readonly at: Date
  }): Promise<void>

  /** Efface les préférences d'un compte. */
  deleteForUser(userId: string): Promise<void>
}
