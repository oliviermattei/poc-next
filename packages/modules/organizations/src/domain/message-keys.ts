import { qualifyMessageKey } from '@repo/core'

import {
  INVITATION_REFUSALS,
  type InvitationRefusal,
  type InvitationStatus,
} from './invitation'
import {
  ORGANIZATIONS_MODULE_ID,
  ORGANIZATION_ROLES,
  type OrganizationRefusal,
  type OrganizationRole,
} from './organization'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs.
 *
 * Deux raisons, et les deux sont mesurées sur ce dépôt :
 *
 * 1. `tests/i18n.test.ts` balaie les fichiers **rendus** (`.tsx`) et exige que
 *    chaque clé citée existe dans le catalogue. Une clé écrite dans un `.tsx`
 *    y est vue **non qualifiée** (`screen.title`) alors que le catalogue la
 *    porte qualifiée (`organizations.screen.title`) : citée depuis l'écran,
 *    elle passe donc pour manquante. Mesuré, dix-neuf fois, à l'écriture de
 *    cette story. Les clés vivent donc dans ce fichier `.ts`, et l'écran ne
 *    manipule que des constantes ;
 * 2. deux d'entre elles dépendent d'une **valeur** — le rôle dans
 *    l'organisation, le motif d'un refus. Elles sont invisibles à tout
 *    balayage statique, et un gabarit écrit dans un `.tsx`
 *    (`` `role.${role}` ``) se lit comme un morceau de phrase concaténé (neuf
 *    faux positifs mesurés en s10). Les composants appellent donc des
 *    **fonctions nommées**.
 *
 * `organizationsMessageKeys()` est la liste complète :
 * `tests/organizations.test.ts` la confronte aux catalogues, dans chaque locale
 * du projet. Une clé ajoutée sans sa traduction ferait un écran en 500 —
 * `getMessageFallback` lève depuis s09 — et rien ne le dirait avant.
 */

/** Une clé du module, qualifiée comme le registre le fera. */
export const organizationsKey = (key: string): string =>
  qualifyMessageKey(ORGANIZATIONS_MODULE_ID, key)

/** Le libellé d'un rôle dans une organisation. */
export const roleLabelKey = (role: OrganizationRole): string => organizationsKey(`role.${role}`)

/** Le message d'un refus, tel que l'écran l'affiche. */
export const refusalMessageKey = (refusal: OrganizationRefusal | InvitationRefusal): string =>
  organizationsKey(`error.${refusal}`)

/** Le libellé du statut d'une invitation (en attente, échue). */
export const invitationStatusKey = (status: InvitationStatus): string =>
  organizationsKey(`invitations.status.${status}`)

/** Les motifs de refus que l'écran sait rendre. Dérivés du `domain`, pas recopiés. */
export const ORGANIZATION_REFUSALS = [
  'invalid_name',
  'invalid_slug',
  'slug_unavailable',
] as const satisfies readonly OrganizationRefusal[]

