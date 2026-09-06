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
import { grantsOwnership } from './permissions'

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

/**
 * Les motifs de refus que l'écran sait rendre. Dérivés du `domain`, pas recopiés.
 *
 * **Les trois de s34 y sont entrés avec l'écran qui les montre** (s34b) : le
 * serveur les rendait depuis s34, la redirection les portait en paramètre, et
 * `app/organizations/page.tsx` — dont l'énumération Zod vient d'ici — les
 * refusait faute d'être déclarés. Une suppression refusée revenait donc sur un
 * écran muet.
 */
export const ORGANIZATION_REFUSALS = [
  'invalid_name',
  'invalid_slug',
  'slug_unavailable',
  'invalid_role',
  'confirmation_mismatch',
  'billing_cancel_failed',
  'purge_failed',
] as const satisfies readonly OrganizationRefusal[]

/**
 * **Tout motif que le module peut refuser est rendable par un écran** — tenu
 * par le compilateur, donc par `pnpm typecheck`.
 *
 * Les routes redirigent vers l'écran avec `?error=<motif>`, et
 * `apps/web/app/organizations/page.tsx` valide ce paramètre contre les deux
 * listes ci-dessus (Zod à chaque frontière). Un motif **absent** des listes n'y
 * est donc pas reconnu : la redirection aboutit sur un écran **muet**, ce qui
 * est exactement ce qui s'était produit entre `s34` et `s34b` — la suppression
 * d'organisation rendait trois motifs qu'aucun écran ne savait afficher.
 *
 * `satisfies` ne tient que l'inclusion inverse (rien d'inventé) ; celle-ci tient
 * la **couverture**. Sans elle, ajouter un motif au `domain` sans l'ajouter ici
 * ne fait rougir aucune commande — mesuré : la mutation qui retire les trois
 * motifs de `s34` laissait `pnpm test` entièrement vert.
 */
type AssertNever<T extends never> = T

export type EveryRefusalIsRenderable = AssertNever<
  Exclude<
    OrganizationRefusal | InvitationRefusal,
    (typeof ORGANIZATION_REFUSALS)[number] | (typeof INVITATION_REFUSALS)[number]
  >
>

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
  /**
   * s17 — le transfert de propriété : un libellé à lui, distinct des autres
   * rôles.
   *
   * « Propriétaire » dirait le rôle posé sans dire ce que le geste coûte à qui
   * clique : il perd la propriété. Le bouton doit dire ce qui va se passer.
   */
  membersTransfer: organizationsKey('members.transfer'),
  membersTransferFor: organizationsKey('members.transferFor'),
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
  /**
   * **Le plafond, dit à quelqu'un qui n'est pas membre** (s47, décision 3).
   *
   * Un second texte pour un seul motif, et c'est une décision de sécurité :
   * celui qui accepte une invitation n'appartient pas encore à
   * l'organisation, et lui nommer l'offre ou le nombre de places lui
   * apprendrait quelque chose d'elle. Il apprend seulement que l'organisation
   * ne peut pas l'accueillir, et à qui parler.
   */
  acceptSeatLimit: organizationsKey('accept.seatLimit'),
  /* ----------------------------------------------------------------------- *
   * s34b — la suppression de l'organisation, côté écran. Le serveur est celui
   * de s34 : il compare la saisie au nom, réservé au propriétaire, et il n'a
   * pas bougé.
   * ----------------------------------------------------------------------- */
  deleteTitle: organizationsKey('delete.title'),
  deleteDescription: organizationsKey('delete.description'),
  deleteWarning: organizationsKey('delete.warning'),
  deleteConfirmationLabel: organizationsKey('delete.confirmationLabel'),
  deleteSubmit: organizationsKey('delete.submit'),
} as const

/**
 * Le message d'un refus **tel que l'écran d'acceptation l'affiche** (s47).
 *
 * Elle ne diffère de `refusalMessageKey` que sur un motif, et c'est le seul qui
 * porte une information appartenant à l'organisation : son plafond de membres.
 * Qui lit cet écran-là n'en est pas membre — il tient un lien, rien de plus.
 *
 * **Elle ne masque pas un refus, elle en change le texte.** Le motif reste le
 * même code, il reste dans `ACCEPT_REFUSALS`, et l'écran l'affiche : c'est
 * exactement ce que s23 exigeait pour `seat_sync_unavailable`, dire la vérité
 * plutôt que « lien invalide ». Ce qui est retiré est l'offre et le nombre, pas
 * le fait.
 *
 * Le partage est écrit **ici** et pas dans l'écran : une condition dans un
 * `.tsx` ferait exister la règle à deux endroits, et le second serait celui qui
 * ment.
 */
export const acceptRefusalMessageKey = (refusal: InvitationRefusal): string =>
  refusal === 'seat_limit_reached'
    ? ORGANIZATIONS_KEYS.acceptSeatLimit
    : refusalMessageKey(refusal)

/**
 * Le libellé du bouton qui **pose** un rôle sur une ligne, et son nom accessible.
 *
 * Deux clés par rôle, exactement comme les boutons de s16 : le texte visible est
 * court (« Administrateur »), le nom accessible nomme sa cible (« Nommer
 * marie@… administrateur »). Trois boutons identiques sur trois lignes sont
 * indiscernables au clavier comme pour une aide technique ; mettre l'adresse
 * *dans* le bouton le rendrait indéformable et ferait déborder l'écran à 390 px
 * — mesuré en s16.
 *
 * `owner` a ses propres clés : « Propriétaire » dirait le rôle posé sans dire ce
 * que le geste coûte à qui clique — il perd la propriété.
 *
 * Composées par une **fonction nommée** et non dans le `.tsx` : une clé
 * construite dans un composant est invisible au balayage de `tests/i18n.test.ts`
 * et se lit comme un fragment de phrase concaténé.
 */
export const roleActionKey = (role: OrganizationRole): string =>
  grantsOwnership(role) ? ORGANIZATIONS_KEYS.membersTransfer : organizationsKey(`members.make.${role}`)

export const roleActionForKey = (role: OrganizationRole): string =>
  grantsOwnership(role)
    ? ORGANIZATIONS_KEYS.membersTransferFor
    : organizationsKey(`members.makeFor.${role}`)

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
  ...ORGANIZATION_ROLES.map(roleActionKey),
  ...ORGANIZATION_ROLES.map(roleActionForKey),
  ...ORGANIZATION_REFUSALS.map(refusalMessageKey),
  ...INVITATION_REFUSALS.map(refusalMessageKey),
  ...DISPLAYED_INVITATION_STATUSES.map(invitationStatusKey),
]
