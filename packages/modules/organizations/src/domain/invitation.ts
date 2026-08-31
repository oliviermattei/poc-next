import { z } from 'zod'

import type { OrganizationRole } from './organization'

/**
 * Les règles pures de l'invitation et du retrait d'un membre (s16).
 *
 * Aucune base, aucun framework, aucun SDK (ADR 006) — `zod` est la seule
 * bibliothèque tierce admise dans cette couche. Rien ici ne sait qu'il existe un
 * jeton secret : la **fabrique** du jeton vit dans `infrastructure/`, parce
 * qu'elle a besoin de `node:crypto`. Ce fichier ne connaît que des dates, des
 * adresses et des statuts.
 *
 * Deux règles y sont écrites une fois et éprouvées une fois
 * (`organization-rules.test.ts`) ; leurs appelants prouvent qu'ils les
 * **appellent** et qu'un refus n'écrit rien, ils ne rejouent pas la matrice.
 */

/**
 * Le rôle d'une personne invitée : **simple membre, toujours**.
 *
 * Choisir le rôle à l'invitation est une permission, donc s17
 * (`docs/stories.md` : « un admin peut inviter et retirer des members »). Ce
 * n'est pas un oubli de s16 : c'est une constante, et le jour où s17 la rendra
 * variable, ce sera par une règle de permission, pas par un champ de
 * formulaire libre.
 */
export const INVITED_ROLE: OrganizationRole = 'member'

/**
 * L'identifiant du template d'email, et le chemin de l'écran d'atterrissage.
 *
 * Écrits **une fois**, ici, parce que trois couches en ont besoin sans avoir le
 * droit de se connaître : l'`application` construit le lien et nomme le
 * template, la `presentation` y redirige un refus, et le point de composition de
 * l'application sert cet écran. Le chemin est une **constante du module**,
 * jamais un paramètre — `docs/security.md` §4 : « aucune redirection pilotée par
 * un paramètre non validé ».
 */
export const INVITATION_EMAIL_TEMPLATE = 'invitation'
export const INVITATION_SCREEN_PATH = '/invitations/accept'

/**
 * La durée de vie d'un lien d'invitation : **sept jours**.
 *
 * `docs/security.md` §2 exige une durée de vie **courte** pour un jeton à usage
 * unique. Sept jours est plus long que les liens de vérification d'`auth`
 * (minutes), et c'est assumé : le destinataire n'a pas demandé cet email, il ne
 * l'attend pas, et un lien mort à l'ouverture transforme l'invitation en
 * ticket de support. Le lien reste à usage unique, révocable à tout instant, et
 * renvoyable — ce sont ces trois propriétés qui bornent l'exposition, pas la
 * seule échéance.
 */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Le quota d'émission : au plus 20 invitations par organisation et par heure.
 *
 * **Ce n'est pas la limitation de débit de s28.** `docs/architecture.md` la
 * reporte explicitement, et pour un point d'entrée **public** ; la route
 * d'invitation est `authenticated`. Ce qui est posé ici est un quota
 * d'expédition : une invitation est un moyen d'envoyer du courrier depuis le
 * domaine du produit, et la réputation d'envoi est le seul actif qu'on ne
 * récupère pas.
 *
 * **Le renvoi compte**, et c'est la correction du constat F2 : une émission est
 * une ligne, le renvoi éteint la précédente et en écrit une neuve, si bien que
 * les deux portes consomment la même fenêtre. Tant que le renvoi réécrivait la
 * même ligne, cinquante renvois envoyaient cinquante emails sans un refus.
 *
 * La limite de ce contrôle est écrite dans la recherche (§7) : le comptage
 * précède l'écriture, donc deux requêtes concurrentes peuvent chacune franchir
 * le seuil. Le dépassement est borné par la concurrence, pas par le temps.
 */
export const INVITATION_QUOTA_PER_WINDOW = 20
export const INVITATION_QUOTA_WINDOW_SECONDS = 60 * 60

/** Ce que devient une invitation, vue à un instant donné. */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

