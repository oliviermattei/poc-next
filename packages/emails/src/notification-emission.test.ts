import type { Mailer, SendEmailInput, SendEmailResult } from '@repo/ports'
import { describe, expect, it } from 'vitest'

import {
  createNotificationEmitter,
  createNotificationTypeRegistry,
  defineNotificationType,
  notificationTemplateId,
  NotificationTypeError,
  type NotificationCentre,
  type RecordNotificationInput,
} from './notifications'

/**
 * Le registre de types de notification et la **fonction d'émission unique**
 * (s32), tous deux dans `@repo/emails` — c'est-à-dire dans le socle, jamais
 * dans le module `notifications` (ADR 057).
 *
 * Ce fichier porte les deux moitiés parce qu'elles ne se prouvent pas l'une
 * sans l'autre : le registre décide **quels canaux existent**, l'émission décide
 * **ce qui part**, et le critère 7 de la story demande que le second continue de
 * fonctionner quand le module qui tient le premier canal est coupé.
 *
 * Ce que ce fichier ne prouve pas, et où c'est prouvé :
 *
 * - que le module coupé n'a ni route, ni entrée de navigation, ni table —
 *   `tests/notifications.test.ts`, contre le vrai registre et une vraie base ;
 * - que la préférence est **calculée** correctement —
 *   `packages/modules/notifications/src/domain/notification-rules.test.ts`, là
 *   où la règle vit. Ici on prouve que l'émission **obéit** à ce qu'on lui rend.
 */

const FR_EN = ['fr', 'en'] as const

const templateOf = (id: string) => ({
  id,
  locales: {
    fr: { subject: 'Sujet {name}', body: 'Corps {name}' },
    en: { subject: 'Subject {name}', body: 'Body {name}' },
  },
})

const bothChannels = defineNotificationType({
  id: 'demo.both',
  channels: ['in_app', 'email'],
  defaults: { in_app: true, email: true },
  email: templateOf('demo.both'),
  actors: [],
})

/** Un type dont la charge utile stockée porte une **référence de compte**. */
const withActor = defineNotificationType({
  id: 'demo.actor',
  channels: ['in_app'],
  defaults: { in_app: true },
  email: null,
  actors: ['name'],
})

/**
 * Un type qui **peut** recevoir un email mais ne le veut pas par défaut.
 *
 * C'est la forme d'`organization.member-joined` dans `config/notifications.ts`,
 * et le cas que le repli du module coupé traitait à l'envers.
 */
const emailOffByDefault = defineNotificationType({
  id: 'demo.email-off',
  channels: ['in_app', 'email'],
  defaults: { in_app: true, email: false },
  email: templateOf('demo.email-off'),
  actors: [],
})

const inAppOnly = defineNotificationType({
  id: 'demo.in-app-only',
  channels: ['in_app'],
  defaults: { in_app: true },
  email: null,
  actors: [],
})

const registryOf = (types: readonly ReturnType<typeof defineNotificationType>[]) =>
  createNotificationTypeRegistry({ types, locales: [...FR_EN] })

/** Un mailer qui enregistre ce qu'on lui confie. Il ne valide rien à la place du serveur. */
const recordingMailer = (
  result: SendEmailResult = { ok: true, id: 'msg-1' },
): { readonly mailer: Mailer; readonly sent: SendEmailInput[] } => {
  const sent: SendEmailInput[] = []

  return {
    sent,
    mailer: {
      send: async (input) => {
        sent.push(input)

        return result
      },
    },
  }
}

/** Un centre qui retient les canaux qu'on lui dit de retenir, et note ce qu'il a reçu. */
const recordingCentre = (
  channels: readonly ('in_app' | 'email')[],
): { readonly centre: NotificationCentre; readonly recorded: RecordNotificationInput[] } => {
  const recorded: RecordNotificationInput[] = []

  return {
    recorded,
    centre: {
      record: async (input) => {
        recorded.push(input)

        return { ok: true, channels }
      },
    },
  }
}

const RECIPIENT = { userId: 'u-1', email: 'destinataire@example.test', locale: 'fr' } as const

