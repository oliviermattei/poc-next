import { describe, expect, it } from 'vitest'

import {
  alreadyMember,
  exceedsInvitationQuota,
  INVITATION_QUOTA_PER_WINDOW,
  INVITATION_QUOTA_WINDOW_SECONDS,
  INVITATION_TTL_SECONDS,
  INVITED_ROLE,
  invitationExpiry,
  invitationStatus,
  isInvitationUsable,
  parseInvitationEmail,
  refusalForStatus,
  removalRefusal,
} from './invitation'
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

/* ------------------------------------------------------------------------- *
 * s16 — les règles pures de l'invitation et du retrait.
 *
 * Elles vivent ici, avec celles de s15, parce que c'est la même unité : le
 * `domain` du module. Un second fichier coûterait un environnement complet pour
 * les mêmes règles, et `tests/organizations.test.ts` ne rejoue pas cette
 * matrice — il prouve que ces règles sont **appelées** et qu'un refus n'écrit
 * rien.
 * ------------------------------------------------------------------------- */

describe('l’adresse d’une invitation', () => {
  it('rogne les bords et abaisse la casse', () => {
    // Sans normalisation **avant** toute comparaison, « Marie@Example.test » et
    // « marie@example.test » seraient deux invitations pour l'index d'unicité,
    // et le refus « déjà membre » se contournerait par une majuscule.
    const parsed = parseInvitationEmail({ email: '  Marie@Example.TEST ' })

    expect(parsed.ok && parsed.value).toBe('marie@example.test')
  })

  it.each([
    ['vide', ''],
    ['blanche', '   '],
    ['sans arobase', 'marie.example.test'],
    ['sans domaine', 'marie@'],
    ['avec un espace', 'ma rie@example.test'],
    ['trop longue', `${'a'.repeat(250)}@example.test`],
  ])('refuse une adresse %s', (_case, email) => {
    const parsed = parseInvitationEmail({ email })

    expect(parsed.ok ? null : parsed.refusal).toBe('invalid_email')
  })

  it('refuse un corps qui n’a pas la forme attendue, sans lever', () => {
    expect(parseInvitationEmail(null).ok).toBe(false)
    expect(parseInvitationEmail({ email: 12 }).ok).toBe(false)
    expect(parseInvitationEmail({}).ok).toBe(false)
  })
})

describe('le statut d’une invitation', () => {
  const now = new Date('2026-09-01T12:00:00.000Z')
  const later = new Date('2026-09-08T12:00:00.000Z')
  const earlier = new Date('2026-08-25T12:00:00.000Z')

  it('est « en attente » tant qu’elle n’est ni consommée, ni révoquée, ni échue', () => {
    expect(invitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: later }, now)).toBe(
      'pending',
    )
  })

  it('est « acceptée » avant tout le reste — une invitation consommée l’emporte', () => {
    // La précédence n'est pas cosmétique : une invitation acceptée puis échue
    // annoncée « expirée » ferait croire à un lien à renvoyer, alors que la
    // personne est déjà membre.
    expect(invitationStatus({ acceptedAt: earlier, revokedAt: null, expiresAt: earlier }, now)).toBe(
      'accepted',
    )
  })

  it('est « révoquée » avant d’être « expirée »', () => {
    // Une invitation révoquée puis échue est **révoquée** : c'est une décision
    // humaine, elle prime sur le temps qui passe.
    expect(invitationStatus({ acceptedAt: null, revokedAt: earlier, expiresAt: earlier }, now)).toBe(
      'revoked',
    )
  })

  it('est « expirée » à l’instant exact de son échéance, pas après', () => {
    // L'inégalité stricte laisserait une milliseconde pendant laquelle un lien
    // périmé est encore accepté — c'est le choix déjà fait par `isTokenExpired`
    // du module `auth`.
    expect(invitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: now }, now)).toBe(
      'expired',
    )
  })

  it('n’est utilisable que lorsqu’elle est en attente', () => {
    expect(isInvitationUsable('pending')).toBe(true)

    for (const status of ['accepted', 'revoked', 'expired'] as const) {
      expect(isInvitationUsable(status), status).toBe(false)
    }
  })

  it('a un motif de refus propre à chaque statut inutilisable', () => {
    // Le critère 3 exige une erreur **explicite** : « expirée », « révoquée » et
    // « déjà acceptée » ne se replient pas sur un refus générique.
    expect(refusalForStatus('accepted')).toBe('invitation_accepted')
    expect(refusalForStatus('revoked')).toBe('invitation_revoked')
    expect(refusalForStatus('expired')).toBe('invitation_expired')
    expect(refusalForStatus('pending')).toBeNull()
  })
})

describe('l’échéance d’une invitation', () => {
  it('est courte, et calculée depuis l’instant d’émission', () => {
    const issued = new Date('2026-09-01T12:00:00.000Z')

    expect(invitationExpiry(issued).toISOString()).toBe('2026-09-08T12:00:00.000Z')
    expect(INVITATION_TTL_SECONDS).toBe(7 * 24 * 60 * 60)
  })
})

describe('le rôle d’un invité', () => {
  it('est simple membre — choisir le rôle est une permission, donc s17', () => {
    expect(INVITED_ROLE).toBe('member')
    expect(ORGANIZATION_ROLES).toContain(INVITED_ROLE)
  })
})

describe('le retrait d’un membre', () => {
  const owner = { userId: 'usr_1', role: 'owner' } as const
  const secondOwner = { userId: 'usr_2', role: 'owner' } as const
  const member = { userId: 'usr_3', role: 'member' } as const

  it('refuse de retirer le dernier propriétaire, qu’il s’agisse de soi ou d’un autre', () => {
    // Une organisation sans propriétaire est une ressource que plus personne ne
    // gouverne. Le motif est le même dans les deux sens : se retirer soi-même
    // n'est pas un cas particulier.
    expect(removalRefusal([owner, member], owner.userId)).toBe('last_owner')
  })

  it('accepte de retirer un propriétaire dès qu’il en reste un autre', () => {
    expect(removalRefusal([owner, secondOwner], owner.userId)).toBeNull()
  })

  it('accepte de retirer un membre simple', () => {
    expect(removalRefusal([owner, member], member.userId)).toBeNull()
  })

  it('refuse de retirer quelqu’un qui n’est pas membre', () => {
    expect(removalRefusal([owner, member], 'usr_inconnu')).toBe('not_a_member')
  })
})

describe('l’invitation d’un membre déjà présent', () => {
  it('est refusée, et la comparaison est faite sur l’adresse normalisée', () => {
    // Le refus est explicite (critère 4) : cette personne est déjà là, il n'y a
    // rien à envoyer. La casse ne doit pas permettre de le contourner.
    expect(alreadyMember(['marie@example.test'], 'Marie@Example.test')).toBe(true)
    expect(alreadyMember(['marie@example.test'], 'paul@example.test')).toBe(false)
  })
})

describe('le quota d’émission d’invitations', () => {
  it('refuse au-delà du seuil, sur la fenêtre glissante', () => {
    // Ce n'est pas la limitation de débit de s28 (`docs/architecture.md`) : c'est
    // un quota par organisation, parce qu'une invitation est un moyen d'expédier
    // du courrier depuis le domaine du produit.
    expect(exceedsInvitationQuota(INVITATION_QUOTA_PER_WINDOW - 1)).toBe(false)
    expect(exceedsInvitationQuota(INVITATION_QUOTA_PER_WINDOW)).toBe(true)
    expect(INVITATION_QUOTA_WINDOW_SECONDS).toBe(60 * 60)
  })
})
