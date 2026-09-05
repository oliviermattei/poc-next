import type { EmailTemplate, RegistryEmailTemplate } from '@repo/core'
import type { EmailData, Mailer } from '@repo/ports'

import { qualifyEmailTemplateId } from './render'

/**
 * **Le registre de types de notification et la fonction d'émission unique**
 * (s32, ADR 057).
 *
 * Ils vivent ici, dans `@repo/emails`, et non dans `packages/modules/notifications` :
 * le critère 7 de la story exige que « les types déclarés retombent sur un envoi
 * email direct » **quand le module est coupé**, donc l'émission ne peut pas
 * vivre dans le module qu'elle doit survivre. Le choix de ce package-ci est
 * dérivé du graphe de dépendances, pas du goût : `@repo/emails` est le seul
 * paquet qui importe déjà `@repo/core` (le contrat des templates) **et**
 * `@repo/ports` (le mailer), et c'est du socle — il n'est jamais coupé.
 *
 * Ce fichier ne connaît **ni la base, ni le module** : le centre de
 * notifications lui est **injecté**, et `null` est un état légitime — c'est
 * exactement ce que rend le point de composition de l'application quand le
 * registre de modules ne contient pas `notifications`.
 */

/** Les canaux qu'un type de notification peut emprunter. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

/**
 * L'espace de nommage des templates d'email des types de notification.
 *
 * Ce n'est **pas** un identifiant de module, et c'est le point : un type de
 * notification survit à la coupure du module `notifications`, donc son texte ne
 * peut pas être déclaré par un contrat de module — le registre n'agrège que les
 * modules activés. Le catalogue de rendu de l'émission est composé au point de
 * composition, à partir de ce registre-ci.
 */
export const NOTIFICATION_TEMPLATE_NAMESPACE = 'notification'

/** L'identifiant qualifié du template d'un type : `notification.<type>`. */
export const notificationTemplateId = (typeId: string): string =>
  qualifyEmailTemplateId(NOTIFICATION_TEMPLATE_NAMESPACE, typeId)

/**
 * Un type de notification, tel que `config/notifications.ts` le déclare.
 *
 * `defaults` dit ce que reçoit un compte qui n'a jamais rien réglé : la
 * préférence enregistrée l'emporte ensuite, canal par canal.
 */
export interface NotificationTypeDeclaration {
  readonly id: string
  readonly channels: readonly NotificationChannel[]
  readonly defaults: Readonly<Partial<Record<NotificationChannel, boolean>>>
  /** Le texte de l'email du type, par locale. `null` quand le type n'a pas de canal email. */
  readonly email: EmailTemplate | null
  /**
   * Les clés de la charge utile **stockée** qui portent une référence de compte
   * — un identifiant — et non une valeur affichable (revue s32, ronde 2, R1).
   *
   * Une ligne de notification survit aux gens qu'elle nomme : elle est adressée
   * à quelqu'un d'autre, et la purge d'un compte n'efface que ce qui lui est
   * **adressé**. Une adresse email écrite dans la charge utile resterait donc
   * lisible après l'effacement du compte qui la porte, pendant que le contrat du
   * module promet `retention: 'erase'`.
   *
   * D'où la règle, et c'est le précédent que tout producteur suivant copiera :
   * **ce qui est stocké porte des références, jamais des données personnelles**,
   * et la valeur affichable est résolue à la lecture. Une charge utile qui ne
   * porte aucune donnée personnelle n'a besoin d'aucune logique de purge.
   *
   * Vide quand le type n'en a pas. Jamais omis : le compilateur réclame la
   * ligne, parce qu'un producteur qui ne se pose pas la question est exactement
   * celui qui écrira une adresse.
   */
  readonly actors: readonly string[]
}

/**
 * Déclare un type de notification.
 *
 * Passer par cette fonction plutôt que par une annotation préserve l'union des
 * canaux déclarés : `defaults` est alors indexé par eux, comme `retention` l'est
 * par `dataCategories` dans le contrat de module. Le refus complet — un canal
 * sans défaut, un défaut sans canal — est tenu par
 * `createNotificationTypeRegistry`, qui nomme le type fautif : c'est la porte
 * que le compilateur ne garde pas, celle d'une déclaration élargie en `string`.
 */