/**
 * Les motifs de refus propres à l'invitation et au retrait.
 *
 * Distincts d'`OrganizationRefusal` (s15) parce qu'ils n'ont pas les mêmes
 * appelants ni le même écran : les premiers reviennent sur `/organizations`, les
 * cinq motifs d'acceptation sur `/invitations/accept`. La liste est la source du
 * catalogue **et** de la validation du paramètre d'URL — recopier l'une ou
 * l'autre les ferait diverger.
 */
export type InvitationRefusal =
  /** L'adresse n'a pas la forme d'une adresse email. */
  | 'invalid_email'
  /** Cette personne est déjà membre de l'organisation. */
  | 'already_member'
  /** Une invitation est déjà en attente pour cette adresse. */
  | 'already_invited'
  /** Le quota d'émission de l'organisation est atteint. */
  | 'invitation_quota'
  /** L'invitation est écrite, mais l'email n'est pas parti : elle est renvoyable. */
  | 'email_failed'
  /** Le lien ne correspond à aucune invitation. */
  | 'invitation_unknown'
  /** Le lien est échu. */
  | 'invitation_expired'
  /** L'invitation a été révoquée. */
  | 'invitation_revoked'
  /** L'invitation a déjà été acceptée. */
  | 'invitation_accepted'
  /** Le lien a été émis pour une autre adresse que celle du compte connecté. */
  | 'invitation_other_recipient'
  /** Retirer cette personne laisserait l'organisation sans propriétaire. */
  | 'last_owner'
  /** La personne visée n'est pas membre de cette organisation. */
  | 'not_a_member'

/** Les motifs que l'écran des organisations sait rendre. */
export const INVITATION_REFUSALS = [
  'invalid_email',
  'already_member',
  'already_invited',
  'invitation_quota',
  'email_failed',
  'invitation_unknown',
  'invitation_expired',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_other_recipient',
  'last_owner',
  'not_a_member',
] as const satisfies readonly InvitationRefusal[]

/**
 * Les motifs que l'écran d'acceptation sait rendre, et **eux seuls**.
 *
 * Un sous-ensemble écrit, pas la liste entière : le paramètre `?error=` de cet
 * écran est validé contre celle-ci, si bien qu'un code d'un autre parcours n'y
 * affiche rien.
 */
export const ACCEPT_REFUSALS = [
  'invitation_unknown',
  'invitation_expired',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_other_recipient',
] as const satisfies readonly InvitationRefusal[]

export type InvitationEmailParse =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly refusal: InvitationRefusal }

/**
 * L'adresse invitée, **normalisée avant d'être jugée**.
 *
 * L'ordre compte, exactement comme pour l'identifiant public d'une organisation :
 * sans abaissement de casse préalable, `Marie@Example.test` et
 * `marie@example.test` seraient deux invitations distinctes pour l'index
 * d'unicité, et le refus « déjà membre » se contournerait par une majuscule.
 *
 * `z.email()` plutôt qu'une expression régulière maison : la forme d'une adresse
 * n'est pas une règle du produit, et une expression écrite ici serait fausse
 * différemment de celle du module `auth`.
 */
const EMAIL = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).pipe(z.email()),
})

export function parseInvitationEmail(input: unknown): InvitationEmailParse {
  const parsed = EMAIL.safeParse(input)

  // Aucun détail de Zod ne sort d'ici : un message de bibliothèque dans une
  // réponse publique renseigne sur l'implémentation.
  return parsed.success
    ? { ok: true, value: parsed.data.email }
    : { ok: false, refusal: 'invalid_email' }
}

/** L'adresse telle que les comparaisons la voient. Une seule normalisation, ici. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/** L'échéance d'une invitation émise à cet instant. */
export function invitationExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVITATION_TTL_SECONDS * 1_000)
}

/** Ce qu'une ligne d'invitation porte, réduit à ce qui décide de son statut. */
export interface InvitationLifecycle {
  readonly acceptedAt: Date | null
  readonly revokedAt: Date | null
  readonly expiresAt: Date
}

