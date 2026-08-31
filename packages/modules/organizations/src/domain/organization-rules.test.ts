import { describe, expect, it } from 'vitest'

import {
  FOUNDER_ROLE,
  ORGANIZATION_ROLES,
  parseOrganizationDraft,
  type OrganizationRefusal,
} from './organization'

/**
 * Les règles pures du module, éprouvées **là où elles vivent**.
 *
 * Leurs appelants — la route de création, celle de renommage — prouvent qu'ils
 * les appellent et qu'un refus n'écrit rien ; ils ne rejouent pas cette
 * matrice (`tests/organizations.test.ts`).
 */

const reserved = new Set(['account', 'sign-in', 'api', 'fr'])

const refusalOf = (name: string, slug: string): OrganizationRefusal | null => {
  const parsed = parseOrganizationDraft({ name, slug }, reserved)

  return parsed.ok ? null : parsed.refusal
}

describe('le nom d’une organisation', () => {
  it('accepte un nom ordinaire et le débarrasse de ses espaces de bord', () => {
    const parsed = parseOrganizationDraft({ name: '  Studio Martin ', slug: 'studio' }, reserved)

    expect(parsed.ok && parsed.value.name).toBe('Studio Martin')
  })

  it.each([
    ['vide', ''],
    ['blanc', '   '],
    ['trop long', 'x'.repeat(65)],
  ])('refuse un nom %s', (_case, name) => {
    expect(refusalOf(name, 'studio')).toBe('invalid_name')
  })
})

describe('l’identifiant d’une organisation', () => {
  it('normalise la casse : deux écritures du même identifiant n’en font qu’un', () => {
    // Sans normalisation, « Studio » et « studio » cohabiteraient et l'unicité
    // annoncée par la story serait fausse — la contrainte de la base porte sur
    // la valeur écrite, pas sur son intention.
    const parsed = parseOrganizationDraft({ name: 'Studio', slug: ' Studio-Martin ' }, reserved)

    expect(parsed.ok && parsed.value.slug).toBe('studio-martin')
  })

  it.each([
    ['un espace', 'studio martin'],
    ['un accent', 'crème'],
    ['un tiret de tête', '-studio'],
    ['un tiret de queue', 'studio-'],
    ['deux tirets consécutifs', 'studio--martin'],
    ['une barre oblique', 'studio/martin'],
    ['un point', 'studio.martin'],
    ['un seul caractère', 's'],
    ['plus de quarante-huit caractères', 'a'.repeat(49)],
  ])('refuse un identifiant portant %s', (_case, slug) => {
    expect(refusalOf('Studio', slug)).toBe('invalid_slug')
  })
})

describe('les identifiants réservés', () => {
  it.each([...reserved])('refuse « %s », qui est une route du système', (slug) => {
    expect(refusalOf('Studio', slug)).toBe('slug_unavailable')
  })

  it('refuse aussi la variante de casse d’un identifiant réservé', () => {
    // La normalisation a lieu **avant** la confrontation à la liste, sans quoi
    // « Account » passerait et servirait `/account`.
    expect(refusalOf('Studio', 'Account')).toBe('slug_unavailable')
  })

  it('rend le même motif de refus qu’un identifiant déjà pris', () => {
    // `docs/security.md` §7 : distinguer « réservé » de « déjà pris » ferait du
    // formulaire de création un test d'existence d'organisation. Le motif est
    // le même, et c'est ce motif que la couche d'écriture rend sur une
    // violation d'unicité.
    expect(refusalOf('Studio', 'account')).toBe('slug_unavailable')
  })
})

describe('le rôle du créateur', () => {
  it('est propriétaire', () => {
    expect(FOUNDER_ROLE).toBe('owner')
  })

  it('fait partie des rôles que le module connaît', () => {
    expect(ORGANIZATION_ROLES).toContain(FOUNDER_ROLE)
  })
})

describe('la frontière du module', () => {
  it('refuse un corps qui n’a pas la forme attendue, sans lever', () => {
    // Zod à **chaque** frontière (`docs/security.md` §4) : ce qui arrive ici
    // vient d'un corps de requête, donc de nulle part.
    expect(parseOrganizationDraft(null, reserved).ok).toBe(false)
    expect(parseOrganizationDraft({ name: 1, slug: [] }, reserved).ok).toBe(false)
    expect(parseOrganizationDraft({ slug: 'studio' }, reserved).ok).toBe(false)
  })
})