/** Les clés fixes de l'écran, qualifiées une fois pour toutes. */
export const ORGANIZATIONS_KEYS = {
  navigation: organizationsKey('navigation.organizations'),
  screenTitle: organizationsKey('screen.title'),
  screenDescription: organizationsKey('screen.description'),
  currentTitle: organizationsKey('current.title'),
  currentDescription: organizationsKey('current.description'),
  switcherLabel: organizationsKey('current.switcherLabel'),
  /**
   * Le libellé du déclencheur quand **aucune** organisation n'est courante
   * alors que le compte en a (constat F7 de la revue de s15).
   *
   * L'écran passait `empty.title` — « Aucune organisation » — et le
   * déclencheur, nommé par son texte visible, annonçait donc un état vide comme
   * l'état courant d'un compte qui en a trois. C'est l'état d'un membre retiré
   * (ADR 025) et celui d'un compte invité (s16) : une invite, pas un constat de
   * vide.
   */
  switcherNone: organizationsKey('current.none'),
  settingsTitle: organizationsKey('settings.title'),
  settingsDescription: organizationsKey('settings.description'),
  settingsName: organizationsKey('settings.nameLabel'),
  settingsSlug: organizationsKey('settings.slugLabel'),
  settingsSlugHint: organizationsKey('settings.slugHint'),
  settingsSubmit: organizationsKey('settings.submit'),
  createTitle: organizationsKey('create.title'),
  createDescription: organizationsKey('create.description'),
  createName: organizationsKey('create.nameLabel'),
  createSlug: organizationsKey('create.slugLabel'),
  createSlugHint: organizationsKey('create.slugHint'),
  createSubmit: organizationsKey('create.submit'),
  emptyTitle: organizationsKey('empty.title'),
  emptyDescription: organizationsKey('empty.description'),
  /* ----------------------------------------------------------------------- *
   * s16 — les membres, les invitations, et l'écran d'atterrissage du lien.
   * ----------------------------------------------------------------------- */
  membersTitle: organizationsKey('members.title'),
  membersDescription: organizationsKey('members.description'),
  membersYou: organizationsKey('members.you'),
  /**
   * Le texte **visible** du bouton, court, et son **nom accessible**, qui nomme
   * sa cible.
   *
   * Les deux, parce qu'aucun des deux ne suffit : quatre boutons « Retirer »
   * sont indiscernables au clavier comme pour une aide technique, et une adresse
   * écrite dans le bouton le rend indéformable et fait déborder l'écran — mesuré
   * à 390 px, 1033 px de contenu.
   */
  membersRemove: organizationsKey('members.remove'),
  membersRemoveFor: organizationsKey('members.removeFor'),
  membersLeave: organizationsKey('members.leave'),
  invitationsTitle: organizationsKey('invitations.title'),
  invitationsDescription: organizationsKey('invitations.description'),
  invitationsEmailLabel: organizationsKey('invitations.emailLabel'),
  invitationsHint: organizationsKey('invitations.hint'),
  invitationsSubmit: organizationsKey('invitations.submit'),
  invitationsResend: organizationsKey('invitations.resend'),
  invitationsResendFor: organizationsKey('invitations.resendFor'),
  invitationsRevoke: organizationsKey('invitations.revoke'),
  invitationsRevokeFor: organizationsKey('invitations.revokeFor'),
  invitationsEmptyTitle: organizationsKey('invitations.emptyTitle'),
  invitationsEmptyDescription: organizationsKey('invitations.emptyDescription'),
  acceptTitle: organizationsKey('accept.title'),
  acceptDescription: organizationsKey('accept.description'),
  acceptSubmit: organizationsKey('accept.submit'),
  acceptAnonymous: organizationsKey('accept.anonymous'),
  acceptSignIn: organizationsKey('accept.signIn'),
  acceptSignUp: organizationsKey('accept.signUp'),
  acceptBack: organizationsKey('accept.back'),
  acceptRefusedTitle: organizationsKey('accept.refusedTitle'),
} as const

/**
 * Les statuts qu'une invitation peut porter à l'écran.
 *
 * Seuls `pending` et `expired` y figurent : `accepted` et `revoked` sortent de
 * la liste des invitations vivantes, donc aucun écran ne les affiche. Le refus
 * qui les nomme, lui, passe par `refusalMessageKey`.
 */
export const DISPLAYED_INVITATION_STATUSES = [
  'pending',
  'expired',
] as const satisfies readonly InvitationStatus[]

/** Toutes les clés du module, fixes et composées, pour la garde de complétude. */
export const organizationsMessageKeys = (): readonly string[] => [
  ...Object.values(ORGANIZATIONS_KEYS),
  ...ORGANIZATION_ROLES.map(roleLabelKey),
  ...ORGANIZATION_REFUSALS.map(refusalMessageKey),
  ...INVITATION_REFUSALS.map(refusalMessageKey),
  ...DISPLAYED_INVITATION_STATUSES.map(invitationStatusKey),
]
