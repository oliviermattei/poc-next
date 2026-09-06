import { describe, expect, it } from 'vitest'

import {
  banRefusal,
  designatesFirstSuperadmin,
  parseAccountTarget,
  revocationRefusal,
  signInCapableSuperadmins,
} from './platform-role'

/**
 * Les règles pures du module (ADR 006) : aucune base, aucun framework.
 *
 * Ce fichier porte la **matrice** ; `tests/admin.test.ts` prouve qu'elle est
 * appelée, il ne la rejoue pas — une matrice répétée à chaque appelant multiplie
 * la suite et éprouve la même décision par une autre porte.
 */
describe('la désignation du premier superadmin', () => {
  const designated = 'patronne@example.test'

  it('désigne le compte dont l’adresse est celle de la variable, sur une base vierge', () => {
    expect(
      designatesFirstSuperadmin({
        superadminCount: 0,
        designatedEmail: designated,
        candidateEmail: designated,
      }),
    ).toBe(true)
  })

  it('compare les adresses sans tenir compte de la casse ni des espaces de bordure', () => {
    // L'adresse est saisie dans un `.env` à la main : `Patronne@Example.test `
    // et `patronne@example.test` désignent la même personne, et le module
    // `auth` normalise déjà les siennes à l'inscription.
    expect(
      designatesFirstSuperadmin({
        superadminCount: 0,
        designatedEmail: ' Patronne@Example.test ',
        candidateEmail: designated,
      }),
    ).toBe(true)
  })

  it('ne désigne personne quand la variable n’est pas renseignée', () => {
    expect(
      designatesFirstSuperadmin({
        superadminCount: 0,
        designatedEmail: null,
        candidateEmail: designated,
      }),
    ).toBe(false)
  })

  it('ne désigne personne dès qu’un superadmin existe : c’est le **premier**, pas un secours', () => {
    // Sans cette borne, révoquer le compte désigné par la variable ne servirait
    // à rien : il se redésignerait à la requête suivante, et le garde-fou du
    // dernier deviendrait un décor.
    expect(
      designatesFirstSuperadmin({
        superadminCount: 1,
        designatedEmail: designated,
        candidateEmail: designated,
      }),
    ).toBe(false)
  })

  it('ne désigne pas une autre adresse que celle de la variable', () => {
    expect(
      designatesFirstSuperadmin({
        superadminCount: 0,
        designatedEmail: designated,
        candidateEmail: 'quelqun-dautre@example.test',
      }),
    ).toBe(false)
  })
})

describe('le dernier superadmin', () => {
  /**
   * **Le garde-fou de la story**, et il vaut pour les deux gestes qui font
   * perdre le rôle : la révocation et le bannissement. Sans lui, la plateforme
   * devient définitivement inadministrable en un clic, et aucune commande ne la
   * répare — plus personne ne peut promouvoir, et la variable ne désigne plus
   * rien tant qu'un superadmin existe, or il n'en existe plus d'utilisable.
   *
   * Les jetons sont ceux que les ports rendent (`last_superadmin`,
   * `not_superadmin`) : **un seul vocabulaire**, tenu par le compilateur, du
   * refus en base jusqu'au corps de la réponse.
   */
  it('refuse qu’on le bannisse', () => {
    expect(
      banRefusal({ superadminCount: 1, targetIsSuperadmin: true, targetCanSignIn: true }),
    ).toBe('last_superadmin')
  })

  it('refuse qu’on le révoque', () => {
    expect(
      revocationRefusal({ superadminCount: 1, targetIsSuperadmin: true, targetCanSignIn: true }),
    ).toBe('last_superadmin')
  })

  it('laisse bannir et révoquer dès qu’il en reste un autre', () => {
    // Bannir un superadmin qui n'est pas le dernier est de la modération entre
    // pairs : la règle ne protège que l'administrabilité de la plateforme.
    expect(
      banRefusal({ superadminCount: 2, targetIsSuperadmin: true, targetCanSignIn: true }),
    ).toBeNull()
    expect(
      revocationRefusal({ superadminCount: 2, targetIsSuperadmin: true, targetCanSignIn: true }),
    ).toBeNull()
  })

  it('ne concerne pas un compte qui ne porte pas le rôle', () => {
    // Bannir une personne ordinaire n'a rien à voir avec le rôle de plateforme…
    expect(
      banRefusal({ superadminCount: 1, targetIsSuperadmin: false, targetCanSignIn: true }),
    ).toBeNull()
    // … mais lui **révoquer** un rôle qu'elle n'a pas est un refus distinct.
    expect(
      revocationRefusal({ superadminCount: 2, targetIsSuperadmin: false, targetCanSignIn: true }),
    ).toBe('not_superadmin')
  })

  /**
   * **Un superadmin qui ne peut plus entrer ne compte pas, et n'est pas
   * protégé** (s37b1).
   *
   * Les deux moitiés de la même correction : il ne compte pas dans le décompte
   * — c'est le décompte qui les nomme, pas cette règle —, et le geste qui le
   * vise ne retire rien à l'administrabilité, donc rien ne l'empêche. Sans la
   * seconde moitié, le seul geste qui nettoie une plateforme à moitié fermée
   * serait interdit.
   */
  it('ne protège pas un superadmin qui ne peut plus ouvrir de session', () => {
    expect(
      banRefusal({ superadminCount: 1, targetIsSuperadmin: true, targetCanSignIn: false }),
    ).toBeNull()
    expect(
      revocationRefusal({ superadminCount: 1, targetIsSuperadmin: true, targetCanSignIn: false }),
    ).toBeNull()
  })
})

/**
 * **Le décompte, et ce qu'il compte** (s37b1) : des comptes capables de se
 * connecter, jamais des lignes de rôle.
 */
describe('le décompte des superadmins', () => {
  it('ne compte pas les porteurs du rôle incapables d’ouvrir une session', () => {
    expect(
      signInCapableSuperadmins({ superadminIds: ['a', 'b'], signInBlocked: ['b'] }),
    ).toBe(1)
  })

  it('compte tout le monde quand personne n’est fermé', () => {
    expect(signInCapableSuperadmins({ superadminIds: ['a', 'b'], signInBlocked: [] })).toBe(2)
  })

  it('rend zéro quand tous les porteurs sont fermés : la désignation redevient possible', () => {
    expect(
      signInCapableSuperadmins({ superadminIds: ['a', 'b'], signInBlocked: ['a', 'b'] }),
    ).toBe(0)
  })
})

describe('la cible d’une action d’administration', () => {
  it('refuse un identifiant absent, vide ou qui n’est pas une chaîne', () => {
    expect(parseAccountTarget({})).toBeNull()
    expect(parseAccountTarget({ userId: '   ' })).toBeNull()
    expect(parseAccountTarget({ userId: 42 })).toBeNull()
    expect(parseAccountTarget(null)).toBeNull()
  })

  it('rend l’identifiant et le motif quand le corps est valide', () => {
    expect(parseAccountTarget({ userId: 'usr_1', reason: 'abus' })).toEqual({
      userId: 'usr_1',
      reason: 'abus',
    })
  })

  it('rend un motif absent comme `null`, jamais comme une chaîne vide', () => {
    expect(parseAccountTarget({ userId: 'usr_1' })?.reason).toBeNull()
    expect(parseAccountTarget({ userId: 'usr_1', reason: '   ' })?.reason).toBeNull()
  })
})
