import { describe, expect, it } from 'vitest'

import {
  GUEST_SCOPE_KIND,
  accountScopeOfCustomer,
  guestPaymentEmailOf,
  guestScopeReference,
  isGuestScopeKind,
  isOpaqueGuestScopeId,
} from './guest'

/**
 * **Le périmètre invité, tel que le stockage seul le connaît** (ADR 047).
 *
 * Ce que ce fichier tient : la forme d'un identifiant invité, et la règle qui
 * refuse de rendre une ligne invitée là où on attend un compte. Le tirage
 * lui-même vit dans `infrastructure/` — le `domain` n'a pas le droit de
 * connaître `node:crypto` (ADR 006) — et son imprévisibilité est mesurée dans
 * `tests/billing.test.ts`, sur le générateur réellement livré.
 */
describe('le périmètre invité', () => {
  it('ne se confond avec aucune des deux formes de ModuleScope', () => {
    expect(isGuestScopeKind(GUEST_SCOPE_KIND)).toBe(true)
    expect(isGuestScopeKind('user')).toBe(false)
    expect(isGuestScopeKind('organization')).toBe(false)
  })

  it('n’accepte comme identifiant qu’un opaque de 64 hexadécimaux', () => {
    expect(isOpaqueGuestScopeId('a'.repeat(64))).toBe(true)
    expect(isOpaqueGuestScopeId('0123456789abcdef'.repeat(4))).toBe(true)

    // Ce qu'un compteur ou un horodatage produirait : trop court, ou hors de
    // l'alphabet. La forme ne prouve pas l'entropie — elle refuse seulement les
    // formes qui n'en ont visiblement aucune.
    expect(isOpaqueGuestScopeId('1')).toBe(false)
    expect(isOpaqueGuestScopeId(String(Date.now()))).toBe(false)
    expect(isOpaqueGuestScopeId('A'.repeat(64))).toBe(false)
    expect(isOpaqueGuestScopeId(`${'a'.repeat(63)}g`)).toBe(false)
    expect(isOpaqueGuestScopeId('a'.repeat(65))).toBe(false)
  })

  it('porte sa référence de diagnostic sous un préfixe qui la distingue', () => {
    // Le `client_reference_id` du fournisseur sert au diagnostic, jamais à
    // l'autorisation (ADR 034). Il ne doit pas pouvoir être lu comme un
    // `user:` ou un `organization:`.
    expect(guestScopeReference('a'.repeat(64))).toBe(`guest:${'a'.repeat(64)}`)
  })

  /**
   * **La règle qui refuse la ligne invitée là où on attend un compte**
   * (ADR 047, « une requête qui sert un compte doit ignorer les invités »).
   *
   * Elle est ici parce que c'est ici qu'elle se prouve : la reconstruction d'un
   * périmètre depuis une ligne client est le seul chemin qui transforme deux
   * colonnes de texte en `ModuleScope`, et sans ce refus une ligne invitée
   * devient un `user:<jeton>` que personne n'a jamais créé.
   */
  it('ne rend aucun périmètre de compte pour une ligne invitée', () => {
    expect(
      accountScopeOfCustomer({ scopeKind: GUEST_SCOPE_KIND, scopeId: 'a'.repeat(64) }),
    ).toBeNull()
  })

  it('rend le périmètre des deux formes de ModuleScope', () => {
    expect(accountScopeOfCustomer({ scopeKind: 'user', scopeId: 'usr_1' })).toEqual({
      kind: 'user',
      userId: 'usr_1',
    })
    expect(accountScopeOfCustomer({ scopeKind: 'organization', scopeId: 'org_1' })).toEqual({
      kind: 'organization',
      organizationId: 'org_1',
    })
  })

  /**
   * **L'adresse du paiement est une frontière**, pas une donnée de confiance.
   *
   * La normalisation n'est pas cosmétique : sans elle, « Alice@Example.test »
   * et « alice@example.test » créent deux comptes pour une personne, et le
   * quatrième critère de la story tombe sans que rien ne rougisse.
   */
  it('normalise l’adresse du paiement, et refuse ce qui n’en est pas une', () => {
    expect(guestPaymentEmailOf('  Alice@Example.test ')).toBe('alice@example.test')
    expect(guestPaymentEmailOf('alice@example.test')).toBe('alice@example.test')

    for (const rejected of [null, undefined, 42, '', 'alice', 'alice@', '@example.test']) {
      expect(guestPaymentEmailOf(rejected), String(rejected)).toBeNull()
    }
  })
})