export function defineNotificationType<const TChannel extends NotificationChannel>(declaration: {
  readonly id: string
  readonly channels: readonly TChannel[]
  readonly defaults: Readonly<Record<NoInfer<TChannel>, boolean>>
  readonly email: EmailTemplate | null
  readonly actors: readonly string[]
}): NotificationTypeDeclaration {
  return declaration
}

/** Une déclaration de type refusée. Le message nomme toujours le type en cause. */
export class NotificationTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotificationTypeError'
  }
}

export interface NotificationTypeRegistry {
  readonly types: readonly NotificationTypeDeclaration[]
  readonly ids: readonly string[]
  /** Les templates des types déclarés, prêts pour `createEmailRenderer`. */
  readonly emails: readonly RegistryEmailTemplate[]
  readonly find: (id: string) => NotificationTypeDeclaration | null
}

const quote = (value: string): string => `« ${value} »`

/**
 * Construit le registre des types, ou **refuse**.
 *
 * Le premier refus est le plancher de la story : **un registre vide est
 * refusé**. Sans lui, le balayage du critère 6 — « aucun type déclaré n'appelle
 * le mailer directement » — serait vert sur zéro type, c'est-à-dire vert sans
 * rien vérifier. C'est le mode d'échec qu'`AGENTS.md` nomme déjà pour
 * `pnpm test:minimal-profile` (« un balayage vide »).
 *
 * Les locales sont **reçues** comme celles de `buildRegistry` : ce package ne
 * lit aucune configuration.
 */
export function createNotificationTypeRegistry(input: {
  readonly types: readonly NotificationTypeDeclaration[]
  readonly locales: readonly string[]
}): NotificationTypeRegistry {
  const { types, locales } = input

  if (types.length === 0) {
    throw new NotificationTypeError(
      'Le registre de types de notification ne déclare aucun type. Un registre vide rendrait ' +
        'vert, sans rien vérifier, le balayage qui garantit qu’aucun type déclaré n’appelle le ' +
        'mailer directement (critère 6 de s32).',
    )
  }

  if (locales.length === 0) {
    throw new NotificationTypeError(
      'Le registre de types de notification est construit sans aucune locale : aucun template ne ' +
        'pourrait alors être contrôlé.',
    )
  }

  const seen = new Set<string>()

  for (const type of types) {
    if (seen.has(type.id)) {
      throw new NotificationTypeError(
        `Deux types de notification portent l’identifiant ${quote(type.id)}.`,
      )
    }

    seen.add(type.id)

    if (type.channels.length === 0) {
      throw new NotificationTypeError(
        `Le type ${quote(type.id)} ne déclare aucun canal : rien ne pourrait lui être livré.`,
      )
    }

    for (const channel of type.channels) {
      if (type.defaults[channel] === undefined) {
        throw new NotificationTypeError(
          `Le type ${quote(type.id)} déclare le canal ${quote(channel)} sans défaut : un compte ` +
            'qui n’a rien réglé ne saurait pas s’il le reçoit.',
        )
      }
    }

    for (const channel of Object.keys(type.defaults)) {
      if (!type.channels.includes(channel as NotificationChannel)) {
        throw new NotificationTypeError(
          `Le type ${quote(type.id)} donne un défaut au canal ${quote(channel)}, qu’il ne ` +
            'déclare pas.',
        )
      }
    }

    const declaredActors = new Set<string>()

    for (const actor of type.actors) {
      if (actor.trim() === '') {
        throw new NotificationTypeError(
          `Le type ${quote(type.id)} déclare une clé d’acteur vide : rien ne pourrait être ` +
            'résolu à la lecture.',
        )
      }

      if (declaredActors.has(actor)) {
        throw new NotificationTypeError(
          `Le type ${quote(type.id)} déclare deux fois la clé d’acteur ${quote(actor)}.`,
        )
      }

      declaredActors.add(actor)
    }

    const carriesEmail = type.channels.includes('email')

    if (carriesEmail && type.email === null) {
      throw new NotificationTypeError(
        `Le type ${quote(type.id)} déclare le canal « email » sans template : rien ne pourrait ` +
          'partir.',
      )
    }

    if (!carriesEmail && type.email !== null) {
      throw new NotificationTypeError(
        `Le type ${quote(type.id)} déclare un template d’email alors qu’il n’a pas de canal ` +
          '« email » : personne ne pourrait l’envoyer.',
      )
    }

    for (const locale of locales) {
      if (type.email !== null && type.email.locales[locale] === undefined) {
        throw new NotificationTypeError(
          `Le template du type ${quote(type.id)} n’est pas livré dans la locale ` +
            `${quote(locale)}, que l’application sert.`,
        )
      }
    }
  }

  const byId = new Map(types.map((type) => [type.id, type]))

  return {
    types,
    ids: types.map((type) => type.id),
    emails: types.flatMap((type) =>
      type.email === null
        ? []
        : [{ moduleId: NOTIFICATION_TEMPLATE_NAMESPACE, template: type.email }],
    ),
    find: (id) => byId.get(id) ?? null,
  }
}