/**
 * Le statut d'une invitation, **dans un ordre de précédence qui a un sens**.
 *
 * Acceptée d'abord : une invitation consommée puis échue reste consommée, et
 * l'annoncer « expirée » ferait croire à un lien à renvoyer alors que la
 * personne est déjà membre. Révoquée ensuite : c'est une décision humaine, elle
 * prime sur le temps qui passe. Expirée en dernier.
 *
 * L'échéance est atteinte **à** l'instant de l'expiration, pas après —
 * l'inégalité stricte laisserait une milliseconde pendant laquelle un lien
 * périmé est encore accepté (le choix déjà fait par `isTokenExpired` du module
 * `auth`).
 */
export function invitationStatus(invitation: InvitationLifecycle, now: Date): InvitationStatus {
  if (invitation.acceptedAt !== null) {
    return 'accepted'
  }

  if (invitation.revokedAt !== null) {
    return 'revoked'
  }

  return invitation.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending'
}

/** Une invitation ne se consomme que lorsqu'elle est en attente. */
export function isInvitationUsable(status: InvitationStatus): boolean {
  return status === 'pending'
}

/**
 * Le motif de refus d'un statut inutilisable, ou `null`.
 *
 * Trois motifs distincts, et c'est le critère 3 : « une invitation expirée, déjà
 * acceptée ou révoquée affiche une erreur **explicite** ». Les replier sur un
 * refus générique laisserait l'invité sans savoir quoi demander.
 *
 * Ce n'est pas une fuite : qui lit ce message détient déjà le lien, donc
 * l'email. Le refus qui doit rester indistinguable est celui d'une **adresse**
 * (`docs/security.md` §7), et il l'est — inviter ne dit jamais si un compte
 * existe.
 */
export function refusalForStatus(status: InvitationStatus): InvitationRefusal | null {
  switch (status) {
    case 'accepted':
      return 'invitation_accepted'
    case 'revoked':
      return 'invitation_revoked'
    case 'expired':
      return 'invitation_expired'
    default:
      return null
  }
}

/** Une appartenance, réduite à ce dont la règle de retrait a besoin. */
export interface RemovableMember {
  readonly userId: string
  readonly role: OrganizationRole
}

/**
 * Ce qui interdit de retirer quelqu'un, ou `null`.
 *
 * **Le dernier propriétaire ne se retire pas**, ni par un autre, ni par
 * lui-même : une organisation sans propriétaire est une ressource que plus
 * personne ne gouverne. Se retirer soi-même n'est donc pas un cas particulier —
 * il n'y a qu'une règle, et c'est ce qui évite qu'un des deux chemins l'oublie.
 *
 * Cette fonction décide du **message**. L'invariant, lui, est tenu par le
 * prédicat de l'ordre de suppression, qui compte les propriétaires dans la même
 * instruction : une lecture suivie d'un `delete` laisserait la fenêtre où deux
 * propriétaires se retirent simultanément.
 */
export function removalRefusal(
  members: readonly RemovableMember[],
  targetUserId: string,
): InvitationRefusal | null {
  const target = members.find((member) => member.userId === targetUserId)

  if (target === undefined) {
    return 'not_a_member'
  }

  if (target.role !== 'owner') {
    return null
  }

  const owners = members.filter((member) => member.role === 'owner').length

  return owners <= 1 ? 'last_owner' : null
}

/**
 * Cette adresse est-elle déjà celle d'un membre ?
 *
 * La comparaison porte sur les adresses **normalisées** des deux côtés : sans
 * cela, une majuscule suffirait à réinviter quelqu'un qui est déjà là (critère
 * 4). C'est une comparaison de liste, jamais une recherche de compte par
 * adresse : le module ne sait pas interroger `auth_user` par email, et c'est ce
 * qui rend l'absence d'énumération structurelle (`docs/security.md` §7).
 */
export function alreadyMember(memberEmails: readonly string[], candidate: string): boolean {
  const wanted = normalizeEmail(candidate)

  return memberEmails.some((email) => normalizeEmail(email) === wanted)
}

/** Le quota est-il atteint ? `count` est le nombre d'émissions sur la fenêtre. */
export function exceedsInvitationQuota(count: number): boolean {
  return count >= INVITATION_QUOTA_PER_WINDOW
}