describe('le registre de types de notification (s32, critère 6)', () => {
  it('refuse un registre vide, en le disant', () => {
    // **Le plancher de la story.** Un registre vide rendrait le balayage du
    // critère 6 vert sur zéro type — le mode d'échec qu'`AGENTS.md` nomme déjà
    // pour `pnpm test:minimal-profile`.
    expect(() => registryOf([])).toThrowError(NotificationTypeError)
    expect(() => registryOf([])).toThrowError(/aucun type/i)
  })

  it('refuse deux types du même identifiant', () => {
    expect(() => registryOf([bothChannels, bothChannels])).toThrowError(/demo\.both/)
  })

  it('refuse un canal déclaré sans défaut, en nommant le type et le canal', () => {
    const incoherent = {
      id: 'demo.sans-defaut',
      channels: ['in_app', 'email'],
      defaults: { in_app: true },
      email: templateOf('demo.sans-defaut'),
      actors: [],
    } as const

    expect(() => registryOf([incoherent])).toThrowError(/demo\.sans-defaut.*email|email.*demo/s)
  })

  it('refuse un canal email sans template : rien ne pourrait partir', () => {
    const orphan = {
      id: 'demo.sans-template',
      channels: ['in_app', 'email'],
      defaults: { in_app: true, email: true },
      email: null,
      actors: [],
    } as const

    expect(() => registryOf([orphan])).toThrowError(/demo\.sans-template/)
  })

  it('refuse un template qui manque une locale de l’application', () => {
    const partial = {
      id: 'demo.partiel',
      channels: ['email'],
      defaults: { email: true },
      email: { id: 'demo.partiel', locales: { fr: { subject: 'S', body: 'B' } } },
      actors: [],
    } as const

    expect(() => registryOf([partial])).toThrowError(/demo\.partiel.*en|en.*demo\.partiel/s)
  })

  it('rend les templates des types déclarés, qualifiés hors de tout module', () => {
    const registry = registryOf([bothChannels, inAppOnly])

    // Un type sans canal email ne contribue aucun template : il n'y a rien à
    // rendre. Le compte est donc dérivé des types, jamais écrit.
    expect(registry.emails).toHaveLength(1)
    expect(notificationTemplateId(bothChannels.id)).toBe('notification.demo.both')
  })
})

describe('la charge utile stockée n’est pas celle de l’email (s32, revue R1)', () => {
  it('écrit dans le centre `stored`, et n’envoie par email que `data`', async () => {
    // **Le précédent que tout producteur suivant copiera.** Une ligne de
    // notification survit aux gens qu'elle nomme : elle est adressée à
    // quelqu'un d'autre, et `purge({kind:'user'})` n'efface que ce qui est
    // adressé au compte. Une adresse écrite dans la charge utile resterait donc
    // lisible après l'effacement, pendant que le contrat promet `'erase'`.
    //
    // L'email, lui, part maintenant et ne se relit pas : il porte la valeur
    // affichable. Les deux durées de vie sont différentes, donc les deux
    // charges le sont aussi — et le compilateur réclame les deux.
    const { mailer, sent } = recordingMailer()
    const { centre, recorded } = recordingCentre(['in_app', 'email'])
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre,
    })

    await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: 'org-1',
      data: { name: 'ada@example.test' },
      stored: { name: 'usr_ada' },
    })

    expect(recorded[0]?.data).toEqual({ name: 'usr_ada' })
    expect(sent[0]?.data).toEqual({ name: 'ada@example.test' })
  })

  it('refuse une clé d’acteur vide ou répétée, en nommant le type', () => {
    expect(() =>
      createNotificationTypeRegistry({
        types: [{ ...withActor, actors: [''] }],
        locales: [...FR_EN],
      }),
    ).toThrowError(NotificationTypeError)

    expect(() =>
      createNotificationTypeRegistry({
        types: [{ ...withActor, actors: ['name', 'name'] }],
        locales: [...FR_EN],
      }),
    ).toThrowError(/demo.actor/)
  })
})