/**
 * Ce que l'émission demande au centre de notifications : **écris ce qui doit
 * l'être, et dis-moi ce que tu as retenu**.
 *
 * Le centre — donc le module — est le seul à connaître les préférences du
 * compte : il lit la préférence par type et par canal, écrit la ligne in-app si
 * ce canal est retenu, et rend la liste des canaux retenus. L'émission n'a
 * aucune règle de préférence à elle ; elle obéit.
 */
export interface RecordNotificationInput {
  readonly type: string
  readonly userId: string
  /** Le périmètre de l'événement : une organisation, ou `null` pour un compte. */
  readonly organizationId: string | null
  /** Les canaux **possibles** du type, et leurs défauts. Le centre applique les préférences. */
  readonly channels: readonly NotificationChannel[]
  readonly defaults: Readonly<Partial<Record<NotificationChannel, boolean>>>
  readonly data: EmailData
}

export type RecordNotificationResult =
  | { readonly ok: true; readonly channels: readonly NotificationChannel[] }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Le centre de notifications, **injecté**.
 *
 * `null` au point de composition quand le module n'est pas activé : c'est ce
 * qui fait du repli du critère 7 une absence, et non une condition disséminée.
 */
export interface NotificationCentre {
  readonly record: (input: RecordNotificationInput) => Promise<RecordNotificationResult>
}

export interface NotificationRecipient {
  readonly userId: string
  readonly email: string
  /** La langue du destinataire, résolue par l'appelant — jamais devinée ici. */
  readonly locale: string
}

export interface EmitNotificationInput {
  readonly type: string
  readonly recipient: NotificationRecipient
  readonly organizationId: string | null
  /**
   * Ce qui est **rendu maintenant** : le texte de l'email, interpolé et envoyé
   * dans la foulée. Il ne se relit pas, donc il porte les valeurs affichables —
   * un nom, une adresse — que l'appelant a déjà sous la main.
   */
  readonly data: EmailData
  /**
   * Ce qui est **écrit dans le centre et relu plus tard** (revue s32, R1).
   *
   * Deux durées de vie différentes, donc deux charges : la ligne survit aux
   * gens qu'elle nomme — elle est adressée à quelqu'un d'autre, et
   * `purge({kind:'user'})` n'efface que ce qui est adressé au compte. Elle porte
   * donc des **références** (`actors` du type le dit), jamais des données
   * personnelles ; la valeur affichable est résolue à la lecture.
   *
   * **Obligatoire, jamais optionnelle avec un repli sur `data`** : ce repli
   * ferait de l'oubli le comportement par défaut, et l'oubli est précisément ce
   * qui a écrit une adresse dans la ligne des autres.
   */
  readonly stored: EmailData
}

export type EmitNotificationErrorCode =
  /** Le type n'est pas déclaré : c'est un défaut de programmation, pas une panne. */
  | 'unknown_type'
  /** Le centre n'a pas pu écrire. Rien n'est parti. */
  | 'centre_unavailable'
  /** Le seul canal retenu était l'email, et l'envoi a échoué. */
  | 'email_failed'

export interface EmitNotificationError {
  readonly code: EmitNotificationErrorCode
  readonly message: string
}

/**
 * Le résultat d'une émission.
 *
 * `delivered` nomme **exactement** ce qui a été livré : un appelant qui tient à
 * l'email voit qu'il n'y est pas, sans avoir à interpréter un booléen. Le
 * résultat est `{ok:false}` quand **rien** n'a pu être livré — la forme du port
 * mailer, héritée : une émission ne lève jamais.
 */
export type EmitNotificationResult =
  | { readonly ok: true; readonly delivered: readonly NotificationChannel[] }
  | { readonly ok: false; readonly error: EmitNotificationError }

