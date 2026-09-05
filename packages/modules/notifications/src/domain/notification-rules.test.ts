import { describe, expect, it } from 'vitest'

import {
  allowedChannels,
  isVisibleTo,
  pageOf,
  NOTIFICATION_PAGE_SIZE,
  type NotificationScope,
  resolveActorReferences,
} from './notification'

/**
 * Les règles pures du module — celles qui décident, et rien d'autre.
 *
 * Elles sont ici parce que c'est ici qu'elles vivent : la matrice des acteurs
 * qu'une règle distingue s'énumère **une fois**, à la règle. Les routes n'en
 * rejouent qu'un témoin, la preuve qu'elles l'appellent
 * (`tests/notifications.test.ts`).
 */

const viewer = (userId: string, organizationIds: readonly string[]): NotificationScope => ({
  userId,
  organizationIds,
})

describe('les canaux retenus pour un type (critère 4)', () => {
  it('retient le défaut du type quand le compte n’a rien réglé', () => {
    expect(
      allowedChannels({
        channels: ['in_app', 'email'],
        defaults: { in_app: true, email: false },
        preferences: [],
      }),
    ).toEqual(['in_app'])
  })

  it('laisse la préférence enregistrée l’emporter sur le défaut, canal par canal', () => {
    expect(
      allowedChannels({
        channels: ['in_app', 'email'],
        defaults: { in_app: true, email: false },
        preferences: [
          { channel: 'in_app', enabled: false },
          { channel: 'email', enabled: true },
        ],
      }),
    ).toEqual(['email'])
  })

  it('ne retient jamais un canal que le type ne déclare pas', () => {
    // Un type peut perdre un canal — le catalogue est édité par le propriétaire.
    // La préférence enregistrée pour ce canal-là survit en base ; elle ne doit
    // pas ressusciter un envoi que le type ne veut plus.
    expect(
      allowedChannels({
        channels: ['in_app'],
        defaults: { in_app: true },
        preferences: [{ channel: 'email', enabled: true }],
      }),
    ).toEqual(['in_app'])
  })

  it('ne retient rien quand tout est coupé', () => {
    expect(
      allowedChannels({
        channels: ['in_app', 'email'],
        defaults: { in_app: true, email: true },
        preferences: [
          { channel: 'in_app', enabled: false },
          { channel: 'email', enabled: false },
        ],
      }),
    ).toEqual([])
  })
})

describe('la visibilité d’une notification (critère 5)', () => {
  const organizationNotification = { recipientId: 'u-1', organizationId: 'org-1' }
  const accountNotification = { recipientId: 'u-1', organizationId: null }

  it('la montre à son destinataire, membre de l’organisation concernée', () => {
    expect(isVisibleTo(organizationNotification, viewer('u-1', ['org-1']))).toBe(true)
  })

  it('la cache à un autre compte, membre de la même organisation', () => {
    // Une notification est **adressée** : appartenir à l'organisation ne donne
    // pas accès à celle d'un collègue.
    expect(isVisibleTo(organizationNotification, viewer('u-2', ['org-1']))).toBe(false)
  })

  it('la cache à son destinataire qui n’est plus membre de l’organisation', () => {
    expect(isVisibleTo(organizationNotification, viewer('u-1', ['org-2']))).toBe(false)
  })

  it('montre une notification de compte à son destinataire, sans organisation', () => {
    expect(isVisibleTo(accountNotification, viewer('u-1', []))).toBe(true)
  })
})

describe('la pagination du centre (critère 1)', () => {
  it('rend la première page par défaut, et son décalage est nul', () => {
    expect(pageOf({ page: 1, total: 0 })).toEqual({
      page: 1,
      pageCount: 1,
      offset: 0,
      limit: NOTIFICATION_PAGE_SIZE,
    })
  })

  it('compte les pages depuis le total, jamais depuis la page lue', () => {
    expect(pageOf({ page: 2, total: NOTIFICATION_PAGE_SIZE * 2 + 1 }).pageCount).toBe(3)
    expect(pageOf({ page: 2, total: NOTIFICATION_PAGE_SIZE * 2 + 1 }).offset).toBe(
      NOTIFICATION_PAGE_SIZE,
    )
  })

  it('ramène une page hors bornes dans les bornes, plutôt que de rendre du vide', () => {
    expect(pageOf({ page: 9, total: 3 }).page).toBe(1)
    expect(pageOf({ page: 0, total: 3 }).page).toBe(1)
  })
})

describe('les références de compte d’une charge utile (revue s32, R1)', () => {
  it('remplace la référence par le nom, et laisse le reste intact', () => {
    const resolved = resolveActorReferences(
      { member: 'usr_ada', organization: 'Acme', rank: 3 },
      ['member'],
      new Map([['usr_ada', 'Ada Lovelace']]),
    )

    expect(resolved).toEqual({ member: 'Ada Lovelace', organization: 'Acme', rank: 3 })
  })

  it('rend `null` pour un compte qui n’existe plus, sans perdre la ligne', () => {
    // **Ce que voit celui qui reste.** La ligne est la sienne : elle doit rester
    // lisible quand le compte qu'elle nomme a été effacé. `null` dit « ce compte
    // n'existe plus » et l'écran y met son propre libellé — il ne rend ni un
    // identifiant, ni une ligne cassée, ni un trou.
    expect(resolveActorReferences({ member: 'usr_parti' }, ['member'], new Map())).toEqual({
      member: null,
    })
  })

  it('ne résout que les clés déclarées : une valeur affichable n’est pas touchée', () => {
    // Sans cette borne, une charge utile dont une valeur ressemble à un
    // identifiant serait réécrite au hasard des homonymies.
    expect(
      resolveActorReferences({ organization: 'usr_ada' }, ['member'], new Map([['usr_ada', 'Ada']])),
    ).toEqual({ organization: 'usr_ada' })
  })

  it('n’invente pas une clé que la charge utile ne porte pas', () => {
    expect(resolveActorReferences({ organization: 'Acme' }, ['member'], new Map())).toEqual({
      organization: 'Acme',
    })
  })
})