describe('emitNotification, module `notifications` activé', () => {
  it('persiste l’in-app et envoie l’email quand les deux canaux sont retenus', async () => {
    const { mailer, sent } = recordingMailer()
    const { centre, recorded } = recordingCentre(['in_app', 'email'])
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre,
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: 'org-1',
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome).toEqual({ ok: true, delivered: ['in_app', 'email'] })
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.organizationId).toBe('org-1')
    expect(sent[0]?.template).toBe(notificationTemplateId(bothChannels.id))
    expect(sent[0]?.to).toBe(RECIPIENT.email)
    expect(sent[0]?.locale).toBe('fr')
  })

  it('n’envoie pas l’email que le centre n’a pas retenu (critère 4)', async () => {
    const { mailer, sent } = recordingMailer()
    const { centre } = recordingCentre(['in_app'])
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre,
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: null,
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome).toEqual({ ok: true, delivered: ['in_app'] })
    // Le refus n'atteint pas le mailer : rien n'est parti, pas même un envoi
    // qu'on aurait ensuite ignoré.
    expect(sent).toEqual([])
  })

  it('ne crée pas l’in-app que le centre n’a pas retenu, et envoie l’email', async () => {
    const { mailer, sent } = recordingMailer()
    const { centre } = recordingCentre(['email'])
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre,
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: null,
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome).toEqual({ ok: true, delivered: ['email'] })
    expect(sent).toHaveLength(1)
  })

  it('rend un résultat, jamais une exception, quand le centre est en panne', async () => {
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer: recordingMailer().mailer,
      centre: {
        record: async () => ({
          ok: false,
          error: { code: 'store_unavailable', message: 'base injoignable' },
        }),
      },
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: null,
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.error.code).toBe('centre_unavailable')
  })

  it('refuse un type que le registre ne déclare pas, sans rien envoyer', async () => {
    const { mailer, sent } = recordingMailer()
    const { centre, recorded } = recordingCentre(['in_app', 'email'])
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre,
    })

    const outcome = await emit({
      type: 'demo.inconnu',
      recipient: RECIPIENT,
      organizationId: null,
      data: {},
      stored: {},
    })

    expect(outcome.ok === false && outcome.error.code).toBe('unknown_type')
    // Un refus qui aurait quand même écrit ou envoyé n'est pas un refus.
    expect(sent).toEqual([])
    expect(recorded).toEqual([])
  })
})

describe('emitNotification, module `notifications` coupé (critère 7)', () => {
  it('retombe sur un envoi email direct, sans erreur chez l’appelant', async () => {
    const { mailer, sent } = recordingMailer()
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      // `null` est ce que rend le point de composition quand le module n'est pas
      // dans le registre. Le chemin est éprouvé **contre le vrai registre**
      // dans `tests/notifications.test.ts` ; ici, c'est la règle elle-même.
      centre: null,
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: 'org-1',
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome).toEqual({ ok: true, delivered: ['email'] })
    expect(sent[0]?.template).toBe(notificationTemplateId(bothChannels.id))
  })

  it('ne rend pas d’erreur pour un type sans canal email : il n’y a rien à replier', async () => {
    const { mailer, sent } = recordingMailer()
    const emit = createNotificationEmitter({
      types: registryOf([inAppOnly]),
      mailer,
      centre: null,
    })

    const outcome = await emit({
      type: inAppOnly.id,
      recipient: RECIPIENT,
      organizationId: null,
      data: {},
      stored: {},
    })

    expect(outcome).toEqual({ ok: true, delivered: [] })
    expect(sent).toEqual([])
  })

  it('n’envoie rien pour un type dont le défaut du canal email est faux', async () => {
    // **Couper un module n'ajoute pas de trafic sortant.** Le repli remplace le
    // canal in-app qui n'existe plus ; il ne rallume pas un canal que le
    // catalogue éteint. Sans cette règle, choisir le profil « socle » envoyait
    // un email à chaque membre d'une organisation à chaque adhésion — que
    // personne n'avait demandé, et qu'on ne rappelle pas.
    //
    // **Les préférences enregistrées sont hors de portée ici**, et c'est le
    // point : elles vivent dans le module coupé. Le défaut déclaré est donc
    // l'autorité dans cette configuration — pas un repli permissif.
    const { mailer, sent } = recordingMailer()
    const emit = createNotificationEmitter({
      types: registryOf([emailOffByDefault]),
      mailer,
      centre: null,
    })

    const outcome = await emit({
      type: emailOffByDefault.id,
      recipient: RECIPIENT,
      organizationId: 'org-1',
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    // Ce n'est pas une erreur : le type est déclaré, il n'y a simplement rien à
    // livrer dans cette configuration.
    expect(outcome).toEqual({ ok: true, delivered: [] })
    expect(sent).toEqual([])
  })

  it('remonte l’échec du mailer en résultat, sans lever', async () => {
    const { mailer } = recordingMailer({
      ok: false,
      error: { code: 'provider_unavailable', message: 'fournisseur muet', attempts: 2 },
    })
    const emit = createNotificationEmitter({
      types: registryOf([bothChannels]),
      mailer,
      centre: null,
    })

    const outcome = await emit({
      type: bothChannels.id,
      recipient: RECIPIENT,
      organizationId: null,
      data: { name: 'Ada' },
      stored: { name: 'Ada' },
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.ok === false && outcome.error.code).toBe('email_failed')
  })
})