export type NotificationEmitter = (
  input: EmitNotificationInput,
) => Promise<EmitNotificationResult>

/**
 * **La fonction d'émission unique** (critères 6 et 7 de s32).
 *
 * Deux chemins, et le second est celui qui casse en silence si on l'oublie :
 *
 * | `centre` | ce qui se passe |
 * |---|---|
 * | injecté (module activé) | le centre applique les préférences, écrit l'in-app, et l'email part si le canal est retenu |
 * | `null` (module coupé) | **envoi email direct**, sans préférence — il n'y a pas de magasin pour en tenir |
 *
 * Le repli n'est pas une dégradation silencieuse : il est la seule chose qui
 * reste possible quand le module qui tient les préférences n'est pas là, et un
 * module coupé qui ferait disparaître l'émission ferait disparaître les emails
 * avec — sans erreur, donc sans signal.
 */
export function createNotificationEmitter(dependencies: {
  readonly types: NotificationTypeRegistry
  readonly mailer: Mailer
  readonly centre: NotificationCentre | null
}): NotificationEmitter {
  const { types, mailer, centre } = dependencies

  const sendEmail = async (
    type: NotificationTypeDeclaration,
    input: EmitNotificationInput,
  ): Promise<EmitNotificationResult> => {
    const sent = await mailer.send({
      to: input.recipient.email,
      template: notificationTemplateId(type.id),
      locale: input.recipient.locale,
      data: input.data,
    })

    return sent.ok
      ? { ok: true, delivered: ['email'] }
      : {
          ok: false,
          error: {
            code: 'email_failed',
            // Le message du port est déjà assaini : ni adresse, ni clé, ni corps.
            message: sent.error.message,
          },
        }
  }

  return async (input) => {
    const type = types.find(input.type)

    if (type === null) {
      return {
        ok: false,
        error: {
          code: 'unknown_type',
          message: `Aucun type de notification ${quote(input.type)} n’est déclaré.`,
        },
      }
    }

    if (centre === null) {
      // **Module coupé — le repli obéit au défaut déclaré du canal email.**
      //
      // Le repli remplace le canal in-app, qui n'existe plus ; il ne rallume
      // pas un canal que le catalogue éteint. Un type déclarant
      // `email: false` n'envoie donc rien : sans canal à livrer, ce n'est pas
      // une erreur, c'est une notification qui n'existe que dans un centre qui
      // n'est pas monté.
      //
      // **La préférence enregistrée du compte est hors de portée ici, et c'est
      // le point** : elle vit dans le module coupé. Le défaut déclaré est donc
      // l'autorité dans cette configuration — pas un repli permissif. Rendre
      // l'email inconditionnel faisait du profil « socle » un produit qui
      // envoie ce que la configuration complète n'aurait jamais envoyé, et un
      // email parti ne se rappelle pas.
      //
      // `defaults.email` suffit à décider : `createNotificationTypeRegistry`
      // refuse un défaut donné à un canal non déclaré, et refuse un canal
      // déclaré sans défaut — les deux ne peuvent pas diverger.
      return type.defaults.email === true
        ? await sendEmail(type, input)
        : { ok: true, delivered: [] }
    }

    const recorded = await centre.record({
      type: type.id,
      userId: input.recipient.userId,
      organizationId: input.organizationId,
      channels: type.channels,
      defaults: type.defaults,
      // **`stored`, jamais `data`** : ce qui est écrit se relit après que les
      // comptes nommés ont disparu (revue s32, R1).
      data: input.stored,
    })

    if (!recorded.ok) {
      return {
        ok: false,
        error: { code: 'centre_unavailable', message: recorded.error.message },
      }
    }

    const delivered: NotificationChannel[] = recorded.channels.includes('in_app')
      ? ['in_app']
      : []

    if (!recorded.channels.includes('email')) {
      return { ok: true, delivered }
    }

    const sent = await sendEmail(type, input)

    if (sent.ok) {
      return { ok: true, delivered: [...delivered, 'email'] }
    }

    // L'in-app est écrite, l'email non : la notification **existe**, et le
    // résultat le dit en ne nommant que le canal livré. `docs/reliability.md`
    // §2 — une panne de tiers dégrade, elle ne casse pas.
    return delivered.length > 0 ? { ok: true, delivered } : sent
  }
}
